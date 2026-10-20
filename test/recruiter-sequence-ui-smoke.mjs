// A RECRUITER HAS A SEQUENCE BUILDER FOR CANDIDATES (owner, 20 Oct: "I don't see any sequence builder for recruiter profiles"), on the real page:
//   the Email page has a Sequence tab for a recruiter; it lists candidate sequences only (not lead sequences); "+ New sequence" goes
//   straight to the candidates builder (a recruiter is not asked "leads or candidates"); only the recruiter's own sequence has Edit.
//   and My Setup shows an OPTIONAL "Write a candidate sequence" step that is not counted in "N of M done".
// Usage: node test/recruiter-sequence-ui-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const results = [];
const SHOTS = process.env.SHOTS || '';   // SHOTS=dir saves pictures for the owner
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name) }); } };
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}


let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'recruiter');
  await page.evaluate(() => {
    const me = STATE.user.id;
    const defs = [
      { id: 'd1', name: 'Candidates — Houston', entity_type: 'submission', status: 'active', created_by: me, steps: [{ step_order: 1, channel: 'candidate_email', config: { subject: 'x', body: 'y' } }], version: 2 },
      { id: 'd2', name: 'Sales outreach standard', entity_type: 'contact', status: 'active', created_by: 'someone', steps: [{ step_order: 1, channel: 'email', config: {} }] },
      { id: 'd3', name: 'Candidates — standard', entity_type: 'submission', status: 'active', created_by: 'boss', steps: [{ step_order: 1, channel: 'candidate_email', config: {} }] },
    ];
    window.apiGet = function (p) {
      if (/^\/wf\/definitions/.test(p)) return Promise.resolve(defs);
      if (/^\/my-setup\/send-window/.test(p)) return Promise.resolve({ prefs: {}, days: ['mon','tue','wed','thu','fri'], org: { start: 8, end: 16 }, effective: { days: null, start: 8, end: 16, narrowed: false } });
      if (/^\/smtp\/enabled/.test(p)) return Promise.resolve({ enabled: false });
      if (/^\/wf\/(enrollments|stats|channels|primary)/.test(p)) return Promise.resolve(/stats/.test(p) ? { by_workflow: {}, total: 0 } : (/channels/.test(p) ? { channels: [], catalogue: [] } : []));
      return Promise.resolve([]);
    };
    window.__built = null;
    window.openSequenceBuilder = function (o) { window.__built = o; };
  });
  await page.evaluate(() => { STATE.emailTab = 'compose'; window.goPage('email'); });
  await page.waitForTimeout(300);
  step('a recruiter\'s Email page has a Sequence tab', await page.evaluate(() => [...document.querySelectorAll('#content .pgtab')].some(t => /^Sequence/.test(t.textContent.trim()))));
  await page.evaluate(() => window.setEmailTab('sequence'));
  await page.waitForFunction(() => !!STATE.wf, { timeout: 8000 });
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('it lists candidate sequences', /Candidates — Houston/.test(t) && /Candidates — standard/.test(t), t.slice(0, 200));
  step('…and not the lead (sales) sequences', !/Sales outreach standard/.test(t) && await page.evaluate(() => !/Sales outreach standard/.test(document.getElementById('content').innerHTML)));
  step('there is a "+ New sequence" button', await page.evaluate(() => !!document.querySelector('[data-wf-new]')));
  step('only the recruiter\'s own sequence has Edit', await page.evaluate(() => /Edit/.test((document.querySelector('[data-wfcard="d1"]') || {}).innerText || '') && !/Edit/.test((document.querySelector('[data-wfcard="d3"]') || {}).innerText || '')));
  await page.evaluate(() => document.querySelector('[data-wf-new]').click());
  await page.waitForTimeout(200);
  step('"+ New sequence" opens the CANDIDATES builder straight away (no "leads or candidates?" question)', await page.evaluate(() => !!window.__built && window.__built.entity_type === 'submission' && !document.querySelector('[data-wf-who]')), JSON.stringify(await page.evaluate(() => window.__built)));
  // ── My Setup: an optional step, never counted ──
  await page.evaluate(() => { STATE.myOutreachPlan = null; window.goPage('mysetup'); });
  await page.waitForTimeout(500);
  const ms = await page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step('My Setup for a recruiter offers "Write a candidate sequence (optional)"', /Write a candidate sequence \(optional\)/.test(ms), ms.slice(0, 300));
  step('…and it is NOT counted: the heading counts the mailbox steps only', /0 of 2 done/.test(ms), ms.slice(0, 200));
  step('…it knows they already made one (their own candidate sequence exists)', /You have a sequence for candidates/.test(ms));
  step('…and its button goes to the Sequence tab', await page.evaluate(() => { window.mySetupOpenCandSeq(); return STATE.page === 'email' && STATE.emailTab === 'sequence'; }));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the page part ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
