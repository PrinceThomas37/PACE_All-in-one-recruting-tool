// THE LEAD INSIGHTS NUMBERS MUST AGREE WITH THE REST OF THE APP (owner, 2026-09-30).
// Screenshots: Lead Insights said "Emails sent 0 / Sent today 0 / Sent (month) 0 / Pending 0 /
// Failed 0" while Email → Sent said "311 total"; and "Leads this week 110" sat over a 7-day
// chart whose bars add to 85.
//   1. `emails` has NO `assigned_to` column — an email belongs to `sent_by`. The route asked for
//      `assigned_to`, the database answered with an error, the error was ignored, and every email
//      number was a confident zero. The fake below knows the LIVE column list (read from the
//      database 2026-09-30) and answers 42703 for anything else, exactly as Postgres does.
//   2. "this week" used `today - 7` (EIGHT calendar days) while the chart shows seven: the tile
//      and the chart must be one definition.
//   3. A failed read must FAIL (500), never read as "no leads / no emails".
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const EMAIL_COLS = ['id','contact_id','job_id','to_email','subject','body','platform','sent_by','status','sent_at','created_at','from_email','followup_type','follow_up_id','graph_message_id','conversation_id','in_reply_to_graph_message_id','template_variant','sending_email_id','org_id','attempt_count','next_attempt_at','fail_kind','fail_reason'];
const JOB_COLS = ['id','stage','industry','position','assigned_at','assigned_to_bd','deleted_at','org_id','company_id'];
const COLS = { emails: EMAIL_COLS, jobs: JOB_COLS };
const ORG = 'org-a', ME = 'bd-lead-1';
const DAY = 86400000, now = Date.now();
const iso = (n) => new Date(now - n * DAY).toISOString();
const D = {
  jobs: [], emails: [],
};
// 110 leads: 15 assigned 5 days ago, 22 three days ago, 48 two days ago, 25 exactly SEVEN days ago (the eighth calendar day the old tile wrongly included)
const addLeads = (n, daysAgo, stage) => { for (let i = 0; i < n; i++) D.jobs.push({ id: 'j' + D.jobs.length, assigned_to_bd: ME, org_id: ORG, deleted_at: null, stage: stage || 'Assigned', assigned_at: iso(daysAgo), position: 'x', industry: 'x', company: null }); };
addLeads(15, 5); addLeads(22, 3); addLeads(48, 2); addLeads(19, 7); addLeads(6, 7, 'Connected');
// 311 sent by me in the last 30 days, 4 today; someone else's emails must not count
for (let i = 0; i < 311; i++) D.emails.push({ id: 'e' + i, sent_by: ME, org_id: ORG, status: 'sent', created_at: iso(i % 25), sent_at: i < 4 ? new Date(now - 3600000).toISOString() : iso(i % 25) });
for (let i = 0; i < 50; i++) D.emails.push({ id: 'o' + i, sent_by: 'someone-else', org_id: ORG, status: 'sent', created_at: iso(1), sent_at: iso(1) });
D.emails.push({ id: 'p1', sent_by: ME, org_id: ORG, status: 'pending', created_at: iso(0), sent_at: null });
D.emails.push({ id: 'f1', sent_by: ME, org_id: ORG, status: 'failed', created_at: iso(1), sent_at: null });

let failNext = null;
function q(table) {
  const st = { f: [] };
  const check = (col) => { if (!COLS[table].includes(col)) throw Object.assign(new Error(`column ${table}.${col} does not exist`), { code: '42703' }); };
  const api = {
    select(list) { String(list || '').replace(/\w+:\w+\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(s => s && !s.includes(':') && !s.includes('(')).forEach(c => { try { check(c); } catch (e) { st.err = e; } }); return api; },
    eq(k, v) { try { check(k); } catch (e) { st.err = e; } st.f.push(r => r[k] === v); return api; },
    is(k, v) { st.f.push(r => (r[k] == null) === (v == null)); return api; },
    gte(k, v) { try { check(k); } catch (e) { st.err = e; } st.f.push(r => String(r[k] || '') >= String(v)); return api; },
    then(a, b) { const err = st.err || (failNext && failNext === table && Object.assign(new Error('boom'), { code: 'X' })); if (err) return Promise.resolve({ data: null, error: { code: err.code, message: err.message } }).then(a, b); return Promise.resolve({ data: D[table].filter(r => st.f.every(f => f(r))), error: null }).then(a, b); },
  };
  return api;
}
const supabase = { from: q };
const routes = {};
const router = require('../routes/workflows.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  today: () => new Date().toISOString().slice(0, 10), logActivity() {}, INDUSTRIES: [], normInd: (x) => x, userOrgId: async () => ORG,
  withOrg: (qq) => qq, reportingChainIds: async () => [] });
const h = router.stack.find(l => l.route && l.route.path === '/insights/bd/:userId').route.stack.slice(-1)[0].handle;
async function call() { let status = 200, out = null; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await h({ params: { userId: ME }, user: { id: ME, role: 'bd_lead', roles: ['bd_lead'] }, orgId: ORG }, res); return { status, body: out }; }

const r = await call();
const b = r.body || {};
step('the report answers', r.status === 200 && !!b.total_all, JSON.stringify(r.body).slice(0, 80));
step('emails sent this month = the 311 the Email page shows (was a confident 0)', b.emails_sent === 311, String(b.emails_sent));
const todayStr = new Date().toISOString().slice(0, 10);
const wantToday = D.emails.filter(e => e.sent_by === ME && e.status === 'sent' && String(e.sent_at).slice(0, 10) === todayStr).length;
step('sent today counts today\'s (and only mine)', wantToday > 0 && b.emails_sent_today === wantToday, b.emails_sent_today + ' vs ' + wantToday);
step('pending and failed are read too', b.emails_pending === 1 && b.emails_failed === 1, b.emails_pending + '/' + b.emails_failed);
step('the 7-day email chart adds up to something, not zeros', Object.values(b.last_7_emails || {}).reduce((a, c) => a + c, 0) > 0);
const chart = Object.values(b.last_7_leads || {}).reduce((a, c) => a + c, 0);
step('"leads this week" equals what the 7-day chart adds up to — one definition', b.total_week === chart && chart === 85, b.total_week + ' vs chart ' + chart);
step('the leads assigned 7 days ago are NOT in "this week" but are in the 30 days', b.total_week === 85 && b.total_month === 110, b.total_week + '/' + b.total_month);
failNext = 'emails';
const bad = await call();
step('a failed email read FAILS the report (500) — never a plausible zero', bad.status === 500, String(bad.status));
failNext = 'jobs';
const bad2 = await call();
step('a failed leads read FAILS it too', bad2.status === 500, String(bad2.status));
console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
