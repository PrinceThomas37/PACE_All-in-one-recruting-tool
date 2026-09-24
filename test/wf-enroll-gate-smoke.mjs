// R47-1 — `POST /wf/enroll` and `/wf/enroll-bulk` used to check nothing about
// `job_id`/`entity_id`/`workflow_id`: own contact + a colleague's (or another
// org's) `job_id` + `any_stage:true` produced a queued email from the
// colleague's mailbox, filled with THAT lead's position/company, sent under
// the caller's name. `gateEnrollTarget` (routes/wf.js) closes it. Every miss
// answers the SAME 404 (law 3) — a foreign/unowned id must read exactly like
// a missing one.
//
// Drives the REAL router (not `gateEnrollTarget` directly, and not
// `wfEngine.enroll` directly) through a real Express app + a tiny in-memory
// fake supabase.
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));

const ORG = 'org1', FOREIGN = 'org2';
const users = [
  { id: 'BD', role: 'bd', manager_id: null },
  { id: 'BD2', role: 'bd', manager_id: null },
  { id: 'RA_LEAD', role: 'ra_lead', manager_id: null },
  { id: 'ADMIN', role: 'admin', manager_id: null },
  { id: 'RECRUITER', role: 'recruiter', manager_id: null },
].map(u => ({ ...u, org_id: ORG, deleted_at: null, is_active: true, name: u.id }));

const JOBS = [
  { id: 'J1', org_id: ORG, assigned_to_bd: 'BD', stage: 'Assigned', deleted_at: null },
  { id: 'J1B', org_id: ORG, assigned_to_bd: 'BD', stage: 'Assigned', deleted_at: null }, // BD's OTHER lead
  { id: 'J2', org_id: ORG, assigned_to_bd: 'BD2', stage: 'Assigned', deleted_at: null }, // colleague's
  { id: 'J_POOL', org_id: ORG, assigned_to_bd: null, stage: 'Unassigned', deleted_at: null },
];
const CONTACTS = [
  { id: 'C1', org_id: ORG, job_id: 'J1' },      // BD's own contact
  { id: 'C2', org_id: ORG, job_id: 'J2' },      // colleague's contact
  { id: 'C_POOL', org_id: ORG, job_id: 'J_POOL' },
  { id: 'C_NO_JOB', org_id: ORG, job_id: null },
  { id: 'C_FOREIGN', org_id: FOREIGN, job_id: null },
];
const WORKFLOW_DEFINITIONS = [
  { id: 'WF1', org_id: ORG, entity_type: 'contact', status: 'active' },
  { id: 'WF_FOREIGN', org_id: FOREIGN, entity_type: 'contact', status: 'active' },
];
const SUBMISSIONS = [
  { id: 'SUB1', org_id: ORG, job_order_id: 'JO1' },
  { id: 'SUB_FOREIGN', org_id: FOREIGN, job_order_id: 'JO_FOREIGN' },
];
const CANDIDATES = [
  { id: 'CAND1', org_id: ORG },
  { id: 'CAND_FOREIGN', org_id: FOREIGN },
];
const RECRUITER_ASSIGNMENTS = [
  { recruiter_id: 'RECRUITER', job_order_id: 'JO1' },
];

const TABLES = {
  users, jobs: JOBS, contacts: CONTACTS, workflow_definitions: WORKFLOW_DEFINITIONS,
  submissions: SUBMISSIONS, candidates: CANDIDATES, recruiter_assignments: RECRUITER_ASSIGNMENTS,
  user_emails: [], microsoft_tokens: [], workflow_enrollments: [],
};

