// A JOB'S STATUS CHANGE CARRIES A NOTE (R-315, owner 26 Oct: "when a job stage is changed, the user should be able to add notes
// to it and then save the stage change").
//   Server: PUT /job-orders/:id with { status, status_note } keeps the note on THAT change's history row (the rewind panel shows
//           it under the change); no note → no note; a note with no actual change writes nothing.
//   Screen: choosing a status (the bulk "Set status" bar or the row's Status) opens a small window with a note box; Save sends
//           status + note; Cancel changes nothing.
// Usage: node test/job-status-note-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the server ───────────────────────────────────────────────────────────────
async function put(body, status0 = 'Active') {
  const fake = createFakeDb({ tables: { job_orders: [{ id: 'jo1', org_id: 'org-A', status: status0, job_title: 'Welder', bd_manager_id: 'u-1' }], record_history: [] } });
  const core = {
    supabase: fake.supabase, db: {}, auth: (q, r, n) => n(), hasRole: (_r, ...rs) => rs.includes('admin'), today: () => '2026-10-26',
    orgIdFor: () => 'org-A', orgStamp: () => ({ org_id: 'org-A' }), withOrg: (q) => q.eq('org_id', 'org-A'),
    hasRequirementColumns: async () => false, applyDerivedJobFields: async () => ({}), persistScores: () => {}, invalidateJobScores: () => {},
    STAGES: [], STAGE_ALIASES: {}, normalizeStage: (x) => x, BDM_GATED_STAGE: '', isBDM: () => true, isRecruiter: () => false,
    assignedJobOrderIds: async () => [], recruiterCanTouchJob: async () => true, reportingChainIds: async () => [],
    nextId: async (p) => p + '-001', logSubmissionActivity: async () => {}, JOB_ORDER_SELECT: '*', JOB_FIELDS: ['status'], JOB_DATE_FIELDS: [],
    pickJobFields: (s) => (s.status !== undefined ? { status: s.status } : {}),
  };
  let handler = null;
  const app = { get() {}, post() {}, delete() {}, put(p, ...r) { if (p === '/job-orders/:id') handler = r[r.length - 1]; } };
  require('../routes/recruiting/job-orders.js')(app, core);
  let status = 200, payload = null;
  const res = { status(s) { status = s; return res; }, json(j) { payload = j; return res; } };
  await handler({ body, user: { id: 'u-1', role: 'admin', roles: ['admin'] }, params: { id: 'jo1' }, query: {} }, res);
  return { status, payload, hist: fake.tables ? fake.tables.record_history : fake.supabase._tables && fake.supabase._tables.record_history, fake };
}
const histOf = (r) => (r.fake.tables && r.fake.tables.record_history) || [];
let r = await put({ status: 'On Hold', status_note: '  Client paused hiring until January  ' });
let h = histOf(r).filter((x) => x.field === 'status');
step('a status change with a note keeps the note on that change\'s history row (trimmed)', r.status === 200 && h.length === 1 && h[0].note === 'Client paused hiring until January' && /On Hold/.test(JSON.stringify(h[0].new_value)), JSON.stringify(h));
r = await put({ status: 'Filled' });
h = histOf(r).filter((x) => x.field === 'status');
step('…without a note, the change is recorded with no note', h.length === 1 && h[0].note === null);
r = await put({ status: 'Active', status_note: 'nothing moved' });
step('…a note with no actual change writes no history row', histOf(r).filter((x) => x.field === 'status').length === 0);
r = await put({ status: 'Closed', status_note: 'x'.repeat(1500) });
h = histOf(r).filter((x) => x.field === 'status');
step('…a very long note is cut to 1,000 characters, not refused', h.length === 1 && h[0].note.length === 1000);

// ── the screen ───────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', (rt) => { const u = rt.request().url(); return u.startsWith(BASE + '/') && /\.(html|js|css)$|\/$/.test(new URL(u).pathname) ? rt.continue() : rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    window.__puts = [];
    window.apiPut = (p, b) => { window.__puts.push([p, b]); return Promise.resolve({}); };
    window.loadJobOrders = () => {};
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'jo1', job_title: 'Office Manager', status: 'Active', bd_manager_id: 'test-bd' }, { id: 'jo2', job_title: 'Welder', status: 'Active', bd_manager_id: 'test-bd' }];
    STATE.bd.jobSel = { jo1: true, jo2: true };
  });
  await ev(() => bdBulkStatus('On Hold')); await page.waitForTimeout(150);
  step('choosing a status no longer changes it at once — a window asks for a note first', await ev(() => !!document.getElementById('bd-status-note') && window.__puts.length === 0));
  step('…and says what is about to change ("Set 2 jobs to On Hold")', /Set 2 jobs to On Hold/.test(await ev(() => document.body.innerText)));
  await page.fill('#bd-status-note', 'Client paused hiring'); await ev(() => bdStatusSave()); await page.waitForTimeout(150);
  let puts = await ev(() => window.__puts);
  step('Save sends the status AND the note, for every chosen job', puts.length === 2 && puts.every(([p, b]) => b.status === 'On Hold' && b.status_note === 'Client paused hiring') && !(await ev(() => !!document.getElementById('bd-status-note'))), JSON.stringify(puts));
  await ev(() => { window.__puts.length = 0; STATE.bd.jobOrders = [{ id: 'jo1', job_title: 'Office Manager', status: 'Active', bd_manager_id: 'test-bd' }]; bdJobSetStatus('jo1', 'Filled'); }); await page.waitForTimeout(150);
  step('the row\'s own Status picker asks the same way ("Set Office Manager to Filled")', /Set Office Manager to Filled/.test(await ev(() => document.body.innerText)));
  await ev(() => bdStatusCancel()); await page.waitForTimeout(100);
  step('Cancel changes nothing', (await ev(() => window.__puts.length)) === 0 && (await ev(() => STATE.bd.jobOrders[0].status)) === 'Active');
  await ev(() => bdJobSetStatus('jo1', 'Filled')); await page.waitForTimeout(100); await ev(() => bdStatusSave()); await page.waitForTimeout(150);
  puts = await ev(() => window.__puts);
  step('Save with an empty note just changes the status (the note is optional)', puts.length === 1 && puts[0][1].status === 'Filled' && !('status_note' in puts[0][1]), JSON.stringify(puts));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
