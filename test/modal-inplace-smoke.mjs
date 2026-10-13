// A CLICK INSIDE A WINDOW MUST NOT MAKE THE WINDOW BLINK OR JUMP (R-197, owner 13 Oct).
//
// Owner, with two screen recordings of the Accept window: "the window refreshes every time I click … it happens in send email and
// any other action … not just the leads". In the recording the window disappears for a beat on a click and comes back scrolled to the
// top. The cause was in the render engine, not in any one window: every change to a window's html rewrote the whole #layer, which
// made a NEW `.modal` element — so its 0.18s pop-in animation played again (the blink) and every scroll box in it restarted at the
// top (the jump).
//
// Proven here with a real browser and a real window built the way every module builds one (STATE.modal = html; render()):
//   * the same window, changed inside   → the SAME element stays, its scroll boxes keep their place, the caret stays, no animation
//   * a different window                → written whole: a new element, starting at the top (it should pop in)
//   * the window closed                 → it goes
//
// Usage: node test/modal-inplace-smoke.mjs
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
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// A window like the Accept window: a heading, a tall scrolling body with a text box and a list that grows, and a footer.
const win = (title, rows, note) => '<div class="modal modal-w720" onclick="event.stopPropagation()">' +
  '<div class="fs-16 fd-mhead">' + title + '</div>' +
  '<div class="fd-mbody" style="max-height:300px;overflow:auto"><input id="probe-in" class="inp" value="' + (note || '') + '">' +
  Array.from({ length: rows }, (_, i) => '<div style="height:40px">row ' + i + '</div>').join('') + '</div>' +
  '<div class="fd-mfoot"><button class="btn btn-primary">Save</button></div></div>';

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');
  await page.evaluate((h) => { window.__win = new Function('t', 'r', 'n', 'return (' + h + ')(t,r,n)'); }, win.toString());

  const show = (title, rows, note) => page.evaluate(([t, r, n]) => { window.STATE.modal = window.__win(t, r, n); window.render(); }, [title, rows, note]);

  await show('Add Acme as a lead', 20, '');
  await page.waitForTimeout(400);                                   // the pop-in has finished, as it has by the time anyone clicks
  const probe = await page.evaluate(() => { const b = document.querySelector('#layer .fd-mbody'); b.scrollTop = 300; window.__m = document.querySelector('#layer .modal'); return { top: b.scrollTop, room: b.scrollHeight - b.clientHeight }; });
  step('the probe can measure: the window body scrolls', probe.top > 100 && probe.room > 100, JSON.stringify(probe));

  await page.focus('#probe-in'); await page.keyboard.type('abc');
  // focusing the box scrolled it into view; put the person back where they were reading before the click
  await page.evaluate(() => { document.querySelector('#layer .fd-mbody').scrollTop = 300; });
  // a click inside changes the window's html (a person got their email, a pill was ticked, "Getting…")
  await show('Add Acme as a lead', 30, 'abc');
  const after = await page.evaluate(() => { const m = document.querySelector('#layer .modal'), b = document.querySelector('#layer .fd-mbody'); return { same: m === window.__m, top: b.scrollTop, rows: b.querySelectorAll('div').length, anims: m.getAnimations().length, animNames: m.getAnimations().map(a => a.animationName || a.transitionProperty || a.constructor.name).join(','), focus: document.activeElement && document.activeElement.id, caret: document.activeElement && document.activeElement.selectionStart }; });
  step('the SAME window element stays after a click inside it (no blink)', after.same);
  step('its scroll box keeps its place (no jump to the top)', after.top === probe.top, 'before ' + probe.top + ' after ' + after.top);
  step('the new contents are shown', after.rows === 30, 'rows ' + after.rows);
  step('the pop-in animation does not play again', after.anims === 0, 'running animations: ' + after.anims + ' ' + after.animNames);
  step('the text box keeps focus and its caret', after.focus === 'probe-in' && after.caret === 3, JSON.stringify({ f: after.focus, c: after.caret }));

  // the window's own scroll (a short screen scrolls the whole panel)
  await page.evaluate(() => { document.querySelector('#layer .modal').scrollTop = 40; });
  await show('Add Acme as a lead', 31, 'abc');
  step('the panel\'s own scroll is kept too', await page.evaluate(() => { const m = document.querySelector('#layer .modal'); return m === window.__m && (m.scrollTop > 0 || m.scrollHeight <= m.clientHeight); }));

  // a different window is a new window
  await show('Send these emails?', 5, '');
  const other = await page.evaluate(() => { const m = document.querySelector('#layer .modal'); return { same: m === window.__m, top: document.querySelector('#layer .fd-mbody').scrollTop, title: m.querySelector('.fd-mhead').textContent }; });
  step('a DIFFERENT window is written whole (a new element, at the top)', !other.same && other.top === 0 && other.title === 'Send these emails?', JSON.stringify(other));

  await page.evaluate(() => { window.STATE.modal = null; window.render(); });
  step('closing it removes it', await page.evaluate(() => !document.querySelector('#layer .modal')));

  // and a window opened twice in a row still opens (nothing is left behind by the in-place path)
  await show('Add Acme as a lead', 3, '');
  step('it can be opened again afterwards', await page.evaluate(() => !!document.querySelector('#layer .modal') && document.querySelectorAll('#layer .modal').length === 1));
} catch (e) { step('test ran to the end', false, e.message); }
finally { if (browser) await browser.close(); server.close(); }
const p = results.filter(Boolean).length;
console.log(`SUMMARY: ${p}/${results.length}`);
process.exit(p === results.length && results.length > 0 ? 0 : 1);
