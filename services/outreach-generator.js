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

/** "Berks Group" → "Berks Group's"; "Health Partners" → "Health Partners'". */
function possessive(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return /s$/i.test(n) ? n + "'" : n + "'s";
}

// ── Rule 1-15, given to the model verbatim. Kept as an array of lines so a
// diff shows which rule changed rather than one reflowed paragraph.
function buildSystemPrompt(companyName, opts) {
  const co = String(companyName || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  const rule14 = (opts && opts.omitSignOff)
    ? '14. The sender\'s email signature is appended automatically after your text, so close with "Thanks," and NOTHING else — no name, no title, no company, no contact details. A second sign-off above the signature is a visible mistake.'
    : `14. Close with the sender's real name, title, and "${co}" — nothing more decorative. Do not add a phone or email signature line unless asked.`;
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
    rule14,
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
//
// Everything below exists because a pasted job posting is not prose. It is a
// job board's HTML flattened into text: headings glued onto the sentence that
// follows them ("Required ExperienceSignificant experience supervising..."),
// salary chips and "Posted 12 days ago" mixed in with the actual brief, and
// often no title line at all because the person copied from below the heading.
//
// The first version of this file read the posting line by line and took the
// first short line as the title. On a real Berks Construction posting that
// produced the title "$110K" and found no skills at all. So the reading is now
// done in four passes — unglue, de-clutter, split required from preferred, and
// only then extract — and each pass is exported so a bad email can be traced
// to the pass that misread it.

// Job boards concatenate a heading onto the next sentence. The seam is a
// lowercase run followed by a capital, and splitting on it is what makes
// "OSHA 30 certificationProcore experience" readable as two requirements.
// The lowercase run must be 3+ characters so real names survive: "McDonald"
// and "DeWalt" are not two words.
function normalizeText(jd) {
  return String(jd || '')
    .replace(/\r/g, '')
    .replace(/([a-z]{3,})\.([A-Z])/g, '$1.\n$2')
    .replace(/([a-z]{3,}|[,;)])([A-Z])/g, '$1\n$2')
    .replace(/[ \t]+/g, ' ');
}

// Furniture, not content: apply buttons, salary chips, star ratings, benefit
// pills, posting age. Also the generic headings that a paste often starts with
// — "Job description" is the single most common first line, and taking it as
// the role title is exactly the mistake this list prevents.
const CLUTTER = [
  /^(quick apply|apply now|easy apply|apply|continue|save|share|report( job)?|sign in|back to (search|results)|show (all|more)|read more|see all jobs|be seen first|view in recruiter|message|follow|more)\b/i,
  /^\$[\d,.]+\s*[-–—]?\s*\$?[\d,.]*\s*(\/\s*)?(yr|year|hr|hour|k)?\b/i,
  /^\d+(\.\d+)?\s*(out of|star|review)/i,
  /^posted\s+\d/i,
  /^(full|part)[- ]time\b/i,
  /^[·•|\-–—\s]*$/,
  /^(medical|dental|vision)[,\s]/i,
];
const GENERIC_HEADING = /^(job\s*)?(description|details|summary|overview|posting|type|id|function|requirements?|responsibilities|qualifications|benefits|compensation|salary|location|about( us| the (role|company|job))?|who we are|why (join|work)|the (position|role|opportunity)|company description|what we.?re looking for|equal opportunity|core responsibilities)\b[:\s]*$/i;

function contentLines(jd) {
  return normalizeText(jd)
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !CLUTTER.some(re => re.test(l)));
}

// Required vs preferred is not cosmetic — it is the difference between a real
// gate and a nice-to-have. Reading "OSHA 30 certification" out of a Preferred
// Qualifications block and telling the client their role is hard to fill
// because of a certification requirement is confidently wrong, and the client
// is the one person who knows it is wrong.
const REQUIRED_MARK = /(required experience|requirements?|qualifications|what we.?re looking for|must have|minimum (qualifications|requirements))/i;
// Anchored to the start of a line, because the bare word "preferred" occurs
// inside requirements all the time — "10+ years ... is strongly preferred" was
// cutting the required block off mid-sentence, which is how the email ended up
// saying the bar was "10+ years ... experience is strongly".
const PREFERRED_MARK = /^(preferred(\s+(qualifications|skills|experience|requirements))?|nice[- ]to[- ]have|bonus(\s+points)?|desired(\s+qualifications)?|pluses)\b/im;

