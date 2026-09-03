// ============================================================================
// OUTREACH GENERATOR — turn a pasted job posting + a contact into one short
// cold email, plus a one-line diagnosis of why the role is hard to fill.
//
// PURE. No supabase, no fetch, no clock, no process.env. Everything here is a
// function of its arguments, which is why the whole thing is testable without
// a network or a database (test/outreach-generator-smoke.mjs).
//
// TWO ENGINES, ONE OUTPUT SHAPE — {subject, diagnosis, email}:
//   • rulesDraft()  reads the posting with regexes and writes the email from a
//                   sentence plan. Always available, costs nothing.
//   • the AI seam   buildSystemPrompt()/buildUserPayload() produce the prompt
//                   the route sends to Anthropic when a key is configured, and
//                   parseAiDraft() reads the answer back into the same shape.
// The route picks; the page cannot tell the difference beyond a `mode` label.
// This is the same keyless-first convention every other AI call site in PACE
// follows — an unfunded deployment still ships a working feature.
//
// The sending company is a PARAMETER, never a constant. This text goes to a
// customer's prospects under the customer's name; "Fute Global LLC" is one
// org's identity, not the product's.
// ============================================================================

'use strict';

const DEFAULT_COMPANY = 'our firm';

// ── Rule 1-15, given to the model verbatim. Kept as an array of lines so a
// diff shows which rule changed rather than one reflowed paragraph.
function buildSystemPrompt(companyName) {
  const co = String(companyName || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  return [
    `You write cold outreach emails for a contingency recruiting team at ${co}. You are given a job posting and details about the hiring contact. You produce exactly one short, natural, non-pushy email plus a one-sentence diagnosis of the real hiring problem.`,
    '',
    'RULES:',
    `1. Open with identity in sentence one — "This is {sender} at ${co}" or a close natural variant. No warm-up before it.`,
    '2. Read the job posting like a recruiter, not a copywriter. Find the ONE real reason this specific role is hard to fill — a rare skill combination, a credential or clearance requirement, a narrow candidate pool, a re-posting or long-open signal, an unusual work environment. State it in one or two plain sentences. This paragraph is the point of the email — it is what makes it feel researched instead of templated. Never invent a fact not supported by the posting or the notes.',
    '3. The job posting may include site clutter (Quick Apply buttons, Continue, star ratings, nav links, unrelated postings). Ignore that noise and extract only the real content: title, responsibilities, qualifications, and any explicit application instructions such as named contacts or do-not-contact notices.',
    '4. Only reference skills or industries that actually appear in the posting or notes. Never fabricate specifics.',
    "5. If the notes mention the contact's tenure, background, a mutual connection, or a prior interaction, you may work in ONE real detail from it, naturally and briefly. Never more than one. Never speculate about their state of mind or workload beyond what's stated.",
    '6. If a no-agencies / no-calls / placement-inquiry notice is flagged, acknowledge it directly in the first two sentences, keep the whole email under 90 words, and give an explicit low-friction way to opt out or say no. Do not use the standard longer structure in that case.',
    '7. Otherwise keep the email medium length, roughly 90-150 words.',
    '8. The call to action is always a plain yes/no question about reviewing resumes — never a request for a call or a meeting.',
    '9. Fee or cost language belongs AFTER the call to action, never before it — unless the contact is explicitly a Controller, CFO, or other finance-first decision-maker, in which case cost framing can move earlier since price is the real objection for that reader.',
    '10. Default fee framing, unless told otherwise: "There is no charge for reviewing candidate resumes. We only charge a fee for successful placement," or a natural variant. Never state a specific percentage.',
    '11. No filler, no marketing adjectives (passionate, dynamic, exceptional, cutting-edge, seamless), no exclamation points, no emoji. Plain sentence case. Contractions are fine.',
    '12. If this is a FOLLOW-UP rather than a first outreach, do not repeat the full pitch. Keep it under 60 words: ask if the role is still open, offer a graceful exit, and only restate that resumes are ready if wanted.',
    "13. If the posting names a specific HR or recruiting contact with a formal application process, that signals a slightly more corporate register. If it's clearly a small owner-operator business, keep it plainer and more direct.",
    `14. Close with the sender's real name, title, and "${co}" — nothing more decorative. Do not add a phone or email signature line unless asked.`,
    '15. If adjustment instructions are provided for a regeneration, apply them while keeping every rule above.',
    '',
    'Return ONLY valid JSON, no markdown fences, no prose outside the JSON, in exactly this shape:',
    '{"subject": "...", "diagnosis": "one or two sentences on the hiring-problem angle you used and why", "email": "the full email body including sign-off, no subject line inside it"}'
  ].join('\n');
}

function txt(v) { return String(v == null ? '' : v).trim(); }

/** What the page must supply before either engine can run. */
function validateInput(input) {
  const i = input || {};
  const missing = [];
  if (!txt(i.contact_first_name)) missing.push('contact first name');
  if (!txt(i.company)) missing.push('company');
  if (!txt(i.job_description)) missing.push('job posting');
  return { ok: missing.length === 0, missing };
}

/** The user turn handed to the model. Mirrors what rulesDraft() reads. */
function buildUserPayload(input) {
  const i = input || {};
  const sender = i.sender || {};
  const lines = [];
  lines.push('SENDER: ' + (txt(sender.name) || '(not set)') + ' — ' +
    (txt(sender.title) || '(not set)') + ', ' + (txt(sender.email) || '(not set)'));
  lines.push('OUTREACH TYPE: ' + (i.outreach_type === 'followup'
    ? 'Follow-up (already contacted once, no reply yet)' : 'First outreach'));
  lines.push('CONTACT: ' + txt(i.contact_first_name) +
    (txt(i.contact_title) ? ' — ' + txt(i.contact_title) : ''));
  lines.push('COMPANY: ' + txt(i.company));
  if (txt(i.location)) lines.push('LOCATION: ' + txt(i.location));
  if (i.no_agencies) {
    lines.push('NOTE: This posting includes a no-agencies / no-calls instruction.' +
      (txt(i.no_agencies_text) ? ' Exact wording: "' + txt(i.no_agencies_text) + '"' : ''));
  }
  if (txt(i.notes)) lines.push('CONTEXT ON THE CONTACT OR SITUATION:\n' + txt(i.notes));
  lines.push('JOB POSTING (may include site clutter — extract the real content):\n' + txt(i.job_description));
  if (txt(i.adjustment)) lines.push('ADJUSTMENT REQUESTED FOR THIS REGENERATION:\n' + txt(i.adjustment));
  return lines.join('\n\n');
}

/**
 * Read the model's answer. It is asked for bare JSON and usually gives it, but
 * a fenced block or a sentence of preamble is common enough that failing the
 * whole generation over it would be silly. Returns null when nothing usable is
 * in there — the caller then falls back to the rules draft rather than showing
 * an error, because a rules email is a better outcome than no email.
 */
function parseAiDraft(text) {
  const raw = String(text || '').replace(/```json|```/g, '').trim();
  if (!raw) return null;
  const candidates = [raw];
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const p = JSON.parse(c);
      if (p && txt(p.subject) && txt(p.email)) {
        return { subject: txt(p.subject), diagnosis: txt(p.diagnosis), email: txt(p.email) };
      }
    } catch (_) { /* try the next shape */ }
  }
  return null;
}

