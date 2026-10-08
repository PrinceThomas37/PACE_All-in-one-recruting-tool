// The free job sources' ONLY caller (services/jobs-jsearch.js, R-164 / D-0099), driven by a fake job-search service:
// what is asked (address, the key in a header and never in the address, one page), how the answer is read, every failure said
// in words, and that nothing is ever retried (a retry after a timeout can be charged twice on the organisation's own plan).
//
// Usage: node test/jobs-jsearch-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const js = require('../services/jobs-jsearch.js');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const KEY = 'JS-SECRET-KEY-98765';
function fake(status, body) {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no json'); return body; } }; };
  return { calls, fetchImpl };
}
const JOB = { job_id: 'a', job_title: 'Welder', employer_name: 'Acme', employer_website: 'https://acme.com', job_posted_at_datetime_utc: '2026-10-07T00:00:00.000Z' };

console.log('\nWhat is asked');
let f = fake(200, { status: 'OK', data: { jobs: [JOB, JOB], cursor: 'NEXT' } });
let r = await js.searchJobs({ key: KEY, query: ' welder jobs in texas ', country: 'US', datePosted: 'week', fetchImpl: f.fetchImpl });
const u = f.calls[0] && new URL(f.calls[0].url);
step('one GET to the search address, one page, the query trimmed and encoded, the country lower-cased, the date choice passed', f.calls.length === 1 && u.origin + u.pathname === 'https://api.openwebninja.com/jsearch/search-v2' && u.searchParams.get('query') === 'welder jobs in texas' && u.searchParams.get('num_pages') === '1' && u.searchParams.get('country') === 'us' && u.searchParams.get('date_posted') === 'week' && f.calls[0].opts.method === 'GET');
step('the key travels in the x-api-key header and NEVER in the address (an address ends up in logs)', f.calls[0].opts.headers['x-api-key'] === KEY && !f.calls[0].url.includes(KEY));
step('the jobs and the cursor for the next page come back', r.ok && r.jobs.length === 2 && r.jobs[0].job_title === 'Welder' && r.cursor === 'NEXT');
f = fake(200, { status: 'OK', data: { jobs: [JOB] } });
await js.searchJobs({ key: KEY, query: 'x', datePosted: 'yesterday-ish', cursor: 'abc', fetchImpl: f.fetchImpl });
const u2 = new URL(f.calls[0].url);
step('a date choice the service does not have becomes "all"; a cursor is passed on', u2.searchParams.get('date_posted') === 'all' && u2.searchParams.get('cursor') === 'abc');
f = fake(200, { status: 'OK', data: [JOB] });
step('an older answer shape (the list straight under data) is still read', (await js.searchJobs({ key: KEY, query: 'x', fetchImpl: f.fetchImpl })).jobs.length === 1);
f = fake(200, { status: 'OK', data: { jobs: [] } });
step('no jobs is an ANSWER (ok, empty), not an error', (await js.searchJobs({ key: KEY, query: 'x', fetchImpl: f.fetchImpl })).ok === true);
f = fake(200, undefined);
step('an answer that is not JSON does not crash — it is "no jobs"', (await js.searchJobs({ key: KEY, query: 'x', fetchImpl: f.fetchImpl })).jobs.length === 0);

console.log('\nWhat it refuses before asking');
f = fake(200, { data: { jobs: [] } });
r = await js.searchJobs({ key: '', query: 'welder', fetchImpl: f.fetchImpl });
step('no key: no call, and it says where an admin adds one', !r.ok && f.calls.length === 0 && /Integrations & API Keys/.test(r.error));
r = await js.searchJobs({ key: KEY, query: '   ', fetchImpl: f.fetchImpl });
step('nothing to search for: no call', !r.ok && f.calls.length === 0);

console.log('\nWhen it fails, in words — and never retried');
for (const [status, re, label] of [[401, /did not accept the key/, 'a refused key'], [403, /did not accept the key/, 'a plan that is not active'], [429, /used up its requests/, 'a used-up allowance'], [500, /having a problem right now/, 'the service being down'], [422, /did not understand/, 'a search it cannot read']]) {
  f = fake(status, { message: status === 429 ? 'Monthly quota exceeded' : 'x' });
  r = await js.searchJobs({ key: KEY, query: 'x', fetchImpl: f.fetchImpl });
  step(label + ' (' + status + ') says what to do, with the key nowhere in the words, and makes exactly ONE call', !r.ok && re.test(r.error) && !r.error.includes(KEY) && f.calls.length === 1, r.error);
}
r = await js.searchJobs({ key: KEY, query: 'x', fetchImpl: async () => { throw new Error('socket hang up'); } });
step('a network failure says the PACE server could not reach it', !r.ok && /Could not reach JSearch from the PACE server/.test(r.error) && r.status === 0);

console.log('\nChecking a key and the diagnostics row');
f = fake(200, { status: 'OK', data: { jobs: [JOB] } });
const ck = await js.checkKey({ key: KEY, fetchImpl: f.fetchImpl });
step('checking a key is ONE request, and reports it works', ck.ok && f.calls.length === 1 && ck.jobs === 1);
f = fake(403, {});
step('a key that does not work reports why', (await js.checkKey({ key: KEY, fetchImpl: f.fetchImpl })).ok === false);
const rec = js.callRecord('finder_job_search', { ok: false, status: 429, error: 'used up', jobs: [1, 2] }, '2026-10-08T00:00:00Z');
step('the diagnostics row records what happened and never carries a key', rec.call === 'finder_job_search' && rec.ok === false && rec.status === 429 && rec.jobs === 2 && !JSON.stringify(rec).includes('KEY'));

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
