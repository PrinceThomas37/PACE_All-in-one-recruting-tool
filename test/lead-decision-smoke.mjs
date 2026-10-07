// CAN THIS COMPANY BE ADDED? — the owner's add rule (R-157, D-0085, D-0090).
// The owner, 7 Oct 2026: a company already in the system is matched by its website, LinkedIn page or NAME; a company
// with an active job cannot be added again; otherwise the 30-day cooldown applies; and it says WHO has it. Nothing is
// shared between customers — only the caller's own organisation is ever looked at.
//
// Proven here:
//   1. the pure rule (services/lead-decision.js): the three ways of matching, the order active job → cooldown → free,
//      the exact day the cooldown ends, who is named, and what does NOT count as active;
//   2. the loading (services/lead-check.js) against an in-memory two-organisation database: another organisation's
//      company is never matched, a missing linkedin_url column is survived, any other failure is NOT swallowed;
//   3. POST /lead-check: who may ask, and a plain 400 when nothing is given;
//   4. the two places a lead is created from outside the manual form enforce the same answer: approving a sourced lead
//      (409 with the sentence; a company already on file is REUSED, not duplicated; a company id from another
//      organisation is a 404) and POST /jobs for an RA (a duplicate under another company record is refused).
// Usage: node test/lead-decision-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const rule = require('../services/lead-decision.js');
const leadCheck = require('../services/lead-check.js');

const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// ── 1. the pure rule ─────────────────────────────────────────────────────────
console.log('\nThe rule');
step('a website matches however it is written (scheme, www, path, an email address, a careers sub-domain)',
  ['https://www.Acme.com/careers?x=1', 'acme.com', 'jobs@acme.com', 'http://careers.acme.com'].every((s) => rule.normalizeDomain(s) === 'acme.com'));
step('…a two-part ending keeps the company label (acme.co.uk is the company, co.uk is not)', rule.normalizeDomain('www.acme.co.uk/jobs') === 'acme.co.uk');
step('…a PLATFORM address is never a company (LinkedIn, Indeed, Gmail, a job-board host): matching on it would merge every company that posts there',
  ['https://www.linkedin.com/company/acme', 'indeed.com', 'someone@gmail.com', 'boards.greenhouse.io/acme', ''].every((s) => rule.normalizeDomain(s) === ''));
step('a LinkedIn page matches however it is written', ['https://www.linkedin.com/company/Acme-Corp/about/?x=1', 'linkedin.com/company/acme-corp'].every((s) => rule.normalizeLinkedIn(s) === 'company/acme-corp') && rule.normalizeLinkedIn('https://acme.com') === '');
step('a name matches without punctuation, case or its legal ending ("Acme, Inc." = "ACME Inc" = "Acme")', rule.normalizeName('Acme, Inc.') === rule.normalizeName('ACME Inc') && rule.normalizeName('ACME Inc') === rule.normalizeName('Acme'));
step('…but a different company is not swallowed ("Acme Staffing" is not "Acme")', rule.normalizeName('Acme Staffing LLC') !== rule.normalizeName('Acme'));
const co = { id: 'c1', name: 'Acme, Inc.', website: 'https://www.acme.com', linkedin_url: 'https://www.linkedin.com/company/acme-corp' };
step('any ONE of website / LinkedIn / name is enough, and the reasons are named',
  rule.reasonsFor({ name: 'Different Name', website: 'acme.com' }, co).join() === 'website' &&
  rule.reasonsFor({ name: 'Zed', linkedin: 'linkedin.com/company/acme-corp' }, co).join() === 'linkedin' &&
  rule.reasonsFor({ name: 'ACME INC' }, co).join() === 'name' &&
  rule.reasonsFor({ name: 'Zed', website: 'zed.com' }, co).length === 0);

