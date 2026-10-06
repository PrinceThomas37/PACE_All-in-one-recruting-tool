// R-122 step 3 — the logo and the search hint, in a real browser (NOT on the
// frozen clock the theme suite uses: the logo's show is real time).
//
//   * the logo says PACE and nothing under it (the owner had "AI RECRUITING" removed);
//   * it TYPES ITSELF OUT — letters appear one by one, a caret blinks — as a CSS
//     animation on the live element, and then it is simply the word;
//   * the sidebar's MARKUP is the finished word every time, so an idle repaint
//     still writes nothing (ui-smoothness-smoke pins the engine; this pins the logo);
//   * a repaint part-way through the show does not restart or lose it;
//   * the search box names the key the person actually has: Ctrl K on Windows
//     and Linux, ⌘K on a Mac — and either key opens it.
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
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
async function open(init) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  return { ctx, page, errors };
}
try {
  // ── THE LOGO ─────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await open();
    const side = await page.evaluate(() => ({ txt: document.querySelector('#sidebar .rail-word').textContent, sub: /AI RECRUITING/i.test(document.getElementById('sidebar').textContent) }));
    step('the logo says PACE and nothing under it (no "AI RECRUITING")', side.txt === 'PACE' && !side.sub, JSON.stringify(side));

    // The show is only ever started by the first paint; start a fresh one.
    await page.waitForTimeout(3700);                      // let the first visit's show end
    const done = await page.evaluate(() => ({ typing: !!document.querySelector('.rail-word.typing'), sizes: [...document.querySelectorAll('.rail-word .tw')].map(e => parseFloat(getComputedStyle(e).fontSize)) }));
    step('once the show is over the word is simply there — no animation class, every letter drawn', !done.typing && done.sizes.length === 4 && done.sizes.every(n => n > 8), JSON.stringify(done));
    step('the markup is the same finished word every time (an idle repaint writes nothing)',
      await page.evaluate(() => { const a = window.paceLogoWord(); return new Promise(r => setTimeout(() => r(a === window.paceLogoWord() && /PACE/.test(a.replace(/<[^>]+>/g, ''))), 400)); }));

    await page.evaluate(() => { window.__paceLogoT0 = 0; window.paceLogoWord(); });   // a new show
    await page.waitForTimeout(450);
    const during = await page.evaluate(() => ({
      typing: !!document.querySelector('.rail-word.typing'),
      anims: document.getAnimations().filter(a => a.animationName === 'tw-in').length,
      caret: getComputedStyle(document.querySelector('.rail-word .tw-caret')).display,
      sizes: [...document.querySelectorAll('.rail-word .tw')].map(e => parseFloat(getComputedStyle(e).fontSize)),
    }));
    step('during the show the letters are being typed — an animation per letter, a caret, the last letter not there yet',
      during.typing && during.anims >= 1 && during.caret !== 'none' && during.sizes[3] === 0, JSON.stringify(during));
    // A repaint of the sidebar mid-show (a nav change) must not lose or restart it.
    const mid = await page.evaluate(async () => {
      window.STATE.page = 'leads'; window.render();
      await new Promise(r => setTimeout(r, 400));
      return { typing: !!document.querySelector('.rail-word.typing'), el: document.querySelector('.rail-word').style.getPropertyValue('--el') };
    });
    step('a repaint mid-show puts the show back where it was (resumed, not restarted)', mid.typing && parseFloat(mid.el) > 0.3, JSON.stringify(mid));
    await page.waitForTimeout(3300);
    const end = await page.evaluate(() => ({ typing: !!document.querySelector('.rail-word.typing'), sizes: [...document.querySelectorAll('.rail-word .tw')].map(e => parseFloat(getComputedStyle(e).fontSize)), caret: getComputedStyle(document.querySelector('.rail-word .tw-caret')).display }));
    step('…and it ends as the plain word, caret gone', !end.typing && end.sizes.every(n => n > 8) && end.caret === 'none', JSON.stringify(end));
    step('nothing threw', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── THE SEARCH HINT NAMES THE PERSON'S OWN KEY ───────────────────────────
  {
    const { ctx, page } = await open();
    const hint = await page.evaluate(() => document.querySelector('.gs-kbd').textContent);
    step('on Windows / Linux the hint says Ctrl K, not a Mac key', hint === 'Ctrl K', hint);
    await page.keyboard.press('Control+k');
    step('Ctrl+K opens it', await page.evaluate(() => document.activeElement && document.activeElement.id === 'gsearch-in'));
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Meta+k');
    step('…and ⌘K opens it too (either key works whatever the hint says)', await page.evaluate(() => document.activeElement && document.activeElement.id === 'gsearch-in'));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(() => { Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) }); Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); });
    const hint = await page.evaluate(() => document.querySelector('.gs-kbd').textContent);
    step('on a Mac the hint says ⌘K', hint === '⌘K', hint);
    await ctx.close();
  }
} catch (e) {
  step('suite ran without throwing', false, e.stack || e.message);
} finally {
  await browser.close();
  server.close();
}
const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
