// SEARCHING A MAILBOX SEARCHES ALL OF IT, NOT JUST THE OPEN FOLDER (owner, 14 Oct: "the search happens only in the folder that's being
// selected, not all folders like in Gmail — I want it to search all across within that email and show the results").
//   1. providers: a list with no folder is the whole mailbox (Graph /me/messages; Gmail with no label filter), and a Gmail result says
//      which folder it lives in (from its system label) so a result can be labelled;
//   2. the page: typing a search sends NO folder; each result shows the folder it is in; a Sent result shows who it went to; the folder
//      menu says "All folders — search results"; choosing a folder leaves the search and brings that folder back; Clear search too;
//      and the folder's own list is not poisoned by the search (a searched list is remembered separately).
// Usage: node test/mailbox-search-all-folders-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const mp = require('../services/mail-provider.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── 1. providers ──
{
  const paths = [];
  const graphMailRequest = async (_t, p) => { paths.push(p); return { value: [{ id: 'g1', parentFolderId: 'F-SENT', subject: 's', receivedDateTime: '2026-10-14T10:00:00Z' }] }; };
  const prov = mp.createMailProvider({ graphMailRequest, getMicrosoftToken: async () => 'tok', gmailProvider: {} });
  const ms = prov.forMailbox({ id: 'm1', platform: 'Microsoft', email_address: 'a@b.c' });
  const all = await ms.listMessages({ q: 'katie' });
  step('Outlook: a search with no folder reads /me/messages — every folder', /^\/me\/messages\?/.test(paths[0]) && /%24search|\$search/.test(paths[0]), paths[0]);
  step('…and each result carries the folder it is in', all.messages[0].folder_id === 'F-SENT');
  await ms.listMessages({ folderId: 'F-INBOX' });
  step('Outlook: with a folder (no search) it still reads just that folder', /^\/me\/mailFolders\/F-INBOX\/messages\?/.test(paths[1]), paths[1]);

  const seen = [];
  const gmailProvider = {
    listMessagePage: async (_id, o) => { seen.push(o); return { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }; },
    getMessage: async (_id, mid) => ({ id: mid, threadId: 't' + mid, labelIds: { a: ['INBOX', 'UNREAD'], b: ['SENT'], c: ['TRASH', 'INBOX'], d: ['CATEGORY_UPDATES'] }[mid], payload: { headers: [{ name: 'Subject', value: 's' }, { name: 'From', value: 'x@y.z' }, { name: 'Date', value: 'Tue, 14 Oct 2026 10:00:00 +0000' }] }, internalDate: String(Date.now()) }),
  };
  const gm = mp.createMailProvider({ graphMailRequest, getMicrosoftToken: async () => 'tok', gmailProvider }).forMailbox({ id: 'm2', platform: 'Gmail', email_address: 'a@g.c' });
  const res = await gm.listMessages({ q: 'katie' });
  step('Gmail: a search with no folder asks for NO label filter — the whole mailbox', seen[0].labelIds === undefined && seen[0].q === 'katie');
  const f = Object.fromEntries(res.messages.map(m => [m.id, m.folder_id]));
  step('Gmail: a result says where it lives — Inbox, Sent; Trash beats Inbox; an archived one has none', f.a === 'INBOX' && f.b === 'SENT' && f.c === 'TRASH' && f.d === null, JSON.stringify(f));
  await gm.listMessages({ folderId: 'INBOX' });
  step('Gmail: with a folder it still filters by that label', JSON.stringify(seen[1].labelIds) === '["INBOX"]');
  step('Gmail: a whole-mailbox search INCLUDES Spam and Trash (Gmail leaves them out unless asked)', seen[0].includeSpamTrash === true, JSON.stringify(seen[0]));
  step('Gmail: reading one folder does not ask for them', seen[1].includeSpamTrash === undefined);
  // and the Gmail provider itself puts it on the wire (a stand-in for the network records the address it is asked for)
  const { createGmailProvider } = require('../gmail-provider.js');
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ messages: [], resultSizeEstimate: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const db = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { access_token: 'tok', expires_at: new Date(Date.now() + 3600e3).toISOString() }, error: null }) }) }) }) };
    const real = createGmailProvider({ supabase: db, google: { clientId: 'x', clientSecret: 'y', redirectUri: 'z', scopes: 's' } });
    await real.listMessagePage('mb', { q: 'katie', maxResults: 5, includeSpamTrash: true });
    await real.listMessagePage('mb', { labelIds: ['INBOX'], maxResults: 5 });
    step('the Gmail request carries includeSpamTrash=true when asked, and not otherwise', /includeSpamTrash=true/.test(urls[0]) && !/includeSpamTrash/.test(urls[1]), urls.join(' | '));
  } finally { globalThis.fetch = realFetch; }
}

