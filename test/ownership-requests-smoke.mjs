// ============================================================================
// Take-over requests (R-047 / D-0036 / D-0037 / D-0038) — the database and
// route half. Adapted from gateway's scratch harness; the pure rule cases
// (canRequestTakeover / approverFor / canDecide / canCancel / transitions)
// live separately in `test/takeover-rule-smoke.mjs`.
//
// Drives the REAL routes/ownership-requests.js + the REAL services/ownership.js
// + the REAL models/index.js db layer + the REAL hierarchy.js chain walk,
// against a tiny hand-rolled in-memory "supabase" (not the real @supabase/
// supabase-js client — this fake implements just enough of the chainable
// builder: select/eq/neq/is/in/order/limit/single/maybeSingle/insert/update/
// delete, and PROJECTS every row to the columns the route's own .select(...)
// string names, the same discipline email-history-scope-smoke.mjs uses, so a
// select that quietly drops a column fails this test rather than passing it
// by accident).
// ============================================================================
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));

// ── fixture ──────────────────────────────────────────────────────────────
const O = 'org1';
const now = () => new Date().toISOString();

const users = [
  { id: 'ADMIN', role: 'admin', manager_id: null },
  { id: 'ADMIN2', role: 'admin', manager_id: null, created_at: '2020-01-01T00:00:00Z' }, // longest-serving
  { id: 'BDM', role: 'bd_lead', manager_id: null },       // manages BD, BD2
  { id: 'BD', role: 'bd', manager_id: 'BDM' },
  { id: 'BD2', role: 'bd', manager_id: 'BDM' },
  { id: 'BDM_OTHER', role: 'bd_lead', manager_id: null }, // a different team
  { id: 'BD3', role: 'bd', manager_id: 'BDM_OTHER' },
  { id: 'ADMIN', role: 'admin', manager_id: null },       // no manager -> falls to admin
].map(u => ({ ...u, org_id: O, deleted_at: null, is_active: true, created_at: u.created_at || '2026-01-01T00:00:00Z', name: u.id }));
// de-dupe ADMIN (listed twice above for clarity of both properties)
const seen = new Set();
const USERS = users.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));

const JOBS = [
  // owned by BD, BD's manager is BDM -> approver should be BDM
  { id: 'J_BD', org_id: O, company_id: 'C1', position: 'Estimator', stage: 'Assigned', assigned_to_bd: 'BD', created_by: 'RA', assigned_to: null, deleted_at: null },
  // unowned (pool). `assigned_to: BD2` only so BD2 can SEE it without being
  // admin/ra_lead (D-0034's pool-sight rule) — a BD does not normally see the
  // pool at all, which is itself the finding worth reporting: no role that can
  // OWN a lead (bd/bd_lead) can normally SEE an unowned one, so "ask to take
  // over an unowned lead" is reachable only through this side door (a BD who
  // is the lead's `assigned_to` researcher) or via the duplicate-email path.
  { id: 'J_POOL', org_id: O, company_id: 'C1', position: 'Super', stage: 'Unassigned', assigned_to_bd: null, created_by: 'RA', assigned_to: 'BD2', deleted_at: null },
  // A separate lead, at a separate company, ONLY for the concurrent-race
  // test below — kept apart from J_BD/C1 so the race's reassignment cannot
  // change how many leads the later client-take-over test expects to move.
  { id: 'J_RACE', org_id: O, company_id: 'C_RACE', position: 'Racer', stage: 'Assigned', assigned_to_bd: 'BD', created_by: 'RA', assigned_to: null, deleted_at: null },
];
const JOB_ORDERS = [
  { id: 'JO_BD3', org_id: O, company_id: 'C1', job_title: 'PM', bd_manager_id: 'BD3', deleted_at: null },
];
const COMPANIES = [
  { id: 'C1', org_id: O, name: 'Acme Co', created_by: 'RA', deleted_at: null },
  { id: 'C_RACE', org_id: O, name: 'Race Co', created_by: 'RA', deleted_at: null },
];
const CONTACTS = [
  { id: 'CT1', org_id: O, job_id: 'J_BD', email: 'poc@acme.com' },
  { id: 'CT_RACE', org_id: O, job_id: 'J_RACE', email: 'race@raceco.com' },
];
const OWNERSHIP_REQUESTS = [];
const USER_EMAILS = [];      // nobody has a connected mailbox in this fixture
const MS_TOKENS = [];
const GMAIL_TOKENS = [];
const EMAIL_SEND_LOG = [];

const TABLES = {
  users: USERS, jobs: JOBS, job_orders: JOB_ORDERS, companies: COMPANIES, contacts: CONTACTS,
  ownership_requests: OWNERSHIP_REQUESTS, user_emails: USER_EMAILS,
  microsoft_tokens: MS_TOKENS, gmail_tokens: GMAIL_TOKENS, email_send_log: EMAIL_SEND_LOG,
};

