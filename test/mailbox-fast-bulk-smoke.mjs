// THE INBOX IS QUICK TO SWITCH, AND CAN ACT ON MANY AT ONCE (owner, 6 Oct):
// "the load time is very high … switching between emails / inbox, sent, spam and all" and
// "no multi-select to delete or label emails … the system should enable the user to label emails".
// A real browser, the API stubbed with a 400 ms provider delay. This sandbox cannot measure real mail-provider
// speed; what it CAN prove is that a screen the person has already seen comes back WITHOUT waiting, and without
// asking the provider again:
//   * a folder seen a moment ago paints at once (no "Loading…"), and makes no new request while fresh
//   * an opened message comes back at once, with no new request; hovering a row fetches it ahead of the click
//   * after Delete / Archive, the memory is corrected — the message never comes back from a remembered list
//   * a list the person is ticking is never rewritten under their hands by a quiet refresh
//   * tick rows → a bar says how many → Delete asks the server ONCE (action trash, the ids), the rows leave, and
//     the toast says it went to Trash and is recoverable; a partial failure is named and that row stays
//   * Select all ticks what is loaded; Clear unticks
//   * Label…: a picker (✓ all / – some), one click labels every ticked email; a new label is created then applied;
//     chips show on the rows
//   * the picker sits above the sidebar, closes with Esc, and nothing pokes out sideways on a phone
// Usage: node test/mailbox-fast-bulk-smoke.mjs   (MAILBOX_SHOT_DIR=… keeps screenshots)
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
const BASE = `http://127.0.0.1:${PORT}`; const SHOTS = process.env.MAILBOX_SHOT_DIR || '';
const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const mk = (id, subj, unread) => ({ id, thread_id: 't' + id, subject: subj, from: { name: 'Sender ' + id, email: id + '@x.test' }, to: [{ email: 'me@gmail.com' }], cc: [],
  date: new Date(Date.now() - 3600000).toISOString(), preview: 'preview ' + id, unread: !!unread, has_attachments: false, platform: 'Gmail', label_ids: [] });
