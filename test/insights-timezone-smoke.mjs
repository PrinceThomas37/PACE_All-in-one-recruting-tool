// A DAY IS THE VIEWER'S OWN DAY IN LEAD INSIGHTS (R-102, D-0065).
// Owner: "that date according to the system of the user". Lead Insights cut its days at UTC midnight, so a
// person in India saw "today" change at 05:30 and one on the US west coast at 17:00. The browser now sends
// `?tz=<IANA zone>`; "today", "this week", "30 days" and the 7-day chart cut at THAT person's midnight.
//   * the same four leads give 4 / 3 / 1 "today" for UTC / Los Angeles / Kolkata at one fixed instant;
//   * an absent or unknown zone behaves as UTC (what every figure used before);
//   * a plain-date column is not shifted; the 7-day chart's keys are the viewer's days;
//   * the report route and the team route both honour ?tz=, and the zone is echoed back in `windows`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const RealDate = Date, FIXED = RealDate.UTC(2026, 9, 1, 19, 0, 0);   // 1 Oct 19:00 UTC = 12:00 Los Angeles = 00:30 on 2 Oct in Kolkata
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
const bd = require('../services/bd-insights');
const mk = (id, at) => ({ id, stage: 'Assigned', assigned_at: at, company: null, industry: 'x' });
const LEADS = [mk('L1', '2026-10-01T10:00:00Z'), mk('L2', '2026-10-01T18:45:00Z'), mk('L3', '2026-10-01T07:00:00Z'), mk('L4', '2026-10-01T06:59:00Z')];
const today = (tz) => bd.summarise({ jobs: LEADS, emails: [], now: FIXED, tz }).total_today;

step('UTC: all four leads were assigned today', today('UTC') === 4, String(today('UTC')));
step('no zone given behaves as UTC', today(undefined) === 4 && today('') === 4);
step('an unknown zone behaves as UTC (never an error)', today('Mars/Olympus') === 4 && bd.validZone('Mars/Olympus') === 'UTC');
step('Los Angeles: the lead at 06:59 UTC was still yesterday there — 3 today', today('America/Los_Angeles') === 3, String(today('America/Los_Angeles')));
step('Kolkata (already 2 Oct): only the 18:45 UTC lead is today — 1', today('Asia/Kolkata') === 1, String(today('Asia/Kolkata')));
const wk = bd.windows(FIXED, 'Asia/Kolkata');
step('windows carry the viewer\'s today and the zone', wk.today === '2026-10-02' && wk.tz === 'Asia/Kolkata' && wk.last7[6] === '2026-10-02' && wk.last7[0] === '2026-09-26', JSON.stringify(wk));
const s = bd.summarise({ jobs: [{ id: 'd', stage: 'Assigned', assigned_at: '2026-10-01', company: null }], emails: [], now: FIXED, tz: 'Asia/Kolkata' });
step('a plain date column is a day already — not shifted by the zone', s.last_7_leads['2026-10-01'] === 1 && s.total_today === 0);
const e = bd.summarise({ jobs: [], now: FIXED, tz: 'Asia/Kolkata', emails: [
  { status: 'sent', created_at: '2026-10-01T18:40:00Z', sent_at: '2026-10-01T18:40:00Z' },
  { status: 'sent', created_at: '2026-10-01T10:00:00Z', sent_at: '2026-10-01T10:00:00Z' }] });
step('emails sent today uses the viewer\'s day too (Kolkata: 1; the 10:00 UTC one was "yesterday" there)', e.emails_sent_today === 1 && e.last_7_emails['2026-10-02'] === 1 && e.last_7_emails['2026-10-01'] === 1, JSON.stringify(e.last_7_emails));

// ── the routes pass the zone through ─────────────────────────────────────────
const D = { jobs: LEADS.map(l => Object.assign({ assigned_to_bd: 'me', org_id: 'o', deleted_at: null, contacts: [] }, l)), emails: [], users: [{ id: 'me', name: 'Me', role: 'bd', roles: ['bd'], manager_id: null, org_id: 'o', deleted_at: null }] };
function q(table) { const f = []; const api = { select: () => api, eq: (k, v) => (f.push(r => r[k] === v), api), is: (k, v) => (f.push(r => (r[k] == null) === (v == null)), api), gte: () => api, order: () => api, range: () => api,
  then(a, b) { return Promise.resolve({ data: D[table].filter(r => f.every(x => x(r))), error: null }).then(a, b); } }; return api; }
const router = require('../routes/workflows.js')({ supabase: { from: q }, auth: (_q, _s, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  today: () => '2026-10-01', logActivity() {}, INDUSTRIES: [], normInd: (x) => x, userOrgId: async () => 'o', withOrg: (qq) => qq,
  reportingChainIds: async (id) => [id] });
const handler = (p) => router.stack.find(l => l.route && l.route.path === p).route.stack.slice(-1)[0].handle;
async function call(path, req) { let out = null, status = 200; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await handler(path)(Object.assign({ user: { id: 'me', role: 'admin', roles: ['admin'] }, orgId: 'o', params: { userId: 'me' } }, req), res); return { status, body: out }; }
const personal = async (tz) => (await call('/insights/bd/:userId', { query: tz ? { tz } : {} })).body;
step('the personal route: ?tz=Asia/Kolkata → 1 today; no tz → 4', (await personal('Asia/Kolkata')).total_today === 1 && (await personal()).total_today === 4);
step('the personal route: ?tz=America/Los_Angeles → 3 today', (await personal('America/Los_Angeles')).total_today === 3);
const team = (await call('/insights/bd-team', { query: { tz: 'Asia/Kolkata' } })).body;
step('the team route honours it too, and echoes the zone and the viewer\'s today', team && team.windows.tz === 'Asia/Kolkata' && team.windows.today === '2026-10-02' && team.people[0].total_today === 1, JSON.stringify(team && team.windows));
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
