// Verifies the recruiting Reports page renders its sections from the
// /reports/recruiting payload, and that the nav item is injected.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, switchRole, waitForLogin } from './helpers/enter-app.mjs';

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
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  const out = await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.reports.loading = false;
    STATE.reports.data = {
      role: 'manager', scope: 'org',
      stages: ['Submitted to BDM', 'Submitted to Client', 'Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement', 'Not Accepted', 'On Hold'],
      funnel: { 'Submitted to BDM': 6, 'Submitted to Client': 5, 'Interview Scheduled': 3, 'Interview Completed': 2, 'Offer': 1, 'Joining': 1, 'Placement': 2, 'Not Accepted': 4, 'On Hold': 1 },
      by_user: [
        { user_id: 'u1', recruiter: 'James Wilson', role_label: 'Recruiter', to_bdm: 7, to_client: 5, interviews: 3, placements: 2, fill_rate: 40, revenue: 12000 },
        { user_id: 'u2', recruiter: 'Priya Nair', role_label: 'Recruiter', to_bdm: 3, to_client: 0, interviews: 0, placements: 0, fill_rate: null, revenue: 0 },
        { user_id: 'u3', recruiter: 'Idle Ian', role_label: 'Recruiter', to_bdm: 0, to_client: 0, interviews: 0, placements: 0, fill_rate: null, revenue: 0 }
      ],
      per_user_funnels: { u1: { 'Submitted to BDM': 7, 'Submitted to Client': 5, 'Placement': 2 }, u2: { 'Submitted to BDM': 3 }, u3: {} },
      hot_jobs: [
        { job_order_id: 'j1', job_code: 'JO-101', job_title: 'Senior Java Developer', client: 'Acme Construction', status: 'Active', submissions: 6, client_submissions: 4, interviews: 3, score: 9 },
        { job_order_id: 'j2', job_code: 'JO-102', job_title: 'Data Engineer', client: 'Globex', status: 'Active', submissions: 3, client_submissions: 1, interviews: 1, score: 4 }
      ],
      trend: [
        { week: '7w ago', ago: 7, to_bdm: 1, to_client: 0 }, { week: '6w ago', ago: 6, to_bdm: 3, to_client: 1 }, { week: '5w ago', ago: 5, to_bdm: 2, to_client: 1 }, { week: '4w ago', ago: 4, to_bdm: 5, to_client: 2 },
        { week: '3w ago', ago: 3, to_bdm: 4, to_client: 3 }, { week: '2w ago', ago: 2, to_bdm: 6, to_client: 2 }, { week: '1w ago', ago: 1, to_bdm: 3, to_client: 0 }, { week: 'This wk', ago: 0, to_bdm: 4, to_client: 1 }
      ],
      avg_time_to_fill: 27,
      top_clients: [{ client: 'Acme Construction', count: 8 }, { client: 'Globex', count: 5 }],
      totals: { submissions: 10, client_submissions: 5, stalled_at_bdm: 3, interviews: 5, placements: 2, revenue: 12000 },
      filters: { from: null, to: null, role: null, user_ids: null },
      stuck_days: 14,
      stage_time: [
        { stage: 'Submitted to BDM', now_there: 4, typical_days: 6.5, typical_from: 'finished', samples: 5, stuck: 2, final: false },
        { stage: 'Placement', now_there: 2, typical_days: 30, typical_from: 'still_there', samples: 0, stuck: 0, final: true }
      ]
    };
    STATE.page = 'reports';
    render();
    const html = window.renderReports();
    // R-006: Reports live ON the Dashboard now; the standalone nav item is gone.
    const navPresent = Array.prototype.some.call(
      document.querySelectorAll('.sb-nav .nav-item'),
      function(el){ return (el.getAttribute('onclick')||'').indexOf("goPage('reports')") > -1; }
    );
    return { html, navPresent };
  });
  step('the standalone Reports nav item is gone (R-006)', !out.navPresent);
  const onDash = await page.evaluate(async () => {
    STATE.page = 'dashboard'; render();
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('dash-reports');
    const t = el ? el.innerText : '';
    // An old link to the Reports page lands on the Dashboard's section.
    goPage('reports');
    await new Promise(r => setTimeout(r, 400));
    return { has: !!el, t, pageAfter: STATE.page };
  });
  step('the same report is on the Dashboard (R-006)', onDash.has && /Work funnel/.test(onDash.t) && !/Work by person/.test(onDash.t), onDash.t.slice(0, 80));
  step('…but the per-person table is NOT on Today (owner, 6 Oct) — it is in My Team → Reports, the same body without the option', await page.evaluate(() => /Work by person/.test(window.renderReportsBody()) && !/Work by person/.test(window.renderReportsBody({ noPeople: true }))));
  step('an old link to Reports lands on the Dashboard', onDash.pageAfter === 'dashboard');
  // On a phone the section must fit: anything wider than the screen must sit
  // inside its own horizontal scroller, never push the page sideways.
  if (process.env.SHOTS) { const vs = page.viewportSize(); await page.setViewportSize({ width: vs.width, height: 3200 }); const el = await page.$('#dash-reports'); if (el) await el.screenshot({ path: path.join(process.env.SHOTS, '43-dash-reports-desktop.png') }); await page.setViewportSize(vs); }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(async () => { STATE.page = 'dashboard'; render(); await new Promise(r => setTimeout(r, 300)); });
  const phone = await page.evaluate(() => {
    const root = document.getElementById('dash-reports'); if (!root) return { missing: true };
    const vw = document.documentElement.clientWidth; const bad = [];
    root.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect(); if (!r.width || r.right <= vw + 1) return;
      let p = el.parentElement, scrolled = false;
      while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth) { scrolled = true; break; } p = p.parentElement; }
      if (!scrolled) bad.push((el.className || el.tagName) + ' ' + Math.round(r.right) + ' [' + (el.textContent || '').trim().slice(0, 40) + '] in ' + ((el.closest('.card') && el.closest('.card').querySelector('.fw6,h3,b')||{}).textContent || '?'));
    });
    return { missing: false, bad: bad.slice(0, 5), n: bad.length };
  });
  if (process.env.SHOTS) { await page.setViewportSize({ width: 390, height: 5200 }); const el = await page.$('#dash-reports'); if (el) await el.screenshot({ path: path.join(process.env.SHOTS, '43-dash-reports-390.png') }); await page.setViewportSize({ width: 390, height: 900 }); }
  step('on a phone the Reports section fits the screen', !phone.missing && phone.n === 0, JSON.stringify(phone));
  step('Headline tiles render (Placements, Avg time-to-fill, Revenue, Waiting on BDM)', out.html.includes('Placements') && out.html.includes('Avg time-to-fill') && out.html.includes('27 days') && out.html.includes('Waiting on BDM'));
  step('Revenue formatted as currency', out.html.includes('$12,000'));
  step('Work funnel section', out.html.includes('Work funnel') && out.html.includes('Submitted to Client'));
  step('the funnel does NOT count candidates merely added (no Sourced / Screening bars)', !/>Sourced<|>Screening</.test(out.html));
  step('8-week trend of what was SENT (two series)', out.html.includes('last 8 weeks') && out.html.includes('This wk') && out.html.includes('Sent to the client'));
  step('Work by person table — and no "Total" / "Candidates added"', out.html.includes('Work by person') && out.html.includes('James Wilson') && out.html.includes('Placed %') && !out.html.includes('>Total<') && !out.html.includes('Candidates added'));
  step('everyone in the team is listed — someone who did nothing shows 0', out.html.includes('Idle Ian'));
  step('no "Open jobs" / "Candidates added" tiles (data entered is not work done)', !out.html.includes('Open jobs') && !out.html.includes('Candidates added'));
  step('Filter bar (period + who)', out.html.includes('Period') && out.html.includes('Recruiters') && out.html.includes('7d'));
  step('Hot jobs card', out.html.includes('Hot jobs') && out.html.includes('Senior Java Developer'));
  step('Top clients section', out.html.includes('Top clients') && out.html.includes('Acme Construction'));
  step('time in stage lives INSIDE the funnel rows now (one table, not two): typical days and who is stuck', !out.html.includes('Time in stage') && out.html.includes('typ. 6.5d') && />2 stuck</.test(out.html));

  // THE RETRO CHARTS (R-122 step 3): the bars are square, outlined, segmented and
  // coloured by what the stage MEANS — not the old rounded blue ramp.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => { STATE.page = 'dashboard'; render(); await new Promise(r => setTimeout(r, 300)); });
  const charts = await page.evaluate(() => {
    const root = document.getElementById('dash-reports'); if (!root) return { missing: true };
    const tracks = [...root.querySelectorAll('.rep-track')], fills = [...root.querySelectorAll('.rep-fill')], cols = [...root.querySelectorAll('.rep-colbar')];
    const cs = (e) => getComputedStyle(e);
    const rowOf = (label) => [...root.querySelectorAll('.rep-row')].find(r => r.querySelector('.rep-lbl') && r.querySelector('.rep-lbl').textContent === label);
    const bg = (label) => { const r = rowOf(label); return r ? cs(r.querySelector('.rep-fill')).backgroundColor : null; };
    return {
      missing: false, tracks: tracks.length, fills: fills.length, cols: cols.length,
      sq: [...tracks, ...fills, ...cols].every(e => cs(e).borderTopLeftRadius === '0px'),
      outlined: tracks.every(e => parseFloat(cs(e).borderTopWidth) >= 2) && cols.every(e => parseFloat(cs(e).borderTopWidth) >= 2),
      segmented: fills.every(e => /repeating-linear-gradient/.test(cs(e).backgroundImage)),
      inlineColour: [...root.querySelectorAll('.rep-fill,.rep-colbar')].filter(e => /background/i.test(e.getAttribute('style') || '')).length,
      won: bg('Placement'), lost: bg('Not Accepted'), ours: bg('Submitted to BDM'), client: bg('Submitted to Client'),
      pills: [...root.querySelectorAll('.rep-pill')].map(e => cs(e).borderTopLeftRadius),
    };
  });
  step('the report draws its funnel, columns and filter keys', !charts.missing && charts.tracks >= 9 && charts.cols >= 1 && charts.pills.length >= 7, JSON.stringify(charts).slice(0, 160));
  step('bars and columns are SQUARE (no rounded corners) and outlined', charts.sq && charts.outlined, JSON.stringify({ sq: charts.sq, outlined: charts.outlined }));
  step('fills are segmented like a level meter', charts.segmented);
  step('colour comes from the tone classes, never inline', charts.inlineColour === 0, String(charts.inlineColour));
  // 'ours purple' is the soft chart purple (D-0078, owner: the old one was "very poppy"); the brand purple stays on controls.
  step('stages are coloured by meaning: won green, lost red, ours purple, client side blue',
    charts.won === 'rgb(169, 201, 140)' && charts.lost === 'rgb(217, 138, 126)' && charts.ours === 'rgb(168, 148, 219)' && charts.client === 'rgb(156, 198, 226)', JSON.stringify([charts.won, charts.lost, charts.ours, charts.client]));
  step('the period / who keys are square paper keys', charts.pills.every(r => r === '0px'), charts.pills.join());

  // EVERY NUMBER OPENS THE PEOPLE BEHIND IT (D-0077). The server's answer is a
  // stub here (the real rule is pinned by report-work-smoke); this proves the
  // wiring: the click asks for the right metric, the drawer shows the rows, a row
  // opens the candidate, Esc closes it, and nothing that cannot be traced is a dead bar.
  const drill = await page.evaluate(async () => {
    const asked = [], opened = [];
    window.apiGet = function (path) {
      asked.push(path);
      if (path.indexOf('/reports/recruiting/rows') === 0) return Promise.resolve({ total: 2, more: 0, rows: [
        { submission_id: 's1', candidate_id: 'c1', candidate: 'Ada Lovelace', job_title: 'Estimator', job_code: 'JO-1', client: 'Acme', stage: 'Submitted to Client', at: '2026-10-13T10:00:00Z', recruiter: 'Rita' },
        { submission_id: 's2', candidate_id: 'c2', candidate: 'Grace Hopper', job_title: 'Estimator', job_code: 'JO-1', client: 'Acme', stage: 'Placement', at: '2026-10-12T10:00:00Z', recruiter: 'Rita' }] });
      return Promise.resolve([]);
    };
    window.bdOpenCandidate = (id) => opened.push(id);
    STATE.page = 'dashboard'; render();
    await new Promise(r => setTimeout(r, 300));
    const wait = () => new Promise(r => setTimeout(r, 250));
    const drawer = () => { const d = document.querySelector('.ev-drawer'); return d ? { t: d.querySelector('.ev-title').textContent.trim(), n: d.querySelectorAll('.ev-row').length, hint: d.querySelector('.ev-hint') ? d.querySelector('.ev-hint').textContent : '' } : null; };
    const out = {};
    // a funnel bar
    const bar = [...document.querySelectorAll('#dash-reports .rep-row.is-click')].find(r => r.querySelector('.rep-lbl').textContent === 'Submitted to Client');
    out.barTitle = bar.getAttribute('title');
    bar.click(); await wait();
    out.funnel = drawer(); out.funnelAsk = asked[asked.length - 1];
    // a row opens the candidate, and the drawer goes first
    document.querySelector('.ev-row.is-click').click(); await wait();
    out.picked = opened.slice(); out.closedByPick = !document.querySelector('.ev-drawer');
    // a headline tile
    document.querySelector('#dash-reports .strip-i.click').click(); await wait();
    out.tile = drawer(); out.tileAsk = asked[asked.length - 1];
    // Escape closes
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait();
    out.escClosed = !document.querySelector('.ev-drawer');
    // a trend column
    const col = [...document.querySelectorAll('#dash-reports .rep-bar1.is-click')][0];
    out.colTitle = col.getAttribute('title');
    col.click(); await wait();
    out.week = drawer(); out.weekAsk = asked[asked.length - 1];
    document.querySelector('.ev-head .btn').click(); await wait();
    // a person's number — the per-person table is no longer on Today (owner, 6 Oct); it is in My Team → Reports,
    // which draws the same body. Mount that body the way the tab does and use it.
    const probe = document.createElement('div'); probe.id = 'people-probe'; probe.innerHTML = window.renderReportsBody(); document.body.appendChild(probe);
    const nb = probe.querySelector('.rep-numbtn'); nb.click(); await wait();
    out.person = drawer(); out.personAsk = asked[asked.length - 1];
    document.querySelector('.overlay').click(); await wait();            // a click outside closes
    out.outsideClosed = !document.querySelector('.ev-drawer');
    // a stuck chip
    const chip = document.querySelector('#dash-reports .rep-stuckchip'); out.chip = !!chip;
    if (chip) { chip.click(); await wait(); out.stuck = drawer(); out.stuckAsk = asked[asked.length - 1]; document.querySelector('.ev-head .btn').click(); await wait(); }
    // zero is not a dead button: a zero person-number is plain text, a zero column has no click
    out.zeroBtns = [...probe.querySelectorAll('.rep-zero')].length; probe.remove();
    out.deadCols = [...document.querySelectorAll('#dash-reports .rep-bar1:not(.is-click) .rep-colbar:not(.is-zero)')].length;
    return out;
  });
  step('hovering a bar says what it is and that it opens the people (a tooltip)', /Submitted to Client: 5 — click to see who/.test(drill.barTitle || ''), drill.barTitle);
  step('clicking a funnel bar opens a drawer with the people behind it', drill.funnel && drill.funnel.t.startsWith('Submitted to Client') && drill.funnel.n === 2 && /Period:/.test(drill.funnel.hint), JSON.stringify(drill.funnel));
  step('…asking the server for THAT metric, with the page\'s filters', /^\/reports\/recruiting\/rows\?.*metric=reached%3ASubmitted%20to%20Client/.test(drill.funnelAsk || ''), drill.funnelAsk);
  step('a person in the drawer opens their candidate record, and the drawer steps aside first', drill.picked.join() === 'c1' && drill.closedByPick);
  step('a headline tile opens its people', drill.tile && /^Sent to the BD manager/.test(drill.tile.t) && /metric=to_bdm/.test(drill.tileAsk || ''), drill.tileAsk);
  step('Escape closes the drawer', drill.escClosed);
  step('a trend column opens exactly its week (and says the period filter does not apply to it)', drill.week && /^Sent to the BD manager — 7w ago/.test(drill.week.t) && /kind=to_bdm/.test(drill.weekAsk || '') && /ago=7/.test(drill.weekAsk || '') && /whatever period/.test(drill.week.hint), drill.weekAsk + ' ' + JSON.stringify(drill.week));
  step('a column\'s tooltip names the series and the week', /Sent to the BD manager, 7w ago: 1 — click to see who/.test(drill.colTitle || ''), drill.colTitle);
  step('a number in "Work by person" opens THAT person\'s people', drill.person && /^James Wilson/.test(drill.person.t) && /user_id=u1/.test(drill.personAsk || ''), drill.personAsk);
  step('a click outside the drawer closes it', drill.outsideClosed);
  step('"2 stuck" opens who has sat there 14+ days', drill.chip && drill.stuck && /stuck/.test(drill.stuck.t) && /metric=stuck%3ASubmitted%20to%20BDM/.test(drill.stuckAsk || ''), drill.stuckAsk);
  step('a zero is plain text, a zero column is not clickable — no dead buttons', drill.zeroBtns >= 3 && drill.deadCols === 0, drill.zeroBtns + ' / ' + drill.deadCols);

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, String(e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
