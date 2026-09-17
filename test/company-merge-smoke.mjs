// ============================================================================
// MERGING A DUPLICATE CLIENT.
//
// Since Session 26 a BD can create a client just by typing its name into the
// New Job form. That is the right trade — the typeahead shows what already
// exists while you type, and refusing an unknown name would block a real job
// order — but with 1,567 companies it means near-duplicates accumulate, and the
// resolver deliberately never merges two names by itself (a job order silently
// filed under the wrong client shows no error anywhere). So the judgement is a
// person's, and this is the tool.
//
// What a merge must never do: lose anything. Everything pointing at the
// duplicate is RE-POINTED and the duplicate is SOFT-DELETED — the row stays,
// and what moved is recorded so a mistake can be unpicked by hand.
// ============================================================================
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const require = createRequire(import.meta.url);
const cm = require('../services/company-merge.js');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };

// ── 1. The rule ─────────────────────────────────────────────────────────────
console.log('\nThe merge rule');

t('a client cannot be merged into itself', () => {
  assert.match(cm.mergeInputError({ sourceId: 'co-1', targetId: 'co-1' }), /same client/i);
});
t('nothing picked is refused in words, not a crash', () => {
  assert.match(cm.mergeInputError({ targetId: 'co-1' }), /Pick the duplicate/i);
});
t('two clients with unlike names are ALLOWED — only a person can know', () => {
  // "Treplar Inc" and "T.I. Construction" can be the same company. The guard
  // against a mis-click is the plan stated in full, not a name comparison the
  // app cannot actually make.
  assert.equal(cm.mergeInputError({ sourceId: 'co-1', targetId: 'co-2' }), null);
});
t('the plan names every kind of record that will move', () => {
  const s = cm.describePlan({ jobs: 3, job_orders: 1, client_documents: 2, email_tracking: 9 },
    { sourceName: 'Treplar Incorporated', targetName: 'Treplar Inc' });
  assert.match(s, /3 leads/); assert.match(s, /1 job\b/);
  assert.match(s, /2 documents/); assert.match(s, /9 emails/);
  assert.match(s, /Treplar Incorporated/); assert.match(s, /Treplar Inc/);
  assert.match(s, /Nothing is deleted/);
});
t('one of something reads as one, not "1 leads"', () => {
  assert.match(cm.describePlan({ jobs: 1 }, {}), /1 lead\b/);
  assert.doesNotMatch(cm.describePlan({ jobs: 1 }, {}), /1 leads/);
});
t('an empty duplicate is a plain answer, not an error', () => {
  const s = cm.describePlan({}, { sourceName: 'Empty Co', targetName: 'Treplar Inc' });
  assert.match(s, /nothing attached/i);
  assert.match(s, /untouched/i);
  assert.equal(cm.totalMoving({}), 0);
});

// ── 2. The table list, against the real schema ──────────────────────────────
console.log('\nWhat the merge must move');

t('EVERY table with a company_id is in the merge list', () => {
  // A table missed here leaves orphan rows pointing at a record the app no
  // longer shows, and nothing would say so. Checked against the schema file
  // and the migrations rather than trusting the list to stay current — the
  // whole failure mode is somebody adding a fifth table and not looking here.
  const roots = ['schema.sql'].map(f => path.join(ROOT, f))
    .concat(fs.readdirSync(path.join(ROOT, 'migrations')).map(f => path.join(ROOT, 'migrations', f)));
  const sql = roots.filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // every `create table X (... company_id ...)` and `alter table X add ... company_id`
  const named = new Set();
  const createRe = /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = createRe.exec(sql))) { if (/\bcompany_id\b/i.test(m[2])) named.add(m[1].toLowerCase()); }
  const alterRe = /alter table (?:public\.)?([a-z_]+)([\s\S]{0,400}?);/gi;
  while ((m = alterRe.exec(sql))) { if (/add column[^;]*\bcompany_id\b/i.test(m[2])) named.add(m[1].toLowerCase()); }
  named.delete('leads');           // the retired pre-`jobs` table
  const covered = new Set(cm.MERGE_TABLES.map(x => x.table));
  const missing = [...named].filter(x => !covered.has(x));
  assert.deepEqual(missing, [], 'table(s) with a company_id are NOT merged: ' + missing.join(', '));
});

