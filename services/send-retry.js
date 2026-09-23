// ============================================================================
// SEND RETRY — what happens to an outbound email after a send fails.
// ----------------------------------------------------------------------------
// PURE. No db, no fetch, no clock (callers pass `now`).
//
// Until Session 29 every failure branch in the send loop wrote
// status:'failed' and nothing ever read that status back. A passing hiccup —
// measured live 2026-09-23: two of one mailbox's emails failed "sign-in
// expired" while three more from the SAME mailbox sent minutes later — lost
// the email for good, and the reason died with the process.
//
// Four kinds of failure, because they want four different answers:
//   * TEMPORARY — sign-in, rate limit, provider hiccup. Goes back in the queue
//     on a backoff: retried after 15 min, then 1 h, then 4 h — the first send
//     plus three retries (MAX_ATTEMPTS = 4), then it stops and says so.
//   * PERMANENT — a fact about the RECIPIENT: bad address, opted out,
//     undeliverable. Retrying changes nothing, re-sending to a known-bad
//     address costs the domain's reputation, and re-sending to an opt-out is
//     the one rule here that is a legal one. Never offered a retry button.
//   * NEEDS FIX — a fact about OUR SETUP: no sending mailbox on the lead, an
//     unlicensed or restricted mailbox. Waiting will not fix it, so it is not
//     retried automatically — but a person can fix it and press Retry.
//   * UNCERTAIN — a timeout or a dropped connection DURING the send. The
//     provider may have accepted it, so an automatic retry could email a
//     prospect twice. Never retried automatically; a person may retry after
//     checking the Sent folder, and the reason says exactly that.
// ============================================================================

const MAX_ATTEMPTS = 4;                       // total sends: the first + 3 retries
const BACKOFF_MINUTES = [15, 60, 240];         // wait after attempt 1, 2, 3

const KIND = { TEMPORARY: 'temporary', PERMANENT: 'permanent', NEEDS_FIX: 'needs_fix', UNCERTAIN: 'uncertain' };

function low(msg) { return String(msg || '').toLowerCase(); }

// A sign-in failure is its own question: it is temporary for the EMAIL, but it
// says the MAILBOX cannot send right now, so the loop stops using that mailbox
// for the rest of the run instead of failing one email every ~90 seconds.
function isAuthFailure(msg) {
  const m = low(msg);
  return m.includes('no microsoft token') || m.includes('please reconnect') ||
    m.includes('token refresh failed') || m.includes('invalidauthenticationtoken') ||
    m.includes('invalid_grant') || m.includes('sign-in expired') ||
    m.includes('unauthorized') || /\b401\b/.test(m) ||
    m.includes('no gmail token') || m.includes('gmail not connected');
}

function classifyFailure(msg) {
  const m = low(msg);
  if (!m) return KIND.TEMPORARY;
  // Checked FIRST: these are facts about the recipient or the setup, and no
  // amount of waiting changes them.
  if (m.includes('suppression') || m.includes('opted out') || m.includes('opt-out')) return KIND.PERMANENT;
  if (m.includes('invalid recipient') || m.includes('not an email')) return KIND.PERMANENT;
  if (m.includes('recipient') && (m.includes('invalid') || m.includes('reject'))) return KIND.PERMANENT;
  if (m.includes('undeliverable') || m.includes('deactivated')) return KIND.PERMANENT;
  if (m.includes('no sending email configured') || m.includes('not configured on the server')) return KIND.NEEDS_FIX;
  if (m.includes('inactivemailbox') || m.includes('mailboxnotenabledforrestapi') || m.includes('inactive or unlicensed')) return KIND.NEEDS_FIX;
  if (m.includes('restricted') && m.includes('mailbox')) return KIND.NEEDS_FIX;
  // A request that died mid-flight may have been delivered.
  if (m.includes('timeout') || m.includes('timed out') || m.includes('aborted') ||
      m.includes('econnreset') || m.includes('socket hang up') || m.includes('fetch failed') ||
      m.includes('network')) return KIND.UNCERTAIN;
  // Everything else — sign-in, throttling, Outlook's store/sync errors, a 5xx —
  // is the kind of thing that is gone an hour later.
  return KIND.TEMPORARY;
}

