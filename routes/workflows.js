// ============================================================================
// BD MANAGER / RECRUITER WORKFLOWS · INSIGHTS · STATS · BULK ACTIONS
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/workflows')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const { releaseToPoolUpdate } = require('../services/outreach-cycle');
const own = require('../services/ownership');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, logActivity, INDUSTRIES, normInd, userOrgId } = ctx;
  // ctx.withOrg already exists on routeCtx, but fall back to a local
  // equivalent so this file degrades safely if ever mounted more narrowly.
  const withOrgLocal = ctx.withOrg || ((q, req) => (req && req.orgId ? q.eq('org_id', req.orgId) : q));
  // `reportingChainIds` also arrives on ctx (gateway added it to routeCtx),
  // but fall back to requiring it directly so this file still works if it's
  // ever mounted with a narrower ctx, the way routes/wf.js is.
  const { reportingChainIds } = ctx.reportingChainIds ? ctx : require('../hierarchy')(supabase);

  // C-0022 #3: only a PURE `ra`/`bd` was ever restricted to themselves — a
  // bd_lead outside a target's team, or an ra_lead outside a target's team,
  // read anyone's counts, from any org (no org filter existed at all).
  // `inCallerScope` is the one check both insights routes use: self, the
  // caller's reporting chain (hierarchy.js — the one chain walk), or admin.
  // A target outside the caller's scope 404s, same shape as a foreign-org id —
  // never 403, which would confirm the id exists.
  async function inCallerScope(req, targetId) {
    if (hasRole(req, 'admin')) return true;
    const chain = await reportingChainIds(req.user.id, req.orgId || null);
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    return own.inScope(targetId, scope);
  }

