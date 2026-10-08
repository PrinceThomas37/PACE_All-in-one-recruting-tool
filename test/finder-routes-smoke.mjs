// THE LEAD FINDER, SERVER SIDE — saved searches, the nightly run, cards, contacts, Accept (R-157, D-0085…D-0091).
// Proven against an in-memory TWO-organisation database and a fake Apollo that records every call, so what is pinned
// is what the owner asked for:
//   * only people an admin switched on may use it; a person's searches and cards are THEIRS (another person's, and
//     another organisation's, do not exist for them);
//   * a run asks Apollo ONCE, leaves out staffing firms and companies the organisation already works, ranks the rest, makes
//     no more cards than the person's daily number, never shows a company twice, and counts its credit;
//   * nothing is saved as a lead until Accept; Accept needs a job and at least one contact with an email, asks the add rule
//     again, sends an RA's lead to the pool and a BD's lead straight to them (in their mailbox), and can be pressed only once;
//   * Wait comes back on its day, Reject never does; postings cost one credit once; an email is revealed once, only a VERIFIED
//     one is kept, and the daily limits stop further calls BEFORE Apollo is asked.
// Usage: node test/finder-routes-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };
const finder = require('../services/lead-finder.js');
const leadCheck = require('../services/lead-check.js');
const settings = require('../config/settings.js');

let NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24), D = 'd'.repeat(24), E = 'e'.repeat(24);

// ── an in-memory database that answers what these routes ask ────────────────────────────────────────────
const like = (p, v) => new RegExp('^' + String(p).replace(/\\(.)|%|_|[.*+?^${}()|[\]]/g, (m, e) => e ? e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : '\\' + m) + '$', 'i').test(String(v == null ? '' : v));
const iso = (v) => (v instanceof Date ? v.toISOString() : v);
let uid = 0;
function makeStore() {
  const st = { calls: [], failures: {}, tables: {
    app_settings: [{ key: 'int_apollo_api_key', value: 'KEY-123' }],
    organizations: [{ id: 'o1' }, { id: 'o2' }],
    users: [
      { id: 'adm', org_id: 'o1', name: 'Ada Admin', email: 'ada@x.test', role: 'admin', roles: ['admin'] },
      { id: 'ra1', org_id: 'o1', name: 'Rhea RA', email: 'rhea@x.test', role: 'ra', roles: ['ra'] },
      { id: 'ra2', org_id: 'o1', name: 'Rob RA', email: 'rob@x.test', role: 'ra', roles: ['ra'] },
      { id: 'bd1', org_id: 'o1', name: 'Bea BD', email: 'bea@x.test', role: 'bd', roles: ['bd'] },
      { id: 'rec1', org_id: 'o1', name: 'Rex Recruiter', email: 'rex@x.test', role: 'recruiter', roles: ['recruiter'] },
      { id: 'ra9', org_id: 'o2', name: 'Other Org RA', email: 'o@y.test', role: 'ra', roles: ['ra'] },
    ],
    companies: [
      { id: 'c1', org_id: 'o1', name: 'Acme, Inc.', website: 'https://www.acme.com', linkedin_url: null, deleted_at: null },
      { id: 'c9', org_id: 'o2', name: 'Brazos Valley Machining', website: 'brazosmachining.example', linkedin_url: null, deleted_at: null },
    ],
    jobs: [{ id: 'j1', org_id: 'o1', company_id: 'c1', position: 'Controller', stage: 'Assigned', created_at: daysAgo(50), created_by: 'adm', assigned_to_bd: 'bd1', assigned_to: 'bd1', deleted_at: null }],
    job_orders: [], contacts: [], finder_searches: [], finder_cards: [],
    user_emails: [{ id: 'm1', org_id: 'o1', user_id: 'bd1', email_address: 'bea@x.test', is_active: true, daily_send_limit: 100 }],
    microsoft_tokens: [{ user_email_id: 'm1', refresh_failed: false }], gmail_tokens: [], email_send_log: [],
  } };
  const defaults = {
    finder_searches: () => ({ active: true, deleted_at: null, last_run_at: null, last_run_note: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), sector: null, keywords: [], domains: [], sizes: [] }),
    // like the real table, every insert has its own moment unless the writer stamps one
    finder_cards: () => ({ status: 'new', created_on: finder.dayOf(NOW), created_at: new Date(NOW.getTime() + (++uid)).toISOString(), postings: null, wait_until: null, lead_id: null, decided_at: null }),
    jobs: () => ({ deleted_at: null, created_at: NOW.toISOString() }), companies: () => ({ deleted_at: null }), contacts: () => ({}),
  };
  const query = (name, orgId) => {
    const filters = []; let mode = 'select', patch = null, row = null, lim = null, wantRows = false, sort = null;
    const rows = () => { let d = (st.tables[name] = st.tables[name] || []).filter((r) => (orgId == null || r.org_id == null || r.org_id === orgId) && filters.every((f) => f(r)));
      if (sort) d = d.slice().sort((a, b) => (sort.asc ? 1 : -1) * ((a[sort.c] > b[sort.c]) - (a[sort.c] < b[sort.c]))); return d; };
    const q = {
      select(cols) { q._cols = cols; if (mode !== 'select') wantRows = true; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, list) { filters.push((r) => list.includes(r[c])); return q; },
      lt(c, v) { filters.push((r) => String(iso(r[c])) < String(iso(v))); return q; },
      lte(c, v) { filters.push((r) => r[c] != null && String(iso(r[c])) <= String(iso(v))); return q; },
      ilike(c, p) { filters.push((r) => like(p, r[c])); return q; },
      order(c, o) { sort = { c, asc: !o || o.ascending !== false }; return q; },
      limit(n) { lim = n; return q; },
      update(p) { mode = 'update'; patch = p; return q; },
      insert(r) { mode = 'insert'; row = r; return q; },
      delete() { mode = 'delete'; return q; },
      upsert(r, o) { mode = 'upsert'; row = r; q._on = (o && o.onConflict) || 'key'; return q; },
      single: async () => { const x = await q.then((v) => v); return { data: Array.isArray(x.data) ? x.data[0] || null : x.data, error: x.error }; },
      maybeSingle: async () => { const x = await q.then((v) => v); return { data: Array.isArray(x.data) ? x.data[0] || null : x.data, error: x.error }; },
      then(res, rej) {
        st.calls.push([name, mode]);
        const fail = st.failures[name + ':' + mode];
        if (fail) return Promise.resolve({ data: null, error: fail }).then(res, rej);
        const t = (st.tables[name] = st.tables[name] || []);
        let out;
        if (mode === 'insert') {
          const list = (Array.isArray(row) ? row : [row]).map((r) => Object.assign({ id: r.id || `${name}-${++uid}` }, (defaults[name] || (() => ({})))(), orgId ? { org_id: orgId } : {}, r));
          for (const r of list) {
            if (name === 'finder_cards' && t.some((x) => x.org_id === r.org_id && x.user_id === r.user_id && x.company_key === r.company_key)) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } }).then(res, rej);
          }
          t.push(...list); out = { data: wantRows ? list.map((r) => Object.assign({}, r)) : null, error: null };
        } else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: wantRows ? hit : null, error: null }; }
        else if (mode === 'delete') { const hit = new Set(rows()); st.tables[name] = t.filter((r) => !hit.has(r)); out = { data: null, error: null }; }
        else if (mode === 'upsert') { for (const r of [].concat(row)) { const i = t.findIndex((x) => x[q._on] === r[q._on]); if (i >= 0) Object.assign(t[i], r); else t.push(Object.assign({}, r)); } out = { data: null, error: null }; }
        else { let d = rows(); if (lim) d = d.slice(0, lim); if (q._cols && q._cols !== '*') { const cs = q._cols.split(',').map((c) => c.trim()); d = d.map((r) => Object.fromEntries(cs.filter((c) => c in r).map((c) => [c, r[c]]))); } else d = d.map((r) => Object.assign({}, r)); out = { data: d, error: null }; }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };
  st.supabase = { from: (n) => query(n, null) };
  st.db = { forRequest: (req) => ({ from: (n) => query(n, req.orgId) }), forOrg: (o) => ({ from: (n) => query(n, o) }), global: st.supabase, crossOrg: (n) => query(n, null) };
  return st;
}

// ── a fake Apollo that records every call ───────────────────────────────────────────────────────────────
const RAW = {
  a: { id: A, name: 'Brazos Valley Machining', primary_domain: 'brazosmachining.example', website_url: 'http://www.brazosmachining.example', linkedin_url: 'http://www.linkedin.com/company/brazos', primary_phone: { number: '+1 254-555-0188' }, organization_headcount_twelve_month_growth: 0.12, organization_city: 'Waco', organization_state: 'Texas', sic_codes: ['3599'], organization_raw_address: '1 Industrial Way, Waco, TX' },
  b: { id: B, name: 'Lone Star Dental Partners', primary_domain: 'lonestardental.example', website_url: 'http://lonestardental.example', primary_phone: { number: '+1 800-555-0142' }, organization_headcount_twelve_month_growth: 0.09, organization_city: 'Houston', organization_state: 'Texas', sic_codes: ['8021'] },
  c: { id: C, name: 'Northline Staffing Group', primary_domain: 'northline.example', organization_headcount_twelve_month_growth: 0.2, sic_codes: ['7361'] },
  d: { id: D, name: 'Acme Incorporated', primary_domain: 'acme.com', organization_headcount_twelve_month_growth: 0.3 },
  e: { id: 'acct123', organization_id: E, modality: 'account', name: 'Gulf Coast Property Group', domain: 'gulfcoastproperty.example', organization_headcount_twelve_month_growth: 0.02, organization_city: 'Corpus Christi', organization_state: 'Texas', sic_codes: ['6513'] },
};
function makeApollo() {
  const a = { calls: [], orgs: Object.values(RAW), error: null, postings: [], people: [], reveal: { ok: true, first_name: 'Dana', last_name: 'Whitfield', title: 'HR Manager', email: 'dana@brazosmachining.example', email_verified: true } };
  const real = require('../services/people-apollo.js');
  a.callRecord = real.callRecord;
  a.searchOrganizations = async (x) => { a.calls.push(['orgs', x]); return a.error ? { ok: false, status: 403, error: a.error } : { ok: true, status: 200, organizations: a.orgs, total: a.orgs.length }; };
  a.organizationJobPostings = async (x) => { a.calls.push(['postings', x]); return { ok: true, status: 200, postings: a.postings }; };
  a.searchPeople = async (x) => { a.calls.push(['people', x]); return { ok: true, status: 200, people: a.people, total: a.people.length }; };
  a.revealPerson = async (x) => { a.calls.push(['reveal', x]); return Object.assign({ status: 200 }, a.reveal); };
  a.checkPeopleSearch = async () => { a.calls.push(['check']); return { ok: true }; };
  return a;
}

