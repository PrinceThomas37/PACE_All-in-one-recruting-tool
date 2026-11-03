// THE CANDIDATE BESIDE THEIR EMAIL (R-362, owner 3 Nov 2026: "do the same for candidates … resume preview, contact number, email ID, small information"):
// GET /mailbox/candidate-card?email= on the REAL routes/mailbox.js over an in-memory database.
//   * an address PACE knows as a candidate answers with who they are, how to reach them, skills, a short resume preview, files and the jobs they are in;
//   * the rule is the one the app already has for opening a candidate: a shared pool of THIS company — pinned here so changing it is a decision;
//   * another company's candidate and a deleted one answer EXACTLY like an address nobody knows ({found:false}): the card cannot be used to ask
//     "is this person a candidate somewhere";
//   * the resume preview is short, plain text, with control characters stripped; skills are tidied (split, trimmed, no repeats, at most 8);
//   * at most 3 files and 4 jobs; a bad address is a 400.
// Usage: node test/mailbox-candidate-card-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const O = 'org-a', OTHER = 'org-b';
const users = [
  { id: 'adm', name: 'Ada Admin', role: 'admin' }, { id: 'rec1', name: 'Rae Recruiter', role: 'recruiter' }, { id: 'bd1', name: 'Bea Smith', role: 'bd' }, { id: 'stranger', name: 'Stan Other', role: 'bd' },
].map((u) => ({ ...u, org_id: O, deleted_at: null, manager_id: null }));
const longResume = 'Senior welder with 12 years of structural and pipe experience.   \u0000\u0007\n\nCertified AWS D1.1.  ' + 'Fabrication, MIG, TIG. '.repeat(80) + '<img src=x onerror=alert(1)>';
const cand = (id, over) => Object.assign({ id, org_id: O, full_name: 'Cal Candidate', first_name: 'Cal', last_name: 'Candidate', email: 'cal@mail.test', phone: '(555) 100-2000', alt_phone: '', current_title: 'Welder', headline: '',
  current_employer: 'Steelworks', current_location: 'Waco, TX', city: '', state: '', skills: 'MIG, TIG,  MIG , Pipe, Structural, Fabrication, Blueprints, Safety, Inspection, Extra', tags: ['AWS D1.1', 'MIG'], experience_years: 12,
  work_authorization: 'US citizen', availability: '2 weeks', applicant_status: 'Active', source: 'Indeed', owner_id: 'rec1', resume_text: longResume, resume_filename: 'cal.pdf', created_at: '2026-10-01T10:00:00Z', deleted_at: null }, over || {});