router.get('/insights/ra/:userId', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (!(await inCallerScope(req, targetId))) return res.status(404).json({ error: 'Not found' });
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);
    let jq = supabase.from('jobs').select('id,stage,freshness,industry,timezone,is_duplicate,created_at,created_date').eq('created_by', targetId).is('deleted_at', null).gte('created_at', monthAgo.toISOString());
    if (req.orgId) jq = jq.eq('org_id', req.orgId);
    const { data: jobs, error } = await jq;
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
    if (!(await inCallerScope(req, targetId))) return res.status(404).json({ error: 'Not found' });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);

    // Jobs assigned to this BD Manager
    let bjq = supabase.from('jobs')
      .select('id,stage,industry,position,assigned_at,company:companies(name,industry)')
      .eq('assigned_to_bd', targetId)
      .is('deleted_at', null);
    if (req.orgId) bjq = bjq.eq('org_id', req.orgId);
    const { data: jobs } = await bjq;

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
    let eq2 = supabase.from('emails')
      .select('id,status,created_at,sent_at')
      .eq('assigned_to', targetId)
      .gte('created_at', monthAgo.toISOString());
    if (req.orgId) eq2 = eq2.eq('org_id', req.orgId);
    const { data: emails } = await eq2;

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
    // C-0017 #6: unscoped even for admin — one customer's volume blended with
    // every other's. Admin is scoped to THEIR org, never the deployment.
    if (req.orgId) query = query.eq('org_id', req.orgId);
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

    // Rampart review (D-0035 #4): a plain BD/BD Lead could stage ANY lead id in
    // the org, not just their own — the org check above stops another COMPANY's
    // leads, not a COLLEAGUE's. admin and ra_lead are the pool roles (they run
    // distribution/recycling org-wide, same as `/distribute/*`) and keep the
    // access they had; bd/bd_lead are narrowed to leads whose `assigned_to_bd`
    // is in their own reporting-chain scope. A lead outside that scope is
    // silently excluded, exactly like a foreign-org id — never a 403 that would
    // confirm which of the pasted ids exist.
    let allowedIds = job_ids;
    if (!hasRole(req, 'admin', 'ra_lead')) {
      const chain = await reportingChainIds(req.user.id, req.orgId || null);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
      let sq = supabase.from('jobs').select('id,assigned_to_bd').in('id', job_ids);
      if (req.orgId) sq = sq.eq('org_id', req.orgId);
      const { data: ownRows } = await sq;
      allowedIds = (ownRows || []).filter(r => own.inScope(r.assigned_to_bd, scope)).map(r => r.id);
    }
    if (!allowedIds.length) return res.json({ success: true, updated: 0, stage });

    // C-0017 #1: `job_ids` is caller-supplied with no ownership or org check
    // at all — any BD in ANY org could rewrite ANY org's leads. The org
    // condition goes ON the update itself (never check-then-mutate, which is
    // a race and twice the code): a foreign id simply matches zero rows.
    let uq = supabase.from('jobs').update(updates).in('id', allowedIds);
    if (req.orgId) uq = uq.eq('org_id', req.orgId);
    const { data: updatedRows, error } = await uq.select('id');
    if (error) throw error;
    const updatedIds = (updatedRows || []).map(r => r.id);

    for (const jid of updatedIds) await logActivity(jid, null, req.user.id, 'stage_changed', `Stage changed to ${stage}`, null, { stage });

    // If resetting to Unassigned, drop the queued outreach and the follow-up
    // schedule with it — both belong to the assignment that just ended.
    // Scoped to the ids that actually moved (and to this org) so a foreign
    // job_id in the same request can't be used to clear another org's queue.
    if (stage === 'Unassigned' && updatedIds.length) {
      let dq = supabase.from('emails').delete().in('job_id', updatedIds).eq('status', 'pending');
      if (req.orgId) dq = dq.eq('org_id', req.orgId);
      await dq;
      let fq = supabase.from('follow_ups').update({ status: 'expired' }).in('job_id', updatedIds).eq('status', 'active');
      if (req.orgId) fq = fq.eq('org_id', req.orgId);
      await fq;
    }

    res.json({ success: true, updated: updatedIds.length, stage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/bulk-assign', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'ra_lead or admin only' });
    const { job_ids, assigned_to_bd } = req.body;
    if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids array required' });
    if (!assigned_to_bd) return res.status(400).json({ error: 'assigned_to_bd required' });
    const { data: bd } = await withOrgLocal(
      supabase.from('users').select('id,name').eq('id', assigned_to_bd).is('deleted_at', null), req
    ).maybeSingle();
    if (!bd) return res.status(400).json({ error: 'BD user not found' });
    // Belt and braces, with the shared helper gateway added for exactly this
    // (index.js `userOrgId`, on routeCtx): this reassigns leads AND their
    // sending mailbox (below) onto `assigned_to_bd`, so a stranger's account
    // in another org must never pass even if the select above somehow did.
    if (userOrgId && req.orgId && (await userOrgId(assigned_to_bd)) !== req.orgId) {
      return res.status(400).json({ error: 'BD user not found' });
    }

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
    // C-0017 #2: same shape as bulk-stage — the org condition goes ON the
    // update, not a separate check, so a foreign job_id in the batch is
    // simply not reassigned rather than being reassigned to another org's BD.
    let uq2 = supabase.from('jobs').update(updatePayload).in('id', job_ids);
    if (req.orgId) uq2 = uq2.eq('org_id', req.orgId);
    const { data: assignedRows, error } = await uq2.select('id');
    if (error) throw error;
    const assignedIds = (assignedRows || []).map(r => r.id);
    for (const jid of assignedIds) await logActivity(jid, null, req.user.id, 'bulk_assigned', `Bulk assigned to BD: ${bd.name}`, null, { assigned_to_bd, bd_name: bd.name });
    res.json({ success: true, assigned: assignedIds.length, bd_name: bd.name, sending_email_id: sendingEmailId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// D-0035 (D5, same answer as lookups.js `/contacts/check-email`): a batch
// duplicate check must say WHOSE lead it is and SINCE WHEN, never the other
// lead's own contact/position/company details, and never another org's. This
// had no org filter at all — a pasted prospect list from ANY org could be
// checked against every other org's contacts, and the response named the
// matched lead's role and client. `email`/`duplicate`/`days_ago`/`added_by`
// is the shape 52-poc-block.js's single-address version already expects.
// R-047 (rampart, do-not-ship blocker): `lead_id` used to ride along on this
// response so the caller could later ask `POST /ownership-requests` to take
// the lead over — but D-0034 hides that same lead from most of these callers,
// and a lead id handed to someone who cannot see the lead is exactly the kind
// of hole this territory keeps closing. Gateway's route resolves the lead
// from the typed email itself (D-0038's `viaDuplicateEmailMatch`), org-scoped,
// server-side — never from an id a browser hands back. `can_request` is
// computed here with the SAME rule the take-over route enforces
// (`canRequestTakeover`, viaDuplicateEmailMatch: true) so an RA, a recruiter
// or an admin never sees a link that then refuses (R-047 F2).
router.post('/jobs/check-duplicates', auth, async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails) || !emails.length) return res.json({ duplicates: [] });
    let q = supabase.from('contacts')
      .select('email,created_at,job:jobs(id,org_id,deleted_at,assigned_to_bd,owner:users!assigned_to_bd(id,name))')
      .in('email', emails.map(e => e.toLowerCase().trim())).not('email', 'is', null);
    if (req.orgId) q = q.eq('org_id', req.orgId);
    const { data, error } = await q;
    if (error) throw error;
    const chain = await reportingChainIds(req.user.id, req.orgId || null);
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    const requester = { id: req.user.id, role: req.user.role, roles: req.user.roles, org_id: req.orgId };
    // Shape per the coordinator/gateway agreement (D5): whose lead it is and
    // since when — never the other lead's company/position/contact, and
    // never the lead's own id.
    const duplicates = (data || []).map(c => {
      const job = c.job || {};
      const canReq = job.id
        ? own.canRequestTakeover({ kind: 'lead', record: job, requester, scope, viaDuplicateEmailMatch: true })
        : { ok: false };
      return {
        email: c.email,
        duplicate: true,
        owner_name: (job.owner && job.owner.name) || null,
        since: c.created_at || null,
        can_request: canReq.ok,
      };
    });
    res.json({ duplicates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
