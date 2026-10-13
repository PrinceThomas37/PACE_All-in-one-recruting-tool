// The website's "Book a walkthrough" form, end to end in Chromium (R-216, D-0137).
//
// The REAL company-site/index.html is served on one origin; a copy of the app's
// public route — the same cors options, the same rate limiter, the real
// routes/site-requests.js over an in-memory database — runs on another. That is
// the shape of production (paceconsultant.in → app.paceconsultant.in), so a
// CORS mistake, a wrong field name or a page that claims "sent" when nothing was
// kept all fail here.
//
// The rule this suite exists for: the old form (mailto:) lost requests silently.
// The new one must never say "sent" unless the app said it kept the request.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const cors = require('cors');
const { createDb } = require('../models/index.js');
const { createRateLimiter } = require('../middleware/rate-limit.js');

const SITE_DIR = path.resolve(new URL('../company-site', import.meta.url).pathname);
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n       ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n       ')); }
}

// ── the app side ─────────────────────────────────────────────────────────────
const ORG = uid(), ADMIN = uid();
const fake = createFakeDb({
  tables: { users: [{ id: ADMIN, org_id: ORG, role: 'admin', roles: ['admin'], is_active: true, created_at: '2025-01-01' }],
    companies: [], jobs: [], contacts: [], reminders: [], activity_log: [], app_settings: [] },
  defaults: Object.fromEntries(['companies', 'jobs', 'contacts', 'reminders', 'activity_log'].map((tb) => [tb, () => ({ id: uid() })])),
});
const savedOrg = process.env.WEBSITE_LEADS_ORG_ID;
process.env.WEBSITE_LEADS_ORG_ID = ORG;
let mode = 'ok', healthHits = 0;
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.get('/health', (q, r) => { healthHits++; r.json({ ok: true }); });
app.use('/site/walkthrough-request', (q, r, n) => (mode === 'slow' ? setTimeout(n, 6500) : mode === 'down' ? r.status(502).send('Bad gateway') : n()));
app.use('/site/walkthrough-request', createRateLimiter({ name: 'site-request', windowMs: 60 * 60 * 1000, max: 5, message: 'Too many requests from here. Please email info@paceconsultant.in.' }));
app.use(require('../routes/site-requests.js')({ db: createDb(fake.supabase) }));
const apiSrv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const API = 'http://127.0.0.1:' + apiSrv.address().port;

