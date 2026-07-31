// Backend boot smoke test — starts index.js with throwaway env on a random port
// (no real Supabase needed) and asserts the HTTP layer is intact after the route
// extraction:
//   - the server boots and /health responds,
//   - the EXTRACTED routes are mounted and auth-gated (401 without a token, which
//     proves the route exists — a missing route would 404),
//   - routes left inline in index.js still respond,
//   - an unknown path still 404s (so the 401s above are meaningful).
//
// Usage: node test/backend-smoke.mjs      (no external dependencies)

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken'); // already a project dependency

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const JWT_SECRET = 'test-secret';

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
child.stdout.on('data', () => {});
child.stderr.on('data', (d) => { stderr += d.toString(); });
let exitedEarly = false;
child.on('exit', (code) => { if (!done) exitedEarly = true; });

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 4000 },
      (res) => { res.resume(); resolve(res.statusCode); });
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    r.end();
  });
}

// POST JSON with an Authorization token; resolves { status, body }.
function postJson(p, token, bodyObj) {
  const payload = JSON.stringify(bodyObj || {});
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', timeout: 6000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${token}` } },
      (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    r.end(payload);
  });
}

async function waitForBoot(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exitedEarly) throw new Error('server exited before boot:\n' + stderr);
    try { await req('GET', '/health'); return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not boot within ' + timeoutMs + 'ms\n' + stderr);
}

const results = [];
const check = (name, actual, expected) =>
  results.push({ name, ok: actual === expected, detail: `got ${actual}, expected ${expected}` });

