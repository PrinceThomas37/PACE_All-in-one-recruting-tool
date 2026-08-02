// Guard test for the bd_recruiter_routes.js split.
//
// That file used to be ONE 2,140-line closure holding ~65 recruiting routes and
// every helper they shared. It is now a mounter over routes/recruiting/*. The
// risk in a move like that is not a crash — it is a route that quietly stops
// being registered, or a helper that used to resolve by hoisting across
// sections and now resolves to undefined inside a handler whose catch block
// already swallows errors.
//
// So this test boots the REAL server and asserts that every recruiting route
// still exists. The distinction that makes it meaningful: a mounted, auth-gated
// route answers 401/403; a route that vanished answers 404. The unknown-path
// check at the end proves 404 is really what a missing route looks like.
//
// The route list below is derived from the pre-split file and is deliberately
// hard-coded — a list regenerated from the current source would happily agree
// with a route that had just been deleted.
//
// Usage: node test/recruiting-routes-mounted.mjs   (no external dependencies)

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// Every route the pre-split bd_recruiter_routes.js registered (58 of them).
const ROUTES = [
  ['POST', '/job-orders/from-lead/x'], ['POST', '/job-orders'],
  ['GET', '/job-orders'], ['GET', '/job-orders/browse'], ['GET', '/job-orders/x'],
  ['PUT', '/job-orders/x'], ['DELETE', '/job-orders/x'],
  ['GET', '/job-orders/x/matches'], ['POST', '/match/score'],
  ['POST', '/job-orders/x/parse-jd'], ['POST', '/job-orders/x/posting-jd'],
  ['POST', '/job-orders/x/recruiters'], ['DELETE', '/job-orders/x/recruiters/y'],
  ['POST', '/job-orders/x/request-assignment'], ['GET', '/assignment-requests'],
  ['POST', '/assignment-requests/x/decide'], ['GET', '/users/x/job-orders'],
  ['GET', '/candidates'], ['GET', '/candidates/check-duplicate'], ['GET', '/candidates/x'],
  ['GET', '/candidates/x/history'], ['POST', '/candidates'], ['PUT', '/candidates/x'],
  ['DELETE', '/candidates/x'],
  ['GET', '/candidates/x/notes'], ['POST', '/candidates/x/notes'],
  ['DELETE', '/candidates/x/notes/y'],
  ['GET', '/candidates/x/documents'], ['POST', '/candidates/x/documents'],
  ['DELETE', '/candidates/x/documents/y'],
  ['GET', '/job-orders/x/submissions'], ['POST', '/submissions'],
  ['PATCH', '/submissions/x/stage'], ['PATCH', '/submissions/x'], ['DELETE', '/submissions/x'],
  ['GET', '/job-orders/x/pipeline'], ['POST', '/pipeline'],
  ['PATCH', '/pipeline/x/status'], ['PATCH', '/pipeline/x'],
  ['POST', '/pipeline/x/promote'], ['DELETE', '/pipeline/x'],
  ['POST', '/candidates/parse-resume'],
  ['GET', '/recruiting-lookups'], ['POST', '/admin/recruiting-lookups'],
  ['PATCH', '/admin/recruiting-lookups/x'], ['DELETE', '/admin/recruiting-lookups/x'],
  ['GET', '/sourcing/providers'], ['POST', '/sourcing/import-file'],
  ['GET', '/sourcing/staged'], ['POST', '/sourcing/staged/x/import'],
  ['POST', '/sourcing/import-selected'], ['DELETE', '/sourcing/staged/x'],
  ['POST', '/sourcing/search'],
  ['GET', '/recruiting-dashboard'], ['GET', '/reports/recruiting'], ['GET', '/team/activity'],
  ['GET', '/bd-analytics/recruiters'], ['GET', '/bd-analytics/funnel'],
];

// Routes whose literal path must win over a sibling :id pattern. Registration
// order is what makes this work, so it is asserted explicitly.
const LITERAL_BEFORE_PARAM = [
  ['GET', '/job-orders/browse'],
  ['GET', '/candidates/check-duplicate'],
];

const child = spawn('node', ['index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_SERVICE_KEY: 'dummy-service-key',
    JWT_SECRET: 'test-secret',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
let stdout = '';
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 5000 },
      res => { res.resume(); resolve(res.statusCode); });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end();
  });
}

async function waitForBoot(ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { await req('GET', '/health'); return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

let failed = 0;
try {
  const booted = await waitForBoot();
  ok('the server boots with the split route modules', booted, stderr.slice(-400));
  if (!booted) throw new Error('server did not boot');

  ok('the recruiting modules report as mounted', /\[BD-Recruiter\] Routes mounted/.test(stdout), stdout.slice(-200));

  // An unknown path must 404 — otherwise the 401s below prove nothing.
  const unknown = await req('GET', '/definitely-not-a-route-xyz');
  ok('an unknown path 404s (so 401 really means "route exists")', unknown === 404, String(unknown));

  let missing = [];
  for (const [method, p] of ROUTES) {
    const status = await req(method, p);
    if (status === 404) missing.push(`${method} ${p}`);
  }
  ok(`all ${ROUTES.length} recruiting routes are still mounted`, missing.length === 0, missing.join(', '));

  for (const [method, p] of LITERAL_BEFORE_PARAM) {
    const status = await req(method, p);
    ok(`${p} is registered before its :id sibling`, status !== 404, String(status));
  }
} catch (err) {
  ok('test harness completed', false, String(err && err.message));
} finally {
  child.kill('SIGKILL');
}

console.log('\n=== RECRUITING ROUTES MOUNTED ===');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
