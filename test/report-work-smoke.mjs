// D-0077 — the Reports count the team's WORK, by the day it happened, and every
// number can show the rows it counts. Pure rules + the real handlers
// (routes/recruiting/analytics.js) against an in-memory database.
//
//   * the owner: "submission means a real submission to a manager or client,
//     being added to the system or a job is not submission" — and "datasets
//     being added to the system do not need to be evaluated, only the work
//     that's being done by the team";
//   * a number and the list behind it are the SAME rows (count === list length,
//     for every metric the page can ask for);
//   * the trend is dated by when a candidate was SENT, never when the row was
//     created;
//   * everyone in the team is listed — someone who did nothing shows 0;
//   * the drill-down obeys the same scope as the report.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const RealDate = Date, FIXED = RealDate.UTC(2026, 9, 15, 12);       // Thu 15 Oct 2026 12:00 UTC, pinned
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
const DAY = 864e5, daysAgo = (n) => new RealDate(FIXED - n * DAY).toISOString();
const rw = require('../services/report-work.js');
const norm = (s) => ({ Confirmation: 'Joining', Rejected: 'Not Accepted' }[s] || s);

// ── 1. THE RULE ────────────────────────────────────────────────────────────
const ev = (new_stage, d) => ({ new_stage, created_at: daysAgo(d) });
let r = rw.reachTimes({ id: 'a', stage: 'Placement', created_at: daysAgo(40), recruiter_id: 'r1' }, [ev('Sourced', 40), ev('Submitted to BDM', 30), ev('Interview Scheduled', 12), ev('Placement', 3)], norm);
step('a candidate is dated by the day each stage was FIRST reached', r.reached['Submitted to BDM'] === FIXED - 30 * DAY && r.reached['Interview Scheduled'] === FIXED - 12 * DAY && r.reached['Placement'] === FIXED - 3 * DAY);
step('…and skipping a stage still counts it on the day they got past it (straight to an interview = sent on that day)',
  rw.reachTimes({ id: 'b', stage: 'Interview Scheduled', created_at: daysAgo(9) }, [ev('Sourced', 9), ev('Interview Scheduled', 2)], norm).reached['Submitted to Client'] === FIXED - 2 * DAY);
step('Sourced and Screening are never work — they have no entry at all', !('Sourced' in r.reached) && !('Screening' in r.reached));
step('a row with NO recorded history falls back to when it last moved, not to nothing',
  rw.reachTimes({ id: 'c', stage: 'Submitted to BDM', created_at: daysAgo(20), stage_updated_at: daysAgo(6) }, [], norm).reached['Submitted to BDM'] === FIXED - 6 * DAY);
const added = rw.reachTimes({ id: 'd', stage: 'Sourced', created_at: daysAgo(1), recruiter_id: 'r1' }, [ev('Sourced', 1)], norm);
step('a candidate only ADDED to a job counts for nothing', ['to_bdm', 'to_client', 'interviews', 'placements', 'reached:Submitted to BDM'].every(m => rw.timeFor(added, m) == null));
const parked = rw.reachTimes({ id: 'e', stage: 'Not Accepted', created_at: daysAgo(30) }, [ev('Submitted to BDM', 20), ev('Submitted to Client', 15), ev('Not Accepted', 4)], norm);
step('rejected after being sent: still counted as sent (they left the building), and shown as ended, dated by the rejection',
  rw.timeFor(parked, 'to_client') === FIXED - 15 * DAY && rw.timeFor(parked, 'parked:Not Accepted') === FIXED - 4 * DAY && rw.timeFor(parked, 'parked:On Hold') == null);
const win = { from: FIXED - 7 * DAY, to: null };
step('the period uses the day the work HAPPENED: sent 15 days ago is out of a 7-day window, rejected 4 days ago is in',
  rw.members([parked], 'to_client', win).length === 0 && rw.members([parked], 'parked:Not Accepted', win).length === 1);
