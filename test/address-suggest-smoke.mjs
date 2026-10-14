// ADDRESS SUGGESTIONS UNDER TO / CC (owner, 14 Oct: "when an email ID is being typed in the compose, reply, forward or reply-all bar, there
// is auto suggest, if the email ID was typed previously, like Gmail or Outlook").
//   1. the collector (services/recipient-suggest.js): who a mailbox has written to, newest first, one entry per address, never itself;
//   2. the REAL route GET /mailbox/:mid/recipients over a fake mailbox: reads the Sent folder only, as far back as the ADMIN's number,
//      only for the mailbox's owner (404 for anybody else), and holds the answer in memory (a second ask costs the provider nothing);
//   3. the page, in a real browser: typing offers the people written to before, then people in the open mailbox, then PACE's contacts;
//      the ones that START like the typing come first; people already in the box and the mailbox's own address are never offered; the
//      box works in New message AND in a reply; arrow keys + Enter / click take one; and typing a whole address then Enter keeps EXACTLY
//      what was typed, even when a longer remembered address begins the same way.
// Usage: node test/address-suggest-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── 1. the collector ──
const { collectRecipients } = require(path.join(ROOT, 'services/recipient-suggest.js'));
const msgs = [
  { date: '2026-10-10T10:00:00Z', to: [{ name: 'Sara Ladd', email: 'Sara@Elevate.com' }], cc: [{ name: '', email: 'bob@x.com' }] },
  { date: '2026-10-12T10:00:00Z', to: [{ name: 'sara@elevate.com', email: 'sara@elevate.com' }, { name: 'Me', email: 'ME@futeglobal.com' }], cc: [] },
  { date: '2026-10-01T10:00:00Z', to: [{ name: 'Old Friend', email: 'old@y.com' }, { name: 'Bad', email: 'not-an-address' }], cc: [] },
];
const got = collectRecipients(msgs, ['me@futeglobal.com']);
step('one entry per address (case-insensitive), newest correspondence first', got.map(g => g.email).join() === 'sara@elevate.com,bob@x.com,old@y.com', got.map(g => g.email).join());
step('…a real name is kept (not the address repeated), and how often is counted', got[0].name === 'Sara Ladd' && got[0].times === 2 && got[1].name === '');
step('…the mailbox\'s own address and a non-address are never suggested', !got.some(g => /futeglobal|not-an/.test(g.email)));
step('nothing in, nothing out (and no throw)', collectRecipients(null, null).length === 0 && collectRecipients([{ to: null }], []).length === 0);

// ── 2. the real route ──
const O = 'org-a';
const fake = createFakeDb({ tables: { user_emails: [{ id: 'mbG', user_id: 'u1', org_id: O, email_address: 'me@futeglobal.com', display_name: 'Me', platform: 'Gmail', is_active: true, is_primary: true }, { id: 'mbH', user_id: 'u1', org_id: O, email_address: 'h@futeglobal.com', display_name: 'H', platform: 'Gmail', is_active: true, is_primary: false }, { id: 'mbX', user_id: 'u2', org_id: O, email_address: 'x@futeglobal.com', platform: 'Gmail', is_active: true }], app_settings: [], microsoft_tokens: [], gmail_tokens: [{ user_email_id: 'mbG', refresh_failed: false }, { user_email_id: 'mbH', refresh_failed: false }] } });
const calls = { page: [], get: 0, labels: 0 };
const sentMsgs = Array.from({ length: 130 }, (_, i) => ({ id: 's' + i, to: i === 129 ? 'oldest@z.com' : 'p' + i + '@z.com', date: i }));
const gmailProvider = {
  listLabels: async () => { calls.labels++; return [{ id: 'INBOX', type: 'system', name: 'INBOX' }, { id: 'SENT', type: 'system', name: 'SENT' }]; },
  getLabel: async () => ({ messagesTotal: 0, messagesUnread: 0 }),
  listMessagePage: async (_id, o) => { calls.page.push(o); const start = Number(o.pageToken || 0); const slice = sentMsgs.slice(start, start + o.maxResults); return { messages: slice.map(m => ({ id: m.id })), nextPageToken: start + o.maxResults < sentMsgs.length ? String(start + o.maxResults) : null }; },
  getMessage: async (_id, mid) => { calls.get++; const m = sentMsgs.find(x => x.id === mid); return { id: mid, threadId: 't' + mid, labelIds: ['SENT'], internalDate: String(1.8e12 + (130 - m.date) * 60000), payload: { headers: [{ name: 'To', value: m.to }, { name: 'From', value: 'me@futeglobal.com' }, { name: 'Subject', value: 's' }, { name: 'Date', value: 'Tue, 14 Oct 2026 10:00:00 +0000' }] } }; },
};
const hasRole = () => false;
const app = express(); app.use(express.json());
app.use(require(path.join(ROOT, 'routes/mailbox.js'))({ supabase: fake.supabase, db: {}, auth: (req, res, next) => { req.user = { id: req.headers['x-user'] || 'u1', org_id: O, roles: ['bd'], role: 'bd' }; req.orgId = O; next(); }, orgIdFor: () => O, hasRole,
  graphMailRequest: async () => ({ value: [] }), getMicrosoftToken: async () => 't', gmailProvider, sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (b) => b, getMailboxSignature: async () => '' }));
