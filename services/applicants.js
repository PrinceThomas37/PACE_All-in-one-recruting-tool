// WHO APPLIED, AND TO WHAT (Session 28).
//
// `routes/apply.js` records the job an applicant chose inside the staged row's
// `raw` blob — `applied_to_job_order_id` / `_job_title` / `_job_code` — rather
// than as columns. That is a deliberate trade (see the note in the sourcing
// router), but it means the shape of that blob is a contract, and a contract
// with two readers spelling a key differently is how two screens come to
// disagree about one fact.
//
// So there is exactly ONE reader, here, and it is pure: the router calls it and
// hands the PAGE a normalised `applied_job`. No screen parses `raw`.
//
// Everything is defensive because `raw` is jsonb: it can be null, a string, or
// an object written by an older version of the apply route.

'use strict';

const { ENTRY_STAGE } = require('./submission-stages');

function obj(row) {
  const raw = row && row.raw;
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** The job order id this person applied to, or null if this is not an application. */
function appliedJobId(row) {
  const raw = obj(row);
  return raw ? str(raw.applied_to_job_order_id) : null;
}

/**
 * The normalised block the page renders. Null when the row is not an
 * application (a CSV import has no job), so the caller can simply omit it.
 *
 * A title is NOT invented when it is missing — the job code, then the bare
 * word "a job", because naming the wrong role is worse than naming none.
 */
function appliedJob(row) {
  const raw = obj(row);
  if (!raw) return null;
  const id = str(raw.applied_to_job_order_id);
  if (!id) return null;
  return {
    id,
    title: str(raw.applied_to_job_title),
    code: str(raw.applied_to_job_code),
    applied_at: str(raw.applied_at) || str(row.created_at),
    note: str(raw.note),
    resume_filename: str(raw.resume_filename),
    // Whether the resume could be read. A recruiter needs to know that the
    // fields below were typed by the applicant rather than lifted from a CV.
    resume_parsed: !!raw.resume_parsed,
  };
}

/** Is this staged row an application (as opposed to a CSV row or a search hit)? */
function isApplication(row) {
  return !!(row && row.provider === 'apply');
}

/** Rows for one job, newest first. Pure — the router does the fetching. */
function forJob(rows, jobOrderId) {
  const want = str(jobOrderId);
  if (!want) return [];
  return (rows || []).filter(r => isApplication(r) && appliedJobId(r) === want);
}


// WHAT A CANDIDATE'S `source` SHOULD READ (Session 28, round 3).
//
// The import stored the raw provider id, so a candidate who applied through a
// job's own link had a Source column reading **"apply"** — an internal token,
// in front of a recruiter, on the record of a real person. The owner's words:
// *"the applicant tag name should be used"*.
//
// This is the one place that turns a provider id into the word a human reads.
// It is NOT `config/sourcing.js`'s label ("Apply page"), because that label
// names the SCREEN a recruiter publishes from; this names what the PERSON is.
const SOURCE_LABELS = {
  apply: 'Applicant',
  csv: 'CSV import',
};

/** The human word for where a candidate came from. Unknown ids pass through. */
function sourceLabel(provider) {
  const id = str(provider);
  if (!id) return null;
  return SOURCE_LABELS[id] || id;
}


// PUTTING SOMEBODY ON A JOB MEANS A SUBMISSION (Session 28, round 3).
//
// Importing an applicant with a job used to write only a `candidate_pipeline`
// row. But the job order's Candidates list, the pipeline board, the funnel and
// every report read `submissions.stage` — so an applicant the owner had
// explicitly added to a job counted nowhere and the job page kept saying
// "Candidates (0)". Verified against the live record before fixing it.
//
// The row is built HERE so the shape is pinned by a test rather than trusted:
// the stage in particular, because `Sourced` is the first ATS stage and using
// anything else would put an applicant somewhere no board draws.
//
// ⚠ THIS IS NOT A SUBMISSION (D-0029). The table is misnamed — it holds the
// whole candidate-on-job pipeline. A submission is a candidate sent to the
// CLIENT, and nothing here has been sent anywhere, so the row carries NO
// `submitted_at` and is not counted as a submission by anything.
//
// `extra` (optional, R-075): what a caller may set that the candidate record
// cannot say — `recruiterId` (whose candidate-on-this-job it is, when that is
// not the person clicking), `snapshot` (rate / employer / availability overrides
// typed in the add form), `submitted_rate`, `notes`, `revision_status`. A call
// with three arguments builds exactly the row it always did.
const SNAPSHOT_KEYS = ['bill_rate', 'pay_rate', 'employer_name', 'availability', 'notice_period'];

function submissionRowFor(cand, jobOrderId, userId, extra) {
  if (!cand || !cand.id || !str(jobOrderId)) return null;
  const c = cand || {};
  const x = extra || {};
  const snap = x.snapshot || {};
  const pick = (k, fallback) => (snap[k] !== undefined ? snap[k] : (fallback || null));
  const row = {
    candidate_id: c.id,
    job_order_id: str(jobOrderId),
    recruiter_id: x.recruiterId || userId || null,
    stage: ENTRY_STAGE,
    revision_status: str(x.revision_status) || 'N/A',
    employer_name: pick('employer_name', c.current_employer),
    bill_rate: pick('bill_rate', c.bill_rate),
    pay_rate: pick('pay_rate', c.pay_rate),
    availability: pick('availability', c.availability),
    notice_period: pick('notice_period', c.notice_period),
    submitted_by: userId || null,
  };
  if (x.submitted_rate) row.submitted_rate = x.submitted_rate;
  if (x.notes) row.notes = x.notes;
  return row;
}


// THE SOURCING DETAILS THAT TRAVEL WITH SOMEBODY ON A JOB (R-075, D-0057).
//
// `candidate_pipeline` began as Ceipal's "tagging" bucket — a person was TAGGED
// to a job, then PROMOTED into a submission — with its own status list (Tagged,
// Contacted, Interested, Screening, Shortlisted, Moved to Submission, Not
// Interested, Rejected) beside the eleven stages. The owner's answer: *"Tagged
// is for the database. Inside a job the stage starts from Sourced."* So inside a
// job there is ONE vocabulary, the eleven stages, and a person's state is the
// stage of their submission.
//
// What the row keeps is what it was always good for: the bill/pay rate,
// employer, availability, notice period, CTC, source and notes captured when
// somebody was put on the job. Its `pipeline_status` column (NOT NULL, default
// 'Tagged') is now inert: it is written as the entry stage, never read for
// meaning, and never sent to a screen — `pipelineView` answers with the
// submission's stage instead. Dropping the column is deep's, later.
const PIPELINE_DETAIL_KEYS = ['work_auth_snap', 'bill_rate', 'pay_rate', 'employer_name', 'availability',
  'notice_period', 'current_ctc', 'source', 'notes'];

/** The sourcing-details row for one person on one job. Null without both ids. */
function pipelineRowFor(cand, jobOrderId, userId, details) {
  if (!cand || !cand.id || !str(jobOrderId)) return null;
  const c = cand || {};
  const d = details || {};
  const pick = (k, fallback) => (d[k] !== undefined ? d[k] : (fallback || null));
  return {
    candidate_id: c.id,
    job_order_id: str(jobOrderId),
    // Never the legacy word. The column is inert; the truth is the submission.
    pipeline_status: ENTRY_STAGE,
    work_auth_snap: pick('work_auth_snap', c.work_authorization),
    bill_rate: pick('bill_rate', c.bill_rate),
    pay_rate: pick('pay_rate', c.pay_rate),
    employer_name: pick('employer_name', c.current_employer),
    availability: pick('availability', c.availability),
    notice_period: pick('notice_period', c.notice_period),
    current_ctc: pick('current_ctc', c.current_ctc),
    source: pick('source', c.source),
    notes: d.notes || null,
    tagged_by: userId || null,
  };
}

/**
 * A person's stage inside a job, read off a pipeline row. It is the stage of
 * the linked submission; a row not yet linked to one (the 15 that pre-date
 * Session 31) is on the job at the entry stage — never "Tagged".
 * `normalize` is the stage vocabulary's own (legacy names → current).
 */
function pipelineStageOf(row, normalize) {
  const n = typeof normalize === 'function' ? normalize : (s => s);
  const sub = row && row.submission;
  const st = sub && str(sub.stage);
  return (st && n(st)) || ENTRY_STAGE;
}

/**
 * What a screen receives for a pipeline row: the row, plus `stage`, and with
 * `pipeline_status` overwritten by that same stage so an older screen that still
 * reads the old key can never draw "Tagged" or "Moved to Submission". New code
 * reads `stage`; the alias goes when the last reader does.
 */
function pipelineView(row, normalize) {
  if (!row) return row;
  const stage = pipelineStageOf(row, normalize);
  return Object.assign({}, row, { stage, pipeline_status: stage });
}

module.exports = {
  appliedJobId, appliedJob, isApplication, forJob, sourceLabel, SOURCE_LABELS,
  submissionRowFor, pipelineRowFor, pipelineStageOf, pipelineView,
  SNAPSHOT_KEYS, PIPELINE_DETAIL_KEYS,
};
