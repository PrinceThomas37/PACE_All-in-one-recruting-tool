// ============================================================================
// EMAILS (reads + simple record ops) — list, pending-count, pending-summary,
// send-progress (polled), manual "mark sent" insert, edit/delete a draft.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/emails')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
//
// IMPORTANT: the send-PIPELINE routes (retry-pending-window, reminder-send,
// generate, send-selected, queue-all) intentionally stay inline in index.js —
// they drive the live Microsoft Graph send loop, background progress state and
// deferred-send logic, and are handled separately with extra care.
//
// The send-window helpers and the send-progress in-memory mirror stay in
// index.js (the send loop uses them too) and are passed in via ctx, so this
// module reads the exact same Map/functions the pipeline writes.
//
// WHO SEES WHICH EMAIL (D-0034, 2026-09-23 — C-0023 / C-0015)
// Every query here goes through `db.forRequest(req)`, so it is bound to the
// caller's organisation by construction: the backend runs as service role, RLS
// is bypassed, and application code is the only thing between one customer's
// outbound book and another's. Inside the organisation, GET /emails returns
// what the viewer's people SENT plus what was sent about the leads their people
// OWN — the rule is `services/ownership.js`, not re-derived here. An RA Lead
// gets per-sender COUNTS (GET /emails/sender-summary), never another person's
// messages (rampart.md decision D4).
// ============================================================================
const express = require('express');
const { renderStoredEmail } = require('../email-vars');
const { isStaleProgress } = require('../services/send-progress');
const sendRetry = require('../services/send-retry');
const settingsConfig = require('../config/settings');
const engineDraft = require('../services/engine-draft');
const own = require('../services/ownership');
const { createDb } = require('../models');

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const newestFirst = (a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0);
const SUMMARY_STATUSES = ['pending', 'sent', 'failed'];

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, hasRole, today, logActivity,
    getSendWindowHours, isInLeadSendWindow, getMinutesUntilWindowOpens,
    formatWindowOpensLabel, padHour, sendProgressCache,
  } = ctx;
  // routeCtx carries `db`; a harness that builds this router without one still
  // gets the scoped layer rather than raw, unscoped access.
  const db = ctx.db || createDb(supabase);
  const { reportingChainIds } = require('../hierarchy')(supabase);
  const orgOf = (req) => (ctx.orgIdFor ? ctx.orgIdFor(req) : ((req && (req.orgId || (req.user && req.user.org_id))) || null));

  // The viewer's D-0034 scope. hierarchy.js is the ONE chain walk; admin needs
  // none because the whole organisation is their view.
  async function viewScopeFor(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgOf(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  // Every page of a query. `build` must return a FRESH builder that is already
  // ORDERED — .range() without an ORDER BY repeats or skips rows between pages.
  async function allPages(build) {
    let out = [], from = 0;
    while (true) {
      const { data, error } = await build().range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      out = out.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return out;
  }

  // The row every Email screen draws. Defined once so the two queries that
  // fetch it cannot drift; `job.assigned_to_bd` is what the D-0034 gate reads.
  const emailRows = (req) => db.forRequest(req).from('emails').select(`*, contact:contacts(id,first_name,last_name,email,designation), job:jobs(id,position,timezone,company_id,assigned_to_bd,company:companies(name,industry,location),sending_email:user_emails!sending_email_id(id,email_address,display_name)), sender:users!sent_by(id,name,email)`);

  // Email about a lead the view OWNS, sent by somebody OUTSIDE it — a recycled
  // lead's history travels with the lead (D-0034). Ids first, so the bodies
  // already fetched by sender are never fetched twice.
  async function emailsOnOwnedLeads(req, ownerIds, status, have) {
    const owned = await allPages(() => db.forRequest(req).from('jobs')
      .select('id').in('assigned_to_bd', ownerIds).order('id', { ascending: true }));
    if (!owned.length) return [];
    const inside = new Set(ownerIds);
    const want = [];
    for (const jobIds of chunk(owned.map(j => j.id), 100)) {
      const rows = await allPages(() => {
        let q = db.forRequest(req).from('emails').select('id,sent_by').in('job_id', jobIds);
        if (status) q = q.eq('status', status);
        return q.order('id', { ascending: true });
      });
      rows.forEach(r => { if (!have.has(r.id) && !inside.has(r.sent_by)) want.push(r.id); });
    }
    let out = [];
    for (const ids of chunk(want, 100)) {
      const { data, error } = await emailRows(req).in('id', ids);
      if (error) throw error;
      out = out.concat(data || []);
    }
    return out;
  }

router.get('/emails', auth, async (req, res) => {
  try {
    const { status } = req.query;
    // D-0034. What the viewer's people SENT, plus what was sent about the leads
    // their people OWN. Admin: the whole organisation. `?mine=1` narrows to the
    // caller's own queue — what the Send/Retry controls act on.
    const scope = await viewScopeFor(req);
    const mineOnly = req.query.mine === '1' || req.query.mine === 'true';
    const senderIds = mineOnly ? [req.user.id] : own.queryOwnerIds(scope); // null = the whole org

    // Narrowed IN SQL before .range() (a filter applied after a page limit
    // empties pages silently), and ordered, with a unique tie-breaker.
    let allData = await allPages(() => {
      let query = emailRows(req);
      if (senderIds) query = query.in('sent_by', senderIds);
      if (status) query = query.eq('status', status);
      return query.order('created_at', { ascending: false }).order('id', { ascending: true });
    });
    if (senderIds && !mineOnly) {
      const extra = await emailsOnOwnedLeads(req, senderIds, status, new Set(allData.map(e => e.id)));
      if (extra.length) allData = allData.concat(extra).sort(newestFirst);
    }
    // The boundary. The SQL above is the speed; this predicate is the rule.
    const jobsById = new Map();
    allData.forEach(e => { if (e.job && e.job.id) jobsById.set(e.job.id, e.job); });
    allData = own.scopeEmails(allData, jobsById, scope);

    // A queued email keeps {{sender}} in storage until it is sent, so it is
    // rendered HERE — once, for every screen — from the mailbox that will
    // actually send it. No page should have to know the token exists.
    //
    // Which mailbox, in the same order the send loop picks it: the row's pinned
    // mailbox (a sequence rotating its "from"), else the lead's, else the row's
    // from_email supplies the name.
    const pinnedIds = [...new Set(allData.map(e => e.sending_email_id).filter(Boolean))];
    const pinnedById = {};
    for (const ids of chunk(pinnedIds, 100)) {
      const { data: pinned } = await db.forRequest(req).from('user_emails')
        .select('id,email_address,display_name').in('id', ids);
      (pinned || []).forEach(m => { pinnedById[m.id] = m; });
    }
    // D-0032: the engine's first email is written by AI at send time, so a
    // queued one still shows the template. Say so on the row rather than let
    // the preview pass for the final text.
    let aiFirstOn = false;
    try { aiFirstOn = Number(await settingsConfig.getSetting(supabase, 'engine_ai_first_email')) === 1; } catch (_) {}
    const isAdmin = hasRole(req, 'admin');
    allData = allData.map((e) => {
      const mailbox = (e.sending_email_id && pinnedById[e.sending_email_id]) || e.job?.sending_email || null;
      const isMine = e.sent_by === req.user.id;
      // What the Email page says about a failure or a scheduled retry comes
      // from send-retry.js, the same rules the send loop obeyed — no page
      // re-derives "can this be retried". The retry routes act only on the
      // caller's own email (or an admin's), so a manager reviewing a report's
      // failure is not offered a Retry that would answer 404 (D-0020).
      return { ...e, ...renderStoredEmail(e, mailbox), sending_email: mailbox,
        is_mine: isMine,
        retry_note: sendRetry.describeRetry(e), can_retry: sendRetry.canRetryByHand(e) && (isMine || isAdmin),
        ai_written: e.template_variant === 'ai',
        ai_will_write: aiFirstOn && e.status === 'pending' && engineDraft.isFirstEmail(e) && e.template_variant !== 'ai' };
    });
    res.json(allData);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/pending-count', auth, async (req, res) => {
  try {
    const { count, error } = await supabase.from('emails').select('id', { count: 'exact', head: true }).eq('sent_by', req.user.id).eq('status', 'pending');
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Per-sender COUNTS — pending / sent / failed — for the people whose sending
// the viewer operates. An RA Lead runs send operations for every BD (pausing a
// BD, retrying a BD's queue), so they and admin get every sender in the
// ORGANISATION; everyone else gets their own D-0034 view. Numbers only: this
// never returns a message, an address or a subject (rampart.md decision D4).
// Registered above every /emails/:id route (a literal after a :param is dead).
router.get('/emails/sender-summary', auth, async (req, res) => {
  try {
    const operator = hasRole(req, 'admin', 'ra_lead');
    const scope = operator ? null : await viewScopeFor(req);
    const senderIds = operator ? null : own.queryOwnerIds(scope);
    const rows = await allPages(() => {
      let q = db.forRequest(req).from('emails').select('id,sent_by,status').in('status', SUMMARY_STATUSES);
      if (senderIds) q = q.in('sent_by', senderIds);
      return q.order('id', { ascending: true });
    });
    const bySender = new Map();
    for (const r of rows) {
      if (!r.sent_by || !SUMMARY_STATUSES.includes(r.status)) continue;
      if (!bySender.has(r.sent_by)) bySender.set(r.sent_by, { id: r.sent_by, name: null, pending: 0, sent: 0, failed: 0 });
      bySender.get(r.sent_by)[r.status] += 1;
    }
    for (const ids of chunk([...bySender.keys()], 100)) {
      const { data: people } = await db.forRequest(req).from('users').select('id,name').in('id', ids);
      (people || []).forEach(p => { if (bySender.has(p.id)) bySender.get(p.id).name = p.name || null; });
    }
    const senders = [...bySender.values()]
      .map(s => ({ ...s, name: s.name || 'Unknown' }))
      .sort((a, b) => (b.pending + b.sent + b.failed) - (a.pending + a.sent + a.failed) || String(a.name).localeCompare(String(b.name)));
    res.json({ scope: operator ? 'org' : scope.label, senders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/pending-summary', auth, async (req, res) => {
  try {
    const sendWindow = await getSendWindowHours();
    if (!hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Counts of the caller's own queue — or, for the two roles that operate
    // other people's sending, a named sender's. Never outside the organisation.
    let query = db.forRequest(req).from('emails').select('id, job:jobs(timezone)').eq('status', 'pending');
    if (hasRole(req, 'admin', 'ra_lead') && req.query.manager_id) {
      query = query.eq('sent_by', req.query.manager_id);
    } else if (!hasRole(req, 'admin', 'ra_lead')) {
      query = query.eq('sent_by', req.user.id);
    }
    query = query.order('id', { ascending: true });

    let rows = [], from = 0;
    while (true) {
      const { data, error } = await query.range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      rows = rows.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }

    const byTz = {};
    let ready_now = 0;
    let waiting_window = 0;
    for (const row of rows) {
      const tz = row.job?.timezone || 'EST';
      if (!byTz[tz]) byTz[tz] = { timezone: tz, pending: 0, ready_now: 0, waiting_window: 0 };
      byTz[tz].pending++;
      if (isInLeadSendWindow(tz, new Date(), sendWindow)) {
        byTz[tz].ready_now++;
        ready_now++;
      } else {
        byTz[tz].waiting_window++;
        waiting_window++;
      }
    }

    const by_timezone = Object.values(byTz)
      .sort((a, b) => b.pending - a.pending)
      .map(t => ({
        ...t,
        minutes_until_opens: getMinutesUntilWindowOpens(t.timezone, new Date(), sendWindow),
        resumes_label: formatWindowOpensLabel(t.timezone, sendWindow)
      }));

    const winLbl = `${padHour(sendWindow.start)} – ${padHour(sendWindow.end)} lead local time`;
    res.json({
      total_pending: rows.length,
      ready_now,
      waiting_window,
      by_timezone,
      send_window: sendWindow,
      send_window_label: winLbl,
      auto_retry: {
        interval_minutes: 20,
        note: 'In-window emails auto-retry every 20 minutes while the server is awake, and again ~3 minutes after startup.'
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emails', auth, async (req, res) => {
  try {
    const { contact_id, job_id, to_email, subject, body, platform } = req.body;
    if (!to_email) return res.status(400).json({ error: 'to_email required' });
    // A record of mail sent about a lead is an ACT on that lead (D-0020), and a
    // lead or contact in another organisation does not exist for this caller.
    const scoped = db.forRequest(req);
    if (job_id) {
      const touchable = ctx.canTouchJob ? await ctx.canTouchJob(req, job_id) : !!(await scoped.from('jobs').byId(job_id, 'id'));
      if (!touchable) return res.status(404).json({ error: 'Lead not found' });
    }
    if (contact_id && !(await scoped.from('contacts').byId(contact_id, 'id'))) return res.status(404).json({ error: 'Contact not found' });
    // The scoped insert stamps org_id — an unstamped row would be filed under
    // the DEFAULT organisation by the column default, silently.
    const { data, error } = await scoped.from('emails').insert({ contact_id: contact_id || null, job_id: job_id || null, to_email, subject, body, platform: platform || 'Gmail', sent_by: req.user.id, status: 'sent', sent_at: today() }).select().single();
    if (error) throw error;
    if (contact_id) await scoped.from('contacts').update({ email_sent_at: today(), email_platform: platform || 'Gmail', updated_at: new Date() }).eq('id', contact_id);
    if (job_id) await logActivity(job_id, contact_id || null, req.user.id, 'email_sent', `Email sent: ${subject || ''}`, null, null);
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/send-progress', auth, async (req, res) => {
  try {
    // Served from the in-memory mirror: this is the most frequently polled
    // endpoint (every 2-10s per BD), so it must not hit the DB on every call.
    // Fall back to the DB only until the mirror is warm after a restart.
    const key = `send_progress_${req.user.id}`;
    // A FINISHED run's card has a shelf life. The 60s timer that clears it only
    // fires while the process lives, and on the free tier the server sleeps —
    // so without this the card comes back hours later still asserting totals
    // about a queue that has since changed (emails purged, a new assignment
    // made) and contradicts the pending panel beside it.
    const expire = async (p) => {
      if (!isStaleProgress(p)) return p;
      sendProgressCache.set(req.user.id, null);
      try { await supabase.from('app_settings').delete().eq('key', key); } catch (_) {}
      return null;
    };
    const cached = sendProgressCache.get(req.user.id);
    if (cached !== undefined) return res.json((await expire(cached)) || { active: false });
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
    let progress = data ? JSON.parse(data.value) : null;
    progress = await expire(progress);
    sendProgressCache.set(req.user.id, progress);
    res.json(progress || { active: false });
  } catch { sendProgressCache.set(req.user.id, null); res.json({ active: false }); }
});

router.delete('/emails/:id', auth, async (req, res) => {
  try {
    // Org-scoped read: another organisation's email answers exactly like a
    // missing one, admin included.
    const { data, error } = await db.forRequest(req).from('emails').select('id,status,sent_by,job_id,job:jobs(id,assigned_to_bd)').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Email not found' });
    if (data.sent_by !== req.user.id && !hasRole(req, 'admin')) {
      // Deleting is acting, and acting is the sender's (D-0020). A manager who
      // can SEE this email is told whose it is; anyone else learns nothing.
      const scope = await viewScopeFor(req);
      if (!own.canSeeEmail(data, data.job, scope)) return res.status(404).json({ error: 'Email not found' });
      return res.status(403).json({ error: "This email is in somebody else's queue, so it is not yours to delete. Ask them, or an admin." });
    }
    if (data.status !== 'pending' && data.status !== 'failed') return res.status(400).json({ error: 'Can only delete pending or failed emails' });
    // The conditions ride ON the delete: the org (a by-id delete is never
    // trusted to the read above), and the status — the send loop may have
    // claimed this row since we read it, and a sent email must keep its record.
    const { data: gone, error: delErr } = await db.forRequest(req).from('emails')
      .delete().eq('id', req.params.id).in('status', ['pending', 'failed']).select('id');
    if (delErr) throw delErr;
    if (!gone || !gone.length) return res.status(409).json({ error: 'This email changed while you were deleting it — it may be sending now. Refresh and check.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/emails/:id', auth, async (req, res) => {
  try {
    const { subject, body } = req.body;
    const updates = {};
    if (subject !== undefined) updates.subject = subject;
    if (body !== undefined) updates.body = body;

    // The editor is handed the RENDERED text (real name, no {{sender}}), so
    // saving it back verbatim would freeze that name into the row and undo the
    // whole point of resolving it at send time. Opening the editor and pressing
    // Save without typing anything is not an edit — keep what is stored.
    const { data: current } = await supabase.from('emails')
      .select('subject,body,from_email,sending_email_id,job:jobs(sending_email_id,sending_email:user_emails!sending_email_id(id,email_address,display_name))')
      .eq('id', req.params.id).eq('sent_by', req.user.id).maybeSingle();
    if (current) {
      let mailbox = current.job?.sending_email || null;
      if (current.sending_email_id) {
        const { data: pinned } = await supabase.from('user_emails')
          .select('id,email_address,display_name').eq('id', current.sending_email_id).maybeSingle();
        if (pinned) mailbox = pinned;
      }
      const rendered = renderStoredEmail(current, mailbox);
      if (updates.subject === rendered.subject) delete updates.subject;
      if (updates.body === rendered.body) delete updates.body;
      // Answer with the rendered row for the same reason GET /emails does: the
      // editor must never be handed a raw {{sender}} back.
      if (!Object.keys(updates).length) return res.json({ ...current, ...rendered });

      const { data, error } = await supabase.from('emails').update(updates).eq('id', req.params.id).eq('sent_by', req.user.id).select().single();
      if (error) throw error;
      return res.json({ ...data, ...renderStoredEmail(data, mailbox) });
    }

    const { data, error } = await supabase.from('emails').update(updates).eq('id', req.params.id).eq('sent_by', req.user.id).select().single();
    if (error) throw error;
    res.json({ ...data, ...renderStoredEmail(data, null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin tool: bulk-delete a manager's PENDING (unsent) emails, filtered by type
// (outreach = initial/null, fu1, fu2) and optionally by a "created before" cutoff.
// Only status='pending' rows are ever touched — sent mail is never affected.
// Pass dry_run:true to preview the count + per-type breakdown before deleting.
const PURGE_TYPES = ['outreach', 'fu1', 'fu2'];
function purgeTypeOf(followupType) {
  if (!followupType || followupType === 'initial') return 'outreach';
  if (followupType === 'fu1') return 'fu1';
  if (followupType === 'fu2') return 'fu2';
  return null; // e.g. 'reminder' — never matched by this tool
}
router.post('/admin/emails/purge-pending', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { manager_id, all_managers, types, before, dry_run } = req.body || {};
    if (!manager_id && !all_managers) return res.status(400).json({ error: 'manager_id or all_managers required' });
    const selected = Array.isArray(types) ? types.filter(t => PURGE_TYPES.includes(t)) : [];
    if (!selected.length) return res.status(400).json({ error: 'Select at least one email type' });
    let beforeTs = null;
    if (before) {
      beforeTs = new Date(before).getTime();
      if (Number.isNaN(beforeTs)) return res.status(400).json({ error: 'Invalid "before" timestamp' });
    }

    // "Every manager" means every manager in THIS organisation. The scoped
    // accessor puts the org condition on the fetch AND on the delete below —
    // without it, one customer's admin emptied every customer's queue
    // (C-0015 #2), unrecoverably. A named manager outside the org is a 404.
    const scoped = db.forRequest(req);
    if (!all_managers && !(await scoped.from('users').byId(manager_id, 'id'))) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch all matching pending rows (paginated past Supabase's 1000-row cap —
    // matters for the all-managers scope, which can be large), ORDERED so the
    // pages neither repeat nor skip rows.
    const data = await allPages(() => {
      let q = scoped.from('emails').select('id, sent_by, followup_type, created_at').eq('status', 'pending');
      if (!all_managers) q = q.eq('sent_by', manager_id);
      return q.order('id', { ascending: true });
    });

    const matches = (data || []).filter(e => {
      const t = purgeTypeOf(e.followup_type);
      if (!t || !selected.includes(t)) return false;
      if (beforeTs != null && new Date(e.created_at).getTime() >= beforeTs) return false;
      return true;
    });

    const by_type = { outreach: 0, fu1: 0, fu2: 0 };
    matches.forEach(e => { by_type[purgeTypeOf(e.followup_type)]++; });

    if (dry_run) return res.json({ count: matches.length, by_type });

    const ids = matches.map(e => e.id);
    // The "Send complete" card is a snapshot of a run whose emails we are about
    // to delete. Leaving it up is how the Email page ends up showing 375 total
    // above a queue of 21 — clear it for everyone whose queue this touched.
    const senders = all_managers
      ? [...new Set(matches.map(e => e.sent_by).filter(Boolean))]
      : [manager_id];

    // Only rows still PENDING are removed: one the send loop claimed since the
    // fetch is on its way out and must keep its record. `deleted` counts what
    // the database actually removed, not what we asked for.
    let deleted = 0;
    for (const batch of chunk(ids, 200)) {
      const { data: gone, error: delErr } = await scoped.from('emails').delete().in('id', batch).eq('status', 'pending').select('id');
      if (delErr) throw delErr;
      deleted += (gone || []).length;
    }
    for (const uid of senders) {
      sendProgressCache.set(uid, null);
      try { await supabase.from('app_settings').delete().eq('key', `send_progress_${uid}`); } catch (_) {}
    }
    res.json({ deleted, by_type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
