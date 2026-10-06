// R-001 + R-002 through the REAL handlers (routes/recruiting/analytics.js),
// against an in-memory database: the rules alone passing proves nothing about
// the wiring. Asserts that
//   * a candidate submitted to the client and later "Not Accepted" still
//     counts as a client submission — on the Reports totals, on Hot jobs AND
//     on the dashboard tiles (the three counts must never disagree: D-0029);
//   * time in stage arrives in the report, with someone stuck at BDM;
//   * another organisation's stage history is never read.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// "This month" is judged by the real calendar, and daysAgo(2) lands in LAST month on the 1st-2nd of a
// month — this suite failed on 1 Oct for exactly that reason, with no code change. Pin the clock to
// noon on the 15th of the current month so the fixtures mean what they say on every day of the year.
const RealDate = Date, _b = new RealDate(), FIXED = RealDate.UTC(_b.getUTCFullYear(), _b.getUTCMonth(), 15, 12);
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
const ORG = 'o1';
const now = Date.now();
const daysAgo = (n) => new Date(now - n * 864e5).toISOString();
const T = {
  submissions: [
    { id: 's1', org_id: ORG, stage: 'Not Accepted', job_order_id: 'jo1', recruiter_id: 'u-r', created_at: daysAgo(10), submitted_at: daysAgo(3), stage_updated_at: daysAgo(1), deleted_at: null },
    { id: 's2', org_id: ORG, stage: 'Submitted to BDM', job_order_id: 'jo1', recruiter_id: 'u-r', created_at: daysAgo(25), submitted_at: daysAgo(2), stage_updated_at: daysAgo(20), deleted_at: null },
    { id: 's3', org_id: ORG, stage: 'Sourced', job_order_id: 'jo1', recruiter_id: 'u-r', created_at: daysAgo(2), submitted_at: null, stage_updated_at: daysAgo(2), deleted_at: null },
  ],
  submission_activity: [
    { org_id: ORG, submission_id: 's1', old_stage: null, new_stage: 'Sourced', created_at: daysAgo(10) },
    { org_id: ORG, submission_id: 's1', old_stage: 'Sourced', new_stage: 'Submitted to BDM', created_at: daysAgo(8) },
    { org_id: ORG, submission_id: 's1', old_stage: 'Submitted to BDM', new_stage: 'Submitted to Client', created_at: daysAgo(5) },
    { org_id: ORG, submission_id: 's1', old_stage: 'Submitted to Client', new_stage: 'Not Accepted', created_at: daysAgo(1) },
    { org_id: ORG, submission_id: 's2', old_stage: 'Sourced', new_stage: 'Submitted to BDM', created_at: daysAgo(20) },
    // Another org's history for s3 — must never be read.
    { org_id: 'o2', submission_id: 's3', old_stage: 'Sourced', new_stage: 'Placement', created_at: daysAgo(1) },
  ],
  job_orders: [{ id: 'jo1', org_id: ORG, client: 'Acme', status: 'Active', job_title: 'Estimator', job_code: 'JO-1', created_at: daysAgo(30), deleted_at: null, placement_fee: '0' }],
  candidate_pipeline: [],
  users: [{ id: 'u-r', org_id: ORG, name: 'Rita', role: 'recruiter', roles: ['recruiter'], deleted_at: null }],
  recruiter_assignments: [],
};
function q(table) {
  const f = [];
  const api = {
    select() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
    is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    order() { return api; }, limit() { return api; },
    then(res, rej) { return Promise.resolve({ data: (T[table] || []).filter(r => f.every(fn => fn(r))), error: null }).then(res, rej); },
  };
  return api;
}
const supabase = { from: q };
const routes = {};
const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {} };
const STAGES = ['Sourced', 'Screening', 'Submitted to BDM', 'Submitted to Client', 'Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement', 'Not Accepted', 'On Hold'];
const ALIASES = { Confirmation: 'Joining', Rejected: 'Not Accepted', 'Not Joined': 'Not Accepted' };
const hasRole = (req, ...rs) => rs.some(r => (req.user.roles || []).includes(r));
require('../routes/recruiting/analytics.js')(app, {
  supabase, db: null, auth: (_a, _b, n) => n(), hasRole, today: () => new Date().toISOString().slice(0, 10),
  orgIdFor: (req) => req.orgId, orgStamp: () => ({}), withOrg: (query, req) => query.eq('org_id', req.orgId),
  STAGES, STAGE_ALIASES: ALIASES, normalizeStage: (s) => ALIASES[s] || s, BDM_GATED_STAGE: 'Submitted to Client',
  isBDM: (req) => hasRole(req, 'admin', 'bd', 'bd_lead'), isRecruiter: (req) => hasRole(req, 'recruiter'),
  reportingChainIds: async (id) => [id, 'u-r'], assignedJobOrderIds: async () => [], logSubmissionActivity: async () => {},
});
const call = async (key, user, query) => { let out, status = 200; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } }; await routes[key]({ user, orgId: ORG, query: query || {} }, res); return { status, body: out }; };
const admin = { id: 'u-adm', roles: ['admin'] };

