// A JOB'S PAY SAYS WHAT IT IS PER (owner, 14 Oct: "I don't have an option to choose yearly, hourly or weekly pay when creating a job").
//
// A job had a currency and a min–max but no period, so "USD 22–26" could be an hourly or a yearly figure — on the screen, and in the
// candidate emails that print it. Pinned:
//   1. one text helper prints the range WITH its period (and nothing extra for an older job without one);
//   2. a posting's own words ("$22 - $26 per hour") are read into a period, never guessed from a bare number;
//   3. the server stores only the four known periods, and clears one with null;
//   4. a candidate email says "an hour / a week / a month / a year" from the job's own period, and an older job keeps the old cautious
//      inference (a bare under-1000 range is a rate; a bigger one says nothing);
//   5. in the browser: the New Job form offers the choice, converting a lead whose posting says "per hour" arrives with Hourly chosen,
//      a job saved with no period never sends the field (so saving cannot touch a column that may not exist yet), and clearing a
//      period that WAS set sends null.
// Usage: node test/job-pay-period-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── 1 + 2. the page's helpers, run for real ─────────────────────────────────
const ctx = vm.createContext({ window: {}, document: {}, navigator: {}, console });
vm.runInContext(fs.readFileSync(new URL('../public/js/01-constants.js', import.meta.url), 'utf8'), ctx);
const pay = (j, e) => vm.runInContext('jobPayText', ctx)(j, e), per = (t) => vm.runInContext('payPeriodFromText', ctx)(t);
step('a job with a period prints it after the range', pay({ pay_cur: 'USD', pay_min: '22', pay_max: '26', pay_period: 'hour' }, '—') === 'USD 22–26 /hr', pay({ pay_cur: 'USD', pay_min: '22', pay_max: '26', pay_period: 'hour' }, '—'));
step('weekly, monthly and yearly print too', ['week:/wk', 'month:/mo', 'year:/yr'].every(x => pay({ pay_min: '1', pay_max: '2', pay_period: x.split(':')[0] }).endsWith(x.split(':')[1])));
step('an older job with no period prints exactly what it always did', pay({ pay_cur: 'GBP', pay_min: '50000', pay_max: '60000' }, '—') === 'GBP 50000–60000');
step('no pay at all prints the empty text', pay({}, '—') === '—' && pay({}) === '');
step('only a min prints with a ?', pay({ pay_min: '30', pay_period: 'hour' }) === 'USD 30–? /hr');
step('a posting that says "per hour" reads as hourly', per('$22 - $26 per hour') === 'hour' && per('$22-26/hr') === 'hour' && per('Hourly, DOE') === 'hour');
step('…"a year" / "annual" / "per annum" as yearly', per('$120,000 a year') === 'year' && per('Annual salary 90k') === 'year' && per('£50,000 per annum') === 'year');
step('…weekly and monthly too', per('$900 per week') === 'week' && per('$4,000/month') === 'month');
step('a bare number says nothing — it is never guessed', per('$22 - $26') === '' && per('') === '' && per(null) === '');

// ── 3. the server's whitelist ───────────────────────────────────────────────
const core = require('../services/recruiting-core.js')({ supabase: { from() { return {}; } }, db: {}, auth: () => {}, hasRole: () => false, today: () => '2026-10-14', loadSuppressedSet: async () => new Set() });
const pick = (v) => core.pickJobFields(v === undefined ? {} : { pay_period: v });
step('the four known periods are stored', ['hour', 'week', 'month', 'year'].every(p => pick(p).pay_period === p));
step('case and spaces are forgiven', pick(' Hour ').pay_period === 'hour');
step('anything else is not stored (null), never an invented word', pick('fortnight').pay_period === null && pick('<b>').pay_period === null);
step('"" and null clear it', pick('').pay_period === null && pick(null).pay_period === null);
step('a body that does not mention it leaves the column alone (the key is absent)', !('pay_period' in pick(undefined)));

