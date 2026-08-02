// Unit test for models/ — the data-access layer that makes org scoping
// structural instead of remembered.
//
// The bug this layer exists to kill: a hand-written query that forgets
// .eq('org_id', …) and silently returns another org's rows. Four of those
// appeared in a single session. The failure is invisible — more rows, never an
// error — so the tests below assert on the QUERY THAT GETS BUILT, which is the
// only place the mistake is visible before it reaches a customer.
//
// Usage: node test/models-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDb, TenancyError } = require('../models/index.js');
const { TENANT_TABLES, GLOBAL_TABLES } = require('../models/tables.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── A Supabase double that RECORDS the query instead of running it ───────────
// Every builder method returns `this` and appends to a log, so a test can
// assert exactly which filters were applied and in what order.
function fakeSupabase() {
  const log = [];
  function builder(table) {
    const calls = [];
    const b = {
      table, calls,
      _rowsForSingle: null,
      then: undefined, // not a promise unless awaited via maybeSingle below
    };
    for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'is', 'gte', 'neq']) {
      b[m] = (...args) => { calls.push({ m, args }); return b; };
    }
    b.maybeSingle = async () => ({ data: b._rowsForSingle, error: null });
    b.single = async () => ({ data: b._rowsForSingle, error: null });
    return b;
  }
  return {
    log,
    from(table) { const b = builder(table); log.push(b); return b; },
    lastQuery() { return log[log.length - 1]; },
  };
}

const eqCalls = (b) => b.calls.filter(c => c.m === 'eq');
const orgFilter = (b) => eqCalls(b).find(c => c.args[0] === 'org_id');
const ORG = 'org-aaa';
const req = { orgId: ORG, user: { org_id: ORG } };

// ── 1. Reads are scoped automatically ────────────────────────────────────────
{
  const sb = fakeSupabase();
  const db = createDb(sb);
  db.forRequest(req).from('candidates').select('*');
  const q = sb.lastQuery();
  ok('a scoped select filters on org_id without being asked', !!orgFilter(q), JSON.stringify(q.calls));
  ok('...with the caller\'s org id', orgFilter(q)?.args[1] === ORG);
  ok('...applied AFTER select (order matters to postgrest)', q.calls[0].m === 'select', q.calls[0].m);
  ok('the caller still gets a chainable builder back', typeof q.eq === 'function' && typeof q.order === 'function');
}
{
  // The count option form — easy to drop a filter on when hand-written.
  const sb = fakeSupabase();
  createDb(sb).forRequest(req).from('submissions').select('id', { count: 'exact', head: true });
  const q = sb.lastQuery();
  ok('select with options is still scoped', !!orgFilter(q));
  ok('...and the options are passed through', q.calls[0].args[1]?.count === 'exact', JSON.stringify(q.calls[0].args));
}

// ── 2. Writes are scoped / stamped ───────────────────────────────────────────
{
  const sb = fakeSupabase();
  const db = createDb(sb);
  db.forRequest(req).from('candidates').insert({ name: 'Ada' });
  const ins = sb.lastQuery().calls[0];
  ok('insert stamps org_id onto the row', ins.args[0].org_id === ORG, JSON.stringify(ins.args[0]));

  db.forRequest(req).from('candidates').insert([{ name: 'A' }, { name: 'B' }]);
  const bulk = sb.lastQuery().calls[0].args[0];
  ok('bulk insert stamps every row', bulk.every(r => r.org_id === ORG), JSON.stringify(bulk));

  db.forRequest(req).from('candidates').insert({ name: 'X', org_id: 'explicit-org' });
  ok('an explicitly-set org_id is never overwritten', sb.lastQuery().calls[0].args[0].org_id === 'explicit-org');

  db.forRequest(req).from('candidates').update({ name: 'Grace' });
  ok('update is org-filtered (cannot patch another org\'s row)', !!orgFilter(sb.lastQuery()));

  db.forRequest(req).from('candidates').delete();
  ok('delete is org-filtered (cannot delete another org\'s row)', !!orgFilter(sb.lastQuery()));

  db.forRequest(req).from('candidates').upsert({ id: 1 }, { onConflict: 'id' });
  const up = sb.lastQuery().calls[0];
  ok('upsert stamps org_id', up.args[0].org_id === ORG);
  ok('...and preserves its options', up.args[1]?.onConflict === 'id');
}

// ── 3. byId — the single-record long tail that leaked before ─────────────────
{
  const sb = fakeSupabase();
  const db = createDb(sb);
  const p = db.forRequest(req).from('job_orders').byId('job-1');
  const q = sb.lastQuery();
  q._rowsForSingle = { id: 'job-1' };
  await p;
  ok('byId filters on org_id', !!orgFilter(q), JSON.stringify(q.calls));
  ok('byId filters on the id too', eqCalls(q).some(c => c.args[0] === 'id' && c.args[1] === 'job-1'));

  const sb2 = fakeSupabase();
  const p2 = createDb(sb2).forRequest(req).from('job_orders').byId('other-org-job');
  sb2.lastQuery()._rowsForSingle = null;
  ok('byId returns null for a row outside the org (404, not a leak)', (await p2) === null);
}

