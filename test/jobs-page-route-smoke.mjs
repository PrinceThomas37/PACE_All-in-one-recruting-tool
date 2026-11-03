// R-349 Stage 1 — GET /jobs/page, THE REAL ROUTE (routes/jobs.js mounted over an in-memory PostgREST).
//   · WHO SEES WHAT is decided before any filter: a plain BD never gets a lead outside their reporting chain, even by asking for it
//     with a filter, an assignee or a huge page; an admin sees the company; another company's lead is never in anyone's page.
//   · the literal path is not swallowed by /jobs/:id (registration order — a dead route fails silently);
//   · the page size: the person's own 10/20/50, else the ADMIN's default (app_settings), else 20 — never a number typed in the code;
//   · "select all" ids cover every page; a team manager opens on "mine" with the mine/team counts.
// Usage: node test/jobs-page-route-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a';
const users = [
  { id: 'boss', org_id: ORG, manager_id: null }, { id: 'mgr', org_id: ORG, manager_id: 'boss' },
  { id: 'rep1', org_id: ORG, manager_id: 'mgr' }, { id: 'rep2', org_id: ORG, manager_id: 'mgr' }, { id: 'lone', org_id: ORG, manager_id: 'boss' },
];
const owners = ['rep1', 'rep2', 'lone', 'mgr'];
const jobs = [];
for (let i = 0; i < 50; i++) {
  jobs.push({ id: 'J' + String(i).padStart(2, '0'), org_id: ORG, position: 'Role ' + i, stage: i % 3 ? 'Assigned' : 'Connected', location: 'Austin',
    company: { name: 'Co' + (i % 5), industry: 'Healthcare' }, contacts: [], created_by: owners[i % 4], assigned_to: owners[i % 4], assigned_to_bd: owners[i % 4], created_at: '2026-11-0' + (1 + (i % 3)) + 'T10:00:00Z' });
}
jobs.push({ id: 'POOL1', org_id: ORG, position: 'Pool', stage: 'Unassigned', company: { name: 'P' }, contacts: [], created_by: 'boss', assigned_to_bd: null, created_at: '2026-11-01T10:00:00Z' });
const fake = createFakeDb({ tables: { users, app_settings: [], jobs: [] } });
// the admin's own number, stored BEFORE the first read (settings are cached per process)
fake.tables.app_settings.push({ key: 'sys_leads_page_size_default@' + ORG, value: '50' });
const supabase = fake.supabase; const db = createDb(supabase);

let current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG };
const app = express(); app.use(express.json());
const auth = (req, res, next) => { req.user = current; req.orgId = ORG; next(); };
const hasRole = (req, ...r) => (req.user.roles || [req.user.role]).some((x) => r.includes(x));
const ctx = {
  supabase, db, auth, hasRole, today: () => '2026-11-03', canTouchJob: async () => true, logActivity: async () => {}, ownership: require('../services/ownership'),
  orgIdFor: () => ORG, withOrg: (q) => q.eq('org_id', ORG), orgStamp: () => ({ org_id: ORG }), userOrgId: () => ORG, mailboxOrgId: () => ORG,
  loadAllJobs: async () => jobs, JOB_SELECT: '*', getTimezoneFromLocation: () => null, persistLearnedSkills: () => {},
};
app.use(require('../routes/jobs')(ctx));
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const get = async (path) => { const r = await fetch(API + path); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; };
const as = (u) => { current = u; };

try {
  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const all = await get('/jobs/page?perPage=50');
  step('the literal /jobs/page is answered by its own handler (not shadowed by /jobs/:id)', all.status === 200 && Array.isArray(all.body.ids), String(all.status));
  step('an admin sees the whole company: 51 leads, pool included', all.body.total === 51 && all.body.ids.includes('POOL1'), String(all.body.total));

  as({ id: 'lone', role: 'bd', roles: ['bd'], org_id: ORG });
  const lone = await get('/jobs/page?perPage=50&assignee=rep1');
  step('a plain BD asking for ANOTHER rep\'s leads gets nothing of theirs (scope is applied before the filter)', lone.status === 200 && lone.body.total === 0 && lone.body.ids.length === 0, JSON.stringify(lone.body.total));
  const loneAll = await get('/jobs/page?perPage=50');
  step('…and only their own leads otherwise', loneAll.body.ids.every((id) => jobs.find((j) => j.id === id).assigned_to_bd === 'lone') && loneAll.body.total > 0, String(loneAll.body.total));
  step('a plain BD does not get the unassigned pool', !loneAll.body.ids.includes('POOL1'));

  as({ id: 'mgr', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG });
  const mgr = await get('/jobs/page?perPage=50');
  step('a team manager opens on "mine" and is told the mine/team split', mgr.body.team.on === true && mgr.body.team.whose === 'mine' && mgr.body.team.mine > 0 && mgr.body.team.team > 0, JSON.stringify(mgr.body.team));
  const team = await get('/jobs/page?perPage=50&whose=team');
  step('…one click shows the team\'s (rep1 + rep2 only, never "lone")', team.body.total > 0 && team.body.ids.every((id) => ['rep1', 'rep2'].includes(jobs.find((j) => j.id === id).assigned_to_bd)));

  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const p2 = await get('/jobs/page?perPage=20&page=2');
  step('paging: page 3 of 20 holds the last 11 of 51; select-all ids still cover all 51', p2.body.rows.length === 11 && p2.body.ids.length === 51 && p2.body.pageCount === 3, `${p2.body.rows.length}/${p2.body.ids.length}/${p2.body.pageCount}`);
  const stage = await get('/jobs/page?perPage=50&stages=Connected');
  step('stage filter works through the query string; strip counts ignore the stage button', stage.body.total === jobs.filter((j) => j.stage === 'Connected').length && stage.body.stripTotal === 51);

  // page size: the person's choice, else the ADMIN's setting, else 20
  // (settings are cached per process, so the admin's number is stored BEFORE the first read; "nothing stored → 20" is the schema default below)
  step('the admin\'s default is used when the person has not chosen (50)', (await get('/jobs/page')).body.perPage === 50, String((await get('/jobs/page')).body.perPage));
  step('a person\'s own choice (10) beats the admin\'s default', (await get('/jobs/page?perPage=10')).body.perPage === 10);
  step('a made-up page size (7) is ignored, not obeyed', (await get('/jobs/page?perPage=7')).body.perPage === 50);

  const names = require('../config/settings.js').SETTINGS_SCHEMA.find((s) => s.key === 'leads_page_size_default');
  step('the default page size is an admin setting in SETTINGS_SCHEMA (D-0123), not a number in the code', !!names && names.default === 20 && names.min === 10 && names.max === 50);
} catch (e) { step('route test ran without throwing', false, e.stack); }
srv.close();
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
