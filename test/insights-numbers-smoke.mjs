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
const USER_COLS = ['id','name','email','role','is_active','deleted_at','roles','org_id','manager_id'];
const COLS = { emails: EMAIL_COLS, jobs: JOB_COLS, users: USER_COLS, contacts: ['id','email_status','org_id'], email_tracking: ['email_id','open_count','org_id'] };
const ORG = 'org-a', ME = 'bd-lead-1';
const DAY = 86400000, now = Date.now();
const iso = (n) => new Date(now - n * DAY).toISOString();
const D = {
  jobs: [], emails: [], users: [], contacts: [], email_tracking: [],
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
    select(list) { String(list || '').replace(/(\w+:)?\w+\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(s => s && !s.includes(':') && !s.includes('(')).forEach(c => { try { check(c); } catch (e) { st.err = e; } }); return api; },
    eq(k, v) { try { check(k); } catch (e) { st.err = e; } st.f.push(r => r[k] === v); return api; },
    is(k, v) { st.f.push(r => (r[k] == null) === (v == null)); return api; },
    gte(k, v) { try { check(k); } catch (e) { st.err = e; } st.f.push(r => String(r[k] || '') >= String(v)); return api; },
    in(k, vs) { try { check(k); } catch (e) { st.err = e; } st.f.push(r => vs.includes(r[k])); return api; },
    order() { return api; },
    range(a, b) { st.range = [a, b]; return api; },
    then(a, b) { const err = st.err || (failNext && failNext === table && Object.assign(new Error('boom'), { code: 'X' })); if (err) return Promise.resolve({ data: null, error: { code: err.code, message: err.message } }).then(a, b); let rows = D[table].filter(r => st.f.every(f => f(r))); if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1); return Promise.resolve({ data: rows, error: null }).then(a, b); },
  };
  return api;
}
const supabase = { from: q };
const routes = {};
const router = require('../routes/workflows.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  today: () => new Date().toISOString().slice(0, 10), logActivity() {}, INDUSTRIES: [], normInd: (x) => x, userOrgId: async () => ORG,
  withOrg: (qq) => qq,
  // the real rule (hierarchy.js): me + everyone under me on manager_id
  reportingChainIds: async (id) => { const out = new Set([id]); const q = [id]; while (q.length) { const c = q.shift(); D.users.filter(u => u.manager_id === c).forEach(u => { if (!out.has(u.id)) { out.add(u.id); q.push(u.id); } }); } return [...out]; } });
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

// ═══ ONE SOURCE: the team report gives each person EXACTLY their personal numbers ═══
failNext = null;
const OTHER = 'bd-2', OUTSIDER = 'bd-3', BOSS = 'lead-x';
D.users.push({ id: ME, name: 'BD Lead 1', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG, manager_id: BOSS, deleted_at: null },
  { id: OTHER, name: 'BD 2', role: 'bd', roles: ['bd'], org_id: ORG, manager_id: ME, deleted_at: null },
  { id: OUTSIDER, name: 'BD 3', role: 'bd', roles: ['bd'], org_id: ORG, manager_id: 'nobody', deleted_at: null },
  { id: BOSS, name: 'Boss', role: 'director', roles: ['director'], org_id: ORG, manager_id: null, deleted_at: null });
for (let i = 0; i < 10; i++) D.jobs.push({ id: 'k' + i, assigned_to_bd: OTHER, org_id: ORG, deleted_at: null, stage: i < 2 ? 'Connected' : 'Assigned', assigned_at: iso(1), position: 'x', industry: 'x', company: null });
for (let i = 0; i < 5; i++) D.emails.push({ id: 'x' + i, sent_by: OTHER, org_id: ORG, status: 'sent', created_at: iso(1), sent_at: iso(1), contact_id: 'cx' + i });
// delivery: of the 5 people emailed, one address turned out invalid; 3 of the 5 emails were sent with open tracking and 1 of those was opened
for (let i = 0; i < 5; i++) D.contacts.push({ id: 'cx' + i, org_id: ORG, email_status: i === 0 ? 'invalid' : 'valid' });
D.email_tracking.push({ email_id: 'x0', org_id: ORG, open_count: 0 }, { email_id: 'x1', org_id: ORG, open_count: 2 }, { email_id: 'x2', org_id: ORG, open_count: 0 }, { email_id: 'x4', org_id: 'other-org', open_count: 9 });
const teamH = router.stack.find(l => l.route && l.route.path === '/insights/bd-team').route.stack.slice(-1)[0].handle;
async function callTeam(user) { let status = 200, out = null; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await teamH({ params: {}, user, orgId: ORG }, res); return { status, body: out }; }
const personalOf = async (id) => { let out; const res = { status() { return res; }, json(j) { out = j; return res; } };
  await h({ params: { userId: id }, user: { id: ME, role: 'admin', roles: ['admin'] }, orgId: ORG }, res); return out; };

