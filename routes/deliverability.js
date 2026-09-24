// ============================================================================
// DELIVERABILITY (read / monitoring) — suppression list, spam pre-check,
// per-variant reply analytics, and the deliverability health overview.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/deliverability')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
//
// NOTE: the sending-CONTROL routes (bounce/reply sweeps, emergency pause/resume,
// mailbox auto-pause resume) intentionally stay inline in index.js for now —
// they mutate live send state and belong with the send-pipeline work.
//
// email-validation and deliverability are required directly (Node caches them,
// so they're the same singletons index.js uses).
//
// ORGANISATION BOUNDARY (C-0023 X1-X4, 2026-09-23). Every tenant table here is
// reached through `db.forRequest(req)`, which puts the caller's org condition
// on reads AND on writes. The backend runs as service role, so RLS is no help:
// before this, one customer's admin could read every customer's opt-out list,
// sent-email samples and mailboxes — and DELETE another customer's opt-out, so
// that customer would then email somebody who had asked them to stop.
// ============================================================================
const express = require('express');
const { renderStoredEmail } = require('../email-vars');
const { emailSyntaxValid } = require('../email-validation');
const { scoreEmailContent } = require('../deliverability');
const { getSetting } = require('../config/settings');
const { domainHealthReport } = require('../domain-health');
const { mailboxConnections } = require('../mailbox-health');
const own = require('../services/ownership');
const { createDb } = require('../models');

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
// A malformed id is a Postgres cast error (22P02). For a by-id route that is
// "no such row", not a server fault.
const isBadId = (err) => !!err && err.code === '22P02';

