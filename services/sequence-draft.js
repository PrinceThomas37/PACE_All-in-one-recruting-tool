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
// The standing rules for anything AI-written here:
//   * `complete()` returns null when there is no key, no allowance left, or the
//     provider failed — and null means "write it with the rules": a ready-made
//     starter, said plainly to be one, never an error and never a silent swap.
//   * A prompt rule is a request; a check is a guarantee. The model is told the
//     house rules and then held to the ones a machine can verify; one repair
//     turn, then the starter wins. A draft that broke a rule is never shipped
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
  first:    { label: 'a first email',        hint: 'Introduce, say why you are writing in one sentence, and ask one simple question.' },
  followup: { label: 'a follow-up',          hint: 'A short nudge that refers back to the first email. Never repeat it; add nothing new that is not true.' },
  final:    { label: 'a last follow-up',     hint: 'A brief, polite last note that leaves the door open. No pressure.' },
};

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
const starterFor = (p) => ({ subject: STARTERS[purposeOf(p)].subject, body: STARTERS[purposeOf(p)].body });

// ── THE PROMPT ──────────────────────────────────────────────────────────────
function buildSystemPrompt(purpose) {
  const p = PURPOSES[purposeOf(purpose)];
  return [
    `You write ONE email template for a recruiting firm's outreach sequence — ${p.label}. ${p.hint}`,
    'The email goes to many different people, so it is written with merge fields, typed exactly like this: {{fn}} (first name), {{ln}} (last name), {{pos}} (the role), {{company}} (their company), {{loc}} (the location), {{sender}} (the sender\'s name).',
    'Use ONLY those fields. Never use square-bracket placeholders like [Name].',
    'Do NOT sign off with a name or a company name — the signature is added automatically. Do not name any specific company except through {{company}}.',
    'Plain, human, warm and short: 50 to 110 words. One clear, easy question. No hype, no flattery, no exclamation marks.',
    'Never invent facts: no numbers of candidates, no years of experience, no fees or percentages, no guarantees, no claims about the reader\'s company.',
    'Answer with JSON only, nothing else: {"subject": "...", "body": "..."}. The subject is under 70 characters. Use \\n for line breaks in the body.',
  ].join('\n');
}
function buildUserPrompt({ prompt, purpose }) {
  return `This is ${PURPOSES[purposeOf(purpose)].label}.\nThe person's instruction: ${String(prompt || '').trim().slice(0, 600)}`;
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

// ── THE CHECK ───────────────────────────────────────────────────────────────
// Returns { ok, violations[] }. Pure.
function checkDraft(d) {
  const v = [];
  const subject = String((d && d.subject) || '').trim(), body = String((d && d.body) || '').trim();
  if (!subject) v.push('the subject is empty');
  if (!body) v.push('the body is empty');
  if (subject.length > 120) v.push('the subject is longer than 120 characters');
  if (body && body.length < 30) v.push('the body is too short to be an email');
  if (body.length > 1500) v.push('the body is longer than 1500 characters');
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

// ── THE WHOLE JOB ───────────────────────────────────────────────────────────
// complete(system, prompt) → Promise<{text}|null>   (the AI seam, injected)
// → { subject, body, source: 'ai'|'starter', note }
async function draft({ complete, prompt, purpose }) {
  const kind = purposeOf(purpose);
  const starter = (note) => Object.assign(starterFor(kind), { source: 'starter', note });
  if (!String(prompt || '').trim()) return starter('Here is a ready-made starter — change anything you like.');
  const system = buildSystemPrompt(kind);
  let out;
  try { out = await complete(system, buildUserPrompt({ prompt, purpose: kind })); } catch (_) { out = null; }
  if (!out || !out.text) return starter('The AI writer is not available right now, so here is a ready-made starter to edit.');
  let parsed = parseDraft(out.text);
  if (!parsed) return starter('The AI\'s answer could not be read, so here is a ready-made starter to edit.');
  let check = checkDraft(parsed);
  if (!check.ok) {
    let fixed = null;
    try { const fix = await complete(system, buildRepairPrompt(parsed, check.violations)); fixed = fix && parseDraft(fix.text); } catch (_) { fixed = null; }
    if (fixed) { const re = checkDraft(fixed); if (re.violations.length < check.violations.length) { parsed = fixed; check = re; } }
  }
  if (!check.ok) return starter('The AI\'s draft broke a rule (' + check.violations.join('; ') + '), so here is a ready-made starter to edit instead.');
  return { subject: parsed.subject, body: parsed.body, source: 'ai', note: 'Written by AI from your instruction — read it before you save.' };
}

module.exports = {
  ALLOWED_VARS, CHIPS, PURPOSES, STARTERS,
  purposeOf, starterFor, buildSystemPrompt, buildUserPrompt, buildRepairPrompt, parseDraft, checkDraft, draft,
};
