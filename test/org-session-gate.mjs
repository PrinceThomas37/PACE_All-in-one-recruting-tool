// Boots the real server and checks ONE property of auth(): what happens to a
// session token that carries no org_id.
//
// WHY THIS IS WORTH A SERVER BOOT
// `orgIdFor()` falls back to the platform's first organisation when a request
// has no org on it. While PACE serves one company that is correct and harmless.
// The moment a second organisation can exist — which is exactly what self-serve
// signup creates — that same fallback silently means "give this session the
// FIRST customer's candidates, leads and mailboxes". No error, no log line, the
// wrong company's data.
//
// So the gate is: once more than one org is possible, a token with no org_id is
// refused outright and the person signs in again. That is a claim about the
// live request path, not about a helper, so it is tested against the live
// request path.
//
// The other half matters just as much: with self-serve OFF and one org (today,
// in production), nothing changes. An org-less token must still work, or this
// "safety fix" is an outage for anyone holding a session.
//
// Usage: node test/org-session-gate.mjs   (no browser, no database)

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-org-gate';

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const withOrg = jwt.sign({ id: 'u1', email: 'a@b.com', roles: ['admin'], role: 'admin', org_id: 'org-1' }, SECRET, { expiresIn: '10m' });
const noOrg = jwt.sign({ id: 'u1', email: 'a@b.com', roles: ['admin'], role: 'admin' }, SECRET, { expiresIn: '10m' });

function request(port, path, token) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: 8000, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end();
  });
}

async function boot(port, extraEnv) {
  const child = spawn('node', ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      // Unreachable on purpose: this test is about the middleware, and every
      // authenticated endpoint past it will fail at the database. "not a 401"
      // is the signal, whatever the eventual error is.
      SUPABASE_URL: 'http://127.0.0.1:59998',
      SUPABASE_SERVICE_KEY: 'dummy-service-key',
      JWT_SECRET: SECRET,
      NODE_ENV: 'test',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 3000 },
          (res) => { res.resume(); resolve(); });
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.on('error', reject);
        r.end();
      });
      return child;
    } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
  }
  child.kill('SIGKILL');
  throw new Error(`server did not boot on ${port}`);
}

const servers = [];
try {
  // ── Multi-org possible (self-serve on) ────────────────────────────────────
  {
    const port = 39871;
    servers.push(await boot(port, { SELF_SERVE_SIGNUP: 'on' }));

    const refused = await request(port, '/users/me', noOrg);
    ok('a session with no org_id is refused once multi-org is possible', refused.status === 401,
      `${refused.status} ${refused.body.slice(0, 120)}`);
    ok('...with a message that says to sign in again', /sign in again/i.test(refused.body), refused.body.slice(0, 160));

    const allowed = await request(port, '/users/me', withOrg);
    ok('a session WITH an org_id is not blocked by the gate', allowed.status !== 401,
      `${allowed.status} ${allowed.body.slice(0, 120)}`);

    const junk = await request(port, '/users/me', 'not-a-token');
    ok('an unsigned token is still rejected as invalid', junk.status === 401 && /invalid token/i.test(junk.body),
      junk.body.slice(0, 120));
  }

  // ── Today's production shape: one org, self-serve off ─────────────────────
  {
    const port = 39872;
    servers.push(await boot(port, {}));

    const legacy = await request(port, '/users/me', noOrg);
    ok('with self-serve off, an org-less session still works (no outage)', legacy.status !== 401,
      `${legacy.status} ${legacy.body.slice(0, 120)}`);
  }
} catch (err) {
  ok('the test harness ran', false, err.message);
} finally {
  for (const s of servers) { try { s.kill('SIGKILL'); } catch (_) {} }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