const admin = { id: 'adm', role: 'admin', roles: ['admin'] };
const t = await callTeam(admin);
const names = ((t.body || {}).people || []).map(x => x.name).sort().join(',');
step('admin: the team report lists every BD in the company', names === 'BD 2,BD 3,BD Lead 1', names);
const meInTeam = ((t.body || {}).people || []).find(x => x.id === ME);
const mePersonal = await personalOf(ME);
const keys = ['total_all', 'total_week', 'total_month', 'emails_sent', 'emails_sent_today', 'emails_pending', 'emails_failed', 'conv_rate', 'reply_rate', 'replied'];
step('the team report and the personal report give the SAME number for every figure (one calculation)', !!meInTeam && keys.every(k => meInTeam[k] === mePersonal[k]), keys.filter(k => !meInTeam || meInTeam[k] !== mePersonal[k]).join(',') || 'all equal');
const tl = await callTeam({ id: ME, role: 'bd_lead', roles: ['bd_lead'] });
const tlNames = ((tl.body || {}).people || []).map(x => x.name).join(',');
step('a lead sees the BDs under them — not themselves, not anyone outside their line', tlNames === 'BD 2' && tl.body.scope === 'team', tlNames);
step('…and their numbers are the real ones (10 leads, 5 emails)', (tl.body.people[0] || {}).total_all === 10 && tl.body.people[0].emails_sent === 5);

// ═══ REPLY RATE is replies, not "moved to Connected" ═══
const repliedIds = D.jobs.filter(j => j.assigned_to_bd === ME).slice(0, 11).map(j => j.id);
D.jobs.filter(j => repliedIds.includes(j.id)).forEach(j => { j.contacts = [{ replied_at: iso(2) }]; });   // 11 of 110 replied (10%)
const rr = await personalOf(ME);
step('reply rate = leads with a recorded reply / leads (11 of 110 = 10%), independent of stage', rr.replied === 11 && rr.reply_rate === 10 && rr.response_rate === 10, rr.replied + ' / ' + rr.reply_rate + '%');
step('…while "conversion" is still the stage-based figure (6 of 110 = 5%) — the two are no longer the same number', rr.conv_rate === 5 && rr.reply_rate !== rr.conv_rate, rr.conv_rate + '% vs ' + rr.reply_rate + '%');

// ═══ more than 1,000 rows: a page boundary must not silently cut the count ═══
for (let i = 0; i < 1200; i++) D.emails.push({ id: 'big' + i, sent_by: OTHER, org_id: ORG, status: 'sent', created_at: iso(2), sent_at: iso(2) });
const big = await personalOf(OTHER);
step('1,205 sent emails are all counted (PostgREST caps a request at 1,000 rows)', big.emails_sent === 1205, String(big.emails_sent));
failNext = 'users';
const badT = await callTeam(admin);
step('a failed read fails the team report too (500), never an empty team', badT.status === 500, String(badT.status));

// ═══ BOUNCE RATE AND OPEN RATE (owner, 8 Oct) — moved here from the Deliverability tab ═══
const dv = await personalOf(OTHER);
step('bounce rate = of the people emailed, the share whose address turned out invalid (1 of 5 = 20%), to one decimal', dv.contacts_emailed === 5 && dv.bounced === 1 && dv.bounce_rate === 20, JSON.stringify([dv.contacts_emailed, dv.bounced, dv.bounce_rate]));
step('open rate = of the TRACKED emails, the share opened (1 of 3 = 33.3%) — another organisation\'s tracking row is not counted', dv.open_tracked === 3 && dv.opened === 1 && dv.open_rate === 33.3, JSON.stringify([dv.open_tracked, dv.opened, dv.open_rate]));
const none = await personalOf(ME);
step('nobody emailed with tracking → the rates are "not measured" (null), never a made-up 0%', none.open_rate === null && none.open_tracked === 0, JSON.stringify([none.bounce_rate, none.open_rate]));
failNext = 'contacts';
const dvBad = await personalOf(OTHER);
step('a failed read of the delivery data leaves the rates unmeasured (null) but the rest of the report still answers', dvBad && dvBad.bounce_rate === null && dvBad.open_rate === null && dvBad.emails_sent === 1205, JSON.stringify([dvBad && dvBad.bounce_rate, dvBad && dvBad.emails_sent]));
failNext = null;

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
