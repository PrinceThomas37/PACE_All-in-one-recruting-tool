// "ALREADY ADDED" (owner, 2026-09-28: "If the person or the email id already
// added. A pop-up should come like that they are already added kinda.")
//
// Until this, POST /contacts had no duplicate check at all: the same person
// could be typed onto a lead twice, or onto a second lead at the same firm —
// and the send engine emails every contact on a lead, so a second row is a
// second cold email to somebody PACE is already talking to.
//
// Pins, on the REAL router (routes/contacts.js) over an in-memory database
// that PROJECTS rows to each select list (Session 30's lesson):
//   * ONE ADDRESS IS ONE PERSON: the same email on any live lead in this org
//     is refused (409) — on this lead, at this company, or anywhere — and
//     "add anyway" can never push it through;
//   * A NAME IS ONLY A CLUE: the same first + last name on this lead or at this
//     company is ASKED (409, can_add_anyway) and `allow_same_name` adds it; the
//     same name at an unrelated company, or a first name alone, is nobody;
//   * the pop-up names a colleague's lead ONLY if the caller may see it
//     (D-0034) — otherwise it says "a colleague's lead" and carries no person
//     and no lead;
//   * a lead that was deleted does not make anybody "already added";
//   * another company's (org's) people never count and never leak;
//   * a typed `_` or `%` is a character, not a wildcard;
//   * nothing is written when the answer is 409.
// Plus the pure rules (findDuplicate, duplicatePayload) directly.
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const { findDuplicate, duplicatePayload, personKey } = require('../services/lead-contacts.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the pure rules ─────────────────────────────────────────────────────────
{
  const ex = [
    { id: 'a', first_name: 'Maria', last_name: 'Lopez', email: 'mlopez@acme.com', job_id: 'j1', company_id: 'co1' },
    { id: 'b', first_name: 'Dave', last_name: 'Reed', email: 'dreed@acme.com', job_id: 'j2', company_id: 'co1' },
    { id: 'c', first_name: 'Nina', last_name: 'Park', email: 'nina@beta.com', job_id: 'j3', company_id: 'co2' },
  ];
  const at = { jobId: 'j1', companyId: 'co1' };
  const e1 = findDuplicate({ first_name: 'X', last_name: 'Y', email: '  MLOPEZ@acme.com ' }, ex, at);
  step('pure: the same address in another case and with spaces is the same person, on this lead', e1 && e1.match === 'email' && e1.where === 'this_lead' && e1.contact.id === 'a', JSON.stringify(e1));
  const e2 = findDuplicate({ first_name: 'X', last_name: 'Y', email: 'nina@beta.com' }, ex, at);
  step('pure: …and anywhere in PACE (another company) it still is', e2 && e2.match === 'email' && e2.where === 'elsewhere');
  const n1 = findDuplicate({ first_name: 'dave', last_name: 'REED', email: 'dave.r@gmail.com' }, ex, at);
  step('pure: the same full name on another lead at this company is a NAME match', n1 && n1.match === 'name' && n1.where === 'company' && n1.contact.id === 'b', JSON.stringify(n1));
  step('pure: the same name at an unrelated company is somebody else', findDuplicate({ first_name: 'Nina', last_name: 'Park', email: null }, ex, at) === null);
  step('pure: a first name alone is never a match', findDuplicate({ first_name: 'Maria', last_name: '', email: 'm2@acme.com' }, ex, at) === null);
  step('pure: accents and punctuation fold ("María López-" is Maria Lopez)', personKey('María', 'López-') === personKey('maria', 'lopez') && !!personKey('maria', 'lopez'));
  const both = findDuplicate({ first_name: 'Maria', last_name: 'Lopez', email: 'nina@beta.com' }, ex, at);
  step('pure: an address match outranks a name match', both && both.match === 'email' && both.contact.id === 'c', JSON.stringify(both));
  const near = findDuplicate({ first_name: 'Q', last_name: 'R', email: 'same@acme.com' },
    [{ id: 'far', email: 'same@acme.com', job_id: 'j9', company_id: 'co9' }, { id: 'here', email: 'same@acme.com', job_id: 'j1', company_id: 'co1' }], at);
  step('pure: nearer wins — this lead before anywhere else', near && near.contact.id === 'here' && near.where === 'this_lead');
  const hid = duplicatePayload({ match: 'email', where: 'company', contact: ex[1] }, { visible: false, lead: { id: 'j2', position: 'Project Manager', company: 'Acme' } });
  step('pure: a lead the caller may not see is not named, and no person travels',
    hid.duplicate.person === null && hid.duplicate.lead === null && /colleague's lead/.test(hid.error) && !/Project Manager|Dave|Reed/.test(JSON.stringify(hid)), JSON.stringify(hid));
  const shown = duplicatePayload({ match: 'email', where: 'company', contact: ex[1] }, { visible: true, lead: { id: 'j2', position: 'Project Manager', company: 'Acme' } });
  step('pure: a lead the caller may see is named, with the person', /the Project Manager lead at Acme/.test(shown.error) && shown.duplicate.person.name === 'Dave Reed' && shown.duplicate.lead.id === 'j2', shown.error);
  step('pure: only a NAME match offers "add anyway"',
    shown.duplicate.can_add_anyway === false && duplicatePayload({ match: 'name', where: 'this_lead', contact: ex[0] }).duplicate.can_add_anyway === true);
}

// ── in-memory PostgREST, projecting to the select list ─────────────────────
const ORG = 'org-a', OTHER = 'org-b';
const tables = {
  companies: [
    { id: 'co1', org_id: ORG, name: 'Acme Builders' },
    { id: 'co2', org_id: ORG, name: 'Beta Corp' },
    { id: 'coX', org_id: OTHER, name: 'Other Co' },
  ],
  jobs: [
    { id: 'j1', org_id: ORG, company_id: 'co1', position: 'Junior Estimator', stage: 'Assigned', created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null },
    { id: 'j2', org_id: ORG, company_id: 'co1', position: 'Project Manager', stage: 'Assigned', created_by: 'bd2', assigned_to: null, assigned_to_bd: 'bd2', deleted_at: null },
    { id: 'j3', org_id: ORG, company_id: 'co2', position: 'Estimator', stage: 'Assigned', created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null },
    { id: 'j4', org_id: ORG, company_id: 'co2', position: 'Controller', stage: 'Assigned', created_by: 'bd2', assigned_to: null, assigned_to_bd: 'bd2', deleted_at: null },
    { id: 'jDel', org_id: ORG, company_id: 'co2', position: 'Old Role', stage: 'Assigned', created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: '2026-09-01T00:00:00Z' },
    { id: 'jX', org_id: OTHER, company_id: 'coX', position: 'Estimator', stage: 'Assigned', created_by: 'bdX', assigned_to: null, assigned_to_bd: 'bdX', deleted_at: null },
  ],
  contacts: [
    { id: 'c1', org_id: ORG, job_id: 'j1', first_name: 'Maria', last_name: 'Lopez', designation: 'HR Manager', email: 'mlopez@acmebuild.com', phone: '555' },
    { id: 'c7', org_id: ORG, job_id: 'j1', first_name: 'Al', last_name: 'One', designation: 'Estimator', email: 'a1b@acmebuild.com', phone: null },
    { id: 'c2', org_id: ORG, job_id: 'j2', first_name: 'Dave', last_name: 'Reed', designation: 'Director of Estimating', email: 'dreed@acmebuild.com', phone: null },
    { id: 'c3', org_id: ORG, job_id: 'j3', first_name: 'Nina', last_name: 'Park', designation: 'Owner', email: 'nina@beta.com', phone: null },
    { id: 'c4', org_id: ORG, job_id: 'j4', first_name: 'Omar', last_name: 'Diaz', designation: 'CFO', email: 'omar@beta.com', phone: null },
    { id: 'c5', org_id: ORG, job_id: 'jDel', first_name: 'Gone', last_name: 'Person', designation: 'Owner', email: 'gone@beta.com', phone: null },
    { id: 'c6', org_id: OTHER, job_id: 'jX', first_name: 'Secret', last_name: 'Other', designation: 'Owner', email: 'shared@acmebuild.com', phone: null },
  ],
};
let seq = 0;
const selects = [];
const ilikes = [];   // every ILIKE pattern a route sent, exactly as sent
function cols(sel) { if (!sel || sel.trim() === '*') return null; return sel.split(',').map(s => s.trim()).filter(Boolean); }
function q(table) {
  const st = { filters: [], op: 'select', payload: null, cols: null, limit: null };
  const rows = () => (tables[table] = tables[table] || []).filter(r => st.filters.every(f => f(r)));
  const project = (r) => { if (!st.cols) return Object.assign({}, r); const o = {}; st.cols.forEach(k => { if (k in r) o[k] = r[k]; }); return o; };
  const api = {
    select(s) { if (st.op === 'select') { st.cols = cols(s); selects.push(table + ':' + s); } else st.cols = cols(s); return api; },
    eq(k, v) { st.filters.push(r => r[k] === v); return api; },
    is(k, v) { st.filters.push(r => (r[k] == null) === (v == null)); return api; },
    in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
    ilike(k, pat) {
      ilikes.push(table + ':' + k + ':' + pat);
      let re = '';
      for (let i = 0; i < pat.length; i++) {
        const ch = pat[i];
        if (ch === '\\' && i + 1 < pat.length) { re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
        re += ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const rx = new RegExp('^' + re + '$', 'i');
      st.filters.push(r => rx.test(String(r[k] == null ? '' : r[k]))); return api;
    },
    order() { return api; },
    limit(n) { st.limit = n; return api; },
    insert(p) { st.op = 'insert'; st.payload = [].concat(p); return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    async maybeSingle() { const r = await run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }; },
    async single() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: r.error || (d ? null : { message: 'no row' }) }; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    const all = (tables[table] = tables[table] || []);
    if (st.op === 'insert') {
      const made = st.payload.map(p => Object.assign({ id: table + '-' + (++seq) }, p));
      made.forEach(r => all.push(r));
      return { data: made.map(project), error: null };
    }
    if (st.op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, st.payload)); return { data: hit.map(project), error: null }; }
    let out = rows().map(project);
    if (st.limit != null) out = out.slice(0, st.limit);
    return { data: out, error: null };
  }
  return api;
}
const supabase = { from: q };
const { hasRole, canTouchJob } = require('../middleware/authorize.js')({ supabase });
const ownership = require('../services/ownership.js');
const { createDb } = require('../models');

const USERS = {
  bd1:  { id: 'bd1', role: 'bd', roles: ['bd'], org_id: ORG },           // works j1, j3
  lead1: { id: 'lead1', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG }, // bd1's manager
  adm:  { id: 'adm', role: 'admin', roles: ['admin'], org_id: ORG },
};
const CHAIN = { bd1: [], lead1: ['bd1'], adm: [] };
const activity = [];
const app = express();
app.use(express.json());
const auth = (req, res, next) => { const u = USERS[req.headers['x-user']]; if (!u) return res.status(401).end(); req.user = u; req.orgId = u.org_id; next(); };
app.use(require('../routes/contacts.js')({
  db: createDb(supabase), supabase, auth, hasRole, canTouchJob, ownership,
  reportingChainIds: async (id) => CHAIN[id] || [], orgIdFor: (req) => req.orgId,
  logActivity: async (jobId, contactId, userId, type, text) => { activity.push({ jobId, contactId, type, text }); },
  isPermanentFollowupBlock: () => false,
}));
const server = http.createServer(app);
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
async function add(user, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}/contacts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json, text: JSON.stringify(json) };
}
const onJ1 = () => tables.contacts.filter(c => c.job_id === 'j1').length;

