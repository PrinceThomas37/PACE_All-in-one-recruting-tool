// THE APP FOLLOWS THE CLOCK UNLESS THE PERSON CHOSE (R-122, D-0072).
//
// Auto = light from 05:00 to 16:59, dark otherwise, decided BEFORE first paint
// by the inline script in index.html's <head>, and by paceClockTheme() in
// 04-shell-login.js afterwards. Two copies of one rule is a drift waiting to
// happen, so this suite runs both at the boundary minutes and requires they
// agree. It also pins the toggle (one click always flips what is on screen;
// flipping back to what the clock shows is Auto again), that a chosen theme is
// never overridden by the clock, that Auto catches up on navigation and NOT on
// its own — and that the retro palette is actually loaded (a guard must fail
// when the thing is absent, not only when it is ugly).
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
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}
const at = (hh, mm = 0) => new Date(2026, 9, 6, hh, mm, 0); // local time, like the person's clock

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
try {
  // Boot a fresh page at a given local time, optionally with a stored choice.
  async function boot(when, stored) {
    const ctx = await browser.newContext();
    await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    if (stored) await ctx.addInitScript(t => { try { localStorage.setItem('pace-theme', t); } catch (e) {} }, stored);
    const page = await ctx.newPage();
    await page.clock.install({ time: when });
    await page.goto(BASE + '/');
    await waitForLogin(page);
    return { ctx, page };
  }
  const state = page => page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    auto: document.documentElement.hasAttribute('data-theme-auto'),
    stored: (() => { try { return localStorage.getItem('pace-theme'); } catch (e) { return 'ERR'; } })(),
  }));

  // 1. The head script and paceClockTheme() agree at every boundary minute.
  const marks = [[4, 59, 'dark'], [5, 0, 'light'], [12, 0, 'light'], [16, 59, 'light'], [17, 0, 'dark'], [23, 30, 'dark']];
  for (const [h, m, want] of marks) {
    const { ctx, page } = await boot(at(h, m));
    const s = await state(page);
    const fn = await page.evaluate(([h, m]) => window.paceClockTheme(new Date(2026, 9, 6, h, m)), [h, m]);
    step(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} with no choice is Auto ${want}`,
      s.theme === want && s.auto && fn === want, `head=${s.theme} auto=${s.auto} fn=${fn}`);
    await ctx.close();
  }

  // 2. A chosen theme beats the clock, at boot and on navigation.
  {
    const { ctx, page } = await boot(at(10), 'dark');
    let s = await state(page);
    step('a stored "dark" at 10:00 stays dark and is not Auto', s.theme === 'dark' && !s.auto, JSON.stringify(s));
    await page.evaluate(() => window.paceClockCheck());
    s = await state(page);
    step('the clock check leaves a chosen theme alone', s.theme === 'dark' && !s.auto, JSON.stringify(s));
    await ctx.close();
  }

  // 3. The toggle: one click flips what is on screen; flipping back to what
  //    the clock shows is Auto again (and forgets the stored choice).
  {
    const { ctx, page } = await boot(at(10));
    await enterApp(page, 'bd');
    await page.evaluate(() => { window.__sent = []; window.apiFetch = (m, u, b) => { window.__sent.push(m + ' ' + u + ' ' + JSON.stringify(b)); return Promise.resolve({}); }; window.toggleTheme(); });
    let s = await state(page);
    step('Auto(light) + one click = chosen dark', s.theme === 'dark' && !s.auto && s.stored === 'dark', JSON.stringify(s));
    await page.evaluate(() => window.toggleTheme());
    s = await state(page);
    step('a second click lands on the clock\'s light = Auto again', s.theme === 'light' && s.auto && s.stored === null, JSON.stringify(s));
    const sent = await page.evaluate(() => window.__sent);
    step('the account is told "dark", then "system" (Auto) — the choice follows the person',
      sent.length === 2 && sent[0] === 'PUT /me/preferences {"theme":"dark"}' && sent[1] === 'PUT /me/preferences {"theme":"system"}', JSON.stringify(sent));
    await ctx.close();
  }

  // 4. Auto catches up when the person moves to another screen — not before.
  {
    const { ctx, page } = await boot(at(16, 58));
    await enterApp(page, 'bd');
    await page.clock.setFixedTime(at(17, 5));
    await page.waitForTimeout(50);
    let s = await state(page);
    step('crossing 17:00 does NOT flip the page under the person', s.theme === 'light', JSON.stringify(s));
    await page.evaluate(() => window.goPage('leads'));
    s = await state(page);
    step('the next screen they open is dark (Auto caught up)', s.theme === 'dark' && s.auto, JSON.stringify(s));
    await ctx.close();
  }

  // 5. The retro palette is the one on screen (fails if retro.css is unlinked).
  {
    const { ctx, page } = await boot(at(10));
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase());
    step('the day canvas is arcade cream #F2EADB (retro.css loaded)', bg === '#F2EADB', 'got ' + bg);
    await ctx.close();
  }
} catch (e) {
  step('suite ran without throwing', false, e.message);
} finally {
  await browser.close();
  server.close();
}
const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