// ── the site side (a different origin: localhost, not 127.0.0.1) ─────────────
const page0 = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
const html = page0.replace('data-api="https://app.paceconsultant.in"', `data-api="${API}"`);
const types = { '.css': 'text/css', '.woff2': 'font/woff2' };
const site = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(html); }
  const f = path.join(SITE_DIR, path.normalize(u));
  if (!f.startsWith(SITE_DIR) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
const SITE = 'http://localhost:' + site.address().port + '/';

const quiet = console.log; console.log = () => {};
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
async function fresh(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(SITE);
  await p.locator('#book').scrollIntoViewIfNeeded();
  return p;
}
async function fill(p, email) { await p.fill('#n', 'Asha Verma'); await p.fill('#e', email); await p.fill('#a', 'BrightStaff'); await p.selectOption('#p', 'Pro'); }

try {
  await t('the production page posts to the app, not to a mail app', () => {
    assert.match(page0, /<form id="f" data-api="https:\/\/app\.paceconsultant\.in"/);
    assert.ok(!/location\.href\s*=\s*'mailto:/.test(page0), 'the old mailto submit must be gone');
  });

  await t('the first touch of the form wakes the app; the honeypot is out of sight and out of the tab order', async () => {
    const p = await fresh();
    await p.click('#n'); await p.waitForTimeout(300);
    assert.equal(healthHits, 1);
    assert.ok((await p.locator('.hp').boundingBox()).x < -1000);
    assert.equal(await p.getAttribute('#w', 'tabindex'), '-1');
    await p.context().close();
  });

  await t('a bad email is caught on the page and nothing is sent', async () => {
    const p = await fresh();
    await fill(p, 'not-an-email'); await p.click('#f-go'); await p.waitForTimeout(200);
    assert.equal(await p.textContent('#ok'), 'Please enter a valid work email.');
    assert.equal(fake.tables.app_settings.length, 0);
    await p.context().close();
  });

  await t('a real request lands as a lead with a reminder, and only then does the page say sent', async () => {
    const p = await fresh();
    await fill(p, 'asha@brightstaff.com'); await p.click('#f-go');
    await p.waitForSelector('#sent:not([hidden])', { timeout: 10000 });
    assert.match((await p.textContent('#sent')).replace(/\s+/g, ' '), /REQUEST SENT Thanks, Asha\. .* will email asha@brightstaff\.com/);
    assert.ok(await p.isHidden('#f'));
    assert.equal(fake.tables.jobs.length, 1);
    assert.equal(fake.tables.jobs[0].stage, 'Unassigned');
    assert.equal(fake.tables.contacts[0].email, 'asha@brightstaff.com');
    assert.equal(fake.tables.reminders[0].user_id, ADMIN);
    assert.equal(JSON.parse(fake.tables.app_settings[0].value).plan, 'Pro');
    await p.context().close();
  });

  await t('a sleeping app: the page says it is still sending, then succeeds', async () => {
    mode = 'slow';
    const p = await fresh();
    await fill(p, 'ravi@nimbus.io'); await p.click('#f-go');
    await p.waitForTimeout(5600);
    assert.match(await p.textContent('#ok'), /Still sending/);
    assert.ok(await p.isDisabled('#f-go'), 'no double submit while waiting');
    await p.waitForSelector('#sent:not([hidden])', { timeout: 10000 });
    await p.context().close();
    mode = 'ok';
  });

  await t('the app down: the page NEVER says sent, and gives the address to write to (phone width, no sideways scroll)', async () => {
    mode = 'down';
    const p = await fresh(390);
    await fill(p, 'lee@acme.io'); await p.click('#f-go');
    await p.waitForSelector('#ok:not([hidden])');
    assert.match(await p.textContent('#ok'), /did not go through.*info@paceconsultant\.in/);
    assert.ok(!(await p.isVisible('#sent')));
    assert.match(await p.getAttribute('#ok a', 'href'), /^mailto:info@paceconsultant\.in\?subject=/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await p.context().close();
    mode = 'ok';
  });

  await t('one address sending again and again gets the limiter\'s sentence', async () => {
    const p = await fresh();
    let said = '';
    for (let k = 0; k < 6 && !/Too many/.test(said); k++) {
      await p.evaluate(() => { document.getElementById('f').hidden = false; document.getElementById('sent').hidden = true; document.getElementById('ok').hidden = true; });
      await fill(p, `x${k}@y.io`); await p.click('#f-go');
      await p.waitForSelector('#sent:not([hidden]), #ok:not([hidden])');
      said = (await p.isVisible('#ok')) ? await p.textContent('#ok') : '';
    }
    assert.match(said, /Too many requests from here\. Please email info@paceconsultant\.in\./);
    await p.context().close();
  });

  await t('yearly prices are whole dollars, and monthly comes back unchanged', async () => {
    const p = await fresh();
    await p.click('#bill [data-bill="year"]');
    assert.deepEqual(await p.$$eval('[data-m]', (ps) => ps.map((x) => x.textContent + ' ' + x.nextElementSibling.textContent)),
      ['$79 a month, billed yearly ($948)', '$239 a month, billed yearly ($2,868)', '$479 a month, billed yearly ($5,748)']);
    await p.click('#bill [data-bill="month"]');
    assert.deepEqual(await p.$$eval('[data-m]', (ps) => ps.map((x) => x.textContent)), ['$99', '$299', '$599']);
    await p.context().close();
  });

  await t('no script errors on the page', () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  site.close(); apiSrv.close();
  console.log = quiet;
  if (savedOrg === undefined) delete process.env.WEBSITE_LEADS_ORG_ID; else process.env.WEBSITE_LEADS_ORG_ID = savedOrg;
}

console.log(results.join('\n'));
console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
