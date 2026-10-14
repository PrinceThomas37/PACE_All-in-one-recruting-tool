// THE MAILBOX DOES NOT FLASH WHEN YOU CLICK INSIDE IT (owner, 14 Oct: "the quick refresh, when labels are clicked and any
// button is clicked in that window").
//
// A flash is a thing being REPLACED: a new element means its pop-in animation plays again and every scroll box inside it goes
// back to the top. R-197 (13 Oct) fixed that for ordinary windows, but the label picker is an OVERLAY (UI.registerOverlay), and
// the in-place update only ran when the overlays had not changed — so every tick inside the label window rewrote the layer.
//
// Pinned here, in a real browser with the API stubbed. Each probe marks the live element, acts, then checks the SAME element
// is still there (a marker an element cannot inherit) — so a replaced window fails, and a missing one fails too:
//   * the label window: ticking a label, creating one, and pressing Done never replace the window element;
//   * the reading pane: Mark unread / Mark read never replace the message frame or the head;
//   * the window's inner scroll position is kept when its inside is updated.
//
// Usage: node test/mailbox-no-flash-smoke.mjs
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
const person = { name: 'Neil Patrick', email: 'neil.patrick@futeglobal.com' };
const me = { name: 'Priya', email: 'priya@futeglobal.com' };
const MSG = { id: 'm1', thread_id: 't1', subject: 'Re: Residential Superintendent', from: person, to: [me], cc: [], date: iso(60),
  preview: 'hello', unread: false, has_attachments: false, platform: 'Gmail', label_ids: ['L1'] };
const LABELS = Array.from({ length: 30 }, (_, i) => ({ id: 'L' + (i + 1), name: 'Label number ' + (i + 1), color: '#2b7' }));
const FIX = {
  accounts: [{ id: 'mb1', email_address: 'priya@futeglobal.com', display_name: 'Priya', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }],
  folders: [{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 0, total: 1 }],
  list: { messages: [MSG], next_cursor: null, crm: {} },
  full: Object.assign({}, MSG, { body_html: '<p>body</p>', has_remote_images: false, attachments: [], crm: {} }),
  labels: LABELS,
};

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

  await page.evaluate((F) => {
    window.apiGet = function (p) {
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve(F.accounts);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/labels$/.test(p)) return Promise.resolve(F.labels);
      if (/\/folders$/.test(p)) return Promise.resolve(F.folders);
      if (/\/threads\//.test(p)) return Promise.resolve([]);
      if (/\/messages\?/.test(p)) return Promise.resolve(F.list);
      if (/\/messages\/m1/.test(p)) return Promise.resolve(F.full);
      return Promise.resolve({});
    };
    window.apiPatch = window.apiDelete = function () { return Promise.resolve({ success: true }); };
    window.apiPost = function (p, body) {
      if (/\/bulk$/.test(p)) return Promise.resolve({ results: (body.ids || []).map(function (id) { return { id: id, ok: true }; }) });
      if (/\/labels$/.test(p)) return Promise.resolve({ id: 'LNEW', name: body.name });
      return Promise.resolve({ success: true });
    };
  }, FIX);

  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  await page.evaluate(() => window.mbOpen('m1'));
  await page.waitForFunction(() => STATE.mailbox.message && document.querySelector('#mb-open iframe'), { timeout: 8000 });
  await page.waitForTimeout(300);

  // ── the reading pane ──────────────────────────────────────────────────────
  await page.evaluate(() => {
    document.querySelector('#mb-open iframe').__probe = 'frame';
    document.querySelector('#mb-open').__probe = 'open';
  });
  const paneKept = () => page.evaluate(() => {
    const f = document.querySelector('#mb-open iframe'), o = document.querySelector('#mb-open');
    return !!f && f.__probe === 'frame' && !!o && o.__probe === 'open';
  });
  await page.evaluate(() => window.mbToggleRead('m1'));
  await page.waitForTimeout(150);
  step('Mark unread leaves the message frame and body standing', await paneKept());
  step('…and the button now offers Mark read', await page.evaluate(() => Array.from(document.querySelectorAll('#mb-head button')).some(b => b.textContent.trim() === 'Mark read')));
  await page.evaluate(() => window.mbToggleRead('m1'));
  await page.waitForTimeout(150);
  step('Mark read leaves the message frame and body standing', await paneKept());

  // ── the label window ──────────────────────────────────────────────────────
  await page.evaluate(() => window.mbLabelMenu(['m1']));
  await page.waitForSelector('.mb-lm-row', { timeout: 4000 });
  await page.waitForTimeout(400);   // the pop-in has finished
  await page.evaluate(() => {
    document.querySelector('.mb-lm').__probe = 'window';
    document.querySelector('.mb-lm-list').scrollTop = 200;
  });
  const winKept = () => page.evaluate(() => { const w = document.querySelector('.mb-lm'); return !!w && w.__probe === 'window'; });
  step('the label window opened and lists the labels', await page.evaluate(() => document.querySelectorAll('.mb-lm-row').length) >= 30);

  const rows = await page.$$('.mb-lm-row');
  await rows[20].click();
  await page.waitForTimeout(250);
  step('ticking a label updates the window where it stands (same element)', await winKept());
  step('…and the tick shows', await page.evaluate(() => !!document.querySelectorAll('.mb-lm-row')[20].querySelector('.st-all')));
  const top = await page.evaluate(() => document.querySelector('.mb-lm-list').scrollTop);
  step('…and the list inside it is still scrolled where it was', top >= 150, top + 'px');
  await (await page.$$('.mb-lm-row'))[3].click();
  await page.waitForTimeout(250);
  step('a second tick keeps the same window too', await winKept());

  await page.fill('#mb-newlabel', 'Fresh label');
  await page.click('.mb-lm-new button');
  await page.waitForTimeout(300);
  step('creating a label keeps the same window', await winKept());
  step('…and the new label is in the list', await page.evaluate(() => /Fresh label/.test(document.querySelector('.mb-lm-list').textContent)));

  await page.click('.mb-lm-h button');
  await page.waitForTimeout(200);
  step('Done closes it', await page.evaluate(() => !document.querySelector('.mb-lm')));
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
