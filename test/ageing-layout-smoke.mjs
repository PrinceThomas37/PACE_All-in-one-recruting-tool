// DOES THE APP STILL WORK AFTER TWO YEARS OF USE? (Session 23)
//
// The owner asked whether information stacking as an account ages had been
// considered "not just in this view but also for everything". It had not.
// Screens were built to look right with the data that existed the day they were
// written, and two were already broken by age alone:
//
//   * the "Connected leads — tick to convert" picker renders EVERY lead ever
//     marked Connected as a chip, with no date bound and no cap, and the ones
//     already converted never leave;
//   * "Needs you today" listed a lead last contacted 91 days ago, and three of
//     its four action kinds had no way to be dismissed at all.
//
// HOW THIS MEASURES IT
// Not by knowing what each page should look like — that would be a test per
// page, and the pages we forget are exactly the ones that break. Instead it
// renders every screen TWICE: once with a young account (20 records) and once
// with an aged one (2,000, roughly two years of real use at this app's rates).
// A screen with a horizon costs about the same either way. A screen without one
// grows with the data, and the RATIO is what fails the build.
//
// That ratio is the whole point: it finds unbounded growth in pages nobody
// thought to check, including pages written after this test.
//
// Usage: node test/ageing-layout-smoke.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';

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
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// A first month of use: 20 records, all inside the default horizon.
const YOUNG = { n: 20, spanDays: 25 };
// Roughly two years at this app's rates, most of it older than the horizon.
const AGED  = { n: 2000, spanDays: 730 };
// A screen may grow a little with age — a count gains digits, a "showing N of
// M" line appears, one more page-number button. It may not grow WITH THE DATA.
// 100x the records must not mean anything like 100x the DOM.
const MAX_GROWTH = 3;

// Seed every collection a page might read.
//
// `spanDays` matters as much as `n`, and getting it wrong makes this test lie.
// A YOUNG account is a few records that are all RECENT — not a few records
// smeared across two years. If both scales share a span, the young case falls
// mostly outside the 90-day horizon and renders almost nothing, so the ratio
// measures the horizon rather than the growth, and a fixed page still looks
// broken. (It did, at 5.4x, until this was split.)
const SEED = ({ n, spanDays }) => {
  const now = Date.now();
  const DAY = 86400000;
  const at = (i) => new Date(now - Math.floor((i / Math.max(1, n)) * spanDays) * DAY).toISOString();
  const day = (i) => at(i).slice(0, 10);
  const S = window.STATE;

  const LEAD_STAGES = ['Unassigned', 'Assigned', 'Connected', 'Converted', 'Dead'];
  const ATS = ['Sourced', 'Screening', 'Submitted to BDM', 'Submitted to Client',
               'Interview Scheduled', 'Offer', 'Placement', 'Not Accepted'];

  S.companies = Array.from({ length: n }, (_, i) => ({
    id: 'co' + i, name: 'Company ' + i, industry: 'Construction',
    location: 'City ' + (i % 50) + ', TX', created_at: at(i),
  }));
  S.contacts = Array.from({ length: n }, (_, i) => ({
    id: 'ct' + i, company_id: 'co' + i, first_name: 'First' + i, last_name: 'Last' + i,
    email: 'c' + i + '@example.test', designation: 'Manager', created_at: at(i),
  }));
  S.jobs = Array.from({ length: n }, (_, i) => ({
    id: 'j' + i, position: 'Position ' + i, pos: 'Position ' + i,
    company_id: 'co' + i, company_name: 'Company ' + i,
    company: { name: 'Company ' + i, industry: 'Construction' },
    location: 'City ' + (i % 50) + ', TX', loc: 'City ' + (i % 50) + ', TX',
    stage: LEAD_STAGES[i % LEAD_STAGES.length],
    industry: 'Construction', date: day(i), created_at: at(i), updated_at: at(i),
    assigned_to_bd: 'test-bd', contacts: [{ id: 'ct' + i, email: 'c' + i + '@example.test', first_name: 'First' + i }],
  }));
  S.leads = S.jobs;
  S.emails = Array.from({ length: n }, (_, i) => ({
    id: 'e' + i, job_id: 'j' + i, contact_id: 'ct' + i,
    to_email: 'c' + i + '@example.test', subject: 'Subject ' + i, body: 'Body ' + i,
    status: ['pending', 'sent', 'failed'][i % 3], sent_at: day(i), created_at: at(i),
    from_email: 'me@example.test', sent_by: 'test-bd',
  }));
  S.activities = Array.from({ length: n }, (_, i) => ({
    id: 'a' + i, job_id: 'j' + i, type: 'note', note: 'Note ' + i, created_at: at(i),
  }));
  S.reminders = Array.from({ length: n }, (_, i) => ({
    id: 'r' + i, user_id: 'test-bd', job_id: 'j' + i, note: 'Reminder ' + i,
    status: i % 2 ? 'pending' : 'sent', remind_at: at(i), created_at: at(i), type: 'ooo',
  }));
  if (!S.bd) S.bd = {};
  S.bd.jobOrders = Array.from({ length: n }, (_, i) => ({
    id: 'jo' + i, title: 'Role ' + i, company_id: 'co' + i, company_name: 'Company ' + i,
    source_lead_id: i % 3 === 0 ? 'j' + i : null,   // a third already converted
    status: 'Open', state: 'TX', job_type: 'Full-time', priority: 'High',
    remote: 'No', created_at: at(i), openings: 1,
  }));
  S.bd.candidates = Array.from({ length: n }, (_, i) => ({
    id: 'cd' + i, first_name: 'Cand' + i, last_name: 'Surname' + i,
    email: 'cand' + i + '@example.test', current_title: 'Technician',
    location: 'City ' + (i % 50) + ', TX', created_at: at(i), skills: 'HVAC, EPA',
  }));
  S.bd.submissions = Array.from({ length: n }, (_, i) => ({
    id: 'sb' + i, candidate_id: 'cd' + i, job_order_id: 'jo' + i,
    stage: ATS[i % ATS.length], created_at: at(i), updated_at: at(i),
  }));
  S.bd.pipeline = S.bd.submissions;
  S.bd.assignments = [];
  S.sourced = Array.from({ length: n }, (_, i) => ({
    id: 'sl' + i, position: 'Sourced ' + i, company_name: 'Company ' + i,
    location: 'City ' + (i % 50), created_at: at(i), source_url: 'https://example.test/' + i,
  }));
  S.clients = S.clients || {};
  // Users stay SMALL on purpose: an org's headcount is bounded, and inflating
  // it would flag role pickers that are legitimately fine.
  return { seeded: n };
};

