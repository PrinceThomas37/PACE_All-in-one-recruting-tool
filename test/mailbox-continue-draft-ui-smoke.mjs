// CONTINUE A DRAFT SAVED IN GMAIL OR OUTLOOK, INSIDE PACE (R-287, owner 20 Oct: "build it"), on the real page:
//   - an open draft shows "Continue writing" (a received email does not);
//   - a draft that was a REPLY opens as a reply to the email it answers (so it threads), with the draft's words and its
//     recipients, WITHOUT the quoted original (PACE's reply adds that itself);
//   - a draft that was not a reply opens as a new message;
//   - once the email is sent, the old draft is moved to Trash — and not before.
// Usage: node test/mailbox-continue-draft-ui-smoke.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const results = [];
const SHOTS = process.env.SHOTS || '';   // SHOTS=dir saves pictures for the owner
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name) }); } };
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}

const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const me = { name: 'Prince Thomas', email: 'prince@futeglobal.com' }, ray = { name: 'Ray Credeur', email: 'rcredeur33@yahoo.com' };
const QUOTE = '<div class="gmail_quote"><div>On Mon, Ray wrote:</div><blockquote>Can we do Tuesday?</blockquote></div>';
const MSGS = {
  r2: { id: 'r2', thread_id: 'T1', subject: 'Interview', from: ray, to: [me], cc: [], date: iso(30), preview: 'Can we do Tuesday?', unread: false, body_html: '<p>Can we do Tuesday?</p>' },
  d1: { id: 'd1', thread_id: 'T1', subject: 'Re: Interview', from: me, to: [ray], cc: [{ name: 'Lisa', email: 'lisa@client.com' }], date: iso(5), preview: 'Thanks Ray', unread: false, is_draft: true,
        body_html: '<p>Thanks Ray, Tuesday works.</p>' + QUOTE },
  d2: { id: 'd2', thread_id: 'T9', subject: 'Intro call', from: me, to: [{ name: 'Sam', email: 'sam@x.com' }], cc: [], date: iso(9), preview: 'Hi Sam', unread: false, is_draft: true, body_html: '<p>Hi Sam, are you free Friday?</p>' },
};
const THREADS = { T1: [MSGS.r2, MSGS.d1], T9: [MSGS.d2] };
const ROWS = ['r2', 'd1', 'd2'].map(id => Object.assign({}, MSGS[id], { latest_id: id, latest_mine: !!MSGS[id].is_draft, party: id === 'r2' ? ray : MSGS[id].to[0], count: 1, participants: [], more_participants: 0, has_draft: !!MSGS[id].is_draft, message_ids: [id], in_folder: [id], unread_ids: [], folder_id: 'f-inbox' }));

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(([msgs, threads, rows]) => {
    window.__calls = [];
    window.apiGet = function (p) {
      window.__calls.push(['GET', p]);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id: 'mb1', email_address: 'prince@futeglobal.com', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/recipients$/.test(p)) return Promise.resolve({ recipients: [] });
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'f-inbox', name: 'Inbox', kind: 'inbox' }, { id: 'f-drafts', name: 'Drafts', kind: 'drafts' }]);
      if (/^\/mailbox\/mb1\/conversations\?/.test(p)) return Promise.resolve({ conversations: rows, next_cursor: null, crm: {} });
      if (/^\/mailbox\/mb1\/messages\?/.test(p)) return Promise.resolve({ messages: rows, next_cursor: null, crm: {} });
      let m = p.match(/\/threads\/([^/?]+)$/); if (m) return Promise.resolve(threads[m[1]] || []);
      m = p.match(/^\/mailbox\/mb1\/messages\/([^/?]+)/); if (m) return Promise.resolve(Object.assign({ attachments: [], has_remote_images: false, crm: {} }, msgs[m[1]]));
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) { window.__calls.push(['POST', p, b]); return Promise.resolve({ success: true, ok: true }); };
    window.apiPatch = function (p, b) { window.__calls.push(['PATCH', p, b]); return Promise.resolve({ success: true }); };
    window.apiDelete = function (p) { window.__calls.push(['DELETE', p]); return Promise.resolve({ success: true }); };
    window.apiFetch = function (m, p, b) { window.__calls.push([m, p, b]); return Promise.resolve({}); };
    STATE.reminders = [];
  }, [MSGS, THREADS, ROWS]);
  const calls = (re, method) => page.evaluate(([src, m]) => window.__calls.filter(c => (!m || c[0] === m) && new RegExp(src).test(c[1])), [re.source, method || '']);

  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 3, { timeout: 8000 });

  // a received email: no Continue writing
  await page.evaluate(() => window.mbOpen('r2'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'r2', { timeout: 8000 });
  await page.waitForTimeout(150);
  step('a received email has no "Continue writing"', await page.evaluate(() => !/Continue writing/.test(document.getElementById('mb-head').innerText)));

  // a reply draft
  await page.evaluate(() => window.mbOpen('d1'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'd1', { timeout: 8000 });
  await page.waitForTimeout(150);
  step('an open draft shows "Continue writing"', await page.evaluate(() => /Continue writing/.test(document.getElementById('mb-head').innerText)));
  await page.evaluate(() => window.mbContinueDraft('d1'));
  await page.waitForFunction(() => STATE.mailbox.composer && STATE.mailbox.composer.msgId === 'r2', { timeout: 8000 });
  const c = await page.evaluate(() => { const k = STATE.mailbox.composer; return { mode: k.mode, to: k.to, cc: k.cc, subject: k.subject, body: k.body, draft: k.providerDraftId }; });
  step('a reply draft opens as a REPLY to the email it answers (so it threads)', c.mode === 'reply', JSON.stringify(c));
  step('…with the draft\'s recipients and subject', c.to === 'rcredeur33@yahoo.com' && c.cc === 'lisa@client.com' && c.subject === 'Re: Interview', JSON.stringify(c));
  step('…with the draft\'s own words, not the quoted original', /Tuesday works/.test(c.body) && !/gmail_quote|wrote:|blockquote/.test(c.body), c.body);
  step('…and it knows which draft it came from', c.draft === 'd1');
  step('nothing is deleted just by opening it', (await calls(/\/messages\/d1$/, 'DELETE')).length === 0);
  await page.evaluate(() => window.mbSendComposer());
  await page.waitForFunction(() => window.__calls.some(x => x[0] === 'DELETE'), { timeout: 8000 });
  const sent = await calls(/\/messages\/r2\/reply$/, 'POST');
  step('Send goes through the normal reply (PACE\'s checks), to the right email', sent.length === 1 && /Tuesday works/.test(sent[0][2].body) && sent[0][2].to === 'rcredeur33@yahoo.com', JSON.stringify(sent));
  step('…and only after it went, the old draft is moved to Trash', (await calls(/\/mailbox\/mb1\/messages\/d1$/, 'DELETE')).length === 1);

  // a stand-alone draft
  await page.evaluate(() => { STATE.mailbox.composer = null; window.mbOpen('d2'); });
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'd2', { timeout: 8000 });
  await page.evaluate(() => window.mbContinueDraft('d2'));
  await page.waitForFunction(() => STATE.mailbox.compose && STATE.mailbox.compose.providerDraftId === 'd2', { timeout: 8000 });
  const n = await page.evaluate(() => { const k = STATE.mailbox.compose; return { to: k.to, subject: k.subject, body: k.body }; });
  step('a draft that was not a reply opens as a NEW message with its recipient, subject and words', n.to === 'sam@x.com' && n.subject === 'Intro call' && /free Friday/.test(n.body), JSON.stringify(n));
  await page.evaluate(() => window.mbSendCompose());
  await page.waitForFunction(() => window.__calls.some(x => x[0] === 'DELETE' && /d2$/.test(x[1])), { timeout: 8000 });
  step('sending it goes out as a new message and then retires the draft', (await calls(/\/mailbox\/mb1\/send$/, 'POST')).length === 1);

  // ── a click on the dimmed area must not make the window vanish (owner 20 Oct) ──
  await page.evaluate(() => { STATE.mailbox.compose = null; window.mbCompose('x@y.com'); });
  await page.waitForFunction(() => !!document.querySelector('#layer [data-win="mailCompose"]'), { timeout: 8000 });
  await page.evaluate(() => { const ed = document.getElementById('mb-c-editor'); ed.innerHTML = 'half written note'; window.mbEditorInput('compose'); });
  await page.evaluate(() => document.querySelector('#layer .overlay').click());
  await page.waitForTimeout(200);
  step('clicking outside a message window MINIMISES it to the tray (it does not vanish)', await page.evaluate(() => Dock.count() === 1 && !document.querySelector('#layer [data-win="mailCompose"]') && !!document.querySelector('#win-tray .win-chip')));
  await page.evaluate(() => document.querySelector('#win-tray .win-chip').click());
  await page.waitForFunction(() => !!document.querySelector('#layer [data-win="mailCompose"]'), { timeout: 8000 });
  step('…and coming back from the tray brings back what was written', await page.evaluate(() => /half written note/.test(document.getElementById('mb-c-editor').innerText)));
  await page.evaluate(() => Dock.close());
  // an ordinary window still closes on an outside click
  await page.evaluate(() => window.openAddLead());
  await page.evaluate(() => document.querySelector('#layer .overlay').click());
  await page.waitForTimeout(150);
  step('an ordinary window (Add lead) still just closes on an outside click', await page.evaluate(() => !STATE.modal && Dock.count() === 0));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the page part ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
