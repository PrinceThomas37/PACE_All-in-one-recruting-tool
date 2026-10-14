// A VALUE IN THE WRONG FIELD IS MOVED ON EVERY WAY IN — through the REAL routes (owner, 14 Oct: a company description in "Found by").
// services/lead-fields.js is the rule (test/lead-fields-smoke.mjs); this proves it is actually CALLED where leads are made and changed,
// over an in-memory database that behaves like PostgREST:
//   * POST /jobs/bulk  (a sheet import) — the description leaves Found by, lands in the lead's Notes, the answer says how many;
//   * POST /jobs       (the RA form)    — the same, and the response carries the sentence to show;
//   * PUT  /jobs/:id   (an edit)        — the same, added to the notes that are already there; and an edit that never mentioned
//                                         Found by leaves it alone;
//   * who may edit is unchanged: an RA lead and an admin may, an RA outside the window may not (403).
// Usage: node test/lead-fields-routes-smoke.mjs
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
const DESC = 'Company Description Venture Visionary Partners is a registered independent wealth management firm that advises affluent families, individuals, business owners, and entrepreneurs on how to be strategically smarter with their wealth.';

const users = [
  { id: 'adm', role: 'admin', manager_id: null }, { id: 'ral', role: 'ra_lead', manager_id: null }, { id: 'ra1', role: 'ra', manager_id: 'ral' }, { id: 'bd1', role: 'bd', manager_id: null },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const old = new Date(Date.now() - 100 * 3600000).toISOString();
const fake = createFakeDb({
  tables: {
    users, companies: [{ id: 'co1', org_id: O, name: 'Venture Visionary Partners' }, { id: 'co2', org_id: O, name: 'Second Co' }, { id: 'co3', org_id: O, name: 'Third Co' }], app_settings: [], activity_log: [],
    jobs: [{ id: 'L1', org_id: O, company_id: 'co1', position: 'Financial Advisor', source: 'LinkedIn', notes: 'Spoke to HR.', stage: 'Unassigned', created_by: 'ra1', created_at: old, deleted_at: null },
           { id: 'L2', org_id: O, company_id: 'co1', position: 'Planner', source: DESC, notes: '', stage: 'Unassigned', created_by: 'ra1', created_at: old, deleted_at: null }],
    contacts: [],
  },
  defaults: { jobs: () => ({ id: 'J' + Math.random().toString(36).slice(2, 8), org_id: O, deleted_at: null, created_at: new Date().toISOString() }), contacts: () => ({}) },
});
const hasRole = (req, ...roles) => (req.user.roles || []).some(r => roles.includes(r));
const ctx = {
  supabase: fake.supabase, auth: (req, res, next) => { const u = users.find(x => x.id === req.headers['x-user']); if (!u) return res.status(401).json({ error: 'no user' }); req.user = { id: u.id, org_id: u.org_id, role: u.role, roles: [u.role] }; req.orgId = u.org_id; next(); },
  hasRole, today: () => '2026-10-14', logActivity: async () => {}, canTouchJob: async () => true, loadAllJobs: async () => [], JOB_SELECT: '*',
  getTimezoneFromLocation: () => 'CST', persistLearnedSkills: async () => {}, orgIdFor: (req) => O, withOrg: (q) => q, orgStamp: () => ({ org_id: O }), userOrgId: async () => O, mailboxOrgId: async () => O,
};
const app = express(); app.use(express.json());
app.use(require(path.join(ROOT, 'routes/jobs.js'))(ctx));
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (who, method, p, body) => new Promise((resolve, reject) => {
  const rq = http.request(base + p, { method, headers: { 'x-user': who, 'content-type': 'application/json' } }, (res) => { let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(out || 'null'); } catch (_) { j = out; } resolve({ status: res.statusCode, json: j }); }); });
  rq.on('error', reject); rq.end(body ? JSON.stringify(body) : undefined);
});
const job = (id) => fake.tables.jobs.find(j => j.id === id);

// ── an import ──
let r = await call('adm', 'POST', '/jobs/bulk', { jobs: [{ company_id: 'co2', position: 'Controller', source: DESC, notes: '' }, { company_id: 'co3', position: 'Estimator', source: 'Indeed' }] });
const imported = fake.tables.jobs.filter(j => ['Controller', 'Estimator'].includes(j.position));
const ctl = imported.find(j => j.position === 'Controller'), est = imported.find(j => j.position === 'Estimator');
step('an import: the description leaves Found by (it falls back to "Import")', r.status === 201 && ctl && ctl.source === 'Import', JSON.stringify({ s: r.status, src: ctl && ctl.source, out: r.json }).slice(0, 200));
step('…and is kept word for word in the lead\'s Notes', ctl && ctl.notes.includes(DESC) && /Moved from "Found by"/.test(ctl.notes));
step('…the answer says how many leads were corrected, in words', r.json.tidied === 1 && /wrong column/.test(r.json.tidiedNote), r.json.tidiedNote);
step('…and a lead with a proper source is untouched', est && est.source === 'Indeed' && !/Moved from/.test(est.notes || ''));

// ── the RA form (create) ──
r = await call('adm', 'POST', '/jobs', { company_id: 'co1', position: 'Wealth Manager', source: DESC, job_url: 'not a link, just words', notes: 'first call booked' });
const made = fake.tables.jobs.find(j => j.position === 'Wealth Manager');
step('create: Found by is emptied and the paragraph is in the Notes after what the person wrote', r.status === 201 && made && made.source === '' && made.notes.startsWith('first call booked') && made.notes.includes(DESC), JSON.stringify(r.json).slice(0, 160));
step('…words typed in the job link box are moved too, and the link stays empty', made && made.job_url === null && /not a link, just words/.test(made.notes));
step('…the response carries what moved, and a sentence to show', r.json.moved && r.json.moved.length === 2 && /wrong place/.test(r.json.moved_sentence), r.json.moved_sentence);

// ── an edit ──
r = await call('ral', 'PUT', '/jobs/L2', { source: DESC });
step('edit by an RA lead: the paragraph in Found by is moved to Notes', r.status === 200 && job('L2').source === '' && job('L2').notes.includes(DESC), JSON.stringify(r.json).slice(0, 160));
r = await call('adm', 'PUT', '/jobs/L1', { source: DESC });
step('…added to the notes that were already on the lead, not over them', job('L1').notes.startsWith('Spoke to HR.') && job('L1').notes.includes(DESC) && job('L1').source === '');
r = await call('adm', 'PUT', '/jobs/L1', { position: 'Senior Financial Advisor' });
step('an edit that never mentioned Found by does not touch it or the notes', job('L1').position === 'Senior Financial Advisor' && job('L1').source === '' && (job('L1').notes.match(/Moved from/g) || []).length === 1);
r = await call('adm', 'PUT', '/jobs/L1', { source: 'Referral' });
step('a proper value saves as typed', job('L1').source === 'Referral' && !r.json.moved);

// ── who may edit is unchanged ──
r = await call('ra1', 'PUT', '/jobs/L1', { source: 'LinkedIn' });
step('an RA whose edit window has passed is still refused (403)', r.status === 403, r.status + ' ' + JSON.stringify(r.json));
step('…and nothing changed', job('L1').source === 'Referral');
server.close();
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
