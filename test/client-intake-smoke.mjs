// ============================================================================
// THE CLIENT INTAKE ON "+ New Job" — POC, address, and the re-add cooldown.
//
// The owner asked (Session 26) that creating a job directly should capture the
// client properly: POC name, email, phone, and the company's address. Three
// decisions were theirs, and two went against my recommendation — which is
// exactly why they are pinned here rather than left to be re-litigated:
//
//   · POC name + email are REQUIRED. (All 328 live leads have a POC and 708 of
//     709 contacts have an email, so this costs nobody anything.)
//   · Phone and LinkedIn stay OPTIONAL. 163 of 709 contacts have no phone;
//     requiring one would buy invented phone numbers, which is what D-0017
//     already exists to prevent.
//   · The company re-add cooldown DOES apply here, same as the RA form.
//     Recorded as D-0023 with the trade-off they accepted.
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
const cd = require('../services/company-cooldown.js');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };
const settle = (page) => page.waitForTimeout(300);

// ── 1. The POC rule ─────────────────────────────────────────────────────────
console.log('\nThe POC rule');

t('a name and an email is enough', () => {
  const r = cr.readContacts([{ first_name: 'Dana', email: 'dana@treplar.com' }]);
  assert.equal(r.error, null);
  assert.equal(r.contacts.length, 1);
});
t('PHONE AND LINKEDIN STAY OPTIONAL — 1 in 4 real contacts has no phone', () => {
  const r = cr.readContacts([{ first_name: 'Dana', email: 'dana@treplar.com' }]);
  assert.equal(r.error, null);
  assert.equal(r.contacts[0].phone, null);
  assert.equal(r.contacts[0].linkedin, null);
});
t('no contact at all is refused, and the sentence says why it matters', () => {
  const r = cr.readContacts([]);
  assert.match(r.error, /emailed or followed up/);
});
t('an untouched "add another" row is dropped, not scolded', () => {
  const r = cr.readContacts([{ first_name: 'Dana', email: 'd@t.com' }, {}, { first_name: '', email: '' }]);
  assert.equal(r.error, null);
  assert.equal(r.contacts.length, 1);
});
t('a name with no email is refused, and names WHICH contact', () => {
  const r = cr.readContacts([{ first_name: 'Dana', email: 'd@t.com' }, { first_name: 'Sam' }]);
  assert.match(r.error, /contact 2/);
});
t('one address entered twice is a mis-click, and is refused', () => {
  // Creating both would give the send path two rows for one person and email
  // them twice.
  const r = cr.readContacts([{ first_name: 'Dana', email: 'd@t.com' }, { first_name: 'Sam', email: ' D@T.com ' }]);
  assert.match(r.error, /twice/);
});
t('the email is trimmed and casefolded before it is stored', () => {
  const r = cr.readContacts([{ first_name: '  Dana ', email: '  Dana@Treplar.COM ' }]);
  assert.equal(r.contacts[0].email, 'dana@treplar.com');
  assert.equal(r.contacts[0].first_name, 'Dana');
});
t('a plausible address is not refused for being unusual', () => {
  // This check decides SHAPE, not deliverability. Refusing somebody's real
  // address is worse than accepting one that later bounces.
  for (const e of ['a.b+tag@sub.domain.co.uk', "o'brien@firm.io", 'x@y.dev']) {
    assert.equal(cr.readContacts([{ first_name: 'A', email: e }]).error, null, e + ' was refused');
  }
  for (const e of ['dana', 'dana@treplar', 'dana @t.com', '@t.com']) {
    assert.notEqual(cr.readContacts([{ first_name: 'A', email: e }]).error, null, e + ' was accepted');
  }
});

// ── 2. The address ──────────────────────────────────────────────────────────
console.log('\nThe client address');

t('every part is optional — a city alone is a valid address', () => {
  assert.deepEqual(cr.readAddress({ city: 'Martinsburg' }), { city: 'Martinsburg' });
});
t('blank parts are omitted, so a blank box never wipes a stored value', () => {
  assert.deepEqual(cr.readAddress({ city: 'Martinsburg', state: '  ', postal_code: '' }), { city: 'Martinsburg' });
});
t('a zip keeps its leading zero — it is text, never a number', () => {
  assert.equal(cr.readAddress({ postal_code: '00501' }).postal_code, '00501');
});
t('the short display form every other screen reads is derived, not retyped', () => {
  assert.equal(cr.displayLocation({ city: 'Martinsburg', state: 'WV', postal_code: '25404' }), 'Martinsburg, WV');
  assert.equal(cr.displayLocation({}), '');
});

