// enrichment.js — find a point of contact and a plausible email, at zero cost.
//
// THE CONSTRAINT. The budget for this is ₹0 (docs/AUTONOMOUS_ENGINE_PLAN.md).
// Paid contact databases are the normal answer and we are not using one yet, so
// this does what a good researcher does by hand: work out the company's email
// pattern, apply it to a named person, and verify the domain will accept mail.
//
// THE TIERS, cheapest first. Nothing moves to a paid tier until the free one
// has failed, and the paid tier is not wired yet — the seam is here so adding a
// key later is a small change rather than a redesign.
//
//   1. Pattern inference + DNS verification (free, unlimited, works today)
//   2. Cached patterns per domain — the single most valuable thing to cache,
//      because one answer covers every future person at that company
//   3. Hunter / Apollo domain search (metered; free tiers are 25/month and 125
//      credits respectively, so reserved for accounts worth spending on)
//
// HONESTY ABOUT WHAT THIS PRODUCES. An inferred address is a *guess with a
// confidence score*, not a verified contact. DNS tells us the domain accepts
// mail; it cannot tell us the mailbox exists. Every address carries its method
// and confidence so the review screen can show it, and so a human decides
// whether to send. The existing bounce sweep is the backstop: a wrong guess
// bounces once and is marked invalid forever.

const { emailSyntaxValid, domainHasMx } = require('./email-validation');

// The patterns worth trying, in rough order of how common they are across US
// and Indian corporate mail. Confidence reflects prevalence, not certainty
// about this specific company.
const PATTERNS = [
  { id: 'first.last',  build: (f, l) => `${f}.${l}`, confidence: 0.45 },
  { id: 'firstlast',   build: (f, l) => `${f}${l}`,  confidence: 0.15 },
  { id: 'flast',       build: (f, l) => `${f[0]}${l}`, confidence: 0.20 },
  { id: 'first_last',  build: (f, l) => `${f}_${l}`, confidence: 0.05 },
  { id: 'first',       build: (f) => f,              confidence: 0.10 },
  { id: 'firstl',      build: (f, l) => `${f}${l[0]}`, confidence: 0.05 }
];

// Generic mailboxes that a company almost certainly has. These are NOT a POC —
// but for recruiting they are often the intended target anyway (careers@ and
// hr@ are read by the people we want), so they're offered as a clearly-labelled
// fallback rather than pretended to be a person.
const ROLE_MAILBOXES = ['careers', 'jobs', 'hr', 'recruiting', 'talent', 'info'];

// Titles worth targeting at an end client, best first. Used to rank whatever
// names we manage to find, and to tell a paid provider what to look for later.
const TARGET_TITLES = [
  'talent acquisition', 'head of talent', 'recruiting manager', 'technical recruiter',
  'hr manager', 'head of hr', 'people operations', 'hiring manager',
  'engineering manager', 'director of engineering', 'vp engineering', 'cto'
];

function clean(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z]/g, '');
}

// Pull a usable domain out of whatever we were given — a bare domain, a URL, or
// an email address.
function normalizeDomain(input) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].trim();
  // Must look like a domain: at least one dot, no spaces, plausible TLD.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

// Split a display name into first/last. Returns null when it isn't a person's
// name — we would rather produce nothing than address someone as "Team".
function splitName(fullName) {
  const parts = String(fullName == null ? '' : fullName).trim().split(/\s+/)
    .filter(p => p && !/^(mr|mrs|ms|dr|prof)\.?$/i.test(p));
  if (parts.length < 2) return null;
  const first = clean(parts[0]);
  const last = clean(parts[parts.length - 1]);
  if (first.length < 2 || last.length < 2) return null;
  return { first, last };
}

