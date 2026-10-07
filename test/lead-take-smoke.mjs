// A BD TAKES LEADS FOR THEMSELVES, AND IMPORTS INTO THEIR OWN PROFILE (R-148, option A, D-0082)
// The owner: "today I thought of importing a list of leads directly into BD user profile. But did not find a way to
// send the outreach." The cause: every import landed in the POOL as "Unassigned" — invisible to the BD who made it —
// and the BD's "Done" button only looked for leads that cannot exist. Proven here, against an in-memory database:
//   * the shared distribution rules (proportional spread, exact count, a cap of 0 = off)
//   * GET /leads/take/status and POST /leads/take: who may, the daily cap and its tally, only MY connected
//     mailboxes, no duplicates, the pool is never exposed, and two people pressing together never get the same lead
//   * POST /jobs/bulk with for_me: the leads are mine, Assigned, in my mailboxes — and still go to the pool for anyone else
// Usage: node test/lead-take-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const dist = require('../services/lead-distribution.js');

// ── 1. the shared rules ────────────────────────────────────────────────────
const accs = [{ id: 'A', remaining: 30 }, { id: 'B', remaining: 10 }];
const q = dist.assignmentQueue(accs, 8, () => 0.5);
step('a queue is EXACTLY as long as the number of leads, and proportional to what each mailbox can still send', q.length === 8 && q.filter(x => x === 'A').length === 6 && q.filter(x => x === 'B').length === 2, q.join(''));
step('a mailbox with no room today gets none; no mailboxes or no leads → an empty queue', dist.assignmentQueue([{ id: 'A', remaining: 0 }, { id: 'B', remaining: 5 }], 3).every(x => x === 'B') && dist.assignmentQueue([], 3).length === 0 && dist.assignmentQueue(accs, 0).length === 0);
step('rounding never loses or invents a lead (7 over three equal mailboxes)', dist.assignmentQueue([{ id: 'a', remaining: 10 }, { id: 'b', remaining: 10 }, { id: 'c', remaining: 10 }], 7).length === 7);
step('the pool is handed out Old → Normal → New, as it always has been', dist.orderPool([{ id: 1, freshness: 'New' }, { id: 2, freshness: 'Old' }, { id: 3, freshness: 'Normal' }]).map(x => x.id).join('') === '231');
step('a cap of 0 means OFF, and the remainder never goes below zero', dist.dayRemaining(0, 0) === 0 && dist.dayRemaining(25, 10) === 15 && dist.dayRemaining(25, 40) === 0 && dist.dayRemaining('x', 0) === 0);

