// THE CANDIDATE BESIDE THEIR EMAIL — the screen (R-362, owner 3 Nov 2026), on the real mailbox page:
//   * an open email from an address PACE knows as a CANDIDATE shows "Candidate in PACE" (closed until asked), then a small card: name, title · employer · place,
//     email, phone, skills, status line, a resume preview that opens on a click, the jobs they are in, and "Open candidate";
//   * the resume text is shown as TEXT — markup inside it never becomes an element;
//   * it asks /mailbox/candidate-card (never the lead one), once per address; an address PACE does not know is never asked about;
//   * "Open candidate" opens the whole record; at a narrower width the card stays inside the pane.
// Usage: node test/mailbox-candidate-card-ui-smoke.mjs
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
const cal = { name: 'Cal Candidate', email: 'cal@mail.test' }, stranger = { name: 'Stan Ger', email: 'stan@unknown.test' };
const MSGS = {
  m1: { id: 'm1', thread_id: 'T1', subject: 'My availability', from: cal, to: [me], cc: [], date: iso(30), preview: 'Hi', unread: false, body_html: '<p>Hello from Cal</p>' },
  m2: { id: 'm2', thread_id: 'T2', subject: 'Cold intro', from: stranger, to: [me], cc: [], date: iso(40), preview: 'Hi', unread: false, body_html: '<p>Hello from Stan</p>' },
};
const CRM = { 'cal@mail.test': { type: 'candidate', id: 'k1', name: 'Cal Candidate' }, 'stan@unknown.test': { type: 'vendor', id: 'v1', name: 'Stan Ger' } };   // a known address of a kind that has NO card is not asked about either
const ROWS = Object.keys(MSGS).map(id => Object.assign({}, MSGS[id], { latest_id: id, latest_mine: false, party: MSGS[id].from, count: 1, participants: [MSGS[id].from] }));
const CARD = { found: true, candidate: { id: 'k1', name: 'Cal Candidate', headline: 'Welder', employer: 'Steelworks', location: 'Waco, TX', email: 'cal@mail.test', phone: '(555) 100-2000', alt_phone: '',
  skills: ['MIG', 'TIG', 'Pipe'], experience_years: 12, work_authorization: 'US citizen', availability: '2 weeks', status: 'Active', source: 'Indeed', owner: 'Rae Recruiter' },
  resume: { preview: 'Senior welder with 12 years of experience. <img src=x onerror="window.__xss=1"> <b>bold</b>', filename: 'cal.pdf', files: [{ id: 'd1', filename: 'cal.pdf', doc_type: 'resume' }] },
  jobs: [{ id: 'jo1', title: 'Pipe Welder', stage: 'Submitted to Client' }, { id: 'jo2', title: 'Structural Welder', stage: 'Sourced' }], more: 1 };

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
    window.bdOpenCandidate = function (id) { window.__opened.push(id); };
    window.apiGet = function (p) {
      window.__calls.push(['GET', p]);
      if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id: 'mb1', email_address: 'prince@futeglobal.com', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }]);
      if (/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: 0, mailboxes: 1 });
      if (/^\/mailbox\/candidate-card/.test(p)) return Promise.resolve(card);
      if (/^\/mailbox\/lead-card/.test(p)) return Promise.resolve({ found: false });
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
  const cardCalls = () => page.evaluate(() => window.__calls.filter(c => /-card/.test(c[1])).map(c => c[1].split('?')[0].split('/').pop() + ':' + decodeURIComponent(c[1].split('email=')[1])));
  const open = async (id) => { await page.evaluate((i) => window.mbOpen(i), id); await page.waitForFunction((i) => (STATE.mailbox.message || {}).id === i, id, { timeout: 8000 }); await page.waitForTimeout(250); };
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length === 2, { timeout: 8000 });

  await open('m1');
  await page.waitForSelector('.mb-lc-btn', { timeout: 5000 });
  step('the card is closed until asked for: only a "Candidate in PACE" button shows (not "Lead in PACE")', await page.evaluate(() => !document.querySelector('.mb-leadcard') && /Candidate in PACE/.test(document.querySelector('.mb-lc-btn').textContent) && !/Lead in PACE/.test(document.querySelector('.mb-lc-btn').textContent)));
  await page.evaluate(() => { document.querySelector('.mb-lc-btn').click(); });
  await page.waitForSelector('.mb-leadcard', { timeout: 5000 });
  const t = await page.evaluate(() => { const c = document.querySelector('.mb-leadcard'); return { text: c.innerText.replace(/\s+/g, ' '), inHead: !!c.closest('#mb-head'), skills: [...c.querySelectorAll('.pill')].map(p => p.textContent), open: c.querySelector('details').open, imgs: c.querySelectorAll('img').length, xss: window.__xss || 0 }; });
  step('the card names the candidate: CANDIDATE IN PACE, name, title · employer · place', t.inHead && /CANDIDATE IN PACE/.test(t.text) && /Cal Candidate/.test(t.text) && /Welder · Steelworks · Waco, TX/.test(t.text), t.text);
  step('…how to reach them: email and phone', /cal@mail\.test/.test(t.text) && /\(555\) 100-2000/.test(t.text));
  step('…skills, and the status line (status, years, authorization, availability, owner)', ['MIG', 'TIG', 'Pipe'].every(s => t.skills.includes(s)) && /Active · 12 yrs · US citizen · 2 weeks · Owner: Rae Recruiter/.test(t.text), t.text);
  step('…the jobs they are in with their stage, and how many more records share the address', /Pipe Welder/.test(t.text) && /Submitted to Client/.test(t.text) && /Structural Welder/.test(t.text) && /\+ 1 more record/.test(t.text));
  step('a job in the list is plain text, not styled as a link (it does nothing when clicked)', await page.evaluate(() => document.querySelectorAll('.mb-leadcard .mb-lc-lead a').length === 0 && document.querySelectorAll('.mb-leadcard .mb-lc-lead .mb-lc-job').length === 0));
  step('the resume preview is folded until asked for', t.open === false && /Resume · cal\.pdf/.test(t.text));
  await page.evaluate(() => { document.querySelector('.mb-leadcard summary').click(); });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ text: document.querySelector('.mb-lc-pre').innerText, imgs: document.querySelectorAll('.mb-leadcard img').length, bold: document.querySelectorAll('.mb-lc-pre b').length, xss: window.__xss || 0 }));
  step('the resume text shows as TEXT: markup in it never becomes an element and never runs', /Senior welder with 12 years/.test(r.text) && /<img src=x/.test(r.text) && r.imgs === 0 && r.bold === 0 && r.xss === 0, JSON.stringify(r));
  if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, 'candidate-card.png') }); }
  await page.evaluate(() => { [...document.querySelectorAll('.mb-leadcard a')].find(a => /Open candidate/.test(a.textContent)).click(); });
  step('"Open candidate" opens the whole record (the candidate\'s id)', (await page.evaluate(() => window.__opened)).join() === 'k1');
  step('the server was asked once, at the CANDIDATE endpoint for that address (never the lead one)', (await cardCalls()).join() === 'candidate-card:cal@mail.test', (await cardCalls()).join());
  await open('m2'); await open('m1');
  step('another email and back does not ask again, and the card is there at once', (await cardCalls()).length === 1 && await page.evaluate(() => !!document.querySelector('.mb-lc-btn')));
  await open('m2');
  step('an address PACE does not know: no card and no question to the server', await page.evaluate(() => !document.querySelector('.mb-lc-btn') && !document.querySelector('.mb-leadcard')) && (await cardCalls()).length === 1);
  await open('m1');
  await page.evaluate(() => { if (!document.querySelector('.mb-leadcard')) document.querySelector('.mb-lc-btn').click(); });
  await page.setViewportSize({ width: 1000, height: 900 }); await page.waitForTimeout(300);
  const narrow = await page.evaluate(() => { const c = document.querySelector('.mb-leadcard').getBoundingClientRect(), pane = document.getElementById('content').getBoundingClientRect(); return { within: c.left >= pane.left - 1 && c.right <= pane.right + 1, noScroll: document.getElementById('content').scrollWidth <= document.getElementById('content').clientWidth + 1 }; });
  step('at a narrower width the card stays inside the pane — nothing overflows', narrow.within && narrow.noScroll, JSON.stringify(narrow));
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
