// COMPOSE, COMPANY FIRST — Email → Compose → "Find at a company" on screen (R-320, D-0191, owner 29 Oct: "Company first").
//   * a company name is looked up (POST /finder/companies/suggest), picked, and its people listed (POST /finder/compose/people)
//     with the place and titles typed — the place keeps its comma
//   * nobody can be ticked before their email is found; "Find email · 1 credit" (POST /finder/compose/reveal) fills it and ticks
//   * "Write N emails" asks the same writer as the one-person composer (POST /outreach/generate) once per ticked person, with
//     THAT person's first name and title, and the posting pasted once
//   * each email can be edited and sent alone, or "Send all" — each through POST /outreach/send with the sequence picked
//   * no vendor's name is written on the screen; a phone does not overflow sideways; screenshots (COMPOSE_SHOT_DIR=…)
// Usage: node test/compose-company-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
const SHOTS = process.env.COMPOSE_SHOT_DIR || '';
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const rep = (r, b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

const PEOPLE = [
  { id: 'p1', first_name: 'Nina', last_name: '', last_name_hint: 'Pa***k', title: 'Talent Acquisition Lead', revealed: false, email: null },
  { id: 'p2', first_name: 'Omar', last_name: 'Diaz', title: 'Controller', revealed: false, email: null },
  { id: 'p3', first_name: 'Lee', last_name: 'Wong', title: 'HR Manager', revealed: false, email: null },
];
const calls = [];
const bodyOf = (r) => { try { return JSON.parse(r.request().postData() || '{}'); } catch (_) { return {}; } };
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 } });
  await ctx.route('**', (r) => {
    const u = r.request().url(); if (u.startsWith(BASE)) return r.continue();
    if (u.startsWith(API)) {
      const p = new URL(u).pathname, m = r.request().method(), b = bodyOf(r); calls.push({ m, p, b });
      if (p === '/finder/companies/suggest') return rep(r, { suggestions: [{ name: 'Brazos Valley Machining', domain: 'brazosmachining.example', city: 'Waco', state: 'Texas' }, { name: 'Brazos Tooling', domain: 'brazostool.example', city: 'Austin', state: 'Texas' }], used_credit: true, credits: { used: 1, limit: 300 }, note: '' });
      if (p === '/finder/compose/people') return rep(r, { people: PEOPLE, total: 3, domain: b.domain, provider: 'Your contact database' });
      if (p === '/finder/compose/reveal') {
        const email = b.person_id === 'p2' ? null : (b.person_id === 'p1' ? 'nina.park@brazosmachining.example' : 'lee.wong@brazosmachining.example');
        return rep(r, { person: { id: b.person_id, first_name: (PEOPLE.find((x) => x.id === b.person_id) || {}).first_name, last_name: b.person_id === 'p1' ? 'Park' : '', title: '', email }, note: email ? null : 'Your contact database has no verified email for this person.', credits: { used: 2, limit: 300 } });
      }
      if (p === '/outreach/generate') return rep(r, { variants: [{ id: 'v1', subject: 'CNC Machinist hire in Waco — for ' + b.contact_first_name, email: 'Hi ' + b.contact_first_name + ',\n\nA note about the CNC Machinist role.\n\nThanks,' }], mode: 'rules', ai_available: false });
      if (p === '/outreach/send') return rep(r, { ok: true, mailbox: 'bea@x.test', sequence: b.sequence_id ? { id: b.sequence_id } : null });
      if (p === '/outreach/sequences') return rep(r, [{ id: 'sq1', name: 'Manufacturing first touch', steps: 3, next_step: { name: 'Follow-up 1', delay_days: 3 } }]);
      if (p === '/outreach/sender') return rep(r, { mailbox: { email_address: 'bea@x.test' }, signature_html: '' });
      return rep(r, m === 'GET' ? [] : {});
    }
    return r.abort();
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  const text = () => ev(() => document.getElementById('content').innerText);
  await ev(() => { STATE.page = 'email'; STATE.emailTab = 'compose'; STATE.composeSide = 'leads'; render(); });
  await page.waitForTimeout(400);
  step('Compose offers "Find at a company" beside "Someone in PACE" and "Someone new"', /Find at a company/.test(await text()) && /Someone in PACE/.test(await text()));

  await ev(() => outreachRecipMode('company')); await page.waitForTimeout(200);
  step('company mode: a company box, the cost said up front, and the per-person boxes (first name, send to) are gone', !!(await page.$('#ogc-q')) && /uses 1 credit when the company is found/.test(await text()) && !(await page.$('#og-first')) && !(await page.$('#og-to')) && !!(await page.$('#og-jd')));
  await page.fill('#ogc-q', 'Brazos'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  step('Enter looks the company up and lists the matches with where they are', calls.some((c) => c.p === '/finder/companies/suggest' && c.b.q === 'Brazos') && /Brazos Valley Machining/.test(await text()) && /Waco, Texas · brazosmachining.example/.test(await text()), JSON.stringify(calls.slice(-2)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'compose-company-pick.png') });

  await page.click('.ogc-row'); await page.waitForTimeout(300);
  let pc = calls.filter((c) => c.p === '/finder/compose/people').pop();
  step('picking a company lists its people at once, by its website', pc && pc.b.domain === 'brazosmachining.example' && /Nina Pa\*\*\*k/.test(await text()) && /Omar Diaz/.test(await text()), JSON.stringify(pc && pc.b));
  await page.fill('#ogc-loc', 'Waco, Texas'); await page.fill('#ogc-title', 'Talent Acquisition, HR');
  await page.click('text=Show people'); await page.waitForTimeout(300);
  pc = calls.filter((c) => c.p === '/finder/compose/people').pop();
  step('"Show people" sends the place and the titles as typed', pc.b.location === 'Waco, Texas' && pc.b.title === 'Talent Acquisition, HR', JSON.stringify(pc.b));
  step('nobody can be ticked before their email is found', await ev(() => [...document.querySelectorAll('.ogc-person input[type=checkbox]')].every((x) => x.disabled)));

  const btns = await page.$$('.ogc-person .btn');
  step('each person has "Find email · 1 credit"', btns.length === 3 && /Find email · 1 credit/.test(await btns[0].innerText()));
  await btns[0].click(); await page.waitForTimeout(300);
  await (await page.$$('.ogc-person .btn'))[0].click(); await page.waitForTimeout(300);   // Omar (now first button left)
  await (await page.$$('.ogc-person .btn'))[0].click(); await page.waitForTimeout(300);   // Lee
  const rv = calls.filter((c) => c.p === '/finder/compose/reveal');
  step('finding an email sends who it is, with what the list said about them', rv.length === 3 && rv[0].b.person_id === 'p1' && rv[0].b.seen.title === 'Talent Acquisition Lead', JSON.stringify(rv.map((x) => x.b)));
  const t1 = await text();
  step('a found email shows and that person is ticked; no verified email is said plainly and stays unticked', /nina.park@brazosmachining.example/.test(t1) && /No verified email/.test(t1) && await ev(() => { const r = [...document.querySelectorAll('.ogc-person')]; return r[0].querySelector('input').checked && !r[1].querySelector('input').checked && r[1].querySelector('input').disabled && r[2].querySelector('input').checked; }));
  step('the Write button counts only the ticked people with an email (2)', /Write 2 emails/.test(t1));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'compose-company-people.png') });

  await ev(() => { const el = document.getElementById('og-jd'); el.value = 'CNC Machinist — Waco, TX. Brazos Valley Machining is hiring a CNC Machinist to run Haas mills.'; el.dispatchEvent(new Event('input', { bubbles: true })); const jt = document.getElementById('og-jobtitle'); jt.value = 'CNC Machinist'; jt.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('text=Write 2 emails'); await page.waitForTimeout(700);
  const gens = calls.filter((c) => c.p === '/outreach/generate');
  step('one email is written per ticked person, each with THAT person\'s first name and title, the posting pasted once', gens.length === 2 && gens[0].b.contact_first_name === 'Nina' && gens[0].b.contact_title === 'Talent Acquisition Lead' && gens[1].b.contact_first_name === 'Lee' && gens.every((g) => /Haas mills/.test(g.b.job_description) && g.b.company === 'Brazos Valley Machining' && g.b.location === 'Waco, Texas'), JSON.stringify(gens.map((g) => g.b)));
  const t2 = await text();
  const subjects = await ev(() => [...document.querySelectorAll('.ogc-draft input.inp')].map((x) => x.value));
  step('both drafts show, each named, editable, with "Send this one" and "Send all (2)"', /2 emails/.test(t2) && /Nina Park/.test(t2) && /Lee Wong/.test(t2) && subjects.join('|') === 'CNC Machinist hire in Waco — for Nina|CNC Machinist hire in Waco — for Lee' && (await page.$$('.ogc-body')).length === 2 && /Send all \(2\)/.test(t2), JSON.stringify(subjects));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'compose-company-drafts.png'), fullPage: true });

  await ev(() => { const t = document.querySelectorAll('.ogc-body')[0]; t.value = 'Hi Nina,\n\nEdited by hand.\n\nThanks,'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await ev(() => { const s = [...document.querySelectorAll('select')].find((x) => /Manufacturing first touch/.test(x.innerHTML)); s.value = 'sq1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('text=Send this one'); await page.waitForTimeout(400);
  let sends = calls.filter((c) => c.p === '/outreach/send');
  step('"Send this one" sends the EDITED email to that person, into the picked sequence', sends.length === 1 && sends[0].b.to === 'nina.park@brazosmachining.example' && /Edited by hand/.test(sends[0].b.body) && sends[0].b.sequence_id === 'sq1' && sends[0].b.name === 'Nina', JSON.stringify(sends[0] && sends[0].b));
  step('…and that one now says Sent; Send all counts what is left (1)', /Sent/.test(await text()) && /Send all \(1\)/.test(await text()));
  await page.click('text=Send all (1)'); await page.waitForTimeout(500);
  sends = calls.filter((c) => c.p === '/outreach/send');
  step('"Send all" sends the rest, once each (no one twice)', sends.length === 2 && sends[1].b.to === 'lee.wong@brazosmachining.example', JSON.stringify(sends.map((s) => s.b.to)));
  step('no vendor\'s name is written on the screen', !/Apollo|ZoomInfo|Lusha/i.test(await text()));

  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  step('on a phone nothing overflows sideways', await ev(() => { const c = document.getElementById('content'); return c.scrollWidth <= c.clientWidth + 1; }), await ev(() => { const c = document.getElementById('content'); return c.scrollWidth + ' > ' + c.clientWidth; }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'compose-company-phone.png') });
  step('no console/page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
