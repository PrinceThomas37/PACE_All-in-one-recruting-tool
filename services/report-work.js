// ============================================================================
// REPORT WORK — what the team DID, counted by the day it happened.
// PURE. No db, no clock of its own (`now` is passed in), so every sentence
// below can be tested with fixed inputs.
//
// Why this exists (Session 40, D-0077). The owner, looking at the Reports on
// Today: *"Submission means a real submission to a manager or client, being
// added to the system or a job is not submission, thus this data is wrong"* and
// *"datasets being added to the system do not need to be evaluated, only the
// work that's being done by the team needs to be evaluated"*.
//
// They were right, and D-0029 had only half-fixed it: the headline totals were
// corrected, but the 8-week chart, the per-person "Total" and "Fill %", the
// funnel's Sourced/Screening bars and "Candidates added" still counted every
// candidate put on a job. This is the ONE definition now:
//
//   * WORK is a candidate REACHING a stage: sent to the manager (BDM), sent to
//     the client, an interview scheduled, a placement — each on the DAY it was
//     first reached (from the recorded stage changes), not the day the row was
//     created. Reaching a later stage counts the earlier ones too: a candidate
//     who went straight to an interview was, on that day, also sent on.
//   * Sourced and Screening are inventory, never work: nothing here counts them.
//   * Not Accepted and On Hold are where work ENDED or PAUSED, shown as such
//     (the day they were last moved there), never as progress.
//   * The same function answers "how many?" and "which ones?" — `members()` is
//     the list and its length is the count, so a number on screen and the list
//     behind it cannot disagree.
// ============================================================================
'use strict';

const subStages = require('./submission-stages');

const { LADDER, rank } = subStages;
const BDM = 'Submitted to BDM';
const CLIENT = 'Submitted to Client';
const INTERVIEW = 'Interview Scheduled';
const PLACED = 'Placement';
// The stages that are WORK: from "sent to the manager" onward.
const WORK_STAGES = LADDER.slice(LADDER.indexOf(BDM));
// Where work ended or paused — reported separately, never as progress.
const PARKED_STAGES = ['Not Accepted', 'On Hold'];
const DAY = 86400000;

const ms = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };

/**
 * One submission row → when it reached each work stage.
 *   sub:    { id, stage, created_at, submitted_at, stage_updated_at, recruiter_id, job_order_id }
 *   events: [{ new_stage, created_at }]   (submission_activity, any order)
 * A stage's time is the FIRST recorded move into it or beyond it. A row whose
 * history never recorded the move (older rows) falls back to when it last
 * moved — better a close date than a candidate who vanished from the count.
 */
function reachTimes(sub, events, normalize = (s) => s) {
  const evs = (events || [])
    .map(e => ({ st: normalize(e && e.new_stage), t: ms(e && e.created_at) }))
    .filter(e => e.st && e.t != null)
    .sort((a, b) => a.t - b.t);
  const now = normalize(sub && sub.stage);
  const cur = rank(now);
  const fallback = ms(sub && (sub.stage_updated_at || sub.submitted_at || sub.created_at));
  const reached = {};
  for (const stage of WORK_STAGES) {
    const i = rank(stage);
    const hit = evs.find(e => rank(e.st) >= i);
    if (hit) reached[stage] = hit.t;
    else if (cur >= i && fallback != null) reached[stage] = fallback;
  }
  // When they entered the stage they are in NOW (the clock for "stuck").
  const lastIn = evs.filter(e => e.st === now).pop();
  const since = lastIn ? lastIn.t : fallback;
  // Parked: only if the candidate is parked NOW, dated by the move that parked them.
  let parked = null;
  if (PARKED_STAGES.includes(now)) {
    const last = evs.filter(e => e.st === now).pop();
    const at = last ? last.t : fallback;
    if (at != null) parked = { stage: now, at };
  }
  return {
    id: sub.id, recruiter_id: sub.recruiter_id || null, job_order_id: sub.job_order_id || null,
    stage: now, created_at: ms(sub.created_at), reached, parked, since,
  };
}

