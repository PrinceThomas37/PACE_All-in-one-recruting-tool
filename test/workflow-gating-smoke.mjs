// Verifies today's ATS workflow changes:
//  1. Recruiters can only move a candidate up to "Submitted to BDM"; stages
//     after that (client submission, interview, offer, placement, rejection)
//     are BD-only and the stage modal blocks a recruiter from opening them.
//  2. Moving to "Submitted to BDM" opens the submission-details hand-off
//     form (template fields + required comment) instead of the plain modal.
//  3. Moving to "Rejected" requires a rejection reason.
//  4. Recent rejections show as context (with reason) on the recruiter
//     dashboard, framed as non-judgmental.
//  5. BD Manager dashboard shows a per-recruiter revenue/placements card.
//  6. Candidate profile shows a resume preview.
//  7. The resume-format overlay opens with Download Word/PDF actions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(PUBLIC_DIR, p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const step = (name, ok, detail='') => { results.push({name, ok}); console.log((ok?'[PASS] ':'[FAIL] ')+name+(detail?' — '+detail:'')); };
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

  // ── 1+2+3: recruiter stage gating + Submit-to-BDM popup + rejection gate ──
  await page.evaluate(() => {
    STATE.user.role = 'recruiter'; STATE.user.roles = ['recruiter']; STATE.user.name = 'Riana Maria';
    STATE.bd = STATE.bd || {};
    STATE.bd.submissions = [
      { id: 'sub1', stage: 'Screening', candidate: { id: 'cand1', full_name: 'Samuel Ordahl' } },
      { id: 'sub2', stage: 'Submitted to Client', candidate: { id: 'cand2', full_name: 'Gwen Stacy' } }
    ];
  });

  // Blocked: recruiter tries to move a Screening candidate straight to "Offer"
  const blockedToast = await page.evaluate(() => {
    openStageModal('sub1', 'Offer');
    return !STATE.modal;
  });
  step('Recruiter cannot open a post-BDM stage on their own submission', blockedToast);

  // Blocked: recruiter tries to move a candidate already at "Submitted to Client"
  const blockedLocked = await page.evaluate(() => {
    openStageModal('sub2', 'Interview Scheduled');
    return !STATE.modal;
  });
  step('Recruiter cannot advance a candidate already past BDM', blockedLocked);

  // Submitted to BDM → opens the hand-off form, not the generic stage modal
  await page.evaluate(() => {
    window.apiGet = function(p){
      if (p === '/candidates/cand1') return Promise.resolve({
        id: 'cand1', full_name: 'Samuel Ordahl', first_name: 'Samuel', last_name: 'Ordahl',
        email: 'samordahl@yahoo.com', phone: '(228) 278-8703', current_location: 'Ocean Springs, Mississippi',
        availability: 'asap', resume_filename: null
      });
      return Promise.reject(new Error('unstubbed ' + p));
    };
    openStageModal('sub1', 'Submitted to BDM');
  });
  await page.waitForTimeout(200);
  const sbdmHtml = await page.evaluate(() => STATE.modal || '');
  step('Submit-to-BDM opens the hand-off form', sbdmHtml.includes('Submit to BD Manager'));
  step('Form prefills applicant fields from the candidate', sbdmHtml.includes('samordahl@yahoo.com') && sbdmHtml.includes('228) 278-8703') && sbdmHtml.includes('Ocean Springs, Mississippi'));
  step('Form has the required Submission Comment field', sbdmHtml.includes('Submission Comment') && sbdmHtml.includes('important'));
  step('Form has a resume attach + Format resume action', sbdmHtml.includes('Attach file') && sbdmHtml.includes('Format resume'));

  const commentGuard = await page.evaluate(() => {
    document.getElementById('sbdm-comment').value = '';
    window.__toastMsgs = [];
    const _orig = window.showToast;
    window.showToast = (m) => { window.__toastMsgs.push(m); };
    sbdmSubmit();
    window.showToast = _orig;
    return window.__toastMsgs.some(m => /comment/i.test(m));
  });
  step('Submitting without a comment is blocked', commentGuard);

  // Rejected → BD duty only (recruiters can't reach this stage at all — see
  // the two blocked-move checks above); switch to BD to test the reason gate.
  await page.evaluate(() => {
    closeModal();
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    openStageModal('sub2', 'Not Accepted');
  });
  await page.waitForTimeout(150);
  const rejectHtml = await page.evaluate(() => STATE.modal || '');
  step('Not Accepted stage shows a required reason field', rejectHtml.includes('Reason (required)'));
  step('Stage modal header shows current → target confirmation', /Submitted to Client[\s\S]*→[\s\S]*Not Accepted/.test(rejectHtml), 'header did not show current→target');

  // Note is required on EVERY stage change: with a reason but no note, blocked on the note.
  const noteGuard = await page.evaluate(() => {
    window.__toastMsgs = [];
    const _orig = window.showToast; window.showToast = (m) => { window.__toastMsgs.push(m); };
    document.getElementById('stg-reject').value = 'Client passed';
    document.getElementById('stg-note').value = '';
    stgApply();
    window.showToast = _orig;
    return window.__toastMsgs.some(m => /add a note/i.test(m));
  });
  step('Moving stage without a note is blocked (notes required)', noteGuard);

  // With a note but no reason, blocked on the reason.
  const rejectGuard = await page.evaluate(() => {
    window.__toastMsgs = [];
    const _orig = window.showToast; window.showToast = (m) => { window.__toastMsgs.push(m); };
    document.getElementById('stg-note').value = 'Sharing client feedback';
    document.getElementById('stg-reject').value = '';
    stgApply();
    window.showToast = _orig;
    return window.__toastMsgs.some(m => /add the reason/i.test(m));
  });
  step('Moving to Not Accepted without a reason is blocked', rejectGuard);
  await page.evaluate(() => { closeModal(); STATE.user.role = 'recruiter'; STATE.user.roles = ['recruiter']; });

  // ── 4: recent rejections shown as context on the recruiter dashboard ─────
  await page.evaluate(() => {
    STATE._recDash = {
      _at: Date.now(), role: 'recruiter', jobs: { total: 1, active: 1 },
      by_stage: { Sourced: 1 }, submissions_week: 1, submissions_month: 1,
      jobs_assigned: { week: 0, month: 1, quarter: 1, total: 1 }, top_jobs: [],
      recent_rejections: [{ submission_id: 'r1', candidate: 'Peter Parker', reason: 'Client wanted 5+ years AWS', at: new Date().toISOString() }],
      upcoming_interviews: [], awaiting_approval: 0
    };
    STATE.page = 'dashboard'; render();
  });
  await page.waitForTimeout(200);
  const recDashHtml = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('Recent rejections card shows candidate + reason', recDashHtml.includes('Recent rejections') && recDashHtml.includes('Peter Parker') && recDashHtml.includes('Client wanted 5+ years AWS'));
  step('Rejections framed as context, not a scorecard', recDashHtml.includes('not a scorecard'));

  // ── 5: BD manager dashboard is banner-first, with NO injected recruiter
  // "column". The old per-recruiter revenue strip (fed by the legacy
  // un-org-scoped /bd-analytics/recruiters) was removed; that breakdown now
  // lives on the My Team → Reports tab. The dashboard must not inject it and
  // must not call /bd-analytics/recruiters.
  await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    document.querySelectorAll('[data-recdash],[data-bdnav],[data-atsnav],[data-srcnav],[data-jbreq]').forEach(e => e.remove());
    window._analyticsCalled = false;
    window.apiGet = function(p){
      if (p === '/recruiting-dashboard') return Promise.resolve({ role: 'manager', scope: 'own', jobs: { total: 3, active: 3 }, by_stage: { 'Submitted to Client': 2 }, submissions_week: 2, submissions_month: 5, upcoming_interviews: [], awaiting_approval: 0 });
      if (p === '/bd-analytics/recruiters') { window._analyticsCalled = true; return Promise.resolve([]); }
      return Promise.reject(new Error('unstubbed ' + p));
    };
    STATE._recAn = null; STATE._recDash = null;
    STATE.page = 'dashboard'; render();
  });
  await page.waitForTimeout(400);
  const bdDashHtml = await page.evaluate(() => document.getElementById('content').innerHTML);
  const analyticsCalled = await page.evaluate(() => window._analyticsCalled);
  step('BD dashboard is banner-first (greeting present)', /banner-name/.test(bdDashHtml) && /👋/.test(bdDashHtml));
  step('No injected "My recruiting team" recruiter column', !bdDashHtml.includes('My recruiting team'));
  step('Dashboard does not call legacy /bd-analytics/recruiters', analyticsCalled === false);

  // ── 6: resume preview on candidate profile ───────────────────────────────
  await page.evaluate(() => {
    STATE.bd = STATE.bd || {};
    STATE.bd.profile = {
      id: 'cand9',
      candidate: { id: 'cand9', full_name: 'Peter Parker', resume_text: 'PETER PARKER\nFrontend Developer\n5 years React experience' },
      history: { pipeline: [], submissions: [], activity: [] },
      notes: [], documents: [{ id: 'd1', doc_type: 'resume', filename: 'peter_resume.docx', url: 'https://example.invalid/resume.docx', content_type: 'application/vnd.openxmlformats', uploaded_at: new Date().toISOString(), uploader: { name: 'Ana' } }],
      noteTab: 'applicant_reference', back: null
    };
    STATE.page = 'candidate_profile' in window ? STATE.page : STATE.page;
  });
  const resumeHtml = await page.evaluate(() => window.renderCandidateProfile());
  step('Candidate profile renders a Resume card', !!resumeHtml && resumeHtml.includes('Resume'));
  step('Text-fallback preview shows extracted resume text', !!resumeHtml && resumeHtml.includes('Frontend Developer'));

  // regression guard for the renderProfile name-collision bug fixed alongside
  // this work: My Profile (10-page-modals.js) must render its own content,
  // not "No candidate loaded." from the candidate-profile module.
  await page.evaluate(() => { STATE.bd.profile = null; goPage('profile'); });
  await page.waitForTimeout(150);
  const myProfileHtml = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('My Profile page is not clobbered by the candidate-profile renderer', !myProfileHtml.includes('No candidate loaded'));

  // ── 7: resume-format overlay (letterhead preview + downloads) ────────────
  await page.evaluate(() => {
    window.apiPost = function(p, b){
      // Mirror the REAL parser output: full_name (not name) and skills as a
      // comma-separated STRING (not an array) — regression for f.skills.map.
      if (p === '/candidates/parse-resume') return Promise.resolve({ fields: { full_name: 'Peter Parker', email: 'pp@example.com', current_title: 'Frontend Engineer', experience_years: 6, skills: 'React, Node, TypeScript' }, used_ai: false, resume_text: 'Resume body text here' });
      return Promise.reject(new Error('unstubbed ' + p));
    };
    const file = new File(['dummy resume content'], 'peter_resume.txt', { type: 'text/plain' });
    atsFormatResumeFile(file);
  });
  await page.waitForTimeout(300);
  const overlayHtml = await page.evaluate(() => { const o = document.getElementById('ats-fmt-overlay'); return o ? o.innerHTML : null; });
  step('Format overlay opens with a preview frame (string skills do not crash)', !!overlayHtml && overlayHtml.includes('ats-fmt-frame'));
  step('Overlay offers Word + PDF download buttons', !!overlayHtml && overlayHtml.includes('Download Word') && overlayHtml.includes('Download PDF'));
  const frame = await page.evaluate(() => {
    const f = document.getElementById('ats-fmt-frame');
    try { return f.contentDocument.body.innerHTML; } catch(e){ return ''; }
  });
  step('Preview shows letterhead + real parsed name (full_name)', /futé|Candidate Submission/i.test(frame) && frame.includes('Peter Parker'));
  step('Preview renders string skills split into a list', frame.includes('React') && frame.includes('TypeScript') && frame.includes('Key Skills'));
  step('No "f.skills.map is not a function" page error', !pageErrors.some(e => /skills\.map/.test(e)));

  step('No JS page errors', pageErrors.length === 0, pageErrors.join('; ').slice(0, 400));
} finally {
  if (browser) await browser.close();
  server.close();
}
const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
