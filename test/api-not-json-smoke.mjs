// An answer that is not JSON must never reach the screen as the browser's own sentence.
//
// 20 Oct 2026, owner: opening a "Needs you today" card showed
//   "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
// The free server sleeps when idle; a request that lands while it wakes comes back EMPTY (or as a gateway page).
// public/js/22-api.js now reads the body as text: a GET is asked once more after a short wait, and if the answer is still
// not JSON the person gets a plain sentence. A POST is never repeated (it may already have happened).
//
// The real apiFetch is cut out of the real file and run against a scripted fetch — nothing is re-implemented here.
//
// Usage: node test/api-not-json-smoke.mjs

import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../public/js/22-api.js', import.meta.url), 'utf8');
const a = src.indexOf('var SESSION_EXPIRED_MSG');
const b = src.indexOf('// ── Restore session if present');
if (a < 0 || b < 0 || b < a) { console.log('[FAIL] could not find the API layer in 22-api.js'); process.exit(1); }
const apiLayer = src.slice(a, b);

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

// a scripted server: each call takes the next answer from the list
function world(answers) {
  const calls = [];
  const sandbox = {
    STATE: { token: 'tok' }, API_URL: '', window: {}, console,
    setTimeout: (fn) => { fn(); return 0; },                       // the 3-second wait is not what is under test
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method });
      const x = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { ok: x.status >= 200 && x.status < 300, status: x.status, text: async () => x.body };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(apiLayer, sandbox);
  return { api: sandbox, calls };
}
const fail = async (p) => { try { await p; return null; } catch (e) { return e; } };

{
  const w = world([{ status: 200, body: '' }, { status: 200, body: '{"enabled":true,"n":3}' }]);
  const r = await w.api.apiGet('/x');
  ok('a GET answered EMPTY is asked once more, and the second answer is used', r && r.n === 3 && w.calls.length === 2, JSON.stringify([r, w.calls.length]));
}
{
  const w = world([{ status: 502, body: '<html>Bad gateway</html>' }, { status: 200, body: '{"ok":true}' }]);
  const r = await w.api.apiGet('/x');
  ok('…and so is a gateway page (the server was waking up)', r && r.ok === true && w.calls.length === 2);
}
{
  const w = world([{ status: 200, body: '' }]);
  const e = await fail(w.api.apiGet('/x'));
  ok('a GET still empty after the second ask says so in words', e && /did not answer properly/.test(e.message) && !/json/i.test(e.message), e && e.message);
  ok('…asked exactly twice, never more', w.calls.length === 2, String(w.calls.length));
  ok('…and the error says the server could not be reached (so a screen can tell it from a real refusal)', e && e.unreachable === true);
}
{
  const w = world([{ status: 200, body: '' }, { status: 200, body: '{"ok":true}' }]);
  const e = await fail(w.api.apiPost('/pay', { a: 1 }));
  ok('a POST is NEVER asked again (it may already have happened) — the person is told instead', e && /did not answer properly/.test(e.message) && w.calls.length === 1, JSON.stringify([e && e.message, w.calls.length]));
}
{
  const w = world([{ status: 404, body: '{"error":"Not found"}' }]);
  const e = await fail(w.api.apiGet('/x'));
  ok('a real refusal with a JSON reason is still delivered as before (and not repeated)', e && e.message === 'Not found' && e.status === 404 && w.calls.length === 1);
}
{
  const w = world([{ status: 401, body: '{"error":"Invalid token"}' }]);
  let expired = 0; w.api.window.sessionExpired = () => { expired++; };
  const e = await fail(w.api.apiGet('/x'));
  ok('an expired sign-in still says so and still signs out (R-118)', e && e.expired === true && expired === 1);
}
{
  const w = world([{ status: 200, body: '{"fine":1}' }]);
  const r = await w.api.apiGet('/x');
  ok('an ordinary answer is untouched and asked once', r && r.fine === 1 && w.calls.length === 1);
}

const failed = results.filter((r) => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
