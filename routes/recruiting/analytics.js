// ============================================================================
// RECRUITING DASHBOARD + REPORTS.
// Split out of bd_recruiter_routes.js. The legacy /bd-analytics/* endpoints
// that used to live here were retired in Session 32 (R-005) — see below.
// ============================================================================


const subStages = require('../../services/submission-stages');
const viewerTime = require('../../services/viewer-time');
const bdInsights = require('../../services/bd-insights');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;

  // Every recorded stage change for these submissions, grouped per submission
  // (R-001, R-002). One query per 200 ids, org-scoped. A failure returns an
  // empty history, which degrades to the old "current stage" count — never an
  // error on a dashboard.
  async function stageHistoryFor(req, ids) {
    const out = {};
    const list = [...new Set((ids || []).filter(Boolean))];
    try {
      for (let i = 0; i < list.length; i += 200) {
        const { data } = await withOrg(supabase.from('submission_activity')
          .select('submission_id,old_stage,new_stage,created_at')
          .in('submission_id', list.slice(i, i + 200)), req);
        (data || []).forEach(a => { (out[a.submission_id] = out[a.submission_id] || []).push(a); });
      }
    } catch (_) { /* history is an improvement, never a requirement */ }
    return out;
  }
  // How far a submission GOT: its current stage and every stage it was ever
  // moved into or out of, normalised to today's vocabulary.
  const reachedOf = (s, hist) => subStages.furthestReached(
    [normalizeStage(s.stage)].concat((hist[s.id] || []).flatMap(a => [a.old_stage, a.new_stage]).filter(Boolean).map(normalizeStage)));

  // ==========================================================================
  // ROLE-AWARE RECRUITING DASHBOARD
  // ==========================================================================

  // One payload, scoped by hierarchy: a recruiter sees THEIR jobs/submissions;
  // a non-admin manager (BD/BD Lead/AD/Director) sees themselves plus everyone
  // under them on the reporting chain (users.manager_id); admin sees the whole
  // desk. Mirrors /reports/recruiting so the dashboard cards and the Reports
  // page agree. Job orders stay org-wide (shared desk inventory, not "owned"
  // by one manager) — only submissions are chain-scoped, same as the report.
  app.get('/recruiting-dashboard', auth, async (req, res) => {
    try {
      const recruiterView = isRecruiter(req) && !isBDM(req);
      const isAdmin = hasRole(req, 'admin');
      const managerScoped = isBDM(req) && !isAdmin;
      const uid = req.user.id;
      // C-0022 #1: `ra`/`ra_lead` are neither isBDM nor isRecruiter, so this
      // used to fall through both branches with `chain` null and the
      // submissions query wide open — the whole org's submissions and
      // upcoming interviews (candidate names) to a role that has no chain of
      // its own defined here. Every non-admin, non-recruiter role is now
      // chain-scoped, not just a BD manager.
      const chain = (!isAdmin && !recruiterView) ? await reportingChainIds(uid, orgIdFor(req)) : null;

      let jobIds = null;
      let assignedAtByJob = {};
      if (recruiterView) {
        const { data: asg } = await supabase.from('recruiter_assignments')
          .select('job_order_id, assigned_at').eq('recruiter_id', uid);
        (asg || []).forEach(a => {
          const prev = assignedAtByJob[a.job_order_id];
          if (!prev || (a.assigned_at && a.assigned_at > prev)) assignedAtByJob[a.job_order_id] = a.assigned_at;
        });
        jobIds = Object.keys(assignedAtByJob);
        if (!jobIds.length) return res.json({ role: 'recruiter', scope: 'own', team_size: null, jobs: { total: 0, active: 0 }, jobs_assigned: { week: 0, month: 0, quarter: 0, total: 0 }, top_jobs: [], by_stage: {}, submissions_week: 0, submissions_month: 0, upcoming_interviews: [], awaiting_approval: 0 });
      }

      let jq = withOrg(supabase.from('job_orders')
        .select('id,job_code,job_title,client,city,state,status,priority,created_at')
        .is('deleted_at', null), req);
      if (recruiterView) jq = jq.in('id', jobIds);
      const { data: jobs } = await jq;

      let sq = withOrg(supabase.from('submissions')
        .select('id,stage,sub_stage,created_at,submitted_at,stage_updated_at,rejection_reason,interview_at,interview_location,job_order_id,recruiter_id,candidate:candidates(id,full_name)')
        .is('deleted_at', null), req);
      if (recruiterView) sq = sq.eq('recruiter_id', uid);
      else if (chain) sq = sq.in('recruiter_id', chain);
      const { data: subs } = await sq;
      const hist = await stageHistoryFor(req, (subs || []).map(s => s.id));

      const now = new Date();
      // The viewer's own days (R-105, D-0065; `?tz=`): the week is seven calendar days including
      // today, the month is the calendar month so far — both cut at THEIR midnight, not the server's.
      const vt = viewerTime.windowsFor(now, req.query && req.query.tz);
      const dayV = (v) => bdInsights.dayOf(v, vt.tz);
      const byStage = {};
      STAGES.forEach(s => { byStage[s] = 0; });
      let week = 0, month = 0, weekClient = 0, monthClient = 0;
      const upcoming = [];
      (subs || []).forEach(s => {
        const ns = normalizeStage(s.stage);
        if (byStage[ns] !== undefined) byStage[ns]++;
        // ADDING A CANDIDATE TO A JOB IS NOT A SUBMISSION (D-0029).
        // This counted EVERY row whatever its stage, so sourcing ten people on
        // Monday reported ten submissions — the metric a buyer asks about
        // first, inflated by doing the work rather than finishing it. Two
        // numbers now, per the owner's call: handed to BD, and sent to client.
        const t = dayV(s.submitted_at || s.created_at);
        // Counted from how far they GOT, not where they are now (R-002): a
        // client submission later marked Not Accepted still went to the client.
        const reached = reachedOf(s, hist);
        const toBdm = subStages.isSentToBdm(reached);
        const toClient = subStages.isSentToClient(reached);
        if (t >= vt.weekFrom) { if (toBdm) week++; if (toClient) weekClient++; }
        if (t >= vt.monthStart) { if (toBdm) month++; if (toClient) monthClient++; }
        if (s.interview_at && new Date(s.interview_at) >= now) {
          upcoming.push({ submission_id: s.id, candidate: (s.candidate && s.candidate.full_name) || '', job_order_id: s.job_order_id, interview_at: s.interview_at, interview_location: s.interview_location || null });
        }
      });
      upcoming.sort((a, b) => new Date(a.interview_at) - new Date(b.interview_at));

      // rejection context: not a judgement metric — shown next to the counts so
      // the recruiter knows WHY (BD records the reason on every rejection)
      const recentRejections = (subs || [])
        .filter(s => normalizeStage(s.stage) === 'Not Accepted')
        .sort((a, b) => new Date(b.stage_updated_at || b.created_at) - new Date(a.stage_updated_at || a.created_at))
        .slice(0, 5)
        .map(s => ({
          submission_id: s.id,
          candidate: (s.candidate && s.candidate.full_name) || '',
          reason: s.rejection_reason || null,
          sub_stage: s.sub_stage || null,
          at: s.stage_updated_at || s.created_at
        }));

      // recruiter extras: when was each job assigned to me, and which of my
      // jobs the whole team is actively working (so the recruiter's dashboard
      // can surface the desk's hottest jobs first)
      let jobsAssigned, topJobs;
      if (recruiterView) {
        jobsAssigned = { week: 0, month: 0, quarter: 0, total: jobIds.length };
        (jobs || []).forEach(j => {
          const t = dayV(assignedAtByJob[j.id] || j.created_at);
          if (t >= vt.weekFrom) jobsAssigned.week++;
          if (t >= vt.monthStart) jobsAssigned.month++;
          if (t >= vt.quarterFrom) jobsAssigned.quarter++;
        });

        // team-wide submissions on my jobs (not just mine) → activity ranking
        const { data: teamSubs } = await supabase.from('submissions')
          .select('job_order_id,recruiter_id,created_at,submitted_at')
          .in('job_order_id', jobIds).is('deleted_at', null);
        const fortnightAgo = new Date(now.getTime() - 14 * 86400000);
        const act = {};
        (teamSubs || []).forEach(s => {
          const a = act[s.job_order_id] = act[s.job_order_id] || { team: 0, recent: 0, mine: 0 };
          a.team++;
          if (s.recruiter_id === uid) a.mine++;
          if (new Date(s.submitted_at || s.created_at) >= fortnightAgo) a.recent++;
        });
        topJobs = (jobs || [])
          .map(j => {
            const a = act[j.id] || { team: 0, recent: 0, mine: 0 };
            return {
              id: j.id, job_code: j.job_code, job_title: j.job_title, client: j.client,
              city: j.city, state: j.state, status: j.status, priority: j.priority,
              created_at: j.created_at, assigned_at: assignedAtByJob[j.id] || null,
              team_subs: a.team, team_subs_14d: a.recent, my_subs: a.mine
            };
          })
          .sort((a, b) => (b.team_subs_14d - a.team_subs_14d) || (b.team_subs - a.team_subs) || (new Date(b.created_at) - new Date(a.created_at)))
          .slice(0, 5);
      }

      res.json({
        role: recruiterView ? 'recruiter' : 'manager',
        // scope tells the UI how the submission numbers below are bounded:
        // 'own' = just this recruiter's, 'team' = the caller's reporting
        // chain (BD manager OR ra/ra_lead — chain is non-null for both since
        // the C-0022 fix above), 'org' = the whole desk (admin).
        scope: recruiterView ? 'own' : (isAdmin ? 'org' : (chain && chain.length > 1 ? 'team' : 'own')),
        team_size: chain ? chain.length : null,
        jobs: {
          total: (jobs || []).length,
          active: (jobs || []).filter(j => j.status === 'Active').length
        },
        ...(recruiterView ? { jobs_assigned: jobsAssigned, top_jobs: topJobs, recent_rejections: recentRejections } : {}),
        by_stage: byStage,
        submissions_week: week,
        submissions_month: month,
        client_submissions_week: weekClient,
        client_submissions_month: monthClient,
        upcoming_interviews: upcoming.slice(0, 8),
        awaiting_approval: byStage['Submitted to BDM'] || 0
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // BD MANAGER ANALYTICS
  // ==========================================================================

  // per-recruiter performance
  // Consolidated recruiting report — funnel, per-recruiter productivity, an
  // 8-week submission trend, time-to-fill, top clients and headline totals.
  // Org-scoped and hierarchy-scoped: everyone sees their own numbers plus
  // everyone under them on the reporting chain (users.manager_id) — a BD
  // sees just their own, a BD Lead sees their whole team's, and so on up to
  // Director. Admin always sees the whole desk regardless of the hierarchy.
  app.get('/reports/recruiting', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const admin = hasRole(req, 'admin');
      const scoped = !admin;
      const org = orgIdFor(req);
      const chain = scoped ? await reportingChainIds(req.user.id, org) : null;

      // ── optional filters (no param ⇒ same response as before) ──────────────
      const q = req.query || {};
      // "1–7 Oct" means the viewer's 1 Oct 00:00 to 7 Oct 23:59:59 in THEIR zone (`?tz=`), not the server's (R-105).
      const fromT = q.from ? viewerTime.dayStartMs(q.from, q.tz) : null;
      const toT = q.to ? viewerTime.dayEndMs(q.to, q.tz) : null;
      const roleFilter = (q.role === 'bd' || q.role === 'recruiter') ? q.role : null;
      let userIds = null;
      if (q.user_ids) {
        userIds = String(q.user_ids).split(',').map(s => s.trim()).filter(Boolean);
        if (scoped) { const cs = new Set(chain); if (!userIds.every(id => cs.has(id))) return res.status(403).json({ error: 'Some users are outside your team.' }); }
        if (!userIds.length) userIds = null;
      }
      // Effective recruiter scope for the submissions query.
      let recScope = null;
      if (scoped) recScope = userIds ? chain.filter(id => userIds.includes(id)) : chain;
      else if (userIds) recScope = userIds;

      let sq = withOrg(supabase.from('submissions')
        .select('id,stage,created_at,submitted_at,stage_updated_at,job_order_id,recruiter_id,recruiter:users!recruiter_id(id,name)')
        .is('deleted_at', null), req);
      if (recScope) sq = sq.in('recruiter_id', recScope);
      let jq = withOrg(supabase.from('job_orders').select('id,client,status,created_at,placement_fee,job_title,job_code').is('deleted_at', null), req);
      let pq = withOrg(supabase.from('candidate_pipeline').select('id,tagged_by,tagged_at').is('deleted_at', null), req);
      if (recScope) pq = pq.in('tagged_by', recScope);

      // Roles for the BD-vs-recruiter split (and the by_user rows).
      const idsForRoles = recScope || null;
      let ru = supabase.from('users').select('id,name,role,roles,employee_id').is('deleted_at', null);
      if (org) ru = ru.eq('org_id', org);
      if (idsForRoles) ru = ru.in('id', idsForRoles);

      const [{ data: subs }, { data: jobs }, { data: pipe }, { data: usersData }] = await Promise.all([sq, jq, pq, ru]);
      const J = jobs || [], jobById = {}; J.forEach(j => { jobById[j.id] = j; });
      const roleOf = {}, nameOf = {}, empOf = {};
      (usersData || []).forEach(u => { roleOf[u.id] = u.roles || (u.role ? [u.role] : []); nameOf[u.id] = u.name; empOf[u.id] = u.employee_id; });
      const isBDRole = id => (roleOf[id] || []).some(r => ['bd', 'bd_lead', 'associate_director', 'director'].includes(r));

      const inWindow = t => { const ms = new Date(t).getTime(); if (fromT != null && ms < fromT) return false; if (toT != null && ms > toT) return false; return true; };
      let S = (subs || []).filter(s => inWindow(s.submitted_at || s.created_at));
      if (roleFilter) S = S.filter(s => roleFilter === 'bd' ? isBDRole(s.recruiter_id) : !isBDRole(s.recruiter_id));
      let P = (pipe || []).filter(p => inWindow(p.tagged_at));
      if (roleFilter) P = P.filter(p => roleFilter === 'bd' ? isBDRole(p.tagged_by) : !isBDRole(p.tagged_by));

      const hist = await stageHistoryFor(req, S.map(s => s.id));

      const funnel = {}; STAGES.forEach(s => { funnel[s] = 0; });
      S.forEach(s => { const st = normalizeStage(s.stage); if (funnel[st] !== undefined) funnel[st]++; });

      const SUBMITTED = ['Submitted to BDM', 'Submitted to Client', 'Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement'];
      const INTERVIEWED = ['Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement'];
      const feeByJob = {}; J.forEach(j => { const n = parseFloat(String(j.placement_fee || '').replace(/[^0-9.]/g, '')); feeByJob[j.id] = isNaN(n) ? 0 : n; });

      // Per-user productivity + per-user funnels (keyed by user id, with role).
      const byUser = {}, per_user_funnels = {};
      S.forEach(s => {
        const id = s.recruiter_id || 'none';
        const st = normalizeStage(s.stage);
        const u = byUser[id] || (byUser[id] = {
          user_id: id, recruiter: nameOf[id] || (s.recruiter && s.recruiter.name) || 'Unassigned',
          employee_id: empOf[id] || null, role_label: isBDRole(id) ? 'BD' : 'Recruiter',
          total: 0, submitted: 0, interviews: 0, placements: 0, revenue: 0
        });
        u.total++;
        if (SUBMITTED.includes(st)) u.submitted++;
        if (INTERVIEWED.includes(st)) u.interviews++;
        if (st === 'Placement') { u.placements++; u.revenue += feeByJob[s.job_order_id] || 0; }
        const f = per_user_funnels[id] || (per_user_funnels[id] = {}); f[st] = (f[st] || 0) + 1;
      });
      const by_user = Object.values(byUser).map(u => Object.assign({}, u, { fill_rate: u.total ? Math.round((u.placements / u.total) * 100) : 0 }))
        .sort((a, b) => b.placements - a.placements || b.total - a.total);
      // Back-compat: the old by_recruiter shape (name-keyed, no user_id/role).
      const by_recruiter = by_user.map(u => ({ recruiter: u.recruiter, total: u.total, submitted: u.submitted, interviews: u.interviews, placements: u.placements, revenue: u.revenue, fill_rate: u.fill_rate }));

      // Hot jobs — active reqs ranked by (submissions + interviews) in the window.
      const closedish = st => { st = String(st || '').toLowerCase(); return st === 'closed' || st === 'filled' || st === 'cancelled'; };
      const jobAgg = {};
      // Same correction: a job is "hot" because candidates have been SENT, not
      // because somebody sourced into it. `pipeline` keeps the fuller count so
      // the screen can say both without conflating them.
      S.forEach(s => { const jid = s.job_order_id; if (!jid) return; const a = jobAgg[jid] || (jobAgg[jid] = { submissions: 0, client_submissions: 0, pipeline: 0, interviews: 0 });
        const ns2 = normalizeStage(s.stage);
        const reached2 = reachedOf(s, hist);
        a.pipeline++;
        if (subStages.isSentToBdm(reached2)) a.submissions++;
        if (subStages.isSentToClient(reached2)) a.client_submissions++;
        if (INTERVIEWED.includes(ns2)) a.interviews++; });
      // From history (R-002) — the same rule the dashboard tiles use above.
      const subCounts = subStages.countSubmissionsEver(S.map(x => ({
        stage: normalizeStage(x.stage),
        history: (hist[x.id] || []).flatMap(a => [a.old_stage, a.new_stage]).filter(Boolean).map(normalizeStage),
      })));
      // Time in stage across the desk (R-001): which stages go stale.
      const stage_time = subStages.timeInStage(S.map(x => ({
        id: x.id, stage: x.stage, stage_updated_at: x.stage_updated_at, created_at: x.created_at,
        events: hist[x.id] || [],
      })), { normalize: normalizeStage });
      const hot_jobs = J.filter(j => !closedish(j.status)).map(j => { const a = jobAgg[j.id] || { submissions: 0, client_submissions: 0, pipeline: 0, interviews: 0 }; return { job_order_id: j.id, job_code: j.job_code, job_title: j.job_title, client: j.client, status: j.status, submissions: a.submissions, client_submissions: a.client_submissions, pipeline: a.pipeline, interviews: a.interviews, score: a.submissions + a.interviews }; })
        .filter(j => j.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);

      const now = Date.now();
      const trend = [];
      for (let i = 7; i >= 0; i--) trend.push({ week: i === 0 ? 'This wk' : (i + 'w ago'), count: 0 });
      S.forEach(s => {
        const t = new Date(s.submitted_at || s.created_at).getTime();
        const wa = Math.floor((now - t) / (7 * 86400000));
        if (wa >= 0 && wa < 8) trend[7 - wa].count++;
      });

      const ttf = [];
      S.forEach(s => {
        if (s.stage === 'Placement') {
          const d = (new Date(s.stage_updated_at || s.created_at) - new Date(s.created_at)) / 86400000;
          if (d >= 0) ttf.push(d);
        }
      });
      const avg_time_to_fill = ttf.length ? Math.round(ttf.reduce((a, b) => a + b, 0) / ttf.length) : null;

      const byClient = {};
      S.forEach(s => { const c = (jobById[s.job_order_id] && jobById[s.job_order_id].client) || '—'; byClient[c] = (byClient[c] || 0) + 1; });
      const top_clients = Object.keys(byClient).map(c => ({ client: c, count: byClient[c] })).sort((a, b) => b.count - a.count).slice(0, 6);

      const totals = {
        candidates_added: P.length,
        // ONE DEFINITION, SHARED (D-0029) — this used a local SUBMITTED list
        // while two other counts in the same file used none at all.
        submissions: subCounts.toBdm,
        client_submissions: subCounts.toClient,
        stalled_at_bdm: subCounts.stalled,
        // Submissions the old "current stage" count would have dropped (R-002).
        submissions_recovered: subCounts.recovered,
        interviews: funnel['Interview Scheduled'] + funnel['Interview Completed'],
        placements: funnel['Placement'],
        open_jobs: J.filter(j => !closedish(j.status)).length,
        total_jobs: J.length,
        revenue: by_user.reduce((a, r) => a + r.revenue, 0)
      };

      const scope = !scoped ? 'org' : (chain.length > 1 ? 'team' : 'own');
      res.json({
        role: scoped ? 'recruiter' : 'manager', scope, team_size: scoped ? chain.length : null,
        funnel, stages: STAGES, by_recruiter, by_user, per_user_funnels, hot_jobs, trend, avg_time_to_fill, top_clients, totals,
        stage_time, stuck_days: subStages.STUCK_DAYS,
        filters: { from: q.from || null, to: q.to || null, role: roleFilter, user_ids: userIds }
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Per-member activity feed (My Team → member drill-in) ───────────────────
  // Merges submission_activity (recruiting stage moves, by recruiter_id) and the
  // lead-engine activity_log (by user_id) for one team member into a single
  // dated stream. Caller must be admin, the member themself, or the member must
  // be somewhere on the caller's reporting chain.
  app.get('/team/activity', auth, async (req, res) => {
    try {
      const targetId = req.query.user_id || req.user.id;
      const admin = hasRole(req, 'admin');
      if (!admin && targetId !== req.user.id) {
        const chain = await reportingChainIds(req.user.id, orgIdFor(req));
        if (!chain.includes(targetId)) return res.status(403).json({ error: 'Not on your team.' });
      }
      const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
      const fromMs = req.query.from ? viewerTime.dayStartMs(req.query.from, req.query.tz) : null;
      const toMs = req.query.to ? viewerTime.dayEndMs(req.query.to, req.query.tz) : null;
      const fromT = fromMs != null ? new Date(fromMs).toISOString() : null;
      const toT = toMs != null ? new Date(toMs).toISOString() : null;

      let saq = withOrg(supabase.from('submission_activity')
        .select('id,action,old_stage,new_stage,note,created_at,submission_id,submission:submissions!submission_id(candidate:candidates!candidate_id(full_name)),job:job_orders!job_order_id(job_title,job_code)')
        .eq('recruiter_id', targetId).order('created_at', { ascending: false }).limit(limit), req);
      if (fromT) saq = saq.gte('created_at', fromT);
      if (toT) saq = saq.lte('created_at', toT);

      let alq = withOrg(supabase.from('activity_log')
        .select('id,action_type,description,created_at,job_id,contact_id')
        .eq('user_id', targetId).order('created_at', { ascending: false }).limit(limit), req);
      if (fromT) alq = alq.gte('created_at', fromT);
      if (toT) alq = alq.lte('created_at', toT);

      const [{ data: sa }, alRes] = await Promise.all([saq, alq.then(r => r, () => ({ data: [] }))]);
      const al = (alRes && alRes.data) || [];

      const feed = [];
      (sa || []).forEach(r => {
        const cand = r.submission && r.submission.candidate && r.submission.candidate.full_name;
        const job = r.job && (r.job.job_title || r.job.job_code);
        // The words follow the owner's two corrections. D-0029: putting somebody
        // on a job is NOT a submission ("Added a submission" said it was).
        // D-0057: "Tagged" is a word for the candidate database, not a step in a
        // job. `tagged` rows are old history (the add used to be logged that
        // way); `promoted` rows carry the retired stage "Tagged" as their
        // old_stage, so they read by where the person went, never from it.
        let detail = (r.action === 'created' || r.action === 'tagged') ? 'Added to a job' :
          r.action === 'promoted' ? (r.new_stage ? ('Moved to ' + r.new_stage) : 'Moved on') :
          r.action === 'bdm_approved' ? 'BDM approved' :
          (r.old_stage && r.new_stage ? ('Moved ' + r.old_stage + ' → ' + r.new_stage) : (r.new_stage || r.action || 'Updated'));
        feed.push({ at: r.created_at, kind: 'submission', action: r.action, detail, candidate: cand || null, job: job || null, note: r.note || null });
      });
      al.forEach(r => {
        feed.push({ at: r.created_at, kind: 'lead', action: r.action_type, detail: r.description || r.action_type, candidate: null, job: null, note: null });
      });
      feed.sort((a, b) => new Date(b.at) - new Date(a.at));
      res.json({ user_id: targetId, activity: feed.slice(0, limit) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // /bd-analytics/recruiters and /bd-analytics/funnel were RETIRED in Session
  // 32 (R-005, ex-C-0003). No screen called either; the recruiter table
  // counted a submission by CURRENT stage — a third definition beside
  // services/submission-stages.js — and /reports/recruiting already carries
  // per-person productivity and the funnel, scoped the same way. Do not bring
  // them back; extend /reports/recruiting instead.
};
