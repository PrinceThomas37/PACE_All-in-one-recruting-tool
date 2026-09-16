// Verifies email-tracking slice 2 (the visible payoff):
//  - the candidate profile shows an Email activity card with "Opened" / "not opened"
//  - and, since D-0012, that the REMOVED "Email JD to candidates" flow stays removed
//
// This file used to drive plEmailJD → plSendTracked and assert the modal's
// tracked-send button. That whole flow was the duplicate half of "email a
// candidate about a job" and is gone (CAPABILITIES.md). The assertions were
// inverted rather than deleted: a capability the owner asked to have removed
// needs a guard that it does not quietly come back, which is the same reason
// the duplication went unnoticed for months in the first place.
//
// What must NOT be asserted away: POST /candidates/email is still live and
// still used by remSendMeeting for Teams interview invitations.
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

  // ── D-0012: the "Email JD to candidates" flow is gone ───────────────────────
  const gone = await page.evaluate(async () => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme', city: 'Dallas', state: 'TX', job_description: 'JD' }];
    STATE.bd.view = { pipelineJoId: 'j1' };
    STATE.bd.pipeline = [
      { id: 'p1', job_order_id: 'j1', pipeline_code: 'PL-1', candidate: { id: 'c1', full_name: 'A', email: 'a@x.com' } },
      { id: 'p2', job_order_id: 'j1', pipeline_code: 'PL-2', candidate: { id: 'c2', full_name: 'B', email: 'b@x.com' } }
    ];
    STATE.bd.plSel = { p1: true, p2: true };
    const pipeline = window.renderBdPipeline ? window.renderBdPipeline() : '';
    return {
      fns: ['plEmailJD', 'plShowEmailJDModal', 'plSendTracked', 'plCopyEmailJD', 'plSendEmailJD', 'cpOpenEmail']
        .filter(n => typeof window[n] === 'function'),
      pipelineOffersIt: /Email JD to candidates/.test(pipeline),
      // The endpoint's OTHER caller must survive — Teams meeting invitations.
      meetingSenderAlive: typeof window.remSendMeeting === 'function'
    };
  });
  step('No Email-JD function is still defined', gone.fns.length === 0, gone.fns.join(', '));
  step('Pipeline no longer offers "Email JD to candidates"', !gone.pipelineOffersIt);
  step('remSendMeeting survives (Teams invites use the same endpoint)', gone.meetingSenderAlive);

  const profileGone = await page.evaluate(() => {
    STATE.bd.profile = { id: 'c1', candidate: { id: 'c1', full_name: 'A Candidate', candidate_code: 'CN-1', email: 'a@x.com' },
      history: { pipeline: [], submissions: [], activity: [] }, notes: [],
      documents: [{ id: 'd1', filename: 'cv.pdf', doc_type: 'Resume', uploaded_at: '2026-07-21T10:00:00Z' }],
      selJob: null, noteTab: 'applicant_reference', emailActivity: [] };
    const html = window.renderCandidateProfile();
    return { html, hasCheckbox: /type="checkbox"[^>]*cpDocToggle/.test(html) };
  });
  step('Profile has no "Email this candidate" action', !/Email this candidate/.test(profileGone.html));
  step('Documents card has no "Email selected" button', !/Email selected/.test(profileGone.html));
  step('Documents card has no orphaned tick-boxes', !profileGone.hasCheckbox);

  // ── candidate profile: Email activity card ──────────────────────────────────
  const prof = await page.evaluate(() => {
    STATE.bd.profile = { id: 'c1', candidate: { id: 'c1', full_name: 'A Candidate', candidate_code: 'CN-1' },
      history: { pipeline: [], submissions: [], activity: [] }, notes: [], documents: [], selJob: null, noteTab: 'applicant_reference',
      emailActivity: [
        { subject: 'Opportunity: Estimator', to_email: 'a@x.com', sent_at: '2026-07-21T10:00:00Z', opened_at: '2026-07-21T12:00:00Z', open_count: 3, replied_at: null },
        { subject: 'Follow up', to_email: 'a@x.com', sent_at: '2026-07-21T14:00:00Z', opened_at: null, open_count: 0, replied_at: null },
        { subject: 'Re: interview', to_email: 'a@x.com', sent_at: '2026-07-20T09:00:00Z', opened_at: '2026-07-20T09:30:00Z', open_count: 1, replied_at: '2026-07-20T15:00:00Z' }
      ] };
    return window.renderCandidateProfile();
  });
  step('Profile shows an Email activity card', prof.includes('Email activity'));
  step('Opened email shows "✓ Opened" with count', /✓ Opened.*3×/.test(prof.replace(/\s+/g, ' ')));
  step('Un-opened email shows "not opened yet"', prof.includes('not opened yet'));
  step('Replied email shows "↩ Replied"', prof.includes('↩ Replied'));

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