// ── 3. The cooldown ─────────────────────────────────────────────────────────
console.log('\nThe company re-add cooldown');

const NOW = new Date('2026-09-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

t('inside the window, it blocks and counts the days left', () => {
  const s = cd.cooldownState({ lastLeadAt: daysAgo(6), now: NOW, days: 21 });
  assert.equal(s.daysAgo, 6); assert.equal(s.daysLeft, 15);
});
t('on the boundary day it is free — day 21 of a 21-day cooldown is over', () => {
  assert.equal(cd.cooldownState({ lastLeadAt: daysAgo(21), now: NOW, days: 21 }), null);
  assert.ok(cd.cooldownState({ lastLeadAt: daysAgo(20), now: NOW, days: 21 }));
});
t('a cooldown of 0 means NO cooldown, not "use the default"', () => {
  // The same blank-versus-zero distinction the AI daily cap makes. Collapsing
  // them would silently re-enable a rule an admin deliberately switched off.
  assert.equal(cd.cooldownState({ lastLeadAt: daysAgo(1), now: NOW, days: 0 }), null);
});
t('a company with no leads is never on cooldown', () => {
  assert.equal(cd.cooldownState({ lastLeadAt: null, now: NOW, days: 21 }), null);
});
t('a future timestamp is bad data, not a block', () => {
  assert.equal(cd.cooldownState({ lastLeadAt: daysAgo(-3), now: NOW, days: 21 }), null);
});
t('the refusal names WHO to go and talk to — a wall with no door is useless', () => {
  const s = cd.cooldownState({ lastLeadAt: daysAgo(6), now: NOW, days: 21 });
  const msg = cd.cooldownSentence(s, { company: 'Treplar Inc', position: 'Welder', addedBy: 'Asha Rao' });
  assert.match(msg, /Treplar Inc/); assert.match(msg, /Asha Rao/);
  assert.match(msg, /6 days ago/); assert.match(msg, /15 more days/);
});
t('it reads naturally at the edges, not "1 days" or "0 days ago"', () => {
  assert.match(cd.cooldownSentence(cd.cooldownState({ lastLeadAt: daysAgo(0), now: NOW, days: 21 }), {}), /today/);
  assert.match(cd.cooldownSentence(cd.cooldownState({ lastLeadAt: daysAgo(1), now: NOW, days: 21 }), {}), /yesterday/);
  assert.match(cd.cooldownSentence(cd.cooldownState({ lastLeadAt: daysAgo(20), now: NOW, days: 21 }), {}), /1 more day\b/);
});

// ── 4. The route ────────────────────────────────────────────────────────────
console.log('\nPOST /job-orders');

function makeDb(tables, writes) {
  const mk = (table) => {
    const b = {
      _rows: (tables[table] || []).slice(), _ins: null,
      select() { return b; }, eq() { return b; }, is() { return b; }, in() { return b; },
      ilike() { return b; }, limit() { return b; }, order() { return b; }, gte() { return b; },
      insert(p) { b._ins = p; writes.push({ table, payload: p }); return b; },
      update(p) { writes.push({ table, update: p }); return b; },
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

async function callCreate(body, { companies = [], jobs = [], orgId = 'org-A' } = {}) {
  const writes = [];
  const tables = { companies: companies.slice(), organizations: [], jobs: jobs.slice(), contacts: [], job_orders: [], app_settings: [] };
  const supabase = makeDb(tables, writes);
  const core = {
    supabase, db: {}, auth: (q, r, n) => n(), hasRole: () => true, today: () => '2026-09-17',
    orgIdFor: () => orgId, orgStamp: () => ({ org_id: orgId }), withOrg: (q) => q.eq('org_id', orgId),
    hasRequirementColumns: async () => false, applyDerivedJobFields: async () => ({}),
    persistScores: () => {}, invalidateJobScores: () => {},
    STAGES: [], STAGE_ALIASES: {}, normalizeStage: (x) => x, BDM_GATED_STAGE: '',
    isBDM: () => true, isRecruiter: () => false,
    assignedJobOrderIds: async () => [], recruiterCanTouchJob: async () => true, reportingChainIds: async () => [],
    nextId: async (p) => p + '-001', logSubmissionActivity: async () => {},
    JOB_ORDER_SELECT: '*', JOB_FIELDS: ['job_title', 'client'], JOB_DATE_FIELDS: [],
    pickJobFields: (s) => ({ job_title: s.job_title, client: s.client }),
  };
  let handler = null;
  const app = { get() {}, put() {}, delete() {}, post(p, ...r) { if (p === '/job-orders') handler = r[r.length - 1]; } };
  require('../routes/recruiting/job-orders.js')(app, core);
  let status = 200, payload = null;
  const res = { status(s) { status = s; return res; }, json(j) { payload = j; return res; } };
  await handler({ body, user: { id: 'u-1' }, orgId, params: {}, query: {} }, res);
  return { status, payload, writes, tables };
}

const GOOD_POC = [{ first_name: 'Dana', last_name: 'Reyes', email: 'dana@treplar.com', designation: 'Ops Manager', phone: '304-555-0142' }];

await ta('a client name, an address and a POC creates all three records', async () => {
  const r = await callCreate({
    lead: { position: 'Industrial Electrician', company_name: 'Treplar Inc', contacts: GOOD_POC,
      address: { address_line1: '1400 Edwin Miller Blvd', city: 'Martinsburg', state: 'WV', postal_code: '25404', country: 'United States' } },
    job: {},
  });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
  const contact = r.writes.find(w => w.table === 'contacts');
  assert.ok(contact, 'no POC was written');
  const row = Array.isArray(contact.payload) ? contact.payload[0] : contact.payload;
  assert.equal(row.email, 'dana@treplar.com');
  assert.equal(row.is_primary, true, 'the first POC must be primary');
  assert.equal(row.org_id, 'org-A');
  const addr = r.writes.find(w => w.table === 'companies' && w.update);
  assert.ok(addr, 'the address was never saved');
  assert.equal(addr.update.postal_code, '25404');
  assert.equal(addr.update.location, 'Martinsburg, WV', 'the short display form was not derived');
});

await ta('no POC is refused, and NOTHING is created', async () => {
  const r = await callCreate({ lead: { position: 'Industrial Electrician', company_name: 'Treplar Inc' }, job: {} });
  assert.equal(r.status, 400);
  assert.match(r.payload.error, /contact/i);
  assert.equal(r.writes.filter(w => w.table === 'job_orders').length, 0, 'a job order was created anyway');
  assert.equal(r.writes.filter(w => w.table === 'jobs' && w.payload).length, 0, 'a lead was created anyway');
});

await ta('a POC with no email is refused', async () => {
  const r = await callCreate({ lead: { position: 'X', company_name: 'Treplar Inc', contacts: [{ first_name: 'Dana' }] }, job: {} });
  assert.equal(r.status, 400);
  assert.match(r.payload.error, /email/i);
});

await ta('THE COOLDOWN BLOCKS an existing client added 6 days ago', async () => {
  const recent = new Date(Date.now() - 6 * 86400000).toISOString();
  const r = await callCreate(
    { lead: { position: 'Welder', company_id: 'co-1', company_name: 'Treplar Inc', contacts: GOOD_POC }, job: {} },
    { companies: [{ id: 'co-1', name: 'Treplar Inc' }], jobs: [{ id: 'ld-1', position: 'Electrician', created_at: recent, users: { name: 'Asha Rao' } }] });
  assert.equal(r.status, 409, 'expected a cooldown block, got ' + r.status);
  assert.equal(r.payload.reason, 'company_cooldown');
  assert.match(r.payload.error, /Asha Rao/, 'the refusal does not say who to talk to');
  assert.equal(r.writes.filter(w => w.table === 'job_orders').length, 0);
});

await ta('a BRAND NEW client is never blocked by the lead it is about to get', async () => {
  const r = await callCreate({ lead: { position: 'Welder', company_name: 'Somewhere Fresh LLC', contacts: GOOD_POC }, job: {} });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
});

await ta('an existing client whose last lead is old is not blocked', async () => {
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  const r = await callCreate(
    { lead: { position: 'Welder', company_id: 'co-1', company_name: 'Treplar Inc', contacts: GOOD_POC }, job: {} },
    { companies: [{ id: 'co-1', name: 'Treplar Inc' }], jobs: [{ id: 'ld-1', position: 'Electrician', created_at: old }] });
  assert.equal(r.status, 201, 'refused: ' + JSON.stringify(r.payload));
});

// ── 5. The form ─────────────────────────────────────────────────────────────
console.log('\nThe Client & POC tab');

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

  const stub = (intake) => page.evaluate((intakeArg) => {
    STATE.user.role = 'bd_manager'; STATE.user.roles = ['bd_manager'];
    window.__sent = null; window.__toasts = [];
    const realToast = window.showToast;
    window.showToast = function (m, k) { window.__toasts.push(String(m)); if (realToast) try { realToast(m, k); } catch (e) {} };
    window.apiGet = function (p) {
      if (p.indexOf('/companies/search') === 0) return Promise.resolve([{ id: 'co-1', name: 'Treplar Inc', industry: 'Manufacturing', location: 'Martinsburg, WV', job_count: 3 }]);
      if (p.indexOf('/intake') > -1) return Promise.resolve(intakeArg);
      return Promise.resolve([]);
    };
    window.apiPost = function (p, b) {
      if (p === '/job-orders') { window.__sent = b; return Promise.resolve({ id: 'jo-1', job_code: 'JOB-001' }); }
      if (p === '/contacts/check-email') return Promise.resolve({ duplicate: false });
      return Promise.resolve({});
    };
    window.loadJobOrders = function () {};
  }, intake);

  const FREE = { id: 'co-1', name: 'Treplar Inc', address: { city: 'Martinsburg', state: 'WV' }, lead_count: 3,
    contacts: [{ first_name: 'Dana', last_name: 'Reyes', email: 'dana@treplar.com', designation: 'Ops Manager', phone: '304-555-0142', is_primary: true }],
    cooldown: { blocked: false } };
  const BLOCKED = Object.assign({}, FREE, { cooldown: { blocked: true, days_left: 15, days_ago: 6,
    sentence: 'Treplar Inc was added 6 days ago by Asha Rao (Electrician). The 21-day company cooldown has 15 more days to run — speak to Asha Rao before adding it again.' } });

  await ta('a direct create gets a Client & POC tab; Edit does not', async () => {
    await stub(FREE);
    await page.evaluate(() => bdOpenNewJob(null));
    await page.waitForSelector('.modal');
    const tabs = await page.$$eval('.mtab', ns => ns.map(n => n.textContent.trim()));
    assert.ok(tabs.some(x => /Client/.test(x)), 'no Client tab: ' + tabs.join(' | '));
    await page.evaluate(() => {
      STATE.bd.jobOrders = [{ id: 'jo-9', job_code: 'J9', job_title: 'Welder', client: 'Acme', recruiters: [] }];
      bdOpenEditJob('jo-9');
    });
    await page.waitForSelector('.modal');
    const editTabs = await page.$$eval('.mtab', ns => ns.map(n => n.textContent.trim()));
    assert.ok(!editTabs.some(x => /Client/.test(x)), 'Edit drew a Client tab: ' + editTabs.join(' | '));
  });

  await ta('saving with no POC refuses and OPENS the tab that fixes it', async () => {
    await settle(page); await stub(FREE);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'Industrial Electrician'; STATE.bd.form.client = 'Treplar Inc'; });
    await page.evaluate(() => bdSaveNewJob());
    await settle(page);
    assert.equal(await page.evaluate(() => window.__sent), null, 'it sent anyway');
    assert.equal(await page.evaluate(() => STATE.bd.form.tab), 'client', 'the person is left on the wrong tab');
    const toasts = await page.evaluate(() => window.__toasts);
    assert.ok(toasts.some(x => /contact/i.test(x)), 'no usable message: ' + JSON.stringify(toasts));
  });

  await ta('a POC filled in on the tab is sent with the job', async () => {
    await settle(page); await stub(FREE);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'Industrial Electrician'; STATE.bd.form.client = 'Treplar Inc'; bdFormTab('client'); });
    await page.waitForSelector('#poc-bd');
    await page.fill('#poc-bd input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-bd input[placeholder="Email address *"]', 'dana@treplar.com');
    await page.fill('#poc-bd input[placeholder="Phone (optional)"]', '304-555-0142');
    await page.fill('input[placeholder="e.g. 1400 Edwin Miller Blvd"]', '1400 Edwin Miller Blvd');
    await page.evaluate(() => bdSaveNewJob());
    await settle(page);
    const sent = await page.evaluate(() => window.__sent && JSON.parse(JSON.stringify(window.__sent)));
    assert.ok(sent, 'nothing was sent: ' + JSON.stringify(await page.evaluate(() => window.__toasts)));
    assert.equal(sent.lead.contacts[0].first_name, 'Dana');
    assert.equal(sent.lead.contacts[0].email, 'dana@treplar.com');
    assert.equal(sent.lead.address.address_line1, '1400 Edwin Miller Blvd');
    assert.equal(cr.readContacts(sent.lead.contacts).error, null, 'the server would refuse this payload');
  });

  await ta('THE COOLDOWN IS SHOWN ON PICK, not discovered at Save', async () => {
    // This is the whole point of fetching the intake when a client is chosen.
    await settle(page); await stub(BLOCKED);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'Welder'; bdFormTab('details'); });
    await page.waitForSelector('#bd-client');
    await page.fill('#bd-client', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    await settle(page);
    const banner = await page.$eval('#bd-client-block', el => el.textContent);
    assert.match(banner, /cooldown/i, 'no cooldown warning where the client is chosen');
    assert.match(banner, /Asha Rao/, 'the banner does not say who to talk to');
  });

  await ta('a blocked client cannot be saved', async () => {
    await page.evaluate(() => bdSaveNewJob());
    await settle(page);
    assert.equal(await page.evaluate(() => window.__sent), null, 'it saved a blocked client');
  });

  await ta('retyping the client name clears the previous one\'s cooldown', async () => {
    // A stale block would refuse a company that is actually free.
    // The refused save above moved us to the Client tab, where the client box
    // does not live — go back to where the name is actually typed.
    await page.evaluate(() => bdFormTab('details'));
    await page.waitForSelector('#bd-client', { timeout: 5000 });
    await page.fill('#bd-client', 'Somewhere Else LLC');
    await settle(page);
    assert.equal(await page.evaluate(() => STATE.bd.form.intake), null);
    const banner = await page.$eval('#bd-client-block', el => el.textContent.trim());
    assert.equal(banner, '', 'the old cooldown banner is still up');
  });

  await ta('a POC the client already has can be used with one click', async () => {
    await settle(page); await stub(FREE);
    await page.evaluate(() => { bdOpenNewJob(null); STATE.bd.form.job_title = 'Welder'; bdFormTab('details'); });
    await page.waitForSelector('#bd-client');
    await page.fill('#bd-client', 'Trep');
    await page.waitForSelector('._co-ac-sug', { timeout: 5000 });
    await page.locator('._co-ac-sug').first().dispatchEvent('mousedown');
    await settle(page);
    await page.evaluate(() => bdFormTab('client'));
    await page.waitForSelector('.poc-known');
    await page.click('.poc-known');
    await settle(page);
    const c = await page.evaluate(() => STATE.bd.form.contacts[0]);
    assert.equal(c.email, 'dana@treplar.com');
    assert.equal(c.designation, 'Ops Manager');
  });

  await ta('the stored address is pre-filled so it is edited, not retyped', async () => {
    const city = await page.$eval('#content, #layer', () => document.querySelector('.modal').innerHTML.includes('Martinsburg'));
    assert.ok(city, 'the client\'s known address was not pre-filled');
  });

  await ta('typing in a POC box does not steal the caret', async () => {
    // pocSet records and never redraws; a redraw on a keystroke is what takes
    // the focus out of the field being typed in.
    const focused = await page.evaluate(async () => {
      const el = document.querySelector('#poc-bd input[placeholder="Last name"]');
      el.focus(); el.value = 'Reye'; el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      return document.activeElement === el;
    });
    assert.ok(focused, 'the caret left the box');
  });

  await ta('a late duplicate-check answer does not eat what is being typed', async () => {
    // The check answers ~300ms after the person has already tabbed on to the
    // phone box. Redrawing the block then replaces the field under their hands
    // and loses the characters typed since the last input event — found in a
    // screenshot, where a filled phone number simply was not there.
    await settle(page);
    await page.evaluate(() => { bdOpenNewJob(null); bdFormTab('client'); });
    await page.waitForSelector('#poc-bd');
    await page.fill('#poc-bd input[placeholder="First name *"]', 'Dana');
    await page.fill('#poc-bd input[placeholder="Email address *"]', 'dana@treplar.com');
    await page.fill('#poc-bd input[placeholder="Phone (optional)"]', '304-555-0142');
    await page.waitForTimeout(500);           // let the check come back
    const phoneBox = await page.$eval('#poc-bd input[placeholder="Phone (optional)"]', el => el.value);
    assert.equal(phoneBox, '304-555-0142', 'the phone box was wiped by the email check');
    assert.equal(await page.evaluate(() => STATE.bd.form.contacts[0].phone), '304-555-0142');
    const note = await page.$eval('#poc-bd .poc-email-note[data-idx="0"]', el => el.textContent);
    assert.match(note, /Not seen before/, 'the check result never appeared');
  });

  await ta('"+ Add another contact" adds a row and Remove takes it away', async () => {
    const before = await page.$$eval('#poc-bd .poc-row', n => n.length);
    await page.click('#poc-bd button[onclick*="pocAdd"]');
    await settle(page);
    const after = await page.$$eval('#poc-bd .poc-row', n => n.length);
    assert.equal(after, before + 1);
    assert.equal(await page.evaluate(() => STATE.bd.form.contacts.length), after);
  });

  await ta('the two copies of the POC rule agree, case for case', async () => {
    // pocFirstError in 52-poc-block.js is a CHECKED COPY of readContacts in
    // services/client-resolve.js — the browser cannot require a Node module.
    // If they ever drift, the form accepts what the server refuses.
    const CASES = [
      [], [{}], [{ first_name: 'Dana', email: 'dana@treplar.com' }],
      [{ first_name: 'Dana' }], [{ email: 'dana@treplar.com' }],
      [{ first_name: 'A', email: 'dana@treplar' }], [{ first_name: 'A', email: 'a.b+t@sub.d.co.uk' }],
      [{ first_name: 'A', email: 'x@y.dev' }, { first_name: 'B', email: 'X@Y.dev' }],
      [{ first_name: 'A', email: 'a@b.com' }, {}],
      [{ first_name: 'A', email: 'a@b.com' }, { first_name: 'B' }],
      [{ first_name: ' A ', email: ' A@B.COM ' }],
      [{ first_name: 'A', email: 'a @b.com' }], [{ first_name: 'A', email: '@b.com' }],
    ];
    const browserSays = await page.evaluate(cs => cs.map(c => window.pocFirstError(c)), CASES);
    CASES.forEach((c, i) => {
      const serverSays = cr.readContacts(c).error;
      assert.equal(browserSays[i], serverSays,
        'case ' + i + ' ' + JSON.stringify(c) + '\n    browser: ' + browserSays[i] + '\n    server:  ' + serverSays);
    });
  });

  await ta('the page threw no errors', () => { assert.deepEqual(pageErrors, []); });

  await ta('on a 390px phone nothing in the Client tab is off-screen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    const ph = await ctx.newPage();
    try {
      await ph.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await waitForLogin(ph); await enterApp(ph);
      await ph.waitForSelector('#sidebar', { timeout: 15000 });
      await ph.evaluate((intakeArg) => {
        STATE.user.role = 'bd_manager'; STATE.user.roles = ['bd_manager'];
        window.apiGet = (p) => p.indexOf('/intake') > -1 ? Promise.resolve(intakeArg) : Promise.resolve([]);
        window.apiPost = () => Promise.resolve({}); window.loadJobOrders = () => {};
        bdOpenNewJob(null); STATE.bd.form.company_id = 'co-1'; STATE.bd.form.client = 'Treplar Inc';
        STATE.bd.form.intake = intakeArg; bdFormTab('client');
      }, FREE);
      await ph.waitForSelector('#poc-bd');
      const worst = await ph.evaluate(() => {
        let w = 0, who = '';
        document.querySelectorAll('.modal *').forEach(el => {
          const b = el.getBoundingClientRect(); if (!b.width) return;
          const over = b.right - window.innerWidth;
          if (over > w) { w = over; who = String(el.className || el.tagName).slice(0, 40); }
        });
        return { w: Math.round(w), who };
      });
      assert.ok(worst.w <= 1, 'off-screen by ' + worst.w + 'px: ' + worst.who);
    } finally { await ctx.close(); }
  });
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
