// C-0029 — a client's document Upload/Delete controls are drawn only for
// someone the server will not refuse (its owner, or an admin). Two halves:
//   A. the REAL `GET /clients` handler (routes/companies.js) computes
//      `can_edit` with the same ownership ladder as requireClientOwner;
//   B. the client drawer, in a real browser, draws or withholds the controls
//      from that flag — and tells a non-owner why they are missing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
  fs.readFile(path.join(PUBLIC_DIR,p),(err,data)=>{
    if(err){res.writeHead(404);return res.end('nf');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});res.end(data);
  });
});
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const API = 'https://fute-lms-backend.onrender.com';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results=[];
const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){
  if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b=process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(b && fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium');
  return 'chromium';
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ── A. the real handler ─────────────────────────────────────────────────────
const d = (n) => new Date(Date.now() - n * 864e5).toISOString();
const T = {
  job_orders: [
    { id: 'jo1', org_id: 'A', company_id: 'co1', status: 'Active', created_at: d(5), bd_manager_id: 'me', deleted_at: null },
    { id: 'jo2', org_id: 'A', company_id: 'co2', status: 'Active', created_at: d(5), bd_manager_id: 'other', deleted_at: null },
    { id: 'jo2b', org_id: 'A', company_id: 'co2', status: 'Filled', created_at: d(90), bd_manager_id: 'me', deleted_at: null }, // older: newest wins
    { id: 'jo3', org_id: 'A', company_id: 'co3', status: 'Active', created_at: d(5), bd_manager_id: null, deleted_at: null },
    { id: 'jo4', org_id: 'A', company_id: 'co4', status: 'Active', created_at: d(5), bd_manager_id: null, deleted_at: null },
    { id: 'joX', org_id: 'B', company_id: 'coX', status: 'Active', created_at: d(5), bd_manager_id: 'me', deleted_at: null },
  ],
  companies: [
    { id: 'co1', org_id: 'A', name: 'Mine by job order', created_by: 'other', deleted_at: null },
    { id: 'co2', org_id: 'A', name: 'Theirs by job order', created_by: 'me', deleted_at: null },
    { id: 'co3', org_id: 'A', name: 'Mine by lead', created_by: 'other', deleted_at: null },
    { id: 'co4', org_id: 'A', name: 'Mine as creator', created_by: 'me', deleted_at: null },
    { id: 'coX', org_id: 'B', name: 'Other company', created_by: 'me', deleted_at: null },
  ],
  jobs: [{ id: 'l1', org_id: 'A', company_id: 'co3', assigned_to_bd: 'me', created_at: d(3), deleted_at: null }],
};
function q(table) {
  const f = [];
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
    is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    not(k, _op, v) { f.push(r => !((r[k] == null) === (v == null || v === 'null'))); return api; },
    maybeSingle() { return api.then(x => ({ ...x, data: x.data[0] || null })); },
    then(res, rej) { return Promise.resolve({ data: (T[table] || []).filter(r => f.every(fn => fn(r))), error: null }).then(res, rej); },
  };
  return api;
}
const express = require('express');
const routes = {};
const fake = { get(p, ...h) { routes['GET ' + p] = h.at(-1); }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
const real = express.Router; express.Router = () => fake;
try {
  require('../routes/companies.js')({ supabase: { from: q }, auth: (_a, _b, n) => n(),
    hasRole: (req, ...rs) => rs.some(r => (req.user.roles || []).includes(r)),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }), orgIdFor: (req) => req.orgId });
} finally { express.Router = real; }
const get = async (user) => { let out; const res = { status() { return res; }, json(j) { out = j; return res; } };
  await routes['GET /clients']({ user, orgId: 'A', query: {} }, res); return out; };
const byId = (list) => Object.fromEntries((list || []).map(c => [c.id, c]));

let rows = byId(await get({ id: 'me', roles: ['bd'] }));
step('A: a client whose newest job order is mine → can_edit', rows.co1 && rows.co1.can_edit === true, JSON.stringify(rows.co1));
step("A: a client whose newest job order is someone else's → not can_edit (even though I created it and had an older one)", rows.co2 && rows.co2.can_edit === false);
step('A: no job-order owner, but the lead is mine → can_edit', rows.co3 && rows.co3.can_edit === true);
step('A: no job-order or lead owner, I created it → can_edit', rows.co4 && rows.co4.can_edit === true);
step("A: another organisation's client never appears", !rows.coX);
step('A: created_by is not leaked into the list', Object.values(rows).every(c => !('created_by' in c)));
rows = byId(await get({ id: 'adm', roles: ['admin'] }));
step('A: admin can edit every client', Object.values(rows).length === 4 && Object.values(rows).every(c => c.can_edit === true));

// ── B. the drawer ───────────────────────────────────────────────────────────
const CLIENTS = [
  { id: 'co1', name: 'Acme Mine', industry: 'x', location: 'y', job_order_count: 1, open_job_order_count: 1, can_edit: true },
  { id: 'co2', name: 'Globex Theirs', industry: 'x', location: 'y', job_order_count: 1, open_job_order_count: 1, can_edit: false },
];
const DOC = [{ id: 'd1', filename: 'MSA.pdf', doc_type: 'contract', uploaded_at: d(2), uploader: { name: 'Priya' } }];
function reply(route, body, status = 200) { return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
async function api(route) {
  const u = new URL(route.request().url()), p = u.pathname, m = route.request().method();
  if (m === 'GET' && p === '/clients') return reply(route, CLIENTS);
  if (m === 'GET' && /^\/companies\/co[12]\/documents$/.test(p)) return reply(route, DOC);
  return reply(route, m === 'GET' ? [] : {});
}
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (u.startsWith(API)) return api(r); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(() => { goPage('clients'); }); await page.waitForTimeout(400);
  const docsPanel = async (id) => {
    await page.evaluate((cid) => { clientsOpen(cid); }, id); await page.waitForTimeout(500);
    await page.evaluate(() => { clientsTab('docs'); }); await page.waitForTimeout(150);
    return page.evaluate(() => { const el = document.querySelector('[data-clpanel="docs"]'); if (!el) return null;
      return { text: el.innerText, upload: !!el.querySelector('#client-doc-file'), del: !!el.querySelector('[onclick^="clientsDeleteDoc"]'), check: !!el.querySelector('input.ck') }; });
  };
  let p1 = await docsPanel('co1');
  step('B: the owner\'s documents panel rendered with its document (so the checks mean something)', p1 && /MSA\.pdf/.test(p1.text), JSON.stringify(p1 && p1.text.slice(0, 60)));
  step('B: the owner sees Upload and Delete', p1 && p1.upload && p1.del);
  step('B: the owner is not shown the "only the owner" note', p1 && !/Only this client's owner/.test(p1.text));
  let p2 = await docsPanel('co2');
  step("B: a non-owner's panel rendered with its document", p2 && /MSA\.pdf/.test(p2.text));
  step('B: a non-owner sees no Upload and no Delete', p2 && !p2.upload && !p2.del, JSON.stringify(p2));
  step('B: …but can still select documents to email', p2 && p2.check);
  step('B: …and is told why the controls are missing', p2 && /Only this client's owner \(or an admin\) can add or remove/.test(p2.text));
  if (SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, '45-client-docs-non-owner.png') }); }
  step('B: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) { step('B: ran without throwing', false, String(e && e.stack || e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
