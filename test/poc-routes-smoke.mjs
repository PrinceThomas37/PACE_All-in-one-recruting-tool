// THE POC FINDER'S ENDPOINTS (R-053, D-0049) — routes/poc.js, the REAL router
// mounted on a real Express app over an in-memory database.
//
// Pins:
//   * GET /jobs/:id/poc fills the four slots from THIS lead's people, learns
//     the company's email format from ALL its leads — and never returns
//     another lead's people (the caller may not be allowed to see them, D-0034);
//   * seeing follows the lead's own rule: someone who cannot see the lead, or
//     another company, gets 404 — the same shape as GET /jobs/:id;
//   * the size pick is the lead workers' (canTouchJob): 403 for someone who
//     can see but not work the lead, 400 for a size not on the list, and it
//     is remembered for the COMPANY; an empty pick clears it.
//
// The fake database PROJECTS every row to the route's own select list —
// Session 30's lesson: a fake that returns whole rows hides a missing column.
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── in-memory PostgREST, projecting to the select list ─────────────────────
const ORG = 'org-a', OTHER = 'org-b';
const tables = {
  users: [
    { id: 'bd1', manager_id: 'lead1', org_id: ORG, deleted_at: null },
    { id: 'bd2', manager_id: null, org_id: ORG, deleted_at: null },
    { id: 'lead1', manager_id: null, org_id: ORG, deleted_at: null },
  ],
  companies: [
    { id: 'co1', org_id: ORG, name: 'Acme Builders', website: 'https://www.acmebuild.com', size_band: null, deleted_at: null },
    { id: 'coX', org_id: OTHER, name: 'Other Co', website: 'other.com', size_band: null, deleted_at: null },
  ],
  jobs: [
    { id: 'j1', org_id: ORG, company_id: 'co1', position: 'Junior Estimator', industry: 'Construction', stage: 'Assigned',
      created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null },
    // Same company, another BD's lead: its people teach the FORMAT only.
    { id: 'j2', org_id: ORG, company_id: 'co1', position: 'Project Manager', industry: 'Construction', stage: 'Assigned',
      created_by: 'bd2', assigned_to: null, assigned_to_bd: 'bd2', deleted_at: null },
    { id: 'jX', org_id: OTHER, company_id: 'coX', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
      created_by: 'bdX', assigned_to: null, assigned_to_bd: 'bdX', deleted_at: null },
  ],
  contacts: [
    { id: 'c1', org_id: ORG, job_id: 'j1', first_name: 'Maria', last_name: 'Lopez', designation: 'HR Manager', email: 'mlopez@acmebuild.com', email_status: 'valid', is_primary: true, phone: '555' },
    { id: 'c2', org_id: ORG, job_id: 'j1', first_name: 'John', last_name: 'Carter', designation: 'President', email: 'jcarter@acmebuild.com', email_status: 'valid', is_primary: false, phone: null },
    { id: 'c3', org_id: ORG, job_id: 'j2', first_name: 'Secret', last_name: 'Person', designation: 'Owner', email: 'sperson@acmebuild.com', email_status: 'valid', is_primary: true, phone: null },
    { id: 'c4', org_id: ORG, job_id: 'j2', first_name: 'Hidden', last_name: 'Human', designation: 'Estimator', email: 'hhuman@acmebuild.com', email_status: 'valid', is_primary: false, phone: null },
  ],
};
const selects = [];   // every select list the route asked for, to prove projection ran
function cols(sel) {
  if (!sel || sel.trim() === '*') return null;
  return sel.split(',').map(s => s.trim()).filter(Boolean);
}
function q(table) {
  const st = { filters: [], op: 'select', payload: null, cols: null, limit: null };
  const rows = () => (tables[table] || []).filter(r => st.filters.every(f => f(r)));
  const project = (r) => { if (!st.cols) return Object.assign({}, r); const o = {}; st.cols.forEach(k => { if (k in r) o[k] = r[k]; }); return o; };
  const api = {
    select(s) { st.cols = cols(s); selects.push(table + ':' + s); return api; },
    eq(k, v) { st.filters.push(r => r[k] === v); return api; },
    is(k, v) { st.filters.push(r => (r[k] == null) === (v == null)); return api; },
    in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
    order() { return api; },
    limit(n) { st.limit = n; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    async maybeSingle() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] || null : r.data; return { data: d, error: r.error }; },
    async single() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: r.error || (d ? null : { message: 'no row' }) }; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    if (st.op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, st.payload)); return { data: hit.map(project), error: null }; }
    let out = rows().map(project);
    if (st.limit != null) out = out.slice(0, st.limit);
    return { data: out, error: null };
  }
  return api;
}
const supabase = { from: q };
const { hasRole } = require('../middleware/authorize.js')({ supabase });
const { canTouchJob } = require('../middleware/authorize.js')({ supabase });

