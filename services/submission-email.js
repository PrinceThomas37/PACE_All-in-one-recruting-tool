// THE SUBMISSION EMAIL (R-092, owner 2026-09-30 / D-0066).
// "When a candidate is submitted to BDM or to client, a send email option should be there with
// submission details. I need that." and "it should be able to attach resume."
//
// Two moments, one email:
//   kind 'bdm'    a recruiter hands a candidate to the BD manager  (Submitted to BDM)
//   kind 'client' the BD manager sends the candidate to the client (Submitted to Client)
//
// PURE: the words only. The route (routes/recruiting/outreach.js) fetches the rows, resolves the
// attachments, picks the mailbox and sends. What is stated comes ONLY from what the submission
// actually holds — nothing is invented, and an empty field is left out, not shown as "N/A".

const firstNameOf = (name) => String(name || '').trim().split(/\s+/)[0] || '';

const FIELDS = [
  ['Email', (d, c) => d.email || c.email],
  ['Mobile', (d, c) => d.mobile || c.phone],
  ['Home phone', (d) => (d.home_phone && d.home_phone !== 'N/A') ? d.home_phone : ''],
  ['Work authorization', (d, c) => (d.work_auth && d.work_auth !== 'N/A') ? d.work_auth : c.work_authorization],
  ['Current location', (d, c) => d.current_location || [c.city, c.state].filter(Boolean).join(', ') || c.current_location],
  ['Relocation', (d) => d.relocation],
  ['Availability', (d, c) => d.availability || c.availability],
];

/**
 * @param {object} o
 * @param {'bdm'|'client'} o.kind
 * @param {object} o.sub        { submission_details }
 * @param {object} o.candidate  { full_name, email, phone, ... }
 * @param {object} o.job        { job_title, job_code, client }
 * @param {string} [o.note]     the sender's own words, placed above the details
 * @param {string} [o.toName]   who it goes to, for the greeting
 * @param {string} [o.senderName]
 * @param {number} [o.attachmentCount]
 * @returns {{subject:string, text:string}}
 */
function buildSubmissionEmail({ kind, sub, candidate, job, note, toName, senderName, attachmentCount }) {
  const d = (sub && sub.submission_details && typeof sub.submission_details === 'object') ? sub.submission_details : {};
  const c = candidate || {}, j = job || {};
  const name = c.full_name || [d.first_name, d.last_name].filter(Boolean).join(' ') || 'Candidate';
  const role = (j.job_title || 'the role') + (j.job_code ? ' (' + j.job_code + ')' : '');
  const subject = (kind === 'client' ? 'Candidate submission: ' : 'Submission for review: ') + name + ' — ' + role;

  const lines = [];
  const hi = firstNameOf(toName);
  lines.push(hi ? 'Hi ' + hi + ',' : 'Hello,', '');
  lines.push(kind === 'client'
    ? 'Please find below the profile of a candidate for ' + role + (j.client ? ' at ' + j.client : '') + '.'
    : (senderName || 'A recruiter') + ' has submitted a candidate for ' + role + (j.client ? ' (' + j.client + ')' : '') + ' for your review.', '');
  const n = String(note || '').trim();
  if (n) lines.push(n, '');
  lines.push('Candidate: ' + name);
  FIELDS.forEach(([label, pick]) => { const v = String(pick(d, c) || '').trim(); if (v) lines.push(label + ': ' + v); });
  if (c.current_title || c.current_employer) lines.push('Current role: ' + [c.current_title, c.current_employer].filter(Boolean).join(' at '));
  const comment = String(d.comment || '').trim();
  if (comment) lines.push('', 'Submission comment', comment);
  if (attachmentCount > 0) lines.push('', attachmentCount === 1 ? 'The résumé is attached.' : 'The résumés are attached (' + attachmentCount + ' files).');
  lines.push('', kind === 'client' ? 'Please let us know your feedback or if you would like to schedule an interview.' : 'Please review and let me know if you would like to take this forward.', '', 'Best regards');
  return { subject, text: lines.join('\n') };
}

// Addresses typed into To/Cc: a list, a "a@x.com, b@y.com" string, or "Name <a@x.com>".
// Only syntactically valid addresses are kept; duplicates (case-insensitive) collapse.
function parseAddresses(input, isValid) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,;\n]+/);
  const seen = new Set(), out = [];
  raw.forEach((x) => {
    const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(String(x)); const a = (m ? m[1] : String(x)).trim();
    const key = a.toLowerCase();
    if (a && !seen.has(key) && isValid(a)) { seen.add(key); out.push(a); }
  });
  return out;
}

module.exports = { buildSubmissionEmail, parseAddresses };
