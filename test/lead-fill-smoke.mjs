// A re-imported sheet fills in what an existing lead is MISSING and never
// overwrites anything (Session 29, R-045).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fillPatch } = require('../services/lead-fill.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

const existing = {
  job: { id: 'j1', job_url: null, salary_range: '$50k', location: 'Albuquerque, NM', industry: '', job_created_date: null,
    research: { jd_raw: 'Title: Office Manager', import_extra: { 'Employee Count': '11-50' } } },
  company: { id: 'c1', website: 'https://rgbsnm.com' },
  contacts: [{ id: 'k1', email: 'Admin@RGBSNM.com', phone: '', linkedin: null, designation: 'HR', last_name: 'Team' }],
};
const sheet = {
  job_url: 'https://www.glassdoor.com/job/123', salary_range: '$99k', location: 'Denver, CO', industry: 'Construction',
  job_created_date: '2026-09-20', website: 'https://other.com',
  import_extra: { 'Employee Count': '500+', 'Revenue': '$10M' },
  contacts: [{ email: 'admin@rgbsnm.com', phone: '505-842-1754', linkedin: 'https://linkedin.com/in/x', designation: 'CEO', last_name: 'Other' },
             { email: 'stranger@x.com', phone: '1' }],
};

console.log('\nLead fill');
const p = fillPatch(existing, sheet);
t('THE CASE: a missing job link is filled in', () => assert.equal(p.job.job_url, 'https://www.glassdoor.com/job/123'));
t('empty fields are filled (industry, posted date)', () => {
  assert.equal(p.job.industry, 'Construction'); assert.equal(p.job.job_created_date, '2026-09-20');
});
t('NOTHING already on the lead is overwritten', () => {
  assert.equal(p.job.salary_range, undefined); assert.equal(p.job.location, undefined);
  assert.equal(p.company.website, undefined);
  const k = p.contacts.find(c => c.id === 'k1').patch;
  assert.equal(k.designation, undefined); assert.equal(k.last_name, undefined);
});
t('extra columns: new ones added, existing ones kept as they were', () => {
  assert.deepEqual(p.job.research.import_extra, { 'Employee Count': '11-50', 'Revenue': '$10M' });
  assert.equal(p.job.research.jd_raw, 'Title: Office Manager', 'the rest of research survives');
});
t('contacts are matched by email (case-insensitive) and only their blanks filled', () => {
  const k = p.contacts.find(c => c.id === 'k1').patch;
  assert.equal(k.phone, '505-842-1754'); assert.equal(k.linkedin, 'https://linkedin.com/in/x');
  assert.equal(p.contacts.length, 1, 'a contact not on the lead is never created or touched');
});
t('an email address is never written into LinkedIn (the #228 misfile)', () => {
  const q = fillPatch(existing, { contacts: [{ email: 'admin@rgbsnm.com', linkedin: 'admin@rgbsnm.com' }] });
  assert.equal(q.contacts.length, 0);
});
t('a job posting is never written into a contact\'s LinkedIn', () => {
  const q = fillPatch(existing, { contacts: [{ email: 'admin@rgbsnm.com', linkedin: 'https://www.indeed.com/viewjob?jk=1' }] });
  assert.equal(q.contacts.length, 0);
});
t('a lead with nothing missing yields an empty patch', () => {
  const full = { job: { job_url: 'u', salary_range: 's', location: 'l', industry: 'i', job_created_date: 'd' }, company: { website: 'w' }, contacts: [] };
  assert.deepEqual(fillPatch(full, sheet).filled.filter(f => !f.startsWith('extra:')), []);
});
t('research stored as a JSON string is read, not clobbered', () => {
  const q = fillPatch({ job: { research: JSON.stringify({ jd_raw: 'x', import_extra: { A: '1' } }) } }, { import_extra: { B: '2' } });
  assert.deepEqual(q.job.research, { jd_raw: 'x', import_extra: { A: '1', B: '2' } });
});

console.log('\nLead fill — wiring');
const jobs = readFileSync(new URL('../routes/jobs.js', import.meta.url), 'utf8');
const mm = readFileSync(new URL('../public/js/14-mailmerge-engine.js', import.meta.url), 'utf8');
t('the endpoint is org-scoped and applies the same ownership check as opening a lead', () => {
  const block = jobs.slice(jobs.indexOf("router.post('/jobs/fill-missing'"), jobs.indexOf("router.post('/jobs', auth"));
  assert.match(block, /withOrg\(supabase\.from\('jobs'\)/);
  assert.match(block, /created_by === req\.user\.id \|\| r\.assigned_to === req\.user\.id \|\| r\.assigned_to_bd === req\.user\.id/);
  assert.match(block, /fillPatch\(/);
  assert.doesNotMatch(block, /supabase\.from\('contacts'\)\.update\([^)]*\)\.eq\('id', c\.id\)\s*;/, 'contact writes must be org-scoped');
});
t('the importer sends existing leads to fill-missing instead of dropping them', () => {
  assert.match(mm, /apiPost\('\/jobs\/fill-missing',\{leads:fills\}\)/);
  assert.match(mm, /job_url:g\.jobUrl/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
