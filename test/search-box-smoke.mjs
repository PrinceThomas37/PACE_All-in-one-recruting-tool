// THE HEADER'S SEARCH BOX, DRIVEN IN THE REAL APP (R-123).
//
// /search is answered by the test (the server side has its own suite,
// search-everything-smoke). What this pins is the box: two letters ask, one
// does not; results are grouped by kind; what you typed and where your caret
// is SURVIVE a repaint of the top bar (it is a render region — a date line or a
// count moving rewrites it); arrows + Enter open the right record with the
// action its page already uses; Escape closes; ⌘K / Ctrl+K jumps into it; and
// on a phone the box has its own row and a 16px input (no zoom on focus).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
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
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}
const ANSWER = {
  q: 'pri',
  candidates: [{ id: 'cand-1', title: 'Priya Raman', sub: 'Java Developer · CN-01' }],
  leads: [{ id: 'lead-1', title: 'Java Developer · Acme Health', sub: 'Dallas, TX · Assigned' }],
  jobs: [{ id: 'jo-1', title: 'Java Engineer', sub: 'JO-1 · Acme · Open' }],
  clients: [],
};

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const asked = [];
  await ctx.route('**', r => {
    const u = r.request().url();
    if (u.includes('/search?')) { asked.push(new URL(u).searchParams.get('q')); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ANSWER) }); }
    return u.startsWith(BASE) ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  await page.evaluate(() => { window.__opened = []; window.bdOpenCandidate = (id) => window.__opened.push('candidate:' + id); window.bdOpenJobOrder = (id) => window.__opened.push('job:' + id); });

  step('the box is in the header', await page.locator('#topbar #gsearch-in').count() === 1);
  await page.click('#gsearch-in');
  await page.keyboard.type('p');
  await page.waitForTimeout(400);
  step('one letter does not search', asked.length === 0 && await page.locator('.gs-panel').count() === 0, JSON.stringify(asked));
  await page.keyboard.type('ri');
  await page.waitForSelector('.gs-row', { timeout: 3000 }).catch(() => {});
  const groups = await page.$$eval('.gs-group', els => els.map(e => e.textContent));
  step('two letters ask the server, once, for what was typed', asked.length === 1 && asked[0] === 'pri', JSON.stringify(asked));
  step('results are grouped by kind, empty kinds left out', groups.join('|') === 'Candidates|Leads|Jobs', groups.join('|'));

  // A repaint of the top bar (a count moving) must not eat the typing.
  await page.evaluate(() => { window.STATE.reminders = [{ id: 'x', user_id: window.STATE.user.id, status: 'pending', due_date: '2020-01-01' }]; window.render(); });
  const kept = await page.evaluate(() => { const el = document.getElementById('gsearch-in'); return { v: el.value, focus: document.activeElement === el, caret: el.selectionStart, panel: !!document.querySelector('.gs-panel') }; });
  step('a repaint keeps what was typed, the focus, the caret and the results', kept.v === 'pri' && kept.focus && kept.caret === 3 && kept.panel, JSON.stringify(kept));

  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  let opened = await page.evaluate(() => window.__opened.slice());
  step('arrows + Enter open the chosen record with its page\'s own action', opened.join() === 'job:jo-1', JSON.stringify(opened));
  step('…and the box closes and clears', await page.locator('.gs-panel').count() === 0 && await page.inputValue('#gsearch-in') === '');

  await page.click('#gsearch-in'); await page.keyboard.type('pri');
  await page.waitForSelector('.gs-row', { timeout: 3000 }).catch(() => {});
  await page.click('.gs-row >> nth=0');
  await page.waitForTimeout(150);
  opened = await page.evaluate(() => window.__opened.slice());
  step('a click opens the candidate', opened[1] === 'candidate:cand-1', JSON.stringify(opened));

  await page.click('#gsearch-in'); await page.keyboard.type('pr');
  await page.waitForSelector('.gs-row', { timeout: 3000 }).catch(() => {});
  const before = await page.locator('.gs-panel').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ panels: document.querySelectorAll('.gs-panel').length, g: window.STATE.gsearch, ae: document.activeElement && document.activeElement.id }));
  step('Escape closes the results', before === 1 && after.panels === 0, JSON.stringify(after));

  await page.click('#content', { position: { x: 600, y: 600 } });
  await page.keyboard.press('Control+k');
  step('Ctrl+K jumps into the box', await page.evaluate(() => document.activeElement && document.activeElement.id === 'gsearch-in'));
  step('nothing threw', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const pp = await phone.newPage();
  await pp.goto(BASE + '/'); await waitForLogin(pp); await enterApp(pp, 'bd');
  const ph = await pp.evaluate(() => {
    const box = document.querySelector('.tb-search').getBoundingClientRect();
    return { w: Math.round(box.width), right: Math.round(box.right), font: parseFloat(getComputedStyle(document.getElementById('gsearch-in')).fontSize), sw: document.documentElement.scrollWidth };
  });
  step('on a phone the box has its own full row, inside the screen', ph.w > 300 && ph.right <= 390 && ph.sw <= 390, JSON.stringify(ph));
  step('…with a 16px input, so focusing it does not zoom the page', ph.font >= 16, ph.font + 'px');
  await phone.close();
} catch (e) {
  step('suite ran without throwing', false, e.message);
} finally {
  await browser.close(); server.close();
}
const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
