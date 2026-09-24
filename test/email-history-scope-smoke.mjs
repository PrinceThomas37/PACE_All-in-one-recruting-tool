// Rampart review finding #2 (Session 30): GET /email/history must never let a
// creator-only relationship, or a manager's general team-visibility, stand in
// for the D-0034/D-0036 email-ownership rule (`services/ownership.js`
// `canSeeEmail`: sender's scope, OR the lead's CURRENT owner's scope — never
// "created it" and never "can see the lead"). 105/105 passed with this file
// unguarded against that specific regression.
//
// Drives the REAL routes/email-history.js router, the REAL hierarchy.js chain
// walk, and a real @supabase/supabase-js client answered by a tiny in-memory
// PostgREST interpreter.
//
// Fixture:
//   RA   (role ra)      reports to RAL
//   RAL  (role ra_lead) manager of RA
//   BD   (role bd)      reports to BDM
//   BDM  (role bd_lead) manager of BD
//   ADMIN (role admin)
//
//   J1: created_by = RA,  assigned_to_bd = BD    (RA created it; BD now owns it)
//   J2: created_by = RA,  assigned_to_bd = null  (pool / recycled — BD used to
//                                                  own it, now released)
//
//   E1: on J1, sent_by = BD   — the BD's own cold email on a lead RA created
//   E2: on J2, sent_by = BD   — the BD's email, now sitting on a pool lead
//   E3: on J1, sent_by = RA   — RA's own send, for a positive control
//   E4: on J3, sent_by = BD   — BD's own send on a lead since REASSIGNED to a
//                                different BD (BD2) — rampart's R1: the SQL
//                                select must include `sent_by`, or the sender
//                                loses sight of their own history the moment a
//                                lead moves on. The fake db here PROJECTS rows
//                                to exactly the columns the route's own
//                                `.select(...)` string names, the same way
//                                real PostgREST does — a select that quietly
//                                drops a column makes this test fail, which is
//                                exactly what hid R1 from every other suite.
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const O = 'org1';
const users = [
  { id: 'ADMIN', role: 'admin', manager_id: null },
  { id: 'BDM', role: 'bd_lead', manager_id: null },
  { id: 'BD', role: 'bd', manager_id: 'BDM' },
  { id: 'BD2', role: 'bd', manager_id: 'BDM' },
  { id: 'RAL', role: 'ra_lead', manager_id: null },
  { id: 'RA', role: 'ra', manager_id: 'RAL' },
].map(u => ({ ...u, org_id: O, deleted_at: null }));

const jobs = [
  { id: 'J1', org_id: O, created_by: 'RA', assigned_to_bd: 'BD', assigned_to: null, deleted_at: null },
  { id: 'J2', org_id: O, created_by: 'RA', assigned_to_bd: null, assigned_to: null, deleted_at: null },
  // Reassigned since BD's email went out — now owned by a DIFFERENT BD.
  { id: 'J3', org_id: O, created_by: 'RA', assigned_to_bd: 'BD2', assigned_to: null, deleted_at: null },
].map(j => ({ ...j }));

const emails = [
  { id: 'E1', org_id: O, job_id: 'J1', contact_id: null, sent_by: 'BD', to_email: 'p1@x.com', subject: 'BD email on RA-created lead', body: 'hi {{sender}}', status: 'sent', created_at: '2026-09-20T10:00:00Z' },
  { id: 'E2', org_id: O, job_id: 'J2', contact_id: null, sent_by: 'BD', to_email: 'p2@x.com', subject: 'BD email now on a pool lead', body: 'hi {{sender}}', status: 'sent', created_at: '2026-09-20T11:00:00Z' },
  { id: 'E3', org_id: O, job_id: 'J1', contact_id: null, sent_by: 'RA', to_email: 'p3@x.com', subject: "RA's own send", body: 'hi {{sender}}', status: 'sent', created_at: '2026-09-20T12:00:00Z' },
  { id: 'E4', org_id: O, job_id: 'J3', contact_id: null, sent_by: 'BD', to_email: 'p4@x.com', subject: "BD's send on a lead since reassigned to BD2", body: 'hi {{sender}}', status: 'sent', created_at: '2026-09-20T13:00:00Z' },
];

const DB = { users, jobs, emails, email_tracking: [], candidate_outreach: [] };

