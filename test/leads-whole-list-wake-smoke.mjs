// SCREENS THAT DO NOT NEED THE WHOLE LEAD LIST MUST NOT ASK FOR IT (R-349 Stage D).
// With the lead list on the server, the whole list is downloaded only when a screen really reads it (STATE.jobs). This opens every screen, as six kinds of
// signed-in person, with only the first page of leads held, and lists which screens woke the whole-list download. Today only the Assign screen does
// (it ticks every Unassigned lead); the Email screen only on its Compose tab (its company picker). A screen that joins the list must be a decision, not an accident.
// Usage: node test/leads-whole-list-wake-smoke.mjs
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


  const ALLOWED = ['assign'];
  const roles = [['admin', 'boss'], ['bd', 'bd1'], ['bd_lead', 'bd1'], ['ra_lead', 'boss'], ['director', 'boss'], ['recruiter', 'bd2']];
  const pages = ['dashboard','leads','email','reminders','workflows','admin','assign','distribution','research','reports','myteam','mysetup','finder','mailbox','clients','sourced','applicants','bd_pipeline','bd_kanban','bd_myjobs','bd_joborders','job_board','seqsetup','activity','users','companies','contacts','templates','settings','insights','calendar','notifications'];
  for (const [role, id] of roles) {
    current = { id, role, roles: [role], org_id: ORG };
    const woke = [];
    for (const pg of pages) {
      await ev(([role, id]) => { leadsStore.reset(); STATE.jobs = []; STATE.contacts = []; STATE.modal = null; STATE.user = Object.assign({}, STATE.user, { id, role, roles: [role] }); STATE.users = [{ id: 'boss', name: 'Bo Boss' }, { id: 'bd1', name: 'Ash' }, { id: 'bd2', name: 'Bea' }]; STATE.page = 'dashboard'; }, [role, id]);
      await ev(() => leadsStore.start());
      await ev((pg) => { STATE.emailTab = 'pending'; STATE.page = pg; render(); }, pg); await page.waitForTimeout(350);
      if (await ev(() => leadsStore.askedFull())) woke.push(pg);
    }
    const extra = woke.filter((p) => !ALLOWED.includes(p));
    if (role === 'admin') step('(positive control) the probe CAN see a wake: the Assign screen wakes the list for an admin', woke.includes('assign'));
    step(role + ': only the screens that read the whole list wake it (' + (woke.join(', ') || 'none') + ')', extra.length === 0, 'unexpected: ' + extra.join(', '));
  }
  step('no script errors on any screen', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { step('probe ran without throwing', false, e.stack); }
if (browser) await browser.close(); web.close(); api.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
