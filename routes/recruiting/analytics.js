// ============================================================================
// RECRUITING DASHBOARD + REPORTS + the legacy /bd-analytics endpoints.
// Split out of bd_recruiter_routes.js; logic unchanged.
//
// NOTE: /bd-analytics/* is legacy and still un-org-scoped — a known fold-in
// (CLAUDE.md growth bet 5), deliberately not changed by this move.
// ============================================================================


module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, notGuest, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;

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
      const managerScoped = isBDM(req) && !hasRole(req, 'admin');
      const uid = req.user.id;
      const chain = managerScoped ? await reportingChainIds(uid, orgIdFor(req)) : null;

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
      else if (managerScoped) sq = sq.in('recruiter_id', chain);
      const { data: subs } = await sq;

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const byStage = {};
      STAGES.forEach(s => { byStage[s] = 0; });
      let week = 0, month = 0;
      const upcoming = [];
      (subs || []).forEach(s => {
        const ns = normalizeStage(s.stage);
        if (byStage[ns] !== undefined) byStage[ns]++;
        const t = new Date(s.submitted_at || s.created_at);
        if (t >= weekAgo) week++;
        if (t >= monthStart) month++;
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
        const quarterAgo = new Date(now.getTime() - 90 * 86400000);
        jobsAssigned = { week: 0, month: 0, quarter: 0, total: jobIds.length };
        (jobs || []).forEach(j => {
          const t = new Date(assignedAtByJob[j.id] || j.created_at);
          if (t >= weekAgo) jobsAssigned.week++;
          if (t >= monthStart) jobsAssigned.month++;
          if (t >= quarterAgo) jobsAssigned.quarter++;
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
        // 'own' = just this recruiter's, 'team' = this manager's reporting
        // chain, 'org' = the whole desk (admin). team_size = chain headcount.
        scope: recruiterView ? 'own' : (managerScoped ? 'team' : 'org'),
        team_size: managerScoped ? chain.length : null,
        jobs: {
          total: (jobs || []).length,
          active: (jobs || []).filter(j => j.status === 'Active').length
        },
        ...(recruiterView ? { jobs_assigned: jobsAssigned, top_jobs: topJobs, recent_rejections: recentRejections } : {}),
        by_stage: byStage,
        submissions_week: week,
        submissions_month: month,
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
      const fromT = q.from ? new Date(q.from + 'T00:00:00').getTime() : null;
      const toT = q.to ? new Date(q.to + 'T23:59:59').getTime() : null;
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
      S.forEach(s => { const jid = s.job_order_id; if (!jid) return; const a = jobAgg[jid] || (jobAgg[jid] = { submissions: 0, interviews: 0 }); a.submissions++; if (INTERVIEWED.includes(normalizeStage(s.stage))) a.interviews++; });
      const hot_jobs = J.filter(j => !closedish(j.status)).map(j => { const a = jobAgg[j.id] || { submissions: 0, interviews: 0 }; return { job_order_id: j.id, job_code: j.job_code, job_title: j.job_title, client: j.client, status: j.status, submissions: a.submissions, interviews: a.interviews, score: a.submissions + a.interviews }; })
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
        submissions: S.filter(s => SUBMITTED.includes(normalizeStage(s.stage))).length,
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
      const fromT = req.query.from ? new Date(req.query.from + 'T00:00:00').toISOString() : null;
      const toT = req.query.to ? new Date(req.query.to + 'T23:59:59').toISOString() : null;

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
        let detail = r.action === 'created' ? 'Added a submission' :
          r.action === 'promoted' ? 'Promoted to a submission' :
          r.action === 'bdm_approved' ? 'BDM approved' :
          r.action === 'tagged' ? 'Tagged to a job' :
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

  app.get('/bd-analytics/recruiters', auth, async (req, res) => {
    try {
      if (!isBDM(req)) return res.status(403).json({ error: 'BD Manager only.' });

      const { data: subs } = await supabase.from('submissions')
        .select('recruiter_id, stage, job_order_id').is('deleted_at', null);
      const { data: recruiters } = await supabase.from('users')
        .select('id,name,employee_id,roles,role');

      // placement fee per job → revenue attribution for placed submissions
      const placedJobIds = [...new Set((subs || []).filter(s => s.stage === 'Placement').map(s => s.job_order_id))];
      const feeByJob = {};
      if (placedJobIds.length) {
        const { data: fj } = await supabase.from('job_orders')
          .select('id, placement_fee').in('id', placedJobIds);
        (fj || []).forEach(j => {
          const n = parseFloat(String(j.placement_fee || '').replace(/[^0-9.]/g, ''));
          feeByJob[j.id] = isNaN(n) ? 0 : n;
        });
      }

      const isRec = u => (Array.isArray(u.roles) && u.roles.includes('recruiter')) || u.role === 'recruiter';
      const recMap = {};
      (recruiters || []).filter(isRec).forEach(u => {
        recMap[u.id] = { recruiter_id: u.id, name: u.name, employee_id: u.employee_id,
                         total: 0, submitted_to_bdm: 0, submitted_to_client: 0, interview: 0, offer: 0, placed: 0, rejected: 0, revenue: 0 };
      });
      (subs || []).forEach(s => {
        const r = recMap[s.recruiter_id];
        if (!r) return;
        r.total++;
        const st = normalizeStage(s.stage);
        if (st === 'Submitted to BDM') r.submitted_to_bdm++;
        else if (st === 'Submitted to Client') r.submitted_to_client++;
        else if (st === 'Interview Scheduled') r.interview++;
        else if (st === 'Offer') r.offer++;
        else if (st === 'Placement') { r.placed++; r.revenue += feeByJob[s.job_order_id] || 0; }
        else if (st === 'Not Accepted') r.rejected++;
      });
      const rows = Object.values(recMap).map(r => ({
        ...r, fill_rate: r.total ? Math.round((r.placed / r.total) * 100) : 0
      })).sort((a, b) => b.placed - a.placed || b.total - a.total);
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // pipeline funnel (counts by stage, optionally for one job order)
  app.get('/bd-analytics/funnel', auth, async (req, res) => {
    try {
      if (!isBDM(req)) return res.status(403).json({ error: 'BD Manager only.' });
      let query = supabase.from('submissions').select('stage').is('deleted_at', null);
      if (req.query.job_order_id) query = query.eq('job_order_id', req.query.job_order_id);
      const { data } = await query;
      const counts = {};
      STAGES.forEach(s => { counts[s] = 0; });
      (data || []).forEach(s => { const st = normalizeStage(s.stage); if (counts[st] !== undefined) counts[st]++; });
      res.json({ stages: STAGES, counts });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
