// ============================================================================
// ORGANISATION DOMAINS — claiming a domain, and PROVING you own it.
//
// This is the foundation of self-serve signup: when someone signs in with
// alice@acme.com, PACE needs to know whether acme.com belongs to a customer
// (join their workspace, with the role their admin set) or nobody (a personal
// workspace).
//
// WHY VERIFICATION IS NOT OPTIONAL
// An unverified claim is an account-takeover primitive. If I can claim
// microsoft.com, then every Microsoft employee who ever signs in with SSO lands
// inside MY workspace, under MY admin, with me able to read whatever they do.
// So a claim starts UNVERIFIED and grants nothing until a DNS TXT record only
// the real domain owner could publish is observed. That is the same proof
// Google Workspace, Microsoft 365 and Stripe use, for the same reason.
//
// FREE MAIL PROVIDERS ARE NEVER CLAIMABLE. Nobody's *organisation* is
// gmail.com. Allowing it would hand one person every Gmail user who signs up —
// the same takeover, wearing a friendlier hat. The list below is a floor, not a
// complete census: it is checked alongside the "is this even a company domain"
// rules, and adding to it is cheap.
//
// The DNS lookup reuses the same timeout-guarded resolver the deliverability
// checks already use, so a slow or hostile nameserver cannot hang a request.
// ============================================================================

const dns = require('dns').promises;
const crypto = require('crypto');

const DNS_TIMEOUT_MS = 5000;
const TOKEN_PREFIX = 'pace-domain-verification=';

// Deliberately conservative: consumer mailbox providers and the disposable
// services people reach for when they want a throwaway account.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.in', 'hotmail.com',
  'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.in',
  'yahoo.co.uk', 'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com',
  'zohomail.com', 'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com',
  'yandex.com', 'yandex.ru', 'rediffmail.com', 'inbox.com', 'fastmail.com',
  // disposable / throwaway
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'sharklasers.com',
  'trashmail.com', 'getnada.com', 'dispostable.com',
]);

/** Normalise anything a human might type into a bare domain. */
function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^[a-z]+:\/\//, '');   // strip a scheme
  d = d.split('/')[0];                 // strip a path
  d = d.split('@').pop();              // accept a whole email address
  d = d.replace(/^www\./, '');
  d = d.replace(/\.$/, '');            // trailing dot from a FQDN
  return d;
}

/**
 * Is this something an organisation could plausibly own?
 * Returns { ok } or { ok:false, reason, message }.
 */
function validateDomain(input) {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, reason: 'empty', message: 'Enter a domain.' };
  if (domain.length > 253) return { ok: false, reason: 'too_long', message: 'That domain is too long.' };
  // Labels: letters/digits/hyphens, not starting or ending with a hyphen.
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    return { ok: false, reason: 'malformed', message: `"${domain}" does not look like a domain name.` };
  }
  if (FREE_MAIL_DOMAINS.has(domain)) {
    return {
      ok: false, reason: 'free_mail',
      message: `${domain} is a personal email provider, so no single organisation can claim it. Use your company's own domain.`,
    };
  }
  // A public suffix on its own ("com", "co.uk") is not an organisation.
  if (domain.split('.').length < 2) {
    return { ok: false, reason: 'malformed', message: 'Enter your full company domain, e.g. acme.com.' };
  }
  return { ok: true, domain };
}

/**
 * The token an org publishes to prove ownership.
 *
 * Derived from the org id + domain via HMAC over JWT_SECRET rather than stored
 * randomly, so it is stable across restarts and reproducible without a lookup —
 * and it cannot be guessed by someone who does not hold the server secret,
 * which is what stops a squatter from pre-publishing a valid-looking record.
 */
function verificationToken(orgId, domain) {
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || 'pace-dev-secret')
    .update(`${orgId}:${normalizeDomain(domain)}`)
    .digest('hex')
    .slice(0, 32);
  return TOKEN_PREFIX + h;
}

/** What we tell the admin to add at their DNS provider. */
function verificationInstructions(orgId, domain) {
  const d = normalizeDomain(domain);
  return {
    domain: d,
    record_type: 'TXT',
    host: d,                                  // the apex; most providers show this as "@"
    value: verificationToken(orgId, d),
    note: 'Add this TXT record at your DNS provider, then press Verify. DNS can take a few minutes to propagate — up to an hour on some providers.',
  };
}

/**
 * Look for the token in the domain's TXT records.
 *
 * Never throws: a domain that does not resolve, has no TXT records, or whose
 * nameserver hangs is simply "not verified yet", which is also what an honest
 * admin sees five minutes before propagation completes.
 */
async function checkVerification(orgId, domain, { resolver } = {}) {
  const v = validateDomain(domain);
  if (!v.ok) return { verified: false, reason: v.reason, message: v.message };

  const expected = verificationToken(orgId, v.domain);
  let records = null;
  try {
    const lookup = (resolver || dns.resolveTxt)(v.domain);
    records = await Promise.race([
      lookup.catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), DNS_TIMEOUT_MS)),
    ]);
  } catch (_) {
    records = null;
  }

  if (!records) {
    return { verified: false, reason: 'no_dns', message: `No TXT records found for ${v.domain} yet. If you have just added it, give DNS a few minutes.` };
  }
  // Each record arrives as an array of 255-char chunks that must be joined.
  const flat = records.map((r) => (Array.isArray(r) ? r.join('') : String(r)).trim());
  const found = flat.some((r) => r === expected);
  return found
    ? { verified: true, domain: v.domain }
    : { verified: false, reason: 'not_found', message: `The verification record was not found on ${v.domain}. Check the value matches exactly, then try again.`, seen: flat.length };
}

const isFreeMailDomain = (d) => FREE_MAIL_DOMAINS.has(normalizeDomain(d));

module.exports = {
  normalizeDomain, validateDomain, verificationToken, verificationInstructions,
  checkVerification, isFreeMailDomain, FREE_MAIL_DOMAINS, TOKEN_PREFIX,
};
