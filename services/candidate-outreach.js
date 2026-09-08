'use strict';
// ============================================================================
// CANDIDATE OUTREACH — write to the people in our database about the jobs in
// our database, and ask one question: are you interested?
//
// PURE. No supabase, no fetch, no clock, no process.env. Everything is a
// function of its arguments, which is why test/candidate-outreach-smoke.mjs
// can pin every rule below with no network and no database.
//
// ── THE DIRECTION IS REVERSED FROM services/outreach-generator.js ──────────
// That file starts from a job posting PASTED off the internet and finds one
// hiring contact. This one starts from a job order we already OWN and finds
// many candidates. Everything awkward about this feature follows from that:
//
//   • 25 candidates on one job would be 25 AI calls. Groq's free tier is 8,000
//     tokens a minute and one generated email costs ~2,100 — four in quick
//     succession already rate-limits (measured 2026-09-08), and 25 would spend
//     the org's whole daily meter, after which EVERY AI feature in PACE
//     silently falls back to its rules writer for the rest of the day.
//
//     So the AI writes THE JOB BRIEF, once per job order, cached on the job
//     (migration 042). The per-candidate sentence is assembled here, for free,
//     from the match engine's `reasons` — which are read off that person's own
//     resume and are therefore true by construction. 25 candidates cost the
//     same as one.
//
//   • The body keeps {{sender}} / {{senderemail}} UNRENDERED, because these
//     emails are QUEUED and drained later. The mailbox that actually sends is
//     resolved at send time. Baking a name in at queue time is how 152 cold
//     emails went out saying "I'm Jennifer Thomas" over Prince Thomas's From
//     line (Session 14). This is the one rule in the file that is not about
//     prose.
// ============================================================================

const txt = (v) => String(v == null ? '' : v).trim();
const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// The two tokens the send path fills. Everything else inside {{ }} is a bug
// that reaches the recipient verbatim — which is exactly why the checker below
// allows these two by name rather than allowing "{{" generally.
const SENDER_TOKEN = '{{sender}}';
const SENDER_TOKENS = /\{\{\s*(sender|senderemail)\s*\}\}/g;

function firstNameOf(name) {
  const n = txt(name);
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

// ── WHAT THE JOB ACTUALLY OFFERS ───────────────────────────────────────────
// Read once per job, reused for every candidate on it. Every field is optional
// because a job order filled in by hand usually is: the writer must degrade to
// a shorter, honest email rather than printing a blank.
function jobFacts(jobOrder) {
  const j = jobOrder || {};
  const place = [txt(j.city), txt(j.state)].filter(Boolean).join(', ') ||
                txt(j.location) || txt(j.country);
  const company = txt(j.client) || txt(j.company_name) ||
                  txt(j.company && j.company.name) || '';
  const skills = String(j.primary_skills || '')
    .split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);

  // PAY IS PRINTED ONLY IF IT IS ON THE JOB ORDER. A number we invented and
  // cannot honour loses a candidate permanently, and it is the single most
  // damaging thing this feature could get wrong — so the writer has no way to
  // produce one, and checkCandidateDraft refuses a draft that contains a
  // figure this function did not return.
  const min = money(j.pay_min), max = money(j.pay_max);
  const cur = txt(j.pay_cur) || 'USD';
  let pay = '';
  if (min && max) pay = `${cur} ${min}-${max}`;
  else if (min) pay = `${cur} ${min}+`;
  else if (max) pay = `up to ${cur} ${max}`;

  const terms = [];
  if (txt(j.job_type)) terms.push(txt(j.job_type));
  if (txt(j.remote)) terms.push(txt(j.remote));
  if (txt(j.duration)) terms.push(txt(j.duration));

  return {
    id: j.id || null,
    title: txt(j.job_title),
    company, place, pay, terms, skills,
    payFigures: payFiguresIn(pay),
    description: txt(j.job_description),
    workAuth: txt(j.work_auth),
    clearance: txt(j.clearance),
  };
}

// "110000" -> "110,000". A bare six-digit run reads as a reference number
// rather than a salary, and the difference matters in the one sentence a
// candidate will look at hardest.
function money(v) {
  const raw = txt(v);
  if (!/^\d+$/.test(raw)) return raw;           // already formatted, or not a plain number
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Every number that legitimately appears in a pay string, so the checker can
// tell "the range from the job order" from "a number the model made up".
function payFiguresIn(pay) {
  return (String(pay || '').match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]/g, ''));
}