// ── 2. an in-memory database that answers these routes' queries ────────────
function makeDb(tables, hooks = {}) {
  const db = { tables, calls: [] };
  db.from = (name) => {
    const filters = []; let mode = 'select', patch = null, limitN = null, row = null, selectAfter = false;
    const apply = () => (tables[name] = tables[name] || []).filter(r => filters.every(f => f(r)));
    const q = {
      select() { if (mode === 'update' || mode === 'insert') selectAfter = true; return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      is(c, v) { filters.push(r => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, list) { filters.push(r => list.includes(r[c])); return q; },
      gte() { return q; }, lt() { return q; }, order() { return q; },
      limit(n) { limitN = n; return q; },
      update(p) { mode = 'update'; patch = p; return q; },
      insert(r) { mode = 'insert'; row = r; return q; },
      upsert(rows, opts) { const t = (tables[name] = tables[name] || []); const k = (opts && opts.onConflict) || 'key'; for (const r of [].concat(rows)) { const i = t.findIndex(x => x[k] === r[k]); if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r }); } return Promise.resolve({ error: null }); },
      maybeSingle: async () => ({ data: apply()[0] || null, error: null }),
      then(res, rej) {
        let out;
        if (mode === 'update') { const hit = apply(); hit.forEach(r => Object.assign(r, patch)); out = { data: selectAfter ? hit.map(r => ({ id: r.id })) : null, error: null }; }
        else if (mode === 'insert') { const rows = (Array.isArray(row) ? row : [row]).map((r, i) => ({ id: r.id || `${name}-${(tables[name] || []).length + i + 1}`, ...r })); (tables[name] = tables[name] || []).push(...rows); out = { data: selectAfter ? rows.map(r => ({ id: r.id })) : null, error: null }; }
        else { let d = apply(); if (limitN) d = d.slice(0, limitN); if (name === 'jobs' && hooks.afterPoolRead) { const snap = d.map(x => ({ ...x })); hooks.afterPoolRead(tables); d = snap; } out = { data: d, error: null }; }
        db.calls.push([name, mode]); return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };
  return db;
}
const mkTables = () => ({
  app_settings: [],
  user_emails: [
    { id: 'm1', user_id: 'bd1', email_address: 'bd1@x.test', is_active: true, daily_send_limit: 100 },
    { id: 'm2', user_id: 'bd1', email_address: 'bd1b@x.test', is_active: true, daily_send_limit: 50 },
    { id: 'm3', user_id: 'bd1', email_address: 'dead@x.test', is_active: true, daily_send_limit: 50 },        // token failed
    { id: 'm9', user_id: 'someone-else', email_address: 'other@x.test', is_active: true, daily_send_limit: 100 },
  ],
  microsoft_tokens: [{ user_email_id: 'm1', refresh_failed: false }, { user_email_id: 'm3', refresh_failed: true }, { user_email_id: 'm9', refresh_failed: false }],
  gmail_tokens: [{ user_email_id: 'm2', refresh_failed: false }],
  email_send_log: [],
  jobs: [
    ...Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, stage: 'Unassigned', assigned_to_bd: null, deleted_at: null, is_duplicate: false, freshness: ['Old', 'Normal', 'New'][i % 3] })),
    { id: 'dup1', stage: 'Unassigned', assigned_to_bd: null, deleted_at: null, is_duplicate: true, freshness: 'Old' },
    { id: 'mine1', stage: 'Contacted', assigned_to_bd: 'bd2', deleted_at: null, is_duplicate: false },
  ],
});
const hasRole = (req, ...roles) => (req.user.roles || []).some(r => roles.includes(r));
const handlerOf = (router, p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const callOn = (router) => async (p, m, user, body) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } };
  await handlerOf(router, p, m)({ user: Object.assign({ id: 'bd1', name: 'Bea BD', roles: ['bd'] }, user), orgId: 'o1', body }, res); return { code, out }; };

// ── 3. the routes ──────────────────────────────────────────────────────────
let tables = mkTables(); let db = makeDb(tables);
const logged = [];
const ctx = () => ({ supabase: db, auth: (_a, _b, n) => n(), hasRole, today: () => '2026-10-07', withOrg: (qq) => qq, logActivity: async (...a) => { logged.push(a); } });
let router = require('../routes/lead-take.js')(ctx()); let call = callOn(router);

