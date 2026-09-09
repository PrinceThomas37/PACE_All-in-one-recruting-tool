// ============================================================================
// MORNING BRIEFING — the one or two sentences at the top of the dashboard
// saying what actually came in today.
//
// WHY THIS EXISTS
// The dashboard opens with ten numbers and no words, so the first thing the
// owner does every morning is work out for themselves what those numbers mean.
// A colleague would just say it: "Six new leads and three candidates came in,
// and two people replied."
//
// THREE LAWS, in the order that matters:
//
//   1. THE RULES WRITER IS THE PRODUCT. There is no funded AI key. On most
//      mornings — and on every morning the free tier is spent or rate-limited
//      — `rulesBriefing()` is what the owner reads. The AI is an upgrade on
//      top of it, never a requirement, and NEVER an apology: this endpoint
//      used to answer "AI summary unavailable", which is the one sentence a
//      customer must never be shown by a feature the Admin screen promises
//      has a built-in non-AI version.
//   2. A FACT THAT IS ZERO IS NOT MENTIONED. "0 new candidates" is noise on a
//      quiet day and a lie waiting to happen on a busy one. Nothing here ever
//      states a number it was not given, and a completely quiet day gets its
//      own true sentence rather than a padded one.
//   3. AN AI DRAFT IS CHECKED, NOT TRUSTED. Same discipline as
//      services/outreach-generator.js: `checkBriefing()` is the guarantee,
//      the prompt is only a request. The check that matters most here is
//      `invented_number` — a summary is a set of factual claims about the
//      morning, so EVERY integer in the text must be one we handed the model.
//      A briefing that rounds 6 up to "about ten" is worse than no briefing.
//
// PURE. No database, no fetch, no clock — the caller reads the rows and passes
// the date in. That is what makes every sentence in here testable without
// waiting for a particular morning to come round.
// ============================================================================

'use strict';

// ── facts ───────────────────────────────────────────────────────────────────
// The shape the route assembles and the pure writer consumes. Every field is
// optional and every missing field means "we have nothing to say about that",
// which is not the same as zero — but both are silent, so the distinction
// costs nothing here.
//
//   {
//     date: '2026-09-09',
//     leads:      { new, duplicates, pool, topIndustries: [{name,count}], topPositions: [{name,count}] },
//     candidates: { new },
//     submissions:{ new },
//     replies:    { inbound, from_candidates, from_contacts }
//   }

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// "a", "a and b", "a, b and c" — the way a person lists things out loud.
function joinList(parts) {
  const p = parts.filter(Boolean);
  if (p.length === 0) return '';
  if (p.length === 1) return p[0];
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}

// Everything that ARRIVED today, in the order a recruiter cares about it.
// Zeroes are dropped here, once, so no sentence builder below has to remember.
function arrivalsOf(facts) {
  const f = facts || {};
  const out = [];
  const leads = num(f.leads && f.leads.new);
  const cands = num(f.candidates && f.candidates.new);
  const subs = num(f.submissions && f.submissions.new);
  const reps = num(f.replies && f.replies.inbound);
  if (leads) out.push({ key: 'leads', n: leads, text: plural(leads, 'new lead', 'new leads') });
  if (cands) out.push({ key: 'candidates', n: cands, text: plural(cands, 'new candidate', 'new candidates') });
  if (subs) out.push({ key: 'submissions', n: subs, text: plural(subs, 'new submission', 'new submissions') });
  if (reps) out.push({ key: 'replies', n: reps, text: plural(reps, 'reply', 'replies') });
  return out;
}

// Is there literally nothing to report? Used by the route to set `quiet`, so a
// card can choose to render smaller rather than shout about an empty morning.
function isQuiet(facts) {
  return arrivalsOf(facts).length === 0;
}

// Every number the writer is allowed to say. This is also the whitelist the
// AI check runs against — which is the entire reason it is computed from the
// facts rather than written out twice.
function allowedNumbers(facts) {
  const f = facts || {};
  const set = new Set();
  arrivalsOf(f).forEach((a) => set.add(a.n));
  [
    f.leads && f.leads.duplicates,
    f.leads && f.leads.pool,
    f.replies && f.replies.from_candidates,
    f.replies && f.replies.from_contacts,
  ].forEach((v) => { if (num(v)) set.add(num(v)); });
  (((f.leads && f.leads.topIndustries) || []).concat((f.leads && f.leads.topPositions) || []))
    .forEach((e) => { if (e && num(e.count)) set.add(num(e.count)); });
  return set;
}

