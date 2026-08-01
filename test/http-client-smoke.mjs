// Unit test for http-client.js — the timeout + retry wrapper every outbound
// call now goes through.
//
// The two properties worth protecting, in order:
//   1. A hung call ALWAYS ends. Before this module, Node's fetch had no default
//      timeout, so one unresponsive socket could stall a background sweep
//      forever with no error and no log.
//   2. An unsafe method is NEVER retried by default. A timeout does not mean
//      the server never got the request — retrying `POST /me/sendMail` on one
//      would send the same email twice. That is the bug this test exists to
//      prevent someone reintroducing.
//
// Usage: node test/http-client-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  fetchWithTimeout, fetchWithRetry, fetchJson, HttpTimeoutError, redactUrl, isNetworkError, _internals,
} = require('../http-client.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── Fakes ────────────────────────────────────────────────────────────────────
const res = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: { get: () => null },
});
const resWithRetryAfter = (status, seconds) => ({
  ok: false, status, json: async () => ({}),
  headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? String(seconds) : null) },
});

// Records every call so we can assert on ATTEMPT COUNT, which is the whole game.
function recorder(handlers) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const n = calls.length;
    calls.push({ url, options });
    const h = Array.isArray(handlers) ? handlers[Math.min(n, handlers.length - 1)] : handlers;
    return typeof h === 'function' ? h(url, options, n) : h;
  };
  impl.calls = calls;
  return impl;
}

const netErr = (code = 'ECONNRESET') => {
  const e = new TypeError('fetch failed');
  e.cause = { code };
  return e;
};

// A fetch that never settles unless aborted — the exact shape of the hang this
// module exists to bound.
const hangs = (_url, options) => new Promise((_resolve, reject) => {
  options.signal?.addEventListener('abort', () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    reject(e);
  });
});

// Backoff is exponential with FULL JITTER, so every timing assertion below is a
// range, never an equality. Keep base backoff tiny so the suite stays fast.
const FAST = { backoffMs: 1, timeoutMs: 200 };