const MEASURE = () => {
  const c = document.getElementById('content');
  return {
    nodes: c ? c.querySelectorAll('*').length : 0,
    height: c ? Math.round(c.scrollHeight) : 0,
    rows: c ? c.querySelectorAll('tr, li, .chip, label, .row, .card').length : 0,
  };
};

const PAGES = ['dashboard', 'leads', 'applicants', 'email', 'reports', 'myteam',
               'bd_joborders', 'bd_myjobs', 'bd_pipeline', 'clients', 'sourced',
               'insights', 'reminders', 'job_board', 'admin', 'assign'];
const ROLES = ['admin', 'bd', 'bd_lead', 'recruiter', 'ra_lead'];

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({
    executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  // Sanity: the seeder must actually reach the app, or every ratio below is 1
  // and the whole suite reports a clean bill of health it did not earn.
  await page.evaluate(SEED, AGED);
  const seenJobs = await page.evaluate(() => (window.STATE.jobs || []).length);
  step('the seeder really loads an aged account into STATE', seenJobs === AGED.n,
    `STATE.jobs = ${seenJobs}, expected ${AGED.n}`);
  // And the young account must sit INSIDE the horizon, or every ratio below is
  // measuring the wrong thing (see the note on SEED).
  await page.evaluate(SEED, YOUNG);
  const youngOldest = await page.evaluate(() =>
    Math.max(...(window.STATE.jobs || []).map(j => (Date.now() - new Date(j.created_at).getTime()) / 86400000)));
  step('a young account is entirely inside the 90-day horizon', youngOldest < 90,
    `oldest young record is ${Math.round(youngOldest)} days old`);

  const offenders = [];
  const measured = [];

  for (const role of ROLES) {
    await switchRole(page, role);
    for (const p of PAGES) {
      // YOUNG
      await page.evaluate(SEED, YOUNG);
      await page.evaluate((pp) => { window.STATE.page = pp; window.render(); }, p);
      await page.waitForTimeout(90);
      const young = await page.evaluate(MEASURE);
      // AGED
      await page.evaluate(SEED, AGED);
      await page.evaluate((pp) => { window.STATE.page = pp; window.render(); }, p);
      await page.waitForTimeout(140);
      const aged = await page.evaluate(MEASURE);

      // A page that draws nothing either way is not evidence of anything.
      if (young.nodes < 5) continue;
      const ratio = aged.nodes / Math.max(1, young.nodes);
      measured.push({ role, p, ratio, young: young.nodes, aged: aged.nodes });
      if (ratio > MAX_GROWTH) {
        offenders.push(`${role}/${p}: ${young.nodes}→${aged.nodes} nodes (${ratio.toFixed(1)}x)`);
      }
    }
  }

  step(`every screen survives an aged account (${measured.length} screens measured)`,
    offenders.length === 0,
    offenders.length ? offenders.join('\n      ') : '');

  // Report the worst few even on success, so a screen creeping toward the limit
  // is visible before it crosses it.
  const worst = measured.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
  console.log('\n  worst growth ratios:');
  for (const w of worst) console.log(`    ${w.ratio.toFixed(2)}x  ${w.role}/${w.p}  (${w.young} → ${w.aged} nodes)`);

  step('no page threw while rendering an aged account',
    pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
