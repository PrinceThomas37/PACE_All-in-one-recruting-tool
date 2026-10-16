// AN ADMIN CAN BRING A DEACTIVATED PERSON BACK (owner, 16 Oct 2026: "where can we see activate button if a user is deactivated?")
//   Deactivate only hides a person (deleted_at); nothing could undo it. Now: GET /users/deactivated lists them (admin only, own company only),
//   POST /users/:id/reactivate restores sign-in and the roster. Not admin = 403; another company's user = 404.
// Usage: node test/user-deactivated-smoke.mjs
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
    { id: 'adm', org_id: 'o1', email: 'adm@one.test', roles: ['admin'], role: 'admin', is_active: true, deleted_at: null, password_hash: bcrypt.hashSync('adminpass1', 4) },
    { id: 'bd1', org_id: 'o1', email: 'bd@one.test', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null, password_hash: bcrypt.hashSync('bdpass1234', 4) },
    { id: 'gone1', org_id: 'o1', email: 'gone@one.test', roles: ['bd'], role: 'bd', is_active: false, deleted_at: '2026-10-10T00:00:00Z', password_hash: bcrypt.hashSync('gonepass12', 4) },
    { id: 'x1', org_id: 'o2', email: 'x@two.test', roles: ['ra'], role: 'ra', is_active: false, deleted_at: '2026-10-11T00:00:00Z', password_hash: bcrypt.hashSync('xpass12345', 4) },
  ],
  app_settings: [], user_emails: [],
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
const login = (email, password) => call('POST', '/auth/login', null, { email, password });

console.log('\nThe deactivated list');
let r = await call('GET', '/users/deactivated', 'adm');
step('an admin sees the deactivated person of their company', r.code === 200 && r.out.length === 1 && r.out[0].id === 'gone1', JSON.stringify(r.out).slice(0, 120));
step('…never another company\'s', !JSON.stringify(r.out).includes('x1'));
step('…and no password hash', !JSON.stringify(r.out).includes('password_hash'));
r = await call('GET', '/users/deactivated', 'bd1');
step('a non-admin is refused (403)', r.code === 403);

console.log('\nReactivate');
r = await login('gone@one.test', 'gonepass12');
step('before: they cannot sign in', r.code !== 200);
r = await call('POST', '/users/gone1/reactivate', 'bd1');
step('a non-admin cannot reactivate (403)', r.code === 403);
r = await call('POST', '/users/x1/reactivate', 'adm');
step('another company\'s user is a 404 and stays deactivated', r.code === 404 && T.users.find((u) => u.id === 'x1').deleted_at);
r = await call('POST', '/users/gone1/reactivate', 'adm');
step('an admin reactivates (200)', r.code === 200 && r.out.id === 'gone1' && r.out.is_active === true, JSON.stringify(r.out).slice(0, 100));
step('…the answer carries no hash', !JSON.stringify(r.out).includes('password_hash'));
r = await login('gone@one.test', 'gonepass12');
step('…they can sign in again', r.code === 200 && !!(r.out && r.out.token), 'code ' + r.code);
r = await call('GET', '/users', 'adm');
step('…and are back on the roster', r.out.some((u) => u.id === 'gone1'));
r = await call('GET', '/users/deactivated', 'adm');
step('…and off the deactivated list', r.out.length === 0);

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