// ── WHY THIS PERSON ────────────────────────────────────────────────────────
// The match engine already produced these sentences ("Skills overlap: Procore,
// OSHA 30", "8 years experience fits the 5-10 asked for"). They are grounded in
// the candidate's own record, so turning them into a clause costs nothing and
// cannot hallucinate. This is the whole personalisation budget, and it is free.
function whyYouClause(reasons, candidate) {
  const list = (reasons || []).map(txt).filter(Boolean);
  const c = candidate || {};

  // The matcher's phrasing is written for a recruiter reading a grid ("Skills
  // overlap: X, Y"). Said to the candidate it has to sound like a person.
  const skillLine = list.find(r => /skill/i.test(r));
  if (skillLine) {
    // NEVER LOWERCASE THIS. The matcher's skills are proper nouns as often as
    // not — "Procore", "OSHA 30", "AutoCAD" — and "your background in procore,
    // osha 30" tells the reader immediately that a machine wrote it. Split and
    // rejoin instead, so the list reads as English.
    const after = skillLine.replace(/^[^:]*:\s*/, '').trim();
    const parts = after.split(/[,;]+/).map(t => t.trim()).filter(Boolean).slice(0, 3);
    if (parts.length) return `your background in ${joinList(parts)}`;
  }
  const yrs = Number(c.experience_years);
  if (Number.isFinite(yrs) && yrs > 0) {
    const title = txt(c.current_title);
    return title
      ? `your ${yrs} years as ${indefinite(title)}`
      : `your ${yrs} years in the field`;
  }
  if (txt(c.current_title)) return `your work as ${indefinite(txt(c.current_title))}`;
  const titleLine = list.find(r => /title|role/i.test(r));
  if (titleLine) return 'what you are doing now';
  return '';
}

