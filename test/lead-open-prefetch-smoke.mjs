// OPENING A LEAD IS ONE DRAW, NOT TWO (owner, 14 Oct: "when a lead is opened it takes time to completely load" — the recording shows
// the panel opening with the plain contact list, then jumping to the four "People to reach" slots, then growing again).
//
// The people and the emails used to be read from the server only AFTER the panel opened. Now resting the pointer on a row (or touching
// it) starts both reads, so by the click they are here. Pinned in a real browser against a stub API with a slow server (600 ms):
//   * resting on a row for a moment asks the server for that lead's people and emails — before any click;
//   * sweeping across rows without resting asks for nothing;
//   * the first frame after a click on a hovered row already has the four slots (no plain list first, no second write);
//   * a row nobody hovered still opens as before (plain list first, slots when the answer comes);
//   * a hover that already fetched is not fetched twice on open; a LATER open asks again (the answer can have changed).
// Usage: node test/lead-open-prefetch-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const poc = require('../services/poc-targets.js');

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
const API = 'https://fute-lms-backend.onrender.com';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}

const NOW = Date.now(), D = 86400000;
const companies = { co1: { id: 'co1', name: 'Acme Builders', website: 'https://www.acmebuild.com' }, co2: { id: 'co2', name: 'Newco Mechanical', website: 'newcomech.com' }, co3: { id: 'co3', name: 'Third Co', website: 'thirdco.com' } };
const jobs = ['j1', 'j2', 'j3'].map((id, i) => ({ id, company_id: 'co' + (i + 1), position: 'Estimator ' + (i + 1), industry: 'Construction', stage: 'Assigned', assigned_to_bd: 'test-bd', created_at: new Date(NOW - (i + 1) * D).toISOString() }));
const contacts = jobs.map((j, i) => ({ id: 'c' + (i + 1), job_id: j.id, first_name: 'Maria' + i, last_name: 'Lopez', designation: 'HR Manager', email: 'm' + i + '@x' + i + '.com', is_primary: true, email_status: 'valid' }));
function pocPayload(id) {
  const j = jobs.find(x => x.id === id), cs = contacts.filter(c => c.job_id === id);
  const t = poc.pocTargets({ position: j.position, industry: j.industry }, null), f = poc.fillSlots(t, cs), fmt = poc.learnFormat(cs, companies[j.company_id].website);
  return { lead_id: id, company_id: j.company_id, size: t.size, size_known: t.size_known, sizes: poc.SIZE_BANDS, function: t.function,
    slots: f.slots.map(s => ({ key: s.key, kind: s.kind, label: s.label, titles: s.titles, contact_id: s.contact_id })), others: f.others, found: 1,
    format: { domain: fmt.domain, pattern: fmt.pattern, learned_from: fmt.learned_from, example: null }, suggestions: [], finder: { apollo: false, credits: { used: 0, limit: 20 } }, can_edit: true };
}
const rawJobs = () => jobs.map(j => ({ id: j.id, company_id: j.company_id, company: { name: companies[j.company_id].name, industry: j.industry, website: companies[j.company_id].website },
  position: j.position, location: 'Austin, TX', stage: j.stage, assigned_to_bd: j.assigned_to_bd, bd_assignee: { name: 'Test BD' }, assigned_at: j.created_at, created_at: j.created_at, industry: j.industry, contacts: contacts.filter(c => c.job_id === j.id) }));
