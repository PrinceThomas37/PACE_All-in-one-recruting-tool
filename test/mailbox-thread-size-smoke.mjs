// THE OPEN MESSAGE IN A LONG THREAD IS BIG ENOUGH TO READ (R-108).
//
// Owner, 1 Oct: "The preview window of the email tab is not big enough, it open up
// like a window inside a screen." Screenshot: a 6-message conversation, the open
// message in a ~260px box with its own scrollbar.
//
// Pinned here, in a real browser with the API stubbed:
//   * in a long thread the open message is much taller than the old 260px, and
//     scales with the window (tall window -> taller box);
//   * "Expand message" makes it fill (nearly) the window, "Shrink message" gives
//     it back, and closing the reader forgets the choice;
//   * the sandboxed iframe is the SAME element after expanding (a class changed,
//     the frame was not rewritten — a rewrite is the white flash the mailbox
//     was already fixed for) and is still sandboxed without scripts;
//   * a single-message conversation is unchanged: no Expand button, body fills pane;
//   * phone width: nothing overflows sideways, the button is reachable.
//
// Usage: node test/mailbox-thread-size-smoke.mjs   (MAILBOX_SHOT_DIR=… to keep screenshots)
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
const SHOTS = process.env.MAILBOX_SHOT_DIR || '';

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
const LONG = Array.from({ length: 40 }, (_, i) => `<p>Line ${i + 1} of a long email, so the body has to scroll somewhere.</p>`).join('');
const THREAD = Array.from({ length: 6 }, (_, i) => ({
  id: 'm' + (i + 1), thread_id: 't1', subject: 'Re: Senior Project Manager — Corona, California',
  from: i % 2 ? me : person, to: [i % 2 ? person : me], cc: [], date: iso(600 - i * 60),
  preview: i === 2 ? 'Hi <neil.patrick@futeglobal.com> - what\'s the status?' : 'Message ' + (i + 1) + ' preview text',
  unread: false, has_attachments: false, platform: 'Gmail',
}));
const FIX = {
  accounts: [{ id: 'mb1', email_address: 'priya@futeglobal.com', display_name: 'Priya', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }],
  folders: [{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 0, total: 6 }],
  list: { messages: [THREAD[5]], next_cursor: null, crm: {} },
  full: (id) => Object.assign({}, THREAD.find(t => t.id === id), { body_html: LONG, has_remote_images: false, attachments: [], crm: {} }),
  single: Object.assign({}, THREAD[0], { id: 's1', thread_id: 'ts', body_html: '<p>just one message</p>', has_remote_images: false, attachments: [], crm: {} }),
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
      if (/\/folders$/.test(p)) return Promise.resolve(F.folders);
      if (/\/threads\/ts/.test(p)) return Promise.resolve([]);
      if (/\/threads\//.test(p)) return Promise.resolve(F.thread);
      if (/\/messages\?/.test(p)) return Promise.resolve(F.list);
      if (/\/messages\/s1/.test(p)) return Promise.resolve(F.single);
      var m = /\/messages\/(m\d)/.exec(p);
      if (m) return Promise.resolve(F.full(m[1]));
      return Promise.resolve({});
    };
    window.apiPost = window.apiPatch = window.apiDelete = function () { return Promise.resolve({ success: true }); };
    window.__F = F;
  }, Object.assign({}, FIX, { thread: THREAD, full: undefined }));
  // functions do not cross evaluate(): rebuild the one that needs data
  await page.evaluate((args) => {
    window.__F.full = function (id) { return Object.assign({}, args.thread.find(function (t) { return t.id === id; }), { body_html: args.long, has_remote_images: false, attachments: [], crm: {} }); };
    var orig = window.apiGet;
    window.apiGet = function (p) { var m = /\/messages\/(m\d)/.exec(p); if (m && !/\/messages\?/.test(p)) return Promise.resolve(window.__F.full(m[1])); return orig(p); };
  }, { thread: THREAD, long: LONG });

  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  await page.evaluate(() => window.mbOpen('m6'));
  await page.waitForFunction(() => STATE.mailbox.thread && STATE.mailbox.thread.length === 6 && document.querySelector('#mb-open iframe'), { timeout: 8000 });

  const box = () => page.evaluate(() => { const b = document.querySelector('#mb-open .mb-body'); const r = b.getBoundingClientRect(); return { h: Math.round(r.height), cls: b.className, vh: innerHeight }; });
  const before = await box();
  step('in a 6-message thread the open message is well above the old 260px', before.h >= 340, `${before.h}px of a ${before.vh}px window`);
  step('and it scales with the window (not a fixed postage stamp)', before.h > 400 && before.h <= before.vh, `${before.h}px`);
  const tag = await page.evaluate(() => { const f = document.querySelector('#mb-open iframe'); f.setAttribute('data-probe', 'same-frame'); return f.getAttribute('sandbox'); });
  step('the frame is still sandboxed and cannot run scripts', tag !== null && !/allow-scripts|allow-same-origin/.test(tag), tag);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'thread-default.png') });

  const btnLabel = () => page.evaluate(() => { const b = Array.from(document.querySelectorAll('#mb-head button')).find(x => /message$/.test(x.textContent.trim())); return b ? b.textContent.trim() : null; });
  step('an "Expand message" button is offered in a long thread', (await btnLabel()) === 'Expand message');
  await page.evaluate(() => window.mbToggleTall());
  const tall = await box();
  step('Expand makes it fill (nearly) the window', tall.h >= tall.vh - 170 && tall.h > before.h, `${tall.h}px of ${tall.vh}px`);
  step('the same frame element survived (class change, no rewrite)', await page.evaluate(() => document.querySelector('#mb-open iframe').getAttribute('data-probe')) === 'same-frame');
  step('the button now offers to shrink it', (await btnLabel()) === 'Shrink message');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'thread-expanded.png') });
  await page.evaluate(() => window.mbToggleTall());
  step('Shrink gives the size back', (await box()).h === before.h);
  await page.evaluate(() => { window.mbToggleTall(); window.mbBack(); });
  await page.evaluate(() => window.mbOpen('m6'));
  await page.waitForFunction(() => document.querySelector('#mb-open iframe') && STATE.mailbox.thread, { timeout: 8000 });
  step('closing the reader forgets the Expand choice', !(await box()).cls.includes('tall'));

  // a taller window gives a taller box
  await page.setViewportSize({ width: 1440, height: 1200 });
  const bigger = await box();
  step('a taller window gives a taller box', bigger.h > before.h, `${before.h}px -> ${bigger.h}px`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // single message: unchanged
  await page.evaluate(() => { STATE.mailbox.thread = []; window.mbOpen('s1'); });
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 's1', { timeout: 8000 });
  await page.waitForTimeout(200);
  const hasBtn = await page.evaluate(() => Array.from(document.querySelectorAll('#mb-head button')).some(x => /message$/.test(x.textContent.trim())));
  step('a single-message conversation has no Expand button', !hasBtn);
  step('and its body still fills the pane (solo)', await page.evaluate(() => !!document.querySelector('.mb-thread.solo')));

  // phone
  await page.evaluate(() => window.mbBack());
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => window.mbOpen('m6'));
  await page.waitForFunction(() => STATE.mailbox.thread && STATE.mailbox.thread.length === 6 && document.querySelector('#mb-open iframe'), { timeout: 8000 });
  await page.waitForTimeout(700);   // the sidebar slides off-canvas when the window narrows
  const phone = await page.evaluate(() => { const c = document.getElementById('content'); const b = document.querySelector('#mb-open .mb-body').getBoundingClientRect(); const btn = Array.from(document.querySelectorAll('#mb-head button')).find(x => /message$/.test(x.textContent.trim())); const br = btn && btn.getBoundingClientRect(); return { over: c.scrollWidth - c.clientWidth, bodyW: Math.round(b.width), bodyH: Math.round(b.height), btn: !!br && br.right <= innerWidth && br.left >= 0 }; });
  step('phone: nothing overflows sideways', phone.over <= 1, `overflow ${phone.over}px`);
  step('phone: the message box is readable and the Expand button is on screen', phone.bodyH >= 340 && phone.btn, `${phone.bodyW}x${phone.bodyH}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'thread-phone.png') });

  step('No page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
} catch (e) {
  step('suite ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  if (browser) await browser.close();
  server.close();
}
const ok = results.every(Boolean);
console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(ok ? 0 : 1);
