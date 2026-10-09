// THE REPLY IS A WINDOW, AND NOTHING YOU TYPED IS LOST (owner, 7 Oct): "when reply or forward is clicked it does not
// open up like a new window … we have to go back and take some information from somewhere else in the app, what we
// have written goes off, the reply resets."  Driven in a real browser, API stubbed like mailbox-page-smoke.
//   * Reply / Forward open a window on the dock (minimise · full screen · close);
//   * clicking ANOTHER message does not wipe a reply in progress, and sending it answers the ORIGINAL message;
//   * minimise → go to another page → come back: the words are still there;
//   * closing the window keeps a draft on this device; Reply on that message brings it back; Discard deletes it.
//
// Usage: node test/reply-window-smoke.mjs

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
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const FIXTURES = {
  accounts: [
    { id: 'mb1', email_address: 'priya@futeglobal.com', display_name: 'Priya', platform: 'Microsoft',
      is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } },
    { id: 'mb2', email_address: 'priya.recruiting@gmail.com', display_name: 'Priya (Gmail)', platform: 'Gmail',
      is_primary: false, is_active: true, readable: true, connection: { connected: true, status: 'ok' } },
  ],
  folders: [
    { id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 3, total: 214 },
    { id: 'f-drafts', name: 'Drafts', kind: 'drafts', unread: 0, total: 2 },
    { id: 'f-sent', name: 'Sent Items', kind: 'sent', unread: 0, total: 480 },
    { id: 'f-archive', name: 'Archive', kind: 'archive', unread: 0, total: 1204 },
    { id: 'f-junk', name: 'Junk Email', kind: 'junk', unread: 1, total: 33 },
    { id: 'f-trash', name: 'Deleted Items', kind: 'trash', unread: 0, total: 61 },
    { id: 'f-client', name: 'Client escalations', kind: 'custom', unread: 2, total: 18 },
  ],
  messages: {
    messages: [
      { id: 'm1', thread_id: 't1', subject: 'Re: Senior Java Developer — interview Friday?',
        from: { name: 'Ada Okafor', email: 'ada.okafor@fidelity.com' },
        to: [{ email: 'priya@futeglobal.com' }], cc: [],
        date: new Date(Date.now() - 40 * 60000).toISOString(),
        preview: 'Friday 3pm works for us. Can you share the two profiles before then?',
        unread: true, has_attachments: false, platform: 'Microsoft' },
      { id: 'm2', thread_id: 't2', subject: 'Updated CV + notice period',
        from: { name: 'Rahul Menon', email: 'rahul.menon@gmail.com' },
        to: [{ email: 'priya@futeglobal.com' }], cc: [],
        date: new Date(Date.now() - 5 * 3600000).toISOString(),
        preview: 'Attaching my updated CV. My notice period is 30 days, negotiable to 15.',
        unread: true, has_attachments: true, platform: 'Microsoft' },
      { id: 'm3', thread_id: 't3', subject: 'Invoice INV-2291 for July',
        from: { name: 'Accounts', email: 'billing@somevendor.io' },
        to: [{ email: 'priya@futeglobal.com' }], cc: [],
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        preview: 'Please find attached the invoice for services rendered in July.',
        unread: false, has_attachments: true, platform: 'Microsoft' },
    ],
    next_cursor: '25',
    // Two of the three senders are already people we are working. That is the
    // whole reason to read mail inside an ATS rather than in Outlook.
    crm: {
      'ada.okafor@fidelity.com': { type: 'contact', id: 'c1', job_id: 'job-1', name: 'Ada Okafor' },
      'rahul.menon@gmail.com': { type: 'candidate', id: 'cand-1', name: 'Rahul Menon' },
    },
  },
  message: {
    id: 'm1', thread_id: 't1', subject: 'Re: Senior Java Developer — interview Friday?',
    from: { name: 'Ada Okafor', email: 'ada.okafor@fidelity.com' },
    to: [{ name: 'Priya', email: 'priya@futeglobal.com' }],
    cc: [{ email: 'hiring@fidelity.com' }],
    date: new Date(Date.now() - 40 * 60000).toISOString(),
    unread: true, has_attachments: false,
    body_html: '<p>Hi Priya,</p><p>Friday 3pm works for us. Can you share the two profiles before then?</p>'
      + '<p>Also — is the second candidate open to a hybrid arrangement?</p><p>Thanks,<br>Ada</p>'
      + '<img data-blocked-src="https://track.test/pixel.gif">',
    has_remote_images: true,
    attachments: [],
    crm: { 'ada.okafor@fidelity.com': { type: 'contact', id: 'c1', job_id: 'job-1', name: 'Ada Okafor' } },
  },
};

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'recruiter');

  await page.evaluate((F) => {
    window.__calls = [];
    window.apiGet = function (p) {
      window.__calls.push(['GET', p]);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve(F.accounts);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 4, mailboxes: 2 });
      // The server returns the signature already FILLED — the bug this guards
      // is the raw template ({{sender}}) reaching a real recipient.
      if (/\/signature$/.test(p)) return Promise.resolve({
        html: '<div><b>Priya Sharma</b><br>Recruitment Manager | Fute Global LLC</div>' });
      if (/\/folders$/.test(p)) return Promise.resolve(F.folders);
      if (/\/messages\?/.test(p)) {
        // Search narrows to one row, so the test can tell the two apart.
        if (/[?&]q=/.test(p)) return Promise.resolve({ messages: [F.messages.messages[1]], next_cursor: null, crm: F.messages.crm });
        // A non-inbox folder returns nothing, proving the folder click refetched.
        if (/folder=f-junk/.test(p)) return Promise.resolve({ messages: [], next_cursor: null, crm: {} });
        return Promise.resolve(F.messages);
      }
      if (/\/messages\/m1/.test(p)) {
        var m = JSON.parse(JSON.stringify(F.message));
        if (/images=show/.test(p)) { m.body_html = m.body_html.replace('data-blocked-src', 'src'); m.has_remote_images = false; }
        return Promise.resolve(m);
      }
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) { window.__calls.push(['POST', p, b]); return Promise.resolve({ success: true }); };
    window.apiPatch = function (p, b) { window.__calls.push(['PATCH', p, b]); return Promise.resolve({ success: true }); };
    window.apiDelete = function (p) { window.__calls.push(['DELETE', p]); return Promise.resolve({ ok: true }); };
  }, FIXTURES);

  // open the Inbox on the first message
  await page.evaluate(() => { goPage('mailbox'); });
  await page.waitForFunction(() => STATE.mailbox && STATE.mailbox.messages && STATE.mailbox.messages.length, { timeout: 8000 });
  await page.evaluate(() => window.mbOpen ? window.mbOpen('m1') : window.mbSelect('m1'));
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 8000 });
  const draftKeys = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('pace-mb-draft:') === 0));
  // Type the way a person does: into the visible editor (D-0118 — #mb-comp-body is only the store behind it, and nothing listens to it).
  const typeBody = async (t) => { await page.click('#mb-comp-editor'); await page.keyboard.press('Control+A'); await page.keyboard.insertText(t); };

  // 1. a window, on the dock
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#layer [data-win="mailReply"] #mb-comp-body', { timeout: 5000 });
  const win = await page.evaluate(() => ({ bar: !!document.querySelector('#layer .win-bar'), min: !!document.querySelector('#layer .win-bar [aria-label="Minimise"]'), max: !!document.querySelector('#layer .win-bar [aria-label="Full screen"]'), inPane: !!(document.getElementById('mb-comp') || { innerHTML: '' }).innerHTML.trim() }));
  step('Reply opens a window with minimise and full-screen buttons — and nothing inside the reading pane', win.bar && win.min && win.max && !win.inPane, JSON.stringify(win));

  // 2. clicking another message does not wipe it; sending answers the ORIGINAL
  await typeBody('Friday 3pm is confirmed — profiles this afternoon.');
  await page.evaluate(() => { Dock.minimise(); });
  await page.evaluate(() => { window.mbOpen ? window.mbOpen('m2') : window.mbSelect('m2'); });
  await page.waitForTimeout(300);
  step('selecting a different message does NOT reset the reply in progress', await page.evaluate(() => STATE.mailbox.composer && STATE.mailbox.composer.body.indexOf('Friday 3pm is confirmed') === 0));

  // 3. minimise, go elsewhere in the app, come back
  step('the minimised reply sits in the tray as a chip', await page.evaluate(() => Dock.parkedKinds().indexOf('mailReply') >= 0 && !!document.querySelector('#win-tray .win-chip')));
  await page.evaluate(() => { goPage('dashboard'); });
  await page.waitForTimeout(300);
  step('…and is still in the tray on another page', await page.evaluate(() => STATE.page === 'dashboard' && !!document.querySelector('#win-tray .win-chip')));
  await page.evaluate(() => { document.querySelector('#win-tray .win-chip').click(); });
  await page.waitForSelector('#layer [data-win="mailReply"] #mb-comp-body', { timeout: 5000 });
  step('bringing it back puts the words back exactly as left', await page.evaluate(() => document.getElementById('mb-comp-body').value === 'Friday 3pm is confirmed — profiles this afternoon.'), await page.evaluate(() => document.getElementById('mb-comp-body').value));

  // 4. send answers message m1 (the one it was opened on), though m2 is selected
  await page.evaluate(() => { window.__calls = []; window.mbSendComposer(); });
  await page.waitForTimeout(400);
  const call = await page.evaluate(() => window.__calls.find(c => /\/reply$/.test(c[1] || '')));
  step('sending answers the ORIGINAL message (m1) from its own mailbox, not the one selected now', !!call && /\/mailbox\/mb1\/messages\/m1\/reply$/.test(call[1]) && /Friday 3pm is confirmed/.test(call[2].body), JSON.stringify(call && call[1]));
  step('…and the window closes, the draft is deleted', await page.evaluate(() => !document.querySelector('#layer [data-win="mailReply"]') && !STATE.mailbox.composer) && (await draftKeys()).length === 0);

  // 5. a draft survives closing the window; Discard deletes it
  await page.evaluate(() => { window.mbOpen ? window.mbOpen('m1') : window.mbSelect('m1'); });
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 5000 });
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#mb-comp-body');
  await typeBody('Half-written answer I must not lose');
  await page.waitForTimeout(900);   // the draft is written a moment after typing stops
  step('what is typed is kept as a draft on this device', (await draftKeys()).length === 1);
  await page.evaluate(() => Dock.close());       // the window's × — closes, keeps the draft
  await page.waitForTimeout(200);
  step('closing the window with × keeps the draft', !(await page.evaluate(() => document.querySelector('#layer [data-win="mailReply"]'))) && (await draftKeys()).length === 1);
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#mb-comp-body');
  step('clicking Reply on that message again brings the draft back', await page.evaluate(() => document.getElementById('mb-comp-body').value === 'Half-written answer I must not lose'));
  await page.evaluate(() => window.mbCancelComposer());
  await page.waitForTimeout(200);
  step('Discard closes the window AND deletes the draft', !(await page.evaluate(() => document.querySelector('#layer [data-win="mailReply"]'))) && (await draftKeys()).length === 0);

  // 6. a second reply never replaces words that are already typed
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#mb-comp-body');
  await typeBody('first');
  await page.evaluate(() => window.mbForward());
  await page.waitForTimeout(200);
  step('asking for a Forward while a reply has words keeps the reply (and says so)', await page.evaluate(() => STATE.mailbox.composer.mode === 'reply' && document.getElementById('mb-comp-body').value === 'first'));
  await page.evaluate(() => window.mbCancelComposer());

  step('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
