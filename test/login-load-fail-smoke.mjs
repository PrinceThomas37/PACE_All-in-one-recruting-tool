// A SIGN-IN THAT WORKED IS NEVER UNDONE BY A SLOW SERVER (R-323, owner 26 Oct: "a user Ash was trying to log in but it came back
// to the login page when clicked log in, but when logged in from another browser it logged in").
//
// Cause: the password was accepted, then the first load (users, leads, companies, reminders, industries, emails) ran on a
// server busy enough that the lead list took 17–32 s; when ANY of those calls failed, PACE threw the sign-in away and put the
// login page back, with the reason in a toast that vanished — it looked exactly like a refused password. Now:
//   · a failed first load keeps the sign-in, tries once more by itself ("PACE is busy — trying again…");
//   · a second failure shows "Your sign-in worked, but PACE could not load your data" with Try again / Sign out — never the
//     login page, and the token is still held;
//   · Try again loads the app; Sign out goes to the login page;
//   · a sign-in that has REALLY run out ("Invalid token") still goes to the login page with the expiry sentence (R-118).
// Usage: node test/login-load-fail-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }

// A token the browser can read (it only decodes the expiry; the "server" here is the route below).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = b64({ alg: 'HS256' }) + '.' + b64({ id: 'u-ash', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
const USER = { id: 'u-ash', name: 'Ash Sayyad', email: 'ash@example.test', role: 'bd', roles: ['bd'] };

