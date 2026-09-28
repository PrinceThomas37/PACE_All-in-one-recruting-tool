// APOLLO FOR THE POC FINDER (R-053, D-0049) — services/people-apollo.js against
// a fake Apollo (an injected fetch). No network.
//
// Pins:
//   * the key travels in the X-Api-Key HEADER and never in a URL (a URL ends
//     up in logs);
//   * people search asks by the company's domains and the open slots' titles,
//     and reads a hidden ("obfuscated") surname as hidden — never as a name;
//   * a lookup (the call that spends a credit) is made ONCE — never retried,
//     even after a failure or a timeout, because a retry can spend a second
//     credit on the same person;
//   * only Apollo's "verified" is a confirmed address; its other statuses are
//     guesses (D-0049: a guess is never emailed);
//   * every refusal comes back as a sentence a recruiter can act on, and a
//     missing key or domain never reaches Apollo at all.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const apollo = require('../services/people-apollo.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const KEY = 'sk-test-9f8e7d';
function fakeApollo(answer) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const a = typeof answer === 'function' ? answer(url, calls.length) : answer;
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.body === undefined) throw new Error('no json'); return a.body; } };
  };
  return { calls, fetchImpl };
}

// ── people search ─────────────────────────────────────────────────────────
const s1 = fakeApollo({ status: 200, body: { people: [
  { id: 'a1', first_name: 'Dave', last_name_obfuscated: 'Re***d', title: 'Chief Estimator', has_email: true, linkedin_url: 'https://linkedin.com/in/x' },
  { id: 'a2', first_name: 'Olivia', last_name: 'Stone', title: 'Office Manager', has_email: false },
  { id: null, first_name: 'Nobody', title: 'HR Manager' },
  { id: 'a4', first_name: '', last_name: 'Blank', title: 'HR Manager' },
] } });
const titles = Array.from({ length: 30 }, (_, i) => 'Title ' + i);
const r1 = await apollo.searchPeople({ key: KEY, domains: ['acme.com', 'acmemail.com', 'acme.com'], titles, perPage: 500, fetchImpl: s1.fetchImpl });
const c1 = s1.calls[0] || {};
step('people search goes to the People API Search endpoint, as a POST', c1.url === 'https://api.apollo.io/api/v1/mixed_people/api_search' && c1.opts.method === 'POST', c1.url);
step('the key is in the X-Api-Key header', c1.opts && c1.opts.headers['X-Api-Key'] === KEY);
step('…and NEVER in the URL', !String(c1.url).includes(KEY) && !/api_key=/.test(String(c1.url)));
step('it asks by every domain the company uses, once each', JSON.stringify(c1.body.q_organization_domains_list) === '["acme.com","acmemail.com"]', JSON.stringify(c1.body.q_organization_domains_list));
step('titles are capped at 25, similar titles included', c1.body.person_titles.length === 25 && c1.body.include_similar_titles === true);
step('page size is clamped to Apollo\'s 100', c1.body.per_page === 100 && c1.body.page === 1, String(c1.body.per_page));
step('the answer is people', r1.ok === true && r1.people.length === 2, JSON.stringify(r1));
const dave = r1.people.find(p => p.id === 'a1') || {};
step('a HIDDEN surname is read as hidden — never as a name', dave.last_name === '' && dave.last_name_masked === true, JSON.stringify(dave));
step('a full surname is kept', (r1.people.find(p => p.id === 'a2') || {}).last_name === 'Stone');
step('"has no email" is kept, so no credit is spent looking for one', (r1.people.find(p => p.id === 'a2') || {}).has_email === false && dave.has_email === true);
step('a row with no id or no first name is dropped', !r1.people.some(p => !p.id || !p.first_name));

const none = fakeApollo({ status: 200, body: { people: [] } });
const noKey = await apollo.searchPeople({ key: '', domains: ['acme.com'], titles: ['CEO'], fetchImpl: none.fetchImpl });
step('no key: a sentence saying where to add it, and Apollo is never called', !noKey.ok && /Admin → Integrations/.test(noKey.error) && none.calls.length === 0, noKey.error);
const noDom = await apollo.searchPeople({ key: KEY, domains: [], titles: ['CEO'], fetchImpl: none.fetchImpl });
step('no domain: a sentence, and Apollo is never called', !noDom.ok && /website or email domain/.test(noDom.error) && none.calls.length === 0, noDom.error);
const one = await apollo.searchPeople({ key: KEY, domain: 'solo.com', titles: ['CEO'], fetchImpl: none.fetchImpl });
step('a single `domain` still works', one.ok && JSON.stringify(none.calls[0].body.q_organization_domains_list) === '["solo.com"]');

