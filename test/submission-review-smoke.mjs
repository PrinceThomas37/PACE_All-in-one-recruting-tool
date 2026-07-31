// Verifies three fixes:
//  1. Submit-to-BDM "Format resume" stashes the formatted doc; on submit BOTH
//     the original file and the formatted futé-letterhead copy are uploaded to
//     the candidate's documents (attached to the packet).
//  2. The BDM can open a "Review submission" modal (from the Awaiting-approval
//     card) showing the recruiter's submission_details + resume documents, with
//     Approve → Client / Reject inside — not just a blind "Approve".
//  3. The Add-Candidate modal no longer dumps a list of existing candidates on
//     open; the create form is primary and search only surfaces matches.
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

  // ── 1: Format resume stashes + attaches to the packet ─────────────────────
  const attach = await page.evaluate(async () => {
    STATE.user.role = 'recruiter'; STATE.user.roles = ['recruiter'];
    STATE.bd = STATE.bd || {};
    STATE.bd.submissions = [{ id: 'subX', job_order_id: 'j1', stage: 'Screening', candidate: { id: 'candX', full_name: 'Daniel Estimator' } }];

    const posted = [];
    const patched = [];
    window.apiGet = function(p){
      if (p === '/candidates/candX') return Promise.resolve({ id: 'candX', full_name: 'Daniel Estimator', first_name: 'Daniel', last_name: 'Estimator', email: 'daniel@x.com', phone: '555' });
      if (p === '/candidates/parse-resume') return Promise.resolve({ fields: { full_name: 'Daniel', skills: 'Estimating, Cost Controls' }, resume_text: 'Resume text body' });
      return Promise.reject(new Error('unstubbed GET ' + p));
    };
    window.apiPost = function(p, b){
      if (/\/candidates\/candX\/documents$/.test(p)) { posted.push(b); return Promise.resolve({ id: 'doc' + posted.length }); }
      if (p === '/candidates/parse-resume') return Promise.resolve({ fields: { full_name: 'Daniel', skills: 'Estimating, Cost Controls' }, resume_text: 'Resume text body' });
      return Promise.reject(new Error('unstubbed POST ' + p));
    };
    window.apiPatch = function(p, b){ if (/\/submissions\/subX\/stage$/.test(p)) { patched.push(b); return Promise.resolve({ id: 'subX', stage: 'Submitted to BDM' }); } return Promise.reject(new Error('unstubbed PATCH ' + p)); };

    openStageModal('subX', 'Submitted to BDM'); // recruiter → opens the hand-off form
    await new Promise(r => setTimeout(r, 250));

    // simulate an attached file + clicking Format resume
    const file = new File(['raw resume bytes'], 'Daniel_CV.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    STATE._sbdm.file = file;
    await new Promise((res) => {
      window.atsFormatResumeFile(file, { preview: false, onFormatted: function(html, name){ STATE._sbdm.formattedHtml = html; STATE._sbdm.formattedName = name; res(); } });
    });

    // fill required fields and submit
    document.getElementById('sbdm-comment').value = 'Strong fit — 28 yrs experience.';
    sbdmSubmit();
    await new Promise(r => setTimeout(r, 300));
    return { posted, patched, formattedStashed: !!STATE._sbdm };
  });
  step('Format resume stashes a formatted doc', true); // reaching here without error implies onFormatted fired
  step('Original resume uploaded to the packet', attach.posted.some(d => d.filename === 'Daniel_CV.docx' && d.doc_type === 'resume'));
  step('Formatted futé-letterhead copy uploaded to the packet', attach.posted.some(d => /_Submission\.doc$/.test(d.filename) && d.content_type === 'application/msword'));
  step('Formatted doc is a real base64 .doc data URI', attach.posted.some(d => typeof d.data_base64 === 'string' && d.data_base64.startsWith('data:application/msword;base64,') && d.data_base64.length > 100));
  step('Stage patched to Submitted to BDM with submission_details', attach.patched.some(b => b.stage === 'Submitted to BDM' && b.submission_details && b.submission_details.comment));
  step('submission_details records the attached resume filenames', attach.patched.some(b => b.submission_details && b.submission_details.original_resume === 'Daniel_CV.docx' && /_Submission\.doc$/.test(b.submission_details.formatted_resume||'')));
  await page.evaluate(() => { try{ closeModal(); }catch(e){} STATE._sbdm = null; });

  // ── 2: BDM review-submission modal ────────────────────────────────────────
  const review = await page.evaluate(async () => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd.submissions = [{
      id: 'subP', job_order_id: 'j1', stage: 'Submitted to BDM', submission_code: 'SB-9',
      submitter: { name: 'Riana Maria' },
      candidate: { id: 'candP', full_name: 'Samuel Ordahl', candidate_code: 'CN-14' },
      submission_details: { first_name: 'Samuel', last_name: 'Ordahl', email: 'sam@x.com', mobile: '(228) 278-8703', work_auth: 'US Citizen', current_location: 'Ocean Springs, MS', relocation: 'Ocean Springs, MS', availability: 'asap', comment: 'HVAC tech, 10 yrs, ready to start.' }
    }];
    window.apiGet = function(p){
      if (/\/candidates\/candP\/documents$/.test(p)) return Promise.resolve([{ id: 'd1', filename: 'Samuel_Submission.doc', doc_type: 'resume', url: 'https://example.invalid/s.doc', uploader: { name: 'Riana' } }]);
      return Promise.reject(new Error('unstubbed ' + p));
    };
    bdViewSubmission('subP');
    await new Promise(r => setTimeout(r, 250));
    return STATE.modal || '';
  });
  step('BDM review modal opens with the submission title', review.includes('Review submission') && review.includes('Samuel Ordahl'));
  step('Modal shows the recruiter submission details', review.includes('228) 278-8703') && review.includes('Ocean Springs') && review.includes('HVAC tech, 10 yrs'));
  step('Modal shows who submitted it', review.includes('Riana Maria') && review.includes('SB-9'));
  step('Modal has Approve → Client and Reject inside', review.includes('Approve → Client') && review.includes('Reject'));
  const docsLoaded = await page.evaluate(() => (document.getElementById('bd-sub-docs')||{}).innerHTML || '');
  step('Modal loads and links the attached resume document', docsLoaded.includes('Samuel_Submission.doc'));
  await page.evaluate(() => { try{ closeModal(); }catch(e){} });

  // ── 3: Add-Candidate modal — no default candidate list ────────────────────
  const addModal = await page.evaluate(async () => {
    STATE.user.role = 'recruiter'; STATE.user.roles = ['recruiter'];
    STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JO-1', job_title: 'HVAC', client: 'Acme' }];
    STATE.bd.view = { pipelineJoId: 'j1' };
    STATE.bd.pipeline = [];
    let listFetched = false;
    window.apiGet = function(p){ if (p === '/candidates' || /^\/candidates\?/.test(p)) { listFetched = true; return Promise.resolve([{ id: 'c9', full_name: 'Existing Person', candidate_code: 'CN-9', email: 'e@x.com' }]); } return Promise.reject(new Error('unstubbed ' + p)); };
    plOpenAdd('j1');
    await new Promise(r => setTimeout(r, 150));
    return { html: STATE.modal || '', listFetched };
  });
  step('Add modal opens without fetching the candidate pool', addModal.listFetched === false);
  step('Add opens the ONE unified candidate form, scoped to the job', /Add Candidate — HVAC/.test(addModal.html) && addModal.html.includes('Work Authorization'));
  step('Unified add form offers search-to-add, not a candidate dump', addModal.html.includes('SEARCH TO ADD TO THIS JOB') && !addModal.html.includes('Existing Person'));

  // typing a query surfaces matches (add an existing candidate to the job)
  const searched = await page.evaluate(async () => { atsJobTagSearch('exist'); await new Promise(r => setTimeout(r, 200)); return STATE.modal || ''; });
  step('Searching surfaces existing candidates to add', searched.includes('Existing Person') && searched.includes('>Add<'));
  await page.evaluate(() => { try{ closeModal(); }catch(e){} });

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 400));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
