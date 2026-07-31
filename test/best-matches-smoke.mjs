// Verifies the "Best matches" view on a job order — the whole candidate
// database ranked against this req, rather than only the people already tagged
// onto it.
//
// The backend is stubbed at window.apiGet so this tests the view's behaviour
// (rendering, filtering, tagging, and how it handles a job with no skills)
// without needing a database. The scoring itself is covered by
// match-engine-smoke.mjs, including server/browser parity.
//
// Usage: node test/best-matches-smoke.mjs

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

// One canned response the stubbed apiGet returns, mirroring the real shape of
// GET /job-orders/:id/matches.
const MATCHES = {
  job_order: { id: 'j1', job_code: 'JOB-1', job_title: 'Senior Frontend Engineer', client: 'Acme' },
  scoreable: true, engine_version: 1, total: 3, pool_size: 120,
  results: [
    { candidate_id: 'c1', score: 92, band: 'strong', reasons: ['4/4 skills', '7 yrs ✓', 'work auth ✓'],
      candidate: { id: 'c1', candidate_code: 'CN-1', full_name: 'Ada Strong', current_title: 'Senior Frontend Engineer', current_employer: 'Globex', experience_years: 7, work_authorization: 'US Citizen', city: 'Dallas', state: 'TX', email: 'ada@x.com', phone: '2140000001' } },
    { candidate_id: 'c2', score: 61, band: 'good', reasons: ['2/4 skills', '4 yrs (needs 5+)'],
      candidate: { id: 'c2', candidate_code: 'CN-2', full_name: 'Bob Middling', current_title: 'Frontend Developer', experience_years: 4, work_authorization: 'US Citizen', city: 'Austin', state: 'TX', email: 'bob@x.com', phone: '2140000002' } },
    { candidate_id: 'c3', score: 12, band: 'low', reasons: ['0/4 skills', 'work auth ≠'],
      candidate: { id: 'c3', candidate_code: 'CN-3', full_name: 'Cy Weak', current_title: 'Operator', experience_years: 1, work_authorization: 'H1B', city: 'Albany', state: 'NY', email: 'cy@x.com', phone: '2140000003' } }
  ]
};

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

  // ── set up a job order + stub the API ──────────────────────────────────────
  await page.evaluate((matches) => {
    window.__calls = [];
    window.__matches = JSON.parse(JSON.stringify(matches));
    window.apiGet = function (p) { window.__calls.push(['GET', p]); return Promise.resolve(window.__matches); };
    window.apiPost = function (p, b) { window.__calls.push(['POST', p, b]); return Promise.resolve({ ok: true }); };
    window.showToast = function () {};
    window.render = function () { document.getElementById('content').innerHTML = window.renderPipelinePage(); };

    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JOB-1', job_title: 'Senior Frontend Engineer', client: 'Acme',
      primary_skills: 'React, Node.js', secondary_skills: 'AWS', exp_min: 5, work_auth: 'US Citizen', state: 'TX' }];
    STATE.bd.view = { pipelineJoId: 'j1' };
    STATE.bd.pipeline = [];   // nobody tagged onto the job yet
    STATE.bd.plSel = {};
    STATE.page = 'bd_pipeline';
  }, MATCHES);

  // The tab must exist on the normal pipeline view.
  const pipelineHtml = await page.evaluate(() => window.renderPipelinePage());
  step('Pipeline view offers a "Best matches" tab', /Best matches/.test(pipelineHtml));

  // ── open Best matches ──────────────────────────────────────────────────────
  await page.evaluate(() => window.plOpenMatches('j1'));
  await page.waitForFunction(() => !(STATE.bd.plMatches || {}).loading, { timeout: 5000 });

  const view = await page.evaluate(() => ({ html: window.renderPipelinePage(), calls: window.__calls.slice() }));

  step('It calls the ranking endpoint for this job',
    view.calls.some(c => c[0] === 'GET' && c[1].indexOf('/job-orders/j1/matches') === 0), JSON.stringify(view.calls[0]));
  step('All three candidates render', /Ada Strong/.test(view.html) && /Bob Middling/.test(view.html) && /Cy Weak/.test(view.html));
  step('Best match appears first',
    view.html.indexOf('Ada Strong') < view.html.indexOf('Bob Middling') &&
    view.html.indexOf('Bob Middling') < view.html.indexOf('Cy Weak'));
  step('Scores render as badges', /92% Strong/.test(view.html) && /61% Good/.test(view.html));
  // A score nobody can explain is a score nobody trusts.
  step('The reasons are shown inline, not just on hover', /4\/4 skills · 7 yrs/.test(view.html));
  step('Pool size is reported so the number is trustworthy', /120 candidates scored/.test(view.html));
  step('Each untagged candidate can be added', (view.html.match(/plTagMatch\(/g) || []).length === 3);
  step('Candidate names link to their profile', /bdOpenCandidate\('c1'\)/.test(view.html));
  step('There is a way back to the pipeline', /plCloseMatches\(\)/.test(view.html));

  // ── someone already in the pipeline is marked, not offered again ───────────
  await page.evaluate(() => {
    STATE.bd.pipeline = [{ id: 'p1', job_order_id: 'j1', candidate: { id: 'c1', full_name: 'Ada Strong' } }];
  });
  const withTagged = await page.evaluate(() => window.renderPipelinePage());
  step('A candidate already on the job shows as in-pipeline', /✓ In pipeline/.test(withTagged));
  step('...and is not offered an Add button again',
    (withTagged.match(/plTagMatch\(/g) || []).length === 2,
    String((withTagged.match(/plTagMatch\(/g) || []).length));

  // ── tagging ────────────────────────────────────────────────────────────────
  await page.evaluate(() => { STATE.bd.pipeline = []; window.bdReloadPipeline = function () {}; window.__calls = []; });
  await page.evaluate(() => window.plTagMatch('c2', null));
  await page.waitForFunction(() => (window.__calls || []).some(c => c[0] === 'POST'), { timeout: 5000 });
  const tagCall = await page.evaluate(() => window.__calls.find(c => c[0] === 'POST'));
  step('Adding uses the shared /pipeline endpoint (so dedup behaves the same)',
    tagCall && tagCall[1] === '/pipeline' && tagCall[2].candidate_id === 'c2' && tagCall[2].job_order_id === 'j1',
    JSON.stringify(tagCall));
  const afterTag = await page.evaluate(() => window.renderPipelinePage());
  step('The tagged row updates in place rather than the list reshuffling',
    /✓ In pipeline/.test(afterTag) && afterTag.indexOf('Ada Strong') < afterTag.indexOf('Bob Middling'));

  // ── filters ────────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__calls = []; });
  await page.evaluate(() => window.plMatchFilter('min', '75'));
  await page.waitForFunction(() => (window.__calls || []).length > 0, { timeout: 5000 });
  const filterCall = await page.evaluate(() => window.__calls[0]);
  step('The band filter is passed to the server', /min_score=75/.test(filterCall[1]), filterCall[1]);

  await page.evaluate(() => { window.__calls = []; });
  await page.evaluate(() => window.plMatchFilter('q', 'ada'));
  await page.waitForFunction(() => (window.__calls || []).length > 0, { timeout: 5000 });
  const qCall = await page.evaluate(() => window.__calls[0]);
  step('The text filter is passed to the server', /q=ada/.test(qCall[1]), qCall[1]);

  // ── a job with no skills must say so, not rank confidently on nothing ──────
  await page.evaluate(() => {
    window.__matches = Object.assign({}, window.__matches, { scoreable: false });
  });
  await page.evaluate(() => window.plOpenMatches('j1'));
  await page.waitForFunction(() => !(STATE.bd.plMatches || {}).loading, { timeout: 5000 });
  const bare = await page.evaluate(() => window.renderPipelinePage());
  step('A job with no skills warns that matching is guesswork', /This job lists no skills yet/.test(bare));
  step('...and offers to read them from the job description', /plParseJd\('j1'\)/.test(bare));

  // ── empty and error states ─────────────────────────────────────────────────
  await page.evaluate(() => { window.__matches = Object.assign({}, window.__matches, { results: [], total: 0, scoreable: true }); });
  await page.evaluate(() => window.plOpenMatches('j1'));
  await page.waitForFunction(() => !(STATE.bd.plMatches || {}).loading, { timeout: 5000 });
  step('An empty result set explains itself', /No candidates in the database yet|No candidates match/.test(await page.evaluate(() => window.renderPipelinePage())));

  await page.evaluate(() => { window.apiGet = function () { return Promise.reject(new Error('backend is down')); }; });
  await page.evaluate(() => window.plOpenMatches('j1'));
  await page.waitForFunction(() => !(STATE.bd.plMatches || {}).loading, { timeout: 5000 });
  step('A failed load surfaces the error instead of an empty table',
    /backend is down/.test(await page.evaluate(() => window.renderPipelinePage())));

  // ── leaving the view ───────────────────────────────────────────────────────
  await page.evaluate(() => window.plCloseMatches());
  const back = await page.evaluate(() => window.renderPipelinePage());
  step('Going back returns to the pipeline table',
    /Add Candidate/.test(back) && !/Back to pipeline/.test(back),
    `hasAddCandidate=${/Add Candidate/.test(back)} stillOnMatches=${/Back to pipeline/.test(back)}`);

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log('\n=== BEST MATCHES SMOKE ===');
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
