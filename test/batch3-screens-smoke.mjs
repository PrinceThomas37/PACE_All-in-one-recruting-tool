// BATCH 3 SCREENS IN A REAL BROWSER (owner, 19 Oct):
//   R-278 / D-0160 — Today for a sales manager "as drawn" (https://claude.ai/artifact/DF9nDByMp9grLCrBT2ggCo): four numbers that
//         ask for action, ONE "Needs you" list with filter chips, today's schedule, the pipeline as counts that open their pages,
//         and "Your team today" with only the people who need a nudge. No charts on Today.
//   R-278 — Outreach Insights (personal) = sequence analytics: five numbers said once, one line chart (emailed / opened /
//         replied) by day or by week, a row per sequence. The numbers are the server's own (services/outreach-insights.js).
//   R-275 — the candidate drawer opened from a job shows THAT job beside the person (description and client), and hides it.
// SHOTS=dir saves a picture of each.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const oi = require('../services/outreach-insights.js');

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 300) : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }

// The insights answer, made by the real counting code from a small set of sends (19 Sep – 19 Oct 2026).
const leadSends = [], tracking = [], contacts = {};
for (let i = 0; i < 40; i++) {
  const day = '2026-10-' + String(1 + (i % 18)).padStart(2, '0');
  leadSends.push({ id: 'e' + i, day, contact_id: 'c' + (i % 25), seq: i % 3 === 0 ? 'wf-ohio' : null });
  tracking.push({ email_id: 'e' + i, open_count: i % 3 === 1 ? 1 : 0 });
}
for (let c = 0; c < 25; c++) contacts['c' + c] = { email_status: c === 7 ? 'invalid' : 'valid', replied_day: c % 6 === 0 ? '2026-10-15' : null, stage: c === 0 ? 'Connected' : 'Assigned' };
const insight = (bucket) => Object.assign(oi.summarise({ from: '2026-09-19', to: '2026-10-19', bucket, leadSends, tracking, contacts, candSends: [], seqNames: { 'wf-ohio': 'Accountants — Ohio' }, only: 'all' }),
  { choices: [{ id: 'all', name: 'All sequences' }, { id: 'outreach', name: 'Your outreach' }, { id: 'wf-ohio', name: 'Accountants — Ohio' }] });

