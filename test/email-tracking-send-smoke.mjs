// Verifies email-tracking slice 2 (the visible payoff):
//  - the "Email JD" modal offers a "Send tracked through PACE" action
//  - plSendTracked posts recipients (with candidate_id) + subject/body/job to
//    POST /candidates/email
//  - the candidate profile shows an Email activity card with "Opened" / "not opened"
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

  // ── Email JD modal → tracked send ───────────────────────────────────────────
  const send = await page.evaluate(async () => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme', city: 'Dallas', state: 'TX', job_description: 'JD' }];
    STATE.bd.view = { pipelineJoId: 'j1' };
    STATE.bd.pipeline = [
      { id: 'p1', job_order_id: 'j1', pipeline_code: 'PL-1', candidate: { id: 'c1', full_name: 'A', email: 'a@x.com' } },
      { id: 'p2', job_order_id: 'j1', pipeline_code: 'PL-2', candidate: { id: 'c2', full_name: 'B', email: 'b@x.com' } }
    ];
    STATE.bd.plSel = { p1: true, p2: true };
    window.plEmailJD();
    const modal = STATE.modal || '';
    // stub apiPost to capture the tracked-send payload
    let captured = null;
    window.apiPost = function (url, body) { captured = { url, body }; return Promise.resolve({ sent: 2, mailbox: 'me@futeglobal.com' }); };
    window.plSendTracked();
    await new Promise(r => setTimeout(r, 50));
    return { modal, captured };
  });
  step('Email JD modal offers "Send tracked through PACE"', /Send tracked through PACE/.test(send.modal));
  step('Modal still offers the mail-app fallback', /Open in mail app/.test(send.modal));
  step('plSendTracked posts to /candidates/email', send.captured && send.captured.url === '/candidates/email', send.captured && send.captured.url);
  step('payload carries the job id', send.captured && send.captured.body.job_order_id === 'j1');
  step('payload recipients include candidate_id + email', !!(send.captured && send.captured.body.recipients.length === 2 &&
    send.captured.body.recipients[0].candidate_id && send.captured.body.recipients[0].email));

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
