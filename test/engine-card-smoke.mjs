// Verifies the Admin page's "Background engine" card.
//
// The card exists because none of futé's recurring work was visible from inside
// the app: if the engine stopped, the only symptom was follow-ups quietly not
// going out. The distinction it has to get right — and what most of this test
// is about — is that CRON_KEY BEING SET IS NOT THE SAME AS THE HEARTBEAT
// WORKING. The key must match in two places (Render and the GitHub Actions
// secret); when they disagree /cron/tick 404s and nothing runs, while the
// server still happily reports "configured". A card that showed a green light
// in that state would be worse than no card at all.
//
// Three states, three different actions, so all three are asserted:
//   healthy — pings arriving
//   silent  — key set, no ping in over an hour (the values disagree)
//   unset   — no key at all (setup never done)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

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
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const JOBS = [
  { job: 'followup',      description: 'Daily follow-up send',  every_ms: 5 * 60 * 1000,  last_run_at: new Date(Date.now() - 60000).toISOString(),      overdue: false, running: false },
  { job: 'reply_sweep',   description: 'Inbox reply sweep',     every_ms: 30 * 60 * 1000, last_run_at: new Date(Date.now() - 5 * 60000).toISOString(),  overdue: false, running: false },
  { job: 'lead_sourcing', description: 'Automatic lead sourcing', every_ms: 60 * 60 * 1000, last_run_at: new Date(Date.now() - 5 * 3600000).toISOString(), overdue: true,  running: false },
  { job: 'warmup_tick',   description: 'Mailbox warm-up',       every_ms: 2 * 3600 * 1000, last_run_at: null,                                           overdue: false, running: true  },
  // Never run AND not running — kept separate from warmup_tick above, because
  // "running now" deliberately wins over "never run" when a job is mid-flight
  // on its first ever execution. One fixture cannot assert both labels.
  { job: 'bounce_sweep',  description: 'Bounce / NDR sweep',    every_ms: 30 * 60 * 1000, last_run_at: null,                                           overdue: false, running: false },
];

// Drive the card by stubbing the API layer, so this tests the CARD, not the
// network — the endpoint itself is covered by engine-runs-smoke.
async function setStatus(page, payload) {
  await page.evaluate((p) => {
    STATE.engineStatus = p;
    STATE._engineLoading = false;
    STATE.page = 'admin';
    render();
  }, payload);
}

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("Continue as Guest")', { timeout: 15000 });
  await page.click('button:has-text("Continue as Guest")');
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  // The card is admin-only surface, so make the guest an admin for the test.
  await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { role: 'admin', roles: ['admin'] });
    STATE.users = STATE.users || [];
  });

  // ── 1. Healthy ────────────────────────────────────────────────────────────
  await setStatus(page, {
    jobs: JOBS, recent: [], cron_configured: true, heartbeat_healthy: true,
    last_cron_ping_at: new Date(Date.now() - 120000).toISOString(),
  });
  let txt = await page.textContent('.page');
  step('healthy: says the engine is running', /Background engine: running/.test(txt), txt.slice(0, 160));
  step('healthy: shows when the last heartbeat arrived', /Last heartbeat .*ago/.test(txt));
  step('healthy: surfaces the overdue job count', /1 overdue/.test(txt), txt.slice(0, 200));

  // ── 2. Silent — THE ONE THAT MATTERS ──────────────────────────────────────
  // Key set, but nothing is arriving. This is what a mismatched GitHub secret
  // looks like, and it must NOT read as healthy.
  await setStatus(page, {
    jobs: JOBS, recent: [], cron_configured: true, heartbeat_healthy: false, last_cron_ping_at: null,
  });
  txt = await page.textContent('.page');
  step('silent: does NOT claim the engine is running', !/Background engine: running/.test(txt));
  step('silent: says the heartbeat is not arriving', /not receiving its heartbeat/.test(txt));
  step('silent: names the likely cause (values not matching)', /not matching exactly/.test(txt), txt.slice(0, 300));

  // ── 3. Unset ──────────────────────────────────────────────────────────────
  await setStatus(page, {
    jobs: JOBS, recent: [], cron_configured: false, heartbeat_healthy: false, last_cron_ping_at: null,
  });
  txt = await page.textContent('.page');
  step('unset: says the engine is not set up', /Background engine: not set up/.test(txt));
  step('unset: explains the consequence in plain language',
    /only runs while somebody has the app open/.test(txt), txt.slice(0, 300));
  step('unset: is distinct from the silent state', !/not receiving its heartbeat/.test(txt));

  // ── 4. The job list ───────────────────────────────────────────────────────
  await page.evaluate(() => { STATE.engineExpanded = true; render(); });
  txt = await page.textContent('.page');
  step('expanded: lists each job by description', /Daily follow-up send/.test(txt) && /Inbox reply sweep/.test(txt));
  step('expanded: shows each job\'s cadence', /every 30m/.test(txt) && /every 2h/.test(txt), txt.slice(0, 400));
  step('expanded: marks a job that has never run', /never run/.test(txt));
  step('expanded: marks a job that is running now', /running now/.test(txt));
  const runBtns = await page.$$('button:has-text("Run now")');
  step('expanded: an admin gets a Run now button per job', runBtns.length === JOBS.length, String(runBtns.length));

  // A non-admin (bd_lead can read the status endpoint) must not get the button.
  await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { role: 'bd_lead', roles: ['bd_lead'] });
    render();
  });
  const adminGuard = await page.textContent('.page');
  step('a non-admin does not land on the admin page at all', !/Background engine/.test(adminGuard), adminGuard.slice(0, 120));

  // ── 5. Degradation — the card must never blank the Admin page ─────────────
  await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { role: 'admin', roles: ['admin'] });
    STATE.engineStatus = { _error: true }; STATE.page = 'admin'; render();
  });
  txt = await page.textContent('.page');
  step('a failed status read degrades to a retry, not a broken page',
    /status unavailable/.test(txt) && /Admin/.test(txt), txt.slice(0, 200));

  await page.evaluate(() => { STATE.engineStatus = null; STATE.page = 'admin'; render(); });
  txt = await page.textContent('.page');
  step('a pending status read shows a loading line', /Checking background engine/.test(txt));

  step('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  step('harness completed', false, String(err && err.message));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
