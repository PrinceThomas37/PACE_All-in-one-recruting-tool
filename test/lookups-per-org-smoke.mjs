// R-048 (Session 32, migration 050): a recruiting dropdown word is unique PER
// COMPANY. Before 050 the rule was (category, lower(value)) across all of PACE,
// so a second customer adding "Remote" would be told it "already exists in
// this list" — about a list it cannot see.
//
// Runs the REAL handlers (routes/recruiting/lookups.js) against an in-memory
// table that enforces exactly the index migration 050 creates, and checks the
// migration file declares that index. Also pins the rename path: renaming onto
// an existing word used to surface a raw database error (500).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the migration declares the per-company index and drops the global one ──
const mig = readFileSync(new URL('../migrations/050_lookups_unique_per_org.sql', import.meta.url), 'utf8');
step('050 creates a unique index on (org_id, category, lower(value))',
  /CREATE UNIQUE INDEX[^;]*recruiting_lookups\s*\(\s*org_id\s*,\s*category\s*,\s*lower\(value\)\s*\)/i.test(mig));
step('050 drops the old global index', /DROP INDEX[^;]*recruiting_lookups_cat_val_uidx/i.test(mig));
step('050 creates the new rule BEFORE dropping the old (never a moment with none)',
  mig.search(/CREATE UNIQUE INDEX/i) < mig.search(/DROP INDEX/i));

// ── in-memory table enforcing the 050 index ──
const rows = [];
let seq = 0;
const key = (r) => [r.org_id, r.category, String(r.value).toLowerCase()].join('|');
const clash = (r, exceptId) => rows.some(x => x.id !== exceptId && key(x) === key(r));
function q() {
  const f = []; let op = 'select', payload = null;
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    insert(p) { op = 'insert'; payload = p; return api; },
    update(p) { op = 'update'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    single() { return api.then(x => ({ ...x, data: Array.isArray(x.data) ? x.data[0] || null : x.data })); },
    maybeSingle() { return api.single(); },
    then(res, rej) {
      let out;
      if (op === 'insert') {
        const r = { id: 'l' + (++seq), is_active: true, ...payload };
        out = clash(r) ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "recruiting_lookups_org_cat_val_uidx"' } }
          : (rows.push(r), { data: [r], error: null });
      } else if (op === 'update') {
        const hit = rows.filter(r => f.every(fn => fn(r)));
        const bad = hit.some(r => clash({ ...r, ...payload }, r.id));
        out = bad ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          : (hit.forEach(r => Object.assign(r, payload)), { data: hit, error: null });
      } else out = { data: rows.filter(r => f.every(fn => fn(r))), error: null };
      return Promise.resolve(out).then(res, rej);
    },
  };
  return api;
}
const routes = {};
const app = { get: (p, ...h) => { routes['GET ' + p] = h.at(-1); }, post: (p, ...h) => { routes['POST ' + p] = h.at(-1); },
  patch: (p, ...h) => { routes['PATCH ' + p] = h.at(-1); }, delete: (p, ...h) => { routes['DELETE ' + p] = h.at(-1); }, put() {} };
const hasRole = (req, ...rs) => rs.some(r => (req.user.roles || []).includes(r));
require('../routes/recruiting/lookups.js')(app, {
  supabase: { from: () => q() }, auth: (_a, _b, n) => n(), hasRole,
  orgIdFor: (req) => req.orgId, orgStamp: (req) => ({ org_id: req.orgId }),
  withOrg: (query, req) => query.eq('org_id', req.orgId),
});
const call = async (key, orgId, body = {}, params = {}) => {
  let out, status = 200;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await routes[key]({ user: { id: 'u', roles: ['admin'] }, orgId, body, params, query: {} }, res);
  return { status, body: out };
};

let r = await call('POST /admin/recruiting-lookups', 'orgA', { category: 'source', value: 'Remote' });
step('company A adds "Remote"', r.status === 201, JSON.stringify(r.body));
r = await call('POST /admin/recruiting-lookups', 'orgB', { category: 'source', value: 'Remote' });
step('company B can ALSO add "Remote" (the point of R-048)', r.status === 201, JSON.stringify(r.body));
r = await call('POST /admin/recruiting-lookups', 'orgA', { category: 'source', value: 'remote' });
step('company A still cannot add it twice, whatever the case — a friendly 409', r.status === 409 && /already exists/.test(r.body.error));
r = await call('POST /admin/recruiting-lookups', 'orgA', { category: 'availability', value: 'Remote' });
step('the same word in a different list of the same company is fine', r.status === 201);

const other = await call('POST /admin/recruiting-lookups', 'orgA', { category: 'source', value: 'Referral' });
r = await call('PATCH /admin/recruiting-lookups/:id', 'orgA', { value: 'REMOTE' }, { id: other.body.id });
step('renaming onto an existing word says so in words (409), not a raw error (500)', r.status === 409 && /already exists/.test(r.body && r.body.error), JSON.stringify(r));
r = await call('PATCH /admin/recruiting-lookups/:id', 'orgA', { value: 'Job board' }, { id: other.body.id });
step('an ordinary rename still works', r.status === 200 && r.body.value === 'Job board');
r = await call('PATCH /admin/recruiting-lookups/:id', 'orgB', { value: 'x' }, { id: other.body.id });
step("another company cannot rename A's value (404)", r.status === 404);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
