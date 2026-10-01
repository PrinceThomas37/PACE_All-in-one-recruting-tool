// RA TEAM VIEW: ONE CALCULATION, DRAWN BY THE BROWSER (R-100, owner 2026-09-30).
// The RA Team table was added up in the browser from whatever jobs the page held, with a hard-coded
// India offset, while the personal RA report used a different "week". Now services/ra-insights.js is the
// only place the numbers are worked out, GET /insights/ra-team and GET /insights/ra/:id both call it.
//   * the team figures for a person equal that person's own report (today / 7 days / 30 days);
//   * a day is the viewer's day (?tz=); "7 days" is seven calendar days including today (no 8-day week);
//   * assigned % and converted % are over everything the RA created; duplicates are counted;
//   * scope: admin sees every RA in the company, a lead sees the RAs under them, never themselves or outsiders;
//   * the screen draws the SERVER's numbers even when the browser holds contradicting jobs.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const RealDate = Date, FIXED = RealDate.UTC(2026, 9, 1, 19, 0, 0);   // 1 Oct 19:00 UTC · 00:30 on 2 Oct in Kolkata
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
const ra = require('../services/ra-insights');
const J = (id, stage, at, extra) => Object.assign({ id, stage, created_at: at, is_duplicate: false }, extra);
const JOBS = [
  J('a', 'Unassigned', '2026-10-01T18:45:00Z'),                 // today in Kolkata, today in UTC/LA
  J('b', 'Assigned',   '2026-10-01T10:00:00Z'),                 // today UTC/LA, yesterday Kolkata
  J('c', 'Connected',  '2026-09-27T10:00:00Z', { is_duplicate: true }),
  J('d', 'In Discussion', '2026-09-25T10:00:00Z'),              // 6 days before 1 Oct — inside UTC's 7 days; Kolkata's 7 start 26 Sep
  J('e', 'Assigned',   '2026-08-01T10:00:00Z'),                 // old: counts in the totals only
];
const u = ra.summarise({ jobs: JOBS, now: FIXED, tz: 'UTC' });
step('UTC: today 2, 7 days 4, 30 days 4, total 5', u.today === 2 && u.week === 4 && u.month === 4 && u.total === 5, JSON.stringify(u));
const k = ra.summarise({ jobs: JOBS, now: FIXED, tz: 'Asia/Kolkata' });
step('Kolkata (already 2 Oct): today 1, 7 days 3 — the viewer\'s own days', k.today === 1 && k.week === 3, JSON.stringify(k));
step('assigned % and converted % are over everything created; duplicates counted', u.assigned === 4 && u.assignPct === 80 && u.conv === 2 && u.convPct === 40 && u.dups === 1, JSON.stringify(u));
step('"7 days" is seven calendar days including today, never eight', Object.keys(u.last_7).length === 7 && Object.values(u.last_7).reduce((a, b) => a + b, 0) === u.week);
step('a plain created_date column is not shifted', ra.summarise({ jobs: [{ id: 'x', stage: 'Assigned', created_date: '2026-10-01' }], now: FIXED, tz: 'Asia/Kolkata' }).week === 1);


// ── the Dashboard's periods (R-106): the same rows cut four ways, one calculation ──────────────────
const pj = ra.summarise({ jobs: JOBS.map((j, i) => Object.assign({}, j, { industry: i % 2 ? 'Energy' : 'Healthcare' })), now: FIXED, tz: 'UTC' }).periods;
step('periods: daily 2 (the two leads of 1 Oct), weekly 4, monthly (calendar October) 2, quarterly 5', pj.daily.total === 2 && pj.weekly.total === 4 && pj.monthly.total === 2 && pj.quarterly.total === 5, JSON.stringify(Object.fromEntries(Object.entries(pj).map(([k, v]) => [k, v.total]))));
step('periods carry the breakdowns the card draws (stage, industry, duplicates, converted %)', pj.weekly.by_stage.Assigned === 1 && pj.weekly.by_industry.Healthcare >= 1 && pj.weekly.dups === 1 && pj.weekly.converted === 2 && pj.weekly.convRate === 50, JSON.stringify(pj.weekly));
step('periods follow the viewer\'s zone: Kolkata daily is 1, not 2', ra.summarise({ jobs: JOBS, now: FIXED, tz: 'Asia/Kolkata' }).periods.daily.total === 1);

// ── the routes ───────────────────────────────────────────────────────────────
const USERS = [
  { id: 'lead', name: 'RA Lead', role: 'ra_lead', roles: ['ra_lead'], manager_id: null, org_id: 'o' },
  { id: 'r1', name: 'Asha', role: 'ra', roles: ['ra'], manager_id: 'lead', org_id: 'o' },
  { id: 'r2', name: 'Ben', role: 'ra', roles: ['ra'], manager_id: null, org_id: 'o' },     // not under the lead
];
const D = { users: USERS.map(x => Object.assign({ deleted_at: null }, x)), jobs: [] };
JOBS.forEach(j => D.jobs.push(Object.assign({ created_by: 'r1', org_id: 'o', deleted_at: null }, j)));
D.jobs.push({ id: 'z', created_by: 'r2', org_id: 'o', deleted_at: null, stage: 'Assigned', created_at: '2026-10-01T10:00:00Z', is_duplicate: false });
function q(table) { const f = []; const api = { select: () => api, eq: (c, v) => (f.push(r => r[c] === v), api), is: (c, v) => (f.push(r => (r[c] == null) === (v == null)), api), gte: (c, v) => (f.push(r => String(r[c] || '') >= String(v)), api), order: () => api, range: () => api,
  then(a, b) { return Promise.resolve({ data: D[table].filter(r => f.every(x => x(r))), error: null }).then(a, b); } }; return api; }
