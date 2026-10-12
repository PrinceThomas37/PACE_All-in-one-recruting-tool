// Verifies the Email setup panel on Admin → Company domains (owner, 12 Oct, D-0120, R-200): what the customer's admin SEES
// (each item with its exact record, a plain count) and what the buttons do (copy the note for the IT person; check again, with a
// typed DKIM selector). The API is stubbed at window.apiGet; the rules are in test/email-setup-smoke.mjs.
//
// Usage: node test/email-setup-ui-smoke.mjs

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

const IT = 'Hello — to let PACE send email for acme.com ...\n1. SPF\n   Type: TXT\n   Host/Name: @\n   Value: v=spf1 include:zoho.com ~all';
const CHECK = (found, IT) => ({
  domain: 'acme.com', provider: { key: 'zoho', label: 'Zoho Mail', connect: 'smtp', region: 'com' }, done: found ? 4 : 2, total: 6, it_text: IT,
  items: [
    { id: 'ownership', title: 'Prove the domain is yours', status: 'done', summary: 'acme.com is verified. People with an address here are recognised as yours.' },
    { id: 'provider', title: 'Where your mail lives', status: 'done', summary: 'Your mail is on Zoho Mail (region com). Found from the domain\'s mail records (MX).' },
    { id: 'spf', title: 'SPF — who may send as your domain', status: found ? 'done' : 'todo', summary: found ? 'SPF is in place.' : 'No SPF record yet.', record: found ? null : { type: 'TXT', host: '@', value: 'v=spf1 include:zoho.com ~all', replaces: false } },
    { id: 'dkim', title: 'DKIM — a signature that proves the mail is yours', status: found ? 'done' : 'todo', summary: found ? 'DKIM is published (selector "mykey").' : 'No DKIM record found at "zoho", "zmail".', steps: found ? null : ['The key is made by your mail provider, so PACE cannot print it. Switch it on in Zoho Mail Admin Console → Domains.'] },
    { id: 'dmarc', title: 'DMARC — what to do with mail that fails the checks', status: 'todo', summary: 'No DMARC record yet.', record: { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none; rua=mailto:dmarc@acme.com', replaces: false } },
    { id: 'connect', title: 'How your staff connect their mailboxes', status: 'info', summary: 'Each person will connect with an app password from Zoho Mail. That connection is still being built, so Zoho Mail mailboxes cannot be connected yet.' },
    { id: 'staff', title: 'Let your people in', status: 'done', summary: 'Anyone who signs in with an address on acme.com joins automatically.' },
  ],
});

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  // The checklist builder runs inside the page (the stub answers from it), so it is passed as source.
  await page.evaluate(({ src, it }) => {
    const chk = new Function('return (' + src + ')')();
    window.__calls = [];
    window.apiGet = function (p) {
      window.__calls.push(p);
      if (p === '/org/domains') return Promise.resolve({ enabled: true, domains: [{ id: 'd1', domain: 'acme.com', verified_at: '2026-10-01T00:00:00Z', auto_join: true }] });
      if (/\/org\/domains\/d1\/email-setup/.test(p)) return Promise.resolve(/dkim_selector=mykey/.test(p) ? chk(true, it) : chk(false, it));
      return Promise.resolve(p.indexOf('/emails') === 0 ? [] : {});
    };
  }, { src: CHECK.toString(), it: IT });
  await enterApp(page, 'admin');
  await page.evaluate(() => { window.STATE.orgDomains = null; window.goPage('admin'); });
  await page.waitForTimeout(500);

  const content = () => page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('Company domains lists the claimed domain with an "Email setup" button', /acme\.com/.test(await content()) && (await page.locator('button', { hasText: 'Email setup' }).count()) === 1);
  await page.locator('button', { hasText: 'Email setup' }).click();
  await page.waitForTimeout(400);
  let t = await content();
  step('the panel says how far along it is, in plain numbers', /Email setup for acme\.com/.test(t) && /2 of 6 done/.test(t));
  step('each item is shown with what it found: where the mail lives, SPF, DKIM, DMARC, how staff connect, staff', /Where your mail lives/.test(t) && /SPF — who may send/.test(t) && /DKIM — a signature/.test(t) && /DMARC — what to do/.test(t) && /How your staff connect/.test(t) && /Let your people in/.test(t));
  step('the exact record to paste is shown: type, host and value', /Type TXT/.test(t) && /v=spf1 include:zoho\.com ~all/.test(t) && /Host _dmarc/.test(t) && /v=DMARC1; p=none; rua=mailto:dmarc@acme\.com/.test(t));
  step('a connection that is not built yet is SAID not to be built', /still being built/.test(t) && /cannot be connected yet/.test(t));
  step('DKIM gets a box for a selector name (the provider\'s own), not an invented key', (await page.locator('#es-selector').count()) === 1 && !/p=MIGf/.test(t));

  await page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'email-setup.png') : '/dev/null', fullPage: false }).catch(() => {});

  await page.locator('button', { hasText: 'Copy for your IT person' }).click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  step('"Copy for your IT person" puts the note on the clipboard', clip === IT, JSON.stringify(clip).slice(0, 60));

  await page.locator('#es-selector').fill('mykey');
  await page.locator('button', { hasText: 'Check again' }).click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__calls.filter(c => /email-setup/.test(c)));
  step('Check again asks the server again, with the typed DKIM selector', calls.length === 2 && /dkim_selector=mykey/.test(calls[1]), JSON.stringify(calls));
  t = await content();
  step('…and what turned green is shown as done (4 of 6, DKIM published)', /4 of 6 done/.test(t) && /DKIM is published \(selector "mykey"\)/.test(t));

  await page.locator('button', { hasText: /^Close$/ }).click();
  step('Close puts the domain list back, with no panel', !/Email setup for acme\.com/.test(await content()));

  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the suite ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.length && results.every(Boolean) ? 0 : 1);