// ── tiny fake postgrest builder ──────────────────────────────────────────
function splitTopLevel(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
function project(row, colsStr) {
  if (!row) return row;
  if (!colsStr || colsStr === '*') return { ...row };
  const out = {};
  for (const c of splitTopLevel(colsStr)) {
    const m = c.match(/^(\w+):(\w+)\(([^]*)\)$/);
    if (m) {
      const [, alias, table, inner] = m;
      const fkCol = alias + '_id';
      const rel = (TABLES[table] || []).find(t => t.id === row[fkCol]);
      out[alias] = rel ? project(rel, inner) : null;
    } else {
      out[c] = row[c];
    }
  }
  return out;
}

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
  ilike(col, pattern) {
    // Minimal PostgREST ilike: '%' -> '.*', everything else literal & escaped,
    // case-insensitive — resolveLeadByEmail passes a plain (non-wildcard)
    // string today, so this only needs to match that exactly, case-folded.
    const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
    this.filters.push(r => typeof r[col] === 'string' && re.test(r[col]));
    return this;
  }
  order(col, o) { this.orderCol = col; this.orderAsc = !(o && o.ascending === false); return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this; }
  single() { this.singleMode = 'single'; return this; }
  match() { const rows = this.rowsRef.filter(r => this.filters.every(f => f(r))); if (this.orderCol) rows.sort((a, b) => (a[this.orderCol] > b[this.orderCol] ? 1 : a[this.orderCol] < b[this.orderCol] ? -1 : 0) * (this.orderAsc ? 1 : -1)); return this.limitN != null ? rows.slice(0, this.limitN) : rows; }
  then(resolve, reject) { try { resolve(this._exec()); } catch (e) { if (reject) reject(e); else throw e; } }
  _exec() {
    if (this.mode === 'select') {
      const rows = this.match();
      const projected = rows.map(r => project(r, this.selectCols));
      if (this.countMode) return { data: this.headOnly ? null : projected, error: null, count: rows.length };
      if (this.singleMode === 'single') return projected.length === 1 ? { data: projected[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      if (this.singleMode === 'maybeSingle') return { data: projected[0] || null, error: null };
      return { data: projected, error: null };
    }
    if (this.mode === 'update') {
      const rows = this.match();
      rows.forEach(r => Object.assign(r, this.payload));
      const projected = rows.map(r => project(r, this.selectCols || null));
      if (this.singleMode === 'maybeSingle') return { data: projected[0] || null, error: null };
      if (this.singleMode === 'single') return projected.length === 1 ? { data: projected[0], error: null } : { data: null, error: { message: 'no rows' } };
      return { data: this.selectCols ? projected : null, error: null };
    }
    if (this.mode === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const nr of rows) {
        if (this.table === 'ownership_requests' && nr.status === 'pending') {
          const dup = this.rowsRef.some(r => r.status === 'pending' && r.org_id === nr.org_id && r.record_kind === nr.record_kind && r.record_id === nr.record_id && r.requester_id === nr.requester_id);
          if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        nr.id = nr.id || (this.table + '_' + (this.rowsRef.length + 1) + '_' + Math.random().toString(36).slice(2, 7));
        nr.created_at = nr.created_at || now();
        nr.updated_at = nr.updated_at || nr.created_at;
        this.rowsRef.push(nr);
      }
      const projected = rows.map(r => project(r, this.selectCols || '*'));
      if (this.singleMode === 'single') return { data: projected[0], error: null };
      return { data: this.selectCols ? projected : null, error: null };
    }
    if (this.mode === 'delete') {
      const rows = this.match();
      const rowSet = new Set(rows);
      const kept = this.rowsRef.filter(r => !rowSet.has(r));
      this.rowsRef.length = 0; this.rowsRef.push(...kept);
      return { data: null, error: null };
    }
  }
}
function tableFor(name) { if (!TABLES[name]) TABLES[name] = []; return TABLES[name]; }
const fakeSupabase = {
  from(table) {
    const rows = tableFor(table);
    const mk = (mode, payload) => { const q = new QB(rows, mode, payload); q.table = table; return q; };
    return {
      select: (cols, opts) => mk('select').select(cols, opts),
      insert: (payload, opts) => mk('insert', payload),
      update: (payload, opts) => mk('update', payload),
      delete: (opts) => mk('delete'),
    };
  },
};

// ── ctx (mirrors index.js routeCtx for the fields this router touches) ────
const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase: fakeSupabase });
const { createDb } = require(path.join(ROOT, 'models'));
const db = createDb(fakeSupabase);
const orgIdFor = (req) => (req && req.user && req.user.org_id) || null;
const withOrg = (q, req) => { const o = orgIdFor(req); return o ? q.eq('org_id', o) : q; };
const activity = [];
const ctx = {
  supabase: fakeSupabase, db, hasRole, orgIdFor, withOrg,
  today: () => '2026-09-24',
  orgStamp: (req) => ({ org_id: orgIdFor(req) }),
  logActivity: async (jobId, contactId, userId, type, desc, oldV, newV) => { activity.push({ jobId, userId, type, desc, oldV, newV }); },
  auth: (req, res, next) => {
    const id = req.headers['x-user'];
    const u = USERS.find(x => x.id === id);
    if (!u) return res.status(401).json({ error: 'no such fixture user' });
    req.user = { id, role: u.role, roles: [u.role], org_id: O };
    req.orgId = O;
    next();
  },
};

