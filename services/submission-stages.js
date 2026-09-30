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
      // 'Tagged' is not a stage inside a job (D-0057). Nothing writes it any more;
      // this only keeps OLD history rows (a promotion's old_stage) out of the clock.
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

// ── WHERE EVERYONE STARTS, AND WHO MAY MOVE THEM (R-075 / R-077, D-0057) ─────
// The owner: *"A candidate when added to job from the candidate section or
// directly gets into Sourced stage. Tagged is for the database. Inside a job
// the stage starts from Sourced."* So there is ONE entry stage, named here, and
// every way of putting a person on a job starts them at it.
const ENTRY_STAGE = LADDER[0];                 // 'Sourced'
const NOT_ACCEPTED = OFF_LADDER[0];            // 'Not Accepted' — always carries its reason
// The stage only a BD Manager may move somebody INTO (the client hand-off).
const BDM_GATED_STAGE = LADDER[CLIENT_INDEX];  // 'Submitted to Client'
const TO_BDM = LADDER[BDM_INDEX];              // 'Submitted to BDM'
// Law 3, as data: a pure recruiter moves a candidate only WITHIN these stages —
// up to and including "Submitted to BDM". BD owns everything after.
const RECRUITER_STAGES = LADDER.slice(0, BDM_INDEX + 1);

// LAW 3 IS A FUNCTION, NOT A PARAGRAPH. "Recruiters move a candidate only up to
// Submitted to BDM; BD owns every later stage" used to be an inline if-chain in
// one route handler, so the second door (a group move) would have had to copy
// it — and a copied rule drifts. This is the one definition; the single move
// and the group move both ask it, per row, and get the same answer and the same
// words.
//
// The rules are an ORDERED LIST because precedence is behaviour: when two
// apply, the user is told about the first. The order is the order the single
// move has always checked them in. `level` says what a rule needs to know:
//   'request' — only who is asking and where they want to move somebody, so a
//               group move can refuse the WHOLE request up front instead of
//               returning the same sentence two hundred times;
//   'row'     — something about this particular submission.
const MOVE_RULES = [
  { id: 'role', level: 'request', status: 403,
    test: c => !c.isBDM && !c.isRecruiter,
    say: () => 'Not permitted.' },
  { id: 'not_assigned', level: 'row', status: 403,
    test: c => c.recruiterScoped && !c.assigned,
    say: () => 'Not assigned to this job order.' },
  { id: 'recruiter_target', level: 'request', status: 403,
    test: c => c.recruiterScoped && !RECRUITER_STAGES.includes(c.to),
    say: () => 'Recruiters can move candidates up to "Submitted to BDM" — the BD team owns the stages after that.' },
  { id: 'with_bd', level: 'row', status: 403,
    test: c => c.recruiterScoped && !RECRUITER_STAGES.includes(c.from),
    say: () => 'This candidate is with the BD team now — only a BD Manager can change this stage.' },
  { id: 'details', level: 'request', status: 400,
    test: c => c.recruiterScoped && c.to === TO_BDM && !(c.details && String(c.details.comment || '').trim()),
    // A group move carries no per-person details, and the hand-off form is one
    // person at a time (the stage modal says the same), so the sentence differs.
    say: c => c.bulk
      ? 'Submit candidates to the BD Manager one at a time — each needs its own submission details.'
      : 'Submission details with a comment are required to submit to the BD Manager.' },
  // (The old fifth rule — "only a BD Manager can move somebody INTO Submitted
  // to Client" — is now carried by the two above it: a recruiter is refused by
  // `recruiter_target`, and anyone who is neither recruiter nor BD by `role`.
  // Keeping it as a separate rule would have left one that can never fire, and
  // a rule no test can make fail is decoration.)
  { id: 'reason', level: 'request', status: 400,
    test: c => c.to === NOT_ACCEPTED && !String(c.reason || '').trim(),
    say: () => 'Please add the reason.' },
  // Group move only: somebody already there is not "moved", and writing a
  // Screening → Screening row into their history (and firing an event) for each
  // of them would bury the real changes. The single move has never refused this.
  { id: 'no_change', level: 'row', status: 409,
    test: c => !!c.bulk && c.from === c.to && (c.fromSubStage || null) === (c.subStage || null),
    say: c => 'Already at "' + c.to + '".' },
];

function judge(ctx, levels) {
  const c = Object.assign({}, ctx);
  c.recruiterScoped = !!c.isRecruiter && !c.isBDM;
  for (const r of MOVE_RULES) {
    if (levels && !levels.includes(r.level)) continue;
    if (r.test(c)) return { rule: r.id, status: r.status, message: r.say(c) };
  }
  return null;
}

/**
 * May this person make this move on this submission? null = yes.
 * ctx: { isBDM, isRecruiter, assigned, from, to, fromSubStage, subStage,
 *        reason, details, bulk } — `from`/`to` already normalised, `assigned`
 * whether the submission's job order is one a recruiter is assigned to.
 */
function moveRefusal(ctx) { return judge(ctx, null); }

/** Only the rules that do not depend on the row — for refusing a whole group move. */
function requestRefusal(ctx) { return judge(ctx, ['request']); }

module.exports = {
  LADDER, OFF_LADDER, STUCK_DAYS, FINAL_STAGES,
  ENTRY_STAGE, RECRUITER_STAGES, BDM_GATED_STAGE, NOT_ACCEPTED,
  isSentToBdm, isSentToClient, isInPipelineOnly,
  countSubmissions, rank,
  furthestReached, countSubmissionsEver, timeInStage,
  moveRefusal, requestRefusal,
};