function indefinite(word) {
  const w = txt(word);
  if (!w) return w;
  return (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
}

// ── THE ANGLES ─────────────────────────────────────────────────────────────
// Same lesson the client generator learned the hard way: without an explicit
// `never`, every angle converges on the strongest available material and the
// picker becomes four paraphrases of one email. Each one here is allowed to do
// something the others may not.
const ANGLE_BRIEF = {
  direct: {
    label: 'Direct',
    blurb: 'The role, why you thought of them, and the question.',
    words: [75, 130],
    must: 'Name the role and where it is, say in one clause why this person specifically came to mind, give the terms that are actually known, and end on the yes/no question.',
    never: 'Do NOT open with pay. Do NOT list every requirement in the posting. Do NOT describe the client company at length.',
  },
  short: {
    label: 'Short',
    blurb: 'Three sentences, for someone who will not read more.',
    words: [35, 75],
    must: 'Three sentences after the greeting, at most. The role, one clause on why them, the question. Nothing else earns its place.',
    never: 'Do NOT explain the company, the terms, the process or the market. Do NOT name more than one credential.',
  },
  specifics: {
    label: 'The terms',
    blurb: 'Leads on pay, location and shape — when those are the draw.',
    words: [70, 120],
    must: 'Lead with what is concretely on offer — pay, location, contract shape, start — because for this role the terms are the reason to read on. Only state terms that are actually given.',
    never: 'Do NOT invent, round, or estimate a pay figure, a start date or a duration. If the pay is not given, do not imply one exists.',
  },
  nurture: {
    label: 'Keeping in touch',
    blurb: 'No specific job — are they open at all?',
    words: [45, 90],
    must: 'Ask whether they are open to hearing about roles at the moment, and make saying "not right now" easy and consequence-free.',
    never: 'Do NOT mention a specific job, client, title, location or pay — there is no job attached to this email, and a job variable printed empty is worse than one omitted.',
  },
};

function angleBrief(id) { return ANGLE_BRIEF[id] || null; }

// ── THE JOB BRIEF ──────────────────────────────────────────────────────────
// Two or three sentences about the role that read like a person describing it,
// written ONCE per job order. The rules version below is what production
// actually runs on when no AI provider is configured — it is the product, not a
// degraded mode, exactly as on the client side.
function rulesJobBrief(job) {
  const f = jobFacts(job);
  const bits = [];
  if (f.title) {
    const at = f.company ? ` with ${f.company}` : '';
    const at2 = f.place ? ` in ${f.place}` : '';
    bits.push(`They are hiring ${indefinite(f.title)}${at}${at2}.`);
  }
  // THE TERMS ARE NOT IN THE BRIEF. `termsLine` prints them, and a brief that
  // also carried them produced "It is Full-time." twice in the same email —
  // caught the first time this writer was run against a real job order.
  return {
    hook: bits.join(' ') || 'A role has come up that may be worth a look.',
    detail: f.skills.length ? `The work centres on ${joinList(f.skills.slice(0, 3))}.` : '',
    engine: 'rules',
  };
}

function buildBriefSystemPrompt() {
  return [
    'You are helping a recruiter describe one open role to candidates who might want it.',
    'You are given a job order from the recruiter\'s own database. You produce a SHORT description of the role, written to be read by a candidate, not by a client.',
    '',
    'RULES:',
    '1. Two or three plain sentences. This text is dropped into an email that already has a greeting and a sign-off, so write only the middle.',
    '2. Say what the work actually is. A candidate decides on the work, not on adjectives.',
    '3. Use ONLY facts present in the job order. Never invent a pay figure, a start date, a duration, a benefit, a team size or a company detail. If pay is not given, do not mention pay at all.',
    '4. No marketing language (exciting, dynamic, fast-paced, passionate, rockstar, world-class), no exclamation marks, no emoji.',
    '5. Do not greet, do not sign off, do not address the reader by name — that is the surrounding email\'s job.',
    '6. Do not promise anything on the employer\'s behalf: no "great culture", no "excellent benefits", no "room to grow" unless the job order says so in those terms.',
    '7. If the job order is thin, write less. Two honest sentences beat four padded ones.',
    '',
    'Return ONLY valid JSON, no markdown fences, in exactly this shape:',
    '{"hook": "the first sentence or two — what the role is", "detail": "one further sentence of substance, or an empty string if there is nothing real to add"}',
  ].join('\n');
}

function buildBriefPayload(job) {
  const f = jobFacts(job);
  const lines = [];
  lines.push('JOB TITLE: ' + (f.title || '(not given)'));
  lines.push('CLIENT: ' + (f.company || '(not given)'));
  lines.push('LOCATION: ' + (f.place || '(not given)'));
  lines.push('PAY: ' + (f.pay || '(not given — do not mention pay)'));
  lines.push('SHAPE: ' + (f.terms.length ? f.terms.join(', ') : '(not given)'));
  lines.push('SKILLS ON THE ORDER: ' + (f.skills.length ? f.skills.join(', ') : '(not given)'));
  if (f.workAuth) lines.push('WORK AUTHORISATION: ' + f.workAuth);
  if (f.clearance) lines.push('CLEARANCE: ' + f.clearance);
  lines.push('');
  lines.push('JOB DESCRIPTION:');
  lines.push(f.description || '(none on the order — write from the fields above only)');
  return lines.join('\n');
}

function parseBrief(text) {
  const raw = String(text || '').replace(/```json|```/g, '').trim();
  if (!raw) return null;
  const tries = [raw];
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
  for (const t of tries) {
    try {
      const p = JSON.parse(t);
      if (p && txt(p.hook)) return { hook: txt(p.hook), detail: txt(p.detail), engine: 'ai' };
    } catch (_) { /* try the next shape */ }
  }
  return null;
}

// A brief is written by a model and then read by every candidate on the job, so
// it is checked once, here, rather than 25 times downstream.
function checkBrief(brief, job) {
  const b = brief || {};
  const f = jobFacts(job);
  const body = [txt(b.hook), txt(b.detail)].filter(Boolean).join(' ');
  const v = [];
  const add = (code, instruction) => v.push({ code, instruction });

  if (!txt(b.hook)) { add('empty', 'Return the role description in the "hook" field.'); return { ok: false, violations: v }; }
  if (/!/.test(body)) add('exclamation', 'Remove every exclamation mark.');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body)) add('emoji', 'Remove the emoji.');
  const mk = body.match(MARKETING_WORDS);
  if (mk) add('marketing_word', `Remove "${mk[0]}" and any other marketing adjective. Describe the work instead.`);
  if (/\{\{/.test(body)) add('placeholder', 'Remove the {{...}} placeholder and write the real word.');
  const money = unsupportedMoney(body, f.payFigures);
  if (money) add('invented_pay', `The job order does not carry the figure ${money}. Remove every pay number that is not on the order.`);
  if (wordCount(body) > 90) add('too_long', `Two or three sentences. Yours is ${wordCount(body)} words — cut it.`);
  if (/\b(hi|hello|dear)\b[\s,]/i.test(body.slice(0, 12))) add('greeting', 'Do not greet the reader — the surrounding email already does.');

  return { ok: v.length === 0, violations: v };
}

// ── THE EMAIL ──────────────────────────────────────────────────────────────
// One candidate, one job, one angle. The sender's name is a TOKEN, not a value:
// see the header note. `signOff` mirrors the client generator — "Thanks," alone
// when a mailbox signature will be appended, a full close when none will.
function draftParts(input, options) {
  const i = input || {};
  const o = options || {};
  const c = i.candidate || {};
  const f = jobFacts(i.job);
  const brief = i.brief || (i.job ? rulesJobBrief(i.job) : { hook: '', detail: '' });

  return {
    first: firstNameOf(c.full_name || c.first_name),
    co: txt(o.companyName) || 'our team',
    job: f,
    hook: txt(brief.hook),
    detail: txt(brief.detail),
    why: whyYouClause(i.reasons, c),
    roleLabel: f.title || 'a role',
    at: f.company ? ` with ${f.company}` : '',
    inPlace: f.place ? ` in ${f.place}` : '',
    payLine: f.pay ? `The range on it is ${f.pay}.` : '',
    termsLine: f.terms.length ? `It is ${joinList(f.terms)}.` : '',
    // The opt-out. In step 1 it is a sentence; step 2 replaces it with the
    // one-click Interested / Not interested buttons. Either way it is not
    // optional — a mass email to candidates without a way out is not one we
    // should be sending.
    outLine: 'If the timing is not right, just say so and I will leave it there.',
    signOff: o.omitSignOff
      ? '\n\nThanks,'
      : '\n\n' + ['Thanks,', SENDER_TOKEN].join('\n'),
  };
}

function joinList(items) {
  const a = (items || []).map(txt).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

// TWO KINDS OF NOTHING, AND CONFLATING THEM COST THE PARAGRAPHS.
//   null  = "this line does not apply" (no why-clause, no pay on the order) — drop it
//   ''    = a deliberate blank line between paragraphs — KEEP it
// Filtering out '' as well collapsed every email to single-spaced sentences,
// which is only visible in a screenshot, never in a word count or a check.
function assemble(p, paras) {
  return paras.filter(x => x !== null && x !== undefined).join('\n') + p.signOff;
}

const VARIANTS = [
  {
    id: 'direct',
    subject: (p) => p.job.title + (p.job.place ? ' — ' + p.job.place : ''),
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. ' + p.hook,
      p.detail || null,
      '',
      (p.why
        ? 'I came to you because of ' + p.why + ', which lines up with what they are asking for.'
        : 'Your profile lines up with what they are asking for.'),
      [p.payLine, p.termsLine].filter(Boolean).join(' ') || null,
      '',
      'Would you be interested in hearing more about it?',
      p.outLine,
    ]),
  },
  {
    id: 'short',
    subject: (p) => p.job.title + ' — worth a look?',
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. There is ' + indefinite(p.roleLabel) +
        ' open' + p.at + p.inPlace + '.',
      (p.why ? 'It came to mind because of ' + p.why + '.' : null),
      '',
      // THE RULES WRITER MUST NEVER FAIL checkCandidateDraft. The first version
      // of this angle had no way out and the checker rejected our own text —
      // which would have meant the shortest angle silently never shipping. An
      // opt-out is mandatory on every angle, so the short one gets a short one.
      'Interested in hearing more? If not, just say so.',
    ]),
  },
  {
    id: 'specifics',
    subject: (p) => p.job.title + (p.job.pay ? ' — ' + p.job.pay : (p.job.place ? ' — ' + p.job.place : '')),
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. Quick one on ' + indefinite(p.roleLabel) +
        p.at + p.inPlace + '.',
      '',
      [p.payLine, p.termsLine].filter(Boolean).join(' ') ||
        'The terms are still being confirmed, and I will send them across as soon as I have them.',
      // The DETAIL (what the work is), never the hook — this angle's own opener
      // already named the role, the client and the place, and repeating the
      // hook printed all three twice.
      p.detail || null,
      '',
      (p.why ? 'You came to mind because of ' + p.why + '.' : null),
      'Interested?',
      p.outLine,
    ]),
  },
];