const calls = [];
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function api(route) {
  const req = route.request(), p = new URL(req.url()).pathname, m = req.method();
  calls.push({ m, p });
  let hit;
  if (m === 'GET' && (hit = p.match(/^\/jobs\/([^/]+)\/poc$/))) { await new Promise(r => setTimeout(r, 600)); return reply(route, pocPayload(hit[1])); }
  if (m === 'GET' && (hit = p.match(/^\/leads\/([^/]+)\/intel$/))) { await new Promise(r => setTimeout(r, 300)); return reply(route, { enabled: false }); }
  if (m === 'GET' && p === '/jobs') return reply(route, rawJobs());
  return reply(route, m === 'GET' ? [] : {});
}
const asked = (re) => calls.filter(c => re.test(c.p)).length;

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (u.startsWith(API)) return api(r); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate((raw) => { STATE.jobs = raw.map(normaliseJob); STATE.contacts = flattenContacts(raw); STATE.leads = STATE.jobs; STATE.page = 'leads'; render(); }, rawJobs());
  await page.waitForSelector('#content tr[data-row-id="j1"]', { timeout: 8000 });
  const row = (id) => page.locator('#content tr[data-row-id="' + id + '"] td').nth(2);
  // first-frame probe: click, then let ONLY microtasks run (what the browser does before it paints), and read the panel
  const clickAndLook = (id) => page.evaluate((id) => new Promise((resolve) => {
    document.querySelector('#content tr[data-row-id="' + id + '"] td:nth-child(3)').click();
    Promise.resolve().then(() => Promise.resolve()).then(() => { const b = document.getElementById('lx-poc-' + id); resolve({ exists: !!b, slots: !!(b && b.querySelector('.lxc')), plain: !!(b && !b.querySelector('.lxc') && /contacts/i.test(b.innerText)) }); });
  }), id);

  // ── nothing is asked for by sweeping across the table ──────────────────
  await row('j1').hover(); await row('j2').hover(); await row('j3').hover();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  step('sweeping across rows without resting asks the server for nothing', asked(/\/poc$/) === 0 && asked(/\/intel$/) === 0, JSON.stringify(calls.map(c => c.p)));

  // ── resting on a row asks, before any click ────────────────────────────
  await row('j1').hover();
  await page.waitForTimeout(1100);   // 90 ms to rest + the 600 ms the stub server takes
  step('resting on a row asks for that lead\'s people before any click', asked(/^\/jobs\/j1\/poc$/) === 1);
  step('…and its emails', asked(/^\/leads\/j1\/intel$/) === 1);
  const first = await clickAndLook('j1');
  step('the FIRST frame after the click already has the four slots', first.exists && first.slots, JSON.stringify(first));
  step('…and it is not the plain list first', !first.plain);
  await page.waitForTimeout(900);
  step('a hover that already fetched is not fetched a second time on open', asked(/^\/jobs\/j1\/poc$/) === 1 && asked(/^\/leads\/j1\/intel$/) === 1, 'poc ' + asked(/^\/jobs\/j1\/poc$/));

  // ── a LATER open asks again ────────────────────────────────────────────
  await clickEl(page, 'j1');                    // close
  await page.waitForTimeout(100);
  await clickEl(page, 'j1');                    // open again, no hover in between
  await page.waitForTimeout(900);
  step('a later open asks again — the answer can have changed since', asked(/^\/jobs\/j1\/poc$/) === 2, 'poc ' + asked(/^\/jobs\/j1\/poc$/));

  // ── a row nobody hovered opens as before ───────────────────────────────
  const cold = await clickAndLook('j3');
  step('a row nobody hovered shows the plain contact list first', cold.exists && cold.plain && !cold.slots, JSON.stringify(cold));
  await page.waitForTimeout(1000);
  step('…and the four slots when the answer arrives', await page.evaluate(() => !!document.querySelector('#lx-poc-j3 .lxc')));

  // ── a touch is a hover ─────────────────────────────────────────────────
  const before = asked(/^\/jobs\/j2\/poc$/);
  await page.evaluate(() => { const td = document.querySelector('#content tr[data-row-id="j2"] td:nth-child(3)'); td.dispatchEvent(new Event('touchstart', { bubbles: true })); });
  await page.waitForTimeout(300);
  step('touching a row (a phone) asks at once', asked(/^\/jobs\/j2\/poc$/) === before + 1);
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the probe ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
async function clickEl(page, id) { await page.evaluate((id) => document.querySelector('#content tr[data-row-id="' + id + '"] td:nth-child(3)').click(), id); }
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
