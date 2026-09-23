// Spreadsheet columns land in the right lead field, the job link is kept, and
// nothing the sheet carried is thrown away (Session 29). The old matcher filed
// every "Email ID" as LinkedIn (live data, 2026-09-23) and had no job link.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../public/js/55-import-columns.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

console.log('\nImport columns');
t('THE BUG: "Email ID" is the email, never LinkedIn', () => {
  assert.equal(C.fieldFor('Email ID'), 'email');
  const r = C.mapRow({ 'Email ID': 'admin@rgbsnm.com', 'LinkedIn': '' });
  assert.equal(r.email, 'admin@rgbsnm.com'); assert.equal(r.linkedin, undefined);
});
t('a job link column is the job link, in every usual spelling', () => {
  for (const c of ['Job Link', 'Job URL', 'job_url', 'Posting URL', 'Apply Link', 'JD Link', 'Link', 'URL', 'Job Posting URL'])
    assert.equal(C.fieldFor(c), 'jobUrl', c);
});
t('the company website is the website, not the job link', () => {
  for (const c of ['Website', 'Company Website', 'Company URL', 'Domain', 'web'])
    assert.equal(C.fieldFor(c), 'website', c);
});
t('job title vs contact title are not confused', () => {
  assert.equal(C.fieldFor('Job Title'), 'position');
  assert.equal(C.fieldFor('Title'), 'designation');
  assert.equal(C.fieldFor('Contact Title'), 'designation');
  assert.equal(C.fieldFor('Position'), 'position');
});
t('short words no longer match inside longer names', () => {
  assert.equal(C.fieldFor('Client Size'), null);   // "li" used to make this LinkedIn
  assert.equal(C.fieldFor('Headquarters'), null);  // "ra"/"hq" nothing
  assert.equal(C.fieldFor('Company LinkedIn'), null);
});
t('unrecognised columns are KEPT as extras, as written', () => {
  const r = C.mapRow({ Company: 'Rio Grande', 'Employee Count': '45', 'Revenue': '$10M', 'Empty': '' });
  assert.equal(r.company, 'Rio Grande');
  assert.deepEqual(r._extra, { 'Employee Count': '45', 'Revenue': '$10M' });
});
t('a second column for the same field is kept as an extra, not lost', () => {
  const r = C.mapRow({ Email: 'a@x.com', 'Work Email': 'b@x.com' });
  assert.equal(r.email, 'a@x.com'); assert.equal(r._extra['Work Email'], 'b@x.com');
});
t('THE SHEET (2026-09-23): a "LinkedIn URL" column holding job postings is the JOB LINK', () => {
  for (const u of ['https://www.indeed.com/viewjob?jk=9190e580a6813847&q=rob',
                   'https://www.glassdoor.co.in/job-listing/office-manager-bookkee',
                   'https://www.linkedin.com/jobs/view/4469978357/?alternateCha']) {
    const r = C.mapRow({ 'Email ID': 'admin@rgbsnm.com', 'LinkedIn URL': u, Source: 'Indeed' });
    assert.equal(r.jobUrl, u, u); assert.equal(r.linkedin, undefined, u);
  }
});
t('a real LinkedIn profile still goes to the contact', () => {
  const r = C.mapRow({ 'LinkedIn URL': 'https://www.linkedin.com/in/jane-doe' });
  assert.equal(r.linkedin, 'https://www.linkedin.com/in/jane-doe'); assert.equal(r.jobUrl, undefined);
});
t('an email typed in the LinkedIn column is kept as an extra, never a profile', () => {
  const r = C.mapRow({ LinkedIn: 'a@x.com' });
  assert.equal(r.linkedin, undefined); assert.equal(r._extra.LinkedIn, 'a@x.com');
});
t('a sheet with its own job-link column keeps it; the posting in "LinkedIn" is not lost', () => {
  const r = C.mapRow({ 'Job Link': 'https://a.com/job', 'LinkedIn URL': 'https://www.indeed.com/viewjob?jk=1' });
  assert.equal(r.jobUrl, 'https://a.com/job'); assert.equal(r._extra['LinkedIn URL'], 'https://www.indeed.com/viewjob?jk=1');
});
t('the preview files the whole column by what it holds', () => {
  const rows = [{ 'LinkedIn URL': 'https://www.indeed.com/viewjob?jk=1' }, { 'LinkedIn URL': '' }, { 'LinkedIn URL': 'https://www.linkedin.com/jobs/view/1' }];
  assert.equal(C.columnField('LinkedIn URL', rows), 'jobUrl');
  assert.equal(C.columnField('LinkedIn URL', [{ 'LinkedIn URL': 'https://linkedin.com/in/x' }]), 'linkedin');
  assert.equal(C.columnField('LinkedIn URL', []), 'linkedin', 'no values: the name decides');
});

console.log('\nImport columns — wiring');
const mm = readFileSync(new URL('../public/js/14-mailmerge-engine.js', import.meta.url), 'utf8');
const jobs = readFileSync(new URL('../routes/jobs.js', import.meta.url), 'utf8');
const leads = readFileSync(new URL('../public/js/06-page-leads.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
t('the importer uses the new matcher and sends job_url and the extras', () => {
  assert.match(mm, /if\(window\.ImportColumns\)return window\.ImportColumns\.mapRow\(row\);/);
  assert.match(mm, /if\(g\.jobUrl\)payload\.job_url=g\.jobUrl;/);
  assert.match(mm, /payload\.import_extra=g\.extra;/);
  assert.match(html, /\/js\/55-import-columns\.js/);
  assert.match(mm, /ImportColumns\.columnField\(c,STATE\.importPreview\)/, 'the preview judges columns by their values');
});
t('the bulk endpoint stores the extras on the lead, bounded', () => {
  assert.match(jobs, /function cleanImportExtra/);
  assert.match(jobs, /import_extra: extra/);
});
t('the lead window draws Lead details, including the job link and website', () => {
  assert.match(leads, /leadDetailsBlock\(j\)\+/);
  assert.match(leads, /\['Job link',j\.job_url,true\]/);
  assert.match(leads, /\['Company website',j\.company_web,true\]/);
  assert.match(leads, /Other details from the import/);
});
t('only http(s) links are ever made clickable', () => {
  assert.match(leads, /function leadSafeUrl/);
  assert.doesNotMatch(leads, /href="'\+escAttr\(j\.job_url\)/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
