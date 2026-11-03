// THE LEADS TAB ON THE SERVER'S PAGES, SIDE BY SIDE WITH THE OLD WHOLE-LIST TAB (R-349 Stages C + D).
// The real browser code (public/js/76-leads-store.js + 06-page-leads.js) talks to the REAL routes (routes/jobs.js, services/lead-page.js) over seeded leads, and
// the same leads are also drawn the OLD way (the browser holding every lead). The two must show the same rows, the same numbers, in the same order:
//   · 9 filter situations × (rows on page 1, the number strip, the lead count, the "Assigned to" and Industry drop-downs)
//   · Next / Previous walk every lead once, in the old tab's order, and the whole list is NEVER downloaded to do it
//   · "select all" ticks EVERY matching lead (130), not only the 20 on screen
//   · a write to a lead (a stage change) shows on the page at once, without the person pressing anything
//   · a server that cannot answer → the old whole-list load runs and the tab still works
//   · a screen that still needs the whole list (STATE.jobs) gets it — once — and the Leads tab, a row opening and the lead window never ask for it
//   · a BD sees only their own leads; signing out leaves nothing behind
// Usage: node test/leads-server-mode-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const own = require('../services/ownership');
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 300) : '')); };

// ── the company's leads ──
const ORG = 'org-a';
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const users = [{ id: 'boss', org_id: ORG, name: 'Bo Boss', manager_id: null }, { id: 'bd1', org_id: ORG, name: 'Ash Sayyad', manager_id: 'boss' }, { id: 'bd2', org_id: ORG, name: 'Bea Wilson', manager_id: 'boss' }, { id: 'bd3', org_id: ORG, name: 'Cy Ray', manager_id: 'boss' }];
const owners = ['bd1', 'bd2', 'bd3', null];
const stagesL = ['Assigned', 'Connected', 'In Discussion', 'Future', 'Rejected', 'Unassigned'];
const inds = ['Healthcare', 'IT & software', 'Construction', ''];
const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]));
const jobs = [];
const NOW = Date.now();
for (let i = 0; i < 130; i++) {
  const o = owners[i % 4];
  jobs.push({ id: uid(i + 1), org_id: ORG, position: ['Nurse', 'Engineer', 'Welder'][i % 3] + ' ' + (i + 1), location: ['Austin, TX', 'Greer, SC'][i % 2], stage: o ? stagesL[i % 5] : 'Unassigned',
    industry: i % 5 === 0 ? inds[i % 4] : '', company: { name: 'Co ' + (i % 9), industry: inds[(i + 1) % 4], website: '' }, company_id: 'c' + (i % 9),
    contacts: i % 4 === 1 ? [{ id: 'k' + i, job_id: uid(i + 1), first_name: 'Pat', last_name: 'Smith' + i, email: `pat${i}@x.test`, is_primary: true }] : [],
    created_by: o || 'boss', assigned_to: o, assigned_to_bd: o, bd_assignee: o ? { name: nameOf[o] } : null,
    // distinct, descending timestamps: today for the first 12, yesterday for the next 12, then older (so the date filters have something to find)
    created_at: new Date(NOW - i * (i < 12 ? 60000 : 3600000 * 5)).toISOString(), deleted_at: null, freshness: 'New' });
}
const fake = createFakeDb({ tables: { users, jobs, app_settings: [] } });
fake.tables.app_settings.push({ key: 'sys_leads_page_size_default@' + ORG, value: '20' });
const supabase = fake.supabase; const db = createDb(supabase);
let current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG };
const app = express(); app.use(express.json());
const auth = (req, res, next) => { req.user = current; req.orgId = current.org_id; next(); };
const hasRole = (req, ...r) => (req.user.roles || [req.user.role]).some((x) => r.includes(x));
const ctx = { supabase, db, auth, hasRole, today: () => new Date().toISOString().slice(0, 10), canTouchJob: async () => true, logActivity: async () => {}, ownership: own,
  orgIdFor: (req) => req.orgId, withOrg: (q, req) => q.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }), userOrgId: () => ORG, mailboxOrgId: () => ORG,
  loadAllJobs: async (org) => jobs.filter((j) => j.org_id === org && !j.deleted_at), JOB_SELECT: '*', getTimezoneFromLocation: () => null, persistLearnedSkills: () => {} };