const hasRole = (req, ...roles) => (req.user.roles || []).some((r) => roles.includes(r));
const handlerOf = (router, p, m) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const callOn = (router) => async (p, m, who, body, params, query) => {
  let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } };
  const u = USERS[who];
  await handlerOf(router, p, m)({ user: Object.assign({}, u), orgId: u.org_id, body: body || {}, params: params || {}, query: query || {} }, res);
  return { code, out };
};
const USERS = {
  adm: { id: 'adm', name: 'Ada Admin', roles: ['admin'], role: 'admin', org_id: 'o1' },
  ra1: { id: 'ra1', name: 'Rhea RA', roles: ['ra'], role: 'ra', org_id: 'o1' },
  ra2: { id: 'ra2', name: 'Rob RA', roles: ['ra'], role: 'ra', org_id: 'o1' },
  bd1: { id: 'bd1', name: 'Bea BD', roles: ['bd'], role: 'bd', org_id: 'o1' },
  rec1: { id: 'rec1', name: 'Rex Recruiter', roles: ['recruiter'], role: 'recruiter', org_id: 'o1' },
  ra9: { id: 'ra9', name: 'Other Org RA', roles: ['ra'], role: 'ra', org_id: 'o2' },
  adm2: { id: 'adm2', name: 'Other Org Admin', roles: ['admin'], role: 'admin', org_id: 'o2' },
};
function boot() {
  const st = makeStore(), apollo = makeApollo(), jsearch = makeJsearch(), logged = [];
  const router = require('../routes/finder.js')({
    supabase: st.supabase, db: st.db, auth: (_a, _b, n) => n(), hasRole, apollo, jsearch, now: () => NOW, noRerunGap: false,
    withOrg: (q) => q, logActivity: async (...a) => { logged.push(a); }, getTimezoneFromLocation: () => 'CST',
  });
  leadCheck._resetForTests();
  return { st, apollo, jsearch, router, call: callOn(router), logged };
}
const resetCredits = (st, n) => settings.setSettings(st.supabase, { finder_apollo_daily_credits: n });

const SEARCH = { name: 'Machining, Texas, mid-size', sector: 'manufacturing', titles: ['CNC Machinist', 'Welder'], locations: ['Texas'], sizes: ['mid'], posted_days: 14 };

// ── a fake job-search service (the free sources) that records every call ───────────────────────────────────
const JOBSET = () => [
  { job_title: 'Welder', employer_name: 'Acme Mfg', employer_website: 'https://www.acmemfg.com', job_publisher: 'LinkedIn', job_apply_link: 'https://www.linkedin.com/jobs/view/1', job_posted_at_datetime_utc: daysAgo(1), job_city: 'Austin', job_state: 'Texas' },
  { job_title: 'MIG Welder', employer_name: 'Acme Mfg', employer_website: 'https://www.acmemfg.com', job_publisher: 'Indeed', job_apply_link: 'https://www.indeed.com/viewjob?jk=2', job_posted_at_datetime_utc: daysAgo(3), job_city: 'Austin', job_state: 'Texas' },
  { job_title: 'Welder', employer_name: 'Gulf Fabrication', job_publisher: 'ZipRecruiter', job_apply_link: 'https://www.ziprecruiter.com/c/x', job_posted_at_datetime_utc: daysAgo(2), job_city: 'Houston', job_state: 'Texas' },
  { job_title: 'Welder', employer_name: 'Northline Staffing Group', employer_website: 'https://northline.example', job_posted_at_datetime_utc: daysAgo(1) },
  { job_title: 'Welder', employer_name: 'Acme, Inc.', employer_website: 'https://www.acme.com', job_posted_at_datetime_utc: daysAgo(1) },
];
function makeJsearch() {
  const j = { calls: [], error: null, jobs: JOBSET };
  j.callRecord = require('../services/jobs-jsearch.js').callRecord;
  j.searchJobs = async (x) => { j.calls.push(x); return j.error ? { ok: false, status: 403, error: j.error } : { ok: true, status: 200, jobs: j.jobs(), cursor: null }; };
  j.checkKey = async (x) => { j.calls.push(Object.assign({ check: true }, x)); return j.error ? { ok: false, status: 403, error: j.error } : { ok: true, jobs: 3 }; };
  return j;
}

// ═════ 1. who may use it ═══════════════════════════════════════════════════════════════════════════════
console.log('\nWho may use it');
let { st, apollo, router, call } = boot();
let r = await call('/finder/access', 'get', 'ra1');
step('a person nobody has switched on is told "not enabled" (200, nothing else)', r.code === 200 && r.out.enabled === false && Object.keys(r.out).length <= 2);
r = await call('/finder/searches', 'get', 'ra1');
step('…and every other finder route refuses them with a plain 403', r.code === 403 && /not switched on/.test(r.out.error));
r = await call('/finder/access', 'get', 'adm');
step('an admin is always on (they set it up), with the choices to offer: the industries and three sizes', r.out.enabled && r.out.sectors.length >= 35 && r.out.sizes.length === 3 && r.out.is_admin);
r = await call('/finder/admin/users/:id', 'put', 'ra1', { enabled: true }, { id: 'ra1' });
step('only an admin can switch people on (403 otherwise)', r.code === 403);
r = await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 40 }, { id: 'ra1' });
step('an admin switches Rhea on with her own number, 40 a day', r.code === 200 && r.out.enabled && r.out.daily === 40);
r = await call('/finder/access', 'get', 'ra1');
step('…now she is on, with 40 a day and the organisation\'s credit limit visible', r.out.enabled && r.out.daily === 40 && r.out.credits.limit === 300 && r.out.goes_to === 'pool');
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra2' });
r = await call('/finder/access', 'get', 'ra2');
step('a person with no number of their own gets the organisation\'s (25)', r.out.daily === 25);
r = await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'rec1' });
step('a recruiter (a role that does not add leads) cannot be switched on', r.code === 400);
r = await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra9' });
step('another organisation\'s person does not exist for this admin (404)', r.code === 404);
r = await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 9999 }, { id: 'ra1' });
step('a daily number above 500 is refused with the range', r.code === 400 && /0 to 500/.test(r.out.error));
r = await call('/finder/admin/users', 'get', 'adm');
step('the admin\'s list shows people who add leads (not the recruiter, not another organisation) with each one\'s state', r.out.users.map((u) => u.id).sort().join() === 'adm,bd1,ra1,ra2' && r.out.users.find((u) => u.id === 'ra1').daily === 40 && r.out.users.find((u) => u.id === 'ra2').effective_daily === 25);
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 2 }, { id: 'ra2' });
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 10 }, { id: 'bd1' });

// ═════ 2. saved searches — personal ═══════════════════════════════════════════════════════════════════════
console.log('\nSaved searches');
r = await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { titles: [] }));
step('a search with no job title is refused, in words', r.code === 400 && /job title/.test(r.out.error));
r = await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { locations: [] }));
step('…and one with no place', r.code === 400 && /place/.test(r.out.error));
r = await call('/finder/searches', 'post', 'ra1', SEARCH);
const s1 = r.out;
step('a good search is saved (201) for the person who made it', r.code === 201 && s1.user_id === 'ra1' && s1.titles.join() === 'CNC Machinist,Welder' && s1.org_id === 'o1');
await call('/finder/searches', 'post', 'ra2', Object.assign({}, SEARCH, { name: 'Rob\'s' }));
r = await call('/finder/searches', 'get', 'ra1');
step('Rhea sees only HER searches, never Rob\'s', r.out.searches.length === 1 && r.out.searches[0].id === s1.id);
r = await call('/finder/searches/:id', 'put', 'ra2', SEARCH, { id: s1.id });
step('Rob cannot change Rhea\'s search: it does not exist for him (404)', r.code === 404);
r = await call('/finder/searches/:id', 'put', 'ra1', Object.assign({}, SEARCH, { name: 'Renamed', posted_days: 30 }), { id: s1.id });
step('Rhea changes hers', r.code === 200 && r.out.name === 'Renamed' && r.out.posted_days === 30);
await call('/finder/searches/:id', 'put', 'ra1', SEARCH, { id: s1.id });
let many = 0; for (let i = 0; i < 25; i++) { const x = await call('/finder/searches', 'post', 'adm', Object.assign({}, SEARCH, { name: 'S' + i })); if (x.code === 201) many++; }
step('a person can keep 20 saved searches, no more', many === 20);

