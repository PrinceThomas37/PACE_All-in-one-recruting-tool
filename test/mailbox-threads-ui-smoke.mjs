// THE INBOX, BATCH 4 (owner, 19 Oct), on the real page:
//   R-271 conversations by default ("me, Ray 3", our reply leads the row, "You:"), opening one reads all of it, Archive acts on
//         the conversation, and a switch to single emails that is saved as the person's preference;
//   R-272 All inboxes: one list over every email ID, each row labelled with its address; an email ID that could not be read
//         is named; opening a row reads it from ITS mailbox;
//   R-273 the full formatting bar (a font and a colour reach what is sent), Reply all on every message and on the older ones in
//         the conversation, Schedule send (a date and time in the person's zone; the window closes), and the Scheduled tab
//         (emails waiting, with Cancel; the person's reminders) and the Draft tab (a reply being written on this device).
// Usage: node test/mailbox-threads-ui-smoke.mjs
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
const CONV = [
  { id: 'r3', thread_id: 'T1', folder_id: 'f-inbox', subject: 'Interview scheduled', from: me, to: [ray], cc: [], date: iso(5), preview: 'Hi Ray, there is a mistake in the client name', unread: false, platform: 'Gmail', label_ids: [],
    latest_id: 'r3', latest_mine: true, party: ray, count: 3, participants: ['me', 'Ray'], more_participants: 0, has_draft: false,
    message_ids: ['r1', 'r2', 'r3'], in_folder: ['r2'], unread_ids: ['r2'] },
  { id: 'z1', thread_id: 'T2', folder_id: 'f-inbox', subject: 'Dialpad voicemail', from: { name: 'Dialpad', email: 'no@dialpad.com' }, to: [me], cc: [], date: iso(30), preview: 'New voicemail', unread: false, platform: 'Gmail', label_ids: [],
    latest_id: 'z1', latest_mine: false, party: { name: 'Dialpad', email: 'no@dialpad.com' }, count: 1, participants: ['Dialpad'], more_participants: 0, has_draft: false,
    message_ids: ['z1'], in_folder: ['z1'], unread_ids: [] },
];
const THREAD = [
  { id: 'r1', thread_id: 'T1', subject: 'Interview scheduled', from: me, to: [ray], date: iso(60), preview: 'Your interview has been scheduled', unread: false },
  { id: 'r2', thread_id: 'T1', subject: 'Re: Interview scheduled', from: ray, to: [me], date: iso(30), preview: 'Not what we discussed', unread: true },
  { id: 'r3', thread_id: 'T1', subject: 'Re: Interview scheduled', from: me, to: [ray], date: iso(5), preview: 'Hi Ray, there is a mistake', unread: false },
];
const ALL = [
  Object.assign({}, CONV[1], { mailbox_id: 'mb1', mailbox_email: 'prince@futeglobal.com', list_folder_id: 'f-inbox' }),
  { id: 'o1', thread_id: 'OC', folder_id: 'O-IN', subject: 'Timesheet', from: { name: 'Lisa', email: 'lisa@client.com' }, to: [], cc: [], date: iso(2), preview: 'Please approve', unread: true, platform: 'Microsoft', label_ids: [],
    latest_id: 'o1', latest_mine: false, party: { name: 'Lisa', email: 'lisa@client.com' }, count: 1, participants: ['Lisa'], more_participants: 0, has_draft: false,
    message_ids: ['o1'], in_folder: ['o1'], unread_ids: ['o1'], mailbox_id: 'mb2', mailbox_email: 'prince@vhcstaffing.com', list_folder_id: 'O-IN' },
];

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', d => d.accept('https://cdn.example.com/logo.png'));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(([conv, thread, all]) => {
    window.__calls = [];
    const msg = (id) => Object.assign({}, thread.find(t => t.id === id) || all.find(a => a.id === id) || conv[1], { body_html: '<p>body ' + id + '</p>', attachments: [], has_remote_images: false, to: [{ email: 'prince@futeglobal.com' }], cc: [{ email: 'ash@futeglobal.com' }] });
    window.apiGet = function (p) {
      window.__calls.push(['GET', p]);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([
        { id: 'mb1', email_address: 'prince@futeglobal.com', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true } },
        { id: 'mb2', email_address: 'prince@vhcstaffing.com', platform: 'Microsoft', is_active: true, readable: true, connection: { connected: true } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 1, mailboxes: 2 });
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/recipients$/.test(p)) return Promise.resolve({ recipients: [] });
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'f-inbox', name: 'Inbox', kind: 'inbox' }, { id: 'f-sent', name: 'Sent', kind: 'sent' }, { id: 'f-drafts', name: 'Drafts', kind: 'drafts' }]);
      if (/^\/mailbox\/mb1\/conversations\?/.test(p)) return Promise.resolve({ conversations: conv, next_cursor: null, crm: {} });
      if (/^\/mailbox\/mb1\/messages\?/.test(p)) return Promise.resolve({ messages: thread.slice().reverse(), next_cursor: null, crm: {} });
      if (/^\/mailbox-all\/inbox/.test(p)) return Promise.resolve({ conversations: all, next_cursor: null, crm: {}, skipped: [{ id: 'mb3', email: 'old@zoho.test', reason: 'This mailbox is not connected' }] });
      if (/\/threads\/T1$/.test(p)) return Promise.resolve(thread);
      if (/\/threads\//.test(p)) return Promise.resolve([]);
      const m = p.match(/^\/mailbox\/(mb\d)\/messages\/([^/?]+)/);
      if (m) return Promise.resolve(msg(m[2]));
      if (/^\/mailbox-scheduled/.test(p)) return Promise.resolve({ ready: true, items: [
        { id: 's1', mailbox_id: 'mb1', mailbox_email: 'prince@futeglobal.com', kind: 'new', to: 'ray@y.com', subject: 'Following up', preview: 'Hi Ray', attachments: ['cv.pdf'], send_at: new Date(Date.now() + 864e5).toISOString(), timezone: 'America/Chicago', status: 'scheduled' },
        { id: 's2', mailbox_id: 'mb1', mailbox_email: 'prince@futeglobal.com', kind: 'reply', to: '', subject: 'Re: x', preview: 'ok', attachments: [], send_at: new Date(Date.now() - 600000).toISOString(), timezone: 'America/Chicago', status: 'failed', error: 'The email ID\'s sign-in had expired — reconnect it, then send this again.' }] });
      if (/^\/reminders/.test(p)) return Promise.resolve([{ id: 'rem1', user_id: STATE.user.id, status: 'pending', return_date: '2026-10-22', note: 'Call Ray about the start date', contact_name: 'Ray Credeur', source: { label: 'Your note' } }]);
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) { window.__calls.push(['POST', p, b]); return Promise.resolve({ success: true, ok: (b && b.ids || []).length, failed: 0, results: (b && b.ids || []).map(id => ({ id, ok: true })) }); };
    window.apiPatch = function (p, b) { window.__calls.push(['PATCH', p, b]); return Promise.resolve({ success: true }); };
    window.apiDelete = function (p) { window.__calls.push(['DELETE', p]); return Promise.resolve({ success: true }); };
    window.apiFetch = function (m, p, b) { window.__calls.push([m, p, b]); return Promise.resolve({}); };
    STATE.reminders = [];
  }, [CONV, THREAD, ALL]);
  const calls = (re, method) => page.evaluate(([src, m]) => window.__calls.filter(c => (!m || c[0] === m) && new RegExp(src).test(c[1])), [re.source, method || '']);

  // ── R-271 conversations ──
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 2, { timeout: 8000 });
  step('the inbox lists CONVERSATIONS by default', (await calls(/^\/mailbox\/mb1\/conversations\?/)).length >= 1 && (await calls(/^\/mailbox\/mb1\/messages\?/)).length === 0);
  const row = await page.evaluate(() => document.querySelector('#mb-list .mb-row').innerText.replace(/\s+/g, ' '));
  step('a row says who wrote in it and how many messages: "me, Ray 3"', /me, Ray\s*3/.test(row), row);
  step('…our own reply leads the row, marked "You:"', /You: Hi Ray, there is a mistake/.test(row), row);
  step('…named by how the conversation began', /Interview scheduled/.test(row) && !/Re: Interview/.test(row));
  step('the tabs are All · Unread · Scheduled · Draft', await page.evaluate(() => ['All', 'Unread', 'Scheduled', 'Draft'].every(t => [...document.querySelectorAll('#mb-tabs .pgtab')].some(x => x.textContent.indexOf(t) === 0))));

  await page.evaluate(() => window.mbOpen('r3'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'r3' && (STATE.mailbox.thread || []).length === 3, { timeout: 8000 });
  await page.waitForTimeout(150);
  step('opening it opens the newest message, with the whole conversation (theirs and ours)', await page.evaluate(() => document.querySelectorAll('#mb-before .mb-msg').length === 2));
  step('…and reads it: the unread message further up is marked read too', (await calls(/\/mailbox\/mb1\/messages\/r2$/, 'PATCH')).length === 1);
  step('Reply all is on the open message even with one other person on it', await page.evaluate(() => /Reply all/.test(document.getElementById('mb-head').innerText) && !!document.querySelector('#mb-open .mb-replyall') && /Reply all/.test(document.querySelector('#mb-open .mb-msg-foot').innerText)));
  step('…and on each older message of the conversation', await page.evaluate(() => document.querySelectorAll('#mb-before .mb-replyall').length === 2));
  await shot(page, 'b4-conversations.png');

  // reply-all on an older message opens THAT message's window
  await page.evaluate(() => document.querySelectorAll('#mb-before .mb-replyall')[1].click());
  await page.waitForFunction(() => STATE.mailbox.composer && STATE.mailbox.composer.msgId === 'r2', { timeout: 8000 });
  step('Reply all on an older message answers THAT message (reply-all window, quoting it)', await page.evaluate(() => STATE.mailbox.composer.mode === 'replyAll' && /Reply all/.test(document.querySelector('#layer [data-win="mailReply"] .mhd').innerText)));

  // ── R-273 formatting bar ──
  const bar = await page.evaluate(() => [...document.querySelectorAll('#layer .mb-fmt [title]')].map(e => e.getAttribute('title')));
  step('the bar has font, size, colour, highlight, alignment, indent, link, unlink, image', ['Font', 'Text size', 'Text colour', 'Highlight', 'Align left', 'Centre', 'Align right', 'Less indent', 'More indent', 'Link', 'Remove link', 'Image (by its web address)'].every(t => bar.includes(t)), bar.join('|'));
  await page.evaluate(() => {
    const ed = document.getElementById('mb-comp-editor'); ed.focus(); ed.innerHTML = 'Hello team'; window.mbEditorInput('reply');
    const r = document.createRange(); r.setStart(ed.firstChild, 0); r.setEnd(ed.firstChild, 5);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.mbFmtKeep('reply');
    window.mbFmtVal('reply', 'fontName', 'Georgia');
  });
  await page.evaluate(() => {
    const ed = document.getElementById('mb-comp-editor'); const r = document.createRange(); r.selectNodeContents(ed);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.mbFmtKeep('reply');
    window.mbFmtVal('reply', 'foreColor', '#c00000');
    // a person picks the next thing from the bar with the words still selected (mousedown on the bar keeps the selection)
    const r2 = document.createRange(); r2.selectNodeContents(ed); s.removeAllRanges(); s.addRange(r2); window.mbFmtKeep('reply');
    window.mbFmtVal('reply', 'size', 'large');
  });
  const bodyHtml = await page.evaluate(() => STATE.mailbox.composer.body);
  step('a font, a colour and a size are written as styles that will be sent', /font-family:\s*Georgia/i.test(bodyHtml) && /color:\s*rgb\(192, 0, 0\)|color:\s*#c00000/i.test(bodyHtml) && /font-size:\s*large/i.test(bodyHtml), bodyHtml);
  await page.evaluate(() => { const ed = document.getElementById('mb-comp-editor'); const r = document.createRange(); r.selectNodeContents(ed); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.mbFmt('reply', 'justifyCenter'); });
  step('Centre aligns the line with a style (not the old align="")', /text-align:\s*center/.test(await page.evaluate(() => STATE.mailbox.composer.body)) && !/align="/.test(await page.evaluate(() => STATE.mailbox.composer.body)));
  await page.evaluate(() => { const ed = document.getElementById('mb-comp-editor'); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.mbFmt('reply', 'image'); });
  step('Image puts in a picture by its https address', /<img[^>]+src="https:\/\/cdn\.example\.com\/logo\.png"/.test(await page.evaluate(() => STATE.mailbox.composer.body)));

  // ── R-273 schedule send ──
  await page.evaluate(() => window.mbSchedOpen('reply'));
  await page.waitForSelector('#layer .mb-sched', { timeout: 5000 });
  await shot(page, 'b4-reply-bar-schedule.png');
  const panel = await page.evaluate(() => document.querySelector('#layer .mb-sched').innerText);
  step('Schedule opens a date and a time, in the person\'s own zone, with quick picks', /Date/.test(panel) && /Time/.test(panel) && /Your time/.test(panel) && /Tomorrow morning/.test(panel), panel.slice(0, 200));
  step('…and it says plainly that on the free server it can go out late', /free server/.test(panel) && /late/.test(panel));
  step('…and the date, the time and the Schedule button are on screen, not below the window\'s edge', await page.evaluate(() => {
    const vh = window.innerHeight, inView = (el) => { const r = el && el.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= vh; };
    return inView(document.getElementById('mb-sched-date-reply')) && inView([...document.querySelectorAll('#layer .mb-sched button')].find(b => /Schedule send/.test(b.textContent)));
  }));
  await page.evaluate(() => { document.getElementById('mb-sched-date-reply').value = '2001-01-01'; document.getElementById('mb-sched-time-reply').value = '08:00'; window.mbSchedConfirm('reply'); });
  await page.waitForTimeout(100);
  step('a time that has passed is refused in the window, nothing is sent to the server', /already passed/.test(await page.evaluate(() => document.querySelector('#layer .mb-sched').innerText)) && (await calls(/\/schedule$/, 'POST')).length === 0);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#layer .mb-sched-quick button')].find(x => /Tomorrow morning/.test(x.textContent)); b.click(); });
  await page.evaluate(() => window.mbSchedConfirm('reply'));
  await page.waitForFunction(() => !STATE.mailbox.composer, { timeout: 5000 });
  const sch = (await calls(/^\/mailbox\/mb1\/schedule$/, 'POST'))[0];
  const when = sch && new Date(sch[2].send_at);
  step('Schedule send stores it for the chosen time: a reply-all to THAT message, formatted, in the person\'s zone', !!sch && sch[2].kind === 'reply' && sch[2].message_id === 'r2' && sch[2].reply_all === true && sch[2].formatted === true && when.getHours() === 8 && when > new Date() && !!sch[2].timezone, JSON.stringify(sch && Object.assign({}, sch[2], { body: '…' })));
  step('…and the window closes (its draft goes too)', await page.evaluate(() => !document.querySelector('#layer [data-win="mailReply"]') && !Object.keys(localStorage).some(k => /pace-mb-draft:mb1:r2:/.test(k))));

  // ── Archive acts on the conversation ──
  const toasts = [];
  await page.evaluate(() => { window.__toasts = []; const st = window.showToast; window.showToast = function (m, k) { __toasts.push([m, k]); return st && st.apply(this, arguments); }; });
  await page.evaluate(() => window.mbArchive('r3'));
  await page.waitForTimeout(150);
  const archToast = await page.evaluate(() => (__toasts.find(t => /Archived/.test(t[0])) || [''])[0]);
  step('…and says so truthfully ("Archived 1", not "0 · 1 could not be changed")', archToast === 'Archived 1', archToast);
  const bulk = (await calls(/\/mailbox\/mb1\/bulk$/, 'POST'))[0];
  step('Archive on a conversation archives its messages in the Inbox (one request)', !!bulk && bulk[2].action === 'archive' && JSON.stringify(bulk[2].ids) === '["r2"]', JSON.stringify(bulk && bulk[2]));
  step('…and the conversation leaves the list, the reader closes', await page.evaluate(() => !STATE.mailbox.messages.some(x => x.thread_id === 'T1') && !STATE.mailbox.selectedId));

  // ── the view switch ── a small on/off switch (owner 20 Oct), not two buttons
  step('the view control is ONE small switch, on by default (conversations)', await page.evaluate(() => { const b = document.querySelectorAll('#mb-toolbar .mb-switch'); return b.length === 1 && b[0].getAttribute('role') === 'switch' && b[0].getAttribute('aria-checked') === 'true' && !document.querySelector('#mb-toolbar .mb-view') && b[0].getBoundingClientRect().height < 30; }));
  await page.evaluate(() => document.querySelector('#mb-toolbar .mb-switch').click());
  await page.waitForFunction(() => document.querySelector('#mb-toolbar .mb-switch') && document.querySelector('#mb-toolbar .mb-switch').getAttribute('aria-checked') === 'false', { timeout: 8000 });
  step('clicking the switch turns conversations off (every email on its own row)', await page.evaluate(() => STATE.mailbox.messages.every(m => !m.message_ids)));
  await page.evaluate(() => document.querySelector('#mb-toolbar .mb-switch').click());
  await page.waitForFunction(() => document.querySelector('#mb-toolbar .mb-switch') && document.querySelector('#mb-toolbar .mb-switch').getAttribute('aria-checked') === 'true', { timeout: 8000 });
  await page.waitForFunction(() => (STATE.mailbox.messages || []).some(m => m.message_ids), { timeout: 8000 });
  await page.evaluate(() => window.mbSetView('messages'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 3, { timeout: 8000 });
  step('"Single emails" lists every email on its own line', (await calls(/^\/mailbox\/mb1\/messages\?/)).length >= 1);
  step('…and is saved as the person\'s own preference', (await calls(/^\/me\/preferences$/, 'PUT')).some(c => c[2] && c[2].mail_view === 'messages'));
  await page.evaluate(() => window.mbSetView('threads'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).some(m => m.message_ids), { timeout: 8000 });

  // ── R-272 all inboxes ──
  const opt = await page.evaluate(() => [...document.querySelectorAll('#mb-toolbar select option')].map(o => o.value + '=' + o.textContent));
  step('the email ID picker offers "All inboxes"', opt.some(o => /^\*=All inboxes/.test(o)), opt.join('|'));
  await page.evaluate(() => window.mbSelectAccount('*'));
  await page.waitForFunction(() => STATE.mailbox.all && (STATE.mailbox.messages || []).length === 2, { timeout: 8000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#mb-list .mb-row')].map(r => r.innerText.replace(/\s+/g, ' ')));
  step('All inboxes lists every email ID\'s inbox together', (await calls(/^\/mailbox-all\/inbox\?view=threads/)).length === 1 && rows.length === 2);
  step('…each row says which email ID it arrived at', /prince@vhcstaffing\.com/.test(rows.find(r => /Timesheet/.test(r)) || '') && /prince@futeglobal\.com/.test(rows.find(r => /Dialpad/.test(r)) || ''), JSON.stringify(rows));
  await shot(page, 'b4-all-inboxes.png');
  step('…an email ID it could not read is named, not silently missing', /old@zoho\.test/.test(await page.evaluate(() => document.getElementById('mb-list').innerText)));
  await page.evaluate(() => window.mbOpen('o1'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'o1', { timeout: 8000 });
  step('opening a row reads it from ITS mailbox (not the one that was open)', (await calls(/^\/mailbox\/mb2\/messages\/o1/, 'GET')).length >= 1 && (await calls(/^\/mailbox\/mb2\/messages\/o1$/, 'PATCH')).length === 1);
  step('…and the list stays All inboxes', await page.evaluate(() => STATE.mailbox.all === true && STATE.mailbox.messages.length === 2));

  // ── Scheduled tab ──
  await page.evaluate(() => window.mbSetFilter('scheduled'));
  await page.waitForFunction(() => STATE.mailbox.sched && (STATE.reminders || []).length === 1, { timeout: 8000 });
  await page.evaluate(() => window.render && window.render());
  await page.waitForTimeout(100);
  const sched = await page.evaluate(() => document.getElementById('mb-list').innerText);
  step('Scheduled lists the emails waiting to go: to, subject, from which email ID, the file names', /To ray@y\.com/.test(sched) && /Following up/.test(sched) && /From prince@futeglobal\.com/.test(sched) && /cv\.pdf/.test(sched), sched.slice(0, 300));
  step('a scheduled reply says it is a reply (not "To —")', /Reply to the conversation/.test(sched) && !/To —/.test(sched));
  step('…one that did not go says why, and offers Send again', /Did not send: The email ID's sign-in had expired/.test(sched) && /Send again/.test(sched));
  await shot(page, 'b4-scheduled-tab.png');
  step('…and the person\'s reminders are in the same tab', /Your reminders/.test(sched) && /Call Ray about the start date/.test(sched) && /Open Reminders/.test(sched));
  await page.evaluate(() => window.mbSchedCancel('s1'));
  await page.waitForTimeout(100);
  step('Cancel it cancels that one', (await calls(/^\/mailbox-scheduled\/s1$/, 'DELETE')).length === 1);

  // ── Draft tab ──
  await page.evaluate(() => localStorage.setItem('pace-mb-draft:mb1:r2:re', JSON.stringify({ to: 'ray@y.com', subject: 'Re: Interview', body: 'Half written', at: Date.now() })));
  await page.evaluate(() => window.mbSetFilter('draft'));
  await page.waitForTimeout(100);
  const dr = await page.evaluate(() => document.getElementById('mb-list').innerText);
  step('Draft shows the reply being written on this device, from which email ID', /Reply to ray@y\.com/.test(dr) && /Half written/.test(dr) && /From prince@futeglobal\.com/.test(dr), dr.slice(0, 200));
  step('…and points to the Drafts saved in Gmail / Outlook', /Drafts folder/.test(dr));
  await shot(page, 'b4-draft-tab.png');
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
