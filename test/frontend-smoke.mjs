// Frontend smoke test — boots public/index.html in headless Chromium using the
// signed-in state driven from the test (no backend required) and asserts that the
// app loads from the split js/ modules and renders every major screen without
// JavaScript errors.
//
// Usage:
//   npm install --no-save playwright-core      # one-time (no browser download)
//   node test/frontend-smoke.mjs
//
// Chromium is located via $PLAYWRIGHT_CHROMIUM, else $PLAYWRIGHT_BROWSERS_PATH,
// else a plain "chromium" on PATH. Exits non-zero on any failure.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { enterApp, switchRole, waitForLogin } from './helpers/enter-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base) {
    const guess = path.join(base, 'chromium');
    if (fs.existsSync(guess)) return guess;
  }
  return 'chromium'; // rely on PATH
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const pageErrors = [];
const consoleErrors = [];
const IGNORE = [/Failed to load resource/i, /net::/i, /ERR_/i, /favicon/i,
  /cdnjs\.cloudflare/i, /googleapis/i, /gstatic/i, /fonts\.google/i, /onrender\.com/i];
const isIgnorable = (t) => IGNORE.some((re) => re.test(t));

const results = [];
const step = (name, ok, detail = '') => results.push({ name, ok, detail });

let browser;
try {
  browser = await chromium.launch({
    executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  // Hermetic: allow only our local host; abort external (fonts, xlsx CDN, API).
  await context.route('**', (route) =>
    route.request().url().startsWith(BASE) ? route.continue() : route.abort());

  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String((err && err.stack) || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnorable(msg.text())) consoleErrors.push(msg.text());
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  step('Login screen renders', (await page.locator('.login-card').count()) > 0);

  await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });
  await page.waitForSelector('#content', { timeout: 15000 });
  step('Sign-in → dashboard renders', (await page.locator('#content').innerHTML()).length > 200);

  async function visit(label, pageId) {
    await page.evaluate((id) => window.goPage(id), pageId);
    await page.waitForTimeout(250);
    const html = await page.locator('#content').innerHTML();
    step(`Navigate: ${label}`, html.length > 50, `#content html length=${html.length}`);
  }

  for (const [label, id] of [['Dashboard', 'dashboard'], ['Leads', 'leads'], ['Email', 'email'],
    ['Reminders', 'reminders'], ['My Insights (BD)', 'bdinsights'], ['Profile', 'profile']]) {
    await visit(label, id);
  }

  await switchRole(page, 'ra');
  await page.waitForTimeout(250);
  step('Switch role → RA', (await page.locator('#sidebar').count()) > 0);
  await visit('RA Dashboard', 'dashboard');
  await visit('RA Insights', 'insights');

  await switchRole(page, 'ra_lead');
  await page.waitForTimeout(250);
  step('Switch role → RA Lead', (await page.locator('#sidebar').count()) > 0);
  await visit('Assign Leads', 'assign');
  await visit('RA Lead Insights', 'insights');

  await browser.close();
} catch (e) {
  step('FATAL: browser automation', false, String((e && e.stack) || e));
  try { if (browser) await browser.close(); } catch {}
}
server.close();

console.log('\n=== FRONTEND SMOKE TEST ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
console.log('\nJS page errors:', pageErrors.length === 0 ? 'none' : '');
pageErrors.forEach((e) => console.log('  ✗ ' + e.split('\n')[0]));
console.log('Console errors:', consoleErrors.length === 0 ? 'none' : '');
consoleErrors.forEach((e) => console.log('  ✗ ' + e));

const hardFail = failed > 0 || pageErrors.length > 0;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} steps passed, ` +
  `${pageErrors.length} page errors, ${consoleErrors.length} console errors`);
console.log(hardFail ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(hardFail ? 1 : 0);