// ═════ 3. running a search ═══════════════════════════════════════════════════════════════════════════════
console.log('\nRunning a search');
r = await call('/finder/searches/:id/run', 'post', 'ra1', {}, { id: s1.id });
const asked = apollo.calls.filter((c) => c[0] === 'orgs');
step('"Run now" asks Apollo ONCE, for a full page, with the search\'s own titles, place, size and date', r.code === 200 && asked.length === 1 && asked[0][1].perPage === 100 && asked[0][1].filters.q_organization_job_titles.join() === 'CNC Machinist,Welder' && asked[0][1].filters.organization_job_locations.join() === 'Texas' && asked[0][1].filters.organization_num_employees_ranges.join() === '51,200,201,500' && asked[0][1].filters.organization_job_posted_at_range.min === '2026-09-23', JSON.stringify(asked[0] && asked[0][1].filters));
const cards = st.tables.finder_cards.filter((c) => c.user_id === 'ra1');
step('it made cards for the three clients (Brazos, Lone Star, Gulf Coast — the "saved account" bucket is read too) …', cards.map((c) => c.company_name).sort().join() === 'Brazos Valley Machining,Gulf Coast Property Group,Lone Star Dental Partners', cards.map((c) => c.company_name).join());
step('… left out the staffing firm …', !cards.some((c) => /Staffing/.test(c.company_name)));
step('… and left out the company this organisation already works (Acme under another name: same website, active lead)', !cards.some((c) => /Acme/.test(c.company_name)) && /1 already in your organisation/.test(r.out.results[0].note) && /1 staffing firm left out/.test(r.out.results[0].note), r.out.results[0].note);
step('a card is only a suggestion: NO lead, company or contact was written by the run', st.tables.jobs.length === 1 && st.tables.companies.length === 2 && st.tables.contacts.length === 0);
step('the company in the "saved accounts" bucket is keyed by ITS company id (not the account id)', cards.some((c) => c.company_key === E && c.apollo_org_id === E));
step('the best-growing company ranks first (Brazos +12%)', [...cards].sort((a, b) => b.score - a.score)[0].company_name === 'Brazos Valley Machining');
step('the run costs ONE credit, counted on the organisation\'s meter', Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-07').value) === 1);
step('the search remembers when it ran and what it found, in words', /Found 5 companies hiring\. 3 new cards/.test(st.tables.finder_searches.find((s) => s.id === s1.id).last_run_note));
const before = apollo.calls.length;
r = await call('/finder/searches/:id/run', 'post', 'ra1', {}, { id: s1.id });
step('pressing Run again a moment later does NOT call Apollo again (a double-click costs one call)', apollo.calls.length === before && r.out.results[0].skipped);
step('a card carries no phone number it was not given and no invented facts (only what Apollo sent)', cards.find((c) => c.company_name === 'Lone Star Dental Partners').payload.company.linkedin_url === '');

// the daily number
await call('/finder/searches', 'post', 'ra2', Object.assign({}, SEARCH, { name: 'Rob two' }));
const robs = (await call('/finder/searches', 'get', 'ra2')).out.searches;
r = await call('/finder/run', 'post', 'ra2');
const robCards = st.tables.finder_cards.filter((c) => c.user_id === 'ra2');
step('a person with 2 cards a day gets exactly 2 — the two best — from the same page', r.code === 200 && robCards.length === 2 && robCards.every((c) => c.company_name !== 'Gulf Coast Property Group'), robCards.map((c) => c.company_name).join());
NOW = new Date(NOW.getTime() + 2 * 60000);
const callsBefore = apollo.calls.length;
r = await call('/finder/run', 'post', 'ra2');
step('once they have their 2 for today, a later run does not even ask Apollo', apollo.calls.length === callsBefore && /already have your 2 cards for today/.test(r.out.results[0].note), r.out.results[0] && r.out.results[0].note);

// credits and errors
NOW = new Date('2026-10-08T12:00:00Z');
await resetCredits(st, 0);
const c0 = apollo.calls.length;
r = await call('/finder/run', 'post', 'ra1');
step('with the organisation\'s daily credit limit at 0, no Apollo call is made and the person is told why', apollo.calls.length === c0 && /credit limit/.test(r.out.results[0].note), r.out.results[0].note);
await resetCredits(st, 300);
apollo.error = 'This Apollo plan or key does not allow company search — it needs a plan with API access and a master API key.';
st.tables.finder_searches.forEach((s) => { s.last_run_at = null; });
r = await call('/finder/run', 'post', 'ra1');
step('when Apollo refuses, the person sees Apollo\'s reason in words, no card is made, and no credit is counted', /does not allow company search/.test(r.out.results[0].note) && st.tables.finder_cards.filter((c) => c.user_id === 'ra1' && c.created_on === '2026-10-08').length === 0 && !st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-08'));
step('…and the failure is kept where an admin can read it (apollo_last_error)', /finder_company_search/.test((st.tables.app_settings.find((x) => x.key === 'apollo_last_error') || {}).value || ''));
apollo.error = null;
st.tables.finder_searches.forEach((s) => { s.last_run_at = null; });
r = await call('/finder/run', 'post', 'ra1');
step('a company already shown to this person (accepted, waiting, rejected or still new) is never made a card again', r.out.new_cards === 0 && /3 you have already seen/.test(r.out.results[0].note), r.out.results[0].note);

// ═════ 4. the cards ═════════════════════════════════════════════════════════════════════════════════════
console.log('\nToday\'s cards');
NOW = new Date('2026-10-07T13:00:00Z');
r = await call('/finder/cards', 'get', 'ra1');
step('Rhea\'s cards, best first, each with the add-rule answer', r.out.cards.length === 3 && r.out.cards[0].company_name === 'Brazos Valley Machining' && r.out.cards.every((c) => c.decision && c.decision.blocked === false), r.out.cards.map((c) => c.company_name).join());
step('a card shows what Apollo said (website, phone, place) and the reasons it ranked, as plain chips', r.out.cards[0].phone === '+1 254-555-0188' && r.out.cards[0].city === 'Waco' && r.out.cards[0].chips.some((c) => /Headcount \+12% in a year/.test(c)));
step('Rob\'s cards are not in Rhea\'s list, and Rhea\'s are not in Rob\'s', (await call('/finder/cards', 'get', 'ra2')).out.cards.every((c) => st.tables.finder_cards.find((x) => x.id === c.id).user_id === 'ra2'));
step('each card says which of the person\'s searches found it (so the page can show them apart)', r.out.cards.every((c) => c.search_id === s1.id));
const brazos = r.out.cards[0].id, lone = r.out.cards[1].id, gulf = r.out.cards[2].id;
r = await call('/finder/cards/:id/reject', 'post', 'ra2', {}, { id: brazos });
step('Rob cannot reject Rhea\'s card (404)', r.code === 404);
r = await call('/finder/cards/:id/reject', 'post', 'ra1', {}, { id: lone });
const rej = st.tables.finder_cards.find((c) => c.id === lone);
step('Reject: the card is turned down and its data is cleared — only a small mark stays', r.code === 200 && rej.status === 'rejected' && rej.payload === null && rej.postings === null && rej.company_name === 'Lone Star Dental Partners');
r = await call('/finder/cards/:id/wait', 'post', 'ra1', {}, { id: gulf });
step('Wait: the card goes away for the admin\'s number of days (14), returning on its date', r.code === 200 && r.out.wait_until === '2026-10-21' && st.tables.finder_cards.find((c) => c.id === gulf).status === 'waiting');
r = await call('/finder/cards', 'get', 'ra1');
step('…neither shows in today\'s cards, and the list says one is waiting', r.out.cards.length === 1 && r.out.waiting === 1);
await settings.setSettings(st.supabase, { finder_wait_days: 3 });
r = await call('/finder/cards/:id/wait', 'post', 'ra1', {}, { id: brazos });
step('the wait time is the ADMIN\'s setting (3 days now)', r.out.wait_until === '2026-10-10');
await settings.setSettings(st.supabase, { finder_wait_days: 14 });
NOW = new Date('2026-10-10T09:00:00Z');
r = await call('/finder/cards', 'get', 'ra1');
step('on the day it is due, a waiting company comes back as a new card (and the other, due on the 21st, does not)', r.out.cards.length === 1 && r.out.cards[0].company_name === 'Brazos Valley Machining' && r.out.waiting === 1);
NOW = new Date('2026-10-07T13:00:00Z');

// ═════ 5. postings, people, reveal — credits ══════════════════════════════════════════════════════════════
console.log('\nPostings, people, emails');
st.tables.finder_cards.find((c) => c.id === brazos).status = 'new'; st.tables.finder_cards.find((c) => c.id === brazos).wait_until = null;
apollo.postings = [
  { id: 'p1', title: 'CNC Machinist', url: 'https://www.linkedin.com/jobs/view/1', city: 'Waco', state: 'Texas', country: 'United States', posted_at: daysAgo(41) },
  { id: 'p2', title: 'CNC Machinist', url: 'https://careers.brazosmachining.example/2', city: 'Waco', state: 'Texas', posted_at: daysAgo(3) },
  { id: 'p3', title: 'Welder', url: 'https://www.indeed.com/viewjob?jk=3', city: 'Waco', state: 'Texas', posted_at: daysAgo(9) },
];
const usedBefore = Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-07').value);
r = await call('/finder/cards/:id/postings', 'post', 'ra1', {}, { id: brazos });
step('opening a card\'s postings costs ONE credit and shows title, where, when and which board each came from, newest first', r.code === 200 && r.out.postings.length === 3 && r.out.postings[0].age_days === 3 && r.out.postings.find((p) => p.title === 'Welder').source === 'Indeed' && r.out.postings.find((p) => p.age_days === 41).source === 'LinkedIn' && Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-07').value) === usedBefore + 1);
step('…and says what they mean: 3 open roles, one open 41 days, the same role posted twice', r.out.signals.open_roles === 3 && r.out.signals.oldest_days === 41 && r.out.signals.repeated[0].title === 'CNC Machinist' && r.out.signals.chips.includes('Oldest open 41 days'));
const pc = apollo.calls.length;
r = await call('/finder/cards/:id/postings', 'post', 'ra1', {}, { id: brazos });
step('asking again is free: the postings are on the card (no second call, no second credit)', r.out.cached === true && apollo.calls.length === pc);
step('the card now lists them with its chips for the review screen', (await call('/finder/cards', 'get', 'ra1')).out.cards[0].postings.length === 3);
r = await call('/finder/cards/:id/people', 'post', 'ra1', { title: 'HR manager, Controller' }, { id: brazos });
apollo.people = [{ id: 'per1', first_name: 'Dana', last_name: '', last_name_masked: true, title: 'HR Manager', has_email: true }, { id: 'per2', first_name: 'Marco', last_name: 'Esteves', title: 'Controller', has_email: true }];
r = await call('/finder/cards/:id/people', 'post', 'ra1', { title: 'HR manager, Controller' }, { id: brazos });
const pplCall = apollo.calls.filter((c) => c[0] === 'people').pop();
step('finding people by the typed titles is FREE (no credit) and uses the company\'s website', r.out.people.length === 2 && pplCall[1].titles.join() === 'HR manager,Controller' && pplCall[1].domain === 'brazosmachining.example' && Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-07').value) === usedBefore + 1);
r = await call('/finder/cards/:id/reveal', 'post', 'ra1', {}, { id: brazos });
step('revealing needs to know whose email', r.code === 400);
r = await call('/finder/cards/:id/reveal', 'post', 'ra1', { person_id: 'per1' }, { id: brazos });
step('revealing one person: a VERIFIED email is kept, and one credit is counted on the organisation AND on the person', r.code === 200 && r.out.person.email === 'dana@brazosmachining.example' && Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_2026-10-07').value) === usedBefore + 2 && Number(st.tables.app_settings.find((x) => x.key === 'finder_reveals_ra1_2026-10-07').value) === 1);
const rc = apollo.calls.length;
r = await call('/finder/cards/:id/reveal', 'post', 'ra1', { person_id: 'per1' }, { id: brazos });
step('revealing the same person again is free (kept on the card)', r.out.cached === true && apollo.calls.length === rc);
apollo.reveal = { ok: true, first_name: 'Marco', last_name: 'Esteves', title: 'Controller', email: 'marco.guess@brazosmachining.example', email_verified: false };
r = await call('/finder/cards/:id/reveal', 'post', 'ra1', { person_id: 'per2' }, { id: brazos });
step('an UNVERIFIED address is never kept (D-0049: a guess is never emailed) — the person is named, with no email, and told so', r.out.person.email === null && /no verified email/.test(r.out.note) && st.tables.finder_cards.find((c) => c.id === brazos).payload.people.per2.email === null);
await settings.setSettings(st.supabase, { finder_reveals_per_day: 2 });
const rc2 = apollo.calls.length;
r = await call('/finder/cards/:id/reveal', 'post', 'ra1', { person_id: 'per3' }, { id: brazos });
step('a person\'s daily reveal limit stops the next one BEFORE Apollo is asked (429)', r.code === 429 && /revealed your 2 emails/.test(r.out.error) && apollo.calls.length === rc2);
await settings.setSettings(st.supabase, { finder_reveals_per_day: 30 });
r = await call('/finder/cards/:id/reveal', 'post', 'ra2', { person_id: 'per1' }, { id: brazos });
step('another person cannot reveal on Rhea\'s card (404)', r.code === 404);

// ═════ 6. Accept ═════════════════════════════════════════════════════════════════════════════════════════
console.log('\nAccept');
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { contacts: [{ person_id: 'per1' }] }, { id: brazos });
step('Accept needs the job the lead is for', r.code === 400 && /job/.test(r.out.error));
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'CNC Machinist', contacts: [] }, { id: brazos });
step('…and at least one contact with an email', r.code === 400 && /at least one contact/.test(r.out.error));
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'CNC Machinist', contacts: [{ person_id: 'per2' }] }, { id: brazos });
step('…a person whose email could not be verified cannot be picked as a contact', r.code === 400 && /Reveal that person/.test(r.out.error));
step('none of those refusals wrote anything: no lead, no company, the card is still new', st.tables.jobs.length === 1 && st.tables.companies.length === 2 && st.tables.finder_cards.find((c) => c.id === brazos).status === 'new');
// a colleague takes the company meanwhile
st.tables.companies.push({ id: 'cX', org_id: 'o1', name: 'Brazos Valley Machining', website: 'http://brazosmachining.example', linkedin_url: null, deleted_at: null });
st.tables.jobs.push({ id: 'jX', org_id: 'o1', company_id: 'cX', position: 'Welder', stage: 'Connected', created_at: daysAgo(2), created_by: 'adm', assigned_to_bd: 'bd1', deleted_at: null });
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'CNC Machinist', contacts: [{ person_id: 'per1' }] }, { id: brazos });
step('if a colleague took the company since the card appeared, Accept is refused with who has it — and the card stays', r.code === 409 && /Bea BD/.test(r.out.error) && st.tables.finder_cards.find((c) => c.id === brazos).status === 'new', r.out && r.out.error);
r = await call('/finder/cards', 'get', 'ra1');
step('…and the card list now shows that card as blocked, before anyone presses Accept', r.out.cards.find((c) => c.id === brazos).decision.blocked === true);
st.tables.jobs = st.tables.jobs.filter((j) => j.id !== 'jX'); st.tables.companies = st.tables.companies.filter((c) => c.id !== 'cX');

