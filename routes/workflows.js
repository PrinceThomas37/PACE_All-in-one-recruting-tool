// ============================================================================
// BD MANAGER / RECRUITER WORKFLOWS · INSIGHTS · STATS · BULK ACTIONS
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/workflows')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const { releaseToPoolUpdate } = require('../services/outreach-cycle');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, logActivity, INDUSTRIES, normInd } = ctx;

router.get('/insights/ra/:userId', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (hasRole(req, 'ra') && !hasRole(req, 'admin', 'ra_lead') && req.user.id !== targetId) return res.status(403).json({ error: 'Forbidden' });
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);
    const { data: jobs, error } = await supabase.from('jobs').select('id,stage,freshness,industry,timezone,is_duplicate,created_at,created_date').eq('created_by', targetId).is('deleted_at', null).gte('created_at', monthAgo.toISOString());
    if (error) throw error;
    const all = jobs || [];
    const todayJobs = all.filter(j => j.created_date === todayStr);
    const weekJobs = all.filter(j => new Date(j.created_at) >= weekAgo);
    const last7 = {};
    for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const key = d.toISOString().split('T')[0]; last7[key] = all.filter(j => j.created_date === key).length; }
    // INDUSTRIES + normInd come from ctx (shared single source of truth).
    function breakdown(arr, field) { const map = {}; arr.forEach(j => { const raw = j[field] || ''; const v = field === 'industry' ? normInd(raw) : (raw || 'Unknown'); map[v] = (map[v] || 0) + 1; }); return map; }
    res.json({ total_month: all.length, total_week: weekJobs.length, total_today: todayJobs.length, duplicates: all.filter(j => j.is_duplicate).length, last_7_days: last7, by_industry: breakdown(all,'industry'), by_timezone: breakdown(all,'timezone'), by_freshness: breakdown(all,'freshness'), by_stage: breakdown(all,'stage') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/insights/bd/:userId', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    // BD can only see their own; BD Lead and admin can see any
    if (hasRole(req, 'bd') && !hasRole(req, 'admin', 'bd_lead') && req.user.id !== targetId) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);

    // Jobs assigned to this BD Manager
    const { data: jobs } = await supabase.from('jobs')
      .select('id,stage,industry,position,assigned_at,company:companies(name,industry)')
      .eq('assigned_to_bd', targetId)
      .is('deleted_at', null);

    const allJobs = jobs || [];
    function jAt(j) { return j.assigned_at ? j.assigned_at.slice(0, 10) : ''; }

    const todayJobs  = allJobs.filter(j => jAt(j) === todayStr);
    const weekJobs   = allJobs.filter(j => jAt(j) >= weekAgo.toISOString().split('T')[0]);
    const monthJobs  = allJobs.filter(j => jAt(j) >= monthAgo.toISOString().split('T')[0]);

    // Funnel stages
    const convStages    = ['Connected', 'In Discussion'];
    const positiveStage = ['Positive'];
    const negStages     = ['Negative', 'No Response'];
    const oooStage      = ['Out of Office'];
    const converted  = allJobs.filter(j => convStages.includes(j.stage));
    const positive   = allJobs.filter(j => positiveStage.includes(j.stage));
    const negative   = allJobs.filter(j => negStages.includes(j.stage));
    const ooo        = allJobs.filter(j => oooStage.includes(j.stage));
    const future     = allJobs.filter(j => j.stage === 'Future');
    const assigned   = allJobs.filter(j => j.stage === 'Assigned');

    // Emails
    const { data: emails } = await supabase.from('emails')
      .select('id,status,created_at,sent_at')
      .eq('assigned_to', targetId)
      .gte('created_at', monthAgo.toISOString());

    const allEmails   = emails || [];
    const sentEmails  = allEmails.filter(e => e.status === 'sent');
    const pendEmails  = allEmails.filter(e => e.status === 'pending');
    const failEmails  = allEmails.filter(e => e.status === 'failed');

    // Last 7 days — emails sent per day
    const last7emails = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      last7emails[key] = sentEmails.filter(e => (e.sent_at || e.created_at || '').slice(0, 10) === key).length;
    }

    // Last 7 days — leads assigned per day
    const last7leads = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      last7leads[key] = allJobs.filter(j => jAt(j) === key).length;
    }

    // Stage breakdown
    const stageBreakdown = {};
    allJobs.forEach(j => { stageBreakdown[j.stage || 'Unknown'] = (stageBreakdown[j.stage || 'Unknown'] || 0) + 1; });

    // Industry breakdown from company data
    const industryBreakdown = {};
    allJobs.forEach(j => {
      const ind = (j.company && j.company.industry) || j.industry || 'Unknown';
      industryBreakdown[ind] = (industryBreakdown[ind] || 0) + 1;
    });

    const convRate     = allJobs.length ? Math.round(converted.length / allJobs.length * 100) : 0;
    const responseRate = allJobs.length ? Math.round((converted.length + positive.length) / allJobs.length * 100) : 0;

    res.json({
      // Volume
      total_all: allJobs.length,
      total_today: todayJobs.length,
      total_week: weekJobs.length,
      total_month: monthJobs.length,
      // Funnel
      assigned: assigned.length,
      positive: positive.length,
      converted: converted.length,
      negative: negative.length,
      ooo: ooo.length,
      future: future.length,
      conv_rate: convRate,
      response_rate: responseRate,
      // Emails
      emails_sent: sentEmails.length,
      emails_sent_today: sentEmails.filter(e => (e.sent_at || e.created_at || '').slice(0, 10) === todayStr).length,
      emails_pending: pendEmails.length,
      emails_failed: failEmails.length,
      // Charts
      last_7_emails: last7emails,
      last_7_leads: last7leads,
      // Breakdowns
      by_stage: stageBreakdown,
      by_industry: industryBreakdown,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', auth, async (req, res) => {
  try {
    const { period } = req.query;
    const now = new Date();
    let dateFrom;
    if (period === 'daily') dateFrom = today();
    else if (period === 'weekly') { const w = new Date(now); w.setDate(w.getDate()-7); dateFrom = w.toISOString().split('T')[0]; }
    else if (period === 'quarterly') { const q = new Date(now); q.setMonth(q.getMonth()-3); dateFrom = q.toISOString().split('T')[0]; }
    else { const m = new Date(now.getFullYear(), now.getMonth(), 1); dateFrom = m.toISOString().split('T')[0]; }
    let query = supabase.from('jobs').select('id,stage,created_by,assigned_to,contacts(id,email_sent_at)').is('deleted_at', null).gte('created_at', dateFrom + 'T00:00:00Z');
    if (!hasRole(req, 'admin')) query = query.or(`created_by.eq.${req.user.id},assigned_to.eq.${req.user.id}`);
    const { data, error } = await query;
    if (error) throw error;
    const total = data.length;
    const emailed = data.filter(j => (j.contacts || []).some(c => c.email_sent_at)).length;
    const byStage = {};
    data.forEach(j => { byStage[j.stage] = (byStage[j.stage] || 0) + 1; });
    res.json({ total, emailed, responseRate: total ? Math.round(emailed/total*100) : 0, byStage, period: period || 'monthly', dateFrom });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/bulk-stage', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Not allowed' });
    const { job_ids, stage } = req.body;
    if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids required' });
    const validStages = ['Unassigned', 'Assigned', 'Connected', 'Rejected', 'Future', 'In Discussion'];
    if (!validStages.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
    // BD users can only move leads to post-assignment stages — not back to Unassigned or Assigned
    const bdOnlyStages = ['Connected', 'Rejected', 'Future', 'In Discussion'];
    if (hasRole(req, 'bd', 'bd_lead') && !hasRole(req, 'admin', 'ra_lead') && !bdOnlyStages.includes(stage)) {
      return res.status(403).json({ error: 'BD users cannot set stage to ' + stage });
    }

    let updates = { stage, updated_at: new Date() };
    // If resetting to Unassigned, clear assignment fields so it re-enters the
    // pool — via the shared helper, which also stamps `last_recycled_at`. That
    // stamp is what makes the lead EMAILABLE again: without it the duplicate-
    // cold-email guard still sees the previous cycle's sent outreach and
    // generation silently produces nothing for a freshly re-assigned lead.
    if (stage === 'Unassigned') updates = releaseToPoolUpdate(new Date());

    const { error } = await supabase.from('jobs').update(updates).in('id', job_ids);
    if (error) throw error;

    for (const jid of job_ids) await logActivity(jid, null, req.user.id, 'stage_changed', `Stage changed to ${stage}`, null, { stage });

    // If resetting to Unassigned, drop the queued outreach and the follow-up
    // schedule with it — both belong to the assignment that just ended.
    if (stage === 'Unassigned') {
      await supabase.from('emails').delete().in('job_id', job_ids).eq('status', 'pending');
      await supabase.from('follow_ups').update({ status: 'expired' }).in('job_id', job_ids).eq('status', 'active');
    }

    res.json({ success: true, updated: job_ids.length, stage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/bulk-assign', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'ra_lead or admin only' });
    const { job_ids, assigned_to_bd } = req.body;
    if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids array required' });
    if (!assigned_to_bd) return res.status(400).json({ error: 'assigned_to_bd required' });
    const { data: bd } = await supabase.from('users').select('id,name').eq('id', assigned_to_bd).single();
    if (!bd) return res.status(400).json({ error: 'BD user not found' });

    // Get BD's primary active email ID for sending
    const { data: bdEmails } = await supabase.from('user_emails')
      .select('id,email_address,is_primary')
      .eq('user_id', assigned_to_bd)
      .eq('is_active', true)
      .order('is_primary', { ascending: false });
    const sendingEmailId = (bdEmails && bdEmails.length) ? bdEmails[0].id : null;

    const now = new Date();
    const updatePayload = { assigned_to_bd, assigned_at: now, stage: 'Assigned', updated_at: now };
    if (sendingEmailId) updatePayload.sending_email_id = sendingEmailId;
    const { error } = await supabase.from('jobs').update(updatePayload).in('id', job_ids);
    if (error) throw error;
    for (const jid of job_ids) await logActivity(jid, null, req.user.id, 'bulk_assigned', `Bulk assigned to BD: ${bd.name}`, null, { assigned_to_bd, bd_name: bd.name });
    res.json({ success: true, assigned: job_ids.length, bd_name: bd.name, sending_email_id: sendingEmailId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/check-duplicates', auth, async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails) || !emails.length) return res.json({ duplicates: [] });
    const { data, error } = await supabase.from('contacts').select('email, job_id, job:jobs(id,position,company_id,company:companies(name))').in('email', emails.map(e => e.toLowerCase().trim())).not('email', 'is', null);
    if (error) throw error;
    res.json({ duplicates: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
