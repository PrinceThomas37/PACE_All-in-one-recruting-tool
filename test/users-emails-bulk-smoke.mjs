// EVERY COLLEAGUE'S MAILBOXES IN ONE REQUEST (R-298, owner 20 Oct: "correct this issue"). The memory watcher showed an admin's
// app asking GET /users/:id/emails once PER PERSON in the same second (~10 at once, each five database trips). Now:
//   • GET /users-emails answers for every person of the caller's OWN company — never another company's, never a removed user;
//   • each mailbox is described exactly as GET /users/:id/emails describes it (one shared function);
//   • the app (public/js/22-api.js) asks once — not once per person, and its own list once, not twice.
// Usage: node test/users-emails-bulk-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-user-password';
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const T = {
  organizations: [{ id: 'o1', name: 'Co One', plan: 'internal' }, { id: 'o2', name: 'Co Two', plan: 'internal' }],
  users: [
    { id: 'adm', org_id: 'o1', email: 'adm@one.test', roles: ['admin'], role: 'admin', name: 'Ann Admin', is_active: true, deleted_at: null, password_hash: bcrypt.hashSync('adminpass1', 4) },
    { id: 'bd1', org_id: 'o1', email: 'bd@one.test', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null, name: 'Bea', password_hash: bcrypt.hashSync('bdpass1234', 4) },
    { id: 'bd2', org_id: 'o1', email: 'bd2@one.test', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null, password_hash: 'x' },
    { id: 'gone1', org_id: 'o1', email: 'gone@one.test', roles: ['bd'], role: 'bd', is_active: false, deleted_at: '2026-10-10T00:00:00Z', password_hash: bcrypt.hashSync('gonepass12', 4) },
    { id: 'y2', org_id: 'o2', email: 'y@two.test', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null, password_hash: 'x' },
    { id: 'x1', org_id: 'o2', email: 'x@two.test', roles: ['ra'], role: 'ra', is_active: false, deleted_at: '2026-10-11T00:00:00Z', password_hash: bcrypt.hashSync('xpass12345', 4) },
  ],
  app_settings: [{ key: 'default_daily_send_limit', value: '30' }, { key: 'daily_limit_warn_above', value: '400' }], record_history: [], microsoft_tokens: [{ user_email_id: 'm1' }], gmail_tokens: [],
  user_emails: [
    { id: 'm1', org_id: 'o1', user_id: 'bd1', email_address: 'bd@box.test', daily_send_limit: 100, is_active: true },
    { id: 'm2', org_id: 'o2', user_id: 'x1', email_address: 'x@box.test', daily_send_limit: 50, is_active: true },
    { id: 'm3', org_id: 'o1', user_id: 'bd1', email_address: 'bd-second@box.test', daily_send_limit: 40, is_active: true },
    { id: 'm4', org_id: 'o1', user_id: 'gone1', email_address: 'gone@box.test', daily_send_limit: 40, is_active: true },
    { id: 'm9', org_id: 'o2', user_id: 'y2', email_address: 'other-company@box.test', daily_send_limit: 40, is_active: true },
  ],
};
let uid = 0;
// Like the real database: an answer carries only the columns the route selected (no select = every column).
function from(name) {
  let mode = 'select', filters = [], row = null, patch = null, one = false, cols = null;
  const proj = (r) => (!r || !cols || cols === '*' ? r : Object.fromEntries(cols.split(',').map((c) => c.trim()).filter((c) => c in r).map((c) => [c, r[c]])));
  const rows = () => (T[name] || []).filter((r) => filters.every((f) => f(r)));
  const q = {
    select(c) { cols = c || null; return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; },
    in(c, l) { filters.push((r) => l.includes(r[c])); return q; },
    is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    not(c, op, v) { filters.push((r) => (op === 'is' && v === null ? r[c] != null : true)); return q; },
    neq(c, v) { filters.push((r) => r[c] !== v); return q; },
    order() { return q; }, limit() { return q; },
    insert(r) { mode = 'insert'; row = r; return q; },
    upsert() { return Promise.resolve({ error: null }); },
    update(p) { mode = 'update'; patch = p; return q; },
    single() { one = 'single'; return q; }, maybeSingle() { one = 'maybe'; return q; },
    then(res, rej) {
      let out;
      T[name] = T[name] || [];
      if (mode === 'insert') { const r = Object.assign({ id: 'new' + (++uid), is_active: true, deleted_at: null }, row); T[name].push(r); out = { data: proj(r), error: null }; }
      else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: one ? proj(hit[0]) || null : hit.map(proj), error: null }; }
      else { const d = rows(); out = one ? (d[0] ? { data: proj(d[0]), error: null } : { data: null, error: one === 'single' ? { message: 'no row' } : null }) : { data: d.map(proj), error: null }; }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return q;
}
const supabase = { from };
const hasRole = (req, ...r) => ((req.user && req.user.roles) || []).some((x) => r.includes(x));
const auth = (req, res, next) => {
  const h = (req.headers.authorization || '').replace('Bearer ', '');
  try { const u = jwt.verify(h, process.env.JWT_SECRET); req.user = u; req.orgId = u.org_id; next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
};
const tokenFor = (id) => { const u = T.users.find((x) => x.id === id); return jwt.sign({ id, org_id: u.org_id, roles: u.roles, role: u.roles[0] }, process.env.JWT_SECRET); };
const ctx = { supabase, auth, hasRole, orgIdFor: (req) => req.orgId || null, loadMailboxSignatures: async () => ({}), today: () => '2026-10-15' };
const app = express(); app.use(express.json());
app.use(require('../routes/auth.js')(ctx));
const server = http.createServer(app);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = async (method, p, who, body) => {
  const r = await fetch(`http://127.0.0.1:${port}` + p, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + tokenFor(who) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) { /* none */ }
  return { code: r.status, out: json };
};

let r = await call('GET', '/users-emails', 'adm');
step('one request answers for the company', r.code === 200 && r.out && typeof r.out === 'object', JSON.stringify(r.out).slice(0, 200));
step('every person of the company is present (an empty list for someone with no mailbox)', Array.isArray(r.out.bd1) && Array.isArray(r.out.bd2) && r.out.bd2.length === 0 && Array.isArray(r.out.adm));
step('a person\'s mailboxes are all there', (r.out.bd1 || []).map(m => m.id).sort().join() === 'm1,m3');
step('another company\'s people and mailboxes are NOT there', !('y2' in r.out) && !('x1' in r.out) && !JSON.stringify(r.out).includes('other-company'));
step('a removed user is not there', !('gone1' in r.out) && !JSON.stringify(r.out).includes('gone@box'));
const single = await call('GET', '/users/bd1/emails', 'adm');
const pick = (m) => JSON.stringify({ id: m.id, ms: m.ms_connected, gm: m.gmail_connected, conn: m.connection, sa: m.sends_as, sig: m.has_own_signature });
step('each mailbox is described exactly as the one-person request describes it', single.code === 200
  && JSON.stringify(single.out.map(pick)) === JSON.stringify((r.out.bd1 || []).map(pick)), JSON.stringify([single.out.map(pick), (r.out.bd1 || []).map(pick)]));
step('…including the Outlook connection flag', (r.out.bd1 || []).find(m => m.id === 'm1').ms_connected === true);
const other = await call('GET', '/users-emails', 'y2');
step('the other company sees only its own', other.code === 200 && Object.keys(other.out).every(id => ['y2', 'x1'].includes(id)) && !JSON.stringify(other.out).includes('bd@box'), JSON.stringify(other.out));
step('signed out → refused', (await call('GET', '/users-emails', null)).code === 401);

// The app asks once. Load the boot code with a fake apiGet and count.
const fs = await import('node:fs');
const vm = await import('node:vm');
const api = fs.readFileSync(new URL('../public/js/22-api.js', import.meta.url), 'utf8');
const start = api.indexOf('function loadAppData(){'), endAt = api.indexOf('function refreshJobs(');
const asked = [];
const resolveFor = (p) => {
  if (p === '/users') return [{ id: 'adm', name: 'A' }, ...Array.from({ length: 9 }, (_, k) => ({ id: 'u' + k, name: 'U' + k }))];
  if (p === '/users-emails') return { adm: [], u0: [{ id: 'z' }] };
  if (/^\/users\/[^/]+\/emails$/.test(p)) return [{ id: 'mine', is_primary: true }];
  if (p === '/outreach-plan') return {};
  return [];
};
const sandbox = { STATE: { user: { id: 'adm', role: 'admin', roles: ['admin'] } }, render() {}, scheduleRender() {}, showToast() {}, sessionStorage: { removeItem() {} },
  apiGet: (p) => { asked.push(p); return Promise.resolve(resolveFor(p)); }, normaliseUser: (u) => u, normaliseJob: (j) => j, flattenContacts: () => [],
  userHasAnyRole: (u, ...roles) => roles.some(x => (u.roles || []).includes(x)), loadMailboxSignature() {}, startProgressPoll() {}, startBackgroundPoll() {}, window: {} };
vm.createContext(sandbox);
vm.runInContext(api.slice(start, endAt) + '\nloadAppData();', sandbox);
await new Promise(r => setTimeout(r, 50));
const perPerson = asked.filter(p => /^\/users\/[^/]+\/emails$/.test(p));
step('the app asks for everyone\'s mailboxes ONCE (it asked once per person)', asked.filter(p => p === '/users-emails').length === 1 && perPerson.length === 1, JSON.stringify(asked));
step('…its own list once (it asked twice)', perPerson.length === 1 && perPerson[0] === '/users/adm/emails');
step('…and the people list once (it asked twice)', asked.filter(p => p === '/users').length === 1);
step('…and fills the shared list for each colleague', sandbox.STATE.userEmailsCache && Array.isArray(sandbox.STATE.userEmailsCache.u0) && sandbox.STATE.userEmailsCache.u0[0].id === 'z');

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
