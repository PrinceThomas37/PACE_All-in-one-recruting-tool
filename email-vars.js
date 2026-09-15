/**
 * Shared email template variables and outreach style variants (O1 + FU1 + FU2).
 */

const DEFAULT_TEMPLATES = {
  o1_subject: 'Candidates for your {{pos}} role in {{loc}}',
  o1_body: `Hi {{fn}},

I'm {{sender}} with Fute Global LLC. I came across your {{pos}} opening in {{loc}} and read through the requirements, and we have several people with {{job_resp}} experience on {{company_service}} work who look like a strong fit. They're open to direct hire and haven't been screened for your role yet.

Would you like to review their resumes?

Looking forward to your thoughts.`,
  fu1_subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
  fu1_body: `Hi {{fn}},

Circling back on your {{pos}} role in {{loc}}. Those candidates with {{job_resp}} experience on {{company_service}} projects are still available.

Want me to send their resumes over?

Looking forward to your thoughts.`,
  fu2_subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
  fu2_body: `Hi {{fn}},

I'll keep this short. Still holding a few screened-ready candidates with {{job_resp}} backgrounds for your {{pos}} opening in {{loc}} whenever the timing suits.

Shall I share their resumes?

Looking forward to your thoughts.`
};

/**
 * Five matched outreach styles — each with O1, FU1, and FU2.
 * Keep in sync with OUTREACH_STYLE_PRESETS in public/index.html.
 */
