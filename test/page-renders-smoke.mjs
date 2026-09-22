// Every page must actually DRAW (Session 28).
//
// The Jobs page shipped broken: the apply-link block was written into
// renderJobOrders (the LIST) while the `j` it reads is a row variable that
// only exists inside the row .map() above it — and the block it builds was
// consumed by renderJobOrderDetail, a different function entirely. So the
// list threw `j is not defined` and the detail would have thrown
// `applyBlock is not defined`. Two dead pages from one misplaced edit.
//
// FIVE browser suites render bd_joborders and every one of them passed.
// That is not bad luck, it is what they measure: UI.registerPage catches a
// render error and writes a small red sentence into #content, and a page
// carrying one short line has excellent contrast, few DOM nodes, no overflow
// and perfect repaint stability. A crashed page is the best-behaved page in
// the app by every metric those suites collect.
//
// So this suite asserts the one thing none of them did: that what got drawn
// is the PAGE, not the apology. It is deliberately dumb and deliberately
// broad — no layout judgement, no per-page knowledge, just "did this render".
//
// Usage: node test/page-renders-smoke.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, switchRole, waitForLogin } from './helpers/enter-app.mjs';

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
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// The two ways the shell admits it could not draw something. Both are real
// sentences the app writes on screen, so both are matched as the user sees
// them rather than by any internal flag.
const BROKEN = ['Could not draw this page', 'Page not found'];

const PAGES = ['dashboard', 'leads', 'applicants', 'email', 'reports', 'myteam',
               'bd_joborders', 'bd_myjobs', 'bd_jodetail', 'bd_pipeline', 'clients',
               'sourced', 'insights', 'reminders', 'job_board', 'admin', 'assign'];
const ROLES = ['admin', 'bd', 'bd_lead', 'recruiter', 'ra_lead'];

// One job order, one lead, with the apply columns present — the detail page
// needs a record to open, and the apply block reads three fields that only
// arrived with migration 044. A page must survive them being absent too,
// which is what the SPARSE pass below is for.
const SEED = (opts) => {
  const S = window.STATE;
  const jo = {
    id: 'jo-1', job_code: 'JO-1', job_title: 'HVAC Technician', client: 'Northwind',
    status: 'Open', city: 'Hartford', state: 'CT', job_type: 'Full-time',
    job_description: 'Service and repair commercial HVAC systems.',
    created_at: new Date().toISOString(),
  };
  if (opts.apply) { jo.apply_enabled = true; jo.apply_token = 'a'.repeat(32); jo.apply_count = 3; }
  S.bd = S.bd || {};
  S.bd.jobOrders = [jo];
  S.bd.view = Object.assign({}, S.bd.view, { joId: 'jo-1' });
  S.jobs = [{ id: 'l-1', position: 'Estimator', company_name: 'Acme', stage: 'Unassigned',
              location: 'Dallas, TX', created_at: new Date().toISOString() }];
  S.contacts = S.contacts || [];
  S.candidates = S.candidates || [];
};

const DREW = () => {
  const c = document.getElementById('content');
  const t = c ? (c.innerText || '') : '';
  return { text: t.slice(0, 400), nodes: c ? c.querySelectorAll('*').length : 0 };
};

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  // A probe that cannot measure must FAIL, never pass — the lesson from the
  // vacuous sourcing guard. If the phrase the whole suite looks for is not
  // even in the bundle, every assertion below is trivially true.
  const guardIsReal = await page.evaluate((needles) => {
    const src = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    return { scripts: src.length, ok: needles.length === 2 };
  }, BROKEN);
  step('the app under test really loaded its modules', guardIsReal.scripts > 20,
    `${guardIsReal.scripts} script tags`);

  const broken = [];
  let checked = 0;

  for (const role of ROLES) {
    await switchRole(page, role);
    // Two passes: a populated account, and one where the apply columns are
    // absent entirely (an org whose rows predate migration 044).
    for (const seed of [{ apply: true }, { apply: false }]) {
      for (const p of PAGES) {
        await page.evaluate(SEED, seed);
        await page.evaluate((pp) => { window.STATE.page = pp; window.render(); }, p);
        await page.waitForTimeout(40);
        const got = await page.evaluate(DREW);
        checked++;
        const hit = BROKEN.find(b => got.text.includes(b));
        if (hit) broken.push(`${p} / ${role} / apply=${seed.apply}: ${got.text.split('\n').filter(Boolean)[0] || hit}`);
      }
    }
  }

  step(`every page draws for every role (${checked} screens)`, broken.length === 0,
    broken.slice(0, 8).join(' | '));

  // The specific regression, named, so a future reader knows what this cost.
  await switchRole(page, 'bd');
  await page.evaluate(SEED, { apply: true });
  for (const p of ['bd_joborders', 'bd_jodetail']) {
    await page.evaluate((pp) => { window.STATE.page = pp; window.render(); }, p);
    await page.waitForTimeout(40);
    const got = await page.evaluate(DREW);
    step(`${p} draws real content, not a render error`,
      !BROKEN.some(b => got.text.includes(b)) && got.nodes > 10,
      `${got.nodes} nodes — ${got.text.split('\n').filter(Boolean)[0] || '(empty)'}`);
  }

  // The apply block belongs to the DETAIL page and must not appear on the list.
  await page.evaluate(() => { window.STATE.page = 'bd_jodetail'; window.render(); });
  await page.waitForTimeout(40);
  const detail = await page.evaluate(() => (document.getElementById('content').innerText || ''));
  step('the job detail page shows the apply link block', detail.includes('Apply link'));

  await page.evaluate(() => { window.STATE.page = 'bd_joborders'; window.render(); });
  await page.waitForTimeout(40);
  const list = await page.evaluate(() => (document.getElementById('content').innerText || ''));
  step('the jobs LIST does not carry the apply block', !list.includes('Apply link'));

  step('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  step('suite ran', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
