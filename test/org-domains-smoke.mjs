// Unit test for services/org-domains.js — claiming a domain and proving it.
//
// THIS IS AN ACCOUNT-TAKEOVER SURFACE, which is why the test is blunt about it.
// If an unverified claim ever counted, or a free mail provider were claimable,
// then whoever claims microsoft.com or gmail.com inherits every person on that
// domain who signs in — into THEIR workspace, under THEIR admin. Every
// assertion below exists to keep one of those two doors shut.
//
// The DNS resolver is injected, so verification is tested against exact record
// sets rather than the internet.
//
// Usage: node test/org-domains-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.JWT_SECRET = 'test-secret-for-domains';
const od = require('../services/org-domains.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const ORG = 'org-acme-1';
const OTHER_ORG = 'org-evil-2';

// ── 1. Normalising what a human types ───────────────────────────────────────
{
  const cases = [
    ['acme.com', 'acme.com'],
    ['  ACME.com  ', 'acme.com'],
    ['https://acme.com', 'acme.com'],
    ['http://www.acme.com/careers', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['alice@acme.com', 'acme.com'],
    ['acme.com.', 'acme.com'],
    ['ACME.CO.UK', 'acme.co.uk'],
  ];
  for (const [input, want] of cases) {
    ok(`normalises "${input}" → ${want}`, od.normalizeDomain(input) === want, od.normalizeDomain(input));
  }
  ok('empty input is safe', od.normalizeDomain('') === '' && od.normalizeDomain(null) === '');
}

// ── 2. FREE MAIL PROVIDERS ARE NEVER CLAIMABLE ──────────────────────────────
{
  for (const d of ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'proton.me', 'hotmail.com', 'aol.com']) {
    const v = od.validateDomain(d);
    ok(`${d} cannot be claimed`, v.ok === false && v.reason === 'free_mail', JSON.stringify(v));
  }
  ok('...and the refusal explains why in plain language',
    /personal email provider/.test(od.validateDomain('gmail.com').message), od.validateDomain('gmail.com').message);
  ok('a disposable-mail domain cannot be claimed either', od.validateDomain('mailinator.com').ok === false);
  ok('the check normalises first (WWW.GMAIL.COM is still gmail)', od.validateDomain('WWW.Gmail.com ').ok === false);
  ok('isFreeMailDomain agrees', od.isFreeMailDomain('gmail.com') && !od.isFreeMailDomain('acme.com'));
}

// ── 3. Only plausible company domains ───────────────────────────────────────
{
  ok('a normal company domain is claimable', od.validateDomain('acme.com').ok === true);
  ok('a subdomain is claimable', od.validateDomain('careers.acme.com').ok === true);
  ok('a multi-part TLD is claimable', od.validateDomain('acme.co.uk').ok === true);
  for (const bad of ['', 'acme', 'com', 'not a domain', 'acme..com', '-acme.com', 'acme-.com', 'acme.c']) {
    ok(`"${bad}" is refused`, od.validateDomain(bad).ok === false, JSON.stringify(od.validateDomain(bad)));
  }
  ok('an absurdly long domain is refused', od.validateDomain('a'.repeat(260) + '.com').ok === false);
}

// ── 4. The verification token ───────────────────────────────────────────────
{
  const t1 = od.verificationToken(ORG, 'acme.com');
  ok('the token is prefixed so an admin can recognise it', t1.startsWith(od.TOKEN_PREFIX), t1);
  ok('the token is stable across calls (no lookup needed)', t1 === od.verificationToken(ORG, 'acme.com'));
  ok('...and normalises its input', t1 === od.verificationToken(ORG, ' ACME.com '));

  // THE KEY PROPERTY: a different org gets a different token, so publishing
  // one org's record does nothing for another's claim.
  ok('a DIFFERENT org gets a DIFFERENT token for the same domain',
    od.verificationToken(OTHER_ORG, 'acme.com') !== t1);
  ok('a different domain gets a different token', od.verificationToken(ORG, 'other.com') !== t1);
  ok('the token carries enough entropy to be unguessable', t1.replace(od.TOKEN_PREFIX, '').length >= 32, t1);
}
{
  const inst = od.verificationInstructions(ORG, 'https://www.acme.com/');
  ok('instructions name the record type', inst.record_type === 'TXT');
  ok('...the normalised domain', inst.domain === 'acme.com', inst.domain);
  ok('...the exact value to paste', inst.value === od.verificationToken(ORG, 'acme.com'));
  ok('...and warn about propagation delay', /propagat/i.test(inst.note), inst.note);
}

// ── 5. Verification against DNS ─────────────────────────────────────────────
const resolverReturning = (records) => async () => records;
const resolverThatFails = () => async () => { throw new Error('ENOTFOUND'); };
const resolverThatHangs = () => () => new Promise(() => {});

{
  const token = od.verificationToken(ORG, 'acme.com');
  // Real TXT records arrive as arrays of 255-char chunks.
  const r = await od.checkVerification(ORG, 'acme.com', { resolver: resolverReturning([[token]]) });
  ok('a matching TXT record verifies the domain', r.verified === true, JSON.stringify(r));
}
{
  const token = od.verificationToken(ORG, 'acme.com');
  const r = await od.checkVerification(ORG, 'acme.com', {
    resolver: resolverReturning([['v=spf1 include:_spf.google.com ~all'], ['some-other=thing'], [token]]),
  });
  ok('it finds the record among unrelated TXT records', r.verified === true, JSON.stringify(r));
}
{
  // THE ATTACK: another org publishes ITS token on a domain it does not own.
  const wrongToken = od.verificationToken(OTHER_ORG, 'acme.com');
  const r = await od.checkVerification(ORG, 'acme.com', { resolver: resolverReturning([[wrongToken]]) });
  ok("another org's token does NOT verify this org's claim", r.verified === false, JSON.stringify(r));
}
{
  const r = await od.checkVerification(ORG, 'acme.com', { resolver: resolverReturning([['nothing-relevant']]) });
  ok('an unrelated record does not verify', r.verified === false && r.reason === 'not_found', JSON.stringify(r));
  ok('...and says what to check', /not found/i.test(r.message), r.message);
}
{
  const r = await od.checkVerification(ORG, 'acme.com', { resolver: resolverThatFails() });
  ok('a domain that does not resolve is "not yet", not an error', r.verified === false && r.reason === 'no_dns', JSON.stringify(r));
  ok('...phrased for someone who just added the record', /few minutes/i.test(r.message), r.message);
}
{
  // A hostile nameserver must not hang the request.
  const started = Date.now();
  const r = await od.checkVerification(ORG, 'acme.com', { resolver: resolverThatHangs() });
  const elapsed = Date.now() - started;
  ok('a hanging nameserver times out instead of hanging', r.verified === false, JSON.stringify(r));
  ok('...within a bounded time', elapsed < 9000, `${elapsed}ms`);
}
{
  const token = od.verificationToken(ORG, 'acme.com');
  // Chunked records must be joined before comparing, or a long token never matches.
  const half = Math.floor(token.length / 2);
  const r = await od.checkVerification(ORG, 'acme.com', {
    resolver: resolverReturning([[token.slice(0, half), token.slice(half)]]),
  });
  ok('a chunked TXT record is joined before comparing', r.verified === true, JSON.stringify(r));
}
{
  // Verification must refuse a free-mail domain before it ever hits DNS —
  // otherwise someone who can publish TXT on a provider's domain gets in.
  const r = await od.checkVerification(ORG, 'gmail.com', {
    resolver: resolverReturning([[od.verificationToken(ORG, 'gmail.com')]]),
  });
  ok('gmail.com cannot be verified EVEN WITH a matching record', r.verified === false, JSON.stringify(r));
  ok('...for the free-mail reason', r.reason === 'free_mail', r.reason);
}
{
  const r = await od.checkVerification(ORG, 'not a domain', { resolver: resolverReturning([]) });
  ok('a malformed domain is refused before DNS', r.verified === false && r.reason === 'malformed', JSON.stringify(r));
}
{
  const token = od.verificationToken(ORG, 'acme.com');
  const r = await od.checkVerification(ORG, 'acme.com', {
    resolver: resolverReturning([[`  ${token}  `]]),
  });
  ok('surrounding whitespace in the record is tolerated', r.verified === true, JSON.stringify(r));
}

console.log('\n=== ORG DOMAINS SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