const OUTREACH_VARIANTS = [
  {
    id: 'v1',
    label: 'Introduction',
    o1: {
      subject: 'Candidates for your {{pos}} role in {{loc}}',
      body: `Hi {{fn}},

I'm {{sender}} with Fute Global LLC. I came across your {{pos}} opening in {{loc}} and read through the requirements, and we have several people with {{job_resp}} experience on {{company_service}} work who look like a strong fit. They're open to direct hire and haven't been screened for your role yet.

Would you like to review their resumes?

Looking forward to your thoughts.`
    },
    fu1: {
      subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
      body: `Hi {{fn}},

Circling back on your {{pos}} role in {{loc}}. Those candidates with {{job_resp}} experience on {{company_service}} projects are still available.

Want me to send their resumes over?

Looking forward to your thoughts.`
    },
    fu2: {
      subject: 'Re: Candidates for your {{pos}} role in {{loc}}',
      body: `Hi {{fn}},

I'll keep this short. Still holding a few screened-ready candidates with {{job_resp}} backgrounds for your {{pos}} opening in {{loc}} whenever the timing suits.

Shall I share their resumes?

Looking forward to your thoughts.`
    }
  },
  {
    id: 'v2',
    label: 'Candidates first',
    o1: {
      subject: '{{pos}} in {{loc}}: a few resumes worth a look',
      body: `Hi {{fn}},

A few direct-hire candidates with strong {{job_resp}} experience on {{company_service}} projects just became available, and they line up well with your {{pos}} opening in {{loc}}.

Should I send their resumes across?

Happy to share whenever you're ready.`
    },
    fu1: {
      subject: 'Re: {{pos}} in {{loc}}: a few resumes worth a look',
      body: `Hi {{fn}},

Quick nudge on this. The {{job_resp}} candidates I mentioned for your {{pos}} role in {{loc}} are still on the market.

Should I pass along their resumes?

Happy to share whenever you're ready.`
    },
    fu2: {
      subject: 'Re: {{pos}} in {{loc}}: a few resumes worth a look',
      body: `Hi {{fn}},

Last note from me on the {{pos}} opening in {{loc}}. Happy to forward those {{company_service}} candidates' resumes if it's useful.

Happy to share whenever you're ready.`
    }
  },
  {
    id: 'v3',
    label: 'Question opener',
    o1: {
      subject: 'A question about your {{pos}} opening in {{loc}}',
      body: `Hi {{fn}},

Is your {{pos}} role in {{loc}} still open? I ask because I'm {{sender}} at Fute Global LLC, and after reading the job description I have a shortlist of people with {{job_resp}} experience on {{company_service}} projects who fit it well. They're direct-hire ready and haven't been put in front of you yet.

Open to a quick look at a couple of profiles?

No rush at all. Just let me know.`
    },
    fu1: {
      subject: 'Re: A question about your {{pos}} opening in {{loc}}',
      body: `Hi {{fn}},

Following up in case my earlier note slipped by. I still have those {{job_resp}} candidates lined up for your {{pos}} role in {{loc}}.

Worth a quick look at a couple of profiles?

No rush at all. Just let me know.`
    },
    fu2: {
      subject: 'Re: A question about your {{pos}} opening in {{loc}}',
      body: `Hi {{fn}},

One final check-in on the {{pos}} role in {{loc}}. If it's still active, I'd be glad to share a couple of {{company_service}} profiles for your review.

No rush at all. Just let me know.`
    }
  },
  {
    id: 'v4',
    label: 'Concise',
    o1: {
      subject: '{{pos}} ({{loc}}): direct-hire candidates available',
      body: `Hi {{fn}},

Saw your {{pos}} opening in {{loc}}. We've got candidates with hands-on {{job_resp}} experience on {{company_service}} work, ready for direct hire and your screening, no obligation to proceed.

Want me to forward a few resumes?

Appreciate you taking a look.`
    },
    fu1: {
      subject: 'Re: {{pos}} ({{loc}}): direct-hire candidates available',
      body: `Hi {{fn}},

Following up. The {{job_resp}} candidates for your {{pos}} role in {{loc}} are still available for review.

Want me to forward a few resumes?

Appreciate you taking a look.`
    },
    fu2: {
      subject: 'Re: {{pos}} ({{loc}}): direct-hire candidates available',
      body: `Hi {{fn}},

Final follow-up on {{pos}} in {{loc}}. Happy to forward those resumes whenever you'd like to take a look.

Appreciate you taking a look.`
    }
  },
  {
    id: 'v5',
    label: 'Direct value',
    o1: {
      subject: 'Direct-hire talent for your {{pos}} need in {{loc}}',
      body: `Hi {{fn}},

I'm {{sender}}, and at Fute Global LLC we place direct-hire talent. Your {{pos}} opening in {{loc}} stood out, and we currently have candidates with solid {{job_resp}} experience on {{company_service}} projects who match what the role calls for, available for your screening at no cost or commitment.

Is it worth sharing their resumes with you?

I'll keep an eye out for your reply.`
    },
    fu1: {
      subject: 'Re: Direct-hire talent for your {{pos}} need in {{loc}}',
      body: `Hi {{fn}},

Wanted to resurface this. The candidates with {{job_resp}} experience on {{company_service}} work are still available for your {{pos}} role in {{loc}}.

Is it worth sharing their resumes?

I'll keep an eye out for your reply.`
    },
    fu2: {
      subject: 'Re: Direct-hire talent for your {{pos}} need in {{loc}}',
      body: `Hi {{fn}},

I'll leave it here for now, but the {{job_resp}} candidates remain ready whenever your {{pos}} search in {{loc}} calls for them.

Glad to share resumes at any point.`
    }
  }
];

/** @deprecated Use OUTREACH_VARIANTS — kept for callers expecting flat subject/body */
const OUTREACH_O1_VARIANTS = OUTREACH_VARIANTS.map(v => ({
  id: v.id,
  label: v.label,
  subject: v.o1.subject,
  body: v.o1.body
}));

