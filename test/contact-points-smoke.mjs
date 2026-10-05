// SEVERAL EMAILS AND PHONES PER PERSON — THE RULES (R-114, D-0070), services/contact-points.js.
//
// The owner (2026-10-05): one MAIN email/phone you can switch with a tick or a click, plus
// extras; every email goes to the MAIN only; a candidate is a duplicate when the name matches
// and ANY address/number matches ANY of the other person's; a résumé's extras are offered,
// never added silently; and an address that opted out can never be made the main.
//
// Pure rules, called directly. The routes (candidate-contact-points-routes-smoke) and the
// screens (contact-points-ui-smoke) are tested separately.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cp = require('../services/contact-points.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── cleaning ────────────────────────────────────────────────────────────────
{
  const r = cp.cleanEmailList(['  B@X.com ', 'c@x.com', 'a@x.com', 'b@x.com', '', null], 'A@x.com');
  step('extra emails: trimmed, lower-cased, no repeats, never the main', same(r.list, ['b@x.com', 'c@x.com']), JSON.stringify(r.list));
  const bad = cp.cleanEmailList(['not an email', 'ok@x.com'], 'm@x.com');
  step('a typed non-email is REJECTED out loud, not dropped', same(bad.list, ['ok@x.com']) && bad.rejected.length === 1 && bad.rejected[0].reason === 'not_an_email' && bad.rejected[0].value === 'not an email');
  step('a comma/semicolon string from a form is split', same(cp.cleanEmailList('a@x.com, b@x.com;c@x.com', 'm@x.com').list, ['a@x.com', 'b@x.com', 'c@x.com']));
  const many = cp.cleanEmailList(Array.from({ length: 14 }, (_, i) => `p${i}@x.com`), 'm@x.com');
  step('more than ten extras: the first ten are kept, the rest are SAID to be too many', many.list.length === cp.MAX_EXTRAS && many.rejected.length === 4 && many.rejected.every(x => x.reason === 'too_many'));

  const ph = cp.cleanPhoneList(['(555) 123-4567', '+1 555.123.4567', '555 987 6543', '12'], '555-123-4567');
  step('phones: the same number written three ways is ONE, and the main is not repeated', same(ph.list, ['555 987 6543']), JSON.stringify(ph.list));
  step('a phone with too few digits is rejected', ph.rejected.length === 1 && ph.rejected[0].reason === 'not_a_phone');
  step('phones keep the way the person wrote them', same(cp.cleanPhoneList(['(555) 987-6543'], '').list, ['(555) 987-6543']));
}

// ── reading + the duplicate rule ────────────────────────────────────────────
{
  const row = { email: 'Main@x.com', extra_emails: ['b@x.com', 'MAIN@x.com'], phone: '(555) 123-4567', extra_phones: ['555-987-6543'] };
  step('allEmails: main first, no repeat of the main hiding in the extras', same(cp.allEmails(row), ['Main@x.com', 'b@x.com']));
  step('allPhones: main first', same(cp.allPhones(row), ['(555) 123-4567', '555-987-6543']));
  step('allEmails survives a row with nothing', same(cp.allEmails({}), []) && same(cp.allEmails(null), []) && same(cp.allEmails({ email: null, extra_emails: 'x' }), []));

  const a = { email: 'jane@old.com', phone: '', extra_emails: ['jane@new.com'], extra_phones: [] };
  step('DUPLICATE: my extra email is their main → they are the same person', cp.sharesContactPoint({ email: 'jane@new.com' }, a));
  step('DUPLICATE: my main is their extra (any case)', cp.sharesContactPoint({ email: 'JANE@NEW.COM' }, a));
  step('DUPLICATE: a phone written differently still matches', cp.sharesContactPoint({ phone: '+1 (555) 987-6543' }, { phone: '', extra_phones: ['555.987.6543'] }));
  step('NOT a duplicate: nothing in common', !cp.sharesContactPoint({ email: 'x@y.com', phone: '5550000000' }, a));
  step('NOT a duplicate: two blanks do not match each other', !cp.sharesContactPoint({ email: '', phone: '' }, { email: '', phone: '' }));
}