const people = { u1: 'Priya Raman', u2: 'Marcus Bell' };
const nameOf = (id) => people[id] || '';
const base = { candidate: { name: 'Acme Inc', website: 'acme.com' }, companies: [co], nameOf, now: NOW, cooldownDays: 30 };
const lead = (o) => Object.assign({ company_id: 'c1', position: 'Staff Accountant', stage: 'Assigned', created_at: daysAgo(12), created_by: 'u1', assigned_to_bd: null, assigned_to: null }, o);
let d = rule.decide(Object.assign({}, base, { companies: [], leads: [], jobOrders: [] }));
step('nothing on file → free, no company id', d.state === 'free' && !d.blocked && d.company_id === null);
d = rule.decide(Object.assign({}, base, { leads: [], jobOrders: [] }));
step('a company on file with no lead → free, and the existing company is the one to reuse', d.state === 'free' && !d.blocked && d.company_id === 'c1');
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'In Discussion', created_at: daysAgo(45), assigned_to_bd: 'u2' })], jobOrders: [] }));
step('an ACTIVE lead blocks it even after the cooldown has passed (45 days, In Discussion)', d.blocked && d.state === 'active_job');
step('…and says WHO owns it (the BD it is assigned to, not the person who typed it) and what the lead is', /Marcus Bell/.test(d.sentence) && /Staff Accountant/.test(d.sentence) && d.owner_name === 'Marcus Bell', d.sentence);
step('…and says it was found by its website when the name was typed differently', /Matched on its website and company name|Matched on its website/.test(d.sentence));
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Unassigned', created_at: daysAgo(60) })], jobOrders: [] }));
step('a lead still sitting in the pool is a live lead (Unassigned counts as active)', d.blocked && d.state === 'active_job' && /Priya Raman/.test(d.sentence));
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Rejected', created_at: daysAgo(45) })], jobOrders: [] }));
step('a REJECTED lead past the cooldown does not block', !d.blocked && d.state === 'free');
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Future', created_at: daysAgo(45) })], jobOrders: [] }));
step('a FUTURE (parked) lead past the cooldown does not block', !d.blocked && d.state === 'free');
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Rejected', created_at: daysAgo(12) })], jobOrders: [] }));
step('…but a rejected lead made 12 days ago is still inside the 30-day cooldown, and the sentence counts the days', d.blocked && d.state === 'cooldown' && d.days_left === 18 && /18 more days/.test(d.sentence) && /Priya Raman/.test(d.sentence), d.sentence);
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Rejected', created_at: daysAgo(29) })], jobOrders: [] }));
step('the cooldown ends on day 30 exactly: day 29 is blocked (1 more day) …', d.blocked && d.days_left === 1);
d = rule.decide(Object.assign({}, base, { leads: [lead({ stage: 'Rejected', created_at: daysAgo(30) })], jobOrders: [] }));
step('… day 30 is free', !d.blocked);
d = rule.decide(Object.assign({}, base, { cooldownDays: 0, leads: [lead({ stage: 'Rejected', created_at: daysAgo(1) })], jobOrders: [] }));
step('a cooldown of 0 means "no cooldown" (the admin switched it off) …', !d.blocked);
d = rule.decide(Object.assign({}, base, { cooldownDays: 0, leads: [lead({ stage: 'Connected', created_at: daysAgo(1) })], jobOrders: [] }));
step('… but an active lead still blocks, whatever the cooldown', d.blocked && d.state === 'active_job');
d = rule.decide(Object.assign({}, base, { leads: [], jobOrders: [{ company_id: 'c1', job_title: 'Welder', status: 'Active', bd_manager_id: 'u2' }] }));
step('an open job order blocks it, names the BD who runs it, and does not say "lead"', d.blocked && /open job order \(Welder\) run by Marcus Bell/.test(d.sentence), d.sentence);
d = rule.decide(Object.assign({}, base, { leads: [], jobOrders: [{ company_id: 'c1', job_title: 'Welder', status: 'Closed', bd_manager_id: 'u2' }] }));
step('a CLOSED job order does not', !d.blocked);
d = rule.decide(Object.assign({}, base, { nameOf: () => '', leads: [lead({ stage: 'Assigned' })], jobOrders: [] }));
step('with nobody to name, the sentence does not invent one ("speak to " is never left dangling)', d.blocked && !/speak to\s*[.—]/.test(d.sentence) && !/owned by\s*[.,]/.test(d.sentence), d.sentence);
d = rule.decide({ candidate: { company_id: 'c1' }, companies: [co], leads: [lead({ stage: 'Connected' })], jobOrders: [], nameOf, now: NOW, cooldownDays: 30 });
step('the company the person PICKED is found by its id alone, and the answer says the record exists in this organisation', d.blocked && d.picked_found === true);
d = rule.decide({ candidate: { company_id: 'nope', name: 'Zed Co', website: 'zed.com' }, companies: [co], leads: [], jobOrders: [], nameOf, now: NOW, cooldownDays: 30 });
step('a company id that is not on file is NOT reported as found', d.picked_found === false && !d.blocked);