function sections(jd) {
  const text = contentLines(jd).join('\n');
  const req = text.search(REQUIRED_MARK);
  const pref = text.search(PREFERRED_MARK);
  
  const required = req >= 0 ? text.slice(req, pref > req ? pref : undefined) : text;
  const preferred = pref >= 0 ? text.slice(pref) : '';
  return { all: text, required, preferred };
}

// ── The role title ─────────────────────────────────────────────────────────
// Three ways in, most reliable first. A posting that names the role in a
// sentence ("BCG is seeking an experienced Construction Superintendent to
// lead...") is more trustworthy than any line-position guess, because the
// person pasting often starts below the heading.
const SEEKING = /\b(?:seeking|looking for|hiring|in search of|recruiting|to hire|need)\s+(?:an?\s+)?(?:experienced\s+|qualified\s+|seasoned\s+|talented\s+|motivated\s+|senior\s+|junior\s+|full[- ]time\s+|part[- ]time\s+)*([A-Z][A-Za-z0-9/&.'\- ]{2,45}?)\s+(?:to|who|that|for|with|in|at|responsible|,|\.|$)/;
const TITLE_HINT = /^(job title|position|role|title)\s*[:\-]\s*(.+)$/i;

function looksLikeTitle(line) {
  const l = line.replace(/[:\s]+$/, '');
  if (!l || l.length > 70) return false;
  if (GENERIC_HEADING.test(l)) return false;
  if (/[$@]|\d{3,}/.test(l)) return false;          // salary chips, phone numbers
  if (/[.!?]$/.test(l)) return false;               // a sentence, not a heading
  const words = l.split(/\s+/);
  if (words.length < 1 || words.length > 8) return false;
  return /^[A-Z]/.test(l) && /[a-z]/.test(l);
}

function extractRoleTitle(jd) {
  const text = contentLines(jd).join('\n');
  const m = text.match(SEEKING);
  if (m && looksLikeTitle(m[1])) return m[1].trim().replace(/\s+/g, ' ');
  for (const l of text.split('\n').slice(0, 30)) {
    const h = l.match(TITLE_HINT);
    if (h && looksLikeTitle(h[2])) return h[2].trim().slice(0, 70);
  }
  for (const l of text.split('\n')) {
    if (looksLikeTitle(l)) return l.replace(/[:\s]+$/, '').slice(0, 70);
  }
  return '';
}

// ── The employer, and where the job is ────────────────────────────────────
// Both are in the posting, so asking a person to retype them is asking for a
// typo. It got one: a LinkedIn profile reads "Vice President at Berks
// Construction", and "Vice President" ended up in the Company box, so the email
// went out saying "I came across Vice President's Construction Superintendent
// opening". The posting knew the answer the whole time.

// Company suffixes are the reliable signal — a title almost never carries one.
const CO_SUFFIX = /\b(llc|l\.l\.c|inc|inc\.|incorporated|corp|corporation|co\.|company|companies|ltd|limited|group|holdings|associates|partners|partnership|solutions|services|systems|industries|technologies|enterprises|labs|works|studio|agency|consulting|construction|manufacturing|health|healthcare|medical|clinic|hospital|university|college|bank|capital|ventures|foundation|institute)\b/i;
const TITLE_WORD = /\b(president|vp|v\.p|ceo|cfo|coo|cto|chief|owner|principal|partner|founder|director|manager|supervisor|superintendent|foreman|estimator|engineer|controller|accountant|recruiter|coordinator|analyst|specialist|administrator|assistant|associate|officer|lead|head|executive|designer|developer|technician|nurse|attorney|paralegal|representative|agent|consultant)\b/i;

/**
 * Does this value look like a person's job title rather than an employer?
 * Used to refuse a Company field that was filled in from a LinkedIn headline.
 * A name carrying a company suffix always wins — "Director's Choice Ltd" is a
 * company, and this must not throw away a real one to catch a wrong one.
 */
function looksLikeJobTitle(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (CO_SUFFIX.test(v)) return false;
  if (v.split(/\s+/).length > 6) return false;
  return TITLE_WORD.test(v);
}

// "Berks Construction Group (BCG) is seeking an experienced Construction
// Superintendent to lead..." — the employer is whatever precedes the verb.
const COMPANY_SEEKING = /(?:^|[.\n])\s*([A-Z][A-Za-z0-9&.,'\-]*(?:\s+[A-Z(][A-Za-z0-9&.,'\-)]*){0,5}?)\s*(?:\([A-Z]{2,6}\)\s*)?\b(?:is|are|has been)\s+(?:currently\s+)?(?:seeking|looking for|hiring|in search of|recruiting)/;

