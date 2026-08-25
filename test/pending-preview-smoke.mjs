// The pending-email preview must never show a raw {{sender}} to the user.
//
// The queued body keeps {{sender}} in storage until it is sent, so GET /emails
// renders it before any screen sees it. This drives the real page with the shape
// that endpoint returns and asserts no token survives to the screen — the
// failure the owner hit that made them stop sending.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

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

// Exactly what GET /emails returns now: subject/body already rendered from the
// sending mailbox, with that mailbox attached.
const mailbox = { id: 'mb-1', email_address: 'prince.thomas@futeglobal.com', display_name: 'Prince Thomas' };
const rendered = {
  id: 'pe-1', to_email: 'josuesolis@leesair.com', status: 'pending',
  subject: 'A question about your HVAC Service Manager opening in Las Vegas, NV',
  body: "Hi Josue,\n\nIs your HVAC Service Manager role in Las Vegas, NV still open? I ask because I'm Prince Thomas at Fute Global LLC, and after reading the job description I have a shortlist of people who fit it well.\n\nOpen to a quick look at a couple of profiles?",
  contact: { first_name: 'Josue', last_name: 'Solis' },
  sending_email: mailbox,
  job: { id: 'job-1', position: 'HVAC Service Manager', timezone: 'PST', company: { name: "Lee's Air" }, sending_email: mailbox }
};

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');

  await page.evaluate((pe) => {
    window.STATE.pendingEmails = [pe];
    window.STATE.emailTab = 'pending';
    window.STATE.previewPendingId = pe.id;
    window.STATE.page = 'email';
    window.render();
  }, rendered);
  await page.waitForSelector('#content', { timeout: 15000 });

  const text = await page.evaluate(() => document.getElementById('content').innerText);
  step('the preview panel is on screen', text.includes('Email Preview'), text.slice(0, 80));
  step('the preview shows the real sender name', text.includes("I'm Prince Thomas"));
  step('no {{sender}} token reaches the screen', !text.includes('{{'), (text.match(/{{\w+}}/g) || []).join(','));
  step('the subject line renders too', text.includes('A question about your HVAC Service Manager'));

  // The edit modal is handed the same rendered text — a token must not appear
  // there either, since that is a box the user reads and types in.
  await page.evaluate(() => window.openEditPendingEmail('pe-1'));
  await page.waitForTimeout(150);
  const modalBody = await page.evaluate(() => (document.getElementById('edit-pe-body') || {}).value || '');
  const modalSubj = await page.evaluate(() => (document.getElementById('edit-pe-subj') || {}).value || '');
  step('the edit modal opens with the email in it', modalBody.length > 0);
  step('the edit box shows the real name, not a token',
    modalBody.includes("I'm Prince Thomas") && !modalBody.includes('{{') && !modalSubj.includes('{{'));

  step('the page threw no errors', pageErrors.length === 0, pageErrors.join(' | '));

  if (process.env.SHOT_PATH) {
    await page.evaluate(() => window.closeModal && window.closeModal());
    await page.waitForTimeout(150);
    await page.screenshot({ path: process.env.SHOT_PATH, fullPage: true });
  }
} catch (e) {
  step('test harness completed', false, String(e && e.message || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
