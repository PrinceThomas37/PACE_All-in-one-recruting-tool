// ============================================================================
// WRITE A SEQUENCE STEP'S EMAIL — from a short instruction, or from a starter.
// Pure apart from the `complete` function passed in (so every rule below is
// testable offline). Observatory's: it is a prompt, a checker and a fallback.
//
// The owner (Session 40, D-0077), on the New sequence screen: "no option to add
// the template or edit, and no option to write with AI when given the right
// prompt". A sequence email is a TEMPLATE — it goes to many different people —
// so unlike the engine's first email (written per lead) it must be written in
// merge fields, and the checker's job is to make sure those fields are ones
// PACE can actually fill.
//
// D-0117 (8 Oct): the instruction is the brief. Default length is a full email
// (140–200 words, 3–4 short paragraphs). If they ask for shorter, follow that.
// A result that misses the topic is not shipped. One that is still short after
// one repair is shipped, and the note says so. Rewrite and Write a variant
// keep every {{variable}} exactly; if they cannot, the person's own text comes
// back — never the ready-made starter.
//
// The standing rules for anything AI-written here:
//   * `complete()` returns null when there is no key, no allowance left, or the
//     provider failed — and null means "write it with the rules": a ready-made
//     starter, said plainly to be one, never an error and never a silent swap.
//     Rewrite and Write a variant are the exception the owner set: there the
//     person's own text is the fallback, because a starter would throw away
//     the variables they placed.
//   * A prompt rule is a request; a check is a guarantee. The model is told the
//     house rules and then held to the ones a machine can verify; one repair
//     turn, then the fallback wins. A draft that broke a rule is never shipped
//     just because an AI wrote it.
//   * It never signs itself: the mailbox's signature is added when the email is
//     sent (fillSignatureHtml), and it never names the customer's own company —
//     that is `{{sender}}`'s and the signature's job, per organisation.
// ============================================================================
'use strict';

const { VAR_SYNONYMS } = require('../email-vars');

// Every merge name PACE can fill (any synonym of a known fact) plus the two the
// built-in templates already use.
const ALLOWED_VARS = new Set([].concat(...VAR_SYNONYMS, ['job_resp', 'company_service']));
// What the builder offers as one-click chips, with the plain name the person sees.
const CHIPS = [
  { v: '{{fn}}', label: 'First name' },
  { v: '{{ln}}', label: 'Last name' },
  { v: '{{pos}}', label: 'Role' },
  { v: '{{company}}', label: 'Company' },
  { v: '{{loc}}', label: 'Location' },
  { v: '{{sender}}', label: 'Your name' },
];
const PURPOSES = {
  first:    { label: 'a first email',    hint: 'The instruction is the brief. Write about that, not a generic pitch.' },
  followup: { label: 'a follow-up',      hint: 'The instruction is the brief. Refer back only to what it names.' },
  final:    { label: 'a last follow-up', hint: 'The instruction is the brief. Leave the door open. No pressure.' },
};
const MODES = ['write', 'rewrite', 'variant'];

// ── RULES-BASED STARTERS (what runs with no AI, and the fallback for a bad draft) ──
const STARTERS = {
  first: {
    subject: 'Candidates for your {{pos}} role in {{loc}}',
    body: `Hi {{fn}},

I'm {{sender}}. I came across {{company}}'s {{pos}} opening in {{loc}}, and I have a few pre-screened people who could fit.

Would you like me to send their resumes over?

Looking forward to your thoughts.`,
  },
  followup: {
    subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
    body: `Hi {{fn}},

Circling back on your {{pos}} role in {{loc}}. The people I mentioned are still available.

Want me to send their resumes over?

Looking forward to your thoughts.`,
  },
  final: {
    subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
    body: `Hi {{fn}},

I'll keep this short. I'm still holding a few candidates for your {{pos}} opening whenever the timing suits.

Shall I share their resumes?

Looking forward to your thoughts.`,
  },
};
const purposeOf = (p) => (PURPOSES[p] ? p : 'first');
const modeOf = (m) => (MODES.indexOf(m) >= 0 ? m : 'write');
const starterFor = (p) => ({ subject: STARTERS[purposeOf(p)].subject, body: STARTERS[purposeOf(p)].body });

