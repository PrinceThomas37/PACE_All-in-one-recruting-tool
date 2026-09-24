// D-0034 / C-0027 — GET /jobs, GET /jobs/export and GET /jobs/:id through the
// REAL router (routes/jobs.js), the REAL reporting-chain walk (hierarchy.js)
// and the REAL supabase-js query builder (answered by a tiny in-memory
// PostgREST interpreter, the same technique observatory used for C-0024).
//
// The fixture is the live org shape the owner measured when reporting the bug
// (docs/territories/DECISIONS.md D-0034): "BD Lead 1 owns 25 leads and saw 49"
// — `GET /jobs` used to hand every `bd_lead` every ASSIGNED lead in the whole
// org. This suite pins the fix at the HTTP boundary, not just the pure rule
// (that is `test/ownership-smoke.mjs`'s job) — a route can call the right
// function on the wrong input, or forget to call it at all, and only an
// end-to-end request proves it didn't.
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const O = 'org-A';
const OTHER = 'org-B';

// BD Lead 1 (bdl) manages bd2/bd3/bd4/bd10 (D-0034's own chain, mirrored from
// rampart's scratch fixture). 25 leads assigned to bdl's chain, 24 to a
// second, unrelated BD Lead (bdl2) who reports to nobody in bdl's tree, and
// 10 unassigned (the pool) split between two RAs.
const users = [
  { id: 'adm', role: 'admin', manager_id: null },
  { id: 'bdl', role: 'bd_lead', manager_id: null },
  { id: 'bd2', role: 'bd', manager_id: 'bdl' },
  { id: 'bd3', role: 'bd', manager_id: 'bdl' },
  { id: 'bdl2', role: 'bd_lead', manager_id: null },
  { id: 'bd5', role: 'bd', manager_id: 'bdl2' },
  { id: 'ral', role: 'ra_lead', manager_id: null },
  { id: 'ra1', role: 'ra', manager_id: 'ral' },
].map(u => ({ ...u, org_id: O, deleted_at: null }));

const jobs = [];
for (let i = 0; i < 15; i++) jobs.push({ id: `a${i}`, assigned_to_bd: 'bdl', created_by: 'ra1', assigned_to: null, stage: 'Assigned', org_id: O, position: 'P' });
for (let i = 0; i < 10; i++) jobs.push({ id: `b${i}`, assigned_to_bd: 'bd2', created_by: 'ra1', assigned_to: null, stage: 'Assigned', org_id: O, position: 'P' });
// Created by a DIFFERENT researcher (not ral's report), so RA Lead's sight of
// it can only come from the pool grant or the chain — never a false "research"
// hit — proving the scope is bounded, not just "everything happens to match".
for (let i = 0; i < 24; i++) jobs.push({ id: `c${i}`, assigned_to_bd: 'bdl2', created_by: 'other-ra', assigned_to: null, stage: 'Assigned', org_id: O, position: 'P' });
for (let i = 0; i < 10; i++) jobs.push({ id: `p${i}`, assigned_to_bd: null, created_by: 'ra1', assigned_to: null, stage: 'Unassigned', org_id: O, position: 'P' });
// A foreign org's lead — must never appear to anyone in org A, including admin.
jobs.push({ id: 'foreign', assigned_to_bd: 'ghost', created_by: 'ghost', assigned_to: null, stage: 'Assigned', org_id: OTHER, position: 'Foreign' });

const DB = { users, jobs, app_settings: [] };

function likeRe(p) { return new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); }
function test(row, col, expr) {
  const v = row ? row[col] : undefined;
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  if (op === 'eq') return String(v) === arg;
  if (op === 'is') return arg === 'null' ? v == null : false;
  if (op === 'gte') return v >= arg;
  if (op === 'lte') return v <= arg;
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  if (op === 'ilike') return v != null && likeRe(arg).test(String(v));
  throw new Error('op ' + op);
}
async function fakeFetch(u, init = {}) {
  const url = new URL(String(u));
  const table = url.pathname.split('/').pop();
  const method = (init.method || 'GET').toUpperCase();
  const hdr = init.headers || {};
  const get = (k) => (typeof hdr.get === 'function' ? hdr.get(k) : hdr[k] || hdr[k.toLowerCase()]);
  const wantObj = /vnd\.pgrst\.object/.test(get('Accept') || '');
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let rows = (DB[table] || []).slice();
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    rows = rows.filter(r => test(r, k, v));
  }
  if (wantObj) return rows.length === 1 ? J(rows[0]) : J({ code: 'PGRST116', message: 'no rows' }, 406);
  return J(rows);
}

const supabase = createClient('http://db.local', 'key', { global: { fetch: fakeFetch }, auth: { persistSession: false } });
const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase });
const orgIdFor = (req) => (req && req.user && req.user.org_id) || null;
const withOrg = (q, req) => { const o = orgIdFor(req); return o ? q.eq('org_id', o) : q; };
const orgStamp = (req) => { const o = orgIdFor(req); return o ? { org_id: o } : {}; };

