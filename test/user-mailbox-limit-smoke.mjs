// A MAILBOX'S DAILY LIMIT CAN BE CHANGED, AND EVERY CHANGE IS RECORDED (owner, 19 Oct 2026, R-266)
//   Admin / team lead: any whole number from 1 (no top in code). The mailbox's own person: lower only. Anyone else: refused.
//   Each change writes who / from / to to record_history; an admin reads them at GET /users/email-limit-changes (own company only).
//   A number above the admin's warning line still saves and comes back with a plain warning.
// Usage: node test/user-mailbox-limit-smoke.mjs
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
    { id: 'x1', org_id: 'o2', email: 'x@two.test', roles: ['ra'], role: 'ra', is_active: false, deleted_at: '2026-10-11T00:00:00Z', password_hash: bcrypt.hashSync('xpass12345', 4) },
  ],
  app_settings: [{ key: 'default_daily_send_limit', value: '30' }, { key: 'daily_limit_warn_above', value: '400' }], record_history: [],
  user_emails: [
    { id: 'm1', org_id: 'o1', user_id: 'bd1', email_address: 'bd@box.test', daily_send_limit: 100, is_active: true },
    { id: 'm2', org_id: 'o2', user_id: 'x1', email_address: 'x@box.test', daily_send_limit: 50, is_active: true },
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
const login = (email, password) => call('POST', '/auth/login', null, { email, password });


const rules = require('../services/mailbox-limit.js');
console.log('\nThe rule');
step('staff: any whole number', rules.decideLimitChange({ staff: true, requested: 4000 }).ok);
step('staff: zero / decimal / text refused', [0, 1.5, 'abc', -3, null].every((v) => !rules.decideLimitChange({ staff: true, requested: v }).ok));
step('owner may lower', rules.decideLimitChange({ owner: true, current: 100, requested: 40 }).ok);
step('owner may not raise', rules.decideLimitChange({ owner: true, current: 100, requested: 101 }).status === 403);
step('…and the refusal names the number to stay under', /100/.test(rules.decideLimitChange({ owner: true, current: 100, requested: 101 }).error));
step('someone else is refused', rules.decideLimitChange({ requested: 5 }).status === 403);
step('a warning above the line, none at it', !!rules.decideLimitChange({ staff: true, requested: 401, warnAbove: 400 }).warn && !rules.decideLimitChange({ staff: true, requested: 400, warnAbove: 400 }).warn);

console.log('\nChanging a limit');
let r = await call('PATCH', '/users/bd1/emails/m1', 'adm', { daily_send_limit: 300 });
step('an admin sets 300', r.code === 200 && T.user_emails[0].daily_send_limit === 300, JSON.stringify(r.out).slice(0, 80));
step('…no warning under the line', !r.out.limit_warning);
r = await call('PATCH', '/users/bd1/emails/m1', 'adm', { daily_send_limit: 900 });
step('an admin may go high; it saves with a warning', r.code === 200 && T.user_emails[0].daily_send_limit === 900 && /900/.test(r.out.limit_warning || ''));
r = await call('PATCH', '/users/bd1/emails/m1', 'adm', { daily_send_limit: 0 });
step('zero is refused and nothing changes', r.code === 400 && T.user_emails[0].daily_send_limit === 900);
r = await call('PATCH', '/users/bd1/emails/m1', 'bd1', { daily_send_limit: 1000 });
step('the mailbox\'s person cannot raise it', r.code === 403 && T.user_emails[0].daily_send_limit === 900);
r = await call('PATCH', '/users/bd1/emails/m1', 'bd1', { daily_send_limit: 120 });
step('…but can lower it', r.code === 200 && T.user_emails[0].daily_send_limit === 120);
r = await call('PATCH', '/users/bd1/emails/m1', 'bd2', { daily_send_limit: 10 });
step('another person cannot touch it', r.code === 403 && T.user_emails[0].daily_send_limit === 120);
r = await call('PATCH', '/users/x1/emails/m2', 'adm', { daily_send_limit: 10 });
step('another company\'s mailbox is refused', r.code >= 400 && T.user_emails[1].daily_send_limit === 50, 'code ' + r.code);

console.log('\nAdding a mailbox');
r = await call('POST', '/users/bd1/emails', 'adm', { email_address: 'new@box.test', sends_as: { title: 'BD', company: 'One', address: '1 Main St, Austin TX' } });
step('with no number typed, it starts at the company default (30)', r.code === 201 && r.out.daily_send_limit === 30, JSON.stringify(r.out).slice(0, 100));
r = await call('POST', '/users/bd1/emails', 'adm', { email_address: 'two@box.test', daily_send_limit: 250, sends_as: { title: 'BD', company: 'One', address: '1 Main St, Austin TX' } });
step('an admin\'s own number is kept', r.code === 201 && r.out.daily_send_limit === 250);
r = await call('POST', '/users/bd1/emails', 'bd1', { email_address: 'three@box.test', daily_send_limit: 5000, sends_as: { title: 'BD', company: 'One', address: '1 Main St, Austin TX' } });
step('a person adding their own gets the default, not what they typed', r.code === 201 && r.out.daily_send_limit === 30);

console.log('\nThe change log');
r = await call('GET', '/users/email-limit-changes', 'adm');
const rows = r.out || [];
step('an admin reads it', r.code === 200 && rows.length >= 4, 'rows ' + rows.length);
const last = rows.find((x) => x.to === 120);
step('…it says who, from, to and which mailbox', last && last.by === 'Bea' && last.from === 900 && last.mailbox === 'bd@box.test', JSON.stringify(last));
step('…the refused changes left no line', !rows.some((x) => x.to === 1000 || x.to === 0 || x.to === 10));
step('…no other company\'s', !rows.some((x) => x.mailbox === 'x@box.test'));
r = await call('GET', '/users/email-limit-changes', 'bd1');
step('a non-admin is refused', r.code === 403);

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
