// A MANAGER OR RA LEAD CAN CORRECT A LEAD LATER (owner, 14 Oct: "an option to edit the lead … to the manager and lead RA, not RA, that
// even if that information is wrong they can edit it later"; the recording shows a company description in "Found by").
//
// In a real browser against a stub API:
//   * "Edit lead" is OFFERED to an admin and an RA lead, and to a BD only on a lead they (or someone they manage) own — never to an RA;
//   * the window opens with the lead's CURRENT values, including the wrong one, and says before saving that a description in "Found
//     by" will be moved to Notes;
//   * Save sends the fields to PUT /jobs/:id and the person is told what the server moved;
//   * a refused save (403) stays open and says why — never a silent no-op;
//   * a very long "Found by" does not print a page of text in the lead's side panel;
//   * the "Auto-replied" tag shows on an Assigned lead that has one, and not on a lead that is already Connected.
// Usage: node test/lead-edit-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
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
const DESC = 'Company Description Venture Visionary Partners is a registered independent wealth management firm that advises affluent families, individuals, business owners, and entrepreneurs on how to be strategically smarter with their wealth.';
const NOW = Date.now(), D = 86400000;
const mk = (id, over) => Object.assign({ id, company_id: 'co1', company: { name: 'Venture Visionary Partners', industry: 'Financial Services' }, position: 'Financial Advisor', location: 'Sylvania, OH', stage: 'Assigned',
  assigned_to_bd: 'test-bd', bd_assignee: { name: 'Test BD' }, assigned_at: new Date(NOW - D).toISOString(), created_at: new Date(NOW - 2 * D).toISOString(), source: DESC, notes: 'Called once.', industry: 'Financial Services',
  contacts: [{ id: 'c-' + id, job_id: id, first_name: 'Deb', last_name: 'Beaty', designation: 'Director', email: 'deb@vvp.com', is_primary: true, email_status: 'valid' }] }, over || {});
const JOBS = [mk('L1'), mk('L2', { assigned_to_bd: 'someone-else', source: 'LinkedIn', position: 'Planner' }), mk('L3', { source: 'Indeed', position: 'Analyst', auto_replied_at: new Date(NOW).toISOString() }),
  mk('L4', { source: 'Indeed', position: 'Associate', stage: 'Connected', auto_replied_at: new Date(NOW).toISOString() })];