const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-19T14:00:00'));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(([day, week]) => {
    const me = STATE.user.id;
    window.__asked = [];
    const today = '2026-10-19';
    const NA = { items: [
      { kind: 'reply_due', entity_type: 'contact', entity_id: 'c1', title: 'Marimar Santos', subtitle: 'Treplar', email: 'm@treplar.test', job_id: 'job-1', reason: "They replied this morning. You haven't replied.", priority: 90, owner_id: me },
      { kind: 'reminder_due', entity_type: 'contact', entity_id: 'c2', reminder_id: 'r1', title: 'Dana Fox', subtitle: 'Acme', job_id: 'job-2', reason: 'Call Dana about the Dallas role', priority: 50, owner_id: me },
      { kind: 'nudge', entity_type: 'lead', entity_id: 'job-3', title: 'Pinpoint Engineering', subtitle: '30 people', job_id: 'job-3', reason: 'You have emailed 30 people here and nobody has replied.', priority: 30, owner_id: me },
    ], summary: {}, team: null, snoozed: 0, overflow: 0 };
    const CD = { enabled: true, scope: 'team', mine: [{ kind: 'lead', id: 'job-9', name: 'Site Engineer · Tri-Tek', state: 'needs_reply', headline: 'Ray wrote yesterday. You have not answered.', last_contact: '2026-10-18', promises_due: 0 }],
      team: [{ owner_id: 'u-raj', owner_name: 'Raj Patel', waiting: 2, promises_due: 0, items: [] }] };
    const answers = {
      '/recruiting-dashboard': { by_stage: { 'Submitted to Client': 3, 'Interview Scheduled': 2, Offer: 1 }, jobs: { total: 7 }, upcoming_interviews: [{ interview_at: today + 'T15:00:00', candidate: 'Patrick Stoneberger', interview_location: 'Teams' }] },
      '/insights/bd/': { emails_sent_today: 42, emails_pending: 18, total_today: 5, by_stage: { Assigned: 12, Connected: 4, 'In Discussion': 2 } },
      '/leads/assign/mailboxes': { mailboxes: [{ limit: 60 }, { limit: 40 }] },
      '/insights/bd-team': { people: [{ id: 'u-raj', name: 'Raj Patel', emails_sent_today: 0 }, { id: 'u-asha', name: 'Asha Rao', emails_sent_today: 25 }] },
      '/next-actions': NA, '/client-intel/digest': CD,
    };
    window.apiGet = function (p) {
      __asked.push(p);
      if (/^\/insights\/outreach/.test(p)) return Promise.resolve(/bucket=week/.test(p) ? week : day);
      const k = Object.keys(answers).find(k => p.indexOf(k) === 0);
      return Promise.resolve(k ? JSON.parse(JSON.stringify(answers[k])) : []);
    };
    STATE.nextActions = NA; STATE.clientDigest = CD;
    // a manager with a team (Raj and Asha report to them), and nothing remembered from the sign-in's own loads
    STATE.users = (STATE.users || []).filter(x => x.id !== 'u-raj' && x.id !== 'u-asha').concat([
      { id: 'u-raj', name: 'Raj Patel', role: 'bd', roles: ['bd'], managerId: me }, { id: 'u-asha', name: 'Asha Rao', role: 'bd', roles: ['bd'], managerId: me }]);
    STATE.todayNums = null; STATE._recDash = null; STATE._recDashLoading = false;
    STATE.reminders = [{ id: 'r1', user_id: me, status: 'pending', return_date: today, reminder_time: '11:30', contact_name: 'Dana Fox', company_name: 'Acme' }];
    STATE.page = 'dashboard'; render();
  }, [insight('day'), insight('week')]);
  await page.waitForFunction(() => /42/.test((document.querySelector('[data-today-tiles]') || {}).textContent || '') && !!document.querySelector('[data-today-team]'), { timeout: 8000 });
  await page.waitForTimeout(200);

  // ── R-278: Today ──
  const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-today-tiles] .td-tile')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
  step('Today has four numbers that ask for action', tiles.length === 4, JSON.stringify(tiles));
  step('…replies waiting on you = the to-do list\'s replies plus your conversations waiting on you (2)', /^2 Replies waiting on you/.test(tiles[0]), tiles[0]);
  step('…emails out today against today\'s limit, and what is still to send', /^42 \/ 100 Emails out today 18 still to send/.test(tiles[1]), tiles[1]);
  step('…new leads today, and interviews today with the first one\'s time and name', /^5 New leads today/.test(tiles[2]) && /^1 Interview today 3:00 PM · Patrick Stoneberger/.test(tiles[3]), JSON.stringify(tiles.slice(2)));
  const needs = await page.evaluate(() => document.querySelector('[data-today-needs]').innerText);
  step('ONE "Needs you" list: the to-do list and your client conversations together', /Marimar Santos/.test(needs) && /Site Engineer · Tri-Tek/.test(needs) && /Pinpoint Engineering/.test(needs), needs.slice(0, 300));
  step('…with filter chips that count what is there', /All 4/.test(needs) && /Replies 2/.test(needs) && /Reminders 1/.test(needs), needs.slice(0, 120));
  await page.evaluate(() => window.todayFilter('replies'));
  const replies = await page.evaluate(() => document.querySelector('[data-today-needs]').innerText);
  step('…Replies narrows it to the replies', /Marimar Santos/.test(replies) && /Tri-Tek/.test(replies) && !/Pinpoint Engineering/.test(replies) && !/Dana Fox/.test(replies));
  await page.evaluate(() => window.todayFilter('all'));
  const side = await page.evaluate(() => document.querySelector('.td-side').innerText);
  step('today\'s schedule in time order: the reminder at 11:30, the interview at 3:00', /11:30 AM\s*Reminder — Dana Fox · Acme[\s\S]*3:00 PM\s*Interview — Patrick Stoneberger · Teams/.test(side), side.slice(0, 300));
  step('the pipeline as counts that open their pages (no charts)', /12 assigned/.test(side) && /4 connected/.test(side) && /7 open/.test(side) && /3 at client/.test(side) && /2 interviewing/.test(side) && /1 offers/.test(side) && /charts are in Reports/.test(side), side);
  const team = await page.evaluate(() => document.querySelector('[data-today-team]').innerText);
  step('"Your team today" lists only who needs a nudge, and why (Raj: 2 replies waiting, no emails out today)', /Raj Patel/.test(team) && /2 replies waiting on them; no emails out today/.test(team) && !/Asha Rao/.test(team), team);
  step('no charts on Today', await page.evaluate(() => !document.querySelector('#content canvas, #content svg.oi-chart')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b3-today.png'), fullPage: true });

  // ── R-278: Outreach Insights ──
  await page.evaluate(() => { STATE.page = 'bdinsights'; render(); });
  await page.waitForSelector('[data-oi-tiles] .oi-tile', { timeout: 8000 });
  await page.waitForFunction(() => !/—/.test(document.querySelector('[data-oi-tiles]').innerText.split('\n')[0]), { timeout: 8000 });
  const d = insight('day').totals;
  const oiTiles = await page.evaluate(() => [...document.querySelectorAll('[data-oi-tiles] .oi-tile')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
  step('five numbers, each said once: people emailed, opened, replied, interested, bounced', oiTiles.length === 5 && /People emailed/.test(oiTiles[0]) && /Opened/.test(oiTiles[1]) && /Replied/.test(oiTiles[2]) && /Interested/.test(oiTiles[3]) && /Bounced/.test(oiTiles[4]), JSON.stringify(oiTiles));
  step('…the numbers are the server\'s own counts', oiTiles[0].startsWith(String(d.people)) && oiTiles[1].startsWith(d.opened_rate + '%') && oiTiles[2].startsWith(d.replied_rate + '%') && oiTiles[3].startsWith(String(d.interested)), JSON.stringify([d, oiTiles]));
  const text = await page.evaluate(() => document.getElementById('content').innerText);
  step('the old repeated sections are gone (no "emails sent · 30 days", no funnel)', !/emails sent · 30 days/i.test(text) && !/funnel/i.test(text));
  step('one line chart with three lines: emailed, opened, replied', await page.evaluate(() => document.querySelectorAll('svg.oi-chart polyline').length === 3 && document.querySelectorAll('svg.oi-chart .oi-hit').length === 31));
  await page.evaluate(() => [...document.querySelectorAll('.oi-segb')].find(b => /Weekly/.test(b.textContent)).click());
  const weeks = insight('week').series.length;
  await page.waitForFunction((n) => document.querySelectorAll('svg.oi-chart .oi-hit').length === n, weeks, { timeout: 8000 });
  step('Weekly asks for weeks and draws one point a week (as many as the server counted: ' + weeks + ')', weeks >= 5 && await page.evaluate(() => __asked.some(p => /\/insights\/outreach\?bucket=week/.test(p))));
  const tbl = await page.evaluate(() => document.querySelector('[data-oi-table]').innerText);
  step('a row per sequence, "Your outreach" first', /Your outreach[\s\S]*Accountants — Ohio/.test(tbl), tbl);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b3-outreach-insights.png'), fullPage: true });

  // ── R-275: the job beside the candidate ──
  await page.evaluate(() => {
    STATE.bd = STATE.bd || {}; STATE.bd.view = Object.assign(STATE.bd.view || {}, { pipelineJoId: 'jo-1' });
    STATE.page = 'bd_pipeline';
    window.apiGet = function (p) {
      if (p === '/candidates/cand-1') return Promise.resolve({ id: 'cand-1', full_name: 'Ray Credeur', email: 'ray@y.test', current_title: 'Civil Engineer' });
      if (p === '/candidates/cand-1/history') return Promise.resolve({ pipeline: [], submissions: [], activity: [{ id: 'a1', submission_id: 's1', job_order_id: 'jo-1', action: 'stage_change', created_at: '2026-10-18T15:04:00Z', old_stage: 'Screening', new_stage: 'Submitted to BDM', note: 'Strong on concrete forming; wants Houston only' }] });   // the server's own select (routes/recruiting/candidates.js)
      if (p === '/job-orders/jo-1') return Promise.resolve({ id: 'jo-1', job_code: 'JO-112', job_title: 'Site Civil Project Engineer', client: 'Tri-Tek Engineering', client_manager: 'Chris Humes', city: 'Houston', state: 'TX', pay_min: 85000, pay_max: 100000, pay_cur: 'USD', pay_period: 'year', primary_skills: 'Civil 3D, site grading', job_description: 'Lead site civil design for commercial projects: grading, drainage and utility plans.' });
      return Promise.resolve([]);
    };
    window.bdOpenCandidate('cand-1');
  });
  await page.waitForSelector('[data-cpjob] .cp-job-jd', { timeout: 8000 });
  const job = await page.evaluate(() => document.querySelector('[data-cpjob]').innerText);
  step('opened from a job, the drawer shows THAT job: title, client, place and pay, must-haves, the description', /JO-112 · Site Civil Project Engineer/.test(job) && /Client: Tri-Tek Engineering · contact: Chris Humes/.test(job) && /Houston, TX/.test(job) && /USD 85000–100000 per year/.test(job) && /Must have: Civil 3D/.test(job) && /Lead site civil design/.test(job), job);
  await page.evaluate(() => window.cpToggleJob());
  step('Hide folds it away (in place)', await page.evaluate(() => document.querySelector('[data-cpjobbody]').hidden === true && document.querySelector('[data-cpjobbtn]').textContent === 'Show'));
  await page.evaluate(() => window.cpToggleJob());
  // The stage note is a row of the Notes list (data-cpstagenote), wherever the drawer draws that list.
  const notes = await page.evaluate(() => { const n = document.querySelector('[data-cpstagenote]'); const box = n && n.closest('[data-cppanel]'); return n ? (box ? box.getAttribute('data-cppanel') + ': ' : '') + n.textContent : ''; });
  step('the note written when the stage was moved is under Notes, with its date and time', /Strong on concrete forming; wants Houston only/.test(notes) && /^notes: /.test(notes) && /Moved Screening → Submitted to BDM/.test(notes) && /\d{1,2}\/\d{1,2}\/\d{2} \d{2}:\d{2}/.test(notes), notes.slice(0, 300));
  if (SHOTS) { await page.waitForTimeout(900); await page.screenshot({ path: path.join(SHOTS, 'b3-candidate-job.png') }); }
  step('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  step('ran to the end', false, String(e && e.stack || e));
} finally { await browser.close(); server.close(); }
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