// ── tiny fake postgrest builder (same shape as the ownership-requests one) ──
class QB {
  constructor(rowsRef, mode, payload) {
    this.rowsRef = rowsRef; this.mode = mode; this.payload = payload;
    this.filters = []; this.selectCols = null; this.singleMode = null;
    this.orderCol = null; this.orderAsc = true; this.limitN = null;
    this.countMode = null; this.headOnly = false;
  }
  select(cols, opts) { this.selectCols = cols || '*'; if (opts && opts.count) this.countMode = opts.count; if (opts && opts.head) this.headOnly = true; return this; }
  eq(col, val) { this.filters.push(r => r[col] === val); return this; }
  neq(col, val) { this.filters.push(r => r[col] !== val); return this; }
  is(col, val) { this.filters.push(r => (val === null || val === 'null') ? (r[col] === null || r[col] === undefined) : r[col] === val); return this; }
  in(col, arr) { this.filters.push(r => arr.includes(r[col])); return this; }
  order(col, o) { this.orderCol = col; this.orderAsc = !(o && o.ascending === false); return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this; }
  single() { this.singleMode = 'single'; return this; }
  match() { const rows = this.rowsRef.filter(r => this.filters.every(f => f(r))); return this.limitN != null ? rows.slice(0, this.limitN) : rows; }
  then(resolve, reject) { try { resolve(this._exec()); } catch (e) { if (reject) reject(e); else throw e; } }
  _exec() {
    if (this.mode === 'select') {
      const rows = this.match();
      if (this.countMode) return { data: this.headOnly ? null : rows, error: null, count: rows.length };
      if (this.singleMode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
      if (this.singleMode === 'maybeSingle') return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (this.mode === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      rows.forEach(r => { r.id = r.id || (this.table + '_' + (this.rowsRef.length + 1)); this.rowsRef.push(r); });
      return { data: rows, error: null };
    }
  }
}
function tableFor(name) { if (!TABLES[name]) TABLES[name] = []; return TABLES[name]; }
const fakeSupabase = {
  from(table) {
    const rows = tableFor(table);
    const mk = (mode, payload) => { const q = new QB(rows, mode, payload); q.table = table; return q; };
    return { select: (c, o) => mk('select').select(c, o), insert: (p) => mk('insert', p) };
  },
};

const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase: fakeSupabase });
const enrollCalls = [];
const engine = {
  listChannels: () => ['email'],
  enroll: async (opts) => { enrollCalls.push(opts); return { id: 'enr_' + enrollCalls.length, ...opts }; },
};
const logCalls = [];
const ctx = {
  supabase: fakeSupabase, hasRole, engine,
  logActivity: async (...args) => { logCalls.push(args); },
  auth: (req, res, next) => {
    const id = req.headers['x-user'];
    const u = users.find(x => x.id === id);
    if (!u) return res.status(401).json({ error: 'no such fixture user' });
    req.user = { id, role: u.role, roles: [u.role], org_id: u.org_id };
    req.orgId = u.org_id;
    next();
  },
};
const app = express();
app.use(express.json());
app.use(require(path.join(ROOT, 'routes/wf.js'))(ctx));
const server = app.listen(0);
const PORT = server.address().port;

function call(user, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers: Object.assign({ 'x-user': user }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });

