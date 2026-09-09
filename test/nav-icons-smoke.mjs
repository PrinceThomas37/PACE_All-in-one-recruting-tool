// THE COLLAPSED RAIL IS ICON-ONLY, SO TWO ITEMS SHARING AN ICON ARE THE SAME
// ITEM AS FAR AS THE USER IS CONCERNED.
//
// The owner's report was "a lot of time the menu is repeating, no repeats in
// full menu". Nothing was drawn twice — `Insights` and `Reports` sat next to
// each other in the Insight group with the SAME bar-chart icon, so the 60px
// rail showed the same picture twice. Expanding it revealed different labels,
// which is exactly why the full menu looked fine.
//
// This suite boots the real shell for every role and asserts three things about
// the nav: it is drawn once, no two items share a label, and no two items share
// an icon. The third is the one that was broken, and it is the one a future
// "just reuse the chart icon" will break again.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, TEST_USERS } from './helpers/enter-app.mjs';

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
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// Every role a real user can hold. `bd_lead` and `director` are not in
// TEST_USERS and are exactly the kind of gap that let this ship: the original
// probe covered five roles and the bug was live on four of them.
const EXTRA = [
  { id: 't-bdl', name: 'T BD Lead',  email: 'bdl@example.test', role: 'bd_lead',            roles: ['bd_lead'],            av: 'BL', avc: 'av-bd',    desig: 'BD Lead' },
  { id: 't-dir', name: 'T Director', email: 'dir@example.test', role: 'director',           roles: ['director'],           av: 'TD', avc: 'av-admin', desig: 'Director' },
  { id: 't-ad',  name: 'T AD',       email: 'ad@example.test',  role: 'associate_director', roles: ['associate_director'], av: 'TA', avc: 'av-admin', desig: 'Associate Director' },
];
const ROLES = [...Object.keys(TEST_USERS), ...EXTRA];

const readNav = (page) => page.evaluate(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const items = [...document.querySelectorAll('#sidebar .nav-item')].map(el => ({
    label: norm(el.querySelector('.nav-txt')?.textContent),
    icon: (el.querySelector('.nav-icon')?.innerHTML || '').replace(/\s+/g, ''),
  })).filter(x => x.label);
  const dup = (arr) => {
    const seen = {}, out = {};
    arr.forEach(({ key, label }) => {
      if (seen[key] && seen[key] !== label) out[key] = (out[key] || [seen[key]]).concat(label);
      else if (seen[key]) out[key] = (out[key] || [seen[key]]).concat(label);
      seen[key] = seen[key] || label;
    });
    return out;
  };
  return {
    sidebars: document.querySelectorAll('#sidebar').length,
    count: items.length,
    dupLabels: dup(items.map(i => ({ key: i.label, label: i.label }))),
    dupIcons: dup(items.map(i => ({ key: i.icon, label: i.label }))),
  };
});

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();

  for (const role of ROLES) {
    const name = typeof role === 'string' ? role : role.role;
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForLogin(page);
    await enterApp(page, role);
    const nav = await readNav(page);

    step(`${name}: the rail is drawn exactly once`, nav.sidebars === 1, `found ${nav.sidebars}`);
    step(`${name}: the rail has items at all`, nav.count > 0, `${nav.count} items`);
    step(`${name}: no two nav items share a label`,
      Object.keys(nav.dupLabels).length === 0, JSON.stringify(nav.dupLabels));
    // THE ONE THAT WAS BROKEN.
    step(`${name}: no two nav items share an icon`,
      Object.keys(nav.dupIcons).length === 0,
      Object.values(nav.dupIcons).map(g => g.join(' = ')).join('; '));

    // A repaint must not duplicate anything either — the shell rewrites the rail
    // region through putRegion(..., outer:true), and an innerHTML there would
    // nest a second #sidebar inside the first.
    await page.evaluate(() => { window.render(); window.render(); });
    await page.waitForTimeout(40);
    const after = await readNav(page);
    step(`${name}: still one rail after repaints`, after.sidebars === 1, `found ${after.sidebars}`);
  }
} catch (err) {
  step('the harness ran', false, err.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length} passed`);
console.log('RESULT: ' + (passed === results.length ? 'PASS' : 'FAIL'));
process.exit(passed === results.length ? 0 : 1);