// ── the real router on a real app ─────────────────────────────────────────
const USERS = {
  bd1:   { id: 'bd1', role: 'bd', roles: ['bd'], org_id: ORG },          // works j1
  bd2:   { id: 'bd2', role: 'bd', roles: ['bd'], org_id: ORG },          // works j2 only
  lead1: { id: 'lead1', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG }, // bd1's manager: sees j1, does not work it
  adm:   { id: 'adm', role: 'admin', roles: ['admin'], org_id: ORG },
  admX:  { id: 'admX', role: 'admin', roles: ['admin'], org_id: OTHER },
};
const app = express();
app.use(express.json());
const auth = (req, res, next) => { const u = USERS[req.headers['x-user']]; if (!u) return res.status(401).end(); req.user = u; req.orgId = u.org_id; next(); };
app.use(require('../routes/poc.js')({ supabase, auth, hasRole, canTouchJob, orgIdFor: (req) => req.orgId }));
const server = http.createServer(app);
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
async function call(method, path, user, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json, text: JSON.stringify(json) };
}

try {
  // ── reading ──────────────────────────────────────────────────────────────
  const a = await call('GET', '/jobs/j1/poc', 'bd1');
  step('the lead\'s worker gets the four slots', a.status === 200 && Array.isArray(a.body.slots) && a.body.slots.length === 4, String(a.status));
  const slot = (k) => a.body.slots.find(s => s.key === k) || {};
  step('the HR manager on the lead fills an HR slot', slot('hr1').contact_id === 'c1', slot('hr1').contact_id);
  step('the president fills a hiring-manager slot', ['mgr1', 'mgr2'].some(k => slot(k).contact_id === 'c2'));
  step('2 of 4 found', a.body.found === 2, String(a.body.found));
  step('size is unknown and assumed 20-50', a.body.size_known === false && a.body.size === '21-50');
  step('the format is learned across the company\'s leads (4 real addresses agree)',
    a.body.format && a.body.format.pattern === 'flast' && a.body.format.learned_from === 4 && a.body.format.domain === 'acmebuild.com', JSON.stringify(a.body.format));
  step('…and shown only as its shape on a made-up name', a.body.format.example === 'jsmith@acmebuild.com');
  step('ANOTHER lead\'s people never leave the server (names, emails, ids)',
    !/Secret|Hidden|sperson@|hhuman@|"c3"|"c4"/.test(a.text), a.text.slice(0, 120));
  step('the worker may edit', a.body.can_edit === true);
  step('the fake database really projected to the route\'s select lists',
    selects.some(s => s.startsWith('contacts:id,first_name')) && !Object.prototype.hasOwnProperty.call((await (async () => {
      const r = await q('contacts').select('id,first_name').eq('id', 'c1').maybeSingle(); return r.data; })()) || {}, 'phone'));

  const mgr = await call('GET', '/jobs/j1/poc', 'lead1');
  step('the worker\'s manager can SEE it', mgr.status === 200);
  step('…but may not edit it (the size pick and Add by hand are hidden)', mgr.body && mgr.body.can_edit === false);
  const stranger = await call('GET', '/jobs/j1/poc', 'bd2');
  step('a BD who cannot see the lead gets 404 — not 403, which would confirm it exists', stranger.status === 404, String(stranger.status));
  const foreign = await call('GET', '/jobs/j1/poc', 'admX');
  step('another company\'s admin gets 404', foreign.status === 404, String(foreign.status));
  const missing = await call('GET', '/jobs/nope/poc', 'adm');
  step('a lead that does not exist gets 404', missing.status === 404);

  // ── the size pick ───────────────────────────────────────────────────────
  const refused = await call('PUT', '/jobs/j1/company-size', 'lead1', { size: '1-20' });
  step('someone who can see but not work the lead may not set its size (403)', refused.status === 403, String(refused.status));
  step('…and nothing changed', tables.companies[0].size_band === null);
  const bad = await call('PUT', '/jobs/j1/company-size', 'bd1', { size: 'huge' });
  step('a size not on the list is refused (400)', bad.status === 400, String(bad.status));
  const ok = await call('PUT', '/jobs/j1/company-size', 'bd1', { size: '1-20' });
  step('the worker sets it — remembered for the COMPANY', ok.status === 200 && tables.companies[0].size_band === '1-20');
  step('…and the answer is the new slots (under 20: the owner hires)',
    ok.body && ok.body.size_known === true && ok.body.size === '1-20' && /Owner/.test(ok.body.slots.find(s => s.key === 'mgr1').label), ok.body && ok.body.slots.find(s => s.key === 'mgr1').label);
  const other = await call('GET', '/jobs/j2/poc', 'bd2');
  step('the other lead at the same company sees the same size', other.status === 200 && other.body.size === '1-20' && other.body.size_known === true);
  const cleared = await call('PUT', '/jobs/j1/company-size', 'bd1', { size: '' });
  step('an empty pick clears it back to unknown', cleared.status === 200 && tables.companies[0].size_band === null && cleared.body.size_known === false);
  const xorg = await call('PUT', '/jobs/j1/company-size', 'admX', { size: '1-20' });
  step('another company\'s admin cannot set it (404)', xorg.status === 404 && tables.companies[0].size_band === null);
} catch (e) {
  step('the run reached its end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  server.close();
}

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
