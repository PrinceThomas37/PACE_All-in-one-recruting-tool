// "HAS ANYTHING CHANGED SINCE MY LAST LOAD?" (R-302, owner 21 Oct). Every open tab re-asked for the whole lead list every 3
// minutes; nearly always nothing had changed. Pinned here, by RUNNING the code:
//   * the server tags GET /jobs; the same content for the same viewer gives the same tag, any change in content, viewer or
//     what they may see gives a new one; a matching tag is answered 304 with no body (nothing scoped or sent);
//   * the browser sends the tag back only while its list is exactly the one the tag came with, for the same person — a fresh
//     load, a sign-out or a list replaced by other code always gets the full answer; "not changed" leaves the list untouched;
//   * (R-302) sign-in no longer downloads every SENT email (no screen read it); the RA Lead asks only for waiting + failed.
// Usage: node test/list-changed-smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
const tags = require('../services/list-tag.js');

// ── the tag ─────────────────────────────────────────────────────────────────
const rows = [{ id: 'a', stage: 'Assigned', contacts: [{ id: 'c1', email: 'x@y.com' }] }, { id: 'b', stage: 'Unassigned' }];
const viewer = { user: 'u1', scope: { all: false, ownerIds: ['u1', 'u2'] } };
const t1 = tags.tagFor(rows, viewer);
ok('same content, same viewer → same tag (even from a freshly read copy)', t1 === tags.tagFor(JSON.parse(JSON.stringify(rows)), JSON.parse(JSON.stringify(viewer))));
ok('a contact edit changes the tag', t1 !== tags.tagFor([{ ...rows[0], contacts: [{ id: 'c1', email: 'new@y.com' }] }, rows[1]], viewer));
ok('a deleted lead changes the tag', t1 !== tags.tagFor([rows[0]], viewer));
ok('another person gets another tag', t1 !== tags.tagFor(rows, { ...viewer, user: 'u9' }));
ok('a change in who they may see changes the tag', t1 !== tags.tagFor(rows, { user: 'u1', scope: { all: false, ownerIds: ['u1'] } }));
ok('If-None-Match matching → fresh; missing or different → not', tags.stillFresh({ headers: { 'if-none-match': t1 } }, t1) && !tags.stillFresh({ headers: {} }, t1) && !tags.stillFresh({ headers: { 'if-none-match': 'W/"l-x-y"' } }, t1));

// ── the route, run ──────────────────────────────────────────────────────────
const supabase = { from: () => ({}) };
const { hasRole, canTouchJob } = require('../middleware/authorize.js')({ supabase });
let list = rows, scoped = 0;
const ownership = require('../services/ownership.js');
const realScope = ownership.scopeLeads;
ownership.scopeLeads = (a, s) => { scoped++; return realScope(a, s); };
const router = require('../routes/jobs.js')({
  supabase, auth: (_a, _b, n) => n(), hasRole, canTouchJob, withOrg: (q) => q, orgIdFor: () => 'o1', orgStamp: () => ({}), today: () => '2026-10-21',
  logActivity: async () => {}, loadAllJobs: async () => list, JOB_SELECT: '*', getTimezoneFromLocation: () => 'EST', persistLearnedSkills: () => {},
});
const h = router.stack.find(l => l.route && l.route.path === '/jobs' && l.route.methods.get).route.stack.slice(-1)[0].handle;
const call = async (inm) => {
  let status = 200, body, ended = false; const hd = {};
  const res = { set(k, v) { hd[k.toLowerCase()] = v; return res; }, status(s) { status = s; return res; }, json(j) { body = j; return res; }, end() { ended = true; return res; } };
  await h({ user: { id: 'adm', role: 'admin', roles: ['admin'] }, headers: inm ? { 'if-none-match': inm } : {} }, res);
  return { status, body, ended, hd };
};
let r = await call();
ok('first load: 200 with the list and a tag', r.status === 200 && Array.isArray(r.body) && r.body.length === 2 && /^W\/"l-/.test(r.hd.etag), JSON.stringify(r.hd));
const tag = r.hd.etag, before = scoped;
r = await call(tag);
ok('same tag back, nothing changed → 304, no body, nothing scoped', r.status === 304 && r.ended && r.body === undefined && before > 0 && scoped === before, 'scoped ' + before + '→' + scoped);
list = [...rows, { id: 'c', stage: 'Unassigned' }];
r = await call(tag);
ok('a new lead → the full list again, with a new tag', r.status === 200 && r.body.length === 3 && r.hd.etag !== tag);
ok('the answer may be revalidated but not reused unasked (private, no-cache)', /no-cache/.test(r.hd['cache-control']) && /private/.test(r.hd['cache-control']));
ownership.scopeLeads = realScope;

// ── the browser side, run on the real 22-api.js source ──────────────────────
const api = fs.readFileSync(new URL('../public/js/22-api.js', import.meta.url), 'utf8');
const src = api.slice(api.indexOf('var SESSION_EXPIRED_MSG'), api.indexOf('function apiPost('));
const STATE = { token: 't', user: { id: 'u1' }, jobs: [] };
const sent = [];
let reply = { status: 200, body: '[{"id":"a"}]', etag: 'W/"l-1-x"' };
const fakeFetch = (url, init) => { sent.push({ url, inm: init.headers['If-None-Match'] || null, cache: init.cache });
  const r = reply; return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (k) => (k.toLowerCase() === 'etag' ? r.etag : null) }, text: () => Promise.resolve(r.body) }); };
