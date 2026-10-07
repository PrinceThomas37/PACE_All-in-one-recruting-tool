// The send card on the Pending screen must not contradict the Pending list (owner's screenshot, 7 Oct 2026:
// "29 sent, 3 waiting, 56 total" beside a Pending list of 27) and must tell the truth about a send a restart killed.
//   * a send in flight shows "Still to go" (the ones not yet reached) next to "Waiting" (looked at and held back)
//   * a send that was stopped early says so, how far it got, and what to press — it is not "Sending emails…"
//   * a stopped-early card is NOT auto-dismissed after 30 s like a clean run (it needs a person)
//   * pressing Send all pending while one is already running says so (it is not "queued")
// Usage: node test/send-card-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  const show = (sp) => ev((sp) => { STATE.pendingEmails = []; STATE.emailTab = 'pending'; STATE.page = 'email'; STATE.sendProgress = sp; render(); }, sp);
  const chips = () => ev(() => [...document.querySelectorAll('#content .fs-20')].map(n => n.textContent.trim() + ' ' + n.nextElementSibling.textContent.trim()));

  // the owner's exact numbers
  await show({ active: true, done: false, total: 56, sent: 29, failed: 0, deferred: 3, current: 'a@b.test' });
  let c = await chips();
  step('a send in flight (29 sent, 3 held back, of 56) shows "Still to go 24" beside "Waiting 3" — the numbers add up to the Total', c.includes('29 Sent') && c.includes('3 Waiting') && c.includes('24 Still to go') && c.includes('56 Total'), c.join(' | '));
  await show({ active: true, done: false, total: 10, sent: 2, failed: 1, retrying: 1, deferred: 0 });
  c = await chips();
  step('failures and retries are taken off too (10 − 2 sent − 1 failed − 1 retrying = 6 to go)', c.includes('6 Still to go'), c.join(' | '));
  await show({ active: false, done: true, total: 4, sent: 3, failed: 1, failDetails: [{ to: 'x@y.test', error: 'Mailbox full' }], completedAt: new Date().toISOString() });
  step('a FINISHED run shows no "Still to go" (it has none)', !(await chips()).some(x => /Still to go/.test(x)));

  // stopped early
  await show({ active: false, done: true, interrupted: true, total: 56, sent: 29, failed: 0, deferred: 3, completedAt: new Date().toISOString() });
  let t = await ev(() => document.getElementById('content').innerText);
  c = await chips();
  step('a send a restart killed says "Sending stopped early" — never "Sending emails…" and never "Send complete"', /Sending stopped early/.test(t) && !/Sending emails/.test(t) && !/Send complete/.test(t));
  step('…says how far it got and what to do: "stopped after 29 of 56 … press Send all pending"', /stopped after 29 of 56/.test(t) && /Send all pending/.test(t) && /still in Pending/.test(t));
  step('…and shows how many are still pending (56 − 29 = 27, the same number as the Pending list), not a contradicting "Waiting"', c.includes('27 Still pending') && !c.some(x => /Waiting/.test(x)), c.join(' | '));
  step('…it is not the quiet one-line "Send finished" (a person has to see it)', !(await ev(() => !!document.querySelector('#content .sp-line'))));

  // not auto-dismissed
  await ev(() => { window.apiGet = (u) => /send-progress/.test(u) ? Promise.resolve({ active: false, done: true, interrupted: true, total: 56, sent: 29, failed: 0, completedAt: new Date().toISOString() }) : Promise.resolve([]); STATE._progressDismissed = false; STATE.sendProgress = null; if (typeof startProgressPoll === 'function') { stopProgressPoll && stopProgressPoll(); startProgressPoll(); } });
  await page.waitForTimeout(2600);
  const sp = await ev(() => STATE.sendProgress);
  step('the poll hands the stopped-early record to the screen', sp && sp.interrupted === true);
  // a clean run schedules an auto-dismiss 30 s later; a stopped-early one must not
  await ev(() => {
    window.__dismissTimers = 0; const orig = window.setTimeout;
    window.setTimeout = function (f, ms) { if (ms === 30000 && /^function\s*\(\)\s*\{\s*STATE\._progressDismissed=true/.test(String(f))) window.__dismissTimers++; return orig.apply(window, arguments); };
    window.__serve = { active: false, done: true, interrupted: true, total: 56, sent: 29, failed: 0, completedAt: new Date().toISOString() };
    window.apiGet = (u) => /send-progress/.test(u) ? Promise.resolve(window.__serve) : Promise.resolve([]);
    window.stopProgressPoll(); window.startProgressPoll();
  });
  await page.waitForTimeout(2800);
  const afterStopped = await ev(() => window.__dismissTimers);
  await ev(() => { window.__serve = { active: false, done: true, total: 3, sent: 3, failed: 0, completedAt: new Date().toISOString() }; STATE._progressDismissed = false; window.stopProgressPoll(); window.startProgressPoll(); });
  await page.waitForTimeout(2800);
  const afterClean = await ev(() => window.__dismissTimers);
  step('a stopped-early card is NOT set to disappear after 30 s (a person has to read it) — a clean finished run still is', afterStopped === 0 && afterClean >= 1, afterStopped + ' / ' + afterClean);

  // already running: the click is told the truth, and the rows it took off the list come back
  await ev(() => {
    window.__toasts = []; window.showToast = function (m, ty) { window.__toasts.push([m, ty]); };
    window.__reloaded = 0; window.loadEmailsForCurrentUser = function () { window.__reloaded++; };
    STATE.pendingEmails = [{ id: 'e1', is_mine: true, status: 'pending' }, { id: 'e2', is_mine: true, status: 'pending' }];
    window.apiPost = (p) => /queue-all/.test(p) ? Promise.resolve({ success: true, queued: 0, already_running: true, pending: 2 }) : Promise.resolve({});
    window.startProgressPoll = function () {}; window.stopProgressPoll = function () {};
    window.closeModal = function () {};
    window.submitSendAll();
  });
  await page.waitForTimeout(250);
  const tt = await ev(() => window.__toasts);
  step('pressing Send all pending while one is already running says so — it does NOT say "queued"', tt.some(x => /already running/.test(x[0])) && !tt.some(x => /queued for sending/.test(x[0])), JSON.stringify(tt));
  step('…and the emails that click had taken off the Pending list are loaded back', (await ev(() => window.__reloaded)) >= 1);
  // and a normal click still says queued
  await ev(() => { window.__toasts = []; window.apiPost = (p) => /queue-all/.test(p) ? Promise.resolve({ success: true, queued: 2 }) : Promise.resolve({}); window.submitSendAll(); });
  await page.waitForTimeout(250);
  step('a normal click still says "2 emails queued for sending"', (await ev(() => window.__toasts)).some(x => /2 emails queued for sending/.test(x[0])));
  step('No uncaught page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  step('Test harness ran', false, e.stack || e.message);
} finally { if (browser) await browser.close(); server.close(); }
console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