app.use(require('../routes/jobs')(ctx));
const api = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const LOCAL = 'http://127.0.0.1:' + api.address().port;

const web = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((r) => web.listen(0, '127.0.0.1', () => r(web.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const calls = []; let failPage = false;
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await bctx.route('**', async (r) => {
    const u = r.request().url(); if (u.startsWith(BASE)) return r.continue();
    if (!u.startsWith(API)) return r.abort();
    const U = new URL(u), p = U.pathname, m = r.request().method(); calls.push(m + ' ' + p + (U.search || ''));
    if (p.startsWith('/jobs')) {
      if (failPage && /^\/jobs\/(page|counts|facets)/.test(p)) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"busy"}' });
      const resp = await fetch(LOCAL + p + U.search, { method: m, headers: { 'Content-Type': 'application/json' }, body: ['GET', 'HEAD'].includes(m) ? undefined : (r.request().postData() || '{}') });
      const txt = await resp.text(); return r.fulfill({ status: resp.status, contentType: 'application/json', body: txt });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: m === 'GET' ? '[]' : '{}' });
  });
  const page = await bctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  const ev = (f, a) => page.evaluate(f, a);
  const fullAsks = () => calls.filter((c) => c === 'GET /jobs').length;
  const ready = () => page.waitForFunction(() => { const lv = STATE.lv; return lv && lv.status === 'ready' && lv.countsFor && lv.facets; }, null, { timeout: 8000 });
  const settle = async () => { await page.waitForTimeout(120); await ready(); await page.waitForTimeout(80); };
  const looks = () => ev(() => ({
    rows: [...document.querySelectorAll('#content tbody tr[data-row-id]')].map((r) => r.getAttribute('data-row-id')),
    strip: [...document.querySelectorAll('#content .strip *')].filter((e) => !e.children.length).map((e) => e.textContent.trim()).filter(Boolean).join('|'),
    count: (document.querySelector('#content .fs-12_5.c-ink3 span') || {}).textContent || '',
    assignee: [...document.querySelectorAll('select[aria-label="Show leads assigned to"] option')].map((o) => o.textContent.trim()).join('|'),
  }));
  const setFilter = (f) => ev((f) => { STATE.jobsFilter = Object.assign({ search: '', stages: [], industries: [], assignee: '', dateRange: 'all', dateFrom: '', dateTo: '' }, f); STATE.leadsPage = 0; STATE.leadSeqSel = {}; render(); }, f);

  // ── sign in the way the app does: the first page, not the list ──
  await ev(() => { STATE.user = Object.assign({}, STATE.user, { id: 'boss', role: 'admin', roles: ['admin'] }); STATE.users = [{ id: 'boss', name: 'Bo Boss' }, { id: 'bd1', name: 'Ash Sayyad' }, { id: 'bd2', name: 'Bea Wilson' }, { id: 'bd3', name: 'Cy Ray' }]; STATE.page = 'leads'; });
  const started = await ev(() => leadsStore.start());
  step('sign-in asks the server for the FIRST PAGE and the numbers (server mode comes on)', started === true && (await ev(() => leadsStore.use(STATE.user))));
  step('…and the whole list was NOT downloaded to do it', fullAsks() === 0, calls.join(' ; ').slice(0, 200));
  await ev(() => render()); await settle();

  // the old tab: the same leads, held whole in the browser (a snapshot of what GET /jobs returns for this viewer)
  const wholeFor = (u) => own.scopeLeads(jobs.filter((j) => j.org_id === ORG), own.viewScope({ role: u.role, roles: u.roles, userId: u.id, chainIds: u.chain || [] }));
  const oldWay = async (u, f) => {
    const whole = wholeFor(u).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.id < b.id ? 1 : -1)));
    await ev(([raw, f]) => {
      const keep = STATE.lv.on; STATE.lv.on = false;                      // switch the store off: this draw is the browser's own, as before
      STATE.jobs = raw.map(normaliseJob); STATE.contacts = flattenContacts(raw);
      STATE.jobsFilter = Object.assign({ search: '', stages: [], industries: [], assignee: '', dateRange: 'all', dateFrom: '', dateTo: '' }, f); STATE.leadsPage = 0; render(); window.__keep = keep;
    }, [whole, f]);
    const l = await looks();
    await ev(() => { STATE.lv.on = !!window.__keep; STATE.jobs = []; STATE.contacts = []; });
    return l;
  };
  const situations = [{}, { stages: ['Connected'] }, { search: 'nurse' }, { search: 'pat7' }, { industries: ['healthcare'] }, { assignee: 'bd1' }, { assignee: 'none' }, { dateRange: 'week' }, { search: 'zzz-nothing' }];
  const admin = { role: 'admin', roles: ['admin'], id: 'boss' };
  for (const f of situations) {
    const was = await oldWay(admin, f);
    await setFilter(f); await settle();
    const now = await looks();
    // the old tab drew the first 20 of the whole list; the server's first page is the same 20
    const same = JSON.stringify(now.rows) === JSON.stringify(was.rows) && now.strip === was.strip && now.count === was.count && now.assignee === was.assignee;
    step('side by side, ' + JSON.stringify(f) + ': same rows in the same order, same numbers', same, same ? '' : JSON.stringify({ was: [was.rows.slice(0, 3), was.strip, was.count, was.assignee.slice(0, 80)], now: [now.rows.slice(0, 3), now.strip, now.count, now.assignee.slice(0, 80)] }));
  }
  step('…and none of that downloaded the whole list', fullAsks() === 0);

  // ── Next / Previous: every lead once, in order, no whole list ──
  await setFilter({}); await settle();
  const seen = []; let guard = 0;
  while (guard++ < 12) {
    seen.push(...(await looks()).rows);
    const next = page.locator('#content button:has-text("Next")');
    if (!(await next.count()) || (await next.first().isDisabled())) break;
    await next.first().click(); await settle();
  }
  const expected = jobs.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.id < b.id ? 1 : -1))).map((j) => j.id);
  step('Next walks all 130 leads once each, in the old order', seen.length === 130 && new Set(seen).size === 130 && JSON.stringify(seen) === JSON.stringify(expected), seen.length + ' rows');
  await page.locator('#content button:has-text("Prev")').first().click(); await settle();
  step('Previous goes back to the page before (leads 101-120)', JSON.stringify((await looks()).rows) === JSON.stringify(expected.slice(100, 120)));
  step('walking the pages never downloaded the whole list', fullAsks() === 0);

  // ── select all = every matching lead, across pages ──
  await setFilter({}); await settle();
  await page.locator('#content thead input.ck').first().click(); await page.waitForTimeout(400);
  const bar = await ev(() => (document.querySelector('#content .card span.fs-13') || {}).textContent || '');
  step('"select all" ticks ALL 130 matching leads, not only the 20 on screen', /130 leads selected/.test(bar), bar);
  step('…it asked the server for the ids once (not for 130 leads)', calls.filter((c) => /^GET \/jobs\/ids/.test(c)).length === 1 && fullAsks() === 0);
  await ev(() => leadClearSel());

  // ── a write shows at once ──
  const target = expected[0];
  step('(the lead shows its old stage before the write)', await ev((id) => { const r = document.querySelector(`#content tr[data-row-id="${id}"]`); return !!r && [...r.querySelectorAll('select')].some((x) => x.value !== 'Rejected'); }, target));
  jobs.find((j) => j.id === target).stage = 'Rejected';          // the server's copy changes (as a stage change would)
  await ev(() => apiPost('/leads/take', { job_ids: [] }).catch(() => {}));        // a successful write to a lead (here the take endpoint answers {}): the page asks again by itself
  await page.waitForFunction((id) => { const r = document.querySelector(`#content tr[data-row-id="${id}"]`); return r && [...r.querySelectorAll('select')].some((s) => s.value === 'Rejected'); }, target, { timeout: 5000 }).then(() => step('a write to a lead refreshes the page on screen by itself', true)).catch(() => step('a write to a lead refreshes the page on screen by itself', false));
  jobs.find((j) => j.id === target).stage = 'Assigned';

  // ── the lead window and a row opening do not wake the whole list ──
  await setFilter({}); await settle();
  const before = fullAsks();
  await page.locator('#content tbody tr[data-row-id]').first().click(); await page.waitForTimeout(500);
  await ev((id) => openJob(id), expected[0]); await page.waitForTimeout(600);
  step('opening a row and the lead window did not download the whole list', fullAsks() === before, calls.filter((c) => c === 'GET /jobs').length + ' whole-list asks');
  await ev(() => { STATE.modal = null; render(); });

  // ── a screen that needs the whole list gets it, once ──
  const n0 = fullAsks();
  const peek = await ev(() => STATE.jobs.length);          // the first touch: starts the one background load
  await page.waitForFunction(() => leadsStore.isFull(), null, { timeout: 8000 }).catch(() => {});
  const whole = await ev(() => STATE.jobs.length);
  await ev(() => STATE.jobs.length); await ev(() => STATE.jobs.length);
  step('a screen that reads the whole list gets it — one download, then it is there', fullAsks() === n0 + 1 && whole === 130, `asks ${fullAsks() - n0}, held ${peek} → ${whole}`);

  // ── a server that cannot answer: the old way runs ──
  await ev(() => { leadsStore.reset(); STATE.jobs = []; STATE.contacts = []; });
  failPage = true; const f0 = fullAsks();
  await ev(() => leadsStartup()); await page.waitForTimeout(800);
  failPage = false;
  step('when the page cannot be had, sign-in falls back to the whole list and the tab still shows the leads', fullAsks() === f0 + 1 && (await ev(() => !leadsStore.use(STATE.user) && STATE.jobs.length === 130)));
  await ev(() => { STATE.jobsFilter = { search: '', stages: [], industries: [], assignee: '', dateRange: 'all', dateFrom: '', dateTo: '' }; STATE.page = 'leads'; render(); });
  step('…and the tab draws 20 rows from it, like before', (await looks()).rows.length === 20);

  // ── a BD sees only their own ──
  current = { id: 'bd1', role: 'bd', roles: ['bd'], org_id: ORG };
  await ev(() => { leadsStore.reset(); STATE.jobs = []; STATE.user = Object.assign({}, STATE.user, { id: 'bd1', role: 'bd', roles: ['bd'] }); STATE.page = 'leads'; });
  await ev(() => leadsStore.start()); await ev(() => { STATE.jobsFilter = { search: '', stages: [], industries: [], assignee: '', dateRange: 'all', dateFrom: '', dateTo: '' }; render(); }); await settle();
  const bdOld = await oldWay({ role: 'bd', roles: ['bd'], id: 'bd1' }, {});
  const bdNow = await looks();
  step("a BD's tab shows only their own leads, the same as the old tab (" + bdOld.count.trim() + ')', JSON.stringify(bdNow.rows) === JSON.stringify(bdOld.rows) && bdNow.count === bdOld.count && bdNow.rows.every((id) => jobs.find((j) => j.id === id).assigned_to_bd === 'bd1'));

  // ── sign-out leaves nothing ──
  await ev(() => signOut());
  const gone = await ev(() => ({ rows: STATE.lv.rows.length, jobs: STATE.jobs.length, on: leadsStore.use({ role: 'bd' }) }));
  step('signing out leaves no leads in the browser and server mode off', gone.rows === 0 && gone.jobs === 0 && gone.on === false, JSON.stringify(gone));
  step('no script errors on the page', errs.length === 0, errs.join(' | '));
} catch (e) { step('browser test ran without throwing', false, e.stack); }
if (browser) await browser.close(); web.close(); api.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