step('"waiting on the BD manager" is a NOW — the window does not hide it', rw.members([rw.reachTimes({ id: 'f', stage: 'Submitted to BDM', created_at: daysAgo(90) }, [ev('Submitted to BDM', 60)], norm)], 'stalled', win).length === 1);
const old = rw.reachTimes({ id: 'g', stage: 'Submitted to BDM', created_at: daysAgo(40) }, [ev('Submitted to BDM', 20)], norm);
step('stuck = sat at a stage 14+ days (and never at a final stage)', rw.members([old], 'stuck:Submitted to BDM', null, FIXED).length === 1 && rw.members([old], 'stuck:Placement', null, FIXED).length === 0);
const tr = rw.weeklyTrend([r, parked, old], FIXED);
step('the 8-week trend is dated by SENDING: BDM 30d→week 4, client 15d→week 2 (ago), BDM 20d, row created 40d ago changes nothing',
  tr.length === 8 && tr[7].week === 'This wk' && tr.find(t => t.ago === 4).to_bdm === 1 && tr.find(t => t.ago === 2).to_client === 1 && tr.find(t => t.ago === 2).to_bdm === 2 + 0 /* parked@20d + old@20d */, JSON.stringify(tr.map(t => [t.ago, t.to_bdm, t.to_client])));
const all = [r, parked, old, added];
step('THE LIST IS THE COUNT: for every metric the page can ask, members().length === count()',
  ['to_bdm', 'to_client', 'interviews', 'placements', 'stalled', 'reached:Placement', 'parked:Not Accepted', 'now:Submitted to BDM', 'stuck:Submitted to BDM']
    .every(m => rw.members(all, m, null, FIXED).length === rw.count(all, m, null, FIXED)));
step('week drill-down lists exactly the trend bar', rw.weekMembers([r, parked, old], 'to_bdm', 4, FIXED).length === tr.find(t => t.ago === 4).to_bdm && rw.weekMembers([r, parked, old], 'to_client', 2, FIXED).length === 1);

