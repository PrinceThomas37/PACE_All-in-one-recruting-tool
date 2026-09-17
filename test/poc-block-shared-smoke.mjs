// ============================================================================
// THE SHARED POC BLOCK, IN BOTH FORMS THAT USE IT.
//
// `15-ra-entry-form.js` had its own contact rows since the RA lead form was
// built. Session 26 added a second, shared one (`52-poc-block.js`) for the BD
// "+ New Job" form and left the older copy standing — two live paths to one
// outcome, which is the duplication the owner caught themselves with the two
// candidate-email workflows (D-0012).
//
// The RA form is now migrated onto the shared block. That form is in DAILY USE
// and had ZERO test coverage before this file, so what is pinned here is not
// the refactor — it is the form still working: a lead saves with the contacts
// that were typed, rows add and remove, the positional Contact Intel rows stay
// aligned to the people they describe, and typing does not take the caret.
// ============================================================================
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
let pass = 0, fail = 0;
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
const settle = (page) => page.waitForTimeout(250);

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

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  // The RA leads page, with the network stubbed the way the page sees it.
  const openRAForm = () => page.evaluate(() => {
    STATE.user.role = 'ra'; STATE.user.roles = ['ra'];
    window.__posted = []; window.__toasts = [];
    const rt = window.showToast;
    window.showToast = function (m, k) { window.__toasts.push(String(m)); if (rt) try { rt(m, k); } catch (e) {} };
    window.apiGet = () => Promise.resolve([]);
    window.apiPost = function (p, b) {
      window.__posted.push({ path: p, body: b });
      if (p === '/contacts/check-email') return Promise.resolve({ duplicate: false });
      if (p === '/companies') return Promise.resolve({ id: 'co-new', name: (b && b.name) || '' });
      return Promise.resolve({ id: 'x' });
    };
    window.apiPut = (p, b) => { window.__posted.push({ path: p, body: b }); return Promise.resolve({}); };
    window.refreshJobs = () => {};
    STATE.jobs = STATE.jobs || [];
    if (window.raFormClear) raFormClear();
    goPage('leads');
  });

  console.log('\nThe RA lead form, on the shared block');

  await ta('the form renders the SHARED block, not its own rows', async () => {
    await openRAForm();
    await page.waitForSelector('#poc-ra', { timeout: 8000 });
    // The old bespoke handlers are gone; nothing may still call them.
    const stale = await page.evaluate(() => ['raFormAddContact', 'raFormRemoveContact', 'raFormUpdateContact', 'raFormCheckEmail']
      .filter(fn => typeof window[fn] === 'function'));
    assert.deepEqual(stale, [], 'old handlers still defined: ' + stale.join(', '));
    const html = await page.content();
    assert.ok(!/raFormAddContact|raFormUpdateContact\(/.test(html), 'the page still emits a call to a deleted handler');
  });

  await ta('a lead saves with the contacts that were typed', async () => {
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    await page.fill('#ra-co-name', 'Treplar Inc');
    await page.fill('#ra-location', 'Martinsburg, WV');
    await page.evaluate(() => { STATE.raForm.position = 'Industrial Electrician'; });
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-ra input[placeholder="Last name"]', 'Reyes');
    await page.fill('#poc-ra input[placeholder="Email address *"]', 'dana@treplar.com');
    await page.fill('#poc-ra input[placeholder="Phone (optional)"]', '304-555-0142');
    await settle(page);
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const posted = await page.evaluate(() => window.__posted);
    const lead = posted.find(x => x.path === '/jobs');
    assert.ok(lead, 'no lead was posted: ' + JSON.stringify(await page.evaluate(() => window.__toasts)));
    assert.equal(lead.body.contacts.length, 1);
    // The API's field names, straight through — no translation layer to lose a field in.
    assert.equal(lead.body.contacts[0].first_name, 'Dana');
    assert.equal(lead.body.contacts[0].last_name, 'Reyes');
    assert.equal(lead.body.contacts[0].email, 'dana@treplar.com');
    assert.equal(lead.body.contacts[0].phone, '304-555-0142');
  });

  await ta('a second contact adds, and both are saved', async () => {
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    await page.fill('#ra-co-name', 'Treplar Inc');
    await page.fill('#ra-location', 'Martinsburg, WV');
    await page.evaluate(() => { STATE.raForm.position = 'Welder'; });
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-ra input[placeholder="Email address *"]', 'dana@treplar.com');
    // Deliberately NO wait: clicking straight after typing an email is the
    // exact race that used to lose the click (see the shift test below).
    await page.click('#poc-ra button[onclick*="pocAdd"]');
    await settle(page);
    const rows = await page.$$('#poc-ra .poc-row');
    assert.equal(rows.length, 2, 'the second row did not appear');
    await page.fill('#poc-ra .poc-row:nth-of-type(2) input[placeholder="First name *"]', 'Marcus');
    await page.fill('#poc-ra .poc-row:nth-of-type(2) input[placeholder="Email address *"]', 'm.hale@treplar.com');
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const lead = (await page.evaluate(() => window.__posted)).find(x => x.path === '/jobs');
    assert.ok(lead, 'no lead posted');
    assert.equal(lead.body.contacts.length, 2);
    assert.equal(lead.body.contacts[1].email, 'm.hale@treplar.com');
  });

  await ta('THE CONTACT INTEL ROWS STAY ALIGNED when a contact is removed', async () => {
    // Those rows are positional against the contact list. If a removal does not
    // splice both, the seniority and notes for one person silently attach to
    // another — a wrong fact about a real human, with nothing on screen to say so.
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    await page.click('#poc-ra button[onclick*="pocAdd"]');
    await settle(page);
    await page.fill('#poc-ra .poc-row:nth-of-type(2) input[placeholder="First name *"]', 'Marcus');
    await settle(page);
    await page.evaluate(() => { raFormUpdateContactIntel(0, 'notes', 'about Dana'); raFormUpdateContactIntel(1, 'notes', 'about Marcus'); });
    await page.click('#poc-ra .poc-row:nth-of-type(1) button[onclick*="pocRemove"]');
    await settle(page);
    const state = await page.evaluate(() => ({
      names: STATE.raForm.contacts.map(c => c.first_name),
      notes: (STATE.raForm.research.contacts || []).map(c => c.notes || null),
    }));
    assert.deepEqual(state.names, ['Marcus'], 'wrong contact survived: ' + JSON.stringify(state.names));
    assert.deepEqual(state.notes, ['about Marcus'], "Dana's notes are now attached to Marcus: " + JSON.stringify(state.notes));
  });

  await ta('typing in a contact box does not take the caret', async () => {
    // The RA form re-renders wholesale, so `changed` must ignore a keystroke.
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    const kept = await page.evaluate(async () => {
      const el = document.querySelector('#poc-ra input[placeholder="Last name"]');
      el.focus(); el.value = 'Rey'; el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      return document.activeElement === el;
    });
    assert.ok(kept, 'the caret left the box');
  });

  await ta('the duplicate-email warning still reaches the saved lead', async () => {
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    await page.evaluate(() => {
      window.apiPost = function (p, b) {
        window.__posted.push({ path: p, body: b });
        if (p === '/contacts/check-email') return Promise.resolve({ duplicate: true, days_ago: 3, added_by: 'Asha Rao', company: 'Treplar Inc' });
        if (p === '/companies') return Promise.resolve({ id: 'co-new', name: (b && b.name) || '' });
        return Promise.resolve({ id: 'x' });
      };
    });
    await page.fill('#ra-co-name', 'Treplar Inc');
    await page.fill('#ra-location', 'Martinsburg, WV');
    await page.evaluate(() => { STATE.raForm.position = 'Welder'; });
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-ra input[placeholder="Email address *"]', 'dana@treplar.com');
    await page.fill('#poc-ra input[placeholder="Phone (optional)"]', '1');
    await page.waitForTimeout(500);
    const note = await page.$eval('#poc-ra .poc-email-note[data-idx="0"]', el => el.textContent);
    assert.match(note, /Already in PACE/, 'the duplicate warning never showed');
    assert.match(note, /Asha Rao/);
    await page.evaluate(() => raFormSubmit());
    await settle(page);
    const lead = (await page.evaluate(() => window.__posted)).find(x => x.path === '/jobs');
    assert.equal(lead.body.is_duplicate, true, 'the lead was not flagged as a duplicate');
  });

  await ta('THE DUPLICATE CHECK MOVES NOTHING when its answer arrives', async () => {
    // The answer lands ~300ms after the person has left the email box, by which
    // time they may be reaching for "+ Add another contact". Before the space
    // was reserved, that button moved 20px and the click was lost — measured:
    // a click straight after typing left one contact, the same click after the
    // answer gave two. Same family as the caret-eating redraw: something
    // arriving from the network must not move a control under the user's hand.
    await openRAForm();
    await page.waitForSelector('#poc-ra');
    await page.fill('#poc-ra input[placeholder="First name *"]', 'Dana');
    const before = await page.$eval('#poc-ra button[onclick*="pocAdd"]', el => el.getBoundingClientRect().top);
    await page.fill('#poc-ra input[placeholder="Email address *"]', 'dana@treplar.com');
    await page.evaluate(() => document.querySelector('#poc-ra input[placeholder="Email address *"]').blur());
    await page.waitForFunction(() => {
      const n = document.querySelector('#poc-ra .poc-email-note[data-idx="0"]');
      return n && /\S/.test(n.textContent.replace(/\u00a0/g, ''));
    }, { timeout: 5000 });
    const after = await page.$eval('#poc-ra button[onclick*="pocAdd"]', el => el.getBoundingClientRect().top);
    assert.equal(Math.round(after - before), 0,
      'the Add button moved ' + Math.round(after - before) + 'px when the check answered');
  });

  await ta('the page threw no errors', () => { assert.deepEqual(pageErrors, []); });
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