let r = await call('GET /reports/recruiting', admin);
const t = r.body.totals || {};
step('report: the client submission later rejected STILL counts as sent to the client', t.client_submissions === 1, JSON.stringify(t));
step('report: both reached BD, so both count as sent to BD', t.submissions === 2);
step('report: the one the old count dropped is reported as recovered', t.submissions_recovered === 1);
step('report: stalled is still about NOW (the one waiting on BD)', t.stalled_at_bdm === 1);
const hot = (r.body.hot_jobs || [])[0] || {};
step('hot jobs uses the same rule (1 to client, 2 to BD)', hot.client_submissions === 1 && hot.submissions === 2, JSON.stringify(hot));
const st = (r.body.stage_time || []);
const bdm = st.find(x => x.stage === 'Submitted to BDM') || {};
step('time in stage: someone has sat at BDM 20 days — stuck', bdm.now_there === 1 && bdm.stuck === 1, JSON.stringify(bdm));
step('time in stage covers the work stages only — Sourced (inventory) is not evaluated', !st.some(x => x.stage === 'Sourced'));
step('another organisation\'s history was not read (no Placement appears)', !st.some(x => x.stage === 'Placement') && t.placements === 0);

r = await call('GET /recruiting-dashboard', admin);
step('dashboard tiles agree: 1 sent to client this month', r.body.client_submissions_month === 1, JSON.stringify(Object.fromEntries(Object.entries(r.body).filter(([k]) => /sub/.test(k)))));
step('dashboard tiles agree: 2 sent to BD this month', r.body.submissions_month === 2, String(r.body.submissions_month));

// ── the viewer's own days and weeks (R-105, D-0065) ──────────────────────────
// The clock is pinned to noon UTC on the 15th. A: 13th (this week). B: the 8th, exactly 7×24 h ago —
// the old week counted it (an eight-day week), a week of seven calendar days does not. C: 00:30 on the
// 1st in Kolkata = 19:00 UTC on the last day of the previous month — the viewer's month, not the server's.
const Y = new Date(FIXED).getUTCFullYear(), M = new Date(FIXED).getUTCMonth();
const sub = (id, iso) => ({ id, org_id: ORG, stage: 'Submitted to BDM', job_order_id: 'jo1', recruiter_id: 'u-r', created_at: iso, submitted_at: iso, stage_updated_at: iso, deleted_at: null });
T.submissions = [sub('A', new Date(FIXED - 2 * 864e5).toISOString()), sub('B', new Date(FIXED - 7 * 864e5).toISOString()), sub('C', new Date(Date.UTC(Y, M, 0, 19, 0, 0)).toISOString())];
T.submission_activity = [];
const dUtc = (await call('GET /recruiting-dashboard', admin, {})).body, dIst = (await call('GET /recruiting-dashboard', admin, { tz: 'Asia/Kolkata' })).body;
step('the week is seven calendar days — a submission exactly 7×24 h ago is NOT in it (it used to be)', dUtc.submissions_week === 1 && dIst.submissions_week === 1, dUtc.submissions_week + '/' + dIst.submissions_week);
step('this month is the VIEWER\'s: UTC counts 2, Kolkata (already the 1st) counts 3', dUtc.submissions_month === 2 && dIst.submissions_month === 3, dUtc.submissions_month + '/' + dIst.submissions_month);
const first = new Date(Date.UTC(Y, M, 1)).toISOString().slice(0, 10);
const rUtc = (await call('GET /reports/recruiting', admin, { from: first, to: first })).body, rIst = (await call('GET /reports/recruiting', admin, { from: first, to: first, tz: 'Asia/Kolkata' })).body;
const tot = (b) => (b.by_user || []).reduce((n, u) => n + u.to_bdm, 0);
step('a report for "the 1st" is cut at the viewer\'s midnight: UTC finds none, Kolkata finds C', tot(rUtc) === 0 && tot(rIst) === 1, tot(rUtc) + '/' + tot(rIst));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
