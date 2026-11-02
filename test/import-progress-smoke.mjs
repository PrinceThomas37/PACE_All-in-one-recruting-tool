// IMPORTS IN PROGRESS + "IMPORT FINISHED" (R-343 step 4, owner 2 Nov 2026): who sees which import (the importer, their own
// team's RA Lead, admins — nobody else), the numbers move while it runs, a finished import stays a day then leaves, a stopped
// one says how far it got; the import route really records it (wiring, not only the module); the Leads tab draws it.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const require = createRequire(import.meta.url);
const runs = require('../services/import-runs.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

runs._reset();
const T0 = Date.parse('2026-11-02T10:00:00Z');
const r = runs.start({ orgId: 'o1', userId: 'ra1', userName: 'Riya', total: 100, now: T0 });
runs.progress(r.id, 50);
const see = (viewerId, teamIds, isAdmin, orgId = 'o1', now = T0 + 1000) => runs.visible({ orgId, viewerId, teamIds, isAdmin, now }).map((x) => x.id);
step('the importer sees their import, with how far it got', see('ra1', []).includes(r.id) && runs.visible({ orgId: 'o1', viewerId: 'ra1', now: T0 })[0].done === 50);
step('their own team\'s RA Lead sees it', see('lead1', ['ra1', 'ra2']).includes(r.id));
step('another team\'s lead does not', !see('lead2', ['ra9']).includes(r.id));
step('an admin sees the company\'s', see('admin', [], true).includes(r.id));
step('another company never sees it, admin or not', !see('admin', [], true, 'o2').includes(r.id));
runs.finish(r.id, { imported: 100, contacts: 130 }, T0 + 5000);
const done = runs.visible({ orgId: 'o1', viewerId: 'ra1', now: T0 + 6000 })[0];
step('finished: says so, with the counts', done.status === 'finished' && done.done === 100 && done.summary.contacts === 130);
step('a finished import is shown for a day, then leaves', see('ra1', [], false, 'o1', T0 + 23 * 3600e3).includes(r.id) && !see('ra1', [], false, 'o1', T0 + 25 * 3600e3).includes(r.id));
const f = runs.start({ orgId: 'o1', userId: 'ra1', total: 200, now: T0 }); runs.progress(f.id, 50); runs.finish(f.id, { failed: true, imported: 50, error: 'timeout' }, T0 + 1000);
step('a stopped import says how far it got', runs.visible({ orgId: 'o1', viewerId: 'ra1', now: T0 + 2000 }).find((x) => x.id === f.id).status === 'failed');
const back = runs.fromLog(Object.assign({ id: 'a1', created_at: new Date(T0).toISOString() }, runs.logRow(done)));
step('the record kept for later reads back the same (for the lead who was away)', back.id === done.id && back.status === 'finished' && back.summary.imported === 100 && back.user_name === 'Riya');

// wiring: the import route records, in batches, and the list route exists above nothing that shadows it
const src = fs.readFileSync(new URL('../routes/jobs.js', import.meta.url), 'utf8');
step('the import route starts, moves and finishes a run', /importRuns\.start\(/.test(src) && /importRuns\.progress\(run\.id/.test(src) && /importRuns\.finish\(run\.id, \{ imported/.test(src));
step('…writes in batches of 50 (no single huge insert)', /jobRows\.slice\(i, i \+ 50\)/.test(src) && !/from\('jobs'\)\.insert\(jobRows\)/.test(src));
step('…and keeps the finished record (activity_log import_finished)', /activity_log'\)\.insert\(importRuns\.logRow/.test(src));

// the Leads tab draws it, in a real browser
const R = path.resolve(new URL('..', import.meta.url).pathname);
const { chromium } = require('playwright-core');
const { enterApp, waitForLogin } = await import(R + '/test/helpers/enter-app.mjs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(R, 'public', p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
const PORT = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))); const BASE = 'http://127.0.0.1:' + PORT;
let answer = { runs: [{ id: 'imp_1', user_id: 'other', user_name: 'Riya', total: 100, done: 42, status: 'running', started_at: new Date().toISOString() }] };
const b = await chromium.launch({ executablePath: (() => { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const bp = process.env.PLAYWRIGHT_BROWSERS_PATH; return bp && fs.existsSync(path.join(bp, 'chromium')) ? path.join(bp, 'chromium') : 'chromium'; })(), args: ['--no-sandbox'] });
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**', (rt) => { const u = rt.request().url(); if (u.startsWith(BASE)) return rt.continue(); if (/onrender\.com|paceconsultant/.test(u)) { const p = new URL(u).pathname; return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === '/imports/recent' ? answer : (rt.request().method() === 'GET' ? [] : {})) }); } return rt.abort(); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(BASE + '/'); await waitForLogin(pg); await enterApp(pg, 'ra_lead');
  await pg.evaluate(() => { STATE.page = 'leads'; render(); });
  await pg.waitForSelector('.imp-running', { timeout: 6000 }).catch(() => {});
  const t1 = await pg.evaluate(() => (document.querySelector('#imp-banner') || {}).textContent || '');
  step('Leads tab: "Riya\'s import: 42 of 100 leads saved" with a bar', /Riya.s import: 42 of 100 leads saved/.test(t1) && !!(await pg.$('.imp-fill')), t1);
  if (process.env.SHOTS) await pg.screenshot({ path: process.env.SHOTS + '/import-running.png' });
  // The first version drew cream words on a cream box (2 Nov): the words must stand out from their own background.
  const contrast = await pg.evaluate(() => {
    const row = document.querySelector('.imp-row'); if (!row) return null;
    const rgb = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    let el = row, bg = 'rgba(0, 0, 0, 0)';
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    const a = lum(getComputedStyle(row).color), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  step('the words are readable on their box (contrast at least 4.5)', contrast != null && contrast >= 4.5, String(contrast));
  await pg.evaluate(() => { render(); render(); });
  step('a repaint keeps the line (drawn from state, not lost)', /42 of 100/.test(await pg.evaluate(() => (document.querySelector('#imp-banner') || {}).textContent || '')));
  answer = { runs: [{ id: 'imp_1', user_id: 'other', user_name: 'Riya', total: 100, done: 100, status: 'finished', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), summary: { imported: 100, contacts: 130, invalid_emails: 3 } }] };
  await pg.evaluate(() => importProgressCheck());
  await pg.waitForSelector('.imp-done', { timeout: 6000 }).catch(() => {});
  const t2 = await pg.evaluate(() => (document.querySelector('#imp-banner') || {}).textContent || '');
  const toast = await pg.evaluate(() => document.body.textContent.includes('finished: 100 leads, 130 contacts'));
  step('finished: the line says so with the counts', /finished.*100 leads, 130 contacts, 3 with no valid email/.test(t2), t2);
  step('…and a notice pops up once', toast);
  if (process.env.SHOTS) await pg.screenshot({ path: process.env.SHOTS + '/import-finished.png' });
  await pg.click('.imp-done .btn');
  step('"Hide" puts the finished line away', !(await pg.$('.imp-done')));
  step('no page errors', errs.length === 0, errs.join(' | '));
} finally { await b.close(); server.close(); }

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