// ── 2. the loading, against an in-memory two-organisation database ────────────
console.log('\nThe loading');
function like(pattern, value) {           // SQL ILIKE with % wildcards and \-escapes
  const re = '^' + String(pattern).replace(/\\(.)|%|_|[.*+?^${}()|[\]]/g, (m, esc) => esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : '\\' + m) + '$';
  return new RegExp(re, 'i').test(String(value == null ? '' : value));
}
function makeStore() {
  const store = {
    tables: {
      app_settings: [{ key: 'sys_company_cooldown_days', value: '30' }],
      companies: [
        { id: 'c1', org_id: 'o1', name: 'Acme, Inc.', website: 'https://www.acme.com', linkedin_url: 'https://www.linkedin.com/company/acme-corp', deleted_at: null },
        { id: 'c2', org_id: 'o1', name: 'ACME INC', website: 'acme.com', linkedin_url: null, deleted_at: null },
        { id: 'c3', org_id: 'o2', name: 'Acme Inc', website: 'acme.com', linkedin_url: null, deleted_at: null },           // ANOTHER organisation
        { id: 'c4', org_id: 'o1', name: 'Zed Works', website: 'zed.com', linkedin_url: null, deleted_at: null },
      ],
      jobs: [
        { id: 'j1', org_id: 'o1', company_id: 'c2', position: 'Staff Accountant', stage: 'Assigned', created_at: daysAgo(10), created_by: 'u1', assigned_to_bd: 'u2', assigned_to: 'u2', deleted_at: null },
        { id: 'j3', org_id: 'o2', company_id: 'c3', position: 'Cook', stage: 'Assigned', created_at: daysAgo(2), created_by: 'x9', assigned_to_bd: null, assigned_to: null, deleted_at: null },
      ],
      job_orders: [],
      users: [{ id: 'u1', org_id: 'o1', name: 'Priya Raman' }, { id: 'u2', org_id: 'o1', name: 'Marcus Bell' }, { id: 'x9', org_id: 'o2', name: 'Other Org Person' }],
      sourced_jobs_raw: [], contacts: [],
    },
    failures: {}, calls: [],
  };
  const query = (name, orgId) => {
    const filters = []; let mode = 'select', patch = null, row = null, lim = null, wantRow = false;
    const rows = () => (store.tables[name] = store.tables[name] || []).filter((r) => (orgId == null || r.org_id == null || r.org_id === orgId) && filters.every((f) => f(r)));
    const q = {
      select(cols) { q._cols = cols; if (mode !== 'select') wantRow = true; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, list) { filters.push((r) => list.includes(r[c])); return q; },
      ilike(c, p) { filters.push((r) => like(p, r[c])); return q; },
      limit(n) { lim = n; return q; }, order() { return q; },
      update(p) { mode = 'update'; patch = p; return q; },
      insert(r) { mode = 'insert'; row = r; return q; },
      single: async () => { const x = await q.then((v) => v); return { data: Array.isArray(x.data) ? x.data[0] || null : x.data, error: x.error }; },
      maybeSingle: async () => { const x = await q.then((v) => v); return { data: Array.isArray(x.data) ? x.data[0] || null : x.data, error: x.error }; },
      then(res, rej) {
        store.calls.push([name, mode, q._cols]);
        const fail = store.failures[name];
        if (fail && (!fail.cols || (q._cols || '').includes(fail.cols))) return Promise.resolve({ data: null, error: { message: fail.message } }).then(res, rej);
        let out;
        if (mode === 'insert') { const list = (Array.isArray(row) ? row : [row]).map((r, i) => Object.assign({ id: r.id || `${name}-${(store.tables[name] || []).length + i + 1}` }, r)); (store.tables[name] = store.tables[name] || []).push(...list); out = { data: wantRow ? list : null, error: null }; }
        else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: wantRow ? hit : null, error: null }; }
        else { let d = rows(); if (lim) d = d.slice(0, lim); if (q._cols && q._cols !== '*') { const cs = q._cols.split(',').map((c) => c.trim()); d = d.map((r) => Object.fromEntries(cs.filter((c) => c in r).map((c) => [c, r[c]]))); } out = { data: d, error: null }; }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };
  store.supabase = { from: (n) => query(n, null) };
  store.db = { forRequest: (req) => ({ from: (n) => query(n, req.orgId) }), global: store.supabase };
  return store;
}
const asUser = (orgId, roles = ['ra'], id = 'u1') => ({ orgId, user: { id, name: 'Test', roles }, body: {} });

