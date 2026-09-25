// SENDING HOURS (R-055). The owner changed the send time in Admin and nothing
// else changed: the box saved a value nothing read, and the hours every screen
// quotes came from two keys nothing wrote. Now there is ONE pair of values.
//   1. the send loop's reader (index.js getSendWindowHours) returns what an
//      admin saved — run for real, not grepped;
//   2. a start that is not before the end is refused, never stored, and the
//      reader never shuts sending even if one is somehow stored;
//   3. the popup: no dead "Outreach send time", no unsaved Timezone picker;
//      it shows the saved hours, saves them, and the "Send window" line every
//      user sees re-reads (real browser, stub API).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── an in-memory app_settings ──────────────────────────────────────────────
let rows = {};
const supabase = {
  from: () => {
    const st = { key: null };
    const api = {
      select() { return api; },
      eq(k, v) { st.key = v; return api; },
      async maybeSingle() { return { data: st.key in rows ? { value: rows[st.key] } : null }; },
      async upsert(list) { (Array.isArray(list) ? list : [list]).forEach(r => { rows[r.key] = r.value; }); return { error: null }; },
    };
    return api;
  },
};
const freshSettings = () => { delete require.cache[require.resolve('../config/settings.js')]; return require('../config/settings.js'); };

// 1. The reader, lifted out of index.js and RUN.
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const m = src.match(/async function getSendWindowHours\(\) \{[\s\S]*?\n\}\n/);
step('index.js still defines getSendWindowHours', !!m);
const makeReader = (settingsConfig) => new Function('supabase', 'settingsConfig', m[0] + '\nreturn getSendWindowHours;')(supabase, settingsConfig);

rows = {};
let reader = makeReader(freshSettings());
let w = await reader();
step('nothing saved → 8:00-16:00 (unchanged behaviour)', w.start === 8 && w.end === 16, JSON.stringify(w));

const s1 = freshSettings();
await s1.setSettings(supabase, { send_window_start_hour: 9, send_window_end_hour: 18 });
reader = makeReader(s1);
w = await reader();
step('what an admin saves is what the send loop obeys', w.start === 9 && w.end === 18, JSON.stringify(w));

rows = { sys_send_window_start_hour: '17', sys_send_window_end_hour: '9' };
reader = makeReader(freshSettings());
w = await reader();
step('a stored start after the end never shuts sending (falls back to 8-16)', w.start === 8 && w.end === 16, JSON.stringify(w));

// 2. The route refuses a backwards pair.
{
  rows = {};
  delete require.cache[require.resolve('../routes/settings.js')];
  freshSettings();
  const router = require('../routes/settings.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => r === 'admin' });
  const h = router.stack.find(l => l.route && l.route.path === '/admin/settings/numbers' && l.route.methods.post).route.stack.slice(-1)[0].handle;
  const call = async (values) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } }; await h({ body: { values }, user: { id: 'a' } }, res); return { status, out }; };
  let r = await call({ send_window_start_hour: 18, send_window_end_hour: 9 });
  step('saving a start after the end is refused, in words', r.status === 400 && /earlier than the stop/.test(r.out.error) && !('sys_send_window_start_hour' in rows));
  r = await call({ send_window_start_hour: 9 });   // end stays at default 16
  step('changing only the start is checked against the saved end', r.status === 200 && rows.sys_send_window_start_hour === '9');
  r = await call({ send_window_end_hour: 9 });
  step('…and only the end against the saved start', r.status === 400 && rows.sys_send_window_end_hour === undefined);
}

// 3. The popup, in a browser.
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const API = 'https://fute-lms-backend.onrender.com';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
let win = { start: 8, end: 16 };
const posts = [];
const pad = (h) => (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
async function api(route) {
  const u = new URL(route.request().url()), p = u.pathname, meth = route.request().method();
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (meth === 'GET' && p === '/admin/settings/numbers') return json([{ key: 'send_window_start_hour', value: win.start }, { key: 'send_window_end_hour', value: win.end }]);
  if (meth === 'POST' && p === '/admin/settings/numbers') { const v = JSON.parse(route.request().postData()).values; posts.push(v); win = { start: v.send_window_start_hour, end: v.send_window_end_hour }; return json({ success: true }); }
  if (meth === 'POST' && p === '/app-settings') { posts.push(JSON.parse(route.request().postData())); return json({ success: true }); }
  if (meth === 'GET' && p === '/emails/pending-summary') return json({ total_pending: 5, ready_now: 0, waiting_window: 5, send_window: win, send_window_label: pad(win.start) + ' – ' + pad(win.end) + ' lead local time', by_timezone: [] });
  return json(meth === 'GET' ? [] : {});
}
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('**', r => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (u.startsWith(API)) return api(r); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'admin');
  win = { start: 7, end: 15 };
  await page.evaluate(() => openEmailEngineModal()); await page.waitForTimeout(400);
  const modal = () => page.evaluate(() => { const m = document.querySelector('#layer .modal'); return m ? m.innerText : ''; });
  let t = await modal();
  step('popup: the dead "Outreach send time" box is gone', t && !/Outreach send time/i.test(t), t.slice(0, 80));
  step('popup: the unsaved Timezone picker is gone', !(await page.$('#engine-tz')));
  step('popup: it says the hours are in each lead\'s own time zone', /lead's own time zone/.test(t));
  const vals = await page.evaluate(() => [document.getElementById('engine-win-start').value, document.getElementById('engine-win-end').value]);
  step('popup: it shows the SAVED hours (7-15), not a hard-coded 8', vals[0] === '7' && vals[1] === '15', vals.join('-'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '31-engine-schedule.png') });
  await page.selectOption('#engine-win-start', '15'); await page.selectOption('#engine-win-end', '9');
  await page.evaluate(() => saveAdminSendTimes()); await page.waitForTimeout(300);
  step('popup: a backwards pair is refused before anything is sent', !posts.some(x => 'send_window_start_hour' in x));
  await page.selectOption('#engine-win-start', '9'); await page.selectOption('#engine-win-end', '17');
  await page.evaluate(() => saveAdminSendTimes()); await page.waitForTimeout(600);
  step('popup: saving writes the hours to the one setting', posts.some(x => x.send_window_start_hour === 9 && x.send_window_end_hour === 17));
  const lbl = await page.evaluate(() => STATE.pendingSummary && STATE.pendingSummary.send_window_label);
  step('after saving, the "Send window" line everyone reads says the new hours', /9:00 AM – 5:00 PM/.test(lbl || ''), lbl);
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) { step('browser part ran', false, e && e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
