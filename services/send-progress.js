// ============================================================================
// SEND PROGRESS — when a finished run's card stops being true.
// ----------------------------------------------------------------------------
// PURE. The "Send complete" card is a SNAPSHOT of one run, stored in
// app_settings so it survives a restart. On the free tier the server sleeps,
// so the 60s timer that was meant to clear it often never fires — the card
// then reappears hours later, and it keeps asserting totals about a queue that
// has since changed (emails deleted, a new assignment made). Two screens of
// the app then contradict each other.
//
// A FINISHED run's card has a shelf life. An ACTIVE run never expires here —
// a long send must keep its progress bar.
// ============================================================================
const DONE_TTL_MS = 15 * 60 * 1000;

function isStaleProgress(progress, now = Date.now(), ttlMs = DONE_TTL_MS) {
  if (!progress || typeof progress !== 'object') return false;
  if (progress.active) return false;
  if (!progress.done) return false;
  const at = progress.completedAt ? new Date(progress.completedAt).getTime() : NaN;
  // A finished run with no timestamp cannot be aged — treat it as stale rather
  // than letting it sit on screen forever.
  if (!Number.isFinite(at)) return true;
  return (now - at) > ttlMs;
}

// ── a run that died with its process ───────────────────────────────────────
// A send runs inside the web process. A deploy or a restart kills it mid-run and leaves its progress record
// saying `active: true` forever — and an ACTIVE record never expires above, so the card kept saying "Sending
// emails…" while nothing was sending (owner's 29-of-56 screenshot, 7 Oct 2026). `alive` is the server's own
// answer to "is a send for this person running in THIS process right now?"; when it is not, an old active
// record is turned into an honest "stopped early" one. A run younger than the grace is left alone: a run that
// is only just starting has written its record a moment before it registers itself.
const DEAD_RUN_GRACE_MS = 90 * 1000;

function reconcileProgress(progress, { alive, now = Date.now(), graceMs = DEAD_RUN_GRACE_MS } = {}) {
  if (!progress || typeof progress !== 'object' || !progress.active) return progress;
  if (alive) return progress;
  const started = progress.startedAt ? new Date(progress.startedAt).getTime() : NaN;
  if (Number.isFinite(started) && now - started <= graceMs) return progress;
  return Object.assign({}, progress, { active: false, done: true, interrupted: true, current: '', completedAt: new Date(now).toISOString() });
}

// Start a run for this person unless one is already going. The check and the registration are ONE step, so two
// clicks in the same instant cannot both start. (A function, so a test can call it — a grep cannot tell a live
// rule from a dead one.)
function tryStartRun(active, userId) {
  if (active.has(userId)) return false;
  active.add(userId);
  return true;
}

module.exports = { isStaleProgress, reconcileProgress, tryStartRun, DONE_TTL_MS, DEAD_RUN_GRACE_MS };
