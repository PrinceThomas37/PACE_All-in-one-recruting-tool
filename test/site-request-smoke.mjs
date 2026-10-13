// Website walkthrough requests become leads in PACE (R-216, D-0137).
//
// What this pins, each because getting it wrong costs a real customer:
//   * a request is KEPT before anything else, and a failure after that does not
//     lose it (the old mailto form lost requests silently — the reason for R-216);
//   * with no WEBSITE_LEADS_ORG_ID nothing goes into ANY organisation's lead list
//     (the first org is a customer's; PACE's prospects must not land there by default);
//   * a lead is made in the configured org only, Unassigned (never emailed by itself),
//     with a reminder for that org's longest-standing admin that says who asked;
//   * the same email again makes no second lead; an email on a DELETED lead is new;
//   * `_` and `%` in an email or agency match only themselves;
//   * a bot (honeypot filled) and a person get the same answer.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const { parseRequest, recordWalkthroughRequest, SOURCE } = require('../services/site-requests.js');
const { createDb } = require('../models/index.js');
const { describeReminder } = require('../services/reminder-source.js');

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); }
}

const ORG_A = uid(), ORG_B = uid();
const ADMIN_OLD = uid(), ADMIN_NEW = uid(), RA = uid(), ADMIN_B = uid();
const NOW = new Date('2026-10-13T19:30:00Z');
const withId = () => ({ id: uid(), created_at: new Date().toISOString() });

function world(extra = {}) {
  const fake = createFakeDb({
    tables: {
      users: [
        { id: ADMIN_NEW, org_id: ORG_A, role: 'admin', roles: ['admin'], is_active: true, created_at: '2026-05-01T00:00:00Z' },
        { id: ADMIN_OLD, org_id: ORG_A, role: 'bd', roles: ['bd', 'admin'], is_active: true, created_at: '2025-01-01T00:00:00Z' },
        { id: RA, org_id: ORG_A, role: 'ra', roles: ['ra'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
        { id: ADMIN_B, org_id: ORG_B, role: 'admin', roles: ['admin'], is_active: true, created_at: '2020-01-01T00:00:00Z' },
      ],
      companies: [], jobs: [], contacts: [], reminders: [], activity_log: [], app_settings: [],
      ...extra,
    },
    defaults: { companies: withId, jobs: withId, contacts: withId, reminders: withId, activity_log: withId },
    onQuery: extra.__onQuery,
  });
  return { fake, db: createDb(fake.supabase) };
}
const REQ = { name: 'Asha Verma', email: 'asha@brightstaff.com', agency: 'BrightStaff', plan: 'Pro' };

// ── 1. reading the form ─────────────────────────────────────────────────────
await t('a filled honeypot is a bot, whatever else is filled in', () => {
  assert.deepEqual(parseRequest({ ...REQ, website: 'http://spam.example' }), { spam: true });
});
await t('name, a real email and the agency are required, each with its own sentence', () => {
  assert.match(parseRequest({ ...REQ, name: '  ' }).error, /name/);
  assert.match(parseRequest({ ...REQ, email: 'not-an-email' }).error, /valid work email/);
  assert.match(parseRequest({ ...REQ, agency: '' }).error, /agency/);
});
await t('text is one bounded line, the email lower-case, an unknown plan becomes "Not sure yet"', () => {
  const r = parseRequest({ name: 'Asha\n\tVerma', email: ' ASHA@BrightStaff.COM ', agency: 'x'.repeat(500), plan: 'Platinum' }).request;
  assert.equal(r.name, 'Asha Verma');
  assert.equal(r.email, 'asha@brightstaff.com');
  assert.equal(r.agency.length, 200);
  assert.equal(r.plan, 'Not sure yet');
  assert.equal(parseRequest({ ...REQ, plan: 'max' }).request.plan, 'Max');
});

// ── 2. no organisation configured ───────────────────────────────────────────
await t('with no organisation set, the request is kept and nobody gets a lead', async () => {
  const { fake, db } = world();
  const out = await recordWalkthroughRequest({ db, orgId: null, request: REQ, now: NOW });
  assert.equal(out.kept, true);
  assert.equal(out.destination, 'none');
  const kept = fake.tables.app_settings.find((r) => r.key === 'site_request:asha@brightstaff.com');
  assert.ok(kept, 'the request must be stored');
  assert.equal(JSON.parse(kept.value).agency, 'BrightStaff');
  for (const tb of ['companies', 'jobs', 'contacts', 'reminders']) assert.equal(fake.tables[tb].length, 0, tb + ' must stay empty');
});

// ── 3. a new request in the configured organisation ─────────────────────────
await t('a new email becomes an Unassigned lead with the person as contact, in that org only', async () => {
  const { fake, db } = world();
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.lead_error, null);
  assert.equal(out.new_lead, true);
  const [co] = fake.tables.companies, [job] = fake.tables.jobs, [ct] = fake.tables.contacts;
  assert.equal(co.name, 'BrightStaff'); assert.equal(co.org_id, ORG_A);
  assert.equal(job.org_id, ORG_A); assert.equal(job.stage, 'Unassigned'); assert.equal(job.source, SOURCE);
  assert.equal(job.company_id, co.id); assert.equal(job.id, out.lead_id);
  assert.equal(job.assigned_to_bd, undefined, 'nobody owns it, so nothing emails it');
  assert.match(job.notes, /Plan: Pro/);
  assert.equal(ct.job_id, job.id); assert.equal(ct.email, REQ.email); assert.equal(ct.first_name, 'Asha'); assert.equal(ct.last_name, 'Verma');
  assert.equal(ct.org_id, ORG_A);
  assert.equal(fake.tables.activity_log.length, 1);
});
await t('the reminder goes to the org\'s longest-standing admin, today, and says who asked', async () => {
  const { fake, db } = world();
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.reminded, true);
  const [r] = fake.tables.reminders;
  assert.equal(r.user_id, ADMIN_OLD, 'oldest admin (an admin through `roles`), not the RA and not the newer admin');
  assert.equal(r.org_id, ORG_A);
  assert.equal(r.reminder_type, 'website_request');
  assert.equal(r.return_date, '2026-10-13');
  assert.match(r.note, /Asha Verma \(BrightStaff\) asked for a walkthrough/);
  assert.match(r.note, /asha@brightstaff\.com/);
  assert.equal(r.job_id, out.lead_id);
  const d = describeReminder(r);
  assert.equal(d.label, 'Website');
  assert.match(d.why, /walkthrough on the PACE website/);
});
await t('an agency already on file in that org is reused (case-insensitive); another org\'s is not', async () => {
  const known = uid();
  const { fake, db } = world({ companies: [
    { id: uid(), org_id: ORG_B, name: 'BrightStaff' },
    { id: known, org_id: ORG_A, name: 'brightstaff' },
  ] });
  await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(fake.tables.companies.length, 2, 'no new company');
  assert.equal(fake.tables.jobs[0].company_id, known);
});

