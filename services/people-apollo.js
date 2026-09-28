// ============================================================================
// APOLLO, FOR THE POC FINDER (R-053, D-0049) — the paid rung of the ladder
// (docs/CONTACT_FINDER_DESIGN.md §5, R5). Nothing else in PACE calls Apollo.
//
// TWO CALLS, AND WHAT EACH COSTS (Apollo's own docs, 2026-09):
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

// Apollo's own words, turned into what to do about them.
function describeApolloError(status, data) {
  const raw = String((data && (data.error || data.message || (data.errors && data.errors[0]))) || '').toLowerCase();
  if (status === 401 || /invalid (api )?key|unauthori[sz]ed/.test(raw)) {
    return 'Apollo did not accept the key — check it in Admin → Integrations.';
  }
  if (status === 403 || /not (included|accessible)|upgrade|plan|master api key/.test(raw)) {
    return 'This Apollo plan or key does not allow people search — it needs a plan with API access and a master API key.';
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

/** Can this key search people? Used by the Integrations card's Test. Free. */
async function checkPeopleSearch({ key, fetchImpl } = {}) {
  const r = await searchPeople({ key, domain: 'apollo.io', titles: ['CEO'], perPage: 1, fetchImpl });
  return r.ok ? { ok: true } : { ok: false, error: r.error, status: r.status };
}

module.exports = { searchPeople, revealPerson, checkPeopleSearch, describeApolloError, normalizePerson, BASE };
