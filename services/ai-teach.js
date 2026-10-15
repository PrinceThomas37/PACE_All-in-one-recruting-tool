// ============================================================================
// TEACHING THE AI BY PICKS — "AI writes each one" (owner, 15 Oct 2026, D-0150, D-0151, D-0152; R-259)
// ----------------------------------------------------------------------------
// The owner: teaching the AI must be by choosing options and writing one-liners, never by writing an email — for the first
// email AND the follow-ups. A person who picks "AI writes each one" on the sequence screen answers:
//   * what the email is for (one line)
//   * what it may use from the job (top skills, why the role is hard to fill, pay if the job says, on-site or remote, industry)
//   * how it ends (offer to send resumes / a yes-or-no question)
//   * how long (short / a bit longer)
//   * optionally, an email they have sent, so it sounds like them (its sound, never its facts)
//   * per follow-up: a gentle nudge / one more detail from the job / a last check-in, plus one optional line it must say
//
// WHAT AN ANSWER CANNOT DO. The house checker (outreach-generator checkDraft) still holds every draft: nothing invented, no fee
// percentage, a question at the end that is never a call or a meeting, no exclamation marks, one sign-off. That is why "ask for a
// short call" — in the mock — is not an ending here: every email using it would be rejected and the backup sent instead.
//
// THE BACKUP. The person's own written first email and follow-ups (u_<id>_tmpl_*) are what the engine queues. The AI replaces one
// at send time only when it wrote a draft that passed the checker and was stored. No provider, no allowance left today, an
// unreadable answer or a rejected draft: the backup goes out unchanged (owner, D-0151: "the remaining emails go out using the
// user's own email").
//
// WHERE IT LIVES. app_settings `u_<id>_ai_teach`, one JSON value, no migration. Cleared when the person picks "I write it".
//
// PURE apart from the injected `complete` — no db, no fetch.
// ============================================================================
'use strict';

const USE = {
  skills:   { label: 'Top skills',                    text: 'the top skills the job asks for' },
  hard:     { label: 'Why the role is hard to fill',  text: 'the one or two requirements that make this role hard to fill' },
  pay:      { label: 'Pay, if the job says',          text: 'the pay, only if the job description states it' },
  onsite:   { label: 'On-site or remote',             text: 'whether the job is on-site, hybrid or remote' },
  industry: { label: 'Their industry',                text: 'the industry the company is in' },
};
const ENDS = {
  resumes: { label: 'Offer to send resumes',   text: 'end with one short question offering to send a few resumes' },
  yesno:   { label: 'Ask a yes-or-no question', text: 'end with one short yes-or-no question about whether they want help with this role' },
};
const LENS = {
  short:  { label: 'Short',        text: 'Keep it short: about 70 to 100 words (never under 60).' },
  medium: { label: 'A bit longer', text: 'Make it a little fuller: about 110 to 150 words (never over 165).' },
};
const ANGLES = {
  nudge:  { label: 'A gentle nudge',               text: 'A gentle nudge: remind them of the question in the first email. Add nothing new.' },
  detail: { label: 'One more detail from the job', text: 'Add ONE detail from the job description that the first email did not mention, then ask the question again.' },
  last:   { label: 'A last check-in',              text: 'A polite last check-in: say this is the last note about this role, and leave the door open with one short question.' },
};
const DEFAULT_USE = ['skills', 'hard', 'pay'];
const MAX_PURPOSE = 200, MAX_VOICE = 1500, MAX_NOTE = 160, MAX_FUS = 5;

const key = (userId) => `u_${userId}_ai_teach`;

function line(s, n) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/"""/g, '"').replace(/\s+/g, ' ').trim().slice(0, n);
}
function block(s, n) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/"""/g, '"').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
}

