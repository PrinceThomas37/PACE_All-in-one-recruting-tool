// ============================================================================
// BD MANAGER / RECRUITER WORKFLOW — BACKEND ROUTES
// Branch: bd-manager-recruiter-workflow
// ----------------------------------------------------------------------------
// Isolated module. Mounted from index.js with a single line:
//
//     require('./bd_recruiter_routes')(app, { supabase, auth, hasRole, notGuest, today });
//
// Nothing in the existing index.js is modified except that one require line.
// All routes here are NEW paths; none collide with existing routes.
// ============================================================================

const { EVENTS, emit } = require('./events');
const { PROVIDER_IDS, providerList } = require('./config/sourcing');
const { parseResume } = require('./resume-parser');
const matchEngine = require('./match-engine');
const { fetchWithTimeout } = require('./http-client');

const AI_TIMEOUT_MS = 30000;

module.exports = function (app, deps) {
  const { supabase, auth, hasRole, notGuest, today } = deps;
  // Multi-tenant: stamp new rows with the caller's org. Returns {} when there is
  // no org context so the column DEFAULT (the platform's default org) applies —
  // keeps single-tenant behaviour intact.
  const orgIdFor = deps.orgIdFor || function (req) { return (req && req.orgId) || null; };
  function orgStamp(req) { const o = orgIdFor(req); return o ? { org_id: o } : {}; }
  // Scope a read to the caller's org (no-op if no org context is resolved yet,
  // which keeps behaviour safe during the single-tenant transition).
  function withOrg(query, req) { const o = orgIdFor(req); return o ? query.eq('org_id', o) : query; }

  // ── relevance engine plumbing ────────────────────────────────────────────
  // Migrations are applied to the live DB *after* the new build is confirmed
  // serving (see CLAUDE.md), so this code has to run correctly before migration
  // 034 exists. Writing to a missing column fails the whole insert, which would
  // mean nobody could create a job order. So probe once and degrade: the derived
  // skills still get written (those columns are old), only the requirement blob
  // is held back until the column is there.
  let _reqColsPromise = null;
  function hasRequirementColumns() {
    if (!_reqColsPromise) {
      _reqColsPromise = supabase.from('job_orders').select('requirement').limit(1)
        .then(r => !r.error)
        .catch(() => false);
    }
    return _reqColsPromise;
  }

  // Derive skills/experience from the JD and build the normalized requirement.
  // Never overwrites a value a human typed — deriveJobSkills only returns fields
  // that were blank on the row it was given.
  async function applyDerivedJobFields(row) {
    const out = {};
    try {
      Object.assign(out, matchEngine.deriveJobSkills(row));
      if (await hasRequirementColumns()) {
        out.requirement = matchEngine.buildRequirement(Object.assign({}, row, out));
        out.requirement_at = new Date();
      } else if (out.skills_source) {
        // skills_source ships in the same migration as requirement.
        delete out.skills_source;
      }
    } catch (err) {
      // Parsing is a convenience. A job order must always save.
      console.error('[match] deriving job fields failed:', err.message);
      return {};
    }
    return out;
  }

  // ── pipeline stage definitions ───────────────────────────────────────────
  // Canonical submission lifecycle = the Ceipal application status. `stage` holds
  // it; the grid labels it "Application Status". The BDM gate is on Submitted to Client.
  const STAGES = [
    'Sourced',
    'Screening',
    'Submitted to BDM',
    'Submitted to Client',
    'Interview Scheduled',
    'Interview Completed',
    'Offer',
    'Joining',        // was "Confirmation"
    'Placement',
    'Not Accepted',   // merges the old "Rejected" + "Not Joined"
    'On Hold'
  ];
  // Old → new stage aliases. Existing rows may still carry pre-migration names
  // until migration 032 runs; normalizeStage() maps them so aggregates stay
  // correct in the meantime (and an incoming write of an old name is accepted).
  const STAGE_ALIASES = { 'Confirmation': 'Joining', 'Rejected': 'Not Accepted', 'Not Joined': 'Not Accepted' };
  function normalizeStage(s) { return STAGE_ALIASES[s] || s; }
  // Stage a recruiter may NOT move INTO without BD Manager approval.
  const BDM_GATED_STAGE = 'Submitted to Client';

  function isBDM(req) { return hasRole(req, 'admin', 'bd', 'bd_lead', 'associate_director', 'director'); }
  function isRecruiter(req) { return hasRole(req, 'recruiter'); }

  // human-readable id helper (LD- / JOB- / CN-) via the SQL function next_id()
  async function nextId(prefix) {
    const { data, error } = await supabase.rpc('next_id', { p_prefix: prefix });
    if (error) throw new Error(`next_id(${prefix}) failed: ${error.message}`);
    return data;
  }

  async function logSubmissionActivity(submissionId, jobOrderId, recruiterId, action, oldStage, newStage, note) {
    try {
      await supabase.from('submission_activity').insert({
        submission_id: submissionId, job_order_id: jobOrderId, recruiter_id: recruiterId,
        action, old_stage: oldStage || null, new_stage: newStage || null, note: note || null
      });
    } catch (_) { /* non-fatal */ }
  }

  // recruiter scoping: which job_order ids is this recruiter assigned to?
  async function assignedJobOrderIds(userId) {
    const { data } = await supabase.from('recruiter_assignments')
      .select('job_order_id').eq('recruiter_id', userId);
    return [...new Set((data || []).map(r => r.job_order_id))];
  }

  // Everyone a user is responsible for on the flexible reporting hierarchy
  // (users.manager_id, migration 026) — themselves plus every direct and
  // transitive report. A user nobody reports to just gets [self]. Used to
  // scope reports: a BD sees their own numbers, a BD Lead sees their whole
  // team's, up the chain to Director — without hard-coding role pairs.
  // Shared with routes/auth.js via ./hierarchy so there's one implementation.
  const { reportingChainIds } = require('./hierarchy')(supabase);

  const JOB_ORDER_SELECT =
    '*, company:companies(id,name,industry,location), ' +
    'source_lead:jobs!source_lead_id(id,position,stage,lead_code), ' +
    'bd_manager:users!bd_manager_id(id,name,employee_id), ' +
    'creator:users!created_by(id,name,employee_id)';

  // All editable job fields (matches the frontend form + migration #2 columns).
  // Used by both create routes and the PUT so every field round-trips.
  const JOB_FIELDS = [
    'job_title','client','client_job_id','client_manager','end_client',
    'status','job_type','emp_level','work_auth','priority','remote','clearance',
    'country','state','city','zip','pay_cur','pay_min','pay_max',
    'start_date','end_date','duration','placement_fee','req_docs',
    'primary_skills','secondary_skills','exp_min','exp_max',
    'industry','domain','degree','languages','job_category',
    'positions','job_description','posting_description','comments',
    'previous_description','previous_description_at'
  ];
  // Date/timestamp columns need null (not '') when empty, or Postgres rejects them.
  const JOB_DATE_FIELDS = ['start_date','end_date','previous_description_at'];
  function pickJobFields(src) {
    const out = {};
    src = src || {};
    JOB_FIELDS.forEach(function (k) {
      if (src[k] === undefined) return;
      let v = src[k];
      if (JOB_DATE_FIELDS.indexOf(k) > -1 && (v === '' || v === null)) { out[k] = null; return; }
      out[k] = v;
    });
    return out;
  }

  // ==========================================================================
  // CONVERSION — lead -> job order
  // ==========================================================================

  // Convert an existing CONNECTED lead (a jobs row) into a job order.
  app.post('/job-orders/from-lead/:jobId', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can convert leads to job orders.' });

      const { data: lead, error: leadErr } = await supabase
        .from('jobs').select('*').eq('id', req.params.jobId).is('deleted_at', null).single();
      if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });
      if (lead.stage !== 'Connected') {
        return res.status(409).json({ error: `Lead must be at stage "Connected" to convert (currently "${lead.stage}").` });
      }

      // guard against double-conversion of the same lead
      const { data: existing } = await supabase
        .from('job_orders').select('id,job_code').eq('source_lead_id', lead.id).is('deleted_at', null).limit(1);
      if (existing && existing.length) {
        return res.status(409).json({ error: `This lead was already converted (${existing[0].job_code}).`, job_order_id: existing[0].id });
      }

      // ensure the lead has an LD- code (older rows backfilled by migration, but be safe)
      let leadCode = lead.lead_code;
      if (!leadCode) {
        leadCode = await nextId('LD');
        await supabase.from('jobs').update({ lead_code: leadCode }).eq('id', lead.id);
      }

      const b = req.body || {};
      const jobCode = await nextId('JOB');
      const jobRow = Object.assign({
        job_code: jobCode,
        source_lead_id: lead.id,
        lead_code: leadCode,
        company_id: lead.company_id,
        job_title: lead.position,                   // title carries over from the lead
        priority: 'Normal',
        status: 'Active',
        bd_manager_id: b.bd_manager_id || req.user.id,
        created_by: req.user.id
      }, pickJobFields(b), orgStamp(req));
      // never let the client blank out the inherited title
      if (!jobRow.job_title) jobRow.job_title = lead.position;
      const { data: jobOrder, error } = await supabase.from('job_orders')
        .insert(jobRow).select(JOB_ORDER_SELECT).single();
      if (error) throw error;

      const openedDate = new Date().toISOString().slice(0, 10);
      await supabase.from('jobs').update({
        job_opened_date: openedDate,
        updated_at: new Date()
      }).eq('id', lead.id);

      res.status(201).json(jobOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // BD creates a job order directly. Lead-first: a jobs (lead) row is created,
  // gets an LD- code, THEN the job order is created from it and gets a JOB- code.
  app.post('/job-orders', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can create job orders.' });

      const b = req.body || {};
      const lead = b.lead || {};
      const job = b.job || {};

      if (!lead.company_id || !lead.position) {
        return res.status(400).json({ error: 'lead.company_id and lead.position are required (lead info must be filled first).' });
      }

      // 1) create the underlying lead (jobs row), pre-stamped Connected since it
      //    is a real, client-confirmed opening originating from the BD directly.
      const leadCode = await nextId('LD');
      const { data: leadRow, error: leadErr } = await supabase.from('jobs').insert({
        company_id: lead.company_id,
        position: lead.position,
        location: lead.location || null,
        source: lead.source || 'BD Direct',
        stage: 'Connected',
        notes: lead.notes || '',
        created_by: req.user.id,
        assigned_to_bd: req.user.id,
        lead_code: leadCode
      }).select().single();
      if (leadErr) throw leadErr;

      // optional contacts on the lead, reusing the existing contacts table shape
      if (Array.isArray(lead.contacts) && lead.contacts.length) {
        const rows = lead.contacts.map((c, i) => ({
          job_id: leadRow.id, first_name: c.first_name || '', last_name: c.last_name || '',
          designation: c.designation || null, email: c.email || null, phone: c.phone || null,
          linkedin: c.linkedin || null, is_primary: i === 0
        }));
        await supabase.from('contacts').insert(rows);
      }

      // 2) create the job order from that lead
      const jobCode = await nextId('JOB');
      const jobRow = Object.assign({
        job_code: jobCode,
        source_lead_id: leadRow.id,
        lead_code: leadCode,
        company_id: leadRow.company_id,
        job_title: leadRow.position,
        priority: 'Normal',
        status: 'Active',
        bd_manager_id: job.bd_manager_id || req.user.id,
        created_by: req.user.id
      }, pickJobFields(job), orgStamp(req));
      if (!jobRow.job_title) jobRow.job_title = leadRow.position;
      // Fill the skill/experience fields from the JD when the BD left them blank,
      // and attach the normalized requirement. Skills carry half the match score
      // and were previously hand-typed, so a blank field meant every candidate
      // scored on title and location alone.
      Object.assign(jobRow, await applyDerivedJobFields(jobRow));
      const { data: jobOrder, error } = await supabase.from('job_orders')
        .insert(jobRow).select(JOB_ORDER_SELECT).single();
      if (error) throw error;

      res.status(201).json(jobOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // JOB ORDERS — list / read / update / soft-delete
  // ==========================================================================

  app.get('/job-orders', auth, async (req, res) => {
    try {
      let query = withOrg(supabase.from('job_orders').select(JOB_ORDER_SELECT).is('deleted_at', null), req);

      // recruiters only see job orders they are assigned to
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.length) return res.json([]);
        query = query.in('id', ids);
      }
      if (req.query.status) query = query.eq('status', req.query.status);

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      const list = data || [];
      // Attach assigned recruiters to every job order (the single-get already
      // does this; the list did not — which made the recruiter "My Jobs" filter
      // return nothing and showed everyone as "Unassigned" on the BDM list).
      if (list.length) {
        const { data: assigns } = await supabase.from('recruiter_assignments')
          .select('job_order_id, id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
          .in('job_order_id', list.map(j => j.id));
        const byJob = {};
        (assigns || []).forEach(a => { (byJob[a.job_order_id] = byJob[a.job_order_id] || []).push(a); });
        list.forEach(j => { j.recruiters = byJob[j.id] || []; });
      }
      res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Company-wide job board — every recruiter can see every job (title, client,
  // location, who's on it, how busy it is) so they can ask to be assigned.
  // Candidate contact details stay locked until assignment (see the masked
  // branch of GET /job-orders/:id/submissions).
  // NOTE: registered before /job-orders/:id so "browse" isn't parsed as an id.
  app.get('/job-orders/browse', auth, async (req, res) => {
    try {
      if (!isRecruiter(req) && !isBDM(req)) return res.status(403).json({ error: 'Recruiting roles only.' });
      const { data: jobs, error } = await withOrg(supabase.from('job_orders')
        .select('id,job_code,job_title,client,city,state,country,status,priority,positions,job_type,emp_level,remote,work_auth,primary_skills,secondary_skills,job_description,pay_cur,pay_min,pay_max,start_date,created_at,company:companies(id,name,industry),bd_manager:users!bd_manager_id(id,name)')
        .is('deleted_at', null), req).order('created_at', { ascending: false });
      if (error) throw error;
      const list = jobs || [];
      const ids = list.map(j => j.id);
      const assignsByJob = {}, subCounts = {}, myReqs = {};
      if (ids.length) {
        const { data: assigns } = await supabase.from('recruiter_assignments')
          .select('job_order_id, recruiter_id, recruiter:users!recruiter_id(id,name)')
          .in('job_order_id', ids);
        (assigns || []).forEach(a => { (assignsByJob[a.job_order_id] = assignsByJob[a.job_order_id] || []).push(a); });
        const { data: subs } = await supabase.from('submissions')
          .select('job_order_id').in('job_order_id', ids).is('deleted_at', null);
        (subs || []).forEach(s => { subCounts[s.job_order_id] = (subCounts[s.job_order_id] || 0) + 1; });
        const { data: reqs } = await supabase.from('assignment_requests')
          .select('id,job_order_id,status').eq('recruiter_id', req.user.id).in('job_order_id', ids);
        (reqs || []).forEach(r => {
          const prev = myReqs[r.job_order_id];
          if (!prev || r.status === 'pending') myReqs[r.job_order_id] = r;
        });
      }
      res.json(list.map(j => ({
        ...j,
        recruiters: (assignsByJob[j.id] || []).map(a => (a.recruiter && a.recruiter.name) || '').filter(Boolean),
        submission_count: subCounts[j.id] || 0,
        assigned_to_me: (assignsByJob[j.id] || []).some(a => a.recruiter_id === req.user.id),
        my_request: myReqs[j.id] ? { id: myReqs[j.id].id, status: myReqs[j.id].status } : null
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/job-orders/:id', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('job_orders')
        .select(JOB_ORDER_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !data) return res.status(404).json({ error: 'Job order not found' });
      const reqOrg = orgIdFor(req);
      if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Job order not found' });

      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(data.id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }

      // attach assigned recruiters
      const { data: assigns } = await supabase.from('recruiter_assignments')
        .select('id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
        .eq('job_order_id', data.id);
      data.recruiters = assigns || [];
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/job-orders/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      // BD managers can edit any job order; recruiters can edit a job they are
      // assigned to (so the people actually working the req can keep it current).
      if (!isBDM(req) && !(isRecruiter(req) && await recruiterCanTouchJob(req, req.params.id))) {
        return res.status(403).json({ error: 'Only BD Managers or an assigned recruiter can edit this job order.' });
      }
      const b = req.body || {};
      const updates = Object.assign({ updated_at: new Date() }, pickJobFields(b));
      if (b.bd_manager_id !== undefined) updates.bd_manager_id = b.bd_manager_id || null;

      // Re-derive against the row as it will be AFTER this edit, not just the
      // fields being sent: a BD who pastes a JD and nothing else should still get
      // skills filled in, and one who types skills by hand must keep them.
      const { data: current } = await supabase.from('job_orders')
        .select('*').eq('id', req.params.id).maybeSingle();
      Object.assign(updates, await applyDerivedJobFields(Object.assign({}, current || {}, updates)));

      const { data, error } = await supabase.from('job_orders')
        .update(updates).eq('id', req.params.id).select(JOB_ORDER_SELECT).single();
      if (error) throw error;
      // The job changed, so every cached score against it is stale.
      invalidateJobScores(req.params.id);
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/job-orders/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can delete job orders.' });
      await supabase.from('job_orders').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // RELEVANCE — rank the candidate pool against a job order
  //
  // The browser has scored candidates for a while, but only the handful already
  // tagged onto a job's pipeline, because that is all it ever holds. Ranking the
  // whole database against a job has to happen server-side. Same scoring rules
  // in both places — literally the same file (see match-engine.js).
  // ==========================================================================

  // Cached scores are an optimisation, not the source of truth: responses are
  // always computed fresh from the current rows, so an edit can never be masked
  // by a stale cache. The write is fire-and-forget so ranking never waits on it,
  // and it silently no-ops until migration 034 is applied.
  function persistScores(rows, jobOrderId, req) {
    if (!rows.length) return;
    const payload = rows.slice(0, 500).map(r => ({
      org_id: orgIdFor(req) || null,
      candidate_id: r.candidate_id,
      job_order_id: jobOrderId,
      score: r.score,
      band: r.band,
      reasons: r.reasons,
      engine_version: matchEngine.VERSION,
      computed_at: new Date()
    }));
    supabase.from('match_scores')
      .upsert(payload, { onConflict: 'candidate_id,job_order_id' })
      .then(() => {}, () => {});   // table may not exist yet — never surface this
  }

  function invalidateJobScores(jobOrderId) {
    supabase.from('match_scores').delete().eq('job_order_id', jobOrderId)
      .then(() => {}, () => {});
  }

  // GET /job-orders/:id/matches — the whole pool, best fit first.
  //   ?limit=      how many to return (default 50, max 200)
  //   ?min_score=  only return candidates at or above this score
  //   ?q=          narrow the pool by name/email/title first
  app.get('/job-orders/:id/matches', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;

      const { data: job, error: jobErr } = await withOrg(
        supabase.from('job_orders').select('*').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (jobErr) throw jobErr;
      // 404 rather than an empty list: an out-of-org id must not be
      // distinguishable from one that doesn't exist.
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const q = String(req.query.q || '').trim().replace(/[,()]/g, ' ').trim();
      let query = withOrg(supabase.from('candidates')
        .select(CANDIDATE_SELECT).is('deleted_at', null), req);
      if (q) query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,current_title.ilike.%${q}%`
      );
      // Bounded so one enormous org can't turn this into a full-table scan; the
      // app's analytics already have that problem and this shouldn't add to it.
      const { data: candidates, error } = await query.limit(2000);
      if (error) throw error;

      const minScore = req.query.min_score != null && req.query.min_score !== ''
        ? parseInt(req.query.min_score, 10) : null;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

      const ranked = matchEngine.rankCandidates(candidates || [], job, {
        minScore: Number.isNaN(minScore) ? null : minScore
      });
      persistScores(ranked, job.id, req);

      res.json({
        job_order: { id: job.id, job_code: job.job_code, job_title: job.job_title, client: job.client },
        // Surfaced so the UI can say *why* scores look thin — a job with no
        // skills listed scores everyone on title and location alone.
        scoreable: Boolean(
          String(job.primary_skills || '').trim() || String(job.secondary_skills || '').trim()
        ),
        engine_version: matchEngine.VERSION,
        total: ranked.length,
        pool_size: (candidates || []).length,
        results: ranked.slice(0, limit)
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /match/score — score one candidate against one job, by id or inline.
  // Inline lets the sourcing branches score a person who isn't in the DB yet.
  app.post('/match/score', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const b = req.body || {};

      let candidate = b.candidate || null;
      if (!candidate && b.candidate_id) {
        const { data } = await withOrg(supabase.from('candidates')
          .select(CANDIDATE_SELECT).eq('id', b.candidate_id).is('deleted_at', null), req).maybeSingle();
        candidate = data;
      }
      let job = b.job || null;
      if (!job && b.job_order_id) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', b.job_order_id).is('deleted_at', null), req).maybeSingle();
        job = data;
      }
      if (!candidate || !job) {
        return res.status(400).json({ error: 'Provide candidate (or candidate_id) and job (or job_order_id).' });
      }

      res.json(Object.assign({ engine_version: matchEngine.VERSION },
        matchEngine.scoreCandidate(candidate, job)));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /job-orders/:id/parse-jd — re-derive skills/experience from the JD on
  // demand, for job orders created before this existed. Returns what it would
  // write; `?apply=1` persists it. Only ever fills blanks.
  app.post('/job-orders/:id/parse-jd', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const { data: job } = await withOrg(
        supabase.from('job_orders').select('*').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });
      if (!isBDM(req) && !(isRecruiter(req) && await recruiterCanTouchJob(req, req.params.id))) {
        return res.status(403).json({ error: 'Only BD Managers or an assigned recruiter can edit this job order.' });
      }

      const derived = await applyDerivedJobFields(job);
      if (!Object.keys(derived).length) {
        return res.json({ applied: false, derived: {}, message: 'Nothing to fill — the skill fields are already set, or the description has no parseable detail.' });
      }
      if (String(req.query.apply || '') !== '1') return res.json({ applied: false, derived });

      const { data, error } = await supabase.from('job_orders')
        .update(Object.assign({ updated_at: new Date() }, derived))
        .eq('id', req.params.id).select(JOB_ORDER_SELECT).single();
      if (error) throw error;
      invalidateJobScores(req.params.id);
      res.json({ applied: true, derived, job_order: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── anonymized posting JD ──────────────────────────────────────────────────
  // Rewrite the job description with the client/company identity removed so it
  // can be published on job boards. AI rewrite when a key is configured;
  // otherwise a rule-based scrub (replace client names with "our client",
  // strip emails/phones/URLs). Returns the text — saving is a separate PUT.
  function scrubJobDescription(jd, names) {
    let out = String(jd || '');
    names.filter(Boolean).forEach(n => {
      const safe = String(n).trim();
      if (safe.length < 3) return;
      out = out.replace(new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'our client');
      // also scrub without common suffixes (Acme Corp → Acme)
      const base = safe.replace(/[,.]?\s+(inc|llc|llp|ltd|corp|co|company|group|pllc|pc)\.?$/i, '').trim();
      if (base.length >= 4 && base.toLowerCase() !== safe.toLowerCase()) {
        out = out.replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'our client');
      }
    });
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')     // emails
             .replace(/https?:\/\/\S+|www\.\S+/gi, '')                           // urls
             .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '')  // phones
             .replace(/(our client)(\s+\1)+/gi, 'our client')
             .replace(/[ \t]{2,}/g, ' ').trim();
    return out;
  }

  app.post('/job-orders/:id/posting-jd', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data: j, error } = await supabase.from('job_orders')
        .select('job_title,client,end_client,client_manager,job_description,company:companies(name)')
        .eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !j) return res.status(404).json({ error: 'Job order not found' });
      if (!j.job_description || !j.job_description.trim()) return res.status(400).json({ error: 'This job has no description to rewrite.' });

      const names = [j.client, j.end_client, j.client_manager, j.company && j.company.name];
      const key = process.env.ANTHROPIC_API_KEY;
      if (key && key !== 'your_anthropic_api_key_here') {
        try {
          const prompt = `Rewrite this job description for public posting on job boards. Remove ALL identifying details of the hiring company: company names (${names.filter(Boolean).join(', ') || 'any company names present'}), people's names, emails, phone numbers, URLs, and street addresses. Refer to the company only as "our client". Keep every requirement, responsibility, pay/benefit detail, and location (city/state is fine). Keep the same structure and roughly the same length. Reply with ONLY the rewritten description — no preamble.

JOB TITLE: ${j.job_title || ''}

DESCRIPTION:
${String(j.job_description).slice(0, 12000)}`;
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] })
          }, { timeoutMs: AI_TIMEOUT_MS });
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text?.trim();
          // belt-and-braces: scrub the AI output too, in case a name slipped through
          if (text) return res.json({ posting: scrubJobDescription(text, names), used_ai: true });
        } catch (_) { /* fall through to rules */ }
      }
      res.json({ posting: scrubJobDescription(j.job_description, names), used_ai: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // RECRUITER ASSIGNMENT
  // ==========================================================================

  app.post('/job-orders/:id/recruiters', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can assign recruiters.' });
      const recruiterIds = req.body.recruiter_ids || (req.body.recruiter_id ? [req.body.recruiter_id] : []);
      if (!recruiterIds.length) return res.status(400).json({ error: 'recruiter_ids required' });

      const rows = recruiterIds.map(rid => ({
        job_order_id: req.params.id, recruiter_id: rid, assigned_by: req.user.id
      }));
      // upsert avoids duplicate-assignment errors thanks to the unique index
      const { error } = await supabase.from('recruiter_assignments')
        .upsert(rows, { onConflict: 'job_order_id,recruiter_id', ignoreDuplicates: true });
      if (error) throw error;

      const { data: assigns } = await supabase.from('recruiter_assignments')
        .select('id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
        .eq('job_order_id', req.params.id);
      res.json(assigns || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/job-orders/:id/recruiters/:rid', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can unassign recruiters.' });
      await supabase.from('recruiter_assignments')
        .delete().eq('job_order_id', req.params.id).eq('recruiter_id', req.params.rid);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Assignment requests: recruiter asks to be put on a job ────────────────
  app.post('/job-orders/:id/request-assignment', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isRecruiter(req)) return res.status(403).json({ error: 'Recruiters only.' });
      const jid = req.params.id, uid = req.user.id;
      const assigned = await assignedJobOrderIds(uid);
      if (assigned.includes(jid)) return res.status(400).json({ error: 'You are already assigned to this job.' });
      const { data: existing } = await supabase.from('assignment_requests')
        .select('id,status').eq('job_order_id', jid).eq('recruiter_id', uid).eq('status', 'pending').maybeSingle();
      if (existing) return res.json(existing);
      const { data, error } = await supabase.from('assignment_requests')
        .insert({ job_order_id: jid, recruiter_id: uid, note: (req.body && req.body.note) || null })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // BDM: the queue of recruiters asking for jobs. Recruiter: their own requests.
  app.get('/assignment-requests', auth, async (req, res) => {
    try {
      let q = supabase.from('assignment_requests')
        .select('id,status,note,created_at,decided_at,job_order_id,recruiter_id,' +
          'job:job_orders(id,job_code,job_title,client),recruiter:users!recruiter_id(id,name,employee_id)')
        .order('created_at', { ascending: false }).limit(100);
      if (isBDM(req)) { if (req.query.status) q = q.eq('status', req.query.status); }
      else if (isRecruiter(req)) q = q.eq('recruiter_id', req.user.id);
      else return res.status(403).json({ error: 'Recruiting roles only.' });
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/assignment-requests/:id/decide', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can decide assignment requests.' });
      const action = (req.body && req.body.action) || '';
      if (!['approve', 'decline'].includes(action)) return res.status(400).json({ error: "action must be 'approve' or 'decline'" });
      const { data: reqRow } = await supabase.from('assignment_requests')
        .select('id,job_order_id,recruiter_id,status').eq('id', req.params.id).maybeSingle();
      if (!reqRow) return res.status(404).json({ error: 'Request not found' });
      if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Request already decided.' });
      if (action === 'approve') {
        const { error: aerr } = await supabase.from('recruiter_assignments')
          .upsert({ job_order_id: reqRow.job_order_id, recruiter_id: reqRow.recruiter_id, assigned_by: req.user.id },
            { onConflict: 'job_order_id,recruiter_id', ignoreDuplicates: true });
        if (aerr) throw aerr;
      }
      const { data, error } = await supabase.from('assignment_requests')
        .update({ status: action === 'approve' ? 'approved' : 'declined', decided_by: req.user.id, decided_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Job orders a specific user is assigned to — lets an admin/BDM see a
  // recruiter's assignments from that recruiter's profile (the recruiter's own
  // /job-orders is scoped to themselves; this is the "view someone else" version).
  app.get('/users/:id/job-orders', auth, async (req, res) => {
    try {
      if (!isBDM(req)) return res.status(403).json({ error: 'Admin or BD Manager only' });
      const ids = await assignedJobOrderIds(req.params.id);
      if (!ids.length) return res.json([]);
      const { data, error } = await supabase.from('job_orders')
        .select(JOB_ORDER_SELECT).in('id', ids).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // CANDIDATES — shared pool (Ceipal-style Applicants database)
  // ==========================================================================

  // Writable candidate fields (matches migration 012 + the Applicants form).
  const CANDIDATE_FIELDS = [
    'full_name','first_name','last_name','email','phone','alt_phone','linkedin_url',
    'current_location','city','state','country','zip',
    'current_title','headline','skills','experience_years',
    'work_authorization','clearance','current_employer',
    'availability','notice_period','current_ctc','expected_ctc',
    'bill_rate','pay_rate','pay_type','pay_currency',
    'applicant_status','source','resume_url','resume_filename','resume_text'
  ];
  const CANDIDATE_SELECT =
    'id,candidate_code,full_name,first_name,last_name,email,phone,alt_phone,linkedin_url,' +
    'current_location,city,state,country,zip,current_title,headline,skills,experience_years,' +
    'work_authorization,clearance,current_employer,availability,notice_period,current_ctc,expected_ctc,' +
    'bill_rate,pay_rate,pay_type,pay_currency,applicant_status,source,resume_url,resume_filename,resume_text,' +
    'tags,owner_id,created_by,created_at,updated_at,' +
    'owner:users!owner_id(id,name,employee_id),creator:users!created_by(id,name,employee_id)';

  function pickCandidateFields(src) {
    const out = {};
    src = src || {};
    CANDIDATE_FIELDS.forEach(function (k) {
      if (src[k] === undefined) return;
      const v = src[k];
      if (k === 'experience_years') { out[k] = (v === '' || v === null) ? null : v; return; }
      out[k] = (v === '') ? null : v;
    });
    return out;
  }

  // Normalizers — mirror the generated columns created in migration 012.
  function normName(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
  function normEmail(s) { return String(s || '').toLowerCase().trim(); }
  function normPhone(s) { return (String(s || '').match(/\d/g) || []).join('').slice(-10); }

  // Duplicate rule (owner's spec): same normalized full name AND (email OR phone
  // matches). Returns the matching non-deleted candidates ([] = no duplicate).
  async function findCandidateDuplicates({ full_name, email, phone, excludeId, profile_url, source, source_external_id, req }) {
    const n = normName(full_name), e = normEmail(email), p = normPhone(phone);
    const scope = (q) => (req ? withOrg(q, req) : q);

    // Provenance match, tried first. The name+contact rule below cannot see an
    // externally sourced person who has neither an email nor a phone — which is
    // most of them — so the same profile would be re-imported endlessly. A
    // profile URL identifies one human unambiguously.
    const sel = 'id,candidate_code,full_name,email,phone,current_title,applicant_status,owner_id';
    if (profile_url || (source && source_external_id)) {
      try {
        let pq = scope(supabase.from('candidates').select(sel).is('deleted_at', null).limit(10));
        pq = profile_url
          ? pq.eq('profile_url', profile_url)
          : pq.eq('source', source).eq('source_external_id', source_external_id);
        if (excludeId) pq = pq.neq('id', excludeId);
        const { data, error } = await pq;
        // A missing column (migration 036 not yet applied) is expected, not fatal
        // — fall through to the name+contact rule below.
        if (!error && data && data.length) return data;
      } catch (_) { /* fall through */ }
    }

    if (!n) return [];
    if (!e && !p) return [];                 // need at least one of email / phone to match on
    let q = scope(supabase.from('candidates').select(sel)
      .is('deleted_at', null).eq('name_norm', n).limit(25));
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).filter(function (c) {
      const ce = normEmail(c.email), cp = normPhone(c.phone);
      return (e && ce && ce === e) || (p && cp && cp === p);
    });
  }

  // GET /candidates
  //  - legacy (no ?page): returns a plain array (used by the job-page add modal)
  //  - paged  (?page=N):  returns { data, total, page, limit } for the Applicants grid
  app.get('/candidates', auth, async (req, res) => {
    try {
      const paged = req.query.page !== undefined;
      const q = (req.query.q || '').trim().replace(/[,()]/g, ' ').trim();  // strip or()-structural chars
      let query = withOrg(supabase.from('candidates')
        .select(CANDIDATE_SELECT, paged ? { count: 'exact' } : undefined)
        .is('deleted_at', null), req);
      if (q) query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%,current_title.ilike.%${q}%`
      );
      if (req.query.applicant_status) query = query.eq('applicant_status', req.query.applicant_status);
      if (req.query.source) query = query.eq('source', req.query.source);
      if (req.query.state) query = query.eq('state', req.query.state);
      if (req.query.work_authorization) query = query.eq('work_authorization', req.query.work_authorization);
      if (req.query.owner_id) query = query.eq('owner_id', req.query.owner_id);
      if (req.query.availability) query = query.eq('availability', req.query.availability);
      if (req.query.experience_min) query = query.gte('experience_years', parseFloat(req.query.experience_min));
      if (req.query.experience_max) query = query.lte('experience_years', parseFloat(req.query.experience_max));
      if (req.query.created_from) query = query.gte('created_at', req.query.created_from);
      if (req.query.created_to) query = query.lte('created_at', req.query.created_to);
      if (req.query.has_resume === '1') query = query.or('resume_url.not.is.null,resume_filename.not.is.null');
      query = query.order('created_at', { ascending: false });

      if (paged) {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const from = (page - 1) * limit;
        const { data, error, count } = await query.range(from, from + limit - 1);
        if (error) throw error;
        return res.json({ data: data || [], total: count || 0, page, limit });
      }
      const { data, error } = await query.limit(100);
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /candidates/check-duplicate?full_name=&email=&phone=
  // Registered before /candidates/:id so the literal path wins the match.
  app.get('/candidates/check-duplicate', auth, async (req, res) => {
    try {
      const dups = await findCandidateDuplicates({
        full_name: req.query.full_name, email: req.query.email,
        phone: req.query.phone, excludeId: req.query.exclude_id, req
      });
      res.json({ duplicate: dups.length > 0, duplicates: dups });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/candidates/:id', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidates')
        .select(CANDIDATE_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !data) return res.status(404).json({ error: 'Candidate not found' });
      const reqOrg = orgIdFor(req);
      if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Candidate not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // A candidate's recruiting history across every job — pipelines, submissions,
  // and the stage-change activity that drives the profile lifecycle bar.
  app.get('/candidates/:id/history', auth, async (req, res) => {
    try {
      const cid = req.params.id;
      const JOB = 'job:job_orders(id,job_code,job_title,client)';
      const { data: pipeline } = await supabase.from('candidate_pipeline')
        .select('id,pipeline_code,pipeline_status,job_order_id,tagged_at,submission_id,' + JOB)
        .eq('candidate_id', cid).is('deleted_at', null).order('tagged_at', { ascending: false });
      const { data: submissions } = await supabase.from('submissions')
        .select('id,submission_code,stage,job_order_id,submitted_at,created_at,bdm_approved_at,pipeline_id,revision_status,' + JOB)
        .eq('candidate_id', cid).is('deleted_at', null).order('created_at', { ascending: false });
      let activity = [];
      const subIds = (submissions || []).map(s => s.id);
      if (subIds.length) {
        const { data: act } = await supabase.from('submission_activity')
          .select('id,submission_id,job_order_id,action,old_stage,new_stage,note,created_at')
          .in('submission_id', subIds).order('created_at', { ascending: true });
        activity = act || [];
      }
      res.json({ pipeline: pipeline || [], submissions: submissions || [], activity });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.full_name || !String(b.full_name).trim()) return res.status(400).json({ error: 'full_name required' });

      // Duplicate catch — name + (email or phone). Warn-and-offer: unless `force`,
      // return the matches (409) so the UI can offer "open existing" over a copy.
      if (!b.force) {
        const dups = await findCandidateDuplicates({ full_name: b.full_name, email: b.email, phone: b.phone, req });
        if (dups.length) return res.status(409).json({ error: 'possible_duplicate', duplicates: dups });
      }

      const code = await nextId('CN');
      const row = Object.assign(pickCandidateFields(b), {
        candidate_code: code,
        applicant_status: b.applicant_status || 'New lead',
        owner_id: b.owner_id || req.user.id,
        created_by: req.user.id
      }, orgStamp(req));
      if (Array.isArray(b.tags)) row.tags = b.tags;
      const { data, error } = await supabase.from('candidates').insert(row).select(CANDIDATE_SELECT).single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/candidates/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const updates = Object.assign(pickCandidateFields(b), { updated_at: new Date(), updated_by: req.user.id });
      if (b.owner_id !== undefined) updates.owner_id = b.owner_id || null;
      if (Array.isArray(b.tags)) updates.tags = b.tags;
      const { data, error } = await supabase.from('candidates')
        .update(updates).eq('id', req.params.id).select(CANDIDATE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('candidates').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // CANDIDATE NOTES & DOCUMENTS (Slice 5)
  // ==========================================================================

  const NOTE_TYPES = ['job_posting', 'applicant_reference'];
  const DOC_BUCKET = 'candidate-docs';
  const MAX_DOC_BYTES = 4.5 * 1024 * 1024;   // fits the 5mb express json limit after base64
  let _bucketEnsured = false;
  async function ensureDocBucket() {
    if (_bucketEnsured) return;
    try { await supabase.storage.createBucket(DOC_BUCKET, { public: false }); } catch (_) { /* exists */ }
    _bucketEnsured = true;
  }

  // ── notes ────────────────────────────────────────────────────────────────
  app.get('/candidates/:id/notes', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidate_notes')
        .select('*, author:users!created_by(id,name,employee_id)')
        .eq('candidate_id', req.params.id).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates/:id/notes', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: 'body required' });
      const noteType = NOTE_TYPES.includes(b.note_type) ? b.note_type : 'applicant_reference';
      const { data, error } = await supabase.from('candidate_notes').insert({
        candidate_id: req.params.id, job_order_id: b.job_order_id || null,
        note_type: noteType, body: String(b.body), created_by: req.user.id
      }).select('*, author:users!created_by(id,name,employee_id)').single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id/notes/:noteId', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('candidate_notes').update({ deleted_at: new Date() })
        .eq('id', req.params.noteId).eq('candidate_id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── documents (stored in the private candidate-docs bucket) ────────────────
  app.get('/candidates/:id/documents', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidate_documents')
        .select('*, uploader:users!uploaded_by(id,name,employee_id)')
        .eq('candidate_id', req.params.id).is('deleted_at', null)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      // attach a short-lived signed URL for each (private bucket)
      const rows = await Promise.all((data || []).map(async (d) => {
        let url = null;
        try {
          const { data: s } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
          url = s ? s.signedUrl : null;
        } catch (_) { /* leave null */ }
        return Object.assign({}, d, { url });
      }));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates/:id/documents', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
      const raw = String(b.data_base64).replace(/^data:.*;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'empty file' });
      if (buffer.length > MAX_DOC_BYTES) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });

      await ensureDocBucket();
      const safe = String(b.filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      const path = req.params.id + '/' + Date.now() + '-' + safe;
      const { error: upErr } = await supabase.storage.from(DOC_BUCKET)
        .upload(path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;

      const docType = ['resume', 'cover_letter', 'other'].includes(b.doc_type) ? b.doc_type : 'resume';
      const { data, error } = await supabase.from('candidate_documents').insert({
        candidate_id: req.params.id, doc_type: docType, filename: String(b.filename),
        storage_path: path, content_type: b.content_type || null, size_bytes: buffer.length,
        uploaded_by: req.user.id
      }).select('*, uploader:users!uploaded_by(id,name,employee_id)').single();
      if (error) throw error;

      // convenience: if this is the first résumé, backfill candidate.resume_url metadata
      if (docType === 'resume') {
        try { await supabase.from('candidates').update({ resume_filename: String(b.filename) }).eq('id', req.params.id); } catch (_) {}
      }
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id/documents/:docId', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: doc } = await supabase.from('candidate_documents')
        .select('storage_path').eq('id', req.params.docId).eq('candidate_id', req.params.id).single();
      await supabase.from('candidate_documents').update({ deleted_at: new Date() })
        .eq('id', req.params.docId).eq('candidate_id', req.params.id);
      if (doc && doc.storage_path) { try { await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]); } catch (_) {} }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // SUBMISSIONS — pipeline (per-candidate stage, with BDM approval gate)
  // ==========================================================================

  const SUBMISSION_SELECT =
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,work_authorization,' +
    'city,state,country,current_location,experience_years,source,resume_url,current_title), ' +
    'recruiter:users!recruiter_id(id,name,employee_id), ' +
    'submitter:users!submitted_by(id,name,employee_id)';

  // editable submission display fields (the Submissions grid)
  const SUBMISSION_FIELDS = ['revision_status','bill_rate','pay_rate','employer_name','availability','notice_period','submitted_rate','notes','sub_stage','interview_at','interview_location'];

  // list submissions for a job order (the kanban data)
  app.get('/job-orders/:id/submissions', auth, async (req, res) => {
    try {
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(req.params.id)) {
          // Job-board browse: an unassigned recruiter may see who is on the job
          // and how far along they are, but candidate contact details (email,
          // phone, resume) unlock only once the recruiter is assigned.
          const { data, error } = await supabase.from('submissions')
            .select('id,job_order_id,stage,sub_stage,created_at,submitted_at,' +
              'candidate:candidates(id,candidate_code,full_name,current_title,city,state,experience_years),' +
              'recruiter:users!recruiter_id(id,name)')
            .eq('job_order_id', req.params.id).is('deleted_at', null)
            .order('created_at', { ascending: false });
          if (error) throw error;
          return res.json({ masked: true, submissions: data || [] });
        }
      }
      const { data, error } = await supabase.from('submissions')
        .select(SUBMISSION_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // add a candidate (from the shared pool) to a job order
  app.post('/submissions', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) {
        return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      }
      // recruiters can only submit into job orders they are assigned to
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(b.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }
      // snapshot rate/availability/employer from the candidate (overridable via body)
      const { data: cand } = await supabase.from('candidates')
        .select('bill_rate,pay_rate,current_employer,availability,notice_period')
        .eq('id', b.candidate_id).single();
      const c = cand || {};
      const pick = (k, fb) => (b[k] !== undefined ? b[k] : (fb || null));
      const { data, error } = await supabase.from('submissions').insert({
        ...orgStamp(req),
        submission_code: await nextId('SB'),
        candidate_id: b.candidate_id, job_order_id: b.job_order_id,
        recruiter_id: b.recruiter_id || req.user.id,
        stage: 'Sourced', submitted_rate: b.submitted_rate || null, notes: b.notes || null,
        revision_status: b.revision_status || 'N/A',
        bill_rate: pick('bill_rate', c.bill_rate),
        pay_rate: pick('pay_rate', c.pay_rate),
        employer_name: pick('employer_name', c.current_employer),
        availability: pick('availability', c.availability),
        notice_period: pick('notice_period', c.notice_period),
        submitted_by: req.user.id, submitted_at: new Date()
      }).select(SUBMISSION_SELECT).single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This candidate is already in this job order.' });
        throw error;
      }
      // Keep the Pipeline tab a full roster: a direct submission add also
      // creates (or links) the candidate's pipeline row for this job.
      try {
        const { data: pl } = await supabase.from('candidate_pipeline').select('id')
          .eq('candidate_id', b.candidate_id).eq('job_order_id', b.job_order_id).is('deleted_at', null).maybeSingle();
        if (pl) {
          await supabase.from('candidate_pipeline')
            .update({ submission_id: data.id, pipeline_status: 'Moved to Submission', updated_at: new Date() }).eq('id', pl.id);
        } else {
          await supabase.from('candidate_pipeline').insert({
            pipeline_code: await nextId('PL'), candidate_id: b.candidate_id, job_order_id: b.job_order_id,
            pipeline_status: 'Moved to Submission', submission_id: data.id, tagged_by: req.user.id
          });
        }
      } catch (_) { /* non-fatal */ }
      await logSubmissionActivity(data.id, b.job_order_id, data.recruiter_id, 'created', null, 'Sourced', null);
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // move a submission to a new stage — enforces the BDM approval gate
  app.patch('/submissions/:id/stage', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const newStage = normalizeStage(req.body.stage);
      if (!STAGES.includes(newStage)) return res.status(400).json({ error: `Invalid stage. Allowed: ${STAGES.join(', ')}` });

      const { data: sub, error: subErr } = await supabase.from('submissions')
        .select('*').eq('id', req.params.id).is('deleted_at', null).single();
      if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

      const recruiterScoped = isRecruiter(req) && !isBDM(req);
      if (recruiterScoped) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(sub.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }

      // ── THE GATE ──────────────────────────────────────────────────────────
      // Recruiters own the stages up to "Submitted to BDM"; everything after
      // (client submission, interviews, offer, placement, rejection) is BD's.
      // Recruiters can still SEE later stages, they just can't change them.
      const RECRUITER_STAGES = ['Sourced', 'Screening', 'Submitted to BDM'];
      if (recruiterScoped) {
        if (!RECRUITER_STAGES.includes(newStage)) {
          return res.status(403).json({ error: 'Recruiters can move candidates up to "Submitted to BDM" — the BD team owns the stages after that.' });
        }
        if (!RECRUITER_STAGES.includes(normalizeStage(sub.stage))) {
          return res.status(403).json({ error: 'This candidate is with the BD team now — only a BD Manager can change this stage.' });
        }
        if (newStage === 'Submitted to BDM') {
          const det = req.body.submission_details;
          if (!det || !String(det.comment || '').trim()) {
            return res.status(400).json({ error: 'Submission details with a comment are required to submit to the BD Manager.' });
          }
        }
      }
      if (newStage === BDM_GATED_STAGE && !isBDM(req)) {
        return res.status(403).json({ error: 'Only a BD Manager can approve "Submitted to BDM" candidates through to the client.' });
      }
      // BD duty: every "Not Accepted" carries its reason (client feedback, no-show,
      // accepted elsewhere…)
      if (newStage === 'Not Accepted' && !String((req.body || {}).rejection_reason || '').trim()) {
        return res.status(400).json({ error: 'Please add the reason.' });
      }

      const bb = req.body || {};
      // A new stage resets the sub-stage unless one is supplied with the move.
      const updates = { stage: newStage, stage_updated_at: new Date(), sub_stage: bb.sub_stage || null };
      if (bb.interview_at !== undefined) updates.interview_at = bb.interview_at || null;
      if (bb.interview_location !== undefined) updates.interview_location = bb.interview_location || null;
      if (bb.interview_type !== undefined) updates.interview_type = bb.interview_type || null;
      if (bb.interview_platform !== undefined) updates.interview_platform = bb.interview_platform || null;
      if (bb.interview_link !== undefined) updates.interview_link = bb.interview_link || null;
      if (bb.interview_address !== undefined) updates.interview_address = bb.interview_address || null;
      if (bb.interviewers !== undefined) updates.interviewers = Array.isArray(bb.interviewers) ? bb.interviewers : null;
      if (bb.submission_details !== undefined) updates.submission_details = bb.submission_details || null;
      if (newStage === 'Not Accepted') updates.rejection_reason = String(bb.rejection_reason).trim();
      let action = 'stage_change';
      if (newStage === BDM_GATED_STAGE && isBDM(req)) {
        updates.bdm_approved_at = new Date();
        updates.bdm_approved_by = req.user.id;
        action = 'bdm_approved';
      }

      const { data, error } = await supabase.from('submissions')
        .update(updates).eq('id', req.params.id).select(SUBMISSION_SELECT).single();
      if (error) throw error;

      // Optional reminder-to-call, riding the existing reminders plumbing.
      if (bb.reminder_date) {
        try {
          const cand = (data.candidate || {});
          await supabase.from('reminders').insert({
            user_id: req.user.id, contact_name: cand.full_name || null, email: cand.email || null,
            return_date: bb.reminder_date,
            note: bb.reminder_note || ('Follow up with ' + (cand.full_name || 'candidate') + ' — ' + newStage),
            status: 'pending'
          });
        } catch (_) { /* non-fatal */ }
      }

      await logSubmissionActivity(data.id, sub.job_order_id, sub.recruiter_id, action, sub.stage, newStage,
        [bb.sub_stage ? ('[' + bb.sub_stage + ']') : '', bb.note || ''].filter(Boolean).join(' ') || null);
      emit(EVENTS.SUBMISSION_ADVANCED, { submissionId: data.id, jobOrderId: sub.job_order_id, fromStage: sub.stage, toStage: newStage, actorUserId: req.user.id });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // edit a submission's display fields (revision status / rate / employer …)
  app.patch('/submissions/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: sub, error: e0 } = await supabase.from('submissions')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !sub) return res.status(404).json({ error: 'Submission not found' });
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(sub.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }
      const b = req.body || {};
      const updates = {};
      SUBMISSION_FIELDS.forEach(k => { if (b[k] !== undefined) updates[k] = (b[k] === '' ? null : b[k]); });
      const { data, error } = await supabase.from('submissions')
        .update(updates).eq('id', req.params.id).select(SUBMISSION_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/submissions/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('submissions').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // PIPELINE — candidate tagging layer (Ceipal "Pipeline" tab)
  // A candidate is TAGGED into a job order, then PROMOTED to a submission.
  // ==========================================================================

  const PIPELINE_STATUSES = ['Tagged','Contacted','Interested','Screening','Shortlisted','Moved to Submission','Not Interested','Rejected'];
  // The Pipeline tab is the FULL roster for a job: promoted rows join their
  // submission so the grid can show the live submission stage instead of the
  // static "Moved to Submission".
  const PIPELINE_SELECT =
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,work_authorization,' +
    'current_title,headline,skills,city,state,country,current_location,experience_years,' +
    'availability,notice_period,current_ctc,bill_rate,pay_rate,source,resume_url), ' +
    'tagger:users!tagged_by(id,name,employee_id), ' +
    'submission:submissions!candidate_pipeline_submission_id_fkey(id,submission_code,stage,sub_stage)';

  // recruiter may only touch a job order they are assigned to
  async function recruiterCanTouchJob(req, jobOrderId) {
    if (!(isRecruiter(req) && !isBDM(req))) return true;
    const ids = await assignedJobOrderIds(req.user.id);
    return ids.includes(jobOrderId);
  }

  // list the pipeline (tagged candidates) for a job order — the Pipeline-tab grid
  app.get('/job-orders/:id/pipeline', auth, async (req, res) => {
    try {
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await supabase.from('candidate_pipeline')
        .select(PIPELINE_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('tagged_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // tag a candidate (from the pool) into a job order's pipeline
  app.post('/pipeline', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // snapshot rate/availability/employer from the candidate (overridable via body)
      const { data: cand } = await supabase.from('candidates')
        .select('work_authorization,bill_rate,pay_rate,current_employer,availability,notice_period,current_ctc,source')
        .eq('id', b.candidate_id).single();
      const c = cand || {};
      const pick = (k, fallback) => (b[k] !== undefined ? b[k] : (fallback || null));
      const row = {
        pipeline_code: await nextId('PL'),
        candidate_id: b.candidate_id, job_order_id: b.job_order_id,
        pipeline_status: b.pipeline_status || 'Tagged',
        work_auth_snap: pick('work_auth_snap', c.work_authorization),
        bill_rate: pick('bill_rate', c.bill_rate),
        pay_rate: pick('pay_rate', c.pay_rate),
        employer_name: pick('employer_name', c.current_employer),
        availability: pick('availability', c.availability),
        notice_period: pick('notice_period', c.notice_period),
        current_ctc: pick('current_ctc', c.current_ctc),
        source: pick('source', c.source),
        notes: b.notes || null,
        tagged_by: req.user.id
      };
      Object.assign(row, orgStamp(req));
      const { data, error } = await supabase.from('candidate_pipeline').insert(row).select(PIPELINE_SELECT).single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This candidate is already tagged to this job.' });
        throw error;
      }
      await logSubmissionActivity(null, b.job_order_id, req.user.id, 'tagged', null, 'Tagged', null);
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // change a pipeline entry's status
  app.patch('/pipeline/:id/status', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const st = req.body.status;
      if (!PIPELINE_STATUSES.includes(st)) return res.status(400).json({ error: `Invalid pipeline status. Allowed: ${PIPELINE_STATUSES.join(', ')}` });
      const { data: row, error: e0 } = await supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !row) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, row.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await supabase.from('candidate_pipeline')
        .update({ pipeline_status: st, updated_at: new Date() }).eq('id', req.params.id).select(PIPELINE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // edit a pipeline entry's snapshot fields (rate / availability / employer …)
  app.patch('/pipeline/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: row, error: e0 } = await supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !row) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, row.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const allowed = ['work_auth_snap','bill_rate','pay_rate','employer_name','availability','notice_period','current_ctc','source','notes','pipeline_status'];
      const b = req.body || {};
      const updates = { updated_at: new Date() };
      allowed.forEach(k => { if (b[k] !== undefined) updates[k] = (b[k] === '' ? null : b[k]); });
      const { data, error } = await supabase.from('candidate_pipeline')
        .update(updates).eq('id', req.params.id).select(PIPELINE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // promote a pipeline entry into a formal submission
  app.post('/pipeline/:id/promote', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: pl, error: e0 } = await supabase.from('candidate_pipeline')
        .select('*').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !pl) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, pl.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // already promoted → return the linked submission
      if (pl.submission_id) {
        const { data: existing } = await supabase.from('submissions').select(SUBMISSION_SELECT).eq('id', pl.submission_id).single();
        return res.json({ pipeline_id: pl.id, submission: existing, already: true });
      }

      const targetStage = req.body.stage || 'Submitted to BDM';
      let submission;
      const { data: sub, error } = await supabase.from('submissions').insert({
        ...orgStamp(req),
        submission_code: await nextId('SB'),
        candidate_id: pl.candidate_id, job_order_id: pl.job_order_id,
        recruiter_id: req.user.id, stage: targetStage,
        pipeline_id: pl.id, revision_status: 'N/A',
        bill_rate: pl.bill_rate || null, pay_rate: pl.pay_rate || null,
        employer_name: pl.employer_name || null, availability: pl.availability || null,
        notice_period: pl.notice_period || null,
        submitted_rate: pl.pay_rate || null, notes: pl.notes || null,
        submitted_by: req.user.id, submitted_at: new Date()
      }).select(SUBMISSION_SELECT).single();
      if (error) {
        if (error.code === '23505') {
          // a submission already exists for this candidate+job — link to it
          const { data: existing } = await supabase.from('submissions').select(SUBMISSION_SELECT)
            .eq('candidate_id', pl.candidate_id).eq('job_order_id', pl.job_order_id).is('deleted_at', null).single();
          submission = existing;
        } else throw error;
      } else submission = sub;
      if (!submission) return res.status(500).json({ error: 'Could not create or find the submission.' });

      await supabase.from('candidate_pipeline')
        .update({ submission_id: submission.id, pipeline_status: 'Moved to Submission', updated_at: new Date() })
        .eq('id', pl.id);
      await logSubmissionActivity(submission.id, pl.job_order_id, req.user.id, 'promoted', 'Tagged', targetStage, null);
      emit(EVENTS.SUBMISSION_ADVANCED, { submissionId: submission.id, jobOrderId: pl.job_order_id, fromStage: null, toStage: targetStage, actorUserId: req.user.id });
      res.status(201).json({ pipeline_id: pl.id, submission });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/pipeline/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('candidate_pipeline').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // RESUME PARSING — file → candidate fields (AI-assisted, rule fallback)
  // ==========================================================================

  // Parse an uploaded resume and return candidate fields for the UI to prefill.
  // Creates nothing — the recruiter reviews before saving.
  app.post('/candidates/parse-resume', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
      const raw = String(b.data_base64).replace(/^data:.*;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'empty file' });
      if (buffer.length > 4.5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });
      const { fields, used_ai, text } = await parseResume(buffer, b.filename);
      res.json({ fields, used_ai, resume_text: text });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ==========================================================================
  // RECRUITING LOOKUPS — managed taxonomies (Slice 6)
  // ==========================================================================

  const LOOKUP_CATEGORIES = ['work_authorization','source','applicant_status','availability','pay_type'];
  function isLookupAdmin(req){ return hasRole(req, 'admin', 'bd_lead'); }

  // GET /recruiting-lookups        → { category: [value, …] } (active only)
  // GET /recruiting-lookups?all=1  → { category: [{id,value,sort_order,is_active}, …] } (management)
  app.get('/recruiting-lookups', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('recruiting_lookups')
        .select('id,category,value,sort_order,is_active')
        .order('category', { ascending: true }).order('sort_order', { ascending: true });
      if (error) throw error;
      const grouped = {};
      LOOKUP_CATEGORIES.forEach(c => { grouped[c] = []; });
      (data || []).forEach(r => { (grouped[r.category] = grouped[r.category] || []).push(r); });
      if (req.query.all === '1') return res.json(grouped);
      const active = {};
      Object.keys(grouped).forEach(c => { active[c] = grouped[c].filter(r => r.is_active).map(r => r.value); });
      res.json(active);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/recruiting-lookups', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      const b = req.body || {};
      if (!LOOKUP_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Invalid category.' });
      if (!b.value || !String(b.value).trim()) return res.status(400).json({ error: 'value required' });
      const { data: last } = await supabase.from('recruiting_lookups')
        .select('sort_order').eq('category', b.category).order('sort_order', { ascending: false }).limit(1);
      const nextOrder = (last && last.length) ? (last[0].sort_order + 1) : 0;
      const { data, error } = await supabase.from('recruiting_lookups')
        .insert({ category: b.category, value: String(b.value).trim(), sort_order: nextOrder }).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That value already exists in this list.' });
        throw error;
      }
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/admin/recruiting-lookups/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      const b = req.body || {};
      const updates = {};
      if (b.value !== undefined) updates.value = String(b.value).trim();
      if (b.is_active !== undefined) updates.is_active = !!b.is_active;
      if (b.sort_order !== undefined) updates.sort_order = parseInt(b.sort_order, 10) || 0;
      const { data, error } = await supabase.from('recruiting_lookups')
        .update(updates).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/admin/recruiting-lookups/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      await supabase.from('recruiting_lookups').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // SOURCING CONNECTORS — pull candidates from a source into the database
  // (Slice A: framework + CSV/file import + staging + dedup import.)
  // ==========================================================================

  app.get('/sourcing/providers', auth, async (req, res) => { res.json(providerList()); });

  // stage rows parsed client-side (CSV/XLSX) with a batch duplicate check
  app.post('/sourcing/import-file', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const provider = PROVIDER_IDS.includes(b.provider) ? b.provider : 'csv';
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
      if (rows.length > 2000) return res.status(413).json({ error: 'Too many rows in one import (max 2000). Split the file.' });

      // batch dedup against existing candidates (2 queries, matched in JS)
      const emails = [...new Set(rows.map(r => normEmail(r.email)).filter(Boolean))];
      const phones = [...new Set(rows.map(r => normPhone(r.phone)).filter(Boolean))];
      const dupSel = 'id,candidate_code,full_name,name_norm,email_norm,phone_norm';
      let cands = [];
      // Org-scoped: without this the batch check can flag a row as a duplicate
      // of a candidate belonging to a different org, and leak their code + name.
      if (emails.length) { const { data } = await withOrg(supabase.from('candidates').select(dupSel).is('deleted_at', null).in('email_norm', emails), req); cands = cands.concat(data || []); }
      if (phones.length) { const { data } = await withOrg(supabase.from('candidates').select(dupSel).is('deleted_at', null).in('phone_norm', phones), req); cands = cands.concat(data || []); }
      const byId = {}; cands.forEach(c => { byId[c.id] = c; }); cands = Object.values(byId);
      const findDup = (r) => {
        const n = normName(r.full_name), e = normEmail(r.email), p = normPhone(r.phone);
        if (!n || (!e && !p)) return null;
        return cands.find(c => c.name_norm === n && ((e && c.email_norm === e) || (p && c.phone_norm === p))) || null;
      };

      const toInsert = rows.map(r => {
        const dup = findDup(r);
        const exp = parseFloat(r.experience_years);
        return {
          provider, external_id: r.external_id || null,
          full_name: r.full_name || null, first_name: r.first_name || null, last_name: r.last_name || null,
          email: r.email || null, phone: r.phone || null,
          current_title: r.current_title || null, current_employer: r.current_employer || null,
          location: r.location || null, city: r.city || null, state: r.state || null, country: r.country || null,
          work_authorization: r.work_authorization || null,
          experience_years: isFinite(exp) ? exp : null,
          skills: r.skills || null, resume_url: r.resume_url || null,
          // A LinkedIn column now arrives as linkedin_url; everything else as
          // source_url. Both land in the existing source_url column (staging has
          // no separate field, and adding one would mean writing to a column
          // that does not exist until migration 036 runs). importStagedCandidate
          // recognises a LinkedIn URL and routes it to candidates.linkedin_url.
          source_url: r.linkedin_url || r.source_url || null,
          raw: r.raw || null, status: 'new', dup_candidate_id: dup ? dup.id : null, created_by: req.user.id,
          ...orgStamp(req)
        };
      });
      const { data, error } = await supabase.from('sourcing_candidates').insert(toInsert).select('id,dup_candidate_id');
      if (error) throw error;
      const dupCount = (data || []).filter(x => x.dup_candidate_id).length;
      res.status(201).json({ staged: (data || []).length, duplicates: dupCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // the review queue
  app.get('/sourcing/staged', auth, async (req, res) => {
    try {
      // Previously this had no org scoping, no guest check and no role check, so
      // any authenticated session — guests included — could read every org's
      // staged candidates. These are real people's contact details; they get the
      // same treatment as the candidates table itself.
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      let q = withOrg(supabase.from('sourcing_candidates')
        .select('*, dup:candidates!dup_candidate_id(id,candidate_code,full_name), imported:candidates!imported_candidate_id(id,candidate_code,full_name)')
        .order('created_at', { ascending: false }).limit(500), req);
      q = q.eq('status', req.query.status || 'new');
      if (req.query.provider) q = q.eq('provider', req.query.provider);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Does this candidates table have the provenance columns yet? Migration 036 is
  // applied after deploy, and writing to a missing column fails the whole insert
  // — which would break importing entirely. Probe once and degrade.
  let _provColsPromise = null;
  function hasProvenanceColumns() {
    if (!_provColsPromise) {
      _provColsPromise = supabase.from('candidates').select('profile_url').limit(1)
        .then(r => !r.error).catch(() => false);
    }
    return _provColsPromise;
  }

  // A LinkedIn profile deserves the dedicated column the candidate form already
  // reads; anything else is a generic profile URL.
  function isLinkedInUrl(u) { return /(^|\/\/|\.)linkedin\.com\/(in|pub)\//i.test(String(u || '')); }

  // import one staged row into `candidates` (honours dedup; optional tag to a job)
  async function importStagedCandidate(staged, opts, userId, req) {
    const provider = staged.provider;
    const profileUrl = staged.profile_url || staged.source_url || null;
    const payload = pickCandidateFields({
      full_name: staged.full_name, first_name: staged.first_name, last_name: staged.last_name,
      email: staged.email, phone: staged.phone, current_title: staged.current_title,
      current_employer: staged.current_employer, current_location: staged.location,
      city: staged.city, state: staged.state, country: staged.country,
      work_authorization: staged.work_authorization, experience_years: staged.experience_years,
      skills: staged.skills, resume_url: staged.resume_url, source: provider,
      // Previously dropped on the floor: a LinkedIn URL imported through Sourcing
      // survived staging and then vanished, because nothing mapped it across.
      linkedin_url: isLinkedInUrl(profileUrl) ? profileUrl : null
    });
    if (!payload.full_name) throw new Error('Staged row has no name.');
    if (!opts.force) {
      const dups = await findCandidateDuplicates({
        full_name: staged.full_name, email: staged.email, phone: staged.phone,
        // Externally sourced people often have neither an email nor a phone, and
        // the name+contact rule can't see them at all. The profile URL is the
        // only stable identity such a person has.
        profile_url: profileUrl, source: provider, source_external_id: staged.external_id, req
      });
      if (dups.length) return { duplicate: true, matches: dups };
    }
    const row = Object.assign(payload, {
      candidate_code: await nextId('CN'), applicant_status: 'New lead', owner_id: userId, created_by: userId
    }, orgStamp(req));
    if (await hasProvenanceColumns()) {
      row.profile_url = profileUrl;
      row.source_external_id = staged.external_id || null;
    }
    const { data: cand, error } = await supabase.from('candidates').insert(row).select(CANDIDATE_SELECT).single();
    if (error) throw error;
    await supabase.from('sourcing_candidates')
      .update({ status: 'imported', imported_candidate_id: cand.id, imported_at: new Date() }).eq('id', staged.id);
    if (opts.job_order_id) {
      try {
        await supabase.from('candidate_pipeline').insert({
          pipeline_code: await nextId('PL'), candidate_id: cand.id, job_order_id: opts.job_order_id,
          pipeline_status: 'Tagged', work_auth_snap: cand.work_authorization || null, source: provider, tagged_by: userId
        });
      } catch (_) { /* already tagged / non-fatal */ }
    }
    return { candidate: cand };
  }

  app.post('/sourcing/staged/:id/import', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: staged, error: e0 } = await supabase.from('sourcing_candidates').select('*').eq('id', req.params.id).single();
      if (e0 || !staged) return res.status(404).json({ error: 'Staged candidate not found' });
      if (staged.status === 'imported') return res.status(409).json({ error: 'Already imported.' });
      const b = req.body || {};
      if (b.job_order_id && !(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const result = await importStagedCandidate(staged, { force: !!b.force, job_order_id: b.job_order_id || null }, req.user.id, req);
      if (result.duplicate) return res.status(409).json({ error: 'possible_duplicate', duplicates: result.matches });
      res.status(201).json(result.candidate);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/sourcing/import-selected', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? b.ids : [];
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      if (b.job_order_id && !(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data: staged } = await supabase.from('sourcing_candidates').select('*').in('id', ids).eq('status', 'new');
      let imported = 0, skipped = 0;
      for (const s of (staged || [])) {
        try {
          const r = await importStagedCandidate(s, { force: !!b.force, job_order_id: b.job_order_id || null }, req.user.id, req);
          if (r.duplicate) skipped++; else imported++;
        } catch (_) { skipped++; }
      }
      res.json({ imported, skipped, total: (staged || []).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/sourcing/staged/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await withOrg(supabase.from('sourcing_candidates').update({ status: 'discarded' }).eq('id', req.params.id), req);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // people-search for API providers — scaffolded; honest not-configured response
  app.post('/sourcing/search', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const provider = (req.body && req.body.provider) || '';
      if (!PROVIDER_IDS.includes(provider)) return res.status(400).json({ error: 'Unknown provider.' });
      if (provider === 'csv') return res.status(400).json({ error: 'Use file import for CSV.' });
      return res.status(501).json({ error: 'needs_credentials', provider,
        message: 'This provider is scaffolded. Add credentials and enable its connector to search.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

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

  console.log('[BD-Recruiter] Routes mounted (job-orders, candidates, pipeline, submissions, recruiter assignment, analytics)');
};
