// The morning-briefing card must render for EVERY role `users.role` can
// actually take, on the dashboard it opens on — not just the roles a
// hand-picked sweep happens to try.
//
// C-0006 (foundry → rampart, closed by foundry): `bd_lead`, `director` and
// `associate_director` had no entry in test/helpers/enter-app.mjs, so a
// five-role sweep silently skipped three roles real people hold. The
// constraint that decides whether a role can be SAVED
// (migrations/039_tenant_isolation.sql, `users_role_check`) lists exactly
// eight: ra, ra_lead, bd, bd_lead, admin, recruiter, associate_director,
// director. That is the list this test walks — not a re-guess of it.
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
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// The exact eight values `users_role_check` allows.
const ALL_ROLES = ['ra', 'ra_lead', 'bd', 'bd_lead', 'admin', 'recruiter', 'associate_director', 'director'];

const BRIEFING = {
  date: '2026-09-09', summary: 'Six new leads and two replies came in today. The replies are waiting on an answer.',
  engine: 'rules', quiet: false, degraded: false, provider: null, ai_rejected: null,
  facts: {}, generated_at: new Date().toISOString(),
};

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);

  for (const role of ALL_ROLES) {
    step(`role "${role}" exists in TEST_USERS (enter-app.mjs)`, !!TEST_USERS[role]);

    await enterApp(page, role);
    await page.evaluate((briefing) => {
      STATE.briefing = undefined;
      STATE.nextActions = undefined;
      window.apiGet = function (p) {
        if (p === '/ai/morning-briefing') return Promise.resolve(briefing);
        if (p === '/next-actions') return Promise.resolve({ items: [], total: 0, by_kind: {} });
        return Promise.reject(new Error('unstubbed ' + p));
      };
      STATE.page = 'dashboard';
      render();
    }, BRIEFING);

    // loadMorningBriefing() is async (a .then off apiGet) — give it a tick.
    await page.waitForTimeout(150);
    // A second render so the resolved STATE.briefing actually paints.
    await page.evaluate(() => render());
    await page.waitForTimeout(50);

    const html = await page.evaluate(() => document.getElementById('content').innerHTML);
    step(`role "${role}": dashboard reaches a real screen, not "Page not found"`, !html.includes('Page not found'), html.slice(0, 80));
    step(`role "${role}": morning-briefing card is present`, html.includes('briefing-card'));
    step(`role "${role}": the actual sentence is on screen`, html.includes('Six new leads and two replies came in today'));
  }
} catch (e) {
  step('no crash while walking every role', false, String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log('\n=== MORNING BRIEFING CARD — ALL 8 ROLES ===');
let failed = 0;
for (const r of results) if (!r.ok) failed++;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