let r = await call('/leads/take/status', 'get', { id: 'adm', roles: ['admin'] });
step('an admin or RA lead is pointed at Assign Leads (403) — this is the BD\'s own button', r.code === 403 && /Assign Leads/.test(r.out.error));
r = await call('/leads/take/status', 'get');
step('status: 25 a day by default, 0 taken, the BD may take up to 25 now', r.out.enabled && r.out.cap === 25 && r.out.taken_today === 0 && r.out.remaining_today === 25 && r.out.can_take === 25, JSON.stringify(r.out).slice(0, 160));
step('…it lists ONLY my mailboxes that are connected and working (not the dead one, not someone else\'s)', r.out.mailboxes.map(m => m.id).sort().join() === 'm1,m2');
step('…and never says how big the pool is (a BD does not see it, D-0034)', !/pool|available|\b40\b|\b41\b/i.test(JSON.stringify(r.out).replace(/pool leads/i, '')));
r = await call('/leads/take', 'post', {}, { count: 0 });
step('"how many?" must be 1 or more', r.code === 400);
r = await call('/leads/take', 'post', {}, { count: 5 });
const mine = tables.jobs.filter(j => j.assigned_to_bd === 'bd1');
step('taking 5 hands me 5 leads, Assigned, stamped with the time and owned by me', r.out.taken === 5 && mine.length === 5 && mine.every(j => j.stage === 'Assigned' && j.assigned_at && j.assigned_to === 'bd1'), JSON.stringify(r.out).slice(0, 140));
step('…each in one of MY connected mailboxes — never the dead one, never another person\'s', mine.every(j => ['m1', 'm2'].includes(j.sending_email_id)));
step('…and never a flagged duplicate, and never someone else\'s lead', !mine.some(j => j.id === 'dup1' || j.id === 'mine1') && tables.jobs.find(j => j.id === 'mine1').assigned_to_bd === 'bd2');
step('…oldest first: the freshest are left for later', mine.every(j => j.freshness !== 'New'), mine.map(j => j.freshness).join());
step('…the answer says how many I may still take today, and the ids to write emails for', r.out.remaining_today === 20 && r.out.job_ids.length === 5);
step('…each one is recorded as self-assigned (so a manager can see it)', logged.length === 5 && logged.every(l => l[3] === 'self_assigned'));
step('…and nothing was SENT: taking only assigns', !(tables.emails || []).length);
r = await call('/leads/take', 'post', {}, { count: 100 });
step('asking for more than the day allows takes only what is left (20), and says why', r.out.taken === 20 && /Took 20 of the 100/.test(r.out.message) && r.out.remaining_today === 0, r.out.message);
r = await call('/leads/take', 'post', {}, { count: 1 });
step('after that: "you have taken your 25 for today — more tomorrow" (400), and nothing more is handed out', r.code === 400 && /25 for today/.test(r.out.error) && tables.jobs.filter(j => j.assigned_to_bd === 'bd1').length === 25);
r = await call('/leads/take/status', 'get');
step('status now says the cap is reached', r.out.reason === 'cap_reached' && r.out.remaining_today === 0);
// tomorrow is a new tally
router = require('../routes/lead-take.js')({ ...ctx(), today: () => '2026-10-08' }); call = callOn(router);
r = await call('/leads/take/status', 'get');
step('tomorrow the allowance is back (the tally is per day)', r.out.remaining_today === 25);

// switched off
const settings = require('../config/settings.js');
await settings.setSettings(db, { self_assign_daily_cap: 0 });   // what the admin's System Settings page does
r = await call('/leads/take/status', 'get'); const off = r.out;
r = await call('/leads/take', 'post', {}, { count: 3 });
step('an admin sets the cap to 0 → it is OFF: status says so and a take is refused with where to turn it on', off.enabled === false && off.reason === 'off' && r.code === 403 && /switched off/.test(r.out.error));
await settings.setSettings(db, { self_assign_daily_cap: 25 });

// no working mailbox
tables.microsoft_tokens.forEach(t => { t.refresh_failed = true; }); tables.gmail_tokens.forEach(t => { t.refresh_failed = true; });
r = await call('/leads/take', 'post', {}, { count: 3 });
step('with no connected mailbox it says so in words and takes nothing', r.code === 400 && /connected and working/.test(r.out.error), r.out.error);

// THE RACE: someone else is handed a lead between my reading the pool and my claiming it
tables = mkTables(); tables.jobs = tables.jobs.filter(j => /^p[0-3]$/.test(j.id));
db = makeDb(tables, { afterPoolRead: (t) => { const x = t.jobs.find(j => j.id === 'p0'); x.assigned_to_bd = 'bd2'; x.stage = 'Assigned'; } });
router = require('../routes/lead-take.js')(ctx()); call = callOn(router);
r = await call('/leads/take', 'post', {}, { count: 4 });
step('RACE: a lead handed to someone else a moment ago is NOT taken from them — I get the other three and am told', r.out.taken === 3 && tables.jobs.find(j => j.id === 'p0').assigned_to_bd === 'bd2' && /Took 3 of the 4/.test(r.out.message), JSON.stringify(r.out).slice(0, 150));

