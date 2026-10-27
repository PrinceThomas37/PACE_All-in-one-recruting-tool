'use strict';
// ============================================================================
// THE INTERVIEW EMAILS — one for each person, each saying what THAT person needs (R-317, owner 26 Oct).
//
// "Interview email: choose the sending mailbox; separate emails to client and candidate. Client: candidate full name, email, phone,
// interview time, mode, resume attached. Candidate: interviewers and their titles, invite link / phone / address by mode, JD."
//   · candidate   — when, how to join (link / phone / address), who they will meet (as typed: "Jane Smith (Hiring Manager)"), and
//                   the job description;
//   · client      — the candidate's name, email and phone, when and how, who is interviewing; the résumé rides along (the route
//                   attaches it — this only says so);
//   · bd_manager  — the internal heads-up, as before.
// Only facts the submission and job order hold; nothing is filled in on their behalf, and no pay figure is stated.
// PURE (the time is formatted by services/interview-time.js). Used by routes/recruiting/outreach.js POST /submissions/:id/interview-invite.
// ============================================================================
const interviewTime = require('./interview-time');

const ROLES = ['candidate', 'client', 'bd_manager'];
const JD_MAX = 3000;   // a long description is cut at a word, said with "…" (an email is not the place for ten pages)

function firstNameOf(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }

function formatOf(sub) {
  return sub.interview_type || (sub.interview_link ? 'virtual' : (sub.interview_address ? 'in_person' : ''));
}

// How to be there, in the words for this kind of interview.
function joiningLines(sub, job) {
  const type = formatOf(sub), out = [];
  if (type === 'virtual') {
    out.push('Format: Virtual' + (sub.interview_platform ? ' (' + sub.interview_platform + ')' : ''));
    if (sub.interview_link) out.push('Join link / meeting ID: ' + sub.interview_link);
  } else if (type === 'in_person') {
    out.push('Format: In person');
    if (sub.interview_address) out.push('Address: ' + sub.interview_address);
    else if (job.city || job.state) out.push('Location: ' + [job.city, job.state].filter(Boolean).join(', '));
  } else if (type === 'phone') {
    out.push('Format: Phone call');
    if (sub.interview_link) out.push('Number: ' + sub.interview_link);
  } else if (sub.interview_location) {
    out.push('Location: ' + sub.interview_location);
  }
  return out;
}

function interviewerLines(sub) {
  const ivs = Array.isArray(sub.interviewers) ? sub.interviewers.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!ivs.length) return [];
  if (ivs.length === 1) return ['Interviewer: ' + ivs[0]];
  return ['Interviewers:'].concat(ivs.map((x) => '  • ' + x));
}

function cut(text, max) {
  const t = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

/**
 * The text of one interview email.
 * @param o.sub        the submission (interview_at, interview_type, interview_platform, interview_link, interview_address, interviewers …)
 * @param o.candidate  { full_name, email, phone }
 * @param o.job        { job_title, client, company: {name}, city, state, job_type, remote, job_description, bd_manager: {name} }
 * @param o.role       'candidate' | 'client' | 'bd_manager'
 * @param o.tz         the zone the time is stated in (spelled out)
 * @param o.toName     who it is addressed to, when known (the client contact's name)
 * @param o.resume    client copy only: 'attached' | 'none_on_file' | anything else (the sender chose not to attach → not mentioned)
 */
function buildInviteText({ sub, candidate, job, role, tz, toName, resume }) {
  sub = sub || {}; candidate = candidate || {}; job = job || {};
  const when = interviewTime.formatInterview(sub.interview_at, tz);
  const company = job.client || (job.company && job.company.name);
  const lines = [];
  const greet = role === 'candidate' ? candidate.full_name : role === 'client' ? toName : (job.bd_manager && job.bd_manager.name);
  lines.push('Hi ' + firstNameOf(greet) + ',', '');
  if (role === 'candidate') lines.push('Your interview has been scheduled. Here are the details:', '');
  else if (role === 'client') lines.push('This confirms the interview with ' + (candidate.full_name || 'the candidate') + ' for the ' + (job.job_title || 'role') + ' position.', '');
  else lines.push('An interview has been scheduled for ' + (candidate.full_name || 'the candidate') + ':', '');

  lines.push('Position: ' + (job.job_title || '—'));
  if (company && role !== 'client') lines.push('Company: ' + company);
  if (role === 'client') {
    lines.push('', 'Candidate', 'Name: ' + (candidate.full_name || '—'));
    if (candidate.email) lines.push('Email: ' + candidate.email);
    if (candidate.phone) lines.push('Phone: ' + candidate.phone);
    lines.push('', 'Interview');
  } else if (role === 'bd_manager') {
    lines.push('Candidate: ' + (candidate.full_name || '—'));
  }
  lines.push('Date & time: ' + when);
  lines.push(...joiningLines(sub, job));
  lines.push(...interviewerLines(sub));

  if (role === 'candidate') {
    const about = [];
    const where = [job.city, job.state].filter(Boolean).join(', ');
    if (where) about.push('Location: ' + where);
    if (job.job_type) about.push('Job type: ' + job.job_type);
    const rem = String(job.remote || '').trim();
    if (/^(remote|hybrid|on.?site)$/i.test(rem)) about.push('Work setting: ' + rem);
    const desc = cut(job.job_description, JD_MAX);
    if (about.length || desc) lines.push('', 'The role', ...about);
    if (desc) lines.push('', 'Job description', desc);
  }
  if (role === 'client' && resume === 'attached') lines.push('', firstNameOf(candidate.full_name) + "'s résumé is attached.");
  if (role === 'client' && resume === 'none_on_file') lines.push('', 'We do not have a résumé on file to attach — we can send one on request.');
  lines.push('', role === 'client' ? 'Please let us know if anything changes on your side.' : 'Please let us know if you have any questions or need to reschedule.', '', 'Best regards');
  return lines.join('\n');
}

function subjectFor({ role, candidate, job }) {
  const who = (candidate && candidate.full_name) || 'Candidate', what = (job && job.job_title) || 'Role';
  if (role === 'candidate') return 'Your interview: ' + what;
  if (role === 'client') return 'Interview confirmed: ' + who + ' — ' + what;
  return 'Interview scheduled: ' + who + ' — ' + what;
}

module.exports = { ROLES, JD_MAX, buildInviteText, subjectFor, firstNameOf };
