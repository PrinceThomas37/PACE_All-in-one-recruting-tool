// R-373a + R-371a — the database health path and the two always-on security headers.
//   * services/deep-health.js (pure): a read that works, fails, throws text, or hangs — and no error text ever comes back.
//   * the REAL index.js, booted with a database that is not there (so the failure path is real): /health stays "ok" and cheap, /health/deep says 503
//     with ok:false and nothing else a stranger could use, and every kind of response — API, static page, script — carries nosniff + a referrer policy.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check } = require(ROOT + '/services/deep-health.js');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// ── the pure part ───────────────────────────────────────────────────────────
const good = await check({ ping: async () => {} });
ok('a read that works → ok, with a time', good.ok === true && good.db.ok === true && typeof good.db.ms === 'number', JSON.stringify(good));
const bad = await check({ ping: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 secret-table'); } });
ok('a read that fails → not ok', bad.ok === false && bad.db.ok === false);
ok('...and no error text, host or table name comes back', !/ECONNREFUSED|10\.0\.0\.5|secret-table/.test(JSON.stringify(bad)), JSON.stringify(bad));
const t0 = Date.now();
const hung = await check({ ping: () => new Promise(() => {}), timeoutMs: 60 });
ok('a read that never answers → not ok after the limit, not after ever', hung.ok === false && Date.now() - t0 < 1500, (Date.now() - t0) + ' ms');

// ── the real server ─────────────────────────────────────────────────────────
const PORT = 20000 + Math.floor(Math.random() * 20000);
const child = spawn('node', ['index.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_SERVICE_KEY: 'dummy', JWT_SECRET: 'test-secret', NODE_ENV: 'test' } });
child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
const get = (p) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET', timeout: 8000 }, (res) => {
    let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', reject); r.end();
});
try {
  const start = Date.now(); let up = false;
  while (Date.now() - start < 30000 && !up) { try { await get('/health'); up = true; } catch { await new Promise(r => setTimeout(r, 200)); } }
  ok('the server boots', up);
  const h = await get('/health');
  ok('/health stays the cheap "ok" (200, never asks the database)', h.status === 200 && /"ok":true/.test(h.body), h.status + ' ' + h.body);
  const d = await get('/health/deep');
  ok('/health/deep with the database unreachable → 503 and ok:false', d.status === 503 && /"ok":false/.test(d.body), d.status + ' ' + d.body);
  ok('...and says nothing a stranger could use', !/ECONN|127\.0\.0\.1|59999|app_settings|dummy/.test(d.body), d.body);
  const api = await get('/auth/me');
  const page = await get('/');
  const script = await get('/js/00-ui-kit.js');
  for (const [name, r] of [['an API answer', api], ['a static page', page], ['a script', script], ['/health', h]]) {
    ok(`R-371a: ${name} carries X-Content-Type-Options: nosniff`, r.headers['x-content-type-options'] === 'nosniff', String(r.headers['x-content-type-options']));
    ok(`R-371a: ${name} carries a Referrer-Policy`, /strict-origin-when-cross-origin/.test(r.headers['referrer-policy'] || ''), String(r.headers['referrer-policy']));
  }
  ok('nosniff did not break the script: it is still served as JavaScript', script.status === 200 && /javascript/.test(script.headers['content-type'] || ''), script.status + ' ' + script.headers['content-type']);
  ok('...and the page as HTML', page.status === 200 && /text\/html/.test(page.headers['content-type'] || ''), page.status + ' ' + page.headers['content-type']);
} catch (e) { ok('suite ran to the end', false, e.stack || e.message); }
child.kill('SIGKILL');
const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