r = await call('/finder/cards/:id/accept', 'post', 'ra1', { positions: ['CNC Machinist', 'Welder', 'cnc machinist', '  '], contacts: [{ person_id: 'per1' }, { first_name: 'Sam', last_name: 'Lee', designation: 'Owner', email: 'sam@brazosmachining.example' }] }, { id: brazos });
const lead = st.tables.jobs.find((j) => j.id === r.out.lead_id);
step('an RA\'s accepted lead is created and goes to the unassigned POOL (201)', r.code === 201 && r.out.goes_to === 'pool' && lead && lead.stage === 'Unassigned' && !lead.assigned_to_bd, JSON.stringify(r.out));
step('several jobs: the first is the lead\'s main job, a repeat or blank is dropped, the rest are kept as "also hiring" (and in the email facts) — no second lead, no second credit', lead.position === 'CNC Machinist' && lead.research.finder.also_hiring.join() === 'Welder' && lead.research.finder.facts.some((f) => /also hiring for Welder/.test(f)) && /also hiring for Welder/.test(lead.notes) && st.tables.jobs.filter((j) => j.company_id === lead.company_id).length === 1);
const co = st.tables.companies.find((c) => c.id === r.out.company_id);
step('the company is created with what Apollo said: website, LinkedIn page, Apollo id', co && co.website === 'http://www.brazosmachining.example' && co.linkedin_url === 'https://www.linkedin.com/company/brazos' && co.apollo_org_id === A && co.org_id === 'o1');
step('the lead carries the job, the posting\'s link and place, the source, and the creator', lead.position === 'CNC Machinist' && lead.job_url === 'https://careers.brazosmachining.example/2'.replace('careers.brazosmachining.example/2', 'careers.brazosmachining.example/2') && /Finder/.test(lead.source) && lead.location === 'Waco, Texas' && lead.created_by === 'ra1');
step('…and the FACTS for the email, never invented duties: only the title is the "posting text"; the facts are real (open roles, oldest, repeated)', lead.research.jd_raw === 'Title: CNC Machinist' && lead.research.finder.facts.some((f) => /3 open roles, the oldest posted 41 days ago/.test(f)) && lead.research.finder.facts.some((f) => /posted 2 times/.test(f)) && lead.research.source.kind === 'finder');
const cts = st.tables.contacts.filter((c) => c.job_id === lead.id);
step('both contacts are saved on the lead, the first is primary, and the revealed one carries the verified address', cts.length === 2 && cts[0].is_primary && !cts[1].is_primary && cts[0].email === 'dana@brazosmachining.example' && cts[0].last_name === '' || cts[0].first_name === 'Dana');
const acc = st.tables.finder_cards.find((c) => c.id === brazos);
step('the card is marked accepted with the lead it became (and its postings are dropped — they are on the lead now)', acc.status === 'accepted' && acc.lead_id === lead.id && acc.postings === null);
step('the lead is logged as found by the finder', st.tables.jobs.length === 2 && (await call('/finder/cards', 'get', 'ra1')).out.cards.every((c) => c.id !== brazos));
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'CNC Machinist', contacts: [{ person_id: 'per1' }] }, { id: brazos });
step('pressing Accept twice makes ONE lead (the second is refused)', r.code === 404 && st.tables.jobs.length === 2);
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'X', contacts: [{ first_name: 'A', email: 'a@b.example' }, { first_name: 'B', email: 'b@b.example' }, { first_name: 'C', email: 'c@b.example' }, { first_name: 'D', email: 'd@b.example' }] }, { id: gulf });
step('(a card put on Wait cannot be accepted until it is back)', r.code === 404);

// a BD manager's lead comes straight to them
await call('/finder/searches', 'post', 'bd1', SEARCH);
NOW = new Date('2026-10-11T12:00:00Z');
st.tables.finder_searches.forEach((s) => { s.last_run_at = null; });
apollo.orgs = [RAW.b];
r = await call('/finder/run', 'post', 'bd1');
const bdCard = st.tables.finder_cards.find((c) => c.user_id === 'bd1');
step('a BD manager gets cards the same way', !!bdCard && bdCard.company_name === 'Lone Star Dental Partners');
const four = [{ first_name: 'A', email: 'a@lonestardental.example' }, { first_name: 'B', email: 'b@lonestardental.example' }, { first_name: 'C', email: 'c@lonestardental.example' }, { first_name: 'D', email: 'd@lonestardental.example' }];
st.tables.user_emails[0].is_active = false;
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { position: 'Dental Hygienist', contacts: four }, { id: bdCard.id });
step('a BD with no connected mailbox cannot save (a lead they cannot email is not created) — and nothing is written', r.code === 400 && st.tables.finder_cards.find((c) => c.id === bdCard.id).status === 'new' && st.tables.jobs.length === 2, r.out && r.out.error);
st.tables.user_emails[0].is_active = true;
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { position: 'Dental Hygienist', contacts: four }, { id: bdCard.id });
const bdLead = st.tables.jobs.find((j) => j.id === (r.out && r.out.lead_id));
step('D-0110: a BD\'s saved lead starts UNASSIGNED — no owner, no mailbox yet (it becomes theirs when its first email is written, or when it is assigned)', r.code === 201 && r.out.goes_to === 'you' && bdLead && !bdLead.assigned_to_bd && bdLead.stage === 'Unassigned' && !bdLead.sending_email_id, JSON.stringify(r.out));
step('…and only 3 contacts are kept even if 4 are sent', r.out.contacts === 3 && st.tables.contacts.filter((c) => c.job_id === bdLead.id).length === 3);

// ── D (8 Oct, owner: "the email never went out"): a saved lead's card says what happened to its first email ──
st.tables.emails = [{ id: 'e1', job_id: bdLead.id, status: 'pending', from_email: 'bd@x.test', sent_by: 'bd1', followup_type: null }];
st.tables.finder_cards.find((c) => c.id === bdCard.id).payload.people = { pX: { first_name: 'Pat', last_name: 'Quill', title: 'CFO', email: 'pat@lonestardental.example' }, pY: { first_name: 'No', last_name: 'Email', title: 'COO' } };
r = await call('/finder/history', 'get', 'bd1');
let hl = r.out.items.find((x) => x.id === bdCard.id);
step('D: a lead whose first email is written but not sent says so — 1 waiting, none sent, from which email ID', hl && hl.lead && hl.lead.email.pending === 1 && hl.lead.email.sent === 0 && hl.lead.email.from === 'bd@x.test', JSON.stringify(hl && hl.lead && hl.lead.email));
step('D: …and says the lead is still nobody\'s (Unassigned) until that email is written for real', hl.lead.unowned === true);
st.tables.emails[0].status = 'sent'; st.tables.emails[0].sent_at = '2026-10-11T15:00:00Z';
r = await call('/finder/history', 'get', 'bd1'); hl = r.out.items.find((x) => x.id === bdCard.id);
step('D: once it is sent, the card says sent, when, and from where', hl.lead.email.sent === 1 && hl.lead.email.pending === 0 && hl.lead.email.last_sent_at === '2026-10-11T15:00:00Z' && hl.lead.email.from === 'bd@x.test');
st.tables.emails.push({ id: 'e2', job_id: bdLead.id, status: 'sent', from_email: 'x', sent_by: 'someone-else', followup_type: null }, { id: 'e3', job_id: bdLead.id, status: 'sent', from_email: 'x', sent_by: 'bd1', followup_type: 'followup1' });
r = await call('/finder/history', 'get', 'bd1'); hl = r.out.items.find((x) => x.id === bdCard.id);
step('D: another person\'s emails and follow-ups are NOT counted as my first email', hl.lead.email.sent === 1);
step('D: people found on the card with a revealed address, not yet contacts, are offered for "another person" (one without an address is not)', hl.lead.more_people.length === 1 && hl.lead.more_people[0].person_id === 'pX');

