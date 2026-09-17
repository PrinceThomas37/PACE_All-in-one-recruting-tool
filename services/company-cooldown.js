// ============================================================================
// THE COMPANY RE-ADD COOLDOWN — one definition, used everywhere.
//
// The rule: once a company has a lead on it, nobody adds that company again
// for `company_cooldown_days` (admin-editable, default 21). It exists so two
// people do not approach the same client a week apart.
//
// It was written THREE times, and the three did not agree:
//   1. `routes/jobs.js` POST /jobs — server-side, reads the real setting, but
//      gated on `hasRole(req,'ra')` so a BD was never checked at all.
//   2. `routes/jobs.js` GET — filters the RA's company list by the same idea.
//   3. `public/js/15-ra-entry-form.js` — HARD-CODES 21 and scans `STATE.jobs`,
//      the leads this user's own /jobs call returned. Both are wrong in a way
//      that shows: set the admin number to 30 and the form happily offers a
//      company on day 25 that the server then refuses. That is the failure
//      CLAUDE.md names — a rule that decides whether an action is ALLOWED
//      belongs where the action is OFFERED, not only where it is taken.
//
// The owner extended the rule to BD job-order creation (Session 26), which
// makes a shared definition necessary rather than merely tidy: a fourth
// hand-written copy on the most important create path in the app is how the
// three above came to disagree in the first place.
//
// PURE — no db, no clock, no request. The caller supplies `now`, because every
// sentence this produces is a claim about elapsed time and a test must be able
// to say what day it is.
// ============================================================================

const DAY_MS = 86400000;

// Is this company inside its cooldown? Returns null when it is free.
//   lastLeadAt — when the most recent lead on this company was created
//   now        — the caller's clock
//   days       — the org's configured cooldown, from settings
function cooldownState({ lastLeadAt, now, days }) {
  const window = Number(days);
  // A cooldown of 0 is a real setting and means "no cooldown", not "default".
  // Collapsing those two is the same mistake as the AI cap's blank-vs-zero.
  if (!Number.isFinite(window) || window <= 0) return null;
  if (!lastLeadAt) return null;
  const then = new Date(lastLeadAt).getTime();
  const at = new Date(now).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(at)) return null;
  const daysAgo = Math.floor((at - then) / DAY_MS);
  if (daysAgo < 0) return null;               // a future timestamp is bad data, not a block
  if (daysAgo >= window) return null;
  return { daysAgo, daysLeft: window - daysAgo, days: window };
}

// The sentence a person reads. It names WHO and WHEN, because the owner chose
// a hard block (Session 26) — and a wall that does not say who to go and talk
// to leaves them with nowhere to go. `closeRefusal()` in services/ownership.js
// is the same idea: a refusal names what you CAN do instead.
function cooldownSentence(state, { company, position, addedBy } = {}) {
  if (!state) return '';
  const who = addedBy ? ` by ${addedBy}` : '';
  const what = position ? ` (${position})` : '';
  const name = company || 'This company';
  const left = state.daysLeft === 1 ? '1 more day' : `${state.daysLeft} more days`;
  const ago = state.daysAgo === 0 ? 'today' : state.daysAgo === 1 ? 'yesterday'
    : `${state.daysAgo} days ago`;
  return `${name} was added ${ago}${who}${what}. `
    + `The ${state.days}-day company cooldown has ${left} to run — speak to `
    + `${addedBy || 'whoever added it'} before adding it again.`;
}

module.exports = { cooldownState, cooldownSentence, DAY_MS };