const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
const get = (who, p) => new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${srv.address().port}${p}`, { headers: { 'x-user': who } }, (res) => { let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(out); } catch (_) { j = out; } resolve({ status: res.statusCode, json: j }); }); }).on('error', reject); });
let r = await get('u1', '/mailbox/mbG/recipients');
step('ROUTE: the answer is the people written to, from the Sent folder', r.status === 200 && Array.isArray(r.json.recipients) && r.json.recipients.length > 0, JSON.stringify(r).slice(0, 160));
step('ROUTE: only as far back as the admin\'s number (100 by default) — the 30 oldest sent emails are not read', r.json.read === 100 && !r.json.recipients.some(x => x.email === 'oldest@z.com') && calls.page.every(p => p.labelIds && p.labelIds[0] === 'SENT'), 'read ' + r.json.read);
const before = calls.get;
r = await get('u1', '/mailbox/mbG/recipients');
step('ROUTE: a second ask is answered from memory — the provider is not asked again', calls.get === before);
step('ROUTE: somebody else\'s mailbox does not exist for you (404)', (await get('u1', '/mailbox/mbX/recipients')).status === 404);
const settings = require(path.join(ROOT, 'config/settings.js'));
await settings.setSettings(fake.supabase, { mailbox_recipient_lookback: 20 });
srv.close();
{
  const app2 = express(); app2.use(express.json());
  app2.use(require(path.join(ROOT, 'routes/mailbox.js'))({ supabase: fake.supabase, db: {}, auth: (req, res, next) => { req.user = { id: 'u1', org_id: O, roles: ['bd'], role: 'bd' }; req.orgId = O; next(); }, orgIdFor: () => O, hasRole,
    graphMailRequest: async () => ({ value: [] }), getMicrosoftToken: async () => 't', gmailProvider, sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (b) => b, getMailboxSignature: async () => '' }));
  const s2 = app2.listen(0, '127.0.0.1'); await new Promise(rr => s2.once('listening', rr));
  const g2 = await new Promise((resolve) => http.get(`http://127.0.0.1:${s2.address().port}/mailbox/mbH/recipients`, (res) => { let o = ''; res.on('data', d => { o += d; }); res.on('end', () => resolve(JSON.parse(o))); }));
  step('ROUTE: the admin lowers the number to 20 → only 20 sent emails are read (another mailbox, so nothing is cached)', g2.read === 20, 'read ' + g2.read);
  s2.close();
}