// ── 3. The route, on a stub database ────────────────────────────────────────
console.log('\nPOST /companies/:id/merge');

function makeDb(tables, ops) {
  const mk = (table) => {
    const b = {
      _rows: (tables[table] || []).slice(), _upd: null, _ins: null, _eqCompany: null,
      select(_, o) { b._head = !!(o && o.head); b._count = !!(o && o.count); return b; },
      eq(k, v) { if (k === 'company_id') b._eqCompany = v; if (k === 'id') b._rows = b._rows.filter(r => r.id === v); return b; },
      is() { return b; }, limit() { return b; }, order() { return b; }, in() { return b; },
      update(p) { b._upd = p; return b; },
      upsert(p) { ops.push({ table, upsert: p }); return b; },
      insert(p) { b._ins = p; return b; },
      single() { return Promise.resolve({ data: b._rows[0] || null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: b._rows[0] || null, error: null }); },
      then(res, rej) {
        if (b._upd) {
          const hit = (tables[table] || []).filter(r => b._eqCompany == null || r.company_id === b._eqCompany);
          if (b._eqCompany != null) { hit.forEach(r => { r.company_id = b._upd.company_id; }); ops.push({ table, moved: hit.length, to: b._upd.company_id }); }
          else { (tables[table] || []).filter(r => b._rows.includes(r)).forEach(r => Object.assign(r, b._upd)); ops.push({ table, update: b._upd }); }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        const rows = b._eqCompany != null ? (tables[table] || []).filter(r => r.company_id === b._eqCompany) : b._rows;
        const out = b._count ? { data: null, count: rows.length, error: null } : { data: rows, error: null };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  return { from: mk };
}

function makeCtx(tables, ops) {
  const supabase = makeDb(tables, ops);
  return {
    supabase, auth: (q, r, n) => n(), hasRole: () => true,
    withOrg: (q) => q.eq('org_id', 'org-A'), orgStamp: () => ({ org_id: 'org-A' }),
    orgIdFor: () => 'org-A',
  };
}

function capture(ctx) {
  const routes = {};
  const router = { get(p, ...r) { routes['GET ' + p] = r[r.length - 1]; }, post(p, ...r) { routes['POST ' + p] = r[r.length - 1]; },
                   put() {}, delete() {}, use() {} };
  const express = require('express');
  const realRouter = express.Router;
  express.Router = () => router;
  try { require('../routes/companies.js')(ctx); } finally { express.Router = realRouter; }
  return routes;
}

function freshTables() {
  return {
    companies: [{ id: 'co-1', name: 'Treplar Inc', org_id: 'org-A' }, { id: 'co-2', name: 'Treplar Incorporated', org_id: 'org-A' }],
    jobs: [{ id: 'j1', company_id: 'co-2', org_id: 'org-A' }, { id: 'j2', company_id: 'co-2', org_id: 'org-A' }, { id: 'j3', company_id: 'co-1', org_id: 'org-A' }],
    job_orders: [{ id: 'jo1', company_id: 'co-2', org_id: 'org-A' }],
    client_documents: [{ id: 'd1', company_id: 'co-2', org_id: 'org-A' }],
    email_tracking: [], app_settings: [],
  };
}
async function call(route, req, tables, ops) {
  const routes = capture(makeCtx(tables, ops));
  const h = routes[route];
  assert.ok(h, route + ' is not registered');
  let status = 200, payload = null;
  const res = { status(s) { status = s; return res; }, json(j) { payload = j; return res; } };
  await h(Object.assign({ user: { id: 'u-1' }, orgId: 'org-A', params: {}, query: {}, body: {} }, req), res);
  return { status, payload };
}

await ta('the preview says exactly what would move, and moves nothing', async () => {
  const tables = freshTables(), ops = [];
  const r = await call('GET /companies/:id/merge-preview', { params: { id: 'co-1' }, query: { from: 'co-2' } }, tables, ops);
  assert.equal(r.status, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.counts.jobs, 2);
  assert.equal(r.payload.counts.job_orders, 1);
  assert.equal(r.payload.total, 4);
  assert.match(r.payload.sentence, /2 leads/);
  assert.equal(ops.filter(o => o.moved).length, 0, 'the preview moved something');
  assert.equal(tables.jobs.filter(j => j.company_id === 'co-2').length, 2, 'the preview changed the data');
});

await ta('the merge re-points everything and soft-deletes the duplicate', async () => {
  const tables = freshTables(), ops = [];
  const r = await call('POST /companies/:id/merge', { params: { id: 'co-1' }, body: { from: 'co-2' } }, tables, ops);
  assert.equal(r.status, 200, JSON.stringify(r.payload));
  assert.equal(tables.jobs.filter(j => j.company_id === 'co-2').length, 0, 'leads were left behind');
  assert.equal(tables.jobs.filter(j => j.company_id === 'co-1').length, 3, 'leads did not arrive');
  assert.equal(tables.job_orders[0].company_id, 'co-1');
  assert.equal(tables.client_documents[0].company_id, 'co-1');
  const dup = tables.companies.find(c => c.id === 'co-2');
  assert.ok(dup.deleted_at, 'the duplicate was not soft-deleted');
  assert.ok(tables.companies.find(c => c.id === 'co-2'), 'the duplicate ROW was destroyed — a merge must never delete');
});

await ta('what moved is RECORDED, so a mistake can be unpicked', async () => {
  const tables = freshTables(), ops = [];
  await call('POST /companies/:id/merge', { params: { id: 'co-1' }, body: { from: 'co-2' } }, tables, ops);
  const rec = ops.find(o => o.table === 'app_settings' && o.upsert);
  assert.ok(rec, 'no record of the merge was written');
  assert.equal(rec.upsert.key, 'company_merge_co-2');
  const v = JSON.parse(rec.upsert.value);
  assert.equal(v.target_id, 'co-1');
  assert.equal(v.source.name, 'Treplar Incorporated');
  assert.equal(v.moved.jobs, 2);
  assert.equal(v.by, 'u-1');
});

await ta('THE RECORD IS WRITTEN BEFORE THE DELETE', async () => {
  // If the soft delete fails, the record of what moved must still exist —
  // otherwise a half-done merge is unreadable.
  const tables = freshTables(), ops = [];
  await call('POST /companies/:id/merge', { params: { id: 'co-1' }, body: { from: 'co-2' } }, tables, ops);
  const recAt = ops.findIndex(o => o.table === 'app_settings' && o.upsert);
  const delAt = ops.findIndex(o => o.table === 'companies' && o.update && o.update.deleted_at);
  assert.ok(recAt > -1 && delAt > -1, 'expected both a record and a delete');
  assert.ok(recAt < delAt, 'the duplicate was deleted before what moved was recorded');
});

await ta('merging a client into itself is refused', async () => {
  const tables = freshTables(), ops = [];
  const r = await call('POST /companies/:id/merge', { params: { id: 'co-1' }, body: { from: 'co-1' } }, tables, ops);
  assert.equal(r.status, 400);
  assert.equal(ops.filter(o => o.moved).length, 0);
});

await ta('a client from another org is not found, and nothing moves', async () => {
  const tables = freshTables(), ops = [];
  tables.companies = [{ id: 'co-1', name: 'Treplar Inc', org_id: 'org-A' }];   // co-2 not visible
  const r = await call('POST /companies/:id/merge', { params: { id: 'co-1' }, body: { from: 'co-2' } }, tables, ops);
  assert.equal(r.status, 404);
  assert.equal(ops.filter(o => o.moved).length, 0, 'it moved records for a company it could not see');
});

// ── 4. The screen ───────────────────────────────────────────────────────────
console.log('\nThe merge panel');

const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => {
    if (e) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const findChromium = () => process.env.PLAYWRIGHT_CHROMIUM
  || (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'))
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  const stub = () => page.evaluate(() => {
    STATE.user.role = 'bd_manager'; STATE.user.roles = ['bd_manager'];
    window.__merged = null;
    window.apiGet = function (p) {
      if (p.indexOf('/companies/search') === 0) return Promise.resolve([{ id: 'co-2', name: 'Treplar Incorporated', job_count: 2 }]);
      if (p.indexOf('/merge-preview') > -1) return Promise.resolve({
        source: { id: 'co-2', name: 'Treplar Incorporated' }, target: { id: 'co-1', name: 'Treplar Inc' },
        counts: { jobs: 2, job_orders: 1 }, total: 3,
        sentence: '2 leads and 1 job will move from “Treplar Incorporated” to “Treplar Inc”, and “Treplar Incorporated” will be removed from your clients. Nothing is deleted.',
      });
      return Promise.resolve([]);
    };
    window.apiPost = function (p, b) { if (/\/merge$/.test(p)) { window.__merged = { p, b }; return Promise.resolve({ merged: true, message: 'Merged' }); } return Promise.resolve({}); };
    window.loadClients = () => {}; window.loadClientDetail = () => {};
    STATE.clients = STATE.clients || {};
    STATE.clients.list = [{ id: 'co-1', name: 'Treplar Inc', job_order_count: 4 }];
  });

  await ta('the plan is shown BEFORE the button can be pressed', async () => {
    await stub();
    await page.evaluate(() => clientsOpenMerge('co-1'));
    await page.waitForSelector('#client-merge-src', { timeout: 5000 });
    const disabled = await page.$eval('#client-merge-go', el => el.disabled);
    assert.equal(disabled, true, 'Merge was pressable with no plan agreed to');
    await page.fill('#client-merge-src', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    await page.waitForTimeout(350);
    const plan = await page.$eval('#client-merge-plan', el => el.textContent);
    assert.match(plan, /2 leads and 1 job will move/);
    assert.match(plan, /Nothing is deleted/);
    assert.equal(await page.$eval('#client-merge-go', el => el.disabled), false, 'Merge is still disabled with a plan on screen');
  });

  await ta('merging sends the duplicate, not the survivor', async () => {
    await page.evaluate(() => clientsMergeConfirm());
    await page.waitForTimeout(300);
    const sent = await page.evaluate(() => window.__merged);
    assert.ok(sent, 'nothing was sent');
    assert.equal(sent.p, '/companies/co-1/merge', 'merged into the wrong client');
    assert.equal(sent.b.from, 'co-2', 'sent the wrong duplicate');
  });

  await ta('retyping the name withdraws the plan and re-locks the button', async () => {
    // A plan describing a different company is worse than no plan at all.
    await stub();
    await page.evaluate(() => clientsOpenMerge('co-1'));
    await page.waitForSelector('#client-merge-src');
    await page.fill('#client-merge-src', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    await page.waitForTimeout(350);
    assert.equal(await page.$eval('#client-merge-go', el => el.disabled), false);
    await page.fill('#client-merge-src', 'Somewhere Else');
    await page.waitForTimeout(200);
    assert.equal(await page.$eval('#client-merge-go', el => el.disabled), true, 'the stale plan is still agreeable');
    assert.equal(await page.evaluate(() => STATE.clients._merge.preview), null);
  });

  await ta('the page threw no errors', () => { assert.deepEqual(pageErrors, []); });
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