// ── refusals, in words ────────────────────────────────────────────────────
const cases = [
  [401, { error: 'Invalid access credentials.' }, /did not accept the key/],
  [403, { error: 'api/v1/mixed_people/api_search is not accessible with this api_key on a free plan. Please upgrade your plan' }, /does not allow people search.*master API key/],
  [422, { error: 'Invalid domain' }, /could not read the request/],
  [429, { message: 'Too many requests' }, /rate-limiting/],
  [500, undefined, /problem on its side \(HTTP 500\)/],
];
for (const [status, body, want] of cases) {
  const f = fakeApollo({ status, body });
  const r = await apollo.searchPeople({ key: KEY, domains: ['acme.com'], titles: ['CEO'], fetchImpl: f.fetchImpl });
  step(`HTTP ${status} comes back as a sentence`, !r.ok && r.status === status && want.test(r.error) && !r.error.includes(KEY), r.error);
}
const down = fakeApollo(new Error('getaddrinfo ENOTFOUND api.apollo.io'));
const rd = await apollo.searchPeople({ key: KEY, domains: ['acme.com'], titles: ['CEO'], fetchImpl: down.fetchImpl });
step('Apollo unreachable is said plainly', !rd.ok && /Could not reach Apollo from the PACE server/.test(rd.error), rd.error);

