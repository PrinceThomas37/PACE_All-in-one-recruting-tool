// Verifies the stage-change consolidation:
//  - The Pipeline tab no longer uses a divergent pipeline_status vocabulary or
//    a no-confirmation "Promote" button. It uses ONE Stage dropdown (the same
//    12-stage submission vocabulary as Submissions/Board) that routes through
//    the shared stage modal.
//  - Un-promoted rows show "Not submitted" and, on picking a stage, promote
//    then open the notes modal; promoted rows open the modal directly.
//  - The modal requires a note and shows the current → target confirmation.
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

  // One shared 11-stage vocabulary is exported for every surface.
  const stageList = await page.evaluate(() => window.ATS_STAGE_LIST);
  step('Single shared stage vocabulary (11 stages)', Array.isArray(stageList) && stageList.length === 11 && stageList[0] === 'Sourced' && stageList[2] === 'Submitted to BDM');
  step('Vocabulary uses Joining + Not Accepted (not Confirmation/Rejected/Not Joined)',
    stageList.indexOf('Joining') > -1 && stageList.indexOf('Not Accepted') > -1 &&
    stageList.indexOf('Confirmation') < 0 && stageList.indexOf('Rejected') < 0 && stageList.indexOf('Not Joined') < 0);
  // Old stored values normalize to the new vocabulary (pre-migration safety).
  const norm = await page.evaluate(() => [window.normalizeStage('Confirmation'), window.normalizeStage('Rejected'), window.normalizeStage('Not Joined'), window.normalizeStage('Offer')]);
  step('normalizeStage maps old → new', norm[0] === 'Joining' && norm[1] === 'Not Accepted' && norm[2] === 'Not Accepted' && norm[3] === 'Offer');

  // Render the Pipeline tab with one promoted + one un-promoted candidate.
  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'job1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme' }];
    STATE.bd.view = { pipelineJoId: 'job1' };
    STATE.bd.submissions = [{ id: 'subA', job_order_id: 'job1', stage: 'Screening', candidate: { id: 'candA', full_name: 'Promoted Person' } }];
    STATE.bd.pipeline = [
      { id: 'plUn', job_order_id: 'job1', pipeline_code: 'PL-1', pipeline_status: 'Tagged', submission_id: null, submission: null, candidate: { id: 'candB', full_name: 'Tagged Person', candidate_code: 'CN-2' } },
      { id: 'plPro', job_order_id: 'job1', pipeline_code: 'PL-2', pipeline_status: 'Moved to Submission', submission_id: 'subA', submission: { id: 'subA', stage: 'Screening', sub_stage: null }, candidate: { id: 'candA', full_name: 'Promoted Person', candidate_code: 'CN-1' } }
    ];
  });
  const pipeHtml = await page.evaluate(() => window.renderPipelinePage());
  step('Pipeline column header is "Stage" (not "Pipeline Status")', pipeHtml.includes('>Stage<') && !pipeHtml.includes('Pipeline Status'));
  step('No standalone "Promote" button remains', !/>Promote</.test(pipeHtml));
  step('No divergent pipeline vocabulary (Tagged/Interested) in the control', !pipeHtml.includes('>Tagged<') && !pipeHtml.includes('>Interested<'));
  step('Stage control uses plMove()', pipeHtml.includes('plMove('));
  step('Un-promoted row shows "Not submitted" option', pipeHtml.includes('Not submitted'));
  step('Dropdown offers the full 12-stage list', pipeHtml.includes('>Submitted to BDM<') && pipeHtml.includes('>Interview Scheduled<') && pipeHtml.includes('>Placement<'));

  // plMove on a PROMOTED row opens the shared stage modal directly.
  await page.evaluate(() => { STATE.modal = null; plMove('plPro', 'subA', 'Interview Scheduled'); });
  await page.waitForTimeout(150);
  const promotedModal = await page.evaluate(() => STATE.modal || '');
  step('Promoted row → opens the shared stage modal', promotedModal.includes('Interview Scheduled') && promotedModal.includes('stg-note'));
  step('Modal shows current → target for a promoted row', /Screening[\s\S]*→[\s\S]*Interview Scheduled/.test(promotedModal));
  await page.evaluate(() => closeModal());

  // plMove on an UN-PROMOTED row promotes (stubbed) then opens the modal.
  const promoteFlow = await page.evaluate(async () => {
    const calls = [];
    const _post = window.apiPost;
    window.apiPost = function(p, b){
      calls.push({ p, b });
      if (/\/pipeline\/plUn\/promote$/.test(p)) {
        return Promise.resolve({ pipeline_id: 'plUn', submission: { id: 'subNew', job_order_id: 'job1', stage: 'Sourced', candidate: { id: 'candB', full_name: 'Tagged Person' } } });
      }
      return _post.apply(this, arguments);
    };
    const _reload = window.bdReloadPipeline; window.bdReloadPipeline = function(){};
    STATE.modal = null;
    plMove('plUn', '', 'Submitted to Client');
    await new Promise(r => setTimeout(r, 250));
    window.apiPost = _post; window.bdReloadPipeline = _reload;
    return { calls, modal: STATE.modal || '' };
  });
  step('Un-promoted row promotes via /pipeline/:id/promote', promoteFlow.calls.some(c => /\/pipeline\/plUn\/promote$/.test(c.p) && c.b && c.b.stage === 'Sourced'));
  step('After promote, the shared stage modal opens for the chosen stage', promoteFlow.modal.includes('Submitted to Client') && promoteFlow.modal.includes('stg-note'));
  await page.evaluate(() => closeModal());

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
