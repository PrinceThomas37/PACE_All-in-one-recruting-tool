// THE SYSTEM-HEALTH BANNER ON THE ADMIN'S DASHBOARD, IN THE REAL BROWSER CODE (public/js/77-system-health.js) (R-367).
//   draws nothing on a healthy day and nothing for a non-admin · draws each issue with its words and ONLY the buttons the server offered ·
//   a button that changes data asks first (Cancel does nothing) · OK calls that endpoint, then asks again and the banner updates ·
//   a failure says so and leaves the button usable · a check that could not run says so (never "all fine") · an opening button opens the mailbox panel.
// Usage: node test/system-health-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
const web = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((r) => web.listen(0, '127.0.0.1', () => r(web.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const issues = [
  { id: 'followups_missed', level: 'bad', title: "Today's follow-ups have not run", sentence: 'The daily follow-up run is set for 08:30 (India time) and it has not run today. It last ran on 2026-10-29.', since: '2026-10-29', actions: [{ id: 'run_followups', label: 'Run follow-ups now', confirm: "Run today's follow-ups now?", method: 'POST', path: '/follow-ups/run' }] },
  { id: 'mailboxes_attention', level: 'bad', title: 'Some mailboxes are not sending', sentence: '1 sign-in expired (a@acme.com).', since: null, actions: [{ id: 'go_mailboxes', label: 'Open the mailbox panel', go: 'deliverability' }] },
];
const calls = []; let healthAnswer = { issues }, failRun = false;
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', async (r) => {
    const u = r.request().url(); if (u.startsWith(BASE)) return r.continue();
    if (!u.startsWith(API)) return r.abort();
    const U = new URL(u), p = U.pathname, m = r.request().method(); calls.push(m + ' ' + p);
    const rep = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/admin/system-health') return healthAnswer === 'fail' ? rep({ error: 'x' }, 500) : rep(healthAnswer);
    if (p === '/follow-ups/run' && m === 'POST') { if (failRun) return rep({ error: 'the database timed out' }, 500); healthAnswer = { issues: issues.slice(1) }; return rep({ success: true, fu1_queued: 7, fu2_queued: 3 }); }
    return rep(m === 'GET' ? [] : {});
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  const ev = (f, a) => page.evaluate(f, a);
  const banner = () => ev(() => { const b = document.getElementById('sh-banner'); return b ? b.innerText.replace(/\s+/g, ' ') : null; });
  const show = async (role) => { await ev((role) => { STATE.user = Object.assign({}, STATE.user, { role, roles: [role] }); STATE.systemHealth = undefined; STATE._shLoading = false; STATE.page = 'dashboard'; render(); }, role); await page.waitForTimeout(500); };
  await ev(() => { window.__confirms = []; window.__answer = true; window.confirm = (t) => { window.__confirms.push(t); return window.__answer; }; window.openDeliverability = () => { window.__opened = true; }; });

  await show('admin');
  let b = await banner();
  step('the admin sees the banner with both issues, in words', b && /System health/.test(b) && /Today's follow-ups have not run/.test(b) && /last ran on 2026-10-29/.test(b) && /Some mailboxes are not sending/.test(b), b);
  step('…the follow-ups line is marked "needs you" and says since when', /needs you/i.test(b) && /since 2026-10-29/.test(b));
  step('…it offers exactly the buttons the server offered: "Run follow-ups now" and "Open the mailbox panel"', await ev(() => [...document.querySelectorAll('#sh-banner button')].map((x) => x.textContent.trim()).join('|')) === 'Run follow-ups now|Open the mailbox panel');
  const askedBefore = calls.filter((c) => c === 'POST /follow-ups/run').length;
  await ev(() => { window.__answer = false; }); await page.locator('#sh-banner button:has-text("Run follow-ups now")').click(); await page.waitForTimeout(250);
  step('pressing it asks first, in the server\'s sentence — and Cancel does nothing', (await ev(() => window.__confirms.length)) === 1 && calls.filter((c) => c === 'POST /follow-ups/run').length === askedBefore);
  failRun = true; await ev(() => { window.__answer = true; }); await page.locator('#sh-banner button:has-text("Run follow-ups now")').click(); await page.waitForTimeout(500);
  const toast1 = await ev(() => document.body.innerText);
  step('a failure says so with the reason, and the button works again', /Could not do that: the database timed out/.test(toast1) && !(await ev(() => document.querySelector('#sh-banner button[data-sh-action="run_followups"]').disabled)));
  failRun = false; await page.locator('#sh-banner button:has-text("Run follow-ups now")').click(); await page.waitForTimeout(700);
  step('OK calls the endpoint, tells the person what happened (10 queued), and the banner asks again', /10 follow-ups queued/.test(await ev(() => document.body.innerText)) && calls.filter((c) => c === 'POST /follow-ups/run').length === askedBefore + 2);
  b = await banner();
  step('…and the fixed issue is gone from the banner, the other stays', b && !/follow-ups have not run/.test(b) && /Some mailboxes are not sending/.test(b), b);
  await page.locator('#sh-banner button:has-text("Open the mailbox panel")').click(); await page.waitForTimeout(150);
  step('an opening button opens the mailbox panel and changes nothing', (await ev(() => window.__opened)) === true && calls.filter((c) => /^(POST|PUT|DELETE)/.test(c) && !/follow-ups/.test(c)).length === 0);
  healthAnswer = { issues: [] }; await show('admin');
  step('a healthy day draws NOTHING', (await banner()) === null);
  healthAnswer = 'fail'; await show('admin');
  step('a check that could not run says so — it never looks like "all fine"', /Could not check the system's health/.test((await banner()) || ''));
  healthAnswer = { issues }; const c0 = calls.filter((c) => c === 'GET /admin/system-health').length; await show('bd');
  step('a BD never sees the banner and never even asks for it', (await banner()) === null && calls.filter((c) => c === 'GET /admin/system-health').length === c0);
  await ev(() => { STATE.systemHealth = { issues: [{ id: 'x', level: 'bad', title: 'T', sentence: 'S', actions: [{ id: 'evil', label: 'Evil', method: 'POST', path: 'https://evil.example/x' }] }] }; STATE.user = Object.assign({}, STATE.user, { role: 'admin', roles: ['admin'] }); render(); });
  const n = calls.length; await page.locator('#sh-banner button:has-text("Evil")').click(); await page.waitForTimeout(250);
  step('a button whose path is not this app\'s own endpoint is ignored', calls.length === n);
  step('no script errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('browser test ran without throwing', false, e.stack); }
if (browser) await browser.close(); web.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
