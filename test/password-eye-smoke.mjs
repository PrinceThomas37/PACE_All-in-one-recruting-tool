// THE EYE ON THE PASSWORD BOXES AN ADMIN TYPES INTO (owner, 16 Oct 2026: "an eye icon, when clicked reveal the password")
//   * Add user → "Sign-in password" has an eye; the typed text is hidden until the eye is clicked, hidden again on a second click
//   * a user's profile → "Sign-in password → Set password" has the same
//   * a saved password is never shown: nothing in the page asks the server for one (no route exists that returns it)
// Usage: node test/password-eye-smoke.mjs
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
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');

  async function eyeCycle(label, inputId) {
    await page.fill('#' + inputId, 'welcome-2026');
    const type0 = await page.$eval('#' + inputId, e => e.type);
    step(label + ': typed text starts hidden', type0 === 'password');
    const eye = page.locator('#' + inputId + ' ~ .pw-eye');
    step(label + ': there is an eye next to it', (await eye.count()) === 1);
    await eye.click();
    const type1 = await page.$eval('#' + inputId, e => e.type), val1 = await page.$eval('#' + inputId, e => e.value);
    step(label + ': clicking the eye shows what was typed', type1 === 'text' && val1 === 'welcome-2026', type1 + ' / ' + val1);
    await eye.click();
    step(label + ': a second click hides it again', (await page.$eval('#' + inputId, e => e.type)) === 'password');
    step(label + ': the typed value is untouched by the toggle', (await page.$eval('#' + inputId, e => e.value)) === 'welcome-2026');
  }

  await page.evaluate(() => { STATE.page = 'admin'; window.openAddUser(); });
  await page.waitForSelector('#u-pw');
  await eyeCycle('Add user', 'u-pw');
  await page.evaluate(() => closeModal());

  await page.evaluate(() => {
    STATE.users = (STATE.users || []).concat([{ id: 'u9', name: 'New Person', email: 'np@example.test', role: 'bd', roles: ['bd'], active: true }]);
    // The person's email IDs arrive AFTER the profile opens and repaint it — held here until the test lets them through.
    window.__held = []; window.__releaseEmails = () => window.__held.forEach((f) => f());
    window.apiGet = () => new Promise((res) => { window.__held.push(() => res([])); });
    STATE.adminSelectedUser = 'u9'; STATE.page = 'admin'; render();
  });
  await page.waitForSelector('#ud-pw', { timeout: 5000 }).catch(() => {});
  if (await page.$('#ud-pw')) {
    await page.fill('#ud-pw', 'typed-before-load');
    await page.evaluate(() => window.__releaseEmails());
    await page.waitForFunction(() => STATE.userEmailsCache && STATE.userEmailsCache.u9, null, { timeout: 5000 });
    step('Profile: a password typed before the email IDs arrive survives the repaint', (await page.$eval('#ud-pw', e => e.value)) === 'typed-before-load');
    await eyeCycle('Profile', 'ud-pw');
  } else step('Profile: the Sign-in password box rendered', false, 'ud-pw not found');
  step('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
} finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
