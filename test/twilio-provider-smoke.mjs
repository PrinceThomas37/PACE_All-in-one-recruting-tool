// Unit test for twilio-provider.js — Layer-3 Step 3 scaffolding. There is no
// Twilio account in this repo (or in CI), so this asserts the two things that
// must be true regardless: (1) the module is dark — isConfigured() false,
// every send a safe no-op — and (2) the signature-validation algorithm that
// would gate real webhooks is correct, tested against Twilio's own published
// example without any network call or real credentials.
//
// Usage: node test/twilio-provider-smoke.mjs   (no external dependencies)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── 1. Dark by default: no TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN in this test's environment
{
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  const twilio = require('../twilio-provider.js');
  ok('isConfigured() is false with no credentials', twilio.isConfigured() === false);
  const result = await twilio.sendMessage({ to: '+15550001111', from: '+15550002222', body: 'hi' });
  ok('sendMessage() is a safe no-op with no credentials', result === null, JSON.stringify(result));
}
{
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxx';
  // TWILIO_AUTH_TOKEN still unset — half-configured must still be dark.
  const twilio = require('../twilio-provider.js');
  ok('isConfigured() is false with only half the credentials set', twilio.isConfigured() === false);
  delete process.env.TWILIO_ACCOUNT_SID;
}

const twilio = require('../twilio-provider.js');

// ── 2. Signature validation — Twilio's published algorithm: HMAC-SHA1 of the
// url with every POST param (sorted by key) appended as key+value, base64
// encoded. The expected value below is computed independently in Python
// (hmac/hashlib, a different HMAC implementation entirely) against the exact
// same inputs, so this cross-checks the algorithm itself, not just that the
// module agrees with its own math.
{
  const authToken = '12345';
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' };
  const expectedSignature = 'GvWf1cFY/Q7PnoempGyD5oXAezc='; // python: hmac.new(token, url+sorted(k+v), sha1) -> b64
  ok('a genuine Twilio signature validates', twilio.validateSignature({ url, params, signature: expectedSignature, authToken }));
  ok('a tampered signature does NOT validate', !twilio.validateSignature({ url, params, signature: 'not-the-real-signature==', authToken }));
  ok('tampered params do NOT validate against the original signature',
    !twilio.validateSignature({ url, params: { ...params, Digits: '9999' }, signature: expectedSignature, authToken }));
  ok('the wrong auth token does NOT validate', !twilio.validateSignature({ url, params, signature: expectedSignature, authToken: 'wrong-token' }));
}
{
  ok('missing signature fails closed, not open', !twilio.validateSignature({ url: 'https://x.com', params: {}, signature: null, authToken: 'x' }));
  ok('missing auth token fails closed, not open', !twilio.validateSignature({ url: 'https://x.com', params: {}, signature: 'x', authToken: '' }));
  ok('missing url fails closed, not open', !twilio.validateSignature({ url: '', params: {}, signature: 'x', authToken: 'x' }));
}

// ── 3. Phone normalization ──────────────────────────────────────────────────
{
  ok('formatting is stripped to the last 10 digits', twilio.last10Digits('+1 (415) 867-5310') === '4158675310');
  ok('an already-bare number round-trips', twilio.last10Digits('4158675310') === '4158675310');
  ok('a missing number normalizes to an empty string, not a crash', twilio.last10Digits(null) === '');
}

console.log('\n=== TWILIO PROVIDER SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
