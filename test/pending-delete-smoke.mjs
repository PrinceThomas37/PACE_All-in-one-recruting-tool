// DELETE A PENDING EMAIL THAT IS NOT WANTED (owner, 14 Oct: "when a pending email is selected, there should be an option to delete that
// email if not required").
//   * opening an email in Pending shows a Delete email button beside Edit; ticked emails get "Delete selected (n)"
//   * both ask first, name who is affected, and say it will not be sent and the lead stays
//   * confirming deletes exactly those emails (DELETE /emails/:id each), takes them off the list, and never touches the rest
//   * a teammate's email can be read but never deleted from here (no button, no tick box)
//   * a failed delete is said, and the list is reloaded from the server rather than guessed
// Usage: node test/pending-delete-smoke.mjs
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
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await page.evaluate((pending) => {
    window.__calls = []; window.__failDelete = null; window.__server = JSON.parse(JSON.stringify(pending));
    window.apiGet = function (p) {
      if (p.indexOf('/emails?status=pending') === 0) return Promise.resolve(JSON.parse(JSON.stringify(window.__server)));
      if (p.indexOf('/emails?status=') === 0) return Promise.resolve([]);
      if (p.indexOf('/emails/pending-summary') === 0) return Promise.resolve({ total_pending: window.__server.length, by_timezone: [], held_ids: [] });
      if (p.indexOf('/emails/send-progress') === 0) return Promise.resolve({ active: false });
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) { window.__calls.push(['POST', p, b]); return Promise.resolve({}); };
    window.apiFetch = function (m, p, b) {
      window.__calls.push([m, p, b]);
      if (m === 'DELETE') { const id = p.split('/').pop(); if (window.__failDelete === id) return Promise.reject(new Error('This email changed while you were deleting it — it may be sending now.')); window.__server = window.__server.filter(e => e.id !== id); return Promise.resolve({ success: true }); }
      return Promise.resolve({});
    };
  }, PENDING);
  await enterApp(page, 'bd');
  await page.evaluate(() => { window.STATE.page = 'email'; window.STATE.emailTab = 'pending'; window.loadEmailsForCurrentUser(); });
  await page.waitForTimeout(500);
  const text = () => page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  const modal = () => page.evaluate(() => { const x = document.querySelector('.modal'); return x ? x.innerText.replace(/\s+/g, ' ') : ''; });
  const dels = () => page.evaluate(() => window.__calls.filter(c => c[0] === 'DELETE').map(c => c[1]));

  // ── 1. one email, from its preview ─────────────────────────────────────────
  await page.evaluate(() => window.previewPendingEmail('e3'));
  let h = await text();
  step('opening an email shows Delete email beside Edit email', /Delete email/.test(h) && /Edit email/.test(h));
  await page.locator('button', { hasText: /^Delete email$/ }).click(); await page.waitForTimeout(150);
  let m = await modal();
  step('it asks first: names who it is to, says it will NOT be sent, that the lead stays, and that it cannot be undone', /Delete this email\?/.test(m) && /fay@lonestar\.example/.test(m) && /will not be sent/.test(m) && /lead stays/.test(m) && /cannot be undone/.test(m) && (await dels()).length === 0, m);
  await page.locator('.modal button', { hasText: /^Keep it$/ }).click(); await page.waitForTimeout(100);
  step('"Keep it" deletes nothing', (await dels()).length === 0 && /fay@lonestar/.test(await text()));
  await page.locator('button', { hasText: /^Delete email$/ }).click(); await page.waitForTimeout(100);
  await page.locator('.modal button', { hasText: /^Delete it$/ }).click(); await page.waitForTimeout(400);
  step('confirming deletes exactly that one email (one request)', JSON.stringify(await dels()) === JSON.stringify(['/emails/e3']), JSON.stringify(await dels()));
  h = await text();
  step('…it leaves the list and the preview closes; the other emails are untouched', !/fay@lonestar/.test(h) && /dana@brazos/.test(h) && /gus@gulf/.test(h) && !/Delete email/.test(h));

  // ── 2. several, ticked ─────────────────────────────────────────────────────
  step('with nothing ticked there is no "Delete selected" button', !/Delete selected/.test(await text()));
  await page.evaluate(() => { window.STATE.pendingSel = {}; window.togglePendingSel('e1'); window.togglePendingSel('e5'); });
  step('ticking two emails offers "Delete selected (2)"', /Delete selected \(2\)/.test(await text()));
  await page.locator('button', { hasText: /Delete selected \(2\)/ }).click(); await page.waitForTimeout(150);
  m = await modal();
  step('the confirm lists both, and counts them', /Delete 2 emails\?/.test(m) && /dana@brazos/.test(m) && /gus@gulf/.test(m) && !/eli@brazos/.test(m), m);
  await page.evaluate(() => { window.__failDelete = 'e5'; });
  await page.locator('.modal button', { hasText: /^Delete these 2$/ }).click(); await page.waitForTimeout(500);
  const d2 = await dels();
  h = await text();
  step('one delete is refused by the server: the other still goes, the person is told which failed and why, and the failed one stays listed (list reloaded from the server)', d2.includes('/emails/e1') && d2.includes('/emails/e5') && !/dana@brazos\.example/.test(h.replace(/eli@brazos/g, '')) && /gus@gulf/.test(h), d2.join() + ' | ' + h.slice(0, 200));
  await page.evaluate(() => { window.__failDelete = null; });

  // ── 3. a teammate's email ──────────────────────────────────────────────────
  await page.evaluate(() => window.previewPendingEmail('e4'));
  h = await text();
  step('a teammate\'s email can be read but has no Delete (or Edit) button, and no tick box', /Rhea/.test(h) && !/Delete email/.test(h) && !/Edit email/.test(h) && (await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#content tbody tr')).find(t => /team@brazos/.test(t.textContent)); return !!r && !r.querySelector('input[type=checkbox]'); })));
  step('asking to delete it anyway (by id) is refused before anything is sent to the server', await page.evaluate(() => { const before = window.__calls.filter(c => c[0] === 'DELETE').length; window.openDeletePendingConfirm(['e4']); return window.__calls.filter(c => c[0] === 'DELETE').length === before && !document.querySelector('.modal'); }));

  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the suite ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.length && results.every(Boolean) ? 0 : 1);