// ── 4. repeats, deleted leads, wildcards, other orgs ────────────────────────
await t('the same email again makes no second lead: the reminder goes on the lead they are on', async () => {
  const { fake, db } = world();
  const first = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  const again = await recordWalkthroughRequest({ db, orgId: ORG_A, request: { ...REQ, email: 'ASHA@brightstaff.com'.toLowerCase() }, now: NOW });
  assert.equal(fake.tables.jobs.length, 1);
  assert.equal(again.new_lead, false);
  assert.equal(again.lead_id, first.lead_id);
  assert.equal(fake.tables.reminders.length, 2);
  assert.match(fake.tables.reminders[1].note, /on the website again/);
});
await t('a person already on a lead you cold-emailed: the reminder lands on THAT lead', async () => {
  const lead = uid(), contact = uid();
  const { fake, db } = world({
    jobs: [{ id: lead, org_id: ORG_A, position: 'Java Developer', stage: 'Connected', deleted_at: null }],
    contacts: [{ id: contact, org_id: ORG_A, job_id: lead, email: 'Asha@BrightStaff.com' }],
  });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.lead_id, lead);
  assert.equal(fake.tables.jobs.length, 1);
  assert.equal(fake.tables.reminders[0].contact_id, contact);
});
await t('an email that is only on a DELETED lead gets a new lead', async () => {
  const gone = uid();
  const { fake, db } = world({
    jobs: [{ id: gone, org_id: ORG_A, position: 'Old', stage: 'Unassigned', deleted_at: '2026-09-01T00:00:00Z' }],
    contacts: [{ id: uid(), org_id: ORG_A, job_id: gone, email: REQ.email }],
  });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.new_lead, true);
  assert.notEqual(out.lead_id, gone);
});
await t('the same email in ANOTHER org is not this org\'s contact', async () => {
  const otherLead = uid();
  const { fake, db } = world({
    jobs: [{ id: otherLead, org_id: ORG_B, position: 'X', stage: 'Unassigned', deleted_at: null }],
    contacts: [{ id: uid(), org_id: ORG_B, job_id: otherLead, email: REQ.email }],
  });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.new_lead, true);
  assert.ok(!fake.tables.reminders.some((r) => r.user_id === ADMIN_B), 'org B\'s admin is never reminded');
});
await t('"_" in an email matches only itself (ILIKE wildcard escaped)', async () => {
  const lead = uid();
  const { fake, db } = world({
    jobs: [{ id: lead, org_id: ORG_A, position: 'X', stage: 'Unassigned', deleted_at: null }],
    contacts: [{ id: uid(), org_id: ORG_A, job_id: lead, email: 'a-b@x.com' }],
  });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: { ...REQ, email: 'a_b@x.com' }, now: NOW });
  assert.equal(out.new_lead, true, 'a_b must not match a-b');
  assert.equal(fake.tables.jobs.length, 2);
});
await t('an org with no admin still gets the lead; it says nobody was reminded', async () => {
  const { fake, db } = world({ users: [{ id: RA, org_id: ORG_A, role: 'ra', roles: ['ra'], is_active: true }] });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.new_lead, true);
  assert.equal(out.reminded, false);
  assert.equal(fake.tables.reminders.length, 0);
});

