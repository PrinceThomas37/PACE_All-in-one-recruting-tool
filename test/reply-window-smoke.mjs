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
      if (/\/labels$/.test(p)) return Promise.resolve([{ id: 'Client', name: 'Client' }, { id: 'Hot', name: 'Hot' }]);
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
      if (/\/messages\/m2/.test(p)) {   // a second email to answer (several reply windows at once)
        var m2 = JSON.parse(JSON.stringify(F.message)); m2.id = 'm2'; m2.subject = 'Second thread'; m2.from = { name: 'Ben Ray', email: 'ben.ray@example.test' };
        return Promise.resolve(m2);
      }
      if (/\/messages\/m1/.test(p)) {
        var m = JSON.parse(JSON.stringify(F.message));
        if (/images=show/.test(p)) { m.body_html = m.body_html.replace('data-blocked-src', 'src'); m.has_remote_images = false; }
        return Promise.resolve(m);
      }
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) {
      window.__calls.push(['POST', p, b]);
      if (/\/labels$/.test(p)) return Promise.resolve({ id: 'L-' + b.name, name: b.name });
      return Promise.resolve({ success: true });
    };
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
  step('selecting a different message does NOT reset the reply in progress (the chip holds the draft)', await page.evaluate(() => { const p = Dock.parked('mailReply')[0]; return !!p && !!p.ctx && p.ctx.body.indexOf('Friday 3pm is confirmed') === 0; }));

  // 3. minimise, go elsewhere in the app, come back
  step('the minimised reply sits in the tray as a chip', await page.evaluate(() => Dock.parkedKinds().indexOf('mailReply') >= 0 && !!document.querySelector('#win-tray .win-chip')));
  await page.evaluate(() => { goPage('dashboard'); });
  await page.waitForTimeout(300);
  step('…and is still in the tray on another page', await page.evaluate(() => STATE.page === 'dashboard' && !!document.querySelector('#win-tray .win-chip')));
  await page.evaluate(() => { document.querySelector('#win-tray .win-chip').click(); });
  await page.waitForSelector('#layer [data-win="mailReply"] #mb-comp-body', { timeout: 5000 });
  step('bringing it back puts the words back exactly as left', await page.evaluate(() => document.getElementById('mb-comp-body').value === 'Friday 3pm is confirmed — profiles this afternoon.'), await page.evaluate(() => document.getElementById('mb-comp-body').value));
  step('…and the box a person SEES shows them too (not only the hidden store)', await page.evaluate(() => document.getElementById('mb-comp-editor').textContent === 'Friday 3pm is confirmed — profiles this afternoon.'), await page.evaluate(() => document.getElementById('mb-comp-editor').textContent));

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

  // 6. Several windows at once (R-240, owner 14 Oct: "i cannot open multiple compose or reply window at one time")
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#mb-comp-body');
  await typeBody('first');
  await page.evaluate(() => window.mbReply(false));        // the SAME email again: brings the one started back, never a second blank answer
  await page.waitForTimeout(200);
  step('Reply again on the same email: no second window — the one already started stays (and says so)', await page.evaluate(() => Dock.parked('mailReply').length === 0 && document.getElementById('mb-comp-editor').textContent === 'first'));
  await page.evaluate(() => window.mbForward());           // a Forward is a different piece of writing: its own window, the reply is parked with its words
  await page.waitForTimeout(300);
  step('Forward while a reply has words: opens its OWN window and parks the reply with its words', await page.evaluate(() => STATE.mailbox.composer.mode === 'forward' && Dock.parked('mailReply').length === 1 && Dock.parked('mailReply')[0].ctx.body === 'first'));
  await page.evaluate(() => { window.mbOpen ? window.mbOpen('m2') : window.mbSelect('m2'); });
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm2', { timeout: 5000 });
  await page.evaluate(() => window.mbReply(false));
  await page.waitForTimeout(300);
  await typeBody('answer to the SECOND email');
  step('Reply to a DIFFERENT email: a third window, each on its own email', await page.evaluate(() => STATE.mailbox.composer.msgId === 'm2' && Dock.parked('mailReply').length === 2 && Dock.parked('mailReply').map(p => p.ctx.msgId + ':' + p.ctx.mode).sort().join() === 'm1:forward,m1:reply'));
  // bring the first reply back: its words, in the box a person SEES
  await page.evaluate(() => { const c = [...document.querySelectorAll('#win-tray .win-chip')].find(x => /Reply/.test(x.textContent) && !/Forward/.test(x.textContent)); if (c) c.click(); });
  await page.waitForTimeout(300);
  const back1 = await page.evaluate(() => ({ seen: document.getElementById('mb-comp-editor').textContent, id: STATE.mailbox.composer.msgId, mode: STATE.mailbox.composer.mode, parked: Dock.parked('mailReply').length }));
  step('Bringing a reply back shows ITS words, on ITS email — and the other two stay parked', back1.seen === 'first' && back1.id === 'm1' && back1.mode === 'reply' && back1.parked === 2, JSON.stringify(back1));
  // send answers the email the window belongs to, even from a different selected email
  await page.evaluate(() => { window.__calls = []; window.mbSendComposer(); });
  await page.waitForTimeout(400);
  const call6 = await page.evaluate(() => window.__calls.find(c => /\/reply$/.test(c[1] || '')));
  step('Sending a reply that was parked answers ITS email (m1), not the selected one (m2)', !!call6 && /\/messages\/m1\/reply$/.test(call6[1]) && call6[2].body === 'first', JSON.stringify(call6 && call6[1]));
  step('…and only that window closed — the other two are still parked', await page.evaluate(() => !document.querySelector('#layer [data-win="mailReply"]') && Dock.parked('mailReply').length === 2));
  await page.evaluate(() => { document.querySelectorAll('#win-tray .win-chip .wx').forEach(x => x.click()); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.indexOf('pace-mb-draft:') === 0).forEach(k => localStorage.removeItem(k)); });

  // 7. Labels before sending (R-244, D-0146 — owner 14 Oct: "mark emails or label them before sending … add them to an existing label or a new one")
  await page.evaluate(() => { window.mbOpen ? window.mbOpen('m1') : window.mbSelect('m1'); });
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 5000 });
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#layer [data-win="mailReply"] .mb-win-lbl', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#layer [data-win="mailReply"] .mb-lbl-pick option').length > 2, { timeout: 5000 });
  step('Reply window: has a Label row listing the mailbox\'s existing labels', await page.evaluate(() => [...document.querySelectorAll('#layer .mb-lbl-pick option')].map(o => o.textContent).join('|') === 'Add a label…|Client|Hot'));
  await typeBody('Labelled reply');
  await page.selectOption('#layer .mb-lbl-pick', 'Client');
  await page.waitForTimeout(200);
  step('choosing an existing label adds it as a chip and takes it out of the list', await page.evaluate(() => [...document.querySelectorAll('#layer .mb-win-lbl .mb-lbl')].map(x => x.textContent.replace('×', '')).join() === 'Client' && ![...document.querySelectorAll('#layer .mb-lbl-pick option')].some(o => o.value === 'Client')));
  step('…and the words typed are still there after the label repaint', await page.evaluate(() => document.getElementById('mb-comp-editor').textContent === 'Labelled reply'));
  await page.fill('#mb-lbl-new-reply', 'Follow up Friday');
  await page.evaluate(() => mbWinLabelNew('reply'));
  await page.waitForTimeout(250);
  step('a NEW label is made in the mailbox first, then added as a chip', await page.evaluate(() => window.__calls.some(c => c[0] === 'POST' && /\/labels$/.test(c[1]) && c[2].name === 'Follow up Friday') && [...document.querySelectorAll('#layer .mb-win-lbl .mb-lbl')].length === 2));
  await page.fill('#mb-lbl-new-reply', 'client');   // already exists (any capitals): picks it, never a duplicate
  await page.evaluate(() => mbWinLabelNew('reply'));
  await page.waitForTimeout(200);
  step('typing a name that already exists picks it instead of making a second', await page.evaluate(() => document.querySelectorAll('#layer .mb-win-lbl .mb-lbl').length === 2 && window.__calls.filter(c => /\/labels$/.test(c[1] || '') && c[0] === 'POST').length === 1));
  // minimise, come back: the labels are still chosen
  await page.evaluate(() => Dock.minimise()); await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelector('#win-tray .win-chip').click(); });
  await page.waitForSelector('#layer [data-win="mailReply"] .mb-win-lbl');
  step('minimise and come back: the chosen labels are still there', await page.evaluate(() => document.querySelectorAll('#layer .mb-win-lbl .mb-lbl').length === 2));
  await page.evaluate(() => { document.querySelector('#layer .mb-lbl-x').click(); });
  await page.waitForTimeout(200);
  step('a chosen label can be taken off again', await page.evaluate(() => document.querySelectorAll('#layer .mb-win-lbl .mb-lbl').length === 1));
  await page.evaluate(() => { window.__calls = []; window.mbSendComposer(); });
  await page.waitForTimeout(400);
  const lcall = await page.evaluate(() => window.__calls.find(c => /\/reply$/.test(c[1] || '')));
  step('sending carries the chosen labels (by id) to the server', !!lcall && JSON.stringify(lcall[2].label_ids) === '["L-Follow up Friday"]', JSON.stringify(lcall && lcall[2].label_ids));
  // New message window
  await page.evaluate(() => mbCompose('x@example.test')); await page.waitForSelector('#layer [data-win="mailCompose"] .mb-win-lbl');
  await page.waitForFunction(() => document.querySelectorAll('#layer [data-win="mailCompose"] .mb-lbl-pick option').length > 2, { timeout: 5000 });
  await page.click('#mb-c-editor'); await page.keyboard.insertText('Labelled new message');
  await page.selectOption('#layer [data-win="mailCompose"] .mb-lbl-pick', 'Hot'); await page.waitForTimeout(200);
  step('New message window: has the same Label row and takes an existing label', await page.evaluate(() => [...document.querySelectorAll('#layer [data-win="mailCompose"] .mb-win-lbl .mb-lbl')].map(x => x.textContent.replace('×', '')).join() === 'Hot' && document.getElementById('mb-c-editor').textContent === 'Labelled new message'));
  await page.evaluate(() => { window.__calls = []; window.mbSendCompose(); });
  await page.waitForTimeout(400);
  const ncall = await page.evaluate(() => window.__calls.find(c => /\/send$/.test(c[1] || '')));
  step('New message: sending carries the label to the server', !!ncall && JSON.stringify(ncall[2].label_ids) === '["Hot"]', JSON.stringify(ncall && ncall[2]));

  step('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
