// "SHOW EVERYTHING" MUST SHOW EVERYTHING (R-392, owner 4 Nov 2026: on the Jobs table the bar kept saying
// "8 of 10 jobs — 2 finished hidden" after the click).  Nothing clicked this button before, which is how it went unseen.
// Every list that has the horizon bar is driven here by a REAL click, and the rows and the bar must both change.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const step = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  // 10 jobs, all recent; 2 of them finished (Closed / Filled) — the owner's "8 of 10".
  await page.evaluate(() => {
    const S = window.STATE, now = Date.now();
    S.bd = S.bd || {};
    S.bd.loading = false;
    S.bd.jobOrders = Array.from({ length: 10 }, (_, i) => ({
      id: 'jo' + i, title: 'Role ' + i, job_title: 'Role ' + i, company_name: 'Company ' + i, client: 'Company ' + i,
      status: i === 3 ? 'Closed' : i === 7 ? 'Filled' : 'Open', state: 'TX', job_type: 'Full-time', priority: 'High', remote: 'No',
      created_at: new Date(now - i * 86400000).toISOString(), openings: 1,
      bd_manager: { id: 'test-adm', name: 'Test Admin' },
    }));
    S.bd.jobsView = 'all'; S.bd.jobShowAll = false; S.bd.myJobShowAll = false;
  });
  // rows = table rows (Jobs) or job cards (My Jobs); the bar text is read from the bar itself.
  const snap = (rowSel) => page.evaluate((rowSel) => {
    const c = document.getElementById('content');
    const bar = c && c.querySelector('.hz-txt');
    return { rows: c ? c.querySelectorAll(rowSel).length : -1, bar: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '',
             btn: !!(c && c.querySelector('.hz-btn')) };
  }, rowSel);

  // ── 1. the Jobs table ──
  await page.evaluate(() => { window.STATE.page = 'bd_joborders'; window.render(); });
  await page.waitForTimeout(300);
  const before = await snap('tbody tr');
  step('Jobs table: before the click the bar says 2 finished are hidden and offers Show everything', before.btn && before.rows === 8 && /8 of 10/.test(before.bar) && /2 finished hidden/.test(before.bar), JSON.stringify(before));
  await page.click('#content .hz-btn');
  await page.waitForTimeout(400);
  const after = await snap('tbody tr');
  step('Jobs table: after a real click all 10 jobs are listed', after.rows === 10, JSON.stringify(after));
  step('Jobs table: after the click nothing is hidden, so the bar is gone', after.bar === '' && !after.btn, JSON.stringify(after));

  // ── 2. My Jobs (cards) ──
  await page.evaluate(() => { window.STATE.page = 'bd_myjobs'; window.render(); });
  await page.waitForTimeout(300);
  const mBefore = await snap('#content [onclick*="bdOpenJob"], #content .job-card, #content .card');
  step('My Jobs: before the click the bar offers Show everything', mBefore.btn && /finished hidden/.test(mBefore.bar), JSON.stringify(mBefore));
  await page.click('#content .hz-btn');
  await page.waitForTimeout(400);
  const mAfter = await snap('#content .card');
  step('My Jobs: after a real click the bar is gone and more cards are drawn', mAfter.bar === '' && !mAfter.btn && mAfter.rows > mBefore.rows - 1, JSON.stringify({ mBefore, mAfter }));
} catch (e) {
  step('run crashed — ' + String(e.message || e).split('\n')[0], false);
} finally {
  if (browser) await browser.close();
  server.close();
}
step('No page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
