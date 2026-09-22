// The applicant → job link (Session 28).
//
// `routes/apply.js` records which job somebody applied to inside the staged
// row's `raw` blob rather than as a column. That makes the blob a CONTRACT, and
// `services/applicants.js` is its only reader — the router asks it, and hands
// the page a normalised `applied_job` so no screen ever parses `raw` itself.
//
// Why a test rather than trust: the original plan filtered this in PostgREST
// with `raw->>applied_to_job_order_id`, which cannot be exercised from this
// sandbox (no credentials) and whose failure mode is an EMPTY list, not an
// error. "No applicants yet" is indistinguishable from "the filter is broken",
// and the owner would have believed the first. Pure function, real assertions.
//
// Usage: node test/applicants-smoke.mjs

import { appliedJobId, appliedJob, isApplication, forJob, sourceLabel, submissionRowFor } from '../services/applicants.js';

const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const eq = (name, got, want) => step(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const JOB = 'af13bed4-ace6-4598-b21e-3b0c7fb7b6e9';

// Shaped exactly like the row routes/apply.js writes.
const application = {
  id: 's1', provider: 'apply', status: 'new', created_at: '2026-09-22T19:24:09.703Z',
  full_name: 'JOHN W. RAYA', email: 'a@b.com', resume_url: 'apply/tok/1-cv.pdf',
  raw: {
    applied_to_job_order_id: JOB,
    applied_to_job_code: 'JO-1042',
    applied_to_job_title: 'Industrial Electrician',
    applied_at: '2026-09-22T19:24:09.000Z',
    note: 'Available immediately',
    resume_filename: 'cv.pdf',
    resume_parsed: true,
  },
};
const csvRow = { id: 's2', provider: 'csv', status: 'new', full_name: 'Someone', raw: { imported_from: 'file.csv' } };

// ── the id ────────────────────────────────────────────────────────────────
eq('an application yields its job order id', appliedJobId(application), JOB);
eq('a CSV row yields no job id', appliedJobId(csvRow), null);

// `raw` is jsonb: every one of these is a shape the database can really hand
// back, and a reader that throws on one takes the whole page down with it.
for (const [label, raw] of [['null', null], ['a string', 'legacy'], ['an array', [1, 2]], ['empty', {}]]) {
  const row = { id: 'x', provider: 'apply', raw };
  let threw = false, out;
  try { out = appliedJobId(row); } catch (_) { threw = true; }
  step(`raw as ${label} returns null and never throws`, !threw && out === null, threw ? 'threw' : `got ${JSON.stringify(out)}`);
}

// ── the block the page renders ────────────────────────────────────────────
const aj = appliedJob(application);
eq('applied_job carries the id', aj.id, JOB);
eq('applied_job carries the title', aj.title, 'Industrial Electrician');
eq('applied_job carries the code', aj.code, 'JO-1042');
eq('applied_job carries the note', aj.note, 'Available immediately');
step('applied_job reports whether the CV could be read', aj.resume_parsed === true);
eq('a CSV row has no applied_job block at all', appliedJob(csvRow), null);

// A MISSING TITLE IS LEFT NULL, NEVER INVENTED. The page decides what to show
// when a job has no title; guessing one here would put the wrong role in front
// of a recruiter deciding whether to call somebody.
const untitled = { id: 's3', provider: 'apply', raw: { applied_to_job_order_id: JOB } };
eq('a missing title stays null rather than being guessed', appliedJob(untitled).title, null);

// An id written as a number (an older apply route, or a hand-fixed row) must
// still match the string the browser sends in a query string.
const numericId = { id: 's4', provider: 'apply', raw: { applied_to_job_order_id: 12345 } };
eq('a numeric job id is compared as a string', appliedJobId(numericId), '12345');
eq('and still matches a query-string id', forJob([numericId], '12345').length, 1);

// Whitespace is not an id.
eq('a blank job id is null, not an empty string', appliedJobId({ provider: 'apply', raw: { applied_to_job_order_id: '   ' } }), null);

// ── filtering for one job ─────────────────────────────────────────────────
const other = { id: 's5', provider: 'apply', raw: { applied_to_job_order_id: 'different-job' } };
const rows = [application, csvRow, other, untitled];

eq('forJob returns only this job\'s applications', forJob(rows, JOB).map(r => r.id), ['s1', 's3']);
step('forJob excludes non-applications', forJob(rows, JOB).every(isApplication));

// THE EMPTY CASE MUST BE A REFUSAL, NOT A PASS-THROUGH. If a page ever calls
// this with no job id, returning everything would show one job's page the
// applicants of every other job — the whole point of the screen, inverted.
eq('no job id returns nothing (never everything)', forJob(rows, null).length, 0);
eq('an empty job id returns nothing', forJob(rows, '').length, 0);
eq('an undefined list is handled', forJob(undefined, JOB).length, 0);

// A job nobody applied to is empty, and that is a real answer.
eq('a job with no applicants is empty', forJob(rows, 'nobody-applied').length, 0);


// ── the word a recruiter reads in the Source column ───────────────────────
// It stored the raw provider id, so a person who applied through a job link
// had a Source reading "apply" on their record. The owner asked for the
// applicant tag name instead.
eq('an applicant\'s source reads as a word, not an id', sourceLabel('apply'), 'Applicant');
eq('a CSV row says so too', sourceLabel('csv'), 'CSV import');
// An id with no mapping PASSES THROUGH rather than becoming blank — losing
// provenance is worse than showing a token.
eq('an unmapped provider passes through', sourceLabel('linkedin'), 'linkedin');
eq('no provider yields null, never a made-up word', sourceLabel(''), null);

// ── putting somebody on a job means a SUBMISSION ──────────────────────────
// The bug the owner hit: importing with a job wrote only a candidate_pipeline
// row, so the job page kept reading "Candidates (0)" for a person it had just
// accepted. Confirmed on the live record — candidate created, pipeline row
// created, ZERO submissions.
const sub = submissionRowFor(
  { id: 'cand-1', current_employer: 'Northwind', bill_rate: 80, availability: '2 weeks' },
  'job-1', 'user-1');
eq('the submission is at the first ATS stage', sub.stage, 'Sourced');
eq('it links the candidate', sub.candidate_id, 'cand-1');
eq('it links the job', sub.job_order_id, 'job-1');
eq('it records who added them', sub.submitted_by, 'user-1');
eq('it snapshots the employer', sub.employer_name, 'Northwind');
step('it snapshots rate and availability', sub.bill_rate === 80 && sub.availability === '2 weeks');

// NO JOB MEANS NO SUBMISSION — importing without a job must not invent one,
// or every applicant lands on whatever job happened to be open.
eq('no job id builds no submission', submissionRowFor({ id: 'c' }, '', 'u'), null);
eq('no candidate builds no submission', submissionRowFor(null, 'job-1', 'u'), null);
eq('a whitespace job id builds no submission', submissionRowFor({ id: 'c' }, '   ', 'u'), null);

// ── isApplication ─────────────────────────────────────────────────────────
step('only provider "apply" is an application',
  isApplication(application) && !isApplication(csvRow) && !isApplication(null) && !isApplication({ provider: 'linkedin' }));

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
