// ============================================================================
// Rate limiting for the unauthenticated surface.
//
// Everything else in this app sits behind `auth`, so the abusable surface is
// small and specific:
//   POST /auth/login   — the one real target. Unlimited password guesses
//                        against a bcrypt hash is both a break-in route and a
//                        CPU exhaustion route (bcrypt is deliberately slow, so
//                        each guess costs the single web process real work).
//   GET  /o/:token.gif — the open-tracking pixel. One DB read + write per hit,
//                        callable by anyone who has ever received an email.
//   GET  /cron/tick    — key-gated, but the key check happens after the request
//                        is accepted, so unbounded probing is still free.
//
// In-memory on purpose: one web process, ₹0 budget, and no Redis. That means
// counters reset on deploy and would not be shared across instances — fine
// today, and the shape to replace (not rewrite around) if this ever runs on 2+
// servers. Memory is bounded by a sweep plus a hard cap, so the limiter can
// never itself become the memory-exhaustion bug.
//
// No new dependencies.
// ============================================================================

// A limiter that has stopped pruning is worse than no limiter, so the cap is
// enforced even if the sweep somehow falls behind.
const MAX_TRACKED_KEYS = 20000;

function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 60;
  const name = opts.name || 'rate-limit';
  const keyFn = opts.keyFn || defaultKey;
  const now = opts.now || (() => Date.now());

  const hits = new Map(); // key -> { count, resetAt }

  function prune(t = now()) {
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    // Hard backstop: if we are still over the cap after pruning we are under an
    // attack designed to spray unique keys. Drop the oldest-expiring entries —
    // losing a counter fails open for that key, which is the right trade
    // against filling the heap.
    if (hits.size > MAX_TRACKED_KEYS) {
      const sorted = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (let i = 0; i < sorted.length - MAX_TRACKED_KEYS; i++) hits.delete(sorted[i][0]);
    }
  }

  /**
   * Record a hit and report the verdict. Callers that must not 429 (the pixel)
   * use this directly and degrade instead.
   * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
   */
  function consume(key, t = now()) {
    if (hits.size > MAX_TRACKED_KEYS) prune(t);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + windowMs });
      return { allowed: true, remaining: max - 1, retryAfterSec: 0 };
    }
    entry.count++;
    const allowed = entry.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - entry.count),
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
    };
  }

  function middleware(req, res, next) {
    const key = keyFn(req);
    // A null key means "not rate-limited" (e.g. a request we can't attribute).
    if (key == null) return next();
    const verdict = consume(`${name}:${key}`);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(verdict.remaining));
    if (verdict.allowed) return next();
    res.set('Retry-After', String(verdict.retryAfterSec));
    if (opts.onLimit) opts.onLimit(req, key);
    return res.status(429).json({
      error: 'rate_limited',
      message: opts.message || 'Too many requests. Please wait a moment and try again.',
      retry_after: verdict.retryAfterSec,
    });
  }

  // Sweep so idle keys don't accumulate. unref() so it never holds a test
  // process (or a graceful shutdown) open.
  const timer = setInterval(() => prune(), Math.max(windowMs, 60000));
  timer.unref?.();

  middleware.consume = consume;
  middleware.prune = prune;
  middleware.reset = () => hits.clear();
  middleware.size = () => hits.size;
  middleware.stop = () => clearInterval(timer);
  return middleware;
}

// Express only reports the real client IP when `trust proxy` is set — see the
// note where these are mounted. Falls back to the socket address so this is
// still correct when run directly.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function defaultKey(req) {
  return clientIp(req);
}

module.exports = { createRateLimiter, clientIp, MAX_TRACKED_KEYS };