// R-348: the lead list no longer holds the sign-in, so the "first load fails" cases are driven through /users (one of the calls
// that still does), and the lead list has its own cases below.
let jobsMode = 'fail';      // the first-load call: 'fail' → 500; 'ok' → []; 'expired' → 401 Invalid token
let jobsCalls = 0;
let leadsMode = 'ok';       // the lead list: 'ok' → one lead; 'slow' → answers after 1.5 s; 'fail' → 500
let leadsCalls = 0;
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', (rt) => {
    const u = new URL(rt.request().url());
    if (u.origin === BASE && /\.(html|js|css|woff2?)$|^\/$/.test(u.pathname)) return rt.continue();
    const json = (status, body) => rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/auth/login') return json(200, { token: TOKEN, user: USER });
    if (u.pathname === '/jobs') {
      leadsCalls++;
      if (leadsMode === 'fail') return json(500, { error: 'canceling statement due to statement timeout' });
      const one = [{ id: 'j1', position: 'Nurse', stage: 'Assigned', contacts: [], company: { name: 'Acme' }, created_at: '2026-10-30T00:00:00Z' }];
      if (leadsMode === 'slow') return new Promise((ok) => setTimeout(ok, 1500)).then(() => json(200, one));
      return json(200, one);
    }
    if (u.pathname === '/users') {
      jobsCalls++;
      if (jobsMode === 'fail') return json(500, { error: 'upstream timeout' });
      if (jobsMode === 'expired') return json(401, { error: 'Invalid token' });
      return json(200, [USER]);
    }
    if (u.pathname === '/me/preferences' || u.pathname === '/app-settings' || u.pathname === '/outreach-plan') return json(200, {});
    return json(200, []);
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { window.LOAD_RETRY_MS = 300; });

  const signIn = async () => { await page.fill('#login-email', 'ash@example.test'); await page.fill('#login-pass', 'right-password'); await ev(() => doLogin()); };

  // ── the first load fails, twice ──
  await signIn();
  await page.waitForTimeout(120);
  step('while the first try fails, the person sees "PACE is busy — trying again…", not the login page',
    await ev(() => !!document.getElementById('app-loading') && /trying again/.test(document.body.innerText) && !document.getElementById('login-email')));
  await page.waitForSelector('#app-loadfail', { timeout: 9000 }).catch(() => {});
  step('after the last retry fails: "Your sign-in worked, but PACE could not load your data", with Try again and Sign out',
    await ev(() => { const b = document.getElementById('app-loadfail'); return !!b && /sign-in worked/.test(b.innerText) && /Try again/.test(b.innerText) && /Sign out/.test(b.innerText) && /Ash Sayyad/.test(b.innerText); }));
  step('…the login page is NOT shown and the sign-in is kept (token in this tab)',
    await ev(() => !document.getElementById('login-email') && STATE.token && sessionStorage.getItem('fg_token') === STATE.token));
  step('…it kept trying by itself for a while (7 tries: the first + 6 spaced retries, 29 Oct), not in an endless loop', jobsCalls === 7, String(jobsCalls));

  // ── Try again once the server answers ──
  jobsMode = 'ok';
  await ev(() => loadAppDataRetry());
  await page.waitForSelector('#sidebar', { timeout: 8000 }).catch(() => {});
  step('Try again, with the server answering, opens PACE', await ev(() => !!document.getElementById('sidebar') && !document.getElementById('app-loadfail') && !STATE.loadFailed));

  // ── Sign out from the failure screen ──
  await ev(() => doLogout()); await page.waitForTimeout(100);
  jobsMode = 'fail'; jobsCalls = 0;
  await signIn(); await page.waitForSelector('#app-loadfail', { timeout: 9000 }).catch(() => {});
  await ev(() => doLogout()); await page.waitForTimeout(150);
  step('Sign out from the failure screen goes to the login page and forgets the sign-in',
    await ev(() => !!document.getElementById('login-email') && !STATE.token && !sessionStorage.getItem('fg_token')));

  // ── a sign-in that really ran out still says so ──
  jobsMode = 'expired';
  await signIn(); await page.waitForTimeout(800);
  step('a sign-in the server calls expired still goes to the login page, with the expiry sentence (not the busy screen)',
    await ev(() => !!document.getElementById('login-email') && !document.getElementById('app-loadfail') && /session expired/i.test(document.body.innerText)));
  // ── R-348: the app opens WITHOUT waiting for the lead list ──
  await ev(() => { window.LEADS_RETRY_S = [0.2, 0.2, 0.2, 0.2, 0.2]; });
  jobsMode = 'ok'; leadsMode = 'slow'; leadsCalls = 0;
  await signIn();
  await page.waitForSelector('#sidebar', { timeout: 1200 }).catch(() => {});
  step('a slow lead list does not hold the sign-in: PACE is open before the leads arrive', await ev(() => !!document.getElementById('sidebar') && STATE.jobsLoading === true));
  step('…and says the leads are on their way (an empty list never reads as "no leads")', await ev(() => /Loading your leads/.test((document.getElementById('leads-loading-note') || {}).innerText || '')));
  await page.waitForFunction(() => !STATE.jobsLoading, null, { timeout: 5000 }).catch(() => {});
  step('when the list arrives the leads are there and the note is gone', await ev(() => STATE.jobs.length === 1 && !document.getElementById('leads-loading-note')));
  step('…asked once, not once per screen', leadsCalls === 1, String(leadsCalls));
  await ev(() => doLogout()); await page.waitForTimeout(100);

  leadsMode = 'fail'; leadsCalls = 0;
  await signIn();
  await page.waitForSelector('#sidebar', { timeout: 3000 }).catch(() => {});
  step('a lead list the server cannot give still lets the person in', await ev(() => !!document.getElementById('sidebar') && !document.getElementById('app-loadfail')));
  await page.waitForFunction(() => /could not load/.test((document.getElementById('leads-loading-note') || {}).innerText || ''), null, { timeout: 6000 }).catch(() => {});
  step('…it is asked again a few times, then the note says so with Try again', leadsCalls === 6 && await ev(() => /Try again/.test(document.getElementById('leads-loading-note').innerText)), String(leadsCalls));
  leadsMode = 'ok';
  await ev(() => document.querySelector('#leads-loading-note button').click());
  await page.waitForFunction(() => STATE.jobs.length === 1, null, { timeout: 4000 }).catch(() => {});
  step('Try again loads the leads and the note goes away', await ev(() => STATE.jobs.length === 1 && !document.getElementById('leads-loading-note')));
  await ev(() => doLogout()); await page.waitForTimeout(100);
  step('signing out removes any lead-loading note', await ev(() => !document.getElementById('leads-loading-note')));

  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