function extractCompany(jd) {
  const text = contentLines(jd).join('\n');
  const m = text.match(COMPANY_SEEKING);
  if (m) {
    const c = m[1].trim().replace(/[,.]$/, '');
    if (c.split(/\s+/).length <= 6 && !looksLikeJobTitle(c) && !/^(we|our|the|this|they|it)$/i.test(c)) return c;
  }
  // Otherwise a line that is plainly a company name — a suffix is the tell.
  for (const l of text.split('\n').slice(0, 12)) {
    if (l.length <= 60 && CO_SUFFIX.test(l) && !/\bis\b|\bseeking\b|:/i.test(l)) {
      return l.replace(/[,.]$/, '').trim();
    }
  }
  return '';
}

// "Lancaster, PA" on its own line, or "in Tucson, AZ" inside a sentence.
const LOC_LINE = /^([A-Z][A-Za-z.'\- ]{1,28},\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?))\b/;
const LOC_INLINE = /\b(?:in|at|near)\s+([A-Z][A-Za-z.'\-]+(?:\s[A-Z][A-Za-z.'\-]+)?,\s*[A-Z]{2})\b/;

function extractLocation(jd) {
  const lines = contentLines(jd);
  for (const l of lines.slice(0, 12)) {
    const m = l.match(LOC_LINE);
    if (m && !CO_SUFFIX.test(m[1])) return m[1].trim();
  }
  const m2 = lines.join('\n').match(LOC_INLINE);
  return m2 ? m2[1].trim() : '';
}

// ── What the role actually asks for ────────────────────────────────────────
// Extraction from the posting's OWN words, not a lookup against a dictionary
// of skills someone thought of in advance. A fixed dictionary is why the first
// version found nothing in a construction posting: it had been written while
// thinking about accounting and software roles.
const TOO_GENERIC = /^(microsoft |ms )?(outlook|word|excel|office|powerpoint|google|windows|email|computer|internet|the|this|that|a|an|our|your|their|work|working|job|position|role|team|company|business|customer|client|significant|strong|extensive|demonstrated|relevant|prior|previous|proven|required|preferred|minimum|desired|excellent|solid|hands|ability|years?|experience|qualifications?|responsibilities)s?\b/i;
const CERT_NEAR = /([A-Z][A-Za-z0-9]*(?:[ \t]+[A-Z0-9][A-Za-z0-9]*){0,2})[ \t]+(?:certification|certificate|certified|licen[cs]e[d]?)\b/g;
const TOOL_NEAR = /(?:^|[ \t])([A-Z][A-Za-z0-9.+#]{2,20}(?:[ \t]+[A-Z][A-Za-z0-9.+#]{2,20})?)[ \t]+experience\b/gm;
// The connector is captured, not discarded: "experience supervising X" and
// "experience with X" have to come back out of the email grammatical, and
// which one it was is the only way to know.
const EXP_PHRASE = /\bexperience\s+(with|in|supervising|coordinating|leading|managing|running|reading|performing)\s+([^.;:\n]{2,80})/gi;
const YEARS_PHRASE = /(\d{1,2}\s*\+?\s*years?[^.;:\n]{0,90})/i;

// "10+ years of commercial construction supervision experience is strongly
// preferred" — the trailing verdict is the posting's grammar, not part of the
// bar, and it has to come off BEFORE the phrase is trimmed to length or the
// trim lands mid-verdict ("...experience is strong").
function cleanYears(t) {
  return String(t || '')
    .replace(/\s+(is|are)\s+(strongly\s+|highly\s+)?(preferred|required|desired|a plus|necessary|essential)\b.*$/i, '')
    // and the same verdict when the capture window already clipped it
    .replace(/\s+(is|are)\s+\w*$/i, '');
}

const TAIL_STOP = /\b(a|an|the|of|in|on|at|to|for|and|or|with|from|by|as|is|are|that|which|their|our|your)$/i;

function tidyPhrase(p, opts) {
  const maxWords = (opts && opts.maxWords) || 7;
  let out = String(p || '').trim()
    .replace(/^(a|an|the|of|in|with|and|or)\s+/i, '')
    .replace(/^(active|current|valid|applicable|appropriate|unrestricted)\s+/i, '')
    .replace(/\s*\band\/or\b.*$/i, '')
    .replace(/,?\s*\band other\b.*$/i, '')
    .replace(/^((?:[^,]*,){2}[^,]*),.*$/, '$1')
    .replace(/[,;:.\s]+$/, '')
    .replace(/\s+/g, ' ');
  let words = out.split(' ');
  if (words.length > maxWords) words = words.slice(0, maxWords);
  // Truncating on a word count regularly landed on "...experience in an", which
  // reads as a sentence that was cut off — because it was.
  while (words.length > 2 && TAIL_STOP.test(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/**
 * Short phrases naming what this role needs, in the posting's own language.
 * Ordered so the ones a recruiter would actually say out loud come first:
 * the domain experience, then the named tools and certifications.
 */
function extractRequirements(jd) {
  const s = sections(jd);
  const out = [];
  const add = (p, prep) => {
    const t = tidyPhrase(p);
    if (!t || t.length < 3 || TOO_GENERIC.test(t)) return;
    if (out.some(e => e.text.toLowerCase() === t.toLowerCase())) return;
    // The article is stripped before the generic-phrase check (so "the ability
    // to..." is still rejected) but put back for the sentence, because
    // "experience in adult intensive care unit" is not English.
    const art = (String(p).trim().match(/^(an?)\s+/i) || [])[1];
    const withArt = art && t.split(' ').length >= 3 ? art.toLowerCase() + ' ' + t : t;
    out.push({ prep: prep || 'in', text: t, clause: (prep || 'in') + ' ' + withArt });
  };

  let m;
  const domain = s.required || s.all;
  const expRe = new RegExp(EXP_PHRASE.source, EXP_PHRASE.flags);
  while ((m = expRe.exec(domain)) && out.length < 4) {
    const prep = /^(with|in)$/i.test(m[1]) ? 'in' : m[1].toLowerCase();
    add(m[2], prep);
  }

  // Named tools and certifications read as researched detail in an email —
  // "Procore and OSHA 30" tells a client you read past the job title.
  const named = [];
  const scope = (s.required + '\n' + s.preferred) || s.all;
  const certRe = new RegExp(CERT_NEAR.source, CERT_NEAR.flags);
  while ((m = certRe.exec(scope))) { const t = tidyPhrase(m[1]); if (t && !TOO_GENERIC.test(t)) named.push(t); }
  // A product name is a word the posting never uses in lower case. "Procore
  // experience" is a tool; "Commercial retail construction experience" is not,
  // and no dictionary of tool names would have known the difference for every
  // industry we sell into.
  const lowered = new Set((scope.match(/\b[a-z][a-z0-9.+#]{2,}\b/g) || []));
  const toolRe = new RegExp(TOOL_NEAR.source, TOOL_NEAR.flags);
  while ((m = toolRe.exec(scope))) {
    const t = tidyPhrase(m[1]);
    if (!t || TOO_GENERIC.test(t)) continue;
    if (t.split(' ').some(w => lowered.has(w.toLowerCase()))) continue;
    named.push(t);
  }

  return { phrases: out.slice(0, 3), named: [...new Set(named)].slice(0, 3) };
}

// Kept for callers that only want the flat list (and for the older tests).
function extractSkills(jd) {
  const r = extractRequirements(jd);
  return [...r.phrases.map(p => p.text), ...r.named].slice(0, 3);
}

// ── Why is this role hard to fill? ─────────────────────────────────────────
// Each signal must carry EVIDENCE from the posting, because the diagnosis is
// shown to a client who knows their own job better than we do. A signal that
// only matches inside the Preferred block is not a gate and is not used.
const SIGNALS = [
  { id: 'clearance', re: /\b(security clearance|top secret|ts\/sci|secret clearance|public trust)\b/i,
    phrase: () => 'the clearance requirement narrows the pool before skills are even on the table',
    why: 'A clearance requirement is the hardest filter in the posting — most qualified people are screened out by it, not by skill.' },
  { id: 'seniority', re: YEARS_PHRASE, requiredOnly: true,
    phrase: (m) => 'the bar is ' + tidyPhrase(cleanYears(m[1]), { maxWords: 11 }) + ', which is a small and mostly-employed group',
    why: (m) => 'The experience bar — ' + tidyPhrase(cleanYears(m[1]), { maxWords: 11 }) + ' — is the real filter here; most applicants are screened out on it before anything else.' },
  { id: 'licence', re: /\b(licen[cs]ed?|certifi(ed|cation)|\bP\.?E\.?\b|CPA|CDL|PMP|RN\b|LPN\b|journeyman|red seal)\b/i,
    requiredOnly: true,
    phrase: () => 'the licence and certification requirements cut the pool down sharply',
    why: 'The posting gates on a licence or certification, which is a much smaller pool than the job title suggests.' },
  { id: 'language', re: /\b(bilingual|spanish|mandarin|french|german)[- ]?(speaking|fluen)/i,
    phrase: () => 'the language requirement on top of the technical side is an unusual combination',
    why: 'A language requirement stacked on the technical requirements is a genuinely rare combination.' },
  { id: 'shift', re: /\b(night shift|graveyard|rotating shift|weekends?|on[- ]call|24\/7)\b/i,
    phrase: () => 'the shift pattern is what usually costs this kind of role its applicants',
    why: 'The schedule, not the skills, is what typically loses candidates on this type of role.' },
  { id: 'travel', re: /\b(travel to assigned|willingness to travel|travel is required|required to travel|relocat\w+)\b/i,
    phrase: () => 'the travel that comes with the project assignments thins the field further',
    why: 'Travel expectations usually cost a posting most of its otherwise qualified applicants.' },
  { id: 'onsite', re: /\b(on[- ]?site|in[- ]?office|in person)\b/i,
    phrase: () => 'a fully on-site role competes against a lot of remote offers for the same skills',
    why: 'On-site work for skills that are widely hired remotely is a competitive disadvantage in the market.' },
  { id: 'span', re: /\b(wear (many|multiple) hats|both .{3,40} and|in addition to)\b/i,
    phrase: () => 'the role spans two functions that are usually two separate hires',
    why: 'The posting combines responsibilities that are normally split across two roles, so single candidates rarely match all of it.' },
];

// A range this wide is a client telling you they do not know what the market
// costs — which is a recruiter's opening, not a candidate problem. Worth
// saying out loud, but never as the sole diagnosis.
const WIDE_RANGE = /\$\s?(\d{2,3})[,.]?\d{0,3}\s*[-–—]\s*\$?\s?(\d{2,3})[,.]?\d{0,3}/;

const DRIVERS_LICENCE = /\bvalid\s+driver'?s?\s+licen[cs]e\b/gi;

// Evidence is quoted back to a client who knows the job better than we do, so
// it has to be a readable fragment of their posting, not the one word that
// happened to match.
function evidenceAround(hay, match) {
  const idx = hay.indexOf(match);
  if (idx < 0) return match.trim().slice(0, 90);
  // Centre the quote on the match. Anchoring to the start of the line put the
  // wrong sentence in front of it on postings that run several requirements
  // together, which reads as if we quoted the wrong thing.
  const lineStart = Math.max(0, hay.lastIndexOf('\n', idx) + 1);
  const sentStart = Math.max(lineStart, hay.lastIndexOf('. ', idx) + 1);
  let end = hay.indexOf('\n', idx + match.length);
  if (end < 0) end = hay.length;
  const dot = hay.indexOf('. ', idx + match.length);
  if (dot >= 0 && dot < end) end = dot + 1;
  return hay.slice(sentStart, Math.min(end, sentStart + 140)).replace(/\s+/g, ' ').trim();
}

function diagnoseSignal(jd, notes) {
  const s = sections(jd);
  const extra = String(notes || '');
  for (const sig of SIGNALS) {
    let hay = sig.requiredOnly ? (s.required + '\n' + extra) : (s.all + '\n' + extra);
    if (sig.id === 'licence') hay = hay.replace(DRIVERS_LICENCE, '');
    const m = hay.match(sig.re);
    if (!m) continue;
    return {
      id: sig.id,
      phrase: typeof sig.phrase === 'function' ? sig.phrase(m) : sig.phrase,
      why: typeof sig.why === 'function' ? sig.why(m) : sig.why,
      evidence: evidenceAround(hay, m[0] || ''),
    };
  }
  return null;
}

// ── Who are we writing to? ─────────────────────────────────────────────────
// The same posting goes to a Controller, a VP and an HR coordinator very
// differently. This is the whole point of the tool: it is one email to one
// person about one job, not a mailshot.
const AUDIENCES = [
  { kind: 'finance', re: /\b(controller|cfo|chief financial|finance|accounting|treasur|bookkeep)\b/i },
  { kind: 'hr',      re: /\b(hr\b|human resources|talent|recruit|people (ops|operations)|staffing)\b/i },
  { kind: 'exec',    re: /\b(ceo|coo|owner|president|principal|partner|founder|vice president|\bvp\b|svp|evp|director|managing)\b/i },
  { kind: 'manager', re: /\b(manager|superintendent|supervisor|foreman|lead|head of|chief)\b/i },
];
function audienceOf(title) {
  const t = String(title || '');
  for (const a of AUDIENCES) if (a.re.test(t)) return a.kind;
  return 'unknown';
}

// Career-history words worth naming back to someone. The value is not that we
// know their CV — it is that it explains why this email went to them and not
// to the careers form.
const TRACK = [
  [/\bestimat(or|ing)\b/i, 'estimating'],
  [/\bpre[- ]?construction\b/i, 'pre-construction'],
  [/\bproject (manager|management)\b/i, 'project management'],
  [/\b(superintendent|foreman|field)\b/i, 'the field'],
  [/\b(operations|ops)\b/i, 'operations'],
  [/\b(recruit\w*|talent)\b/i, 'recruiting'],
  [/\b(account\w*|controller|audit\w*)\b/i, 'accounting'],
  [/\bengineer\w*\b/i, 'engineering'],
  [/\b(sales|business development)\b/i, 'sales'],
];

/**
 * The ONE detail from the notes (rule 5) — and it has to be a FACT, not the
 * person's own name. The first version split the notes on the first sentence
 * boundary, so a pasted LinkedIn profile produced the email sentence "Ed Jones,
 * which is why I am writing to you rather than through the posting." That is
 * worse than saying nothing.
 */
function pickNoteDetail(notes, opts) {
  const n = String(notes || '').trim();
  if (!n) return '';
  const o = opts || {};
  const name = String(o.contactName || '').trim();

  const mutual = n.match(/\bmutual (?:connection|friend|contact|acquaintance)\s+([A-Z][a-z]+)/i);
  if (mutual) return 'we have ' + mutual[1] + ' in common';

  // Prior roles inside the same notes, minus whatever their title is now — the
  // interesting part is where they came FROM.
  const current = String(o.contactTitle || '');
  const track = [];
  for (const [re, label] of TRACK) {
    if (re.test(n) && !re.test(current) && track.indexOf(label) < 0) track.push(label);
    if (track.length === 2) break;
  }
  if (track.length) return 'you came up through ' + joinList(track);

  const repost = n.match(/re-?posted(?:\s+after\s+(\d+)\s+days?)?/i);
  if (repost) return repost[1] ? 'the role has been re-posted after ' + repost[1] + ' days' : 'the role has been re-posted';

  const tenure = n.match(/\b(\d{1,2})\s*(?:yrs?|years?)\b/);
  if (tenure && o.company) return 'you have been at ' + o.company + ' for ' + tenure[1] + ' years';

  // Nothing structured found. Fall back to the first real sentence, but never
  // to something that is only the person's name or title.
  const first = (n.split(/(?<=[.!?])\s+|\n/)[0] || '').trim().replace(/[.\s]+$/, '');
  if (!first || first.length < 12) return '';
  if (name && first.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, '')) return '';
  if (current && first.toLowerCase().includes(current.toLowerCase()) && first.length < current.length + 12) return '';
  return first.slice(0, 120);
}

function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** "Construction Superintendent" → "Construction Superintendents". */
function pluralRole(title) {
  const t = String(title || '').trim().replace(/\s*[-–—(,/].*$/, '').trim();
  if (!t) return 'people';
  if (/s$/i.test(t)) return t;
  if (/y$/i.test(t)) return t.slice(0, -1) + 'ies';
  if (/(ch|sh|x|z)$/i.test(t)) return t + 'es';
  return t + 's';
}

function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

/**
 * The keyless engine. Writes the email from a sentence plan rather than a
 * fill-in-the-blank template: which sentences appear, and in what order, is
 * decided by the same rules the model is given — the no-agencies short form,
 * the follow-up short form, finance-first fee placement, and now the reader's
 * role and their own background.
 *
 * The sender identity comes in from the caller and is the MAILBOX's, not the
 * logged-in user's. A draft signed by one person and sent from another's
 * address is the exact failure that cost 152 cold emails in Session 14.
 */
function rulesDraft(input, options) {
  const i = input || {};
  const co = txt((options || {}).companyName) || DEFAULT_COMPANY;
  const sender = i.sender || {};
  const senderName = txt(sender.name) || 'me';
  const senderTitle = txt(sender.title);
  const first = firstNameOf(i.contact_first_name);
  const role = extractRoleTitle(i.job_description);
  const roleLabel = role || 'the role you have open';

  // THE POSTING OUTRANKS THE FORM for the employer and the city. A typed value
  // is used when it is plausibly a company; a value that reads as a person's
  // job title is refused outright, because printing it produces "I came across
  // Vice President's Construction Superintendent opening" — which is what a
  // LinkedIn headline pasted into the Company box actually produced.
  const typedCompany = txt(i.company);
  const companyRejected = looksLikeJobTitle(typedCompany);
  const company = (companyRejected || !typedCompany)
    ? extractCompany(i.job_description)
    : typedCompany;
  const loc = txt(i.location) || extractLocation(i.job_description);
  // Two newlines: the sign-off is its own block, and a "Best regards," glued to
  // the last sentence is the tell that an email was assembled, not written.
  // WHEN A MAILBOX SIGNATURE WILL BE APPENDED, THE BODY MUST NOT SIGN ITSELF.
  // The recipient of the first real send got both: "Best regards, Prince Thomas,
  // Account Manager, Fute Global" and then the full signature card underneath
  // it. The signature carries the name, title, company and contact details —
  // so the body stops at "Thanks," and lets it.
  const signOff = (options || {}).omitSignOff
    ? '\n\nThanks,'
    : '\n\n' + ['Best regards,', senderName, [senderTitle, co].filter(Boolean).join(', ')]
        .filter(Boolean).join('\n');

  // ── Follow-up (rule 12): under 60 words, no pitch, an explicit way out.
  if (i.outreach_type === 'followup') {
    const body = [
      'Hi ' + first + ',',
      '',
      'This is ' + senderName + ' at ' + co + ', following up on ' + (role ? 'the ' + role + ' role' : 'the role') +
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
  const reqs = extractRequirements(i.job_description);
  const audience = audienceOf(i.contact_title);
  const detail = pickNoteDetail(i.notes, {
    contactName: i.contact_first_name, contactTitle: i.contact_title, company
  });
  const feeLine = 'There is no charge for reviewing resumes. We only charge a fee on a successful placement.';
  const cta = 'Would it be worth sending you a couple of resumes to look at?';

  // ── No-agencies (rule 6): acknowledge it in the first two sentences, stay
  // under 90 words, and make saying no the easiest thing to do.
  if (i.no_agencies) {
    const body = [
      'Hi ' + first + ',',
      '',
      'This is ' + senderName + ' at ' + co + '. I saw the note on the ' + (role || 'job') +
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

  // ── Sentence 1: who this is and which posting. Rule 1 — identity first.
  const opening = 'This is ' + senderName + ' at ' + co + '. I came across ' +
    (company ? possessive(company) + ' ' : 'the ') + roleLabel + ' opening' + (loc ? ' in ' + loc : '') + '.';

  // ── Sentence 2: why THIS person, not the careers form. Factual about what we
  // did, never a guess about how they feel about it (rule 5).
  const REACH = {
    exec: 'I sent this to you rather than through the careers form because a hire like this usually gets decided at your level, not on a job board.',
    manager: "I sent this to you rather than through the careers form because you're the one carrying the work while the seat is open.",
    finance: 'I sent this to you rather than through the careers form because the cost of the hire is the part that usually needs answering first.',
    hr: '',
    unknown: ''
  };
  const reach = detail
    ? 'I sent this to you rather than through the careers form — ' + detail + '.'
    : (REACH[audience] || '');

  // ── The researched paragraph (rule 2). This is the point of the email, so it
  // quotes what the posting actually asks for rather than adjectives.
  const observation = signal
    ? 'Reading the posting, ' + signal.phrase + '.'
    : 'Reading the posting, it is a narrower brief than the title suggests.';
  // What we can actually offer, in the posting's own words. Naming the tools
  // and certifications it asks for is the cheapest possible proof that a human
  // read past the job title.
  const who = role ? pluralRole(role) : 'people';
  const supplyBits = [];
  if (reqs.phrases.length) supplyBits.push('with experience ' + reqs.phrases[0].clause);
  if (reqs.named.length) supplyBits.push((supplyBits.length ? 'plus ' : 'with ') + joinList(reqs.named) + ' behind them');
  const supply = supplyBits.length
    ? 'We have ' + who + ' ' + supplyBits.join(', ') + ', open to a direct hire and not yet in front of you.'
    : 'We have ' + who + ' who match that brief, open to a direct hire and not yet in front of you.';

  const paras = ['Hi ' + first + ',', '', [opening, reach].filter(Boolean).join(' ')];
  if (audience === 'finance') {
    // Rule 9: for a finance-first reader, cost is the real objection, so it goes
    // ahead of the ask instead of after it.
    paras.push('', observation + ' ' + supply, '', feeLine, '', cta);
  } else {
    paras.push('', observation + ' ' + supply, '', cta, '', feeLine);
  }
  let body = paras.join('\n') + signOff;

  // Rule 7 is a length rule, so it is checked rather than hoped for. The
  // "why you" sentence is the first thing dropped when the email runs long —
  // it is the one that is nice to have rather than load-bearing.
  if (wordCount(body) > 170 && reach) {
    paras[2] = opening;
    body = paras.join('\n') + signOff;
  }

  const diagnosisBits = [
    signal ? signal.why : 'No single hard constraint stood out in the posting, so this leads on the specifics of the brief itself.'
  ];
  if (signal && signal.evidence) diagnosisBits.push('Taken from the posting’s own wording: “' + signal.evidence + '”.');
  if (audience === 'finance') diagnosisBits.push('The contact reads as finance-first, so the fee framing sits ahead of the ask.');
  else if (audience === 'exec') diagnosisBits.push('The contact is senior enough to decide, so this is addressed to them as the decision-maker rather than as a screener.');
  if (WIDE_RANGE.test(String(i.job_description || ''))) {
    diagnosisBits.push('The salary range in the posting is unusually wide, which usually means the market rate is still an open question — useful leverage on a follow-up.');
  }

  return {
    subject: (role || 'Your opening') + (loc ? ' in ' + loc : '') + ' — candidates ready to review',
    diagnosis: diagnosisBits.join(' '),
    email: body,
    mode: 'rules',
    // What the email actually used, so the page can show it rather than leaving
    // the writer to spot a wrong name inside a paragraph.
    used: { role: role, company: company, location: loc },
    company_rejected: companyRejected ? typedCompany : null
  };
}

/** "Ed Jones" → "Ed". A full name in a greeting reads like a mail merge. */
function firstNameOf(name) {
  const n = txt(name);
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

module.exports = {
  DEFAULT_COMPANY,
  buildSystemPrompt, buildUserPayload, parseAiDraft, validateInput,
  rulesDraft, extractRoleTitle, extractSkills, extractRequirements, diagnoseSignal, possessive,
  extractCompany, extractLocation, looksLikeJobTitle,
  contentLines, normalizeText, sections, audienceOf, pickNoteDetail, pluralRole,
  firstNameOf, wordCount
};
