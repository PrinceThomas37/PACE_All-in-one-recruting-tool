// THE LEADS INDUSTRY FILTER FILTERS (R-312, owner 26 Oct: "filtering leads by industry is not working out, also I need a search
// bar to search the industry in the industry filter button").
//
// Cause: the dropdown offered PACE's fixed 44-category list ("Architecture, Construction & Building Materials"), but leads carry
// the names Apollo / LinkedIn give them ("Construction", "Law Practice") — an exact match almost never happened. Now:
//   · the list is the industries the person's leads actually carry, most common first, with how many;
//   · a lead's industry is its own, else its company's (company_ind), matched ignoring case and spaces;
//   · a long list has a search box that hides rows IN PLACE (typing never repaints, so focus stays in the box);
//   · a name with an apostrophe works (it used to break the onchange string).
// Usage: node test/leads-industry-filter-smoke.mjs   (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }

let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', (r) => { const u = r.request().url(); if (u.startsWith(BASE + '/') && !/\/(jobs|users|companies|reminders|industries|emails|mailbox|finder|leads|my-setup|next-actions)/.test(new URL(u).pathname)) return r.continue(); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'admin');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const now = Date.now(), iso = new Date(now).toISOString();
    const L = (id, co, ownInd, coInd) => ({ id, position: 'Role ' + id, pos: 'Role ' + id, company_id: 'c' + id, company_name: co, company_ind: coInd || '', industry: ownInd || '',
      location: 'Austin, TX', loc: 'Austin, TX', stage: 'Assigned', date: iso.slice(0, 10), created_at: iso, updated_at: iso, assigned_to_bd: 'test-adm', assigned_bd_name: 'Test Admin', contacts: [] });
    window.STATE.industriesList = ['Architecture, Construction & Building Materials', 'Law Enforcement, Legal & Security'];   // the old fixed list
    window.STATE.jobs = [
      L('1', 'Northwind Builders', 'Construction'), L('2', 'Granite Works', 'construction '), L('3', 'Hale & Hale LLP', 'Law Practice'),
      L('4', 'Ivy Accounting', '', 'Accounting'),          // industry only on the company
      L('5', "O'Brien Foods", "Women's Apparel"), L('6', 'Pine Partners', 'Real Estate'), L('7', 'Quill Legal', 'Legal Services'),
      L('8', 'Rook Design', 'Design Services'), L('9', 'Sage Dental', 'Medical Practices'), L('10', 'Tern Logistics', 'Truck Transportation'),
    ];
    window.STATE.contacts = []; window.STATE.leads = window.STATE.jobs;
    window.STATE.page = 'leads'; window.render();
  });
  await page.waitForTimeout(300);
  const rows = () => ev(() => [...document.querySelectorAll('#content')].map((c) => c.innerText).join('\n'));
  await ev(() => { STATE.openDrop = 'Industry'; render(); }); await page.waitForTimeout(150);
  const list = await ev(() => [...document.querySelectorAll('.flt-panel [data-flt]')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  step('the Industry list is what the leads carry — not the fixed 44-category list', list.length === 9 && !list.some((x) => /Building Materials/.test(x)), JSON.stringify(list));
  step('…most common first, with how many ("Construction 2" — "construction " is the same industry)', /^Construction 2$/.test(list[0] || ''), list[0]);
  step('…and an industry held only on the COMPANY is listed too', list.some((x) => /^Accounting 1$/.test(x)));
  step('a list this long has a search box', await ev(() => !!document.querySelector('.flt-panel input[type=search]')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'industry-filter-open.png'), clip: await ev(() => { const r = document.querySelector('.flt-panel').getBoundingClientRect(); return { x: Math.max(0, r.x - 260), y: Math.max(0, r.y - 60), width: Math.min(900, r.width + 520), height: Math.min(800, r.height + 90) }; }) });

  await page.click('.flt-panel input[type=search]'); await page.keyboard.type('leg');
  const vis = await ev(() => [...document.querySelectorAll('.flt-panel [data-flt]')].filter((r) => r.style.display !== 'none').map((r) => r.getAttribute('data-flt')));
  step('typing "leg" leaves only the matching industries', vis.length === 1 && vis[0] === 'legal services', JSON.stringify(vis));
  step('…without a repaint: the cursor is still in the search box', await ev(() => document.activeElement && document.activeElement.type === 'search' && document.activeElement.value === 'leg'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'industry-filter-search.png'), clip: await ev(() => { const r = document.querySelector('.flt-panel').getBoundingClientRect(); return { x: Math.max(0, r.x - 260), y: Math.max(0, r.y - 60), width: Math.min(900, r.width + 520), height: 260 }; }) });

  await ev(() => { const cb = [...document.querySelectorAll('.flt-panel input[type=checkbox]')].find((c) => c.dataset.v === 'Construction'); cb.checked = true; cb.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(150);
  let t = await rows();
  step('ticking Construction shows BOTH construction leads (case and spaces ignored) and nothing else', /Northwind Builders/.test(t) && /Granite Works/.test(t) && !/Hale & Hale/.test(t) && !/Ivy Accounting/.test(t));
  await ev(() => { STATE.jobsFilter.industries = ['Accounting']; render(); }); await page.waitForTimeout(150);
  t = await rows();
  step('ticking Accounting finds the lead whose industry is only on its company', /Ivy Accounting/.test(t) && !/Northwind/.test(t));
  await ev(() => { STATE.jobsFilter.industries = []; STATE.openDrop = 'Industry'; render(); }); await page.waitForTimeout(100);
  await ev(() => { const cb = [...document.querySelectorAll('.flt-panel input[type=checkbox]')].find((c) => c.dataset.v === "Women's Apparel"); cb.checked = true; cb.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(150);
  t = await rows();
  step('an industry with an apostrophe can be ticked and filters', /O'Brien Foods/.test(t) && !/Northwind/.test(t));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
