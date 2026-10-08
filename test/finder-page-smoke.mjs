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
  wait_days: 14, card_days: 5, goes_to: 'pool', jobsource: { connected: false, used: 0, limit: 10, per_run: 3 },
  sectors: [{ id: 'medical', label: 'Medical & dental', titles: ['Dental Hygienist', 'Medical Assistant', 'Phlebotomist', 'Medical Coder'] }, { id: 'it', label: 'IT & software', titles: ['Software Engineer', 'Data Analyst'] }],
  sizes: [{ id: 'small', label: '11–50' }, { id: 'mid', label: '51–500' }], posted: { min: 0, max: 30, def: 14 },
};
const CARDS = {
  waiting: 2, daily: 25, today: 3,
  cards: [
    { id: 'c1', search_id: 's1', company_name: 'Brazos Valley Machining', status: 'new', domain: 'brazosmachining.com', website: 'https://brazosmachining.com', linkedin_url: '', phone: '+1 254-555-0188', city: 'Waco', state: 'TX', employees: 85, revenue: '', chips: ['Headcount +12% in a year'], postings: null, search: { titles: ['CNC Machinist'], locations: ['Texas'] }, decision: { blocked: false, state: 'free', sentence: '' } },
    { id: 'c2', search_id: 's2', company_name: 'Lone Star Dental Partners', status: 'new', domain: 'lonestardental.com', website: 'lonestardental.com', phone: '', city: 'Austin', state: 'TX', employees: 40, chips: [], postings: null, search: null, decision: { blocked: true, state: 'cooldown', sentence: 'Rhea added Lone Star 12 days ago. It can be added again in 18 days.' } },
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
    window.__hist = { days: 90, card_days: 5, hidden: 3, counts: { accepted: 2, waiting: 1, rejected: 1 }, items: [
      { id: 'a1', search_id: 's1', company_name: 'Saved Machining', place: 'Waco, TX', status: 'accepted', decided_at: '2026-10-05T10:00:00Z', lead: { id: 'L7', position: 'Welder', stage: 'Assigned', contacts: [{ name: 'Dana Cole', title: 'HR Manager', email: 'dana@saved.example', primary: true }, { name: 'Eli Ross', title: 'Plant Manager', email: 'eli@saved.example', primary: false }], jobs: [{ title: 'Welder', main: true }, { title: 'Estimator', also: true }, { title: 'Pipefitter', url: 'https://jobs.example/2', source: 'Indeed' }] } },
      { id: 'a2', search_id: 's2', company_name: 'Handed Co', place: '', status: 'accepted', decided_at: '2026-10-04T10:00:00Z', lead: null, lead_elsewhere: true },
      { id: 'w1', search_id: 's1', company_name: 'Parked Dental', place: '', status: 'waiting', wait_until: '2026-10-21', decided_at: '2026-10-07T10:00:00Z', lead: null },
      { id: 'r1', search_id: 's2', company_name: 'Declined Inc', place: '', status: 'rejected', decided_at: '2026-10-06T10:00:00Z', lead: null } ] };
    const rec = (m, p, b) => window.__calls.push([m, p, b]);
    window.apiGet = function (p) {
      rec('GET', p);
      if (p === '/finder/access') return Promise.resolve(window.__access);
      if (p === '/finder/cards') return Promise.resolve(window.__cards);
      if (p === '/finder/mailboxes') return Promise.resolve({ goes_to: 'you', suggested_id: 'm2', mailboxes: [{ id: 'm1', email_address: 'bea@x.test', display_name: 'Bea', sent_today: 40 }, { id: 'm2', email_address: 'bea.two@x.test', display_name: '', sent_today: 3 }] });
      if (p.indexOf('/finder/history') === 0) return Promise.resolve(window.__hist);
      if (p === '/finder/searches') return Promise.resolve({ searches: window.__searches });
      if (p === '/finder/admin/jobsource') return Promise.resolve(window.__js);
      if (p === '/finder/admin/users') return Promise.resolve({ default_daily: 25, users: [{ id: 'u9', name: 'Rob Ra', email: 'rob@x.test', roles: ['ra'], enabled: false, daily: null }] });
      if (p === '/finder/diagnose') return Promise.resolve({ connected: true, ok: false, checks: [{ ok: true, text: 'Finding people by job title works (free).' }, { ok: false, text: 'This Apollo key is not allowed to search companies.' }] });
      return Promise.resolve({});
    };
    window.apiPost = function (p, b) {
      rec('POST', p, b);
      if (/\/postings$/.test(p)) return Promise.resolve({ postings: [{ title: 'CNC Machinist', url: 'https://x.test/1', city: 'Waco', state: 'TX', age_days: 41, source: 'LinkedIn' }, { title: 'Welder', url: '', age_days: 3, source: '' }], signals: { chips: ['2 open roles', 'Oldest open 41 days'] } });
      if (/\/people$/.test(p)) return Promise.resolve(b && b.title === 'Owner' ? { total: 1, people: [{ id: 'p9', first_name: 'Hal', last_name: 'Fox', title: 'Owner', revealed: false, email: null }] } : JSON.parse(JSON.stringify(people)));
      if (/\/emails\/generate$/.test(p)) return Promise.resolve({ generated: 1 });
      if (/\/reveal$/.test(p)) { const e = emails[b.person_id]; return Promise.resolve({ person: { id: b.person_id, first_name: 'X', last_name: 'Y', title: 'T', email: e }, note: e ? null : 'Apollo has no verified email for this person.', credits: { used: 4, limit: 300 } }); }
      if (/\/accept$/.test(p)) return Promise.resolve({ lead_id: 'L1', goes_to: window.__access.goes_to, contacts: (b.contacts || []).length });
      if (p === '/finder/find') return Promise.resolve(window.__findResp || { results: [{ search_id: null, note: 'Found 5 companies hiring. 3 new cards.', cards: 3 }], new_cards: 3, credits: { used: 5, limit: 300 } });
      if (/\/unwait$/.test(p)) return Promise.resolve({ success: true });
      if (/\/(reject|wait)$/.test(p)) return Promise.resolve({ success: true, wait_until: '2026-10-21' });
      if (/\/run$/.test(p)) { const R = { results: [{ name: 'S', cards: 2, note: 'Found 5 companies hiring. 2 new cards.' }], new_cards: 2, credits: { used: 4, limit: 300 } }; return window.__hold ? new Promise((r) => { window.__release = () => r(R); }) : Promise.resolve(R); }
      if (p === '/finder/admin/jobsource/test') return Promise.resolve({ ok: true, text: 'The key works (1 request used; 3 jobs came back).', used: 1, limit: 10 });
      if (p === '/finder/companies/suggest') {
        window.__lookups = (window.__lookups || 0) + 1; const q = String(b.q).toLowerCase();
        if (/^[a-z0-9-]+\.[a-z]{2,}$/.test(q)) return Promise.resolve({ suggestions: [{ name: q, domain: q, city: '', state: '', website_only: true }], used_credit: false, note: '' });
        if (q === 'acme') return Promise.resolve({ suggestions: [{ name: 'Acme Manufacturing', domain: 'acmemfg.com', city: 'Austin', state: 'Texas', employees: 120 }, { name: 'Acme Foods', domain: 'acmefoods.com', city: 'Dallas', state: 'Texas', employees: 60 }], used_credit: true, credits: { used: 4, limit: 300 }, note: '' });
        return Promise.resolve({ suggestions: [], used_credit: false, note: 'Apollo has no company with that name. Check the spelling, or paste its website.' });
      }
      if (p === '/finder/searches') { window.__searches.push(Object.assign({ id: 's1', active: true, posted_days: b.posted_days }, b)); return Promise.resolve({ id: 's1' }); }
      return Promise.resolve({});
    };
    window.__refreshed = 0; window.refreshJobs = function () { window.__refreshed++; return Promise.resolve(); };
    window.__js = { connected: false, hint: null, used: 0, limit: 10, per_run: 3 };
    window.apiPut = function (p, b) {
      rec('PUT', p, b);
      if (p === '/finder/admin/jobsource') { window.__js = { connected: !!b.api_key, hint: b.api_key ? '••••••' + String(b.api_key).slice(-4) : null, used: 0, limit: 10, per_run: 3 }; return Promise.resolve(window.__js); }
      return Promise.resolve({});
    };
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
  step('with cards from two searches a row of choices appears, and picking one shows only that search\'s cards', /All · 2/.test(h) && await page.evaluate(() => { window.fdFilterCards('s1'); return true; }) && /Brazos Valley/.test(await html()) && !/Lone Star Dental/.test(await html()));
  await page.evaluate(() => window.fdFilterCards(''));
  h = await html();
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
  step('Accept opens ONE window with the job, the people and where it goes', /Add Brazos Valley Machining as a lead/.test(m) && /Which jobs is this lead for/.test(m) && /Who should we write to/.test(m) && /Where it goes/.test(m));
  step('for an RA it says plainly: into the Unassigned pool, nothing emailed now — and offers no "Send from" (a pool lead has no mailbox yet)', /Unassigned pool/.test(m) && /Nothing is emailed now/.test(m) && !/Send from/.test(m));
  step('the jobs already opened on the card are offered as one-click choices', /class="fd-pill/.test(m) && /CNC Machinist/.test(m) && /Welder/.test(m));
  const saveDisabled = () => page.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => /Save lead|Saving/.test(b.textContent)).disabled);
  step('Save lead is disabled until a job and a contact are chosen', await saveDisabled());

  await page.evaluate(() => { document.getElementById('fd-titleq').value = 'HR Manager'; window.fdFindPeople(); });
  await page.waitForTimeout(250);
  m = await modal();
  step('Find people asks with the typed title, and lists names, titles and a masked surname as Apollo sent it', (await calls()).some(c => /c1\/people$/.test(c[1]) && c[2].title === 'HR Manager') && /Dana Cole/.test(m) && /Eli Ro\*\*\*s/.test(m) && /Plant Manager/.test(m));
  step('with Apollo connected and a website on the card, the window offers Find people', /Find people/.test(m) && !/Apollo is not connected here/.test(m));
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
  await page.evaluate(() => { document.getElementById('fd-titleq').value = 'Owner'; window.fdFindPeople(); });
  await page.waitForTimeout(250);
  m = await modal();
  step('searching again for another title ADDS to the list: the people already paid for and ticked stay, with their emails', /Hal Fox/.test(m) && /Dana/.test(m) && /dana@brazosmachining\.com/.test(m) && (await page.evaluate(() => Object.keys(window.STATE.finder.acc.picked).filter(k => window.STATE.finder.acc.picked[k]).sort().join())) === 'p1,p3,p4');
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Zed'; document.getElementById('fd-m-email').value = 'zed@brazosmachining.com'; window.fdAddManual(); });
  m = await modal();
  step('a FOURTH contact is refused in words — a lead carries three at most', /Three contacts is the most/.test(m) && (await page.evaluate(() => window.STATE.finder.acc.manual.length)) === 0);

  // add by hand
  await page.evaluate(() => { const a = window.STATE.finder.acc; Object.keys(a.picked).forEach(k => { a.picked[k] = false; }); a.picked.p1 = true; a.mdraft = null; a.err = ''; });
  await page.evaluate(() => window.fdToggleJob('Welder'));
  m = await modal();
  step('several jobs can be ticked: the main one is starred, the others ticked, and the window says the rest ride along free and the email is for the main job only', /★ CNC Machinist/.test(m) && /✓ Welder/.test(m) && /also hiring/.test(m) && /no extra credit/i.test(m) && /written for the main job only/.test(m));
  step('the main job is an explicit choice (a radio list of the ticked jobs), with the first one ticked chosen to start with', await page.evaluate(() => { const r = [...document.querySelectorAll('.modal input[name=fd-main]')]; return r.length === 2 && r[0].checked && !r[1].checked; }));
  await page.evaluate(() => window.fdSetMain('Welder'));
  m = await modal();
  step('choosing another job as the main one moves the star', /★ Welder/.test(m) && /✓ CNC Machinist/.test(m));
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Sam'; document.getElementById('fd-m-email').value = 'not-an-email'; window.fdAddManual(); });
  m = await modal();
  step('a hand-added contact with a broken email is refused in words', /valid email/.test(m));
  await page.evaluate(() => { document.getElementById('fd-m-first').value = 'Sam'; document.getElementById('fd-m-last').value = 'Ode'; document.getElementById('fd-m-email').value = 'sam@brazosmachining.com'; window.fdAddManual(); });
  m = await modal();
  step('…and a good one is added and marked "added by hand"', /sam@brazosmachining\.com/.test(m) && /added by hand/.test(m));

  const histBefore = (await calls()).filter(c => String(c[1]).indexOf('/finder/history') === 0).length;
  await page.evaluate(() => window.fdSave());
  await page.waitForTimeout(300);
  cs = await calls();
  const acc = cs.find(c => /c1\/accept$/.test(c[1]));
  step('Save sends the MAIN job first, then the others, and the chosen contacts — revealed people by id (the server holds their email), hand-added in full', acc && acc[2].positions.join() === 'Welder,CNC Machinist' && acc[2].contacts.length === 2 && acc[2].contacts[0].person_id === 'p1' && acc[2].contacts[1].email === 'sam@brazosmachining.com', JSON.stringify(acc && acc[2]));
  step('afterwards the window is closed and the card is gone', !(await modal()) && !/Brazos Valley Machining/.test(await html()));
  step('the history is reloaded after Save, so the new lead is in "Saved & past" at once', (await calls()).filter(c => String(c[1]).indexOf('/finder/history') === 0).length > histBefore);
  step('Leads is refreshed by itself after Save (the new lead needs no manual refresh)', (await page.evaluate(() => window.__refreshed)) >= 1);
  step('for an RA (lead goes to the pool) no email is written', !(await calls()).some(c => /emails\/generate/.test(c[1])) && !/Write the first email now/.test(m));

  // BD sees a different destination
  await page.evaluate((c) => { window.__access.goes_to = 'you'; window.STATE.finder.access.goes_to = 'you'; window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.STATE.finder.cards.forEach(x => { x._base = []; }); window.render(); window.fdAccept('c1'); }, CARDS);
  m = await modal();
  await page.waitForTimeout(250);
  m = await modal();
  step('for a BD manager it says: straight to you', /Straight to you/.test(m));
  step('…with a "Send from" list of their own mailboxes, each with how many it has sent today, the one with fewest pre-selected', /Send from/.test(m) && /Bea &lt;bea@x\.test&gt; — 40 sent today/.test(m) && /bea\.two@x\.test&gt; — 3 sent today/.test(m) && (await page.evaluate(() => document.getElementById('fd-mailbox').value)) === 'm2');
  step('…and offers to write the first email now — ticked, and saying plainly that nothing is sent until Send', /Write the first email now/.test(m) && /Nothing is sent until you press Send/.test(m) && await page.evaluate(() => !!document.querySelector('.modal input[type=checkbox][onclick="fdToggleWrite()"]:checked')));
  await page.evaluate(() => { const a = window.STATE.finder.acc; a.jobs = ['Welder']; a.main = 'Welder'; a.manual = [{ first_name: 'Sam', last_name: '', designation: '', email: 'sam@x.com' }]; window.fdPickMailbox('m1'); window.fdSave(); });
  await page.waitForTimeout(300);
  cs = await calls();
  step('Save sends the mailbox the person chose', (cs.find(c => /c1\/accept$/.test(c[1]) && c[2].mailbox_id) || [0, 0, {}])[2].mailbox_id === 'm1');
  step('a BD Save then asks the server to write that lead\'s first email (into Pending — not to send it)', cs.some(c => c[0] === 'POST' && c[1] === '/emails/generate' && c[2].job_ids.join() === 'L1') && !cs.some(c => /send/.test(c[1])));
  await page.evaluate((c) => { window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.STATE.finder.cards.forEach(x => { x._base = []; }); window.fdAccept('c1'); window.fdToggleWrite(); }, CARDS);
  m = await modal();
  step('un-ticking it means no email is written for that lead', !(await page.evaluate(() => window.STATE.finder.acc.writeEmail)));
  await page.evaluate(() => { const a = window.STATE.finder.acc; a.jobs = ['Welder']; a.main = 'Welder'; a.manual = [{ first_name: 'Sam', last_name: '', designation: '', email: 'sam@x.com' }]; a.mailboxes = []; a.mailboxId = ''; a.mailErr = 'None of your email IDs is connected and working — connect or reconnect one under Email IDs first.'; window.fdToggleWrite(); });
  m = await modal();
  step('a BD with no working mailbox is told so in red and cannot Save (there would be nothing to send from)', /None of your email IDs is connected/.test(m) && await page.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => /Save lead/.test(b.textContent)).disabled));
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
  step('with no daily search the page says what one is and offers to make one', /No daily searches yet/.test(h) && /Make your first daily search/.test(h));
  step('the Daily run tab says plainly that these run by themselves every morning, that Run now does not change that, and where to go for a one-off', /run on their own every morning/.test(h) && /does not change its schedule/.test(h) && /Find leads now/.test(h));
  await page.evaluate(() => window.fdNewSearch());
  h = await html();
  step('the name box is called "Name of the run" (the owner found a bare "Name" unclear)', /Name of the run/.test(h) && !/<div class="fd-label">Name<\/div>/.test(h));
  step('the form asks where to search — Apollo, Free job sources or Both — with Apollo ticked while Apollo is connected', /Search with/.test(h) && (h.match(/name="fd-src"/g) || []).length === 3 && /value="apollo" checked/.test(h) && /Free job sources/.test(h) && /Apollo plus the free sources/.test(h));
  await page.evaluate(() => window.fdPickSource('free'));
  h = await html();
  step('picking Free job sources warns that no key is saved yet, and says company size and industry words are Apollo-only and that it brings companies not people', /value="free" checked/.test(h) && /Free job sources are not connected yet/.test(h) && /company size and industry words do not apply/.test(h) && /not people/.test(h) && !/Apollo is not connected, so Apollo cannot be searched/.test(h));
  await page.evaluate(() => window.fdPickSource('apollo'));
  step('Apollo alone shows neither the warning nor the free-source note', !/Free job sources are not connected yet/.test(await html()) && !/company size and industry words do not apply/.test(await html()));
  await page.evaluate(() => { const a = window.STATE.finder.access; a.apollo.connected = false; a.jobsource.connected = true; window.fdNewSearch(); });
  h = await html();
  step('an organisation with no Apollo but a job-source key starts on Free job sources, and an Apollo pick warns that Apollo is not connected', /value="free" checked/.test(h) && (await page.evaluate(() => { window.fdPickSource('apollo'); return true; })) && /Apollo is not connected, so Apollo cannot be searched/.test(await html()));
  await page.evaluate(() => { const a = window.STATE.finder.access; a.apollo.connected = true; a.jobsource.connected = false; window.fdNewSearch(); });
  step('before any industry is picked the page says how to get titles to tick, and nothing is chosen', /Pick an industry above to get titles you can tick/.test(h) && /0 of 40 chosen/.test(h));
  await page.evaluate(() => { window.fdAddSector('medical'); window.fdAddSector('it'); });
  h = await html();
  step('SEVERAL industries can be picked: each is a chip with its own titles to tick (the old page took one)', /fd-chip">Medical &amp; dental/.test(h) && /fd-chip">IT &amp; software/.test(h) && /Dental Hygienist/.test(h) && /Software Engineer/.test(h));
  step('each picked industry is drawn exactly ONCE (one Select all and one Clear per industry — a screenshot once showed every block twice)', (h.match(/fdTitlesAll\('medical'\)/g) || []).length === 1 && (h.match(/fdTitlesAll\('it'\)/g) || []).length === 1 && (h.match(/fdTitlesNone\('medical'\)/g) || []).length === 1 && (h.match(/Dental Hygienist/g) || []).length === 1);
  step('…an unnamed run is named after the first industry, and nothing is ticked yet (0 of 4)', /value="Medical &amp; dental"/.test(h) && /0 of 4 ticked/.test(h) && !/aria-pressed="true"/.test(h));
  const titlesNow = () => page.evaluate(() => window.STATE.finder.form.titles.join('|'));
  await page.evaluate(() => window.fdTitleToggle('medical', 1));
  h = await html();
  step('ticking one title ticks just that one (shown with a tick, pressed state set for assistive tech)', (await titlesNow()) === 'Medical Assistant' && /aria-pressed="true"[^>]*>✓ Medical Assistant/.test(h) && /1 of 4 ticked/.test(h));
  await page.evaluate(() => window.fdTitlesAll('medical'));
  step('Select all ticks every title of that industry and does not repeat the one already ticked', (await titlesNow()) === 'Medical Assistant|Dental Hygienist|Phlebotomist|Medical Coder' && /4 of 4 ticked/.test(await html()));
  await page.evaluate(() => window.fdTitlesNone('medical'));
  step('Clear unticks that industry\'s titles', (await titlesNow()) === '');
  await page.evaluate(() => { window.fdTitleToggle('medical', 1); window.fdTitlesAll('it'); window.fdDropSector('it'); });
  h = await html();
  step('removing an industry hides its suggestions but keeps the titles already ticked, now under "Your titles"', !/fd-chip">IT &amp; software/.test(h) && (await titlesNow()) === 'Medical Assistant|Software Engineer|Data Analyst' && /Your titles/.test(h) && /fd-chip">Software Engineer/.test(h));
  await page.evaluate(() => { window.fdTitleDrop(1); window.fdTitleDrop(1); });
  step('a title chip can be removed with its ×', (await titlesNow()) === 'Medical Assistant');
  await page.evaluate(() => { document.getElementById('fd-f-newtitle').value = 'Welder, CNC Machinist, welder'; window.fdTitleAdd(); });
  h = await html();
  step('a title that is on no list can be typed (commas allowed, repeats ignored) and shows as a chip', (await titlesNow()) === 'Medical Assistant|Welder|CNC Machinist' && /fd-chip">Welder/.test(h));
  await page.evaluate(() => { document.getElementById('fd-f-newtitle').value = Array.from({ length: 50 }, (_, i) => 'Title ' + i).join(', '); window.fdTitleAdd(); });
  const capped = await page.evaluate(() => window.STATE.finder.form.titles.length);
  step('there is a ceiling of 40 titles at once, so one search cannot become a giant Apollo query', capped === 40, String(capped));
  await page.evaluate(() => { window.STATE.finder.form.titles = ['Medical Assistant', 'Welder', 'CNC Machinist']; window.fdTab('searches'); });
  // preferred companies
  await page.evaluate(() => { document.getElementById('fd-f-co').value = 'acme'; window.fdCoLookup(); });
  await page.waitForTimeout(150);
  h = await html();
  step('typing a company name and pressing Look up lists the real matches WITH where they are', /Acme Manufacturing/.test(h) && /Austin, Texas · acmemfg\.com · about 120 people/.test(h) && /Acme Foods/.test(h) && /Dallas, Texas/.test(h));
  step('…and the credit strip moves to what the server said it cost', /4\/300/.test(h.replace(/<[^>]+>/g, '')) || /4\/300/.test(await page.evaluate(() => document.getElementById('content').innerText)));
  await page.evaluate(() => window.fdCoAdd(0));
  h = await html();
  step('Add puts the chosen company on the search as a chip showing its place, and the result row says Added ✓', /fd-chip"><strong>Acme Manufacturing<\/strong> · Austin, Texas · acmemfg\.com/.test(h) && /Added ✓/.test(h) && /Only these companies will be searched/.test(h));
  await page.evaluate(() => window.fdCoAdd(1));
  await page.evaluate(() => { document.getElementById('fd-f-co').value = 'acme.com'; window.fdCoLookup(); });
  await page.waitForTimeout(150);
  const cos = await page.evaluate(() => window.STATE.finder.form.companies.map(c => c.domain).join('|'));
  step('as many companies as you like: a second and a pasted website (added straight away, no list to pick from) join the first', cos === 'acmemfg.com|acmefoods.com|acme.com', cos);
  await page.evaluate(() => { document.getElementById('fd-f-co').value = 'zzzz'; window.fdCoLookup(); });
  await page.waitForTimeout(150);
  h = await html();
  step('a name Apollo does not know says so in words and adds nothing', /Apollo has no company with that name/.test(h) && (await page.evaluate(() => window.STATE.finder.form.companies.length)) === 3);
  await page.evaluate(() => window.fdCoDrop(2));
  step('a company chip can be removed', (await page.evaluate(() => window.STATE.finder.form.companies.map(c => c.domain).join('|'))) === 'acmemfg.com|acmefoods.com');
  // posted-within slider
  h = await html();
  step('"Posted within" is a slider from today to 30 days (the old page had a 7/14/30 drop-down)', /<input id="fd-f-posted"[^>]*type="range"[^>]*min="0"[^>]*max="30"/.test(h) && /fd-posted-out" class="fd-strong">in the last 14 days/.test(h) && !/<select id="fd-f-posted"/.test(h));
  await page.evaluate(() => { const e = document.getElementById('fd-f-posted'); e.value = '3'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  step('moving the slider changes the words beside it without repainting the page', (await page.evaluate(() => document.getElementById('fd-posted-out').textContent)) === 'in the last 3 days');
  step('the slider is drawn in the app\'s own style (square, yellow-filled, not the browser\'s round default) and its fill follows the thumb: 3 of 30 days = 10%', await page.evaluate(() => { const e = document.getElementById('fd-f-posted'); return getComputedStyle(e).webkitAppearance === 'none' && e.style.getPropertyValue('--fd-pct') === '10%'; }));
  await page.evaluate(() => { const e = document.getElementById('fd-f-posted'); e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  step('one day reads "yesterday or today"', (await page.evaluate(() => document.getElementById('fd-posted-out').textContent)) === 'yesterday or today');
  await page.evaluate(() => { const e = document.getElementById('fd-f-posted'); e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  step('zero reads "today" — and is a real answer, not "unset"', (await page.evaluate(() => document.getElementById('fd-posted-out').textContent)) === 'today');
  await page.evaluate(() => { document.getElementById('fd-f-locations').value = 'Texas, remote'; document.querySelector('.fd-size-box[value=mid]').checked = true; });
  await page.evaluate(() => window.fdTab('searches'));
  h = await html();
  step('what was typed survives a repaint of the page — including a slider left at 0 (a 0 must never snap back to 14)', /value="Texas, remote"/.test(h) && (await page.evaluate(() => document.getElementById('fd-f-posted').value)) === '0' && /fd-posted-out" class="fd-strong">today/.test(h));
  await page.evaluate(() => window.fdPickSource('both'));
  await page.evaluate(() => window.fdSaveSearch());
  await page.waitForTimeout(250);
  const saved = (await calls()).find(c => c[0] === 'POST' && c[1] === '/finder/searches');
  step('Save sends clean lists: the titles ticked and typed, the places split on commas, the size, 0 days, the industries, and the chosen companies with their places', saved && saved[2].titles.join() === 'Medical Assistant,Welder,CNC Machinist' && saved[2].locations.join() === 'Texas,remote' && saved[2].sizes.join() === 'mid' && saved[2].posted_days === 0 && saved[2].sectors.join() === 'medical' && saved[2].source === 'both' && saved[2].sector === 'medical' && saved[2].companies.length === 2 && saved[2].companies[0].city === 'Austin' && saved[2].domains.join() === 'acmemfg.com,acmefoods.com' && saved[2].name === 'Medical & dental', JSON.stringify(saved && saved[2]));
  h = await html();
  step('the saved search says where it looks (Apollo + free job sources)', /looks in: Apollo \+ free job sources/.test(await html()));
  step('the saved search appears in the list with a Run now button', /Medical &amp; dental/.test(h) && /Run now/.test(h));
  await page.evaluate(() => { window.STATE.finder.searches = [{ id: 's3', name: 'Today only', active: true, source: 'free', sector: 'it', sectors: ['it', 'medical'], titles: ['Software Engineer'], locations: ['Ohio'], sizes: [], posted_days: 0, keywords: [], domains: ['acmemfg.com'], companies: [{ name: 'Acme Manufacturing', domain: 'acmemfg.com', city: 'Austin', state: 'Texas' }] }, { id: 's4', name: 'Old row', active: true, sector: 'it', titles: ['Welder'], locations: ['Ohio'], sizes: [], posted_days: 7, keywords: [], domains: ['oldco.com'] }]; window.fdTab('searches'); });
  h = await html();
  step('a daily search saved at 0 days reads "posted today", and one with chosen companies says how many', /posted today/.test(h) && /only 1 chosen company/.test(h) && /posted in the last 7 days/.test(h));
  await page.evaluate(() => window.fdEditSearch('s3'));
  h = await html();
  step('editing it brings back everything: both industries, the 0-day slider (not 14), and the company with its place', /fd-chip">IT &amp; software/.test(h) && /fd-chip">Medical &amp; dental/.test(h) && (await page.evaluate(() => document.getElementById('fd-f-posted').value)) === '0' && /Acme Manufacturing<\/strong> · Austin, Texas/.test(h) && /value="free" checked/.test(h));
  await page.evaluate(() => { window.fdCancelForm(); window.__calls.length = 0; window.fdToggleSearch('s3'); });
  await page.waitForTimeout(150);
  const tg = (await calls()).find(c => c[0] === 'PUT' && c[1] === '/finder/searches/s3');
  step('pausing a search sends it back whole — still 0 days, still its companies and industries (a pause must not widen it)', tg && tg[2].posted_days === 0 && tg[2].active === false && tg[2].companies.length === 1 && tg[2].sectors.join() === 'it,medical' && tg[2].source === 'free' && tg[2].name === 'Today only', JSON.stringify(tg && tg[2]));
  await page.waitForTimeout(150); await page.evaluate(() => { window.STATE.finder.searches = [{ id: 's4', name: 'Old row', active: true, sector: 'it', titles: ['Welder'], locations: ['Ohio'], sizes: [], posted_days: 7, keywords: [], domains: ['oldco.com'] }]; window.__calls.length = 0; window.fdEditSearch('s4'); });
  h = await html();
  step('a search saved before this change (websites only, no source) still opens: its websites show as company chips, and it looks in Apollo as it always did', /fd-chip"><strong>oldco\.com<\/strong>/.test(h) && /value="apollo" checked/.test(h));
  await page.evaluate(() => window.fdCancelForm());
  await page.evaluate(() => { window.__searches.push({ id: 's2', name: 'Second search', active: true, titles: ['Welder'], locations: ['Ohio'], sizes: [], posted_days: 14, keywords: [], domains: [] }); window.STATE.finder.searches = JSON.parse(JSON.stringify(window.__searches)); window.__hold = true; window.fdRun('s1'); });
  await page.waitForTimeout(150);
  const btns = await page.evaluate(() => [...document.querySelectorAll('#content .fd-card button')].filter(b => /Run now|Running/.test(b.textContent)).map(b => b.textContent.trim() + (b.disabled ? '(off)' : '')));
  step('while one search runs only ITS button says Running… — the other says Run now and is switched off', btns.join('|') === 'Running…(off)|Run now(off)' || btns.join('|') === 'Run now(off)|Running…(off)', btns.join('|'));
  await page.evaluate(() => { window.__hold = false; window.__release(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.fdTab('searches'));
  await page.evaluate(() => window.fdRun('s1'));
  await page.waitForTimeout(300);
  step('Run now asks the server to run THAT search, then shows the new cards', (await calls()).some(c => c[1] === '/finder/searches/s1/run') && (await page.evaluate(() => window.STATE.finder.tab)) === 'cards');
  await page.evaluate(() => window.fdTab('searches'));
  await page.evaluate(() => window.fdDeleteSearch('s1'));
  await page.waitForTimeout(200);
  step('Delete (after the confirmation) asks the server to delete that search', (await calls()).some(c => c[0] === 'DELETE' && c[1] === '/finder/searches/s1'));

  // ── admin tab ──────────────────────────────────────────────────────────
  step('an ordinary person has no "Access & job sources" tab', !/Access &amp; job sources/.test(await html()));
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

  step('the admin tab has a Free job sources card: no key yet, a password box (never plain text), and a plain explanation that the key is the organisation\'s own and finds companies, not people', /Free job sources \(JSearch\)/.test(h) && /No key saved yet/.test(h) && (await page.evaluate(() => { const e = document.getElementById('fd-js-key'); return !!e && e.type === 'password' && e.autocomplete === 'off'; })) && /organisation&#39;s own|organisation's own/.test(h) && /not people/.test(h) && !/Check my key/.test(h));
  await page.evaluate(() => { document.getElementById('fd-js-key').value = 'JS-KEY-ABCDEFGH1234'; window.fdJsSave(); });
  await page.waitForTimeout(250);
  h = await html();
  const jsPut = (await calls()).find(c => c[0] === 'PUT' && c[1] === '/finder/admin/jobsource');
  step('saving sends the key once; afterwards only its last four characters are shown, the box is empty again, and a Check my key button appears', jsPut && jsPut[2].api_key === 'JS-KEY-ABCDEFGH1234' && /A key is saved \(••••••1234\)/.test(h) && !/ABCDEFGH/.test(h) && /Check my key \(1 request\)/.test(h) && (await page.evaluate(() => document.getElementById('fd-js-key').value)) === '');
  step('the strip now shows the day\'s job-source requests', /Job-source requests today/.test(h));
  await page.evaluate(() => window.fdJsTest());
  await page.waitForTimeout(250);
  h = await html();
  step('Check my key says in words that it works', /The key works \(1 request used/.test(h) && (await calls()).some(c => c[0] === 'POST' && c[1] === '/finder/admin/jobsource/test'));
  await page.evaluate(() => window.fdJsRemove());
  await page.waitForTimeout(250);
  h = await html();
  step('Remove key sends an empty key and the card goes back to "No key saved yet"', (await calls()).some(c => c[0] === 'PUT' && c[1] === '/finder/admin/jobsource' && c[2].api_key === '') && /No key saved yet/.test(h) && !/Check my key/.test(h));
  await page.evaluate(() => { document.getElementById('fd-js-key').value = '   '; window.fdJsSave(); });
  step('an empty box is not sent', (await calls()).filter(c => c[0] === 'PUT' && c[1] === '/finder/admin/jobsource').length === 2);

  // the Accept window for a card whose people cannot be looked up by Apollo
  await page.evaluate((c) => { const a = window.STATE.finder.access; a.apollo.connected = false; window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.STATE.finder.cards.forEach(x => { x._base = []; }); window.fdAccept('c1'); }, CARDS);
  await page.waitForTimeout(250);
  m = await page.evaluate(() => String(window.STATE.modal));
  step('with no Apollo the Accept window does not offer Find people; it says so and opens "Add someone by hand"', !/>Find people</.test(m) && /Apollo is not connected here/.test(m) && /<details class="fd-manual" open>/.test(m));
  await page.evaluate((c) => { const a = window.STATE.finder.access; a.apollo.connected = true; window.fdCloseAccept(); window.STATE.finder.cards = JSON.parse(JSON.stringify(c.cards)); window.STATE.finder.cards.forEach(x => { x._base = []; x.domain = ''; }); window.fdAccept('c1'); }, CARDS);
  await page.waitForTimeout(250);
  m = await page.evaluate(() => String(window.STATE.modal));
  step('a company whose website is not known (a free-source card may not have one) says so and opens the by-hand form, even with Apollo connected', !/>Find people</.test(m) && /website is not known/.test(m) && /<details class="fd-manual" open>/.test(m));
  await page.evaluate(() => window.fdCloseAccept());

  // ── Find leads now (one-off) and Daily run ───────────────────────────────
  await page.evaluate(() => { window.STATE.finder.tab = 'cards'; window.goPage('finder'); });
  await page.waitForTimeout(300);
  h = await html();
  step('the tabs are: Today\'s cards · Find leads now · Daily run · Saved & past', /Today&#39;s cards|Today's cards/.test(h) && h.indexOf('Find leads now') > 0 && h.indexOf('Daily run') > h.indexOf('Find leads now') && h.indexOf('Saved &amp; past') > h.indexOf('Daily run'));
  await page.evaluate(() => window.fdTab('now'));
  h = await html();
  step('Find leads now is a search for right now: it says it is not saved and does not repeat, costs 1 credit, and asks for no name', /not saved and does not repeat/.test(h) && /1 Apollo credit/.test(h) && !(await page.evaluate(() => !!document.getElementById('fd-f-name'))) && /Find leads now<\/button>/.test(h));
  await page.evaluate(() => { document.getElementById('fd-f-newtitle').value = 'Welder, CNC Machinist'; window.fdTitleAdd(); document.getElementById('fd-f-locations').value = 'Ohio'; const e = document.getElementById('fd-f-posted'); e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); window.__findHold = true; window.__calls.length = 0; });
  await page.evaluate(() => { window.fdFindNow(); });
  await page.waitForTimeout(250);
  cs = await calls();
  const fnd = cs.find(c => c[0] === 'POST' && c[1] === '/finder/find');
  step('Find asks the server for a ONE-OFF search with what was typed — and never saves a search', fnd && fnd[2].titles.join() === 'Welder,CNC Machinist' && fnd[2].locations.join() === 'Ohio' && fnd[2].posted_days === 0 && !cs.some(c => c[0] === 'POST' && c[1] === '/finder/searches'), JSON.stringify(fnd));
  step('…then shows the new cards (it lands on Today\'s cards)', (await page.evaluate(() => window.STATE.finder.tab)) === 'cards');
  await page.evaluate(() => window.fdTab('now'));
  h = await html();
  step('the one-off form keeps what was typed and says what the search found', /value="Ohio"/.test(h) && /Found 5 companies hiring\. 3 new cards\./.test(h));
  await page.evaluate(() => window.fdSaveNowAsDaily());
  await page.waitForTimeout(250);
  const asDaily = (await calls()).find(c => c[0] === 'POST' && c[1] === '/finder/searches');
  step('"Also run this every day" is the ONLY way a one-off becomes a daily search — it saves it with a name made from what was typed', asDaily && asDaily[2].name === 'Welder in Ohio' && asDaily[2].titles.join() === 'Welder,CNC Machinist', JSON.stringify(asDaily && asDaily[2]));
  await page.evaluate(() => { window.__findResp = { results: [{ search_id: null, note: 'You just searched. Give it a minute.', skipped: true, cards: 0 }], new_cards: 0 }; window.fdFindNow(); });
  await page.waitForTimeout(250);
  h = await html();
  step('a search that finds nothing new stays on the form and says why', (await page.evaluate(() => window.STATE.finder.tab)) === 'now' && /You just searched/.test(h));
  await page.evaluate(() => { window.__findResp = null; });
  await page.evaluate(() => { window.STATE.finder.cards = [{ id: 'o1', search_id: null, company_name: 'One Off Co', status: 'new', chips: [], _base: [], decision: { blocked: false } }, { id: 'o2', search_id: 's1', company_name: 'Daily Co', status: 'new', chips: [], _base: [], decision: { blocked: false } }]; window.STATE.finder.cardSearch = ''; window.fdTab('cards'); });
  h = await html();
  step('Today\'s cards tells one-off cards from daily ones in its choices', /One-off searches · 1/.test(h));

  // ── saved & past ───────────────────────────────────────────────────────
  await switchRole(page, 'ra');
  await page.evaluate(() => { window.__searches = [{ id: 's1', name: 'Machining', active: true, titles: ['Welder'], locations: ['Texas'], sizes: [], posted_days: 14, keywords: [], domains: [] }, { id: 's2', name: 'Dental', active: true, titles: ['Hygienist'], locations: ['Ohio'], sizes: [], posted_days: 14, keywords: [], domains: [] }]; window.STATE.finder.searches = JSON.parse(JSON.stringify(window.__searches)); window.goPage('finder'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.fdTab('history'));
  await page.waitForTimeout(300);
  h = await html();
  step('there is a "Saved & past" tab that opens on the companies saved as leads, with its count', /Saved &amp; past/.test(h) && /Saved Machining/.test(h) && /Saved as leads · 2/.test(h) && /Waiting · 1/.test(h) && /Turned down · 1/.test(h) && !/Parked Dental/.test(h));
  step('each saved company shows its place, which search found it, and the lead it became (job and stage) with an Open lead button', /Waco, TX/.test(h) && /Found by Machining/.test(h) && /<strong>Welder<\/strong> · Assigned/.test(h) && /Open lead/.test(h));
  step('a lead handed to someone else is not described — it says so', /now belongs to someone else/.test(h));
  step('a saved company has a "POCs & jobs" button (and the others do not)', /POCs &amp; jobs/.test(h) && (h.match(/POCs &amp; jobs/g) || []).length === 1 && !/Dana Cole/.test(h));
  await page.evaluate(() => window.fdHistToggle('a1'));
  h = await html();
  step('opening it shows the people to contact (main contact marked, with title and email) and the jobs (main job, also hiring, and the ones Apollo listed, with a link)', /Dana Cole/.test(h) && /main contact/.test(h) && /dana@saved\.example/.test(h) && /Eli Ross/.test(h) && /main job/.test(h) && /also hiring/.test(h) && /href="https:\/\/jobs\.example\/2"/.test(h) && /Indeed/.test(h));
  await page.evaluate(() => window.fdHistToggle('a1'));
  step('…and Hide closes it again', !/Dana Cole/.test(await html()));
  await page.evaluate(() => window.fdHistSearch('s2'));
  h = await html();
  step('the searches can be told apart: picking one shows only what THAT search found', /Handed Co/.test(h) && !/Saved Machining/.test(h));
  await page.evaluate(() => { window.fdHistSearch(''); window.fdHistStatus('waiting'); });
  h = await html();
  step('Waiting shows when each comes back, with a Show now button', /Parked Dental/.test(h) && /Comes back on/.test(h) && /Show now/.test(h));
  await page.evaluate(() => window.fdUnwait('w1', null));
  await page.waitForTimeout(250);
  step('Show now asks the server to bring that company back', (await calls()).some(c => c[0] === 'POST' && c[1] === '/finder/cards/w1/unwait'));
  await page.evaluate(() => window.fdHistStatus('rejected'));
  h = await html();
  step('Turned down shows the name and says it will never be shown again', /Declined Inc/.test(h) && /never shown to you again/.test(h));
  step('it says how many older ones are hidden, offers to show everything, and says when undecided cards are removed', /3 older than 90 days are hidden/.test(h) && /Show everything/.test(h) && /removed after 5 days/.test(h));
  await page.evaluate(() => { document.getElementById('fd-hq').value = 'zzz'; window.fdHistQ('zzz'); });
  h = await html();
  step('the name box narrows the list, and says when nothing matches', /Nothing matches/.test(h));
  await page.evaluate(() => { window.fdHistQ(''); window.fdHistAll(); });
  await page.waitForTimeout(250);
  step('"Show everything" asks for all of it', (await calls()).some(c => c[0] === 'GET' && c[1] === '/finder/history?all=1'));
  await page.evaluate(() => window.fdTab('searches'));
  h = await html();
  step('on My searches each search says what it found before, with a See them button that opens the history for just that search', /Found before: 1 saved as leads · 1 waiting · 0 turned down/.test(h) && await page.evaluate(() => { window.fdHistFor('s1'); return window.STATE.finder.tab === 'history' && window.STATE.finder.histSearch === 's1' && window.STATE.finder.histStatus === 'accepted'; }));
  await page.evaluate(() => { window.STATE.jobs = [{ id: 'L7' }]; window.fdOpenLead('L7'); });
  step('Open lead takes the person to that lead', (await page.evaluate(() => window.STATE.modal && window.STATE.modal.type)) === 'jobDetail');
  await page.evaluate(() => { window.STATE.modal = null; window.STATE.jobs = []; window.goPage('finder'); window.fdOpenLead('L7'); });
  step('…and when the lead is not on their list it says why instead of doing nothing', !(await page.evaluate(() => window.STATE.modal && window.STATE.modal.type)));

  // ── phone ──────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { window.STATE.finder.cards = JSON.parse(JSON.stringify(window.__cards.cards)); window.fdTab('cards'); });
  await page.waitForTimeout(200);
  step('on a phone nothing overflows the page sideways', await page.evaluate(() => { const c = document.getElementById('content'); return c.scrollWidth <= c.clientWidth + 1; }));

  await page.setViewportSize({ width: 1200, height: 900 });
  await switchRole(page, 'bd');
  await page.evaluate(() => { window.__refreshed = 0; window.goPage('leads'); });
  await page.waitForTimeout(300);
  step('the Leads page has a refresh button, like the Inbox', await page.evaluate(() => !!document.querySelector('#content .tbar-ico[title="Refresh leads"]')));
  await page.evaluate(() => document.querySelector('#content .tbar-ico[title="Refresh leads"]').click());
  await page.waitForTimeout(200);
  step('…and pressing it reloads the leads from the server', (await page.evaluate(() => window.__refreshed)) >= 1);

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
