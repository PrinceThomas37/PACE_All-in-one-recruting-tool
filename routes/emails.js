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
// ============================================================================
const express = require('express');
const { renderStoredEmail } = require('../email-vars');

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, hasRole, today, logActivity,
    getSendWindowHours, isInLeadSendWindow, getMinutesUntilWindowOpens,
    formatWindowOpensLabel, padHour, sendProgressCache,
  } = ctx;

router.get('/emails', auth, async (req, res) => {
  try {
    const { status } = req.query;
    // Paginate to avoid Supabase 1000-row silent cap
    let allData = [], from = 0;
    while (true) {
      let query = supabase.from('emails').select(`*, contact:contacts(id,first_name,last_name,email,designation), job:jobs(id,position,timezone,company_id,company:companies(name,industry,location),sending_email:user_emails!sending_email_id(id,email_address,display_name)), sender:users!sent_by(id,name,email)`).order('created_at', { ascending: false });
      if (!hasRole(req, 'admin', 'ra_lead')) query = query.eq('sent_by', req.user.id);
      if (status) query = query.eq('status', status);
      query = query.range(from, from + 999);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || !data.length) break;
      allData = allData.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    // A queued email keeps {{sender}} in storage until it is sent, so it is
    // rendered HERE — once, for every screen — from the mailbox that will
    // actually send it. No page should have to know the token exists.
    //
    // Which mailbox, in the same order the send loop picks it: the row's pinned
    // mailbox (a sequence rotating its "from"), else the lead's, else the row's
    // from_email supplies the name.
    const pinnedIds = [...new Set(allData.map(e => e.sending_email_id).filter(Boolean))];
    const pinnedById = {};
    if (pinnedIds.length) {
      const { data: pinned } = await supabase.from('user_emails')
        .select('id,email_address,display_name').in('id', pinnedIds);
      (pinned || []).forEach(m => { pinnedById[m.id] = m; });
    }
    allData = allData.map((e) => {
      const mailbox = (e.sending_email_id && pinnedById[e.sending_email_id]) || e.job?.sending_email || null;
      return { ...e, ...renderStoredEmail(e, mailbox), sending_email: mailbox };
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

router.get('/emails/pending-summary', auth, async (req, res) => {
  try {
    const sendWindow = await getSendWindowHours();
    if (!hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let query = supabase.from('emails').select('id, job:jobs(timezone)').eq('status', 'pending');
    if (hasRole(req, 'admin', 'ra_lead') && req.query.manager_id) {
      query = query.eq('sent_by', req.query.manager_id);
    } else if (!hasRole(req, 'admin', 'ra_lead')) {
      query = query.eq('sent_by', req.user.id);
    }

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
    const { data, error } = await supabase.from('emails').insert({ contact_id: contact_id || null, job_id: job_id || null, to_email, subject, body, platform: platform || 'Gmail', sent_by: req.user.id, status: 'sent', sent_at: today() }).select().single();
    if (error) throw error;
    if (contact_id) await supabase.from('contacts').update({ email_sent_at: today(), email_platform: platform || 'Gmail', updated_at: new Date() }).eq('id', contact_id);
    if (job_id) await logActivity(job_id, contact_id || null, req.user.id, 'email_sent', `Email sent: ${subject || ''}`, null, null);
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/send-progress', auth, async (req, res) => {
  try {
    // Served from the in-memory mirror: this is the most frequently polled
    // endpoint (every 2-10s per BD), so it must not hit the DB on every call.
    // Fall back to the DB only until the mirror is warm after a restart.
    const cached = sendProgressCache.get(req.user.id);
    if (cached !== undefined) return res.json(cached || { active: false });
    const key = `send_progress_${req.user.id}`;
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
    const progress = data ? JSON.parse(data.value) : null;
    sendProgressCache.set(req.user.id, progress);
    res.json(progress || { active: false });
  } catch { sendProgressCache.set(req.user.id, null); res.json({ active: false }); }
});

router.delete('/emails/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('emails').select('id,status,sent_by').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Email not found' });
    if (data.sent_by !== req.user.id && !hasRole(req, 'admin')) return res.status(403).json({ error: 'Forbidden' });
    if (data.status !== 'pending' && data.status !== 'failed') return res.status(400).json({ error: 'Can only delete pending or failed emails' });
    const { error: delErr } = await supabase.from('emails').delete().eq('id', req.params.id);
    if (delErr) throw delErr;
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

    // Fetch all matching pending rows (paginated past Supabase's 1000-row cap —
    // matters for the all-managers scope, which can be large). When all_managers
    // is set we don't constrain by sent_by, so every manager's queue is covered.
    let data = [], pageFrom = 0;
    while (true) {
      let q = supabase.from('emails').select('id, followup_type, created_at').eq('status', 'pending');
      if (!all_managers) q = q.eq('sent_by', manager_id);
      q = q.range(pageFrom, pageFrom + 999);
      const { data: page, error } = await q;
      if (error) throw error;
      if (!page || !page.length) break;
      data = data.concat(page);
      if (page.length < 1000) break;
      pageFrom += 1000;
    }

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
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { error: delErr } = await supabase.from('emails').delete().in('id', batch);
      if (delErr) throw delErr;
      deleted += batch.length;
    }
    res.json({ deleted, by_type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