// ── 2. THROUGH THE REAL HANDLERS ───────────────────────────────────────────
const ORG = 'o1';
const T = {
  submissions: [
    // sourced into the system 30 days ago, SENT to BDM 2 days ago → this week's work, not week 4's
    { id: 's1', org_id: ORG, stage: 'Submitted to BDM', job_order_id: 'jo1', candidate_id: 'c1', candidate: { id: 'c1', full_name: 'Ada Lovelace' }, recruiter_id: 'u-r', created_at: daysAgo(30), submitted_at: null, stage_updated_at: daysAgo(2), deleted_at: null },
    { id: 's2', org_id: ORG, stage: 'Placement', job_order_id: 'jo1', candidate_id: 'c2', candidate: { id: 'c2', full_name: 'Grace Hopper' }, recruiter_id: 'u-r', created_at: daysAgo(45), submitted_at: daysAgo(20), stage_updated_at: daysAgo(3), deleted_at: null },
    // 40 candidates ADDED to jobs this week — inventory
    ...Array.from({ length: 40 }, (_, i) => ({ id: 'a' + i, org_id: ORG, stage: i % 2 ? 'Sourced' : 'Screening', job_order_id: 'jo1', candidate_id: 'cx' + i, candidate: { id: 'cx' + i, full_name: 'Added ' + i }, recruiter_id: 'u-r', created_at: daysAgo(1), submitted_at: null, stage_updated_at: daysAgo(1), deleted_at: null })),
    // another recruiter's work, outside u-r's own scope
    { id: 'o1', org_id: ORG, stage: 'Submitted to Client', job_order_id: 'jo1', candidate_id: 'c9', candidate: { id: 'c9', full_name: 'Other Person' }, recruiter_id: 'u-o', created_at: daysAgo(9), submitted_at: daysAgo(4), stage_updated_at: daysAgo(4), deleted_at: null },
  ],
  submission_activity: [
    { org_id: ORG, submission_id: 's1', old_stage: 'Sourced', new_stage: 'Submitted to BDM', created_at: daysAgo(2) },
    { org_id: ORG, submission_id: 's2', old_stage: 'Sourced', new_stage: 'Submitted to BDM', created_at: daysAgo(25) },
    { org_id: ORG, submission_id: 's2', old_stage: 'Submitted to BDM', new_stage: 'Submitted to Client', created_at: daysAgo(20) },
    { org_id: ORG, submission_id: 's2', old_stage: 'Submitted to Client', new_stage: 'Interview Scheduled', created_at: daysAgo(10) },
    { org_id: ORG, submission_id: 's2', old_stage: 'Interview Scheduled', new_stage: 'Placement', created_at: daysAgo(3) },
    { org_id: ORG, submission_id: 'o1', old_stage: 'Submitted to BDM', new_stage: 'Submitted to Client', created_at: daysAgo(4) },
  ],
  job_orders: [{ id: 'jo1', org_id: ORG, client: 'Acme', status: 'Active', job_title: 'Estimator', job_code: 'JO-1', created_at: daysAgo(60), deleted_at: null, placement_fee: '5000' }],
  users: [
    { id: 'u-r', org_id: ORG, name: 'Rita', role: 'recruiter', roles: ['recruiter'], deleted_at: null },
    { id: 'u-idle', org_id: ORG, name: 'Idle Ian', role: 'recruiter', roles: ['recruiter'], deleted_at: null },
    { id: 'u-o', org_id: ORG, name: 'Omar', role: 'recruiter', roles: ['recruiter'], deleted_at: null },
    { id: 'u-adm', org_id: ORG, name: 'Admin', role: 'admin', roles: ['admin'], deleted_at: null },
  ],
};
function q(table) {
  const f = [];
  const api = {
    select() { return api; }, eq(k, v) { f.push(x => x[k] === v); return api; }, in(k, vs) { f.push(x => vs.includes(x[k])); return api; },
    is(k, v) { f.push(x => (x[k] == null) === (v == null)); return api; }, order() { return api; }, limit() { return api; },
    then(res, rej) { return Promise.resolve({ data: (T[table] || []).filter(x => f.every(fn => fn(x))), error: null }).then(res, rej); },
  };
  return api;
}
const routes = {};
const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {} };
const STAGES = ['Sourced', 'Screening', 'Submitted to BDM', 'Submitted to Client', 'Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement', 'Not Accepted', 'On Hold'];
const hasRole = (req, ...rs) => rs.some(x => (req.user.roles || []).includes(x));
require('../routes/recruiting/analytics.js')(app, {
  supabase: { from: q }, db: null, auth: (_a, _b, n) => n(), hasRole, today: () => new RealDate(FIXED).toISOString().slice(0, 10),
  orgIdFor: (req) => req.orgId, orgStamp: () => ({}), withOrg: (query, req) => query.eq('org_id', req.orgId),
  STAGES, STAGE_ALIASES: {}, normalizeStage: (s) => s, BDM_GATED_STAGE: 'Submitted to Client',
  isBDM: (req) => hasRole(req, 'admin', 'bd', 'bd_lead'), isRecruiter: (req) => hasRole(req, 'recruiter'),
  reportingChainIds: async (id) => [id], assignedJobOrderIds: async () => [], logSubmissionActivity: async () => {},
});
const call = async (key, user, query) => { let body, status = 200; const res = { status(s) { status = s; return res; }, json(j) { body = j; return res; } }; await routes[key]({ user, orgId: ORG, query: query || {} }, res); return { status, body }; };
const admin = { id: 'u-adm', roles: ['admin'] }, rita = { id: 'u-r', roles: ['recruiter'] };

