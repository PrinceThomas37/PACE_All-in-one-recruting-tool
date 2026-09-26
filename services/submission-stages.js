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
// (Was a KNOWN LIMIT, D-0029: counting by the stage a candidate is at NOW
// dropped anyone submitted and later marked `Not Accepted`. CLOSED in Session
// 32 (R-002): `countSubmissionsEver` / `furthestReached` below count from
// `submission_activity`'s stage history, and every screen that counts a
// submission — dashboard tiles, hot jobs, the report — uses them.
// `countSubmissions` remains for callers with no history to hand.)

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

// ── FROM HISTORY, NOT FROM "NOW" (R-002, Session 32) ────────────────────────
// The known limit above is closed here: `submission_activity` records every
// stage change (old_stage → new_stage), so how far a candidate GOT is the
// furthest ladder stage they were ever at — current stage or any recorded one.
// Somebody submitted to the client and later marked `Not Accepted` is still a
// client submission; they did leave the building.
//
// `stalled` stays keyed to the CURRENT stage on purpose: "handed to BD and
// not yet with the client" is a statement about now. A candidate BD rejected
// is not stalled — they are finished.

/** The furthest ladder stage in `stages` (current + history), or null. */
function furthestReached(stages) {
  let best = -1;
  (stages || []).forEach(s => { const i = rank(s); if (i > best) best = i; });
  return best >= 0 ? LADDER[best] : null;
}

/**
 * The two numbers, counted from what each candidate REACHED.
 * rows: [{ stage, history: [stage, …] }] — history from submission_activity.
 */
function countSubmissionsEver(rows) {
  const out = { toBdm: 0, toClient: 0, stalled: 0, inPipeline: 0, offLadder: 0, total: 0, recovered: 0 };
  for (const r of (rows || [])) {
    out.total++;
    const now = r && r.stage;
    const reached = furthestReached([now].concat((r && r.history) || []));
    if (isSentToClient(reached)) {
      out.toClient++; out.toBdm++;
      if (!isSentToClient(now)) out.recovered++;   // would have been lost by the old count
    } else if (isSentToBdm(reached)) {
      out.toBdm++;
      if (!isSentToBdm(now)) out.recovered++;
    } else if (isInPipelineOnly(reached)) out.inPipeline++;
    else out.offLadder++;
    if (isSentToBdm(now) && !isSentToClient(now)) out.stalled++;
  }
  return out;
}

// ── TIME IN STAGE (R-001, Session 32) ───────────────────────────────────────
// How long candidates sit at each stage, across the desk, and which stages
// go stale. A stage STARTS when a change moves someone into it and ENDS at
// the next change for that submission; the stage they are in now is still
// running, measured to `now`. Built only from recorded changes — a row with
// no history contributes its current stage from `stage_updated_at`.
const STUCK_DAYS = 14;
// Finished, not waiting: nobody is "stuck" at a placement or a rejection.
const FINAL_STAGES = ['Placement', 'Not Accepted'];
const DAY = 86400000;

function median(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * subs: [{ id, stage, stage_updated_at, created_at,
 *          events: [{ new_stage, created_at }] }]   (any order)
 * normalize: the stage vocabulary's own normaliser (legacy names → current).
 */
function timeInStage(subs, { now = Date.now(), normalize = (s) => s, stuckDays = STUCK_DAYS } = {}) {
  const per = {};
  const bucket = (st) => (per[st] = per[st] || { stage: st, done: [], current: [] });
  (subs || []).forEach(s => {
    const evs = ((s && s.events) || [])
      .filter(e => e && e.new_stage && Number.isFinite(new Date(e.created_at).getTime()))
      .map(e => ({ st: normalize(e.new_stage), t: new Date(e.created_at).getTime() }))
      .filter(e => e.st && e.st !== 'Tagged')
      .sort((a, b) => a.t - b.t);
    for (let i = 0; i < evs.length - 1; i++) {
      const d = (evs[i + 1].t - evs[i].t) / DAY;
      if (d >= 0) bucket(evs[i].st).done.push(d);
    }
    const cur = normalize(s && s.stage);
    if (!cur) return;
    const last = evs.length && evs[evs.length - 1].st === cur ? evs[evs.length - 1].t
      : new Date((s && (s.stage_updated_at || s.created_at)) || now).getTime();
    const d = (now - last) / DAY;
    if (Number.isFinite(d) && d >= 0) bucket(cur).current.push(d);
  });
  const order = LADDER.concat(OFF_LADDER);
  return Object.values(per).map(b => ({
    stage: b.stage,
    now_there: b.current.length,
    typical_days: median(b.done.length ? b.done : b.current) == null ? null : Math.round(median(b.done.length ? b.done : b.current) * 10) / 10,
    typical_from: b.done.length ? 'finished' : 'still_there',
    samples: b.done.length,
    final: FINAL_STAGES.includes(b.stage),
    stuck: FINAL_STAGES.includes(b.stage) ? 0 : b.current.filter(d => d >= stuckDays).length,
    oldest_days: b.current.length ? Math.floor(Math.max.apply(null, b.current)) : null,
  })).sort((a, b) => {
    const ia = order.indexOf(a.stage), ib = order.indexOf(b.stage);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

module.exports = {
  LADDER, OFF_LADDER, STUCK_DAYS, FINAL_STAGES,
  isSentToBdm, isSentToClient, isInPipelineOnly,
  countSubmissions, rank,
  furthestReached, countSubmissionsEver, timeInStage,
};
