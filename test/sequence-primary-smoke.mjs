// PRIMARY SEQUENCE (owner, 6 Oct): a left-to-right switch that makes ONE sequence "primary" — the one the
// "Start sequence" window has ready. The owner chose PRE-SELECT (D-0079), not "start automatically".
//   pure rules (services/sequence-primary.js)  · the routes (GET/PUT /wf/primary)  · the screens (in a browser)
// Usage: node test/sequence-primary-smoke.mjs
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const P = require('../services/sequence-primary.js');
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : ' — ' + d)); };

// ── 1. the rules ──────────────────────────────────────────────────────────────
ok('turning one ON makes it the Primary of its kind', JSON.stringify(P.toggle({}, 'contact', 'a', true)) === '{"contact":"a"}');
ok('…and replaces the previous Primary of the SAME kind (there is one per kind)', JSON.stringify(P.toggle({ contact: 'a' }, 'contact', 'b', true)) === '{"contact":"b"}');
ok('…but leaves the Primary of ANOTHER kind alone', JSON.stringify(P.toggle({ candidate: 'z' }, 'contact', 'b', true)) === '{"candidate":"z","contact":"b"}');
ok('turning the Primary OFF clears it', JSON.stringify(P.toggle({ contact: 'a' }, 'contact', 'a', false)) === '{}');
ok('turning off a sequence that is NOT the Primary changes nothing', JSON.stringify(P.toggle({ contact: 'a' }, 'contact', 'b', false)) === '{"contact":"a"}');
ok('an unknown kind or a blank id changes nothing', JSON.stringify(P.toggle({ contact: 'a' }, 'planet', 'b', true)) === '{"contact":"a"}' && JSON.stringify(P.toggle({}, 'contact', '', true)) === '{}');
ok('rubbish in the store is read as "none", never thrown', JSON.stringify(P.parse('nonsense')) === '{}' && JSON.stringify(P.parse(null)) === '{}' && JSON.stringify(P.parse('[1,2]')) === '{}' && JSON.stringify(P.parse({ contact: 5, x: 'y' })) === '{}');
const defs = [{ id: 'a', status: 'active', entity_type: 'contact' }, { id: 'z', status: 'archived', entity_type: 'candidate' }, { id: 'd', status: 'draft', entity_type: 'job' }, { id: 'w', status: 'active', entity_type: 'candidate' }];
ok('only an ACTIVE sequence of the right kind is offered as Primary', JSON.stringify(P.resolve({ contact: 'a', candidate: 'z', job: 'd' }, defs)) === '{"contact":"a"}');
ok('…a Primary filed under the wrong kind is not offered', JSON.stringify(P.resolve({ contact: 'w' }, defs)) === '{}');
ok('…the stored choice is not repaired, so Reactivate brings it back', JSON.stringify(P.resolve({ candidate: 'z' }, defs.map(d => d.id === 'z' ? { ...d, status: 'active' } : d))) === '{"candidate":"z"}');
ok('the setting key is per person', P.primaryKey('u1') !== P.primaryKey('u2') && /u1/.test(P.primaryKey('u1')));

