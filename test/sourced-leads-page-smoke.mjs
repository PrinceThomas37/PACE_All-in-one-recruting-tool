// Verifies the Sourced Leads review screen — the human gate between automated
// sourcing and anyone being contacted.
//
// The behaviours that matter here are trust behaviours: does it say WHY to call
// this company, does it admit an inferred email is a guess, and is it impossible
// to create a lead without a person clicking. Those are asserted directly.
//
// The API is stubbed at window.apiGet/apiPost; the pipeline itself is covered by
// lead-sourcing-smoke.mjs.
//
// Usage: node test/sourced-leads-page-smoke.mjs

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

const QUEUE = {
  counts: { new: 2, duplicate: 1, promoted: 4 },
  results: [
    { id: 's1', title: 'Senior Java Developer', company_name: 'Fidelity Investments',
      location: 'Dallas, TX', city: 'Dallas', state: 'TX', department: 'Engineering',
      posted_at: '2026-05-18T00:00:00Z', first_posted_at: '2026-05-18T00:00:00Z',
      seen_count: 12, repost_count: 2, status: 'new', url: 'https://example.com/j1',
      company_domain: 'fidelity.com',
      parsed: { skills: ['Java', 'Spring Boot', 'AWS'] },
      hiring_reason: { category: 'hard_to_fill', confidence: 'high',
        headline: 'Hard to fill — open 74 days; reposted 2 times.',
        angle: 'Your Senior Java Developer opening has been live about 74 days and reposted 2 times — usually a sign the local pipeline is thin.' },
      contacts: [
        { email: 'careers@fidelity.com', name: null, title: 'Company mailbox', confidence: 0.35, method: 'role_mailbox', deliverable: 'domain_ok' }
      ] },
    { id: 's2', title: 'Data Engineer', company_name: 'Toyota Connected',
      location: 'Plano, TX', posted_at: '2026-07-20T00:00:00Z', seen_count: 1, repost_count: 0,
      status: 'new', parsed: { skills: ['Python'] },
      hiring_reason: { category: 'team_build', confidence: 'high',
        headline: 'Team build-out — 3 openings for this same role.',
        angle: 'You have 3 Data Engineer openings live at once — that is a team build, not a single hire.' },
      contacts: [] }
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
  await waitForLogin(page);
  await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  await page.evaluate((queue) => {
    window.__posts = [];
    window.__queue = JSON.parse(JSON.stringify(queue));
    window.apiGet = function (p) {
      if (p.indexOf('/sourced-leads') === 0) return Promise.resolve(window.__queue);
      if (p.indexOf('/lead-sources/providers') === 0) return Promise.resolve({ providers: [{ id: 'greenhouse', label: 'Greenhouse', example: 'e.g. the "stripe" in job-boards.greenhouse.io/stripe' }] });
      if (p.indexOf('/lead-sources') === 0) return Promise.resolve([]);
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) {
      window.__posts.push([p, b]);
      if (/find-contacts/.test(p)) return Promise.resolve({ contacts: [
        { email: 'priya.raman@fidelity.com', name: 'Priya Raman', title: 'Talent Acquisition', confidence: 0.45, method: 'pattern_inference', deliverable: 'domain_ok' }
      ] });
      return Promise.resolve({ success: true, job_id: 'new-job-1' });
    };
    window.apiDelete = function (p) { window.__posts.push(['DELETE', p]); return Promise.resolve({}); };
    STATE.user.role = 'bd'; STATE.user.roles = ['bd'];
  }, QUEUE);

  await page.evaluate(() => window.goPage('sourced'));
  await page.waitForFunction(() => !(STATE.sourced || {}).loading && (STATE.sourced.list || []).length, { timeout: 5000 });

  const html = await page.evaluate(() => document.getElementById('content').innerHTML);

  step('The queue lists sourced openings', /Senior Java Developer/.test(html) && /Data Engineer/.test(html));
  step('The company is shown', /Fidelity Investments/.test(html));
  // The whole point of the feature: know why to call before calling.
  step('It says WHY to call, in plain words',
    /Why call them/.test(html) && /live about 74 days and reposted 2 times/.test(html));
  step('The reason is also summarised as a chip', /Hard to fill/.test(html) && /Team build/.test(html));
  step('Reposts and sightings are reported separately and honestly',
    /reposted 2×/.test(html) && /seen 12×/.test(html), 'neither should be conflated');
  step('Parsed skills are shown', /Spring Boot/.test(html));
  step('A row with no contact says so', /no contact yet/.test(html));
  step('A row with a contact says how many', /1 possible contact/.test(html));
  step('Status filters carry counts', /To review \(2\)/.test(html) && /Already have \(1\)/.test(html));
  step('Both tabs are offered', /Review queue/.test(html) && /Boards watched/.test(html));

  // ── nothing becomes a lead without a person ──────────────────────────────
  const postsBefore = await page.evaluate(() => window.__posts.length);
  step('Loading the queue creates nothing', postsBefore === 0, String(postsBefore));

  // ── the approve flow ─────────────────────────────────────────────────────
  await page.evaluate(() => window.srcdOpenApprove('s1'));
  const modal = await page.evaluate(() => STATE.modal || '');
  step('Reviewing opens a confirmation rather than adding immediately', /Add this as a lead/.test(modal));
  step('The outreach opener is shown before approving', /Opening line for outreach/.test(modal));
  step('It explains that the opener becomes the first email', /what the first email will lead with/.test(modal));
  // An inferred address is a guess; the UI must not imply otherwise.
  step('A role mailbox is labelled as a company mailbox, not a person', /company mailbox/.test(modal));
  step('Contact confidence is stated as a percentage', /about 35% likely/.test(modal));
  step('It states that nothing is emailed yet', /Nothing is emailed now/.test(modal));
  step('Contacts are opt-in (unticked by default)', !/checked/.test(modal), 'no contact should be pre-selected');

  // Working out an email on demand.
  await page.evaluate(() => window.srcdFindContacts());
  await page.waitForFunction(() => (STATE.sourced.approving || {}).busy === false, { timeout: 5000 });
  const modal2 = await page.evaluate(() => STATE.modal || '');
  step('Working out an email calls the server', await page.evaluate(() => window.__posts.some(p => /find-contacts/.test(p[0]))));
  step('A guessed personal address is shown', /priya\.raman@fidelity\.com/.test(modal2));
  step('...and is labelled as a guess, not a fact', /guessed from the usual pattern/.test(modal2), modal2.slice(0, 0));

  // Approving with a chosen contact.
  await page.evaluate(() => window.srcdToggleContact('priya.raman@fidelity.com'));
  await page.evaluate(() => window.srcdConfirmApprove());
  await page.waitForFunction(() => (STATE.sourced.list || []).every(r => r.id !== 's1'), { timeout: 5000 });
  const approveCall = await page.evaluate(() => window.__posts.find(p => /\/approve$/.test(p[0])));
  step('Approving posts to the approve endpoint', Boolean(approveCall), JSON.stringify(approveCall));
  step('Only the ticked contact is attached',
    approveCall && approveCall[1].contacts.length === 1 && approveCall[1].contacts[0].email === 'priya.raman@fidelity.com',
    JSON.stringify(approveCall && approveCall[1].contacts));
  step('The approved row leaves the queue', await page.evaluate(() => (STATE.sourced.list || []).length === 1));

  // ── dismissing ───────────────────────────────────────────────────────────
  await page.evaluate(() => window.srcdReject('s2', null));
  await page.waitForFunction(() => (STATE.sourced.list || []).length === 0, { timeout: 5000 });
  step('Dismissing removes it from the queue',
    await page.evaluate(() => window.__posts.some(p => /\/reject$/.test(p[0]))));

  // ── the empty state teaches rather than shrugs ───────────────────────────
  await page.evaluate(() => { window.__queue = { results: [], counts: {}, not_configured: true }; });
  await page.evaluate(() => window.goPage('sourced'));
  await page.waitForFunction(() => !(STATE.sourced || {}).loading, { timeout: 5000 });
  const empty = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('With nothing set up it explains what to do', /No boards being watched yet/.test(empty));
  step('...and names the boards it can read', /Greenhouse/.test(empty) && /Lever/.test(empty));

  // ── the sources tab ──────────────────────────────────────────────────────
  await page.evaluate(() => window.srcdSetView('sources'));
  await page.evaluate(() => window.srcdToggleAdd());
  const sources = await page.evaluate(() => document.getElementById('content').innerHTML);
  step('A board can be added', /Watch a new board/.test(sources) && /srcdAddSource/.test(sources));
  step('A board can be tested before saving', /srcdTest/.test(sources), 'the likeliest setup mistake is a wrong board name');
  step('The board-name hint is shown', /job-boards\.greenhouse\.io/.test(sources));

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log('\n=== SOURCED LEADS PAGE SMOKE ===');
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