let done = false;
try {
  await waitForBoot(12000);

  check('GET /health → 200 (server boots)', await req('GET', '/health'), 200);
  check('GET /api/version → 200', await req('GET', '/api/version'), 200);

  // Extracted routers: mounted + auth-gated → 401 (not 404).
  check('GET /companies → 401 (extracted, gated)', await req('GET', '/companies'), 401);
  check('GET /companies/search → 401 (extracted)', await req('GET', '/companies/search'), 401);
  check('POST /companies → 401 (extracted)', await req('POST', '/companies'), 401);
  check('GET /reminders → 401 (extracted)', await req('GET', '/reminders'), 401);
  check('POST /contacts → 401 (extracted)', await req('POST', '/contacts'), 401);
  check('PATCH /contacts/x/email-status → 401 (extracted)', await req('PATCH', '/contacts/x/email-status'), 401);
  check('GET /app-settings → 401 (extracted)', await req('GET', '/app-settings'), 401);
  check('GET /outreach-plan → 401 (extracted)', await req('GET', '/outreach-plan'), 401);
  check('GET /suppression → 401 (extracted)', await req('GET', '/suppression'), 401);
  check('GET /analytics/templates → 401 (extracted)', await req('GET', '/analytics/templates'), 401);
  check('GET /admin/deliverability → 401 (extracted)', await req('GET', '/admin/deliverability'), 401);
  check('GET /admin/domain-health → 401 (new, gated)', await req('GET', '/admin/domain-health'), 401);
  check('POST /ai/generate-email → 401 (extracted)', await req('POST', '/ai/generate-email'), 401);
  check('GET /events/recent → 401 (extracted)', await req('GET', '/events/recent'), 401);
  check('GET /jobs → 401 (extracted)', await req('GET', '/jobs'), 401);
  check('GET /jobs/today-summary → 401 (extracted)', await req('GET', '/jobs/today-summary'), 401);
  check('POST /jobs/bulk → 401 (extracted)', await req('POST', '/jobs/bulk'), 401);
  check('POST /parse-jd → 401 (extracted)', await req('POST', '/parse-jd'), 401);
  check('GET /jobs/x/contacts → 401 (extracted)', await req('GET', '/jobs/x/contacts'), 401);
  check('GET /users/x/job-orders → 401 (new, gated)', await req('GET', '/users/x/job-orders'), 401);
  // ATS candidate database (Slice 1) — mounted + auth-gated.
  check('GET /candidates → 401 (bd-recruiter, gated)', await req('GET', '/candidates'), 401);
  check('GET /candidates/check-duplicate → 401 (new, gated)', await req('GET', '/candidates/check-duplicate'), 401);
  check('GET /candidates/x → 401 (new, gated)', await req('GET', '/candidates/x'), 401);
  check('GET /candidates/x/history → 401 (Slice 4, gated)', await req('GET', '/candidates/x/history'), 401);
  // ATS notes & documents (Slice 5) — mounted + auth-gated.
  check('GET /candidates/x/notes → 401 (Slice 5, gated)', await req('GET', '/candidates/x/notes'), 401);
  check('POST /candidates/x/notes → 401 (Slice 5, gated)', await req('POST', '/candidates/x/notes'), 401);
  check('GET /candidates/x/documents → 401 (Slice 5, gated)', await req('GET', '/candidates/x/documents'), 401);
  check('POST /candidates/x/documents → 401 (Slice 5, gated)', await req('POST', '/candidates/x/documents'), 401);
  // ATS managed lookups (Slice 6) — mounted + auth-gated.
  check('GET /recruiting-lookups → 401 (Slice 6, gated)', await req('GET', '/recruiting-lookups'), 401);
  check('POST /admin/recruiting-lookups → 401 (Slice 6, gated)', await req('POST', '/admin/recruiting-lookups'), 401);
  check('PATCH /admin/recruiting-lookups/x → 401 (Slice 6, gated)', await req('PATCH', '/admin/recruiting-lookups/x'), 401);
  check('DELETE /admin/recruiting-lookups/x → 401 (Slice 6, gated)', await req('DELETE', '/admin/recruiting-lookups/x'), 401);
  // Sourcing connectors (framework) — mounted + auth-gated.
  check('GET /sourcing/providers → 401 (sourcing, gated)', await req('GET', '/sourcing/providers'), 401);
  check('POST /sourcing/import-file → 401 (sourcing, gated)', await req('POST', '/sourcing/import-file'), 401);
  check('GET /sourcing/staged → 401 (sourcing, gated)', await req('GET', '/sourcing/staged'), 401);
  check('POST /sourcing/staged/x/import → 401 (sourcing, gated)', await req('POST', '/sourcing/staged/x/import'), 401);
  check('POST /sourcing/import-selected → 401 (sourcing, gated)', await req('POST', '/sourcing/import-selected'), 401);
  check('DELETE /sourcing/staged/x → 401 (sourcing, gated)', await req('DELETE', '/sourcing/staged/x'), 401);
  check('POST /sourcing/search → 401 (sourcing, gated)', await req('POST', '/sourcing/search'), 401);
  check('GET /recruiting-dashboard → 401 (role-aware, gated)', await req('GET', '/recruiting-dashboard'), 401);
  check('GET /reports/recruiting → 401 (gated)', await req('GET', '/reports/recruiting'), 401);
  check('GET /team/activity → 401 (new, gated)', await req('GET', '/team/activity'), 401);
  check('POST /meetings → 401 (new, gated)', await req('POST', '/meetings'), 401);
  check('POST /candidates/parse-resume → 401 (gated)', await req('POST', '/candidates/parse-resume'), 401);
  check('POST /job-orders/x/posting-jd → 401 (gated)', await req('POST', '/job-orders/x/posting-jd'), 401);
  check('POST /candidates → 401 (bd-recruiter, gated)', await req('POST', '/candidates'), 401);
  check('PUT /candidates/x → 401 (bd-recruiter, gated)', await req('PUT', '/candidates/x'), 401);
  check('DELETE /candidates/x → 401 (new, gated)', await req('DELETE', '/candidates/x'), 401);
  // ATS pipeline / tagging layer (Slice 2) — mounted + auth-gated.
  check('GET /job-orders/x/pipeline → 401 (new, gated)', await req('GET', '/job-orders/x/pipeline'), 401);
  check('POST /pipeline → 401 (new, gated)', await req('POST', '/pipeline'), 401);
  check('PATCH /pipeline/x/status → 401 (new, gated)', await req('PATCH', '/pipeline/x/status'), 401);
  check('PATCH /pipeline/x → 401 (new, gated)', await req('PATCH', '/pipeline/x'), 401);
  check('POST /pipeline/x/promote → 401 (new, gated)', await req('POST', '/pipeline/x/promote'), 401);
  check('DELETE /pipeline/x → 401 (new, gated)', await req('DELETE', '/pipeline/x'), 401);
  // ATS submissions lifecycle (Slice 3) — mounted + auth-gated.
  check('GET /job-orders/x/submissions → 401 (gated)', await req('GET', '/job-orders/x/submissions'), 401);
  check('PATCH /submissions/x/stage → 401 (gated)', await req('PATCH', '/submissions/x/stage'), 401);
  check('PATCH /submissions/x → 401 (new, gated)', await req('PATCH', '/submissions/x'), 401);
  check('GET /jobs/x/activity → 401 (still inline)', await req('GET', '/jobs/x/activity'), 401);

  // Dependency check: run the POST /jobs handler with a valid admin token and a
  // minimal body. As an admin it skips the RA cooldown and reaches
  // getTimezoneFromLocation + buildResearchFromLeadData BEFORE the first Supabase
  // call, so a dependency that wasn't wired through ctx/require would surface as a
  // ReferenceError ("X is not defined"). We expect a Supabase/network 500 instead.
  {
    const token = jwt.sign({ id: 'test-admin', roles: ['admin'], role: 'admin', name: 'T' }, JWT_SECRET);
    // A missing pre-DB dependency (e.g. getTimezoneFromLocation / buildResearchFromLeadData)
    // throws a ReferenceError BEFORE any Supabase call → a fast 500 whose body says
    // "is not defined". If deps resolve, the handler reaches Supabase and hangs on the
    // dead dummy host → our request times out. So: fast ReferenceError = FAIL;
    // anything else (incl. timeout = reached the DB layer) = PASS.
    let detail, ok;
    try {
      const { status, body } = await postJson('/jobs', token, { company_id: 'c1', position: 'Engineer' });
      const isRefErr = /is not defined|is not a function/i.test(body);
      ok = !isRefErr;
      detail = `status=${status} body=${body.slice(0, 180)}`;
    } catch (e) {
      ok = true; // timeout = handler got past dep resolution into the Supabase call
      detail = `reached DB layer (${e.message})`;
    }
    results.push({ name: 'POST /jobs handler resolves all deps (no ReferenceError)', ok, detail });
  }

  // Still-inline routes unaffected.
  check('GET /emails → 401 (extracted)', await req('GET', '/emails'), 401);
  check('GET /emails/pending-summary → 401 (extracted)', await req('GET', '/emails/pending-summary'), 401);
  check('GET /emails/send-progress → 401 (extracted)', await req('GET', '/emails/send-progress'), 401);
  check('POST /admin/emails/purge-pending → 401 (new, gated)', await req('POST', '/admin/emails/purge-pending'), 401);
  check('GET /admin/settings/numbers → 401 (new, gated)', await req('GET', '/admin/settings/numbers'), 401);
  check('GET /admin/integrations → 401 (new, gated)', await req('GET', '/admin/integrations'), 401);
  check('POST /admin/integrations/zerobounce → 401 (new, gated)', await req('POST', '/admin/integrations/zerobounce'), 401);
  check('POST /admin/integrations/zerobounce/test → 401 (new, gated)', await req('POST', '/admin/integrations/zerobounce/test'), 401);
  check('POST /admin/integrations/email-verify → 401 (new, gated)', await req('POST', '/admin/integrations/email-verify'), 401);
  check('POST /admin/settings/numbers → 401 (new, gated)', await req('POST', '/admin/settings/numbers'), 401);
  check('DELETE /emails/x → 401 (extracted)', await req('DELETE', '/emails/x'), 401);
  // Pipeline routes deliberately kept inline — still respond (401 without token).
  check('POST /emails/queue-all → 401 (still inline)', await req('POST', '/emails/queue-all'), 401);
  check('POST /emails/generate → 401 (still inline)', await req('POST', '/emails/generate'), 401);
  check('GET /industries → 401 (extracted)', await req('GET', '/industries'), 401);
  check('GET /lookup/zipcode → 401 (extracted)', await req('GET', '/lookup/zipcode'), 401);
  check('POST /contacts/check-email → 401 (extracted)', await req('POST', '/contacts/check-email'), 401);
  check('GET /distribute/pool-stats → 401 (extracted)', await req('GET', '/distribute/pool-stats'), 401);
  check('GET /admin/manager-ra-modes → 401 (extracted)', await req('GET', '/admin/manager-ra-modes'), 401);
  check('POST /distribute/execute → 401 (still inline)', await req('POST', '/distribute/execute'), 401);

  // Dependency check for the window-helper-heavy pending-summary route: an admin
  // token reaches getSendWindowHours + the window helpers before any per-row work.
  {
    const token = jwt.sign({ id: 'test-admin', roles: ['admin'], role: 'admin', name: 'T' }, JWT_SECRET);
    let ok, detail;
    try {
      const { status, body } = await new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, path: '/emails/pending-summary', method: 'GET', timeout: 6000, headers: { Authorization: `Bearer ${token}` } },
          (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
        r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', reject); r.end();
      });
      ok = !/is not defined|is not a function/i.test(body);
      detail = `status=${status} body=${body.slice(0, 160)}`;
    } catch (e) { ok = true; detail = `reached DB layer (${e.message})`; }
    results.push({ name: 'GET /emails/pending-summary resolves window helpers (no ReferenceError)', ok, detail });
  }

  // Sequencing (workflow engine) routes — mounted + auth-gated.
  check('GET /wf/definitions → 401 (gated)', await req('GET', '/wf/definitions'), 401);
  check('GET /wf/sending-mailboxes → 401 (new, gated)', await req('GET', '/wf/sending-mailboxes'), 401);
  check('POST /wf/enroll-bulk → 401 (gated)', await req('POST', '/wf/enroll-bulk'), 401);

  // Dependency check: enroll-bulk with an admin token + a from_mailbox_ids body
  // exercises resolveFromMailboxes (the rotation validator) and the metadata
  // assembly before the engine's Supabase call — a mis-wired helper would
  // ReferenceError here rather than hang on the dead DB host.
  {
    const token = jwt.sign({ id: 'test-admin', roles: ['admin'], role: 'admin', name: 'T' }, JWT_SECRET);
    let ok, detail;
    try {
      const { status, body } = await postJson('/wf/enroll-bulk', token,
        { workflow_id: 'w1', entity_type: 'contact', items: [{ entity_id: 'c1', job_id: 'j1' }], from_mailbox_ids: ['m1', 'm2'], any_stage: true });
      ok = !/is not defined|is not a function/i.test(body);
      detail = `status=${status} body=${body.slice(0, 160)}`;
    } catch (e) { ok = true; detail = `reached DB layer (${e.message})`; }
    results.push({ name: 'POST /wf/enroll-bulk resolves rotation deps (no ReferenceError)', ok, detail });
  }

  // Gmail OAuth routes — mounted. Status is auth-gated (401 without token);
  // connect is a redirect/HTML flow (not a 401), so just assert it's not a 404.
  check('GET /auth/google/status/x → 401 (new, gated)', await req('GET', '/auth/google/status/x'), 401);
  {
    const s = await req('GET', '/auth/google/connect');
    results.push({ name: 'GET /auth/google/connect → mounted (not 404)', ok: s !== 404, detail: `got ${s}` });
  }

  // Warm-up pool routes — mounted + auth-gated.
  check('GET /warmup/mailboxes → 401 (new, gated)', await req('GET', '/warmup/mailboxes'), 401);
  check('POST /warmup/tick → 401 (new, gated)', await req('POST', '/warmup/tick'), 401);
  check('POST /warmup/x/start → 401 (new, gated)', await req('POST', '/warmup/x/start'), 401);

  // Dependency check: /warmup/tick with an admin token exercises the warm-up
  // engine's tick (poolMailboxes → Supabase) — a mis-wired engine/ctx would
  // ReferenceError rather than hang on the dead DB host.
  {
    const token = jwt.sign({ id: 'test-admin', roles: ['admin'], role: 'admin', name: 'T' }, JWT_SECRET);
    let ok, detail;
    try {
      const { status, body } = await postJson('/warmup/tick', token, {});
      ok = !/is not defined|is not a function/i.test(body);
      detail = `status=${status} body=${body.slice(0, 160)}`;
    } catch (e) { ok = true; detail = `reached DB layer (${e.message})`; }
    results.push({ name: 'POST /warmup/tick resolves engine deps (no ReferenceError)', ok, detail });
  }

  // Unknown path still 404s → proves the 401s above mean "route exists + gated".
  check('GET /definitely-not-a-route → 404', await req('GET', '/definitely-not-a-route'), 404);
} catch (e) {
  results.push({ name: 'FATAL', ok: false, detail: String(e.message || e) });
} finally {
  done = true;
  child.kill('SIGKILL');
}

console.log('\n=== BACKEND SMOKE TEST ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