const calls = []; let putStatus = 200;
const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function api(route) {
  const req = route.request(), p = new URL(req.url()).pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch (_) {}
  calls.push({ m, p, body });
  if (m === 'GET' && p === '/jobs') return reply(route, JOBS);
  if (m === 'PUT' && /^\/jobs\/L\d$/.test(p)) {
    if (putStatus !== 200) return reply(route, { error: 'Forbidden' }, putStatus);
    return reply(route, Object.assign({}, JOBS[0], body, { moved: [{ field: 'source', to: 'notes', text: 'Company Description Venture Visionary Partners is a regis…', why: 'x' }], moved_sentence: 'Moved "Company Description Venture Visionary Partners is a regis…" from Found by to Notes — it was in the wrong place.' }));
  }
  return reply(route, m === 'GET' ? [] : {});
}

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (u.startsWith(API)) return api(r); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  const load = async (role) => {
    await enterApp(page, role);
    await page.evaluate((raw) => { STATE.jobs = raw.map(normaliseJob); STATE.contacts = flattenContacts(raw); STATE.leads = STATE.jobs; STATE.page = 'leads'; render(); }, JOBS);
    await page.waitForSelector('#content tr[data-row-id="L1"]', { timeout: 8000 });
  };
  const open = async (id) => { await page.evaluate((id) => document.querySelector('#content tr[data-row-id="' + id + '"] td:nth-child(3)').click(), id); await page.waitForTimeout(250); };
  const offered = (id) => page.evaluate((id) => { const p = document.querySelector('#content tr.row-exp'); return !!(p && [...p.querySelectorAll('button')].some(b => b.textContent.trim() === 'Edit lead')); });

  // ── who is offered it ──
  for (const [role, expect] of [['admin', true], ['ra_lead', true], ['ra', false], ['bd', true]]) {
    await load(role === 'ra' ? 'admin' : role);          // an RA's own page is a different screen; the rule is proven on canEditLead below
    await open('L1');
    if (role !== 'ra') step(role + ' is offered "Edit lead" on a lead', (await offered('L1')) === expect);
  }
  step('an RA is not allowed to edit (canEditLead)', await page.evaluate(() => { STATE.user = Object.assign({}, STATE.user, { id: 'test-ra', role: 'ra', roles: ['ra'] }); return canEditLead(STATE.jobs[0]); }) === false);
  await load('bd'); await open('L2');
  step('a BD is NOT offered it on a lead somebody else owns', (await offered('L2')) === false);

  // ── the window ──
  await load('ra_lead'); await open('L1');
  step('the side panel does not print the whole description under "Found by"', await page.evaluate(() => { const kv = [...document.querySelectorAll('#content tr.row-exp .lx-kv')].find(x => /Found by/.test(x.textContent)); return !!kv && kv.textContent.length < 120; }));
  await page.evaluate(() => [...document.querySelectorAll('#content tr.row-exp button')].find(b => b.textContent.trim() === 'Edit lead').click());
  await page.waitForSelector('#le-source', { timeout: 4000 });
  const win = await page.evaluate(() => ({ source: document.getElementById('le-source').value, pos: document.getElementById('le-position').value, notes: document.getElementById('le-notes').value, hint: document.getElementById('le-hint-source').textContent, title: document.querySelector('.modal .mt').textContent }));
  step('the window opens with the lead\'s current values — including the wrong one', win.source.startsWith('Company Description') && win.pos === 'Financial Advisor' && win.notes === 'Called once.' && win.title === 'Edit lead');
  step('…and says, before saving, that the description will be moved to Notes', /move it to Notes/.test(win.hint), win.hint);
  await page.fill('#le-source', 'LinkedIn');
  step('typing a proper value clears the hint (without repainting the window)', await page.evaluate(() => document.getElementById('le-hint-source').textContent === ''));
  await page.fill('#le-source', DESC);
  await page.fill('#le-position', 'Senior Financial Advisor');
  await page.click('#le-save'); await page.waitForTimeout(500);
  const put = calls.filter(c => c.m === 'PUT').pop();
  step('Save sends the lead\'s fields to PUT /jobs/:id', put && put.p === '/jobs/L1' && put.body.position === 'Senior Financial Advisor' && put.body.source === DESC && put.body.notes === 'Called once.' && 'salary_range' in put.body, JSON.stringify(put && put.body).slice(0, 120));
  step('…the person is told what the server moved', await page.evaluate(() => /from Found by to Notes/.test(document.body.innerText)));
  step('…and the window closes', await page.evaluate(() => !document.getElementById('le-source')));

  // ── a refused save ──
  await open('L1'); await page.waitForTimeout(150);
  if (!(await offered('L1'))) await open('L1');
  putStatus = 403;
  await page.evaluate(() => openLeadEdit('L1'));
  await page.waitForSelector('#le-source'); await page.click('#le-save'); await page.waitForTimeout(400);
  step('a refused save stays open and says why', await page.evaluate(() => !!document.getElementById('le-source') && /Forbidden/.test(document.querySelector('.modal').innerText)));
  putStatus = 200;
  await page.evaluate(() => leadEditClose());

  // ── the tag ──
  await load('admin');
  const tags = await page.evaluate(() => ({ l3: (document.querySelector('#content tr[data-row-id="L3"]') || {}).innerText || '', l4: (document.querySelector('#content tr[data-row-id="L4"]') || {}).innerText || '' }));
  step('an Assigned lead that has only auto-replied wears an "Auto-replied" tag', /Auto-replied/.test(tags.l3));
  step('…and a lead that is already Connected does not', !/Auto-replied/.test(tags.l4));
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('the probe ran to the end', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