function inWindow(t, win) {
  if (t == null) return false;
  if (win && win.from != null && t < win.from) return false;
  if (win && win.to != null && t > win.to) return false;
  return true;
}

// The moment a row counts for a metric, or null when it does not.
//   to_bdm | to_client | interviews | placements   — the four headline numbers
//   reached:<Stage>                                — a funnel bar
//   parked:<Not Accepted|On Hold>                  — where work ended / paused
//   stalled                                        — at BDM NOW, not yet sent on (a "now", ignores the window)
//   now:<Stage> | stuck:<Stage>                    — sitting at a stage NOW / for STUCK_DAYS+ (ignore the window)
const isNowMetric = (m) => m === 'stalled' || String(m).startsWith('now:') || String(m).startsWith('stuck:');
function timeFor(row, metric, now = Date.now()) {
  switch (metric) {
    case 'to_bdm': return row.reached[BDM] ?? null;
    case 'to_client': return row.reached[CLIENT] ?? null;
    case 'interviews': return row.reached[INTERVIEW] ?? null;
    case 'placements': return row.reached[PLACED] ?? null;
    case 'stalled': return row.stage === BDM ? (row.reached[BDM] ?? 0) : null;
    default: break;
  }
  if (String(metric).startsWith('now:')) return row.stage === metric.slice(4) ? (row.since ?? 0) : null;
  if (String(metric).startsWith('stuck:')) {
    const st = metric.slice(6);
    if (row.stage !== st || subStages.FINAL_STAGES.includes(st) || row.since == null) return null;
    return (now - row.since) / DAY >= subStages.STUCK_DAYS ? row.since : null;
  }
  if (String(metric).startsWith('reached:')) return row.reached[metric.slice(8)] ?? null;
  if (String(metric).startsWith('parked:')) return row.parked && row.parked.stage === metric.slice(7) ? row.parked.at : null;
  return null;
}

/** The rows behind a number — and the number is their count. */
function members(rows, metric, win, now = Date.now()) {
  const out = [];
  for (const r of rows || []) {
    const t = timeFor(r, metric, now);
    if (t == null) continue;
    if (!isNowMetric(metric) && !inWindow(t, win)) continue;
    out.push({ row: r, at: t });
  }
  return out;
}
const count = (rows, metric, win, now) => members(rows, metric, win, now).length;

/**
 * The eight-week trend: sent to the manager and sent to the client, per week.
 * Weeks are rolling seven-day blocks ending now ("This wk" = the last 7 days).
 * Not tied to the period filter — it is the shape of recent weeks, and the
 * person/role filter still applies (the caller narrows the rows first).
 */
function weeklyTrend(rows, now, weeks = 8) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ week: i === 0 ? 'This wk' : (i + 'w ago'), ago: i, to_bdm: 0, to_client: 0 });
  for (const r of rows || []) {
    for (const [key, stage] of [['to_bdm', BDM], ['to_client', CLIENT]]) {
      const t = r.reached[stage];
      if (t == null) continue;
      const ago = Math.floor((now - t) / (7 * DAY));
      if (ago >= 0 && ago < weeks) out[weeks - 1 - ago][key]++;
    }
  }
  return out;
}
/** Which rows sit in week `ago` for 'to_bdm' | 'to_client' (the trend's drill-down). */
function weekMembers(rows, kind, ago, now) {
  const stage = kind === 'to_client' ? CLIENT : BDM;
  const out = [];
  for (const r of rows || []) {
    const t = r.reached[stage];
    if (t == null) continue;
    if (Math.floor((now - t) / (7 * DAY)) === ago && now - t >= 0) out.push({ row: r, at: t });
  }
  return out;
}

module.exports = {
  WORK_STAGES, PARKED_STAGES, BDM, CLIENT, INTERVIEW, PLACED,
  reachTimes, timeFor, members, count, weeklyTrend, weekMembers, inWindow, isNowMetric,
};