// ── E: email another job / another person from a saved lead's card ──
const jobsN = st.tables.jobs.length;
r = await call('/finder/cards/:id/another', 'post', 'bd1', { positions: ['Dental Hygienist'], contacts: [{ person_id: 'pX' }] }, { id: bdCard.id });
step('E: the SAME job at the same company is refused — it would write to them twice about the same thing', r.code === 409 && st.tables.jobs.length === jobsN, r.out && r.out.error);
r = await call('/finder/cards/:id/another', 'post', 'bd1', { positions: ['Dental Assistant'], contacts: [{ person_id: 'pY' }] }, { id: bdCard.id });
step('E: a person whose address was never revealed cannot be written to', r.code === 400 && /Reveal/.test(r.out.error) && st.tables.jobs.length === jobsN);
r = await call('/finder/cards/:id/another', 'post', 'bd1', { positions: ['Dental Assistant', 'Office Manager'], contacts: [{ person_id: 'pX' }, { contact_id: st.tables.contacts.find((c) => c.job_id === bdLead.id).id }] }, { id: bdCard.id });
const second = st.tables.jobs.find((j) => j.id === (r.out && r.out.lead_id));
step('E: another job at the same company becomes a SECOND lead — same company, new job, Unassigned, nobody\'s mailbox yet', r.code === 201 && second && second.company_id === bdLead.company_id && second.position === 'Dental Assistant' && second.stage === 'Unassigned' && !second.assigned_to_bd && !second.sending_email_id, JSON.stringify(r.out));
step('E: …with the other job kept as "also hiring" and the people picked (a new one and one from the first lead)', second.research.finder.also_hiring.join() === 'Office Manager' && st.tables.contacts.filter((c) => c.job_id === second.id).length === 2 && st.tables.contacts.filter((c) => c.job_id === second.id)[0].email === 'pat@lonestardental.example');
step('E: …and the first lead is untouched', st.tables.jobs.find((j) => j.id === bdLead.id).stage === 'Unassigned' && st.tables.contacts.filter((c) => c.job_id === bdLead.id).length === 3);
r = await call('/finder/cards/:id/another', 'post', 'ra1', { positions: ['Anything'], contacts: [{ first_name: 'A', email: 'a@b.example' }] }, { id: bdCard.id });
step('E: somebody else\'s card does not exist for you (404)', r.code === 404);
r = await call('/finder/cards/:id/another', 'post', 'bd1', { positions: ['Estimator'], contacts: [] }, { id: bdCard.id });
step('E: with nobody to write to it is refused', r.code === 400 && /at least one person/.test(r.out.error));

// ═════ 7. the nightly sweep and tidy-up ═══════════════════════════════════════════════════════════════════
console.log('\nThe nightly run');
({ st, apollo, router, call } = boot());
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 5 }, { id: 'ra1' });
await call('/finder/searches', 'post', 'ra1', SEARCH);
await call('/finder/searches', 'post', 'ra9', SEARCH).catch(() => {});
st.tables.finder_searches.push({ id: 'sO2', org_id: 'o2', user_id: 'ra9', name: 'Other org', titles: ['Welder'], locations: ['Texas'], sizes: [], posted_days: 14, keywords: [], domains: [], active: true, deleted_at: null, last_run_at: null });
await resetCredits(st, 300);
let sum = await router.runDue();
const ra9 = await (async () => st.tables.finder_cards.filter((c) => c.user_id === 'ra9'))();
step('the nightly sweep runs the active searches of people who are switched on (here: Rhea\'s only — the other organisation\'s person was never switched on)', sum.searches === 1 && st.tables.finder_cards.filter((c) => c.user_id === 'ra1').length === 3 && ra9.length === 0, JSON.stringify(sum));
const nc = apollo.calls.length;
sum = await router.runDue();
step('…and runs each search at most once a day (a second sweep the same day asks Apollo nothing)', sum.searches === 0 && apollo.calls.length === nc);
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: false }, { id: 'ra1' });
NOW = new Date('2026-10-09T03:00:00Z');
sum = await router.runDue();
step('a person switched OFF is skipped by the sweep', sum.searches === 0);
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 5 }, { id: 'ra1' });
st.tables.finder_cards.forEach((c) => { c.created_at = daysAgo(9); });
NOW = new Date('2026-10-09T03:00:00Z');
st.tables.finder_cards.forEach((c) => { c.created_at = new Date(NOW.getTime() - 9 * 86400000).toISOString(); });
await call('/finder/cards', 'get', 'ra1');
step('unreviewed cards disappear after the admin\'s number of days (5) — nothing lingers in the database', st.tables.finder_cards.filter((c) => c.status === 'new').length === 0);

// ═════ 7b. what my searches found before ═══════════════════════════════════════════════════════════════
console.log('\nHistory');
({ st, apollo, router, call } = boot());
await resetCredits(st, 300);
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra1' });
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra2' });
NOW = new Date('2026-10-20T12:00:00Z');
const card = (o) => Object.assign({ id: 'h' + (++uid), org_id: 'o1', user_id: 'ra1', search_id: 'sA', company_key: 'k' + uid, company_name: 'Co ' + uid, status: 'rejected', payload: null, score: 1, created_on: '2026-10-01', created_at: daysAgo(15), decided_at: daysAgo(10), wait_until: null, lead_id: null }, o);
st.tables.jobs.push({ id: 'jL', org_id: 'o1', company_id: 'c1', position: 'Welder', stage: 'Assigned', created_by: 'ra1', assigned_to_bd: null, deleted_at: null, research: { finder: { also_hiring: ['Estimator'], postings: [{ title: 'Welder', url: 'https://jobs.example/1', source: 'Indeed' }, { title: 'Pipefitter', url: '', source: '' }] } } });
st.tables.contacts.push({ id: 'k1', org_id: 'o1', job_id: 'jL', first_name: 'Dana', last_name: 'Cole', designation: 'HR Manager', email: 'dana@saved.example', is_primary: true }, { id: 'k2', org_id: 'o1', job_id: 'jL', first_name: 'Eli', last_name: 'Ross', designation: 'Plant Manager', email: 'eli@saved.example', is_primary: false }, { id: 'k9', org_id: 'o1', job_id: 'jM', first_name: 'Secret', last_name: 'Person', designation: 'CEO', email: 'secret@moved.example', is_primary: true });
st.tables.jobs.push({ id: 'jM', org_id: 'o1', company_id: 'c1', position: 'Estimator', stage: 'Assigned', created_by: 'adm', assigned_to_bd: 'bd1', deleted_at: null });
st.tables.finder_cards.push(
  card({ id: 'hAcc', company_name: 'Saved Co', status: 'accepted', lead_id: 'jL', payload: { company: { city: 'Waco', state: 'TX' } } }),
  card({ id: 'hMoved', company_name: 'Handed Away Co', status: 'accepted', lead_id: 'jM' }),
  card({ id: 'hGone', company_name: 'Deleted Lead Co', status: 'accepted', lead_id: 'jNONE' }),
  card({ id: 'hWait', company_name: 'Parked Co', status: 'waiting', wait_until: '2026-10-30', decided_at: daysAgo(2) }),
  card({ id: 'hRej', company_name: 'Turned Down Co' }),
  card({ id: 'hOld', company_name: 'Ancient Co', decided_at: daysAgo(200), created_at: daysAgo(210) }),
  card({ id: 'hNew', company_name: 'Undecided Co', status: 'new' }),
  card({ id: 'hRob', user_id: 'ra2', company_name: 'Robs Co', status: 'accepted', lead_id: 'jL' }));
r = await call('/finder/history', 'get', 'ra1');
const hn = r.out.items.map((x) => x.company_name);
step('the history lists what was saved, parked and turned down — never an undecided card', r.code === 200 && ['Saved Co', 'Parked Co', 'Turned Down Co'].every((n) => hn.includes(n)) && !hn.includes('Undecided Co'), hn.join());
step('…counted by what became of each', r.out.counts.accepted === 3 && r.out.counts.waiting === 1 && r.out.counts.rejected === 1, JSON.stringify(r.out.counts));
const savedItem = r.out.items.find((x) => x.company_name === 'Saved Co');
step('a saved company shows the lead it became (job and stage) and its place', savedItem.lead.id === 'jL' && savedItem.lead.position === 'Welder' && savedItem.lead.stage === 'Assigned' && savedItem.place === 'Waco, TX');
step('a saved company shows the POCs on the lead (primary first, with title and email) and the jobs: the main one, the "also hiring" ones, and what Apollo listed — each job once', savedItem.lead.contacts.map((c) => c.name).join() === 'Dana Cole,Eli Ross' && savedItem.lead.contacts[0].email === 'dana@saved.example' && savedItem.lead.jobs.map((j) => j.title).join() === 'Welder,Estimator,Pipefitter' && savedItem.lead.jobs[0].main === true && savedItem.lead.jobs[1].also === true && savedItem.lead.jobs[0].url === undefined, JSON.stringify(savedItem.lead.jobs));
const movedItem = r.out.items.find((x) => x.company_name === 'Handed Away Co');
step('…and the people of a lead that was handed away are not in the answer at all', !JSON.stringify(r.out).includes('secret@moved.example'));
step('a lead that is no longer the person\'s (made by someone else, held by another) is NOT described to them', movedItem.lead === null && movedItem.lead_elsewhere === true);
step('a lead that was deleted says so', r.out.items.find((x) => x.company_name === 'Deleted Lead Co').lead_gone === true);
step('only 90 days are shown by default, and it says how many are hidden', !hn.includes('Ancient Co') && r.out.hidden === 1 && r.out.days === 90);
r = await call('/finder/history', 'get', 'ra1', {}, {}, { all: '1' });
step('"all" reaches the older ones too', r.out.items.some((x) => x.company_name === 'Ancient Co') && r.out.hidden === 0);
r = await call('/finder/history', 'get', 'ra2');
step('Rob sees only his own history (Rhea\'s companies and her lead are not in it)', r.out.items.length === 1 && r.out.items[0].company_name === 'Robs Co' && r.out.items[0].lead === null);
r = await call('/finder/cards/:id/unwait', 'post', 'ra2', {}, { id: 'hWait' });
step('Rob cannot bring back Rhea\'s parked company (404)', r.code === 404 && st.tables.finder_cards.find((c) => c.id === 'hWait').status === 'waiting');
r = await call('/finder/cards/:id/unwait', 'post', 'ra1', {}, { id: 'hRej' });
step('a turned-down company cannot be brought back (it is gone for good)', r.code === 404 && st.tables.finder_cards.find((c) => c.id === 'hRej').status === 'rejected');
r = await call('/finder/cards/:id/unwait', 'post', 'ra1', {}, { id: 'hWait' });
const back = st.tables.finder_cards.find((c) => c.id === 'hWait');
step('Show now brings a parked company back to today\'s cards at once', r.code === 200 && back.status === 'new' && back.wait_until === null && back.created_on === '2026-10-20');
r = await call('/finder/history', 'get', 'rec1');
step('a person who is not switched on gets no history (403)', r.code === 403);

