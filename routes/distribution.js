// ============================================================================
// DISTRIBUTION (reads + per-manager RA mode config).
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/distribution')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
//
// NOTE: the lead-distribution ACTIONS (POST /distribute/generate-ratio and
// POST /distribute/execute) stay inline in index.js — execute assigns leads and
// can trigger auto-send, so it belongs with the send-pipeline work.
// ============================================================================
const express = require('express');
const own = require('../services/ownership');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, normInd, withOrg, orgIdFor } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

router.get('/admin/manager-ra-modes', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const { data } = await supabase.from('app_settings').select('key,value').like('key', 'u_%_ra_mode');
    const modes = {};
    (data || []).forEach(r => {
      const m = /^u_(.+)_ra_mode$/.exec(r.key);
      if (m) modes[m[1]] = r.value === 'manual' ? 'manual' : 'auto';
    });
    res.json({ modes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin/leads set one BD manager to 'auto' or 'manual' RA mode.
router.post('/admin/manager-ra-mode', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const bdId = req.body && req.body.bd_id;
    const mode = req.body && req.body.mode;
    if (!bdId || (mode !== 'auto' && mode !== 'manual')) return res.status(400).json({ error: 'bd_id and mode (auto|manual) required' });
    const { error } = await supabase.from('app_settings').upsert({ key: `u_${bdId}_ra_mode`, value: mode, updated_at: new Date() }, { onConflict: 'key' });
    if (error) throw error;
    console.log(`[RaMode] Manager ${bdId} set to ${mode.toUpperCase()} by user ${req.user.id}`);
    res.json({ success: true, bd_id: bdId, mode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/distribute/pool-stats', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    // Supabase default limit is 1000 — use range to fetch all rows in batches
    let pool = [], from = 0, batchSize = 1000;
    while (true) {
      const { data, error } = await withOrg(supabase.from('jobs')
        .select('id,freshness,industry,timezone,is_duplicate,company:companies(industry),contacts(email)')
        .is('deleted_at', null).eq('stage', 'Unassigned').is('assigned_to_bd', null)
        .range(from, from + batchSize - 1), req);
      if (error) throw error;
      if (!data || !data.length) break;
      pool = pool.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    // by_freshness was missing while `freshness` was being selected — so the
    // preview's Freshness column was structurally always empty, whatever the
    // pool contained and whichever engine produced the split.
    const stats = { total: pool.length, by_freshness: {}, by_industry: {}, by_timezone: {}, duplicates: 0, without_people: 0 };   // without_people: leads nobody can write to (no contact with an email) — Assign skips them
    pool.forEach(j => {
      const rawInd = j.industry || j.company?.industry || '';
      const ind = normInd(rawInd) || 'Unknown';
      const fresh = j.freshness || 'Unknown';
      stats.by_freshness[fresh] = (stats.by_freshness[fresh] || 0) + 1;
      stats.by_industry[ind] = (stats.by_industry[ind] || 0) + 1;
      stats.by_timezone[j.timezone || 'Unknown'] = (stats.by_timezone[j.timezone || 'Unknown'] || 0) + 1;
      if (j.is_duplicate) stats.duplicates++;
      if (!require('../services/lead-distribution').hasWritableContact(j)) stats.without_people++;
    });
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Before assigning (owner, 29 Oct): the manager's email IDs, each with what it can still send today, what is already queued
// on it (first outreach / FU1 / FU2) and the follow-ups that fall due today but are not queued yet — so the assigner can
// send new leads from the email IDs with the least waiting. Counts only. A manager outside the caller's company: 404.
router.get('/distribute/mailboxes', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    const managerId = String(req.query.manager_id || '');
    const { data: who } = await withOrg(supabase.from('users').select('id').eq('id', managerId), req).maybeSingle();
    if (!who) return res.status(404).json({ error: 'Not found' });
    const todayStr = today();
    const { data: boxes } = await withOrg(supabase.from('user_emails')
      .select('id,org_id,email_address,display_name,platform,daily_send_limit,is_active').eq('user_id', managerId).eq('is_active', true), req);
    const ids = (boxes || []).map(b => b.id);
    if (!ids.length) return res.json({ mailboxes: [] });
    const cap = await require('../services/lead-distribution').connectedMailboxesFor({ supabase, withOrg: (q) => withOrg(q, req), userId: managerId, todayStr, ignoreRoom: true });
    const connected = new Set(((cap && cap.accounts) || []).map(a => a.id));
    const dailyDefault = (cap && cap.dailyDefault) || 0;
    const { data: logs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', todayStr).in('user_email_id', ids);
    const sentToday = {}; (logs || []).forEach(l => { sentToday[l.user_email_id] = l.emails_sent || 0; });
    // Queued: the email's own mailbox, else its lead's (services/pending-by-mailbox.js) — this manager's queue only.
    let rows = [], from = 0;
    for (;;) {
      const { data } = await withOrg(supabase.from('emails').select('id,followup_type,sending_email_id,job:jobs(sending_email_id)')
        .eq('sent_by', managerId).eq('status', 'pending').order('id', { ascending: true }).range(from, from + 999), req);
      if (!data || !data.length) break;
      rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
    }
    const queued = {}; require('../services/pending-by-mailbox').byMailbox(rows).forEach(r => { if (r.id) queued[r.id] = r; });
    // Follow-ups that fall due today and have not been queued yet (the follow-up engine queues them at its daily time).
    const steps = require('../services/followup-steps');
    const dueToday = {};
    const { data: fus } = await withOrg(supabase.from('follow_ups').select('*').eq('status', 'active').in('user_email_id', ids), req);
    (fus || []).forEach(f => { const n = steps.nextDue(f, todayStr); if (n) { const k = f.user_email_id; dueToday[k] = dueToday[k] || { fu1: 0, fu2: 0, later: 0 }; dueToday[k][n === 1 ? 'fu1' : n === 2 ? 'fu2' : 'later']++; } });
    const dl = require('../services/daily-limit');
    const mailboxes = (boxes || []).map(b => {
      const limit = dl.limitOf(b, dailyDefault);
      const q = queued[b.id] || { pending: 0, initial: 0, fu1: 0, fu2: 0, later: 0 };
      const d = dueToday[b.id] || { fu1: 0, fu2: 0, later: 0 };
      const sent = sentToday[b.id] || 0;
      return { id: b.id, email: b.email_address, name: b.display_name || null, platform: b.platform || null, connected: connected.has(b.id),
        limit, sent_today: sent, room_today: Math.max(0, limit - sent), queued: q, due_today_not_queued: d,
        free_today: Math.max(0, limit - sent - q.pending - d.fu1 - d.fu2 - d.later) };
    }).sort((a, b) => b.free_today - a.free_today);
    res.json({ mailboxes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/distribute/today-summary', auth, async (req, res) => {
  try {
    const targetId = req.query.manager_id || req.user.id;
    // C-0021 #10: anyone could read any BD's daily assignment counts by
    // passing their id. Allowed for yourself, anyone in your reporting chain
    // (a manager reviewing), admin, or a role that distributes the pool
    // (own.POOL_ROLES — they already see every account's numbers to run
    // distribution). These are counts, not records — low severity — but the
    // gate costs nothing.
    if (targetId !== req.user.id && !hasRole(req, 'admin')) {
      const chain = await reportingChainIds(req.user.id, orgIdFor(req));
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
      if (!own.inScope(targetId, scope) && !scope.seesPool) return res.status(403).json({ error: 'Forbidden' });
    }
    const { data: jobs } = await withOrg(supabase.from('jobs').select('id,industry,timezone,assigned_at,company:companies(industry)').eq('assigned_to_bd', targetId).gte('assigned_at', today() + 'T00:00:00Z'), req);
    const summary = { total: jobs?.length || 0, by_industry: {}, by_timezone: {} };
    (jobs || []).forEach(j => {
      const rawInd = j.industry || j.company?.industry || '';
      const ind = normInd(rawInd) || 'Unknown';
      summary.by_industry[ind] = (summary.by_industry[ind] || 0) + 1;
      summary.by_timezone[j.timezone || 'Unknown'] = (summary.by_timezone[j.timezone || 'Unknown'] || 0) + 1;
    });
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
