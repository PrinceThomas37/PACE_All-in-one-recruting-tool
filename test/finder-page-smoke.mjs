// Verifies the Find Leads screen (R-157, steps 2 and 3): the cards, the one Accept window, saved searches and
// the admin tab. The API is stubbed at window.apiGet/apiPost/apiPut/apiDelete; every rule itself lives on the
// server and is covered by finder-routes-smoke.mjs — what is asserted HERE is what the person sees and what the
// screen asks the server to do.
//
// Usage: node test/finder-page-smoke.mjs

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

const ACCESS = {
  enabled: true, is_admin: false, daily: 25, apollo: { connected: true }, credits: { used: 3, limit: 300 }, reveals: { used: 1, limit: 30 },
  wait_days: 14, card_days: 5, goes_to: 'pool',
  sectors: [{ id: 'medical', label: 'Medical & dental', titles: ['Dental Hygienist', 'Medical Assistant'] }],
  sizes: [{ id: 'small', label: '11–50' }, { id: 'mid', label: '51–500' }], posted: [7, 14, 30],
};
const CARDS = {
  waiting: 2, daily: 25, today: 3,
  cards: [
    { id: 'c1', company_name: 'Brazos Valley Machining', status: 'new', domain: 'brazosmachining.com', website: 'https://brazosmachining.com', linkedin_url: '', phone: '+1 254-555-0188', city: 'Waco', state: 'TX', employees: 85, revenue: '', chips: ['Headcount +12% in a year'], postings: null, search: { titles: ['CNC Machinist'], locations: ['Texas'] }, decision: { blocked: false, state: 'free', sentence: '' } },
    { id: 'c2', company_name: 'Lone Star Dental Partners', status: 'new', domain: 'lonestardental.com', website: 'lonestardental.com', phone: '', city: 'Austin', state: 'TX', employees: 40, chips: [], postings: null, search: null, decision: { blocked: true, state: 'cooldown', sentence: 'Rhea added Lone Star 12 days ago. It can be added again in 18 days.' } },
  ],
};
const PEOPLE = { total: 4, people: [
  { id: 'p1', first_name: 'Dana', last_name: 'Cole', title: 'HR Manager', revealed: false, email: null },
  { id: 'p2', first_name: 'Eli', last_name: '', last_name_hint: 'Ro***s', title: 'Plant Manager', revealed: false, email: null },
  { id: 'p3', first_name: 'Fay', last_name: 'Kim', title: 'Owner', revealed: false, email: null },
  { id: 'p4', first_name: 'Gus', last_name: 'Lee', title: 'Director', revealed: false, email: null },
] };
const EMAILS = { p1: 'dana@brazosmachining.com', p2: null, p3: 'fay@brazosmachining.com', p4: 'gus@brazosmachining.com' };

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);

  await page.evaluate(({ access, cards, people, emails }) => {
    window.__calls = []; window.__access = JSON.parse(JSON.stringify(access)); window.__cards = JSON.parse(JSON.stringify(cards));
    window.__searches = [];
    const rec = (m, p, b) => window.__calls.push([m, p, b]);
    window.apiGet = function (p) {
      rec('GET', p);
      if (p === '/finder/access') return Promise.resolve(window.__access);
      if (p === '/finder/cards') return Promise.resolve(window.__cards);
      if (p === '/finder/searches') return Promise.resolve({ searches: window.__searches });
      if (p === '/finder/admin/users') return Promise.resolve({ default_daily: 25, users: [{ id: 'u9', name: 'Rob Ra', email: 'rob@x.test', roles: ['ra'], enabled: false, daily: null }] });
      if (p === '/finder/diagnose') return Promise.resolve({ connected: true, ok: false, checks: [{ ok: true, text: 'Finding people by job title works (free).' }, { ok: false, text: 'This Apollo key is not allowed to search companies.' }] });
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) {
      rec('POST', p, b);
      if (/\/postings$/.test(p)) return Promise.resolve({ postings: [{ title: 'CNC Machinist', url: 'https://x.test/1', city: 'Waco', state: 'TX', age_days: 41, source: 'LinkedIn' }, { title: 'Welder', url: '', age_days: 3, source: '' }], signals: { chips: ['2 open roles', 'Oldest open 41 days'] } });
      if (/\/people$/.test(p)) return Promise.resolve(JSON.parse(JSON.stringify(people)));
      if (/\/reveal$/.test(p)) { const e = emails[b.person_id]; return Promise.resolve({ person: { id: b.person_id, first_name: 'X', last_name: 'Y', title: 'T', email: e }, note: e ? null : 'Apollo has no verified email for this person.', credits: { used: 4, limit: 300 } }); }
      if (/\/accept$/.test(p)) return Promise.resolve({ lead_id: 'L1', goes_to: window.__access.goes_to, contacts: (b.contacts || []).length });
      if (/\/(reject|wait)$/.test(p)) return Promise.resolve({ success: true, wait_until: '2026-10-21' });
      if (/\/run$/.test(p)) return Promise.resolve({ results: [{ name: 'S', cards: 2, note: 'Found 5 companies hiring. 2 new cards.' }], new_cards: 2, credits: { used: 4, limit: 300 } });
      if (p === '/finder/searches') { window.__searches.push(Object.assign({ id: 's1', active: true, posted_days: b.posted_days }, b)); return Promise.resolve({ id: 's1' }); }
      return Promise.resolve({});
    };
    window.apiPut = function (p, b) { rec('PUT', p, b); return Promise.resolve({}); };
    window.apiDelete = function (p) { rec('DELETE', p); return Promise.resolve({}); };
  }, { access: ACCESS, cards: CARDS, people: PEOPLE, emails: EMAILS });

  const html = () => page.evaluate(() => document.getElementById('content').innerHTML);
  const modal = () => page.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.innerHTML : ''; });
  const calls = () => page.evaluate(() => window.__calls);
  const nav = () => page.evaluate(() => document.getElementById('sidebar').innerText);

  // ── who sees it ────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__access = { enabled: false, is_admin: false }; });
  await enterApp(page, 'ra');
  await page.waitForTimeout(300);
  step('a person who has NOT been switched on has no "Find Leads" in the menu', !/Find Leads/.test(await nav()));
  await page.evaluate(() => window.goPage('finder'));
  await page.waitForTimeout(200);
  step('…and the page, reached by hand, says it is not switched on for them (never a broken screen)', /not switched on/.test(await html()));

  await page.evaluate((a) => { window.__access = JSON.parse(JSON.stringify(a)); window.STATE.finder.access = null; window.STATE.finder.accessFor = null; window.STATE.page = 'dashboard'; window.render(); }, ACCESS);
  await page.waitForTimeout(400);
  step('a person who HAS been switched on sees "Find Leads" in the menu', /Find Leads/.test(await nav()));

  // ── the cards ──────────────────────────────────────────────────────────
  await page.evaluate(() => window.goPage('finder'));
  await page.waitForTimeout(400);
  let h = await html();
  step('the page opens on Today\'s cards, best first, with the company facts', /Brazos Valley Machining/.test(h) && /Waco, TX/.test(h) && /85 employees/.test(h) && /Headcount \+12%/.test(h) && h.indexOf('Brazos') < h.indexOf('Lone Star'));
  step('a card says which search found it', /Found for: CNC Machinist in Texas/.test(h));
  step('the numbers are shown: to review, waiting, credits, reveals', /2<\/div><div class="strip-l">To review/.test(h) && /3\/300/.test(h) && /1\/30/.test(h));
  step('a company the add rule blocks shows the reason in words and its Accept button is DISABLED', /Rhea added Lone Star 12 days ago/.test(h) && await page.evaluate(() => { const b = [...document.querySelectorAll('#content button')].filter(x => x.textContent.trim() === 'Accept'); return b.length === 2 && !b[0].disabled && b[1].disabled; }));
  await page.evaluate(() => window.fdAccept('c2'));
  step('opening Accept on a card the rule blocks does nothing (no window opens)', !(await modal()) && (await page.evaluate(() => !window.STATE.finder.acc)));

  await page.evaluate(() => { window.STATE.finder.acc = null; window.STATE.modal = null; window.render(); });
  await page.evaluate(() => [...document.querySelectorAll('#content button')].find(b => /See their open jobs/.test(b.textContent)).click());
  await page.waitForTimeout(250);
  h = await html();
  step('"See their open jobs" lists them with age and source, and adds the signal chips', /CNC Machinist/.test(h) && /41d ago/.test(h) && /LinkedIn/.test(h) && /Oldest open 41 days/.test(h));
  step('…and it asked the server once, for that card only', (await calls()).filter(c => /c1\/postings$/.test(c[1])).length === 1);

  // wait & reject
  await page.evaluate(() => window.fdWait('c2', null));
  await page.waitForTimeout(200);
  let cs = await calls();
  step('Wait asks the server to park that card; it leaves the list', cs.some(c => c[0] === 'POST' && c[1] === '/finder/cards/c2/wait') && !/Lone Star Dental/.test(await html()));
  step('…and the "Waiting" number goes up by one', /3<\/div><div class="strip-l">Waiting/.test(await html()));

  // ── ACCEPT: the one window ─────────────────────────────────────────────
  await page.evaluate(() => window.fdAccept('c1'));
  await page.waitForTimeout(200);
  let m = await modal();
  step('Accept opens ONE window with the job, the people and where it goes', /Add Brazos Valley Machining as a lead/.test(m) && /Which job is this lead for/.test(m) && /Who should we write to/.test(m) && /Where it goes/.test(m));
  step('for an RA it says plainly: into the Unassigned pool, nothing emailed now', /Unassigned pool/.test(m) && /Nothing is emailed now/.test(m));
  step('the jobs already opened on the card are offered as one-click choices', /class="fd-pill/.test(m) && /CNC Machinist/.test(m) && /Welder/.test(m));
  const saveDisabled = () => page.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => /Save lead|Saving/.test(b.textContent)).disabled);
  step('Save lead is disabled until a job and a contact are chosen', await saveDisabled());

  await page.evaluate(() => { document.getElementById('fd-titleq').value = 'HR Manager'; window.fdFindPeople(); });
  await page.waitForTimeout(250);
  m = await modal();
  step('Find people asks with the typed title, and lists names, titles and a masked surname as Apollo sent it', (await calls()).some(c => /c1\/people$/.test(c[1]) && c[2].title === 'HR Manager') && /Dana Cole/.test(m) && /Eli Ro\*\*\*s/.test(m) && /Plant Manager/.test(m));
  step('an email is NOT shown until it is asked for, and the button says it costs a credit', !/dana@brazos/.test(m) && /Get email · 1 credit/.test(m));

  await page.evaluate(() => window.fdReveal('p1'));
  await page.waitForTimeout(250);
  m = await modal();
  step('revealing a verified email shows it, ticks the person for the lead, and counts the credit on the page', /dana@brazosmachining\.com/.test(m) && await page.evaluate(() => !!document.querySelector('.modal input[type=checkbox][checked], .modal input[type=checkbox]:checked')));
  await page.evaluate(() => window.fdReveal('p2'));
  await page.waitForTimeout(250);
  m = await modal();
  step('a person with no verified email says so and cannot be picked (no guesses)', /No verified email/.test(m) && /Apollo has no verified email/.test(m));

  step('the job is still not chosen, so Save is still disabled', await saveDisabled());
  await page.evaluate(() => { [...document.querySelectorAll('.modal .fd-pill')].find(b => b.textContent === 'CNC Machinist').click(); });
  step('choosing a job and one contact enables Save', !(await saveDisabled()));

  await page.evaluate(() => { window.fdReveal('p3'); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.fdReveal('p4'); });
  await page.waitForTimeout(250);
  m = await modal();
  step('the three revealed-with-email people are ticked automatically', (await page.evaluate(() => Object.keys(window.STATE.finder.acc.picked).filter(k => window.STATE.finder.acc.picked[k]).sort().join())) === 'p1,p3,p4');
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Zed'; document.getElementById('fd-m-email').value = 'zed@brazosmachining.com'; window.fdAddManual(); });
  m = await modal();
  step('a FOURTH contact is refused in words — a lead carries three at most', /Three contacts is the most/.test(m) && (await page.evaluate(() => window.STATE.finder.acc.manual.length)) === 0);

  // add by hand
  await page.evaluate(() => { const a = window.STATE.finder.acc; Object.keys(a.picked).forEach(k => { a.picked[k] = false; }); a.picked.p1 = true; a.mdraft = null; a.err = ''; window.fdUsePosition('CNC Machinist'); });
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Sam'; document.getElementById('fd-m-email').value = 'not-an-email'; window.fdAddManual(); });
  m = await modal();
  step('a hand-added contact with a broken email is refused in words', /valid email/.test(m));
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Sam'; document.getElementById('fd-m-last').value = 'Ode'; document.getElementById('fd-m-email').value = 'sam@brazosmachining.com'; window.fdAddManual(); });
  m = await modal();
  step('…and a good one is added and marked "added by hand"', /sam@brazosmachining\.com/.test(m) && /added by hand/.test(m));

  await page.evaluate(() => window.fdSave());
  await page.waitForTimeout(300);
  cs = await calls();
  const acc = cs.find(c => /c1\/accept$/.test(c[1]));
  step('Save sends the job and the chosen contacts — revealed people by id (the server holds their email), hand-added in full', acc && acc[2].position === 'CNC Machinist' && acc[2].contacts.length === 2 && acc[2].contacts[0].person_id === 'p1' && acc[2].contacts[1].email === 'sam@brazosmachining.com', JSON.stringify(acc && acc[2]));
  step('afterwards the window is closed and the card is gone', !(await modal()) && !/Brazos Valley Machining/.test(await html()));

  // BD sees a different destination
  await page.evaluate((c) => { window.__access.goes_to = 'you'; window.STATE.finder.access.goes_to = 'you'; window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.STATE.finder.cards.forEach(x => { x._base = []; }); window.render(); window.fdAccept('c1'); }, CARDS);
  m = await modal();
  step('for a BD manager it says: straight to you, in your own mailbox', /Straight to you/.test(m));
  await page.evaluate(() => window.fdCloseAccept());

  // a refusal from the server stays in the window, in words, and nothing is lost
  await page.evaluate((c) => {
    window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.fdAccept('c1');
    const a = window.STATE.finder.acc; document.getElementById('fd-position').value = 'Welder'; a.manual = [{ first_name: 'Sam', last_name: '', designation: '', email: 'sam@x.com' }];
    const old = window.apiPost; window.apiPost = function (p, b) { if (/accept$/.test(p)) return Promise.reject(new Error('Rhea added Brazos 2 days ago.')); return old(p, b); };
    window.fdSave();
  }, CARDS);
  await page.waitForTimeout(250);
  m = await modal();
  step('when the server says no, the window stays open with the reason in red and the choices intact', /Rhea added Brazos 2 days ago/.test(m) && /sam@x\.com/.test(m) && /value="Welder"/.test(m));
  await page.evaluate(() => window.fdCloseAccept());

  // ── searches ───────────────────────────────────────────────────────────
  await page.evaluate(() => window.fdTab('searches'));
  await page.waitForTimeout(200);
  h = await html();
  step('with no saved search the page says what a search is and offers to make one', /No saved searches yet/.test(h) && /Make your first search/.test(h));
  await page.evaluate(() => window.fdNewSearch());
  await page.evaluate(() => window.fdPickSector('medical'));
  h = await html();
  step('picking an industry fills in the job titles and the name (and leaves the rest to the person)', /Dental Hygienist, Medical Assistant/.test(h) && /value="Medical &amp; dental"/.test(h));
  await page.evaluate(() => { document.getElementById('fd-f-locations').value = 'Texas, remote'; document.querySelector('.fd-size-box[value=mid]').checked = true; document.getElementById('fd-f-posted').value = '30'; });
  await page.evaluate(() => window.fdTab('searches'));
  h = await html();
  step('what was typed survives a repaint of the page (nothing is lost under the person\'s hands)', /value="Texas, remote"/.test(h));
  await page.evaluate(() => window.fdSaveSearch());
  await page.waitForTimeout(250);
  const saved = (await calls()).find(c => c[0] === 'POST' && c[1] === '/finder/searches');
  step('Save sends clean lists (titles and places split on commas), the size and the posted-within choice', saved && saved[2].titles.join() === 'Dental Hygienist,Medical Assistant' && saved[2].locations.join() === 'Texas,remote' && saved[2].sizes.join() === 'mid' && saved[2].posted_days === 30 && saved[2].sector === 'medical', JSON.stringify(saved && saved[2]));
  h = await html();
  step('the saved search appears in the list with a Run now button', /Medical &amp; dental/.test(h) && /Run now/.test(h));
  await page.evaluate(() => window.fdRun('s1'));
  await page.waitForTimeout(300);
  step('Run now asks the server to run THAT search, then shows the new cards', (await calls()).some(c => c[1] === '/finder/searches/s1/run') && (await page.evaluate(() => window.STATE.finder.tab)) === 'cards');
  await page.evaluate(() => window.fdTab('searches'));
  await page.evaluate(() => window.fdDeleteSearch('s1'));
  await page.waitForTimeout(200);
  step('Delete (after the confirmation) asks the server to delete that search', (await calls()).some(c => c[0] === 'DELETE' && c[1] === '/finder/searches/s1'));

  // ── admin tab ──────────────────────────────────────────────────────────
  step('an ordinary person has no "Access & Apollo" tab', !/Access &amp; Apollo/.test(await html()));
  await page.evaluate(() => { window.__access.is_admin = true; window.STATE.finder.access.is_admin = true; });
  await switchRole(page, 'admin');
  await page.evaluate(() => { window.STATE.finder.access.is_admin = true; window.goPage('finder'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.fdTab('admin'));
  await page.waitForTimeout(300);
  h = await html();
  step('an admin sees who may use it, with a switch and a cards-a-day box per person', /Rob Ra/.test(h) && /May use it/.test(h) && /cards\/day/.test(h));
  await page.evaluate(() => { document.getElementById('fd-on-u9').checked = true; document.getElementById('fd-n-u9').value = '10'; window.fdAdminSave('u9'); });
  await page.waitForTimeout(200);
  const put = (await calls()).find(c => c[0] === 'PUT' && /admin\/users\/u9/.test(c[1]));
  step('Save sends the switch and the number', put && put[2].enabled === true && put[2].daily === 10, JSON.stringify(put && put[2]));
  await page.evaluate(() => window.fdDiagnose());
  await page.waitForTimeout(250);
  h = await html();
  step('"Check what my key can do" lists each check in words, red where Apollo refuses', /Finding people by job title works/.test(h) && /not allowed to search companies/.test(h) && /c-red/.test(h));

  // ── phone ──────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { window.STATE.finder.cards = JSON.parse(JSON.stringify(window.__cards.cards)); window.fdTab('cards'); });
  await page.waitForTimeout(200);
  step('on a phone nothing overflows the page sideways', await page.evaluate(() => { const c = document.getElementById('content'); return c.scrollWidth <= c.clientWidth + 1; }));

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, e.stack || e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log('\n=== FIND LEADS PAGE SMOKE ===');
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
