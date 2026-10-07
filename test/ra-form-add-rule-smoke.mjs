// THE RA LEAD FORM ASKS THE SERVER "CAN THIS COMPANY BE ADDED?" (R-157, D-0085, D-0090).
// The form used to carry its own copy of the cooldown: a HARD-CODED 21 days over only the leads this person could
// see, and it created a brand-new company record BEFORE anything checked whether the company already existed.
// Now the one rule is on the server (services/lead-decision.js) and the form only asks and shows:
//   * picking a company, or leaving the name/website, asks POST /lead-check; a refusal appears under the name with
//     the reason and the owner;
//   * Submit asks again BEFORE anything is written: a refused lead creates no company and no lead;
//   * a company already on file (same website, LinkedIn page or name) that is free is REUSED — no second record;
//   * editing a lead is not adding one, so it is never refused by this rule.
// Usage: node test/ra-form-add-rule-smoke.mjs
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
let pass = 0, fail = 0;
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
const settle = (page) => page.waitForTimeout(350);

const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => {
    if (e) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const findChromium = () => process.env.PLAYWRIGHT_CHROMIUM
  || (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'))
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');

const BLOCKED = {
  blocked: true, state: 'active_job', company_id: 'c1', company_name: 'Acme, Inc.', matched_text: 'website',
  sentence: 'Acme, Inc. already has an active lead (Staff Accountant), owned by Marcus Bell. A company with an active lead cannot be added again — speak to Marcus Bell. Matched on its website.',
};
const ON_FILE = { blocked: false, state: 'free', company_id: 'c7', company_name: 'Acme, Inc.', matched_on: ['website'], matched_text: 'website' };

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  // The form, with the network stubbed. window.__answer is what the server says to /lead-check.
  const openForm = (answer) => page.evaluate((ans) => {
    STATE.user.role = 'ra'; STATE.user.roles = ['ra'];
    window.__posted = []; window.__toasts = []; window.__answer = ans;
    const rt = window.showToast;
    window.showToast = function (m, k) { window.__toasts.push(String(m)); if (rt) try { rt(m, k); } catch (e) {} };
    window.apiGet = () => Promise.resolve([]);
    window.apiPost = function (p, b) {
      window.__posted.push({ path: p, body: b });
      if (p === '/lead-check') return Promise.resolve(window.__answer);
      if (p === '/contacts/check-email') return Promise.resolve({ duplicate: false });
      if (p === '/companies') return Promise.resolve({ id: 'co-new', name: (b && b.name) || '' });
      return Promise.resolve({ id: 'x' });
    };
    window.apiPut = (p, b) => { window.__posted.push({ path: p, body: b }); return Promise.resolve({}); };
    window.refreshJobs = () => {};
    STATE.jobs = STATE.jobs || [];
    if (window.raFormClear) raFormClear();
    goPage('leads');
  }, answer);
  const fillValid = async (company, website) => {
    await page.waitForSelector('#poc-ra', { timeout: 8000 });
    await page.fill('#ra-co-name', company);
    if (website) await page.fill('input[placeholder="Website"]', website);
    await page.fill('#ra-location', 'Houston, TX');
    await page.evaluate(() => { STATE.raForm.position = 'Staff Accountant'; });
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-ra input[placeholder="Email address *"]', 'dana@acme.com');
    await settle(page);
  };
  const posted = () => page.evaluate(() => window.__posted);

  console.log('\nThe RA lead form and the add rule');

  await ta('the form no longer carries its own 21-day copy of the rule', async () => {
    await openForm({ blocked: false, company_id: null });
    await page.waitForSelector('#poc-ra', { timeout: 8000 });
    const has = await page.evaluate(() => typeof window.companyCooldownCheck === 'function' || /21-day cooldown/.test(document.body.innerHTML));
    assert.equal(has, false, 'a hard-coded cooldown is still on the page');
  });

  await ta('leaving the company name asks the server about the name AS TYPED, and a refusal appears under it with the reason and owner', async () => {
    await openForm(BLOCKED);
    await page.waitForSelector('#poc-ra');
    await page.fill('#ra-co-name', 'Acme Inc');
    await page.fill('input[placeholder="Website"]', 'acme.com');       // moving focus off the name box
    await page.waitForTimeout(700);
    const ask = (await posted()).find(x => x.path === '/lead-check');
    assert.ok(ask, 'the server was never asked');
    assert.equal(ask.body.name, 'Acme Inc');
    const html = await page.evaluate(() => document.getElementById('content').innerHTML);
    assert.match(html, /Cannot add this company yet/);
    assert.match(html, /owned by Marcus Bell/);
    assert.match(html, /ld-box is-stop/);
  });

  await ta('Submit with a refused company writes NOTHING: no company, no lead — and the toast says why', async () => {
    await openForm(BLOCKED);
    await fillValid('Acme Inc', 'acme.com');
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const p = await posted();
    assert.ok(p.some(x => x.path === '/lead-check'), 'the server was not asked at submit');
    assert.ok(!p.some(x => x.path === '/companies'), 'a company record was created for a lead that was refused');
    assert.ok(!p.some(x => x.path === '/jobs'), 'a lead was written although the company was refused');
    const toasts = await page.evaluate(() => window.__toasts);
    assert.ok(toasts.some(t => /owned by Marcus Bell/.test(t)), 'the toast did not say why: ' + toasts.join(' | '));
    const submitting = await page.evaluate(() => STATE.raFormSubmitting);
    assert.equal(submitting, false, 'the form is stuck on "submitting"');
  });

  await ta('a company already on file and free is REUSED: the lead goes on that company and no second company is created', async () => {
    await openForm(ON_FILE);
    await fillValid('Acme Incorporated', 'acme.com');
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const p = await posted();
    assert.ok(!p.some(x => x.path === '/companies'), 'a duplicate company record was created');
    const lead = p.find(x => x.path === '/jobs');
    assert.ok(lead, 'no lead posted: ' + JSON.stringify(await page.evaluate(() => window.__toasts)));
    assert.equal(lead.body.company_id, 'c7');
  });

  await ta('…and the form says so BEFORE Submit: "Already on file as …", free to add, joins that company', async () => {
    await openForm(ON_FILE);
    await page.waitForSelector('#poc-ra');
    await page.fill('#ra-co-name', 'Acme Incorporated');
    await page.fill('input[placeholder="Website"]', 'acme.com');
    await page.waitForTimeout(700);
    const html = await page.evaluate(() => document.getElementById('content').innerHTML);
    assert.match(html, /Already on file as Acme, Inc\./);
    assert.match(html, /instead of creating a second one/);
    assert.ok(!/Cannot add this company yet/.test(html));
  });

  await ta('a brand-new company is still created, then the lead — exactly as before', async () => {
    await openForm({ blocked: false, company_id: null });
    await fillValid('Brand New Co', 'brandnew.example');
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const p = await posted();
    const iCo = p.findIndex(x => x.path === '/companies'), iJob = p.findIndex(x => x.path === '/jobs');
    assert.ok(iCo >= 0 && iJob > iCo, 'company then lead expected: ' + p.map(x => x.path).join(' → '));
    assert.equal(p[iJob].body.company_id, 'co-new');
  });

  await ta('picking a company from the suggestions asks the server about THAT company record', async () => {
    await openForm(BLOCKED);
    await page.waitForSelector('#poc-ra');
    await page.evaluate(() => {
      STATE.raFormCoSuggestions = [{ id: 'c1', name: 'Acme, Inc.', industry: 'Healthcare', location: 'Houston, TX', website: 'acme.com' }];
    });
    await page.fill('#ra-co-name', 'Acm');                 // opens the suggestion list through the form's own code path
    await page.evaluate(() => { STATE.raFormCoSuggestions = [{ id: 'c1', name: 'Acme, Inc.', industry: 'Healthcare', location: 'Houston, TX', website: 'acme.com' }]; if (window._patchCoSuggestions) window._patchCoSuggestions(); });
    const pickable = await page.$('._co-sug');
    if (pickable) { await pickable.dispatchEvent('mousedown'); }
    else { await page.evaluate(() => { STATE.raForm.coId = 'c1'; STATE.raForm.coName = 'Acme, Inc.'; STATE.raForm._decKey = null; raFormCheckNow(); }); }
    await page.waitForTimeout(700);
    const asks = (await posted()).filter(x => x.path === '/lead-check');
    assert.ok(asks.some(a => a.body.company_id === 'c1'), 'the pick did not ask about company c1: ' + JSON.stringify(asks.map(a => a.body)));
  });

  await ta('EDITING a lead is never refused by the add rule (it used to refuse an edit because the lead being edited was itself "recent")', async () => {
    await openForm(BLOCKED);
    await fillValid('Acme Inc', 'acme.com');
    await page.evaluate(() => { STATE.raForm.editJobId = 'job-77'; STATE.raForm.coId = 'c1'; window.__posted = []; });
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const p = await posted();
    assert.ok(!p.some(x => x.path === '/lead-check'), 'an edit asked the add rule');
    assert.ok(p.some(x => x.path === '/jobs/job-77'), 'the edit was not saved: ' + p.map(x => x.path).join(' → '));
  });

  await ta('the page threw no errors', async () => { assert.deepEqual(pageErrors, []); });
} catch (e) {
  fail++; console.log('  ✗ harness — ' + e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
