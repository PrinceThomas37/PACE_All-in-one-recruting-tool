// Verifies this session's job/candidate changes:
//  1. Pipeline "Candidates" table shows Email + Title columns.
//  2. Status reads "Added" until a candidate reaches "Submitted to BDM"
//     (only then "✓ Submitted") — no longer mislabels tagged/early candidates.
//  3. Selecting a candidate repaints ONLY the bulk bar (plRepaintSelection),
//     not the whole page — so the scroll position is preserved.
//  4. Multi-select "Email JD to candidates" opens a compose modal.
//  5. ONE unified Add-Candidate window: the job's "+ Add Candidate" and the
//     kanban's "+ Add Candidate" both open the same full applicant form
//     (atsOpenNew), scoped to the job.
//  6. Job details are editable in place (bdOpenEditJob → the job form, prefilled).
//  7. Breadcrumb navigation: opening job → candidate builds a trail, Back pops it.
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

  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'job1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme', city: 'Dallas', state: 'TX',
      job_description: 'Great job', pay_min: '40', pay_max: '55', pay_cur: 'USD', work_auth: 'US Citizen', primary_skills: 'Estimating' }];
    STATE.bd.view = { pipelineJoId: 'job1' };
    STATE.bd.plSel = {};
    STATE.bd.pipeline = [
      { id: 'plUn',  job_order_id: 'job1', pipeline_code: 'PL-1', submission_id: null,   submission: null,
        candidate: { id: 'candB', full_name: 'Tagged Person', email: 'tag@x.com', phone: '111', current_title: 'Welder', city:'Austin', state:'TX' } },
      { id: 'plScr', job_order_id: 'job1', pipeline_code: 'PL-2', submission_id: 'subS', submission: { id: 'subS', stage: 'Screening' },
        candidate: { id: 'candS', full_name: 'Early Person', email: 'early@x.com', phone: '222', current_title: 'Fitter' } },
      { id: 'plSub', job_order_id: 'job1', pipeline_code: 'PL-3', submission_id: 'subB', submission: { id: 'subB', stage: 'Submitted to BDM' },
        candidate: { id: 'candA', full_name: 'Sent Person', email: 'sent@x.com', phone: '333', current_title: 'Foreman' } }
    ];
  });

  const html = await page.evaluate(() => window.renderPipelinePage());
  // 1. Email + Title columns
  step('Table has an Email column header', /<th[^>]*>Email<\/th>/.test(html));
  step('Table has a Title column header', /<th[^>]*>Title<\/th>/.test(html));
  step('Candidate email rendered as a mailto link', html.includes('mailto:sent@x.com'));
  step('Candidate current title rendered', html.includes('Foreman') && html.includes('Welder'));

  // 2. Added vs Submitted
  step('Tagged (un-promoted) candidate shows "Added"', html.includes('>Added</span>'));
  step('"Submitted to BDM" candidate shows "✓ Submitted"', html.includes('✓ Submitted'));
  const submittedCount = (html.match(/✓ Submitted/g) || []).length;
  step('Only the truly-submitted candidate is marked Submitted (exactly 1)', submittedCount === 1, 'found ' + submittedCount);

  // 3. Selection repaints in place (no full render) — plRepaintSelection updates
  // the #pl-bulkbar container; the row checkboxes carry stable ids.
  step('Row checkboxes have stable ids (pl-chk-*)', html.includes('id="pl-chk-plUn"'));
  step('Header select-all has a stable id', html.includes('id="pl-chk-all"'));
  step('Stable #pl-bulkbar container exists', html.includes('id="pl-bulkbar"'));
  const repaint = await page.evaluate(() => {
    // simulate ticking a candidate — must NOT rebuild the whole page
    let renderCalls = 0; const realRender = window.render; window.render = function(){ renderCalls++; return realRender.apply(this, arguments); };
    // mount the page so #pl-bulkbar exists in the DOM
    STATE.page = 'bd_pipeline'; realRender();
    window.plToggleSel('plSub');
    const bar = document.getElementById('pl-bulkbar');
    const out = { renderCalls, barHasSelected: !!(bar && /selected/.test(bar.innerHTML)), barHasEmail: !!(bar && /Email JD to candidates/.test(bar.innerHTML)) };
    window.render = realRender; return out;
  });
  step('Ticking a candidate does NOT trigger a full render()', repaint.renderCalls === 0, 'render calls: ' + repaint.renderCalls);
  step('Bulk bar updates in place with the selection', repaint.barHasSelected);
  // 4. Email JD compose modal
  step('Bulk bar exposes "Email JD to candidates"', repaint.barHasEmail);
  const emailModal = await page.evaluate(() => { STATE.bd.plSel = { plSub: true }; window.plEmailJD(); return STATE.modal || ''; });
  step('Email JD opens a compose modal with a Subject field', /Email the job to/.test(emailModal) && emailModal.includes('pl-jd-subject'));
  step('Compose modal BCCs candidates (privacy)', /BCC/i.test(emailModal));

  // 5. Unified Add-Candidate window
  const addModal = await page.evaluate(() => { window.plOpenAdd('job1'); return STATE.modal || ''; });
  step('Job "+ Add Candidate" opens the unified form titled for the job', /Add Candidate — Estimator/.test(addModal));
  step('Unified form has full applicant fields (Work Authorization)', addModal.includes('Work Authorization'));
  step('Unified form offers search-to-add existing candidate', /SEARCH TO ADD TO THIS JOB/.test(addModal));
  const kanbanAdd = await page.evaluate(() => { window.bdOpenAddCandidate('job1'); return STATE.modal || ''; });
  step('Kanban "+ Add Candidate" opens the SAME unified form', /Add Candidate — Estimator/.test(kanbanAdd) && kanbanAdd.includes('Work Authorization'));

  // 6. Edit job in place
  const editModal = await page.evaluate(() => { window.bdOpenEditJob('job1'); return STATE.modal || ''; });
  step('Edit-job opens the job form in edit mode', /Edit Job/.test(editModal) && editModal.includes('Save changes'));
  step('Edit-job form is prefilled from the job order', editModal.includes('Estimator') && editModal.includes('Acme'));

  // 7. Breadcrumb navigation trail
  const nav = await page.evaluate(() => {
    STATE.nav.stack = [];
    window.bdOpenPipeline('job1');     // record runs synchronously (backend call is async/irrelevant)
    window.bdOpenCandidate('candA');
    const afterOpen = STATE.nav.stack.map(e => e.k);
    const bar = window.navBar();
    window.navBack();
    const afterBack = STATE.nav.stack.map(e => e.k);
    return { afterOpen, afterBack, barHasJob: /Estimator/.test(bar), barHasCand: /Sent Person/.test(bar) };
  });
  step('Opening job → candidate builds a trail (root › job › candidate)', nav.afterOpen.length === 3 && nav.afterOpen[2] === 'candidate', JSON.stringify(nav.afterOpen));
  step('Breadcrumb shows the job and candidate labels', nav.barHasJob && nav.barHasCand);
  step('Back pops one level (candidate → job)', nav.afterBack.length === 2 && nav.afterBack[nav.afterBack.length - 1] !== 'candidate', JSON.stringify(nav.afterBack));

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
