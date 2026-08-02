// Proves the org filter is actually applied by the CONVERTED ROUTE HANDLERS —
// not just by models/ in isolation (that is models-smoke.mjs).
//
// This distinction matters. The existing backend-smoke only asserts these
// endpoints return 401 without a token, which would pass just as happily if
// every handler leaked every org's rows. The bug being guarded here is real and
// was live before this conversion:
//
//   PATCH /contacts/:id/email-status updated a contact BY ID with no org filter
//   and — unlike the PUT/DELETE beside it — no canTouchJob check either. Any BD
//   could patch another org's contact by guessing an id, and the OOO reminder it
//   creates was written without an org stamp.
//
// So the assertions below are on the QUERY EACH HANDLER BUILDS: every read,
// update and delete must carry org_id, and every insert must be stamped.
//
// Usage: node test/org-scoping-routes-smoke.mjs   (needs express, no browser)

import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models/index.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const ORG = 'org-alpha';
const OTHER_ORG = 'org-beta';

// ── A Supabase double that records every query it is asked to build ──────────
function recordingSupabase(rowFactory = () => ({ id: 'row-1', job_id: 'job-1' })) {
  const queries = [];
  function builder(table) {
    const q = { table, calls: [], filters: {}, payload: undefined };
    queries.push(q);
    const chain = {};
    for (const m of ['select', 'order', 'in', 'is', 'gte', 'neq', 'limit']) {
      chain[m] = (...args) => { q.calls.push({ m, args }); return chain; };
    }
    for (const m of ['insert', 'upsert', 'update']) {
      chain[m] = (...args) => { q.calls.push({ m, args }); q.payload = args[0]; q.op = m; return chain; };
    }
    chain.delete = (...args) => { q.calls.push({ m: 'delete', args }); q.op = 'delete'; return chain; };
    chain.eq = (col, val) => { q.calls.push({ m: 'eq', args: [col, val] }); q.filters[col] = val; return chain; };
    chain.single = async () => ({ data: rowFactory(q), error: null });
    chain.maybeSingle = async () => ({ data: rowFactory(q), error: null });
    // Awaiting the builder directly (e.g. the GET list query) resolves here.
    chain.then = (resolve, reject) => Promise.resolve({ data: [rowFactory(q)], error: null }).then(resolve, reject);
    return chain;
  }
  return { queries, from: builder };
}

// A ctx close enough to what index.js passes these routers.
function makeCtx(supabase, { orgId = ORG } = {}) {
  return {
    db: createDb(supabase),
    supabase,
    auth: (req, _res, next) => { req.user = { id: 'u1', org_id: orgId, roles: ['bd'] }; req.orgId = orgId; next(); },
    hasRole: () => true,
    canTouchJob: async () => true,
    logActivity: async () => {},
    isPermanentFollowupBlock: () => false,
  };
}

async function serve(routerPath, supabase, opts) {
  const app = express();
  app.use(express.json());
  app.use(require(routerPath)(makeCtx(supabase, opts)));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, server,
    call: (method, path, body) => fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    close: () => new Promise(r => server.close(r)),
  };
}

// Every query against a tenant table must carry the org filter or the stamp.
function auditQueries(queries, label) {
  const bad = [];
  for (const q of queries) {
    if (q.op === 'insert' || q.op === 'upsert') {
      const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
      if (rows.some(r => r && r.org_id !== ORG)) bad.push(`${q.table}.${q.op} not stamped`);
    } else if (q.filters.org_id !== ORG) {
      bad.push(`${q.table}.${q.op || 'select'} missing org filter`);
    }
  }
  return { ok: bad.length === 0, detail: `${label}: ${bad.join('; ')}` };
}

