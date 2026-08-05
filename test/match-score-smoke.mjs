// Verifies candidate ↔ job match scoring:
//  - matchScore ranks a well-matched candidate far above a poor one
//  - a job with no scoreable detail returns null (renders "—")
//  - the Candidates table shows a Match column and sorts best-fit first
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

  // ── pure scorer ────────────────────────────────────────────────────────────
  const scores = await page.evaluate(() => {
    const job = { primary_skills: 'React, Node.js, TypeScript', secondary_skills: 'AWS, GraphQL',
      exp_min: '5', exp_max: '10', work_auth: 'US Citizen', job_title: 'Senior Frontend Engineer', state: 'TX', remote: 'No' };
    const strong = { skills: 'React, Node.js, TypeScript, AWS, GraphQL', experience_years: 7,
      work_authorization: 'US Citizen', current_title: 'Senior Frontend Engineer', state: 'TX' };
    const weak = { skills: 'COBOL, Fortran', experience_years: 1, work_authorization: 'H1B',
      current_title: 'Mainframe Operator', state: 'NY' };
    return {
      strong: window.matchScore(strong, job),
      weak: window.matchScore(weak, job),
      empty: window.matchScore({ skills: 'X' }, {}),                 // job has nothing to score
      badge: window.matchBadge(window.matchScore(strong, job)),
      sortStrong: window.matchScoreValue(strong, job),
      sortWeak: window.matchScoreValue(weak, job)
    };
  });
  step('Strong candidate scores high (≥75)', scores.strong.score >= 75, 'got ' + scores.strong.score);
  step('Weak candidate scores low (<40)', scores.weak.score < 40, 'got ' + scores.weak.score);
  step('Strong ranks well above weak', (scores.strong.score - scores.weak.score) >= 40);
  step('Unscoreable job returns null', scores.empty.score === null);
  step('Badge renders the % and a band label', /\d+% (Strong|Good|Fair|Low)/.test(scores.badge));
  step('Score value is sortable (strong > weak)', scores.sortStrong > scores.sortWeak);

  // ── Candidates table: Match column + best-first sort ────────────────────────
  const table = await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JO-1', job_title: 'Senior Frontend Engineer', client: 'Acme',
      primary_skills: 'React, Node.js, TypeScript', secondary_skills: 'AWS', exp_min: '5', exp_max: '10', work_auth: 'US Citizen', state: 'TX', remote: 'No' }];
    STATE.bd.view = { pipelineJoId: 'j1' }; STATE.bd.plSel = {}; STATE.bd.plSort = 'match';
    STATE.bd.pipeline = [
      { id: 'pWeak', job_order_id: 'j1', pipeline_code: 'PL-1', submission_id: null, submission: null,
        candidate: { id: 'cw', full_name: 'Weak Fit', skills: 'COBOL', experience_years: 1, work_authorization: 'H1B', current_title: 'Operator', state: 'NY' } },
      { id: 'pStrong', job_order_id: 'j1', pipeline_code: 'PL-2', submission_id: null, submission: null,
        candidate: { id: 'cs', full_name: 'Strong Fit', skills: 'React, Node.js, TypeScript, AWS', experience_years: 7, work_authorization: 'US Citizen', current_title: 'Senior Frontend Engineer', state: 'TX' } }
    ];
    const html = window.renderPipelinePage();
    return { html, strongBeforeWeak: html.indexOf('Strong Fit') < html.indexOf('Weak Fit') };
  });
  step('Table has a Match column', /<th[^>]*>Match<\/th>/.test(table.html));
  step('Match badges rendered for rows', (table.html.match(/% (Strong|Good|Fair|Low)/g) || []).length >= 2);
  step('Best-match sort puts the strong candidate first', table.strongBeforeWeak);
  step('Sort toggle offered (Best match / Recently added)', table.html.includes('Best match') && table.html.includes('Recently added'));

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