const FIELDS = 'The email goes to many different people, so it is written with merge fields, typed exactly like this: {{fn}} (first name), {{ln}} (last name), {{pos}} (the role), {{company}} (their company), {{loc}} (the location), {{sender}} (the sender\'s name).';
const HOUSE = [
  'Use ONLY those fields. Never use square-bracket placeholders like [Name].',
  'Do NOT sign off with a name or a company name — the signature is added automatically. Do not name any specific company except through {{company}}.',
  'Never invent facts: no numbers of candidates, no years of experience, no fees or percentages, no guarantees, no claims about the reader\'s company.',
  'Answer with JSON only, nothing else: {"subject": "...", "body": "..."}. The subject is under 70 characters. Use \\n for line breaks in the body.',
];

// ── THE PROMPT ──────────────────────────────────────────────────────────────
function buildSystemPrompt(purpose) {
  const p = PURPOSES[purposeOf(purpose)];
  return [
    `You write ONE email template — ${p.label}. ${p.hint}`,
    'The person\'s instruction is the brief. Write about THAT topic. Do not switch to a generic "I have candidates" or "send their resumes" pitch unless the instruction asks for candidates or resumes.',
    'Default length: 140 to 200 words, in 3 or 4 short paragraphs. If the instruction asks for something shorter, or names a smaller word count, follow that instead.',
    FIELDS,
  ].concat(HOUSE).join('\n');
}
function buildUserPrompt({ prompt, purpose }) {
  return `This is ${PURPOSES[purposeOf(purpose)].label}.\nThe person's instruction: ${String(prompt || '').trim().slice(0, 600)}`;
}
function buildKeepPrompt(mode, purpose) {
  const job = mode === 'variant'
    ? 'Write ONE different version of the same outreach: same facts, same ask, different sentences.'
    : 'Rewrite the person\'s email. Change only what their instruction asks. If they gave no instruction, tighten the sentences without changing the topic.';
  return [
    `You ${mode} ONE email template — ${PURPOSES[purposeOf(purpose)].label}.`,
    job,
    'Keep every {{variable}} exactly: the same fields, the same number of times, in the subject and in the body separately. Do not add a field they did not use. Do not remove one. Do not change a field into a real name.',
    'Do not switch to a generic "I have candidates" pitch unless their text or their instruction already asks for candidates or resumes.',
    FIELDS,
  ].concat(HOUSE).join('\n');
}
function buildKeepUser({ prompt, subject, body }) {
  const ask = String(prompt || '').trim().slice(0, 600);
  return `Their instruction (may be empty): ${ask || '(none — keep the same outreach)'}\n\nTheir subject:\n${subject}\n\nTheir body:\n${body}`;
}
function buildRepairPrompt(parsed, violations) {
  return `Your draft broke these rules:\n- ${violations.join('\n- ')}\n\nHere is the draft:\n${JSON.stringify({ subject: parsed.subject, body: parsed.body })}\n\nRewrite it so none of those rules is broken, changing as little else as you can. Answer with JSON only: {"subject": "...", "body": "..."}.`;
}

// ── READING THE ANSWER ──────────────────────────────────────────────────────
function parseDraft(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.subject === 'string' && typeof j.body === 'string') return { subject: j.subject.trim(), body: j.body.replace(/\r/g, '').trim() };
    } catch (_) { /* fall through to the plain-text shape */ }
  }
  const s = t.match(/subject\s*:\s*(.+)/i), b = t.match(/body\s*:\s*([\s\S]+)/i);
  if (s && b) return { subject: s[1].trim(), body: b[1].trim() };
  return null;
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}
function paragraphCount(text) {
  return String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).length;
}

// A named count under 140, or the words short / brief / concise, means they
// asked for less than a full email. A named count is the floor (with a little
// slack). "Short" with no number means there is no 140-word floor.
function lengthAsk(prompt) {
  const p = String(prompt || '');
  const named = p.match(/\b(\d{2,3})\s*words?\b/i);
  const n = named ? Number(named[1]) : null;
  const saysShort = /\b(short|shorter|brief|briefly|concise|quick note|one paragraph|a single paragraph)\b/i.test(p);
  if (n && n < 140) return { floor: Math.max(20, Math.round(n * 0.8)), paragraphs: 0, named: n };
  if (saysShort) return { floor: null, paragraphs: 0, named: null };
  return { floor: 140, paragraphs: 3, named: null };
}
function lengthViolation(body, prompt) {
  const ask = lengthAsk(prompt);
  if (ask.floor == null) return '';
  const words = wordCount(body);
  const paras = paragraphCount(body);
  if (words < ask.floor || (ask.paragraphs && paras < ask.paragraphs)) {
    return ask.named
      ? `it is shorter than the ${ask.named} words they asked for`
      : 'it is shorter than a full email (140 to 200 words, in 3 or 4 short paragraphs)';
  }
  return '';
}