// ═════ 7d. a one-off search ("Find leads now") ═══════════════════════════════════════════════════════════
console.log('\nFind leads now');
({ st, apollo, router, call } = boot());
await resetCredits(st, 300);
NOW = new Date('2026-10-21T12:00:00Z');
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 3 }, { id: 'ra1' });
r = await call('/finder/find', 'post', 'ra2', { titles: ['Welder'], locations: ['Texas'] });
step('a person who is not switched on cannot run one (403)', r.code === 403);
r = await call('/finder/find', 'post', 'ra1', { titles: [], locations: ['Texas'] });
step('a one-off search with no job title is refused in words, before anything is spent', r.code === 400 && /job title/i.test(r.out.error) && apollo.calls.length === 0);
r = await call('/finder/find', 'post', 'ra1', { titles: ['CNC Machinist', 'Welder'], locations: ['Texas'], sizes: ['mid'], posted_days: 14 });
const oneCards = st.tables.finder_cards.filter((c) => c.user_id === 'ra1');
step('Find leads now makes cards at once: the three clients (staffing firm and the company already worked are left out)', r.code === 200 && r.out.new_cards === 3 && oneCards.length === 3 && !oneCards.some((c) => /Staffing|Acme/.test(c.company_name)), r.out.results[0].note);
step('…nothing is saved or scheduled: no saved search row exists', st.tables.finder_searches.length === 0 && oneCards.every((c) => c.search_id === null));
step('…it asked Apollo once with the typed criteria, and cost one credit', apollo.calls.filter((c) => c[0] === 'orgs').length === 1 && apollo.calls[0][1].filters.q_organization_job_titles.join() === 'CNC Machinist,Welder' && Number(st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_' + finder.dayOf(NOW)).value) === 1);
step('…and the cards say what they were found for', oneCards.every((c) => c.payload.search.titles.join() === 'CNC Machinist,Welder'));
r = await call('/finder/find', 'post', 'ra1', { titles: ['Welder'], locations: ['Texas'] });
step('pressing Find again straight away does NOT call Apollo again (a double-click costs one credit)', r.out.results[0].skipped === true && apollo.calls.filter((c) => c[0] === 'orgs').length === 1);
r = await call('/finder/cards', 'get', 'ra1');
step('one-off cards are in Today\'s cards but are NOT counted in the daily number ("0 of your 3 cards for today")', r.out.cards.length === 3 && r.out.today === 0 && r.out.daily === 3, 'today=' + r.out.today);
// the daily run still gets its full number
const F2 = (id, name) => ({ id: id.repeat(24), name, primary_domain: name.toLowerCase().replace(/ /g, '') + '.example', organization_headcount_twelve_month_growth: 0.1 });
apollo.orgs = [F2('f', 'Fox Foundry'), F2('g', 'Gray Gears'), F2('h', 'Hale Hydraulics'), F2('i', 'Ivy Iron')];
await call('/finder/searches', 'post', 'ra1', SEARCH);
r = await call('/finder/run', 'post', 'ra1');
step('the DAILY run still brings its full number (3) — the one-off cards did not use it up', r.code === 200 && r.out.new_cards === 3 && st.tables.finder_cards.filter((c) => c.user_id === 'ra1' && c.search_id).length === 3, r.out.results[0].note);
// the per-run ceiling
NOW = new Date('2026-10-21T12:10:00Z');
await settings.setSettings(st.supabase, { finder_cards_per_run: 2 });
apollo.orgs = [F2('j', 'Jet Joinery'), F2('k', 'Kite Kilns'), F2('l', 'Lark Lumber')];
r = await call('/finder/find', 'post', 'ra1', { titles: ['Welder'], locations: ['Texas'] });
step('a one-off search is held to its own ceiling per press (2 here), whatever the daily number is', r.out.new_cards === 2, r.out.results[0].note);
await settings.setSettings(st.supabase, { finder_cards_per_run: 0 });
NOW = new Date('2026-10-21T12:20:00Z');
r = await call('/finder/find', 'post', 'ra1', { titles: ['Welder'], locations: ['Texas'] });
step('with the ceiling at 0 the one-off search is off, and says why — without calling Apollo', r.out.new_cards === 0 && /switched off/.test(r.out.results[0].note) && apollo.calls.filter((c) => c[0] === 'orgs').length === 3);

// ═════ 7c. which mailbox a lead sends from ══════════════════════════════════════════════════════════════
console.log('\nThe mailbox');
({ st, apollo, router, call } = boot());
await resetCredits(st, 300);
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'bd1' });
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra1' });
st.tables.user_emails.push(
  { id: 'm2', org_id: 'o1', user_id: 'bd1', email_address: 'bea.two@x.test', display_name: 'Bea Two', is_active: true, daily_send_limit: 50 },
  { id: 'm3', org_id: 'o1', user_id: 'bd1', email_address: 'bea.off@x.test', is_active: true, daily_send_limit: 150 },
  { id: 'mAdm', org_id: 'o1', user_id: 'adm', email_address: 'ada@x.test', is_active: true, daily_send_limit: 150 });
st.tables.microsoft_tokens.push({ user_email_id: 'm2', refresh_failed: false }, { user_email_id: 'mAdm', refresh_failed: false }, { user_email_id: 'm3', refresh_failed: true });
st.tables.email_send_log.push({ user_email_id: 'm1', send_date: finder.dayOf(NOW), emails_sent: 40 }, { user_email_id: 'm2', send_date: finder.dayOf(NOW), emails_sent: 3 });
const mbxCard = (id, key) => st.tables.finder_cards.push({ id, org_id: 'o1', user_id: 'bd1', search_id: null, company_key: key, company_name: 'Mbx ' + key, status: 'new', score: 1, created_on: '2026-10-07', created_at: NOW.toISOString(), postings: null, wait_until: null, lead_id: null, decided_at: null, payload: { company: { domain: key + '.example', website: 'http://' + key + '.example' }, people: {} } });
['mc1', 'mc2', 'mc3', 'mc4'].forEach((id, i) => mbxCard(id, 'mbx' + (i + 1)));
r = await call('/finder/mailboxes', 'get', 'bd1');
step('a BD sees their own CONNECTED mailboxes (not the one whose sign-in failed, not an admin\'s), with what each has sent today', r.code === 200 && r.out.mailboxes.map((m) => m.id).sort().join() === 'm1,m2' && r.out.mailboxes.find((m) => m.id === 'm1').sent_today === 40 && r.out.mailboxes.find((m) => m.id === 'm2').sent_today === 3, JSON.stringify(r.out.mailboxes.map((m) => [m.id, m.sent_today])));
step('…and the one to pre-select is the one that has sent the FEWEST today (m2, though m1 is first and has the bigger limit)', r.out.suggested_id === 'm2');
r = await call('/finder/mailboxes', 'get', 'ra1');
step('a person whose leads go to the pool has no mailbox to choose (nothing to show)', r.out.goes_to === 'pool' && r.out.mailboxes.length === 0);
const jobsBefore = st.tables.jobs.length;
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { positions: ['Welder'], contacts: [{ first_name: 'Sam', email: 'sam@mbx1.example' }], mailbox_id: 'mAdm' }, { id: 'mc1' });
step('a mailbox that belongs to someone else is refused in words — and nothing is saved', r.code === 400 && /not one of yours/.test(r.out.error) && st.tables.jobs.length === jobsBefore && st.tables.finder_cards.find((c) => c.id === 'mc1').status === 'new', JSON.stringify(r.out));
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { positions: ['Welder'], contacts: [{ first_name: 'Sam', email: 'sam@mbx1.example' }], mailbox_id: 'm3' }, { id: 'mc1' });
step('…and so is one of their own whose sign-in is broken', r.code === 400 && st.tables.jobs.length === jobsBefore);
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { positions: ['Welder'], contacts: [{ first_name: 'Sam', email: 'sam@mbx1.example' }], mailbox_id: 'm1' }, { id: 'mc1' });
step('a chosen mailbox is checked (a bad one was refused above) but the lead stays Unassigned until the first email claims it', r.code === 201 && st.tables.jobs.find((j) => j.id === r.out.lead_id).stage === 'Unassigned' && !st.tables.jobs.find((j) => j.id === r.out.lead_id).sending_email_id, JSON.stringify(r.out));
r = await call('/finder/cards/:id/accept', 'post', 'bd1', { positions: ['Welder'], contacts: [{ first_name: 'Sam', email: 'sam@mbx2.example' }] }, { id: 'mc2' });
step('with no choice made the lead is simply saved Unassigned (the mailbox spread happens when the first email is written)', r.code === 201 && st.tables.jobs.find((j) => j.id === r.out.lead_id).stage === 'Unassigned');
step('…and nobody owns it yet', !st.tables.jobs.find((j) => j.id === r.out.lead_id).assigned_to_bd);