let st = makeStore();
leadCheck._resetForTests();
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'Acme Inc', website: 'acme.com' }, now: NOW });
step('the same website under TWO company records in your organisation is one company: blocked, owner named', d.blocked && d.state === 'active_job' && /Marcus Bell/.test(d.sentence), d.sentence);
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o2'), candidate: { name: 'Zed Works', website: 'zed.com' }, now: NOW });
step('another organisation\'s companies are NEVER matched or named: o2 asking about Zed Works finds nothing of o1\'s', !d.blocked && d.company_id === null);
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o2'), candidate: { name: 'Acme Inc', website: 'acme.com' }, now: NOW });
step('…and o2\'s own Acme is seen only through o2\'s own leads (a cook added 2 days ago → cooldown), never o1\'s', d.blocked && d.state === 'active_job' && d.company_id === 'c3' && !/Marcus|Priya/.test(d.sentence), d.sentence);
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'A Completely Different Name', website: 'https://careers.acme.com/jobs' }, now: NOW });
step('found by WEBSITE alone, whatever name was typed (a careers sub-domain still means acme.com)', d.blocked && d.matched_on.join() === 'website', JSON.stringify(d.matched_on));
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { linkedin: 'https://www.linkedin.com/company/acme-corp/' }, now: NOW });
step('found by LinkedIn page alone', d.matched_on.includes('linkedin') && d.company_id === 'c1');
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { company_id: 'c4' }, now: NOW });
step('a picked company with no history and no look-alikes → free', !d.blocked && d.company_id === 'c4' && d.picked_found === true);
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { company_id: 'c3' }, now: NOW });
step('a company id belonging to ANOTHER organisation is not found at all', d.picked_found === false && !d.blocked);