// ── 3. the page ──
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r2 => server.listen(0, '127.0.0.1', () => r2(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const MSG = { id: 'm1', thread_id: 't1', folder_id: 'f-inbox', subject: 'Re: Controller', from: { name: 'Sally Zed', email: 'sally@zz.com' }, to: [{ name: 'Priya', email: 'priya@futeglobal.com' }], cc: [], date: iso(5), preview: 'hi', unread: false, platform: 'Gmail', label_ids: [] };
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', rt => rt.request().url().startsWith(BASE) ? rt.continue() : rt.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'recruiter');
  await page.evaluate((msg) => {
    window.apiGet = function (p) {
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id: 'mb1', email_address: 'priya@futeglobal.com', display_name: 'Priya', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/\/recipients$/.test(p)) return Promise.resolve({ recipients: [{ email: 'sara@elevatedesignbuildkc.com', name: 'Sara Ladd' }, { email: 'saran@other.com', name: '' }, { email: 'sam@acme.com.au', name: '' }, { email: 'priya@futeglobal.com', name: 'Priya' }, { email: 'bob@x.com', name: 'Bob Marsh' }] });
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 0, total: 1 }]);
      if (/\/threads\//.test(p)) return Promise.resolve([]);
      if (/\/messages\?/.test(p)) return Promise.resolve({ messages: [msg], next_cursor: null, crm: {} });
      if (/\/messages\/m1/.test(p)) return Promise.resolve(Object.assign({}, msg, { body_html: '<p>x</p>', has_remote_images: false, attachments: [], crm: {} }));
      return Promise.resolve({});
    };
    window.apiPost = window.apiPatch = window.apiDelete = function () { return Promise.resolve({ success: true }); };
    STATE.contacts = [{ id: 'c1', job_id: 'j1', first_name: 'Sam', last_name: 'Stone', email: 'sam@acme.com' }, { id: 'c2', job_id: 'j1', first_name: 'Sue', last_name: 'Ladd', email: 'sue@acme.com' }];
  }, MSG);
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 1, { timeout: 8000 });

  await page.evaluate(() => window.mbCompose(''));
  await page.waitForSelector('#mb-c-editor', { timeout: 4000 });
  await page.waitForFunction(() => (((STATE.mailbox.recip || {}).mb1 || {}).list || []).length > 0, { timeout: 4000 });
  const to = () => page.locator('.modal .chipf').first().locator('.chipf-in');
  const sugs = () => page.evaluate(() => [...document.querySelectorAll('.modal .chipf-sug-i')].map(x => x.getAttribute('data-e')));
  await to().click(); await page.keyboard.type('sa');
  const s1 = await sugs();
  step('typing "sa" offers people written to before FIRST, then the mailbox, then PACE\'s contacts', s1.join() === 'sara@elevatedesignbuildkc.com,saran@other.com,sam@acme.com.au,sally@zz.com,sam@acme.com', s1.join());
  step('…never the mailbox\'s own address, and at most six', !s1.includes('priya@futeglobal.com') && s1.length <= 6);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.type('ladd');
  const s2 = await sugs();
  step('a name works too — "ladd" finds Sara Ladd (written to) and Sue Ladd (a PACE contact)', s2[0] === 'sara@elevatedesignbuildkc.com' && s2.includes('sue@acme.com'), s2.join());
  step('…each suggestion shows the name and the address', await page.evaluate(() => /Sara Ladd/.test(document.querySelector('.modal .chipf-sug-i').innerText) && /sara@elevatedesignbuildkc\.com/.test(document.querySelector('.modal .chipf-sug-i').innerText)));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  const chips1 = await page.evaluate(() => [...document.querySelectorAll('.modal .chipf')[0].querySelectorAll('.chipf-c')].map(c => c.getAttribute('data-a')));
  step('arrow keys then Enter take the highlighted suggestion as an address chip', chips1.join() === 'sara@elevatedesignbuildkc.com', chips1.join());
  step('…the hidden field the send reads has it too, and the list is closed', await page.evaluate(() => document.getElementById('mb-c-to').value === 'sara@elevatedesignbuildkc.com' && !document.querySelector('.modal .chipf-sug')));
  await page.keyboard.type('sar');
  step('somebody already in the box is not offered again', !(await sugs()).includes('sara@elevatedesignbuildkc.com'), (await sugs()).join());
  await page.keyboard.press('Escape');
  step('Escape closes the list (and not the window)', (await sugs()).length === 0 && await page.evaluate(() => !!document.getElementById('mb-c-editor')));
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');

  await page.keyboard.type('sam@acme.com');
  step('a longer remembered address that starts the same way is offered…', (await sugs()).includes('sam@acme.com.au'));
  await page.keyboard.press('Enter');
  const chips2 = await page.evaluate(() => [...document.querySelectorAll('.modal .chipf')[0].querySelectorAll('.chipf-c')].map(c => c.getAttribute('data-a')));
  step('…but Enter keeps EXACTLY what was typed — a suggestion is taken only when the person moves onto it', chips2.join() === 'sara@elevatedesignbuildkc.com,sam@acme.com', chips2.join());
  await page.keyboard.type('bo');
  await page.locator('.modal .chipf-sug-i').first().dispatchEvent('mousedown');
  const chips3 = await page.evaluate(() => [...document.querySelectorAll('.modal .chipf')[0].querySelectorAll('.chipf-c')].map(c => c.getAttribute('data-a')));
  step('clicking a suggestion takes it too', chips3.includes('bob@x.com'), chips3.join());
  await page.keyboard.type('zzzz');
  step('typing something nobody matches offers nothing', (await sugs()).length === 0);
  await page.evaluate(() => window.mbCancelComposer());

  // the reply window
  await page.evaluate(() => window.mbOpen('m1'));
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'm1', { timeout: 8000 });
  await page.evaluate(() => window.mbReply(false));
  await page.waitForSelector('[data-win="mailReply"]', { timeout: 4000 });
  await page.locator('[data-win="mailReply"] .chipf .chipf-in').first().click();
  await page.keyboard.type('bob');
  const s5 = await page.evaluate(() => [...document.querySelectorAll('[data-win="mailReply"] .chipf-sug-i')].map(x => x.getAttribute('data-e')));
  step('the same suggestions work in a REPLY (and so in reply all and forward — one box)', s5[0] === 'bob@x.com', s5.join());
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the page part ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