// ── 4. the candidate emails ─────────────────────────────────────────────────
const co = require('../services/candidate-outreach.js');
const facts = (o) => co.jobFacts(Object.assign({ job_title: 'Estimator', client: 'Acme' }, o));
step('a job that says hourly → "an hour"', facts({ pay_min: '22', pay_max: '26', pay_period: 'hour' }).payPeriod === ' an hour');
step('…a figure under 1000 that the job says is YEARLY is NOT called hourly (the old guess would have)', facts({ pay_min: '90', pay_max: '120', pay_period: 'year' }).payPeriod === ' a year');
step('…weekly and monthly', facts({ pay_min: '900', pay_max: '1100', pay_period: 'week' }).payPeriod === ' a week' && facts({ pay_min: '4000', pay_max: '5000', pay_period: 'month' }).payPeriod === ' a month');
step('an older job keeps the cautious inference: a small range is a rate…', facts({ pay_min: '25', pay_max: '35' }).payPeriod === ' an hour');
step('…and a big one says nothing', facts({ pay_min: '80000', pay_max: '100000' }).payPeriod === '');

// ── 5. the browser ──────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await c.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(() => {
    window.__sent = [];
    window.apiGet = () => Promise.resolve([]);
    window.apiPost = (p, b) => { window.__sent.push({ m: 'POST', p, b }); return Promise.resolve({ id: 'jo9', job_code: 'JO-9' }); };
    window.apiPut = (p, b) => { window.__sent.push({ m: 'PUT', p, b }); return Promise.resolve({ id: 'jo9', job_code: 'JO-9' }); };
    STATE.jobs = [
      { id: 'L1', position: 'Production Operator', company_name: 'H.B. Fuller', company_id: 'co1', location: 'Maple Grove, MN', salary_range: '$22 - $26 per hour', stage: 'Connected' },
      { id: 'L2', position: 'Controller', company_name: 'Acme', company_id: 'co2', location: 'Dallas, TX', salary_range: '', stage: 'Connected' },
    ];
  });
  const opts = () => page.evaluate(() => { const s = document.querySelector('select[aria-label="Pay is per"]'); return s ? { values: [...s.options].map(o => o.value + ':' + o.textContent.trim()), value: s.value } : null; });
  await page.evaluate(() => bdOpenNewJob('L1'));
  await page.waitForSelector('select[aria-label="Pay is per"]', { timeout: 5000 });
  let o = await opts();
  step('the New Job form offers Hourly, Weekly, Monthly and Yearly', o && o.values.join() === ':Per…,hour:Hourly,week:Weekly,month:Monthly,year:Yearly', o && o.values.join());
  step('converting a lead whose posting says "per hour" arrives with Hourly chosen', o && o.value === 'hour', o && o.value);
  await page.evaluate(() => bdSaveNewJob());
  await page.waitForTimeout(200);
  let s = await page.evaluate(() => window.__sent.slice());
  step('…and the save sends it', s.some(x => /from-lead\/L1/.test(x.p) && x.b.pay_period === 'hour'), JSON.stringify(s.map(x => x.p)));
  step('…without internal bookkeeping fields', s.every(x => !('_payWas' in (x.b || {}))));

  await page.evaluate(() => { window.__sent = []; bdOpenNewJob('L2'); });
  await page.waitForSelector('select[aria-label="Pay is per"]');
  o = await opts();
  step('a lead whose posting says nothing arrives with no period chosen', o && o.value === '', o && o.value);
  await page.evaluate(() => bdSaveNewJob());
  await page.waitForTimeout(200);
  s = await page.evaluate(() => window.__sent.slice());
  const sent2 = s.find(x => /from-lead\/L2/.test(x.p));
  step('…and saving it does NOT send the field at all (the column is never touched)', sent2 && !('pay_period' in sent2.b), sent2 && Object.keys(sent2.b).includes('pay_period') ? 'sent' : '');

  // editing: a period that was set shows; choosing another saves it; clearing it sends null
  await page.evaluate(() => { window.__sent = []; STATE.bd.jobOrders = [{ id: 'jo7', job_title: 'Estimator', client: 'Acme', status: 'Active', pay_cur: 'USD', pay_min: '90', pay_max: '120', pay_period: 'year', recruiters: [] }]; bdOpenEditJob('jo7'); });
  await page.waitForSelector('select[aria-label="Pay is per"]');
  o = await opts();
  step('editing a job shows the period it was saved with', o && o.value === 'year', o && o.value);
  await page.evaluate(() => { bdFormSet('pay_period', ''); bdSaveNewJob(); });
  await page.waitForTimeout(200);
  s = await page.evaluate(() => window.__sent.slice());
  const put = s.find(x => x.m === 'PUT');
  step('clearing a period that WAS set sends null, so it really is cleared', put && put.b.pay_period === null, put && JSON.stringify(put.b.pay_period));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the browser part ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