// ── 2. the page ──
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
const me = { name: 'Priya', email: 'priya@futeglobal.com' }, katie = { name: 'Katie Simmer', email: 'katie@cargill.com' };
const INBOX_ONLY = [{ id: 'i1', thread_id: 't1', folder_id: 'f-inbox', subject: 'Inbox item', from: { name: 'Zed', email: 'zed@x.com' }, to: [me], cc: [], date: iso(5), preview: 'hello', unread: false, platform: 'Gmail', label_ids: [] }];
const FOUND = [
  { id: 'sp1', thread_id: 't8', folder_id: 'f-spam', subject: 'Katie in Spam', from: katie, to: [me], cc: [], date: iso(30), preview: 'spam', unread: false, platform: 'Gmail', label_ids: [] },
  { id: 'tr1', thread_id: 't9', folder_id: 'f-trash', subject: 'Katie in Trash', from: katie, to: [me], cc: [], date: iso(40), preview: 'trash', unread: false, platform: 'Gmail', label_ids: [] },
  { id: 'ar1', thread_id: 't10', folder_id: null, subject: 'Katie archived', from: katie, to: [me], cc: [], date: iso(50), preview: 'old', unread: false, platform: 'Gmail', label_ids: [] },
  { id: 'i2', thread_id: 't2', folder_id: 'f-inbox', subject: 'Katie in the inbox', from: katie, to: [me], cc: [], date: iso(10), preview: 'hi', unread: false, platform: 'Gmail', label_ids: [] },
  { id: 's1', thread_id: 't3', folder_id: 'f-sent', subject: 'Sent to Katie', from: me, to: [katie], cc: [], date: iso(20), preview: 'we sent', unread: false, platform: 'Gmail', label_ids: [] },
];
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'recruiter');
  // This suite is about the single-email list (the provider's /messages read). Conversations are the default since R-271
  // and have their own suite (mailbox-threads-ui-smoke); this is the person's own "Single emails" choice, not a bypass.
  await page.evaluate(() => { STATE.mailView = 'messages'; });
  await page.evaluate(([inbox, found]) => {
    window.__reads = [];
    window.apiGet = function (p) {
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id: 'mb1', email_address: 'priya@futeglobal.com', display_name: 'Priya', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 0, total: 1 }, { id: 'f-sent', name: 'Sent', kind: 'sent', unread: 0, total: 1 }, { id: 'f-spam', name: 'Spam', kind: 'junk', unread: 0, total: 1 }, { id: 'f-trash', name: 'Trash', kind: 'trash', unread: 0, total: 1 }]);
      if (/\/messages\?/.test(p)) { window.__reads.push(p); return Promise.resolve({ messages: /[?&]q=/.test(p) ? found : (/folder=f-sent/.test(p) ? [] : inbox), next_cursor: null, crm: {} }); }
      return Promise.resolve({});
    };
    window.apiPost = window.apiPatch = window.apiDelete = function () { return Promise.resolve({ success: true }); };
  }, [INBOX_ONLY, FOUND]);
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 1, { timeout: 8000 });

  await page.evaluate(() => window.mbSearch('katie'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 5, { timeout: 8000 });
  const searchRead = await page.evaluate(() => window.__reads[window.__reads.length - 1]);
  step('a search sends NO folder — the server searches every folder', /q=katie/.test(searchRead) && !/folder=/.test(searchRead), searchRead);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#mb-list .mb-row')].map(r => ({ txt: r.innerText.replace(/\s+/g, ' '), chip: (r.querySelector('.mb-in-folder') || {}).textContent || '' })));
  const chipOf = (t) => (rows.find(r => r.txt.indexOf(t) > -1) || {}).chip;
  step('each result shows the folder it is in', rows.length === 5 && chipOf('Katie in the inbox') === 'Inbox' && chipOf('Sent to Katie') === 'Sent', JSON.stringify(rows));
  step('results from Spam and Trash are found and say so', chipOf('Katie in Spam') === 'Spam' && chipOf('Katie in Trash') === 'Trash', JSON.stringify(rows.map(r => r.chip)));
  step('a Gmail message that was archived (in no folder) says "All Mail"', chipOf('Katie archived') === 'All Mail');
  step('a Sent result shows who it went TO, not us', /To Katie Simmer/.test(rows.find(r => r.txt.indexOf('Sent to Katie') > -1).txt));
  step('an Inbox result shows who it is from', /Katie Simmer/.test(rows.find(r => r.txt.indexOf('Katie in the inbox') > -1).txt));
  const menu = await page.evaluate(() => { const s = document.querySelector('#mb-toolbar select[onchange*="mbSelectFolder"]'); return s ? { sel: s.options[s.selectedIndex].textContent, n: s.options.length } : null; });
  step('the folder menu says the results are from ALL folders', menu && /All folders/.test(menu.sel), JSON.stringify(menu));
  step('the search box says it searches all folders', await page.evaluate(() => /all folders/i.test((document.querySelector('#mb-toolbar input[type="search"], #mb-toolbar input') || {}).placeholder || '')));

  await page.evaluate(() => window.mbSelectFolder('f-sent'));
  await page.waitForFunction(() => !STATE.mailbox.q && STATE.mailbox.folderId === 'f-sent', { timeout: 8000 });
  await page.waitForTimeout(200);
  const afterPick = await page.evaluate(() => ({ q: STATE.mailbox.q, last: window.__reads[window.__reads.length - 1], chips: document.querySelectorAll('#mb-list .mb-in-folder').length, sel: (() => { const s = document.querySelector('#mb-toolbar select[onchange*="mbSelectFolder"]'); return s.options[s.selectedIndex].textContent; })() }));
  step('choosing a folder LEAVES the search and reads that folder only', afterPick.q === '' && /folder=f-sent/.test(afterPick.last) && !/q=/.test(afterPick.last), JSON.stringify(afterPick));
  step('…the folder menu names that folder again and the result chips are gone', /Sent/.test(afterPick.sel) && afterPick.chips === 0);

  await page.evaluate(() => window.mbSelectFolder('f-inbox'));
  await page.waitForFunction(() => STATE.mailbox.folderId === 'f-inbox' && (STATE.mailbox.messages || []).some(m => m.id === 'i1'), { timeout: 8000 });
  step('the Inbox\'s own list is not poisoned by the earlier search (only its own message is there)', await page.evaluate(() => STATE.mailbox.messages.length === 1 && STATE.mailbox.messages[0].id === 'i1'));
  await page.evaluate(() => window.mbSearch('katie'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 5, { timeout: 8000 });
  await page.evaluate(() => window.mbClearSearch());
  await page.waitForFunction(() => !STATE.mailbox.q && (STATE.mailbox.messages || []).some(m => m.id === 'i1'), { timeout: 8000 });
  step('Clear search goes back to the folder that was open', await page.evaluate(() => STATE.mailbox.folderId === 'f-inbox' && STATE.mailbox.messages.length === 1));
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
