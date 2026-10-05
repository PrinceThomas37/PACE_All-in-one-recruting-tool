// SEVERAL EMAILS AND PHONES PER CANDIDATE — THE REAL ROUTES (R-114, D-0070).
//
// routes/recruiting/candidates.js mounted for real over an in-memory PostgREST
// (test/helpers/fake-postgrest.mjs, projecting to each route's own select list).
//
//   part 1 — create: extras are cleaned and stored; a typed non-email is refused with a
//            sentence; more than ten is refused; the main is never repeated in the extras
//   part 2 — duplicates: the same name + ANY address/number of either person is caught
//            (their extra = my main, my extra = their main, a phone written differently);
//            another company's candidate is never matched; no shared address = no duplicate;
//            check-duplicate (the "open the existing one" panel) agrees with create
//   part 3 — edit: a form that sends only the main leaves the extras alone; making an extra
//            the main is ONE update that moves the old main into the extras; an address that
//            opted out can NEVER be made the main (409, nothing written) — the safety rule
//   part 4 — the résumé: every email and phone is returned, the main first
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
import { loadSchema } from './helpers/schema-from-migrations.mjs';
const require = createRequire(import.meta.url);
const express = require('express');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const schema = loadSchema();
const ORG = 'org-a', OTHER = 'org-b';
const JANE = uid(), THEIRS = uid(), BOB = uid();
const db = createFakeDb({
  schema, validate: schema.isComplete('candidates') ? ['candidates'] : [],
  tables: {
    candidates: [
      { id: JANE, org_id: ORG, candidate_code: 'CN-0001', full_name: 'Jane Doe', name_norm: 'jane doe', email: 'jane@old.com', phone: '', phone_norm: '',
        extra_emails: ['jane@new.com'], extra_phones: ['(555) 987-6543'], deleted_at: null },
      { id: BOB, org_id: ORG, candidate_code: 'CN-0002', full_name: 'Bob Roe', name_norm: 'bob roe', email: 'bob@x.com', phone: '(555) 222-3333', phone_norm: '5552223333',
        extra_emails: ['bob@opted-out.com', 'bob@second.com'], extra_phones: [], deleted_at: null },
      // the SAME name and number in another company — must never be matched from org-a
      { id: THEIRS, org_id: OTHER, candidate_code: 'CN-0003', full_name: 'Zed Other', name_norm: 'zed other', email: 'zed@o.com', phone: '', phone_norm: '',
        extra_emails: ['shared@both.com'], extra_phones: [], deleted_at: null },
    ],
    suppression_list: [{ email: 'bob@opted-out.com', reason: 'unsubscribe' }],
    users: [{ id: 'u1', name: 'Rita Recruiter', employee_id: 'E1' }],
  },
  relations: { candidates: { owner: { table: 'users', fk: 'owner_id' }, creator: { table: 'users', fk: 'created_by' } } },
  defaults: { candidates: (r) => ({ id: uid(), org_id: ORG, deleted_at: null, name_norm: String(r.full_name || '').toLowerCase().trim(), phone_norm: String(r.phone || '').replace(/\D/g, '').slice(-10), extra_emails: [], extra_phones: [] }) },
});

const loadSuppressedSet = async (emails) => {
  const { data } = await db.supabase.from('suppression_list').select('email').in('email', emails);
  return new Set((data || []).map(r => String(r.email).toLowerCase()));
};
const app = express();
app.use(express.json());
const auth = (req, res, next) => { req.user = { id: 'u1', role: 'recruiter', roles: ['recruiter'], org_id: ORG }; req.orgId = ORG; next(); };
let codeN = 100;
const core = {
  supabase: db.supabase, db: {}, auth, hasRole: () => true, today: () => '2026-10-05', loadSuppressedSet,
  orgIdFor: () => ORG, orgStamp: () => ({ org_id: ORG }), withOrg: (q) => q.eq('org_id', ORG),
  isBDM: () => false, isRecruiter: () => true, nextId: async () => 'CN-' + (++codeN),
};
require('../routes/recruiting/candidates')(app, new Proxy(core, { get: (t, k) => (k in t ? t[k] : (k === 'STAGES' ? [] : undefined)) }));
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};
const row = (id) => db.tables.candidates.find(c => c.id === id);

