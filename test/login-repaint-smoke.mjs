// THE LOGIN SCREEN MUST NOT GLITCH WHEN SOMEONE SIGNS OUT AND ANOTHER PERSON SIGNS IN (owner, 15 Oct 2026, screen recording:
//   "when I duplicate the tab, sign out and try to log in a new profile, the screen glitches many times").
//   Causes found by reproducing it with a slow server:
//   * a call from the OLD session still in flight at sign-out answered later and its .then() repainted the login screen
//     (wiping what the next person was typing, restarting the animated background), wrote the old person's data into the
//     new session, and — if it was a 401 — signed the NEW person out
//   * pressing Log In repainted the login form BLANK for the whole wait instead of showing "Loading your data"
//   * the same spinner was rewritten again when the data load began
// Usage: node test/login-repaint-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return undefined; }
const USERS = {
  old: { id: 'u-old', name: 'Prince Thomas', email: 'prince@x.test', role: 'admin', roles: ['admin'] },
  neu: { id: 'u-new', name: 'New Manager', email: 'new.manager@x.test', role: 'bd', roles: ['bd'] },
};
let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let mode = 'normal';        // 'normal' | 'late-answers' (old session's calls answer after sign-out; the sent list answers 401)
  await ctx.route('**', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (!/onrender\.com$/.test(u.hostname)) return route.abort();
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    const p = u.pathname + u.search; const auth = route.request().headers()['authorization'] || '';
    const json = (b, code = 200) => route.fulfill({ status: code, contentType: 'application/json', headers: h, body: JSON.stringify(b) });
    if (u.pathname === '/auth/login') { await new Promise(r => setTimeout(r, 1000)); return json({ token: 'tok-new', user: USERS.neu }); }
    if (mode === 'late-answers' && auth === 'Bearer tok-old') {
      await new Promise(r => setTimeout(r, 2200));
      if (p === '/emails?status=sent') return json({ error: 'Invalid token' }, 401);
      if (p === '/app-settings') return json({ stale_from_old_session: true });
    }
    await new Promise(r => setTimeout(r, 60));
    if (u.pathname === '/app-settings' || u.pathname === '/outreach-plan' || u.pathname.startsWith('/distribute')) return json({});
    return json([]);
  });
  const page = await ctx.newPage();
  // a duplicated tab: the first person's session is already in sessionStorage
  await page.addInitScript((u) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); sessionStorage.setItem('fg_token', 'tok-old'); sessionStorage.setItem('fg_user', JSON.stringify(u)); } }, USERS.old);
  await page.addInitScript(() => {
    window.__ev = [];
    const sig = () => { const a = document.getElementById('app'); if (a.querySelector('.login-card')) return 'LOGIN'; if (a.querySelector('#sidebar')) return 'SHELL'; if (/Loading your data/.test(a.textContent)) return 'SPINNER'; return 'other'; };
    const start = () => { const a = document.getElementById('app'); if (!a) return setTimeout(start, 5); new MutationObserver((ms) => { for (const m of ms) if (m.target === a) window.__ev.push(sig()); }).observe(a, { childList: true }); };
    start();
  });
  const events = () => page.evaluate(() => window.__ev.slice());
  const clearEvents = () => page.evaluate(() => { window.__ev.length = 0; });

  mode = 'late-answers';
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForFunction(() => window.STATE && STATE.user && !STATE.loading && document.getElementById('sidebar'), null, { timeout: 15000 });
  step('the duplicated tab opens as the first person', await page.evaluate(() => STATE.user.name) === 'Prince Thomas');

  console.log('\nSigning out while that session still has calls in flight');
  await clearEvents();
  await page.evaluate(() => window.signOut());
  await page.waitForSelector('#login-email');
  await page.fill('#login-email', 'new.manager@x.test');
  const canvasBefore = await page.evaluate(() => { const c = document.getElementById('login-canvas'); c.__mark = 1; return !!c; });
  await page.waitForTimeout(3200);        // the old session's slow answers arrive during this window
  let ev = await events();
  step('the login screen is painted exactly once — the old session\'s late answers repaint nothing', ev.length === 1 && ev[0] === 'LOGIN', JSON.stringify(ev));
  step('what the next person typed is still there, and the background was not rebuilt', await page.evaluate(() => document.getElementById('login-email').value === 'new.manager@x.test' && document.getElementById('login-canvas').__mark === 1) && canvasBefore);
  step('the old session\'s data was not written into the new one', await page.evaluate(() => !(STATE.appSettings && STATE.appSettings.stale_from_old_session)));
  await page.evaluate(() => { window.render(); window.render(); window.render(); });
  step('even a deliberate repaint on the login screen keeps typed text', await page.evaluate(() => document.getElementById('login-email').value) === 'new.manager@x.test');

  console.log('\nPressing Log In');
  mode = 'normal';
  await page.fill('#login-pass', 'secret-pass');
  await clearEvents();
  await page.evaluate(() => window.doLogin());
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => ({ spinner: /Loading your data/.test(document.getElementById('app').textContent), card: !!document.querySelector('.login-card') }));
  step('while it waits, the screen says "Loading your data" — the login form is not blanked and redrawn', mid.spinner && !mid.card, JSON.stringify(mid));
  await page.waitForFunction(() => STATE.user && STATE.user.name === 'New Manager' && !STATE.loading && document.getElementById('sidebar'), null, { timeout: 15000 });
  ev = await events();
  step('sign-in is one spinner then the app — nothing is painted twice', JSON.stringify(ev.filter((x, i) => x !== ev[i - 1])) === JSON.stringify(ev) && ev.filter(x => x === 'SPINNER').length === 1 && !ev.includes('LOGIN'), JSON.stringify(ev));

  console.log('\nA late "your session expired" from the OLD session, after the next person has signed in');
  // a second duplicated tab: the old session has a call in flight that the server will answer with 401 after the new person is in
  const page2 = await ctx.newPage();
  await page2.addInitScript((u) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); sessionStorage.setItem('fg_token', 'tok-old'); sessionStorage.setItem('fg_user', JSON.stringify(u)); } }, USERS.old);
  mode = 'late-answers';
  await page2.goto('http://127.0.0.1:' + PORT + '/');
  await page2.waitForFunction(() => window.STATE && STATE.user && !STATE.loading && document.getElementById('sidebar'), null, { timeout: 15000 });
  await page2.evaluate(() => { apiGet('/emails?status=sent').catch(() => {}); });      // old token, answered 401 in ~2.2 s
  await page2.evaluate(() => window.signOut());
  await page2.waitForSelector('#login-email');
  await page2.fill('#login-email', 'new.manager@x.test'); await page2.fill('#login-pass', 'secret-pass');
  await page2.evaluate(() => window.doLogin());
  await page2.waitForTimeout(3600);                                                      // the old 401 lands in here
  step('the old session\'s late 401 does not sign the new person out', await page2.evaluate(() => !!STATE.user && STATE.user.name === 'New Manager' && !!STATE.token && !!document.getElementById('sidebar')));
} catch (e) { step('the probe ran to the end', false, String(e && e.message || e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
