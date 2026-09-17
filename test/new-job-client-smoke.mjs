// ============================================================================
// "+ New Job" WITHOUT A LEAD.
//
// The owner filled in the New Job form and pressed Save Job, and got:
//   "Failed to create job: lead.company_id and lead.position are required
//    (lead info must be filled first)."
//
// Two faults, stacked:
//  1. public/js/25-workflow-bd.js sent `company_id: null` — HARD-CODED — on
//     every direct create. The Client box was free text that was never resolved
//     to a `companies` row, so the direct-create path could not succeed for
//     anybody, ever. The from-lead path was unaffected, which is why this was
//     never noticed.
//  2. The refusal named JSON field names and told the reader to go and make a
//     lead first — a step the server actually performs for them. The form let
//     twenty fields be filled and only then refused. CLAUDE.md: a rule that
//     decides whether an action is ALLOWED belongs where the action is OFFERED.
//
// This pins the fix at both ends: the pure rule, the route driven with a stub
// database (so the company really is found-or-created and the rows really are
// org-stamped), and the real form in a real browser.
// ============================================================================
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const require = createRequire(import.meta.url);
const cr = require('../services/client-resolve.js');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
// A save closes the modal and re-renders. Let that finish before the next
// case opens a fresh one, or its suggestion box is detached mid-click.
const settle = (page) => page.waitForTimeout(300);
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };

// ── 1. The pure rule ────────────────────────────────────────────────────────
console.log('\nThe rule');

t('a typed client NAME alone is enough — this is the whole bug', () => {
  assert.equal(cr.clientInputError({ position: 'Industrial Electrician', company_name: 'Treplar Inc' }), null);
});
t('a picked client id alone is enough', () => {
  assert.equal(cr.clientInputError({ position: 'Industrial Electrician', company_id: 'co-1' }), null);
});
t('no client is refused, in words a person can act on', () => {
  const msg = cr.clientInputError({ position: 'Industrial Electrician' });
  assert.match(msg, /client/i);
  assert.doesNotMatch(msg, /company_id|lead\.position|must be filled first/,
    'the refusal still names JSON fields or tells the reader to make a lead first');
});
t('no job title is refused separately', () => {
  assert.match(cr.clientInputError({ company_name: 'Treplar Inc' }), /title/i);
});
t('whitespace is not a client name', () => {
  assert.notEqual(cr.clientInputError({ position: 'X', company_name: '   ' }), null);
});

const ROWS = [{ id: 'co-1', name: 'Treplar Inc' }, { id: 'co-2', name: 'Acme Facilities' }];
t('an existing client is matched regardless of case and spacing', () => {
  assert.equal(cr.matchCompany('  treplar   INC ', ROWS).id, 'co-1');
});
t('a DIFFERENT company is not merged into an existing one', () => {
  // Silently folding "Treplar Industries" into "Treplar Inc" puts a job order
  // on the wrong client, and nothing on screen would say so.
  assert.equal(cr.matchCompany('Treplar Industries', ROWS), null);
  assert.equal(cr.matchCompany('Treplar', ROWS), null);
});
t('an empty name matches nothing rather than the first row', () => {
  assert.equal(cr.matchCompany('', ROWS), null);
  assert.equal(cr.matchCompany('   ', ROWS), null);
});
t('the SQL pattern is a superset of what counts as a match', () => {
  // It only pre-filters; matchCompany decides. Narrowing it silently creates
  // a duplicate client, so extra spacing must still reach the matcher.
  assert.equal(cr.companySearchPattern('Treplar  Inc'), 'treplar%inc');
});

// ── 2. The route, driven with a stub database ───────────────────────────────
console.log('\nPOST /job-orders');

// A recording stand-in for the supabase query builder. Every chain method
// returns the builder; awaiting it (or .single()) resolves from `tables`.
function makeDb(tables, writes) {
  const mk = (table) => {
    const b = {
      _rows: (tables[table] || []).slice(), _ins: null,
      select() { return b; }, eq() { return b; }, is() { return b; },
      ilike() { return b; }, limit() { return b; }, order() { return b; },
      insert(payload) { b._ins = payload; writes.push({ table, payload }); return b; },
      update() { return b; },
      single() { return Promise.resolve(b._one()); },
      maybeSingle() { return Promise.resolve(b._one()); },
      _one() {
        if (b._ins) {
          const row = Object.assign({ id: table + '-new' }, Array.isArray(b._ins) ? b._ins[0] : b._ins);
          (tables[table] = tables[table] || []).push(row);
          return { data: row, error: null };
        }
        return { data: b._rows[0] || null, error: null };
      },
      then(res, rej) { return Promise.resolve(b._ins ? b._one() : { data: b._rows, error: null }).then(res, rej); },
    };
    return b;
  };
  return { from: mk };
}

