// Verifies the team-hierarchy UI: getTeam() returns direct reports (not the
// whole org — the fixed dashboard bug), the shared org-subtree renderer nests
// transitive reports, the My Team page + nav gate on having reports, and the
// Admin org-chart view + admin-only guard behave.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

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

// A small org: Dana (director) → Lee (bd_lead) → {Mia, Sam (recruiters)}, and
// Ora (ra) reporting to nobody. Everyone in the same org.
const USERS = [
  { id: 'dana', name: 'Dana Director', role: 'director', roles: ['director'], employee_id: 'FG-001', manager_id: null },
  { id: 'lee',  name: 'Lee Lead',     role: 'bd_lead',  roles: ['bd_lead'],  employee_id: 'FG-002', manager_id: 'dana' },
  { id: 'mia',  name: 'Mia Recruit',  role: 'recruiter',roles: ['recruiter'],employee_id: 'FG-003', manager_id: 'lee' },
  { id: 'sam',  name: 'Sam Recruit',  role: 'recruiter',roles: ['recruiter'],employee_id: 'FG-004', manager_id: 'lee' },
  { id: 'ora',  name: 'Ora Analyst',  role: 'ra',       roles: ['ra'],       employee_id: 'FG-005', manager_id: null }
];

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("Continue as Guest")', { timeout: 15000 });
  await page.click('button:has-text("Continue as Guest")');
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  // Load the org into STATE via the real normaliser.
  await page.evaluate((users) => { STATE.users = users.map(normaliseUser); }, USERS);

  // 1. getTeam() = direct reports only (the fixed bug: no longer the whole org)
  const team = await page.evaluate(() => {
    const dana = STATE.users.find(u => u.id === 'dana');
    const lee = STATE.users.find(u => u.id === 'lee');
    return {
      danaTeam: getTeam(dana).map(u => u.id).sort(),
      leeTeam: getTeam(lee).map(u => u.id).sort(),
      danaSubtree: reportingSubtree('dana').map(u => u.id).sort()
    };
  });
  step('getTeam(director) = direct reports only', JSON.stringify(team.danaTeam) === JSON.stringify(['lee']), team.danaTeam.join(','));
  step('getTeam(lead) = its two recruiters', JSON.stringify(team.leeTeam) === JSON.stringify(['mia', 'sam']), team.leeTeam.join(','));
  step('reportingSubtree(director) = whole line', JSON.stringify(team.danaSubtree) === JSON.stringify(['lee', 'mia', 'sam']), team.danaSubtree.join(','));

  // 2. renderOrgSubtree nests transitive reports and marks the viewer
  const tree = await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { id: 'dana', role: 'director', roles: ['director'], name: 'Dana Director', isGuest: true });
    return renderOrgSubtree('dana', { click: 'none' });
  });
  step('Org subtree shows the whole line', tree.includes('Dana Director') && tree.includes('Lee Lead') && tree.includes('Mia Recruit') && tree.includes('Sam Recruit'));
  step('Org subtree marks the viewer (YOU)', tree.includes('YOU'));
  step('Org subtree shows team-size chip', tree.includes('in team'));

  // 3. My Team page: gate + render. Dana leads a team → nav + page.
  const my = await page.evaluate(() => {
    render(); // triggers injectNav
    const navHas = Array.from(document.querySelectorAll('.sb-nav .nav-item')).some(e => e.textContent.trim().includes('My Team'));
    goPage('myteam');
    const html = document.getElementById('content').innerHTML;
    return { navHas, isMyTeam: STATE.page === 'myteam', html };
  });
  step('My Team nav shows for a manager', my.navHas);
  step('My Team page renders the reporting structure', my.isMyTeam && my.html.includes('Reporting structure') && my.html.includes('Lee Lead'));

  // 3b. My Team hub: three tabs (Overview / Team Insights / Reports), and the
  // Overview offers a List | Org chart toggle that renders the horizontal chart.
  const hub = await page.evaluate(() => {
    goPage('myteam');
    const tabs = Array.from(document.querySelectorAll('#content button')).map(b => b.textContent.trim());
    const hasTabs = tabs.includes('Overview') && tabs.includes('Team Insights') && tabs.includes('Reports');
    myteamChartView('chart');
    const chartHtml = document.getElementById('content').innerHTML;
    const nav = Array.from(document.querySelectorAll('.sb-nav .nav-item')).map(e => e.textContent.trim());
    return { hasTabs, chartHtml, nav };
  });
  step('My Team hub has Overview / Team Insights / Reports tabs', hub.hasTabs);
  step('Org chart view renders the transitive tree', hub.chartHtml.includes('Org chart') && hub.chartHtml.includes('Mia') && hub.chartHtml.includes('Sam'));
  // 3c. Nav order: My Team sits right after Dashboard, and Team Insights / My
  // Profile / Reports are no longer standalone items for a team lead.
  step('Nav: My Team right after Dashboard', hub.nav[0] === 'Dashboard' && hub.nav[1] === 'My Team', hub.nav.join(' | '));
  step('Nav: no standalone Team Insights / My Profile item', !hub.nav.includes('Team Insights') && !hub.nav.includes('My Profile'));

  // 4. My Team gate is data-driven: Ora (no reports) gets no nav item, no page
  const ora = await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { id: 'ora', role: 'ra', roles: ['ra'], name: 'Ora Analyst' });
    STATE.page = 'dashboard';
    render();
    const navHas = Array.from(document.querySelectorAll('.sb-nav .nav-item')).some(e => e.textContent.trim().includes('My Team'));
    return { navHas };
  });
  step('My Team nav hidden for someone with no reports', !ora.navHas);

  // 5. Admin org-chart view renders trees + groups the unassigned
  const org = await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { id: 'admin1', role: 'admin', roles: ['admin'], name: 'Ann Admin' });
    STATE.adminView = 'org';
    STATE.adminSelectedUser = null;
    STATE.page = 'admin';
    const html = renderAdmin();
    return html;
  });
  step('Admin org chart lists a team root', org.includes('Dana Director') && org.includes('Org chart'));
  step('Admin org chart groups the unassigned', org.includes('Not on the chart yet') && org.includes('Ora Analyst'));

  // 6. Admin guard: a non-admin who lands on the admin page is bounced
  const guard = await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { id: 'lee', role: 'bd_lead', roles: ['bd_lead'], name: 'Lee Lead' });
    STATE.adminView = 'list';
    STATE.page = 'admin';
    const html = renderAdmin();
    return { page: STATE.page, isAdminUI: html.includes('Email Engine Schedule') || html.includes('System Settings') };
  });
  step('Non-admin bounced off the Admin page', guard.page === 'dashboard' && !guard.isAdminUI);

  // 7. Individual (RA) dashboard: real STATE.jobs data, not the dead STATE.leads
  // seed. Ora has no reports and role 'ra' — the one role left that isn't a
  // recruiter or a manager, so it must hit renderIndividualDashboard().
  const ra = await page.evaluate(() => {
    STATE.user = Object.assign({}, STATE.user, { id: 'ora', role: 'ra', roles: ['ra'], name: 'Ora Analyst', isGuest: false });
    STATE.jobs = [
      { id: 'j1', position: 'Backend Engineer', company_name: 'Acme Co', industry: 'Software', location: 'Remote', stage: 'Connected', is_duplicate: false, created_by: 'ora', created_date: new Date().toISOString().slice(0,10), created_at: new Date().toISOString() },
      { id: 'j2', position: 'Frontend Engineer', company_name: 'Beta Inc', industry: 'Software', location: 'NYC', stage: 'Unassigned', is_duplicate: false, created_by: 'ora', created_date: new Date().toISOString().slice(0,10), created_at: new Date().toISOString() },
      { id: 'j3', position: 'Data Analyst', company_name: 'Gamma LLC', industry: 'Finance', location: 'SF', stage: 'Assigned', is_duplicate: true, created_by: 'ora', created_date: new Date().toISOString().slice(0,10), created_at: new Date().toISOString() },
      { id: 'j4', position: 'Other Analyst', company_name: 'Zeta Co', industry: 'Retail', location: 'LA', stage: 'Connected', is_duplicate: false, created_by: 'someone-else', created_date: new Date().toISOString().slice(0,10), created_at: new Date().toISOString() }
    ];
    STATE.reminders = [];
    STATE.viewingUser = null;
    STATE.page = 'dashboard';
    return { html: renderDashboard() };
  });
  step('Individual dashboard shows real leads (own jobs only, not j4)', ra.html.includes('Backend Engineer') && ra.html.includes('Data Analyst') && !ra.html.includes('Other Analyst'));
  step('Individual dashboard shows real stage pills', ra.html.includes('Connected') && ra.html.includes('Unassigned'));
  step('Individual dashboard has no dead-data leftovers', !ra.html.includes('Response rate trend') && !ra.html.includes('Positive') && !ra.html.includes('Negative'));

  step('No JS page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
