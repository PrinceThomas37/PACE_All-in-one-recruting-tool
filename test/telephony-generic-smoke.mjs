// Unit test for telephony/generic.js — the bring-your-own-carrier adapter:
// any CPaaS vendor or a client's own PBX relay that can POST a small JSON
// payload with an HMAC header. No real carrier is configured in this repo
// (or CI), so this asserts the module is dark by default and, independent of
// that, that its HMAC verification and payload normalization are correct.
//
// Usage: node test/telephony-generic-smoke.mjs   (no external dependencies)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import crypto from 'node:crypto';

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const fakeReq = (body, opts = {}) => ({
  body,
  rawBody: 'rawBody' in opts ? opts.rawBody : Buffer.from(JSON.stringify(body)),
  get: (h) => (h === 'X-Webhook-Signature' ? opts.signature : undefined),
});

// ── 1. Dark by default: no TELEPHONY_GENERIC_WEBHOOK_SECRET ────────────────
{
  delete process.env.TELEPHONY_GENERIC_WEBHOOK_SECRET;
  const generic = require('../telephony/generic.js');
  ok('the adapter identifies itself as "generic"', generic.name === 'generic');
  ok('isConfigured() is false with no secret', generic.isConfigured() === false);
  ok('verifyWebhook() fails closed with no secret, even given a plausible request',
    generic.verifyWebhook(fakeReq({ from: '+1', body: 'hi' }, { signature: 'anything' })) === false);
  const sendResult = await generic.sendMessage();
  ok('sendMessage() is a no-op (this adapter defines inbound only)', sendResult === null);
}

// ── 2. HMAC verification, once a secret exists ──────────────────────────────
{
  process.env.TELEPHONY_GENERIC_WEBHOOK_SECRET = 'super-secret';
  const generic = require('../telephony/generic.js');
  ok('isConfigured() is true once a secret is set', generic.isConfigured() === true);

  const payload = { from: '+14158675310', body: 'Interested, send details', message_key: 'ext-123', channel: 'sms' };
  const raw = Buffer.from(JSON.stringify(payload));
  const goodSig = crypto.createHmac('sha256', 'super-secret').update(raw).digest('hex');

  ok('a correctly signed request validates', generic.verifyWebhook(fakeReq(payload, { rawBody: raw, signature: goodSig })));
  ok('a wrong signature does NOT validate', !generic.verifyWebhook(fakeReq(payload, { rawBody: raw, signature: 'deadbeef'.repeat(8) })));
  ok('a signature computed with the wrong secret does NOT validate',
    !generic.verifyWebhook(fakeReq(payload, { rawBody: raw, signature: crypto.createHmac('sha256', 'wrong-secret').update(raw).digest('hex') })));
  ok('a tampered body does NOT validate against the original signature',
    !generic.verifyWebhook(fakeReq({ ...payload, body: 'tampered' }, { rawBody: Buffer.from(JSON.stringify({ ...payload, body: 'tampered' })), signature: goodSig })));
  ok('a missing signature header fails closed', !generic.verifyWebhook(fakeReq(payload, { rawBody: raw, signature: undefined })));
  ok('a missing rawBody fails closed (never trusts req.body alone for the HMAC)',
    !generic.verifyWebhook(fakeReq(payload, { rawBody: undefined, signature: goodSig })));

  delete process.env.TELEPHONY_GENERIC_WEBHOOK_SECRET;
}

// ── 3. normalizeInbound — same shared shape every adapter must produce ─────
{
  const generic = require('../telephony/generic.js');
  const n = generic.normalizeInbound({ body: { from: '+14158675310', body: 'Hi there', message_key: 'ext-1', channel: 'whatsapp' } });
  ok('a well-formed payload normalizes correctly', n && n.from === '+14158675310' && n.body === 'Hi there' && n.channel === 'whatsapp', JSON.stringify(n));
}
{
  const generic = require('../telephony/generic.js');
  const n = generic.normalizeInbound({ body: { from: '+1', body: 'Hi', channel: 'not-a-real-channel' } });
  ok('an unrecognized channel falls back to "sms" rather than passing through garbage', n.channel === 'sms', JSON.stringify(n));
}
{
  const generic = require('../telephony/generic.js');
  ok('a payload missing "from" is rejected (null), not guessed at', generic.normalizeInbound({ body: { body: 'Hi' } }) === null);
  ok('a payload missing "body" is rejected (null), not guessed at', generic.normalizeInbound({ body: { from: '+1' } }) === null);
}

console.log('\n=== TELEPHONY: GENERIC ADAPTER SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