const F = {
  accounts: [{ id: 'mb2', email_address: 'me@gmail.com', display_name: 'Me', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }],
  folders: [{ id: 'INBOX', name: 'Inbox', kind: 'inbox', unread: 2, total: 9 }, { id: 'SENT', name: 'Sent', kind: 'sent', unread: 0, total: 9 }, { id: 'SPAM', name: 'Spam', kind: 'junk', unread: 0, total: 1 }],
  inbox: [mk('a1', 'Alpha subject', true), mk('a2', 'Bravo subject', true), mk('a3', 'Charlie subject', false), mk('a4', 'Delta subject', false)],
  sent: [mk('s1', 'Sent one', false)],
  labels: [{ id: 'Label_1', name: 'Clients', color: '#E74856' }, { id: 'Label_2', name: 'Hot' }],
};
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page); await enterApp(page, 'recruiter');
  const ev = (f, a) => page.evaluate(f, a);
  await ev((F) => {
    window.__gets = []; window.__posts = []; window.__toasts = []; window.__failIds = {};
    const wait = (v) => new Promise(r => setTimeout(() => r(JSON.parse(JSON.stringify(v))), 400));
    window.__inbox = F.inbox.slice(); window.__sent = F.sent.slice();
    window.apiGet = (p) => { window.__gets.push(p);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve(F.accounts);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 1, mailboxes: 1 });
      if (/\/folders$/.test(p)) return wait(F.folders);
      if (/\/labels$/.test(p)) return Promise.resolve(F.labels);
      if (/\/messages\?/.test(p)) return wait({ messages: /folder=SENT/.test(p) ? window.__sent : window.__inbox, next_cursor: null, crm: {} });
      const m = p.match(/\/messages\/([^/?]+)/);
      if (m) return wait({ id: m[1], thread_id: 't' + m[1], subject: 'Subject ' + m[1], from: { name: 'S', email: 's@x.test' }, to: [{ email: 'me@gmail.com' }], cc: [], date: new Date().toISOString(), unread: false, body_html: '<p>body ' + m[1] + '</p>', attachments: [], has_remote_images: false, label_ids: [] });
      if (/\/threads\//.test(p)) return Promise.resolve([]);
      return Promise.resolve({}); };
    window.apiPost = (p, b) => { window.__posts.push([p, JSON.parse(JSON.stringify(b || {}))]);
      if (/\/bulk$/.test(p)) { const results = b.ids.map(id => window.__failIds[id] ? { id, ok: false, error: 'boom' } : { id, ok: true, new_id: id }); return Promise.resolve({ ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }); }
      if (/\/labels$/.test(p)) return Promise.resolve({ id: 'Label_9', name: b.name });
      return Promise.resolve({ success: true }); };
    window.apiPatch = () => Promise.resolve({ success: true });
    window.apiDelete = () => Promise.resolve({ ok: true });
    window.showToast = (m, t) => window.__toasts.push([m, t]);
  }, F);

  const listGets = () => ev(() => window.__gets.filter(g => /\/messages\?/.test(g)).length);
  const msgGets = () => ev(() => window.__gets.filter(g => /\/messages\/[^?]+$/.test(g.split('?')[0])).length);
  const rowNames = () => ev(() => [...document.querySelectorAll('.mb-row .mb-subj')].map(e => e.textContent.trim()));
  const txt = () => ev(() => document.getElementById('content').innerText);
  const settle = (ms = 900) => page.waitForTimeout(ms);

  // ── 1. a folder seen a moment ago comes back at once ───────────────────────
  await ev(() => goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 4, { timeout: 8000 });
  step('the Inbox loads (first time: it has to wait for the provider)', (await rowNames()).length === 4);
  // R-142 (owner: "switching the tabs within — inbox to sent to spam — still takes 3 secs"): once the Inbox is
  // on screen, Sent and Spam are read quietly behind it, so the FIRST click on them is a remembered screen.
  await settle(2600);
  const folderGets = (f) => ev((f) => window.__gets.filter(g => new RegExp('/messages\\?.*folder=' + f).test(g)).length, f);
  step('after the Inbox, Sent and Spam were each read quietly, once', (await folderGets('SENT')) === 1 && (await folderGets('SPAM')) === 1, `sent=${await folderGets('SENT')} spam=${await folderGets('SPAM')}`);
  step('…and nothing else was read behind the screen (no custom folders, no repeats)', (await listGets()) === 3, 'list requests: ' + await listGets());
  const w0 = Date.now();
  await ev(() => mbSelectFolder('SENT'));
  const warmSent = await ev(() => ({ rows: document.querySelectorAll('.mb-row').length, loading: STATE.mailbox.listLoading }));
  step('the FIRST click on Sent paints its row at once — no "Loading…", no wait', warmSent.rows === 1 && !warmSent.loading, JSON.stringify(warmSent) + ' ' + (Date.now() - w0) + 'ms');
  await settle(700);
  step('…and it asked the provider for nothing more', (await folderGets('SENT')) === 1, 'sent reads: ' + await folderGets('SENT'));
  await ev(() => mbSelectFolder('INBOX'));
  await settle(500);
  const gets1 = await listGets();
  await ev(() => mbSelectFolder('SENT'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 1 && !STATE.mailbox.listLoading, { timeout: 8000 });
  step('Sent loads', (await rowNames())[0] === 'Sent one');
  const before = await listGets();
  const t0 = Date.now();
  await ev(() => mbSelectFolder('INBOX'));
  const instant = await ev(() => ({ rows: document.querySelectorAll('.mb-row').length, loading: STATE.mailbox.listLoading, msgs: (STATE.mailbox.messages || []).length }));
  step('going back to the Inbox paints its 4 rows IMMEDIATELY — no "Loading…" blank', instant.rows === 4 && !instant.loading, JSON.stringify(instant) + ' ' + (Date.now() - t0) + 'ms');
  await settle(700);
  step('…and asked the provider for nothing (the list is fresh)', (await listGets()) === before, `before=${before} after=${await listGets()}`);

  // ── 2. messages ─────────────────────────────────────────────────────────────
  const m0 = await msgGets();
  await ev(() => mbOpen('a1'));
  await page.waitForFunction(() => STATE.mailbox.message && STATE.mailbox.message.id === 'a1', { timeout: 8000 });
  step('the first open of a message waits for the provider once', (await msgGets()) === m0 + 1);
  await ev(() => mbBack());
  await ev(() => mbOpen('a1'));
  const again = await ev(() => ({ open: STATE.mailbox.message && STATE.mailbox.message.id, loading: STATE.mailbox.msgLoading }));
  step('opening it AGAIN shows it at once', again.open === 'a1' && !again.loading, JSON.stringify(again));
  await settle(500);
  step('…with no new request', (await msgGets()) === m0 + 1);
  // hover ahead
  await ev(() => mbBack());
  const h0 = await msgGets();
  await page.hover('.mb-row:nth-child(3)');       // third row after the select-all header → a2
  await settle(900);
  step('resting the pointer on a row fetches that message ahead of the click', (await msgGets()) === h0 + 1, `h0=${h0} now=${await msgGets()}`);
  const row = await ev(() => document.querySelectorAll('.mb-row')[1].getAttribute('onclick'));
  const opened = /mbOpen\('(\w+)'\)/.exec(row)[1];
  await ev((id) => mbOpen(id), opened);
  const pre = await ev(() => ({ open: STATE.mailbox.message && STATE.mailbox.message.id, loading: STATE.mailbox.msgLoading }));
  step('…so the click is instant', pre.open === opened && !pre.loading, JSON.stringify(pre));
  await ev(() => mbBack());

  // ── 3. selecting many, deleting ───────────────────────────────────────────────
  step('every row has a tick box, and there is no bar until something is ticked', await ev(() => document.querySelectorAll('.mb-row .mb-chk input').length === 4 && !document.querySelector('.mb-bulk')));
  await ev(() => { document.querySelectorAll('.mb-row .mb-chk input')[0].click(); document.querySelectorAll('.mb-row .mb-chk input')[2].click(); });
  await settle(150);
  step('ticking two rows opens the bar: "2 selected"', await ev(() => /2 selected/.test(document.querySelector('.mb-bulk').innerText)));
  step('…and ticking did not open a message', await ev(() => !STATE.mailbox.selectedId));
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'inbox-bulk-bar.png') }); }
  await ev(() => { window.__failIds = { a3: true }; window.__posts.length = 0; window.__toasts.length = 0; });
  await ev(() => mbBulk('trash'));
  await settle(300);
  const bulk = await ev(() => window.__posts.filter(p => /\/bulk$/.test(p[0])));
  step('Delete is ONE request: action "trash" with exactly the two ticked ids', bulk.length === 1 && bulk[0][1].action === 'trash' && bulk[0][1].ids.slice().sort().join() === 'a1,a3', JSON.stringify(bulk));
  step('the one that went leaves the list; the one that failed STAYS', JSON.stringify(await rowNames()) === JSON.stringify(['Bravo subject', 'Charlie subject', 'Delta subject']), JSON.stringify(await rowNames()));
  const toast = await ev(() => window.__toasts.map(t => t[0]).join(' | '));
  step('the toast says Trash + recoverable, and names the failure', /Trash/.test(toast) && /recoverable/.test(toast) && /1 could not/.test(toast), toast);
  step('a Delete never calls the permanent-delete route (there is none to call)', !(await ev(() => window.__posts.some(p => /destroy|permanent|hard/i.test(p[0] + JSON.stringify(p[1]))))));
  // memory corrected: Sent and back — a1 does not come back
  await ev(() => { window.__failIds = {}; mbSelectFolder('SENT'); });
  await page.waitForFunction(() => !STATE.mailbox.listLoading, { timeout: 5000 });
  await ev(() => mbSelectFolder('INBOX'));
  step('the deleted message does not come back from the remembered list', !(await rowNames()).includes('Alpha subject'));

  // ── 4. select all / clear ──────────────────────────────────────────────────────
  await ev(() => mbSelAll()); await settle(150);
  step('Select all ticks everything loaded', await ev(() => /3 selected/.test(document.querySelector('.mb-bulk').innerText)));
  await ev(() => mbSelClear()); await settle(100);
  step('Clear unticks and the bar goes away', await ev(() => !document.querySelector('.mb-bulk')));

  // ── 5. a quiet refresh never rewrites a list being worked ────────────────────────
  // Age the Inbox past its 15s freshness, come back to it (shown at once from memory, re-read behind
  // the screen), tick a row inside the refresh window, and let the refresh land with DIFFERENT mail.
  await ev(() => { mbSelectFolder('SENT'); });
  await page.waitForFunction(() => !STATE.mailbox.listLoading, { timeout: 5000 });
  await page.waitForTimeout(15500);
  await ev(() => { window.__inbox = window.__inbox.slice(0, 1).concat([{ ...window.__inbox[0], id: 'zz', subject: 'Brand new mail' }]); mbSelectFolder('INBOX'); });
  const shown = (await rowNames()).length;
  await ev(() => { document.querySelectorAll('.mb-row .mb-chk input')[0].click(); });
  await settle(900);
  step('a refresh that lands while a row is ticked does NOT rewrite the list under the person', shown === 3 && (await rowNames()).length === 3 && !(await rowNames()).includes('Brand new mail') && (await ev(() => Object.keys(STATE.mailbox.sel).length)) === 1, JSON.stringify(await rowNames()));
  await ev(() => mbSelClear());
  await ev(() => { mbSelectFolder('SENT'); });
  await page.waitForFunction(() => !STATE.mailbox.listLoading, { timeout: 5000 });
  await ev(() => mbSelectFolder('INBOX'));
  step('…but what it fetched is remembered: the next visit shows the new mail', (await rowNames()).includes('Brand new mail'), JSON.stringify(await rowNames()));

  // ── 6. labels ──────────────────────────────────────────────────────────────────
  await ev(() => { document.querySelectorAll('.mb-row .mb-chk input')[0].click(); document.querySelectorAll('.mb-row .mb-chk input')[1].click(); });
  await settle(150);
  await ev(() => mbLabelMenu()); await settle(300);
  step('Label… opens a picker listing the mailbox\'s labels', await ev(() => !!document.querySelector('.mb-lm') && /Clients/.test(document.querySelector('.mb-lm').innerText) && /Hot/.test(document.querySelector('.mb-lm').innerText)));
  step('the picker sits ABOVE the sidebar (its left edge is not hidden under the menu)', await ev(() => { const r = document.querySelector('.mb-lm').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 20, r.top + 20); return !!(el && el.closest('.mb-lm')); }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'inbox-label-picker.png') });
  await ev(() => { window.__posts.length = 0; });
  await ev(() => mbLabelToggle('Label_1')); await settle(400);
  const lab = await ev(() => window.__posts.filter(p => /\/bulk$/.test(p[0])));
  step('one click on "Clients" labels both ticked emails (one request)', lab.length === 1 && lab[0][1].action === 'label' && lab[0][1].label_id === 'Label_1' && lab[0][1].ids.length === 2, JSON.stringify(lab));
  step('the picker now shows ✓ for Clients', await ev(() => /✓/.test(document.querySelector('.mb-lm').innerText)));
  step('chips appear on the two rows behind it', await ev(() => document.querySelectorAll('.mb-row .mb-lbl').length === 2 && /Clients/.test(document.querySelector('.mb-row .mb-lbl').textContent)));
  step('R-136: a chip shows its label\'s own colour as a small square (and a label with none shows no square)', await ev(() => { const d = document.querySelector('.mb-row .mb-lbl .mb-ldot'); return !!d && getComputedStyle(d).backgroundColor === 'rgb(231, 72, 86)' && !document.querySelector('.mb-lm-name .mb-ldot ~ .none'); }) && await ev(() => document.querySelectorAll('.mb-lm-row').length === 2 && document.querySelectorAll('.mb-lm-row .mb-ldot').length === 1));
  await ev(() => { window.__posts.length = 0; });
  await ev(() => mbLabelToggle('Label_1')); await settle(400);
  const unl = await ev(() => window.__posts.filter(p => /\/bulk$/.test(p[0])));
  step('clicking a ✓ label again REMOVES it from them all', unl.length === 1 && unl[0][1].action === 'unlabel' && (await ev(() => document.querySelectorAll('.mb-row .mb-lbl').length)) === 0, JSON.stringify(unl));
  // create new
  await ev(() => { document.getElementById('mb-newlabel').value = 'Follow up'; window.__posts.length = 0; mbLabelCreate(); }); await settle(500);
  const created = await ev(() => window.__posts.map(p => [p[0].replace(/^.*\/mailbox\/[^/]+/, ''), p[1].action || p[1].name]));
  step('"Create & apply" makes the label, then applies it', JSON.stringify(created) === JSON.stringify([['/labels', 'Follow up'], ['/bulk', 'label']]), JSON.stringify(created));
  step('…and it is in the list from then on', await ev(() => /Follow up/.test(document.querySelector('.mb-lm').innerText)));
  await ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await settle(150);
  step('Esc closes the picker', await ev(() => !document.querySelector('.mb-lm')));
  await ev(() => mbSelClear());

  // ── 7. phone ──────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 800 }); await settle(500);
  await ev(() => { document.querySelectorAll('.mb-row .mb-chk input')[0].click(); }); await settle(200);
  const ph = await ev(() => { const c = document.getElementById('content'); const b = document.querySelector('.mb-bulk').getBoundingClientRect(); return { over: c.scrollWidth - c.clientWidth, right: Math.round(b.right), vw: innerWidth }; });
  step('phone: the bar and the rows fit the screen (nothing pokes out sideways)', ph.over <= 1 && ph.right <= ph.vw + 1, JSON.stringify(ph));
  step('No page errors', pageErrors.length === 0, pageErrors.join('|').slice(0, 300));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
