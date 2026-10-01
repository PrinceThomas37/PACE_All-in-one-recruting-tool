// "NEEDS YOU TODAY" AND "CLIENT CONVERSATIONS": THE TOP 3, A BUTTON FOR ALL, A CHECKBOX FOR DONE (R-098/R-099, D-0066).
// Owner: "only top 3 priority shows and then a button to see all and a check box to check which shows that it's completed."
//   * each list draws only its first three rows (the server already ranks them), and says how many there are in all;
//   * "See all N" shows every row, "Show the top 3" goes back;
//   * every row has a checkbox: ticking a reminder marks it DONE; ticking anything else is the snooze that returns only
//     if they write again (POST /next-actions/dismiss, scope drop) — and for a client conversation the item posted is the
//     one the SERVER sent (`complete`), never one the browser made up;
//   * a failed tick un-ticks the box and says so; a row that is ticked is not lost silently.
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
const NOW = new Date().toISOString();
const NA = (id, kind, extra) => Object.assign({ kind, entity_type: 'contact', entity_id: id, title: 'P-' + id, subtitle: 'Co', reason: 'why ' + id, priority: 50, last_activity_at: NOW }, extra);
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext(); await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  await ev((items) => { window.__posts = []; window.__fail = false; STATE.viewingUser = null;
    window.apiPost = (u, b) => { window.__posts.push({ u, b }); return window.__fail ? Promise.reject(new Error('refused')) : Promise.resolve({ success: true }); };
    window.apiGet = () => Promise.resolve({ items: [] });
    STATE.nextActions = { items, summary: { by_kind: {} } }; STATE.naExpanded = false; STATE.naShowOlder = false; }, [
    NA('a', 'reply_due', { priority: 90 }), NA('b', 'reply_due', { priority: 80 }), NA('c', 'commitment_due', { priority: 70 }),
    NA('d', 'reminder_due', { priority: 60, reminder_id: 'r-d', last_activity_at: null, due_at: NOW.slice(0, 10) }), NA('e', 'nudge', { priority: 50 })]);
  const rows = () => ev(() => { const h = document.createElement('div'); h.innerHTML = renderNextActionsCard(); return { titles: [...h.querySelectorAll('[data-na-item]')].map(r => r.textContent.match(/P-\w/)[0]), ticks: h.querySelectorAll('[data-na-item] input[type=checkbox]').length, text: h.textContent }; });
  let r = await rows();
  step('Needs you today: only the top three rows are drawn, in priority order', JSON.stringify(r.titles) === '["P-a","P-b","P-c"]', JSON.stringify(r.titles));
  step('…and a button says how many there are in all', /See all 5/.test(r.text));
  step('every row has a "completed" checkbox', r.ticks === 3);
  await ev(() => { STATE.naExpanded = true; });
  r = await rows();
  step('See all shows all five, and the button goes back to the top three', r.titles.length === 5 && /Show the top 3/.test(r.text), JSON.stringify(r.titles));
  await ev(() => { STATE.naExpanded = false; render(); });
  // tick a non-reminder row, in the live DOM
  const live = (id) => ev((i) => { const row = [...document.querySelectorAll('[data-na-item]')].find(x => x.textContent.includes('P-' + i)); return row ? { has: true } : { has: false }; }, id);
  await page.waitForFunction(() => document.querySelector('[data-na-item] input[type=checkbox]'), null, { timeout: 5000 }).catch(() => {});
  const tickable = await ev(() => !!document.querySelector('[data-na-item] input[type=checkbox]'));
  if (!tickable) { await ev(() => { document.getElementById('content').innerHTML = renderNextActionsCard(); }); }
  await ev(() => { [...document.querySelectorAll('[data-na-item]')].find(x => x.textContent.includes('P-a')).querySelector('input[type=checkbox]').click(); });
  await page.waitForTimeout(200);
  let posts = await ev(() => window.__posts);
  step('ticking a reply row posts the fingerprinted snooze (scope drop) for exactly that row', posts.length >= 1 && posts[0].u === '/next-actions/dismiss' && posts[0].b.scope === 'drop' && posts[0].b.item.entity_id === 'a' && posts[0].b.item.kind === 'reply_due', JSON.stringify(posts[0]));
  await ev(() => { window.__posts.length = 0; window.__fail = true; STATE.nextActions = { items: [{ kind: 'reply_due', entity_type: 'contact', entity_id: 'z', title: 'P-z', reason: 'r', priority: 1, last_activity_at: new Date().toISOString() }], summary: { by_kind: {} } }; document.getElementById('content').innerHTML = renderNextActionsCard(); });
  await ev(() => { document.querySelector('[data-na-item] input[type=checkbox]').click(); });
  await page.waitForTimeout(250);
  const failed = await ev(() => { const c = document.querySelector('[data-na-item] input[type=checkbox]'); return { checked: c.checked, disabled: c.disabled }; });
  step('a failed tick un-ticks the box (the row is not silently lost)', failed.checked === false && failed.disabled === false, JSON.stringify(failed));
  // a reminder is DONE, not snoozed
  await ev((it) => { window.__posts.length = 0; window.__fail = false; window.reminderClosed = window.reminderClosed || function(){}; STATE.nextActions = { items: [it], summary: { by_kind: {} } }; document.getElementById('content').innerHTML = renderNextActionsCard(); }, NA('d', 'reminder_due', { reminder_id: 'r-d', last_activity_at: null }));
  await ev(() => { document.querySelector('[data-na-item] input[type=checkbox]').click(); });
  await page.waitForTimeout(200);
  posts = await ev(() => window.__posts);
  step('ticking a reminder marks it DONE (a real change), not snoozed', posts.length === 1 && posts[0].u === '/next-actions/r-d/done', JSON.stringify(posts));

  // ── Client conversations ──
  const CD = (i) => ({ kind: 'lead', id: 'L' + i, name: 'Job ' + i + ' · Co', owner_id: 'me', state: 'needs_reply', headline: 'h' + i, last_contact: '2026-09-2' + i, promises_due: 0, next_step: null, summary_line: null,
    complete: { kind: 'client_conversation', entity_type: 'lead', entity_id: 'L' + i, last_activity_at: '2026-09-2' + i, state: 'needs_reply' } });
  await ev((mine) => { window.__posts = []; window.__fail = false; STATE._cdAllMine = false; STATE.clientDigest = { enabled: true, mine, team: [], completed: 0 }; STATE.viewingUser = null; document.getElementById('content').innerHTML = renderClientDigest(); }, [1, 2, 3, 4, 5].map(CD));
  const cd = await ev(() => ({ rows: document.querySelectorAll('.cd-row').length, ticks: document.querySelectorAll('.cd-row input[type=checkbox]').length, text: document.getElementById('content').textContent }));
  step('Client conversations: only the top three rows, each with a checkbox, and a "See all 5" button', cd.rows === 3 && cd.ticks === 3 && /See all 5/.test(cd.text), JSON.stringify({ rows: cd.rows, ticks: cd.ticks }));
  await ev(() => { STATE._cdAllMine = true; document.getElementById('content').innerHTML = renderClientDigest(); });
  step('…See all shows five and offers to go back', await ev(() => document.querySelectorAll('.cd-row').length === 5 && /Show the top 3/.test(document.getElementById('content').textContent)));
  await ev(() => { STATE._cdAllMine = false; document.getElementById('content').innerHTML = renderClientDigest(); window.loadClientDigest = () => {}; document.querySelectorAll('.cd-row')[1].querySelector('input[type=checkbox]').click(); });
  await page.waitForTimeout(200);
  posts = await ev(() => window.__posts);
  step('ticking a conversation posts the SERVER\'s item (scope drop) — never one the browser built', posts.length === 1 && posts[0].u === '/next-actions/dismiss' && posts[0].b.scope === 'drop' && JSON.stringify(posts[0].b.item) === JSON.stringify({ kind: 'client_conversation', entity_type: 'lead', entity_id: 'L2', last_activity_at: '2026-09-22', state: 'needs_reply' }), JSON.stringify(posts[0]));
  await ev(() => { window.__posts.length = 0; window.__fail = true; document.getElementById('content').innerHTML = renderClientDigest(); document.querySelectorAll('.cd-row')[0].querySelector('input[type=checkbox]').click(); });
  await page.waitForTimeout(250);
  step('a failed tick on a conversation un-ticks the box', await ev(() => { const c = document.querySelector('.cd-row input[type=checkbox]'); return c.checked === false && c.disabled === false; }));
  step('No page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