(async () => {
  // CANNOT-MEASURE GUARD
  ok('CANNOT-MEASURE GUARD: server actually answers', (await call('BD', 'GET', '/wf/channels')).status === 200);

  // ── 1. own contact + a colleague's job_id -> 404 ────────────────────────
  {
    const r = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C1', job_id: 'J2' });
    ok('own contact + colleague\'s job_id -> 404', r.status === 404, r.body);
    ok('nothing was enrolled', !enrollCalls.length, enrollCalls);
  }

  // ── 2. job_id not the contact's own (even one the caller DOES own) -> 404 ──
  {
    const r = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C1', job_id: 'J1B' });
    ok('job_id not the contact\'s own (even BD\'s own OTHER lead) -> 404', r.status === 404, r.body);
    ok('still nothing enrolled', !enrollCalls.length, enrollCalls);
  }

  // sanity: the SAME contact + its OWN job_id (or no job_id at all) succeeds
  {
    const r = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C1', job_id: 'J1' });
    ok('sanity: own contact + its OWN job_id succeeds', r.status === 200 && enrollCalls.length === 1, r.body);
    const r2 = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C1' });
    ok('sanity: own contact with no job_id passed (derived from the contact) succeeds', r2.status === 200 && enrollCalls.length === 2, r2.body);
    enrollCalls.length = 0;
  }

  // ── 3. pool lead: ra_lead/admin ok, plain BD 404 ────────────────────────
  {
    const rBd = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C_POOL' });
    ok('a plain BD cannot enroll a pool-lead contact -> 404', rBd.status === 404, rBd.body);
    const rRal = await call('RA_LEAD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C_POOL' });
    ok('ra_lead CAN enroll a pool-lead contact', rRal.status === 200, rRal.body);
    const rAdmin = await call('ADMIN', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'contact', entity_id: 'C_POOL' });
    ok('admin CAN enroll a pool-lead contact', rAdmin.status === 200, rAdmin.body);
    enrollCalls.length = 0;
  }

  // ── 4. foreign workflow / submission / candidate id -> 404 ─────────────
  {
    const r = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF_FOREIGN', entity_type: 'contact', entity_id: 'C1' });
    ok('a foreign-org workflow_id -> 404 (never reveals it exists elsewhere)', r.status === 404, r.body);

    const r2 = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'submission', entity_id: 'SUB_FOREIGN' });
    ok('a foreign-org submission entity_id -> 404', r2.status === 404, r2.body);

    const r3 = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'candidate', entity_id: 'CAND_FOREIGN' });
    ok('a foreign-org candidate entity_id -> 404', r3.status === 404, r3.body);

    // positive controls: the SAME kinds, same-org, succeed
    const r4 = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'submission', entity_id: 'SUB1' });
    ok('sanity: a same-org submission (job order owned/touchable) enrolls fine', r4.status === 200, r4.body);
    const r5 = await call('BD', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'candidate', entity_id: 'CAND1' });
    ok('sanity: a same-org candidate enrolls fine', r5.status === 200, r5.body);
    enrollCalls.length = 0;
  }

  // ── bonus: a plain RECRUITER not assigned to the submission's job order ──
  {
    const r = await call('RECRUITER', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'submission', entity_id: 'SUB1' });
    ok('recruiter assigned to SUB1\'s job order (JO1) can enroll', r.status === 200, r.body);
    enrollCalls.length = 0;
    // remove the assignment to prove the negative
    RECRUITER_ASSIGNMENTS.length = 0;
    const r2 = await call('RECRUITER', 'POST', '/wf/enroll', { workflow_id: 'WF1', entity_type: 'submission', entity_id: 'SUB1' });
    ok('recruiter NOT assigned to the submission\'s job order -> 404', r2.status === 404, r2.body);
    RECRUITER_ASSIGNMENTS.push({ recruiter_id: 'RECRUITER', job_order_id: 'JO1' });
    enrollCalls.length = 0;
  }

  // ── 5. bulk refuses PER ITEM, not the whole request ─────────────────────
  {
    const r = await call('BD', 'POST', '/wf/enroll-bulk', {
      workflow_id: 'WF1', entity_type: 'contact',
      items: [
        { entity_id: 'C1', job_id: 'J1' },        // valid: own contact + own job
        { entity_id: 'C1', job_id: 'J2' },        // invalid: colleague's job_id
        { entity_id: 'C_POOL' },                  // invalid for a plain BD: pool
        { entity_id: 'C2' },                      // invalid: colleague's own contact
      ],
    });
    ok('bulk enroll answers 200 even with bad items mixed in (per-item, not all-or-nothing)', r.status === 200, r.body);
    ok('exactly one item enrolled (the valid one)', r.body.enrolled === 1 && enrollCalls.length === 1, r.body);
    ok('exactly three items reported as per-item errors', r.body.errors && r.body.errors.length === 3, r.body);
    ok('the errors name the SAME entity_id they failed on', r.body.errors.every(e => e.entity_id), r.body.errors);
    enrollCalls.length = 0;
  }

  const failed = results.filter(x => !x.c);
  for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