// No job attached. Every job variable would render empty, so this is a
// different email rather than the same one with blanks — the same reasoning
// behind DEFAULT_CANDIDATE_NURTURE_EMAIL in routes/recruiting/outreach.js.
const NURTURE_VARIANT = {
  id: 'nurture',
  subject: () => 'Keeping in touch',
  build: (p) => assemble(p, [
    'Hi ' + p.first + ',', '',
    'This is ' + SENDER_TOKEN + ' at ' + p.co + '. Checking in to see how things are going. Are you open to hearing about new roles at the moment?',
    '',
    'If the timing is not right, just say so and I will leave it a while.',
  ]),
};

function rulesVariants(input, options) {
  const i = input || {};
  const p = draftParts(i, options);
  const set = (i.outreach_type === 'nurture' || !i.job) ? [NURTURE_VARIANT] : VARIANTS;
  return set.map(v => {
    const email = v.build(p);
    const brief = ANGLE_BRIEF[v.id] || {};
    return {
      id: v.id, label: brief.label || v.id, blurb: brief.blurb || '',
      subject: v.subject(p), email, words: wordCount(email), mode: 'rules',
    };
  });
}

/** What the caller must supply before anything can be written. */
function validateInput(input) {
  const i = input || {};
  const c = i.candidate || {};
  const missing = [];
  if (!txt(c.full_name) && !txt(c.first_name)) missing.push('candidate name');
  if (!txt(c.email)) missing.push('candidate email');
  if (i.outreach_type !== 'nurture') {
    if (!i.job) missing.push('job');
    else if (!txt((i.job || {}).job_title)) missing.push('job title');
  }
  return { ok: missing.length === 0, missing };
}

