// THE REPLY WINDOW SHOWS THE SIGNATURE OF THE MAILBOX IT SENDS FROM (owner, 14 Oct: "the email is sent from Lisa, but the
// signature shown is different — I think the preview is crashed"; the send itself used the right one).
//
// The page kept ONE signature for the whole session and never asked again, so whichever mailbox loaded first was shown under
// every mailbox after it. Pinned in a real browser with the API stubbed: two mailboxes with different signatures —
//   * a reply from the second mailbox previews the SECOND signature, after the first one was already loaded;
//   * going back to the first previews the first;
//   * New message follows the mailbox too;
//   * a signature changed on the server shows the next time a window opens (the preview is not stale for the whole session).
//
// Usage: node test/mailbox-signature-per-account-smoke.mjs
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
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const person = { name: 'Sara Ladd', email: 'sara@example.com' };
const MSG = { id: 'm1', thread_id: 't1', subject: 'Re: Controller', from: person, to: [{ name: 'x', email: 'x@futeglobal.com' }], cc: [], date: iso(60),
  preview: 'hello', unread: false, has_attachments: false, platform: 'Gmail', label_ids: [] };
const acct = (id, email) => ({ id, email_address: email, display_name: email, platform: 'Gmail', is_primary: id === 'mbA', is_active: true, readable: true, connection: { connected: true, status: 'ok' } });
let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'recruiter');
  // This suite is about the single-email list (the provider's /messages read). Conversations are the default since R-271
  // and have their own suite (mailbox-threads-ui-smoke); this is the person's own "Single emails" choice, not a bypass.
  await page.evaluate(() => { STATE.mailView = 'messages'; });
  await page.evaluate((F) => {
    window.__sig = { mbA: 'SIG-OF-PRINCE', mbB: 'SIG-OF-LISA' };
    window.apiGet = function (p) {
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve(F.accounts);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 2 });
      var s = /^\/mailbox\/(mb[AB])\/signature$/.exec(p);
      if (s) return Promise.resolve({ html: '<b>' + window.__sig[s[1]] + '</b>' });
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/folders$/.test(p)) return Promise.resolve(F.folders);
      if (/\/threads\//.test(p)) return Promise.resolve([]);
      if (/\/messages\?/.test(p)) return Promise.resolve(F.list);
      if (/\/messages\/m1/.test(p)) return Promise.resolve(F.full);
      return Promise.resolve({});
    };
    window.apiPatch = window.apiDelete = window.apiPost = function () { return Promise.resolve({ success: true }); };
  }, {
    accounts: [acct('mbA', 'prince@futeglobal.com'), acct('mbB', 'lisa@futeglobal.com')],
    folders: [{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 0, total: 1 }],
    list: { messages: [MSG], next_cursor: null, crm: {} },
    full: Object.assign({}, MSG, { body_html: '<p>body</p>', has_remote_images: false, attachments: [], crm: {} }),
  });
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => STATE.mailbox.activeId === 'mbA' && (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });

  const openReply = async () => {
    await page.evaluate(() => window.mbOpen('m1'));
    await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 8000 });
    await page.evaluate(() => window.mbReply(false));
    await page.waitForSelector('[data-win="mailReply"]', { timeout: 4000 });
  };
  const preview = () => page.evaluate(() => { const w = document.querySelector('[data-win="mailReply"]'); return w ? w.textContent : ''; });
  const turnOn = async () => {
    await page.evaluate(() => window.mbCompSetSig(true));
    await page.waitForFunction(() => /SIG-OF-/.test(document.querySelector('[data-win="mailReply"]').textContent), { timeout: 4000 });
  };
  const closeReply = () => page.evaluate(() => window.mbCancelComposer());

  await openReply(); await turnOn();
  step('first mailbox: the reply previews its own signature', /SIG-OF-PRINCE/.test(await preview()));
  await closeReply();

  await page.evaluate(() => window.mbSelectAccount('mbB'));
  await page.waitForFunction(() => STATE.mailbox.activeId === 'mbB' && (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  await openReply();
  await page.waitForFunction(() => /SIG-OF-/.test(document.querySelector('[data-win="mailReply"]').textContent), { timeout: 4000 });
  const second = await preview();
  step('second mailbox: the reply previews the SECOND signature', /SIG-OF-LISA/.test(second), second.replace(/\s+/g, ' ').slice(-120));
  step('…and not the first one', !/SIG-OF-PRINCE/.test(second));
  await closeReply();

  await page.evaluate(() => window.mbSelectAccount('mbA'));
  await page.waitForFunction(() => STATE.mailbox.activeId === 'mbA' && (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  await openReply();
  await page.waitForFunction(() => /SIG-OF-/.test(document.querySelector('[data-win="mailReply"]').textContent), { timeout: 4000 });
  step('back on the first mailbox: its own again', /SIG-OF-PRINCE/.test(await preview()) && !/SIG-OF-LISA/.test(await preview()));
  await closeReply();

  // a signature edited elsewhere shows the next time a window opens
  await page.evaluate(() => { window.__sig.mbA = 'SIG-PRINCE-EDITED'; });
  await openReply();
  await page.waitForFunction(() => /SIG-PRINCE-EDITED/.test(document.querySelector('[data-win="mailReply"]').textContent), { timeout: 4000 }).catch(() => {});
  step('a signature changed meanwhile shows when the next window opens', /SIG-PRINCE-EDITED/.test(await preview()));
  await closeReply();

  // New message follows the mailbox as well
  await page.evaluate(() => window.mbSelectAccount('mbB'));
  await page.waitForFunction(() => STATE.mailbox.activeId === 'mbB', { timeout: 8000 });
  await page.evaluate(() => window.mbCompose(''));
  await page.waitForSelector('#mb-c-editor', { timeout: 4000 });
  await page.evaluate(() => window.mbComposeSetSig(true));
  await page.waitForFunction(() => /SIG-OF-/.test(document.querySelector('.modal').textContent), { timeout: 4000 });
  const nm = await page.evaluate(() => document.querySelector('.modal').textContent);
  step('New message from the second mailbox previews the second signature', /SIG-OF-LISA/.test(nm) && !/SIG-OF-PRINCE/.test(nm));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the probe ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