// ── CONTACTS ─────────────────────────────────────────────────────────────────
{
  const sb = recordingSupabase();
  const s = await serve('../routes/contacts.js', sb);

  await s.call('POST', '/contacts', { job_id: 'job-1', first_name: 'Ada' });
  let a = auditQueries(sb.queries, 'POST /contacts');
  ok('POST /contacts stamps org_id on the new contact', a.ok, a.detail);

  sb.queries.length = 0;
  await s.call('PUT', '/contacts/c1', { first_name: 'Grace' });
  a = auditQueries(sb.queries, 'PUT /contacts/:id');
  ok('PUT /contacts/:id scopes both the lookup and the update', a.ok, a.detail);

  sb.queries.length = 0;
  await s.call('DELETE', '/contacts/c1');
  a = auditQueries(sb.queries, 'DELETE /contacts/:id');
  ok('DELETE /contacts/:id scopes both the lookup and the delete', a.ok, a.detail);

  // THE ONE THAT WAS ACTUALLY BROKEN.
  sb.queries.length = 0;
  await s.call('PATCH', '/contacts/c1/email-status', { email_status: 'valid' });
  a = auditQueries(sb.queries, 'PATCH email-status');
  ok('PATCH /contacts/:id/email-status is org-scoped (was a cross-org write)', a.ok, a.detail);
  const upd = sb.queries.find(q => q.op === 'update');
  ok('...the update filters on org_id, not id alone', upd?.filters.org_id === ORG, JSON.stringify(upd?.filters));

  // The OOO branch also writes a reminder — previously unstamped.
  sb.queries.length = 0;
  await s.call('PATCH', '/contacts/c1/email-status', { email_status: 'out_of_office', ooo_until: '2026-09-01' });
  const rem = sb.queries.find(q => q.table === 'reminders');
  ok('the OOO reminder it creates is org-stamped', rem?.payload?.org_id === ORG, JSON.stringify(rem?.payload?.org_id));
  a = auditQueries(sb.queries, 'PATCH email-status (OOO)');
  ok('...and every query in the OOO path is scoped', a.ok, a.detail);

  await s.close();
}

// ── REMINDERS ────────────────────────────────────────────────────────────────
{
  const sb = recordingSupabase();
  const s = await serve('../routes/reminders.js', sb);

  await s.call('GET', '/reminders');
  let a = auditQueries(sb.queries, 'GET /reminders');
  ok('GET /reminders is org-scoped (was user_id only)', a.ok, a.detail);

  sb.queries.length = 0;
  await s.call('POST', '/reminders', { return_date: '2026-09-01' });
  a = auditQueries(sb.queries, 'POST /reminders');
  ok('POST /reminders stamps org_id (was relying on the column DEFAULT)', a.ok, a.detail);

  sb.queries.length = 0;
  await s.call('PATCH', '/reminders/r1', { status: 'done' });
  a = auditQueries(sb.queries, 'PATCH /reminders/:id');
  ok('PATCH /reminders/:id is org-scoped', a.ok, a.detail);

  sb.queries.length = 0;
  await s.call('DELETE', '/reminders/r1');
  a = auditQueries(sb.queries, 'DELETE /reminders/:id');
  ok('DELETE /reminders/:id is org-scoped', a.ok, a.detail);

  // The user_id scoping that was already there must survive the conversion.
  sb.queries.length = 0;
  await s.call('GET', '/reminders');
  ok('...and the existing user_id scoping is preserved', sb.queries[0]?.filters.user_id === 'u1', JSON.stringify(sb.queries[0]?.filters));

  await s.close();
}

// ── A different org gets a different filter (not a hardcoded constant) ───────
{
  const sb = recordingSupabase();
  const s = await serve('../routes/reminders.js', sb, { orgId: OTHER_ORG });
  await s.call('GET', '/reminders');
  ok('the filter follows the caller\'s org, it is not hardcoded', sb.queries[0]?.filters.org_id === OTHER_ORG, JSON.stringify(sb.queries[0]?.filters));
  await s.close();
}

console.log('\n=== ORG SCOPING (ROUTES) SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
