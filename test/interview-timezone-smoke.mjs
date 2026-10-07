// CHOOSE THE TIME ZONE WHILE SCHEDULING AN INTERVIEW (R-095, owner 2026-09-30).
// "Ability to choose time zone while scheduling interviews" … "All time zones. Our product should be used worldwide."
//   * the interview form has a Time zone picker BY CITY (type Dallas → Central Time, click), reaching EVERY zone, defaulting to the scheduler's own;
//   * the wall time typed is read in the zone picked: 10:00 in New York is 14:00Z in October (summer time),
//     15:00Z in November (winter time); 10:00 in Kolkata is 04:30Z;
//   * what is saved is that real instant, and the invite request carries the zone so the email says which clock;
//   * the server states the time in the zone with the zone spelled out (services/interview-time.js).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const it = require('../services/interview-time');
step('validZone accepts real zones and refuses nonsense', it.validZone('Asia/Kolkata') === 'Asia/Kolkata' && it.validZone('Mars/Olympus') === null && it.validZone('') === null && it.validZone(null) === null);
step('formatInterview: Tokyo is a day ahead of Los Angeles at the same instant', /Tuesday, October 6, 2026 at 6:00 AM Japan Standard Time/.test(it.formatInterview('2026-10-05T21:00:00Z', 'Asia/Tokyo')) && /Monday, October 5, 2026 at 2:00 PM Pacific Daylight Time/.test(it.formatInterview('2026-10-05T21:00:00Z', 'America/Los_Angeles')));
step('formatInterview: nothing recorded says "To be confirmed"', it.formatInterview(null, 'Asia/Tokyo') === 'To be confirmed');

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata' }); await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  const conv = (w, z) => ev(([w, z]) => ivZonedToInstant(w, z), [w, z]);
  step('10:00 in Kolkata is 04:30Z', await conv('2026-10-05T10:00', 'Asia/Kolkata') === '2026-10-05T04:30:00.000Z');
  step('10:00 in New York in October (summer time) is 14:00Z', await conv('2026-10-05T10:00', 'America/New_York') === '2026-10-05T14:00:00.000Z');
  step('10:00 in New York in November (winter time) is 15:00Z', await conv('2026-11-02T10:00', 'America/New_York') === '2026-11-02T15:00:00.000Z');
  step('10:00 in Auckland (ahead of UTC, southern summer) is 21:00Z the day before', await conv('2026-12-10T10:00', 'Pacific/Auckland') === '2026-12-09T21:00:00.000Z');
  step('a blank or unreadable time is null, never a wrong date', await conv('', 'Asia/Kolkata') === null && await conv('soon', 'UTC') === null);

  await ev(() => { STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = [{ id: 'job1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme' }];
    STATE.bd.submissions = [{ id: 's1', job_order_id: 'job1', stage: 'Submitted to Client', candidate: { id: 'c1', full_name: 'Sarah Chen' } }];
    window.__calls = []; window.apiPatch = (u, b) => { window.__calls.push({ m: 'PATCH', u, b }); return Promise.resolve({ id: 's1', stage: 'Interview Scheduled' }); };
    window.apiPost = (u, b) => { window.__calls.push({ m: 'POST', u, b }); return Promise.resolve({ sent: 1 }); };
    openStageModal('s1', 'Interview Scheduled', null); });
  // The picker is by CITY now (7 Oct, owner): type Dallas, get "Central Time" — never a list of zone codes to hunt through.
  const def = await ev(() => ({ zone: document.getElementById('stg-iv-tz').value, shown: document.getElementById('stg-iv-tzq').value, note: document.getElementById('stg-tz-note').textContent, select: !!document.querySelector('#stg-tzp select') }));
  step('the interview form asks for a CITY (a type-to-search box), not a long list of zone codes', !def.select && def.shown.indexOf('/') < 0, JSON.stringify(def));
  step('it defaults to the scheduler\'s own zone, named in words with its offset', /^Asia\/(Kolkata|Calcutta)$/.test(def.zone) && /India Standard Time/.test(def.shown) && /UTC\+05:30/.test(def.note), JSON.stringify(def));
  const find = (q, n) => ev(([q, n]) => ivTzSearch(q, n), [q, n]);
  const top = async (q) => { const r = await find(q, 8); return r[0] || null; };
  let r;
  r = await top('dallas'); step('"dallas" suggests Dallas, TX — Central Time', r && r.label === 'Dallas, TX' && r.zone === 'America/Chicago' && /Central/.test(r.name), JSON.stringify(r));
  r = await top('boca'); step('"boca" suggests Boca Raton — Eastern Time', r && /^Boca Raton/.test(r.label) && r.zone === 'America/New_York' && /Eastern/.test(r.name), JSON.stringify(r));
  r = await top('modesto'); step('"modesto" suggests Modesto — Pacific Time', r && /^Modesto/.test(r.label) && r.zone === 'America/Los_Angeles' && /Pacific/.test(r.name), JSON.stringify(r));
  r = await top('bangalore'); step('"bangalore" finds Bengaluru — India Standard Time', r && /^Bengaluru/.test(r.label) && r.zone === 'Asia/Kolkata' && /India/.test(r.name), JSON.stringify(r));
  r = await top('texas'); step('a state works: "texas" → Central Time', r && r.zone === 'America/Chicago', JSON.stringify(r));
  r = await top('est'); step('an everyday zone name works: "est" → Eastern Time', r && r.zone === 'America/New_York', JSON.stringify(r));
  r = await top('auckland'); step('a city only the browser\'s zone list knows still works: "auckland" → Pacific/Auckland', r && r.zone === 'Pacific/Auckland', JSON.stringify(r));
  step('nonsense suggests nothing (and the box says so) rather than guessing', (await find('qzxvk', 8)).length === 0);
  const reach = await ev(() => { const miss = []; Intl.supportedValuesOf('timeZone').forEach(id => { const parts = id.split('/'), city = parts[parts.length - 1].replace(/_/g, ' '); if (!ivTzSearch(city, 80).some(x => x.zone === id)) miss.push(id); }); return { n: Intl.supportedValuesOf('timeZone').length, miss }; });
  step('EVERY zone the browser knows is still reachable by its city name (worldwide is not narrowed)', reach.n > 300 && reach.miss.length === 0, JSON.stringify(reach.miss.slice(0, 8)));

  // the real box: type, see the list, click
  await page.click('#stg-iv-tzq'); await page.keyboard.press('Control+a'); await page.keyboard.type('dall');
  const list = await ev(() => ({ open: !document.getElementById('stg-tz-list').hidden, first: (document.querySelector('#stg-tz-list .tzp-opt') || {}).textContent || '' }));
  step('typing "dall" opens suggestions with the place, its zone name and offset', list.open && /Dallas, TX/.test(list.first) && /Central/.test(list.first) && /UTC-0[56]:00/.test(list.first), JSON.stringify(list));
  await page.click('#stg-tz-list .tzp-opt');
  const picked = await ev(() => ({ zone: document.getElementById('stg-iv-tz').value, shown: document.getElementById('stg-iv-tzq').value, note: document.getElementById('stg-tz-note').textContent, open: !document.getElementById('stg-tz-list').hidden }));
  step('clicking the suggestion sets the zone (hidden), shows the city, explains in words, closes the list', picked.zone === 'America/Chicago' && picked.shown === 'Dallas, TX' && /Central/.test(picked.note) && !picked.open, JSON.stringify(picked));
  await page.click('#stg-iv-tzq'); await page.keyboard.press('Control+a'); await page.keyboard.type('zzzz not a place'); await page.click('#stg-iv-at');
  await page.waitForTimeout(250);
  const back = await ev(() => ({ zone: document.getElementById('stg-iv-tz').value, shown: document.getElementById('stg-iv-tzq').value }));
  step('leaving the box with words that match nothing puts the chosen city back — the zone never silently changes', back.zone === 'America/Chicago' && back.shown === 'Dallas, TX', JSON.stringify(back));
  await page.click('#stg-iv-tzq'); await page.keyboard.press('Control+a'); await page.keyboard.type('new york'); await page.keyboard.press('Enter');
  step('the keyboard works too: type "new york", Enter → New York', await ev(() => document.getElementById('stg-iv-tz').value === 'America/New_York' && document.getElementById('stg-iv-tzq').value === 'New York, NY'));
  await ev(() => { document.getElementById('stg-iv-at').value = '2026-10-05T10:00';
    document.getElementById('stg-note').value = 'Scheduled'; document.getElementById('stg-iv-notify-cand').checked = true; stgApply(); });
  await page.waitForTimeout(300);
  const calls = await ev(() => window.__calls);
  const patch = calls.find(c => c.m === 'PATCH'), inv = calls.find(c => /interview-invite/.test(c.u || ''));
  step('what is saved is the real instant: 10:00 picked in New York = 14:00Z (the browser is in Kolkata)', !!patch && patch.b.interview_at === '2026-10-05T14:00:00.000Z', JSON.stringify(patch && patch.b.interview_at));
  step('the invite request carries the zone so the email can say which clock', !!inv && inv.b.interview_tz === 'America/New_York', JSON.stringify(inv && inv.b));
  step('No page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
