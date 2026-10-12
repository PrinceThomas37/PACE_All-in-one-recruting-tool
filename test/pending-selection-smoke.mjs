// Verifies "Review & send" and "Send selected" (owner, 12 Oct). The complaint, in the owner's words: when "Review & send" is
// pressed on a Find Leads lead, the person lands on EVERY pending email and the only send button sends them all — "selection is
// missing". What is asserted here is what the person sees and exactly what the screen asks the server to send.
//
//   1. Review & send opens the Pending tab on that ONE lead's emails, ticked; a teammate's row has no tick box.
//   2. Send selected asks the server to send exactly the ticked ids — never the rest of the queue.
//   3. "Show all pending" puts the whole queue back with NOTHING ticked (a person never sends what they did not choose).
//   4. Another page, or another tab, drops the narrowing (a quietly filtered queue hides mail).
//   5. The server route behind it uses the same columns and the same "is it due" rule as Send all pending.
//
// Usage: node test/pending-selection-smoke.mjs

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
const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const row = (id, jobId, company, to, extra = {}) => Object.assign({ id, job_id: jobId, to_email: to, subject: 'Hello ' + company, body: 'Hi', status: 'pending', is_mine: true, job: { id: jobId, position: 'Welder', company: { name: company }, timezone: 'EST' }, contact: { first_name: 'Dana', last_name: 'Cole' } }, extra);
const PENDING = [
  row('e1', 'L1', 'Brazos Machining', 'dana@brazos.example'),
  row('e2', 'L1', 'Brazos Machining', 'eli@brazos.example'),
  row('e3', 'L2', 'Lone Star Dental', 'fay@lonestar.example'),
  row('e4', 'L1', 'Brazos Machining', 'team@brazos.example', { is_mine: false, sender: { name: 'Rhea' } }),
  row('e5', 'L3', 'Gulf Fabrication', 'gus@gulf.example'),
];

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);

  await page.evaluate((pending) => {
    window.__calls = [];
    window.apiGet = function (p) {
      if (p.indexOf('/emails?status=pending') === 0) return Promise.resolve(JSON.parse(JSON.stringify(pending)));
      if (p.indexOf('/emails?status=') === 0) return Promise.resolve([]);
      if (p.indexOf('/emails/pending-summary') === 0) return Promise.resolve({ total_pending: pending.length, by_timezone: [], held_ids: [] });
      if (p.indexOf('/emails/send-progress') === 0) return Promise.resolve({ active: false });
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) { window.__calls.push([p, b]); if (/send-selected$/.test(p)) return Promise.resolve({ success: true, queued: (b.email_ids || []).length }); return Promise.resolve({}); };
    // A saved Find Leads lead L1 whose first email is waiting in Pending.
    window.STATE.finder.hist = { days: 90, card_days: 5, hidden: 0, counts: { accepted: 1 }, items: [
      { id: 'h1', search_id: 's1', company_name: 'Brazos Machining', place: 'Waco, TX', status: 'accepted', decided_at: '2026-10-05T10:00:00Z',
        lead: { id: 'L1', position: 'Welder', stage: 'Assigned', email: { pending: 2, sent: 0, failed: 0, from: 'bea@x.test' }, contacts: [], jobs: [] } } ] };
    window.STATE.finder.access = { enabled: true, apollo: { connected: true }, credits: { used: 0, limit: 300 }, reveals: { used: 0, limit: 30 }, sectors: [], sizes: [], posted: { min: 0, max: 30, def: 14 } };
    window.STATE.finder.accessFor = 'test-bd'; window.STATE.finder.tab = 'history'; window.STATE.finder.histStatus = 'accepted';
  }, PENDING);
  await enterApp(page, 'bd');
  await page.evaluate(() => { window.STATE.finder.accessFor = window.STATE.user.id; window.STATE.finder.access = { enabled: true, apollo: { connected: true }, credits: { used: 0, limit: 300 }, reveals: { used: 0, limit: 30 }, sectors: [], sizes: [], posted: { min: 0, max: 30, def: 14 } }; window.STATE.page = 'finder'; window.STATE.finder.tab = 'history'; window.render(); });
  await page.waitForTimeout(400);

  // ── 1. Review & send ───────────────────────────────────────────────────────
  const btn = page.locator('button', { hasText: 'Review & send' });
  step('the saved lead shows a "Review & send" button', (await btn.count()) === 1);
  await btn.first().click();
  await page.waitForTimeout(500);
  let h = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('it opens the Pending tab on THIS lead only: its two emails, not the other leads\'', /dana@brazos\.example/.test(h) && /eli@brazos\.example/.test(h) && !/fay@lonestar/.test(h) && !/gus@gulf/.test(h));
  step('…and the banner says so, with a way back to the whole queue', /Only Brazos Machining/.test(h) && /Show all pending \(5\)/.test(h));
  step('…and counts only the person\'s OWN ticked emails (two), not the teammate\'s that is shown beside them', /2 of your emails are waiting for this lead and ticked/.test(h) && /A teammate's email is shown too/.test(h));
  const boxes = () => page.evaluate(() => Array.from(document.querySelectorAll('#content tbody input[type=checkbox]')).map(b => b.checked));
  step('both of the person\'s own emails for the lead are ticked; the teammate\'s row has no tick box at all', JSON.stringify(await boxes()) === '[true,true]', JSON.stringify(await boxes()));
  step('the primary button says how many: Send selected (2); Send all pending is still there but is not the main button', /Send selected \(2\)/.test(h) && /Send all pending \(4\)/.test(h)
    && (await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#content button')).find(x => /Send all pending/.test(x.textContent)); return !!b && /btn-outline/.test(b.className) && !/btn-primary/.test(b.className); })));

  // ── 2. un-tick one, send selected ──────────────────────────────────────────
  await page.locator('#content tbody input[type=checkbox]').nth(1).click();
  h = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('un-ticking one email changes the count to Send selected (1)', /Send selected \(1\)/.test(h));
  await page.locator('button', { hasText: 'Send selected (1)' }).click();
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => { const x = document.querySelector('.modal'); return x ? x.innerText.replace(/\s+/g, ' ') : ''; });
  step('a confirm names who the email goes to before anything is sent', /Confirm: Send this email/.test(m) && /dana@brazos\.example/.test(m) && !/eli@brazos/.test(m));
  await page.locator('.modal button', { hasText: /^Send it$/ }).click();
  await page.waitForTimeout(250);
  const calls = await page.evaluate(() => window.__calls);
  const sent = calls.filter(c => /send-selected$/.test(c[0]));
  step('the server is asked once, for exactly the ticked email — not the lead\'s other one, not the queue', sent.length === 1 && JSON.stringify(sent[0][1]) === JSON.stringify({ email_ids: ['e1'] }), JSON.stringify(sent));
  step('and never for Send all (queue-all) from this path', !calls.some(c => /queue-all$/.test(c[0])));

  // ── 3. Show all pending: nothing ticked ────────────────────────────────────
  await page.evaluate(() => window.loadEmailsForCurrentUser());
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: /Show all pending/ }).click();
  await page.waitForTimeout(150);
  h = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('Show all pending lists every lead\'s emails again', /fay@lonestar/.test(h) && /gus@gulf/.test(h) && /dana@brazos/.test(h));
  step('…with NOTHING ticked and Send selected (0) switched off — a person never sends what they did not choose',
    (await boxes()).every(b => b === false) && /Send selected \(0\)/.test(h) && (await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#content button')).find(x => /Send selected/.test(x.textContent)); return !!b && b.disabled; })));
  await page.locator('#content tbody input[type=checkbox]').nth(2).click();
  h = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('in the whole queue a person can tick any emails they like', /Send selected \(1\)/.test(h));
  await page.locator('#content thead input[type=checkbox]').click();
  step('the header box ticks every one of their own emails (four — the teammate\'s is never included)', /Send selected \(4\)/.test(await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '))));
  await page.locator('#content thead input[type=checkbox]').click();
  step('…and clears them again', /Send selected \(0\)/.test(await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '))));

  // ── 4. the narrowing is for one visit ──────────────────────────────────────
  await page.evaluate(() => { window.STATE.emailTab = 'pending'; window.STATE.pendingFocus = { jobId: 'L3', label: 'Gulf Fabrication' }; window.STATE.pendingSel = {}; window.render(); });
  step('a focus on one lead narrows the list', !/dana@brazos/.test(await page.evaluate(() => document.getElementById('content').innerText)));
  await page.evaluate(() => window.goPage('leads'));
  step('going to another page drops the focus', await page.evaluate(() => window.STATE.pendingFocus === null));
  await page.evaluate(() => { window.STATE.pendingFocus = { jobId: 'L3', label: 'Gulf Fabrication' }; window.setEmailTab('pending'); });
  step('pressing the Pending tab again drops the focus too', await page.evaluate(() => window.STATE.pendingFocus === null));

  // ── 5. the server route ────────────────────────────────────────────────────
  const SRC = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const ss = SRC.slice(SRC.indexOf("app.post('/emails/send-selected'"), SRC.indexOf('// GET /emails/send-progress'));
  step('send-selected reads the SAME columns as Send all pending (PENDING_EMAIL_JOB_SELECT), not its own older list', /\.select\(PENDING_EMAIL_JOB_SELECT\)/.test(ss));
  step('…skips a row that is waiting out its retry backoff, exactly as Send all does (sendRetry.isDue)', /sendRetry\.isDue\(e, nowMs\)/.test(ss));
  step('…only ever the caller\'s own rows, and only pending ones', /\.eq\('sent_by', req\.user\.id\)/.test(ss) && /\.eq\('status', 'pending'\)/.test(ss));
  step('…and an error before the answer is sent is answered (it used to leave the request hanging)', /if \(!res\.headersSent\) res\.status\(500\)/.test(ss));

  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the suite ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.length && results.every(Boolean) ? 0 : 1);