let rep = (await call('GET /reports/recruiting', admin)).body;
step('40 candidates added to jobs this week change NOTHING in the work numbers', rep.totals.submissions === 3 && rep.totals.client_submissions === 2, JSON.stringify(rep.totals));
step('…there is no "candidates added" / "open jobs" figure at all', !('candidates_added' in rep.totals) && !('open_jobs' in rep.totals));
step('the funnel has no Sourced / Screening bars (inventory is not evaluated)', !('Sourced' in rep.funnel) && !('Screening' in rep.funnel) && !rep.stages.includes('Sourced'));
step('the funnel counts who REACHED each stage: 3 sent to BDM, 2 to the client, 1 interviewed, 1 placed', rep.funnel['Submitted to BDM'] === 3 && rep.funnel['Submitted to Client'] === 2 && rep.funnel['Interview Scheduled'] === 1 && rep.funnel['Placement'] === 1, JSON.stringify(rep.funnel));
const thisWeek = rep.trend.find(t => t.week === 'This wk');
step('the trend dates the work by SENDING: Ada (row created 30 days ago, sent 2 days ago) is THIS week', thisWeek.to_bdm >= 1 && rep.trend.find(t => t.ago === 4).to_bdm === 0, JSON.stringify(rep.trend.map(t => [t.ago, t.to_bdm, t.to_client])));
step('…and the 40 added candidates are not in any week', rep.trend.reduce((n, t) => n + t.to_bdm, 0) === 3);
step('everyone in the team is evaluated — Idle Ian is there with zeros; the admin (not a worker) is not', rep.by_user.some(u => u.recruiter === 'Idle Ian' && u.to_bdm === 0 && u.fill_rate === null) && !rep.by_user.some(u => u.recruiter === 'Admin'));
const rita_ = rep.by_user.find(u => u.user_id === 'u-r');
step('per-person: Rita sent 2 to BDM, 1 to client, 1 interview, 1 placement, and no "total" of added candidates', rita_.to_bdm === 2 && rita_.to_client === 1 && rita_.interviews === 1 && rita_.placements === 1 && !('total' in rita_) && rita_.revenue === 5000, JSON.stringify(rita_));
step('placed % is of those SENT to a client (1 of 1), not of everything added', rita_.fill_rate === 100);

// the drill-down: same rows as the numbers
const rows = async (metric, extra, user) => (await call('GET /reports/recruiting/rows', user || admin, Object.assign({ metric }, extra || {}))).body;
const agree = [['to_bdm', rep.totals.submissions], ['to_client', rep.totals.client_submissions], ['interviews', rep.totals.interviews], ['placements', rep.totals.placements], ['stalled', rep.totals.stalled_at_bdm],
  ['reached:Submitted to BDM', rep.funnel['Submitted to BDM']], ['reached:Placement', rep.funnel['Placement']]];
for (const [m, n] of agree) { const b = await rows(m); step(`drill-down "${m}" lists exactly the ${n} the report counts`, b.total === n && b.rows.length === n, b.total + '/' + b.rows.length); }
const toClient = await rows('to_client');
step('a row names the candidate, job, client, stage, the day, and the person', toClient.rows.some(x => x.candidate === 'Grace Hopper' && x.job_title === 'Estimator' && x.client === 'Acme' && x.stage === 'Placement' && x.recruiter === 'Rita' && x.candidate_id === 'c2' && /^\d{4}-/.test(x.at)), JSON.stringify(toClient.rows[0]));
step('newest first', toClient.rows.length < 2 || toClient.rows[0].at >= toClient.rows[1].at);
step('narrowing by person: Rita\'s sent-to-BDM is her 2', (await rows('to_bdm', { user_id: 'u-r' })).total === 2);
step('narrowing by client / job works too', (await rows('to_client', { client: 'Acme' })).total === 2 && (await rows('to_bdm', { job_order_id: 'jo1' })).total === 3);
const wk = (await call('GET /reports/recruiting/rows', admin, { kind: 'to_bdm', ago: 0 })).body;
step('a trend column opens exactly its week', wk.total === thisWeek.to_bdm, wk.total + ' vs ' + thisWeek.to_bdm);
step('a nonsense metric is refused, never guessed', (await call('GET /reports/recruiting/rows', admin, { metric: 'drop table' })).status === 400 && (await call('GET /reports/recruiting/rows', admin, { kind: 'to_bdm', ago: 99 })).status === 400);
step('a period filters by the day of the work: a 3-day window sees Ada (2d) but not the client send 20 days ago',
  (await rows('to_bdm', { from: new RealDate(FIXED - 3 * DAY).toISOString().slice(0, 10), to: new RealDate(FIXED).toISOString().slice(0, 10) })).total === 1);
const mine = (await call('GET /reports/recruiting', rita)).body, mineRows = await rows('to_client', {}, rita);
step('scope: Rita sees only her own work in the report AND in the drill-down (Omar\'s client send is not hers)', mine.totals.client_submissions === 1 && mineRows.total === 1 && !mineRows.rows.some(x => x.recruiter === 'Omar'));
step('another person\'s id in the filter is refused for a non-admin', (await call('GET /reports/recruiting/rows', rita, { metric: 'to_bdm', user_ids: 'u-o' })).status === 403);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
