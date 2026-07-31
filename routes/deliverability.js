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
// ============================================================================
const express = require('express');
const { emailSyntaxValid } = require('../email-validation');
const { scoreEmailContent } = require('../deliverability');
const { getSetting } = require('../config/settings');
const { domainHealthReport } = require('../domain-health');
const { mailboxConnections } = require('../mailbox-health');

// Human-readable label for a template_variant id, shown next to the raw id
// in the reply-rate table so PDs/BDs see a real name instead of "v1".
const VARIANT_LABELS = { v1: 'Style 1', v2: 'Style 2', v3: 'Style 3', v4: 'Style 4', v5: 'Style 5', default: 'Default template' };

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, addToSuppression, warmupLimit } = ctx;

// ── Suppression list (opt-outs / never-mail) ────────────────────────────────
router.get('/suppression', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const q = (req.query.q || '').toLowerCase().trim();
    let query = supabase.from('suppression_list').select('id,email,reason,source,note,created_at').order('created_at', { ascending: false }).limit(500);
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
    await addToSuppression(email, 'manual', 'admin', req.user.id, note || null);
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/suppression/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    await supabase.from('suppression_list').delete().eq('id', req.params.id);
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
    let q = supabase.from('emails').select('template_variant,contact_id,status,subject,body,created_at').eq('status', 'sent');
    if (days > 0) q = q.gte('created_at', new Date(Date.now() - days * 24 * 3600 * 1000).toISOString());
    const { data: sent } = await q;
    const byVar = {};
    const contactIds = new Set();
    (sent || []).forEach(e => {
      const v = e.template_variant || 'default';
      byVar[v] = byVar[v] || { variant: v, sent: 0, contacts: new Set(), sample: null };
      byVar[v].sent++;
      if (!byVar[v].sample && e.subject) byVar[v].sample = { subject: e.subject, body: e.body || '' };
      if (e.contact_id) { byVar[v].contacts.add(e.contact_id); contactIds.add(e.contact_id); }
    });
    let repliedSet = new Set();
    if (contactIds.size) {
      try {
        const { data: replied } = await supabase.from('contacts').select('id').in('id', [...contactIds]).not('replied_at', 'is', null);
        repliedSet = new Set((replied || []).map(r => r.id));
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
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const { data: emails } = await supabase.from('emails').select('status,created_at').gte('created_at', since);
    const all = emails || [];
    const sent = all.filter(e => e.status === 'sent').length;
    const failed = all.filter(e => e.status === 'failed').length;
    let bounced = 0, replied = 0, suppression = 0;
    try { const { count } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('email_status', 'invalid'); bounced = count || 0; } catch (_) {}
    try { const { count } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).not('replied_at', 'is', null); replied = count || 0; } catch (_) {}
    try { const { count } = await supabase.from('suppression_list').select('id', { count: 'exact', head: true }); suppression = count || 0; } catch (_) {}
    const { data: mailboxes } = await supabase.from('user_emails').select('id,email_address,display_name,is_active,daily_send_limit').eq('is_active', true);
    const delivCols = {};
    try { const { data } = await supabase.from('user_emails').select('id,warmup_start_date,auto_paused_at'); (data || []).forEach(r => { delivCols[r.id] = r; }); } catch (_) {}
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
    res.json({ window_days: days, sent, failed, bounced_contacts: bounced, replied_contacts: replied, suppression_count: suppression, mailboxes: mailboxHealth });
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
      const { data: mbs } = await supabase.from('user_emails').select('email_address').eq('is_active', true);
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
