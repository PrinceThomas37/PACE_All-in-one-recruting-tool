// "BLOCKED" IN THE EMAIL VALIDITY MENU (owner, 13 Oct): "sometimes the email IDs we create are right, but then our email gets
// blocked due to their security team".
//
// A blocked contact is one whose address is RIGHT but whose side rejects our mail. Mailing on only hurts the sender's reputation, so
// nothing more is sent — but it is not the same as Invalid (the address still teaches its domain's format; the person can be tried
// another way). Proven here:
//   1. the one definition (services/contact-status.js): which statuses stop email, which stop follow-ups, the sentence said on the row
//   2. the REAL send-time rules lifted out of index.js and run: a blocked contact is never emailed, follow-ups stop, out-of-office
//      pauses follow-ups only
//   3. the REAL routes (routes/contacts.js over an in-memory database): Blocked can be set; it stops follow-ups (the same event as
//      Invalid); and a database that has not had migration 064 yet answers in plain words (409), never a bare database error
//   4. the browser: the menu offers exactly the server's statuses, in order, with Blocked — and both menus agree
// Usage: node test/contact-status-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const cs = require('../services/contact-status.js');

// ── 1. the definition ───────────────────────────────────────────────────────
step('the menu order is valid, invalid, deactivated, blocked, out of office', cs.STATUSES.join() === 'valid,invalid,deactivated,blocked,out_of_office');
step('invalid, deactivated and blocked are never emailed; valid and out-of-office are not "never"', ['invalid', 'deactivated', 'blocked'].every(cs.neverEmail) && !cs.neverEmail('valid') && !cs.neverEmail('out_of_office') && !cs.neverEmail(null) && !cs.neverEmail(''));
step('follow-ups stop for those three AND while out of office', ['invalid', 'deactivated', 'blocked', 'out_of_office'].every(cs.blocksFollowups) && !cs.blocksFollowups('valid') && !cs.blocksFollowups(undefined));
step('a BLOCKED address still teaches its domain\'s format (it is a real address); a bounced one does not', !cs.teachesNothing('blocked') && cs.teachesNothing('invalid') && cs.teachesNothing('deactivated'));
step('the sentence said on a refused email names Blocked and says the address itself is right', /Blocked/.test(cs.sentence('blocked')) && /address is right/.test(cs.sentence('blocked')) && /Invalid/.test(cs.sentence('invalid')));
step('case and blanks are handled (BLOCKED, null)', cs.neverEmail('BLOCKED') && cs.label('blocked') === 'Blocked' && cs.label(null) === 'Valid');

// ── 2. the real send-time rules, lifted from index.js and run ───────────────
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const grab = (re) => { const m = src.match(re); return m ? m[0] : ''; };
const pieces = [grab(/function contactEmailStatus\(contact\) \{[\s\S]*?\n\}\n/), grab(/function isFollowupEligibleContact\(contact\) \{[\s\S]*?\n\}\n/), grab(/function isPermanentFollowupBlock\(status\) \{[\s\S]*?\n\}\n/)];
step('index.js still defines the three send-time helpers', pieces.every(Boolean));
const rules = new Function('contactStatusRules', 'emailSyntaxValid', pieces.join('\n') + '\nreturn { isFollowupEligibleContact, isPermanentFollowupBlock, contactEmailStatus };')(cs, (e) => /@/.test(String(e)));
const c = (s) => ({ email: 'a@b.test', email_status: s });
step('the send loop refuses to email a BLOCKED contact (any email type)', rules.isPermanentFollowupBlock('blocked') && rules.isPermanentFollowupBlock('invalid') && !rules.isPermanentFollowupBlock('out_of_office') && !rules.isPermanentFollowupBlock('valid'));
step('a blocked contact gets no follow-ups; neither does an out-of-office one; a valid one does', !rules.isFollowupEligibleContact(c('blocked')) && !rules.isFollowupEligibleContact(c('out_of_office')) && rules.isFollowupEligibleContact(c('valid')) && rules.isFollowupEligibleContact(c(undefined)));
step('the bounce sweep leaves a blocked contact Blocked (it does not turn it into Invalid)', /neverEmail\(c\.email_status\)\) continue/.test(fs.readFileSync(new URL('../services/bounce-mark.js', import.meta.url), 'utf8')));   // the rule moved to services/bounce-mark.js (R-243); test/org-isolation-r067-smoke.mjs calls it

