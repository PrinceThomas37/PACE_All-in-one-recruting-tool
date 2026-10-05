// SEVERAL EMAILS AND PHONES ON A LEAD'S CONTACT (R-114 stage 2, D-0070) — the lead row, in a real browser.
//
// The owner: the same main-plus-extras for lead contacts. On a lead's opened row each contact shows its
// main email and phone, then its extras with "Make main" and ✕, and "+ add another email / number". It is a
// LIVE place: each gesture is saved at once through PUT /contacts/:id and the list is reloaded.
//
//   * the contact row shows the phone it never showed, the extras under the main, and the add links
//   * "+ add another number" opens one input with the cursor in it; Enter saves ONE PUT with the full list
//   * "Make main" is one PUT carrying the new main and the swapped extras; the row then shows the new main
//   * ✕ removes at once
//   * a refusal (an opted-out address) is said in a sentence and the row shows the server's truth
//   * the opened row stays OPEN through every save (a refresh must not snap it shut)
//   * a phone: nothing overflows sideways; targets are big enough
//
// Usage: node test/lead-contact-cp-ui-smoke.mjs   (CP_SHOT_DIR=… keeps screenshots)
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
const SHOTS = process.env.CP_SHOT_DIR || '';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);

  await ev(() => {
    window.__calls = []; window.__toasts = []; window.__putError = null;
    window.__raw = [{ id: 'j1', position: 'Senior Developer', stage: 'Assigned', company: { id: 'co1', name: 'Acme Build', website: 'acmebuild.com' }, company_name: 'Acme Build',
      assigned_to_bd: STATE.user.id, created_by: STATE.user.id, industry: 'Construction', created_at: new Date().toISOString(),
      contacts: [
        { id: 'c1', job_id: 'j1', first_name: 'Maria', last_name: 'Lopez', designation: 'HR Director', email: 'maria@acme.com', phone: '(555) 111-2222', extra_emails: ['maria2@acme.com'], extra_phones: [], is_primary: true, email_status: 'valid' },
        { id: 'c2', job_id: 'j1', first_name: 'John', last_name: 'Carter', designation: 'GM', email: 'john@acme.com', phone: '', extra_emails: [], extra_phones: [], is_primary: false, email_status: 'valid' },
      ] }];
    window.apiGet = (u) => {
      window.__calls.push(['GET', u]);
      if (u === '/jobs') return Promise.resolve(JSON.parse(JSON.stringify(window.__raw)));
      return Promise.reject(new Error('not stubbed: ' + u));   // the POC finder's answer never arrives → the plain contact list shows
    };
    window.apiPut = (u, b) => {
      window.__calls.push(['PUT', u, JSON.parse(JSON.stringify(b || {}))]);
      if (window.__putError) { const e = window.__putError; window.__putError = null; return Promise.reject(new Error(e)); }
      const id = u.split('/')[2];
      const c = window.__raw[0].contacts.find(x => x.id === id); if (c) Object.assign(c, b);
      return Promise.resolve({});
    };
    window.showToast = (m, t) => { window.__toasts.push([m, t]); };
    STATE.jobs = window.__raw.map(normaliseJob); STATE.contacts = flattenContacts(window.__raw); STATE.leads = STATE.jobs;
    STATE.page = 'leads'; render();
  });
  await page.waitForTimeout(300);
  await ev(() => { const el = document.querySelector('#content tr[data-row-id="j1"] td:nth-child(3)'); if (el) el.click(); });
  await page.waitForSelector('.lx-contact .lx-cp', { timeout: 6000 });

  const maria = () => ev(() => { const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); return r ? { text: r.innerText.replace(/\s+/g, ' '), vals: Array.from(r.querySelectorAll('.cp-val')).map(v => v.textContent.trim()), adds: Array.from(r.querySelectorAll('.cp-add')).map(b => b.textContent.trim()) } : null; });
  let m = await maria();
  step('the contact row now shows the phone it never showed', m && /☎ \(555\) 111-2222/.test(m.text), m && m.text.slice(0, 160));
  step('…the extra email under the main, and both add links', m && same(m.vals, ['maria2@acme.com']) && same(m.adds, ['+ add another email', '+ add another number']), JSON.stringify(m));
  step('the open row is on screen (the lead is expanded)', await ev(() => !!document.querySelector('tr.row-exp')));
  if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, 'lead-contact-desktop.png') }); }

  // add a number
  await ev(() => { const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); r.querySelector('.cp-add:nth-of-type(1)'); const b = Array.from(r.querySelectorAll('.cp-add')).find(x => /number/.test(x.textContent)); b.click(); });
  await page.waitForTimeout(150);
  step('"+ add another number" opens one input with the cursor in it', await ev(() => /^cp-lc.*-phone-new$/.test((document.activeElement || {}).id || '')), await ev(() => (document.activeElement || {}).id));
  await page.keyboard.type('(555) 333-4444'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.lx-contact .cp-val')).some(v => /333-4444/.test(v.textContent)), null, { timeout: 4000 }).catch(() => {});   // the list reloads, then the row repaints
  let put = await ev(() => window.__calls.filter(c => c[0] === 'PUT').pop());
  step('Enter SAVES AT ONCE: one PUT to this contact with the full extras list', put && put[1] === '/contacts/c1' && same(put[2], { extra_phones: ['(555) 333-4444'] }), JSON.stringify(put));
  m = await maria();
  step('…and the row shows it, still open', m && m.vals.includes('(555) 333-4444') && await ev(() => !!document.querySelector('tr.row-exp')), JSON.stringify(m && m.vals));

  // make main
  await ev(() => { const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); r.querySelector('[data-cp-row="email-0"] .cp-link').click(); });
  await page.waitForTimeout(500);
  put = await ev(() => window.__calls.filter(c => c[0] === 'PUT').pop());
  step('MAKE MAIN: one PUT carrying the new main and the swapped extras', put && same(put[2], { email: 'maria2@acme.com', extra_emails: ['maria@acme.com'] }), JSON.stringify(put && put[2]));
  m = await maria();
  step('…the row shows the new main and the old one as an extra', m && /maria2@acme\.com/.test(m.text.split('maria@')[0] || m.text) && m.vals.includes('maria@acme.com'), JSON.stringify(m));
  step('…the lead is STILL open (a refresh must not snap it shut)', await ev(() => !!document.querySelector('tr.row-exp')));

  // a refusal
  await ev(() => { window.__putError = 'That address opted out of email from us, so it cannot be the main address.'; window.__toasts.length = 0; const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); r.querySelector('[data-cp-row="email-0"] .cp-link').click(); });
  await page.waitForTimeout(500);
  const toasts = await ev(() => window.__toasts);
  step('SAFETY: a refused switch is said in a sentence', toasts.some(t => /opted out/.test(t[0]) && t[1] === 'error'), JSON.stringify(toasts));
  m = await maria();
  step('…and the row still shows the server\'s truth (nothing pretended)', m && /maria2@acme\.com/.test(m.text) && m.vals.includes('maria@acme.com'));

  // remove
  await ev(() => { const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); r.querySelector('[data-cp-row="phone-0"] .cp-x').click(); });
  await page.waitForTimeout(500);
  put = await ev(() => window.__calls.filter(c => c[0] === 'PUT').pop());
  step('✕ removes at once (one PUT, the list without it)', put && same(put[2], { extra_phones: [] }), JSON.stringify(put && put[2]));

  // John has none: a calm row, add links only
  const john = await ev(() => { const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /John/.test(x.textContent)); return { vals: r.querySelectorAll('.cp-val').length, adds: r.querySelectorAll('.cp-add').length, tel: /☎/.test(r.textContent) }; });
  step('a contact with no extras and no phone shows only the two add links (calm)', john.vals === 0 && john.adds === 2 && !john.tel, JSON.stringify(john));

  // phone
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(700);
  const ph = await ev(() => { const c = document.getElementById('content'); const r = Array.from(document.querySelectorAll('.lx-contact')).find(x => /Maria/.test(x.textContent)); const rr = r.getBoundingClientRect(); const btn = r.querySelector('.cp-link,.cp-add').getBoundingClientRect();
    return { over: c.scrollWidth - c.clientWidth, right: Math.round(rr.right), vw: innerWidth, btnH: Math.round(btn.height) }; });
  step('phone: nothing overflows sideways', ph.over <= 1 && ph.right <= ph.vw + 1, JSON.stringify(ph));
  step('phone: the links are big enough to hit (>= 32px)', ph.btnH >= 32, 'height ' + ph.btnH);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'lead-contact-phone.png') });
  step('No page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (e) {
  step('suite ran to the end', false, String(e && e.stack || e).slice(0, 500));
} finally {
  if (browser) await browser.close();
  server.close();
}
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length} passed`);
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
