// THE SEQUENCES LIST: "N people in it now", Stop all, Delete, Recently deleted — and no "Enrolled leads" list (R-384, R-385; D-0216).
// Owner, 4–5 Nov: remove the Enrolled-leads list (its per-person Pause / Exit / History go away); each sequence says how many people are in
// it now with a Stop all that ASKS first and names the number; Delete asks first, says how many it stops and for how many days it can come
// back; a deleted sequence sits under "Recently deleted" with a Restore. Real clicks in a real browser; the server answers are faked.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
const results = []; const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const calls = [];
async function api(route) {
  const u = new URL(route.request().url()), p = u.pathname, m = route.request().method();
  calls.push(m + ' ' + p);
  const j = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (m === 'POST' && /\/stop-all$/.test(p)) return j({ stopped: 3 });
  if (m === 'POST' && /\/delete$/.test(p)) return j({ deleted: true, stopped: 3, restorable_days: 14 });
  if (m === 'POST' && /\/restore$/.test(p)) return j({ id: 'G1', status: 'archived' });
  if (p === '/wf/limits') return j({ versions_max: 20, undo_days: 14 });
  return j(m === 'GET' ? [] : {});
}
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => { const u = r.request().url(); return u.startsWith(BASE) ? r.continue() : u.startsWith(API) ? api(r) : r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (fn, a) => page.evaluate(fn, a);
  const seed = () => ev(() => {
    const me = STATE.user.id, st = (n) => Array.from({ length: n }, (_, i) => ({ step_order: i + 1, channel: 'email', delay_days: i ? 3 : 0, config: { subject: 's', body: 'b' } }));
    STATE.wf = { defs: [
        { id: 'S1', name: 'Estimators Ohio', status: 'active', entity_type: 'contact', created_by: me, steps: st(3), people_now: 3 },
        { id: 'S2', name: 'Quiet one', status: 'active', entity_type: 'contact', created_by: me, steps: st(2), people_now: 0 } ],
      enrollments: [{ id: 'e1', workflow_id: 'S1', status: 'active', current_step_order: 1, entity_id: 'abcdefgh12', contact: { first_name: 'Pat', last_name: 'Doe' } }],
      stats: { by_workflow: { S1: { active: 3, completed: 4 } } }, channels: ['email'], catalogue: [], undoDays: 14, versionsMax: 20,
      deleted: [{ id: 'G1', name: 'Old plan', deleted_at: new Date().toISOString(), restorable_until: new Date(Date.now() + 5 * 86400000).toISOString() }] };
    STATE.page = 'email'; STATE.emailTab = 'sequence'; STATE.seqView = undefined; render();
  });
  const text = () => ev(() => document.getElementById('content').innerText);
  await seed(); await page.waitForTimeout(600);
  let t = await text();
  step('a sequence with people says so: "3 people in it now" — one with nobody says "nobody in it now"', /3 people in it now/.test(t) && /nobody in it now/.test(t), t.slice(0, 0));
  step('there is NO "Enrolled leads" list any more, and no per-person Pause / Exit / History', !/Enrolled leads/.test(t) && !/Pat Doe/.test(t) && !(await ev(() => /wfEnrollmentAction|wfToggleRuns/.test(document.getElementById('content').innerHTML))));
  const btns = await ev(() => ({ stop: [...document.querySelectorAll('[data-wfcard] [data-wf-stopall]')].map(b => b.closest('[data-wfcard]').dataset.wfcard), del: [...document.querySelectorAll('[data-wfcard] [data-wf-delete]')].map(b => b.closest('[data-wfcard]').dataset.wfcard) }));
  step('Stop all appears only where someone is inside (S1, not S2); Delete appears on both', JSON.stringify(btns.stop) === '["S1"]' && btns.del.length === 2, JSON.stringify(btns));

  // Stop all: asks first, names the number, can be cancelled without anything happening
  calls.length = 0;
  await page.click('[data-wfcard="S1"] [data-wf-stopall]'); await page.waitForTimeout(300);
  const ask = await ev(() => document.querySelector('[data-wf-confirm]') ? document.querySelector('[data-wf-confirm]').innerText : '');
  step('Stop all ASKS first, names the number (3), and says queued emails still go out', /Stop everyone in/.test(ask) && /3 people/.test(ask) && /already waiting to go still go out/.test(ask) && /Stop all 3/.test(ask), ask.replace(/\s+/g, ' ').slice(0, 200));
  await page.click('[data-wf-confirm] .btn-outline'); await page.waitForTimeout(300);
  step('Cancel does nothing — no call was made and the sequence is untouched', !calls.some(c => /stop-all/.test(c)) && !(await ev(() => !!document.querySelector('[data-wf-confirm]'))));
  await page.click('[data-wfcard="S1"] [data-wf-stopall]'); await page.waitForTimeout(200);
  await page.click('[data-wf-confirm-go]'); await page.waitForTimeout(500);
  step('confirming calls the server to stop S1 (and only then)', calls.includes('POST /wf/definitions/S1/stop-all'), JSON.stringify(calls.filter(c => c.startsWith('POST'))));

  // Delete
  await seed(); await page.waitForTimeout(400); calls.length = 0;
  await page.click('[data-wfcard="S1"] [data-wf-delete]'); await page.waitForTimeout(300);
  const dask = await ev(() => document.querySelector('[data-wf-confirm]').innerText);
  step('Delete ASKS first: how many it stops (3), that nothing is erased, and for how many days it can come back (14)', /Delete/.test(dask) && /3 people/.test(dask) && /14 days/.test(dask) && /stay as they are/.test(dask), dask.replace(/\s+/g, ' ').slice(0, 220));
  await page.click('[data-wf-confirm] .btn-outline'); await page.waitForTimeout(200);
  step('…and cancelling it deletes nothing', !calls.some(c => /\/delete$/.test(c)));
  await page.click('[data-wfcard="S1"] [data-wf-delete]'); await page.waitForTimeout(200);
  await page.click('[data-wf-confirm-go]'); await page.waitForTimeout(500);
  step('confirming calls the server to delete S1', calls.includes('POST /wf/definitions/S1/delete'), JSON.stringify(calls.filter(c => c.startsWith('POST'))));
  await page.click('[data-wfcard="S2"] [data-wf-delete]').catch(() => {});
  // a sequence nobody is in: the wording says so
  await seed(); await page.waitForTimeout(300);
  await page.click('[data-wfcard="S2"] [data-wf-delete]'); await page.waitForTimeout(300);
  step('deleting a sequence nobody is in says "Nobody is in it now"', /Nobody is in it now/.test(await ev(() => document.querySelector('[data-wf-confirm]').innerText)));
  await ev(() => closeModal());

  // Recently deleted
  await seed(); await page.waitForTimeout(300);
  t = await text();
  step('"Recently deleted" lists the deleted sequence with its deadline and a Restore button', /Recently deleted \(1\)/i.test(t) && /Old plan/.test(t) && /brought back until/.test(t) && await ev(() => !!document.querySelector('[data-wfgone="G1"] [data-wf-restore]')));
  calls.length = 0;
  await page.click('[data-wfgone="G1"] [data-wf-restore]'); await page.waitForTimeout(500);
  step('Restore calls the server to restore it', calls.includes('POST /wf/definitions/G1/restore'));
} catch (e) {
  step('run crashed — ' + String(e.message || e).split('\n')[0], false);
} finally { if (browser) await browser.close(); server.close(); }
step('No page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
