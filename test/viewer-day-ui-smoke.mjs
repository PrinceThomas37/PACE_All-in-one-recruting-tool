// THE SCREENS USE THE VIEWER'S OWN DAY, AND THE RA DASHBOARD DRAWS THE SERVER'S NUMBERS (R-103, R-106; D-0065).
//   R-103  todayIST() used to be India's date (device time + 5.5 h) for everyone, so a US recruiter's reminders turned
//          "due" ~10 h early. It is now the device's own calendar day — and the server is told the zone (withTz).
//   R-106  the individual (RA) dashboard added up whatever jobs the page held; every figure now comes from the one
//          server calculation (GET /insights/ra/:id → periods), cut at the viewer's midnight.
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
const FIXED = Date.UTC(2026, 9, 1, 19, 0, 0);   // 1 Oct 19:00 UTC = 12:00 Los Angeles = 00:30 on 2 Oct in Kolkata
let browser; const errs = [];
async function enter(tz) {
  const ctx = await browser.newContext({ timezoneId: tz }); await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'ra');
  return page;
}
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const pin = (page) => page.evaluate((t) => { const R = Date; window.__R = R; window.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } }; }, FIXED);
  const la = await enter('America/Los_Angeles'); await pin(la);
  const ist = await enter('Asia/Kolkata'); await pin(ist);
  const t1 = await la.evaluate(() => todayIST()), t2 = await ist.evaluate(() => todayIST());
  step('Los Angeles at noon on 1 Oct: today is 1 Oct (it used to say 2 Oct — India\'s date)', t1 === '2026-10-01', t1);
  step('Kolkata (already 2 Oct): today is 2 Oct — each person\'s own day', t2 === '2026-10-02', t2);
  step('a plain date is a day already; a timestamp is read in the viewer\'s zone', await la.evaluate(() => localDayKey('2026-10-05') === '2026-10-05' && localDayKey('2026-10-02T03:00:00Z') === '2026-10-01'));
  step('the server is told the zone (withTz), joined correctly to a path with or without a query', await la.evaluate(() => withTz('/x') === '/x?tz=America%2FLos_Angeles' && withTz('/x?a=1') === '/x?a=1&tz=America%2FLos_Angeles'));

  // R-106: the RA dashboard draws the server's numbers
  const seen = [];
  await la.evaluate(() => { window.__gets = []; window.apiGet = (u) => { window.__gets.push(u);
    if (/^\/insights\/ra\//.test(u)) return Promise.resolve({ periods: {
      daily: { total: 3, dups: 1, converted: 1, convRate: 33, by_stage: { Assigned: 2, Connected: 1 }, by_industry: { Healthcare: 3 } },
      weekly: { total: 21, dups: 2, converted: 7, convRate: 33, by_stage: { Assigned: 14, Connected: 7 }, by_industry: { Healthcare: 12, Energy: 9 } },
      monthly: { total: 88, dups: 5, converted: 30, convRate: 34, by_stage: { Assigned: 58, Connected: 30 }, by_industry: { Energy: 88 } },
      quarterly: { total: 240, dups: 9, converted: 80, convRate: 33, by_stage: { Assigned: 160, Connected: 80 }, by_industry: { Energy: 240 } } } });
    return Promise.resolve([]); };
    // the browser holds jobs that CONTRADICT the server — the card must not add these up
    STATE.jobs = [{ id: 'j1', created_by: STATE.user.id, stage: 'Rejected', created_date: new Date().toISOString().slice(0, 10), industry: 'Mining' }];
    STATE._raDash = null; STATE.period = 'weekly'; });
  const card = async () => la.evaluate(() => { STATE.viewingUser = null; const h = document.createElement('div'); h.innerHTML = renderIndividualDashboard(STATE.user); return { vals: [...h.querySelectorAll('.bstat-val')].map(x => x.textContent), text: h.textContent }; });
  let c = await card();
  step('before the server answers the figures say "…", never a number the browser made up', JSON.stringify(c.vals) === '["…","…","…%","…"]' || c.vals.every(v => /…/.test(v)), JSON.stringify(c.vals));
  await la.waitForTimeout(250);
  c = await card();
  step('weekly: the banner shows the SERVER\'s 21 leads, 7 connected, 33%, 2 duplicates', JSON.stringify(c.vals) === '["21","7","33%","2"]', JSON.stringify(c.vals));
  step('…the industry bars and stage pills are the server\'s too (Healthcare/Energy; 14 Assigned)', /Healthcare/.test(c.text) && /Energy/.test(c.text) && !/Mining/.test(c.text) && /14/.test(c.text));
  await la.evaluate(() => { STATE.period = 'quarterly'; }); c = await card();
  step('switching the period reads another cut of the same server calculation (quarterly: 240)', c.vals[0] === '240', JSON.stringify(c.vals));
  const gets = await la.evaluate(() => window.__gets.filter(u => /^\/insights\/ra\//.test(u)));
  step('it asked the server once, with the viewer\'s zone', gets.length >= 1 && gets.every(u => /tz=America%2FLos_Angeles/.test(u)) && gets.length === 1, JSON.stringify(gets));
  await la.evaluate(() => { window.apiGet = () => Promise.reject(new Error('down')); STATE._raDash = null; STATE.period = 'weekly'; });
  await card(); await la.waitForTimeout(250); c = await card();
  step('if the server cannot answer the card says so with dashes — it does not invent numbers', c.vals.every(v => /—/.test(v)), JSON.stringify(c.vals));
  step('No page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