/** Whatever is stored or sent (a JSON string, an object, or nothing) → a complete, bounded answer set. Unknown picks are dropped. */
function normalize(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (_) { o = null; } }
  if (!o || typeof o !== 'object') o = {};
  const use = Array.isArray(o.use) ? [...new Set(o.use.filter((k) => USE[k]))] : DEFAULT_USE.slice();
  const fus = (Array.isArray(o.fus) ? o.fus : []).slice(0, MAX_FUS).map((f) => ({
    angle: f && ANGLES[f.angle] ? f.angle : 'nudge',
    note: line(f && f.note, MAX_NOTE),
  }));
  return {
    purpose: line(o.purpose, MAX_PURPOSE),
    use,
    end: ENDS[o.end] ? o.end : 'resumes',
    len: LENS[o.len] ? o.len : 'short',
    voice: block(o.voice, MAX_VOICE),
    fus,
  };
}

/** Has this person taught the AI at all? (A purpose is the one thing it cannot write without.) */
const isTaught = (t) => !!(t && String(t.purpose || '').trim());

/** The first problem with a set of answers the person is saving, in plain words — or null. */
function problem(t) {
  if (!t || String(t.purpose || '').trim().length < 5) return 'Say in one line what the email is for, so the AI knows what to write.';
  return null;
}

/** The answers as instructions, appended to the first-email writer's system prompt. Empty when the person has not taught it. */
function firstBlock(teach) {
  const t = normalize(teach);
  if (!isTaught(t)) return '';
  const uses = t.use.map((k) => USE[k].text);
  const skipped = Object.keys(USE).filter((k) => t.use.indexOf(k) < 0).map((k) => USE[k].text);
  const out = [
    '', '',
    'THE SENDER\'S ANSWERS FOR THIS EMAIL',
    'The person whose name goes on this email chose these. Follow them. Where they disagree with the style rules above about length or ' +
      'what to lead with, THEY WIN. They can never change: nothing invented; no stated fee percentage or rate; never a request for a call ' +
      'or meeting; no leftover {placeholders}; one sign-off only; the JSON shape of your answer.',
    '- What this email is for, in their words: "' + t.purpose + '"',
    uses.length ? '- From the job description you may use: ' + uses.join('; ') + '.' : '- Use nothing from the job description beyond the job title and the city.',
    skipped.length ? '- Do not mention: ' + skipped.join('; ') + '.' : '',
    '- How it ends: ' + ENDS[t.end].text + '.',
    '- ' + LENS[t.len].text,
  ];
  if (t.voice) {
    out.push('- Sound like this email they once wrote. Copy its tone, sentence length and way of greeting — NEVER its facts, names, ' +
      'numbers or claims, which are about a different situation:', '"""', t.voice, '"""');
  }
  return out.filter((l) => l !== '').join('\n');
}

/** The follow-up answers for step N (1-based), or null when this follow-up is not taught. */
function followupFor(teach, step) {
  const t = normalize(teach);
  if (!isTaught(t)) return null;
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1) return null;
  return t.fus[n - 1] || null;
}

/**
 * Should the send replace this FOLLOW-UP with an AI draft? Same gate as the first email (ai-first-choice: the company switch and the
 * person's choice) plus: the person taught this follow-up, and it is not a retry of one the AI already wrote.
 */
function shouldWriteFollowup({ aiReady, allowed, teach, step, alreadyAi }) {
  if (!aiReady || !allowed || alreadyAi) return false;
  return !!followupFor(teach, step);
}

function followupSystem({ omitSignOff }) {
  return [
    'You write ONE short follow-up email from a recruiter to a hiring contact who has not replied to the recruiter\'s first email.',
    'Rules — every one is checked by a machine, and a draft that breaks one is thrown away:',
    '1. Open with a greeting line using their first name: "Hi <first name>,".',
    '2. 30 to 80 words in the body. Plain sentences. No exclamation marks, no emoji, no marketing adjectives.',
    '3. Use ONLY facts that are in the first email or the job description given to you. Invent nothing: no numbers, names, results or claims about candidates.',
    '4. End with exactly one short question. Never ask for a call, a meeting, a chat or their time.',
    '5. Never state a fee percentage or a rate.',
    omitSignOff ? '6. Close with "Thanks," on its own line and NOTHING after it — the signature is added automatically.' : '6. Close with "Thanks," and the sender\'s first name.',
    '7. Do not repeat the whole first email. It is a reply in the same thread.',
    '',
    'Answer with JSON only, exactly this shape: {"subject":"Re","email":"<the email body>"}',
  ].join('\n');
}

