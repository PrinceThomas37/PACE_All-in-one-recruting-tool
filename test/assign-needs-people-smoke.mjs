// A lead nobody can write to is not handed out (20 Oct 2026).
//
// 85 leads were assigned to two BDs; none had a contact person, so no email could ever be written, and the only trace was a
// progress message that vanished after five minutes. Now: the pool count says how many have nobody to write to, the Assign
// window says so before the click, and Assign leaves those in the pool.
//
// Calls the real rule (services/lead-distribution.js) and the real pool-stats route against an in-memory database.
//
// Usage: node test/assign-needs-people-smoke.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const dist = require('../services/lead-distribution');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

// ── the rule ────────────────────────────────────────────────────────────────
ok('a lead with a person who has a well-formed address can be written to', dist.hasWritableContact({ contacts: [{ email: 'pat@acme.test' }] }) === true);
ok('a lead with no contacts cannot', dist.hasWritableContact({ contacts: [] }) === false && dist.hasWritableContact({}) === false);
ok('a person with no address, or a broken one, does not count', dist.hasWritableContact({ contacts: [{ email: '' }, { email: null }, { email: 'not-an-email' }] }) === false);
ok('one good person among bad ones is enough', dist.hasWritableContact({ contacts: [{ email: '' }, { email: 'ok@acme.test' }] }) === true);
{
  const pool = [{ id: 1, contacts: [] }, { id: 2, contacts: [{ email: 'a@b.test' }] }, { id: 3 }, { id: 4, contacts: [{ email: 'c@d.test' }] }];
  const s = dist.splitByContacts(pool);
  ok('a pool splits into reachable and without-people, order kept', s.reachable.map(l => l.id).join() === '2,4' && s.withoutPeople.map(l => l.id).join() === '1,3');
  ok('an empty pool splits into two empty lists', dist.splitByContacts([]).reachable.length === 0 && dist.splitByContacts(null).withoutPeople.length === 0);
}

// ── the pool count, over the real route ─────────────────────────────────────
const ORG = '11111111-1111-1111-1111-111111111111';
const db = createFakeDb({
  tables: {
    jobs: [
      { id: 'j1', org_id: ORG, stage: 'Unassigned', assigned_to_bd: null, deleted_at: null, freshness: 'Normal', industry: 'Construction', timezone: 'EST', is_duplicate: false, company_id: 'c1' },
      { id: 'j2', org_id: ORG, stage: 'Unassigned', assigned_to_bd: null, deleted_at: null, freshness: 'Normal', industry: 'Construction', timezone: 'EST', is_duplicate: false, company_id: 'c2' },
      { id: 'j3', org_id: ORG, stage: 'Unassigned', assigned_to_bd: null, deleted_at: null, freshness: 'Normal', industry: 'Retail', timezone: 'CST', is_duplicate: false, company_id: 'c3' },
    ],
    companies: [{ id: 'c1', industry: 'Construction' }, { id: 'c2', industry: 'Construction' }, { id: 'c3', industry: 'Retail' }],
    contacts: [{ id: 'p1', job_id: 'j1', email: 'pat@acme.test' }],      // j2 and j3 have nobody
  },
  relations: { jobs: { company: { table: 'companies', fk: 'company_id' }, contacts: { table: 'contacts', fk: 'job_id', many: true } } },
});
const makeRoutes = require('../routes/distribution');
const app = express(); app.use(express.json());
app.use(makeRoutes({
  supabase: db.supabase, hasRole: (req, ...r) => r.includes('admin'), today: () => '2026-10-20', normInd: (s) => s, orgIdFor: () => ORG,
  withOrg: (q) => q.eq('org_id', ORG), auth: (req, _r, next) => { req.user = { id: 'u', roles: ['admin'], role: 'admin', org_id: ORG }; req.orgId = ORG; next(); },
}));
const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
const r = await fetch(`http://127.0.0.1:${server.address().port}/distribute/pool-stats`);
const stats = await r.json();
server.close();
ok('the pool count still counts every unassigned lead', r.status === 200 && stats.total === 3, JSON.stringify(stats));
ok('…and says how many of them have nobody to write to', stats.without_people === 2, JSON.stringify(stats));

// ── the wiring (a pin only: the rule it calls is the callable one above) ─────
{
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const exec = idx.slice(idx.indexOf("app.post('/distribute/execute'"), idx.indexOf('// /distribute/pool-stats + /distribute/today-summary'));
  ok('Assign reads each lead\'s contacts, hands out only the reachable ones, refuses when none is, and reports what it left', /contacts\(email\)/.test(exec) && /splitByContacts\(pool\)/.test(exec) && /pool = split\.reachable/.test(exec) && /skipped_no_people/.test(exec) && /Nothing was assigned/.test(exec));
}
// ── what the person sees ────────────────────────────────────────────────────
{
  const win = fs.readFileSync(new URL('../public/js/19-distribution.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../public/js/21-assign-leads.js', import.meta.url), 'utf8');
  ok('the Assign window warns before the click, in words', /no contact person with an email, so no email can be written/.test(win) && /pool\.without_people/.test(win));
  ok('…the result toast says how many were left in the pool', /res\.skipped_no_people/.test(win));
  ok('…and the Assign Leads page shows the same count', /poolStats\.without_people/.test(page));
}

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
