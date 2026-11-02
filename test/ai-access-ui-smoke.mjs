// AI ON / OFF PER PERSON — THE SCREEN HALF (D-0195, owner 2 Nov 2026). The rule itself is the server's (ai-access-smoke);
// this pins what people see: with AI off every AI button on My Setup is gone and one plain line says why, with AI on they
// are there, signing in asks the server, and the admin's switch on a person's page sends the change.
// Every probe that cannot measure FAILS. Usage: node test/ai-access-ui-smoke.mjs  (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const R = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(R + '/index.js');
const { chromium } = require('playwright-core');
const { enterApp, waitForLogin } = await import(R + '/test/helpers/enter-app.mjs');
const teachMod = require(R + '/services/ai-teach.js');
const OUT = process.env.SHOTS || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' -> ' + x : '')); } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(R, 'public', p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); const BASE = 'http://127.0.0.1:' + PORT;
let aiOn = false; const calls = [];
async function api(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method(); let body = null; try { body = req.postDataJSON(); } catch (_) {}
  calls.push({ m, p: u.pathname, body });
  const j = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/me/ai-access') return j({ on: aiOn, message: 'AI is not switched on for your account. Ask your admin.' });
  if (u.pathname === '/users/ai-access') return j({ access: { u2: true } });
  if (u.pathname === '/users/u2/ai-access' && m === 'PUT') return j({ id: 'u2', on: body.on });
  if (u.pathname === '/my-setup/sequence' && m === 'GET') return j({ mode: 'template', teach: teachMod.normalize(null), teach_options: teachMod.options(),
    first: { subject: 'Your {{pos}}', body: 'Hi {{fn}}, I saw {{company}} is hiring. Want resumes?', versions: [] }, followups: [{ day: 3, subject: '', body: 'Just checking, {{fn}}.', thread: 'same', versions: [] }],
    followup_max: 5, versions_max: 20, versions_count: 3, sample: { vars: { fn: 'Dana', pos: 'Java Developer', company: 'Acme' }, example: false, name: 'Dana Lee', company: 'Acme', email: 'd@a.example' } });
  return j(m === 'GET' ? [] : {});
}
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || (process.env.PLAYWRIGHT_BROWSERS_PATH ? process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium' : '/opt/pw-browsers/chromium'), headless: true, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**', (r) => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (/onrender\.com|paceconsultant/.test(u)) return api(r); return r.abort(); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(BASE + '/'); await waitForLogin(pg); await enterApp(pg, 'bd');

  // signing in asks the server (loadAppData is the one tail of every sign-in)
  const before = calls.length;
  await pg.evaluate(() => { try { window.loadAppData(); } catch (_) {} });
  await pg.waitForTimeout(600);
  ok('signing in asks the server whether AI is on for this person', calls.slice(before).some((c) => c.p === '/me/ai-access'));
  ok('AI off: the page knows it', await pg.evaluate(() => document.body.classList.contains('ai-off')));

  // My Setup with AI off
  await pg.evaluate(() => openSequenceSetup()); await pg.waitForSelector('[data-sq-vcount]', { state: 'attached' });
  const off = await pg.evaluate(() => {
    const all = [...document.querySelectorAll('#sq-root [data-ai]')];
    return { marked: all.length, visible: all.filter((b) => b.offsetParent !== null).length, note: (document.querySelector('.ai-off-note') || {}).textContent || '' };
  });
  ok('the AI buttons are on the page (so the next check measures something)', off.marked >= 3, JSON.stringify(off));
  ok('AI off: none of them shows', off.visible === 0, JSON.stringify(off));
  ok('AI off: one plain line says why', /not switched on for your account/.test(off.note), off.note);
  const offCards = await pg.evaluate(() => ({ aiMode: (document.querySelector('[data-mode="ai"]') || {}).offsetParent !== null && !!document.querySelector('[data-mode="ai"]'),
    vbox: !!document.querySelector('[data-sq-vcount]') && document.querySelector('[data-sq-vcount]').offsetParent !== null }));
  ok('AI off: no "AI writes each one" choice and no versions box', !offCards.aiMode && !offCards.vbox, JSON.stringify(offCards));
  if (OUT) await pg.screenshot({ path: OUT + '/ai-off-mysetup.png' });

  // AI on
  aiOn = true; await pg.evaluate(() => loadAiAccess()); await pg.waitForTimeout(400);
  await pg.evaluate(() => openSequenceSetup()); await pg.waitForSelector('[data-sq-vcount]');
  const on = await pg.evaluate(() => ({ visible: [...document.querySelectorAll('#sq-root [data-ai]')].filter((b) => b.offsetParent !== null).length, note: !!document.querySelector('.ai-off-note') }));
  ok('AI on: the AI buttons are there and no "off" line', on.visible >= 3 && !on.note, JSON.stringify(on));

  // the admin's switch
  await enterApp(pg, 'admin');
  await pg.evaluate(() => { STATE.users = [{ id: 'u2', name: 'Sam Wilson', email: 'sam@x.example', role: 'bd', roles: ['bd'] }]; STATE.adminSelectedUser = 'u2'; STATE.page = 'admin'; render(); });
  await pg.waitForSelector('.ai-switch input', { timeout: 6000 }).catch(() => {});
  const card = await pg.evaluate(() => { const i = document.querySelector('.ai-switch input'); return i ? { checked: i.checked, text: i.closest('.card').textContent } : null; });
  ok('the admin sees "AI is on for this person" on the person\'s page', !!card && card.checked && /AI is on for this person/.test(card.text), JSON.stringify(card));
  if (OUT) { await pg.evaluate(() => document.querySelector('.ai-switch').closest('.card').scrollIntoView({ block: 'center' })); await pg.screenshot({ path: OUT + '/ai-admin-switch.png' }); }
  await pg.click('.ai-switch input'); await pg.waitForTimeout(500);
  const put = calls.filter((c) => c.p === '/users/u2/ai-access' && c.m === 'PUT').pop();
  ok('turning it off sends {on:false} for that person', !!put && put.body && put.body.on === false, JSON.stringify(put));
  ok('…and the page now says off', /AI is off for this person/.test(await pg.evaluate(() => (document.querySelector('.ai-switch') || {}).textContent || '')));
  ok('no page errors', errs.length === 0, errs.join(' | '));
} finally { await browser.close(); server.close(); }
console.log('\nPASS ' + pass + ' FAIL ' + fail);
process.exit(fail ? 1 : 0);