function getVariantById(id) {
  const key = String(id || '').trim();
  return OUTREACH_VARIANTS.find(v => v.id === key) || OUTREACH_VARIANTS[0];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deal full style variants from a shuffled deck — each used once before any repeat. */
function buildRotatingTemplateDeck(count, variants = OUTREACH_VARIANTS) {
  const deck = [];
  while (deck.length < count) {
    deck.push(...shuffleInPlace([...variants]));
  }
  return deck.slice(0, count);
}

function isRandomTemplateMode(value) {
  return value === 'true' || value === true;
}

function formatJobResp(skills) {
  const list = (skills || []).filter(Boolean).slice(0, 3);
  if (!list.length) return 'the key requirements';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function formatCompanyService(industry) {
  const val = String(industry || '').trim();
  return val || 'relevant';
}

function formatSkillsLine(skills) {
  const list = (skills || []).filter(Boolean).slice(0, 3);
  if (!list.length) return '';
  if (list.length === 1) return ` with experience in ${list[0]}`;
  if (list.length === 2) return ` with experience in ${list[0]} and ${list[1]}`;
  return ` with experience in ${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

const SENDER_JOB_TITLE = 'Recruitment Manager';

function normalizeSenderTitle(text) {
  return String(text || '')
    .replace(/BD Manager at Fute Global LLC/gi, `${SENDER_JOB_TITLE} at Fute Global LLC`)
    .replace(/BD Manager \|/gi, `${SENDER_JOB_TITLE} |`);
}

// ── ONE TEMPLATE VOCABULARY ──────────────────────────────────────────────────
// PACE grew two merge-variable vocabularies that fill from two different
// builders: the sales side (`buildEmailVars` here — fn/pos/company/loc) and the
// recruiting side (`buildCandidateVars` in routes/recruiting/outreach.js —
// first_name/position/client). Both are filled by THIS function, and until now
// a name from the wrong list was left on the page exactly as typed.
//
// That is not theoretical. The default sequence seeded by migration 007 carries
// "Hi {{first_name}}, I emailed you about the {{position}} role at {{company}}"
// on its BD-touch step, which runs through the SALES builder — so every task it
// has ever created read "Hi {{first_name}}, I emailed you about the
// {{position}} role at KB Home", with only the one name both lists share filled
// in. The sequence builder's own hint text tells people to write
// `{{first_name}} {{position}} {{client}}`, so the UI was actively teaching the
// vocabulary that does not work here.
//
// Each row below is one fact under several names. A DIRECT hit always wins, so
// a builder that defines both `company` and `client` as different things (the
// recruiting one does) is unaffected — an alias is consulted only when the name
// the template used is absent entirely.
const VAR_SYNONYMS = [
  ['fn', 'first_name', 'firstname'],
  ['ln', 'last_name', 'lastname', 'surname'],
  ['pos', 'position', 'job_title', 'jobtitle', 'role'],
  ['company', 'client', 'company_name', 'companyname'],
  ['loc', 'location', 'city_state'],
  ['desig', 'designation', 'title'],
  ['ind', 'industry'],
  ['sender', 'sender_name', 'sendername', 'from_name'],
  ['senderemail', 'sender_email', 'senderemailaddress', 'from_email']
];

// name → [every name for the same fact, canonical first]
const VAR_GROUP = (() => {
  const map = {};
  VAR_SYNONYMS.forEach(group => group.forEach(name => { map[name] = group; }));
  return map;
})();

// Tokens that are SUPPOSED to survive queueing — the sender identity is
// resolved at send time, from the mailbox that actually sends (see
// DEFER_SENDER below). Everything else still in braces is a hole.
const SEND_TIME_VARS = new Set(['sender', 'senderemail']);

/**
 * Resolve one `{{token}}` against a variable map, trying the token itself and
 * then every synonym of it.
 *
 * Returns `{ value }` when it resolved, `{ defer: canonicalName }` when the
 * fact exists but is deliberately null — that is the DEFER_SENDER convention,
 * and the canonical name matters: the send path fills `{{sender}}`, not
 * `{{sender_name}}`, so an aliased deferred token is rewritten to the name the
 * send path knows. Returns null when nothing matched.
 */
function resolveVar(vars, key) {
  const names = VAR_GROUP[key] || [key];
  // THE KEY THE TEMPLATE ACTUALLY USED IS TRIED FIRST, ALWAYS. Iterating the
  // group in its own order instead made `{{client}}` resolve to `company`
  // whenever both were defined — and on the recruiting side they are two
  // different facts (the end client vs. the company on the record), so a
  // template asking for one would have printed the other. An alias may only
  // ever fill a name the variable map does not define.
  const tried = [key, ...names.filter(n => n !== key)];
  for (const name of tried) {
    if (vars[name] === undefined) continue;
    if (vars[name] === null) return { defer: names[0] };
    return { value: vars[name] };
  }
  // Nothing defined it. If the fact is one the SEND path fills — the sender
  // identity — the token still has a future, so normalise it to the name that
  // path looks for. `{{sender_email}}` left as typed is a token nothing in PACE
  // fills, i.e. one that ships raw.
  if (SEND_TIME_VARS.has(names[0])) return { defer: names[0] };
  return null;
}

function fillTemplate(tmpl, vars) {
  const map = vars || {};
  const filled = String(tmpl == null ? '' : tmpl).replace(/{{(\w+)}}/g, (m, k) => {
    const hit = resolveVar(map, k);
    if (!hit) return m;                      // unknown variable — left visible, never silently blanked
    if (hit.defer) return `{{${hit.defer}}}`; // send-time token, normalised to the name the send path fills
    return hit.value;
  });
  return normalizeSenderTitle(filled);
}

/**
 * Which `{{tokens}}` are still unfilled in a piece of text, ignoring the two
 * that are filled at send time.
 *
 * This is the check behind the reminder send path. A prompt rule is a request;
 * a check is a guarantee — the same reasoning as checkDraft in the outreach
 * generator. An email that went out reading "Hi {{fn}}, ... the {{pos}} opening
 * at {{company}}" is not a formatting slip, it is a recruiter's name on a
 * broken message in a prospect's inbox, and nothing in the app noticed.
 */
function unresolvedVars(text) {
  const found = [];
  String(text == null ? '' : text).replace(/{{(\w+)}}/g, (m, k) => {
    if (!SEND_TIME_VARS.has(k) && !found.includes(k)) found.push(k);
    return m;
  });
  return found;
}

/**
 * Build merge variables from job, contact, and sender display name.
 */
function buildEmailVars({ job, contact, senderDisplayName }) {
  const research = job?.research || {};
  const req = research.requirements || {};
  const skills = Array.isArray(req.skills) ? [...req.skills] : [];
  if (req.skill_1) skills[0] = req.skill_1;
  if (req.skill_2) skills[1] = req.skill_2;
  const filteredSkills = skills.filter(Boolean).slice(0, 3);
  const companyExpertise = research.company?.expertise || '';
  const loc = job?.location || job?.company?.location || req.location || '';
  const city = req.city || (loc.includes(',') ? loc.split(',')[0].trim() : loc);
  const salaryDisplay = req.salary_display || job?.salary_range || '';
  const localHint = req.local_hint || '';

  let localLine = '';
  if (localHint) localLine = ` Must be local to ${localHint}.`;
  else if (req.local_required === true && city) localLine = ` Local to ${city} preferred.`;

  const salaryLine = salaryDisplay ? ` (${salaryDisplay})` : '';

  return {
    fn: contact?.first_name || '',
    ln: contact?.last_name || '',
    company: job?.company?.name || '',
    pos: job?.position || '',
    ind: job?.company?.industry || job?.industry || '',
    loc,
    desig: contact?.designation || 'Hiring Manager',
    // `null` is meaningful: it leaves {{sender}} in the text so the SEND path can
    // fill it from the mailbox that actually sends (see DEFER_SENDER below).
    sender: senderDisplayName === null ? null : (senderDisplayName || ''),
    skill_1: filteredSkills[0] || '',
    skill_2: filteredSkills[1] || '',
    skill_3: filteredSkills[2] || '',
    skills_line: formatSkillsLine(filteredSkills),
    job_resp: formatJobResp(filteredSkills),
    company_service: formatCompanyService(companyExpertise || job?.company?.industry || job?.industry || ''),
    salary_range: salaryDisplay,
    salary_line: salaryLine,
    local_line: localLine,
    city
  };
}

/** Fingerprints of outdated outreach templates saved in app_settings. */
const LEGACY_TEMPLATE_MARKERS = [
  /BD Manager at Fute Global LLC/i,
  /BD Manager \|/i,
  /I'd like to check before sending/i,
  /I'm reaching out about your {{pos}} opening/i,
  /There's no charge to review resumes/i,
  /At Fute Global/i,
  /specializ(e|ing) in connecting/i,
  /15-?\s*minute call/i,
  /Opportunity regarding/i,
  /Hope you had a great break/i,
  // Retired outreach copy (announced "cold email" / over-templated) — refresh to current defaults
  /yet to be introduced/i,
  /we haven't met yet/i,
  /We've not been introduced/i,
  /Pleasure to connect, albeit virtually/i
];

function isLegacyTemplate(text) {
  const val = String(text || '').trim();
  if (!val) return false;
  return LEGACY_TEMPLATE_MARKERS.some(re => re.test(val));
}

/** Return saved template or Daniel default when empty / legacy. */
function resolveTemplate(saved, templateKey) {
  const val = String(saved || '').trim();
  if (!val || isLegacyTemplate(val)) return DEFAULT_TEMPLATES[templateKey] || '';
  return normalizeSenderTitle(val);
}


// ── SENDER IDENTITY ──────────────────────────────────────────────────────────
// The name in the body and the name in the signature must be the same person,
// and that person is whoever's mailbox actually sends the message — which is
// NOT known when an email is queued. A lead can be reassigned, its sending
// mailbox swapped, or a sequence can rotate the "from" mailbox, all AFTER the
// row is written and BEFORE it goes out. So queue time leaves {{sender}} and
// {{senderemail}} in place (pass senderDisplayName: DEFER_SENDER) and the send
// path fills them from the same mailbox row it fills the signature from.
const DEFER_SENDER = null;

// Last-resort display name when a mailbox row has no display_name:
// "prince.thomas@futeglobal.com" -> "Prince Thomas". Never returns a raw token.
function displayNameFromAddress(emailAddress) {
  const local = String(emailAddress || '').split('@')[0];
  if (!local) return '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * The sender identity for a mailbox row, with the address as the name of last
 * resort. `mailbox` may be null — a queued email whose lead has no sending
 * mailbox still has a from_email to fall back on.
 */
function senderIdentityFor(mailbox, fallbackAddress) {
  const emailAddress = mailbox?.email_address || fallbackAddress || '';
  return {
    displayName: mailbox?.display_name || displayNameFromAddress(emailAddress),
    emailAddress
  };
}

/**
 * Fill {{sender}} / {{senderemail}} from the mailbox that is actually sending.
 * Text with no tokens (already-filled legacy rows, hand-edited drafts) is
 * returned untouched, so this is safe to run over every outbound message.
 *
 * EVERY reader of a stored emails.body must go through this. The text sits in
 * the database with the token still in it, so anything that shows it to a human
 * — the pending preview, a quoted reply chain in a follow-up — shows "{{sender}}"
 * unless it is filled first. `renderStoredEmail` below is the shape to reach for.
 */
function applySenderIdentity(text, { displayName, emailAddress } = {}) {
  const address = String(emailAddress || '');
  const name = String(displayName || '') || displayNameFromAddress(address);
  return String(text == null ? '' : text)
    .replace(/{{sender}}/g, name)
    .replace(/{{senderemail}}/g, address);
}

/**
 * Render a stored email row for display or for quoting: subject and body filled
 * from the mailbox it will send from (or did send from). One call, so a caller
 * cannot fill the body and forget the subject.
 */
function renderStoredEmail(row, mailbox) {
  const identity = senderIdentityFor(mailbox, row?.from_email);
  return {
    subject: applySenderIdentity(row?.subject, identity),
    body: applySenderIdentity(row?.body, identity)
  };
}

module.exports = {
  DEFAULT_TEMPLATES,
  VAR_SYNONYMS,
  unresolvedVars,
  SEND_TIME_VARS,
  OUTREACH_VARIANTS,
  OUTREACH_O1_VARIANTS,
  getVariantById,
  buildEmailVars,
  fillTemplate,
  DEFER_SENDER,
  applySenderIdentity,
  displayNameFromAddress,
  senderIdentityFor,
  renderStoredEmail,
  formatSkillsLine,
  formatJobResp,
  formatCompanyService,
  isLegacyTemplate,
  resolveTemplate,
  normalizeSenderTitle,
  SENDER_JOB_TITLE,
  buildRotatingTemplateDeck,
  isRandomTemplateMode
};