const TOPIC_STOP = new Set(('a an the and or but for with from that this your you our their write email emails follow followup first last note about into onto please make draft template outreach sequence short shorter brief briefly words word paragraph paragraphs friendly warm professional polite human plain just only also when what how they them then than into over under after before').split(' '));
function topicWords(prompt) {
  return [...new Set((String(prompt || '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []))].filter(w => !TOPIC_STOP.has(w));
}
const ASKS_PITCH = /\b(candidates?|r[eé]sum[eé]s?|cvs?|pre-?screened|placements?)\b/i;
const GENERIC_PITCH = /\b(pre-?screened|send (their|a few|some) r[eé]sum[eé]s|i have (a few|some|several) (people|candidates)|candidates for your)\b/i;
function missesTopic(prompt, draft, also) {
  const hay = `${draft && draft.subject || ''} ${draft && draft.body || ''}`;
  const asked = `${prompt || ''} ${also || ''}`;
  if (!ASKS_PITCH.test(asked) && GENERIC_PITCH.test(hay)) return true;
  const words = topicWords(prompt);
  if (words.length < 2) return false;
  const low = hay.toLowerCase();
  return !words.some(w => low.includes(w) || low.includes(w.slice(0, Math.max(4, w.length - 1))));
}
function topicViolation(prompt, draft, also) {
  return missesTopic(prompt, draft, also) ? 'it misses the topic of the instruction and must not become a generic "I have candidates" pitch' : '';
}

function varTokens(text) {
  return (String(text || '').match(/\{\{\s*[^}]*?\s*\}\}/g) || []).map(t => t.replace(/\s+/g, '').toLowerCase()).sort();
}
function sameVars(a, b) {
  const A = varTokens(a), B = varTokens(b);
  return A.length === B.length && A.every((x, i) => x === B[i]);
}
function varViolations(own, draft) {
  const v = [];
  if (!sameVars(own.subject, draft.subject)) v.push('the subject must keep every {{variable}} exactly — the same fields, the same number of times');
  if (!sameVars(own.body, draft.body)) v.push('the body must keep every {{variable}} exactly — the same fields, the same number of times');
  return v;
}

// ── THE CHECK ───────────────────────────────────────────────────────────────
// Returns { ok, violations[] }. Pure. Length and topic are judged in draft(),
// not here: the ready-made starters are short on purpose and must still pass.
function checkDraft(d) {
  const v = [];
  const subject = String((d && d.subject) || '').trim(), body = String((d && d.body) || '').trim();
  if (!subject) v.push('the subject is empty');
  if (!body) v.push('the body is empty');
  if (subject.length > 120) v.push('the subject is longer than 120 characters');
  if (body && body.length < 30) v.push('the body is too short to be an email');
  if (body.length > 4000) v.push('the body is longer than 4000 characters');
  const seen = new Set();
  for (const field of [subject, body]) {
    (field.match(/\{\{\s*([^}]*?)\s*\}\}/g) || []).forEach((tok) => {
      const name = tok.replace(/[{}\s]/g, '').toLowerCase();
      if (!ALLOWED_VARS.has(name) && !seen.has(name)) { seen.add(name); v.push(`it uses {{${name}}}, which PACE cannot fill`); }
    });
  }
  if (/\[[A-Za-z][^\]\n]{0,40}\]/.test(subject + '\n' + body)) v.push('it has a [square-bracket] placeholder instead of a merge field');
  if (/fut[eé] global/i.test(subject + '\n' + body)) v.push('it names a specific company — the sender\'s company comes from the signature');
  if (/\b\d{1,3}\s?%/.test(body)) v.push('it states a percentage');
  if (/\$\s?\d/.test(body)) v.push('it states an amount of money');
  return { ok: v.length === 0, violations: v };
}

const SHORTER_NOTE = 'Written by AI from your instruction — it came out shorter than a full email. Read it before you save.';
const AI_NOTE = 'Written by AI from your instruction — read it before you save.';

async function oneRepair(complete, system, parsed, violations) {
  try {
    const fix = await complete(system, buildRepairPrompt(parsed, violations));
    return fix && parseDraft(fix.text);
  } catch (_) { return null; }
}

// ── THE WHOLE JOB ───────────────────────────────────────────────────────────
// complete(system, prompt) → Promise<{text}|null>   (the AI seam, injected)
// → { subject, body, source: 'ai'|'starter'|'kept'|'refused', note }
async function draftFromInstruction({ complete, prompt, purpose }) {
  const kind = purposeOf(purpose);
  const starter = (note) => Object.assign(starterFor(kind), { source: 'starter', note });
  if (!String(prompt || '').trim()) return starter('Here is a ready-made starter — change anything you like.');
  const system = buildSystemPrompt(kind);
  let out;
  try { out = await complete(system, buildUserPrompt({ prompt, purpose: kind })); } catch (_) { out = null; }
  if (!out || !out.text) return starter('The AI writer is not available right now, so here is a ready-made starter to edit.');
  let parsed = parseDraft(out.text);
  if (!parsed) return starter('The AI\'s answer could not be read, so here is a ready-made starter to edit.');
  const judge = (d) => {
    const check = checkDraft(d);
    const length = lengthViolation(d.body, prompt);
    const topic = topicViolation(prompt, d);
    const violations = check.violations.slice();
    if (length) violations.push(length);
    if (topic) violations.push(topic);
    return { check, length, topic, violations };
  };
  let seen = judge(parsed);
  if (seen.violations.length) {
    const fixed = await oneRepair(complete, system, parsed, seen.violations);
    if (fixed) {
      const again = judge(fixed);
      if (again.violations.length < seen.violations.length) { parsed = fixed; seen = again; }
    }
  }
  if (seen.topic) return { source: 'refused', subject: '', body: '', note: 'The draft missed the topic of your instruction, so it was not used.' };
  if (!seen.check.ok) return starter('The AI\'s draft broke a rule (' + seen.check.violations.join('; ') + '), so here is a ready-made starter to edit instead.');
  if (seen.length) return { subject: parsed.subject, body: parsed.body, source: 'ai', note: SHORTER_NOTE };
  return { subject: parsed.subject, body: parsed.body, source: 'ai', note: AI_NOTE };
}

async function draftKeeping({ complete, prompt, purpose, mode, subject, body }) {
  const kind = purposeOf(purpose);
  const own = { subject: String(subject || '').replace(/\r/g, '').trim(), body: String(body || '').replace(/\r/g, '').trim() };
  const giveBack = (note) => ({ subject: own.subject, body: own.body, source: 'kept', note });
  if (!own.subject && !own.body) return giveBack('Write the email first — there is nothing to change.');
  const system = buildKeepPrompt(mode, kind);
  let out;
  try { out = await complete(system, buildKeepUser({ prompt, subject: own.subject, body: own.body })); } catch (_) { out = null; }
  if (!out || !out.text) return giveBack('The AI writer is not available right now, so your text is unchanged.');
  let parsed = parseDraft(out.text);
  if (!parsed) return giveBack('The AI\'s answer could not be read, so your text is unchanged.');
  const judge = (d) => {
    const check = checkDraft(d);
    const vars = varViolations(own, d);
    const topic = topicViolation(prompt, d, own.subject + ' ' + own.body);
    const violations = check.violations.concat(vars);
    if (topic) violations.push(topic);
    return { check, vars, topic, violations };
  };
  let seen = judge(parsed);
  if (seen.violations.length) {
    const fixed = await oneRepair(complete, system, parsed, seen.violations);
    if (fixed) {
      const again = judge(fixed);
      if (again.violations.length < seen.violations.length) { parsed = fixed; seen = again; }
    }
  }
  if (seen.violations.length) return giveBack('The rewrite could not keep your {{variables}} and your topic, so your text is unchanged.');
  const note = mode === 'variant'
    ? 'A different version of your email — every {{variable}} is still there. Read it before you save.'
    : 'Rewritten from your email — every {{variable}} is still there. Read it before you save.';
  return { subject: parsed.subject, body: parsed.body, source: 'ai', note };
}

async function draft(opts) {
  const mode = modeOf(opts && opts.mode);
  if (mode === 'rewrite' || mode === 'variant') return draftKeeping(Object.assign({}, opts, { mode }));
  return draftFromInstruction(opts || {});
}

module.exports = {
  ALLOWED_VARS, CHIPS, PURPOSES, STARTERS, MODES,
  purposeOf, modeOf, starterFor, buildSystemPrompt, buildUserPrompt, buildKeepPrompt, buildRepairPrompt,
  parseDraft, checkDraft, draft, wordCount, paragraphCount, lengthAsk, lengthViolation,
  missesTopic, topicWords, sameVars, varTokens,
};
