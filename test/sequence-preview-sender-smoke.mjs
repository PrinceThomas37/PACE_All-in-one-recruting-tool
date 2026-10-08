// THE SEQUENCE PREVIEW SPEAKS AS THE EMAIL ID, NOT THE PROFILE NAME (owner, 8 Oct, screenshot: "it's taking the profile name instead of the email
// ID name from which the emails are being sent … we solved this earlier, it's appearing again")
//   * {{sender}} / {{senderemail}} / {{sendercompany}} in a sequence step's preview are filled from one of the person's OWN email IDs
//   * with several, a "filled in as" picker chooses which; with none, the field is MARKED — the profile name is never used
// Usage: node test/sequence-preview-sender-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const SERVER_VARS = [...require('../services/sequence-draft.js').ALLOWED_VARS].sort();

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
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(() => {
    window.apiPost = () => Promise.resolve({ id: 'wf-1' }); window.apiPut = () => Promise.resolve({ id: 'wf-1' }); window.loadWorkflows = () => {};
    STATE.user.name = 'BD Lead 1';                       // the PROFILE name — must never appear as the sender
    STATE.userEmailsCache = STATE.userEmailsCache || {};
    STATE.userEmailsCache[STATE.user.id] = [
      { id: 'm1', email_address: 'amy@alpha.test', display_name: 'Amy Alpha', is_active: true, is_primary: true, sends_as: { company: 'Alpha Staffing' } },
      { id: 'm2', email_address: 'amy@beta.test', display_name: 'Amy Beta', is_active: true, sends_as: {} } ];
    STATE.page = 'email'; STATE.emailTab = 'sequence';
    wfOpenBuilder();
  });
  await page.waitForSelector('.seq-modal');
  await page.evaluate(() => [...document.querySelectorAll('.seq-seg')].find(b => /Write it for this step/.test(b.textContent)).click());
  await page.evaluate(() => { const b = document.getElementById('wf-body-0'); b.value = "Hi {{fn}}, I'm {{sender}} ({{senderemail}}) at {{sendercompany}}."; b.dispatchEvent(new Event('input', { bubbles: true })); });
  const prev = () => page.evaluate(() => document.getElementById('wf-prev-0').innerText.replace(/\s+/g, ' '));
  let t = await prev();
  step('the preview names the PRIMARY email ID\'s name — not the profile name', /I'm Amy Alpha/.test(t) && !/BD Lead 1/.test(t), t.slice(0, 160));
  step('…its address and its company too', /amy@alpha\.test/.test(t) && /at Alpha Staffing/.test(t));
  step('with two email IDs a picker says which one it is filled in as', await page.evaluate(() => { const s = document.querySelector('#wf-prev-0 .seq-prev-as select'); return !!s && s.options.length === 2; }));
  await page.evaluate(() => { const s = document.querySelector('#wf-prev-0 .seq-prev-as select'); s.value = 'm2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  t = await prev();
  step('choosing the other email ID changes the name and address', /I'm Amy Beta/.test(t) && /amy@beta\.test/.test(t) && !/Amy Alpha/.test(t), t.slice(0, 160));
  step('…and an email ID with no company said leaves {{sendercompany}} MARKED, never blank', await page.evaluate(() => [...document.querySelectorAll('#wf-prev-0 .seq-bad')].some(m => /sendercompany/.test(m.textContent))));
  await page.evaluate(() => { STATE.userEmailsCache[STATE.user.id] = []; wfPreviewAs(''); });
  t = await prev();
  step('with NO email ID connected the name is marked as unfilled — the profile name is never used instead', !/BD Lead 1/.test(t) && await page.evaluate(() => [...document.querySelectorAll('#wf-prev-0 .seq-bad')].some(m => /\{\{sender\}\}/.test(m.textContent))), t.slice(0, 160));
  step('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { console.error(e); results.push(false); console.log('[FAIL] crashed — ' + e.message); }
finally { await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
