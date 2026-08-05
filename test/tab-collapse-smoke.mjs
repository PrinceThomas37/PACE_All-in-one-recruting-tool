// Verifies the job-view tab collapse: the redundant "Pipeline" and
// "Submissions" tables are merged into a single "Candidates" tab (the superset
// pipeline view), leaving Candidates + Board (+ Job details for BD). Every
// old entry point that opened Submissions now lands on Candidates, and the
// ported bulk bar (sequence / Email JD) appears on selection.
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

  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'job1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme', city: 'Dallas', state: 'TX', job_description: 'Great job' }];
    STATE.bd.view = { pipelineJoId: 'job1' };
    STATE.bd.plSel = {};
    STATE.bd.pipeline = [
      { id: 'plUn', job_order_id: 'job1', pipeline_code: 'PL-1', submission_id: null, submission: null, candidate: { id: 'candB', full_name: 'Tagged Person', email: 'tag@x.com' } },
      { id: 'plPro', job_order_id: 'job1', pipeline_code: 'PL-2', submission_id: 'subA', submission: { id: 'subA', stage: 'Screening' }, candidate: { id: 'candA', full_name: 'Promoted Person', email: 'pro@x.com' } }
    ];
  });

  const html = await page.evaluate(() => window.renderPipelinePage());
  step('Tab is labeled "Candidates"', /Candidates \(\d+\)/.test(html));
  step('No "Submissions" tab remains', !html.includes('>Submissions</div>') && !/Submissions \(\d+\)/.test(html));
  step('Board tab still present', html.includes('>Board</div>'));
  step('Job details tab present for BD', html.includes('>Job details</div>'));
  step('"+ Add Candidate" (not "Add to Pipeline")', html.includes('+ Add Candidate') && !html.includes('Add to Pipeline'));
  step('Row select checkboxes present', html.includes('plToggleSel('));

  // bulk bar appears once rows are selected
  const barHtml = await page.evaluate(() => { STATE.bd.plSel = { plPro: true, plUn: true }; return window.renderPipelinePage(); });
  step('Bulk bar shows on selection (sequence + Email JD)', barHtml.includes('Start sequence') && barHtml.includes('Email JD') && barHtml.includes('2</b> selected'));

  // Email JD → compose modal → mailto BCC with the selected candidate emails
  const emailJD = await page.evaluate(() => {
    plEmailJD();
    const modalOpened = /Email the job to/.test(STATE.modal || '');
    let opened = '';
    const _open = window.open; window.open = (u) => { opened = u; };
    plSendEmailJD();
    window.open = _open;
    return { modalOpened, opened };
  });
  step('Email JD opens a compose/review modal', emailJD.modalOpened);
  step('Sending builds a mailto BCC with selected candidate emails', emailJD.opened.startsWith('mailto:') && /bcc=/.test(emailJD.opened) && /tag%40x.com|pro%40x.com/.test(emailJD.opened));

  // The old bdOpenSubmissions entry point now routes to the Candidates view.
  const routes = await page.evaluate(() => {
    let called = null;
    const _pipe = window.bdOpenPipeline; window.bdOpenPipeline = (jid) => { called = jid; };
    bdOpenSubmissions('job1');
    window.bdOpenPipeline = _pipe;
    return called;
  });
  step('bdOpenSubmissions() now routes to the Candidates (pipeline) view', routes === 'job1');

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
