// Verifies richer interview scheduling in the stage modal:
//  - the interview form captures format (in-person/virtual/phone), platform +
//    join link, office address, interviewer names, and "email to" options
//  - the format toggle shows the right fields
//  - stgApply sends the full detail payload and, when opted in, fires the
//    interview-invite email endpoint
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

  const modal = await page.evaluate(() => {
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
    STATE.bd = STATE.bd || {};
    STATE.bd.submissions = [{ id: 's1', stage: 'Submitted to Client', job_order_id: 'j1',
      candidate: { id: 'c1', full_name: 'Sarah Chen', email: 'sarah@x.com' } }];
    window.openStageModal('s1', 'Interview Scheduled', null);
    return STATE.modal || '';
  });
  step('Interview details block renders', /INTERVIEW DETAILS/.test(modal));
  step('Format selector (in person / virtual / phone)', modal.includes('stg-iv-type') && modal.includes('In person') && modal.includes('Virtual') && modal.includes('Phone'));
  step('Virtual: platform choices incl. Teams / Google Meet / Zoom', modal.includes('Microsoft Teams') && modal.includes('Google Meet') && modal.includes('Zoom'));
  step('Virtual: join link / meeting ID field', modal.includes('stg-iv-link'));
  step('In-person: office address field', modal.includes('stg-iv-address'));
  step('Interviewer name(s) field', modal.includes('stg-iv-people'));
  step('"Email these details to" Candidate + BD Manager', modal.includes('stg-iv-notify-cand') && modal.includes('stg-iv-notify-bd'));
  step('"Generate Teams meeting link" button offered', modal.includes('Generate Teams meeting link'));

  const teams = await page.evaluate(async () => {
    document.getElementById('stg-iv-type').value = 'virtual'; window.stgIvTypeToggle();
    document.getElementById('stg-iv-at').value = '2026-08-01T10:00';
    let posted = null;
    window.apiPost = function (url, body) { posted = { url, body }; return Promise.resolve({ joinUrl: 'https://teams.microsoft.com/l/meetup-join/xyz', platform: 'Microsoft Teams' }); };
    window.stgGenTeams('s1');
    await new Promise(r => setTimeout(r, 60));
    return { posted, link: (document.getElementById('stg-iv-link') || {}).value };
  });
  step('Generate Teams posts to /submissions/:id/create-meeting', teams.posted && teams.posted.url === '/submissions/s1/create-meeting' && !!teams.posted.body.start);
  step('The returned Teams join link fills the link field', /teams\.microsoft/.test(teams.link));

  const toggle = await page.evaluate(() => {
    document.getElementById('stg-iv-type').value = 'in_person'; window.stgIvTypeToggle();
    const inperson = document.getElementById('stg-iv-inperson').style.display;
    const virt = document.getElementById('stg-iv-virtual').style.display;
    return { inperson, virt };
  });
  step('Toggling to In person shows address, hides virtual', toggle.inperson === 'block' && toggle.virt === 'none');

  const apply = await page.evaluate(async () => {
    // back to virtual + fill the form
    document.getElementById('stg-iv-type').value = 'virtual'; window.stgIvTypeToggle();
    document.getElementById('stg-note').value = 'Round 1 scheduled';
    document.getElementById('stg-iv-at').value = '2026-08-01T10:00';
    document.getElementById('stg-iv-platform').value = 'Google Meet';
    document.getElementById('stg-iv-link').value = 'https://meet.google.com/abc-defg-hij';
    document.getElementById('stg-iv-people').value = 'Jane Smith, Raj Patel';
    document.getElementById('stg-iv-notify-cand').checked = true;
    let patch = null, invite = null;
    window.apiPatch = function (url, body) { patch = { url, body }; return Promise.resolve({ id: 's1', stage: 'Interview Scheduled' }); };
    window.apiPost = function (url, body) { invite = { url, body }; return Promise.resolve({ sent: 1, mailbox: 'me@futeglobal.com' }); };
    window.stgApply();
    await new Promise(r => setTimeout(r, 100));
    return { patch, invite };
  });
  step('Stage PATCH carries interview_type=virtual', apply.patch && apply.patch.body.interview_type === 'virtual');
  step('PATCH carries platform + join link', apply.patch && apply.patch.body.interview_platform === 'Google Meet' && /meet\.google/.test(apply.patch.body.interview_link));
  step('PATCH carries up to 3 interviewer names', apply.patch && Array.isArray(apply.patch.body.interviewers) && apply.patch.body.interviewers.length === 2 && apply.patch.body.interviewers[0] === 'Jane Smith');
  step('Interview invite emailed to chosen recipients', apply.invite && apply.invite.url === '/submissions/s1/interview-invite' && apply.invite.body.recipients.includes('candidate'));

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