// ═════ 8. what is wrong with the key, in words ═════════════════════════════════════════════════════════════
console.log('\nThe form\'s choices and the company lookup');
({ st, apollo, router, call } = boot());
await resetCredits(st, 300);
NOW = new Date('2026-10-22T12:00:00Z');
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true }, { id: 'ra1' });
r = await call('/finder/access', 'get', 'ra1');
step('the access answer offers the wide industry list (35+, each with titles) and the slider\'s range 0–30', r.out.sectors.length >= 35 && r.out.sectors.every((x) => x.titles.length >= 9) && r.out.posted.min === 0 && r.out.posted.max === 30 && r.out.posted.def === 14, JSON.stringify(r.out.posted));
r = await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { name: 'Today only', posted_days: 0, sectors: ['manufacturing', 'trades'], companies: [{ name: 'Acme Manufacturing', domain: 'https://www.acmemfg.com/x', city: 'Austin', state: 'Texas' }] }));
step('a search saved at 0 days (today only) is kept as 0 — not 14 — with both industries and the chosen company', r.code === 201 && r.out.posted_days === 0 && r.out.sectors.join() === 'manufacturing,trades' && r.out.sector === 'manufacturing' && r.out.companies[0].name === 'Acme Manufacturing' && r.out.companies[0].city === 'Austin' && r.out.domains.join() === 'acmemfg.com', JSON.stringify(r.out));
const todayId = r.out.id;
r = await call('/finder/searches/:id', 'put', 'ra1', Object.assign({}, SEARCH, { name: 'Three days', posted_days: 3 }), { id: todayId });
step('…and it can be changed to any day in between (3)', r.code === 200 && r.out.posted_days === 3);
r = await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { name: 'Too far', posted_days: 45 }));
step('a number outside 0–30 does not break the save: it becomes the 14-day default', r.code === 201 && r.out.posted_days === 14);
apollo.calls.length = 0; apollo.orgs = []; const credits = () => Number((st.tables.app_settings.find((x) => x.key === 'finder_credits_o1_' + finder.dayOf(NOW)) || { value: 0 }).value);
const credits0 = credits();
const tick = () => { NOW = new Date(NOW.getTime() + 5000); };
r = await call('/finder/companies/suggest', 'post', 'ra2', { q: 'acme' });
step('a person who is not switched on cannot look companies up (403, no Apollo call)', r.code === 403 && apollo.calls.length === 0);
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'a' });
step('one letter is refused in words, before anything is spent', r.code === 400 && /two letters/.test(r.out.error) && apollo.calls.length === 0);
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'https://www.Acme.com/careers' });
step('a pasted website is added without asking Apollo and without a credit', r.code === 200 && r.out.suggestions.length === 1 && r.out.suggestions[0].domain === 'acme.com' && r.out.suggestions[0].website_only === true && r.out.used_credit === false && apollo.calls.length === 0 && credits() === credits0);
const NAMED = [
  { id: 'a'.repeat(24), name: 'Acme Holdings', primary_domain: 'acmeholdings.com', estimated_num_employees: 900 },
  { id: 'b'.repeat(24), name: 'Acme', primary_domain: 'acme.com', organization_city: 'Austin', organization_state: 'Texas', estimated_num_employees: 40 },
  { id: 'c'.repeat(24), name: 'Acme No Site' },
];
apollo.orgs = NAMED;
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: ' acme ' });
const sc = apollo.calls.filter((c) => c[0] === 'orgs');
step('a company NAME is looked up in Apollo by name, one page of ten, and the real matches come back best first with where they are', r.code === 200 && sc.length === 1 && sc[0][1].filters.q_organization_name === 'acme' && sc[0][1].perPage === 10 && r.out.suggestions.map((x) => x.domain).join() === 'acme.com,acmeholdings.com' && r.out.suggestions[0].city === 'Austin', JSON.stringify(r.out.suggestions));
step('…it cost ONE credit, counted in the organisation\'s daily meter, and the answer says so', r.out.used_credit === true && credits() === credits0 + 1 && r.out.credits.used === credits0 + 1);
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'acme' });
step('a second press in the same instant does NOT call Apollo again (a double-click is one credit)', r.out.skipped === true && apollo.calls.filter((c) => c[0] === 'orgs').length === 1 && credits() === credits0 + 1);
tick(); apollo.orgs = [];
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'zzzz nothing' });
step('a name Apollo does not know says so in words and costs nothing', r.code === 200 && r.out.suggestions.length === 0 && /no company with that name/.test(r.out.note) && r.out.used_credit === false && credits() === credits0 + 1);
tick(); apollo.orgs = [NAMED[2]];
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'acme no' });
step('companies found but none with a website say so (and the credit Apollo charged is counted)', r.out.suggestions.length === 0 && /none has a website/.test(r.out.note) && credits() === credits0 + 2);
tick(); await resetCredits(st, credits());
const callsBeforeLimit = apollo.calls.length;
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'acme' });
step('when the organisation\'s daily credit limit is used up, no lookup is made and the person is told — they can still paste a website', r.code === 200 && r.out.suggestions.length === 0 && /credit limit/.test(r.out.note) && /paste/.test(r.out.note) && apollo.calls.length === callsBeforeLimit);
await resetCredits(st, 300); tick();
apollo.error = 'This Apollo plan or key does not allow company search.';
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'acme' });
step('when Apollo refuses, the person gets Apollo\'s reason (502) and no credit is counted', r.code === 502 && /does not allow company search/.test(r.out.error) && credits() === credits0 + 2);
apollo.error = null; tick();
const keyRow = st.tables.app_settings.find((x) => x.key === 'int_apollo_api_key'); st.tables.app_settings = st.tables.app_settings.filter((x) => x.key !== 'int_apollo_api_key');
const callsBeforeNoKey = apollo.calls.length;
r = await call('/finder/companies/suggest', 'post', 'ra1', { q: 'acme' });
step('with no Apollo key it says an admin must add one, says a website can still be pasted, and calls nothing', r.code === 200 && /Admin → Integrations/.test(r.out.note) && /paste/.test(r.out.note) && apollo.calls.length === callsBeforeNoKey);
st.tables.app_settings.push(keyRow);

console.log('\nThe free job sources');
let jsearch;
({ st, apollo, jsearch, router, call } = boot());
await resetCredits(st, 300);
await settings.setSettings(st.supabase, { finder_cards_per_run: 25 });
NOW = new Date('2026-10-23T12:00:00Z');
const tickMin = () => { NOW = new Date(NOW.getTime() + 61000); };
const jsMeter = () => Number((st.tables.app_settings.find((x) => x.key === 'finder_jsearch_o1_' + finder.dayOf(NOW)) || { value: 0 }).value);
const O1KEY = 'int_jsearch_api_key__org_o1';
await call('/finder/admin/users/:id', 'put', 'adm', { enabled: true, daily: 5 }, { id: 'ra1' });
r = await call('/finder/access', 'get', 'ra1');
step('before a key is saved the access answer says free sources are not connected, with the day\'s allowance and the per-run number', r.out.jobsource.connected === false && r.out.jobsource.used === 0 && r.out.jobsource.limit === 6 && r.out.jobsource.per_run === 3, JSON.stringify(r.out.jobsource));
r = await call('/finder/admin/jobsource', 'get', 'ra1');
step('only an admin may see or change the key (403 for anyone else)', r.code === 403 && (await call('/finder/admin/jobsource', 'put', 'ra1', { api_key: 'JS-KEY-ABCDEFGH1234' })).code === 403 && (await call('/finder/admin/jobsource/test', 'post', 'ra1')).code === 403);
r = await call('/finder/admin/jobsource', 'put', 'adm', { api_key: 'short' });
step('a key that does not look like one is refused in words and nothing is saved', r.code === 400 && /does not look like a key/.test(r.out.error) && !st.tables.app_settings.some((x) => x.key === O1KEY));
r = await call('/finder/admin/jobsource', 'put', 'adm', { api_key: 'JS KEY WITH SPACES 1234' });
step('…a key with spaces too', r.code === 400);
r = await call('/finder/admin/jobsource', 'put', 'adm', { api_key: '  JS-KEY-ABCDEFGH1234  ' });
step('a good key is saved under THIS organisation\'s name, trimmed, and the answer shows only its last four characters — never the key', r.code === 200 && r.out.connected === true && r.out.hint === '••••••1234' && !JSON.stringify(r.out).includes('ABCDEFGH') && st.tables.app_settings.find((x) => x.key === O1KEY).value === 'JS-KEY-ABCDEFGH1234');
r = await call('/finder/admin/jobsource', 'get', 'adm2');
step('ANOTHER organisation\'s admin sees no key — the key is one organisation\'s alone', r.out.connected === false && r.out.hint === null);
await call('/finder/admin/jobsource', 'put', 'adm2', { api_key: 'OTHER-ORG-KEY-5678' });
step('…and saving theirs does not touch ours', st.tables.app_settings.find((x) => x.key === O1KEY).value === 'JS-KEY-ABCDEFGH1234' && st.tables.app_settings.some((x) => x.key === 'int_jsearch_api_key__org_o2'));
st.tables.app_settings = st.tables.app_settings.filter((x) => x.key !== 'int_jsearch_api_key__org_o2');
r = await call('/finder/access', 'get', 'ra1');
step('everyone with access now sees that free sources are connected (and never the key)', r.out.jobsource.connected === true && !JSON.stringify(r.out).includes('ABCDEFGH'));
r = await call('/finder/admin/jobsource/test', 'post', 'adm');
step('"Check my key" makes ONE request with the organisation\'s own key, counts it on the meter, and says it works', r.out.ok === true && jsearch.calls.length === 1 && jsearch.calls[0].check === true && jsearch.calls[0].key === 'JS-KEY-ABCDEFGH1234' && jsMeter() === 1 && /works/.test(r.out.text), JSON.stringify(r.out));
jsearch.error = 'JSearch did not accept the key — check it.';
r = await call('/finder/admin/jobsource/test', 'post', 'adm');
step('a key that does not work says why', r.out.ok === false && /did not accept the key/.test(r.out.text));
jsearch.error = null; jsearch.calls.length = 0;

// a one-off search through the free sources only (Apollo is never asked)
r = await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { name: 'Free one', source: 'free' }));
step('a saved search remembers where it looks; an unknown place is Apollo, as before', r.out.source === 'free' && (await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { name: 'Odd', source: 'bing' }))).out.source === 'apollo');
st.tables.finder_searches.length = 0;
apollo.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder', 'Machinist', 'Inspector', 'Fitter', 'Fabricator'], locations: ['Texas'], posted_days: 14 });
const freeCards = st.tables.finder_cards.filter((c) => c.user_id === 'ra1');
step('Find leads now with the free sources makes cards without asking Apollo at all (no key, no credit)', r.code === 200 && apollo.calls.length === 0 && freeCards.length === 2 && r.out.new_cards === 2, r.out.results[0].note);
step('…it looked up only the allowed number of title-in-place searches (3 of 5), each with the ORGANISATION\'s key, and counted each on the meter', jsearch.calls.length === 3 && jsearch.calls.every((c) => c.key === 'JS-KEY-ABCDEFGH1234') && jsearch.calls.map((c) => c.query).join() === 'Welder jobs in Texas,Machinist jobs in Texas,Inspector jobs in Texas' && jsMeter() === 5 && /3 of 5/.test(r.out.results[0].note), r.out.results[0].note + ' meter=' + jsMeter());
const fs_names = freeCards.map((c) => c.company_name).sort().join();
step('the cards are the companies: the staffing firm is left out and the company this organisation already works (Acme, Inc.) is left out', fs_names === 'Acme Mfg,Gulf Fabrication' && /staffing firm/.test(r.out.results[0].note) && /already in your organisation/.test(r.out.results[0].note), fs_names + ' | ' + r.out.results[0].note);
const acmeCard = freeCards.find((c) => c.company_name === 'Acme Mfg');
step('a card keeps its company (website, place) and carries the jobs the search already saw — newest first, with where each was seen — and the jobs are not stored twice', acmeCard.payload.company.domain === 'acmemfg.com' && acmeCard.payload.company.city === 'Austin' && !('postings' in acmeCard.payload.company) && acmeCard.postings.length === 2 && acmeCard.postings[0].title === 'Welder' && acmeCard.postings[0].source === 'LinkedIn' && acmeCard.company_key === 'acmemfg.com' && acmeCard.apollo_org_id === null);
r = await call('/finder/cards', 'get', 'ra1');
const fs_shown = r.out.cards.find((c) => c.company_name === 'Acme Mfg');
step('the card shows its jobs and why it ranks, and no company size it does not know', fs_shown.postings.length === 2 && fs_shown.chips.some((c) => /open roles/.test(c)) && fs_shown.chips.some((c) => /Seen on LinkedIn/.test(c)) && fs_shown.employees === null);
const fs_gulf = r.out.cards.find((c) => c.company_name === 'Gulf Fabrication');
apollo.calls.length = 0;
r = await call('/finder/cards/:id/postings', 'post', 'ra1', {}, { id: acmeCard.id });
step('"See their open jobs" on a free card costs nothing and calls nobody — the jobs are already there', r.out.cached === true && r.out.postings.length === 2 && apollo.calls.length === 0 && jsearch.calls.length === 3);
r = await call('/finder/cards/:id/people', 'post', 'ra1', {}, { id: fs_gulf.id });
step('a company with no known website cannot have people looked up — it says so and to add someone by hand (no Apollo call)', r.code === 409 && /website is not known/.test(r.out.error) && apollo.calls.length === 0);


