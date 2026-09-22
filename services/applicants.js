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
function submissionRowFor(cand, jobOrderId, userId) {
  if (!cand || !cand.id || !str(jobOrderId)) return null;
  const c = cand || {};
  return {
    candidate_id: c.id,
    job_order_id: str(jobOrderId),
    recruiter_id: userId || null,
    stage: 'Sourced',
    revision_status: 'N/A',
    employer_name: c.current_employer || null,
    bill_rate: c.bill_rate || null,
    pay_rate: c.pay_rate || null,
    availability: c.availability || null,
    notice_period: c.notice_period || null,
    submitted_by: userId || null,
  };
}

module.exports = { appliedJobId, appliedJob, isApplication, forJob, sourceLabel, SOURCE_LABELS, submissionRowFor };
