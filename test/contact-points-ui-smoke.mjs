// SEVERAL EMAILS AND PHONES PER CANDIDATE — THE THREE SCREENS (R-114, D-0070), in a real browser.
//
// The owner: one MAIN you can switch with a tick or a click, plus extras — in Add Candidate,
// Edit Candidate AND the candidate's header; a résumé upload offers what else it found as
// extras for the user to confirm (nothing silent); duplicates show every address.
//
//   part 1 — Add Candidate: "+ add another" (focused, the form is not redrawn so the scroll stays), Make main swaps
//            the main and the extra in the form, ✕ removes
//   part 2 — a résumé upload: main filled from the first, the rest OFFERED ticked (not in the
//            form until saved), an unticked one is NOT saved
//   part 3 — a duplicate warning lists every address of the person it matched
//   part 4 — Edit Candidate carries the person's existing extras and saves them back
//   part 5 — the candidate header: add / Make main / ✕ each SAVE at once through PUT; a refusal
//            (an address that opted out cannot be the main) is said, and the header reloads
//   part 6 — the browser's swap equals the server's makeMain on the same cases (no drift)
//   part 7 — a phone: nothing overflows sideways; screenshots (light, dark, phone)
//
// Usage: node test/contact-points-ui-smoke.mjs   (CP_SHOT_DIR=… keeps the screenshots)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const serverCp = require('../services/contact-points.js');

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
  await enterApp(page, 'recruiter');
  const ev = (f, a) => page.evaluate(f, a);

  // A fake API the page talks to; every write is recorded.
  await ev(() => {
    window.__calls = []; window.__toasts = [];
    window.__server = { candidate: { id: 'c1', full_name: 'Jane Doe', candidate_code: 'CN-0001', email: 'jane@old.com', phone: '(555) 111-2222',
      extra_emails: ['jane@new.com', 'jane@third.com'], extra_phones: ['(555) 987-6543'], owner: { name: 'Rita' } } };
    window.__nextPost = null; window.__putError = null;
    window.apiGet = (u) => {
      window.__calls.push(['GET', u]);
      if (/\/candidates\/check-duplicate/.test(u)) return Promise.resolve({ duplicate: true, duplicates: [{ id: 'c9', full_name: 'Priya Nair', candidate_code: 'CN-9', email: 'p@old.org', extra_emails: ['priya.nair@work.io'], phone: '', extra_phones: ['(555) 987-6543'], current_title: 'Engineer' }] });
      if (/\/history$/.test(u)) return Promise.resolve({ pipeline: [], submissions: [], activity: [] });
      if (/\/(notes|email-activity|documents)$/.test(u)) return Promise.resolve([]);
      if (/^\/candidates\/c1$/.test(u)) return Promise.resolve(JSON.parse(JSON.stringify(window.__server.candidate)));
      return Promise.resolve([]);
    };
    window.apiPost = (u, b) => {
      window.__calls.push(['POST', u, JSON.parse(JSON.stringify(b || {}))]);
      if (u === '/candidates/parse-resume') return Promise.resolve({ fields: { full_name: 'Priya Nair', email: 'priya@home.com', phone: '(555) 123-4567' }, used_ai: false, resume_text: 'Priya Nair',
        contacts: { emails: ['priya@home.com', 'priya.nair@work.io', 'p.nair@old.org'], phones: ['(555) 123-4567', '+1 555.987.6543'] } });
      if (u === '/candidates' && window.__nextPost) { const e = window.__nextPost; window.__nextPost = null; return Promise.reject(new Error(e)); }
      if (u === '/candidates') return Promise.resolve({ id: 'cNew' });
      return Promise.resolve({});
    };
    window.apiPut = (u, b) => {
      window.__calls.push(['PUT', u, JSON.parse(JSON.stringify(b || {}))]);
      if (window.__putError) { const e = window.__putError; window.__putError = null; return Promise.reject(new Error(e)); }
      Object.assign(window.__server.candidate, b);
      return Promise.resolve({});
    };
    window.showToast = (m, t) => { window.__toasts.push([m, t]); };
    window.loadApplicants = function () {};
  });
  const calls = (m, u) => ev(([m, u]) => window.__calls.filter(c => c[0] === m && (u instanceof Object ? false : c[1].indexOf(u) === 0)), [m, u]);
  const lastCall = (m, u) => ev(([m, u]) => { const l = window.__calls.filter(c => c[0] === m && (c[1] === u || (u === '/candidates/check-duplicate' && c[1].indexOf(u) === 0))); return l[l.length - 1] || null; }, [m, u]);
  const form = () => ev(() => JSON.parse(JSON.stringify(STATE.ats.form)));
  const mainVal = (ph) => ev((ph) => { const i = Array.from(document.querySelectorAll('#layer .modal input.sel')).find(x => x.placeholder === ph); return i ? i.value : null; }, ph);
  const extraRows = (kind) => ev((kind) => Array.from(document.querySelectorAll('#layer .modal [data-cp="ats-' + kind + '"] .cp-row input')).map(i => i.value), kind);

  // ── part 1 — Add Candidate ────────────────────────────────────────────────
  await ev(() => atsOpenNew());
  await page.waitForSelector('#layer .modal');
  const labels = await ev(() => Array.from(document.querySelectorAll('#layer .modal label')).map(l => l.textContent.replace(/\s+/g, ' ').trim()));
  step('the window labels the main email and main phone as the MAIN', labels.some(l => /^Email \(main\)/.test(l)) && labels.some(l => /^Mobile \(main\)/.test(l)), labels.slice(0, 4).join(' | '));
  const addBtns = await ev(() => Array.from(document.querySelectorAll('#layer .modal .cp-add')).map(b => b.textContent.trim()));
  step('"+ add another email" and "+ add another number" are offered', same(addBtns, ['+ add another email', '+ add another number']), JSON.stringify(addBtns));

  await page.fill('#layer .modal input[placeholder="jane@example.com"]', 'jane@home.com');
  await page.fill('#layer .modal input[placeholder="(555) 123-4567"]', '(555) 111-2222');
  await page.click('#layer .modal .cp-add:has-text("another email")');
  step('"+ add another email" adds a row and puts the cursor in it', await ev(() => document.activeElement && document.activeElement.id === 'cp-ats-email-0'), await ev(() => document.activeElement && document.activeElement.id));
  await page.keyboard.type('jane@work.io');
  await page.click('#layer .modal .cp-add:has-text("another email")');
  await page.keyboard.type('jane3@x.com');
  await page.click('#layer .modal .cp-add:has-text("another number")');
  await page.keyboard.type('(555) 333-4444');
  let f = await form();
  step('what is typed lands in the form as extras (main untouched)', f.email === 'jane@home.com' && same(f.extra_emails, ['jane@work.io', 'jane3@x.com']) && same(f.extra_phones, ['(555) 333-4444']) && f.phone === '(555) 111-2222', JSON.stringify([f.email, f.extra_emails, f.extra_phones]));
  step('the extras are drawn UNDER the main, with a Make main and a ✕ each', (await extraRows('email')).length === 2 && await ev(() => document.querySelectorAll('#layer .modal [data-cp="ats-email"] .cp-link').length === 2 && document.querySelectorAll('#layer .modal [data-cp="ats-email"] .cp-x').length === 2));

  // Make main (the owner's "tick or click")
  await page.click('#layer .modal [data-cp="ats-email"] [data-cp-row="email-0"] .cp-link');
  f = await form();
  step('MAKE MAIN: the clicked extra becomes the main and the old main takes its place', f.email === 'jane@work.io' && same(f.extra_emails, ['jane@home.com', 'jane3@x.com']), JSON.stringify([f.email, f.extra_emails]));
  step('…and the main box on screen shows it', (await mainVal('jane@example.com')) === 'jane@work.io');
  await page.click('#layer .modal [data-cp="ats-phone"] [data-cp-row="phone-0"] .cp-link');
  f = await form();
  step('MAKE MAIN works for the phone too', f.phone === '(555) 333-4444' && same(f.extra_phones, ['(555) 111-2222']), JSON.stringify([f.phone, f.extra_phones]));
  await page.click('#layer .modal [data-cp="ats-email"] [data-cp-row="email-1"] .cp-x');
  f = await form();
  step('✕ removes that extra only', same(f.extra_emails, ['jane@home.com']), JSON.stringify(f.extra_emails));

  // the window keeps its scroll. (The first row is near the top of a long form, so the test scrolls a
  // little — a user can only click a button they can SEE — and checks the redraw does not throw them to the top.)
  await page.click('#layer .modal .cp-add:has-text("another number")');   // so Make main has a row to act on
  await page.waitForTimeout(150);
  const scroller = '#layer .modal [style*="overflow-y:auto"]';
  const before = await ev((q) => { const b = document.querySelector(q); b.scrollTop = 70; return { can: b.scrollHeight > b.clientHeight, top: b.scrollTop }; }, scroller);
  await page.click('#layer .modal [data-cp="ats-phone"] [data-cp-row="phone-0"] .cp-link');   // Make main redraws the window, no focus move
  await page.waitForTimeout(200);
  const afterMain = await ev((q) => document.querySelector(q).scrollTop, scroller);
  step('Make main does not throw the user back to the top of a long form', before.can && before.top >= 60 && Math.abs(afterMain - before.top) <= 4, JSON.stringify({ before, afterMain }));
  await ev((q) => { document.querySelector(q).scrollTop = 70; }, scroller);
  await page.click('#layer .modal .cp-add:has-text("another number")');
  await page.waitForTimeout(200);
  const afterAdd = await ev((q) => document.querySelector(q).scrollTop, scroller);
  step('adding another does not move the form either, and the new box has the cursor', Math.abs(afterAdd - 70) <= 6 && await ev(() => /^cp-ats-phone-/.test(document.activeElement.id)), 'scrollTop ' + afterAdd);
  await page.keyboard.press('Escape');

  // ── part 2 — a résumé upload ──────────────────────────────────────────────
  await ev(() => { atsOpenNew(); STATE.ats._resumeStash = { name: 'cv.pdf', size: 10, type: 'application/pdf', data: 'data:application/pdf;base64,AAAA' }; atsParseResume(); });
  await page.waitForSelector('#layer .modal .cp-found');
  f = await form();
  step('the résumé fills the MAIN email and phone from the first of each', f.email === 'priya@home.com' && f.phone === '(555) 123-4567');
  const offered = await ev(() => Array.from(document.querySelectorAll('#layer .modal .cp-found label')).map(l => ({ text: l.textContent.replace(/\s+/g, ' ').trim(), on: l.querySelector('input').checked })));
  step('what else it found is OFFERED, ticked, and the main is not repeated in the offer',
    offered.length === 3 && offered.every(o => o.on) && !offered.some(o => /priya@home\.com|123-4567/.test(o.text)) && offered.some(o => /p\.nair@old\.org/.test(o.text)), JSON.stringify(offered));
  step('NOTHING is silently added: the form itself holds no extras yet', !(f.extra_emails || []).length && !(f.extra_phones || []).length, JSON.stringify([f.extra_emails, f.extra_phones]));
  step('the offer sits at the TOP of the window, next to the main email — not at the foot of a long form', await ev(() => { const m = document.querySelector('#layer .modal'); const f = m.querySelector('.cp-found').getBoundingClientRect(); const e = m.querySelector('[data-cp-main="ats-email"]').getBoundingClientRect(); return f.top < e.top && e.top - f.top < 260; }));
  if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, 'add-resume-found.png') }); }
  await page.uncheck('#layer .modal .cp-found label:has-text("p.nair@old.org") input');
  await page.click('#layer .modal button:has-text("Create candidate")');
  await page.waitForTimeout(150);
  const posted = await lastCall('POST', '/candidates');
  const pl = posted && posted[2];
  step('SAVE sends the ticked ones as extras and leaves out the unticked one', pl && same(pl.extra_emails, ['priya.nair@work.io']) && same(pl.extra_phones, ['+1 555.987.6543']) && pl.email === 'priya@home.com', JSON.stringify(pl && [pl.email, pl.extra_emails, pl.extra_phones]));

  // ── part 3 — a duplicate warning ──────────────────────────────────────────
  await ev(() => { atsOpenNew(); STATE.ats.form.full_name = 'Priya Nair'; STATE.ats.form.email = 'priya.nair@work.io'; STATE.ats.form.extra_phones = ['(555) 987-6543']; window.__nextPost = 'possible_duplicate'; atsSaveApplicant(false); });
  await page.waitForSelector('#layer .modal .warn-panel');
  const chk = await lastCall('GET', '/candidates/check-duplicate');
  step('the duplicate check is asked about EVERY address and number the form holds', chk && /extra_phones=/.test(chk[1]) && decodeURIComponent(chk[1]).includes('(555) 987-6543') && /email=priya\.nair%40work\.io/.test(chk[1]), chk && chk[1]);
  const dupText = await ev(() => document.querySelector('#layer .modal .warn-panel').textContent.replace(/\s+/g, ' '));
  step('the warning lists every address and number of the person it matched', /p@old\.org, priya\.nair@work\.io/.test(dupText) && /\(555\) 987-6543/.test(dupText), dupText.slice(0, 220));
  await page.keyboard.press('Escape');

  // ── part 4 — Edit Candidate ───────────────────────────────────────────────
  await ev(() => { STATE.ats.rows = [JSON.parse(JSON.stringify(window.__server.candidate))]; atsOpenEdit('c1'); });
  await page.waitForSelector('#layer .modal');
  step('Edit shows the existing extras', same(await extraRows('email'), ['jane@new.com', 'jane@third.com']) && same(await extraRows('phone'), ['(555) 987-6543']), JSON.stringify([await extraRows('email'), await extraRows('phone')]));
  await page.click('#layer .modal [data-cp="ats-email"] [data-cp-row="email-1"] .cp-link');
  await page.click('#layer .modal button:has-text("Save changes")');
  await page.waitForTimeout(150);
  const put = await lastCall('PUT', '/candidates/c1');
  step('Edit saves the switched main and the extras back (one PUT)', put && put[2].email === 'jane@third.com' && same(put[2].extra_emails, ['jane@new.com', 'jane@old.com']) && same(put[2].extra_phones, ['(555) 987-6543']), JSON.stringify(put && [put[2].email, put[2].extra_emails]));
  await ev(() => { window.__server.candidate.email = 'jane@old.com'; window.__server.candidate.extra_emails = ['jane@new.com', 'jane@third.com']; window.__calls.length = 0; });

  // ── part 5 — the candidate header (live) ──────────────────────────────────
  await ev(() => { STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = STATE.bd.jobOrders || []; bdOpenCandidate('c1'); });
  await page.waitForSelector('[data-cp="prof-email"]', { timeout: 6000 });
  const hdr = await ev(() => ({ more: Array.from(document.querySelectorAll('[data-cp="prof-email"] .cp-val')).map(v => v.textContent.trim()), morePh: Array.from(document.querySelectorAll('[data-cp="prof-phone"] .cp-val')).map(v => v.textContent.trim()),
    keys: Array.from(document.querySelectorAll('.kv .kv-k')).map(k => k.textContent.trim()) }));
  step('the header shows the main, then the extras under it', same(hdr.more, ['jane@new.com', 'jane@third.com']) && same(hdr.morePh, ['(555) 987-6543']) && hdr.keys.includes('Email') && hdr.keys.includes('More emails'), JSON.stringify(hdr));
  if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: path.join(SHOTS, 'header.png') }); }   // after the drawer has slid in

  await page.click('[data-cp="prof-email"] .cp-add');
  step('the header "+ add another email" opens one input, focused', await ev(() => document.activeElement && document.activeElement.id === 'cp-prof-email-new'));
  await page.keyboard.type('jane@fourth.com'); await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  let hp = await lastCall('PUT', '/candidates/c1');
  step('Enter SAVES AT ONCE: one PUT with the full extras list', hp && same(hp[2], { extra_emails: ['jane@new.com', 'jane@third.com', 'jane@fourth.com'] }), JSON.stringify(hp && hp[2]));
  step('…and the header now shows it (reloaded from the server)', same(await ev(() => Array.from(document.querySelectorAll('[data-cp="prof-email"] .cp-val')).map(v => v.textContent.trim())), ['jane@new.com', 'jane@third.com', 'jane@fourth.com']));

  await page.click('[data-cp="prof-email"] [data-cp-row="email-1"] .cp-link');
  await page.waitForTimeout(250);
  hp = await lastCall('PUT', '/candidates/c1');
  step('MAKE MAIN in the header: one PUT carrying the new main and the swapped extras', hp && hp[2].email === 'jane@third.com' && same(hp[2].extra_emails, ['jane@new.com', 'jane@old.com', 'jane@fourth.com']), JSON.stringify(hp && hp[2]));
  step('…and the header\'s main is now that address', (await ev(() => Array.from(document.querySelectorAll('.kv')).find(k => k.querySelector('.kv-k').textContent.trim() === 'Email').querySelector('.kv-v').textContent)).includes('jane@third.com'));

  await page.click('[data-cp="prof-email"] [data-cp-row="email-0"] .cp-x');
  await page.waitForTimeout(250);
  hp = await lastCall('PUT', '/candidates/c1');
  step('✕ in the header removes it at once', hp && !hp[2].extra_emails.includes('jane@new.com') && hp[2].extra_emails.length === 2, JSON.stringify(hp && hp[2]));

  // a refusal is SAID, and the header is reloaded from the truth
  await ev(() => { window.__putError = 'That address opted out of email from us, so it cannot be the main address.'; window.__toasts.length = 0; });
  await page.click('[data-cp="prof-email"] [data-cp-row="email-0"] .cp-link');
  await page.waitForTimeout(300);
  const toasts = await ev(() => window.__toasts);
  step('SAFETY: a refused switch (opted-out address) is said in a sentence', toasts.some(t => /opted out/.test(t[0]) && t[1] === 'error'), JSON.stringify(toasts));
  const srvMain = await ev(() => window.__server.candidate.email);
  const shownMain = await ev(() => Array.from(document.querySelectorAll('.kv')).find(k => k.querySelector('.kv-k').textContent.trim() === 'Email').querySelector('.kv-v').textContent);
  step('…and the header still shows the real main (it was reloaded, nothing pretended)', shownMain.includes(srvMain), srvMain + ' / ' + shownMain.slice(0, 60));

  // ── part 6 — the browser's swap equals the server's ───────────────────────
  const cases = [
    { kind: 'email', m: { email: 'a@x.com', extra_emails: ['b@x.com', 'c@x.com'] }, idx: 1 },
    { kind: 'email', m: { email: 'A@X.com', extra_emails: ['B@x.com'] }, idx: 0 },
    { kind: 'email', m: { email: '', extra_emails: ['b@x.com', 'c@x.com'] }, idx: 0 },
    { kind: 'phone', m: { phone: '(555) 111-2222', extra_phones: ['555.333.4444', '555-666-7777'] }, idx: 1 },
    { kind: 'phone', m: { phone: '', extra_phones: ['555.333.4444'] }, idx: 0 },
    { kind: 'email', m: { email: 'a@x.com', extra_emails: [] }, idx: 0 },
  ];
  const browserSwaps = await ev((cases) => cases.map(c => CP.swap(c.m, c.kind, c.idx)), cases);
  let drift = [];
  cases.forEach((c, i) => {
    const list = c.m[c.kind === 'email' ? 'extra_emails' : 'extra_phones'];
    const srv = list[c.idx] === undefined ? null : serverCp.makeMain(c.m, c.kind, list[c.idx]);
    const b = browserSwaps[i];
    const key = c.kind === 'email' ? 'email' : 'phone', ek = c.kind === 'email' ? 'extra_emails' : 'extra_phones';
    const ok = (srv === null && b === null) || (srv && b && srv[key] === b.main && same(srv[ek], b.extras));
    if (!ok) drift.push({ case: i, server: srv, browser: b });
  });
  step('the browser\'s swap and the server\'s makeMain agree on every case (no drift)', drift.length === 0, JSON.stringify(drift));

  // ── part 7 — a phone, and the dark theme ──────────────────────────────────
  await ev(() => { closeModal && closeModal(); });
  await ev(() => { window.__server.candidate.extra_emails = ['jane.a.very.long.address.indeed@a-rather-long-company-name.example.com', 'second@x.com']; STATE.ats.rows = [JSON.parse(JSON.stringify(window.__server.candidate))]; atsOpenEdit('c1'); });
  await page.waitForSelector('#layer .modal');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'edit-desktop-light.png') });
  await ev(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'edit-desktop-dark.png') });
  await ev(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(700);
  const ph = await ev(() => { const m = document.querySelector('#layer .modal'); const r = m.getBoundingClientRect(); const rows = Array.from(m.querySelectorAll('.cp-row')).map(x => x.getBoundingClientRect());
    const btn = m.querySelector('.cp-link').getBoundingClientRect(); const scroller = m.querySelector('[style*="overflow-y:auto"]');
    return { modalRight: Math.round(r.right), vw: innerWidth, rowsOut: rows.filter(x => x.right > innerWidth + 1).length, btnH: Math.round(btn.height), xOver: scroller.scrollWidth - scroller.clientWidth }; });
  step('phone: the extras rows stay inside the screen and nothing scrolls sideways', ph.rowsOut === 0 && ph.modalRight <= ph.vw + 1 && ph.xOver <= 1, JSON.stringify(ph));
  step('phone: the Make main / ✕ targets are big enough to hit (>= 32px high)', ph.btnH >= 32, 'height ' + ph.btnH);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'edit-phone.png') });

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