/** The user prompt for follow-up N: what this follow-up does, the person's line, the first email that went out, the posting. */
function followupPrompt({ teach, step, input, firstEmail }) {
  const f = followupFor(teach, step);
  const t = normalize(teach);
  const i = input || {};
  const posting = String(i.job_description || '').slice(0, 6000);
  return [
    'FOLLOW-UP NUMBER: ' + step,
    'WHAT THIS FOLLOW-UP DOES: ' + ANGLES[(f && f.angle) || 'nudge'].text,
    f && f.note ? 'IT MUST ALSO SAY (the sender\'s own line, keep its meaning): "' + f.note + '"' : '',
    t.voice ? 'SOUND LIKE THIS (its tone only, never its facts):\n"""\n' + t.voice + '\n"""' : '',
    '',
    'THEIR FIRST NAME: ' + (i.contact_first_name || ''),
    'THEIR COMPANY: ' + (i.company || ''),
    'THE JOB: ' + (i.job_title || '') + (i.location ? ' in ' + i.location : ''),
    '',
    'THE FIRST EMAIL THAT WAS SENT:',
    '"""',
    'Subject: ' + String((firstEmail && firstEmail.subject) || ''),
    '',
    String((firstEmail && firstEmail.body) || '').slice(0, 3000),
    '"""',
    '',
    'THE JOB DESCRIPTION:',
    '"""',
    posting,
    '"""',
  ].filter((l) => l !== '').join('\n');
}

/**
 * Ask, check, repair once, or give up — the same shape as engine-draft.draftFirstEmail.
 * Returns { body, repaired } or { skipped: reason, violations? }. Never throws on a bad answer.
 */
async function writeFollowup({ gen, complete, teach, step, input, firstEmail, omitSignOff }) {
  if (!input) return { skipped: 'missing_contact_or_company' };
  if (!followupFor(teach, step)) return { skipped: 'not_taught' };
  if (!firstEmail || !String(firstEmail.body || '').trim()) return { skipped: 'no_first_email' };
  const system = followupSystem({ omitSignOff });
  const out = await complete(system, followupPrompt({ teach, step, input, firstEmail }));
  if (!out || !out.text) return { skipped: 'ai_unavailable' };
  let parsed = gen.parseAiDraft(out.text);
  if (!parsed) return { skipped: 'ai_unparseable' };
  const checkInput = Object.assign({}, input, { outreach_type: 'followup' });
  const opts = { omitSignOff };
  let check = gen.checkDraft(parsed, checkInput, opts);
  let repaired = false;
  if (!check.ok) {
    const fix = await complete(system, gen.buildRepairPrompt(parsed, check.violations));
    const fixed = fix && gen.parseAiDraft(fix.text);
    if (fixed) {
      const recheck = gen.checkDraft(fixed, checkInput, opts);
      if (recheck.violations.length < check.violations.length) { parsed = fixed; check = recheck; repaired = true; }
    }
  }
  if (!check.ok) return { skipped: 'draft_rejected', violations: check.violations.map((v) => v.code) };
  return { body: parsed.email, repaired };
}

/** What the screen shows for the picks: [{ k, label }] per list. */
function options() {
  const list = (o) => Object.keys(o).map((k) => ({ k, label: o[k].label }));
  return { use: list(USE), ends: list(ENDS), lens: list(LENS), angles: list(ANGLES) };
}

module.exports = {
  USE, ENDS, LENS, ANGLES, DEFAULT_USE, MAX_PURPOSE, MAX_VOICE, MAX_NOTE,
  key, normalize, isTaught, problem, firstBlock, followupFor, shouldWriteFollowup,
  followupSystem, followupPrompt, writeFollowup, options,
};