// ── THE HOUSE-STYLE CHECK ──────────────────────────────────────────────────
// A prompt rule is a request; this is the guarantee. Mechanical only — it never
// scores prose. A dull email passes; one that invents a salary, claims
// experience the candidate does not have, or leaves a stray {{token}} does not.
//
// The rules for a CANDIDATE email are not the client rules with the names
// swapped. Fee language is right on a client email and wrong here. An opt-out
// is optional there and mandatory here. And the two facts a candidate cannot
// answer without — what the job is and where it is — must be present.
const MARKETING_WORDS = /\b(exciting|passionate|dynamic|exceptional|fast[- ]paced|cutting[- ]edge|seamless|world[- ]class|rock ?star|synergy|best[- ]in[- ]class|unparalleled|game[- ]chang\w+|once[- ]in[- ]a[- ]lifetime)\b/i;
const FEE_WORDS = /\b(placement fee|our fee|commission|contingency|no charge for reviewing|retainer)\b/i;
const OPT_OUT = /\b(not right|no(?:t)? interested|say so|not the right time|timing is not|leave it|unsubscribe|opt out|let me know and I(?:'| wi)ll)\b/i;

function sentencesOf(body) {
  return String(body || '').split(/(?<=[.?!])\s+|\n+/).map(t => t.trim()).filter(Boolean);
}

// Any money-shaped figure in the text that the job order does not carry. Bare
// years ("8 years") are not money and are handled separately.
//
// FOUR SHAPES, AND MISSING ONE MAKES THE WHOLE CHECK DECORATIVE. The first
// version only looked for a symbol prefix or a number FOLLOWED by a currency
// code — so "USD 200,000", the exact shape jobFacts() itself emits, sailed
// straight through. A checker with a hole in it is worse than none, because it
// reports a clean draft.
const MONEY_SHAPES = [
  // $120,000 · £95k · ₹18,00,000
  /[$£€₹]\s?\d[\d,.]*(?:\s?[kKmM])?/g,
  // USD 110,000  ·  110,000 USD
  /\b(?:USD|INR|EUR|GBP|CAD|AUD)\s?\d[\d,.]*(?:\s?[kKmM])?/gi,
  /\b\d[\d,.]*(?:\s?[kKmM])?\s?(?:USD|INR|EUR|GBP|CAD|AUD)\b/gi,
  // 65 per hour · 120,000 a year
  /\b\d[\d,.]*\s?(?:per|an?)\s?(?:hour|hr|year|yr|annum|month)\b/gi,
  // A bare figure that can only be money: comma-grouped, or five digits and up.
  // Deliberately NOT any bare number — "OSHA 30" and "9 years" must pass, and
  // they do, because both are under the threshold and carry no separator.
  /\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/g,
];

function unsupportedMoney(email, allowed) {
  const ok = new Set(allowed || []);
  const text = String(email || '');
  for (const re of MONEY_SHAPES) {
    re.lastIndex = 0;
    const found = text.match(re) || [];
    for (const f of found) {
      const n = (f.match(/\d[\d,.]*/) || [''])[0].replace(/[,.]/g, '');
      if (!ok.has(n)) return f.trim();
    }
  }
  return null;
}

function checkCandidateDraft(draft, input, opts) {
  const d = draft || {};
  const i = input || {};
  const o = opts || {};
  const c = i.candidate || {};
  const f = jobFacts(i.job);
  const email = txt(d.email);
  const subject = txt(d.subject);
  const v = [];
  const add = (code, instruction) => v.push({ code, instruction });

  if (!email) { add('empty', 'Return the full email body in the "email" field.'); return { ok: false, violations: v }; }

  // {{sender}} AND {{senderemail}} ARE LEGAL HERE AND NOWHERE ELSE IS. The
  // client generator sends immediately and so rejects every {{, but these
  // emails are queued and the sender is resolved at send time — the tokens are
  // load-bearing. Strip exactly those two, then anything still wrapped in
  // braces is a template leak that a candidate would read verbatim.
  const residue = email.replace(SENDER_TOKENS, '') + ' ' + subject.replace(SENDER_TOKENS, '');
  if (/\{\{/.test(residue)) {
    add('placeholder', 'Remove the {{...}} placeholder and write the real word. Only {{sender}} and {{senderemail}} may remain.');
  }

  const angle = o.angle && ANGLE_BRIEF[o.angle] ? ANGLE_BRIEF[o.angle] : null;
  const words = wordCount(email);
  if (angle) {
    if (words > angle.words[1] + 25) {
      add('too_long', `The "${angle.label}" angle should run ${angle.words[0]}-${angle.words[1]} words. Yours is ${words}. Cut it back.`);
    } else if (words < angle.words[0] - 15 && materialIn(i) >= 3) {
      // A MINIMUM LENGTH IS AN INSTRUCTION TO INVENT WHEN THERE ARE NO FACTS.
      // The lower bound exists to stop a model being lazy with a rich job
      // order — not to demand four sentences about a job order carrying only a
      // title. Enforcing it on thin input would push the writer towards exactly
      // what invented_pay and invented_experience are here to prevent, and it
      // rejected this file's own rules drafts the first time it ran.
      add('too_short', `The "${angle.label}" angle should run ${angle.words[0]}-${angle.words[1]} words. Yours is ${words} — there is not enough there to answer.`);
    }
  }

  if (/!/.test(email)) add('exclamation', 'Remove every exclamation mark. Plain sentences only.');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(email)) add('emoji', 'Remove the emoji.');
  const mk = email.match(MARKETING_WORDS);
  if (mk) add('marketing_word', `Remove the word "${mk[0]}" and any other marketing adjective. Describe the work instead.`);

  // Fee talk is the CLIENT email's vocabulary. Said to a candidate it reads as
  // "you are the product", which is the fastest way to lose one.
  const fee = email.match(FEE_WORDS);
  if (fee) add('fee_language', `Remove "${fee[0]}". Fees are between us and the client and have no place in a candidate email.`);

  // THE ONE THAT MATTERS MOST. A pay figure we invented and cannot honour is
  // not a style problem — the candidate finds out at offer stage and we lose
  // them and their referrals.
  const money = unsupportedMoney(email, f.payFigures);
  if (money) {
    add('invented_pay', f.pay
      ? `The job order says ${f.pay}. Remove "${money}" — quote the range on the order or no figure at all.`
      : `The job order carries no pay information, so remove "${money}" entirely. Never imply a figure we have not been given.`);
  }

  // Claimed experience must match the record. The matcher's reasons come off
  // the candidate's own resume, so anything else is the model filling a gap.
  const claimed = email.match(/\b(\d{1,2})\+?\s*years?\b/i);
  if (claimed) {
    const yrs = Number(c.experience_years);
    if (!Number.isFinite(yrs) || Math.abs(yrs - Number(claimed[1])) > 1) {
      add('invented_experience', Number.isFinite(yrs)
        ? `The record says ${yrs} years, not ${claimed[1]}. Use the real number or drop the claim.`
        : `We do not know how long they have been doing this, so remove "${claimed[0]}". Never tell someone about their own career.`);
    }
  }

  if (i.outreach_type !== 'nurture') {
    // A candidate cannot answer "are you interested" without knowing what and
    // where. Both are on the job order, so there is no excuse for either
    // being missing.
    if (f.title && !new RegExp(escapeRe(f.title), 'i').test(email + ' ' + subject)) {
      add('missing_role', `Name the role — "${f.title}" — in the email or the subject. They cannot answer without it.`);
    }
    if (f.place && !new RegExp(escapeRe(f.place.split(',')[0].trim()), 'i').test(email + ' ' + subject)) {
      add('missing_location', `Say where the job is (${f.place}). Location decides the answer more often than anything else.`);
    }
  }

  const questions = sentencesOf(email).filter(t => t.includes('?'));
  if (!questions.length) add('no_ask', 'End with a plain question asking whether they are interested.');

  if (!OPT_OUT.test(email) && !o.hasButtons) {
    add('no_optout', 'Give them an explicit, one-line way to say no. A mass email to candidates without a way out is not one we should send.');
  }

  // The mailbox signature is appended after this text. A second sign-off is
  // visible to the recipient, and this app has shipped one before.
  if (o.omitSignOff) {
    const closing = /\n\s*(thanks|best regards|kind regards|warm regards|regards|sincerely|cheers)\s*,?\s*/gi;
    let last = null, m;
    while ((m = closing.exec(email)) !== null) last = m;
    if (last) {
      if (!/^thanks/i.test(last[1])) add('double_signoff', 'Close with "Thanks," and nothing else — a signature is appended automatically.');
      const after = email.slice(last.index + last[0].length).replace(SENDER_TOKENS, '').trim();
      if (after) add('double_signoff_name', `Delete everything after "Thanks," — the appended signature already carries the name and title. Remove: "${after.split(/\n/)[0].slice(0, 40)}"`);
    }
  }

  // A candidate email with no greeting reads as a mailshot, which is exactly
  // what it must not read as. Same failure the client generator hit live.
  const first = firstNameOf(c.full_name || c.first_name);
  const opening = email.split(/\n/).find(l => l.trim()) || '';
  if (first && first !== 'there' && !new RegExp('\\b' + escapeRe(first) + '\\b', 'i').test(opening)) {
    add('no_greeting', `Open with a greeting line addressing them by first name — "Hi ${first}," — before the first sentence.`);
  }

  if (subject.length > 90) add('subject_long', 'Shorten the subject line to something that fits in an inbox list.');

  return { ok: v.length === 0, violations: v };
}

function escapeRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// How much there actually is to write about. Counts only facts a candidate
// would care about — not fields that happen to be non-null.
function materialIn(input) {
  const i = input || {};
  const f = jobFacts(i.job);
  let n = 0;
  if (f.title) n++;
  if (f.company) n++;
  if (f.place) n++;
  if (f.pay) n++;
  if (f.terms.length) n++;
  if (f.skills.length) n++;
  if (whyYouClause(i.reasons, i.candidate)) n++;
  return n;
}

module.exports = {
  ANGLE_BRIEF, angleBrief,
  jobFacts, payFiguresIn, whyYouClause,
  rulesJobBrief, buildBriefSystemPrompt, buildBriefPayload, parseBrief, checkBrief,
  rulesVariants, draftParts, validateInput, checkCandidateDraft,
  unsupportedMoney, MONEY_SHAPES, materialIn, firstNameOf, wordCount, joinList, indefinite,
  SENDER_TOKENS,
};