const reportingChainIds = async (id) => { const out = new Set([id]); const qq = [id]; while (qq.length) { const c = qq.shift(); D.users.filter(x => x.manager_id === c).forEach(x => { if (!out.has(x.id)) { out.add(x.id); qq.push(x.id); } }); } return [...out]; };
const router = require('../routes/workflows.js')({ supabase: { from: q }, auth: (_a, _b, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  today: () => '2026-10-01', logActivity() {}, INDUSTRIES: [], normInd: (x) => x || 'Unknown', userOrgId: async () => 'o', withOrg: (x) => x, reportingChainIds });
const handler = (p) => router.stack.find(l => l.route && l.route.path === p).route.stack.slice(-1)[0].handle;
async function call(p, req) { let out = null, status = 200; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await handler(p)(Object.assign({ orgId: 'o', params: {}, query: {} }, req), res); return { status, body: out }; }
const admin = { user: { id: 'adm', role: 'admin', roles: ['admin'] } }, lead = { user: { id: 'lead', role: 'ra_lead', roles: ['ra_lead'] } };
const team = (await call('/insights/ra-team', Object.assign({ query: { tz: 'Asia/Kolkata' } }, admin))).body;
const asha = team.people.find(p => p.id === 'r1');
step('admin: the team lists every RA in the company', team.people.map(p => p.id).sort().join() === 'r1,r2', team.people.map(p => p.id).join());
step('the team row for a person is the calculation above (Kolkata: today 1, 7 days 3)', asha && asha.today === 1 && asha.week === 3 && asha.total === 5, JSON.stringify(asha));
const mine = (await call('/insights/ra/:userId', Object.assign({ params: { userId: 'r1' }, query: { tz: 'Asia/Kolkata' } }, admin))).body;
step('the personal report agrees with the team row (today / 7 days / 30 days)', mine.total_today === asha.today && mine.total_week === asha.week && mine.total_month === asha.month, JSON.stringify([mine.total_today, mine.total_week, mine.total_month]));
const lt = (await call('/insights/ra-team', lead)).body;
step('a lead sees only the RAs under them — not themselves, not outsiders', lt.scope === 'team' && lt.people.map(p => p.id).join() === 'r1', lt.people.map(p => p.id).join());

// ── the screen ───────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
let browser; const errs = []; const seen = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext();
  const SERVER_TEAM = { scope: 'org', windows: {}, people: [{ id: 'r1', name: 'Asha', role: 'ra', total: 77, today: 9, week: 33, month: 55, dups: 4, assigned: 60, assignPct: 78, conv: 11, convPct: 14 }] };
  await ctx.route('**', r => { const url = r.request().url(); if (url.startsWith(BASE)) return r.continue(); const p = new URL(url).pathname; seen.push(p + new URL(url).search); if (p === '/insights/ra-team') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVER_TEAM), headers: { 'access-control-allow-origin': '*' } }); if (url.includes('onrender.com') || url.includes('127.0.0.1')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } }); return r.abort(); });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, { id: 'lead', name: 'RA Lead', role: 'ra_lead', roles: ['ra_lead'] });
  await page.evaluate(() => {
    // the browser holds jobs that CONTRADICT the server — the screen must not add these up
    STATE.users = [{ id: 'r1', name: 'Asha', role: 'ra', roles: ['ra'] }];
    STATE.jobs = [{ id: 'j1', created_by: 'r1', stage: 'Assigned', created_date: new Date().toISOString().slice(0, 10) }];
    STATE.raTeamInsights = null; STATE.insightsSelectedRA = null; STATE.page = 'insights'; render();
  });
  await page.waitForFunction(() => /Asha/.test(document.getElementById('content').innerText), null, { timeout: 8000 }).catch(() => {});
  const text = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('the RA Team table shows the server\'s row (9 today · 33 · 55 · 4 duplicates · 78% · 14%)', /Asha/.test(text) && /\b9\b/.test(text) && /\b33\b/.test(text) && /\b55\b/.test(text) && /78%/.test(text) && /14%/.test(text), text.slice(0, 260));
  step('…and not the one lead the browser holds', !/\b1 leads\b/.test(text) && /77 leads/.test(text), text.slice(0, 160));
  step('the browser asked the server, with its own time zone', seen.some(s => /^\/insights\/ra-team\?tz=/.test(s)), JSON.stringify(seen));
  step('No page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
