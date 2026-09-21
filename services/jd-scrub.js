'use strict';
// ============================================================================
// REMOVING THE CLIENT FROM A JOB DESCRIPTION — pure, no db, no clock, no AI.
//
// WHY THIS IS ITS OWN FILE. Two places publish a job description to people
// outside the company, and they must agree about what "safe to publish" means:
//
//   • POST /job-orders/:id/posting-jd — the recruiter-facing "re-write job
//     description" button, which produces text to paste onto a job board.
//   • GET /apply/:token — the public apply page, which renders a description
//     to the open internet with no human in the loop at all.
//
// The second one is why this was extracted. A staffing desk's client list is
// the asset it is paid for, and the apply page publishes without anyone
// reading the result first. When the two paths had separate ideas about
// scrubbing, the automatic one was always going to be the weaker — and the
// weaker one is the one facing the public.
//
// WHAT IT REMOVES: the client's name (with and without a corporate suffix, so
// "Acme Corp" also catches a bare "Acme"), email addresses, URLs and phone
// numbers. It is deliberately blunt. Over-scrubbing costs a slightly awkward
// sentence; under-scrubbing costs a client.
//
// WHAT IT IS NOT: a guarantee. A description that refers to the client
// obliquely ("the largest homebuilder in Travis County") is not something a
// regular expression can find, which is exactly why the apply page prefers a
// human-written `posting_description` whenever one exists and only falls back
// to this. The AI rewrite in routes/recruiting/job-orders.js runs its output
// through here too, for the same reason.
// ============================================================================

const CORP_SUFFIX = /[,.]?\s+(inc|llc|llp|ltd|corp|co|company|group|pllc|pc)\.?$/i;

// Words a company name might open with that are also ordinary description
// vocabulary. Scrubbing one of these would shred the text it is meant to
// clean, so a name beginning with one keeps its first word.
const GENERIC_WORDS = new Set([
  'advanced', 'allied', 'alliance', 'american', 'associated', 'atlantic',
  'building', 'capital', 'central', 'certified', 'commercial', 'complete',
  'comprehensive', 'consolidated', 'construction', 'continental', 'creative',
  'custom', 'diamond', 'digital', 'diversified', 'dynamic', 'eastern', 'elite',
  'empire', 'energy', 'engineered', 'enterprise', 'excel', 'executive',
  'federal', 'general', 'global', 'golden', 'quality', 'greater', 'heritage',
  'industrial', 'infinity', 'innovative', 'integrated', 'international',
  'liberty', 'lincoln', 'modern', 'mountain', 'national', 'network',
  'northern', 'pacific', 'paramount', 'personnel', 'pinnacle', 'pioneer',
  'precision', 'preferred', 'premier', 'premium', 'professional', 'progress',
  'progressive', 'quality', 'regional', 'reliable', 'resource', 'resources',
  'select', 'service', 'services', 'signature', 'solution', 'solutions',
  'southern', 'specialty', 'standard', 'sterling', 'strategic', 'summit',
  'superior', 'supreme', 'systems', 'technical', 'technologies', 'technology',
  'trusted', 'united', 'universal', 'western',
]);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} jd     the description to clean
 * @param {string[]} names  every name for the client we know (client, end_client, company name)
 * @returns {string}
 */
