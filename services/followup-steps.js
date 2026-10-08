// ============================================================================
// UP TO FIVE FOLLOW-UPS, THE PERSON'S CHOICE (owner, 8 Oct: "it's the user's choice to select the number of follow-ups, if any needed").
// The Outreach Plan used to be exactly three emails: Outreach 1, Follow-up 1, Follow-up 2. Now a person says how many follow-ups they want
// (0 to 5) and when each goes out. Nothing changes for anyone who never touches it: the default stays TWO follow-ups on day 3 and day 7.
//
//   * `u_<id>_fu_count`   how many follow-ups (0–5); missing or odd → 2, as it has always been
//   * `u_<id>_fu<N>_day`  days after the FIRST email was sent (defaults 3, 7, 14, 21, 28)
//   * `follow_ups` row    followup<N>_due_date / followup<N>_sent_at for N = 1…5 (migration 062 added 3–5)
// A follow-up N is due when the one before it has gone out (follow-up 1: the first email has), it has not gone out itself, and its due date
// has come. A follow-up with no due date was never scheduled for that person — the row finishes after the last one that was.
// PURE: no database, no clock.
// ============================================================================
'use strict';

const MAX = 5;
const STEPS = ['fu1', 'fu2', 'fu3', 'fu4', 'fu5'];
const DEFAULT_DAYS = [3, 7, 14, 21, 28];
const DEFAULT_COUNT = 2;

const isFollowupType = (t) => STEPS.includes(t);
const stepNumber = (t) => STEPS.indexOf(t) + 1;                  // 0 when it is not a follow-up
const typeOf = (n) => STEPS[n - 1] || null;
const prevType = (t) => { const n = stepNumber(t); return n > 1 ? STEPS[n - 2] : null; };
const dueCol = (n) => `followup${n}_due_date`;
const sentCol = (n) => `followup${n}_sent_at`;

const wholeNumber = (v, lo, hi) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };   // an EMPTY value is "not chosen", never 0

/** How many follow-ups this person wants (0–5). Anything missing or odd is the old two. */
function countFor(settings, userId) {
  const n = wholeNumber(settings && settings[`u_${userId}_fu_count`], 0, MAX);
  return n === null ? DEFAULT_COUNT : n;
}

/** Days after the first email for follow-up N (1–90), or its default. */
function dayFor(settings, userId, n) {
  const d = wholeNumber(settings && settings[`u_${userId}_fu${n}_day`], 1, 90);
  return d === null ? DEFAULT_DAYS[n - 1] : d;
}

/** 'YYYY-MM-DD' for `anchor` plus `days` (UTC date arithmetic, the same the assignment code has always used). */
function dateAfter(anchor, days) { const d = new Date(anchor); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; }

/** The follow_ups columns a new row gets: the due date of each follow-up this person chose, null for the rest. */
function dueDates(settings, userId, anchor) {
  const out = {};
  const count = countFor(settings, userId);
  for (let n = 1; n <= MAX; n++) out[dueCol(n)] = n <= count ? dateAfter(anchor, dayFor(settings, userId, n)) : null;
  return out;
}

/** Which follow-up of this row is due today — the NEXT one only — or 0. */
function nextDue(row, today) {
  if (!row) return 0;
  for (let n = 1; n <= MAX; n++) {
    if (row[sentCol(n)]) continue;
    if (n > 1 && !row[sentCol(n - 1)]) return 0;               // the one before has not gone out
    return row[dueCol(n)] && String(row[dueCol(n)]) <= String(today) ? n : 0;
  }
  return 0;
}

/** Is follow-up N the last one scheduled for this row (no later due date)? Then sending it finishes the row. */
function isLast(row, n) {
  for (let m = n + 1; m <= MAX; m++) if (row && row[dueCol(m)]) return false;
  return true;
}

module.exports = { MAX, STEPS, DEFAULT_DAYS, DEFAULT_COUNT, isFollowupType, stepNumber, typeOf, prevType, dueCol, sentCol, countFor, dayFor, dateAfter, dueDates, nextDue, isLast };
