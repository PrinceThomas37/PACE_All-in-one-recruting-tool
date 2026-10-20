// THE OWNER'S 19 OCT SCREEN NOTES, IN A REAL BROWSER (R-279, R-280, R-281, R-283). Each step is one sentence of theirs:
//   R-279 "Even if I clicked on today the leads number don't change above"  → the Leads strip follows the filters (not the stage buttons)
//   R-280 "choose how many leads the user can see on their page, 10, 20, 50" → a per-person picker, saved to the account
//   R-281 "Remove these recently dismissed after 7 days"                     → Reminders lists only the last 7 days' dismissals
//   R-283 "A fresh manager sees the things that are not relevant for him"   → a sales manager with no sequence sees only "Finish your setup"
// SHOTS=dir saves a picture of each for the owner.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
function findChromium() { const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-19T15:00:00Z'));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  // The server, as these screens see it: every call recorded; /my-setup/sync answers what the test sets.
  await page.evaluate(() => {
    window.__calls = []; window.__owed = ['mailbox', 'sequence'];
    window.apiFetch = (m, p, b) => { __calls.push([m, p, b]);
      if (p === '/my-setup/sync') return Promise.resolve({ owed: __owed });
      return Promise.resolve(m === 'GET' ? [] : {}); };
  });

  // ── R-279 + R-280: the Leads page ──
  await page.evaluate(() => {
    const day = (n) => new Date(Date.UTC(2026, 9, 19 - n, 12)).toISOString();
    const stages = ['Assigned', 'Assigned', 'Connected', 'Rejected', 'In Discussion'];
    STATE.jobs = []; STATE.contacts = [];
    for (let i = 0; i < 60; i++) STATE.jobs.push({ id: 'j' + i, position: 'Role ' + i, company_name: 'Co ' + i, stage: stages[i % 5], created_at: day(i < 7 ? 0 : 3 + (i % 9)), assigned_to_bd: 'x', assigned_bd_name: 'BD One' });
    STATE.jobsFilter = { search: '', stages: [], industries: [], dateRange: 'all', dateFrom: '', dateTo: '', assignee: '' };
    STATE.leadsPage = 0; STATE.leadsPageSize = 20; STATE.page = 'leads'; render();
  });
  await page.waitForTimeout(300);
  const strip = () => page.evaluate(() => { const el = [...document.querySelectorAll('#content *')].find(x => x.children.length === 0 && /^\s*Total leads\s*$/.test(x.textContent)); const box = el && el.parentElement; return box ? box.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const rows = () => page.evaluate(() => document.querySelectorAll('#content table tbody tr').length);
  const allStrip = await strip();
  step('R-279: with no filter the strip counts every lead (60)', /^60(?!\d)/.test(allStrip), allStrip);
  await page.evaluate(() => { STATE.jobsFilter.dateRange = 'today'; STATE.leadsPage = 0; render(); });
  await page.waitForTimeout(200);
  const todayStrip = await strip();
  step('R-279: clicking "Today" changes the numbers on top to today\'s leads (7)', /^7(?!\d)/.test(todayStrip), todayStrip);
  const stageCounts = await page.evaluate(() => document.querySelector('#content').textContent.match(/(\d+)\s*Assigned/));
  step('R-279: …the stage numbers follow too (4 of today\'s 7 are Assigned)', stageCounts && stageCounts[1] === '4', stageCounts && stageCounts[0]);
  await page.evaluate(() => { STATE.jobsFilter.stages = ['Connected']; render(); });
  await page.waitForTimeout(200);
  const stageStrip = await strip();
  step('R-279: clicking a STAGE does not zero the strip — it still shows today\'s 7 (the stage buttons are the strip)', /^7(?!\d)/.test(stageStrip), stageStrip);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'r279-leads-today.png') });
  await page.evaluate(() => { STATE.jobsFilter.stages = []; STATE.jobsFilter.dateRange = 'all'; render(); });
  await page.waitForTimeout(200);
  step('R-280: 20 leads a page by default', await rows() === 20, String(await rows()));
  const picker = await page.evaluate(() => { const s = document.getElementById('leads-per-page'); return s ? [...s.options].map(o => o.value).join(',') : ''; });
  step('R-280: a "Show N per page" picker offers 10, 20 and 50', picker === '10,20,50', picker);
  await page.selectOption('#leads-per-page', '50'); await page.waitForTimeout(250);
  step('R-280: choosing 50 shows 50 rows', await rows() === 50, String(await rows()));
  const saved = await page.evaluate(() => __calls.find(c => c[1] === '/me/preferences' && c[0] === 'PUT'));
  step('R-280: …and it is saved to the PERSON (their preferences), not just this browser', saved && saved[2] && saved[2].leads_per_page === 50, JSON.stringify(saved));
  await page.selectOption('#leads-per-page', '10'); await page.waitForTimeout(250);
  step('R-280: choosing 10 shows 10', await rows() === 10, String(await rows()));
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.screenshot({ path: path.join(SHOTS, 'r280-per-page.png') }); }

  // ── R-281: Reminders ──
  await page.evaluate(() => {
    const ago = (d) => new Date(Date.UTC(2026, 9, 19, 12) - d * 864e5).toISOString();
    STATE.reminders = [
      { id: 'r1', user_id: STATE.user.id, contact_name: 'Dismissed yesterday', company_name: 'A', return_date: '2026-10-18', status: 'sent', updated_at: ago(1) },
      { id: 'r2', user_id: STATE.user.id, contact_name: 'Dismissed 6 days ago', company_name: 'B', return_date: '2026-10-12', status: 'sent', updated_at: ago(6) },
      { id: 'r3', user_id: STATE.user.id, contact_name: 'Dismissed 9 days ago', company_name: 'C', return_date: '2026-10-08', status: 'sent', updated_at: ago(9) },
      { id: 'r4', user_id: STATE.user.id, contact_name: 'Dismissed 30 days ago', company_name: 'D', return_date: '2026-09-15', status: 'sent', updated_at: ago(30) },
      { id: 'r5', user_id: STATE.user.id, contact_name: 'Still to do', company_name: 'E', return_date: '2026-10-25', status: 'pending', updated_at: ago(2) },
    ];
    STATE.page = 'reminders'; render();
  });
  await page.waitForTimeout(250);
  const remTxt = await page.evaluate(() => document.querySelector('#content').textContent);
  step('R-281: "Recently dismissed" lists only the last 7 days (2 of 4)', /Recently dismissed \(2\)/.test(remTxt) && /Dismissed yesterday/.test(remTxt) && /Dismissed 6 days ago/.test(remTxt), (remTxt.match(/Recently dismissed \(\d+\)/) || [''])[0]);
  step('R-281: …older ones are gone from the list (not deleted — just not shown)', !/Dismissed 9 days ago/.test(remTxt) && !/Dismissed 30 days ago/.test(remTxt));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'r281-reminders.png') });

  // ── R-283: a fresh sales manager's Today ──
  await switchRole(page, 'bd');
  await page.evaluate(() => { STATE.setupOwed = undefined; STATE.page = 'dashboard'; render(); });
  await page.waitForTimeout(400);
  const fresh = await page.evaluate(() => ({ card: !!document.querySelector('[data-setup-card]'), txt: document.querySelector('#content').textContent }));
  step('R-283: a BD Manager who has not written a sequence sees "Finish your setup" with both steps', fresh.card && /Finish your setup/.test(fresh.txt) && /Connect your outreach mailbox/.test(fresh.txt) && /Write your first sequence/.test(fresh.txt), fresh.txt.slice(0, 200));
  step('R-283: …and NO recruiting tiles (Jobs / Awaiting approval / Placements / Upcoming interviews / To BDM)', !/Awaiting approval|Upcoming interviews|To BDM this week|Placements/.test(fresh.txt));
  step('R-283: …the answer came from the server (/my-setup/sync), not a guess in the browser', await page.evaluate(() => __calls.some(c => c[1] === '/my-setup/sync')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'r283-fresh-manager-today.png') });
  await page.evaluate(() => { document.querySelector('[data-setup-card] .btn-primary').click(); });
  await page.waitForTimeout(250);
  step('R-283: "Open My Setup" goes to My Setup', await page.evaluate(() => STATE.page === 'mysetup'));
  await page.evaluate(() => { __owed = ['mailbox']; STATE.setupOwed = undefined; STATE.page = 'dashboard'; render(); });
  await page.waitForTimeout(400);
  const done = await page.evaluate(() => ({ card: !!document.querySelector('[data-setup-card]'), txt: document.querySelector('#content').textContent }));
  step('R-283: once the sequence is written the ordinary Today comes back', !done.card && /Needs you/i.test(done.txt), done.txt.slice(0, 160));
  await switchRole(page, 'admin');
  await page.evaluate(() => { __owed = ['mailbox', 'sequence']; STATE.setupOwed = undefined; STATE.page = 'dashboard'; render(); });
  await page.waitForTimeout(400);
  step('R-283: an admin is never held on the setup card (they run the organisation from day one)', await page.evaluate(() => !document.querySelector('[data-setup-card]')));

  step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
