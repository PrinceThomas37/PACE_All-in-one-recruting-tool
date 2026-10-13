// Verifies the app-password window on My Setup (D-0120, R-200 step b): the extra button appears only when the server can hold
// passwords; the window shows the provider's guide, runs the connection, shows each step with a tick or a cross, never leaves the
// password on the screen, and ends on a "Mailbox ready" card. The API is stubbed at window.apiGet/apiPost; the rules are on the
// server (test/smtp-routes-smoke.mjs).
//
// Usage: node test/my-setup-smtp-ui-smoke.mjs

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
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const PW = 'zz-very-secret-app-pw-9';
const BOX = { id: 'mbS', user_id: 'test-bd', email_address: 'bea@acme.test', display_name: 'Bea Smith', platform: 'SMTP', is_active: true, daily_send_limit: 150, connection: { connected: false, status: 'none' }, sends_as: { company: 'Acme Talent', title: 'VP', address: '1 Main Street, Austin TX' }, has_own_signature: true };
const INFO = (known) => ({ enabled: true, email: 'bea@acme.test', provider: { key: known ? 'zoho' : 'other', label: known ? 'Zoho Mail' : 'another mail provider' }, servers_known: known,
  guide: known ? { title: 'Get an app password from Zoho', steps: ['Open Zoho Accounts and go to Security → App Passwords.', 'Choose "Generate New Password", name it PACE.'], note: 'App passwords need two-factor sign-in turned on in Zoho.' } : { title: 'Get an app password from your mail provider', steps: ['Create an app password named PACE.'], note: '' } });

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  // functions cannot be passed into the page: pass the builder as source
  await page.evaluate(({ box, infoSrc }) => {
    const info = new Function('return (' + infoSrc + ')')();
    window.__posts = []; window.__enabled = true; window.__known = true; window.__connectAnswers = []; window.__box = JSON.parse(JSON.stringify(box));
    window.apiGet = function (p) {
      if (p === '/smtp/enabled') return Promise.resolve({ enabled: window.__enabled });
      if (/^\/smtp\/info\//.test(p)) return Promise.resolve(info(window.__known));
      if (/^\/users\/[^/]+\/emails$/.test(p)) return Promise.resolve([window.__box]);
      if (p === '/my-setup/send-window') return Promise.resolve({ org: { start: 8, end: 16 }, prefs: {}, effective: { start: 8, end: 16, days: ['mon'] }, days: ['mon'] });
      if (p === '/outreach-plan') return Promise.resolve({});
      return Promise.resolve(p.indexOf('/emails') === 0 ? [] : {});
    };
    window.apiPost = function (p, b) {
      window.__posts.push([p, JSON.parse(JSON.stringify(b || {}))]);
      if (/^\/smtp\/connect\//.test(p)) return Promise.resolve(window.__connectAnswers.shift());
      return Promise.resolve({});
    };
  }, { box: BOX, infoSrc: INFO.toString() });
  await enterApp(page, 'bd');
  const text = () => page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  const modal = () => page.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.innerText.replace(/\s+/g, ' ') : ''; });
  const openSetup = async () => { await page.evaluate((b) => { window.STATE.userEmailsCache = window.STATE.userEmailsCache || {}; window.STATE.userEmailsCache['test-bd'] = [JSON.parse(JSON.stringify(b))]; window.STATE.mySetup = window.STATE.mySetup || {}; window.STATE.mySetup.smtpOn = undefined; window.goPage('mysetup'); }, BOX); await page.waitForTimeout(500); };

  // ── the button follows the server ─────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__enabled = false; });
  await openSetup();
  step('when the server CANNOT hold passwords there is no app-password button (a screen must not advertise it)', !/Add mailbox with an app password/.test(await text()));
  await page.evaluate(() => { window.__enabled = true; });
  await openSetup();
  step('when it can, the button is there beside Outlook and Gmail', /Add mailbox with an app password/.test(await text()) && /Add Outlook mailbox/.test(await text()));
  step('an app-password mailbox is labelled as such and offers "Enter the app password" (not a sign-in popup)', /App password/.test(await text()) && /Enter the app password/.test(await text()) && !/Connect Outlook/.test(await text()));

  // ── the window ────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.locator('button', { hasText: 'Enter the app password' }).click();
  await page.waitForTimeout(400);
  let m = await modal();
  step('it names the mailbox, and shows how to get an app password from THIS provider', /Connect bea@acme\.test with an app password/.test(m) && /Get an app password from Zoho/.test(m) && /Generate New Password/.test(m) && /two-factor/.test(m));
  step('the password box hides what is typed, and no server fields are shown for a provider PACE knows', (await page.locator('#ms-smtp-pass[type=password]').count()) === 1 && (await page.locator('#ms-smtp-host').count()) === 0);
  await page.locator('.modal button', { hasText: /^Connect$/ }).click();
  await page.waitForTimeout(150);
  step('connecting with no password asks for one and calls nothing', /Type the app password/.test(await modal()) && !(await page.evaluate(() => window.__posts.length)));

  await page.evaluate(() => { window.__connectAnswers.push({ ok: false, steps: [ { id: 'servers', ok: true, label: 'Found your mail servers', message: 'Zoho (business) — smtppro.zoho.com' }, { id: 'smtp', ok: true, label: 'Signed in to send', message: 'The outgoing server accepted the app password.' }, { id: 'imap', ok: false, label: 'Signed in to read replies', message: 'IMAP is switched off for this mailbox. Turn on IMAP access in the mail settings, then try again.' } ] }); });
  await page.locator('#ms-smtp-pass').fill(PW);
  await page.locator('.modal button', { hasText: /^Connect$/ }).click();
  await page.waitForTimeout(400);
  m = await modal();
  const posted = await page.evaluate(() => window.__posts[0]);
  step('it asks the server once, for THIS mailbox, sending only the password (no servers, no username)', posted[0] === '/smtp/connect/mbS' && JSON.stringify(posted[1]) === JSON.stringify({ password: PW }));
  step('each step is shown with a tick or a cross and its plain-words message', /✓ Found your mail servers/.test(m) && /✓ Signed in to send/.test(m) && /✗ Signed in to read replies/.test(m) && /IMAP is switched off/.test(m));
  step('the password is NOT left on the screen or in the page after the attempt', !m.includes(PW) && (await page.locator('#ms-smtp-pass').inputValue()) === '' && !(await page.evaluate((pw) => JSON.stringify(window.STATE.mySetup && window.STATE.mySetup.smtp || {}).includes(pw), PW)));
  step('a failed attempt is not "ready", and can be tried again', !/Mailbox ready/.test(m) && (await page.locator('.modal button', { hasText: /^Connect$/ }).count()) === 1);

  await page.evaluate(() => { window.__connectAnswers.push({ ok: true, daily_send_limit: 150, steps: [ { id: 'servers', ok: true, label: 'Found your mail servers', message: 'Zoho (business) — smtppro.zoho.com' }, { id: 'smtp', ok: true, label: 'Signed in to send', message: 'The outgoing server accepted the app password.' }, { id: 'imap', ok: true, label: 'Signed in to read replies', message: 'The incoming server accepted it and the inbox opens.' }, { id: 'test', ok: true, label: 'Test email', message: 'A test email reached your inbox.' } ] }); window.__box.connection = { connected: true, status: 'ok' }; });
  await page.locator('#ms-smtp-pass').fill(PW);
  await page.locator('.modal button', { hasText: /^Connect$/ }).click();
  await page.waitForTimeout(500);
  m = await modal();
  step('success ends on a "Mailbox ready" card: connected, replies and bounces noticed, the admin-set daily limit, and the honest note about the in-app inbox', /Mailbox ready/.test(m) && /bea@acme\.test is connected/.test(m) && /daily limit is 150 emails, as set by your admin/.test(m) && /in-app inbox is not available/.test(m));
  await page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'smtp-ready.png') : '/dev/null' }).catch(() => {});
  await page.locator('.modal button', { hasText: /^Done$/ }).click();
  await page.waitForTimeout(500);
  step('Done closes the window and the mailbox now shows Connected', !(await modal()) && /Connected/.test(await text()) && /1 mailbox connected/.test(await text()));

  // ── a provider PACE does not know ─────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__known = false; window.__box.connection = { connected: false, status: 'none' }; });
  await openSetup();
  await page.locator('button', { hasText: 'Enter the app password' }).click();
  await page.waitForTimeout(400);
  step('an unknown provider shows the server boxes straight away (PACE does not guess)', (await page.locator('#ms-smtp-host').count()) === 1 && (await page.locator('#ms-imap-host').count()) === 1 && /Create an app password named PACE/.test(await modal()));
  await page.evaluate(() => { window.__posts.length = 0; window.__connectAnswers.push({ ok: false, steps: [{ id: 'smtp', ok: false, label: 'Signed in to send', message: 'Could not find smtp.example.com. Check the server name.' }] }); });
  await page.locator('#ms-smtp-host').fill('smtp.example.com'); await page.locator('#ms-imap-host').fill('imap.example.com'); await page.locator('#ms-smtp-pass').fill(PW);
  await page.locator('.modal button', { hasText: /^Connect$/ }).click();
  await page.waitForTimeout(400);
  const p2 = await page.evaluate(() => window.__posts[0]);
  step('typed servers are sent as typed, with the secure SMTP port and IMAP 993', p2[1].smtp_host === 'smtp.example.com' && p2[1].imap_host === 'imap.example.com' && p2[1].smtp_port === 465 && p2[1].imap_port === 993 && p2[1].password === PW);
  step('and the typed servers are still there to correct after a failure, but the password is not', (await page.locator('#ms-smtp-host').inputValue()) === 'smtp.example.com' && (await page.locator('#ms-smtp-pass').inputValue()) === '' && /Could not find smtp\.example\.com/.test(await modal()));

  // ── a server that cannot hold passwords says so inside the window ─────────────────────────────────────────────────
  await page.evaluate(() => { window.mySetupSmtpClose(); window.apiGet = (function (orig) { return function (p) { if (/^\/smtp\/info\//.test(p)) return Promise.resolve({ enabled: false, reason: 'This server cannot store mailbox passwords yet (MAILBOX_SECRET_KEY is not set), so app-password mailboxes are not available.' }); return orig(p); }; })(window.apiGet); });
  await page.evaluate(() => window.mySetupSmtpOpen('mbS'));
  await page.waitForTimeout(300);
  m = await modal();
  step('if the server is not set up, the window says why and offers no password box', /MAILBOX_SECRET_KEY/.test(m) && (await page.locator('#ms-smtp-pass').count()) === 0);
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the suite ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.length && results.every(Boolean) ? 0 : 1);
