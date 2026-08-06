// ============================================================================
// TWILIO ADAPTER — one carrier plugged into the shared telephony pipeline
// (see registry.js for the interface every adapter implements). No `twilio`
// npm package — outbound HTTP goes through http-client.js, same convention
// as services/billing.js's Stripe seam.
//
// DARK BY DESIGN. There is no Twilio account today (see the Layer-3 plan
// doc's pricing scoping — this is a real recurring cost the owner has not
// yet signed off on). isConfigured() is false until both
// TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set, and every method is a
// safe no-op / fails closed until then — same posture as conversation-ai.js.
// ============================================================================
const crypto = require('crypto');
const { fetchWithTimeout } = require('../http-client');
const { last10Digits } = require('./phone-utils');

const SEND_TIMEOUT_MS = 15000;

function isConfigured() {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
}

function authHeader() {
  const token = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Verify an inbound webhook actually came from Twilio, per Twilio's
 * published signature algorithm: HMAC-SHA1 of (the exact request URL Twilio
 * was configured with + every POST param, sorted by key, concatenated as
 * key+value with no separator), base64-encoded, compared against the
 * X-Twilio-Signature header. PURE — no network, fully testable without a
 * live account or any real credentials. Exported directly (not just via the
 * adapter interface) because the algorithm itself is worth testing in
 * isolation from Express.
 */
function validateSignature({ url, params = {}, signature, authToken = process.env.TWILIO_AUTH_TOKEN }) {
  if (!authToken || !signature || !url) return false;
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // Constant-time compare — a webhook signature check is exactly the
  // comparison a timing attack targets, and a length mismatch must not
  // short-circuit through a fast, timing-observable `false` either.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyWebhook(req, rawUrl) {
  if (!isConfigured()) return false; // nothing to verify against — fail closed, not open
  return validateSignature({ url: rawUrl, params: req.body || {}, signature: req.get('X-Twilio-Signature') });
}

function normalizeInbound(req) {
  const body = req.body || {};
  const rawFrom = String(body.From || '');
  const whatsapp = rawFrom.startsWith('whatsapp:');
  return {
    from: rawFrom.replace(/^whatsapp:/, ''),
    body: String(body.Body || ''),
    messageKey: body.MessageSid || body.SmsSid || null,
    channel: whatsapp ? 'whatsapp' : (body.Body !== undefined ? 'sms' : 'voice'),
  };
}

function ackResponse(res) {
  // Twilio expects TwiML back; empty means "no automated reply." An error
  // here must never cause Twilio to retry-storm a webhook we don't fully
  // trust the shape of.
  res.type('text/xml').send('<Response></Response>');
}

/** Send an SMS or WhatsApp message. Returns null (never throws) with no
 * account configured, a network failure, or a rejected send — same
 * "no result means fall back" contract as conversation-ai.extractSignals. */
async function sendMessage({ to, from, body, channel = 'sms' }, opts = {}) {
  if (!isConfigured()) return null;
  if (!to || !from || !body) return null;
  const whatsapp = channel === 'whatsapp';
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({
    To: whatsapp ? `whatsapp:${to}` : to,
    From: whatsapp ? `whatsapp:${from}` : from,
    Body: body,
  });
  try {
    const response = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
      { timeoutMs: SEND_TIMEOUT_MS, fetchImpl: opts.fetchImpl }
    );
    const data = await response.json();
    if (!response.ok) {
      console.error('[telephony:twilio] send failed:', (data && data.message) || response.status);
      return null;
    }
    return { sid: data.sid, status: data.status };
  } catch (err) {
    console.error('[telephony:twilio] send failed:', err.message);
    return null;
  }
}

module.exports = {
  name: 'twilio',
  isConfigured, verifyWebhook, normalizeInbound, ackResponse, sendMessage,
  validateSignature, last10Digits, // exposed directly too: the algorithm and the phone-normalizer are each independently useful/testable
};
