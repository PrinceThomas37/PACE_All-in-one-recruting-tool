// Verifies two fixes reported after the tab collapse:
//  1. Opening a job from an entry point that never populated
//     STATE.bd.jobOrders (the All Jobs board's "On your desk — open", or the
//     recruiter dashboard's "My jobs" top-5 card) no longer shows
//     "Job not found" — bdOpenPipeline now fetches the single job order
//     directly when it's missing.
//  2. The Candidates page shows a job-details summary (description, pay,
//     location, work auth, skills) FIRST, before the candidates table —
//     visible to recruiters too, not just BD.
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

  const JOB = {
    id: 'job1', job_code: 'JO-1722', job_title: 'HVAC Technician', client: 'Acme Facilities',
    city: 'Ocean Springs', state: 'MS', country: 'USA', zip: '39564',
    pay_cur: 'USD', pay_min: '28', pay_max: '35', job_type: 'Contract', emp_level: 'Mid-Senior',
    work_auth: 'US Citizen', remote: 'No', priority: 'High', positions: 2,
    exp_min: '5', exp_max: '10', primary_skills: 'HVAC install, PM systems', industry: 'Construction',
    job_description: 'X'.repeat(400) + ' — full JD text describing the HVAC technician role in detail.'
  };

  // ── Bug 1: job opened from a path that never loaded STATE.bd.jobOrders ────
  await page.evaluate((job) => {
    STATE.user.role = 'recruiter'; STATE.user.roles = ['recruiter'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [];              // simulate: never visited My Jobs
    STATE.bd.pipeline = [];
    STATE.bd.view = {};
    window.apiGet = function(p){
      if (p === '/job-orders/' + job.id) return Promise.resolve(job);
      if (p === '/job-orders/' + job.id + '/pipeline') return Promise.resolve([]);
      return Promise.reject(new Error('unstubbed ' + p));
    };
    window.__job = job;
  }, JOB);

  await page.evaluate(() => { bdOpenSubmissions(window.__job.id); }); // "On your desk — open" calls this
  await page.waitForTimeout(300);
  const afterOpen = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Job opened from a cold entry point no longer shows "Job not found"', !afterOpen.includes('Job not found'));
  step('The job title renders correctly', afterOpen.includes('HVAC Technician'));

  // ── Bug 2: job-details summary shown FIRST, before the candidates table ───
  step('Job description shown', afterOpen.includes('Job Description'));
  step('Pay rate shown', afterOpen.includes('Pay Rate') && afterOpen.includes('28') && afterOpen.includes('35'));
  step('Location shown', afterOpen.includes('Ocean Springs'));
  step('Work authorization shown', afterOpen.includes('Work Authorization') && afterOpen.includes('US Citizen'));
  step('Job Description appears before the candidates table in the DOM', afterOpen.indexOf('Job Description') < afterOpen.indexOf('<table'));
  step('Long description is collapsed with a Show more toggle', afterOpen.includes('Show more'));
  step('Recruiter (not just BD) sees the job summary card', afterOpen.includes('Job Description')); // role is 'recruiter' above

  // BD sees it too, plus their extra "Job details" tab still works separately.
  const bdHtml = await page.evaluate((job) => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd.jobOrders = [];
    STATE.bd.view = {};
    bdOpenSubmissions(job.id);
    return null;
  }, JOB);
  await page.waitForTimeout(300);
  const bdContent = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('BD also sees the job summary + no "Job not found"', bdContent.includes('Job Description') && !bdContent.includes('Job not found'));
  step('BD still has a separate "Job details" tab', bdContent.includes('>Job details</div>'));

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
