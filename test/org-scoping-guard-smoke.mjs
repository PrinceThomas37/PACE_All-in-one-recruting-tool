// Guards the four findings from C-0018 (rampart's org-scoping audit) that were
// previously covered by nothing — each one fails SILENTLY: a missing filter
// returns more rows than it should, never an error, and a wrong status code
// looks identical to a right one until somebody pastes a foreign id.
//
// Usage: node test/org-scoping-guard-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { TENANT_TABLES } = require(path.join(ROOT, 'models/tables.js'));
const createAuthorize = require(path.join(ROOT, 'middleware/authorize.js'));
const provisioning = require(path.join(ROOT, 'services/provisioning.js'));

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ═══════════════════════════════════════════════════════════════════════════
// 1. Every raw `supabase.from('<tenant table>')` in routes/ must carry an org
//    filter, an ownership filter, or an explicit cross-org escape hatch.
//
// ALLOW-LIST, NOT DENY-LIST (rampart's phrasing): the guard below is built as
// "does this handler contain one of the known-safe patterns", so a brand-new
// router that reaches a tenant table with nothing else gets flagged BY
// DEFAULT — it has to earn its way onto the safe side, not be assumed onto it.
//
// The unit here is the ROUTE HANDLER BLOCK (source between one top-level
// `router.<verb>(` and the next), not a fixed character window, because the
// query and its guard are very often built across several statements — e.g.
// `let q = supabase.from(...).select(...); q = withOrg(q, req);` — and a
// window narrow enough to avoid false negatives elsewhere was throwing 328
// false positives when tried first (recorded here so nobody re-derives that
// the hard way): almost every chain in this codebase spans multiple lines.
//
// WHAT THIS TEST IS NOT: it does not prove every flagged call site is
// actually exploitable (some may be safe by construction the grep cannot see
// — e.g. an id already scoped by an earlier query in the same handler, or a
// public route with no org context at all, like an OAuth callback). What it
// DOES prove: this is the exact list today, so anyone who adds a new
// unguarded tenant-table read/write anywhere in routes/ makes this test go
// red the same session they add it — which is the point, since the original
// `GET /emails` bug shipped with a fully green suite. Existing entries are
// PRE-EXISTING DEBT surfaced by this audit, not something this territory may
// fix (routes/*.js belong to other territories) — raised as C-0019.
const GUARD = /withOrg\(|\.eq\(\s*['"](org_id|sent_by|user_id|created_by|assigned_to|assigned_to_bd|owner_id)['"]|crossOrg|forRequest\(|guardUser\(|org_id:\s*(orgId|org)\b/;

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function findUnguarded(routesDir) {
  const files = walk(routesDir);
  const flags = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const starts = [];
    const re0 = /\nrouter\.[a-zA-Z]+\(/g;
    let mm;
    while ((mm = re0.exec(src))) starts.push(mm.index + 1);
    starts.push(src.length);
    for (let i = 0; i < starts.length - 1; i++) {
      const blockStart = starts[i];
      const block = src.slice(blockStart, starts[i + 1]);
      const re = /supabase\.from\(\s*['"]([a-zA-Z_]+)['"]\s*\)/g;
      let m;
      while ((m = re.exec(block))) {
        const table = m[1];
        if (!TENANT_TABLES.has(table)) continue;
        if (!GUARD.test(block)) {
          // Keyed on the SOURCE LINE TEXT, not the line NUMBER — a line number
          // shifts every time somebody edits an unrelated line above it (this
          // happened live while writing this test: routes/auth.js gained six
          // lines of unrelated guardUser() calls between one run and the
          // next, and every line-number key below it went stale). The snippet
          // is stable across exactly that kind of edit and only breaks when
          // the flagged statement itself changes, which is the case that
          // should force a KNOWN_DEBT update anyway.
          const abs = blockStart + m.index;
          const lineStart = src.lastIndexOf('\n', abs) + 1;
          let lineEnd = src.indexOf('\n', abs);
          if (lineEnd === -1) lineEnd = src.length;
          const snippet = src.slice(lineStart, lineEnd).trim().slice(0, 80);
          flags.push(`${path.relative(ROOT, f)} :: ${snippet} [${table}]`);
        }
      }
    }
  }
  return flags.sort();
}

// Snapshot taken 2026-09-09 while closing C-0018 (refreshed once, live, when
// routes/auth.js changed under this test mid-session — see the comment on
// the snippet key above). Every line here is pre-existing debt raised to its
// owning territory via C-0019, NOT fixed by this test. If this list shrinks
// because someone fixed one, update it here too — that is a welcome edit.
// If it GROWS, that is a new unguarded call site and the fix belongs in the
// router, not in this allow-list.
const KNOWN_DEBT = [
  "routes/auth.js :: const { data, error } = await supabase.from('users').select(USER_COLS).eq('id',  [users]",
  "routes/auth.js :: const { data: user, error } = await supabase.from('users').select('*') [users]",
  "routes/companies.js :: await supabase.from('client_documents').update({ deleted_at: new Date() }) [client_documents]",
  "routes/companies.js :: await supabase.from('companies').update({ deleted_at: new Date() }).eq('id', req [companies]",
  "routes/companies.js :: const { data, error } = await supabase.from('client_documents') [client_documents]",
  "routes/companies.js :: const { data, error } = await supabase.from('client_documents').insert({ [client_documents]",
  "routes/companies.js :: const { data, error } = await supabase.from('companies').insert(rows).select('id [companies]",
  "routes/companies.js :: const { data, error } = await supabase.from('companies').insert({ name, website, [companies]",
  "routes/companies.js :: const { data, error } = await supabase.from('companies').update(updates).eq('id' [companies]",
  "routes/companies.js :: const { data: doc } = await supabase.from('client_documents') [client_documents]",
  "routes/deliverability.js :: await supabase.from('suppression_list').delete().eq('id', req.params.id); [suppression_list]",
  "routes/deliverability.js :: const { data: emails } = await supabase.from('emails').select('status,created_at [emails]",
  "routes/deliverability.js :: const { data: mbs } = await supabase.from('user_emails').select('email_address') [user_emails]",
  "routes/deliverability.js :: const { data: replied } = await supabase.from('contacts').select('id').in('id',  [contacts]",
  "routes/deliverability.js :: let mbQuery = supabase.from('user_emails').select('id,email_address,display_name [user_emails]",
  "routes/deliverability.js :: let q = supabase.from('emails').select('template_variant,contact_id,status,subje [emails]",
  "routes/deliverability.js :: let query = supabase.from('suppression_list').select('id,email,reason,source,not [suppression_list]",
  "routes/deliverability.js :: try { const { count } = await supabase.from('contacts').select('id', { count: 'e [contacts]",
  "routes/deliverability.js :: try { const { count } = await supabase.from('contacts').select('id', { count: 'e [contacts]",
  "routes/deliverability.js :: try { const { count } = await supabase.from('suppression_list').select('id', { c [suppression_list]",
  "routes/deliverability.js :: try { const { data } = await supabase.from('user_emails').select('id,warmup_star [user_emails]",
  "routes/emails.js :: const { data, error } = await supabase.from('emails').insert({ contact_id: conta [emails]",
  "routes/emails.js :: const { data, error } = await supabase.from('emails').select('id,status,sent_by' [emails]",
  "routes/emails.js :: const { error: delErr } = await supabase.from('emails').delete().eq('id', req.pa [emails]",
  "routes/emails.js :: if (contact_id) await supabase.from('contacts').update({ email_sent_at: today(), [contacts]",
  "routes/jobs.js :: await supabase.from('emails').delete().eq('job_id', req.params.id).eq('status',  [emails]",
  "routes/jobs.js :: await supabase.from('follow_ups').update({ status: 'skipped' }).eq('job_id', req [follow_ups]",
  "routes/jobs.js :: await supabase.from('jobs').update({ deleted_at: new Date() }).eq('id', req.para [jobs]",
  "routes/jobs.js :: const { data, error } = await supabase.from('contacts').select('*').eq('job_id', [contacts]",
  "routes/jobs.js :: const { data, error } = await supabase.from('jobs').select(JOB_SELECT).eq('id',  [jobs]",
  "routes/jobs.js :: const { data, error } = await supabase.from('jobs').update(updates).eq('id', req [jobs]",
  "routes/jobs.js :: const { data, error } = await supabase.from('jobs').update({ research, updated_a [jobs]",
  "routes/jobs.js :: const { data: existing } = await supabase.from('jobs').select('*').eq('id', req. [jobs]",
  "routes/jobs.js :: const { data: existing } = await supabase.from('jobs').select('created_by,positi [jobs]",
  "routes/jobs.js :: const { data: job } = await supabase.from('jobs').select('created_by,industry'). [jobs]",
  "routes/jobs.js :: const { data: job } = await supabase.from('jobs').select('created_by,industry,co [jobs]",
  "routes/lookups.js :: const { data, error } = await supabase.from('contacts') [contacts]",
  "routes/microsoft.js :: await supabase.from('microsoft_tokens').delete().eq('user_email_id', req.params. [microsoft_tokens]",
  "routes/microsoft.js :: await supabase.from('microsoft_tokens').delete().eq('user_email_id', userEmailId [microsoft_tokens]",
  "routes/microsoft.js :: await supabase.from('user_emails').update({ is_active: false }).eq('id', req.par [user_emails]",
  "routes/microsoft.js :: await supabase.from('user_emails').update({ platform: 'Microsoft', is_active: tr [user_emails]",
  "routes/microsoft.js :: const { data } = await supabase.from('microsoft_tokens').select('email_address,e [microsoft_tokens]",
  "routes/microsoft.js :: const { data: mailbox } = await supabase.from('user_emails').select('user_id').e [user_emails]",
  "routes/microsoft.js :: const { data: userEmailRow } = await supabase.from('user_emails').select('email_ [user_emails]",
  "routes/microsoft.js :: const { error: insertErr } = await supabase.from('microsoft_tokens').insert( [microsoft_tokens]",
  "routes/workflows.js :: await supabase.from('emails').delete().in('job_id', job_ids).eq('status', 'pendi [emails]",
  "routes/workflows.js :: await supabase.from('follow_ups').update({ status: 'expired' }).in('job_id', job [follow_ups]",
  "routes/workflows.js :: const { data, error } = await supabase.from('contacts').select('email, job_id, j [contacts]",
  "routes/workflows.js :: const { error } = await supabase.from('jobs').update(updates).in('id', job_ids); [jobs]",
  "routes/workflows.js :: let query = supabase.from('jobs').select('id,stage,created_by,assigned_to,contac [jobs]",
].sort();

{
  const flags = findUnguarded(path.join(ROOT, 'routes'));
  const extra = flags.filter(f => !KNOWN_DEBT.includes(f));
  const fixed = KNOWN_DEBT.filter(f => !flags.includes(f));
  ok('routes/: no NEW unguarded tenant-table supabase.from() call beyond the known-debt snapshot',
    extra.length === 0,
    extra.length ? `NEW: ${extra.join(' | ')}` : '');
  ok('routes/: known-debt snapshot is still accurate (nothing silently fixed without updating this list)',
    fixed.length === 0,
    fixed.length ? `no longer flagged, remove from KNOWN_DEBT: ${fixed.join(' | ')}` : '');
  // Proves the grep actually works rather than passing vacuously: the exact
  // bug dispatch found (GET /emails, no org_id condition) must still be in
  // the snapshot right now — if this ever goes false because the underlying
  // scan logic broke, that is itself worth knowing.
  ok('the grep catches the ORIGINAL reported bug (routes/emails.js has unguarded `emails` reads)',
    flags.some(f => f.startsWith('routes/emails.js') && f.endsWith('[emails]')));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. routes/auth.js: every /users/:id* route answers 404 (not 403) for a
//    cross-org id — a 403 would confirm the record exists to whoever is
//    probing it.
{
  const authFactory = require(path.join(ROOT, 'routes/auth.js'));

  // A recording double, same shape as org-scoping-routes-smoke.mjs's, plus a
  // real `users` row belonging to ANOTHER org so the guard has something to
  // correctly refuse.
  const FOREIGN_USER = { id: 'foreign-user', org_id: 'org-B', name: 'Foreign', email: 'f@x.com', roles: ['ra'] };
  function recordingSupabase() {
    function builder(table) {
      const filters = {};
      let op = 'select';
      const chain = {
        select: () => chain,
        insert: (v) => { op = 'insert'; chain._payload = v; return chain; },
        update: (v) => { op = 'update'; chain._payload = v; return chain; },
        delete: () => { op = 'delete'; return chain; },
        eq: (col, val) => { filters[col] = val; return chain; },
        is: () => chain,
        order: () => chain,
        single: async () => resolve(),
        maybeSingle: async () => resolve(),
        then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
      };
      function resolve() {
        if (table !== 'users') return { data: null, error: null };
        if (filters.id && filters.id !== FOREIGN_USER.id) return { data: null, error: null };
        if (filters.org_id && filters.org_id !== FOREIGN_USER.org_id) return { data: null, error: null };
        return { data: FOREIGN_USER, error: null };
      }
      return chain;
    }
    return { from: builder };
  }

  const ctx = {
    supabase: recordingSupabase(),
    auth: (req, _res, next) => { req.user = { id: 'caller', org_id: 'org-A', roles: ['admin'] }; req.orgId = 'org-A'; next(); },
    hasRole: (req, ...roles) => (req.user.roles || []).some(r => roles.includes(r)),
    loadMailboxSignatures: async () => ({}),
  };

  const app = require('express')();
  app.use(require('express').json());
  app.use(authFactory(ctx));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body) => fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });

  try {
    const putRes = await call('PUT', `/users/${FOREIGN_USER.id}`, { name: 'Renamed' });
    ok('PUT /users/:id (foreign org) → 404, not 403', putRes.status === 404, `got ${putRes.status}`);

    const rolesRes = await call('PUT', `/users/${FOREIGN_USER.id}/roles`, { roles: ['admin'] });
    ok('PUT /users/:id/roles (foreign org) → 404, not 403', rolesRes.status === 404, `got ${rolesRes.status}`);

    const delRes = await call('DELETE', `/users/${FOREIGN_USER.id}`);
    ok('DELETE /users/:id (foreign org) → 404, not 403', delRes.status === 404, `got ${delRes.status}`);

    const mgrRes = await call('PUT', `/users/${FOREIGN_USER.id}/manager`, { manager_id: null });
    ok('PUT /users/:id/manager (foreign org) → 404, not 403', mgrRes.status === 404, `got ${mgrRes.status}`);

    const emailsRes = await call('GET', `/users/${FOREIGN_USER.id}/emails`);
    ok('GET /users/:id/emails (foreign org) → 404, not 403', emailsRes.status === 404, `got ${emailsRes.status}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. middleware/authorize.js: canTouchJob false for a job in another org even
//    when the caller is an admin, true for one in their own. (Restates the
//    class from test/authorize.mjs deliberately — this is the audit's own
//    checklist, and the two suites failing independently is the point: one
//    can regress without the other noticing if they were merged into one.)
{
  const mockOrgAware = (jobRow) => ({
    from: () => {
      const filters = {};
      const chain = {
        select: () => chain,
        eq: (col, val) => { filters[col] = val; return chain; },
        single: async () => {
          if (!jobRow) return { data: null };
          for (const [col, val] of Object.entries(filters)) if (jobRow[col] !== val) return { data: null };
          return { data: jobRow };
        },
      };
      return chain;
    },
  });
  const admin = { user: { id: 'a', roles: ['admin'] }, orgId: 'org-A' };
  const { canTouchJob } = createAuthorize({ supabase: mockOrgAware({ id: 'j', org_id: 'org-B', created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z' }) });
  ok('canTouchJob: admin in org-A, job in org-B → false', (await canTouchJob(admin, 'j')) === false);

  const { canTouchJob: ctjSameOrg } = createAuthorize({ supabase: mockOrgAware({ id: 'j', org_id: 'org-A', created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z' }) });
  ok('canTouchJob: admin in org-A, job in org-A → true', (await ctjSameOrg(admin, 'j')) === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. services/provisioning.js: onOrgCreated fires when createWorkspace (via
//    provision()) succeeds — this is what arms MULTI_ORG without a restart.
{
  const inserted = { organizations: [], users: [] };
  const fakeSupabase = {
    from: (table) => ({
      insert: (row) => ({
        select: () => ({
          single: async () => {
            const withId = { id: `${table}-1`, ...row };
            inserted[table] = inserted[table] || [];
            inserted[table].push(withId);
            return { data: withId, error: null };
          },
        }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  };

  let fired = null;
  provisioning.onOrgCreated((org) => { fired = org; });

  const result = await provisioning.provision(fakeSupabase, { action: 'create_workspace', role: 'admin' }, { email: 'new@co.example.com', name: 'New Co' });

  ok('provision(create_workspace) succeeds', result.ok === true, JSON.stringify(result));
  ok('onOrgCreated listener fires with the new org row', !!fired && fired.id === result.orgId, JSON.stringify(fired));

  // A throwing listener must never break the signup it is just an observer of.
  provisioning.onOrgCreated(() => { throw new Error('boom'); });
  const result2 = await provisioning.provision(fakeSupabase, { action: 'create_workspace', role: 'admin' }, { email: 'new2@co.example.com', name: 'New Co 2' });
  ok('a throwing onOrgCreated listener never breaks provision()', result2.ok === true, JSON.stringify(result2));
}

console.log('\n=== ORG-SCOPING GUARD TEST (C-0018) ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