// ── making an extra the main ────────────────────────────────────────────────
{
  const row = { email: 'a@x.com', extra_emails: ['b@x.com', 'c@x.com'] };
  const m = cp.makeMain(row, 'email', 'C@X.COM');
  step('make main: the chosen one moves up and the old main takes its place', same(m, { email: 'c@x.com', extra_emails: ['b@x.com', 'a@x.com'] }), JSON.stringify(m));
  step('make main: a value that is not an extra changes nothing (null)', cp.makeMain(row, 'email', 'zzz@x.com') === null && cp.makeMain(row, 'email', 'a@x.com') === null);
  const none = cp.makeMain({ email: '', extra_emails: ['b@x.com'] }, 'email', 'b@x.com');
  step('make main when there is NO main yet: the extra moves up, nothing is left behind', same(none, { email: 'b@x.com', extra_emails: [] }));
  const p = cp.makeMain({ phone: '(555) 111-2222', extra_phones: ['555.333.4444'] }, 'phone', '(555) 333-4444');
  step('make main works for phones (matched by digits, written the way it was typed)', same(p, { phone: '555.333.4444', extra_phones: ['(555) 111-2222'] }), JSON.stringify(p));
}

// ── the opt-out safety rule ─────────────────────────────────────────────────
{
  const row = { email: 'a@x.com', extra_emails: ['b@x.com'] };
  step('opt-out: an extra that opted out is found', cp.firstSuppressed(row, new Set(['b@x.com'])) === 'b@x.com');
  step('opt-out: the main that opted out is found', cp.firstSuppressed(row, new Set(['a@x.com'])) === 'a@x.com');
  step('opt-out: case does not hide it', cp.firstSuppressed({ email: 'A@X.com' }, new Set(['a@x.com'])) === 'a@x.com');
  step('opt-out: nobody suppressed → empty', cp.firstSuppressed(row, new Set(['z@x.com'])) === '' && cp.firstSuppressed(row, new Set()) === '' && cp.firstSuppressed(row, null) === '');
}

// the leads engine's question: the address on the email, or ANY other address of the same person
{
  const sup = new Set(['stopped@x.com']);
  const ct = { email: 'a@x.com', extra_emails: ['stopped@x.com'] };
  step('send-time: a contact whose EXTRA address opted out is suppressed even though the email is going to the main', cp.suppressedFor(ct, 'a@x.com', sup) === 'stopped@x.com');
  step('send-time: the address on the email itself opting out is caught with no contact record at all', cp.suppressedFor(null, 'Stopped@X.com', sup) === 'stopped@x.com');
  step('send-time: nobody opted out → empty', cp.suppressedFor(ct, 'a@x.com', new Set(['z@x.com'])) === '' && cp.suppressedFor(ct, 'a@x.com', new Set()) === '');
}