// ── 3. the real routes ──────────────────────────────────────────────────────
const express = require('express');
const { createDb } = require('../models');
const { EVENTS, on } = require('../events');
const ORG = 'org-a', J1 = uid(), CT = uid();
const fake = createFakeDb({
  tables: { companies: [], jobs: [{ id: J1, org_id: ORG, company_id: null, position: 'Dev', stage: 'Assigned', deleted_at: null, created_by: 'u1', assigned_to_bd: 'u1' }],
    contacts: [{ id: CT, org_id: ORG, job_id: J1, first_name: 'Dana', last_name: 'Gate', email: 'dana@acme.test', email_status: 'valid', extra_emails: [], extra_phones: [], is_primary: true }],
    reminders: [], activity_log: [], app_settings: [], suppression_list: [] },
  defaults: { contacts: () => ({ id: uid(), org_id: ORG, extra_emails: [], extra_phones: [], email_status: 'valid' }) },
  relations: { contacts: { job: { table: 'jobs', fk: 'job_id' } }, jobs: { company: { table: 'companies', fk: 'company_id' } } },
});
// A database that has NOT had migration 064: its CHECK refuses "blocked" (code 23514), as the live one does today.
let migrated = false;
const gated = { ...fake.supabase, from(t) {
  const q = fake.supabase.from(t);
  if (t !== 'contacts' || !q.update) return q;
  const upd = q.update.bind(q);
  q.update = (v) => {
    if (!migrated && v && v.email_status === 'blocked') {
      const refuse = { code: '23514', message: 'new row for relation "contacts" violates check constraint "contacts_email_status_check"' };
      const chain = { eq() { return chain; }, select() { return chain; }, single: async () => ({ data: null, error: refuse }), then: (res) => res({ data: null, error: refuse }) };
      return chain;
    }
    return upd(v);
  };
  return q;
} };
const events = [];
on(EVENTS.CONTACT_INVALIDATED, (env) => events.push(env.payload));
const app = express(); app.use(express.json());
const auth = (req, res, next) => { req.user = { id: 'u1', role: 'admin', roles: ['admin'], org_id: ORG }; req.orgId = ORG; next(); };
const ctx = { supabase: gated, db: createDb(gated), auth, hasRole: () => true, today: () => '2026-10-13', canTouchJob: async () => true, logActivity: async () => {},
  isPermanentFollowupBlock: rules.isPermanentFollowupBlock, ownership: require('../services/ownership'), reportingChainIds: async () => [], orgIdFor: () => ORG,
  loadSuppressedSet: async () => new Set(), withOrg: (q) => q.eq('org_id', ORG), orgStamp: () => ({ org_id: ORG }), userOrgId: () => ORG, mailboxOrgId: () => ORG };
app.use(require('../routes/contacts')(ctx));
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const call = async (method, p, body) => { const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, body: j }; };
const row = () => fake.tables.contacts.find(x => x.id === CT);

let r = await call('PATCH', '/contacts/' + CT + '/email-status', { email_status: 'blocked' });
step('before migration 064: choosing Blocked is answered in plain words (409), not a database error', r.status === 409 && r.body.code === 'status_needs_update' && /Blocked/.test(r.body.error) && !/check constraint/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
step('…and nothing was changed', row().email_status === 'valid');
r = await call('PUT', '/contacts/' + CT, { email_status: 'blocked' });
step('the contact edit form gets the same plain answer', r.status === 409 && r.body.code === 'status_needs_update');
migrated = true;
r = await call('PATCH', '/contacts/' + CT + '/email-status', { email_status: 'blocked' });
step('after migration 064: Blocked is saved', r.status === 200 && row().email_status === 'blocked', JSON.stringify(r.body).slice(0, 120));
await new Promise(res => setTimeout(res, 50));
step('…and it stops the follow-ups the same way Invalid does (the same event, reason "manual")', events.some(e => e.contactId === CT && e.reason === 'manual'));
r = await call('PATCH', '/contacts/' + CT + '/email-status', { email_status: 'made_up' });
step('a status nobody defined is still refused (400)', r.status === 400);
r = await call('PATCH', '/contacts/' + CT + '/email-status', { email_status: 'valid' });
step('and a person can set it back to Valid once it is sorted out', r.status === 200 && row().email_status === 'valid');
srv.close();

// ── 4. the browser menus ────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const web = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); }); });
const PORT = await new Promise(rs => web.listen(0, '127.0.0.1', () => rs(web.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || (base && fs.existsSync(path.join(base, 'chromium')) ? path.join(base, 'chromium') : 'chromium'), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxB.route('**', rt => rt.request().url().startsWith(BASE) ? rt.continue() : rt.abort());
  const page = await ctxB.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');
  const menu = await page.evaluate(() => {
    const html = window.leadContactRowHtml({ id: 'c1', first_name: 'Pat', last_name: 'Lee', designation: 'HR', email: 'pat@acme.test', email_status: 'blocked' });
    const d = document.createElement('div'); d.innerHTML = html;
    const sel = d.querySelector('select');
    return { list: window.CONTACT_STATUSES.slice(), opts: sel ? [...sel.options].map(o => o.value + ':' + o.textContent + (o.selected ? '*' : '')) : [] };
  });
  step('the browser\'s list of statuses is exactly the server\'s, in the same order', menu.list.join() === cs.STATUSES.join());
  step('the lead\'s contact menu offers all five with their names, Blocked among them and shown as chosen for a blocked contact', menu.opts.join('|') === 'valid:Valid|invalid:Invalid|deactivated:Deactivated|blocked:Blocked*|out_of_office:Out of office', menu.opts.join('|'));
  const labels = await page.evaluate(() => window.CONTACT_STATUSES.every((k) => window.CONTACT_STATUS_LABELS[k]));
  step('every status has a name on screen', labels);
} catch (e) { step('the browser part ran', false, e.message); }
finally { if (browser) await browser.close(); web.close(); }

const p = results.filter(Boolean).length;
console.log(`SUMMARY: ${p}/${results.length}`);
process.exit(p === results.length ? 0 : 1);