st = makeStore(); leadCheck._resetForTests();
st.failures.companies = { cols: 'linkedin_url', message: 'column companies.linkedin_url does not exist' };
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'Acme Inc', website: 'acme.com', linkedin: 'linkedin.com/company/acme-corp' }, now: NOW });
step('before migration 057 (no linkedin_url column) the check still works on website and name — it learns the column is missing and carries on', d.blocked && /Marcus Bell/.test(d.sentence));
st = makeStore(); leadCheck._resetForTests();
st.failures.companies = { message: 'connection reset' };
let threw = null; try { await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'Acme Inc' }, now: NOW }); } catch (e) { threw = e; }
step('any OTHER failure is thrown, never swallowed (a check that found nothing because the database failed would wave a duplicate through)', threw && /connection reset/.test(threw.message));
st = makeStore(); leadCheck._resetForTests();
st.failures.job_orders = { message: 'relation "job_orders" does not exist' };
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'Acme Inc', website: 'acme.com' }, now: NOW });
step('a job-order table that cannot be read counts as "no job orders" — the live-lead rule still protects the company', d.blocked && d.state === 'active_job');
st = makeStore(); leadCheck._resetForTests();
st.tables.jobs = [];            // no leads at all, but an open job order
st.tables.job_orders = [{ id: 'jo1', org_id: 'o1', company_id: 'c1', job_title: 'Welder', status: 'Active', bd_manager_id: 'u2', deleted_at: null }];
d = await leadCheck.checkCompany({ db: st.db, supabase: st.supabase, req: asUser('o1'), candidate: { name: 'Acme' }, now: NOW });
step('an open job order alone blocks, found by name only', d.blocked && /open job order \(Welder\) run by Marcus Bell/.test(d.sentence));

// ── 3. POST /lead-check ──────────────────────────────────────────────────────
console.log('\nPOST /lead-check');
const hasRole = (req, ...roles) => (req.user.roles || []).some((r) => roles.includes(r));
const handlerOf = (router, p, m) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const callOn = (router) => async (p, m, req) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } }; await handlerOf(router, p, m)(req, res); return { code, out }; };
st = makeStore(); leadCheck._resetForTests();
const checkRouter = require('../routes/lead-check.js')({ supabase: st.supabase, db: st.db, auth: (_a, _b, n) => n(), hasRole });
let call = callOn(checkRouter);
let r = await call('/lead-check', 'post', Object.assign(asUser('o1', ['ra']), { body: { name: 'Acme Inc', website: 'acme.com' } }));
step('an RA asking about a duplicate gets the decision with the sentence', r.code === 200 && r.out.blocked === true && /Marcus Bell/.test(r.out.sentence) && r.out.state === 'active_job');
step('…the answer carries no internals (no picked_found, no ids of leads)', !('picked_found' in r.out) && !JSON.stringify(r.out).includes('j1'));
r = await call('/lead-check', 'post', Object.assign(asUser('o1', ['recruiter']), { body: { name: 'Acme' } }));
step('a recruiter (not someone who adds leads) is refused', r.code === 403);
r = await call('/lead-check', 'post', Object.assign(asUser('o1', ['bd']), { body: {} }));
step('asking about nothing is a plain 400 that says what to give', r.code === 400 && /company name, website, LinkedIn page or company/.test(r.out.error));