const app = express();
app.use(express.json());
app.use(require(path.join(ROOT, 'routes/ownership-requests.js'))(ctx));
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
  // BD2 is BD's sibling (same manager BDM, not each other's manager) and
  // cannot see BD's lead directly — D-0034 does not widen sight sideways,
  // only up the chain — so "same team" here means D-0038's actual door: the
  // duplicate-email match. Confirms BOTH that sight is really required
  // (no email -> not_found) and that once granted, the approver lands on the
  // team the record is actually leaving (BDM, who manages both of them).
  {
    const r = await call('BD2', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD' });
    ok('same-team sibling has no sight without the duplicate-email door', r.status === 200 && r.body.ok === false && /could not find/i.test(r.body.reason), r.body);
    const r2 = await call('BD2', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com' });
    ok('same-team, via the duplicate-email door: ok true, approver is BDM (owner\'s AND asker\'s manager)', r2.status === 200 && r2.body.ok === true && r2.body.approver && r2.body.approver.id === 'BDM', r2.body);
  }

  // cross-team, genuinely no relationship and no matching email -> identical
  // not_found sentence (rampart law 3: never distinguish "exists but hidden"
  // from "does not exist").
  {
    const r = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD' });
    ok('cross-team, no sight, no email: not_found sentence, ok:false', r.status === 200 && r.body.ok === false && /could not find/i.test(r.body.reason), r.body);
    const r2 = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD', via_email: 'nobody@nowhere.com' });
    ok('a NON-matching typed email does not grant sight either', r2.status === 200 && r2.body.ok === false, r2.body);
  }

  // duplicate-email path from a DIFFERENT team: still stands in for sight,
  // and the approver is still the CURRENT OWNER's manager (D-0037) — BD3's
  // own manager (BDM_OTHER) is never consulted.
  {
    const r = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com' });
    ok('cross-team duplicate-email match stands in for sight; approver is the OWNER\'s manager, not the asker\'s', r.status === 200 && r.body.ok === true && r.body.approver.id === 'BDM', r.body);
  }

  // a lead resolved from via_email ALONE, no record_id at all — the shape
  // guild's duplicate-warning now actually sends (option (a)): the lead id
  // is never handed to the browser, so the door is via_email-only.
  {
    const r = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'lead', via_email: 'poc@acme.com' });
    ok('can-request resolves a lead from via_email alone (no record_id)', r.status === 200 && r.body.ok === true && r.body.approver && r.body.approver.id === 'BDM', r.body);

    const post = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', via_email: 'poc@acme.com', note: 'no record_id at all' });
    ok('POST /ownership-requests resolves + creates from via_email alone (201)', post.status === 201 && post.body.request && post.body.request.status === 'pending', post.body);
    ok('the resolved request still points at J_BD internally, masked the same way', post.body.request.record_label === 'A lead with poc@acme.com', post.body.request);
    // cancel it immediately so it does not interfere with later ownership
    // transitions this fixture depends on (J_BD's owner chain).
    await call('BD3', 'POST', `/ownership-requests/${post.body.request.id}/cancel`, {});
  }

  // unowned pool lead -> approver falls to the ASKER's manager. (Worth
  // flagging in the report: BD2 can only see this pool lead here because the
  // fixture makes them its `assigned_to` researcher — no role that is
  // ALLOWED to own a lead (bd/bd_lead) normally SEES the pool at all
  // (D-0034: only admin/ra_lead do), and admin/ra_lead cannot ask for one
  // (rule 3 excludes admin; ra_lead is not an allowed owner role for `lead`).
  // "Ask to take over an unowned lead" is therefore reachable only through a
  // side door like this one, or the duplicate-email door — never a plain ask.)
  {
    const r = await call('BD2', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_POOL' });
    ok('unowned record: approver is the asker\'s manager', r.status === 200 && r.body.ok === true && r.body.approver.id === 'BDM', r.body);
  }

  // self-approval -> admin: BDM (a manager) can see a REPORT's lead directly
  // (D-0038: "managers can still ask for their own team's leads from the
  // lead itself") and asks for it. The owner's manager IS the requester, so
  // approverFor must reroute to an admin rather than let BDM approve their
  // own ask. Deterministic pick: the longest-serving admin (ADMIN2, seeded
  // earlier) — never BDM, never a random admin.
  {
    const r = await call('BDM', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD' });
    ok('a manager requesting a direct report\'s lead sees it (chain), and self-approval collapses to the deterministic admin',
      r.status === 200 && r.body.ok === true && r.body.approver.id === 'ADMIN2', r.body);
  }

  // ── create a real request, then walk it through approve (via the
  // duplicate-email door, the realistic same-team-request shape) ─────────
  let reqId = null;
  {
    const r = await call('BD2', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com', note: 'covering while BD is out' });
    ok('POST creates the request (201)', r.status === 201 && r.body.request && r.body.request.status === 'pending', r.body);
    ok('the duplicate-email path never reveals the lead\'s own details — masked label', r.body.request && r.body.request.record_label === 'A lead with poc@acme.com', r.body.request);
    reqId = r.body.request && r.body.request.id;
  }

  // duplicate ask while pending -> 409 already_requested
  {
    const r = await call('BD2', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com' });
    ok('asking again while pending -> 409 already_requested', r.status === 409 && r.body.error === 'already_requested', r.body);
  }

  // the requester sees it in "mine"; the approver (BDM) sees it in "waiting"
  {
    const r = await call('BD2', 'GET', '/ownership-requests?box=mine');
    ok('requester\'s "mine" box has it', r.body.requests.some(x => x.id === reqId), r.body);
    const r2 = await call('BDM', 'GET', '/ownership-requests?box=waiting');
    ok('approver\'s "waiting" box has it, and waiting_count >= 1', r2.body.requests.some(x => x.id === reqId) && r2.body.waiting_count >= 1, r2.body);
    const r3 = await call('BD3', 'GET', '/ownership-requests?box=waiting');
    ok('an unrelated user\'s "waiting" box does not have it', !r3.body.requests.some(x => x.id === reqId), r3.body);
  }

  // wrong decider cannot approve
  {
    const r = await call('BD3', 'POST', `/ownership-requests/${reqId}/approve`, {});
    ok('a non-approver cannot approve (403)', r.status === 403, r.body);
  }

  // the approver approves — the lead should move
  {
    const r = await call('BDM', 'POST', `/ownership-requests/${reqId}/approve`, { note: 'go ahead' });
    ok('approve succeeds (200) and reports the move', r.status === 200 && r.body.request.status === 'approved' && r.body.moved && r.body.moved.lead, r.body);
    const job = JOBS.find(j => j.id === 'J_BD');
    ok('the lead really moved: assigned_to_bd is now BD2', job.assigned_to_bd === 'BD2', job);
    ok('no connected mailbox in this fixture -> sending_email_id is null, not the old owner\'s', job.sending_email_id === null, job);
  }

  // sequential re-decision on an already-decided request: canDecide's own
  // `takeoverTransition` check catches this before the DB is even touched,
  // and says so plainly (403, not a bare 409) — this is the FIRST of two
  // layers, not the race guard itself.
  {
    const r = await call('BDM', 'POST', `/ownership-requests/${reqId}/approve`, {});
    ok('re-approving an already-decided request is refused (canDecide catches it first)', r.status === 403 && /already approved/i.test(r.body.reason), r.body);
  }

  // decline path, fresh request
  let reqId2 = null;
  {
    const rr = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com' });
    ok('duplicate-email request creates with the masked label', rr.status === 201 && rr.body.request.record_label === 'A lead with poc@acme.com', rr.body);
    reqId2 = rr.body.request.id;
    // now J_BD's owner is BD2, whose manager is BDM -> approver BDM
    const r = await call('BDM', 'POST', `/ownership-requests/${reqId2}/decline`, { note: 'not right now' });
    ok('decline succeeds and the lead is untouched', r.status === 200 && r.body.request.status === 'declined', r.body);
    const job = JOBS.find(j => j.id === 'J_BD');
    ok('decline never moves the record', job.assigned_to_bd === 'BD2', job);
  }

  // cancel path
  {
    const rr = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', via_email: 'poc@acme.com' });
    const id3 = rr.body.request.id;
    const wrong = await call('BDM', 'POST', `/ownership-requests/${id3}/cancel`, {});
    ok('only the requester may cancel', wrong.status === 403, wrong.body);
    const r = await call('BD3', 'POST', `/ownership-requests/${id3}/cancel`, {});
    ok('the requester can cancel their own pending request', r.status === 200 && r.body.request.status === 'cancelled', r.body);
  }

  // the actual RACE: two approvers hit approve on the SAME still-pending
  // request at once. Node is single-threaded but these are two separate
  // in-flight requests, so both can pass the synchronous canDecide check
  // before either write lands — the DB-level guard is `.eq('status',
  // 'pending')` on the UPDATE itself, conditional and atomic, which is what
  // must be the thing that lets only one through (BDM and an admin both
  // qualify under canDecide, so this genuinely tests the DB guard, not just
  // the in-process transition check).
  {
    const rr = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_RACE', via_email: 'race@raceco.com' });
    const raceId = rr.body.request.id;
    const [a, b] = await Promise.all([
      call('BDM', 'POST', `/ownership-requests/${raceId}/approve`, {}),
      call('ADMIN2', 'POST', `/ownership-requests/${raceId}/approve`, {}),
    ]);
    const statuses = [a.status, b.status].sort();
    ok('exactly one of two simultaneous approvals wins (200), the other is refused, never both 200',
      statuses[0] === 200 && statuses[1] !== 200, { a: a.body, b: b.body });
    const job = JOBS.find(j => j.id === 'J_RACE');
    ok('the lead was reassigned exactly once by the race, not twice', job.assigned_to_bd === 'BD3', job);
  }

  // client take-over: JO_BD3 (job order) and a live lead both owned by BD3 at
  // C1 -> approving a client take-over for BD1(new) should move BOTH, and
  // leave any OTHER owner's leads at the same company alone.
  {
    JOBS.push({ id: 'J_OTHER_OWNER', org_id: O, company_id: 'C1', position: 'Other', stage: 'Assigned', assigned_to_bd: 'BD', created_by: 'RA', assigned_to: null, deleted_at: null });
    JOBS.push({ id: 'J_BD3_LEAD', org_id: O, company_id: 'C1', position: 'Foreman', stage: 'Assigned', assigned_to_bd: 'BD3', created_by: 'RA', assigned_to: null, deleted_at: null });
    const can = await call('BD2', 'POST', '/ownership-requests/can-request', { kind: 'client', record_id: 'C1' });
    // C1's owner is JO_BD3.bd_manager_id = BD3 (job order beats lead in the
    // ladder) -> approver is BD3's manager BDM_OTHER
    ok('client can-request resolves the job-order-first ladder', can.status === 200 && can.body.ok === true && can.body.approver.id === 'BDM_OTHER', can.body);

    const post = await call('BD2', 'POST', '/ownership-requests', { kind: 'client', record_id: 'C1' });
    ok('client request created', post.status === 201, post.body);
    const cReqId = post.body.request.id;
    const appr = await call('BDM_OTHER', 'POST', `/ownership-requests/${cReqId}/approve`, {});
    ok('client approve succeeds and reports what moved', appr.status === 200 && appr.body.moved.client && appr.body.moved.client.job_orders_moved === 1 && appr.body.moved.client.leads_moved.length === 1, appr.body);
    ok('the job order moved to BD2', JOB_ORDERS.find(j => j.id === 'JO_BD3').bd_manager_id === 'BD2', JOB_ORDERS);
    ok('BD3\'s lead at C1 moved to BD2', JOBS.find(j => j.id === 'J_BD3_LEAD').assigned_to_bd === 'BD2', JOBS.find(j => j.id === 'J_BD3_LEAD'));
    ok('the OTHER owner\'s lead at the same company (BD\'s) was left alone', JOBS.find(j => j.id === 'J_OTHER_OWNER').assigned_to_bd === 'BD', JOBS.find(j => j.id === 'J_OTHER_OWNER'));
  }

  // ── a request body can NEVER set viaDuplicateEmailMatch itself (D-0038) ──
  // The route only sets it after verifying, server-side, that the requester's
  // OWN typed via_email string matches a real contact on the lead
  // (`emailMatchesLead`). A body field named `viaDuplicateEmailMatch` must be
  // silently ignored — sending it directly, with no matching (or no) via_email,
  // on a lead the requester genuinely cannot see must still answer not_found.
  {
    // BD3 has no relationship to J_BD and no matching email — with the real
    // duplicate-email door (a correct via_email) this would succeed (proven
    // above); asserting it here with the RAW flag and a wrong/missing email
    // instead proves the flag itself carries no weight from the client.
    const r1 = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'lead', record_id: 'J_BD', viaDuplicateEmailMatch: true });
    ok('can-request ignores a body-supplied viaDuplicateEmailMatch with no matching email', r1.status === 200 && r1.body.ok === false && /could not find/i.test(r1.body.reason), r1.body);

    const r2 = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', viaDuplicateEmailMatch: true });
    ok('POST body field viaDuplicateEmailMatch:true is ignored (no matching via_email) -> 404 not_found', r2.status === 404 && r2.body.error === 'not_found', r2.body);

    const r3 = await call('BD3', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_BD', viaDuplicateEmailMatch: true, via_email: 'not-a-real-contact@nowhere.com' });
    ok('POST body flag ignored even alongside a NON-matching via_email -> 404 not_found', r3.status === 404 && r3.body.error === 'not_found', r3.body);
  }

  // ── MUTATION: remove the DB-level conditional-update race guard ──────────
  // The real route's approve/decline/cancel writes end
  // `.eq('id', row.id).eq('status', 'pending')` — an atomic, conditional
  // UPDATE that lets only one of two simultaneous approvals actually change a
  // row (the real race test above proves this: exactly one 200). Since M1
  // (review round 2), `reassignLead` ALSO conditions its write on the old
  // owner still matching, which independently catches the same-request race
  // in this fixture's shape (the second call's write matches zero rows and
  // reverts to 409 owner_changed) — a real, separate protection, but one that
  // would mask the STATUS guard's own absence if left in place. This block
  // builds an ISOLATED fixture whose fake `ownership_requests` UPDATE ignores
  // an `.eq('status', …)` filter AND whose fake `jobs` UPDATE ignores the
  // `.eq('assigned_to_bd', oldOwnerId)` filter — simulating BOTH guards'
  // removal at once, to isolate what the status guard alone is for — and
  // proves that WITHOUT either, both concurrent approvals succeed. This is
  // what the real guards prevent; it is not exercised by the earlier race
  // test's positive assertion alone, because that test only ever ran against
  // the guarded code.
  {
    const O2 = 'org2';
    const users2 = [
      { id: 'ADMIN', role: 'admin', manager_id: null },
      { id: 'BDM', role: 'bd_lead', manager_id: null },
      { id: 'BD', role: 'bd', manager_id: 'BDM' },
      { id: 'BD2', role: 'bd', manager_id: 'BDM' },
    ].map(u => ({ ...u, org_id: O2, deleted_at: null, is_active: true, created_at: '2026-01-01T00:00:00Z', name: u.id }));
    const JOBS2 = [{ id: 'J_RACE2', org_id: O2, company_id: 'C1', position: 'Racer', stage: 'Assigned', assigned_to_bd: 'BD', created_by: 'RA', assigned_to: null, deleted_at: null }];
    const CONTACTS2 = [{ id: 'CT2', org_id: O2, job_id: 'J_RACE2', email: 'race2@raceco.com' }];
    const COMPANIES2 = [{ id: 'C1', org_id: O2, name: 'Race Co 2', created_by: 'RA', deleted_at: null }];
    const OWNERSHIP_REQUESTS2 = [];
    const TABLES2 = { users: users2, jobs: JOBS2, job_orders: [], companies: COMPANIES2, contacts: CONTACTS2, ownership_requests: OWNERSHIP_REQUESTS2, user_emails: [], microsoft_tokens: [], gmail_tokens: [], email_send_log: [] };

    // A deterministic barrier so both approve calls' initial `loadOwnRequest`
    // read (the TOCTOU window a real network race exploits) are forced to
    // happen at the same instant, before either has written anything —
    // otherwise, on a fast in-memory fake, one request can simply finish
    // entirely before the other starts, which proves nothing about the guard.
    let raceBarrierN = 0, raceBarrierCount = 0, raceBarrierResolvers = [];
    function armRaceBarrier(n) { raceBarrierN = n; raceBarrierCount = 0; raceBarrierResolvers = []; }
    function raceArrive() {
      return new Promise(resolve => {
        raceBarrierResolvers.push(resolve);
        raceBarrierCount++;
        if (raceBarrierCount >= raceBarrierN) {
          const rs = raceBarrierResolvers; raceBarrierResolvers = [];
          rs.forEach(r => r());
        }
      });
    }
    class NoGuardQB extends QB {
      eq(col, val) {
        // Simulate the guard's removal: an .eq('status', …) filter on an
        // ownership_requests UPDATE is silently dropped. Everything else
        // (id, org_id, …) still filters normally.
        if (this.mode === 'update' && this.table === 'ownership_requests' && col === 'status') return this;
        // A SECOND, independent guard now also exists (`reassignLead`'s
        // conditional write, M1 review round 2): even with the status guard
        // gone, the second approval's own `.eq('assigned_to_bd', oldOwnerId)`
        // finds the row already moved by the first and reports owner_changed
        // — a real, separate protection that would otherwise mask the status
        // guard's own absence. Drop it too, so this fixture isolates the
        // STATUS guard specifically, per the coordinator's note.
        if (this.mode === 'update' && this.table === 'jobs' && col === 'assigned_to_bd') return this;
        return super.eq(col, val);
      }
      then(resolve, reject) {
        // Gate exactly the read `loadOwnRequest` performs
        // (`.select('*').eq('id', id).maybeSingle()`), so both approve
        // requests are forced to read the row's status simultaneously.
        if (this.mode === 'select' && this.table === 'ownership_requests' && this.singleMode === 'maybeSingle') {
          raceArrive().then(() => { try { resolve(this._exec()); } catch (e) { if (reject) reject(e); else throw e; } });
          return;
        }
        super.then(resolve, reject);
      }
    }
    function tableFor2(name) { if (!TABLES2[name]) TABLES2[name] = []; return TABLES2[name]; }
    const noGuardSupabase = {
      from(table) {
        const rows = tableFor2(table);
        const mk = (mode, payload) => { const q = new NoGuardQB(rows, mode, payload); q.table = table; return q; };
        return {
          select: (cols, opts) => mk('select').select(cols, opts),
          insert: (payload) => mk('insert', payload),
          update: (payload) => mk('update', payload),
          delete: () => mk('delete'),
        };
      },
    };
    const { hasRole: hasRole2 } = require(path.join(ROOT, 'middleware/authorize'))({ supabase: noGuardSupabase });
    const { createDb: createDb2 } = require(path.join(ROOT, 'models'));
    const db2 = createDb2(noGuardSupabase);
    const orgIdFor2 = (req) => (req && req.user && req.user.org_id) || null;
    const ctx2 = {
      supabase: noGuardSupabase, db: db2, hasRole: hasRole2, orgIdFor: orgIdFor2,
      withOrg: (q, req) => { const o = orgIdFor2(req); return o ? q.eq('org_id', o) : q; },
      today: () => '2026-09-24',
      orgStamp: (req) => ({ org_id: orgIdFor2(req) }),
      logActivity: async () => {},
      auth: (req, res, next) => {
        const id = req.headers['x-user'];
        const u = users2.find(x => x.id === id);
        if (!u) return res.status(401).json({ error: 'no such fixture user' });
        req.user = { id, role: u.role, roles: [u.role], org_id: O2 };
        req.orgId = O2;
        next();
      },
    };
    const app2 = express();
    app2.use(express.json());
    app2.use(require(path.join(ROOT, 'routes/ownership-requests.js'))(ctx2));
    const server2 = app2.listen(0);
    const PORT2 = server2.address().port;
    const call2 = (user, method, urlPath, body) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ host: '127.0.0.1', port: PORT2, path: urlPath, method, headers: Object.assign({ 'x-user': user }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
        res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

    const rr = await call2('BD2', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_RACE2', via_email: 'race2@raceco.com' });
    ok('MUTATION setup: no-guard fixture creates the request fine', rr.status === 201, rr.body);
    const raceId2 = rr.body.request && rr.body.request.id;
    armRaceBarrier(2);
    const [ra, rb] = await Promise.all([
      call2('BDM', 'POST', `/ownership-requests/${raceId2}/approve`, {}),
      call2('ADMIN', 'POST', `/ownership-requests/${raceId2}/approve`, {}),
    ]);
    ok('MUTATION: with BOTH the status guard and the row-level reassignment guard removed, BOTH simultaneous approvals succeed (the real code never allows this)',
      ra.status === 200 && rb.status === 200, { a: ra.body, b: rb.body });

    server2.close();
  }

  // ── owner-changed mid-approve → the approval REVERTS to pending (M1) ─────
  // The guarded, correct code path: canDecide passes, the requester is live,
  // the EARLY live-owner recheck (`currentOwnerOf`) still agrees with what
  // was stored at request time — so the status flip to 'approved' genuinely
  // happens — but the record's owner changes in the narrow window between
  // that recheck and `reassignLead`'s own conditional write (a distribute, or
  // a different take-over, landing in between). `reassignLead`'s write then
  // matches zero rows, and `revertApproval` must undo the optimistic status
  // flip rather than leave an "approved" request that moved nothing.
  //
  // Reproduced deterministically (not via a real race) with a one-shot QB
  // that, on the SPECIFIC read `currentOwnerOf` performs, returns the
  // CORRECT pre-change owner (so the early check passes) but mutates the
  // underlying row as a side effect immediately after — simulating a change
  // that lands in exactly that gap.
  {
    const O3 = 'org3';
    const users3 = [
      { id: 'ADMIN', role: 'admin', manager_id: null },
      { id: 'BDM', role: 'bd_lead', manager_id: null },
      { id: 'BD', role: 'bd', manager_id: 'BDM' },
      { id: 'BD2', role: 'bd', manager_id: 'BDM' },
      { id: 'BD3', role: 'bd', manager_id: 'BDM' },
    ].map(u => ({ ...u, org_id: O3, deleted_at: null, is_active: true, created_at: '2026-01-01T00:00:00Z', name: u.id }));
    const JOBS3 = [{ id: 'J_REVERT', org_id: O3, company_id: 'C1', position: 'Revert', stage: 'Assigned', assigned_to_bd: 'BD', created_by: 'RA', assigned_to: null, deleted_at: null }];
    const CONTACTS3 = [{ id: 'CT3', org_id: O3, job_id: 'J_REVERT', email: 'revert@raceco.com' }];
    const COMPANIES3 = [{ id: 'C1', org_id: O3, name: 'Revert Co', created_by: 'RA', deleted_at: null }];
    const OWNERSHIP_REQUESTS3 = [];
    const TABLES3 = { users: users3, jobs: JOBS3, job_orders: [], companies: COMPANIES3, contacts: CONTACTS3, ownership_requests: OWNERSHIP_REQUESTS3, user_emails: [], microsoft_tokens: [], gmail_tokens: [], email_send_log: [] };

    let armInjection = false;
    class RevertQB extends QB {
      then(resolve, reject) {
        if (armInjection && this.mode === 'select' && this.table === 'jobs' && this.singleMode === 'maybeSingle') {
          const result = this._exec(); // captures the row BEFORE the injected change
          armInjection = false;
          const row = this.rowsRef.find(r => r.id === 'J_REVERT');
          if (row) row.assigned_to_bd = 'BD3'; // "someone else" reassigned it in the gap
          resolve(result);
          return;
        }
        super.then(resolve, reject);
      }
    }
    function tableFor3(name) { if (!TABLES3[name]) TABLES3[name] = []; return TABLES3[name]; }
    const revertSupabase = {
      from(table) {
        const rows = tableFor3(table);
        const mk = (mode, payload) => { const q = new RevertQB(rows, mode, payload); q.table = table; return q; };
        return {
          select: (cols, opts) => mk('select').select(cols, opts),
          insert: (payload) => mk('insert', payload),
          update: (payload) => mk('update', payload),
          delete: () => mk('delete'),
        };
      },
    };
    const { hasRole: hasRole3 } = require(path.join(ROOT, 'middleware/authorize'))({ supabase: revertSupabase });
    const { createDb: createDb3 } = require(path.join(ROOT, 'models'));
    const db3 = createDb3(revertSupabase);
    const orgIdFor3 = (req) => (req && req.user && req.user.org_id) || null;
    const ctx3 = {
      supabase: revertSupabase, db: db3, hasRole: hasRole3, orgIdFor: orgIdFor3,
      withOrg: (q, req) => { const o = orgIdFor3(req); return o ? q.eq('org_id', o) : q; },
      today: () => '2026-09-24',
      orgStamp: (req) => ({ org_id: orgIdFor3(req) }),
      logActivity: async () => {},
      auth: (req, res, next) => {
        const id = req.headers['x-user'];
        const u = users3.find(x => x.id === id);
        if (!u) return res.status(401).json({ error: 'no such fixture user' });
        req.user = { id, role: u.role, roles: [u.role], org_id: O3 };
        req.orgId = O3;
        next();
      },
    };
    const app3 = express();
    app3.use(express.json());
    app3.use(require(path.join(ROOT, 'routes/ownership-requests.js'))(ctx3));
    const server3 = app3.listen(0);
    const PORT3 = server3.address().port;
    const call3 = (user, method, urlPath, body) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request({ host: '127.0.0.1', port: PORT3, path: urlPath, method, headers: Object.assign({ 'x-user': user }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
        res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

    const rr = await call3('BD2', 'POST', '/ownership-requests', { kind: 'lead', record_id: 'J_REVERT', via_email: 'revert@raceco.com' });
    ok('REVERT setup: request created against BD-owned lead', rr.status === 201 && rr.body.request.status === 'pending', rr.body);
    const revertReqId = rr.body.request.id;

    armInjection = true;
    const appr = await call3('BDM', 'POST', `/ownership-requests/${revertReqId}/approve`, {});
    ok('owner-changed mid-approve: the write reports 409 owner_changed, never a false 200', appr.status === 409 && appr.body.error === 'owner_changed', appr.body);
    ok('the underlying lead was NOT reassigned to the original requester', JOBS3.find(j => j.id === 'J_REVERT').assigned_to_bd === 'BD3', JOBS3.find(j => j.id === 'J_REVERT'));

    const mine = await call3('BD2', 'GET', '/ownership-requests?box=mine');
    const row = mine.body.requests.find(x => x.id === revertReqId);
    ok('the request REVERTED to pending (never left "approved" sitting over a no-op)', row && row.status === 'pending', row);
    ok('decided_by/decided_at were cleared by the revert', row && row.decided_by === null && row.decided_at === null, row);

    server3.close();
  }

  // ── client whose only ownership is companies.created_by (M2) ─────────────
  // A client with no live job order and no live lead owned by `oldOwner` is
  // only "theirs" through the created_by fallback rung on the ladder —
  // approving its take-over must move THAT rung too, or the approval reports
  // success while moving nothing at all.
  {
    COMPANIES.push({ id: 'C_CREATED_BY_ONLY', org_id: O, name: 'Fallback Co', created_by: 'BD', deleted_at: null });
    const can = await call('BD2', 'POST', '/ownership-requests/can-request', { kind: 'client', record_id: 'C_CREATED_BY_ONLY' });
    ok('created_by-only client: owner resolves to created_by (BD), approver is BD\'s manager (BDM)', can.status === 200 && can.body.ok === true && can.body.approver.id === 'BDM', can.body);

    const post = await call('BD2', 'POST', '/ownership-requests', { kind: 'client', record_id: 'C_CREATED_BY_ONLY' });
    ok('created_by-only client request created', post.status === 201, post.body);
    const appr = await call('BDM', 'POST', `/ownership-requests/${post.body.request.id}/approve`, {});
    ok('approve succeeds and reports created_by_transferred, zero job orders/leads moved', appr.status === 200 && appr.body.moved.client && appr.body.moved.client.created_by_transferred === true && appr.body.moved.client.job_orders_moved === 0 && appr.body.moved.client.leads_moved.length === 0, appr.body);
    ok('companies.created_by actually moved to the requester', COMPANIES.find(c => c.id === 'C_CREATED_BY_ONLY').created_by === 'BD2', COMPANIES.find(c => c.id === 'C_CREATED_BY_ONLY'));
  }

  // ── a genuinely UNOWNED client (created_by null too) still transfers via
  // created_by (R47-4) — the original `&&` on a truthy created_by meant a
  // client with no owner at all (never created_by'd, no job order, no lead)
  // could never be approved: the write's `priorCreatedBy === oldOwner` check
  // needed null === null to count, which the old code's truthiness check
  // rejected, so the approval reverted to pending forever.
  {
    COMPANIES.push({ id: 'C_UNOWNED', org_id: O, name: 'Nobody\'s Co', created_by: null, deleted_at: null });
    const can = await call('BD3', 'POST', '/ownership-requests/can-request', { kind: 'client', record_id: 'C_UNOWNED' });
    ok('a fully unowned client: approver is the ASKER\'s manager (BDM_OTHER)', can.status === 200 && can.body.ok === true && can.body.approver.id === 'BDM_OTHER', can.body);

    const post = await call('BD3', 'POST', '/ownership-requests', { kind: 'client', record_id: 'C_UNOWNED' });
    ok('unowned-client request created', post.status === 201, post.body);
    const appr = await call('BDM_OTHER', 'POST', `/ownership-requests/${post.body.request.id}/approve`, {});
    ok('approve on a fully unowned client SUCCEEDS (R47-4) and sets created_by, never stuck reverting to pending', appr.status === 200 && appr.body.moved.client && appr.body.moved.client.created_by_transferred === true, appr.body);
    ok('companies.created_by is now the requester, was null', COMPANIES.find(c => c.id === 'C_UNOWNED').created_by === 'BD3', COMPANIES.find(c => c.id === 'C_UNOWNED'));
  }

  const failed = results.filter(x => !x.c);
  for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