// ── 4. The guards — the whole point ──────────────────────────────────────────
{
  const db = createDb(fakeSupabase());
  const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

  const e1 = throws(() => db.global.from('candidates'));
  ok('reaching tenant data through db.global throws', e1 instanceof TenancyError, String(e1));
  ok('...and the error says what to do instead', /forRequest|crossOrg/.test(String(e1?.message)), String(e1?.message));

  const e2 = throws(() => db.forRequest(req).from('app_settings'));
  ok('a global table through a scoped accessor throws', e2 instanceof TenancyError, String(e2));

  const e3 = throws(() => db.forRequest(req).from('candidatez'));
  ok('a typo\'d table name throws instead of silently failing', e3 instanceof TenancyError, String(e3));
  ok('...and points at the registry', /models\/tables\.js/.test(String(e3?.message)));

  ok('crossOrg on an unknown table still throws', throws(() => db.crossOrg('nope')) instanceof TenancyError);
}

// ── 5. Escape hatches work, and are visible ──────────────────────────────────
{
  const sb = fakeSupabase();
  const db = createDb(sb);
  db.crossOrg('emails').select('*');
  ok('crossOrg deliberately applies NO org filter', !orgFilter(sb.lastQuery()), JSON.stringify(sb.lastQuery().calls));

  db.global.from('app_settings').select('*');
  ok('db.global applies no org filter', !orgFilter(sb.lastQuery()));
  ok('db.raw exposes the underlying client for rpc/storage', db.raw === sb);
}

// ── 6. Background jobs: forOrg, and the transitional no-op ───────────────────
{
  const sb = fakeSupabase();
  const db = createDb(sb);
  db.forOrg('org-bbb').from('jobs').select('*');
  ok('forOrg scopes without a request object', orgFilter(sb.lastQuery())?.args[1] === 'org-bbb');

  // Matches the withOrg() this replaces: no org resolved => no filter, because
  // every org_id column has a DEFAULT of the platform's default org.
  db.forRequest({}).from('jobs').select('*');
  ok('no resolvable org => no filter (single-tenant behaviour preserved)', !orgFilter(sb.lastQuery()));
  db.forRequest({}).from('jobs').insert({ a: 1 });
  ok('no resolvable org => no stamp (the column DEFAULT applies)', sb.lastQuery().calls[0].args[0].org_id === undefined);

  db.forRequest({ user: { org_id: 'org-ccc' } }).from('jobs').select('*');
  ok('org is read from req.user.org_id when req.orgId is unset', orgFilter(sb.lastQuery())?.args[1] === 'org-ccc');
}

// ── 7. The registry itself ───────────────────────────────────────────────────
{
  // Verified against the live schema of project teiqievahzhllojvgsku.
  ok('the registry covers all 38 live tenant tables', TENANT_TABLES.size === 38, String(TENANT_TABLES.size));
  ok('the registry lists the 8 live global tables', GLOBAL_TABLES.size === 8, String(GLOBAL_TABLES.size));
  const overlap = [...TENANT_TABLES].filter(t => GLOBAL_TABLES.has(t));
  ok('no table is in both lists', overlap.length === 0, overlap.join(','));
  for (const t of ['candidates', 'job_orders', 'submissions', 'jobs', 'companies', 'contacts', 'users', 'email_tracking'])
    ok(`${t} is registered as tenant data`, TENANT_TABLES.has(t));
  for (const t of ['app_settings', 'organizations', 'engine_runs', 'microsoft_tokens'])
    ok(`${t} is registered as global`, GLOBAL_TABLES.has(t));
}

// ── 8. Every tenant table really is scoped (no per-table gaps) ───────────────
{
  const db = createDb(fakeSupabase());
  const unscoped = [];
  for (const t of TENANT_TABLES) {
    const sb = fakeSupabase();
    createDb(sb).forRequest(req).from(t).select('*');
    if (!orgFilter(sb.lastQuery())) unscoped.push(t);
  }
  ok('EVERY registered tenant table gets an org filter', unscoped.length === 0, unscoped.join(','));

  const leaked = [];
  for (const t of GLOBAL_TABLES) {
    try { db.global.from(t); } catch (e) { leaked.push(t); }
  }
  ok('EVERY registered global table is reachable via db.global', leaked.length === 0, leaked.join(','));
}

// ── 9. Misuse of the factory ─────────────────────────────────────────────────
{
  let err;
  try { createDb(null); } catch (e) { err = e; }
  ok('createDb(null) fails loudly at wiring time', err instanceof TenancyError, String(err));
}

console.log('\n=== MODELS SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
