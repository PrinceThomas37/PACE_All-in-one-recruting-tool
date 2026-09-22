// WHAT COUNTS AS A SUBMISSION (Session 28, D-0029).
//
// The owner's correction: *"define submission, ie job submission. adding a
// candidate to a job is not submission."* They were right, and PACE had it
// wrong in two places.
//
// A SUBMISSION IS A CANDIDATE SENT TO THE CLIENT — profile, CV and rate, for a
// hire/no-hire decision. It is the unit a staffing desk measures itself on.
// ADDING A CANDIDATE TO A JOB IS NOT THAT: it says only "this person is in the
// running", nothing has left the building, and usually they have not even been
// screened.
//
// ⚠ THE TABLE IS MISNAMED. `submissions` stores ALL ELEVEN ATS stages, from
// Sourced to Placement — it is the candidate-on-job PIPELINE record. That is a
// storage name, not a meaning, and the name leaked into two counts that treated
// every row as a submission. Do not read the table name as the definition; read
// this file.
//
// TWO NUMBERS, DELIBERATELY (D-0029). The owner chose to publish both rather
// than pick one, and the reason is the GAP between them: candidates stalling
// between the recruiter and BD approval are invisible if only one figure is
// ever shown.
//   * toBdm    — `Submitted to BDM` onward. Recruiter output, an INTERNAL
//                handoff. Nobody outside the company has seen this person.
//   * toClient — `Submitted to Client` onward. The real submission.
//
// ⚠ KNOWN LIMIT, recorded in D-0029's "Re-open when": this keys off the stage a
// candidate is AT NOW, not every stage they ever reached. Somebody submitted to
// the client and later marked `Not Accepted` stops being counted, which
// UNDER-reports. Fixing it means reading `submission_activity`'s stage history
// or adding a `client_submitted_at` column. The bug being fixed here was two
// screens disagreeing; consistency first.

'use strict';

// Ordered, and the order is the whole mechanism — "submitted" means "at or past
// this point", so a list of names would have to be hand-maintained twice.
// `Not Accepted` and `On Hold` sit OUTSIDE the ladder because neither says how
// far the candidate got; see the known limit above.
const LADDER = [
  'Sourced',
  'Screening',
  'Submitted to BDM',
  'Submitted to Client',
  'Interview Scheduled',
  'Interview Completed',
  'Offer',
  'Joining',
  'Placement',
];
const OFF_LADDER = ['Not Accepted', 'On Hold'];

const BDM_INDEX = LADDER.indexOf('Submitted to BDM');
const CLIENT_INDEX = LADDER.indexOf('Submitted to Client');

function rank(stage) {
  const i = LADDER.indexOf(String(stage || '').trim());
  return i;                    // -1 for off-ladder or unknown
}

/** Has this candidate been handed to BD for approval (or further)? */
function isSentToBdm(stage) {
  const i = rank(stage);
  return i >= 0 && i >= BDM_INDEX;
}

/** Has this candidate actually gone to the CLIENT (or further)? */
function isSentToClient(stage) {
  const i = rank(stage);
  return i >= 0 && i >= CLIENT_INDEX;
}

/** In the running for a job, but not sent anywhere yet. */
function isInPipelineOnly(stage) {
  const i = rank(stage);
  return i >= 0 && i < BDM_INDEX;
}

/**
 * The two numbers, plus the ones that give them context.
 * `rows` are submission records; only `stage` is read.
 *
 * `stalled` is the GAP D-0029 exists to expose: handed to BD and not yet with
 * the client. A single headline figure hides exactly this.
 */
function countSubmissions(rows) {
  const out = { toBdm: 0, toClient: 0, stalled: 0, inPipeline: 0, offLadder: 0, total: 0 };
  for (const r of (rows || [])) {
    const stage = r && r.stage;
    out.total++;
    if (isSentToClient(stage)) { out.toClient++; out.toBdm++; continue; }
    if (isSentToBdm(stage)) { out.toBdm++; out.stalled++; continue; }
    if (isInPipelineOnly(stage)) { out.inPipeline++; continue; }
    out.offLadder++;
  }
  return out;
}

module.exports = {
  LADDER, OFF_LADDER,
  isSentToBdm, isSentToClient, isInPipelineOnly,
  countSubmissions, rank,
};
