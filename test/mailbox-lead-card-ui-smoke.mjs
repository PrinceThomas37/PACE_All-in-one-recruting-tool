// THE LEAD BESIDE ITS EMAIL — the screen (R-319, owner's 28 notes), on the real mailbox page:
//   * an open email from an address PACE knows as a lead's contact shows a small card in its header band: name, role · company, each lead
//     (job as a link, stage, place, owner), "+ N more";
//   * it is asked for ONCE per address, and never for an address PACE does not know (the server is not asked at all);
//   * its arriving does not rewrite the message body's frame (the iframe is the same element — an idle repaint writes nothing there);
//   * for an email WE sent, the card is the person it went to;
//   * "nothing visible" (found:false) draws no card, and a failed request draws no card and no error;
//   * the job link opens the lead; at a narrow width the card drops under the subject instead of overflowing.
// Usage: node test/mailbox-lead-card-ui-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const results = [];
const SHOTS = process.env.SHOTS || '';   // SHOTS=dir saves pictures to look at
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const findChromium = () => process.env.PLAYWRIGHT_CHROMIUM || (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')) ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');

const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const me = { name: 'Prince Thomas', email: 'prince@futeglobal.com' };
const dana = { name: 'Dana Cole', email: 'dana@acme.test' }, stranger = { name: 'Stan Ger', email: 'stan@unknown.test' }, hidden = { name: 'Hal Hidden', email: 'hal@hidden.test' }, boom = { name: 'Bo Om', email: 'bo@boom.test' };
const MSGS = {
  m1: { id: 'm1', thread_id: 'T1', subject: 'About the welder role', from: dana, to: [me], cc: [], date: iso(30), preview: 'Hi', unread: false, body_html: '<p>Hello from Dana</p>' },
  m2: { id: 'm2', thread_id: 'T2', subject: 'Cold intro', from: stranger, to: [me], cc: [], date: iso(40), preview: 'Hi', unread: false, body_html: '<p>Hello from Stan</p>' },
  m3: { id: 'm3', thread_id: 'T3', subject: 'Re: About the welder role', from: me, to: [dana], cc: [], date: iso(10), preview: 'Thanks', unread: false, body_html: '<p>We sent this</p>' },
  m4: { id: 'm4', thread_id: 'T4', subject: 'Not yours', from: hidden, to: [me], cc: [], date: iso(50), preview: 'Hi', unread: false, body_html: '<p>Hello from Hal</p>' },
  m5: { id: 'm5', thread_id: 'T5', subject: 'Server trouble', from: boom, to: [me], cc: [], date: iso(60), preview: 'Hi', unread: false, body_html: '<p>Hello from Bo</p>' },
};
const CRM = { 'dana@acme.test': { type: 'contact', id: 'c1', job_id: 'J1', name: 'Dana Cole' }, 'hal@hidden.test': { type: 'contact', id: 'c9', job_id: 'J9', name: 'Hal Hidden' }, 'bo@boom.test': { type: 'contact', id: 'c8', job_id: 'J8', name: 'Bo Om' } };
const ROWS = Object.keys(MSGS).map(id => Object.assign({}, MSGS[id], { latest_id: id, latest_mine: id === 'm3', party: MSGS[id].from.email === me.email ? MSGS[id].to[0] : MSGS[id].from, count: 1, participants: [], more_participants: 0, has_draft: false, message_ids: [id], in_folder: [id], unread_ids: [], folder_id: 'f-inbox' }));
const CARD = { found: true, contact: { name: 'Dana Cole', designation: 'HR Manager', email: 'dana@acme.test' }, company: { name: 'Acme Machining', website: 'https://acme.test' },
  leads: [{ id: 'J1', position: 'Welder', location: 'Waco, TX', stage: 'Assigned', owner: 'Bea Smith', unassigned: false }, { id: 'J2', position: 'CNC Machinist', location: 'Austin, TX', stage: 'Unassigned', owner: '', unassigned: true }], more: 2 };

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(([msgs, rows, crm, card]) => {
    window.__calls = []; window.__opened = [];
    window.openJob = function (id) { window.__opened.push(id); };
    window.apiGet = function (p) {
      window.__calls.push(['GET', p]);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id: 'mb1', email_address: 'prince@futeglobal.com', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/^\/mailbox\/lead-card/.test(p)) {
        const e = decodeURIComponent(p.split('email=')[1]);
        if (e === 'dana@acme.test') return window.__holdCard ? new Promise(res => { window.__releaseCard = () => res(card); }) : Promise.resolve(card);
        if (e === 'bo@boom.test') return Promise.reject(new Error('server down'));
        return Promise.resolve({ found: false });
      }
      if (/\/labels$/.test(p)) return Promise.resolve([]);
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' });
      if (/\/recipients$/.test(p)) return Promise.resolve({ recipients: [] });
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'f-inbox', name: 'Inbox', kind: 'inbox' }]);
      if (/^\/mailbox\/mb1\/conversations\?/.test(p)) return Promise.resolve({ conversations: rows, next_cursor: null, crm });
      if (/^\/mailbox\/mb1\/messages\?/.test(p)) return Promise.resolve({ messages: rows, next_cursor: null, crm });
      let m = p.match(/\/threads\/([^/?]+)$/); if (m) return Promise.resolve([]);
      m = p.match(/^\/mailbox\/mb1\/messages\/([^/?]+)/); if (m) return Promise.resolve(Object.assign({ attachments: [], has_remote_images: false, crm }, msgs[m[1]]));
      return Promise.resolve({});
    };
    window.apiPost = () => Promise.resolve({}); window.apiPatch = () => Promise.resolve({}); window.apiDelete = () => Promise.resolve({}); window.apiFetch = () => Promise.resolve({});
    STATE.reminders = [];
  }, [MSGS, ROWS, CRM, CARD]);
  const cardCalls = () => page.evaluate(() => window.__calls.filter(c => /lead-card/.test(c[1])).map(c => decodeURIComponent(c[1].split('email=')[1])));
  const open = async (id) => { await page.evaluate((i) => window.mbOpen(i), id); await page.waitForFunction((i) => (STATE.mailbox.message || {}).id === i, id, { timeout: 8000 }); await page.waitForTimeout(250); };

  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 5, { timeout: 8000 });

  // ── an email from a lead's contact ──
  await page.evaluate(() => { window.__holdCard = true; });
  await open('m1');
  step('before the answer arrives there is no card (and no error)', await page.evaluate(() => !document.querySelector('.mb-leadcard')));
  await page.evaluate(() => { window.__frameBefore = document.querySelector('#mb-open iframe'); window.__bodyBefore = document.querySelector('#mb-open'); window.__releaseCard(); });
  await page.waitForSelector('.mb-leadcard', { timeout: 5000 });
  const card = await page.evaluate(() => { const c = document.querySelector('.mb-leadcard'); return { text: c.innerText.replace(/\s+/g, ' '), inHead: !!c.closest('#mb-head'), jobs: [...c.querySelectorAll('.mb-lc-job')].map(a => a.textContent) }; });
  step('an email from a lead\'s contact shows the card in its header band: name, role · company', card.inHead && /Dana Cole/.test(card.text) && /HR Manager · Acme Machining/.test(card.text), card.text);
  step('…each lead with the job, stage, place and owner (an unowned one says so)', card.jobs.join() === 'Welder,CNC Machinist' && /Assigned/.test(card.text) && /Waco, TX · Owner: Bea Smith/.test(card.text) && /Austin, TX · Unassigned/.test(card.text), card.text);
  step('…and says how many more there are', /\+ 2 more leads/.test(card.text));
  step('the card arriving did not rewrite the message body (the same frame element, the same body region)', await page.evaluate(() => document.querySelector('#mb-open iframe') === window.__frameBefore && document.querySelector('#mb-open') === window.__bodyBefore && !!window.__frameBefore));
  await page.evaluate(() => { document.querySelector('.mb-lc-job').click(); });
  if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, 'lead-card.png') }); }
  step('the job is a link that opens that lead', (await page.evaluate(() => window.__opened)).join() === 'J1');
  step('the server was asked once, for that address', (await cardCalls()).join() === 'dana@acme.test');
  await open('m2'); await open('m1');
  step('opening it again (or another email and back) does not ask again — and the card is there at once', (await cardCalls()).length === 1 && await page.evaluate(() => !!document.querySelector('.mb-leadcard')));

  // ── an address PACE does not know ──
  await open('m2');
  step('an address PACE does not know as a lead\'s contact: no card, and the server is not even asked', await page.evaluate(() => !document.querySelector('.mb-leadcard')) && (await cardCalls()).length === 1);

  // ── an email we sent: the person it went to ──
  await page.evaluate(() => { window.__holdCard = false; });
  await open('m3');
  step('an email WE sent shows the card of the person it went to', await page.evaluate(() => !!document.querySelector('.mb-leadcard') && /Dana Cole/.test(document.querySelector('.mb-leadcard').innerText)));

  // ── a known address the person may not see; a failing server ──
  await open('m4');
  step('nothing the person may see (found:false): no card, no error', await page.evaluate(() => !document.querySelector('.mb-leadcard') && !/error|could not/i.test(document.getElementById('mb-head').innerText)) && (await cardCalls()).includes('hal@hidden.test'));
  await open('m5');
  step('a failed request draws no card and no error (a cross-link is a nicety)', await page.evaluate(() => !document.querySelector('.mb-leadcard') && !/server down/i.test(document.getElementById('content').innerText)));

  // ── narrow ──
  await open('m1');
  await page.setViewportSize({ width: 1000, height: 900 }); await page.waitForTimeout(300);
  const narrow = await page.evaluate(() => { const c = document.querySelector('.mb-leadcard').getBoundingClientRect(), pane = document.getElementById('content').getBoundingClientRect(), h = document.querySelector('.mb-head-main').getBoundingClientRect(); return { within: c.right <= pane.right + 1 && c.left >= pane.left - 1, below: c.top >= h.bottom - 1 || c.left >= h.right - 1, noScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 }; });
  step('at a narrower width the card stays inside the pane (under the subject if it cannot sit beside it) — nothing overflows', narrow.within && narrow.noScroll, JSON.stringify(narrow));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the page part ran to the end', false, String(e && e.stack || e) + ' PAGEERRORS: ' + pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