// Human-readable label for a template_variant id, shown next to the raw id
// in the reply-rate table so PDs/BDs see a real name instead of "v1".
const VARIANT_LABELS = { v1: 'Style 1', v2: 'Style 2', v3: 'Style 3', v4: 'Style 4', v5: 'Style 5', default: 'Default template' };

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, addToSuppression, warmupLimit } = ctx;
  const db = ctx.db || createDb(supabase);
  const { reportingChainIds } = require('../hierarchy')(supabase);
  const orgOf = (req) => (ctx.orgIdFor ? ctx.orgIdFor(req) : ((req && (req.orgId || (req.user && req.user.org_id))) || null));
  // The viewer's D-0034 scope (services/ownership.js; hierarchy.js is the one chain walk).
  async function viewScopeFor(req) {
    const chain = hasRole(req, 'admin') ? null : await reportingChainIds(req.user.id, orgOf(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

// ── Suppression list (opt-outs / never-mail) ────────────────────────────────
// Scoped to the caller's organisation. NOTE: what the SEND path honours is
// ledger's rule (index.js loadSuppressedSet) and is not changed here.
router.get('/suppression', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const q = (req.query.q || '').toLowerCase().trim();
    let query = db.forRequest(req).from('suppression_list').select('id,email,reason,source,note,created_at').order('created_at', { ascending: false }).limit(500);
    if (q) query = query.ilike('email', `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/suppression', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const { email, note } = req.body || {};
    if (!email || !emailSyntaxValid(email)) return res.status(400).json({ error: 'Valid email required' });
    await addToSuppression(email, 'manual', 'admin', req.user.id, note || null, orgOf(req));
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Removing an opt-out means somebody who asked not to be emailed can be emailed
// again — so the org condition rides ON the delete itself, in one statement,
// and a row that is not this organisation's answers 404 exactly like a missing
// one (never 403, which would confirm it exists). `success` is only ever said
// about a row the database actually removed.
router.delete('/suppression/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const { data: gone, error } = await db.forRequest(req).from('suppression_list')
      .delete().eq('id', req.params.id).select('id');
    if (error && !isBadId(error)) throw error;
    if (!gone || !gone.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Spam-content pre-check (non-blocking) ───────────────────────────────────
router.post('/emails/spam-check', auth, (req, res) => {
  const { subject, body } = req.body || {};
  res.json(scoreEmailContent(subject || '', body || ''));
});

// ── Reply rate per template variant (closes the A/B loop) ───────────────────
router.get('/analytics/templates', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 0, 0), 365);
    const sinceIso = days > 0 ? new Date(Date.now() - days * 24 * 3600 * 1000).toISOString() : null;
    const scoped = db.forRequest(req);

    // The COUNTS are the organisation's (an aggregate, and an A/B comparison is
    // only worth anything over every send). Paginated and ordered — this read
    // used to stop silently at Supabase's 1,000-row cap — and it carries no
    // bodies, because counting needs none.
    const sent = [];
    for (let from = 0; ; from += 1000) {
      let q = scoped.from('emails').select('id,template_variant,contact_id').eq('status', 'sent');
      if (sinceIso) q = q.gte('created_at', sinceIso);
      const { data: page, error } = await q.order('id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!page || !page.length) break;
      sent.push(...page);
      if (page.length < 1000) break;
    }
    const byVar = {};
    const contactIds = new Set();
    sent.forEach(e => {
      const v = e.template_variant || 'default';
      byVar[v] = byVar[v] || { variant: v, sent: 0, contacts: new Set(), sample: null };
      byVar[v].sent++;
      if (e.contact_id) { byVar[v].contacts.add(e.contact_id); contactIds.add(e.contact_id); }
    });

    // The SAMPLE is one real email somebody sent, so it follows D-0034: only
    // from mail the viewer may see (their own people's), else none. An RA Lead
    // therefore gets the numbers and no BD's letter (rampart.md decision D4).
    const senderIds = own.queryOwnerIds(await viewScopeFor(req)); // null = admin
    if (!senderIds || senderIds.length) {
      let sq = scoped.from('emails').select('template_variant,subject,body,from_email,sent_by,created_at').eq('status', 'sent');
      if (sinceIso) sq = sq.gte('created_at', sinceIso);
      if (senderIds) sq = sq.in('sent_by', senderIds);
      const { data: recent } = await sq.order('created_at', { ascending: false }).limit(300);
      (recent || []).forEach(e => {
        const v = e.template_variant || 'default';
        // The stored body keeps {{sender}} until it is sent; this sample is shown
        // on the Admin templates page, so render it like every other reader does.
        // from_email is selected so the name it resolves to is the real sender's.
        if (byVar[v] && !byVar[v].sample && e.subject) byVar[v].sample = renderStoredEmail(e, null);
      });
    }

    // In chunks: thousands of ids in one `.in()` is a URL no server accepts, and
    // the error it produced was swallowed below as "nobody replied".
    let repliedSet = new Set();
    for (const ids of chunk([...contactIds], 150)) {
      try {
        const { data: replied } = await scoped.from('contacts').select('id').in('id', ids).not('replied_at', 'is', null);
        (replied || []).forEach(r => repliedSet.add(r.id));
      } catch (_) {}
    }
    const rows = Object.values(byVar).map(r => {
      const repliedContacts = [...r.contacts].filter(id => repliedSet.has(id)).length;
      return {
        variant: r.variant, label: VARIANT_LABELS[r.variant] || r.variant,
        sent: r.sent, replied: repliedContacts,
        reply_rate: r.sent ? Math.round(repliedContacts / r.sent * 1000) / 10 : 0,
        sample: r.sample
      };
    }).sort((a, b) => b.reply_rate - a.reply_rate);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Deliverability health overview ──────────────────────────────────────────
router.get('/admin/deliverability', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    // Scope the mailbox list to the caller's people, not everyone: 'own' = just
    // their own mailboxes, 'team' = their reporting line, 'org' = the whole org
    // (admin only). Non-admins default to their team; admins to org-wide.
    const admin = hasRole(req, 'admin');
    let view = ['own', 'team', 'org'].includes(req.query.view) ? req.query.view : (admin ? 'org' : 'team');
    if (view === 'org' && !admin) view = 'team';
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    // All five figures are THIS organisation's. Sent/failed are exact counts —
    // reading the rows and counting them stopped at Supabase's 1,000-row cap.
    const scoped = db.forRequest(req);
    const countOf = async (q) => { try { const { count } = await q; return count || 0; } catch (_) { return 0; } };
    const [sent, failed, bounced, replied, suppression] = await Promise.all([
      countOf(scoped.from('emails').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', since)),
      countOf(scoped.from('emails').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since)),
      countOf(scoped.from('contacts').select('id', { count: 'exact', head: true }).eq('email_status', 'invalid')),
      countOf(scoped.from('contacts').select('id', { count: 'exact', head: true }).not('replied_at', 'is', null)),
      countOf(scoped.from('suppression_list').select('id', { count: 'exact', head: true })),
    ]);
    let mbQuery = scoped.from('user_emails').select('id,email_address,display_name,is_active,daily_send_limit,user_id').eq('is_active', true);
    if (view !== 'org') {
      const ids = view === 'own' ? [req.user.id] : await reportingChainIds(req.user.id, orgOf(req));
      mbQuery = mbQuery.in('user_id', ids);
    }
    const { data: mailboxes } = await mbQuery;
    const delivCols = {};
    for (const ids of chunk((mailboxes || []).map(m => m.id), 100)) {
      try { const { data } = await scoped.from('user_emails').select('id,warmup_start_date,auto_paused_at').in('id', ids); (data || []).forEach(r => { delivCols[r.id] = r; }); } catch (_) {}
    }
    const [warmupStart, warmupStep] = await Promise.all([
      getSetting(supabase, 'mailbox_warmup_start'),
      getSetting(supabase, 'mailbox_warmup_step'),
    ]);
    const conns = await mailboxConnections(supabase, (mailboxes || []).map(m => m.id));
    const mailboxHealth = (mailboxes || []).map(m => {
      const dc = delivCols[m.id] || {};
      return {
        id: m.id, email: m.email_address, name: m.display_name, daily_limit: m.daily_send_limit,
        auto_paused: !!dc.auto_paused_at,
        connection: conns[m.id] || { connected: false, status: 'none' },
        warmup: dc.warmup_start_date ? { since: dc.warmup_start_date, today_cap: warmupLimit(dc, warmupStart, warmupStep) } : null
      };
    });
    res.json({ window_days: days, view, can_org: admin, sent, failed, bounced_contacts: bounced, replied_contacts: replied, suppression_count: suppression, mailboxes: mailboxHealth });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  // ── Domain authentication + blacklist health ───────────────────────────────
  // SPF/DKIM/DMARC record checks + DNSBL lookups for every sending domain.
  // DNS is slow, so results are cached ~15 min; ?refresh=1 forces a re-check.
  const healthCache = new Map(); // domain -> { report, at }
  const HEALTH_TTL_MS = 15 * 60 * 1000;
  router.get('/admin/domain-health', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      // This organisation's sending domains only — another customer's domains
      // (and their DNS posture) are not this caller's to read.
      const { data: mbs } = await db.forRequest(req).from('user_emails').select('email_address').eq('is_active', true);
      const domains = [...new Set((mbs || [])
        .map(m => (m.email_address || '').split('@')[1])
        .filter(Boolean).map(d => d.toLowerCase()))];
      const reports = await Promise.all(domains.map(async (d) => {
        const cached = healthCache.get(d);
        if (!refresh && cached && (Date.now() - cached.at) < HEALTH_TTL_MS) return cached.report;
        const report = await domainHealthReport(d);
        healthCache.set(d, { report, at: Date.now() });
        return report;
      }));
      reports.sort((a, b) => (a.score == null ? 101 : a.score) - (b.score == null ? 101 : b.score)); // worst first
      res.json({ domains: reports, checked: reports.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
