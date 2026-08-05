// Verifies the new role-relevant recruiter dashboard: a recruiter sees
// recruiting widgets (pipeline, interviews, subs) and none of the BD lead-gen
// widgets (Your Team, Response rate trend, Industry breakdown), and the nav
// hides Leads but keeps My Jobs near the top.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, switchRole, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(PUBLIC_DIR, p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const step = (name, ok, detail='') => { results.push({name, ok}); console.log((ok?'[PASS] ':'[FAIL] ')+name+(detail?' — '+detail:'')); };
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

  // Morph the guest into a pure recruiter with a stubbed /recruiting-dashboard payload
  await page.evaluate(() => {
    STATE.user.role = 'recruiter';
    STATE.user.roles = ['recruiter'];
    STATE.user.name = 'James Wilson';
    STATE._recDash = {
      _at: Date.now(), role: 'recruiter',
      jobs: { total: 2, active: 2 },
      by_stage: { 'Sourced': 3, 'Screening': 1, 'Submitted to BDM': 0, 'Submitted to Client': 2,
        'Interview Scheduled': 1, 'Interview Completed': 0, 'Offer': 1, 'Confirmation': 0,
        'Placement': 1, 'Rejected': 1, 'Not Joined': 0, 'On Hold': 0 },
      submissions_week: 7, submissions_month: 7,
      jobs_assigned: { week: 1, month: 2, quarter: 2, total: 2 },
      top_jobs: [
        { id: 'j1', job_code: 'JO-101', job_title: 'Senior Java Developer', client: 'Acme Corp', city: 'Austin', state: 'TX',
          status: 'Active', priority: 'High', team_subs: 9, team_subs_14d: 5, my_subs: 3, created_at: new Date().toISOString() },
        { id: 'j2', job_code: 'JO-102', job_title: 'Data Engineer', client: 'Globex', city: 'Remote', state: '',
          status: 'Active', priority: 'Normal', team_subs: 4, team_subs_14d: 2, my_subs: 1, created_at: new Date().toISOString() }
      ],
      upcoming_interviews: [{ candidate: 'Jane Doe', interview_at: new Date(Date.now()+86400000).toISOString(), interview_location: 'Zoom' }],
      awaiting_approval: 0
    };
    STATE.page = 'dashboard';
    render();
  });
  await page.waitForTimeout(300);

  const content = await page.evaluate(() => document.getElementById('content').innerHTML);
  const sidebar = await page.evaluate(() => document.getElementById('sidebar').innerText);

  // Recruiting widgets present
  step('Banner shows recruiting stats', content.includes('Subs this week') && content.includes('Subs this month'));
  step('Tiles: My Jobs / Offers / Placements', content.includes('My Jobs') && content.includes('Offers') && content.includes('Placements'));
  step('Candidate pipeline card renders stages', content.includes('My candidate pipeline') && content.includes('Sourced') && content.includes('Interview Scheduled'));
  step('Upcoming interviews shows candidate', content.includes('Upcoming interviews') && content.includes('Jane Doe') && content.includes('Zoom'));
  step('Reminders widget present', content.includes('Reminders'));

  // My jobs card
  step('Jobs-assigned timeline stats', content.includes('Assigned this week') && content.includes('This quarter') && content.includes('All time'));
  step('Top active jobs listed with details', content.includes('Senior Java Developer') && content.includes('JO-101') && content.includes('Acme Corp'));
  step('Top jobs show team + my activity', content.includes('team · 14d') && content.includes('my subs'));
  step('Priority badge on hot job', content.includes('High'));
  step('All my jobs button present', content.includes('All my jobs'));
  const jobClick = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('#content [onclick]'))
      .find(e => (e.getAttribute('onclick')||'').includes("bdOpenSubmissions('j1')"));
    return !!el;
  });
  step('Top job row clicks through to submissions', jobClick);

  // BD lead-gen widgets gone
  step('No "Your Team" leads table', !content.includes('Your Team'));
  step('No "Response rate trend"', !content.includes('Response rate trend'));
  step('No "Industry breakdown"', !content.includes('Industry breakdown'));
  step('No lead-stage "Pipeline overview"', !content.includes('Pipeline overview'));
  step('No lead banner stats', !content.includes('Leads this period') && !content.includes('Emails sent'));

  // Nav relevance
  const navItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sb-nav .nav-item')).map(e => e.textContent.trim()));
  step('Nav hides Leads', !navItems.includes('Leads'), navItems.join(' | '));
  step('Nav keeps My Jobs after Dashboard', navItems[0] === 'Dashboard' && navItems[1] === 'My Jobs', navItems.join(' | '));
  // Sourcing moved inside the Candidates tab (a sub-tab, not its own nav item).
  step('Nav keeps Candidates, no separate Sourcing item', navItems.includes('Candidates') && !navItems.includes('Sourcing'));

  // ── Job board (All Jobs) ───────────────────────────────────────────────────
  const jbNav = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sb-nav .nav-item')).map(e => e.textContent.trim()));
  step('Nav shows All Jobs for recruiter', jbNav.includes('All Jobs'), jbNav.join(' | '));

  await page.evaluate(() => {
    // stub the API so the board's real load path runs against fixed data
    const browse = [
      { id: 'b1', job_code: 'JO-201', job_title: 'React Developer', client: 'Stark Industries', city: 'NYC', state: 'NY',
        status: 'Active', priority: 'High', recruiters: ['Alice'], submission_count: 6, assigned_to_me: false, my_request: null,
        job_description: 'Build the front-end for a new internal tool.', pay_cur: 'USD', pay_min: '60', pay_max: '80',
        remote: 'Hybrid', work_auth: 'US Citizen', start_date: '2026-09-01' },
      { id: 'b2', job_code: 'JO-202', job_title: 'Cloud Architect', client: 'Wayne Ent', city: 'Gotham', state: 'NJ',
        status: 'Active', priority: 'Normal', recruiters: [], submission_count: 0, assigned_to_me: true, my_request: null },
      { id: 'b3', job_code: 'JO-203', job_title: 'ML Engineer', client: 'Oscorp', city: 'SF', state: 'CA',
        status: 'On Hold', priority: 'Normal', recruiters: ['Bob'], submission_count: 2, assigned_to_me: false, my_request: { id: 'r1', status: 'pending' } }
    ];
    const _origApiGet = window.apiGet;
    window.apiGet = function(p){
      if (p === '/job-orders/browse') return Promise.resolve(JSON.parse(JSON.stringify(browse)));
      return _origApiGet.apply(this, arguments);
    };
    STATE.jb.list = null;
    goPage('job_board');
  });
  await page.waitForTimeout(400);
  const board = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Board lists all company jobs', board.includes('React Developer') && board.includes('Cloud Architect') && board.includes('ML Engineer'));
  step('Board shows recruiters + activity', board.includes('Alice') && board.includes('6 subs'));
  step('Unassigned job offers Request assignment', board.includes('Request assignment'));
  step('Assigned job shows On your desk', board.includes('On your desk'));
  step('Pending request shows waiting state', board.includes('Requested — waiting on BD'));

  // job popup — client/job info only, no candidates, whether or not assigned
  await page.evaluate(() => { jbOpenJob('b1'); });
  await page.waitForTimeout(300);
  const modal = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Modal shows job description', modal.includes('Build the front-end for a new internal tool'));
  step('Modal shows pay, work style, needed-by', modal.includes('60') && modal.includes('Hybrid') && modal.includes('Needed By'));
  step('Modal has no candidate list/masking language', !modal.includes('Candidates on this job') && !modal.includes('Contact details are hidden'));
  await page.evaluate(() => { jbCloseModal(); goPage('dashboard'); });
  await page.waitForTimeout(200);

  // Sanity: a BD gets the manager/team dashboard, not the recruiter one.
  //
  // This used to assert the legacy lead-gen widgets ("Response rate trend",
  // "Industry breakdown"). That dashboard is gone: it read STATE.leads, which
  // was only ever filled by the guest demo's generated data, so for a real
  // login it rendered a wall of zeroes. A BD is a manager role, so the
  // assertion is now that they land on the team desk.
  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    document.querySelectorAll('[data-bdnav],[data-atsnav],[data-srcnav]').forEach(e => e.remove());
    render();
  });
  await page.waitForTimeout(200);
  const bdContent = await page.evaluate(() => document.getElementById('content').innerHTML);
  const bdNav = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sb-nav .nav-item')).map(e => e.textContent.trim()));
  step('BD lands on the team desk, not the recruiter dashboard',
    bdContent.includes('Your team') && !bdContent.includes('No jobs on your desk yet'), bdContent.slice(0, 200));
  step('BD dashboard shows no seeded lead-gen widgets',
    !bdContent.includes('Response rate trend'), 'the legacy demo-fed dashboard is gone');
  step('BD still sees Leads nav', bdNav.includes('Leads'), bdNav.join(' | '));
  step('BD has no All Jobs nav (their Jobs page covers it)', !bdNav.includes('All Jobs'), bdNav.join(' | '));

  // BDM assignment-requests card
  await page.evaluate(() => {
    STATE.jb._reqs = { _at: Date.now(), list: [
      { id: 'r9', status: 'pending', created_at: new Date(Date.now()-7200000).toISOString(),
        job: { id: 'b1', job_code: 'JO-201', job_title: 'React Developer' },
        recruiter: { id: 'u9', name: 'James Wilson' } }
    ]};
    render();
  });
  await page.waitForTimeout(200);
  const bdDash = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('BDM sees assignment-requests card', bdDash.includes('Assignment requests') && bdDash.includes('James Wilson') && bdDash.includes('React Developer'));
  step('Request row has Assign/Decline buttons', bdDash.includes('Assign') && bdDash.includes('Decline'));

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