const m = new Function('STATE', 'fetch', 'window', 'API_URL', src + '\nreturn { apiGetJobsList, endSessionCalls: window.endSessionCalls };')(STATE, fakeFetch, {}, '');
let jl = await m.apiGetJobsList();
ok('a first load sends no tag', sent[0].inm === null && jl && jl.data.length === 1);
STATE.jobs = jl.data.map(x => x); jl.keep();
reply = { status: 304, body: '', etag: 'W/"l-1-x"' };
jl = await m.apiGetJobsList();
ok('the next ask sends the tag back, without the browser cache', sent[1].inm === 'W/"l-1-x"' && sent[1].cache === 'no-store');
ok('"not changed" → null: the list on screen is kept as it is', jl === null);
STATE.jobs = STATE.jobs.slice();   // other code replaced the list
reply = { status: 200, body: '[{"id":"a"},{"id":"b"}]', etag: 'W/"l-2-x"' };
await m.apiGetJobsList();
ok('a list replaced by other code is never answered "not changed"', sent[2].inm === null);
STATE.jobs = [{ id: 'a' }]; (await m.apiGetJobsList()).keep();
STATE.user = { id: 'u2' };
await m.apiGetJobsList();
ok('another person never sends the last person\'s tag', sent[4].inm === null);
STATE.user = { id: 'u1' }; STATE.jobs = [{ id: 'a' }]; (await m.apiGetJobsList()).keep(); m.endSessionCalls();
// after endSessionCalls the in-flight generation moved on, so the call never answers; only what was SENT matters here
m.apiGetJobsList(); await new Promise(r => setTimeout(r, 10));
ok('after sign-out / a new sign-in the tag is gone', sent[6].inm === null);
STATE.jobs = [];
ok('an empty list never sends a tag (nothing to keep)', (() => { const n = sent.length; m.apiGetJobsList(); return sent[n].inm === null; })());
ok('the first screen after sign-in always asks in full', /_jobsTag=null;[^\n]*\n\s*var calls=\[apiGet\('\/users'\),apiGetJobsList\(\)/.test(api));

// ── no download of every sent email ────────────────────────────────────────
const bind = fs.readFileSync(new URL('../public/js/11-bind-and-actions.js', import.meta.url), 'utf8');
const all = fs.readdirSync(new URL('../public/js/', import.meta.url)).map(f => fs.readFileSync(new URL('../public/js/' + f, import.meta.url), 'utf8')).join('\n');
ok('nothing asks for every sent email any more', !/['"]\/emails\?status=sent['"]/.test(all));
ok('…and nothing read it (no screen reads STATE.sentEmails)', !/STATE\.sentEmails(?!\s*=)/.test(all));
ok('the RA Lead asks for waiting + failed, not every email', !/apiGet\('\/emails'\)/.test(bind) && /apiGet\('\/emails\?status=pending'\),apiGet\('\/emails\?status=failed'\)/.test(bind));

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
