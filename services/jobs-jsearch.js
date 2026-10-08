// ============================================================================
// JSEARCH, FOR THE LEAD FINDER'S "FREE JOB SOURCES" (R-164, D-0099) — the only place PACE calls it.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS. A small company with no Apollo or ZoomInfo budget can still find companies that are hiring: JSearch
// (OpenWeb Ninja) searches Google for Jobs — LinkedIn, Indeed, ZipRecruiter, Glassdoor, company career pages — through a
// licensed API, by job title and place, and returns the employer, the job, where it is and when it was posted. It has no
// people and no emails: contacts are typed by hand (or found with Apollo if the organisation has it).
//
// WHAT IT COSTS (the vendor's own docs, read 2026-10-08): ONE request credit per page of up to 10 jobs, on the plan the
// ORGANISATION bought — the key belongs to the organisation using it, never to PACE (the vendor's terms allow showing the
// results inside a product, not reselling them as a data service, and a shared key would put every customer's searches on
// one allowance). The free plan is 200 requests a month with a hard stop. NEVER retried: a retry after a timeout can be
// charged twice.
//
//   GET https://api.openwebninja.com/jsearch/search-v2?query=…&num_pages=1&country=us&date_posted=…
//   header  x-api-key: <the organisation's key>            (a URL ends up in logs; a header does not)
//   200  { status:'OK', data:{ jobs:[ { job_id, job_title, employer_name, employer_website, job_publisher, job_apply_link,
//          job_posted_at_datetime_utc, job_city, job_state, job_country, job_location, job_is_remote, … } ], cursor } }
//
// Every failure comes back as a plain sentence a person can act on. No database, no clock: the caller owns the meter and
// what is stored. `fetchImpl` is injectable so the tests drive a fake service.
// ============================================================================
const { fetchWithTimeout } = require('../http-client');

const BASE = 'https://api.openwebninja.com/jsearch';
const TIMEOUT_MS = 20000;
const DATE_CHOICES = ['all', 'today', '3days', 'week', 'month'];

async function get(pathAndQuery, key, fetchImpl) {
  const res = await fetchWithTimeout(BASE + pathAndQuery, {
    method: 'GET',
    headers: { Accept: 'application/json', 'x-api-key': key },
  }, { timeoutMs: TIMEOUT_MS, fetchImpl });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/** The vendor's words turned into what to do about them. */
function describeError(status, data) {
  const raw = String((data && (data.error && (data.error.message || data.error) || data.message || data.detail)) || '').toLowerCase();
  if (status === 401 || status === 403 || /invalid.*key|not subscribed|unauthori[sz]ed|forbidden/.test(raw)) {
    return 'JSearch did not accept the key — check it under Admin → Integrations & API Keys. If it is new, make sure the plan is active.';
  }
  if (status === 429 || /quota|limit|exceed/.test(raw)) {
    return 'This JSearch key has used up its requests for the period (the free plan is 200 a month). It resets with the plan, or upgrade the plan with the vendor.';
  }
  if (status === 400 || status === 422) return 'JSearch did not understand the search' + (raw ? ' (' + raw.slice(0, 120) + ')' : '') + '.';
  if (status >= 500) return 'JSearch is having a problem right now (HTTP ' + status + '). Try again in a few minutes — nothing was lost.';
  return 'JSearch answered with an error (HTTP ' + status + (raw ? ': ' + raw.slice(0, 120) : '') + ').';
}

/**
 * One page of jobs for a free-text query ("welder jobs in texas"). ONE request credit. `datePosted` is one of
 * all / today / 3days / week / month (the service has no finer choice — the caller trims to the exact day count).
 */
async function searchJobs({ key, query, country = 'us', datePosted = 'all', cursor = '', fetchImpl } = {}) {
  if (!key) return { ok: false, status: 0, error: 'Free job sources are not connected. An admin adds the JSearch key under Admin → Integrations & API Keys.' };
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return { ok: false, status: 0, error: 'Nothing to search for.' };
  const params = ['query=' + encodeURIComponent(q), 'num_pages=1', 'country=' + encodeURIComponent(String(country || 'us').toLowerCase().slice(0, 2)),
    'date_posted=' + (DATE_CHOICES.includes(datePosted) ? datePosted : 'all')];
  if (cursor) params.push('cursor=' + encodeURIComponent(String(cursor)));
  let r;
  try {
    r = await get('/search-v2?' + params.join('&'), key, fetchImpl);
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach JSearch from the PACE server — ' + (e && e.message || e) };
  }
  if (!r.ok) return { ok: false, status: r.status, error: describeError(r.status, r.data) };
  const d = (r.data && r.data.data) || {};
  // v2 puts the list under data.jobs; an older shape put it straight under data.
  const jobs = Array.isArray(d.jobs) ? d.jobs : (Array.isArray(r.data && r.data.data) ? r.data.data : []);
  return { ok: true, status: r.status, jobs, cursor: (d && d.cursor) || null };
}

/** Does this key work? One request. Used by the admin's "Check my key". */
async function checkKey({ key, fetchImpl } = {}) {
  const r = await searchJobs({ key, query: 'accountant jobs in chicago', datePosted: 'week', fetchImpl });
  return r.ok ? { ok: true, jobs: r.jobs.length } : { ok: false, error: r.error, status: r.status };
}

/** What a call did, for the one diagnostics row the routes keep. NEVER carries the key. */
function callRecord(call, result, at) {
  const r = result || {};
  const out = { at: at || null, call, ok: !!r.ok, status: r.status == null ? null : r.status };
  if (r.error) out.error = String(r.error).slice(0, 300);
  if (Array.isArray(r.jobs)) out.jobs = r.jobs.length;
  return out;
}

module.exports = { searchJobs, checkKey, describeError, callRecord, BASE, DATE_CHOICES };
