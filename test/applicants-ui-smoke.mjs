// The Applicants screens (Session 28).
//
// Two places show the same people: Candidates → Applicants (everyone who
// applied, across all jobs) and a block on a job order's own page (just that
// job's). They read ONE list out of STATE and ONE endpoint, because two copies
// is how two screens come to disagree — the repo has paid for that twice
// (candidate outreach built twice, Session 22; the preview and the queue
// reading different briefs, Session 21).
//
// What is asserted here that a render check cannot see:
//   1. the job page shows THIS job's applicants and not another job's;
//   2. an already-imported applicant still appears, marked — a list that drops
//      the person you just actioned looks like the application was lost;
//   3. every onclick either screen emits is a function that exists (Session 21:
//      a bulk edit deleted two handlers and every check still passed).
//
// Usage: node test/applicants-ui-smoke.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

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
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

const JOB_A = 'job-aaa', JOB_B = 'job-bbb';

// Shaped as GET /sourcing/staged returns them: the router attaches
// `applied_job` via services/applicants.js, so the page never sees `raw`.
const SEED = ([a, b]) => {
  const S = window.STATE;
  S.bd = S.bd || {};
  S.bd.jobOrders = [
    { id: a, job_code: 'JO-1', job_title: 'Industrial Electrician', client: 'Northwind', status: 'Open', city: 'Hartford', state: 'CT' },
    { id: b, job_code: 'JO-2', job_title: 'Project Estimator', client: 'Acme', status: 'Open', city: 'Dallas', state: 'TX' },
    // A REAL job that nobody has applied to. The first version of the empty
    // test pointed at an id that did not exist, so the page drew "Job not found"
    // and the assertion passed without ever rendering the applicants block —
    // a vacuous pass of exactly the kind this repo keeps finding.
    { id: 'job-ccc', job_code: 'JO-3', job_title: 'Site Supervisor', client: 'Metro', status: 'Open', city: 'Reno', state: 'NV' },
  ];
  S.bd.view = Object.assign({}, S.bd.view, { joId: a });
  const mk = (id, name, jobId, title, code, status, extra) => Object.assign({
    id, provider: 'apply', status, full_name: name, email: name.toLowerCase().replace(/ /g, '.') + '@mail.com',
    phone: '555-0100', location: 'Hartford, CT', resume_url: 'apply/tok/cv.pdf',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    applied_job: { id: jobId, title, code, applied_at: new Date(Date.now() - 3600000).toISOString(), resume_parsed: true },
  }, extra || {});
  S.applied = {
    loading: false, loaded: true, jobId: null, busy: {},
    rows: [
      mk('s1', 'John Raya', a, 'Industrial Electrician', 'JO-1', 'new'),
      mk('s2', 'Dana Wills', b, 'Project Estimator', 'JO-2', 'new'),
      mk('s3', 'Sam Okafor', a, 'Industrial Electrician', 'JO-1', 'imported',
         { imported_candidate_id: 'cand-9', imported: { id: 'cand-9', candidate_code: 'C-9', full_name: 'Sam Okafor' } }),
    ],
  };
};

const TEXT = () => (document.getElementById('content').innerText || '');

let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');
  await page.evaluate(SEED, [JOB_A, JOB_B]);

  // A probe that cannot measure must fail, not pass.
  const seeded = await page.evaluate(() => (window.STATE.applied && window.STATE.applied.rows || []).length);
  step('the seed really reaches STATE', seeded === 3, `${seeded} rows`);

  // ── Candidates → Applicants ──────────────────────────────────────────────
  await page.evaluate(() => { window.STATE.page = 'applicants'; window.STATE.ats.view = 'applied'; window.render(); });
  await page.waitForTimeout(60);
  const all = await page.evaluate(TEXT);

  step('the Applicants tab lists every applicant', all.includes('John Raya') && all.includes('Dana Wills') && all.includes('Sam Okafor'));
  step('it names the job each person applied for', all.includes('Industrial Electrician') && all.includes('Project Estimator'));
  step('an un-actioned applicant offers "Add to candidates"', all.includes('Add to candidates'));
  step('an already-imported applicant is still listed, marked', all.includes('Sam Okafor') && /Imported/i.test(all));
  step('the count reports only NEW applications', /2 new applications/.test(all), all.split('\n').find(l => /new application/.test(l)) || '(no count line)');

  // ── the job order page ───────────────────────────────────────────────────
  await page.evaluate(() => { window.STATE.page = 'bd_jodetail'; window.render(); });
  await page.waitForTimeout(60);
  const jobPage = await page.evaluate(TEXT);

  step('the job page shows its own applicants', jobPage.includes('John Raya') && jobPage.includes('Sam Okafor'));
  // THE ONE THAT MATTERS: another job's applicant must not appear here.
  step('the job page does NOT show another job\'s applicant', !jobPage.includes('Dana Wills'));
  step('the job block counts only its own new applicants', /1 new/.test(jobPage), jobPage.split('\n').find(l => /new/.test(l)) || '');

  // A job nobody applied to says so plainly rather than drawing an empty table.
  await page.evaluate(() => { window.STATE.bd.view.joId = 'job-ccc'; window.render(); });
  await page.waitForTimeout(60);
  const emptyJob = await page.evaluate(TEXT);
  // Strict: the job must really have rendered (its own title proves it), and
  // the block must state the empty case in words rather than drawing nothing.
  step('a real job with no applicants renders and says so',
    emptyJob.includes('Site Supervisor') && /Nobody has applied/i.test(emptyJob),
    emptyJob.split('\n').filter(Boolean).slice(0, 3).join(' | '));
  step('and shows no other job\'s applicants on it',
    !emptyJob.includes('John Raya') && !emptyJob.includes('Dana Wills'));

  // ── every onclick is defined (Session 21) ────────────────────────────────
  const undefinedHandlers = await page.evaluate(() => {
    const out = [];
    for (const [p, sub] of [['applicants', 'applied'], ['bd_jodetail', null]]) {
      window.STATE.page = p; if (sub) window.STATE.ats.view = sub;
      window.render();
      const html = document.getElementById('content').innerHTML;
      const re = /onclick="(?:event\.stopPropagation\(\);)?\s*([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = re.exec(html))) {
        if (typeof window[m[1]] !== 'function' && !out.includes(m[1])) out.push(m[1]);
      }
    }
    return out;
  });
  step('every onclick these screens emit is a real function', undefinedHandlers.length === 0, undefinedHandlers.join(', '));

  // A CROSS-MODULE CALL MUST BE TO A REAL GLOBAL (Session 28, round 3).
  // The first version of the import handler called `loadApplicants()` and
  // `loadSubmissions()` — both module-local, neither on window. Guarded with
  // `if (window.x)`, so it threw nothing and did nothing: the candidate pool
  // silently never refreshed. **Guarding a call to a function that does not
  // exist is dead code, not safety.** These two are what the Applicants screen
  // reaches for after an import, so they are asserted to exist.
  const hooks = await page.evaluate(() => ['atsReloadCandidates', 'bdReloadSubmissions']
    .filter(n => typeof window[n] !== 'function'));
  step('the refresh hooks the import calls really exist', hooks.length === 0, hooks.join(', '));

  step('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  step('suite ran', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