try {
  // ── part 1 — create ───────────────────────────────────────────────────────
  {
    const r = await call('POST', '/candidates', { full_name: 'Ann Lee', email: 'ann@x.com', phone: '(555) 444-5555',
      extra_emails: ['ANN2@x.com', 'ann@x.com', 'ann3@x.com'], extra_phones: ['555.444.5555', '(555) 666-7777'] });
    step('create with extras → 201', r.status === 201, JSON.stringify(r.body).slice(0, 160));
    step('the extras are cleaned: lower-cased, the main is not repeated, the same number written another way is one',
      r.body && JSON.stringify(r.body.extra_emails) === '["ann2@x.com","ann3@x.com"]' && JSON.stringify(r.body.extra_phones) === '["(555) 666-7777"]', JSON.stringify([r.body && r.body.extra_emails, r.body && r.body.extra_phones]));
    const stored = db.tables.candidates.find(c => c.full_name === 'Ann Lee');
    step('…and that is what was stored', stored && stored.email === 'ann@x.com' && stored.extra_emails.length === 2);

    const bad = await call('POST', '/candidates', { full_name: 'Cy Bad', email: 'cy@x.com', extra_emails: ['not an email'] });
    step('a typed non-email is refused with a sentence that names it (400)', bad.status === 400 && /not an email/.test(bad.body.error) && /email address/.test(bad.body.error), bad.body && bad.body.error);
    step('…and nothing was created', !db.tables.candidates.some(c => c.full_name === 'Cy Bad'));
    const badPhone = await call('POST', '/candidates', { full_name: 'Di Bad', extra_phones: ['12'] });
    step('a typed non-phone is refused too', badPhone.status === 400 && /phone number/.test(badPhone.body.error));
    const tooMany = await call('POST', '/candidates', { full_name: 'Ed Many', extra_emails: Array.from({ length: 12 }, (_, i) => `e${i}@x.com`) });
    step('more than ten extras is refused with the limit stated', tooMany.status === 400 && /at most 10/.test(tooMany.body.error), tooMany.body && tooMany.body.error);
    const plain = await call('POST', '/candidates', { full_name: 'Flo Plain', email: 'flo@x.com' });
    step('a candidate with no extras still works exactly as before', plain.status === 201 && Array.isArray(plain.body.extra_emails) && plain.body.extra_emails.length === 0);
  }

  // ── part 2 — duplicates ───────────────────────────────────────────────────
  {
    const a = await call('POST', '/candidates', { full_name: 'jane  DOE', email: 'jane@new.com' });
    step('DUPLICATE: my main is their EXTRA email → 409 possible_duplicate, naming Jane', a.status === 409 && a.body.error === 'possible_duplicate' && a.body.duplicates.some(d => d.id === JANE), a.status + ' ' + JSON.stringify(a.body).slice(0, 120));
    const b = await call('POST', '/candidates', { full_name: 'Jane Doe', email: 'someone@else.com', extra_emails: ['JANE@OLD.COM'] });
    step('DUPLICATE: my EXTRA is their main', b.status === 409 && b.body.duplicates.some(d => d.id === JANE));
    const c = await call('POST', '/candidates', { full_name: 'Jane Doe', phone: '+1 555-987-6543' });
    step('DUPLICATE: a phone written another way matches their extra number', c.status === 409);
    const d = await call('POST', '/candidates', { full_name: 'Jane Doe', email: 'unrelated@x.com', phone: '(555) 000-1111' });
    step('NOT a duplicate: same name, no shared address or number → created', d.status === 201, String(d.status));
    const e = await call('POST', '/candidates', { full_name: 'Someone Else', email: 'jane@new.com' });
    step('NOT a duplicate: same address, different name → created (the name must match too)', e.status === 201);
    const f = await call('POST', '/candidates', { full_name: 'Zed Other', email: 'shared@both.com' });
    step("another company's candidate is never matched (their name + their extra address)", f.status === 201, String(f.status));
    const g = await call('POST', '/candidates', { full_name: 'Jane Doe', email: 'jane@new.com', force: true });
    step('"Create anyway" (force) still creates', g.status === 201);

    const chk = await call('GET', '/candidates/check-duplicate?full_name=Jane%20Doe&email=nope%40x.com&extra_emails=' + encodeURIComponent('x@y.com,jane@new.com'));
    step('check-duplicate sees the form\'s EXTRA addresses (the "open the existing one" panel)', chk.status === 200 && chk.body.duplicate === true && chk.body.duplicates.some(d => d.id === JANE), JSON.stringify(chk.body).slice(0, 120));
    step('…and the match carries its own extras so the panel can show them', chk.body.duplicates[0] && Array.isArray(chk.body.duplicates[0].extra_emails));
    const chk2 = await call('GET', '/candidates/check-duplicate?full_name=Jane%20Doe&extra_phones=' + encodeURIComponent('(555) 987-6543;(555) 111-1111'));
    step('check-duplicate: phones separated by ";" are read', chk2.body.duplicate === true);
  }

  // ── part 3 — edit ─────────────────────────────────────────────────────────
  {
    const only = await call('PUT', '/candidates/' + JANE, { current_title: 'Engineer' });
    step('a save that mentions no email or phone leaves the extras exactly as they were', only.status === 200 && JSON.stringify(row(JANE).extra_emails) === '["jane@new.com"]' && JSON.stringify(row(JANE).extra_phones) === '["(555) 987-6543"]');

    const sw = await call('PUT', '/candidates/' + JANE, { email: 'jane@new.com', extra_emails: ['jane@old.com'] });
    step('make main (the form sends the swapped pair) → 200', sw.status === 200, JSON.stringify(sw.body).slice(0, 120));
    step('…the extra is now the main and the old main took its place, in ONE row', row(JANE).email === 'jane@new.com' && JSON.stringify(row(JANE).extra_emails) === '["jane@old.com"]');

    const justMain = await call('PUT', '/candidates/' + JANE, { email: 'jane@old.com' });
    step('a caller that only knows `email` can switch the main without wiping the extras; the new main leaves the extras', justMain.status === 200 && row(JANE).email === 'jane@old.com' && JSON.stringify(row(JANE).extra_emails) === '[]', JSON.stringify(row(JANE).extra_emails));
    await call('PUT', '/candidates/' + JANE, { email: 'jane@old.com', extra_emails: ['jane@new.com'] });

    // an API caller that only knows `email` and sets a brand-new main must NOT lose the extras
    const keepExtras = await call('PUT', '/candidates/' + JANE, { email: 'brand-new@x.com' });
    step('setting a brand-new main with ONLY `email` leaves every extra in place (an older page or API caller never wipes them)', keepExtras.status === 200 && row(JANE).email === 'brand-new@x.com' && JSON.stringify(row(JANE).extra_emails) === '["jane@new.com"]', JSON.stringify(row(JANE).extra_emails));
    await call('PUT', '/candidates/' + JANE, { email: 'jane@old.com', extra_emails: ['jane@new.com'] });

    // THE SAFETY RULE
    const optedOut = await call('PUT', '/candidates/' + BOB, { email: 'bob@opted-out.com', extra_emails: ['bob@x.com', 'bob@second.com'] });
    step('SAFETY: an address that opted out can NEVER be made the main (409, with the reason)', optedOut.status === 409 && optedOut.body.code === 'address_opted_out' && /opted out/.test(optedOut.body.error), optedOut.status + ' ' + JSON.stringify(optedOut.body));
    step('…and NOTHING was written (the main is still the old one)', row(BOB).email === 'bob@x.com' && row(BOB).extra_emails.includes('bob@opted-out.com'));
    const okSwitch = await call('PUT', '/candidates/' + BOB, { email: 'bob@second.com', extra_emails: ['bob@x.com', 'bob@opted-out.com'] });
    step('a different extra CAN be made the main — and the opted-out one stays listed as an extra, never main', okSwitch.status === 200 && row(BOB).email === 'bob@second.com' && row(BOB).extra_emails.includes('bob@opted-out.com'));
    const sameMain = await call('PUT', '/candidates/' + BOB, { email: 'bob@second.com', current_title: 'PM' });
    step('saving without changing the main is never blocked', sameMain.status === 200);
    // an opted-out address that is ALREADY the main (they opted out after it became main) must not trap the record
    row(BOB).email = 'bob@opted-out.com';
    const keep = await call('PUT', '/candidates/' + BOB, { email: 'bob@opted-out.com', current_title: 'Director' });
    step('editing a candidate whose current main is opted out is not blocked (only CHANGING to one is)', keep.status === 200);

    const badExtra = await call('PUT', '/candidates/' + JANE, { extra_phones: ['x'] });
    step('a typed non-phone on edit is refused with a sentence', badExtra.status === 400 && /phone number/.test(badExtra.body.error));
    const foreign = await call('PUT', '/candidates/' + THEIRS, { email: 'x@y.com', extra_emails: ['q@y.com'] });
    step("another company's candidate cannot be edited (404, nothing written)", foreign.status === 404 && row(THEIRS).email === 'zed@o.com');
  }

  // ── part 4 — the résumé reader ────────────────────────────────────────────
  {
    const { parseResume } = require('../resume-parser');
    const text = 'Priya Nair\nSenior Engineer\npriya@home.com | (555) 123-4567\nAlso reachable: priya.nair@work.io, mobile +1 555.987.6543\nDenver, CO\n8 years of experience building things, with enough words here to count as a real resume text body.';
    const out = await parseResume(Buffer.from(text), 'cv.txt', null, null);
    step('the résumé reader returns EVERY email and phone, the main first', out.contacts && JSON.stringify(out.contacts.emails) === '["priya@home.com","priya.nair@work.io"]' && out.contacts.phones.length === 2 && out.contacts.phones[0] === out.fields.phone, JSON.stringify(out.contacts));
    step('…and the main it fills the form with is the first of each', out.fields.email === 'priya@home.com');
    step('the résumé\'s extras are NOT written into the fields (the form offers them for a tick)', out.fields.extra_emails === undefined && out.fields.contacts === undefined);
  }
} catch (e) {
  step('suite ran to the end', false, String(e && e.stack || e).slice(0, 400));
}
srv.close();
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length} passed`);
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