// ── 2. the routes ─────────────────────────────────────────────────────────────
{
  const O = 'org1';
  const DB = { workflow_definitions: [
    { id: 'wf-a', org_id: O, status: 'active', entity_type: 'contact' }, { id: 'wf-b', org_id: O, status: 'active', entity_type: 'contact' },
    { id: 'wf-draft', org_id: O, status: 'draft', entity_type: 'contact' }, { id: 'wf-other', org_id: 'org2', status: 'active', entity_type: 'contact' }], app_settings: [] };
  const supabase = { from: (table) => { const f = {}; let mode = 'select', payload = null;
    const c = { select: () => c, eq: (k, v) => { f[k] = v; return c; }, in: () => c, order: () => c,
      upsert: async (row) => { const i = DB[table].findIndex(r => r.key === row.key); if (i >= 0) DB[table][i] = row; else DB[table].push(row); return { error: null }; },
      maybeSingle: async () => ({ data: (DB[table] || []).find(r => Object.entries(f).every(([k, v]) => r[k] === v)) || null }),
      then: (res) => Promise.resolve({ data: (DB[table] || []).filter(r => Object.entries(f).every(([k, v]) => r[k] === v)), error: null }).then(res) };
    return c; } };
  const app = express(); app.use(express.json());
  app.use(require('../routes/wf.js')({ supabase, hasRole: () => true, engine: {}, logActivity: async () => {},
    auth: (req, _r, next) => { req.user = { id: 'u-me', role: 'bd' }; req.orgId = O; next(); } }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, body: j }; };
  let r = await call('GET', '/wf/primary');
  ok('nobody has a Primary to begin with', r.status === 200 && JSON.stringify(r.body) === '{}', JSON.stringify(r));
  r = await call('PUT', '/wf/primary', { workflow_id: 'wf-a', on: true });
  ok('switching one on answers with the new Primary', r.status === 200 && r.body.contact === 'wf-a', JSON.stringify(r));
  r = await call('PUT', '/wf/primary', { workflow_id: 'wf-b', on: true });
  ok('switching a second ON moves it (still one per kind)', r.body.contact === 'wf-b' && (await call('GET', '/wf/primary')).body.contact === 'wf-b');
  r = await call('PUT', '/wf/primary', { workflow_id: 'wf-draft', on: true });
  ok('a draft cannot be Primary (it cannot be started) → 409', r.status === 409, JSON.stringify(r));
  r = await call('PUT', '/wf/primary', { workflow_id: 'wf-other', on: true });
  ok('another company\'s sequence → 404 and nothing stored', r.status === 404 && (await call('GET', '/wf/primary')).body.contact === 'wf-b', JSON.stringify(r));
  r = await call('PUT', '/wf/primary', { workflow_id: '', on: true });
  ok('no sequence named → 400', r.status === 400);
  ok('the choice is stored under THIS person\'s key only', DB.app_settings.length === 1 && DB.app_settings[0].key === P.primaryKey('u-me'), JSON.stringify(DB.app_settings));
  r = await call('PUT', '/wf/primary', { workflow_id: 'wf-b', on: false });
  ok('switching the Primary off clears it', r.body.contact === undefined && JSON.stringify((await call('GET', '/wf/primary')).body) === '{}');
  // an archived Primary is simply not offered
  await call('PUT', '/wf/primary', { workflow_id: 'wf-a', on: true });
  DB.workflow_definitions.find(d => d.id === 'wf-a').status = 'archived';
  ok('a Primary that is later archived is not offered', JSON.stringify((await call('GET', '/wf/primary')).body) === '{}');
  server.close();
}

