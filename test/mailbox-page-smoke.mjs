// The Inbox page (public/js/47-page-mailbox.js), driven in a real browser with
// the API stubbed at window.apiGet/apiPost/apiPatch/apiDelete.
//
// The assertions that carry weight here are the safety ones, because they are
// the ones a redesign would quietly undo:
//   * the message body renders inside a SANDBOXED iframe, never in the page —
//     an email body is written by whoever felt like emailing you;
//   * remote images stay blocked until the reader asks, because loading one
//     tells a stranger their mail was opened;
//   * "Delete" says out loud that the mail moved to Trash and is recoverable.
//
// The rest is ordinary UI: folders, list, reading pane, reply, compose, search,
// and the CRM chip that is the whole reason to read mail inside an ATS.
//
// Usage: node test/mailbox-page-smoke.mjs

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

  // ── nav ────────────────────────────────────────────────────────────────────
  const nav = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sb-nav .nav-item')).map(e => e.textContent.trim()));
  step('Inbox is in the sidebar for a recruiter', nav.some(n => n.indexOf('Inbox') === 0), nav.join(' | '));

  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  let html = await page.evaluate(() => document.getElementById('content').innerHTML);

  // ── folders ────────────────────────────────────────────────────────────────
  step('All six standard folders are listed',
    ['Inbox', 'Drafts', 'Sent Items', 'Archive', 'Junk Email', 'Deleted Items'].every(f => html.includes(f)));
  step('A user\'s own folder is listed too', html.includes('Client escalations'));
  step('Unread counts show on folders', /">3<\/span>/.test(html), 'inbox badge');
  step('It opens on Inbox, not on whatever came first',
    await page.evaluate(() => STATE.mailbox.folderId) === 'f-inbox');

  // ── list ───────────────────────────────────────────────────────────────────
  step('Messages are listed', html.includes('interview Friday?') && html.includes('Updated CV'));
  step('The sender is shown', html.includes('Ada Okafor') && html.includes('Rahul Menon'));
  step('Previews are shown', html.includes('Friday 3pm works for us'));
  step('An unread message is bold, a read one is not',
    (html.match(/font-weight:700/g) || []).length >= 2 && html.includes('font-weight:500'));
  step('An attachment is flagged in the list', html.includes('📎'));
  step('Both mailboxes are offered in the account picker',
    html.includes('priya@futeglobal.com') && html.includes('priya.recruiting@gmail.com'));

  // ── the CRM cross-link: the reason to read mail here at all ────────────────
  step('A sender who is a lead contact is chipped as "Lead"', html.includes('>Lead<'));
  step('A sender who is a candidate is chipped as "Candidate"', html.includes('>Candidate<'));
  step('An unknown sender gets no chip', !/billing@somevendor\.io[\s\S]{0,200}>(Lead|Candidate)</.test(html));

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'inbox-list.png'), fullPage: false });

  // ── reading pane ───────────────────────────────────────────────────────────
  await page.evaluate(() => window.mbOpen('m1'));
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 8000 });
  await page.waitForTimeout(200);
  html = await page.evaluate(() => document.getElementById('content').innerHTML);

  step('The reading pane shows the subject and full addresses',
    html.includes('interview Friday?') && html.includes('ada.okafor@fidelity.com'));
  step('Cc is shown when there is one', html.includes('hiring@fidelity.com'));
  step('Reply / Reply all / Archive / Delete are all offered',
    html.includes('>Reply<') && html.includes('>Reply all<') && html.includes('>Archive<') && html.includes('>Delete<'));

  // THE SAFETY ASSERTION. A message body is the most hostile HTML this app
  // handles; it must render in a sandbox with no script and no same-origin.
  const frame = await page.evaluate(() => {
    const f = document.querySelector('iframe[title="Message body"]');
    return f ? { sandbox: f.getAttribute('sandbox'), hasSrcdoc: !!f.getAttribute('srcdoc'),
                 body: (f.getAttribute('srcdoc') || '') } : null;
  });
  step('The message body renders inside an iframe', !!frame && frame.hasSrcdoc);
  step('...that cannot run scripts', !!frame && !/allow-scripts/.test(frame.sandbox), frame && frame.sandbox);
  step('...and cannot reach this origin', !!frame && !/allow-same-origin/.test(frame.sandbox), frame && frame.sandbox);
  step('...but can still open links', !!frame && /allow-popups/.test(frame.sandbox), frame && frame.sandbox);
  step('The body content actually made it into the frame', !!frame && /Friday 3pm works for us/.test(frame.body));
  step('The message body is NOT written into the page itself',
    !html.includes('is the second candidate open to a hybrid') || /srcdoc=/.test(html));

  // Remote images blocked until asked for.
  step('Blocked images are announced, not silently dropped',
    html.includes('Images in this message are blocked') && html.includes('Show images'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'inbox-reading.png'), fullPage: false });
  await page.evaluate(() => window.mbShowImages());
  await page.waitForFunction(() => STATE.mailbox.showImages && !STATE.mailbox.msgLoading, { timeout: 5000 });
  const shown = await page.evaluate(() => ({
    called: window.__calls.some(c => /images=show/.test(c[1] || '')),
    html: document.getElementById('content').innerHTML,
  }));
  step('Asking for images refetches the message with images=show', shown.called);
  step('...and the banner goes away', !shown.html.includes('Images in this message are blocked'));

  // Opening a message marks it read — the way every mail client behaves.
  const readCall = await page.evaluate(() =>
    window.__calls.find(c => c[0] === 'PATCH' && /\/messages\/m1$/.test(c[1])));
  step('Opening a message marks it read on the server', !!readCall && readCall[2].read === true);

  // ── reply composer ─────────────────────────────────────────────────────────
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  step('Reply opens an inline composer, not a modal',
    await page.evaluate(() => !!document.getElementById('mb-comp-body') && !document.querySelector('.overlay')));
  step('It says the original will be quoted',
    (await page.evaluate(() => document.getElementById('content').innerHTML)).includes('quoted underneath'));

  // The reported gap: no visible, editable subject on a reply.
  const replyFields = await page.evaluate(() => ({
    to: (document.getElementById('mb-comp-to') || {}).value,
    subject: (document.getElementById('mb-comp-subject') || {}).value,
    hasSubject: !!document.getElementById('mb-comp-subject'),
  }));
  step('Reply shows an editable Subject, prefilled with Re:',
    replyFields.hasSubject && /^Re: /.test(replyFields.subject), JSON.stringify(replyFields));
  step('Reply prefills To with the sender', replyFields.to === 'ada.okafor@fidelity.com', replyFields.to);

  // The reported gap: signature was forced on. It is now off by default.
  const sigDefault = await page.evaluate(() => STATE.mailbox.composer.sig);
  step('Signature is OFF by default on a reply', sigDefault === false, String(sigDefault));
  step('A signature picker is offered',
    (await page.evaluate(() => document.getElementById('content').innerHTML)).includes('No signature'));

  if (SHOTS) {
    await page.evaluate(() => {
      document.getElementById('mb-comp-body').value = 'Friday 3pm is confirmed — sending both profiles this afternoon.';
      window.mbCompField('body', document.getElementById('mb-comp-body').value);
    });
    await page.screenshot({ path: path.join(SHOTS, 'inbox-reply.png'), fullPage: false });
  }

  // Turning the signature on fetches the FILLED signature to preview — the bug
  // being guarded is a template going out with {{sender}} still in it.
  await page.evaluate(() => window.mbCompSetSig(true));
  await page.waitForFunction(() => STATE.mailbox.sigHtml !== null, { timeout: 5000 });
  const sigPreview = await page.evaluate(() => ({
    fetched: window.__calls.some(c => /\/signature$/.test(c[1] || '')),
    html: document.getElementById('content').innerHTML,
  }));
  step('Choosing "My signature" fetches it from the server', sigPreview.fetched);
  step('The preview shows the FILLED signature, not the raw template',
    sigPreview.html.includes('Priya Sharma') && !sigPreview.html.includes('{{sender}}'));
  await page.evaluate(() => window.mbCompSetSig(false));

  await page.evaluate(() => {
    document.getElementById('mb-comp-body').value = 'Friday 3pm is confirmed.';
    document.getElementById('mb-comp-subject').value = 'Re: Friday 3pm — confirmed';
  });
  await page.evaluate(() => window.mbSendComposer());
  await page.waitForTimeout(300);
  const replyCall = await page.evaluate(() => window.__calls.find(c => /\/reply$/.test(c[1] || '')));
  step('Reply posts the typed body', !!replyCall && replyCall[2].body === 'Friday 3pm is confirmed.');
  step('Reply posts the EDITED subject',
    !!replyCall && replyCall[2].subject === 'Re: Friday 3pm — confirmed', JSON.stringify(replyCall && replyCall[2].subject));
  step('Reply says the signature is off', !!replyCall && replyCall[2].include_signature === false);
  step('reply_all is false for a plain reply', !!replyCall && replyCall[2].reply_all === false);

  // An empty reply must not reach the network — a wasted send against a real
  // mailbox's daily limit.
  await page.evaluate(() => { window.__calls = []; window.mbReply(false); });
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  await page.evaluate(() => { document.getElementById('mb-comp-body').value = '   '; window.mbSendComposer(); });
  await page.waitForTimeout(200);
  step('An empty reply is refused before it hits the network',
    await page.evaluate(() => !window.__calls.some(c => /\/reply$/.test(c[1] || ''))));

  // ── reply all ──────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; window.mbReply(true); });
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  const ra = await page.evaluate(() => ({
    to: document.getElementById('mb-comp-to').value,
    cc: (document.getElementById('mb-comp-cc') || {}).value || '',
  }));
  step('Reply all prefills Cc with the other participants', /hiring@fidelity\.com/.test(ra.cc), ra.cc);
  step('Reply all never cc:s the replying mailbox itself', !/priya@futeglobal\.com/.test(ra.cc), ra.cc);
  step('Reply all never duplicates the sender in Cc', !/ada\.okafor/.test(ra.cc), ra.cc);

  // ── forward ────────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; window.mbForward(); });
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  const fw = await page.evaluate(() => ({
    to: document.getElementById('mb-comp-to').value,
    subject: document.getElementById('mb-comp-subject').value,
    html: document.getElementById('content').innerHTML,
  }));
  step('Forward starts with an empty To', fw.to === '', fw.to);
  step('Forward prefills the subject with Fwd:', /^Fwd: /.test(fw.subject), fw.subject);
  step('Forward says the original attachments come along',
    fw.html.includes('carried over'), 'the user needs to know this');

  // A forward with nobody to forward to must not reach the network.
  await page.evaluate(() => window.mbSendComposer());
  await page.waitForTimeout(200);
  step('A forward with no recipient is refused before the network',
    await page.evaluate(() => !window.__calls.some(c => /\/forward$/.test(c[1] || ''))));

  await page.evaluate(() => {
    document.getElementById('mb-comp-to').value = 'colleague@futeglobal.com';
    document.getElementById('mb-comp-body').value = 'FYI — worth a look.';
    window.mbSendComposer();
  });
  await page.waitForTimeout(300);
  const fwCall = await page.evaluate(() => window.__calls.find(c => /\/forward$/.test(c[1] || '')));
  step('Forward posts to the forward endpoint with recipient and note',
    !!fwCall && fwCall[2].to === 'colleague@futeglobal.com' && fwCall[2].body === 'FYI — worth a look.',
    JSON.stringify(fwCall && fwCall[2]));
  step('Forward carries the Fwd: subject', !!fwCall && /^Fwd: /.test(fwCall[2].subject));

  // ── attachments ────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; window.mbReply(false); });
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  step('An "Attach files" button is offered on a reply',
    (await page.evaluate(() => document.getElementById('content').innerHTML)).includes('Attach files'));
  step('There is a real file input behind it',
    await page.evaluate(() => !!document.getElementById('mb-comp-files')));

  // Drive the file input for real rather than faking STATE.
  await page.setInputFiles('#mb-comp-files', {
    name: 'rahul-menon-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake resume'),
  });
  await page.waitForFunction(() => (STATE.mailbox.composer.files || []).length === 1, { timeout: 5000 });
  step('A chosen file appears as a chip',
    (await page.evaluate(() => document.getElementById('content').innerHTML)).includes('rahul-menon-cv.pdf'));

  await page.evaluate(() => {
    document.getElementById('mb-comp-body').value = 'CV attached.';
    window.mbSendComposer();
  });
  await page.waitForTimeout(300);
  const attCall = await page.evaluate(() => window.__calls.find(c => /\/reply$/.test(c[1] || '')));
  step('The attachment is sent, base64-encoded, with its name and type',
    !!attCall && attCall[2].attachments.length === 1
      && attCall[2].attachments[0].filename === 'rahul-menon-cv.pdf'
      && attCall[2].attachments[0].content_type === 'application/pdf'
      && Buffer.from(attCall[2].attachments[0].base64, 'base64').toString().includes('fake resume'),
    JSON.stringify(attCall && attCall[2].attachments && attCall[2].attachments[0] &&
      { f: attCall[2].attachments[0].filename, t: attCall[2].attachments[0].content_type }));

  // Removing it takes it back off.
  await page.evaluate(() => { window.__calls = []; window.mbReply(false); });
  await page.waitForSelector('#mb-comp-body', { timeout: 5000 });
  await page.setInputFiles('#mb-comp-files', {
    name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
  });
  await page.waitForFunction(() => (STATE.mailbox.composer.files || []).length === 1, { timeout: 5000 });
  await page.evaluate(() => window.mbRemoveFile(0));
  step('A file can be removed again',
    await page.evaluate(() => (STATE.mailbox.composer.files || []).length === 0));
  await page.evaluate(() => window.mbCancelComposer());

  // ── delete says what it actually did ───────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; window.mbTrash('m3'); });
  await page.waitForTimeout(300);
  const trashed = await page.evaluate(() => ({
    call: window.__calls.find(c => c[0] === 'DELETE'),
    toast: (STATE.toasts || []).map(t => t.msg).join(' | '),
    stillListed: (STATE.mailbox.messages || []).some(m => m.id === 'm3'),
  }));
  step('Delete calls the trash endpoint', !!trashed.call && /\/messages\/m3$/.test(trashed.call[1]));
  // This matters: the user just changed their REAL mailbox and needs to know
  // the mail is recoverable and where from.
  step('Delete says the mail moved to Trash and is recoverable',
    /Trash/.test(trashed.toast) && /recoverable/.test(trashed.toast), trashed.toast);
  step('The deleted row leaves the list immediately', !trashed.stillListed);

  // ── archive ────────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; window.mbArchive('m2'); });
  await page.waitForTimeout(300);
  step('Archive posts to the archive endpoint',
    await page.evaluate(() => window.__calls.some(c => /\/archive$/.test(c[1] || ''))));

  // ── search + folders ───────────────────────────────────────────────────────
  await page.evaluate(() => window.mbSearch('notice period'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 1, { timeout: 5000 });
  html = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Search narrows the list', html.includes('Updated CV') && !html.includes('interview Friday?'));
  step('A "Clear" affordance appears with an active search', html.includes('>Clear<'));

  await page.evaluate(() => { window.mbClearSearch(); });
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 3, { timeout: 5000 });
  step('Clearing search restores the folder', true);

  await page.evaluate(() => window.mbSelectFolder('f-junk'));
  await page.waitForFunction(() => STATE.mailbox.folderId === 'f-junk' && !STATE.mailbox.listLoading, { timeout: 5000 });
  html = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Switching folder refetches that folder', html.includes('Nothing here'));

  // ── compose ────────────────────────────────────────────────────────────────
  await page.evaluate(() => window.mbSelectFolder('f-inbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 3, { timeout: 5000 });
  await page.evaluate(() => window.mbCompose());
  await page.waitForSelector('#mb-c-to', { timeout: 5000 });
  step('Compose opens with To / Cc / Subject / Message',
    await page.evaluate(() => !!(document.getElementById('mb-c-to') && document.getElementById('mb-c-cc')
      && document.getElementById('mb-c-subject') && document.getElementById('mb-c-body'))));
  step('Compose names the mailbox it will send from',
    (await page.evaluate(() => document.querySelector('.modal').innerHTML)).includes('priya@futeglobal.com'));

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'inbox-compose.png'), fullPage: false });

  step('Compose offers attachments and a signature picker',
    (await page.evaluate(() => document.querySelector('.modal').innerHTML)).includes('Attach files')
    && (await page.evaluate(() => document.querySelector('.modal').innerHTML)).includes('No signature'));

  await page.evaluate(() => {
    window.__calls = [];
    document.getElementById('mb-c-to').value = 'ada.okafor@fidelity.com';
    document.getElementById('mb-c-subject').value = 'Two profiles for Friday';
    document.getElementById('mb-c-body').value = 'Attaching both now.';
    window.mbSendCompose();
  });
  await page.waitForTimeout(300);
  const sent = await page.evaluate(() => window.__calls.find(c => /\/send$/.test(c[1] || '')));
  step('Compose posts to the send endpoint with what was typed',
    !!sent && sent[2].to === 'ada.okafor@fidelity.com' && sent[2].body === 'Attaching both now.');
  step('Compose defaults to no signature too', !!sent && sent[2].include_signature === false);

  // ── the no-mailbox state is a setup screen, not an error ───────────────────
  await page.evaluate(() => {
    window.apiGet = function (p) {
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([
        { id: 'mb9', email_address: 'stale@futeglobal.com', platform: 'Microsoft', is_active: true,
          readable: false, connection: { connected: true, status: 'expired' } },
      ]);
      return Promise.resolve({});
    };
    closeModal();
    STATE.mailbox.accounts = null; STATE.mailbox.activeId = null;
    window.goPage('mailbox');
  });
  await page.waitForFunction(() => STATE.mailbox.accounts !== null, { timeout: 5000 });
  await page.waitForTimeout(150);
  html = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('With nothing connected it explains rather than erroring',
    html.includes('No mailbox connected yet') && html.includes('Set up a mailbox'));
  step('...and names the mailbox that needs reconnecting',
    html.includes('stale@futeglobal.com') && html.includes('sign-in expired'));

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  step('Suite ran to completion', false, String(err && err.stack || err));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
