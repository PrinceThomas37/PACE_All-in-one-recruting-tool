// SEARCH EVERYTHING SHOWS NOTHING ITS LISTS WOULD NOT (R-123).
//
// routes/search.js mounted for real over the in-memory PostgREST, with the real
// models layer (db.forRequest) and the real ownership rules. Each kind must apply
// the same gate as the list it comes from:
//   leads      — D-0034: a BD sees their own and their chain's, never a
//                colleague's, never the pool; admin sees the org
//   jobs       — a BD desk sees the org's job orders; a pure recruiter only
//                the ones they are assigned to
//   clients    — BD desk only, and a company is a client only with a job order
//   candidates — the org's pool, for the recruiting desks only
//   and never another company's anything.
// Plus: a lead is found by its company or a contact's name; the scope is applied
// in SQL BEFORE the limit (six newer invisible matches must not hide the one the
// viewer may see); junk in the query cannot break it.
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', OTHER = 'org-b';
const ACME = uid(), BETA = uid(), ACME_B = uid();
const L1 = uid(), L2 = uid(), L3 = uid(), L4 = uid();
const JO1 = uid(), JO2 = uid(), JO3 = uid();
const old = '2026-01-01T00:00:00Z', newer = '2026-09-01T00:00:00Z';
const hidden = Array.from({ length: 6 }, () => uid());
const fake = createFakeDb({
  tables: {
    companies: [
      { id: ACME, org_id: ORG, name: 'Acme Health', industry: 'Healthcare', location: 'Dallas', deleted_at: null },
      { id: BETA, org_id: ORG, name: 'Acme Beta Labs', industry: 'Biotech', location: 'Austin', deleted_at: null },
      { id: ACME_B, org_id: OTHER, name: 'Acme Elsewhere', industry: 'X', location: 'Y', deleted_at: null },
    ],
    jobs: [
      { id: L1, org_id: ORG, company_id: ACME, position: 'Java Developer', location: 'Dallas, TX', stage: 'Assigned', assigned_to_bd: 'bd1', created_by: 'ra1', assigned_to: 'ra1', created_at: old, deleted_at: null },
      { id: L2, org_id: ORG, company_id: BETA, position: 'Java Lead', location: 'Austin, TX', stage: 'Assigned', assigned_to_bd: 'bd9', created_by: 'ra9', assigned_to: 'ra9', created_at: old, deleted_at: null },
      { id: L3, org_id: ORG, company_id: BETA, position: 'Java Pool Role', location: 'Remote', stage: 'Unassigned', assigned_to_bd: null, created_by: 'ra9', assigned_to: 'ra9', created_at: old, deleted_at: null },
      { id: L4, org_id: OTHER, company_id: ACME_B, position: 'Java Elsewhere', location: 'Z', stage: 'Assigned', assigned_to_bd: 'bd1', created_by: 'bd1', assigned_to: 'bd1', created_at: old, deleted_at: null },
      // six NEWER matches the BD may not see — a limit-then-filter would return none of L1
      ...hidden.map((id, i) => ({ id, org_id: ORG, company_id: BETA, position: 'Java Hidden ' + i, location: '-', stage: 'Assigned', assigned_to_bd: 'bd9', created_by: 'ra9', assigned_to: 'ra9', created_at: newer, deleted_at: null })),
    ],
    contacts: [
      { id: uid(), org_id: ORG, job_id: L1, first_name: 'Maria', last_name: 'Lopez', email: 'maria@acme.test' },
      { id: uid(), org_id: ORG, job_id: L2, first_name: 'Mario', last_name: 'Rossi', email: 'mario@beta.test' },
    ],
    job_orders: [
      { id: JO1, org_id: ORG, job_code: 'JO-1', job_title: 'Java Engineer', client: 'Acme Health', company_id: ACME, status: 'Open', created_at: old, deleted_at: null },
      { id: JO2, org_id: ORG, job_code: 'JO-2', job_title: 'Java Architect', client: 'Gamma', company_id: null, status: 'Open', created_at: old, deleted_at: null },
      { id: JO3, org_id: OTHER, job_code: 'JO-3', job_title: 'Java Abroad', client: 'Acme Elsewhere', company_id: ACME_B, status: 'Open', created_at: old, deleted_at: null },
    ],
    recruiter_assignments: [{ id: uid(), org_id: ORG, recruiter_id: 'rec1', job_order_id: JO1 }],
    candidates: [
      { id: uid(), org_id: ORG, full_name: 'Priya Raman', current_title: 'Java Developer', email: 'priya@mail.test', phone: '555-0101', candidate_code: 'CN-01', created_at: old, deleted_at: null },
      { id: uid(), org_id: OTHER, full_name: 'Priya Foreign', current_title: 'Java', email: 'pf@mail.test', phone: '555-0909', candidate_code: 'CN-99', created_at: old, deleted_at: null },
    ],
  },
  relations: { jobs: { company: { table: 'companies', fk: 'company_id' } } },
});
const db = createDb(fake.supabase);
const USERS = {
  admin: { id: 'adm1', role: 'admin', roles: ['admin'] },
  bd: { id: 'bd1', role: 'bd', roles: ['bd'] },
  recruiter: { id: 'rec1', role: 'recruiter', roles: ['recruiter'] },
  ra: { id: 'ra1', role: 'ra', roles: ['ra'] },
};
const app = express();
const auth = (req, res, next) => { req.user = Object.assign({ org_id: ORG }, USERS[req.headers['x-as']]); req.orgId = ORG; next(); };
const hasRole = (req, ...rs) => (req.user.roles || [req.user.role]).some(r => rs.includes(r));
app.use(require('../routes/search')({ db, auth, hasRole, orgIdFor: () => ORG, reportingChainIds: async () => [] }));
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const search = async (as, q) => {
  const r = await fetch(API + '/search?q=' + encodeURIComponent(q), { headers: { 'x-as': as } });
  return { status: r.status, body: await r.json() };
};
const ids = (list) => (list || []).map(x => x.id).sort().join(',');
const J = (v) => JSON.stringify(v);