// ── Reading the posting ────────────────────────────────────────────────────
// Job boards paste in with furniture around the actual posting. These are the
// lines that are never content, dropped before anything else looks at the text.
const CLUTTER = /^(quick apply|apply now|easy apply|continue|save|share|report job|sign in|back to (search|results)|show more|read more|see all jobs|job details|full[- ]time|part[- ]time|·|•|\|)\s*$|^(\d+(\.\d+)?\s*(out of|stars?|reviews?)|posted \d)\b/i;

function contentLines(jd) {
  return String(jd || '')
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !CLUTTER.test(l));
}

const TITLE_HINT = /^(job title|position|role|title)\s*[:\-]\s*(.+)$/i;

/** Best guess at the role's name — used for the subject line and history. */
function extractRoleTitle(jd) {
  const lines = contentLines(jd);
  for (const l of lines.slice(0, 25)) {
    const m = l.match(TITLE_HINT);
    if (m && m[2].trim()) return m[2].trim().slice(0, 70);
  }
  // Otherwise the first short line that reads like a heading rather than prose.
  for (const l of lines) {
    if (l.length <= 70 && l.split(' ').length <= 9 && !/[.!?]$/.test(l) && /[a-z]/i.test(l)) {
      return l.replace(/\s*[-–|].*$/, '').trim().slice(0, 70);
    }
  }
  return '';
}