// ── the lookup that spends a credit ───────────────────────────────────────
const m1 = fakeApollo({ status: 200, body: { person: { first_name: 'Dave', last_name: 'Reed', title: 'Chief Estimator', email: 'dreed@acme.com', email_status: 'verified', linkedin_url: 'https://linkedin.com/in/dreed' } } });
const v1 = await apollo.revealPerson({ key: KEY, id: 'a1', fetchImpl: m1.fetchImpl });
const mc = m1.calls[0] || {};
step('a lookup goes to People Enrichment by Apollo\'s own id', mc.url === 'https://api.apollo.io/api/v1/people/match' && mc.body.id === 'a1' && mc.opts.headers['X-Api-Key'] === KEY && !mc.url.includes(KEY), mc.url);
step('…never asking for personal emails or phone numbers (a phone costs 8 credits)', mc.body.reveal_personal_emails === false && mc.body.reveal_phone_number === false);
step('a VERIFIED address comes back confirmed, with the full name', v1.ok && v1.email === 'dreed@acme.com' && v1.email_verified === true && v1.last_name === 'Reed', JSON.stringify(v1));
for (const st of ['extrapolated', 'guessed', 'unverified', 'likely to engage', null]) {
  const g = fakeApollo({ status: 200, body: { person: { first_name: 'Gia', last_name: 'Guess', email: 'gia@acme.com', email_status: st } } });
  const vg = await apollo.revealPerson({ key: KEY, id: 'g', fetchImpl: g.fetchImpl });
  step(`an address Apollo calls "${st}" is NOT confirmed`, vg.ok && vg.email_verified === false, JSON.stringify(vg));
}
const fail = fakeApollo({ status: 500 });
const vf = await apollo.revealPerson({ key: KEY, id: 'a1', fetchImpl: fail.fetchImpl });
step('a failed lookup is made ONCE — never retried (a retry can spend a second credit)', !vf.ok && fail.calls.length === 1, 'calls=' + fail.calls.length);
const hang = fakeApollo(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
const vh = await apollo.revealPerson({ key: KEY, id: 'a1', fetchImpl: hang.fetchImpl });
step('…and neither is one that timed out', !vh.ok && hang.calls.length === 1, 'calls=' + hang.calls.length);
const nothing = fakeApollo({ status: 200, body: {} });
const vn = await apollo.revealPerson({ key: '', id: 'a1', fetchImpl: nothing.fetchImpl });
step('no key: no lookup is made', !vn.ok && nothing.calls.length === 0);

// ── a company, by its website (2026-09-28) ────────────────────────────────
const o1 = fakeApollo({ status: 200, body: { organization: { id: 'org-1', name: 'Saylor Consulting', primary_domain: 'saylorconsulting.com',
  estimated_num_employees: 35, industry: 'architecture & planning', founded_year: 1998, linkedin_url: 'https://linkedin.com/company/saylor', city: 'San Francisco', state: 'California' } } });
const en = await apollo.enrichOrganization({ key: KEY, domain: 'SaylorConsulting.com', fetchImpl: o1.fetchImpl });
const oc = o1.calls[0] || {};
step('a company lookup is a GET to Organization Enrichment, by domain', oc.opts && oc.opts.method === 'GET' &&
  oc.url === 'https://api.apollo.io/api/v1/organizations/enrich?domain=saylorconsulting.com', oc.url);
step('…with the key in the header, never the URL', oc.opts && oc.opts.headers['X-Api-Key'] === KEY && !oc.url.includes(KEY));
step('…and the answer is the record: name, id and Apollo\'s employee ESTIMATE', en.ok && en.found && en.org.id === 'org-1' && en.org.name === 'Saylor Consulting' &&
  en.org.employees === 35 && en.org.industry && en.org.founded_year === 1998, JSON.stringify(en));
for (const [what, answer] of [['a 404', { status: 404, body: { error: 'not found' } }], ['an empty record', { status: 200, body: { organization: {} } }], ['no record', { status: 200, body: {} }]]) {
  const f = fakeApollo(answer);
  const r = await apollo.enrichOrganization({ key: KEY, domain: 'nobody.com', fetchImpl: f.fetchImpl });
  step(`${what} means "Apollo does not know it" — an answer, not an error`, r.ok === true && r.found === false, JSON.stringify(r));
}
const z = fakeApollo({ status: 200, body: { organization: { id: 'org-2', name: 'Tiny', estimated_num_employees: 0 } } });
const zr = await apollo.enrichOrganization({ key: KEY, domain: 'tiny.com', fetchImpl: z.fetchImpl });
step('an estimate of 0 is "not known", never "0 people"', zr.found && zr.org.employees === null, JSON.stringify(zr.org));
const oFail = fakeApollo({ status: 500 });
await apollo.enrichOrganization({ key: KEY, domain: 'acme.com', fetchImpl: oFail.fetchImpl });
step('a failed company lookup is made ONCE — never retried (a retry can be charged twice)', oFail.calls.length === 1, 'calls=' + oFail.calls.length);
const oPlan = fakeApollo({ status: 403, body: { error: 'not accessible with this api_key on a free plan' } });
const op = await apollo.enrichOrganization({ key: KEY, domain: 'acme.com', fetchImpl: oPlan.fetchImpl });
step('a plan refusal names what was refused — company lookups', !op.ok && /does not allow company lookups/.test(op.error), op.error);
const oNone = fakeApollo({ status: 200, body: {} });
const on1 = await apollo.enrichOrganization({ key: KEY, domain: '', fetchImpl: oNone.fetchImpl });
const on2 = await apollo.enrichOrganization({ key: '', domain: 'acme.com', fetchImpl: oNone.fetchImpl });
step('no website or no key: a sentence, and Apollo is never called', !on1.ok && !on2.ok && oNone.calls.length === 0);

// ── the record kept for diagnosis ─────────────────────────────────────────
const rec = apollo.callRecord('company_lookup', { ok: false, status: 403, error: 'refused', key: KEY }, '2026-09-28T10:00:00Z');
step('the diagnostics record says what happened — and never carries the key',
  rec.call === 'company_lookup' && rec.ok === false && rec.status === 403 && rec.error === 'refused' && !JSON.stringify(rec).includes(KEY), JSON.stringify(rec));

// ── the Integrations card's Test ──────────────────────────────────────────
const okCheck = fakeApollo({ status: 200, body: { people: [{ id: 'x', first_name: 'Tim', title: 'CEO' }] } });
const ck = await apollo.checkPeopleSearch({ key: KEY, fetchImpl: okCheck.fetchImpl });
step('the key test asks the question that matters — can it search people? (free)', ck.ok === true && /mixed_people\/api_search/.test(okCheck.calls[0].url) && okCheck.calls[0].body.per_page === 1);
const planCheck = fakeApollo({ status: 403, body: { error: 'This endpoint is not accessible on your current plan' } });
const cp = await apollo.checkPeopleSearch({ key: KEY, fetchImpl: planCheck.fetchImpl });
step('a valid key on a plan without API access FAILS the test, and says why', cp.ok === false && /does not allow people search/.test(cp.error), cp.error);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