// ── phones and the lead import (R-014) ──────────────────────────────────────
{
  const ok = ['(555) 123-4567', '+1 555.123.4567', '555 123 4567', '+91 98765 43210', '555-123-4567 ext 22', '555-123-4567 x22'];
  const no = ['', 'N/A', 'jane@x.com', '12345', 'call me', '555-1234 5678 9999 1111', null, undefined];
  step('looksLikePhone: real numbers in every common shape (country code, dots, extension)', ok.every(cp.looksLikePhone), ok.filter(x => !cp.looksLikePhone(x)).join(' | '));
  step('looksLikePhone: an address, a word, too few digits, nothing — NOT a phone', no.every(x => !cp.looksLikePhone(x)), no.filter(cp.looksLikePhone).join(' | '));
  step('splitPhones: several numbers in one cell, junk dropped', same(cp.splitPhones('(555) 123-4567 / 555.987.6543; N/A | call me'), ['(555) 123-4567', '555.987.6543']));
  const shifted = cp.tidyImportedContact({ first_name: 'A', email: 'Senior Recruiter', phone: 'a.b@acme.com', designation: '' });
  step('tidy: Email is not an address but Phone holds one → it is the email; the text becomes the title', shifted.contact.email === 'a.b@acme.com' && shifted.contact.phone === '' && shifted.contact.designation === 'Senior Recruiter' && same(shifted.fixes, ['email_from_phone']), JSON.stringify(shifted));
  const keepTitle = cp.tidyImportedContact({ email: 'Senior Recruiter', phone: 'a.b@acme.com', designation: 'VP' });
  step('tidy: an existing title is never overwritten', keepTitle.contact.designation === 'VP');
  const second = cp.tidyImportedContact({ email: 'a@x.com', phone: 'b@y.com' });
  step('tidy: a valid email AND an address in Phone → the second is an extra, the main is untouched', second.contact.email === 'a@x.com' && same(second.contact.extra_emails, ['b@y.com']) && same(second.fixes, ['extra_email_from_phone']));
  const many = cp.tidyImportedContact({ email: 'a@x.com', phone: '(555) 123-4567 / 555.987.6543', extra_phones: ['(555) 222-3333'] });
  step('tidy: several numbers → first is the main, the rest and any sent extras are extras (no repeats)', many.contact.phone === '(555) 123-4567' && same(many.contact.extra_phones, ['555.987.6543', '(555) 222-3333']) && same(many.fixes, ['phones_split']), JSON.stringify(many.contact));
  const na = cp.tidyImportedContact({ email: 'a@x.com', phone: 'N/A' });
  step('tidy: "N/A" is not a phone → left empty, and counted', na.contact.phone === '' && same(na.fixes, ['phone_not_a_phone']));
  const clean = cp.tidyImportedContact({ email: 'a@x.com', phone: '+1 (555) 123-4567', extra_emails: ['b@x.com'] });
  step('tidy: a clean contact changes nothing and reports nothing', clean.contact.phone === '+1 (555) 123-4567' && same(clean.contact.extra_emails, ['b@x.com']) && clean.fixes.length === 0);
  step('describeImportFixes: plain sentences, empty when nothing was fixed', cp.describeImportFixes({}) === '' && /2 contacts had the email address in the Phone column/.test(cp.describeImportFixes({ email_from_phone: 2 })) && /1 had several numbers/.test(cp.describeImportFixes({ phones_split: 1 })));
}

// ── a résumé ────────────────────────────────────────────────────────────────
{
  const text = 'JANE DOE\njane@home.com | (555) 123-4567\nAlso: Jane.Doe@work.io, cell +1 555.987.6543, jane@home.com.\nFax 555-000-1';
  const f = cp.extractContactPoints(text);
  step('résumé: EVERY email, in order, no repeats, a trailing full stop is not part of it', same(f.emails, ['jane@home.com', 'jane.doe@work.io']), JSON.stringify(f.emails));
  step('résumé: EVERY phone, in order, no repeats; a fax fragment is not a phone', same(f.phones, ['(555) 123-4567', '+1 555.987.6543']), JSON.stringify(f.phones));
  step('résumé: no contact details → two empty lists', same(cp.extractContactPoints('no details here, just words'), { emails: [], phones: [] }) && same(cp.extractContactPoints(null), { emails: [], phones: [] }));
}

// ── what a write stores ─────────────────────────────────────────────────────
{
  const prior = { email: 'a@x.com', extra_emails: ['b@x.com', 'c@x.com'], phone: '555-111-2222', extra_phones: ['555-333-4444'] };
  const onlyEmail = cp.normaliseForWrite({ email: 'z@x.com' }, prior);
  step('a form that sends only the MAIN leaves the extras alone (never wipes them)', same(onlyEmail.columns, { extra_emails: ['b@x.com', 'c@x.com'] }) && onlyEmail.columns.extra_phones === undefined, JSON.stringify(onlyEmail.columns));
  const promoted = cp.normaliseForWrite({ email: 'b@x.com' }, prior);
  step('a new main that was already an extra is no longer listed as an extra', same(promoted.columns.extra_emails, ['c@x.com']));
  const nothing = cp.normaliseForWrite({ current_title: 'x' }, prior);
  step('a write that mentions neither touches neither', same(nothing.columns, {}));
  const create = cp.normaliseForWrite({ email: 'm@x.com', extra_emails: ['m@x.com', 'q@x.com', 'bad'], phone: '', extra_phones: ['555-222-3333'] }, {});
  step('a create: the main is dropped from the extras, bad ones are reported with their kind', same(create.columns.extra_emails, ['q@x.com']) && create.rejected.length === 1 && create.rejected[0].kind === 'email' && same(create.columns.extra_phones, ['555-222-3333']));
}

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length} passed`);
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