// When the next automatic attempt should happen, or null when it should not.
// `attemptsSoFar` counts sends already tried, including the one that failed.
function nextAttemptAt(attemptsSoFar, kind, now = Date.now()) {
  if (kind !== KIND.TEMPORARY) return null;
  const n = Math.max(1, Number(attemptsSoFar) || 1);
  if (n >= MAX_ATTEMPTS) return null;
  const mins = BACKOFF_MINUTES[Math.min(n - 1, BACKOFF_MINUTES.length - 1)];
  return new Date(now + mins * 60 * 1000).toISOString();
}

// The one decision the send loop makes after a failure: the row update to
// write. Everything the Email page shows about a failure comes from these
// four columns, so no screen has to re-derive it.
function failureUpdate(email, rawMsg, reason, now = Date.now()) {
  const attempts = (Number(email && email.attempt_count) || 0) + 1;
  const kind = classifyFailure(rawMsg);
  const next = nextAttemptAt(attempts, kind, now);
  return {
    status: next ? 'pending' : 'failed',
    attempt_count: attempts,
    next_attempt_at: next,
    fail_kind: kind,
    fail_reason: String(reason || rawMsg || 'Send failed').slice(0, 500),
  };
}

// Can a PERSON retry this row? Any failed row except one that failed on a
// fact about the recipient. Permanent is refused — "Retry" next to an opted-out recipient would
// be an invitation to break the one rule that is a legal one.
function canRetryByHand(email) {
  if (!email || email.status !== 'failed') return false;
  return email.fail_kind !== KIND.PERMANENT;
}

// The update a manual retry writes. A person's retry is a fresh start: the
// automatic ladder gets its full three retries again, and it is due now.
function manualRetryUpdate() {
  return { status: 'pending', attempt_count: 0, next_attempt_at: null, fail_kind: null, fail_reason: null };
}

// Would retrying this row email somebody twice? A failed cold email's lead may
// have been re-generated since (failed rows never block regeneration — see
// services/outreach-cycle.js), so its twin may already be queued or sent.
// `siblings` = other rows for the same contact. Same job, same step, alive.
const LIVE = new Set(['pending', 'sending', 'sent']);
function hasLiveTwin(email, siblings) {
  if (!email) return false;
  const step = email.followup_type || 'initial';
  return (siblings || []).some(r => r && r.id !== email.id &&
    r.contact_id === email.contact_id && r.job_id === email.job_id &&
    (r.followup_type || 'initial') === step && LIVE.has(r.status));
}

// Is a pending row due? A row with no next_attempt_at has never failed.
function isDue(email, now = Date.now()) {
  if (!email || !email.next_attempt_at) return true;
  const t = new Date(email.next_attempt_at).getTime();
  return !Number.isFinite(t) || t <= now;
}

// One sentence for the Email page. Never the provider's raw jargon.
function describeRetry(email, now = Date.now()) {
  if (!email) return '';
  const n = Number(email.attempt_count) || 0;
  if (email.status === 'pending' && email.next_attempt_at && n > 0) {
    const mins = Math.max(0, Math.round((new Date(email.next_attempt_at).getTime() - now) / 60000));
    const when = mins <= 0 ? 'on the next run' : mins < 60 ? `in ${mins} min` : `in about ${Math.round(mins / 60)} h`;
    return `Retry ${n} of ${MAX_ATTEMPTS - 1} ${when}`;
  }
  if (email.status === 'failed') {
    if (email.fail_kind === KIND.PERMANENT) return 'Will not be retried — the address cannot receive this email';
    if (email.fail_kind === KIND.NEEDS_FIX) return 'Fix the setting named above, then press Retry';
    if (email.fail_kind === KIND.UNCERTAIN) return 'Not retried automatically — it may have gone out. Check Sent before retrying';
    if (n >= MAX_ATTEMPTS) return `Gave up after ${n - 1} retries`;
  }
  return '';
}

module.exports = {
  MAX_ATTEMPTS, BACKOFF_MINUTES, KIND,
  isAuthFailure, classifyFailure, nextAttemptAt, failureUpdate,
  canRetryByHand, manualRetryUpdate, hasLiveTwin, isDue, describeRetry,
};
