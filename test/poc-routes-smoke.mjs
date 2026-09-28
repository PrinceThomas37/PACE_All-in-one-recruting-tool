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
//   * "Find the rest" (slice 2, a fake Apollo): only EMPTY slots are searched;
//     a credit is spent only where nothing free works (a hidden surname, no
//     format) and never past the day's ceiling; an address is stored only as
//     Confirmed (Apollo verified) or Likely (the company's own format); the
//     finder NEVER writes a contact itself; somebody turned down, on file at
//     the company, or opted out anywhere is never suggested; a person looked
//     up for another lead is never paid for twice; Accept goes through the
//     one add-contact path and Not-this-person sticks.
//   * The company's size from Apollo (2026-09-28): looked up FIRST when unknown
//     (the same click), by website, checked by name; 1 credit only when found;
//     a picked size is never overwritten; "not known" is not asked (or paid
//     for) again for 30 days unless a person presses Look up; the ceiling
//     holds. "Search contact" on one slot searches that slot only. The last
//     Apollo answer is kept for diagnosis — never the key. The fake table enforces
//     migration 052's own CHECK rules and unique index, so a row the real
//     database would refuse fails here too.
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
  poc_suggestions: [],
  app_settings: [],
  // Opted out under ANOTHER company: the check is deployment-wide, like the send path's.
  suppression_list: [{ id: 's1', org_id: OTHER, email: 'optout@gamma.com' }],
};
let seq = 0;
// migration 052, as rules the fake refuses by
function pocCheck(r) {
  if (!['hr1', 'hr2', 'mgr1', 'mgr2'].includes(r.slot_key)) return 'slot_key';
  if (!r.first_name || r.first_name.length > 100) return 'first_name';
  if (!['apollo', 'website', 'posting'].includes(r.source)) return 'source';
  if (r.email_confidence != null && !['confirmed', 'likely'].includes(r.email_confidence)) return 'email_confidence';
  if (r.email_source != null && !['apollo', 'format'].includes(r.email_source)) return 'email_source';
  if (!['suggested', 'accepted', 'rejected'].includes(r.status)) return 'status';
  if ((r.email == null) !== (r.email_confidence == null)) return 'poc_suggestions_email_has_confidence';
  if ((r.status === 'suggested') !== (r.decided_at == null)) return 'poc_suggestions_decided_has_time';
  if (!r.org_id) return 'org_id not null';
  return null;
}
const dbRefused = [];   // every write the fake database refused, and why
const selects = [];   // every select list the route asked for, to prove projection ran
function cols(sel) {
  if (!sel || sel.trim() === '*') return null;
  return sel.split(',').map(s => s.trim()).filter(Boolean);
}
function q(table) {
  const st = { filters: [], op: 'select', payload: null, cols: null, limit: null, conflict: null };
  const rows = () => (tables[table] = tables[table] || []).filter(r => st.filters.every(f => f(r)));
  const project = (r) => { if (!st.cols) return Object.assign({}, r); const o = {}; st.cols.forEach(k => { if (k in r) o[k] = r[k]; }); return o; };
  const api = {
    select(s) { st.cols = cols(s); selects.push(table + ':' + s); return api; },
    eq(k, v) { st.filters.push(r => r[k] === v); return api; },
    is(k, v) { st.filters.push(r => (r[k] == null) === (v == null)); return api; },
    in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
    order() { return api; },
    limit(n) { st.limit = n; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    insert(p) { st.op = 'insert'; st.payload = [].concat(p); return api; },
    upsert(p, o) { st.op = 'upsert'; st.payload = [].concat(p); st.conflict = (o && o.onConflict) || 'id'; return api; },
    async maybeSingle() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] || null : r.data; return { data: d, error: r.error }; },
    async single() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: r.error || (d ? null : { message: 'no row' }) }; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    const all = (tables[table] = tables[table] || []);
    if (st.op === 'update') {
      const hit = rows();
      if (table === 'poc_suggestions') {
        for (const r of hit) { const why = pocCheck(Object.assign({}, r, st.payload)); if (why) { dbRefused.push(why); return { data: null, error: { message: 'violates ' + why } }; } }
      }
      hit.forEach(r => Object.assign(r, st.payload)); return { data: hit.map(project), error: null };
    }
    if (st.op === 'insert') {
      const made = [];
      for (const p of st.payload) {
        const r = Object.assign({ id: table + '-' + (++seq), created_at: new Date(Date.now() + seq).toISOString() }, p);
        if (table === 'poc_suggestions') {
          if (r.status === undefined) r.status = 'suggested';
          ['last_name', 'title', 'email', 'email_confidence', 'email_source', 'source_ref', 'linkedin_url', 'contact_id', 'decided_by', 'decided_at', 'company_id']
            .forEach(k => { if (r[k] === undefined) r[k] = null; });
          const why = pocCheck(r);
          if (why) { dbRefused.push(why); return { data: null, error: { message: 'violates ' + why } }; }
          if (r.source_ref && all.some(x => x.job_id === r.job_id && x.source === r.source && x.source_ref === r.source_ref)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "poc_suggestions_once_idx"' } };
          }
        }
        all.push(r); made.push(r);
      }
      return { data: made.map(project), error: null };
    }
    if (st.op === 'upsert') {
      for (const p of st.payload) {
        const hit = all.find(x => x[st.conflict] === p[st.conflict]);
        if (hit) Object.assign(hit, p); else all.push(Object.assign({ id: table + '-' + (++seq) }, p));
      }
      return { data: null, error: null };
    }
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
// A fake Apollo: what it was asked, and what it answers.
const apolloCalls = { search: [], reveal: [] };
let SEARCH = () => ({ ok: true, status: 200, people: [] });
const REVEAL = {};
// Company lookups by domain; anything not listed is "Apollo does not know it" (0 credits).
const ENRICH = {};
const apollo = {
  async searchPeople(a) { apolloCalls.search.push(a); return SEARCH(a); },
  async revealPerson(a) { apolloCalls.reveal.push(a.id); return REVEAL[a.id] || { ok: false, status: 404, error: 'Apollo could not find them.' }; },
  async enrichOrganization(a) { (apolloCalls.enrich = apolloCalls.enrich || []).push(a.domain); return ENRICH[a.domain] || { ok: true, status: 200, found: false }; },
};
const activity = [];
const logActivity = async (jobId, contactId, userId, type, text) => { activity.push({ jobId, contactId, userId, type, text }); };
app.use(require('../routes/poc.js')({ supabase, auth, hasRole, canTouchJob, orgIdFor: (req) => req.orgId, logActivity, apollo }));
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

  // ── "Find the rest" (slice 2) ─────────────────────────────────────────────
  const settings = require('../config/settings.js');
  const DAY = new Date().toISOString().slice(0, 10);
  const meter = () => { const r = tables.app_settings.find(x => x.key === `poc_credits_${ORG}_${DAY}`); return r ? Number(r.value) : 0; };
  const sug = (b, first) => ((b && b.suggestions) || []).find(x => x.first_name === first);

  const off = await call('GET', '/jobs/j1/poc', 'bd1');
  step('with no Apollo key the page is told so', off.body && off.body.finder && off.body.finder.apollo === false && off.body.finder.is_admin === false, JSON.stringify(off.body && off.body.finder));
  const noKey = await call('POST', '/jobs/j1/poc/find', 'bd1');
  step('"Find the rest" without a key is refused with a sentence saying who can fix it (409)',
    noKey.status === 409 && /ask an admin/.test(noKey.body.error) && /Admin → Integrations/.test(noKey.body.error), noKey.body && noKey.body.error);
  const noKeyAdm = await call('POST', '/jobs/j1/poc/find', 'adm');
  step('…and tells an admin to add it themselves', noKeyAdm.status === 409 && /^Apollo is not connected yet — add its key/.test(noKeyAdm.body.error), noKeyAdm.body && noKeyAdm.body.error);
  step('…and Apollo was never called', apolloCalls.search.length === 0 && apolloCalls.reveal.length === 0);

  tables.app_settings.push({ key: 'int_apollo_api_key', value: 'test-key' });
  SEARCH = () => ({ ok: true, status: 200, people: [
    // a hidden surname — only a credit can name him
    { id: 'ap-dave', first_name: 'Dave', last_name: '', last_name_masked: true, title: 'Director of Estimating', has_email: true },
    // a full name at a company whose format PACE knows → a Likely address, free
    { id: 'ap-olivia', first_name: 'Olivia', last_name: 'Stone', title: 'Office Manager', has_email: true },
    // on file on the company's other lead (j2) AND the best fit for the open
    // manager slot: if on-file people were not left out BEFORE picking, he
    // would take the slot from Dave and the slot would come back empty
    { id: 'ap-hidden', first_name: 'Hidden', last_name: 'Human', title: 'Chief Estimator', has_email: true },
    // on file on THIS lead, with her surname hidden by Apollo — she can only
    // be recognised after a lookup (see the other lead's run below)
    { id: 'ap-maria', first_name: 'Maria', last_name: '', last_name_masked: true, title: 'HR Manager', has_email: true },
    // neither HR nor a manager
    { id: 'ap-pat', first_name: 'Pat', last_name: 'Nobody', title: 'Warehouse Associate', has_email: true },
  ] });
  REVEAL['ap-dave'] = { ok: true, status: 200, first_name: 'Dave', last_name: 'Reed', title: 'Director of Estimating',
    linkedin_url: 'https://linkedin.com/in/dreed', email: 'dave.reed@acmebuild.com', email_verified: true, email_status: 'verified' };
  REVEAL['ap-maria'] = { ok: true, status: 200, first_name: 'Maria', last_name: 'Lopez', title: 'HR Manager', email: 'mlopez@acmebuild.com', email_verified: true };
  const contactsBefore = tables.contacts.length;
  const f1 = await call('POST', '/jobs/j1/poc/find', 'bd1');
  step('Find the rest answers with the fresh slots', f1.status === 200 && Array.isArray(f1.body.slots), f1.status + ' ' + (f1.body && f1.body.error));
  const ask = apolloCalls.search[0] || {};
  step('Apollo is searched by the company\'s own domain', JSON.stringify(ask.domains) === '["acmebuild.com"]', JSON.stringify(ask.domains));
  step('…for the titles of the EMPTY slots only (the filled president slot is not asked for)',
    (ask.titles || []).includes('Chief Estimator') && (ask.titles || []).includes('Office Manager') && !(ask.titles || []).includes('President'), JSON.stringify(ask.titles));
  step('two people found — somebody on file never takes a slot from somebody new', f1.body.result && f1.body.result.added === 2 && f1.body.result.already_known === 0, JSON.stringify(f1.body.result));
  const olivia = sug(f1.body, 'Olivia'), dave = sug(f1.body, 'Dave');
  step('the office manager fills the empty HR slot with a LIKELY address from the company\'s own format',
    olivia && olivia.slot_key === 'hr2' && olivia.email === 'ostone@acmebuild.com' && olivia.email_confidence === 'likely' && olivia.email_source === 'format', JSON.stringify(olivia));
  step('the estimating director fills the empty manager slot with Apollo\'s VERIFIED address (Confirmed)',
    dave && dave.slot_key === 'mgr1' && dave.last_name === 'Reed' && dave.email === 'dave.reed@acmebuild.com' && dave.email_confidence === 'confirmed' && dave.email_source === 'apollo', JSON.stringify(dave));
  step('exactly ONE credit spent — on the hidden surname, not on the person the format could reach',
    JSON.stringify(apolloCalls.reveal) === '["ap-dave"]' && meter() === 1 && f1.body.finder.credits.used === 1 && f1.body.finder.credits.limit === 20,
    JSON.stringify(apolloCalls.reveal) + ' meter=' + meter() + ' ' + JSON.stringify(f1.body.finder));
  // ("Human" alone would match the slot title "Human Resources Manager".)
  step('somebody already on file at the company is never suggested — and the other lead\'s people are never named',
    !/Hidden|hhuman@/.test(f1.text) && !sug(f1.body, 'Hidden') && !sug(f1.body, 'Maria'));
  step('nobody outside HR or management is suggested', !/Pat|Nobody/.test(f1.text));
  step('THE FINDER WROTE NO CONTACT — found people wait for a person to accept them', tables.contacts.length === contactsBefore);

  const f2 = await call('POST', '/jobs/j1/poc/find', 'bd1');
  step('asked again, it does not search again: every slot has somebody, or somebody waiting',
    f2.status === 200 && f2.body.result.added === 0 && apolloCalls.search.length === 1 && /waiting/.test(f2.body.result.message), JSON.stringify(f2.body && f2.body.result));

  const rj = await call('POST', `/jobs/j1/poc/suggestions/${olivia.id}/reject`, 'bd1');
  step('"Not this person" takes her off the list', rj.status === 200 && !sug(rj.body, 'Olivia'), String(rj.status));
  const rjRow = tables.poc_suggestions.find(x => x.id === olivia.id);
  step('…recorded as turned down, by whom and when', rjRow.status === 'rejected' && rjRow.decided_by === 'bd1' && !!rjRow.decided_at);
  const f3 = await call('POST', '/jobs/j1/poc/find', 'bd1');
  step('asked again, a turned-down person is never suggested for that lead again',
    f3.status === 200 && f3.body.result.added === 0 && !sug(f3.body, 'Olivia') && apolloCalls.search.length === 2, JSON.stringify(f3.body && f3.body.result));

  // A person looked up for one lead is never paid for twice.
  const rvA = apolloCalls.reveal.length;
  const g1 = await call('POST', '/jobs/j2/poc/find', 'bd2');
  const daveJ2 = sug(g1.body, 'Dave');
  step('the same person found for ANOTHER lead reuses the lookup — no second credit for him',
    g1.status === 200 && daveJ2 && daveJ2.email === 'dave.reed@acmebuild.com' && daveJ2.email_confidence === 'confirmed' && !apolloCalls.reveal.slice(rvA).includes('ap-dave'),
    JSON.stringify(g1.body && g1.body.result) + ' reveals=' + JSON.stringify(apolloCalls.reveal.slice(rvA)));
  // Maria's surname was hidden, so only a lookup could tell she is on file.
  const mariaRow = tables.poc_suggestions.find(x => x.job_id === 'j2' && x.source_ref === 'ap-maria');
  step('somebody recognised as ALREADY ON FILE only after the lookup is still never suggested',
    !sug(g1.body, 'Maria') && g1.body.result.already_known === 1 && /already on file/.test(g1.body.result.message), JSON.stringify(g1.body.result));
  step('…PACE records her as turned down itself, keeping no address', mariaRow && mariaRow.status === 'rejected' && mariaRow.decided_by == null && mariaRow.email === null, JSON.stringify(mariaRow));
  step('…and that lead\'s worker never sees the first lead\'s people', !/Maria|Lopez|Carter|mlopez@|jcarter@/.test(g1.text));
  const rvA2 = apolloCalls.reveal.length;
  await call('POST', '/jobs/j2/poc/find', 'bd2');
  step('…and she is never looked up (paid for) again', !apolloCalls.reveal.slice(rvA2).includes('ap-maria'), JSON.stringify(apolloCalls.reveal.slice(rvA2)));
  step('two credits spent so far: Dave once, Maria once', meter() === 2, 'meter=' + meter());

  const ac = await call('POST', `/jobs/j1/poc/suggestions/${dave.id}/accept`, 'bd1');
  const daveContact = tables.contacts.find(c => c.job_id === 'j1' && c.first_name === 'Dave');
  step('Accept makes him a contact on the lead — name, title, the confirmed address, LinkedIn',
    ac.status === 200 && daveContact && daveContact.last_name === 'Reed' && daveContact.designation === 'Director of Estimating' &&
    daveContact.email === 'dave.reed@acmebuild.com' && daveContact.linkedin === 'https://linkedin.com/in/dreed' && daveContact.org_id === ORG,
    ac.status + ' ' + JSON.stringify(daveContact));
  const acRow = tables.poc_suggestions.find(x => x.id === dave.id);
  step('…the suggestion records the decision and the contact it became', acRow.status === 'accepted' && acRow.contact_id === daveContact.id && acRow.decided_by === 'bd1');
  step('…the lead\'s history says where he came from',
    activity.some(a => a.type === 'contact_added' && a.contactId === daveContact.id && /POC finder \(Apollo, email confirmed by Apollo\)/.test(a.text)), JSON.stringify(activity.slice(-1)));
  step('…and the answer shows him in the slot he was found for', ac.body.slots.find(x => x.key === 'mgr1').contact_id === daveContact.id && !sug(ac.body, 'Dave'));
  const again = await call('POST', `/jobs/j1/poc/suggestions/${dave.id}/accept`, 'bd1');
  step('accepting twice adds nobody twice (409)', again.status === 409 && tables.contacts.filter(c => c.first_name === 'Dave' && c.job_id === 'j1').length === 1, String(again.status));

  const dup = await call('POST', `/jobs/j2/poc/suggestions/${daveJ2.id}/accept`, 'bd2');
  step('one person, one conversation: he cannot then be accepted onto another lead at the company (409, says why)',
    dup.status === 409 && /one conversation per person/.test(dup.body.error) && !tables.contacts.some(c => c.job_id === 'j2' && c.first_name === 'Dave'), dup.body && dup.body.error);
  const dupRow = tables.poc_suggestions.find(x => x.id === daveJ2.id);
  step('…PACE turned that suggestion down itself (no person named as the decider)', dupRow.status === 'rejected' && dupRow.decided_by == null && !!dupRow.decided_at);
  step('…without naming the other lead', !/j1|Junior Estimator/.test(dup.text));

  // Who may do it.
  const waitingJ2 = tables.poc_suggestions.find(x => x.job_id === 'j2' && x.status === 'suggested');
  step('(a suggestion is still waiting on the other lead)', !!waitingJ2);
  const g403 = await call('POST', '/jobs/j1/poc/find', 'lead1');
  step('someone who can see but not work the lead may not run the finder (403)', g403.status === 403, String(g403.status));
  const g404 = await call('POST', '/jobs/j1/poc/find', 'bd2');
  step('a BD who cannot see the lead gets 404', g404.status === 404, String(g404.status));
  const gX = await call('POST', '/jobs/j1/poc/find', 'admX');
  step('another company\'s admin gets 404', gX.status === 404, String(gX.status));
  const viaWrong = await call('POST', `/jobs/j1/poc/suggestions/${waitingJ2.id}/accept`, 'bd1');
  step('a suggestion is reached only through its own lead (404)', viaWrong.status === 404 && waitingJ2.status === 'suggested', String(viaWrong.status));
  const unseen = await call('POST', `/jobs/j2/poc/suggestions/${waitingJ2.id}/reject`, 'bd1');
  step('…and only by someone who can see that lead (404)', unseen.status === 404 && waitingJ2.status === 'suggested', String(unseen.status));
  const lead1Rej = await call('POST', `/jobs/j2/poc/suggestions/${waitingJ2.id}/accept`, 'admX');
  step('…never by another company', lead1Rej.status === 404 && waitingJ2.status === 'suggested', String(lead1Rej.status));

  // The day's ceiling.
  tables.companies.push({ id: 'co3', org_id: ORG, name: 'Beta Corp', website: 'beta.com', size_band: '51-200', deleted_at: null });
  tables.jobs.push({ id: 'j3', org_id: ORG, company_id: 'co3', position: 'Service Technician', industry: 'HVAC', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  await settings.setSettings(supabase, { poc_apollo_daily_credits: 2 });   // two a day — both already spent
  SEARCH = (a) => (a.domains || []).includes('beta.com') ? { ok: true, status: 200, people: [
    { id: 'ap-sam', first_name: 'Sam', last_name: '', last_name_masked: true, title: 'HR Manager', has_email: true },
    { id: 'ap-tina', first_name: 'Tina', last_name: 'Moss', title: 'Service Manager', has_email: true },
  ] } : { ok: true, status: 200, people: [] };
  REVEAL['ap-sam'] = { ok: true, status: 200, first_name: 'Sam', last_name: 'Hart', title: 'HR Manager', email: 'shart@beta.com', email_verified: true };
  const rvB = apolloCalls.reveal.length;
  const h1 = await call('POST', '/jobs/j3/poc/find', 'bd1');
  step('past the day\'s ceiling no credit is spent', h1.status === 200 && apolloCalls.reveal.length === rvB && meter() === 2, h1.status + ' reveals=' + (apolloCalls.reveal.length - rvB));
  step('…a hidden surname waits for another day instead of being stored as half a person',
    !sug(h1.body, 'Sam') && h1.body.result.held_for_credits === 1 && /credit/.test(h1.body.result.message), JSON.stringify(h1.body && h1.body.result));
  const tina = sug(h1.body, 'Tina');
  step('…a full name is still suggested — with NO address, because PACE knows no format here and will not guess one',
    tina && tina.email === null && tina.email_confidence === null && tina.slot_key === 'mgr1', JSON.stringify(tina));

  // Opted out anywhere; Apollo's own guesses.
  await settings.setSettings(supabase, { poc_apollo_daily_credits: 10 });
  tables.companies.push({ id: 'co4', org_id: ORG, name: 'Gamma LLC', website: 'https://www.gamma.com/about', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j4', org_id: ORG, company_id: 'co4', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  SEARCH = (a) => (a.domains || []).includes('gamma.com') ? { ok: true, status: 200, people: [
    { id: 'ap-omar', first_name: 'Omar', last_name: 'Out', title: 'HR Manager', has_email: true },
    { id: 'ap-gia', first_name: 'Gia', last_name: 'Guess', title: 'Chief Estimator', has_email: true },
  ] } : { ok: true, status: 200, people: [] };
  REVEAL['ap-omar'] = { ok: true, status: 200, first_name: 'Omar', last_name: 'Out', title: 'HR Manager', email: 'optout@gamma.com', email_verified: true };
  REVEAL['ap-gia'] = { ok: true, status: 200, first_name: 'Gia', last_name: 'Guess', title: 'Chief Estimator', email: 'gia@gamma.com', email_verified: false, email_status: 'extrapolated' };
  const k1 = await call('POST', '/jobs/j4/poc/find', 'bd1');
  step('somebody who opted out — under ANY company — is never suggested', k1.status === 200 && !sug(k1.body, 'Omar') && k1.body.result.opted_out === 1, JSON.stringify(k1.body && k1.body.result));
  step('…their address is not kept, and never reaches the page', !/optout@/.test(k1.text) && !tables.poc_suggestions.some(x => x.email === 'optout@gamma.com'));
  const gia = sug(k1.body, 'Gia');
  step('Apollo\'s own GUESS at an address is dropped — the person comes with no email (D-0049)', gia && gia.email === null && !/gia@gamma/.test(k1.text), JSON.stringify(gia));
  const rvC = apolloCalls.reveal.length;
  await call('POST', '/jobs/j4/poc/find', 'bd1');
  step('an opted-out person is not looked up — or paid for — again', apolloCalls.reveal.length === rvC, 'reveals ' + (apolloCalls.reveal.length - rvC));

  // Apollo refusing.
  SEARCH = () => ({ ok: false, status: 403, error: 'This Apollo plan or key does not allow people search — it needs a plan with API access and a master API key.' });
  const pl = await call('POST', '/jobs/j4/poc/find', 'bd1');
  step('Apollo refusing (its plan, the key) comes back as a sentence, never a bare code', pl.status === 502 && /plan/.test(pl.body.error), pl.body && pl.body.error);
  tables.companies.push({ id: 'co6', org_id: ORG, name: 'Delta Inc', website: 'delta.com', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j6', org_id: ORG, company_id: 'co6', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  SEARCH = () => ({ ok: true, status: 200, people: [
    { id: 'ap-d1', first_name: 'Dee', last_name: '', last_name_masked: true, title: 'HR Manager', has_email: true },
    { id: 'ap-d2', first_name: 'Don', last_name: '', last_name_masked: true, title: 'Chief Estimator', has_email: true },
  ] });
  REVEAL['ap-d1'] = { ok: false, status: 429, error: 'Apollo is rate-limiting this key right now — try again in a few minutes.' };
  REVEAL['ap-d2'] = { ok: true, status: 200, first_name: 'Don', last_name: 'Late', title: 'Chief Estimator', email: 'dlate@delta.com', email_verified: true };
  const rvD = apolloCalls.reveal.length;
  const rl = await call('POST', '/jobs/j6/poc/find', 'bd1');
  step('a rate limit stops the run — the next person is not tried against a refusing Apollo',
    rl.status === 200 && apolloCalls.reveal.length === rvD + 1 && rl.body.result.held_for_credits === 2 && /rate-limiting/.test(rl.body.result.message),
    JSON.stringify(rl.body && rl.body.result) + ' reveals=' + (apolloCalls.reveal.length - rvD));
  tables.companies.push({ id: 'co5', org_id: ORG, name: 'No Site Inc', website: null, size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j5', org_id: ORG, company_id: 'co5', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  const nd = await call('POST', '/jobs/j5/poc/find', 'bd1');
  step('a company with no website and no known address says what to add (409)', nd.status === 409 && /website/.test(nd.body.error), nd.body && nd.body.error);

  // ── the company's size, from Apollo (2026-09-28) ─────────────────────────
  const enrichN = () => (apolloCalls.enrich || []).length;
  const co = (id) => tables.companies.find(c => c.id === id);
  tables.companies.push({ id: 'co7', org_id: ORG, name: 'Saylor Consulting Group', website: 'https://www.saylorconsulting.com', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j7', org_id: ORG, company_id: 'co7', position: 'Cost Manager / Field Contract Administrator', industry: 'Architecture and Planning',
    stage: 'Assigned', created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  ENRICH['saylorconsulting.com'] = { ok: true, status: 200, found: true, org: { id: 'org-saylor', name: 'Saylor Consulting', employees: 35, industry: 'Architecture & Planning' } };
  SEARCH = (a) => (a.domains || []).includes('saylorconsulting.com') ? { ok: true, status: 200, people: [
    { id: 'ap-hana', first_name: 'Hana', last_name: 'Reyes', title: 'HR Manager', has_email: true },
    { id: 'ap-otto', first_name: 'Otto', last_name: 'Park', title: 'Office Manager', has_email: true },
    { id: 'ap-cal', first_name: 'Cal', last_name: 'Brooks', title: 'Director of Operations', has_email: true },
  ] } : { ok: true, status: 200, people: [] };
  REVEAL['ap-hana'] = { ok: true, status: 200, first_name: 'Hana', last_name: 'Reyes', title: 'HR Manager', email: 'hreyes@saylorconsulting.com', email_verified: true };
  const m0 = meter(), e0 = enrichN(), s0 = apolloCalls.search.length;
  const badSlot = await call('POST', '/jobs/j7/poc/find', 'bd1', { slot_key: 'boss' });
  step('an unknown slot is refused (400)', badSlot.status === 400, String(badSlot.status));
  const one = await call('POST', '/jobs/j7/poc/find', 'bd1', { slot_key: 'hr1' });
  step('with no size set, the SAME click looks the company up first — by its website',
    one.status === 200 && JSON.stringify((apolloCalls.enrich || []).slice(e0)) === '["saylorconsulting.com"]', one.status + ' ' + JSON.stringify((apolloCalls.enrich || []).slice(e0)));
  step('…Apollo’s 35 people becomes 20–50, marked as Apollo’s, with its count and id',
    co('co7').size_band === '21-50' && co('co7').employee_count === 35 && co('co7').size_source === 'apollo' && co('co7').apollo_org_id === 'org-saylor' && !!co('co7').size_checked_at,
    JSON.stringify(co('co7')));
  step('…and the page is told, in a sentence', one.body.size_known === true && one.body.size_source === 'apollo' && one.body.employee_count === 35 &&
    /^Company size from Apollo: about 35 people \(20–50\)\./.test(one.body.result.message), one.body.result && one.body.result.message);
  step('a company found costs ONE credit (Hana’s email needed a second)', meter() === m0 + 2, 'meter +' + (meter() - m0));
  const askOne = apolloCalls.search[s0] || {};
  const hr1 = one.body.slots.find(x => x.key === 'hr1');
  step('"Search contact" on one slot asks Apollo for THAT slot’s titles only',
    JSON.stringify(askOne.titles) === JSON.stringify(hr1.titles), JSON.stringify(askOne.titles));
  step('…and fills that slot only', one.body.suggestions.length === 1 && one.body.suggestions[0].slot_key === 'hr1' && one.body.suggestions[0].first_name === 'Hana',
    JSON.stringify(one.body.suggestions.map(x => [x.slot_key, x.first_name])));
  const all = await call('POST', '/jobs/j7/poc/find', 'bd1');
  step('searching again does not look the size up again (it is known now)', enrichN() === e0 + 1, String(enrichN() - e0));
  step('"Search contacts" then fills the other empty slots', all.status === 200 && all.body.suggestions.some(x => x.first_name === 'Otto') && all.body.suggestions.some(x => x.first_name === 'Cal'),
    JSON.stringify(all.body.suggestions.map(x => [x.slot_key, x.first_name])));

  // A size somebody picked is never overwritten.
  await call('PUT', '/jobs/j7/company-size', 'bd1', { size: '51-200' });
  step('a size picked by hand is marked as picked', co('co7').size_source === 'manual' && co('co7').size_band === '51-200');
  const eM = enrichN();
  const man = await call('POST', '/jobs/j7/company-size/lookup', 'bd1');
  step('"Look up with Apollo" leaves a picked size alone — and does not ask Apollo', man.status === 200 && co('co7').size_band === '51-200' && enrichN() === eM && /picked by hand/.test(man.body.result.message),
    man.body && man.body.result && man.body.result.message);

  // Apollo does not know the company: 0 credits, and not asked again for a while.
  tables.companies.push({ id: 'co8', org_id: ORG, name: 'Quiet Co', website: 'quiet.com', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j8', org_id: ORG, company_id: 'co8', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  const m1 = meter(), e1 = enrichN();
  const nf = await call('POST', '/jobs/j8/company-size/lookup', 'bd1');
  step('a company Apollo does not know costs nothing, and says so', nf.status === 200 && meter() === m1 && /does not know quiet\.com/.test(nf.body.result.message) && co('co8').size_band == null && !!co('co8').size_checked_at,
    nf.body && nf.body.result && nf.body.result.message);
  step('…and the page can say Apollo had no size', nf.body.size_known === false && !!nf.body.size_checked_at);
  await call('POST', '/jobs/j8/poc/find', 'bd1');
  step('a search soon after does not ask Apollo about that company again', enrichN() === e1 + 1, String(enrichN() - e1));
  await call('POST', '/jobs/j8/company-size/lookup', 'bd1');
  step('…but a person pressing "Look up with Apollo" does ask again', enrichN() === e1 + 2, String(enrichN() - e1));

  // The website finds a record, the name says it is somebody else.
  tables.companies.push({ id: 'co9', org_id: ORG, name: 'Northwind Builders', website: 'nwb.com', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j9', org_id: ORG, company_id: 'co9', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  ENRICH['nwb.com'] = { ok: true, status: 200, found: true, org: { id: 'org-sg', name: 'Southgate Holdings', employees: 5000 } };
  const mm = await call('POST', '/jobs/j9/company-size/lookup', 'bd1');
  step('a record under a DIFFERENT name is not used — the size is left for a person', mm.status === 200 && co('co9').size_band == null && co('co9').employee_count == null &&
    /Southgate Holdings/.test(mm.body.result.message), mm.body && mm.body.result && mm.body.result.message);

  // The day's ceiling holds for company lookups too.
  tables.companies.push({ id: 'co10', org_id: ORG, name: 'Capped Co', website: 'capped.com', size_band: null, deleted_at: null });
  tables.jobs.push({ id: 'j10', org_id: ORG, company_id: 'co10', position: 'Estimator', industry: 'Construction', stage: 'Assigned',
    created_by: 'bd1', assigned_to: null, assigned_to_bd: 'bd1', deleted_at: null });
  await settings.setSettings(supabase, { poc_apollo_daily_credits: meter() });
  const eC = enrichN();
  const cap = await call('POST', '/jobs/j10/company-size/lookup', 'bd1');
  step('past the day’s ceiling the company is not looked up', cap.status === 200 && enrichN() === eC && /used up/.test(cap.body.result.message), cap.body && cap.body.result && cap.body.result.message);

  // Who may press it.
  const lk403 = await call('POST', '/jobs/j7/company-size/lookup', 'lead1');
  const lk404 = await call('POST', '/jobs/j7/company-size/lookup', 'bd2');
  const lkX = await call('POST', '/jobs/j7/company-size/lookup', 'admX');
  step('"Look up with Apollo": 403 for someone who only sees the lead, 404 for someone who cannot, 404 for another company',
    lk403.status === 403 && lk404.status === 404 && lkX.status === 404, [lk403.status, lk404.status, lkX.status].join(','));
  const keyRow = tables.app_settings.find(x => x.key === 'int_apollo_api_key');
  tables.app_settings.splice(tables.app_settings.indexOf(keyRow), 1);
  const nok = await call('POST', '/jobs/j8/company-size/lookup', 'bd1');
  tables.app_settings.push(keyRow);
  step('with no key it says who can connect Apollo (409)', nok.status === 409 && /Apollo is not connected/.test(nok.body.error), nok.body && nok.body.error);

  // What Apollo last said is kept for diagnosis — never the key.
  const lastCall = tables.app_settings.find(x => x.key === 'apollo_last_call');
  const lastErr = tables.app_settings.find(x => x.key === 'apollo_last_error');
  step('the last Apollo answer is kept, and the last failure separately', !!lastCall && !!lastErr && JSON.parse(lastErr.value).ok === false,
    (lastCall && lastCall.value) + ' | ' + (lastErr && lastErr.value));
  step('…and neither ever holds the key', !String(lastCall && lastCall.value).includes('test-key') && !String(lastErr && lastErr.value).includes('test-key'));

  step('no write broke migration 052\'s own rules', dbRefused.length === 0, dbRefused.join(', '));
} catch (e) {
  step('the run reached its end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  server.close();
}

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