function scrubJobDescription(jd, names) {
  // ORDER IS LOAD-BEARING, AND GETTING IT WRONG IS SILENT.
  //
  // Contact details are masked FIRST, before any name replacement. The client's
  // name is usually also its mail domain, so scrubbing names first rewrites
  // "careers@northwind.com" into "careers@our client.com" — which no longer
  // looks like an email address, so the contact pass then walks straight past
  // it and publishes the rest of the line. The name looked scrubbed; the
  // address was still on the page.
  let out = maskContacts(String(jd || ''));

  (Array.isArray(names) ? names : [names]).filter(Boolean).forEach((n) => {
    const safe = String(n).trim();
    // Under three characters a "name" matches half the alphabet — scrubbing on
    // it would shred the description rather than clean it.
    if (safe.length < 3) return;
    out = out.replace(new RegExp(escapeRe(safe), 'gi'), 'our client');

    const base = safe.replace(CORP_SUFFIX, '').trim();
    if (base.length >= 4 && base.toLowerCase() !== safe.toLowerCase()) {
      out = out.replace(new RegExp(escapeRe(base), 'gi'), 'our client');
    }

    // AND THE NAME PEOPLE ACTUALLY USE. "Northwind Construction LLC" appears in
    // the body as plain "Northwind", and stripping only the corporate suffix
    // leaves that everywhere — the whole leak, on the one page nobody reads
    // before it publishes.
    //
    // The risk in the other direction is real: a client called "Precision
    // Systems" would turn every "precision" in the description into "our
    // client". So the first word is scrubbed only when it is DISTINCTIVE —
    // long enough, and not ordinary business vocabulary. This is chosen to make
    // the false positive unlikely, not to make the catch exhaustive. A name
    // this misses is exactly why the apply page prefers a human-written
    // posting_description over anything this function can produce.
    const head = base.split(/\s+/)[0] || '';
    if (head.length >= 6 && !GENERIC_WORDS.has(head.toLowerCase()) &&
        head.toLowerCase() !== base.toLowerCase()) {
      out = out.replace(new RegExp('\\b' + escapeRe(head) + '\\b', 'gi'), 'our client');
    }
  });

  // CONTACT DETAILS GO BY THE SENTENCE, NOT BY THE CHARACTER. Deleting just the
  // address out of "Questions? Email careers@acme.com or call 860-555-0142."
  // leaves "Questions? Email or call ." on a page a stranger is reading, which
  // looks like the site is broken — a worse first impression than being short.
  out = dropMaskedSentences(out);

  return out
    .split(MASK).join('')                              // any mask that survived
    .replace(/(our client)(\s+\1)+/gi, 'our client')   // "our client our client"
    .replace(/\s+([.,;:!?])/g, '$1')                   // orphaned punctuation
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n').map((l) => capitaliseSentences(l.trim())).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// One pattern, used twice: to find contact details and to mask them. Note the
// global flag lives on a fresh regex per call — a shared /g regex carries
// lastIndex between calls and silently skips matches.
const CONTACT_SRC = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' +
                    '|https?:\\/\\/\\S+|www\\.\\S+' +
                    '|(?:\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}';

// A sentinel with no punctuation in it. THE MASKING HAS TO HAPPEN BEFORE THE
// SENTENCE SPLIT: an email and a URL both contain full stops, so splitting
// first chops "careers@acme.com" into two "sentences", neither of which still
// looks like an email — and the scrubber then walks straight past both halves
// and publishes them. That bug was visible only in a screenshot.
const MASK = '\u0000';

function maskContacts(text) {
  return String(text).replace(new RegExp(CONTACT_SRC, 'gi'), MASK);
}

function dropMaskedSentences(text) {
  return String(text).split('\n').map((line) => {
    if (!line.includes(MASK)) return line;
    // A bullet is one atomic thought: it goes whole or it stays whole.
    if (/^\s*[-*\u2022]/.test(line)) return '';
    const parts = line.match(/[^.!?]+[.!?]*/g) || [line];
    const keep = parts.map((p) => (p.includes(MASK) ? null : p));
    // A short lead-in whose payload was just removed ("Questions?", "Contact
    // us:") is now pointing at nothing, so it goes with it.
    for (let i = 0; i < keep.length - 1; i++) {
      if (keep[i] && keep[i + 1] === null &&
          keep[i].trim().split(/\s+/).length <= 3 && /[?:]\s*$/.test(keep[i])) {
        keep[i] = null;
      }
    }
    return keep.filter(Boolean).join(' ').trim();
  }).join('\n');
}

// "Acme is hiring" → "our client is hiring" reads as a typo at the start of a
// sentence. Only the first letter is touched, so an acronym mid-sentence and
// anything the customer capitalised deliberately are both left alone.
function capitaliseSentences(line) {
  return String(line).replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

/** Every name a job order might reveal its client by. */
function clientNames(job) {
  const j = job || {};
  return [j.client, j.end_client, j.company && j.company.name, j.client_manager].filter(Boolean);
}

module.exports = { scrubJobDescription, clientNames };
