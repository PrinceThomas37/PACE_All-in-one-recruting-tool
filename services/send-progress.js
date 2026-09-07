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

module.exports = { isStaleProgress, DONE_TTL_MS };
