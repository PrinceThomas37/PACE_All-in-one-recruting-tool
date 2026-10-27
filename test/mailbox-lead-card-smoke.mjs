// THE LEAD BESIDE ITS EMAIL (R-319, owner's 28 notes): GET /mailbox/lead-card?email= on the REAL routes/mailbox.js over an in-memory database.
//   * an address PACE knows as a contact on a lead answers with who they are, the company, and the leads — each with job, place, stage, owner;
//   * ONLY leads the caller may see (D-0034, ownership.canSeeLead): a BD sees their own, their manager sees the team's, an admin sees all;
//   * nothing visible answers EXACTLY like an address nobody knows ({found:false}) — so it cannot be used to ask "is this person a lead";
//   * another organisation's lead, a deleted lead and a pool lead (for a plain BD) never show; at most three leads, the rest counted;
//   * a bad address is a 400.
// Usage: node test/mailbox-lead-card-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const O = 'org-a', OTHER = 'org-b';
const users = [
  { id: 'adm', name: 'Ada Admin', role: 'admin', manager_id: null }, { id: 'bdl', name: 'Lena Lead', role: 'bd_lead', manager_id: null },
  { id: 'bd1', name: 'Bea Smith', role: 'bd', manager_id: 'bdl' }, { id: 'bd2', name: 'Bo Jones', role: 'bd', manager_id: null }, { id: 'bd3', name: 'Cy Free', role: 'bd', manager_id: null },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const T = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
const job = (id, over) => Object.assign({ id, org_id: O, company_id: 'co1', position: 'Welder', location: 'Waco, TX', stage: 'Assigned', created_by: 'bd1', assigned_to: 'bd1', assigned_to_bd: 'bd1', created_at: T(5), deleted_at: null }, over || {});
const contact = (id, job_id, over) => Object.assign({ id, org_id: O, job_id, first_name: 'Dana', last_name: 'Cole', designation: 'HR Manager', email: 'dana@acme.test' }, over || {});
const fake = createFakeDb({
  tables: {
    users,
    companies: [{ id: 'co1', org_id: O, name: 'Acme Machining', website: 'https://acme.test' }, { id: 'co2', org_id: OTHER, name: 'Elsewhere', website: '' }],
    jobs: [
      job('j1'), job('j2', { assigned_to_bd: 'bd2', assigned_to: 'bd2', created_by: 'bd2', position: 'Estimator', created_at: T(9) }),
      job('jdel', { deleted_at: T(10), position: 'Deleted one' }),
      job('jpool', { assigned_to_bd: null, assigned_to: null, created_by: 'adm', stage: 'Unassigned', position: 'Pool job' }),
      job('jother', { org_id: OTHER, company_id: 'co2', assigned_to_bd: 'bd1', position: 'Other org job' }),
      ...['m1', 'm2', 'm3', 'm4'].map((id, i) => job(id, { position: 'Many ' + id, created_at: T(11 + i) })),
    ],
    contacts: [
      contact('c1', 'j1'), contact('c2', 'j2'), contact('c3', 'jdel'), contact('c4', 'jpool'), contact('c5', 'jother'),
      contact('c6', 'j1', { email: 'solo@acme.test', first_name: 'Sol', last_name: 'Oh' }),
      ...['m1', 'm2', 'm3', 'm4'].map((id, i) => contact('cm' + i, id, { email: 'many@acme.test', first_name: 'Max', last_name: 'Many' })),
    ],
    app_settings: [],
  },
  relations: { jobs: { company: { table: 'companies', fk: 'company_id' } } },
});
const supabase = fake.supabase;
const { createDb } = require(path.join(ROOT, 'models/index.js'));
const db = createDb(supabase);
const { hasRole } = require(path.join(ROOT, 'middleware/authorize.js'))({ supabase });
const ownership = require(path.join(ROOT, 'services/ownership.js'));
const { reportingChainIds } = require(path.join(ROOT, 'hierarchy.js'))(supabase);
const ctx = {
  supabase, db, hasRole, ownership, reportingChainIds, orgIdFor: () => O,
  auth: (req, res, next) => { const u = users.find(x => x.id === req.headers['x-user']); if (!u) return res.status(401).json({ error: 'no user' }); req.user = { id: u.id, org_id: O, role: u.role, roles: [u.role] }; req.orgId = O; next(); },
};
const app = express(); app.use(express.json()); app.use(require(path.join(ROOT, 'routes/mailbox.js'))(ctx));
const server = app.listen(0, '127.0.0.1'); await new Promise(res => server.once('listening', res));
const get = (who, q) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${server.address().port}/mailbox/lead-card?email=${encodeURIComponent(q)}`, { headers: { 'x-user': who } }, (res) => {
    let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch (_) {} resolve({ status: res.statusCode, json }); });
  }).on('error', reject);
});
const ids = (r) => (r.json.leads || []).map(l => l.id);

let r = await get('bd1', 'dana@acme.test');
step('the owner opens an email from a contact on their lead: who, the company and the lead (job, place, stage, owner)', r.status === 200 && r.json.found && r.json.contact.name === 'Dana Cole' && r.json.contact.designation === 'HR Manager' && r.json.company.name === 'Acme Machining' && ids(r).join() === 'j1' && r.json.leads[0].position === 'Welder' && r.json.leads[0].location === 'Waco, TX' && r.json.leads[0].stage === 'Assigned' && r.json.leads[0].owner === 'Bea Smith', JSON.stringify(r.json));
step('…a colleague\'s lead for the same person is NOT in it (D-0034)', !ids(r).includes('j2') && !JSON.stringify(r.json).includes('Estimator') && !JSON.stringify(r.json).includes('Bo Jones'));
r = await get('bd2', 'dana@acme.test');
step('the other BD sees THEIR lead, not the first one', ids(r).join() === 'j2' && r.json.leads[0].owner === 'Bo Jones');
r = await get('bdl', 'dana@acme.test');
step('a manager sees their team\'s lead (Bea reports to them), not another team\'s', ids(r).join() === 'j1');
r = await get('adm', 'dana@acme.test');
step('an admin sees every live lead of the person in their organisation, newest first', ids(r).join() === 'j2,j1,jpool', JSON.stringify(ids(r)));
step('…never the deleted lead, never the other organisation\'s', !ids(r).includes('jdel') && !ids(r).includes('jother'), JSON.stringify(ids(r)));
step('…the pool lead (nobody owns it) shows for an admin as unassigned', (r.json.leads.find(l => l.id === 'jpool') || {}).unassigned === true);
const unknown = await get('bd3', 'nobody@nowhere.test');
const hidden = await get('bd3', 'dana@acme.test');
step('a person who may see NONE of them gets exactly the answer an unknown address gets (it cannot be used to probe)', JSON.stringify(hidden.json) === JSON.stringify(unknown.json) && hidden.json.found === false && hidden.status === 200, JSON.stringify([hidden.json, unknown.json]));
r = await get('bd1', 'DANA@Acme.Test');
step('the address is matched whatever its capitals', r.json.found === true);
r = await get('bd1', 'many@acme.test');
step('a person on many leads: the three newest are listed and the rest counted', r.json.found && r.json.leads.length === 3 && r.json.more === 1 && ids(r)[0] === 'm4', JSON.stringify(r.json.leads.map(l => l.id) + ' more ' + r.json.more));
r = await get('bd1', 'dana@acme.test');
step('nothing in the answer reveals fields the card does not need (no ids of other people, no emails but their own)', !/bd2|"created_by"|assigned_to/.test(JSON.stringify(r.json)));
r = await get('bd1', 'not-an-email');
step('a bad address is a 400, not a database error', r.status === 400);
r = await get('bd1', '');
step('no address is a 400', r.status === 400);
r = await get('nobody', 'dana@acme.test');
step('no sign-in is a 401', r.status === 401);

server.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