const fake = createFakeDb({
  tables: {
    users,
    candidates: [
      cand('k1'), cand('k2', { email: 'dup@mail.test', full_name: 'Dup One', created_at: '2026-10-02T10:00:00Z' }), cand('k3', { email: 'dup@mail.test', full_name: 'Dup Two', created_at: '2026-10-03T10:00:00Z' }),
      cand('kdel', { email: 'gone@mail.test', deleted_at: '2026-10-05T00:00:00Z' }), cand('kother', { email: 'far@mail.test', org_id: OTHER, full_name: 'Far Away' }),
      cand('kbare', { email: 'bare@mail.test', full_name: '', first_name: 'Bo', last_name: 'Bare', phone: '', current_title: '', headline: 'Headline only', current_employer: '', current_location: '', city: 'Austin', state: 'TX', skills: '', tags: null, experience_years: null,
        work_authorization: '', availability: '', applicant_status: '', source: '', owner_id: null, resume_text: '', resume_filename: '' }),
    ],
    candidate_documents: [1, 2, 3, 4].map((i) => ({ id: 'd' + i, org_id: O, candidate_id: 'k1', doc_type: 'resume', filename: `cv${i}.pdf`, uploaded_at: `2026-10-0${i}T10:00:00Z`, deleted_at: null })),
    job_orders: [1, 2, 3, 4, 5].map((i) => ({ id: 'jo' + i, org_id: O, job_title: 'Welder ' + i })),
    submissions: [1, 2, 3, 4, 5].map((i) => ({ id: 's' + i, org_id: O, candidate_id: 'k1', job_order_id: 'jo' + i, stage: i === 1 ? 'Submitted to Client' : 'Sourced', created_at: `2026-10-0${i}T10:00:00Z`, deleted_at: null })),
    app_settings: [],
  },
  relations: { submissions: { job_order: { table: 'job_orders', fk: 'job_order_id' } } },
});
const supabase = fake.supabase;
const { createDb } = require(path.join(ROOT, 'models/index.js'));
const db = createDb(supabase);
const { hasRole } = require(path.join(ROOT, 'middleware/authorize.js'))({ supabase });
const ownership = require(path.join(ROOT, 'services/ownership.js'));
const { reportingChainIds } = require(path.join(ROOT, 'hierarchy.js'))(supabase);
const ctx = {
  supabase, db, hasRole, ownership, reportingChainIds, orgIdFor: () => O,
  auth: (req, res, next) => { const u = users.find((x) => x.id === req.headers['x-user']); if (!u) return res.status(401).json({ error: 'no user' }); req.user = { id: u.id, org_id: O, role: u.role, roles: [u.role], name: u.name }; req.orgId = O; next(); },
};
const app = express(); app.use(express.json()); app.use(require(path.join(ROOT, 'routes/mailbox.js'))(ctx));
const server = app.listen(0, '127.0.0.1'); await new Promise((res) => server.once('listening', res));
const get = (who, q) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${server.address().port}/mailbox/candidate-card?email=${encodeURIComponent(q)}`, { headers: { 'x-user': who } }, (res) => {
    let out = ''; res.on('data', (d) => { out += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch (_) {} resolve({ status: res.statusCode, json, raw: out }); });
  }).on('error', reject);
});

let r = await get('rec1', 'cal@mail.test');
const c = (r.json || {}).candidate || {};
step('a known candidate: name, title, employer, place, email and phone', r.status === 200 && r.json.found && c.name === 'Cal Candidate' && c.headline === 'Welder' && c.employer === 'Steelworks' && c.location === 'Waco, TX' && c.email === 'cal@mail.test' && c.phone === '(555) 100-2000', JSON.stringify(c));
step('…status, experience, work authorization, availability, source and the owner\'s NAME', c.status === 'Active' && c.experience_years === 12 && c.work_authorization === 'US citizen' && c.availability === '2 weeks' && c.source === 'Indeed' && c.owner === 'Rae Recruiter');
step('skills are tidied: split, trimmed, no repeats ("MIG" once), at most 8', c.skills.length === 8 && c.skills.filter((s) => s === 'MIG').length === 1 && c.skills.every((s) => s === s.trim() && s), JSON.stringify(c.skills));
step('the resume preview is SHORT (≤ 600), one line of plain text, control characters gone', r.json.resume.preview.length === 600 && !/[\u0000-\u0008]/.test(r.json.resume.preview) && !/\n/.test(r.json.resume.preview) && /^Senior welder with 12 years/.test(r.json.resume.preview), r.json.resume.preview.slice(0, 80));
step('…the file name and at most 3 files (newest first)', r.json.resume.filename === 'cal.pdf' && r.json.resume.files.length === 3 && r.json.resume.files[0].filename === 'cv4.pdf');
step('the jobs they are in: title and stage, newest first, at most 4', r.json.jobs.length === 4 && r.json.jobs[0].title === 'Welder 5' && r.json.jobs.every((j) => j.title && 'stage' in j), JSON.stringify(r.json.jobs));
step('the card carries what the screen needs to open the whole record (the id)', c.id === 'k1');

// the rule the app already has: a shared pool of this company
const asBd = await get('bd1', 'cal@mail.test'); const asAdm = await get('adm', 'cal@mail.test'); const asStr = await get('stranger', 'cal@mail.test');
step('PINNED: candidates are a shared pool of the company — a BD who does not own the candidate, an admin and a stranger in the same company all see the card (the rule of GET /candidates/:id)', [asBd, asAdm, asStr].every((x) => x.json && x.json.found && x.json.candidate.id === 'k1'));

// nothing found answers the same way
const unknown = await get('rec1', 'nobody@mail.test'), deleted = await get('rec1', 'gone@mail.test'), foreign = await get('rec1', 'far@mail.test');
step('an unknown address, a DELETED candidate and ANOTHER COMPANY\'S candidate all answer exactly { found:false } — indistinguishable', unknown.raw === deleted.raw && deleted.raw === foreign.raw && unknown.json.found === false && Object.keys(unknown.json).length === 1, [unknown.raw, deleted.raw, foreign.raw].join(' | '));

// duplicates and gaps
const dup = await get('rec1', 'dup@mail.test');
step('two records with one address: the newest is shown and the other is counted', dup.json.candidate.name === 'Dup Two' && dup.json.more === 1);
const bare = await get('rec1', 'bare@mail.test');
step('a thin record is fine: name built from first + last, headline, place from city + state, no owner, no files, no jobs, nothing invented', bare.json.found && bare.json.candidate.name === 'Bo Bare' && bare.json.candidate.headline === 'Headline only' && bare.json.candidate.location === 'Austin, TX' && bare.json.candidate.owner === '' && bare.json.candidate.skills.length === 0 && bare.json.candidate.experience_years === null && bare.json.resume.preview === '' && bare.json.resume.files.length === 0 && bare.json.jobs.length === 0, JSON.stringify(bare.json).slice(0, 200));

// the address
step('a bad address is a 400', (await get('rec1', 'not-an-email')).status === 400 && (await get('rec1', '')).status === 400 && (await get('rec1', 'a@b.c' + 'x'.repeat(260))).status === 400);
step('the address is matched in any case', (await get('rec1', 'CAL@Mail.TEST')).json.found === true);
step('no user → 401 (the route is behind sign-in)', (await get('nobody', 'cal@mail.test')).status === 401);

server.close();
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
