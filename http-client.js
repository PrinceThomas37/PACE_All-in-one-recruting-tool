// ============================================================================
// Outbound HTTP client — timeouts and (where safe) retry with backoff.
//
// WHY THIS EXISTS
// Every outbound call in this app used bare `fetch`, which in Node has NO
// default timeout. A hung Microsoft Graph or Gmail call therefore hangs its
// caller forever — and those callers are the background sweeps that run in the
// single web process, so one unresponsive socket could stall an entire reply
// sweep or send loop indefinitely, with no error and no log. Timeouts are the
// fix; retries are the bonus.
//
// THE RETRY RULE (read before widening it)
// Retries default to SAFE METHODS ONLY (GET/HEAD/OPTIONS). A timeout does not
// mean the server never got the request — it means we stopped waiting. Blindly
// retrying `POST /me/sendMail` on a timeout would send the same email twice.
// So unsafe methods get the timeout but not the retry, unless the caller
// explicitly opts in with `retryUnsafe: true` (only appropriate where the
// endpoint is idempotent or the duplicate is harmless).
//
// No new dependencies — AbortController and fetch are both built into Node 18+,
// which package.json already requires.
// ============================================================================

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Transient by nature: rate limiting, and the gateway/overload family. A 500 is
// deliberately included — Graph and Gmail both return it for transient
// server-side blips — but a 4xx other than 429 is our fault and never retried.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class HttpTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`Request to ${redactUrl(url)} timed out after ${timeoutMs}ms`);
    this.name = 'HttpTimeoutError';
    this.code = 'ETIMEDOUT';
    this.timeoutMs = timeoutMs;
    this.url = redactUrl(url);
  }
}

// Several of these URLs carry an api_key / access_token in the query string.
// Anything that reaches an error message or a log line gets scrubbed first.
function redactUrl(url) {
  try {
    const u = new URL(String(url));
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|password|api_key/i.test(k)) u.searchParams.set(k, '***');
    }
    return `${u.origin}${u.pathname}${u.search}`;
  } catch (_) {
    return String(url).split('?')[0];
  }
}

function isSafeMethod(options) {
  return SAFE_METHODS.has(String(options?.method || 'GET').toUpperCase());
}

// Connection-level failures: DNS, refused, reset, socket hang-up. Node's fetch
// surfaces these as a TypeError whose `cause` holds the real errno.
function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'HttpTimeoutError') return true;
  if (err.name === 'AbortError') return true;
  const code = err.cause?.code || err.code || '';
  if (/^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT|UND_ERR_)/.test(code)) return true;
  return err instanceof TypeError && /fetch failed|network/i.test(String(err.message || ''));
}

// Honour Retry-After when the server sends one (seconds, or an HTTP date),
// since guessing a backoff against a 429 is how you get rate-limited harder.
function retryAfterMs(res) {
  const raw = res?.headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}

function backoffFor(attempt, baseMs) {
  const exponential = baseMs * Math.pow(2, attempt);
  // Full jitter. Without it, several sweeps that failed together would retry in
  // lockstep and re-create the same burst that got them throttled.
  return Math.min(MAX_BACKOFF_MS, Math.round(exponential * (0.5 + Math.random() * 0.5)));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch with a hard timeout. Rejects with HttpTimeoutError when it fires.
 *
 * A caller-supplied `options.signal` is respected and takes precedence — in
 * that case the caller owns cancellation and we don't wrap it.
 */
async function fetchWithTimeout(url, options = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs == null ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (options.signal || !timeoutMs) return fetchImpl(url, options);

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (timedOut) throw new HttpTimeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetch with a timeout, plus retry-with-backoff for transient failures.
 *
 * opts:
 *   timeoutMs    per-attempt timeout (default 20s)
 *   retries      extra attempts after the first (default 2 for safe methods)
 *   retryUnsafe  allow retrying POST/PUT/PATCH/DELETE — ONLY set this when a
 *                duplicate request is harmless (see the header note)
 *   backoffMs    base backoff (default 500ms, exponential + full jitter)
 *   onRetry      ({ attempt, delayMs, reason }) => void, for logging
 *   fetchImpl    injectable for tests
 */
async function fetchWithRetry(url, options = {}, opts = {}) {
  const allowRetry = opts.retryUnsafe || isSafeMethod(options);
  const retries = allowRetry ? (opts.retries == null ? DEFAULT_RETRIES : opts.retries) : 0;
  const backoffMs = opts.backoffMs == null ? DEFAULT_BACKOFF_MS : opts.backoffMs;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, options, opts);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isNetworkError(err)) throw err;
      const delayMs = backoffFor(attempt, backoffMs);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, reason: err.name || 'network' });
      await sleep(delayMs);
      continue;
    }

    if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
      const delayMs = retryAfterMs(res) ?? backoffFor(attempt, backoffMs);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, reason: `HTTP ${res.status}` });
      await sleep(Math.min(delayMs, MAX_BACKOFF_MS));
      continue;
    }
    return res;
  }
  throw lastErr;
}

/** fetchWithRetry + JSON parse, in the shape the existing call sites use. */
async function fetchJson(url, options = {}, opts = {}) {
  const res = await fetchWithRetry(url, options, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

module.exports = {
  fetchWithTimeout,
  fetchWithRetry,
  fetchJson,
  HttpTimeoutError,
  redactUrl,
  isNetworkError,
  // exported for tests
  _internals: { backoffFor, retryAfterMs, isSafeMethod, RETRYABLE_STATUS, DEFAULT_TIMEOUT_MS },
};