// the organisation's daily allowance
tickMin();
await settings.setSettings(st.supabase, { finder_jsearch_daily_requests: 5 });
jsearch.calls.length = 0;
const fsBefore = jsMeter();
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['T1', 'T2', 'T3', 'T4'], locations: ['Ohio'], posted_days: 14 });
step('when the organisation\'s day is nearly used (5 requests) a run makes only what is left and SAYS so — and the meter never goes past the limit', jsearch.calls.length === 5 - fsBefore && jsMeter() === 5 && /free-job-source requests \(5\)/.test(r.out.results[0].note), r.out.results[0].note + ' calls=' + jsearch.calls.length);
tickMin(); jsearch.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('with the day used up nothing is asked at all', jsearch.calls.length === 0 && r.out.new_cards === 0 && /free-job-source requests/.test(r.out.results[0].note));
await settings.setSettings(st.supabase, { finder_jsearch_daily_requests: 50 });
await settings.setSettings(st.supabase, { finder_jsearch_requests_per_run: 0 });
tickMin(); jsearch.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('an admin can switch the free sources off (0 per run): nothing is asked, and it says why', jsearch.calls.length === 0 && /switched off/.test(r.out.results[0].note));
await settings.setSettings(st.supabase, { finder_jsearch_requests_per_run: 3 });

// no key / a refusing service
st.tables.app_settings = st.tables.app_settings.filter((x) => x.key !== O1KEY);
tickMin(); jsearch.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('with no key saved a free search asks nothing and says where an admin adds the key', jsearch.calls.length === 0 && r.out.new_cards === 0 && /Integrations & API Keys/.test(r.out.results[0].note));
await call('/finder/admin/jobsource', 'put', 'adm', { api_key: 'JS-KEY-ABCDEFGH1234' });
tickMin(); jsearch.error = 'JSearch did not accept the key — check it.';
const m0 = jsMeter(); jsearch.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder', 'Fitter', 'Fabricator'], locations: ['Texas'], posted_days: 14 });
step('when the service refuses, the person gets its reason, no cards are made, the failure is kept for an admin, and it stops at the first refusal (one request, not three)', r.out.new_cards === 0 && /did not accept the key/.test(r.out.results[0].note) && r.out.results[0].error && jsearch.calls.length === 1 && st.tables.app_settings.some((x) => x.key === 'jsearch_last_error') && jsMeter() === m0 + 1, 'calls=' + jsearch.calls.length);
jsearch.error = null;

// both sources together
st.tables.finder_cards.length = 0; await settings.setSettings(st.supabase, { finder_jsearch_daily_requests: 100 });
apollo.orgs = [
  { id: 'f'.repeat(24), name: 'Acme Manufacturing', primary_domain: 'acmemfg.com', estimated_num_employees: 80, organization_headcount_twelve_month_growth: 0.1 },
  { id: 'g'.repeat(24), name: 'Fox Foundry', primary_domain: 'foxfoundry.example', organization_headcount_twelve_month_growth: 0.1 },
];
tickMin(); apollo.calls.length = 0; jsearch.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'both', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
const fsBoth = st.tables.finder_cards.filter((c) => c.user_id === 'ra1');
const acme2 = fsBoth.find((c) => c.company_key === 'f'.repeat(24));
step('Both: Apollo and the free sources are each asked once, and a company they both know is ONE card — Apollo\'s record (size) with the free source\'s jobs on it, so those jobs cost no credit', apollo.calls.filter((c) => c[0] === 'orgs').length === 1 && jsearch.calls.length === 1 && fsBoth.length === 3 && fsBoth.map((c) => c.company_name).sort().join() === 'Acme Manufacturing,Fox Foundry,Gulf Fabrication' && acme2.payload.company.employees === 80 && acme2.postings.length === 2, fsBoth.map((c) => c.company_name).join() + ' | ' + r.out.results[0].note);
step('every card of ONE run carries the same time — the run\'s — not its own moment (that is what lets a run be shown as a group)', new Set(fsBoth.map((c) => c.created_at)).size === 1 && fsBoth[0].created_at === NOW.toISOString(), fsBoth.map((c) => c.created_at).join(' | '));

// Today's cards: the NEWEST RUN first (owner, 8 Oct: "new generated cards first and then the rest of the old cards below"),
// best match first inside a run.
st.tables.finder_cards.length = 0;
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const runCard = (id, score, at) => st.tables.finder_cards.push({ id, org_id: 'o1', user_id: 'adm', search_id: null, company_key: id, company_name: id, status: 'new', score, created_on: '2026-10-07', created_at: at, postings: null, wait_until: null, lead_id: null, decided_at: null, payload: { company: { domain: id + '.example' } } });
runCard('old-hi', 90, hoursAgo(50)); runCard('old-lo', 10, hoursAgo(50));          // an earlier run: a strong card and a weak one
runCard('mid', 50, hoursAgo(26));                                                   // yesterday's run
runCard('new-lo', 5, hoursAgo(1)); runCard('new-hi', 60, hoursAgo(1));              // the newest run: a weak card and a stronger one
r = await call('/finder/cards', 'get', 'adm');
step('the newest run\'s cards are on top (best match first within the run), then the earlier runs\' — a weak new card beats a strong old one', r.out.cards.map((c) => c.id).join() === 'new-hi,new-lo,mid,old-hi,old-lo', r.out.cards.map((c) => c.id).join());
step('each card says when it was found and whether it is from the newest run', r.out.cards.filter((c) => c.is_new).map((c) => c.id).join() === 'new-hi,new-lo' && r.out.cards.every((c) => c.found_at), JSON.stringify(r.out.cards.map((c) => [c.id, c.is_new])));
st.tables.finder_cards.length = 0;
tickMin(); st.tables.finder_cards.length = 0; apollo.error = 'This Apollo plan or key does not allow company search.';
r = await call('/finder/find', 'post', 'ra1', { source: 'both', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('Both, with Apollo refusing: the free sources\' companies still come through, and the note says Apollo had a problem', r.out.new_cards === 2 && /Apollo had a problem/.test(r.out.results[0].note), r.out.results[0].note);
apollo.error = null;
tickMin(); st.tables.finder_cards.length = 0;
const apolloKeyRow = st.tables.app_settings.find((x) => x.key === 'int_apollo_api_key'); st.tables.app_settings = st.tables.app_settings.filter((x) => x.key !== 'int_apollo_api_key'); apollo.calls.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('an organisation with NO Apollo at all can still find companies by job title (the whole point)', r.out.new_cards === 2 && apollo.calls.length === 0);
tickMin(); st.tables.finder_cards.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'apollo', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
step('…and an Apollo search without Apollo still says so, as it always did', r.out.new_cards === 0 && /Apollo is not connected/.test(r.out.results[0].note));
st.tables.app_settings.push(apolloKeyRow);

// the nightly run
tickMin(); st.tables.finder_cards.length = 0; jsearch.calls.length = 0;
await call('/finder/searches', 'post', 'ra1', Object.assign({}, SEARCH, { name: 'Nightly free', source: 'free', titles: ['Welder'], locations: ['Texas'] }));
const sumF = await router.runDue();
step('the nightly sweep runs a free search with its own organisation\'s key and meter', sumF.searches >= 1 && jsearch.calls.length >= 1 && jsearch.calls.every((c) => c.key === 'JS-KEY-ABCDEFGH1234') && st.tables.finder_cards.some((c) => c.user_id === 'ra1' && c.company_name === 'Acme Mfg'), JSON.stringify(sumF));

// accepting a free card (last: the company becomes one this organisation works, so later searches would rightly skip it)
tickMin(); st.tables.finder_cards.length = 0;
r = await call('/finder/find', 'post', 'ra1', { source: 'free', titles: ['Welder'], locations: ['Texas'], posted_days: 14 });
const freeAcceptId = st.tables.finder_cards.find((c) => c.company_name === 'Acme Mfg').id;
r = await call('/finder/cards/:id/accept', 'post', 'ra1', { position: 'Welder', positions: ['Welder', 'MIG Welder'], contacts: [{ first_name: 'Hal', last_name: 'Fox', designation: 'Owner', email: 'hal@acmemfg.com' }] }, { id: freeAcceptId });
const fsLead = st.tables.jobs.find((j) => j.id === r.out.lead_id);
step('a free card is accepted like any other: a lead is made, with a contact typed by hand', r.code === 201 && !!fsLead && fsLead.position === 'Welder' && fsLead.research.finder.also_hiring.join() === 'MIG Welder' && r.out.contacts === 1 && (st.tables.companies.find((c) => c.id === r.out.company_id) || {}).name === 'Acme Mfg' && !(st.tables.companies.find((c) => c.id === r.out.company_id) || {}).apollo_org_id, JSON.stringify(r.out));

console.log('\nDiagnose');
({ st, apollo, router, call } = boot());
await resetCredits(st, 300);
r = await call('/finder/diagnose', 'get', 'ra1');
step('only an admin can ask what the key can do', r.code === 403);
r = await call('/finder/diagnose', 'get', 'adm');
step('an admin gets one plain line per thing the finder needs (key, people, companies, postings) and the credits it took', r.code === 200 && r.out.ok && r.out.checks.map((c) => c.id).join() === 'key,people,companies,postings' && r.out.credits.used === 2, JSON.stringify(r.out.checks.map((c) => c.id)));
apollo.error = 'This Apollo plan or key does not allow company search — it needs a plan with API access and a master API key.';
r = await call('/finder/diagnose', 'get', 'adm');
step('when the key lacks a permission, that line says so in Apollo\'s own words and the rest still run', !r.out.ok && r.out.checks.find((c) => c.id === 'companies').ok === false && /does not allow company search/.test(r.out.checks.find((c) => c.id === 'companies').text) && r.out.checks.find((c) => c.id === 'people').ok);
st.tables.app_settings = st.tables.app_settings.filter((x) => x.key !== 'int_apollo_api_key');
r = await call('/finder/diagnose', 'get', 'adm');
step('with no key saved it says so and spends nothing', r.out.connected === false && /Admin → Integrations/.test(r.out.checks[0].text));

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