// ── 4. importing into my own profile ───────────────────────────────────────
tables = mkTables(); db = makeDb(tables);
const jobsRouter = require('../routes/jobs.js')({ supabase: db, auth: (_a, _b, n) => n(), hasRole, today: () => '2026-10-07', logActivity: async () => {}, canTouchJob: () => true,
  loadAllJobs: async () => [], JOB_SELECT: '*', getTimezoneFromLocation: () => 'EST', persistLearnedSkills: async () => {}, orgIdFor: () => 'o1', withOrg: (qq) => qq, orgStamp: () => ({ org_id: 'o1' }), userOrgId: async () => 'o1', mailboxOrgId: async () => 'o1' });
const bulk = callOn(jobsRouter);
const payload = (n) => Array.from({ length: n }, (_, i) => ({ company_id: 'co' + i, position: 'Estimator ' + i, location: 'Dallas, TX', contacts: [{ first_name: 'Maria' + i }] }));
tables.jobs = [];
r = await bulk('/jobs/bulk', 'post', {}, { jobs: payload(6), for_me: true });
let imp = tables.jobs.filter(j => /^jobs-/.test(j.id));
step('a BD importing "for me": the leads are MINE — Assigned, owned, time-stamped', r.code === 201 && r.out.owned === true && imp.length === 6 && imp.every(j => j.stage === 'Assigned' && j.assigned_to_bd === 'bd1' && j.assigned_at), JSON.stringify(r.out).slice(0, 140));
step('…each in one of my connected mailboxes (so the first emails can be written and sent from it)', imp.every(j => ['m1', 'm2'].includes(j.sending_email_id)) && new Set(imp.map(j => j.sending_email_id)).size === 2);
step('…and the answer carries the new lead ids, for "Write the first emails"', r.out.job_ids.length === 6);
tables.jobs = [];
r = await bulk('/jobs/bulk', 'post', {}, { jobs: payload(2) });
step('the SAME import without "for me" still goes to the pool, unowned (how an RA works)', r.out.owned === false && tables.jobs.every(j => j.stage === 'Unassigned' && !j.assigned_to_bd), JSON.stringify(tables.jobs.map(j => j.stage)));
tables.jobs = [];
r = await bulk('/jobs/bulk', 'post', { id: 'adm', roles: ['admin'] }, { jobs: payload(2), for_me: true });
step('"for me" from an admin or RA is ignored: their import goes to the pool (they have Assign Leads)', r.out.owned === false && tables.jobs.every(j => j.stage === 'Unassigned'));
tables.jobs = []; tables.microsoft_tokens.forEach(t => { t.refresh_failed = true; }); tables.gmail_tokens.forEach(t => { t.refresh_failed = true; });
r = await bulk('/jobs/bulk', 'post', {}, { jobs: payload(2), for_me: true });
step('with no connected mailbox the import is REFUSED before anything is created — and says why', r.code === 400 && /connected and working/.test(r.out.error) && tables.jobs.length === 0, r.out.error);
tables.microsoft_tokens.forEach(t => { t.refresh_failed = false; }); tables.email_send_log = [{ user_email_id: 'm1', emails_sent: 999, send_date: '2026-10-07' }, { user_email_id: 'm2', emails_sent: 999, send_date: '2026-10-07' }];
r = await bulk('/jobs/bulk', 'post', {}, { jobs: payload(2), for_me: true });
step('a mailbox whose sending limit is used up TODAY does not block an import (owning is not sending)', r.code === 201 && r.out.owned === true);

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
