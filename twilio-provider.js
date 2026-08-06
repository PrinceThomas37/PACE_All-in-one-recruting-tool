// ============================================================================
// TWILIO PROVIDER — outbound SMS/WhatsApp send + inbound webhook signature
// validation. No `twilio` npm package — outbound HTTP goes through
// http-client.js, same convention as services/billing.js's Stripe seam.
//
// DARK BY DESIGN. There is no Twilio account today (see the Layer-3 plan doc's
// pricing scoping — this is a real recurring cost the owner has not yet
// signed off on a number for). isConfigured() is false until both
// TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set, and every send is a safe
// no-op until then — same posture as conversation-ai.js and routes/ai.js.
// Applying migrations/042 or deploying this file commits to no cost by
// itself: nothing calls Twilio, and no number is provisioned, until real
// credentials exist.
// ============================================================================
const crypto = require('crypto');
const { fetchWithTimeout } = require('./http-client');

const SEND_TIMEOUT_MS = 15000;

function isConfigured() {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
}

function authHeader() {
  const token = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${token}`;
}

/** Send an SMS or WhatsApp message. Returns null (never throws) with no
 * account configured, a network failure, or a rejected send — same
 * "no result means fall back" contract as conversation-ai.extractSignals. */
async function sendMessage({ to, from, body, whatsapp = false }, opts = {}) {
  if (!isConfigured()) return null;
  if (!to || !from || !body) return null;
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
      console.error('[twilio] send failed:', data && data.message || response.status);
      return null;
    }
    return { sid: data.sid, status: data.status };
  } catch (err) {
    console.error('[twilio] send failed:', err.message);
    return null;
  }
}

/**
 * Verify an inbound webhook actually came from Twilio, per Twilio's published
 * signature algorithm: HMAC-SHA1 of (the exact request URL Twilio was
 * configured with + every POST param, sorted by key, concatenated as
 * key+value with no separator), base64-encoded, compared against the
 * X-Twilio-Signature header. PURE — no network, fully testable without a
 * live account or any real credentials.
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

/** Digits-only, last 10 — the same normalization candidates.phone_norm
 * already applies in Postgres (migration 012), kept here for JS-side phone
 * matching against contacts, which has no equivalent generated column. */
function last10Digits(phone) {
  return String(phone || '').replace(/[^0-9]/g, '').slice(-10);
}

module.exports = { isConfigured, sendMessage, validateSignature, last10Digits };
