// The two emails an application produces (Session 28, round 3).
//
// One goes to a STRANGER, under the customer's name, with nobody reviewing it
// first — the same exposure as the apply page itself. So the exact words are
// pinned here rather than trusted.
//
// The rules being enforced, all of which are easy to break by "improving" the
// copy later:
//   * the END CLIENT'S NAME IS NEVER IN THE APPLICANT'S EMAIL;
//   * NOTHING IS PROMISED that PACE cannot keep (no "within 48 hours");
//   * the recruiter's alert MAY name the client — it is internal.
//
// Usage: node test/applicant-notify-smoke.mjs

import { applicantReceipt, recruiterAlert, firstName } from '../services/applicant-notify.js';

const results = [];
const step = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const eq = (n, got, want) => step(n, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── how a person is addressed ─────────────────────────────────────────────
// A CV shouts its name; an email should not shout back.
eq('an all-caps CV name is addressed normally', firstName('JOHN W. RAYA'), 'John');
eq('a normal name is left alone', firstName('Dana Wills'), 'Dana');
eq('a single name works', firstName('Prince'), 'Prince');
eq('no name yields nothing, never "undefined"', firstName(''), '');
eq('a null name yields nothing', firstName(null), '');

// ── the applicant's receipt ───────────────────────────────────────────────
const CLIENT = 'Northwind Construction';
const r = applicantReceipt({ applicantName: 'JOHN W. RAYA', jobTitle: 'Industrial Electrician', company: 'Fute Global' });

step('the subject names the role', r.subject.includes('Industrial Electrician'));
step('it greets them by first name', r.text.startsWith('Hi John,'));
step('it confirms the CV arrived', /CV have arrived/i.test(r.text));
step('it signs off as the CUSTOMER', r.text.includes('Fute Global'));
step('it offers a reply path', /reply to this email/i.test(r.text));

// THE RULE THAT MATTERS MOST. The end client's name is the asset a staffing
// desk is paid for, and this email goes to the open internet.
const withClient = applicantReceipt({
  applicantName: 'John', jobTitle: 'Industrial Electrician', company: 'Fute Global',
  client: CLIENT, end_client: CLIENT,          // passed and must be ignored
});
step('the end client is NEVER in the applicant\'s email',
  !withClient.text.includes('Northwind') && !withClient.html.includes('Northwind'));

// NOTHING IS PROMISED. PACE cannot keep a timeframe, so it must not state one.
step('no timeframe is promised', !/\b(24|48|72)\s*hours?\b|\bwithin \d+ (day|week)/i.test(r.text),
  r.text.match(/within[^.]*/i)?.[0] || '');
step('no tracking pixel on a receipt', !/<img/i.test(r.html));

// It must survive a job order with no title rather than saying "the  role".
const noTitle = applicantReceipt({ applicantName: 'John', jobTitle: '', company: 'Fute Global' });
step('a missing job title degrades cleanly', !noTitle.text.includes('the  role') && noTitle.subject.length > 0,
  noTitle.subject);
// And with no org name it still signs off as something.
const noOrg = applicantReceipt({ applicantName: 'John', jobTitle: 'Electrician', company: '' });
step('a missing company still signs off', /—\s*\S/.test(noOrg.text));

// ── the recruiter's alert ─────────────────────────────────────────────────
const a = recruiterAlert({
  applicantName: 'JOHN W. RAYA', jobTitle: 'Industrial Electrician', jobCode: 'JO-1042',
  client: CLIENT, email: 'john@mail.com', phone: '860-555-0142', location: 'Hartford, CT',
});
step('the subject names who and what', a.subject.includes('JOHN W. RAYA') && a.subject.includes('Industrial Electrician'));
step('it carries the job code', a.subject.includes('JO-1042'));
// THIS one is internal, so the client IS allowed — and is useful.
step('the recruiter alert MAY name the client', a.text.includes(CLIENT) && a.html.includes(CLIENT));
step('it carries contact details', a.text.includes('john@mail.com') && a.text.includes('860-555-0142'));
step('it says where to go next', /Applicants/.test(a.text));

// Missing facts are omitted, not printed as empty rows.
const sparse = recruiterAlert({ applicantName: 'Dana', jobTitle: 'Estimator' });
step('absent facts are omitted, not blank', !/Phone:\s*$/m.test(sparse.text) && !/Client:\s*$/m.test(sparse.text));
step('a nameless applicant still produces a subject', recruiterAlert({}).subject.length > 0);

// Both messages must be safe to put in an html email.
const nasty = applicantReceipt({ applicantName: '<script>x</script>', jobTitle: 'Dev', company: 'Acme' });
step('html is escaped in the receipt', !nasty.html.includes('<script>'));
const nastyA = recruiterAlert({ applicantName: '<img onerror=1>', jobTitle: 'Dev' });
step('html is escaped in the alert', !nastyA.html.includes('<img onerror'));

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
