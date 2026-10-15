// AN ADMIN CAN GIVE A NEW COLLEAGUE A WAY IN (owner, 15 Oct 2026: "i created a new user, but i am not able to login")
//   The Add-user window had no password box, so every new user got a random password nobody knew.
//   * Add user with a password → that person can sign in with it, straight away
//   * Add user without one → still a random unknown password (sign-in with Microsoft / Google), nobody can guess in
//   * an admin can set / reset a colleague's password; nobody else can; another company's user is a 404
//   * too short is refused (400) and nothing changes; the hash is never returned
// Usage: node test/user-password-smoke.mjs
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
    { id: 'x1', org_id: 'o2', email: 'x@two.test', roles: ['ra'], role: 'ra', is_active: true, deleted_at: null, password_hash: bcrypt.hashSync('xpass12345', 4) },
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
    neq(c, v) { filters.push((r) => r[c] !== v); return q; },
    order() { return q; }, limit() { return q; },
    insert(r) { mode = 'insert'; row = r; return q; },
    update(p) { mode = 'update'; patch = p; return q; },
    single() { one = 'single'; return q; }, maybeSingle() { one = 'maybe'; return q; },
    then(res, rej) {
      let out;
      T[name] = T[name] || [];
      if (mode === 'insert') { const r = Object.assign({ id: 'new' + (++uid), is_active: true, deleted_at: null }, row); T[name].push(r); out = { data: proj(r), error: null }; }
      else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: one ? hit[0] || null : hit, error: null }; }
      else { const d = rows(); out = one ? (d[0] ? { data: proj(d[0]), error: null } : { data: null, error: one === 'single' ? { message: 'no row' } : null }) : { data: d, error: null }; }
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

console.log('\nAdd a user WITH a password');
let r = await call('POST', '/users', 'adm', { name: 'New Recruiter', email: 'New.Rec@one.test', role: 'ra', password: 'welcome-2026' });
step('the admin can add the user (201)', r.code === 201, JSON.stringify(r.out).slice(0, 100));
step('…the answer never carries the password or its hash', r.out && !('password_hash' in r.out) && !JSON.stringify(r.out).includes('welcome-2026'));
r = await login('new.rec@one.test', 'welcome-2026');
step('…and they can sign in with it straight away', r.code === 200 && !!(r.out && r.out.token), 'code ' + r.code);
r = await login('new.rec@one.test', 'wrong-password');
step('…a wrong password is still refused (401)', r.code === 401);

console.log('\nAdd a user WITHOUT a password');
r = await call('POST', '/users', 'adm', { name: 'Sso Person', email: 'sso@one.test', role: 'bd' });
step('still allowed (201) — they use Microsoft / Google', r.code === 201);
r = await login('sso@one.test', 'anything-at-all');
step('…but nobody can guess a password in (401)', r.code === 401);
r = await call('POST', '/users', 'adm', { name: 'Short Pw', email: 'short@one.test', role: 'ra', password: 'abc' });
step('a too-short password is refused (400) and no user is made', r.code === 400 && !T.users.some((u) => u.email === 'short@one.test'));

console.log('\nSet / reset a password');
const sso = T.users.find((u) => u.email === 'sso@one.test');
r = await call('PUT', `/users/${sso.id}/password`, 'adm', { password: 'brand-new-pass' });
step('the admin sets one for the Microsoft/Google-only person (200)', r.code === 200 && r.out && r.out.success === true);
r = await login('sso@one.test', 'brand-new-pass');
step('…and they can now sign in with it', r.code === 200);
r = await call('PUT', `/users/${sso.id}/password`, 'adm', { password: 'short' });
step('too short is refused (400)…', r.code === 400);
r = await login('sso@one.test', 'brand-new-pass');
step('…and the old password still works (nothing changed)', r.code === 200);
r = await call('PUT', `/users/${sso.id}/password`, 'bd1', { password: 'taken-over-1' });
step('a non-admin cannot set anyone\'s password (403)', r.code === 403);
r = await login('sso@one.test', 'taken-over-1');
step('…and it did not change', r.code === 401);
r = await call('PUT', '/users/x1/password', 'adm', { password: 'cross-org-pass' });
step('another company\'s user is a plain 404', r.code === 404);
r = await login('x@two.test', 'cross-org-pass');
step('…and their password did not change', r.code === 401);
r = await call('PUT', `/users/${sso.id}/password`, null, { password: 'no-token-pass' });
step('signed out is refused (401)', r.code === 401);

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