async function run() {
  // ── 1. Timeouts ────────────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let err;
    try {
      await fetchWithTimeout('https://example.test/hang', {}, { timeoutMs: 60, fetchImpl: hangs });
    } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    ok('a hung request rejects instead of hanging forever', err instanceof HttpTimeoutError, String(err));
    ok('the timeout error carries code ETIMEDOUT', err?.code === 'ETIMEDOUT', err?.code);
    ok('it gives up at roughly the configured budget', elapsed >= 50 && elapsed < 1500, `${elapsed}ms`);
  }
  {
    const impl = recorder(res(200, { hi: true }));
    const r = await fetchWithTimeout('https://example.test/ok', {}, { timeoutMs: 500, fetchImpl: impl });
    ok('a fast request passes straight through', r.status === 200);
    ok('the abort signal is attached to the request', !!impl.calls[0].options.signal);
  }
  {
    // A caller-supplied signal means the caller owns cancellation; we must not
    // wrap it, or we would silently override their lifetime with ours.
    const ctrl = new AbortController();
    const impl = recorder(res(200));
    await fetchWithTimeout('https://example.test/ok', { signal: ctrl.signal }, { timeoutMs: 10, fetchImpl: impl });
    ok('a caller-supplied signal is respected, not replaced', impl.calls[0].options.signal === ctrl.signal);
  }

  // ── 2. THE SAFETY RULE: unsafe methods are not retried ─────────────────────
  {
    const impl = recorder(() => { throw netErr(); });
    let err;
    try {
      await fetchWithRetry('https://graph.test/me/sendMail', { method: 'POST' }, { ...FAST, fetchImpl: impl });
    } catch (e) { err = e; }
    ok('a failed POST is attempted exactly ONCE (never double-sends)', impl.calls.length === 1, `${impl.calls.length} attempts`);
    ok('and the network error still surfaces to the caller', !!err);
  }
  {
    const impl = recorder([resWithRetryAfter(503, 0), res(200)]);
    const r = await fetchWithRetry('https://graph.test/me/sendMail', { method: 'POST' }, { ...FAST, fetchImpl: impl });
    ok('a POST that gets a 503 is NOT retried either', impl.calls.length === 1, `${impl.calls.length} attempts`);
    ok('the 503 is returned as-is for the caller to handle', r.status === 503);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const impl = recorder(() => { throw netErr(); });
    try { await fetchWithRetry('https://x.test/a', { method }, { ...FAST, fetchImpl: impl }); } catch (_) {}
    ok(`${method} is treated as unsafe and not retried`, impl.calls.length === 1, `${impl.calls.length} attempts`);
  }
  {
    // The explicit opt-in, used for token refresh (idempotent, and a transient
    // failure there takes a whole mailbox offline).
    const impl = recorder([() => { throw netErr(); }, res(200, { access_token: 'x' })]);
    const r = await fetchWithRetry('https://login.test/token', { method: 'POST' }, { ...FAST, retryUnsafe: true, fetchImpl: impl });
    ok('retryUnsafe:true lets an idempotent POST retry', impl.calls.length === 2 && r.status === 200, `${impl.calls.length} attempts`);
  }

  // ── 3. Retry behaviour on safe methods ─────────────────────────────────────
  {
    const impl = recorder([() => { throw netErr('ENOTFOUND'); }, () => { throw netErr('ECONNREFUSED'); }, res(200)]);
    const r = await fetchWithRetry('https://x.test/a', {}, { ...FAST, fetchImpl: impl });
    ok('a GET retries through transient network errors and succeeds', r.status === 200 && impl.calls.length === 3, `${impl.calls.length} attempts`);
  }
  {
    const impl = recorder(() => { throw netErr(); });
    let err;
    try { await fetchWithRetry('https://x.test/a', {}, { ...FAST, retries: 2, fetchImpl: impl }); } catch (e) { err = e; }
    ok('retries are bounded — it gives up after 1 + retries attempts', impl.calls.length === 3, `${impl.calls.length} attempts`);
    ok('and the last error is rethrown', !!err);
  }
  {
    const impl = recorder([res(500), res(502), res(200, { done: 1 })]);
    const r = await fetchWithRetry('https://x.test/a', {}, { ...FAST, fetchImpl: impl });
    ok('5xx responses are retried', r.status === 200 && impl.calls.length === 3, `${impl.calls.length} attempts`);
  }
  {
    const impl = recorder([res(429), res(200)]);
    const r = await fetchWithRetry('https://x.test/a', {}, { ...FAST, fetchImpl: impl });
    ok('429 is retried', r.status === 200 && impl.calls.length === 2);
  }
  {
    // Our fault, not theirs — retrying a 401/404 just wastes the budget and
    // delays the real error reaching the caller.
    for (const status of [400, 401, 403, 404, 422]) {
      const impl = recorder(res(status));
      const r = await fetchWithRetry('https://x.test/a', {}, { ...FAST, fetchImpl: impl });
      ok(`${status} is NOT retried (client error)`, impl.calls.length === 1 && r.status === status, `${impl.calls.length} attempts`);
    }
  }
  {
    // A per-attempt timeout that resolves on the retry — proves the timeout and
    // the retry loop compose, rather than the first timeout killing the whole call.
    let n = 0;
    const impl = async (url, options) => (n++ === 0 ? hangs(url, options) : res(200));
    const r = await fetchWithRetry('https://x.test/a', {}, { timeoutMs: 40, backoffMs: 1, fetchImpl: impl });
    ok('a timed-out GET attempt is retried and can then succeed', r.status === 200, `n=${n}`);
  }
  {
    const seen = [];
    const impl = recorder([res(503), res(503), res(200)]);
    await fetchWithRetry('https://x.test/a', {}, { ...FAST, fetchImpl: impl, onRetry: (i) => seen.push(i) });
    ok('onRetry fires once per retry with attempt + delay + reason', seen.length === 2 && seen[0].reason === 'HTTP 503' && typeof seen[0].delayMs === 'number', JSON.stringify(seen));
  }

  // ── 4. Retry-After is honoured ─────────────────────────────────────────────
  {
    const t0 = Date.now();
    const impl = recorder([resWithRetryAfter(429, 0.15), res(200)]);
    await fetchWithRetry('https://x.test/a', {}, { backoffMs: 1, timeoutMs: 500, fetchImpl: impl });
    const elapsed = Date.now() - t0;
    ok('Retry-After overrides the computed backoff', elapsed >= 120, `${elapsed}ms`);
  }
  {
    // A hostile or careless Retry-After must not park a background job for an hour.
    const t0 = Date.now();
    const impl = recorder([resWithRetryAfter(429, 99999), res(200)]);
    await fetchWithRetry('https://x.test/a', {}, { backoffMs: 1, timeoutMs: 500, fetchImpl: impl });
    ok('an absurd Retry-After is capped, not obeyed literally', Date.now() - t0 < 12000);
  }

  // ── 5. Backoff shape ───────────────────────────────────────────────────────
  {
    const { backoffFor } = _internals;
    const a0 = Array.from({ length: 40 }, () => backoffFor(0, 100));
    const a3 = Array.from({ length: 40 }, () => backoffFor(3, 100));
    ok('backoff grows with the attempt number', Math.min(...a3) > Math.max(...a0), `${Math.max(...a0)} vs ${Math.min(...a3)}`);
    ok('backoff is jittered, not fixed (avoids synchronised retry storms)', new Set(a0).size > 1);
    ok('backoff is capped', Math.max(...Array.from({ length: 40 }, () => backoffFor(20, 1000))) <= 8000);
  }

  // ── 6. Secret redaction ────────────────────────────────────────────────────
  {
    ok('api_key in a query string is redacted', redactUrl('https://api.test/v2/x?api_key=SECRET123&email=a@b.c') === 'https://api.test/v2/x?api_key=***&email=a%40b.c', redactUrl('https://api.test/v2/x?api_key=SECRET123&email=a@b.c'));
    ok('access_token is redacted', !redactUrl('https://api.test/x?access_token=abc').includes('abc'));
    ok('a malformed url degrades to its path, not a throw', redactUrl('not a url?key=abc') === 'not a url');
    let err;
    try { await fetchWithTimeout('https://api.test/x?api_key=SECRET123', {}, { timeoutMs: 20, fetchImpl: hangs }); } catch (e) { err = e; }
    ok('a timeout message never leaks the key', !String(err?.message).includes('SECRET123'), String(err?.message));
  }

  // ── 7. isNetworkError classification ───────────────────────────────────────
  {
    ok('ECONNRESET counts as a network error', isNetworkError(netErr('ECONNRESET')));
    ok('undici UND_ERR_* counts as a network error', isNetworkError(netErr('UND_ERR_SOCKET')));
    ok('a timeout counts as a network error', isNetworkError(new HttpTimeoutError('https://x.test', 1)));
    ok('an ordinary Error does not', !isNetworkError(new Error('bad json')));
    ok('null does not', !isNetworkError(null));
  }

  // ── 8. fetchJson shape ─────────────────────────────────────────────────────
  {
    const r = await fetchJson('https://x.test/a', {}, { fetchImpl: recorder(res(200, { a: 1 })) });
    ok('fetchJson returns { ok, status, data }', r.ok === true && r.status === 200 && r.data.a === 1, JSON.stringify(r));
    const bad = await fetchJson('https://x.test/a', {}, {
      fetchImpl: recorder({ ok: false, status: 500, headers: { get: () => null }, json: async () => { throw new Error('not json'); } }),
      retries: 0,
    });
    ok('unparseable JSON degrades to {} instead of throwing', bad.status === 500 && typeof bad.data === 'object', JSON.stringify(bad));
  }

  // ── 9. Defaults are actually set ───────────────────────────────────────────
  {
    ok('there is a default timeout (no call is unbounded)', _internals.DEFAULT_TIMEOUT_MS > 0 && _internals.DEFAULT_TIMEOUT_MS <= 60000, String(_internals.DEFAULT_TIMEOUT_MS));
    ok('GET is classified safe', _internals.isSafeMethod({}) && _internals.isSafeMethod({ method: 'get' }));
    ok('POST is classified unsafe', !_internals.isSafeMethod({ method: 'POST' }));
  }
}

await run();

console.log('\n=== HTTP CLIENT SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
