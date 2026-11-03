// WHO ASSIGNED A LEAD — the edit form path (PUT /jobs/:id), the REAL route over an in-memory PostgREST (R-340, owner 3 Nov 2026).
//   an admin / RA Lead changes the owner → the lead records WHO did it and the history says who handed it to whom;
//   the edit form re-sends the SAME owner on every save → who-assigned is NOT rewritten to whoever saved last;
//   clearing the owner → nobody assigned it any more.
// Usage: node test/job-owner-edit-routes-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const ORG = 'org-a';
const fake = createFakeDb({ tables: {
  users: [{ id: 'adm', org_id: ORG, name: 'Prince Thomas', manager_id: null }, { id: 'bdA', org_id: ORG, name: 'Alex BD', manager_id: 'adm' }, { id: 'bdB', org_id: ORG, name: 'Sam Wilson', manager_id: 'adm' }],
  jobs: [{ id: 'J1', org_id: ORG, position: 'Nurse', stage: 'Assigned', assigned_to_bd: 'bdA', assigned_by: 'someone-before', created_by: 'adm', deleted_at: null, research: null, notes: '' }],
  activity_log: [], companies: [], contacts: [], follow_ups: [], emails: [], app_settings: [],
}, defaults: { activity_log: () => ({ id: Math.random().toString(36).slice(2) }) } });
const supabase = fake.supabase; const db = createDb(supabase);
const logged = [];
const app = express(); app.use(express.json());
const user = { id: 'adm', name: 'Prince Thomas', role: 'admin', roles: ['admin'], org_id: ORG };
const auth = (req, res, next) => { req.user = user; req.orgId = ORG; next(); };
const hasRole = (req, ...r) => (req.user.roles || []).some((x) => r.includes(x));
const ctx = {
  supabase, db, auth, hasRole, today: () => '2026-11-03', canTouchJob: async () => true, ownership: require('../services/ownership'),
  logActivity: async (...a) => { logged.push(a); }, orgIdFor: () => ORG, withOrg: (q) => q.eq('org_id', ORG), orgStamp: () => ({ org_id: ORG }),
  userOrgId: async () => ORG, mailboxOrgId: async () => ORG, loadAllJobs: async () => [], JOB_SELECT: '*', getTimezoneFromLocation: () => null, persistLearnedSkills: () => {},
};
app.use(require('../routes/jobs')(ctx));
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const put = async (id, body) => { const r = await fetch(API + '/jobs/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; };
const job = () => fake.tables.jobs.find((j) => j.id === 'J1');
try {
  const a = await put('J1', { assigned_to_bd: 'bdB' });
  step('changing the owner works (200) and moves the lead', a.status === 200 && job().assigned_to_bd === 'bdB', a.status + ' ' + JSON.stringify(a.body).slice(0, 120));
  step('R-340: the lead now records WHO did it (the admin who edited)', job().assigned_by === 'adm', String(job().assigned_by));
  const h = logged.find((l) => l[3] === 'assigned');
  step('the history gets one line: who handed it to whom', !!h && h[2] === 'adm' && h[4] === 'Assigned to Sam Wilson by Prince Thomas (lead edited)' && h[6] && h[6].assigned_by === 'adm' && h[6].assigned_to_bd === 'bdB', JSON.stringify(h && h[4]));

  // the edit form re-sends the same owner on every save: someone else saving must not take the credit
  user.id = 'adm2'; user.name = 'Other Admin';
  const b = await put('J1', { assigned_to_bd: 'bdB', notes: 'called them' });
  step('saving again with the SAME owner does not rewrite who assigned it', b.status === 200 && job().assigned_by === 'adm', String(job().assigned_by));
  step('…and writes no second "assigned" history line', logged.filter((l) => l[3] === 'assigned').length === 1);
  user.id = 'adm'; user.name = 'Prince Thomas';

  const c = await put('J1', { assigned_to_bd: null });
  step('clearing the owner clears who assigned it (nobody has it any more)', c.status === 200 && job().assigned_to_bd === null && job().assigned_by === null, String(job().assigned_by));
  step('…and writes no "assigned" line (nothing was handed over)', logged.filter((l) => l[3] === 'assigned').length === 1);
} catch (e) { step('route test ran without throwing', false, e.stack); }
srv.close();
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
