// R-049 over the REAL server: a customer's admin cannot stop, run or retime anything the other customers share, and the
// emergency stop they DO have reaches only their own company. Boots index.js against an unreachable database (as
// backend-smoke does); sessions are signed tokens, so what is asserted is the route's own answer.
//
//   F = the founding company (its admins are the PACE operator while OPERATOR_EMAILS is unset)
//   S = a second company
//
// Usage: node test/operator-routes-smoke.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const F = '11111111-1111-1111-1111-111111111111';
const S = '22222222-2222-2222-2222-222222222222';
const env = { ...process.env, PORT: String(PORT), SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_SERVICE_KEY: 'dummy', JWT_SECRET: 'test-secret', NODE_ENV: 'test', DEFAULT_ORG_ID: F };
delete env.OPERATOR_EMAILS;
const child = spawn('node', ['index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '', exited = false, done = false;
child.stdout.on('data', () => {}); child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', () => { if (!done) exited = true; });

const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
const founderAdmin = tok({ id: 'f-admin', email: 'admin@founder.test', roles: ['admin'], role: 'admin', org_id: F });
const founderRa = tok({ id: 'f-ra', email: 'ra@founder.test', roles: ['ra'], role: 'ra', org_id: F });
const secondAdmin = tok({ id: 's-admin', email: 'admin@second.test', roles: ['admin'], role: 'admin', org_id: S });
const secondRa = tok({ id: 's-ra', email: 'ra@second.test', roles: ['ra'], role: 'ra', org_id: S });

function call(method, p, token, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 8000, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, body: j }); }); });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', reject); r.end(payload);
  });
}
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

try {
  const start = Date.now();
  for (;;) {
    if (exited) throw new Error('server exited before boot:\n' + stderr);
    try { const r = await call('GET', '/health'); if (r.status === 200) break; } catch (_) {}
    if (Date.now() - start > 15000) throw new Error('no boot\n' + stderr);
    await new Promise((r) => setTimeout(r, 200));
  }

  // The shared things: operator only.
  const engine2 = await call('POST', '/admin/engine/run/anything', secondAdmin);
  ok('a second company\'s admin cannot run a background engine by hand', engine2.status === 403, JSON.stringify(engine2));
  const settings2 = await call('POST', '/app-settings', secondAdmin, { key: 'outreach_send_time', value: '03:00' });
  ok('…cannot change the deployment-wide send times', settings2.status === 403, JSON.stringify(settings2));
  const sweep2 = await call('POST', '/admin/bounce-sweep', secondAdmin);
  ok('…cannot trigger the mailbox sweeps for every company', sweep2.status === 403, JSON.stringify(sweep2));
  const ci2 = await call('POST', '/admin/client-intel/catch-up', secondAdmin);
  ok('…nor the client catch-up', ci2.status === 403, JSON.stringify(ci2));
  const wu2 = await call('POST', '/warmup/tick', secondAdmin);
  ok('…nor the warm-up engine', wu2.status === 403, JSON.stringify(wu2));
  const engine1 = await call('POST', '/admin/engine/run/anything', founderAdmin);
  ok('the founding company\'s admin (the operator today) still can — a 404 for the made-up job, not a refusal', engine1.status === 404, JSON.stringify(engine1));
  const engineRa = await call('POST', '/admin/engine/run/anything', founderRa);
  ok('a non-admin never can', engineRa.status === 403);

  // The stop: platform-wide is the operator's, a company's is its own.
  const plat2 = await call('POST', '/admin/sending/pause', secondAdmin, { scope: 'platform' });
  ok('a second company\'s admin cannot stop sending for EVERY company', plat2.status === 403, JSON.stringify(plat2));
  const st0 = await call('GET', '/admin/sending/status', founderAdmin);
  ok('…and nothing was paused by trying', st0.body && st0.body.paused === false && st0.body.platform === false, JSON.stringify(st0.body));
  await call('GET', '/sending/my-status', founderRa);          // each company's person is seen once (the server learns who belongs where from the session)
  const my0 = await call('GET', '/sending/my-status', secondRa);
  ok('a second company\'s person is not paused to begin with', my0.body && my0.body.paused === false, JSON.stringify(my0.body));

  const stop2 = await call('POST', '/admin/sending/pause', secondAdmin, {});
  ok('a second company\'s admin CAN stop their own company', stop2.status === 200 && stop2.body.scope === 'org', JSON.stringify(stop2));
  const mine2 = await call('GET', '/sending/my-status', secondRa);
  ok('…their people are told sending is paused', mine2.body && mine2.body.paused === true, JSON.stringify(mine2.body));
  const mine1 = await call('GET', '/sending/my-status', founderRa);
  ok('…and the founding company\'s people are NOT', mine1.body && mine1.body.paused === false, JSON.stringify(mine1.body));
  const stF = await call('GET', '/admin/sending/status', founderAdmin);
  ok('…the founder\'s admin sees no pause either', stF.body && stF.body.paused === false && stF.body.platform === false, JSON.stringify(stF.body));

  const crossMgr = await call('POST', '/admin/sending/pause', founderAdmin, { manager_id: 's-ra' });
  ok('an admin cannot pause a manager who belongs to another company', crossMgr.status === 404, JSON.stringify(crossMgr));
  const mine2b = await call('GET', '/sending/my-status', secondRa);
  const stillF = await call('GET', '/sending/my-status', founderRa);
  ok('…and it changed nothing for either company', mine2b.body.manager === false && stillF.body.paused === false, JSON.stringify([mine2b.body, stillF.body]));

  const plat1 = await call('POST', '/admin/sending/pause', founderAdmin, { scope: 'platform' });
  ok('the operator can stop everything', plat1.status === 200 && plat1.body.scope === 'platform', JSON.stringify(plat1));
  const f2 = await call('GET', '/sending/my-status', founderRa);
  ok('…and then the founding company is paused too', f2.body && f2.body.paused === true, JSON.stringify(f2.body));
  const res2 = await call('POST', '/admin/sending/resume', secondAdmin, {});
  ok('a company resuming itself does not lift the operator\'s stop, and the answer says so', res2.status === 200 && res2.body.paused === true && res2.body.held_by_operator === true, JSON.stringify(res2));
  const resP = await call('POST', '/admin/sending/resume', founderAdmin, { scope: 'platform' });
  ok('the operator lifts it', resP.status === 200 && resP.body.paused === false, JSON.stringify(resP));
  const end = await call('GET', '/sending/my-status', secondRa);
  ok('…and the second company, which resumed itself, is sending again', end.body && end.body.paused === false, JSON.stringify(end.body));
} catch (e) {
  ok('the run reached its end', false, e.message);
} finally {
  done = true; child.kill('SIGKILL');
}
const failed = results.filter((r) => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
