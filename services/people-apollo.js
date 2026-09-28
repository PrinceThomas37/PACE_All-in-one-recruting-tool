// ============================================================================
// APOLLO, FOR THE POC FINDER (R-053, D-0049) — the paid rung of the ladder
// (docs/CONTACT_FINDER_DESIGN.md §5, R5). Nothing else in PACE calls Apollo.
//
// THREE CALLS, AND WHAT EACH COSTS (Apollo's own docs, 2026-09):
//   * Organization Enrichment  GET /api/v1/organizations/enrich?domain= — one
//     company's record by its website: employee count, industry, founded
//     year, LinkedIn, location. EXACTLY 1 credit when Apollo finds the
//     company, 0 when it does not (Apollo's own tool description,
//     2026-09-28). A GET, and still NEVER retried — a retry after a timeout
//     can be charged twice. Used for the company-size band (owner, 2026-09-28:
//     "make apollo search for employee size using company name and website").
//   * People API Search  POST /api/v1/mixed_people/api_search — finds people
//     at a company by title. Uses NO credits. Returns no email. Needs a plan
//     that includes it: the owner's plan on 2026-09-27 refused it outright
//     ("your Apollo plan does not include People API Search").
//   * People Enrichment  POST /api/v1/people/match — one person's full name,
//     title and work email. Uses a credit when it finds one. NEVER retried:
//     a retry after a timeout can spend a second credit for the same person.
//
// Every failure comes back as a plain sentence a recruiter can act on — the
// status code alone told nobody anything (the AI provider layer learned this).
// The key goes in the X-Api-Key header, never the URL: a URL ends up in logs.
//
// No database, no clock: the caller owns credits, the daily ceiling and what
// is stored. `fetchImpl` is injectable so the tests drive a fake Apollo.
// ============================================================================
const { fetchWithTimeout } = require('../http-client');

const BASE = 'https://api.apollo.io/api/v1';
const TIMEOUT_MS = 15000;

