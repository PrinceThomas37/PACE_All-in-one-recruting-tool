// A "RECONNECT YOUR MAILBOX" REMINDER CARRIES ITS OWN RECONNECT BUTTON (R-315, owner 26 Oct: "when a mailbox reconnect reminder
// is shown, reconnect option should be shown there only").
//   · the card shows Reconnect beside Dismiss (and an ordinary reminder does not);
//   · pressing it opens the sign-in for THAT mailbox (Gmail → Google's, Outlook → Microsoft's), looked up by its address;
//   · when the sign-in reports success the reminder closes by itself;
//   · an app-password mailbox goes to My Setup (it has no sign-in window); a mailbox no longer on the account says so.
// Usage: node test/reminder-reconnect-smoke.mjs   (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }

let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', (r) => { const u = r.request().url(); return u.startsWith(BASE + '/') && /\.(html|js|css)$|\/$/.test(new URL(u).pathname) ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const today = todayIST();
    window.__log = [];
    window.apiGet = (p) => { window.__log.push('GET ' + p); return Promise.resolve(/\/users\/test-bd\/emails$/.test(p) ? [
      { id: 'mg', email_address: 'ash@futeglobal.com', platform: 'Gmail' }, { id: 'mm', email_address: 'ash@vhcstaffing.com', platform: 'Microsoft' },
      { id: 'ms', email_address: 'ash@zoho.test', platform: 'SMTP' }] : []); };
    window.apiFetch = (m, p, b) => { window.__log.push(m + ' ' + p + ' ' + JSON.stringify(b)); return Promise.resolve({}); };
    window.connectGmailUserEmail = (u, id) => window.__log.push('google ' + u + ' ' + id);
    window.connectMicrosoftUserEmail = (u, id) => window.__log.push('microsoft ' + u + ' ' + id);
    const R = (id, mail) => ({ id, user_id: 'test-bd', contact_name: 'Reconnect your mailbox', company_name: mail, return_date: today, reminder_time: '09:00:00',
      status: 'pending', reminder_type: 'manager_prompt', note: 'BD Lead 1 asked you to pick this up.\nReconnect your mailbox · ' + mail });
    STATE.reminders = [R('r1', 'ash@futeglobal.com'), R('r2', 'ash@vhcstaffing.com'), R('r3', 'ash@zoho.test'), R('r4', 'gone@old.test'),
      { id: 'r5', user_id: 'test-bd', contact_name: 'Dana Reyes', company_name: 'Northwind', email: 'dana@northwind.test', return_date: today, reminder_time: '09:00:00', status: 'pending', reminder_type: 'manual' }];
    STATE.page = 'reminders'; render();
  });
  await page.waitForTimeout(300);
  const btns = await ev(() => [...document.querySelectorAll('.rem-card')].map((c) => ({ name: c.querySelector('.rem-name').innerText, reconnect: [...c.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Reconnect') })));
  step('each "Reconnect your mailbox" card has a Reconnect button', btns.filter((b) => b.name === 'Reconnect your mailbox').every((b) => b.reconnect), JSON.stringify(btns));
  step('…and an ordinary reminder does not', btns.find((b) => b.name === 'Dana Reyes') && !btns.find((b) => b.name === 'Dana Reyes').reconnect);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'reminder-reconnect.png'), clip: { x: 0, y: 0, width: 1280, height: 520 } });
  const press = async (rid) => { await ev((id) => { window.__log.length = 0; [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Reconnect' && /'(r\d)'/.exec(b.getAttribute('onclick'))[1] === id).click(); }, rid); await page.waitForTimeout(150); return ev(() => window.__log.slice()); };
  let log = await press('r1');
  step('a Gmail mailbox opens Google\'s sign-in for THAT mailbox', log.includes('google test-bd mg'), JSON.stringify(log));
  step('…and nothing closes the reminder before the sign-in succeeds', !log.some((x) => /PATCH \/reminders/.test(x)));
  await ev(() => window.postMessage({ type: 'google_oauth_success' }, '*')); await page.waitForTimeout(200);
  log = await ev(() => window.__log.slice());
  step('when the sign-in succeeds, the reminder closes by itself', log.some((x) => /PATCH \/reminders\/r1 \{"status":"sent"\}/.test(x)), JSON.stringify(log));
  log = await press('r2');
  step('an Outlook mailbox opens Microsoft\'s sign-in', log.includes('microsoft test-bd mm'), JSON.stringify(log));
  log = await press('r3');
  step('an app-password mailbox goes to My Setup (no sign-in window)', await ev(() => STATE.page === 'mysetup') && !log.some((x) => /google|microsoft/.test(x)));
  await ev(() => { STATE.page = 'reminders'; render(); }); await page.waitForTimeout(150);
  log = await press('r4');
  step('a mailbox no longer on the account opens nothing and says so', !log.some((x) => /google|microsoft/.test(x)) && /not connected to your account/.test(await ev(() => document.body.innerText)));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