// Each signal is one honest reason a role sits open. `phrase` goes into the
// email as the researched paragraph; `why` goes into the diagnosis. Order is
// priority — the first match wins, so the most specific reasons sit first.
const SIGNALS = [
  { re: /\b(security clearance|top secret|ts\/sci|secret clearance|public trust)\b/i,
    phrase: (m) => 'the clearance requirement narrows the pool before skills are even on the table',
    why: 'A clearance requirement is the hardest filter in the posting — most qualified people are screened out by it, not by skill.' },
  { re: /\b(licen[cs]ed?|certifi(ed|cation)|\bP\.?E\.?\b|CPA|CDL|PMP|RN\b|LPN\b|OSHA|journeyman|red seal)\b/i,
    phrase: (m) => 'the licence and certification requirements cut the candidate pool down sharply',
    why: 'The posting gates on a licence or certification, which is a much smaller pool than the job title suggests.' },
  { re: /\b(1[0-9]|[7-9])\+?\s*(\+)?\s*years?\b/i,
    phrase: (m) => 'the experience bar in the posting is set high for this market',
    why: 'The years-of-experience requirement is high enough that most applicants are filtered out on the first pass.' },
  { re: /\b(bilingual|spanish|mandarin|french)[- ]?(speaking|fluen)/i,
    phrase: () => 'the language requirement on top of the technical side is an unusual combination',
    why: 'A language requirement stacked on the technical requirements is a genuinely rare combination.' },
  { re: /\b(night shift|graveyard|rotating shift|weekend|on[- ]call|24\/7)\b/i,
    phrase: () => 'the shift pattern is what usually costs this kind of role its applicants',
    why: 'The schedule, not the skills, is what typically loses candidates on this type of role.' },
  { re: /\b(travel|relocat)\w*\s*(up to\s*)?\d{0,3}%?/i,
    phrase: () => 'the travel expectation tends to thin out otherwise qualified candidates',
    why: 'Travel or relocation expectations usually cost a posting most of its otherwise qualified applicants.' },
  { re: /\b(on[- ]?site|in[- ]?office|in person)\b/i,
    phrase: () => 'a fully on-site role competes against a lot of remote offers for the same skills',
    why: 'On-site work for skills that are widely hired remotely is a competitive disadvantage in the market.' },
  { re: /\b(wear (many|multiple) hats|both .* and|in addition to|as well as)\b/i,
    phrase: () => 'the role spans two functions that are usually two separate hires',
    why: 'The posting combines responsibilities that are normally split across two roles, so single candidates rarely match all of it.' }
];

/** Which real constraint is making this hard to fill? */
function diagnoseSignal(jd, notes) {
  const hay = String(jd || '') + '\n' + String(notes || '');
  for (const s of SIGNALS) {
    const m = hay.match(s.re);
    if (m) return { phrase: s.phrase(m), why: s.why };
  }
  return null;
}

/** Skills that are actually in the posting — never invented. */
const SKILL_WORDS = ['payroll','accounts payable','accounts receivable','general ledger','month-end close',
  'QuickBooks','Sage','SAP','Workday','NetSuite','Excel','estimating','project management','scheduling',
  'blueprint','AutoCAD','Revit','welding','fabrication','maintenance','quality control','safety',
  'HR','recruiting','benefits','onboarding','compliance','collections','job costing','reconciliation',
  'Java','Python','.NET','React','SQL','AWS','Azure','Kubernetes','DevOps','data engineering','nursing'];