function test(row, col, expr) {
  const v = row ? row[col] : undefined;
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  if (op === 'eq') return String(v) === arg;
  if (op === 'is') return arg === 'null' ? v == null : false;
  if (op === 'not') { const [op2, ...r2] = arg.split('.'); return !test(row, col, op2 + '.' + r2.join('.')); }
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  throw new Error('op ' + op);
}

async function fakeFetch(u) {
  const url = new URL(String(u));
  const table = url.pathname.split('/').pop();
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let rows = (DB[table] || []).slice();
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    rows = rows.filter(r => test(r, k, v));
  }
  const ord = url.searchParams.get('order');
  if (ord) {
    const [col, dir] = ord.split('.');
    rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
  }
  const lim = url.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
  // PROJECT to exactly the columns the route asked for — real PostgREST does
  // this, and a select string missing a column (rampart's R1: `emails`
  // missing `sent_by`) must make the caller's downstream logic see that
  // field as `undefined`, not silently fall back to the full row.
  const selectParam = url.searchParams.get('select');
  if (selectParam && selectParam !== '*' && !selectParam.includes('(')) {
    const cols = selectParam.split(',').map(s => s.trim()).filter(Boolean);
    rows = rows.map(r => { const out = {}; for (const c of cols) out[c] = r[c]; return out; });
  }
  return J(rows);
}

const supabase = createClient('http://db.local', 'k', { global: { fetch: fakeFetch }, auth: { persistSession: false } });
const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase });

const orgIdFor = (req) => (req && req.user && req.user.org_id) || null;
const withOrg = (q, req) => { const o = orgIdFor(req); return o ? q.eq('org_id', o) : q; };

const ctx = {
  supabase, hasRole, withOrg, orgIdFor,
  auth: (req, res, next) => {
    const id = req.headers['x-user'];
    const u = users.find(x => x.id === id);
    req.user = { id, role: u.role, roles: [u.role], org_id: O };
    req.orgId = O;
    next();
  },
};

const app = express();
app.use(express.json());
app.use(require(path.join(ROOT, 'routes/email-history.js'))(ctx));
const server = app.listen(0);
const PORT = server.address().port;

function call(user, qs = '') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/email/history?source=leads&days=0' + qs, method: 'GET', headers: { 'x-user': user } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); r.end();
  });
}

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });

(async () => {
  const subjectsFor = async (user) => {
    const r = await call(user);
    if (r.status !== 200) throw new Error(user + ' -> ' + r.status + ' ' + JSON.stringify(r.body));
    return (r.body.items || []).map(i => i.subject);
  };

  const raSubjects = await subjectsFor('RA');
  ok('CANNOT-MEASURE GUARD: RA got a real items array', Array.isArray(raSubjects), raSubjects);
  ok('RA (created J1, does not own it) sees zero of the BD\'s email on it', !raSubjects.includes('BD email on RA-created lead'), raSubjects);
  ok('RA sees their own send', raSubjects.includes("RA's own send"), raSubjects);

  const ralSubjects = await subjectsFor('RAL');
  ok('RA Lead sees zero BD email on a lead their RA created (still BD-owned)', !ralSubjects.includes('BD email on RA-created lead'), ralSubjects);
  ok('RA Lead sees zero BD email on a pool/recycled lead', !ralSubjects.includes('BD email now on a pool lead'), ralSubjects);
  ok('RA Lead still sees their own RA\'s send (positive control)', ralSubjects.includes("RA's own send"), ralSubjects);

  const bdSubjects = await subjectsFor('BD');
  ok('the owning BD sees their own email on the lead they own', bdSubjects.includes('BD email on RA-created lead'), bdSubjects);
  ok('the owning BD sees their own email even after the lead is released to the pool', bdSubjects.includes('BD email now on a pool lead'), bdSubjects);
  ok('R1: the sender still sees their own email after the lead is reassigned to a DIFFERENT BD', bdSubjects.includes('BD\'s send on a lead since reassigned to BD2'), bdSubjects);

  const bdmSubjects = await subjectsFor('BDM');
  ok('the BD\'s manager sees the BD\'s email on the owned lead', bdmSubjects.includes('BD email on RA-created lead'), bdmSubjects);
  ok('the BD\'s manager sees the BD\'s email on the now-pool lead (sender-based)', bdmSubjects.includes('BD email now on a pool lead'), bdmSubjects);

  const adminSubjects = await subjectsFor('ADMIN');
  ok('admin sees all three', ['BD email on RA-created lead', 'BD email now on a pool lead', "RA's own send"].every(s => adminSubjects.includes(s)), adminSubjects);

  const failed = results.filter(x => !x.c);
  for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
