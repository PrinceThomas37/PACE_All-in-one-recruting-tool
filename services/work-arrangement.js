// ============================================================================
// WORK ARRANGEMENT — on-site / remote / hybrid, read from the job posting (R-343, owner 2 Nov 2026, D-0195 / D-0197).
// ----------------------------------------------------------------------------
// The "Add a detail" menu's "Work arrangement", a FULL PHRASE (owner's choice): "fully on-site (Dallas, TX)", "100% remote",
// "remote", "hybrid (3 days in office)", "hybrid". Read with plain keyword rules — no AI, instant, works for a person whose AI
// is off. A posting that does not say → '' → the sentence holding {{work_arrangement}} is left out of that lead's email
// (email-vars.js SENTENCE_DROPS_WHEN_EMPTY, the same as "Pay, if known" — owner: "A. Leave the sentence out").
// PURE. When it is unsure it says nothing: a wrong "100% remote" in a client's inbox is worse than a missing sentence.
// ============================================================================
'use strict';

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const NUM = '(\\d|one|two|three|four|five)';

function daysInOffice(t) {
  const pats = [
    new RegExp(NUM + '\\s*(?:\\+\\s*)?days?\\s*(?:a|per|each|/)?\\s*week\\s*(?:in|at|on)?\\s*(?:the\\s*)?(?:office|on[- ]?site|in[- ]?office)', 'i'),
    new RegExp(NUM + '\\s*(?:\\+\\s*)?days?\\s*(?:in|at)\\s*(?:the\\s*)?office', 'i'),
    new RegExp(NUM + '\\s*(?:\\+\\s*)?days?\\s*on[- ]?site', 'i'),
    new RegExp('(?:in|at)\\s*(?:the\\s*)?office\\s*' + NUM + '\\s*days?', 'i'),
    new RegExp('on[- ]?site\\s*' + NUM + '\\s*days?', 'i'),
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (m) { const n = WORDS[m[1].toLowerCase()] || Number(m[1]); if (n >= 1 && n <= 5) return n; }
  }
  return null;
}

/**
 * kind: 'onsite' | 'remote' | 'hybrid' | null. phrase: the words the email gets ('' when unknown).
 * `posting` = the job posting text; `place` = "City, ST" of the job (for the on-site phrase), optional.
 */
function read(posting, place) {
  const t = ' ' + String(posting || '').replace(/\s+/g, ' ') + ' ';
  if (t.trim().length < 20) return { kind: null, phrase: '' };
  const where = String(place || '').trim();

  // Each kind needs the posting to SAY it about the job — a word alone is not enough ("on-site lunch program", "hybrid VTOL
  // drone", "work from home negotiable after training" all read wrong on the first try against 60 live postings, 2 Nov).
  const notRemote = /\b(?:not|no|non)[- ]remote\b|\bnot (?:a |an )?(?:remote|work[- ]from[- ]home) (?:role|position|job)\b|\bremote work (?:is )?not (?:available|possible|an option)\b|\bno (?:work[- ]from[- ]home|wfh|telecommut\w*|remote) (?:options?|available|work)\b/i.test(t);
  const fullyRemote = /\b(?:100\s*%|fully|completely|entirely)\s*remote\b|\bremote[- ]first\b/i.test(t);
  const remote = !notRemote && (fullyRemote || /\b(?:this is a |is a )?remote (?:position|role|job|opportunity)\b|\b(?:work location|location|workplace type|work type)\s*:?\s*remote\b|\(\s*remote\s*\)|\bremote\s*[-–|]\s*(?:us|usa|united states)\b|\b(?:role|position|job) is (?:fully |100% )?remote\b/i.test(t));
  const onsite = /\b(?:100\s*%|fully|entirely)\s*on[- ]?site\b|\bon[- ]?site (?:role|position|job|opportunity)\b|\b(?:role|position|job) is (?:100% |fully )?(?:on[- ]?site|in[- ]office|in[- ]person)\b|\b(?:work location|location|workplace type|work type)\s*:?\s*(?:in[- ]person|on[- ]?site|in[- ]office)\b|\bin[- ]office (?:position|role|job|schedule)\b|\bin[- ]person (?:role|position|job)\b|\bno (?:work[- ]from[- ]home|remote) (?:options?|available|work)\b/i.test(t);
  const hybridSays = /\bhybrid\s*(?:role|position|job|schedule|work(?:ing|place)?|arrangement|opportunit\w*|set[- ]?up|model of work|in[- ]office|office|remote|\/|\()|\b(?:work location|location|workplace type|work type)\s*:?\s*hybrid\b|\b(?:role|position|job|this) is hybrid\b|\bwork(?:s|ing)? (?:a )?hybrid\b/i.test(t);

  if (hybridSays && !/\b100\s*%\s*on[- ]?site\b/i.test(t)) {
    const n = daysInOffice(t);
    return { kind: 'hybrid', phrase: n ? `hybrid (${n} day${n === 1 ? '' : 's'} in office)` : 'hybrid' };
  }
  if (remote && !onsite) return { kind: 'remote', phrase: fullyRemote ? '100% remote' : 'remote' };
  if (onsite && !remote) return { kind: 'onsite', phrase: where ? `fully on-site (${where})` : 'fully on-site' };
  return { kind: null, phrase: '' };          // says nothing, or says both without "hybrid": unsure → the sentence goes
}

module.exports = { read, daysInOffice };