async function post(path, key, body, fetchImpl) {
  const res = await fetchWithTimeout(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
    body: JSON.stringify(body),
  }, { timeoutMs: TIMEOUT_MS, fetchImpl });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function get(pathAndQuery, key, fetchImpl) {
  const res = await fetchWithTimeout(BASE + pathAndQuery, {
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache', 'X-Api-Key': key },
  }, { timeoutMs: TIMEOUT_MS, fetchImpl });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// Apollo's own words, turned into what to do about them. `what` names the
// thing that was refused ("people search", "company lookups").
function describeApolloError(status, data, what) {
  const raw = String((data && (data.error || data.message || (data.errors && data.errors[0]))) || '').toLowerCase();
  if (status === 401 || /invalid (api )?key|unauthori[sz]ed/.test(raw)) {
    return 'Apollo did not accept the key — check it in Admin → Integrations.';
  }
  if (status === 403 || /not (included|accessible)|upgrade|plan|master api key/.test(raw)) {
    return 'This Apollo plan or key does not allow ' + (what || 'people search') + ' — it needs a plan with API access and a master API key.';
  }
  if (status === 429 || /rate limit|too many/.test(raw)) {
    return 'Apollo is rate-limiting this key right now — try again in a few minutes.';
  }
  if (status === 422) return 'Apollo could not read the request for this company (' + (raw || 'no detail') + ').';
  if (status >= 500) return 'Apollo is having a problem on its side (HTTP ' + status + ') — try again later.';
  return 'Apollo answered with an error (HTTP ' + status + (raw ? ': ' + raw : '') + ').';
}

function normalizePerson(p) {
  p = p || {};
  const last = p.last_name || '';
  return {
    id: p.id || null,
    first_name: p.first_name || '',
    last_name: last,
    // Some plans mask surnames in search results ("Sm***h"); the full one
    // only comes back from enrichment.
    last_name_masked: !last && !!p.last_name_obfuscated,
    title: p.title || '',
    linkedin_url: p.linkedin_url || null,
    has_email: p.has_email !== false,
  };
}

/**
 * People at one company whose titles fit. Free (no credits).
 * `domains`: the company's website domain and, when its staff mail uses a
 * different one, that too — Apollo files a company under its website.
 */
async function searchPeople({ key, domain, domains, titles, perPage = 25, fetchImpl } = {}) {
  if (!key) return { ok: false, status: 0, error: 'Apollo is not connected — add its key in Admin → Integrations.' };
  const orgDomains = Array.from(new Set([].concat(domains || [], domain || []).filter(Boolean)));
  if (!orgDomains.length) return { ok: false, status: 0, error: 'This company has no website or email domain to search by.' };
  let r;
  try {
    r = await post('/mixed_people/api_search', key, {
      q_organization_domains_list: orgDomains,
      person_titles: (titles || []).slice(0, 25),
      include_similar_titles: true,
      page: 1,
      per_page: Math.min(Math.max(1, perPage), 100),
    }, fetchImpl);
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach Apollo from the PACE server — ' + (e && e.message || e) };
  }
  if (!r.ok) return { ok: false, status: r.status, error: describeApolloError(r.status, r.data) };
  const list = (r.data && (r.data.people || r.data.contacts)) || [];
  const people = list.map(normalizePerson).filter(p => p.id && p.first_name);
  return { ok: true, status: r.status, people };
}

/** One person's full name + work email. Uses a credit when an email is found. */
async function revealPerson({ key, id, fetchImpl } = {}) {
  if (!key || !id) return { ok: false, status: 0, error: 'Nothing to look up.' };
  let r;
  try {
    r = await post('/people/match', key, { id, reveal_personal_emails: false, reveal_phone_number: false }, fetchImpl);
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach Apollo from the PACE server — ' + (e && e.message || e) };
  }
  if (!r.ok) return { ok: false, status: r.status, error: describeApolloError(r.status, r.data) };
  const p = (r.data && r.data.person) || {};
  return {
    ok: true, status: r.status,
    first_name: p.first_name || '', last_name: p.last_name || '', title: p.title || '',
    linkedin_url: p.linkedin_url || null,
    email: p.email || null,
    // Only Apollo's "verified" is a confirmed address. "guessed",
    // "unverified", "extrapolated"… are guesses, and D-0049 says a guess is
    // never emailed — the caller drops them.
    email_verified: String(p.email_status || '').toLowerCase() === 'verified',
    email_status: p.email_status || null,
  };
}

/**
 * One company's record, by its website domain. 1 credit when found, 0 when
 * not. `found:false` is an ANSWER (Apollo does not know it), not an error.
 */
async function enrichOrganization({ key, domain, fetchImpl } = {}) {
  if (!key) return { ok: false, status: 0, error: 'Apollo is not connected — add its key in Admin → Integrations.' };
  const d = String(domain || '').trim().toLowerCase();
  if (!d) return { ok: false, status: 0, error: 'This company has no website to look it up by.' };
  let r;
  try {
    r = await get('/organizations/enrich?domain=' + encodeURIComponent(d), key, fetchImpl);
  } catch (e) {
    return { ok: false, status: 0, error: 'Could not reach Apollo from the PACE server — ' + (e && e.message || e) };
  }
  if (r.status === 404) return { ok: true, status: 404, found: false };
  if (!r.ok) return { ok: false, status: r.status, error: describeApolloError(r.status, r.data, 'company lookups') };
  const o = (r.data && r.data.organization) || null;
  if (!o || !o.id) return { ok: true, status: r.status, found: false };
  const n = Number(o.estimated_num_employees);
  return {
    ok: true, status: r.status, found: true,
    org: {
      id: String(o.id), name: o.name || '', domain: o.primary_domain || d, website: o.website_url || null,
      // Apollo's ESTIMATE. Absent or 0 means it does not know — never "0 people".
      employees: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
      industry: o.industry || null, founded_year: o.founded_year || null, linkedin_url: o.linkedin_url || null,
      city: o.city || null, state: o.state || null, country: o.country || null,
    },
  };
}

/**
 * What an Apollo call did, for the one diagnostics row the routes keep
 * (app_settings `apollo_last_call` / `apollo_last_error`) — so a failure the
 * owner saw can be read from the database instead of being transcribed.
 * NEVER carries the key. `at` comes from the caller (no clock here).
 */
function callRecord(call, result, at) {
  const r = result || {};
  const out = { at: at || null, call, ok: !!r.ok, status: r.status == null ? null : r.status };
  if (r.error) out.error = String(r.error).slice(0, 300);
  if (r.found !== undefined) out.found = !!r.found;
  if (Array.isArray(r.people)) out.people = r.people.length;
  return out;
}

/** Can this key search people? Used by the Integrations card's Test. Free. */
async function checkPeopleSearch({ key, fetchImpl } = {}) {
  const r = await searchPeople({ key, domain: 'apollo.io', titles: ['CEO'], perPage: 1, fetchImpl });
  return r.ok ? { ok: true } : { ok: false, error: r.error, status: r.status };
}

module.exports = { searchPeople, revealPerson, enrichOrganization, checkPeopleSearch, callRecord, describeApolloError, normalizePerson, BASE };
