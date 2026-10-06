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

  // 6. The sky phase: the head script's data-sky and paceSkyPhase() agree at
  //    every boundary (dawn 05-07, day 08-16, dusk 17-19, night 20-04).
  for (const [h, want] of [[4, 'night'], [5, 'dawn'], [7, 'dawn'], [8, 'day'], [16, 'day'], [17, 'dusk'], [19, 'dusk'], [20, 'night']]) {
    const { ctx, page } = await boot(at(h, 30));
    const got = await page.evaluate((h) => [document.documentElement.getAttribute('data-sky'), window.paceSkyPhase(new Date(2026, 9, 6, h, 30))], h);
    step(`${h}:30 sky is ${want}`, got[0] === want && got[1] === want, JSON.stringify(got));
    await ctx.close();
  }

  // 7. The header on Today shows only REAL numbers, and the New button only
  //    where PACE has that action — never a placeholder.
  {
    const { ctx, page } = await boot(at(12));
    await enterApp(page, 'admin');
    const hdr = () => page.evaluate(() => ({
      chips: [...document.querySelectorAll('#topbar .tb-chip')].map(e => e.textContent),
      newBtn: (document.querySelector('#topbar .tb-new') || {}).textContent || null,
      clock: (document.getElementById('tb-clock') || {}).textContent || '',
    }));
    await page.evaluate(() => { window.STATE.nextActions = undefined; window.STATE.reminders = []; window.render(); });
    let h = await hdr();
    step('no counts are shown while they are unknown', h.chips.length === 0, JSON.stringify(h.chips));
    step('the date line reads the person\'s clock', /^TUE · 06 OCT 2026 · 12:00/.test(h.clock), h.clock);
    await page.evaluate(() => { const S = window.STATE; S.nextActions = { items: [{}, {}, {}] };
      S.reminders = [{ id: 'a', user_id: S.user.id, status: 'pending', return_date: '2026-10-01' }, { id: 'b', user_id: S.user.id, status: 'pending', return_date: '2026-10-09' }, { id: 'c', user_id: 'someone-else', status: 'pending', return_date: '2026-10-01' }];
      window.render(); });
    h = await hdr();
    step('Today counts only YOUR overdue reminders (no dead need-you chip)', h.chips.join('|') === '1 PAST DUE', JSON.stringify(h.chips));
    // THE "+ NEW" MENU (R-122 step 3): one button, every page, and each entry
    // only for someone who already has that action. Opening it lists them;
    // picking one runs the page's own function; a click elsewhere closes it.
    const items = () => page.evaluate(() => [...document.querySelectorAll('#topbar .tb-newrow .tb-newlbl')].map(e => e.textContent));
    const usable = () => page.evaluate(() => [...document.querySelectorAll('#topbar .tb-newrow:not(.is-off) .tb-newlbl')].map(e => e.textContent));
    const greyed = () => page.evaluate(() => [...document.querySelectorAll('#topbar .tb-newrow.is-off .tb-newlbl')].map(e => e.textContent));
    step('a BD desk gets one "+ New" button on Today', /^\+ New/.test(h.newBtn || ''), String(h.newBtn));
    step('…closed until it is opened', (await items()).length === 0);
    await page.evaluate(() => document.querySelector('#topbar .tb-new').click());
    step('opening it offers Job, Candidate, Lead, Email and Sequence to an admin', (await items()).join('|') === 'Job|Candidate|Lead|Email|Sequence', (await items()).join('|'));
    const picked = await page.evaluate(() => { let got = null; window.bdOpenNewJob = (id) => { got = 'job:' + id; };
      [...document.querySelectorAll('#topbar .tb-newrow')].find(b => /Job/.test(b.textContent)).click(); return got; });
    step('picking "Job" runs the Jobs screen\'s own new-job action', picked === 'job:null', String(picked));
    step('…and the menu closes', (await items()).length === 0);
    await page.evaluate(() => document.querySelector('#topbar .tb-new').click());
    await page.evaluate(() => document.body.click());
    step('a click anywhere else closes it', (await items()).length === 0);
    await page.evaluate(() => document.querySelector('#topbar .tb-new').click());
    await page.keyboard.press('Escape');
    step('Escape closes it', (await items()).length === 0);
    await page.evaluate(() => window.goPage('leads'));
    h = await hdr();
    step('the button is on every page, not just Today — and Today\'s counts stay on Today', /^\+ New/.test(h.newBtn || '') && h.chips.length === 0, JSON.stringify(h));
    await page.evaluate(() => { window.STATE.user = Object.assign({}, window.STATE.user, { role: 'bd', roles: ['bd'] }); window.goPage('dashboard'); document.querySelector('#topbar .tb-new').click(); });
    // R-135 (owner): never hidden — greyed, with the reason, when the person has no permission.
    step('a plain BD still SEES Sequence in the menu — greyed, not removed', (await items()).join('|') === 'Job|Candidate|Lead|Email|Sequence' && (await greyed()).join('|') === 'Sequence', (await items()).join('|') + ' / greyed: ' + (await greyed()).join('|'));
    step('…and the greyed Sequence gives the reason and cannot be clicked', await page.evaluate(() => { const b = document.querySelector('#topbar .tb-newrow.is-off'); return !!b && b.disabled && /Team leads and admins/.test(b.textContent) && b.getAttribute('aria-disabled') === 'true'; }));
    step('…while the four they CAN use are live', (await usable()).join('|') === 'Job|Candidate|Lead|Email', (await usable()).join('|'));
    await page.evaluate(() => { window.STATE.newMenu = false; window.STATE.user = Object.assign({}, window.STATE.user, { role: 'ra', roles: ['ra'] }); window.goPage('dashboard'); });
    h = await hdr();
    step('a desk with nothing to start STILL has the button — greyed out and not clickable', /^\+ New/.test(h.newBtn || '') && await page.evaluate(() => { const b = document.querySelector('#topbar .tb-new'); return b.disabled && b.classList.contains('is-off') && !!b.title; }), String(h.newBtn));
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