// Deliberately bypasses supabase for the list endpoint — mirrors index.js's
// real loadAllJobs contract (org-scoped array in, no cross-org rows) without
// needing the query-builder for it; /jobs/:id and /jobs/export still go
// through the real supabase-js client above.
async function loadAllJobs(orgId) { return jobs.filter(j => j.org_id === orgId); }

const ctx = {
  supabase, auth: (req, res, next) => {
    const u = users.find(x => x.id === req.headers['x-user']);
    if (!u) return res.status(401).json({ error: 'no user' });
    req.user = { id: u.id, org_id: u.org_id, role: u.role, roles: [u.role] };
    req.orgId = u.org_id;
    next();
  },
  hasRole, today: () => '2026-09-24', logActivity: async () => {}, canTouchJob: async () => true,
  loadAllJobs, JOB_SELECT: 'id,org_id,assigned_to_bd,created_by,assigned_to,stage,position',
  getTimezoneFromLocation: () => 'EST', persistLearnedSkills: async () => {},
  orgIdFor, withOrg, orgStamp, userOrgId: async () => O, mailboxOrgId: async () => O,
};

const app = express();
app.use(express.json());
app.use(require(path.join(ROOT, 'routes/jobs.js'))(ctx));
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
function call(who, method, p) {
  return new Promise((resolve, reject) => {
    const rq = http.request(base + p, { method, headers: { 'x-user': who } }, (res) => {
      let out = ''; res.on('data', d => { out += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(out || 'null'); } catch (_) { json = out; } resolve({ status: res.statusCode, json }); });
    });
    rq.on('error', reject); rq.end();
  });
}

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const ids = (r) => Array.isArray(r.json) ? r.json.map(j => j.id).sort() : null;

try {
  // ── GET /jobs ──────────────────────────────────────────────────────────
  const bdl = await call('bdl', 'GET', '/jobs');
  ok('BD Lead sees exactly self + chain: 15 own + bd2\'s 10 = 25, never the org\'s 59 assigned (the shape of the live bug: 25 owned, 49 seen)',
    ids(bdl).length === 25 && ids(bdl).every(id => id[0] === 'a' || id[0] === 'b'),
    `n=${ids(bdl).length}`);
  ok('...and never sees bdl2\'s 24 (a DIFFERENT bd_lead\'s chain, not the role\'s org-wide slice)',
    !ids(bdl).some(id => id[0] === 'c'));
  ok('...and never sees the pool (bd_lead does not distribute)', !ids(bdl).some(id => id[0] === 'p'));
  ok('...and never a foreign org\'s lead', !ids(bdl).includes('foreign'));

  const bdl2 = await call('bdl2', 'GET', '/jobs');
  ok('the OTHER BD Lead sees exactly their own chain (24), not bdl\'s 25', ids(bdl2).length === 24 && ids(bdl2).every(id => id[0] === 'c'));

  const bd2 = await call('bd2', 'GET', '/jobs');
  ok('a BD under bdl sees only their own 10 (a report, not a manager)', ids(bd2).length === 10 && ids(bd2).every(id => id[0] === 'b'));

  const admin = await call('adm', 'GET', '/jobs');
  ok('admin sees the whole org (59) and never org B', ids(admin).length === 59 && !ids(admin).includes('foreign'), `n=${ids(admin).length}`);

  const ral = await call('ral', 'GET', '/jobs');
  ok('RA Lead sees the pool (10) + what their own RA (ra1) researched (25) = 35 — never bdl2\'s 24, which a different researcher created',
    ids(ral).length === 35 && !ids(ral).some(id => id[0] === 'c'), `n=${ids(ral).length}`);

  // ── GET /jobs/:id — 404, never 403, for anything out of scope ───────────
  const own = await call('bdl', 'GET', '/jobs/a0');
  ok('own lead by id: 200', own.status === 200);
  const foreignOrg = await call('bdl', 'GET', '/jobs/foreign');
  ok('foreign ORG lead by id: 404', foreignOrg.status === 404);
  const outOfScope = await call('bdl', 'GET', '/jobs/c0');
  ok('same-org, out-of-CHAIN lead by id: 404 (not just a foreign-org 404)', outOfScope.status === 404);
  const adminForeign = await call('adm', 'GET', '/jobs/foreign');
  ok('even admin gets 404 on a foreign ORG lead by id', adminForeign.status === 404);

  // ── GET /jobs/export — same D-0034 scope as GET /jobs ────────────────────
  const exportRal = await call('ral', 'GET', '/jobs/export');
  ok('export is scoped the same way as the list (ra_lead: 35)', ids(exportRal).length === 35, `n=${ids(exportRal).length}`);
  const exportBd = await call('bd2', 'GET', '/jobs/export');
  ok('export refuses a plain BD (RA Lead / admin only)', exportBd.status === 403);
} finally {
  server.close();
}

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