async function callCreate(body, { companies = [], orgId = 'org-A' } = {}) {
  const writes = [];
  const tables = { companies: companies.slice(), organizations: [], jobs: [], contacts: [], job_orders: [] };
  const supabase = makeDb(tables, writes);
  const orgIdFor = () => orgId;
  const core = {
    supabase, db: {}, auth: (req, res, next) => next(), hasRole: () => true, today: () => '2026-09-17',
    orgIdFor, orgStamp: () => ({ org_id: orgId }),
    withOrg: (q) => q.eq('org_id', orgId),
    hasRequirementColumns: async () => false, applyDerivedJobFields: async () => ({}),
    persistScores: () => {}, invalidateJobScores: () => {},
    STAGES: [], STAGE_ALIASES: {}, normalizeStage: (s) => s, BDM_GATED_STAGE: '',
    isBDM: () => true, isRecruiter: () => false,
    assignedJobOrderIds: async () => [], recruiterCanTouchJob: async () => true, reportingChainIds: async () => [],
    nextId: async (p) => p + '-001', logSubmissionActivity: async () => {},
    JOB_ORDER_SELECT: '*', JOB_FIELDS: ['job_title', 'client', 'city', 'state'],
    JOB_DATE_FIELDS: [], pickJobFields: (src) => ({ job_title: src.job_title, client: src.client }),
  };

  // Capture the POST /job-orders handler off a fake express app.
  let handler = null;
  const app = {
    get() {}, put() {}, delete() {},
    post(p, ...rest) { if (p === '/job-orders') handler = rest[rest.length - 1]; },
  };
  require('../routes/recruiting/job-orders.js')(app, core);
  assert.ok(handler, 'POST /job-orders was not registered');

  let status = 200, payload = null;
  const res = { status(s) { status = s; return res; }, json(j) { payload = j; return res; } };
  await handler({ body, user: { id: 'u-1' }, orgId, params: {}, query: {} }, res);
  return { status, payload, writes, tables };
}

await ta('a typed client name creates the client, the lead and the job order', async () => {
  const r = await callCreate({
    lead: { position: 'Industrial Electrician', company_name: 'Treplar Inc', location: 'Martinsburg West Virginia' },
    job: { job_title: 'Industrial Electrician', client: 'Treplar Inc' },
  });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
  const co = r.writes.find(w => w.table === 'companies');
  assert.ok(co, 'no client company was created');
  assert.equal(co.payload.name, 'Treplar Inc');
  assert.ok(r.writes.find(w => w.table === 'jobs'), 'no lead was created');
  assert.ok(r.writes.find(w => w.table === 'job_orders'), 'no job order was created');
});

await ta('an EXISTING client is reused, not duplicated', async () => {
  const r = await callCreate(
    { lead: { position: 'Industrial Electrician', company_name: '  treplar inc  ' }, job: {} },
    { companies: [{ id: 'co-1', name: 'Treplar Inc' }] });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
  assert.equal(r.writes.filter(w => w.table === 'companies').length, 0, 'a duplicate client was created');
  const lead = r.writes.find(w => w.table === 'jobs');
  assert.equal(lead.payload.company_id, 'co-1', 'the lead did not point at the existing client');
});

await ta('the lead and its contacts are stamped with the caller org', async () => {
  // These two inserts carried no org_id at all. The column has a DEFAULT, so a
  // second org's job order would have silently landed in the DEFAULT org's
  // leads list with no error anywhere.
  const r = await callCreate({
    lead: { position: 'Industrial Electrician', company_name: 'Treplar Inc',
      contacts: [{ first_name: 'Dana', email: 'dana@treplar.com' }] },
    job: {},
  }, { orgId: 'org-B' });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
  for (const table of ['companies', 'jobs', 'contacts']) {
    const w = r.writes.find(x => x.table === table);
    assert.ok(w, table + ' was never written');
    const row = Array.isArray(w.payload) ? w.payload[0] : w.payload;
    assert.equal(row.org_id, 'org-B', table + ' insert is missing org_id');
  }
});