function topNames(list, n) {
  return (list || [])
    .filter((e) => e && e.name && num(e.count))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((e) => e.name);
}

// ── the rules writer ────────────────────────────────────────────────────────
// One sentence saying what arrived, and at most one more saying the single
// most useful thing about it. Two sentences is the brief; three is a report,
// and the owner already has a report.
function rulesBriefing(facts) {
  const f = facts || {};
  const arrivals = arrivalsOf(f);
  const pool = num(f.leads && f.leads.pool);
  const sentences = [];

  if (arrivals.length === 0) {
    sentences.push('Nothing new has come in yet today.');
    if (pool) {
      sentences.push(`The unassigned pool still has ${plural(pool, 'lead', 'leads')} waiting to be worked.`);
    }
    return { summary: sentences.join(' '), engine: 'rules', quiet: true };
  }

  sentences.push(`${capitalize(joinList(arrivals.map((a) => a.text)))} came in today.`);

  // The second sentence is a choice, not a list. Replies first: they are the
  // only arrival with a person on the other end already waiting.
  const reps = arrivals.find((a) => a.key === 'replies');
  const industries = topNames(f.leads && f.leads.topIndustries, 2);
  const positions = topNames(f.leads && f.leads.topPositions, 2);
  const dupes = num(f.leads && f.leads.duplicates);

  if (reps) {
    sentences.push(reps.n === 1
      ? 'The reply is waiting on an answer.'
      : 'The replies are waiting on an answer.');
  } else if (industries.length) {
    sentences.push(`The new leads are mostly ${joinList(industries)}.`);
  } else if (positions.length) {
    sentences.push(`The roles are mostly ${joinList(positions)}.`);
  } else if (dupes) {
    sentences.push(`${capitalize(plural(dupes, 'is flagged as a duplicate', 'are flagged as duplicates'))}.`);
  } else if (pool) {
    sentences.push(`The unassigned pool is at ${plural(pool, 'lead', 'leads')}.`);
  }

  return { summary: sentences.join(' '), engine: 'rules', quiet: false };
}

