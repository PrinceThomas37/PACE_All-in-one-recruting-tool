// ROWS HIDDEN OR FILTERED OUT OF A SPREADSHEET ARE NOT IMPORTED UNLESS THE PERSON SAYS SO (R-306, owner 3 Nov 2026).
// The 26 Oct import: the owner expected 78 leads, PACE made 95. Decided: show "N rows are hidden", import only the visible rows by default, all only on request.
// NOTE found by this test: SheetJS reports hidden rows ONLY when the file is read with cellStyles:true — without it every hidden row looks visible (the 26 Oct cause).
// Part 1 — the reader (public/js/78-import-visible.js) on REAL .xlsx files made here with SheetJS (written, then read back, so the file format is in the loop).
// Part 2 — the import preview in the real browser code: the notice, the two choices, the numbers, and what is handed to the import.
// The spreadsheets are MADE FOR THIS TEST. The owner's original 78-row file was never available, so this proves the mechanism, not that file.
// Usage: node test/import-hidden-rows-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const IV = require('../public/js/78-import-visible.js');
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };

// a sheet: header + n data rows; `hide` = 1-based data rows to hide (as a person, or an auto-filter, would)
function makeXlsx({ n = 10, hide = [], blankHidden = [], header = ['Company', 'Position', 'First Name', 'Email'] } = {}) {
  const aoa = [header];
  for (let i = 1; i <= n; i++) aoa.push([`Co ${i}`, `Role ${i}`, `Pat${i}`, `pat${i}@co${i}.test`]);
  blankHidden.forEach((i) => { aoa[i] = ['', '', '', '']; });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!rows'] = []; hide.concat(blankHidden).forEach((i) => { ws['!rows'][i] = { hidden: true }; });   // data row i is worksheet row i (the header is row 0)
  if (hide.length) ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const sheetOf = (buf) => { const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true }); return wb.Sheets[wb.SheetNames[0]]; };

let r = IV.read(sheetOf(makeXlsx({ n: 10 })), XLSX);
ok('a sheet with nothing hidden: every row, 0 hidden, and visible IS all', r.all.length === 10 && r.visible.length === 10 && r.hidden === 0);
r = IV.read(sheetOf(makeXlsx({ n: 10, hide: [3, 7] })), XLSX);
ok('two rows hidden (by hand or by a filter): 10 in the sheet, 8 visible, 2 hidden — read back from a real .xlsx', r.all.length === 10 && r.visible.length === 8 && r.hidden === 2, JSON.stringify([r.all.length, r.visible.length, r.hidden]));
ok('…and it is exactly the hidden ones that are missing (Co 3, Co 7), nothing else', !r.visible.some((x) => x.Company === 'Co 3' || x.Company === 'Co 7') && r.visible.map((x) => x.Company).join() === ['Co 1', 'Co 2', 'Co 4', 'Co 5', 'Co 6', 'Co 8', 'Co 9', 'Co 10'].join());
ok('…the visible rows keep every column and value, exactly as the old import saw them', JSON.stringify(r.visible[2]) === JSON.stringify(r.all[3]) && r.visible[2].Email === 'pat4@co4.test');
r = IV.read(sheetOf(makeXlsx({ n: 10, hide: [2], blankHidden: [9] })), XLSX);
ok('a hidden row that is blank is not counted (nobody would miss it)', r.hidden === 1, String(r.hidden));
r = IV.read(sheetOf(makeXlsx({ n: 6, hide: [1, 2, 3, 4, 5, 6] })), XLSX);
ok('every row hidden: 0 visible, 6 hidden — the preview then says so instead of importing nothing silently', r.visible.length === 0 && r.hidden === 6 && r.all.length === 6);
const dup = IV.read(sheetOf(makeXlsx({ n: 4, hide: [2], header: ['Company', 'Position', 'Email', 'Email'] })), XLSX);
ok('duplicate column names are handled exactly as before (Email, Email_1)', dup.visible[0].Email_1 !== undefined && Object.keys(dup.visible[0]).join() === Object.keys(dup.all[0]).join());
const big = IV.read(sheetOf(makeXlsx({ n: 95, hide: Array.from({ length: 17 }, (_, i) => 5 + i * 5) })), XLSX);
ok('the 26 Oct shape: 95 rows in the sheet, 17 hidden → 78 visible', big.all.length === 95 && big.hidden === 17 && big.visible.length === 78, JSON.stringify([big.all.length, big.hidden, big.visible.length]));

// ── Part 2: the preview in the real browser code ──
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((res) => web.listen(0, '127.0.0.1', () => res(web.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const xlsxJs = fs.readFileSync(path.resolve(new URL('../node_modules/xlsx/dist/xlsx.full.min.js', import.meta.url).pathname));
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', async (rt) => {
    const u = rt.request().url(); if (u.startsWith(BASE)) return rt.continue();
    if (/xlsx(\.full)?\.min\.js/.test(u)) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: xlsxJs });
    if (u.startsWith(API)) return rt.fulfill({ status: 200, contentType: 'application/json', body: rt.request().method() === 'GET' ? '[]' : '{}' });
    return rt.abort();
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { STATE.page = 'leads'; STATE.jobs = []; STATE.contacts = []; STATE.companies = []; render(); window.__got = null; window.doImportProcess = function (toProcess) { window.__got = toProcess; }; window.confirm = () => true; });
  await page.waitForSelector('#xl-import', { state: 'attached' });
  const load = async (buf) => { await page.setInputFiles('#xl-import', { name: 'leads.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf }); await page.waitForTimeout(600); };
  const modal = () => ev(() => { const m = document.querySelector('.modal'); return m ? m.innerText.replace(/\s+/g, ' ') : ''; });

  await load(makeXlsx({ n: 10, hide: [3, 7] }));
  let t = await modal();
  ok('the preview says "2 rows are hidden" and that they are not being imported', /2 rows are hidden/.test(t) && /not being imported/.test(t), t.slice(0, 300));
  ok('…by default it will import the 8 visible rows', /Import 8 job/.test(t) && /Import only the 8 visible rows/.test(t) && /Import all 10 rows/.test(t), t.slice(0, 400));
  await page.locator('#import-hidden button:has-text("Import all 10 rows")').click(); await page.waitForTimeout(300);
  t = await modal();
  ok('choosing "Import all 10 rows" changes the numbers to 10 and the notice to "being imported too"', /Import 10 job/.test(t) && /being imported too/.test(t), t.slice(0, 300));
  await page.locator('#import-hidden button:has-text("Import only the 8 visible rows")').click(); await page.waitForTimeout(300);
  ok('…and back to the visible rows only', /Import 8 job/.test(await modal()));
  await page.locator('.modal .btn-primary:has-text("Import 8")').click(); await page.waitForTimeout(700);
  const got = await ev(() => window.__got);
  const names = got ? JSON.stringify(got).match(/Co \d+/g) : [];
  ok('pressing Import hands the import ONLY the 8 visible jobs (never Co 3 or Co 7)', got && got.length === 8 && !names.includes('Co 3') && !names.includes('Co 7'), got ? String(got.length) + ' ' + names.join() : 'nothing handed over');

  await ev(() => { closeModal && closeModal(); window.__got = null; });
  await load(makeXlsx({ n: 10 }));
  t = await modal();
  ok('a sheet with nothing hidden shows no notice at all', !/hidden/.test(t) && /Import 10 job/.test(t), t.slice(0, 200));
  ok('no script errors', errs.length === 0, errs.join(' | '));
} catch (e) { ok('browser part ran without throwing', false, e.stack); }
if (browser) await browser.close(); web.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
