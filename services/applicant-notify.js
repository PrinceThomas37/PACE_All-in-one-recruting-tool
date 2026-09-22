// WHAT WE SAY WHEN SOMEBODY APPLIES (Session 28, round 3).
//
// Two messages leave the apply page, and they are NOT the same message pointed
// at two people:
//
//   * to the APPLICANT — "we have it". A careers page that swallows a CV in
//     silence is the single most common complaint candidates have about
//     applying anywhere. This is the difference between a form and a front
//     door, and it costs nothing.
//   * to the RECRUITER — "somebody applied". Otherwise the only way to learn
//     is to go and look, and nobody goes and looks.
//
// Both builders are PURE — no database, no clock beyond what is passed, no
// send. That is what makes the exact bytes testable, which matters here more
// than usual: this text goes to a stranger under the CUSTOMER's name, with
// nobody reviewing it first.
//
// RULES THAT HOLD:
//   * THE CLIENT'S NAME IS NEVER IN THE APPLICANT'S EMAIL. Same rule as the
//     apply page itself — it is the asset a staffing desk is paid for. The
//     applicant is told the ROLE they applied for, never who it is for.
//   * NOTHING IS PROMISED. No "we will be in touch within 48 hours", because
//     nothing in PACE can keep that promise. It says what is true: it arrived,
//     and somebody will look.
//   * NO TRACKING PIXEL. This is a receipt, not outreach. Measuring whether a
//     candidate opened their own confirmation is not a thing to do.

'use strict';

function txt(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function esc(s) {
  return txt(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function firstName(full) {
  const n = txt(full).replace(/\s+/g, ' ');
  if (!n) return '';
  // "JOHN W. RAYA" is how a CV shouts; "John" is how a person is addressed.
  const first = n.split(' ')[0];
  if (!first) return '';
  if (first === first.toUpperCase() && first.length > 1) {
    return first.charAt(0) + first.slice(1).toLowerCase();
  }
  return first;
}

/**
 * The receipt the applicant gets.
 * `company` is the CUSTOMER's own name (the org), never the end client's.
 */
function applicantReceipt({ applicantName, jobTitle, company }) {
  const who = firstName(applicantName);
  const role = txt(jobTitle);
  const org = txt(company);

  const subject = role
    ? 'We received your application — ' + role
    : 'We received your application';

  const greeting = who ? 'Hi ' + who + ',' : 'Hi,';
  const roleLine = role
    ? 'Thanks for applying for the ' + role + ' role. Your application and CV have arrived with us.'
    : 'Thanks for applying. Your application and CV have arrived with us.';

  // Deliberately no timeframe — see the rules above.
  const lines = [
    greeting,
    '',
    roleLine,
    '',
    'A recruiter will review it. If it looks like a fit for this role or another one we are working on, we will be in touch.',
    '',
    'You do not need to do anything else. If you want to add something, just reply to this email.',
    '',
    org ? ('— ' + org) : '— Recruitment team',
  ];

  const text = lines.join('\n');
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">' +
    lines.map(l => (l === '' ? '<div style="height:10px"></div>' : '<div>' + esc(l) + '</div>')).join('') +
    '</div>';

  return { subject, text, html };
}

/**
 * The nudge the recruiter gets. This one is INTERNAL, so it may name the
 * client and may carry the applicant's contact details.
 */
function recruiterAlert({ applicantName, jobTitle, jobCode, client, email, phone, location, appUrl }) {
  const name = txt(applicantName) || 'Someone';
  const role = txt(jobTitle) || 'a job';

  const subject = 'New applicant: ' + name + ' — ' + role +
    (txt(jobCode) ? ' (' + txt(jobCode) + ')' : '');

  const facts = [
    ['Applied for', [txt(jobTitle), txt(jobCode)].filter(Boolean).join(' · ')],
    ['Client', txt(client)],
    ['Email', txt(email)],
    ['Phone', txt(phone)],
    ['Location', txt(location)],
  ].filter(r => r[1]);

  const lines = [
    name + ' applied through the job\'s apply link.',
    '',
  ].concat(facts.map(r => r[0] + ': ' + r[1]));

  if (txt(appUrl)) {
    lines.push('', 'Open PACE → Candidates → Applicants to read the CV and add them: ' + txt(appUrl));
  } else {
    lines.push('', 'Open PACE → Candidates → Applicants to read the CV and add them.');
  }

  const text = lines.join('\n');
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">' +
    '<div><b>' + esc(name) + '</b> applied through the job\'s apply link.</div>' +
    '<div style="height:10px"></div>' +
    '<table style="border-collapse:collapse;font-size:13px">' +
      facts.map(r => '<tr><td style="padding:2px 14px 2px 0;color:#555">' + esc(r[0]) + '</td>' +
                     '<td style="padding:2px 0"><b>' + esc(r[1]) + '</b></td></tr>').join('') +
    '</table>' +
    '<div style="height:12px"></div>' +
    '<div>Open PACE → Candidates → Applicants to read the CV and add them.' +
      (txt(appUrl) ? ' <a href="' + esc(appUrl) + '">' + esc(appUrl) + '</a>' : '') +
    '</div></div>';

  return { subject, text, html };
}

module.exports = { applicantReceipt, recruiterAlert, firstName };