await ta('a client id belonging to another org is refused, not used', async () => {
  // withOrg scopes the ownership check, so a foreign id simply is not found.
  const r = await callCreate(
    { lead: { position: 'X', company_id: 'co-other' }, job: {} },
    { companies: [] });
  assert.equal(r.status, 404, 'a foreign company id was accepted');
  assert.equal(r.writes.filter(w => w.table === 'job_orders').length, 0);
});

await ta('no client at all is still refused — in the new words', async () => {
  const r = await callCreate({ lead: { position: 'Industrial Electrician' }, job: {} });
  assert.equal(r.status, 400);
  assert.doesNotMatch(r.payload.error, /must be filled first/);
});

// ── 3. The form, in a real browser ──────────────────────────────────────────
console.log('\nThe New Job form');

const PUBLIC_DIR = path.join(ROOT, 'public');
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
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

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
  await waitForLogin(page);
  await enterApp(page);
  await page.waitForSelector('#sidebar', { timeout: 15000 });

  // Stub the network the way the page sees it, and record what Save sends.
  await page.evaluate(() => {
    STATE.user.role = 'bd_manager'; STATE.user.roles = ['bd_manager'];
    window.__sent = null;
    window.apiGet = function (p) {
      if (p.indexOf('/companies/search') === 0) {
        return Promise.resolve([{ id: 'co-1', name: 'Treplar Inc', industry: 'Manufacturing', location: 'WV', job_count: 3 }]);
      }
      return Promise.resolve([]);
    };
    window.apiPost = function (p, body) {
      if (p === '/job-orders') { window.__sent = body; return Promise.resolve({ id: 'jo-1', job_code: 'JOB-001' }); }
      return Promise.resolve({});
    };
    window.loadJobOrders = function () {};
  });

  await ta('the Client box is a picker, not a bare text input', async () => {
    await page.evaluate(() => bdOpenNewJob(null));
    await page.waitForSelector('#bd-client', { timeout: 5000 });
    const hint = await page.$eval('#bd-client-hint', el => el.textContent);
    assert.match(hint, /existing client|type a new one/i, 'the field does not say what it will do');
  });

  await ta('typing a NEW client name is enough to save — the reported bug', async () => {
    await page.evaluate(() => {
      bdOpenNewJob(null);
      STATE.bd.form.job_title = 'Industrial Electrician';
      STATE.bd.form.city = 'Martinsburg'; STATE.bd.form.state = 'West Virginia';
    });
    await page.waitForSelector('#bd-client', { timeout: 5000 });
    await page.fill('#bd-client', 'Treplar Inc');
    await page.evaluate(() => bdSaveNewJob());
    await settle(page);
    const sent = await page.evaluate(() => window.__sent && JSON.parse(JSON.stringify(window.__sent)));
    assert.ok(sent, 'Save Job sent nothing');
    assert.equal(sent.lead.company_name, 'Treplar Inc', 'the typed client name was not sent');
    // The measure that matters: put the payload that actually goes on the wire
    // through the SERVER's own rule. Before the fix it carried a hard-coded
    // company_id:null and no name at all, and the route refused it.
    assert.equal(cr.clientInputError(sent.lead), null, 'the server would still refuse this payload');
  });

  await ta('picking an existing client sends its id, so no duplicate is made', async () => {
    await settle(page);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'Industrial Electrician'; });
    await page.waitForSelector('#bd-client', { timeout: 5000 });
    await page.fill('#bd-client', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    // mousedown is the event the widget binds — it has to fire before the
    // input's onblur clears the box. Dispatching it directly also keeps this
    // off the repaint that the previous case's save kicked off.
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    const hint = await page.$eval('#bd-client-hint', el => el.textContent);
    assert.match(hint, /existing client/i, 'the form does not say it matched an existing client');
    await page.evaluate(() => bdSaveNewJob());
    await settle(page);
    const sent = await page.evaluate(() => window.__sent);
    assert.equal(sent.lead.company_id, 'co-1', 'the picked client id was not sent');
    assert.equal(sent.lead.company_name, 'Treplar Inc');
  });

  await ta('typing again drops a previously picked client', async () => {
    // A stale company_id under freshly typed text puts the job on the wrong client.
    await settle(page);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'X'; });
    await page.waitForSelector('#bd-client', { timeout: 5000 });
    await page.fill('#bd-client', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    assert.equal(await page.evaluate(() => STATE.bd.form.company_id), 'co-1');
    await page.fill('#bd-client', 'Treplar Industries');
    assert.equal(await page.evaluate(() => STATE.bd.form.company_id), null, 'the old client id survived a retype');
  });

  await ta('Edit Job keeps the plain Client box — PUT never changes the company', async () => {
    // pickJobFields drops company_id, so a picker on the edit form would offer
    // something the server ignores. Same for convert-from-lead, which inherits
    // the lead's company. A control that appears to act and does not is worse
    // than no control (CLAUDE.md, Session 24).
    await settle(page);
    await page.evaluate(() => {
      STATE.bd.jobOrders = [{ id: 'jo-9', job_code: 'JOB-9', job_title: 'Welder', client: 'Acme', recruiters: [] }];
      bdOpenEditJob('jo-9');
    });
    await page.waitForSelector('.modal', { timeout: 5000 });
    assert.equal(await page.$('#bd-client'), null, 'the edit form drew the client picker');
    assert.equal(await page.$('#bd-client-hint'), null, 'the edit form drew the client hint');
  });

  await ta('convert-from-lead keeps the plain Client box too', async () => {
    await settle(page);
    await page.evaluate(() => {
      STATE.jobs = [{ id: 'ld-1', lead_code: 'LD-1', position: 'Welder', company_name: 'Acme', company_id: 'co-7', location: 'Dallas TX' }];
      bdOpenNewJob('ld-1');
    });
    await page.waitForSelector('.modal', { timeout: 5000 });
    assert.equal(await page.$('#bd-client'), null, 'the from-lead form drew the client picker');
  });

  await ta('the page threw no errors', () => {
    assert.deepEqual(pageErrors, []);
  });

  // ── The same form on a phone ──────────────────────────────────────────────
  // The modal's three columns were written into a style="" attribute, and an
  // inline style cannot be re-laid-out by any stylesheet (CLAUDE.md). At 390px
  // that put the whole RIGHT column — Client, Work Authorization, City, End
  // Date — past the viewport, where #content's overflow-x:hidden made it
  // unreachable. Fixing the Client box on a desktop while leaving it off-screen
  // on a phone is not fixing it. .g3/.g2 are the app's own grid classes and
  // already collapse below 860px.
  for (const theme of ['light', 'dark']) {
    await ta('on a 390px phone, nothing in the modal is off-screen (' + theme + ')', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
      const ph = await ctx.newPage();
      try {
        await ph.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await waitForLogin(ph); await enterApp(ph);
        await ph.waitForSelector('#sidebar', { timeout: 15000 });
        await ph.evaluate((th) => {
          document.documentElement.setAttribute('data-theme', th);
          STATE.user.role = 'bd_manager'; STATE.user.roles = ['bd_manager'];
          window.apiGet = (p) => p.indexOf('/companies/search') === 0
            ? Promise.resolve([{ id: 'co-1', name: 'Treplar Inc', industry: 'Manufacturing', location: 'Martinsburg, WV', job_count: 3 }])
            : Promise.resolve([]);
          window.apiPost = () => Promise.resolve({}); window.loadJobOrders = () => {};
          bdOpenNewJob(null); STATE.bd.form.job_title = 'Industrial Electrician'; bdFormTab('details');
        }, theme);
        await ph.waitForSelector('#bd-client');
        await ph.fill('#bd-client', 'Trep');
        await ph.waitForSelector('._co-ac-sug', { timeout: 5000 });
        await ph.waitForTimeout(250);
        const m = await ph.evaluate(() => {
          let worst = 0, who = '';
          document.querySelectorAll('.modal *').forEach(el => {
            const b = el.getBoundingClientRect(); if (!b.width) return;
            const over = b.right - window.innerWidth;
            if (over > worst) { worst = over; who = String(el.className || el.tagName).slice(0, 40); }
          });
          const box = document.querySelector('._co-ac-sug').parentElement;
          return { worst: Math.round(worst), who, bg: getComputedStyle(box).backgroundColor,
                   font: getComputedStyle(document.getElementById('bd-client')).fontSize };
        });
        assert.ok(m.worst <= 1, 'off-screen by ' + m.worst + 'px: ' + m.who);
        // A float over content must be OPAQUE — --card is glass (CLAUDE.md,
        // Session 25). An rgba() with alpha here means the page shows through
        // and the two sets of text overlap.
        assert.doesNotMatch(m.bg, /rgba\(.*,\s*0?\.\d+\)/, 'the suggestion list is see-through: ' + m.bg);
        // 16px or iOS zooms on focus and never zooms back.
        assert.equal(m.font, '16px', 'the Client input would make iOS zoom');
      } finally { await ctx.close(); }
    });
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