function capitalize(s) {
  const t = String(s || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// ── the AI seam ─────────────────────────────────────────────────────────────
// The model is given the facts as a flat list and forbidden everything the
// rules writer would not do. Note what it is NOT given: any freedom to add a
// number. Rule 1 is the one the checker enforces byte for byte.
const SYSTEM = [
  'You write one short morning briefing for a recruiting team, in the voice of a colleague',
  'saying it out loud — not a report, not a newsletter, not a marketing email.',
  '',
  'Rules:',
  '1. Use ONLY the numbers given. Never state, round, estimate or total a number that is not in the list.',
  '2. Never mention anything that is not in the list. If something is absent, it did not happen and is not mentioned.',
  '3. One or two sentences. Never three.',
  '4. Plain prose. No bullet points, no headings, no bold, no emoji, no exclamation marks.',
  '5. No greeting, no sign-off, no name, no "here is your summary".',
  '6. Say what came in first; then at most one sentence about what deserves attention.',
  '7. Never invent an instruction, a deadline or a promise. State what is true and stop.',
].join('\n');

function buildSystemPrompt() { return SYSTEM; }

// The payload is a plain list of "label: value" lines rather than JSON: the
// facts are few and a model reads a list more literally than a nested object,
// and literal is the whole requirement here.
function buildUserPayload(facts) {
  const f = facts || {};
  const lines = [];
  if (f.date) lines.push(`Date: ${f.date}`);
  arrivalsOf(f).forEach((a) => lines.push(`${capitalize(a.text)} today`));
  const dupes = num(f.leads && f.leads.duplicates);
  if (dupes) lines.push(`${plural(dupes, 'of the new leads is', 'of the new leads are')} flagged as duplicates`);
  const pool = num(f.leads && f.leads.pool);
  if (pool) lines.push(`Unassigned lead pool: ${pool}`);
  const inds = topNames(f.leads && f.leads.topIndustries, 3);
  if (inds.length) lines.push(`Industries of the new leads: ${inds.join(', ')}`);
  const pos = topNames(f.leads && f.leads.topPositions, 3);
  if (pos.length) lines.push(`Roles being hired for: ${pos.join(', ')}`);
  const fromC = num(f.replies && f.replies.from_candidates);
  const fromK = num(f.replies && f.replies.from_contacts);
  if (fromC) lines.push(`${fromC} of the replies came from candidates`);
  if (fromK) lines.push(`${fromK} of the replies came from client contacts`);
  if (!lines.filter((l) => !/^Date:/.test(l)).length) {
    lines.push('Nothing at all arrived today. Say so in one short sentence.');
  }
  return lines.join('\n');
}

// A model told to write two sentences will sometimes hand back a label, a
// quoted block or a bulleted list around them. Take the prose out of whatever
// arrives; return null if there is no prose in it.
function parseAiBriefing(text) {
  let t = String(text || '').trim();
  if (!t) return null;
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  t = t.replace(/^(here('s| is)[^:]*:|summary:|briefing:)\s*/i, '').trim();
  t = t.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim())
       .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return t || null;
}

const SENTENCE_RE = /[^.!?]+[.!?]+/g;
function sentenceCount(text) {
  const m = String(text || '').match(SENTENCE_RE);
  return m ? m.length : (String(text || '').trim() ? 1 : 0);
}

// ── the check ───────────────────────────────────────────────────────────────
// `checkBriefing` is the guarantee; the prompt above is only the request.
// Returns a list of violation codes — empty means the draft may ship.
function checkBriefing(text, facts) {
  const v = [];
  const t = String(text || '').trim();
  if (!t) return ['empty'];

  // 1. INVENTED NUMBER — the one that makes this feature safe to ship at all.
  // Every integer in the text must be a number we handed over. Years (a date
  // like 2026) and ordinals inside a date are not facts about the morning and
  // have no business here either, so they fail the same rule.
  const allowed = allowedNumbers(facts);
  const nums = t.match(/\d[\d,]*/g) || [];
  for (const raw of nums) {
    const n = Number(raw.replace(/,/g, ''));
    if (!allowed.has(n)) { v.push('invented_number'); break; }
  }
  // A number spelled as a word is still a number. Only check the small ones —
  // "one" as an article ("one of the replies") is legitimate, so it is exempt.
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(t) && !allowed.has(n)) { v.push('invented_number_word'); break; }
  }

  // A vague quantity is an invented number wearing a hat: "around a dozen
  // leads" survives every digit check above and is still not what happened.
  if (/\b(a dozen|dozens|about|around|roughly|approximately|several|numerous|a handful|plenty|nearly|almost|a number of|dozen)\b/i.test(t)) {
    v.push('vague_quantity');
  }

  if (sentenceCount(t) > 2) v.push('too_long');
  if (t.length > 320) v.push('too_long_chars');
  if (/\{\{[^}]*\}\}/.test(t)) v.push('placeholder');
  if (/[!]/.test(t)) v.push('exclamation');
  if (/^\s*([-*•]|\d+[.)])\s/m.test(t)) v.push('list');
  if (/^\s*#{1,6}\s|\*\*/.test(t)) v.push('markdown');
  if (/\b(hi|hello|hey|good morning|dear)\b/i.test(t.slice(0, 20))) v.push('greeting');
  if (/\b(thanks|best|regards|cheers)\b\s*[,.]?\s*$/i.test(t)) v.push('signoff');
  if (/\b(exciting|amazing|incredible|fantastic|great news|leverage|synerg)/i.test(t)) v.push('marketing');
  // A briefing that talks about the AI is a briefing about the wrong subject.
  if (/\b(as an ai|i cannot|i don't have|no data (was )?provided)\b/i.test(t)) v.push('meta');
  return v;
}

// The one decision the route makes about an AI draft, kept here so it is
// testable: take the AI only if it parsed AND passed clean. There is no repair
// turn — this answer is two sentences long, so a second call costs as much as
// the first for a text nobody will notice the difference in, and the rules
// draft is genuinely good. (Contrast the outreach generator, where a repair
// turn earns its tokens because a prospect reads the result.)
function chooseBriefing(aiText, facts) {
  const rules = rulesBriefing(facts);
  const parsed = parseAiBriefing(aiText);
  if (!parsed) return { ...rules, ai_rejected: aiText ? 'unparseable' : null };
  const violations = checkBriefing(parsed, facts);
  if (violations.length) return { ...rules, ai_rejected: violations.join(',') };
  return { summary: parsed, engine: 'ai', quiet: rules.quiet, ai_rejected: null };
}

module.exports = {
  rulesBriefing,
  buildSystemPrompt,
  buildUserPayload,
  parseAiBriefing,
  checkBriefing,
  chooseBriefing,
  isQuiet,
  allowedNumbers,
  arrivalsOf,
  joinList,
  plural,
};
