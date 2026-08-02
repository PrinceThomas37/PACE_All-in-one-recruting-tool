// ============================================================================
// RECRUITING CORE — the shared closure the recruiting route modules are built on.
//
// bd_recruiter_routes.js was one 2,140-line closure: ~65 routes plus every
// helper they share, all in one scope. That worked, but it relied on function
// hoisting ACROSS sections — recruiterCanTouchJob is defined in the pipeline
// block and called from job-orders, relevance and sourcing; invalidateJobScores
// is defined in the relevance block and called from the job-orders CRUD above
// it. Cutting the file into route modules without first pulling these out would
// break exactly those calls, and several of them silently (an undefined helper
// inside a try/catch that already swallows errors).
//
// So the shared surface lives here, is built once, and is handed to each route
// module. What stayed behind in a single route module is what only that module
// uses — scrubJobDescription (job-orders), ensureDocBucket (candidates),
// importStagedCandidate (sourcing).
//
// Behaviour is intentionally byte-identical to the original closure; this is a
// move, not a rewrite. The one addition is `db` (models/), passed through so
// route modules can be converted to org-scoped access incrementally.
// ============================================================================

const matchEngine = require('../match-engine');

module.exports = function createRecruitingCore(deps) {
  const { supabase, hasRole } = deps;

  // ── Multi-tenant ──────────────────────────────────────────────────────────
  // Stamp new rows with the caller's org. Returns {} when there is no org
  // context so the column DEFAULT (the platform's default org) applies — keeps
  // single-tenant behaviour intact.
  const orgIdFor = deps.orgIdFor || function (req) { return (req && req.orgId) || null; };
  function orgStamp(req) { const o = orgIdFor(req); return o ? { org_id: o } : {}; }
  // Scope a read to the caller's org (no-op if no org context is resolved yet,
  // which keeps behaviour safe during the single-tenant transition).
  function withOrg(query, req) { const o = orgIdFor(req); return o ? query.eq('org_id', o) : query; }

  // ── Relevance engine plumbing ─────────────────────────────────────────────
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

  // Cached scores are an optimisation, not the source of truth: responses are
  // always computed fresh from the current rows, so an edit can never be masked
  // by a stale cache. The write is fire-and-forget so ranking never waits on it,
  // and it silently no-ops until migration 034 is applied.
  // Lives here, not in the relevance block, because the job-orders CRUD above it
  // calls invalidateJobScores — a cross-section call the old file only got away
  // with because of hoisting.
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

  // ── Pipeline stage definitions ────────────────────────────────────────────
  // Canonical submission lifecycle = the Ceipal application status. `stage` holds
  // it; the grid labels it "Application Status". The BDM gate is on Submitted to Client.
  //
  // NOTE: this vocabulary is duplicated in five frontend files — see CLAUDE.md.
  // 33-stage-modal.js is canonical; a rename must update all of them plus this.
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

  // A recruiter may only touch a job order they are assigned to. Note the gate
  // is deliberately narrow: it constrains ONLY a pure recruiter. Every other
  // role (BD Manager, and anyone who is neither) returns true here and is
  // gated elsewhere — copied verbatim from the original closure, because
  // "tightening" it to deny non-recruiters would silently lock roles out.
  //
  // Called from job-orders, relevance, pipeline and sourcing, which is why it
  // lives here rather than in the pipeline block it used to sit in.
  async function recruiterCanTouchJob(req, jobOrderId) {
    if (!(isRecruiter(req) && !isBDM(req))) return true;
    const ids = await assignedJobOrderIds(req.user.id);
    return ids.includes(jobOrderId);
  }

  // Everyone a user is responsible for on the flexible reporting hierarchy
  // (users.manager_id, migration 026) — themselves plus every direct and
  // transitive report. A user nobody reports to just gets [self]. Used to
  // scope reports: a BD sees their own numbers, a BD Lead sees their whole
  // team's, up the chain to Director — without hard-coding role pairs.
  // Shared with routes/auth.js via ./hierarchy so there's one implementation.
  const { reportingChainIds } = require('../hierarchy')(supabase);

  // ── Submission shape ──────────────────────────────────────────────────────
  // Shared: the submissions routes select with it, and pipeline's "promote"
  // creates a submission and reads it back with the same shape. Another
  // cross-section reference the original file only got away with via hoisting.
  const SUBMISSION_SELECT =
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,work_authorization,' +
    'city,state,country,current_location,experience_years,source,resume_url,current_title), ' +
    'recruiter:users!recruiter_id(id,name,employee_id), ' +
    'submitter:users!submitted_by(id,name,employee_id)';

  // editable submission display fields (the Submissions grid)
  const SUBMISSION_FIELDS = ['revision_status','bill_rate','pay_rate','employer_name','availability','notice_period','submitted_rate','notes','sub_stage','interview_at','interview_location'];

  // ── Job order shape ───────────────────────────────────────────────────────
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

  return {
    // passthrough of the raw deps every route module needs
    supabase, db: deps.db, auth: deps.auth, hasRole, notGuest: deps.notGuest, today: deps.today,
    // multi-tenant
    orgIdFor, orgStamp, withOrg,
    // relevance
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    // stages
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    // roles + scoping
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    // shared writes
    nextId, logSubmissionActivity,
    // submission shape
    SUBMISSION_SELECT, SUBMISSION_FIELDS,
    // job order shape
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  };
};
