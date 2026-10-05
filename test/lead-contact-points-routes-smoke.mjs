// SEVERAL EMAILS AND PHONES PER LEAD CONTACT, AND PHONES AT IMPORT — THE REAL ROUTES (R-114 stage 2, R-014, D-0070).
//
// routes/contacts.js and routes/jobs.js mounted for real over an in-memory PostgREST, with the real
// models layer (db.forRequest) so company scoping is the real thing. DNS is stubbed (a domain
// ending .dead is "invalid", everything else "valid") so the suite does not need a network.
//
//   part 1 — POST /contacts: extras are cleaned and stored; a typed phone that is not a phone, or an extra
//            that is not an address, is refused with a sentence (400) and nothing is created
//   part 2 — "already added": the SAME person is caught when ANY of their addresses is ANY address of somebody
//            already in PACE (their extra = my main, my extra = their main), anywhere in the org
//   part 3 — PUT /contacts/:id: extras the form did not send are left alone; make-main is one update; an address
//            that opted out can NEVER be made the main (409, nothing written); switching an "invalid" contact to a
//            good address brings them back (the mark belonged to the OLD address) but out-of-office stays; a phone
//            that is not a phone is refused; another company's contact is a 404
//   part 4 — the lead import (POST /jobs/bulk): an address sitting in the PHONE column becomes the email (the
//            sheet was shifted), several numbers in one cell become main + extras, "N/A" is not stored as a phone,
//            and the response SAYS what was tidied
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);

// DNS is stubbed BEFORE the routes load (they destructure the functions at require time).
const ev = require('../email-validation');
ev.classifyEmailDeliverability = async (e) => (/\.dead$/.test(String(e)) || !ev.emailSyntaxValid(e) ? 'invalid' : 'valid');
ev.annotateContactEmailStatus = async (rows) => { for (const r of rows) if (r.email) r.email_status = await ev.classifyEmailDeliverability(r.email); return rows; };

const express = require('express');
const { createDb } = require('../models');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', OTHER = 'org-b';
const J1 = uid(), J2 = uid(), JX = uid(), C1 = uid(), C2 = uid();
const CT_DANA = uid(), CT_EVE = uid(), CT_BOB = uid(), CT_OOO = uid(), CT_FOREIGN = uid();
const fake = createFakeDb({
  tables: {
    companies: [{ id: C1, org_id: ORG, name: 'Acme' }, { id: C2, org_id: ORG, name: 'Globex' }],
    jobs: [
      { id: J1, org_id: ORG, company_id: C1, position: 'Dev', stage: 'Assigned', created_by: 'u1', assigned_to: 'u1', assigned_to_bd: 'u1', deleted_at: null },
      { id: J2, org_id: ORG, company_id: C2, position: 'PM', stage: 'Assigned', created_by: 'u1', assigned_to: 'u1', assigned_to_bd: 'u1', deleted_at: null },
      { id: JX, org_id: OTHER, company_id: 'cx', position: 'Other', stage: 'Assigned', deleted_at: null },
    ],
    contacts: [
      { id: CT_DANA, org_id: ORG, job_id: J2, first_name: 'Dana', last_name: 'Existing', designation: 'HR', email: 'dana@old.com', phone: '', extra_emails: ['dana@new.com'], extra_phones: [], email_status: 'valid' },
      { id: CT_EVE, org_id: ORG, job_id: J1, first_name: 'Eve', last_name: 'Bounced', designation: 'TA', email: 'eve@bounced.dead', phone: '', extra_emails: ['eve@good.com'], extra_phones: [], email_status: 'invalid' },
      { id: CT_BOB, org_id: ORG, job_id: J1, first_name: 'Bob', last_name: 'Away', designation: 'GM', email: 'bob@x.com', phone: '(555) 222-3333', extra_emails: ['bob2@x.com'], extra_phones: ['(555) 444-5555'], email_status: 'out_of_office' },
      { id: CT_OOO, org_id: ORG, job_id: J1, first_name: 'Opt', last_name: 'Out', designation: 'VP', email: 'opt@x.com', phone: '', extra_emails: ['stopped@x.com'], extra_phones: [], email_status: 'valid' },
      { id: CT_FOREIGN, org_id: OTHER, job_id: JX, first_name: 'Far', last_name: 'Away', designation: 'X', email: 'far@o.com', phone: '', extra_emails: [], extra_phones: [], email_status: 'valid' },
    ],
    suppression_list: [{ email: 'stopped@x.com', reason: 'unsubscribe' }],
    app_settings: [], reminders: [], activity_log: [],
  },
  defaults: { contacts: () => ({ id: uid(), org_id: ORG, extra_emails: [], extra_phones: [], email_status: 'valid' }), jobs: () => ({ id: uid(), org_id: ORG, deleted_at: null }) },
});
const supabase = fake.supabase;
const db = createDb(supabase);
const loadSuppressedSet = async (emails) => {
  const { data } = await supabase.from('suppression_list').select('email').in('email', emails);
  return new Set((data || []).map(r => String(r.email).toLowerCase()));
};
const app = express();
app.use(express.json());
const auth = (req, res, next) => { req.user = { id: 'u1', role: 'admin', roles: ['admin'], org_id: ORG }; req.orgId = ORG; next(); };
const ctx = {
  supabase, db, auth, hasRole: () => true, today: () => '2026-10-05', canTouchJob: async () => true, logActivity: async () => {},
  isPermanentFollowupBlock: (s) => s === 'invalid' || s === 'deactivated', ownership: require('../services/ownership'),
  reportingChainIds: async () => [], orgIdFor: () => ORG, loadSuppressedSet,
  withOrg: (q) => q.eq('org_id', ORG), orgStamp: () => ({ org_id: ORG }), userOrgId: () => ORG, mailboxOrgId: () => ORG,
  loadAllJobs: async () => [], JOB_SELECT: '*', getTimezoneFromLocation: () => null, persistLearnedSkills: () => {},
};
app.use(require('../routes/contacts')(ctx));
app.use(require('../routes/jobs')(ctx));
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};
const row = (id) => fake.tables.contacts.find(c => c.id === id);
const J = (v) => JSON.stringify(v);

