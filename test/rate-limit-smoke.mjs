// Unit test for middleware/rate-limit.js — the limiter on the unauthenticated
// surface (login, the cron heartbeat, the tracking pixel).
//
// What matters here, in order:
//   1. Login actually gets bounded. Unlimited guesses against a bcrypt hash is
//      both a break-in route and a CPU-exhaustion route on a single web process.
//   2. Per-IP and per-email are SEPARATE counters — they stop different
//      attacks, and one must not mask the other.
//   3. The limiter cannot itself become the memory-exhaustion bug it exists to
//      prevent (unique-key spray must stay bounded).
//   4. Windows expire, so a locked-out human is not locked out forever.
//
// Usage: node test/rate-limit-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRateLimiter, clientIp, MAX_TRACKED_KEYS } = require('../middleware/rate-limit.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// Minimal express-ish req/res doubles.
const mkReq = (ip = '1.2.3.4', body = {}) => ({ ip, body, socket: { remoteAddress: ip } });
function mkRes() {
  const r = {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    set(k, v) { r.headers[k.toLowerCase()] = v; return r; },
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; r.ended = true; return r; },
  };
  return r;
}
// Drive the middleware synchronously and report whether next() was reached.
function hit(limiter, req) {
  const res = mkRes();
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return { passed, res };
}

// ── 1. The basic bound ───────────────────────────────────────────────────────
{
  const lim = createRateLimiter({ name: 't', windowMs: 60000, max: 3 });
  const req = mkReq('9.9.9.9');
  const verdicts = [hit(lim, req), hit(lim, req), hit(lim, req), hit(lim, req)];
  ok('requests under the limit pass through', verdicts.slice(0, 3).every(v => v.passed));
  ok('the request over the limit is blocked', !verdicts[3].passed);
  ok('a blocked request answers 429', verdicts[3].res.statusCode === 429, String(verdicts[3].res.statusCode));
  ok('a blocked request says how long to wait', Number(verdicts[3].res.headers['retry-after']) > 0, verdicts[3].res.headers['retry-after']);
  ok('the 429 body is machine-readable', verdicts[3].res.body?.error === 'rate_limited', JSON.stringify(verdicts[3].res.body));
  ok('remaining is reported while under the limit', verdicts[0].res.headers['x-ratelimit-remaining'] === '2', verdicts[0].res.headers['x-ratelimit-remaining']);
  lim.stop();
}

// ── 2. Keys are isolated ─────────────────────────────────────────────────────
{
  const lim = createRateLimiter({ name: 't', windowMs: 60000, max: 2 });
  const attacker = mkReq('6.6.6.6');
  hit(lim, attacker); hit(lim, attacker); hit(lim, attacker);
  const bystander = hit(lim, mkReq('7.7.7.7'));
  ok('one IP hitting the limit does not block a different IP', bystander.passed);
  lim.stop();
}

// ── 3. Login's two limiters stop two different attacks ───────────────────────
{
  // Per-email: a distributed guess at ONE account, from many IPs.
  const byEmail = createRateLimiter({
    name: 'login-email', windowMs: 60000, max: 3,
    keyFn: (req) => String(req.body?.email || '').toLowerCase().trim() || null,
  });
  const target = 'victim@example.com';
  const spread = [1, 2, 3, 4].map(n => hit(byEmail, mkReq(`10.0.0.${n}`, { email: target })));
  ok('per-email limiting catches one account guessed from many IPs', !spread[3].passed);
  ok('a different account is unaffected', hit(byEmail, mkReq('10.0.0.9', { email: 'someone@else.com' })).passed);
  ok('the email key is case/whitespace normalised', !hit(byEmail, mkReq('10.0.0.5', { email: '  VICTIM@Example.com ' })).passed);
  byEmail.stop();

  // Per-IP: one host spraying MANY accounts — invisible to the per-email counter.
  const byIp = createRateLimiter({ name: 'login-ip', windowMs: 60000, max: 3 });
  const sprayer = '11.11.11.11';
  const spray = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'].map(e => hit(byIp, mkReq(sprayer, { email: e })));
  ok('per-IP limiting catches one host spraying many accounts', !spray[3].passed);
  byIp.stop();
}

