// ============================================================================
// VIEW HORIZON — every list has a horizon and an exit.
// ----------------------------------------------------------------------------
// PURE. No db, no fetch, no clock of its own — `now` is always injected,
// because every function here makes a claim about elapsed time and a test that
// cannot control the clock cannot pin one.
//
// Why this module exists (Session 23). Screens were built to look right with
// the data that existed the day they were written. Two were confirmed broken by
// age, not by bugs:
//
//   * the "Connected leads — tick to convert" picker renders EVERY lead ever
//     marked Connected, with no date bound and no cap, and the ones already
//     converted never leave — 19 chips today, ~400 in two years, stacked above
//     the table they exist to help you use;
//   * "Needs you today" listed a lead last contacted 91 days ago, and only
//     reminders had a Done button, so three of the four action kinds could not
//     be dismissed AT ALL.
//
// The owner reported the second as "the cache or the memory does not get
// cleared after an activity is finished". Nothing was stuck in memory. Finished
// work simply had no exit from the screen. That is the distinction this module
// encodes:
//
//   A HORIZON is how far back a list looks by default.
//   An EXIT   is how a finished item leaves it.
//
// A list with neither works for a year and then breaks — on a customer's
// account rather than ours, because a buyer's evaluation account is empty and
// their third year is what decides renewal.
// ============================================================================

// 90 days: long enough that nothing a person is actively working falls off,
// short enough that a list stays a list. Callers may widen it; the DEFAULT is
// what an unconfigured screen gets, and it is deliberately not Infinity.
const DEFAULT_HORIZON_DAYS = 90;

// Past this many items a picker stops being a picker. Ticking one of 15 chips
// is pleasant; ticking one of 400 is worse than typing. The interaction has to
// change SHAPE at some point, not just get taller — this is where.
const PICKER_CAP = 15;

// How many recent items still show as chips once a picker has gone to search.
const PICKER_RECENT = 6;

// Terminal states, per vocabulary. A record in one of these is finished: it is
// excluded from WORKING views by default and always reachable in one click.
// Excluded, never deleted — being finished is not a reason to lose a record.
const CLOSED_LEAD_STAGES = ['Converted', 'Dead', 'Not Interested', 'Lost'];
const CLOSED_ATS_STAGES = ['Placement', 'Not Accepted'];

const MS_DAY = 24 * 60 * 60 * 1000;

// Days between a timestamp and `now`, or null when there is no usable date.
// Null is never treated as "recent" by withinHorizon — a row with no date
// cannot be claimed to be inside a window.
function ageInDays(when, now = Date.now()) {
  if (when === null || when === undefined || when === '') return null;
  const t = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(t)) return null;
  const n = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(n)) return null;
  return (n - t) / MS_DAY;
}

// Is this row inside the window? `days` of 0 or a non-finite value means NO
// horizon (show everything) — that is the explicit "show all" case, and it is
// the caller's choice to make, never the default.
function withinHorizon(when, days = DEFAULT_HORIZON_DAYS, now = Date.now()) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return true;
  const age = ageInDays(when, now);
  if (age === null) return false;
  // A future-dated row (a scheduled send) is inside every window.
  return age <= d;
}

function isClosedLeadStage(stage) {
  return CLOSED_LEAD_STAGES.includes(String(stage || ''));
}

function isClosedAtsStage(stage) {
  return CLOSED_ATS_STAGES.includes(String(stage || ''));
}

// Split a collection into what a working view shows and what it summarises.
// Returns BOTH halves plus the counts, because item 6 of the plan — "counts
// before lists" — needs the number of things it is not drawing. A view that
// silently drops rows and cannot say how many is worse than one that draws
// them all.
//
// `dateOf` and `closedOf` are accessors so this works for leads, candidates,
// emails and submissions without knowing any of their shapes.
function partitionForView(rows, opts = {}) {
  const {
    horizonDays = DEFAULT_HORIZON_DAYS,
    now = Date.now(),
    dateOf = (r) => r && (r.created_at || r.sent_at || r.updated_at),
    closedOf = () => false,
    showClosed = false,
    showAll = false,
  } = opts;

  const all = Array.isArray(rows) ? rows : [];
  const days = showAll ? 0 : horizonDays;

  let closed = 0;
  let aged = 0;
  const visible = [];

  for (const r of all) {
    if (!showClosed && closedOf(r)) { closed++; continue; }
    if (!withinHorizon(dateOf(r), days, now)) { aged++; continue; }
    visible.push(r);
  }

  return {
    visible,
    counts: {
      total: all.length,
      matching: visible.length,   // passed the horizon; a pager may show fewer
      showing: visible.length,    // kept as an alias for existing callers
      closed,          // finished, took its exit
      aged,            // real and open, just older than the horizon
      hidden: closed + aged,
    },
  };
}

// One plain sentence for the horizon bar. Says what is NOT on screen and why,
// because a filtered list that does not admit it is filtered is a lie the user
// cannot see. Returns null when nothing is hidden — no bar, no noise.
function describeHidden(counts, horizonDays = DEFAULT_HORIZON_DAYS) {
  if (!counts || !counts.hidden) return null;
  const bits = [];
  if (counts.aged) bits.push(`${counts.aged} older than ${horizonDays} days`);
  if (counts.closed) bits.push(`${counts.closed} finished`);
  // "matching", not "showing" — a caller may paginate what passed the horizon,
  // and two controls disagreeing about the same count is its own bug.
  return `${counts.matching} of ${counts.total} — ${bits.join(', ')} hidden.`;
}

// How a picker should present itself for this many options. The SHAPE, decided
// in one place, so no screen has to re-derive it and disagree.
function pickerMode(count, cap = PICKER_CAP) {
  return (Number(count) || 0) > cap ? 'search' : 'chips';
}

module.exports = {
  DEFAULT_HORIZON_DAYS,
  PICKER_CAP,
  PICKER_RECENT,
  CLOSED_LEAD_STAGES,
  CLOSED_ATS_STAGES,
  ageInDays,
  withinHorizon,
  isClosedLeadStage,
  isClosedAtsStage,
  partitionForView,
  describeHidden,
  pickerMode,
};