try {
  let r = await search('admin', 'java');
  step('admin: every lead in the company (own, colleague\'s, pool), never another company\'s', r.status === 200 && r.body.leads.length === 5 && !r.body.leads.some(l => l.id === L4), J(r.body.leads.map(l => l.title)));
  step('admin: both job orders, not the other company\'s', ids(r.body.jobs) === [JO1, JO2].sort().join(','), J(r.body.jobs));
  step('nothing failed quietly', !r.body.failed, J(r.body.failed));

  r = await search('bd', 'java');
  step('BD: only the lead they own — not a colleague\'s, not the pool', ids(r.body.leads) === L1, J(r.body.leads.map(l => l.title)));
  step('…even with six NEWER invisible matches (scope applied before the limit)', r.body.leads.length === 1);
  step('BD desk: the company\'s job orders', ids(r.body.jobs) === [JO1, JO2].sort().join(','), J(r.body.jobs.map(j => j.title)));
  step('a lead reads "position · company"', r.body.leads[0] && r.body.leads[0].title === 'Java Developer · Acme Health', J(r.body.leads[0]));

  r = await search('bd', 'maria');
  step('a lead is found by its contact\'s name — and says who matched', ids(r.body.leads) === L1 && /Maria Lopez/.test(r.body.leads[0].sub), J(r.body.leads));
  r = await search('bd', 'mario');
  step('…but not through a colleague\'s contact', r.body.leads.length === 0, J(r.body.leads));
  r = await search('bd', 'acme');
  step('a lead is found by its company name', r.body.leads.some(l => l.id === L1), J(r.body.leads));
  step('clients: Acme Health (has a job order), not Acme Beta Labs (a lead only), not another company\'s', ids(r.body.clients) === ACME, J(r.body.clients));

  r = await search('recruiter', 'java');
  step('recruiter: only the job they are assigned to', ids(r.body.jobs) === JO1, J(r.body.jobs));
  step('recruiter: no leads they do not own, no clients', r.body.leads.length === 0 && r.body.clients.length === 0, J([r.body.leads, r.body.clients]));
  r = await search('recruiter', 'priya');
  step('recruiter: the company\'s candidate pool, not another company\'s', r.body.candidates.length === 1 && r.body.candidates[0].title === 'Priya Raman', J(r.body.candidates));

  r = await search('ra', 'priya');
  step('a research analyst (no Candidates in their menu) gets no candidates', r.body.candidates.length === 0 && r.body.jobs.length === 0 && r.body.clients.length === 0, J(r.body));
  r = await search('ra', 'java');
  step('…and only the lead they researched', ids(r.body.leads) === L1, J(r.body.leads.map(l => l.title)));

  r = await search('admin', 'j');
  step('one letter searches nothing', r.status === 200 && r.body.q === '' && !r.body.leads.length, J(r.body));
  r = await search('admin', 'ja%v,a()');
  step('junk characters cannot break the query', r.status === 200 && !r.body.failed, r.status + ' ' + J(r.body).slice(0, 120));
} catch (e) {
  step('suite ran without throwing', false, e.stack);
} finally {
  srv.close();
}
const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