// ── 4. A null key means "cannot attribute" — never block ─────────────────────
{
  const lim = createRateLimiter({ name: 't', windowMs: 60000, max: 1, keyFn: () => null });
  ok('an unattributable request is not limited', [1, 2, 3].every(() => hit(lim, mkReq()).passed));
  lim.stop();
}

// ── 5. Windows expire (a human who mistyped is not locked out forever) ───────
{
  let clock = 1_000_000;
  const lim = createRateLimiter({ name: 't', windowMs: 1000, max: 2, now: () => clock });
  const key = 'someone';
  ok('two hits allowed in the window', lim.consume(key).allowed && lim.consume(key).allowed);
  ok('the third is blocked', !lim.consume(key).allowed);
  clock += 1001;
  ok('after the window elapses the counter resets', lim.consume(key).allowed);
  lim.stop();
}

// ── 6. Memory is bounded — the limiter must not become the DoS ───────────────
{
  let clock = 1_000_000;
  const lim = createRateLimiter({ name: 't', windowMs: 1000, max: 5, now: () => clock });
  for (let i = 0; i < 500; i++) lim.consume(`k${i}`);
  ok('keys are tracked while live', lim.size() === 500, String(lim.size()));
  clock += 1001;
  lim.prune(clock);
  ok('expired keys are pruned', lim.size() === 0, String(lim.size()));

  // Unique-key spray: the attack shape that would otherwise grow the map forever.
  const big = createRateLimiter({ name: 't2', windowMs: 10 * 60 * 1000, max: 5 });
  for (let i = 0; i < MAX_TRACKED_KEYS + 2000; i++) big.consume(`spray${i}`);
  ok('unique-key spray stays under the hard cap', big.size() <= MAX_TRACKED_KEYS + 1, String(big.size()));
  lim.stop(); big.stop();
}

// ── 7. The pixel path: consume() reports, caller decides ─────────────────────
{
  // routes/tracking.js uses consume() directly and, over the limit, skips the DB
  // write while STILL returning the gif — a 429 to a mail client renders a
  // broken-image box to the recipient, which is worse than an uncounted open.
  const lim = createRateLimiter({ name: 'pixel', windowMs: 60000, max: 2 });
  const key = 'pixel:1.1.1.1';
  ok('consume() reports allowed under the limit', lim.consume(key).allowed && lim.consume(key).allowed);
  const over = lim.consume(key);
  ok('consume() reports blocked over the limit', !over.allowed);
  ok('consume() returns a retry hint', over.retryAfterSec > 0, String(over.retryAfterSec));
  ok('consume() never throws — the pixel can always still be served', typeof over.allowed === 'boolean');
  lim.stop();
}

// ── 8. clientIp resolution ───────────────────────────────────────────────────
{
  ok('clientIp prefers req.ip (set by express when trust proxy is on)', clientIp({ ip: '5.5.5.5', socket: { remoteAddress: '10.0.0.1' } }) === '5.5.5.5');
  ok('clientIp falls back to the socket address', clientIp({ socket: { remoteAddress: '10.0.0.1' } }) === '10.0.0.1');
  ok('clientIp never returns undefined', clientIp({}) === 'unknown');
}

// ── 9. onLimit fires for logging ─────────────────────────────────────────────
{
  const seen = [];
  const lim = createRateLimiter({ name: 't', windowMs: 60000, max: 1, onLimit: (req, key) => seen.push(key) });
  const req = mkReq('3.3.3.3');
  hit(lim, req); hit(lim, req);
  ok('onLimit fires once the limit is crossed', seen.length === 1 && seen[0] === '3.3.3.3', JSON.stringify(seen));
  lim.stop();
}

console.log('\n=== RATE LIMIT SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
