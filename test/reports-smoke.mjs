// Verifies the recruiting Reports page renders its sections from the
// /reports/recruiting payload, and that the nav item is injected.
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

  const out = await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.reports.loading = false;
    STATE.reports.data = {
      role: 'manager',
      stages: window.ATS_STAGE_LIST,
      funnel: { 'Sourced': 12, 'Screening': 8, 'Submitted to BDM': 6, 'Submitted to Client': 5, 'Interview Scheduled': 3, 'Interview Completed': 2, 'Offer': 1, 'Confirmation': 1, 'Placement': 2, 'Rejected': 4, 'Not Joined': 0, 'On Hold': 1 },
      by_recruiter: [
        { recruiter: 'James Wilson', total: 9, submitted: 7, interviews: 3, placements: 2, fill_rate: 22, revenue: 12000 },
        { recruiter: 'Priya Nair', total: 5, submitted: 3, interviews: 1, placements: 0, fill_rate: 0, revenue: 0 }
      ],
      by_user: [
        { user_id: 'u1', recruiter: 'James Wilson', role_label: 'Recruiter', total: 9, submitted: 7, interviews: 3, placements: 2, fill_rate: 22, revenue: 12000 },
        { user_id: 'u2', recruiter: 'Priya Nair', role_label: 'Recruiter', total: 5, submitted: 3, interviews: 1, placements: 0, fill_rate: 0, revenue: 0 }
      ],
      per_user_funnels: { u1: { 'Sourced': 9, 'Submitted to Client': 5, 'Placement': 2 }, u2: { 'Sourced': 5 } },
      hot_jobs: [
        { job_order_id: 'j1', job_code: 'JO-101', job_title: 'Senior Java Developer', client: 'Acme Construction', status: 'Active', submissions: 6, interviews: 3, score: 9 },
        { job_order_id: 'j2', job_code: 'JO-102', job_title: 'Data Engineer', client: 'Globex', status: 'Active', submissions: 3, interviews: 1, score: 4 }
      ],
      trend: [{ week: '7w ago', count: 1 }, { week: '6w ago', count: 3 }, { week: '5w ago', count: 2 }, { week: '4w ago', count: 5 }, { week: '3w ago', count: 4 }, { week: '2w ago', count: 6 }, { week: '1w ago', count: 3 }, { week: 'This wk', count: 4 }],
      avg_time_to_fill: 27,
      top_clients: [{ client: 'Acme Construction', count: 8 }, { client: 'Globex', count: 5 }],
      totals: { candidates_added: 20, submissions: 15, interviews: 5, placements: 2, open_jobs: 4, total_jobs: 6, revenue: 12000 },
      filters: { from: null, to: null, role: null, user_ids: null }
    };
    STATE.page = 'reports';
    render();
    const html = window.renderReports();
    // Reports is now a sidebar item built by 04-shell-login.js (shown standalone
    // to users without the My Team hub), not a DOM-injected [data-rptnav] node.
    const navPresent = Array.prototype.some.call(
      document.querySelectorAll('.sb-nav .nav-item'),
      function(el){ return (el.getAttribute('onclick')||'').indexOf("goPage('reports')") > -1; }
    );
    return { html, navPresent };
  });
  step('Reports nav item present in sidebar', out.navPresent);
  step('Headline tiles render (Placements, Avg time-to-fill, Revenue)', out.html.includes('Placements') && out.html.includes('Avg time-to-fill') && out.html.includes('27 days'));
  step('Revenue formatted as currency', out.html.includes('$12,000'));
  step('Pipeline funnel section', out.html.includes('Pipeline funnel') && out.html.includes('Submitted to Client'));
  step('8-week submission trend', out.html.includes('last 8 weeks') && out.html.includes('This wk'));
  step('Per-person productivity table', out.html.includes('Per-person productivity') && out.html.includes('James Wilson') && out.html.includes('Fill %'));
  step('Filter bar (period + who)', out.html.includes('Period') && out.html.includes('Recruiters') && out.html.includes('7d'));
  step('Hot jobs card', out.html.includes('Hot jobs') && out.html.includes('Senior Java Developer'));
  step('Top clients section', out.html.includes('Top clients') && out.html.includes('Acme Construction'));

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
