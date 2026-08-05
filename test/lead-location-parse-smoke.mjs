// Verifies the fix to bdOpenNewJob's Connected-lead -> Convert-to-Job prefill:
// City/State must actually populate from the lead's combined "location" string
// (leads have no discrete city/state field), handling both 2-letter
// abbreviations and full state names, and degrading safely on garbage input.
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
const pageErrors = [];

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
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
  await waitForLogin(page);
  await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.jobs = [
      { id: 'lead-abbr', stage: 'Connected', position: 'HVAC Technician', company_name: 'Acme Corp', location: 'Ocean Springs, MS' },
      { id: 'lead-full', stage: 'Connected', position: 'Data Engineer', company_name: 'Globex', location: 'Austin, Texas' },
      { id: 'lead-spacey', stage: 'Connected', position: 'QA Lead', company_name: 'Initech', location: '  Dallas ,  tx  ' },
      { id: 'lead-nocomma', stage: 'Connected', position: 'Recruiter', company_name: 'Umbrella', location: 'Remote' },
      { id: 'lead-empty', stage: 'Connected', position: 'Analyst', company_name: 'Hooli', location: '' },
      { id: 'lead-garbage', stage: 'Connected', position: 'Manager', company_name: 'Vandelay', location: 'Nowhereville, Xyzzy' }
    ];
  });

  const cases = [
    ['lead-abbr', 'Ocean Springs', 'Mississippi'],
    ['lead-full', 'Austin', 'Texas'],
    ['lead-spacey', 'Dallas', 'Texas'],
    ['lead-nocomma', 'Remote', ''],
    ['lead-empty', '', ''],
    ['lead-garbage', 'Nowhereville', ''],
  ];

  for (const [id, expCity, expState] of cases) {
    const got = await page.evaluate((leadId) => {
      bdOpenNewJob(leadId);
      const f = STATE.bd.form;
      closeModal();
      return { city: f.city, state: f.state };
    }, id);
    step(`${id}: city="${expCity}"`, got.city === expCity, `got city="${got.city}"`);
    step(`${id}: state="${expState}"`, got.state === expState, `got state="${got.state}"`);
  }

  // Regression: direct "+ New Job" (no leadId) must still start blank, not throw.
  const blank = await page.evaluate(() => {
    bdOpenNewJob(null);
    const f = STATE.bd.form;
    closeModal();
    return { city: f.city, state: f.state, hasModal: true };
  });
  step('Direct New Job (no lead) still starts with blank city/state', blank.city === '' && blank.state === '');

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
