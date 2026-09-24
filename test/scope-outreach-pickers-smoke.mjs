// D-0034 / C-0027 — the outreach generator's pickers (`GET /outreach/recipients`,
// `GET /outreach/company-contacts/:id`), `POST /outreach/send` (lead ownership
// on creation), and `POST /outreach/convert-lead` (own token/id only), through
// the REAL router and the REAL supabase-js query builder, answered by a tiny
// in-memory PostgREST interpreter (observatory's C-0024 proof, adapted
// verbatim into a committed suite — including the case that matters most: a
// picker whose limit is spent on rows ahead of it must not come back empty for
// the viewer's own visible row sitting behind them).
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROUTER = process.argv[2] || path.join(ROOT, 'routes/outreach-generator.js');
const express = require(path.join(ROOT, 'node_modules/express'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const O = 'o1';
const users = [
  { id: 'A', role: 'admin', manager_id: null }, { id: 'L', role: 'bd_lead', manager_id: null },
  { id: 'B1', role: 'bd', manager_id: 'L' }, { id: 'B2', role: 'bd', manager_id: 'L' },
  { id: 'B3', role: 'bd', manager_id: null }, { id: 'RL', role: 'ra_lead', manager_id: null },
  { id: 'R1', role: 'ra', manager_id: 'RL' }, { id: 'R2', role: 'ra', manager_id: null },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const jobs = [
  { id: 'J1', assigned_to_bd: 'B1', created_by: 'R2', assigned_to: null, company_id: 'C1', position: 'P1' },
  { id: 'J2', assigned_to_bd: 'B2', created_by: 'R2', assigned_to: null, company_id: 'C1', position: 'P2' },
  { id: 'J3', assigned_to_bd: 'B3', created_by: 'R2', assigned_to: null, company_id: 'C1', position: 'P3' },
  { id: 'J4', assigned_to_bd: null, created_by: 'R1', assigned_to: null, company_id: 'C1', position: 'P4' },
  { id: 'J5', assigned_to_bd: null, created_by: 'R2', assigned_to: null, company_id: 'C1', position: 'P5' },
  { id: 'J6', assigned_to_bd: 'B3', created_by: 'R1', assigned_to: null, company_id: 'C1', position: 'P6' },
  { id: 'JX', assigned_to_bd: 'B1', created_by: 'B1', assigned_to: null, company_id: 'C1', position: 'other org' , org_id: 'o2'},
].map(j => ({ org_id: O, ...j }));
const contacts = [];
// 30 contacts on B3's lead FIRST, so a limit spent before filtering would eat every slot.
for (let i = 0; i < 30; i++) contacts.push({ id: 'c3_' + i, job_id: 'J3', first_name: 'Ned' + i, last_name: 'X', email: `ned${i}@b3.com` });
for (const j of ['J1', 'J2', 'J4', 'J5', 'J6', 'JX']) contacts.push({ id: 'c_' + j, job_id: j, first_name: 'Ed', last_name: j, email: `ed.${j}@x.com`, org_id: j === 'JX' ? 'o2' : O });
contacts.forEach(c => { c.org_id = c.org_id || O; c.designation = 'VP'; });
const companies = [{ id: 'C1', name: 'Berks', org_id: O, deleted_at: null, industry: '', location: '' }];
const tracking = [
  { id: 't1', token: 'tokB1', sent_by: 'B1', to_email: 'new@p.com', subject: 's', lead_id: null, org_id: O },
  { id: 't2', token: 'tokB2', sent_by: 'B2', to_email: 'new2@p.com', subject: 's', lead_id: null, org_id: O },
];
const DB = { users, jobs, contacts, companies, email_tracking: tracking, email_send_log: [], organizations: [{ id: O, name: 'Acme' }], app_settings: [] };
const inserts = [];
let nextId = 1;

function likeRe(p) { return new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); }
function test(row, col, expr) {
  const v = row ? row[col] : undefined;
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  if (op === 'eq') return String(v) === arg;
  if (op === 'is') return arg === 'null' ? v == null : false;
  if (op === 'not') { const [op2, ...r2] = arg.split('.'); return !test(row, col, op2 + '.' + r2.join('.')); }
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  if (op === 'ilike') return v != null && likeRe(arg).test(String(v));
  throw new Error('op ' + op);
}
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function orTest(row, expr) {
  return splitTop(expr.replace(/^\(|\)$/g, '')).some(part => { const i = part.indexOf('.'); return test(row, part.slice(0, i), part.slice(i + 1)); });
}
const fetchLog = [];
async function fakeFetch(u, init = {}) {
  const url = new URL(String(u)); const table = url.pathname.split('/').pop();
  const method = (init.method || 'GET').toUpperCase();
  const hdr = init.headers || {}; const get = (k) => (typeof hdr.get === 'function' ? hdr.get(k) : hdr[k] || hdr[k.toLowerCase()]);
  const wantObj = /vnd\.pgrst\.object/.test(get('Accept') || '');
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  fetchLog.push(method + ' ' + decodeURIComponent(url.pathname + url.search));
  if (method === 'POST') {
    const body = JSON.parse(init.body); const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: r.id || ('new' + nextId++), ...r }));
    inserts.push({ table, rows }); (DB[table] = DB[table] || []).push(...rows);
    return wantObj ? J(rows[0], 201) : J(rows, 201);
  }
  if (method === 'PATCH') { inserts.push({ table, patch: JSON.parse(init.body), q: url.search }); return J([], 200); }
  let rows = (DB[table] || []).slice();
  const sel = url.searchParams.get('select') || '*';
  if (table === 'contacts' && /jobs/.test(sel)) {
    rows = rows.map(c => { const j = jobs.find(x => x.id === c.job_id); return { ...c, jobs: j ? { ...j, companies: companies.find(k => k.id === j.company_id) || null } : null }; });
    if (/jobs!inner/.test(sel)) rows = rows.filter(c => c.jobs);
  }
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    if (k === 'or') { rows = rows.filter(r => orTest(r, v)); continue; }
    if (k.startsWith('jobs.')) { rows = rows.filter(r => r.jobs && test(r.jobs, k.slice(5), v)); continue; }
    rows = rows.filter(r => test(r, k, v));
  }
  const lim = url.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
  if (wantObj) return rows.length === 1 ? J(rows[0]) : J({ code: 'PGRST116', message: 'no rows' }, 406);
  return J(rows);
}
const supabase = createClient('http://db.local', 'k', { global: { fetch: fakeFetch }, auth: { persistSession: false } });
const { hasRole, canTouchJob } = require(path.join(ROOT, 'middleware/authorize'))({ supabase });
const orgIdFor = (req) => (req && req.user && req.user.org_id) || null;
const withOrg = (q, req) => { const o = orgIdFor(req); return o ? q.eq('org_id', o) : q; };
const orgStamp = (req) => { const o = orgIdFor(req); return o ? { org_id: o } : {}; };
const enrolled = [];
const ctx = {
  supabase, hasRole, canTouchJob, orgIdFor, withOrg, orgStamp,
  auth: (req, res, next) => { const id = req.headers['x-user']; const u = users.find(x => x.id === id); req.user = { id, role: u.role, roles: [u.role], org_id: O, name: id, email: id + '@acme.com' }; req.orgId = O; next(); },
  today: () => '2026-09-23', buildHtmlEmailBody: (t, s) => '<p>' + t + '</p>' + (s || ''),
  getMailboxSignature: async () => '', loadSuppressedSet: async () => new Set(),
  recruiterSendingMailbox: async (id) => ({ id: 'mb_' + id, email_address: id + '@acme.com', display_name: id, platform: 'Microsoft' }),
  sendMailboxNewMessage: async () => ({}), logActivity: async () => {},
  wfEngine: { enroll: async (o) => { enrolled.push(o); return { id: 'en' + enrolled.length, next_step_due_date: null }; } },
};
const app = express(); app.use(express.json()); app.use(require(ROUTER)(ctx));
const server = app.listen(0);
const PORT = server.address().port;
function call(method, p, user, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { 'x-user': user, 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const results = []; const ok = (n, c, d) => results.push({ n, c: !!c, d });
const jobsOf = (list) => [...new Set(list.map(c => c.job_id))].sort().join(',');
(async () => {
  const want = { B1: 'J1', L: 'J1,J2', B3: 'J3,J6', RL: 'J4,J5,J6', R1: 'J4,J6', A: 'J1,J2,J3,J4,J5,J6', R2: 'J1,J2,J3,J5' };
  for (const [u, w] of Object.entries(want)) {
    const r = await call('GET', '/outreach/recipients?q=ed', u);
    const got = jobsOf(r.body.contacts || []);
    // limit 8: the 30 B3 contacts fill the page for anyone who may see J3, so compare what is reachable.
    const exp = w.split(',').filter(Boolean);
    const gotSet = new Set(got.split(',').filter(Boolean));
    const noForeign = [...gotSet].every(j => exp.includes(j));
    const nonJ3 = exp.filter(j => j !== 'J3');
    const allNonJ3Present = nonJ3.every(j => gotSet.has(j)) || (r.body.contacts || []).length === 8;
    ok(`recipients as ${u}: only [${w}]`, r.status === 200 && noForeign && allNonJ3Present && (r.body.contacts || []).length <= 8, `status ${r.status} got [${got}] n=${(r.body.contacts||[]).length}`);
    const cc = await call('GET', '/outreach/company-contacts/C1', u);
    const got2 = new Set((cc.body || []).map(c => c.job_id));
    ok(`company-contacts as ${u}: only [${w}]`, cc.status === 200 && [...got2].every(j => exp.includes(j)) && (cc.body || []).length <= 25 && (nonJ3.every(j => got2.has(j)) || (cc.body || []).length === 25), `status ${cc.status} got [${[...got2].sort()}] n=${(cc.body||[]).length}`);
    ok(`no owner fields leak to the page (${u})`, !(r.body.contacts || []).some(c => 'assigned_to_bd' in c || 'jobs' in c), JSON.stringify((r.body.contacts||[])[0]));
  }
  // The limit is spent on visible rows: B1 sees J1 despite 30 invisible matches ahead of it.
  const b1 = await call('GET', '/outreach/recipients?q=ed', 'B1');
  ok('B1 finds its own contact past 30 invisible matches', (b1.body.contacts || []).length === 1 && b1.body.contacts[0].job_id === 'J1', JSON.stringify(b1.body.contacts));
  const bk = await call('GET', '/outreach/recipients?q=erk', 'B1');
  ok('companies stay shared (D-0034 left the client list undecided)', (bk.body.companies || []).length === 1 && (bk.body.contacts || []).length === 0, JSON.stringify(bk.body));
  ok('another org never appears, even for admin', !JSON.stringify((await call('GET', '/outreach/recipients?q=ed', 'A')).body).includes('JX'));

  // ── item 2: the sender owns the lead ─────────────────────────────────────
  inserts.length = 0;
  const s = await call('POST', '/outreach/send', 'B1', { to: 'fresh@prospect.com', subject: 'Hi', body: 'Hello there', sequence_id: 'wf1', company: 'NewCo', name: 'Pat Doe', position: 'Estimator' });
  const jobIns = inserts.find(i => i.table === 'jobs' && i.rows);
  ok('send+sequence: 200 and enrolled', s.status === 200 && s.body.sequence && s.body.sequence.enrollment_id, JSON.stringify(s.body));
  ok('send+sequence: lead owned by the sender', jobIns && jobIns.rows[0].assigned_to_bd === 'B1', jobIns && JSON.stringify(jobIns.rows[0]));
  ok('send+sequence: assigned_at stamped', jobIns && jobIns.rows[0].assigned_at, jobIns && jobIns.rows[0].assigned_at);
  ok('send+sequence: stage Assigned, org stamped', jobIns && jobIns.rows[0].stage === 'Assigned' && jobIns.rows[0].org_id === O);

  // ── a typed address already on a COLLEAGUE's lead is not enrolled ────────
  enrolled.length = 0;
  const s2 = await call('POST', '/outreach/send', 'B1', { to: 'ed.J2@x.com', subject: 'Hi', body: 'Hello', sequence_id: 'wf1' });
  ok("colleague's contact: sent, not enrolled, says why", s2.status === 200 && s2.body.sent && s2.body.sequence && /colleague/.test(s2.body.sequence.error || '') && enrolled.length === 0, JSON.stringify(s2.body));
  // ... but one on YOUR OWN lead still is
  enrolled.length = 0;
  const s3 = await call('POST', '/outreach/send', 'B1', { to: 'ed.J1@x.com', subject: 'Hi', body: 'Hello', sequence_id: 'wf1' });
  ok('own contact: enrolled on the existing lead', s3.status === 200 && enrolled.length === 1 && enrolled[0].job_id === 'J1', JSON.stringify(s3.body));

  // ── convert-lead: own token only; lead owned by the caller ───────────────
  const foreign = await call('POST', '/outreach/convert-lead', 'B1', { token: 'tokB2' });
  ok("convert-lead: a colleague's token is 404", foreign.status === 404, JSON.stringify(foreign));
  inserts.length = 0;
  const mine = await call('POST', '/outreach/convert-lead', 'B1', { token: 'tokB1', company: 'P Co', name: 'Sam Roe' });
  const cj = inserts.find(i => i.table === 'jobs' && i.rows);
  ok('convert-lead: own token → 201, Connected, owned by me', mine.status === 201 && cj && cj.rows[0].stage === 'Connected' && cj.rows[0].assigned_to_bd === 'B1', JSON.stringify(mine) + ' ' + (cj && JSON.stringify(cj.rows[0])));

  const fid = await call('POST', '/outreach/convert-lead', 'B1', { id: 't2' });
  ok("convert-lead by id: a colleague's row is 404", fid.status === 404, JSON.stringify(fid));
  inserts.length = 0;
  const mid = await call('POST', '/outreach/convert-lead', 'B2', { id: 't2', company: 'Q Co' });
  const cj2 = inserts.find(i => i.table === 'jobs' && i.rows);
  ok('convert-lead by id: own row → 201, owned by B2', mid.status === 201 && cj2 && cj2.rows[0].assigned_to_bd === 'B2', JSON.stringify(mid));
  const sent = await call('GET', '/outreach/sent', 'B1');
  ok('/outreach/sent returns the row id, own sends only', sent.status === 200 && sent.body.length === 3 && sent.body.every(r => r.id && r.sent_by === 'B1') && fetchLog.some(l => /email_tracking\?select=id,token,/.test(l)), JSON.stringify(sent.body));
  server.close();
  let failed = 0;
  for (const r of results) { if (!r.c) failed++; console.log(`[${r.c ? 'PASS' : 'FAIL'}] ${r.n}${r.c ? '' : '  — ' + r.d}`); }
  console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
  if (process.env.SHOWLOG) console.log(fetchLog.filter(l => /contacts\?/.test(l)).slice(0, 6).join('\n'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