try {
  const before = onJ1();
  const a = await add('bd1', { job_id: 'j1', first_name: 'Maria', last_name: 'Lopez', email: ' MLopez@AcmeBuild.com ' });
  step('the same address on this lead (any case, stray spaces) is refused — 409',
    a.status === 409 && a.body.duplicate && a.body.duplicate.match === 'email' && a.body.duplicate.where === 'this_lead', a.status + ' ' + a.text);
  step('…the pop-up says who, and that they are already here',
    /Maria Lopez \(mlopez@acmebuild\.com\) is already on this lead/.test(a.body.error) && a.body.duplicate.title === 'Already added' && a.body.duplicate.person.title === 'HR Manager', a.body.error);
  step('…nothing was written', onJ1() === before && !activity.length);
  const aa = await add('bd1', { job_id: 'j1', first_name: 'Maria', last_name: 'Lopez', email: 'mlopez@acmebuild.com', allow_same_name: true });
  step('"Add anyway" can never push a repeated ADDRESS through', aa.status === 409 && aa.body.duplicate.can_add_anyway === false && onJ1() === before, String(aa.status));

  const b = await add('bd1', { job_id: 'j1', first_name: 'David', last_name: 'R', email: 'dreed@acmebuild.com' });
  step('the same address on a colleague\'s lead at this company is refused', b.status === 409 && b.body.duplicate.where === 'company', b.status + ' ' + b.text);
  step('…and a lead the caller may not see is not named — no role, no person',
    /a colleague's lead at this company/.test(b.body.error) && b.body.duplicate.lead === null && b.body.duplicate.person === null &&
    !/Project Manager|Dave|Reed|Director of Estimating|j2/.test(b.text), b.text);
  const bAdm = await add('adm', { job_id: 'j1', first_name: 'David', last_name: 'R', email: 'dreed@acmebuild.com' });
  step('an admin, who sees the company, is told exactly where',
    bAdm.status === 409 && /the Project Manager lead at Acme Builders/.test(bAdm.body.error) && bAdm.body.duplicate.lead.id === 'j2' && bAdm.body.duplicate.person.name === 'Dave Reed', bAdm.body && bAdm.body.error);

  const c = await add('bd1', { job_id: 'j1', first_name: 'N', last_name: 'P', email: 'nina@beta.com' });
  step('the same address at ANOTHER company is refused too — one address, one conversation',
    c.status === 409 && c.body.duplicate.where === 'elsewhere' && /the Estimator lead at Beta Corp/.test(c.body.error), c.body && c.body.error);
  const d = await add('bd1', { job_id: 'j1', first_name: 'O', last_name: 'D', email: 'omar@beta.com' });
  step('…naming that lead only when the caller may see it', d.status === 409 && /on a colleague's lead\./.test(d.body.error) && !/Controller|Beta|Omar/.test(d.text), d.text);

  const e = await add('bd1', { job_id: 'j1', first_name: 'Gone', last_name: 'Person', email: 'gone@beta.com' });
  step('somebody on a DELETED lead is not "already added" (201)', e.status === 201 && tables.contacts.some(x => x.job_id === 'j1' && x.email === 'gone@beta.com'), String(e.status));

  const f = await add('bd1', { job_id: 'j1', first_name: 'María', last_name: 'López', email: 'maria.lopez@gmail.com' });
  step('the same NAME on this lead with another address is ASKED — 409 with "add anyway"',
    f.status === 409 && f.body.duplicate.match === 'name' && f.body.duplicate.can_add_anyway === true && /Is this the same person\?/.test(f.body.error) && f.body.duplicate.title === 'Already added?', f.text);
  const f2 = await add('bd1', { job_id: 'j1', first_name: 'María', last_name: 'López', email: 'maria.lopez@gmail.com', allow_same_name: true });
  step('…and "Add anyway" adds them (201), once', f2.status === 201 && tables.contacts.filter(x => x.email === 'maria.lopez@gmail.com').length === 1, String(f2.status));
  const g = await add('bd1', { job_id: 'j1', first_name: 'Dave', last_name: 'Reed' });
  step('the same name on a colleague\'s lead at this company is asked, without naming it',
    g.status === 409 && g.body.duplicate.match === 'name' && g.body.duplicate.where === 'company' && /colleague's lead at this company/.test(g.body.error) && !/Project Manager|dreed@/.test(g.text), g.text);
  const h = await add('bd1', { job_id: 'j1', first_name: 'Nina', last_name: 'Park', email: 'n.park@acmebuild.com' });
  step('the same name at an UNRELATED company is somebody else (201)', h.status === 201, String(h.status));
  const i = await add('bd1', { job_id: 'j1', first_name: 'Maria', email: 'maria2@acmebuild.com' });
  step('a first name alone is never a match (201)', i.status === 201, String(i.status));
  const k = await add('bd1', { job_id: 'j1', first_name: 'Al', last_name: 'Bee', email: 'a_b@acmebuild.com' });
  step('a typed "_" is a character, not a wildcard — a_b@ is not a1b@ (201)', k.status === 201, String(k.status) + ' ' + k.text);
  // The exact comparison after the query already decides, so the outcome
  // above cannot tell an escaped pattern from a raw one. The pattern can.
  step('…the search itself sent it escaped (a\\_b@), not as a wildcard',
    ilikes.includes('contacts:email:a\\_b@acmebuild.com') && !ilikes.includes('contacts:email:a_b@acmebuild.com'), ilikes.filter(x => /a.b@/.test(x)).join(' | '));
  const l = await add('bd1', { job_id: 'j1', first_name: 'Sam', last_name: 'Lee', email: 'shared@acmebuild.com' });
  step('another company\'s (org\'s) people never count (201) and never leak', l.status === 201 && !/Secret|Other Co|jX/.test(l.text), l.text);
  step('every accepted add wrote one history line', activity.filter(x => x.type === 'contact_added').length === 6, String(activity.length));
  step('the fake database really projected the new lookups',
    selects.some(s => s === 'contacts:id,first_name,last_name,email,designation,job_id') && selects.some(s => s.startsWith('jobs:id,company_id,position,stage')), selects.slice(-4).join(' | '));
  const m = await add('lead1', { job_id: 'j1', first_name: 'Zed', last_name: 'Zee', email: 'zed@acmebuild.com' });
  step('the gate is unchanged: someone who cannot work the lead may not add to it (403)', m.status === 403, String(m.status));
} catch (e) {
  step('the run reached its end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  server.close();
}
const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
