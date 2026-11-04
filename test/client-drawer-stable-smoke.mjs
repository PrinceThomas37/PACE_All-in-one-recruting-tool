// A CLIENT DRAWER MUST NOT FLICKER WHILE ITS DATA ARRIVES (R-391, owner 4 Nov 2026, every client: "the screen flips between
// the drawer and the list with a ghost layer").  The record asks the server six things; each answer repaints the drawer.
// The drawer's opening animation (fade + slide, from transparent) used to replay on EVERY repaint, so the list showed
// through again and again.  This opens a client with answers arriving at staggered times and watches the drawer every
// frame: after it has opened it must stay fully opaque and never leave the screen.
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

// Answers arrive one after another, like a real server: 150ms, 300ms, 450ms …
const API = 'https://fute-lms-backend.onrender.com';
let n = 0;
const DELAYS = [];
async function api(route) {
  const u = new URL(route.request().url());
  const p = u.pathname;
  if (/^\/(clients|companies)(\/|$)/.test(p)) {
    const delay = 150 * (++n);
    DELAYS.push(p);
    await new Promise(r => setTimeout(r, delay));
    const body = p === '/clients' ? [{ id: 'co1', name: 'Concept 8, LLC', industry: 'Staffing', job_order_count: 1, open_job_order_count: 1, can_edit: true }]
      : /\/intel$/.test(p) ? { enabled: false } : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
}

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => { const u = r.request().url(); return u.startsWith(BASE) ? r.continue() : u.startsWith(API) ? api(r) : r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');
  await page.evaluate(() => window.goPage('clients'));
  await page.waitForSelector('#content tbody tr, #content .rr-row, #content [onclick*="clientsOpen"]', { timeout: 8000 }).catch(() => {});
  n = 0; DELAYS.length = 0;

  // Sample the drawer on every animation frame from the click until all answers are in.
  await page.evaluate(() => {
    window.__frames = []; window.__t0 = performance.now();
    const tick = () => {
      const s = document.querySelector('.dwr-scrim'), d = document.querySelector('.dwr');
      window.__frames.push({ t: Math.round(performance.now() - window.__t0), scrim: s ? +getComputedStyle(s).opacity : null, dwr: d ? +getComputedStyle(d).opacity : null });
      if (performance.now() - window.__t0 < 2600) requestAnimationFrame(tick);
    };
    window.clientsOpen('co1');
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(2900);
  const frames = await page.evaluate(() => window.__frames);
  const SETTLED = 400;                       // the first open may animate (180ms); nothing after that may
  const late = frames.filter(f => f.t > SETTLED);
  const gone = late.filter(f => f.scrim === null);
  const dim = late.filter(f => f.scrim !== null && (f.scrim < 0.99 || (f.dwr !== null && f.dwr < 0.99)));
  step('the six client requests were really answered one after another', DELAYS.length >= 5, `${DELAYS.length} requests seen`);
  step('the drawer is measured every frame, on screen the whole time (probe sees it)', late.length > 20 && frames.some(f => f.scrim !== null), `${frames.length} frames`);
  step('after it has opened, the drawer never leaves the screen while data arrives', gone.length === 0, `${gone.length} frames without it`);
  step('after it has opened, the drawer never fades or slides again while data arrives', dim.length === 0, `${dim.length} frames below full opacity, lowest ${Math.min(1, ...dim.map(f => Math.min(f.scrim, f.dwr ?? 1))).toFixed(2)}`);
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
