// "Add lead" (D-0077) in a real browser, against a stubbed API:
//   * it is the shared form kit (retro look), not hand-styled boxes;
//   * a company is EITHER picked from yours OR added right here — with its
//     address — and a name that already exists is reused, never doubled;
//   * as many contacts as the person has (the first is the main one);
//   * what was typed survives adding a contact / switching company mode;
//   * a retry after a failed save reuses the company it already created.
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
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
    const tag = width + 'px: ';

    // The API, stubbed in the page: every call is recorded.
    await page.evaluate(() => {
      window.__calls = []; window.__existing = [{ id: 'co-acme', name: 'Acme Corp', industry: 'Construction', location: 'Dallas, TX', website: 'acme.com' }];
      window.__jobFails = 0; window.__toasts = [];
      window.apiGet = (p) => { __calls.push(['GET', p]);
        if (p.indexOf('/companies/search') === 0) { const q = decodeURIComponent(p.split('q=')[1]).toLowerCase(); return Promise.resolve(__existing.filter(c => c.name.toLowerCase().includes(q))); }
        return Promise.resolve([]); };
      window.apiPost = (p, b) => { __calls.push(['POST', p, JSON.parse(JSON.stringify(b))]);
        if (p === '/companies') { const c = { id: 'co-new-' + __calls.length, name: b.name, industry: b.industry, location: b.location, website: b.website, address: b.address }; __existing.push(c); return Promise.resolve(c); }
        if (p === '/jobs') { if (__jobFails > 0) { __jobFails--; return Promise.reject(new Error('Server said no')); } return Promise.resolve({ id: 'job-1' }); }
        return Promise.resolve({}); };
      window.refreshJobs = () => Promise.resolve();
      const real = window.showToast; window.showToast = (m, t) => { __toasts.push([m, t]); };
      STATE.companies = [{ id: 'co-acme', name: 'Acme Corp' }];
      STATE.page = 'leads'; window.openAddJob();
    });
    await page.waitForSelector('.modal.modal-w860');

    const look = await page.evaluate(() => { const m = document.querySelector('.modal'); const cs = getComputedStyle(m); const inp = document.querySelector('.modal .inp, .modal input');
      return { kit: !!document.querySelector('.modal .mh .mt') && !!document.querySelector('.modal .mf'), radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, inRadius: getComputedStyle(document.querySelector('.modal select, .modal input')).borderTopLeftRadius,
        inlineBoxes: document.querySelectorAll('.modal [style*="background:var(--bg3)"]').length, title: document.querySelector('.modal .mt').textContent }; });
    step(tag + 'Add lead uses the shared form kit and takes the retro look (square, outlined, no hand-styled boxes)', look.kit && look.radius === '0px' && parseFloat(look.border) >= 2 && look.inRadius === '0px' && look.inlineBoxes === 0, JSON.stringify(look));
    const overflow = await page.evaluate(() => { const m = document.querySelector('.modal'); return m.scrollWidth > m.clientWidth + 1 || m.getBoundingClientRect().right > document.documentElement.clientWidth + 1; });
    step(tag + 'the window fits the screen', !overflow);
    if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'add-lead-existing-' + width + '.png') }); }

    // ── a) the company can be NEW, with an address ──────────────────────────
    const hasNew = await page.evaluate(() => [...document.querySelectorAll('.al-tabs .fc')].map(b => b.textContent).join('|'));
    step(tag + 'there is a choice: Existing company | New company', hasNew === 'Existing company|New company', hasNew);
    await page.evaluate(() => [...document.querySelectorAll('.al-tabs .fc')].find(b => /New/.test(b.textContent)).click());
    const fields = await page.evaluate(() => [...document.querySelectorAll('.modal .flbl')].map(l => l.textContent.replace('*', '').trim()));
    step(tag + 'a new company asks for name, website, the full postal ADDRESS (street, suite, city, state, ZIP, country) and industry', ['Company name', 'Website', 'Street address', 'Suite / floor / unit', 'City', 'State / region', 'ZIP / postal code', 'Country', 'Industry'].every(f => fields.includes(f)), fields.join(','));
    if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'add-lead-new-' + width + '.png') }); }

    // type it all
    await page.fill('#al-conew', 'Globex Industries');
    await page.fill('input[placeholder="acme.com"]', 'globex.com');
    const byLabel = (label, value) => page.evaluate(([l, v]) => { const g = [...document.querySelectorAll('.modal .fgrp')].find(x => (x.querySelector('.flbl') || {}).textContent.replace('*', '').trim() === l); const i = g.querySelector('input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, [label, value]);
    await byLabel('Street address', '12 Main St'); await byLabel('Suite / floor / unit', 'Suite 4'); await byLabel('City', 'Austin'); await byLabel('State / region', 'TX'); await byLabel('ZIP / postal code', '78701'); await byLabel('Country', 'United States');
    await page.fill('#al-pos', 'VP Engineering');
    await page.fill('input[placeholder="First name *"]', 'Sam');
    await page.fill('input[placeholder="Email"]', 'sam@globex.com');
    // a second and third contact
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Add another contact/.test(b.textContent)).click());
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].find(b => /Add another contact/.test(b.textContent)).click());
    const nContacts = await page.evaluate(() => document.querySelectorAll('.al-contact').length);
    step(tag + 'any number of contacts can be added (the first is the main one)', nContacts === 3, String(nContacts));
    step(tag + 'what was typed survives adding contacts', await page.inputValue('#al-conew') === 'Globex Industries' && await page.inputValue('input[placeholder="First name *"]') === 'Sam' && await page.inputValue('#al-pos') === 'VP Engineering');
    await page.evaluate(() => { const b = document.querySelectorAll('.al-contact')[1]; b.querySelector('input[placeholder="First name *"]').value = 'Pat'; b.querySelector('input[placeholder="First name *"]').dispatchEvent(new Event('input', { bubbles: true }));
      b.querySelector('input[placeholder="Email"]').value = 'pat@globex.com'; b.querySelector('input[placeholder="Email"]').dispatchEvent(new Event('input', { bubbles: true })); });
    // the third stays EMPTY — an empty block is ignored
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find(b => /Add lead/.test(b.textContent)).click());
    await page.waitForTimeout(400);
    const c1 = await page.evaluate(() => ({ calls: __calls.filter(c => c[0] === 'POST'), search: __calls.filter(c => c[0] === 'GET' && c[1].indexOf('/companies/search') === 0).length, open: !!document.querySelector('.modal') }));
    const co = c1.calls.find(c => c[1] === '/companies'), job = c1.calls.find(c => c[1] === '/jobs');
    step(tag + 'a NEW company is checked against yours first, then created with its structured address (the columns migration 043 already added)', c1.search === 1 && co && co[2].name === 'Globex Industries' && co[2].address_line1 === '12 Main St' && co[2].address_line2 === 'Suite 4' && co[2].city === 'Austin' && co[2].state === 'TX' && co[2].postal_code === '78701' && co[2].country === 'United States' && co[2].website === 'globex.com' && !('address' in co[2]), JSON.stringify(co));
    step(tag + 'the lead is created on THAT company with every filled contact (the empty one is skipped)', job && /^co-new-/.test(job[2].company_id) && job[2].position === 'VP Engineering' && job[2].contacts.length === 2 && job[2].contacts[0].first_name === 'Sam' && job[2].contacts[1].email === 'pat@globex.com', JSON.stringify(job && job[2].contacts));
    step(tag + 'the window closes and the lead is confirmed', !c1.open);

    // ── b) a name that already exists is REUSED, not doubled ────────────────
    await page.evaluate(() => { __calls.length = 0; __toasts.length = 0; window.openAddJob(); });
    await page.waitForSelector('.modal.modal-w860');
    await page.evaluate(() => [...document.querySelectorAll('.al-tabs .fc')].find(b => /New/.test(b.textContent)).click());
    await page.fill('#al-conew', '  acme corp ');
    await page.fill('#al-pos', 'CFO'); await page.fill('input[placeholder="First name *"]', 'Lee');
    await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find(b => /Add lead/.test(b.textContent)).click());
    await page.waitForTimeout(400);
    const c2 = await page.evaluate(() => ({ posts: __calls.filter(c => c[0] === 'POST').map(c => c[1]), job: __calls.find(c => c[1] === '/jobs'), toast: __toasts.map(t => t[0]).join(' | ') }));
    step(tag + 'typing a company that already exists does NOT create a second one — it is used, and the person is told', !c2.posts.includes('/companies') && c2.job && c2.job[2].company_id === 'co-acme' && /already one of your companies/.test(c2.toast), JSON.stringify(c2.posts) + ' ' + c2.toast);

    // ── c) a failed save, then a retry, never doubles the company ───────────
    await page.evaluate(() => { __calls.length = 0; __jobFails = 1; window.openAddJob(); });
    await page.waitForSelector('.modal.modal-w860');
    await page.evaluate(() => [...document.querySelectorAll('.al-tabs .fc')].find(b => /New/.test(b.textContent)).click());
    await page.fill('#al-conew', 'Initech'); await page.fill('#al-pos', 'Analyst'); await page.fill('input[placeholder="First name *"]', 'Bill');
    const save = () => page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find(b => /Add lead|Adding/.test(b.textContent)).click());
    await save(); await page.waitForTimeout(400);
    const stillOpen = await page.evaluate(() => ({ open: !!document.querySelector('.modal'), chip: !!document.querySelector('.al-picked'), name: (document.querySelector('.al-picked-n') || {}).textContent }));
    step(tag + 'after a failed save the window stays, what was typed is kept, and the company it already made is now the chosen one', stillOpen.open && stillOpen.chip && stillOpen.name === 'Initech', JSON.stringify(stillOpen));
    await save(); await page.waitForTimeout(400);
    const c3 = await page.evaluate(() => __calls.filter(c => c[0] === 'POST').map(c => c[1]));
    step(tag + 'the retry creates the LEAD only — Initech was not created twice', c3.filter(x => x === '/companies').length === 1 && c3.filter(x => x === '/jobs').length === 2, c3.join());

    // ── d) the checks ───────────────────────────────────────────────────────
    const tryBad = async (setup) => { await page.evaluate(() => { __toasts.length = 0; window.openAddJob(); }); await page.waitForSelector('.modal.modal-w860'); await setup(); await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find(b => /Add lead/.test(b.textContent)).click()); await page.waitForTimeout(150); return page.evaluate(() => ({ toast: __toasts.map(t => t[0]).join(' | '), posts: __calls.filter(c => c[0] === 'POST').length })); };
    await page.evaluate(() => { __calls.length = 0; });
    let bad = await tryBad(async () => {});
    step(tag + 'no company chosen → asked to pick or add one, nothing sent', /Pick a company/.test(bad.toast) && bad.posts === 0, bad.toast);
    bad = await tryBad(async () => { await page.evaluate(() => addLeadPickCo({ id: 'co-acme', name: 'Acme Corp' })); await page.fill('#al-pos', 'X'); await page.fill('input[placeholder="First name *"]', 'A'); await page.fill('input[placeholder="Email"]', 'not-an-email'); });
    step(tag + 'a malformed email is refused with the contact\'s number', /Contact 1: that email does not look right/.test(bad.toast) && bad.posts === 0, bad.toast);
    bad = await tryBad(async () => { await page.evaluate(() => addLeadPickCo({ id: 'co-acme', name: 'Acme Corp' })); await page.fill('#al-pos', 'X'); await page.fill('input[placeholder="Last name"]', 'Smith'); });
    step(tag + 'a contact with a surname but no first name is refused', /needs a first name/.test(bad.toast) && bad.posts === 0, bad.toast);
    bad = await tryBad(async () => { await page.evaluate(() => addLeadPickCo({ id: 'co-acme', name: 'Acme Corp' })); await page.fill('#al-pos', 'X'); });
    step(tag + 'no contact at all is refused', /at least one contact/.test(bad.toast) && bad.posts === 0, bad.toast);
    await ctx.close();
  }
  step('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