try {
  // ── part 1 — POST /contacts ───────────────────────────────────────────────
  {
    const r = await call('POST', '/contacts', { job_id: J1, first_name: 'Zed', last_name: 'Newman', email: 'zed@x.com', phone: '(555) 111-2222',
      extra_emails: ['ZED2@x.com', 'zed@x.com'], extra_phones: ['555.333.4444', '(555) 111-2222'] });
    step('a contact with extras → 201', r.status === 201, r.status + ' ' + J(r.body).slice(0, 150));
    step('extras are cleaned: lower-cased, the main is not repeated', r.body && J(r.body.extra_emails) === '["zed2@x.com"]' && J(r.body.extra_phones) === '["555.333.4444"]', J([r.body && r.body.extra_emails, r.body && r.body.extra_phones]));

    const badPhone = await call('POST', '/contacts', { job_id: J1, first_name: 'Pat', last_name: 'Phone', email: 'pat@x.com', phone: 'N/A' });
    step('a typed phone that is not a phone is refused with a sentence (400)', badPhone.status === 400 && /does not look like a phone number/.test(badPhone.body.error), J(badPhone.body));
    const emailAsPhone = await call('POST', '/contacts', { job_id: J1, first_name: 'Eli', last_name: 'Mail', email: 'eli@x.com', phone: 'eli.other@x.com' });
    step('an email address typed into Phone is refused too', emailAsPhone.status === 400);
    const badExtra = await call('POST', '/contacts', { job_id: J1, first_name: 'Ex', last_name: 'Tra', email: 'ex@x.com', extra_emails: ['not an email'] });
    step('an extra that is not an address is refused, naming it', badExtra.status === 400 && /not an email/.test(badExtra.body.error) && /email address/.test(badExtra.body.error), J(badExtra.body));
    step('…and none of those created anybody', !fake.tables.contacts.some(c => ['Pat', 'Eli', 'Ex'].includes(c.first_name)));
  }

  // ── part 2 — already added, on ANY address ────────────────────────────────
  {
    const a = await call('POST', '/contacts', { job_id: J1, first_name: 'Different', last_name: 'Name', email: 'dana@new.com' });
    step('ALREADY ADDED: my main is somebody\'s EXTRA address → refused (409), naming the address', a.status === 409 && a.body.duplicate && a.body.duplicate.title === 'Already added' && /dana@new\.com/.test(a.body.error), a.status + ' ' + J(a.body).slice(0, 200));
    const b = await call('POST', '/contacts', { job_id: J1, first_name: 'Another', last_name: 'Person', email: 'someone@else.com', extra_emails: ['DANA@old.com'] });
    step('ALREADY ADDED: my EXTRA is somebody\'s main → refused', b.status === 409 && b.body.duplicate.match === 'email' && b.body.duplicate.can_add_anyway === false, a.status + ' ' + J(b.body).slice(0, 160));
    const c = await call('POST', '/contacts', { job_id: J1, first_name: 'Third', last_name: 'Party', email: 'third@x.com', extra_emails: ['unrelated@y.com'] });
    step('no shared address → created', c.status === 201, c.status + ' ' + J(c.body).slice(0, 100));
    const d = await call('POST', '/contacts', { job_id: J1, first_name: 'Foreign', last_name: 'Lookup', email: 'far@o.com' });
    step("another company's contact is never matched (their address is not ours to collide with)", d.status === 201, String(d.status));
  }

  // ── part 3 — PUT /contacts/:id ────────────────────────────────────────────
  {
    const only = await call('PUT', '/contacts/' + CT_DANA, { designation: 'Head of HR' });
    step('a save that mentions no email or phone leaves the extras exactly as they were', only.status === 200 && J(row(CT_DANA).extra_emails) === '["dana@new.com"]');

    const sw = await call('PUT', '/contacts/' + CT_DANA, { email: 'dana@new.com', extra_emails: ['dana@old.com'] });
    step('make main: the extra becomes the main and the old main takes its place, in ONE row', sw.status === 200 && row(CT_DANA).email === 'dana@new.com' && J(row(CT_DANA).extra_emails) === '["dana@old.com"]', J([row(CT_DANA).email, row(CT_DANA).extra_emails]));
    const keep = await call('PUT', '/contacts/' + CT_BOB, { email: 'bob-brand-new@x.com' });
    step('a caller that only sends `email` never wipes the extras', keep.status === 200 && J(row(CT_BOB).extra_emails) === '["bob2@x.com"]', J(row(CT_BOB).extra_emails));
    await call('PUT', '/contacts/' + CT_BOB, { email: 'bob@x.com' });

    const optedOut = await call('PUT', '/contacts/' + CT_OOO, { email: 'stopped@x.com', extra_emails: ['opt@x.com'] });
    step('SAFETY: an address that opted out can NEVER be made the main (409)', optedOut.status === 409 && optedOut.body.code === 'address_opted_out', optedOut.status + ' ' + J(optedOut.body));
    step('…and NOTHING was written', row(CT_OOO).email === 'opt@x.com' && J(row(CT_OOO).extra_emails) === '["stopped@x.com"]');

    const revive = await call('PUT', '/contacts/' + CT_EVE, { email: 'eve@good.com', extra_emails: ['eve@bounced.dead'] });
    step('an "invalid" contact switched to a good address is judged on the NEW address → valid again (follow-ups resume)', revive.status === 200 && row(CT_EVE).email_status === 'valid', row(CT_EVE).email_status);
    const away = await call('PUT', '/contacts/' + CT_BOB, { email: 'bob2@x.com', extra_emails: ['bob@x.com'] });
    step('"out of office" belongs to the PERSON and survives a switch of address', away.status === 200 && row(CT_BOB).email_status === 'out_of_office', row(CT_BOB).email_status);
    const explicit = await call('PUT', '/contacts/' + CT_EVE, { email: 'eve@bounced.dead', email_status: 'deactivated' });
    step('an explicit status in the same request is respected', explicit.status === 200 && row(CT_EVE).email_status === 'deactivated');

    const badPhone = await call('PUT', '/contacts/' + CT_BOB, { phone: 'someone@x.com' });
    step('a phone that is not a phone is refused on edit too', badPhone.status === 400 && row(CT_BOB).phone === '(555) 222-3333');
    const goodPhone = await call('PUT', '/contacts/' + CT_BOB, { phone: '(555) 777-8888', extra_phones: ['(555) 222-3333'] });
    step('make a number the main: one update, the old main is kept as an extra', goodPhone.status === 200 && row(CT_BOB).phone === '(555) 777-8888' && J(row(CT_BOB).extra_phones) === '["(555) 222-3333"]');
    const foreign = await call('PUT', '/contacts/' + CT_FOREIGN, { email: 'x@y.com' });
    step("another company's contact cannot be edited (404, nothing written)", foreign.status === 404 && row(CT_FOREIGN).email === 'far@o.com');
  }

  // ── part 4 — the lead import ──────────────────────────────────────────────
  {
    const r = await call('POST', '/jobs/bulk', { jobs: [{ company_id: C1, position: 'Import Test', location: 'Austin, TX', contacts: [
      { first_name: 'Shifted', last_name: 'Sheet', designation: '', email: 'Senior Recruiter', phone: 'shifted.sheet@acme.com' },
      { first_name: 'Many', last_name: 'Numbers', designation: 'VP', email: 'many@acme.com', phone: '(555) 111-2222 / 555.333.4444' },
      { first_name: 'No', last_name: 'Number', designation: 'TA', email: 'nonumber@acme.com', phone: 'N/A' },
      { first_name: 'Second', last_name: 'Address', designation: 'HR', email: 'second@acme.com', phone: 'second.other@acme.com', extra_phones: ['(555) 222-3333'] },
      { first_name: '', last_name: 'Kristin', designation: 'Abrams', email: 'Director of Operations', phone: 'kristin.abrams@acme.com' },
      { first_name: 'Plain', last_name: 'Good', designation: 'CEO', email: 'plain@acme.com', phone: '+1 (555) 999-0000', extra_emails: ['plain2@acme.com'] },
    ] }] });
    step('the import answers 201', r.status === 201, r.status + ' ' + J(r.body).slice(0, 220));
    const by = (first) => fake.tables.contacts.find(c => c.first_name === first);
    const shifted = by('Shifted');
    step('SHIFTED SHEET: the address in the Phone column becomes the email; the text that sat in Email becomes the title', shifted && shifted.email === 'shifted.sheet@acme.com' && !shifted.phone && shifted.designation === 'Senior Recruiter' && shifted.email_status === 'valid', J(shifted));
    const many = by('Many');
    step('SEVERAL NUMBERS in one cell: the first is the main, the rest are extras', many && many.phone === '(555) 111-2222' && J(many.extra_phones) === '["555.333.4444"]', J(many && [many.phone, many.extra_phones]));
    const none = by('No');
    step('"N/A" is not stored as a phone number', none && !none.phone, J(none && none.phone));
    const second = by('Second');
    step('a SECOND address in the Phone column is kept as an extra email, the real email untouched; extra numbers carried', second && second.email === 'second@acme.com' && J(second.extra_emails) === '["second.other@acme.com"]' && J(second.extra_phones) === '["(555) 222-3333"]', J(second));
    const plain = by('Plain');
    step('a clean row is stored exactly as it was (phone kept, extra email kept)', plain && plain.email === 'plain@acme.com' && plain.phone === '+1 (555) 999-0000' && J(plain.extra_emails) === '["plain2@acme.com"]');
    const whole = fake.tables.contacts.find(c => c.email === 'kristin.abrams@acme.com');
    step('A WHOLE ROW ONE COLUMN OFF (the 80 live ones) is stored in order: name, title and email each back in its own field', whole && whole.first_name === 'Kristin' && whole.last_name === 'Abrams' && whole.designation === 'Director of Operations' && !whole.phone && whole.email_status === 'valid', J(whole));
    step('the response COUNTS what was tidied', r.body && r.body.contactFixes && r.body.contactFixes.email_from_phone === 1 && r.body.contactFixes.row_shifted === 1 && r.body.contactFixes.phones_split === 1 && r.body.contactFixes.phone_not_a_phone === 1 && r.body.contactFixes.extra_email_from_phone === 1, J(r.body && r.body.contactFixes));
    step('…and SAYS it in a sentence (nothing is repaired silently)', r.body && /had the email address in the Phone column/.test(r.body.contactFixesNote) && /several numbers in one cell/.test(r.body.contactFixesNote), r.body && r.body.contactFixesNote);
    step('the shifted contact is NOT counted as "no valid email" any more', r.body && r.body.invalidEmails === 0, J(r.body && r.body.invalidEmails));
  }
} catch (e) {
  step('suite ran to the end', false, String(e && e.stack || e).slice(0, 500));
}
srv.close();
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length} passed`);
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