function extractSkills(jd) {
  const hay = String(jd || '');
  const found = [];
  for (const s of SKILL_WORDS) {
    const re = new RegExp('(^|[^a-z])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
    if (re.test(hay) && found.indexOf(s) < 0) found.push(s);
    if (found.length === 3) break;
  }
  return found;
}

const FINANCE_TITLE = /\b(controller|cfo|finance|accounting|treasur|owner|president|principal)\b/i;

/** The ONE detail from the notes we are allowed to use (rule 5). */
function oneNoteDetail(notes) {
  const n = txt(notes);
  if (!n) return '';
  const first = n.split(/(?<=[.!?])\s+|\n/)[0] || n;
  return first.trim().replace(/[.\s]+$/, '').slice(0, 140);
}

function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

/**
 * The keyless engine. Writes the email from a sentence plan rather than a
 * fill-in-the-blank template: which sentences appear, and in which order, is
 * decided by the same rules the model is given — the no-agencies short form,
 * the follow-up short form, and finance-first fee placement all change the
 * shape of the message, not just a word inside it.
 */
function rulesDraft(input, options) {
  const i = input || {};
  const co = txt((options || {}).companyName) || DEFAULT_COMPANY;
  const sender = i.sender || {};
  const senderName = txt(sender.name) || 'me';
  const senderTitle = txt(sender.title);
  const first = txt(i.contact_first_name) || 'there';
  const company = txt(i.company);
  const role = extractRoleTitle(i.job_description);
  const roleLabel = role || 'the role you have open';
  const loc = txt(i.location);
  // Two newlines, not one: the sign-off is its own block, and a "Best regards,"
  // glued to the last sentence is the tell that an email was assembled rather
  // than written.
  const signOff = '\n\n' + ['Best regards,', senderName, [senderTitle, co].filter(Boolean).join(', ')]
    .filter(Boolean).join('\n');

  // ── Follow-up (rule 12): under 60 words, no pitch, an explicit way out.
  if (i.outreach_type === 'followup') {
    const body = [
      'Hi ' + first + ',',
      '',
      'This is ' + senderName + ' at ' + co + ', following up on ' + roleLabel +
        (loc ? ' in ' + loc : '') + '. Is it still open?',
      '',
      "If it's filled, or you'd rather I stop, say so and I'll close the file. " +
        'Otherwise resumes are ready whenever you want them.'
    ].join('\n') + signOff;
    return {
      subject: 'Still open? ' + (role || 'your opening') + (loc ? ' — ' + loc : ''),
      diagnosis: 'Follow-up with no reply yet, so this asks one question — is the role still open — and gives an explicit way to say no rather than repeating the original pitch.',
      email: body,
      mode: 'rules'
    };
  }

  const signal = diagnoseSignal(i.job_description, i.notes);
  const skills = extractSkills(i.job_description);
  const detail = oneNoteDetail(i.notes);
  const financeFirst = FINANCE_TITLE.test(txt(i.contact_title));
  const feeLine = 'There is no charge for reviewing resumes. We only charge a fee on a successful placement.';
  const cta = 'Would it be worth sending you a couple of resumes to look at?';

  // ── No-agencies (rule 6): acknowledge it in the first two sentences, stay
  // under 90 words, and make saying no the easiest thing to do.
  if (i.no_agencies) {
    const body = [
      'Hi ' + first + ',',
      '',
      'This is ' + senderName + ' at ' + co + '. I saw the note on your ' + roleLabel +
        ' posting about placement inquiries, so I will keep this to one message and leave it with you.',
      '',
      (signal ? 'Reading the posting, ' + signal.phrase + '. ' : '') +
        'If resumes are useful we have people ready; if not, reply "no" and I will not follow up again.'
    ].join('\n') + signOff;
    return {
      subject: (role || 'Your opening') + (loc ? ' — ' + loc : '') + ' — one message only',
      diagnosis: 'The posting carries a no-agencies notice, so this acknowledges it in the opening, stays short, and makes declining a one-word reply.',
      email: body,
      mode: 'rules'
    };
  }

  // ── Standard first outreach (rules 1, 2, 5, 7-10).
  // The role has already been named in the opening line when we know the
  // company, so naming it again one sentence later is the repetition that makes
  // a generated email read as generated.
  const namedAlready = !!company;
  const subjectPhrase = namedAlready
    ? 'the posting'
    : 'the posting for ' + roleLabel + (loc ? ' in ' + loc : '');
  const observation = signal
    ? 'I read through ' + subjectPhrase + ', and ' + signal.phrase + '.'
    : 'I read through ' + subjectPhrase + ', and it is a narrower brief than the title suggests.';
  const skillLine = skills.length
    ? ' We have people with ' + joinList(skills) + ' experience who are open to a direct hire and have not been shown to you yet.'
    : ' We have people who look like a fit and are open to a direct hire.';
  // Rule 5: ONE detail from the notes, and it sits in the opening where a real
  // person would put it — not bolted on after the ask, where it reads as a
  // postscript someone remembered to add.
  const detailLine = detail
    ? ' ' + detail.charAt(0).toUpperCase() + detail.slice(1) + ', which is why I am writing to you rather than through the posting.'
    : '';

  const paras = ['Hi ' + first + ',', '',
    'This is ' + senderName + ' at ' + co + '.' +
      (company ? ' I came across ' + company + "'s opening for " + roleLabel +
        (loc ? ' in ' + loc : '') + '.' : '') + detailLine];
  if (financeFirst) {
    // Rule 9: for a finance-first reader, cost is the real objection — it goes
    // ahead of the ask instead of after it.
    paras.push('', observation + skillLine, '', feeLine, '', cta);
  } else {
    paras.push('', observation + skillLine, '', cta, '', feeLine);
  }
  let body = paras.join('\n') + signOff;

  // Rule 7 is a length rule, so it is checked rather than hoped for. The note
  // detail is the first thing dropped when the email runs long — it is the one
  // sentence that is nice to have rather than load-bearing.
  if (wordCount(body) > 165 && detailLine) {
    paras[2] = paras[2].replace(detailLine, '');
    body = paras.join('\n') + signOff;
  }

  return {
    subject: (role ? role : 'Your opening') + (loc ? ' in ' + loc : '') + ' — candidates ready to review',
    diagnosis: (signal ? signal.why : 'No single hard constraint stood out in the posting, so this leads on the specifics of the brief itself.') +
      (financeFirst ? ' The contact reads as finance-first, so the fee framing sits ahead of the ask.' : ''),
    email: body,
    mode: 'rules'
  };
}

module.exports = {
  DEFAULT_COMPANY,
  buildSystemPrompt, buildUserPayload, parseAiDraft, validateInput,
  rulesDraft, extractRoleTitle, extractSkills, diagnoseSignal, contentLines, wordCount
};
