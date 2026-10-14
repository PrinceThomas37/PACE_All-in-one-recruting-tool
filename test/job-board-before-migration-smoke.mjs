// THE JOB BOARD STILL LOADS BEFORE MIGRATION 065 IS APPLIED (D-0141 #3).
// GET /job-orders/browse names `pay_period` in its select list. A database that has not had migration 065 answers "no such column",
// and the whole board would have been empty. The route now retries without that one column. Proven through the REAL route over a
// database that behaves both ways:
//   * with the column: the board has the pay period;
//   * without it (42703 naming pay_period): the board still lists every job, minus the period — and no error;
//   * any OTHER database error is still an error (the retry is for this one column only).
// Usage: node test/job-board-before-migration-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const O = 'org-a';
const fake = createFakeDb({
  relations: { job_orders: { company: { table: 'companies', fk: 'company_id' }, bd_manager: { table: 'users', fk: 'bd_manager_id' } } },
  tables: { users: [{ id: 'rec1', org_id: O, role: 'recruiter', deleted_at: null }], companies: [], recruiter_assignments: [], submissions: [], assignment_requests: [], app_settings: [],
    job_orders: [{ id: 'j1', org_id: O, job_code: 'JO-1', job_title: 'Estimator', client: 'Acme', status: 'Active', pay_cur: 'USD', pay_min: '22', pay_max: '26', pay_period: 'hour', created_at: new Date().toISOString(), deleted_at: null }] },
});
let mode = 'migrated';   // 'migrated' | 'old' | 'broken'
const supabase = { ...fake.supabase, from(t) {
  const q = fake.supabase.from(t);
  if (t !== 'job_orders') return q;
  const sel = q.select.bind(q);
  q.select = (cols, o) => {
    if (mode === 'old' && /pay_period/.test(String(cols))) { const dead = { is: () => dead, eq: () => dead, order: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column job_orders.pay_period does not exist' } }), then: (r) => r({ data: null, error: { code: '42703', message: 'column job_orders.pay_period does not exist' } }) }; return dead; }
    if (mode === 'broken') { const dead = { is: () => dead, eq: () => dead, order: () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }), then: (r) => r({ data: null, error: { code: '57014', message: 'timeout' } }) }; return dead; }
    return sel(cols, o);
  };
  return q;
} };
const hasRole = (req, ...roles) => (req.user.roles || []).some(r => roles.includes(r));
const core = require(path.join(ROOT, 'services/recruiting-core.js'))({ supabase, db: {}, auth: (req, res, next) => { req.user = { id: 'rec1', org_id: O, role: 'recruiter', roles: ['recruiter'] }; req.orgId = O; next(); }, hasRole, today: () => '2026-10-14', loadSuppressedSet: async () => new Set() });
const app = express(); app.use(express.json());
require(path.join(ROOT, 'routes/recruiting/job-orders.js'))(app, core);
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const get = () => new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${server.address().port}/job-orders/browse`, (res) => { let out = ''; res.on('data', d => { out += d; }); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(out); } catch (_) { return out; } })() })); }).on('error', reject); });

let r = await get();
step('with the column: the board lists the job with its pay period', r.status === 200 && r.json.length === 1 && r.json[0].pay_period === 'hour', JSON.stringify(r).slice(0, 160));
mode = 'old';
r = await get();
step('BEFORE migration 065: the board still lists the job (no error)', r.status === 200 && Array.isArray(r.json) && r.json.length === 1 && r.json[0].job_title === 'Estimator', JSON.stringify(r).slice(0, 200));
step('…without the period (the column does not exist yet)', r.status === 200 && r.json[0] && r.json[0].pay_period === undefined);
mode = 'broken';
r = await get();
step('a different database error is still an error, not a quiet empty board', r.status === 500, JSON.stringify(r).slice(0, 160));
server.close();
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
