// A CLICK ON THE PAGE MUST NOT THROW IT BACK TO THE TOP (R-143).
//
// Owner, on the Email tab: "when some button … in compose, or in pending, or all
// email, or outreach (like I click on Follow-up 2) the page resets to up, like
// it doesn't reload, but scrolls up automatically."
//
// The cause was one level down from where anyone looked: render() restores the
// scroll of #content and `.page`, but every page built on the UI kit scrolls in
// its own `.pg-body`, which was recreated at the top whenever a click changed
// the page's html. A repaint that changed NOTHING kept its place (so focusing a
// box looked fine), which is exactly why it went unnoticed.
//
// This drives real clicks on a page scrolled halfway down and asserts the place
// is kept — and that moving to a different TAB still starts at the top.
//
// Usage: node test/scroll-keep-smoke.mjs
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
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 700 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  const open = async (tab) => {
    await page.evaluate((t) => { window.STATE.emailTab = t; window.STATE.page = 'email'; window.render(); }, tab);
    await page.waitForTimeout(250);
  };
  const scrollDown = () => page.evaluate(() => { const b = document.querySelector('#content .pg-body'); b.scrollTop = 500; return { top: b.scrollTop, room: b.scrollHeight - b.clientHeight }; });
  const top = () => page.evaluate(() => { const b = document.querySelector('#content .pg-body'); return b ? b.scrollTop : -1; });

  // Follow-ups start at none (D-0114); this test needs the two tabs it clicks, so the person has turned two on.
  await page.evaluate(() => { window.STATE.myOutreachPlan = Object.assign(window.STATE.myOutreachPlan || {}, { fu_count: '2' }); });
  // The probe must be able to measure: the page has to be tall enough to scroll.
  await open('outreachplan');
  const probeBox = await scrollDown();
  step('the page is tall enough to scroll (the probe can measure)', probeBox.top > 100 && probeBox.room > 100, JSON.stringify(probeBox));

  // Real buttons, found by their visible labels and clicked WITHOUT letting the
  // browser scroll them into view first (Playwright's own click() does, which
  // would move the page for us and make a jump look like a kept place).
  const CLICKS = [
    ['Follow-up 2', 'button:has-text("Follow-up 2")'],
    ['Follow-up 1', 'button:has-text("Follow-up 1")'],
    ['Outreach 1', 'button:has-text("Outreach 1")'],
    ['a writing-style preset', 'button:has-text("Question opener")'],
    ['Random', 'button:has-text("Random")'],
    ['Specific', 'button:has-text("Specific")'],
  ];
  const jumped = [];
  for (const [label, sel] of CLICKS) {
    await open('outreachplan');
    const before = (await scrollDown()).top;
    if (before < 50) { jumped.push(`${label}: page too short to test (${before})`); continue; }
    const found = await page.evaluate((q) => {
      const t = q.match(/has-text\("(.+)"\)/)[1];
      const b = [...document.querySelectorAll('#content button')].find(x => (x.textContent || '').includes(t));
      if (!b) return false; b.click(); return true;
    }, sel);
    if (!found) { jumped.push(`${label}: button not found`); continue; }
    await page.waitForTimeout(300);
    const after = await top();
    if (Math.abs(after - before) > 4) jumped.push(`${label}: ${before} → ${after}`);
  }
  step(`clicking buttons on the Outreach Plan does not scroll the page to the top (${CLICKS.length} buttons)`, jumped.length === 0, jumped.join(' | '));

  // A different TAB is a different page: it starts at the top.
  await open('outreachplan');
  await scrollDown();
  await page.evaluate(() => window.setEmailTab('compose'));
  await page.waitForTimeout(250);
  step('moving to another tab starts at the top', (await top()) === 0, 'scrollTop ' + (await top()));
} catch (e) {
  step('suite ran', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