// Build candidate addresses for a person at a domain, best guess first.
// `knownPattern` (from the cache or a paid lookup) collapses this from a list of
// guesses to a single high-confidence answer — which is the whole reason the
// cache stores patterns rather than addresses.
function inferEmails(fullName, domain, knownPattern) {
  const d = normalizeDomain(domain);
  const name = splitName(fullName);
  if (!d || !name) return [];

  if (knownPattern) {
    const p = PATTERNS.find(x => x.id === knownPattern);
    if (p) {
      const address = `${p.build(name.first, name.last)}@${d}`;
      if (emailSyntaxValid(address)) {
        return [{ email: address, pattern: p.id, confidence: 0.9, method: 'known_pattern' }];
      }
    }
  }

  return PATTERNS
    .map(p => ({
      email: `${p.build(name.first, name.last)}@${d}`,
      pattern: p.id, confidence: p.confidence, method: 'pattern_inference'
    }))
    .filter(c => emailSyntaxValid(c.email));
}

function roleMailboxes(domain) {
  const d = normalizeDomain(domain);
  if (!d) return [];
  return ROLE_MAILBOXES.map(r => ({
    email: `${r}@${d}`, pattern: 'role_address', confidence: 0.35, method: 'role_mailbox'
  })).filter(c => emailSyntaxValid(c.email));
}

// Verify the DOMAIN can receive mail. This is free, cached 6h by the existing
// helper, and is the only verification available without paying.
//
// It deliberately does NOT claim the mailbox exists. `deliverable: 'domain_ok'`
// is the strongest honest statement we can make, and the UI says exactly that.
async function verifyDomain(domain) {
  const d = normalizeDomain(domain);
  if (!d) return { domain: null, deliverable: 'unknown', reason: 'no usable domain' };
  try {
    const hasMx = await domainHasMx(d);
    return hasMx
      ? { domain: d, deliverable: 'domain_ok', reason: 'domain accepts mail (MX present)' }
      : { domain: d, deliverable: 'no_mx', reason: 'domain has no mail server — do not send' };
  } catch (err) {
    // A transient DNS failure must never condemn a domain; the existing
    // email-validation module takes the same position.
    return { domain: d, deliverable: 'unknown', reason: 'could not check DNS just now' };
  }
}

// The one call the ingest pipeline makes.
//
// Given a company (and optionally names discovered elsewhere), produce ranked
// contact candidates with honest confidence. With no names available it returns
// role mailboxes, clearly labelled — for recruiting outreach careers@/hr@ is
// frequently the right target anyway, and it is better than an empty lead.
async function findContacts({ companyName, domain, people = [], knownPattern } = {}) {
  const d = normalizeDomain(domain);
  const check = await verifyDomain(d);

  // No mail server means nothing here is sendable. Say so once, loudly, rather
  // than handing back a list of addresses that will all bounce.
  if (check.deliverable === 'no_mx') {
    return { domain: d, deliverable: check, contacts: [], note: check.reason };
  }

  const contacts = [];
  for (const p of (Array.isArray(people) ? people : [])) {
    const name = typeof p === 'string' ? p : (p && p.name);
    const title = (p && p.title) || null;
    for (const guess of inferEmails(name, d, knownPattern)) {
      contacts.push({
        name, title,
        email: guess.email,
        confidence: guess.confidence,
        method: guess.method,
        pattern: guess.pattern,
        deliverable: check.deliverable,
        // Provenance, required by the compliance note in the plan: every sourced
        // person must record where they came from.
        source: 'inferred'
      });
    }
  }

  if (!contacts.length) {
    for (const r of roleMailboxes(d)) {
      contacts.push({
        name: null, title: 'Company mailbox', email: r.email,
        confidence: r.confidence, method: r.method, pattern: r.pattern,
        deliverable: check.deliverable, source: 'role_address'
      });
    }
  }

  contacts.sort((a, b) => b.confidence - a.confidence);
  return {
    domain: d,
    deliverable: check,
    contacts: contacts.slice(0, 8),
    note: contacts.length ? null : 'No contact could be inferred without a name or a domain.'
  };
}

module.exports = {
  findContacts, inferEmails, roleMailboxes, verifyDomain,
  normalizeDomain, splitName, PATTERNS, TARGET_TITLES, ROLE_MAILBOXES
};