// ── 4. enforced where the lead is created ─────────────────────────────────────
console.log('\nEnforcement');
const logged = [];
function sourcedRouter(store) {
  return require('../routes/lead-sources.js')({
    supabase: store.supabase, db: store.db, auth: (_a, _b, n) => n(), hasRole,
    withOrg: (q) => q, orgStamp: (req) => ({ org_id: req.orgId }), orgIdFor: (req) => req.orgId, logActivity: async (...a) => { logged.push(a); },
  });
}
st = makeStore(); leadCheck._resetForTests();
st.tables.sourced_jobs_raw = [
  { id: 's1', org_id: 'o1', status: 'new', title: 'Staff Accountant', company_name: 'Acme Incorporated', company_domain: 'acme.com', provider: 'greenhouse', city: 'Houston', state: 'TX', contacts: [] },
  { id: 's2', org_id: 'o1', status: 'new', title: 'Welder', company_name: 'Brand New Co', company_domain: 'brandnew.example', provider: 'lever', city: 'Waco', state: 'TX', contacts: [] },
  { id: 's3', org_id: 'o1', status: 'new', title: 'Cook', company_name: 'Zed Works', company_domain: 'zed.com', provider: 'lever', city: 'Waco', state: 'TX', contacts: [] },
];
const src = sourcedRouter(st); call = callOn(src);
const sourcedUser = (extra) => Object.assign(asUser('o1', ['bd'], 'u2'), extra);
r = await call('/sourced-leads/:id/approve', 'post', sourcedUser({ params: { id: 's1' }, body: {} }));
step('approving a sourced lead for a company already on file under another name is REFUSED (409) with the owner named', r.code === 409 && r.out.reason === 'active_job' && /Marcus Bell/.test(r.out.error), r.out && r.out.error);
step('…nothing was created: no lead, no company, the posting is still "new"', st.tables.jobs.filter((j) => j.org_id === 'o1').length === 1 && st.tables.companies.length === 4 && st.tables.sourced_jobs_raw[0].status === 'new');
r = await call('/sourced-leads/:id/approve', 'post', sourcedUser({ params: { id: 's3' }, body: {} }));
const zedLead = st.tables.jobs.find((j) => j.position === 'Cook' && j.org_id === 'o1');
step('approving a company that is on file but free REUSES that company instead of creating a second one', r.code === 201 && zedLead && zedLead.company_id === 'c4' && st.tables.companies.length === 4, JSON.stringify(r.out));
r = await call('/sourced-leads/:id/approve', 'post', sourcedUser({ params: { id: 's2' }, body: {} }));
step('a company nobody has is created as before (still a 201, one new company)', r.code === 201 && st.tables.companies.length === 5);
r = await call('/sourced-leads/:id/approve', 'post', sourcedUser({ params: { id: 's3' }, body: {} }));
step('approving the same posting twice is still refused ("Already approved")', r.code === 409 && /Already approved/.test(r.out.error));
st = makeStore(); leadCheck._resetForTests();
st.tables.sourced_jobs_raw = [{ id: 's4', org_id: 'o1', status: 'new', title: 'Cook', company_name: 'Whoever', company_domain: 'whoever.example', provider: 'lever', contacts: [] }];
const src2 = sourcedRouter(st); call = callOn(src2);
r = await call('/sourced-leads/:id/approve', 'post', sourcedUser({ params: { id: 's4' }, body: { company_id: 'c3' } }));
step('a company id from ANOTHER organisation, sent in the request, is a 404 (it used to be trusted as sent)', r.code === 404 && st.tables.jobs.filter((j) => j.position === 'Cook' && j.org_id === 'o1').length === 0, JSON.stringify(r.out));

// POST /jobs for an RA: the same company under another record is refused.
st = makeStore(); leadCheck._resetForTests();
const jobsRouter = require('../routes/jobs.js')({
  supabase: st.supabase, db: st.db, auth: (_a, _b, n) => n(), hasRole, today: () => '2026-10-07', logActivity: async () => {}, canTouchJob: async () => true,
  loadAllJobs: async () => [], JOB_SELECT: '*', getTimezoneFromLocation: () => 'CST', persistLearnedSkills: () => {},
  orgIdFor: (req) => req.orgId, withOrg: (q) => q, orgStamp: (req) => ({ org_id: req.orgId }), userOrgId: async () => 'o1', mailboxOrgId: async () => 'o1',
});
call = callOn(jobsRouter);
r = await call('/jobs', 'post', Object.assign(asUser('o1', ['ra'], 'u1'), { body: { company_id: 'c1', position: 'Controller' } }));
step('an RA adding a lead on company c1 is refused because ITS twin c2 (same website, different record) already has an active lead', r.code === 409 && /Marcus Bell/.test(r.out.error) && r.out.reason === 'active_job', JSON.stringify(r.out));
step('…and no lead was written', st.tables.jobs.filter((j) => j.position === 'Controller').length === 0);

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
