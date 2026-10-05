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
const applicants = require('./applicants');
const subStages = require('./submission-stages');
const { createDb } = require('../models');

module.exports = function createRecruitingCore(deps) {
  const { supabase, hasRole } = deps;
  // The org-scoped data layer (models/). index.js has never handed one to
  // bd_recruiter_routes (the mounter's own header says it does), so build it
  // here from the client we DO get — createDb is a stateless wrapper. Every new
  // query in this territory goes through it (law 7): `db.forRequest(req)`
  // scopes reads and mutations to the caller's org and stamps inserts, so a
  // forgotten `.eq('org_id')` is not a way to leak or misfile a row.
  const db = deps.db || createDb(supabase);

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

  // The stage-change trail. R-002 COUNTS SUBMISSIONS FROM THIS TABLE, so a row
  // that does not land is a number that is quietly too low — it stays non-fatal
  // (losing one trail entry beats losing the save it describes) but no longer
  // silent: a failed write is logged, where before an `{error}` result was
  // simply dropped. Pass `req` and the row is org-stamped through models/;
  // without it (older callers) the column default applies, as it always did.
  async function logSubmissionActivity(submissionId, jobOrderId, recruiterId, action, oldStage, newStage, note, req) {
    return logSubmissionActivities([{
      submission_id: submissionId, job_order_id: jobOrderId, recruiter_id: recruiterId,
      action, old_stage: oldStage || null, new_stage: newStage || null, note: note || null
    }], req);
  }
  // Many rows, one write — a group stage move of two hundred is one insert,
  // not two hundred.
  async function logSubmissionActivities(rows, req) {
    if (!rows || !rows.length) return;
    try {
      const q = req ? db.forRequest(req).from('submission_activity') : supabase.from('submission_activity');
      const { error } = await q.insert(rows);
      if (error) console.error('[submission_activity] history write failed:', error.message);
    } catch (e) { console.error('[submission_activity] history write failed:', e && e.message); }
  }

  // Read rows for a list of ids, a hundred at a time (a long `.in()` is a long
  // URL). ONE MALFORMED ID MAKES THE DATABASE REFUSE THE WHOLE CHUNK, and the
  // caller would then read a hundred good ids as "not found" — a failure that
  // looks exactly like a normal answer. So when a chunk is refused it is asked
  // again one id at a time and whatever answers is kept; only the bad id is lost.
  // `run(chunk)` builds the query and returns it (awaitable → {data, error}).
  async function readByIds(ids, run, size) {
    const list = [...new Set((ids || []).filter(Boolean))];
    const step = size || 100;
    const out = [];
    for (let i = 0; i < list.length; i += step) {
      const chunk = list.slice(i, i + step);
      const { data, error } = await run(chunk);
      if (!error) { out.push(...(data || [])); continue; }
      for (const id of chunk) {
        try {
          const r = await run([id]);
          if (!r.error) out.push(...(r.data || []));
        } catch (_) { /* that id is unreadable — it is reported as not found */ }
      }
    }
    return out;
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
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,extra_emails,extra_phones,work_authorization,' +
    'city,state,country,current_location,experience_years,source,resume_url,current_title), ' +
    'recruiter:users!recruiter_id(id,name,employee_id), ' +
    'submitter:users!submitted_by(id,name,employee_id)';

  // editable submission display fields (the Submissions grid)
  const SUBMISSION_FIELDS = ['revision_status','bill_rate','pay_rate','employer_name','availability','notice_period','submitted_rate','notes','sub_stage','interview_at','interview_location'];

  // ── PUTTING SOMEBODY ON A JOB — THE ONE WRITER (R-075, D-0057) ─────────────
  //
  // The owner: *"A candidate when added to job from the candidate section or
  // directly gets into Sourced stage. Tagged is for the database. Inside a job
  // the stage starts from Sourced."*
  //
  // Before this, five different pieces of code each decided for themselves what
  // "on a job" meant — the tag button, the direct add, the sourcing import, the
  // pipeline "promote" and the candidate-email queue — and no two wrote the same
  // rows. One stamped `submitted_at` on a person nobody had submitted; one wrote
  // the pipeline row with NO org_id (so it filed under the default company);
  // one made a submission with no code and no history; one let a recruiter
  // create a submission at ANY stage. CLAUDE.md's rule for exactly this:
  // "two live paths to one outcome is the bug".
  //
  // So membership is written HERE and nowhere else. ON A JOB = A `submissions`
  // ROW at `Sourced` (Session 28's rule, D-0029: a row for somebody who has been
  // ADDED, not sent anywhere — so NO `submitted_at`), plus the sourcing-details
  // row beside it (`candidate_pipeline`: rates, employer, availability, notice,
  // CTC, source, notes). The submission is the membership and the only state;
  // the pipeline row's own status column is inert (see services/applicants.js).
  //
  // The contract, so a caller cannot get it wrong:
  //   * IDEMPOTENT. Somebody already on the job is `already`, never a duplicate,
  //     never an error — and if only HALF of the membership exists (the 15 rows
  //     tagged before Session 31 have a pipeline row and no submission) the
  //     missing half is written: adding somebody to a job they appear to be on
  //     heals it.
  //   * IT TAKES ROWS, NOT IDS, and refuses one from another company. The
  //     callers load the candidate and the job order through `loadCandidateFor`
  //     / `loadJobOrderFor` (org-scoped); this checks the `org_id` they carry
  //     as well, so a caller that forgot to scope is refused rather than
  //     writing across companies. (The sourcing import forgot, and would have.)
  //   * A partial write is REPORTED. The submission is the membership: if it
  //     cannot be written the call throws. If only the details row fails, the
  //     person IS on the job and the result carries `warning`.
  //   * Codes are only spent on real inserts — the existing membership is
  //     looked up first, so re-adding a hundred people burns no SB-/PL- numbers.
  //
  // A NEW WAY OF ADDING SOMEBODY TO A JOB CALLS THIS. It does not insert into
  // `submissions` or `candidate_pipeline` itself.
  const PIPELINE_SELECT =
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,extra_emails,extra_phones,work_authorization,' +
    'current_title,headline,skills,city,state,country,current_location,experience_years,' +
    'availability,notice_period,current_ctc,bill_rate,pay_rate,source,resume_url), ' +
    'tagger:users!tagged_by(id,name,employee_id), ' +
    'submission:submissions!candidate_pipeline_submission_id_fkey(id,submission_code,stage,sub_stage)';
  const MEMBER_CAND_COLS = 'id,org_id,work_authorization,bill_rate,pay_rate,current_employer,availability,notice_period,current_ctc,source';
  // Enough of an existing row to decide "already there" and to link the halves.
  const MEMBER_SUB_COLS = 'id,candidate_id,job_order_id,pipeline_id,stage,sub_stage,submission_code,recruiter_id';
  const MEMBER_PL_COLS = 'id,candidate_id,job_order_id,submission_id';

  /** The job order, if it is alive AND in the caller's company; otherwise null. */
  async function loadJobOrderFor(req, id) {
    if (!id) return null;
    const { data } = await db.forRequest(req).from('job_orders')
      .select('id,org_id,job_title,job_code,status,bd_manager_id')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    return data || null;
  }
  /** The candidate, if alive AND in the caller's company; otherwise null. */
  async function loadCandidateFor(req, id) {
    if (!id) return null;
    const { data } = await db.forRequest(req).from('candidates')
      .select(MEMBER_CAND_COLS).eq('id', id).is('deleted_at', null).maybeSingle();
    return data || null;
  }
  async function findMemberSubmission(scoped, candidateId, jobOrderId, cols) {
    const { data, error } = await scoped.from('submissions').select(cols || SUBMISSION_SELECT)
      .eq('candidate_id', candidateId).eq('job_order_id', jobOrderId).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    return data || null;
  }
  async function findMemberPipeline(scoped, candidateId, jobOrderId, cols) {
    const { data, error } = await scoped.from('candidate_pipeline').select(cols || PIPELINE_SELECT)
      .eq('candidate_id', candidateId).eq('job_order_id', jobOrderId).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /**
   * Put one candidate on one job at the entry stage.
   *   cand      — a row from loadCandidateFor (has org_id, and the snapshot columns)
   *   jobOrder  — a row from loadJobOrderFor
   *   opts.recruiterId  whose candidate-on-this-job it is (default: the caller)
   *   opts.details      the add form's sourcing details (PIPELINE_DETAIL_KEYS);
   *                     they seed BOTH rows so the two cannot start out disagreeing
   *   opts.submission   { submitted_rate, revision_status } — submission-only fields
   *   opts.existing     { submission, pipeline } already read by a batch caller
   *   opts.note         goes on the history row
   * Returns { status: 'added'|'already', healed, created:{submission,pipeline},
   *           submission, pipeline, warning }.
   */
  async function addCandidateToJob(req, cand, jobOrder, opts) {
    const o = opts || {};
    if (!cand || !cand.id) throw new Error('addCandidateToJob needs a candidate row');
    if (!jobOrder || !jobOrder.id) throw new Error('addCandidateToJob needs a job order row');
    const org = orgIdFor(req);
    if (org && ((cand.org_id && cand.org_id !== org) || (jobOrder.org_id && jobOrder.org_id !== org))) {
      throw new Error('That candidate or job order is not in your company.');
    }
    const scoped = db.forRequest(req);
    const userId = (req.user && req.user.id) || null;
    const recruiterId = o.recruiterId || userId;
    const d = o.details || {};

    const pre = o.existing || null;
    let sub = pre ? (pre.submission || null) : await findMemberSubmission(scoped, cand.id, jobOrder.id);
    let pl = pre ? (pre.pipeline || null) : await findMemberPipeline(scoped, cand.id, jobOrder.id);
    const wasMember = !!(sub || pl);
    const created = { submission: false, pipeline: false };

    // 1. THE MEMBERSHIP — a submission at the entry stage, no submitted_at.
    if (!sub) {
      const snapshot = {};
      applicants.SNAPSHOT_KEYS.forEach(k => { if (d[k] !== undefined) snapshot[k] = d[k]; });
      const row = applicants.submissionRowFor(cand, jobOrder.id, userId,
        Object.assign({ recruiterId, snapshot, notes: d.notes }, o.submission || {}));
      row.submission_code = await nextId('SB');
      if (pl) row.pipeline_id = pl.id;
      const { data, error } = await scoped.from('submissions').insert(row).select(SUBMISSION_SELECT).single();
      if (error) {
        if (error.code !== '23505') throw error;
        // Somebody put them on this job a moment ago. That is "already", not a failure.
        sub = await findMemberSubmission(scoped, cand.id, jobOrder.id);
        if (!sub) throw error;
      } else { sub = data; created.submission = true; }
    }

    // 2. THE SOURCING DETAILS — beside it, linked to it.
    let warning = null;
    if (!pl) {
      try {
        const prow = applicants.pipelineRowFor(cand, jobOrder.id, userId, d);
        prow.pipeline_code = await nextId('PL');
        prow.submission_id = sub.id;
        const { data, error } = await scoped.from('candidate_pipeline').insert(prow).select(PIPELINE_SELECT).single();
        if (error) {
          if (error.code !== '23505') throw error;
          pl = await findMemberPipeline(scoped, cand.id, jobOrder.id);
        } else { pl = data; created.pipeline = true; }
      } catch (e) {
        // The person is on the job; only their sourcing details are missing.
        warning = 'Added to the job, but the sourcing details were not saved: ' + ((e && e.message) || 'unknown error');
      }
    }

    // 3. LINK THE TWO HALVES, in both directions, only where a link is missing
    //    or wrong (a link that is already right is not rewritten).
    if (pl && sub) {
      try {
        if (pl.submission_id !== sub.id) {
          // Also retires the legacy status word the row may still carry.
          await scoped.from('candidate_pipeline')
            .update({ submission_id: sub.id, pipeline_status: subStages.ENTRY_STAGE, updated_at: new Date() }).eq('id', pl.id);
          pl.submission_id = sub.id;
        }
        if (sub.pipeline_id !== pl.id) {
          await scoped.from('submissions').update({ pipeline_id: pl.id }).eq('id', sub.id);
          sub.pipeline_id = pl.id;
        }
        pl.submission = { id: sub.id, submission_code: sub.submission_code, stage: sub.stage, sub_stage: sub.sub_stage || null };
      } catch (e) {
        warning = warning || ('Added to the job, but the two records could not be linked: ' + ((e && e.message) || 'unknown error'));
      }
    }

    // 4. THE TRAIL — the job's history begins at the entry stage. Only for a
    //    membership we just wrote; an existing one already has its own.
    if (created.submission) {
      await logSubmissionActivity(sub.id, jobOrder.id, recruiterId, 'created', null, subStages.ENTRY_STAGE, o.note || null, req);
    }

    return {
      status: wasMember ? 'already' : 'added',
      healed: wasMember && (created.submission || created.pipeline),
      created, submission: sub, pipeline: pl, warning,
    };
  }

  // What a screen receives for a pipeline row: the row, plus its `stage` (the
  // submission's; Sourced when none is linked yet), with the inert legacy
  // `pipeline_status` overwritten by that same stage. See services/applicants.js.
  function pipelineView(row) { return applicants.pipelineView(row, normalizeStage); }

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
    supabase, db, auth: deps.auth, hasRole, today: deps.today,
    // the ONE opt-out lookup (index.js) — a candidate's address is checked against it before it can become the main (D-0070)
    loadSuppressedSet: deps.loadSuppressedSet,
    // multi-tenant
    orgIdFor, orgStamp, withOrg,
    // relevance
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    // stages
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    ENTRY_STAGE: subStages.ENTRY_STAGE, RECRUITER_STAGES: subStages.RECRUITER_STAGES,
    // roles + scoping
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    // shared writes
    nextId, logSubmissionActivity, logSubmissionActivities, readByIds,
    // putting somebody on a job (R-075) — the ONE writer, and how to load what it takes
    loadJobOrderFor, loadCandidateFor, addCandidateToJob, pipelineView,
    findMemberSubmission, findMemberPipeline,
    PIPELINE_SELECT, MEMBER_CAND_COLS, MEMBER_SUB_COLS, MEMBER_PL_COLS,
    // submission shape
    SUBMISSION_SELECT, SUBMISSION_FIELDS,
    // job order shape
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  };
};