// ── 3. the screens ────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': (MIME[path.extname(p)] || 'application/octet-stream') + '; charset=utf-8' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`; const SHOTS = process.env.SHOTS || '';
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    window.__puts = [];
    const step = (n) => ({ step_order: n, step_type: 'email', delay_days: n ? 3 : 0, config: { template: 'initial' } });
    STATE.wf = { stats: { by_workflow: { 'wf-a': { active: 0 }, 'wf-b': { active: 3 } } }, defs: [
      { id: 'wf-a', name: 'Client intro', status: 'active', entity_type: 'contact', steps: [step(0), step(1)] },
      { id: 'wf-b', name: 'Re-engage', status: 'active', entity_type: 'contact', steps: [step(0)] },
      { id: 'wf-c', name: 'Draft idea', status: 'draft', entity_type: 'contact', steps: [step(0)] },
      { id: 'wf-d', name: 'Candidate nurture', status: 'active', entity_type: 'candidate', steps: [step(0)] }], enrollments: [] };
    STATE.wfPrimary = {};
    window.apiPut = (p, b) => { window.__puts.push([p, JSON.parse(JSON.stringify(b))]); const cur = Object.assign({}, STATE.wfPrimary); const d = STATE.wf.defs.find(x => x.id === b.workflow_id); if (b.on) cur[d.entity_type] = b.workflow_id; else if (cur[d.entity_type] === b.workflow_id) delete cur[d.entity_type]; return Promise.resolve(cur); };
    window.loadWorkflows = () => {};
    STATE.page = 'email'; STATE.emailTab = 'sequence'; render();
  });
  await page.waitForTimeout(400);
  const txt = () => ev(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  step_ok(await ev(() => document.querySelectorAll('.wf-prim-sw').length), 3);
  function step_ok(n, want) { ok('every ACTIVE sequence has a Primary switch (and a draft does not): ' + want, n === want, String(n)); }
  ok('nothing is Primary yet', await ev(() => document.querySelectorAll('.wf-prim-sw.on').length === 0));
  await ev(() => document.querySelector('.wf-prim-sw[data-wf="wf-a"]').click()); await page.waitForTimeout(250);
  ok('clicking the switch asks the server to make it Primary', await ev(() => window.__puts.length === 1 && window.__puts[0][1].workflow_id === 'wf-a' && window.__puts[0][1].on === true), JSON.stringify(await ev(() => window.__puts)));
  ok('…the switch goes to the "on" side and a "Primary" badge appears on that sequence', await ev(() => document.querySelector('.wf-prim-sw[data-wf="wf-a"]').classList.contains('on') && !!document.querySelector('[data-wfcard="wf-a"] .wf-prim-badge') && !document.querySelector('[data-wfcard="wf-b"] .wf-prim-badge')));
  await ev(() => document.querySelector('.wf-prim-sw[data-wf="wf-b"]').click()); await page.waitForTimeout(250);
  ok('switching another one on moves it: only one is on among leads', await ev(() => document.querySelectorAll('.wf-prim-sw.on[data-kind="contact"]').length === 1 && document.querySelector('.wf-prim-sw[data-wf="wf-b"]').classList.contains('on')));
  ok('…while a candidate sequence can have its own Primary at the same time', await (async () => { await ev(() => document.querySelector('.wf-prim-sw[data-wf="wf-d"]').click()); await page.waitForTimeout(250); return ev(() => document.querySelectorAll('.wf-prim-sw.on').length === 2); })());
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'sequence-primary-list.png') }); }
  // the Start window
  await ev(() => { wfStartSequence('contact', [{ entity_id: 'c1', job_id: 'j1', contact_id: 'c1' }, { entity_id: 'c2', job_id: 'j2', contact_id: 'c2' }]); });
  await page.waitForTimeout(300);
  const modal = await ev(() => { const m = document.querySelector('.modal'); return { t: m.innerText.replace(/\s+/g, ' '), first: (m.querySelector('[data-wfstart]') || {}).getAttribute && m.querySelector('[data-wfstart]').getAttribute('data-wfstart'), primaryBtn: !!m.querySelector('.wf-start-primary') }; });
  ok('the Start window has the Primary ready: its own big button, named', modal.primaryBtn && /Start with Re-engage/.test(modal.t), modal.t.slice(0, 200));
  ok('…the Primary is listed first, the others still there', modal.first === 'wf-b' && /Client intro/.test(modal.t));
  ok('…and a CANDIDATE selection gets the candidate Primary, not the lead one', await (async () => { await ev(() => { STATE.wfStart = null; closeModal(); wfStartSequence('candidate', [{ entity_id: 'k1' }]); }); await page.waitForTimeout(300); return ev(() => /Start with Candidate nurture/.test(document.querySelector('.modal').innerText)); })());
  await ev(() => { STATE.wfPrimary = {}; STATE.wfStart = null; closeModal(); wfStartSequence('contact', [{ entity_id: 'c1' }]); }); await page.waitForTimeout(300);
  ok('with no Primary the window is exactly as before (no big button)', await ev(() => !document.querySelector('.wf-start-primary')));
  ok('the one-click Start enrolls into the Primary', await (async () => { await ev(() => { STATE.wfPrimary = { contact: 'wf-b' }; STATE.wfStart = null; closeModal(); window.__enrolled = null; window.wfEnrollSelectionInto = (id) => { window.__enrolled = id; }; wfStartSequence('contact', [{ entity_id: 'c1' }]); }); await page.waitForTimeout(300); await ev(() => document.querySelector('.wf-start-primary').click()); return ev(() => window.__enrolled === 'wf-b'); })());
  ok('No page errors', errs.length === 0, errs.join('|').slice(0, 300));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