// ── 5. failures ─────────────────────────────────────────────────────────────
await t('if the request cannot even be kept, that is an error the visitor sees', async () => {
  const { db } = world({ __onQuery: (q) => (q.table === 'app_settings' ? { data: null, error: { message: 'db down' } } : undefined) });
  await assert.rejects(recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW }), (e) => /db down/.test(e && e.message));
});
await t('a failure AFTER keeping is reported to the operator, and the request is not lost', async () => {
  const { fake, db } = world({ __onQuery: (q) => (q.table === 'jobs' && q.op === 'insert' ? { data: null, error: { message: 'insert refused' } } : undefined) });
  const out = await recordWalkthroughRequest({ db, orgId: ORG_A, request: REQ, now: NOW });
  assert.equal(out.kept, true);
  assert.match(out.lead_error, /insert refused/);
  assert.ok(fake.tables.app_settings.length === 1);
});

// ── 6. the public route ─────────────────────────────────────────────────────
await t('the route: 400 with a sentence, the same 200 for a person and a bot, org read per request', async () => {
  const express = require('express');
  const { fake, db } = world();
  const app = express();
  app.use(express.json());
  app.use(require('../routes/site-requests.js')({ db }));
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const post = (body) => new Promise((ok, no) => {
    const data = JSON.stringify(body);
    const r = http.request({ port: server.address().port, path: '/site/walkthrough-request', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(b) })); });
    r.on('error', no); r.end(data);
  });
  const saved = process.env.WEBSITE_LEADS_ORG_ID;
  const quiet = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    const bad = await post({ ...REQ, email: 'nope' });
    assert.equal(bad.status, 400); assert.match(bad.body.error, /valid work email/);
    const bot = await post({ ...REQ, website: 'x' });
    assert.deepEqual(bot, { status: 200, body: { ok: true } });
    assert.equal(fake.tables.app_settings.length, 0, 'a bot stores nothing');
    delete process.env.WEBSITE_LEADS_ORG_ID;
    const nowhere = await post(REQ);
    assert.equal(nowhere.status, 503, 'kept but in nobody\'s lead list must not be "ok"');
    assert.match(nowhere.body.error, /email info@paceconsultant\.in/);
    assert.equal(fake.tables.jobs.length, 0);
    assert.ok(fake.tables.app_settings.some((r) => r.key === 'site_request:' + REQ.email), 'still kept');
    process.env.WEBSITE_LEADS_ORG_ID = ORG_A;
    assert.deepEqual(await post({ ...REQ, email: 'ravi@nimbus.io', agency: 'Nimbus' }), { status: 200, body: { ok: true } });
    assert.equal(fake.tables.jobs.length, 1);
    assert.equal(fake.tables.jobs[0].org_id, ORG_A);
  } finally {
    console.log = quiet; console.warn = warn;
    if (saved === undefined) delete process.env.WEBSITE_LEADS_ORG_ID; else process.env.WEBSITE_LEADS_ORG_ID = saved;
    server.close();
  }
});
await t('the route: a lead that could not be made is a 503, never "ok" (D-0138)', async () => {
  const express = require('express');
  const { fake, db } = world({ __onQuery: (q) => (q.table === 'jobs' && q.op === 'insert' ? { data: null, error: { message: 'insert refused' } } : undefined) });
  const app = express();
  app.use(express.json());
  app.use(require('../routes/site-requests.js')({ db }));
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const saved = process.env.WEBSITE_LEADS_ORG_ID;
  const err = console.error; console.error = () => {};
  try {
    process.env.WEBSITE_LEADS_ORG_ID = ORG_A;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/site/walkthrough-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(REQ) });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /info@paceconsultant\.in/);
    assert.equal(fake.tables.app_settings.length, 1, 'the request itself is kept');
  } finally {
    console.error = err;
    if (saved === undefined) delete process.env.WEBSITE_LEADS_ORG_ID; else process.env.WEBSITE_LEADS_ORG_ID = saved;
    server.close();
  }
});
await t('index.js mounts the route behind its own rate limit', async () => {
  const src = require('node:fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(src, /app\.use\('\/site\/walkthrough-request', createRateLimiter\(\{ name: 'site-request'/);
  assert.match(src, /app\.use\(require\('\.\/routes\/site-requests'\)\(routeCtx\)\)/);
  assert.ok(src.indexOf("'/site/walkthrough-request', createRateLimiter") < src.indexOf("require('./routes/site-requests')"), 'the limiter must be registered before the route');
});

console.log(results.join('\n'));
console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
