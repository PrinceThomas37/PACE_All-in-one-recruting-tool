// ============================================================================
// GENERIC CARRIER ADAPTER — for any carrier that isn't Twilio: Exotel,
// Ozonetel, Knowlarity, Vonage, Plivo, MessageBird, or a client's own
// in-house PBX/relay. Rather than hand-write a bespoke adapter per vendor
// (most of which have their own undocumented-to-us webhook shapes, and would
// go untested against a real account anyway), this defines ONE simple
// contract any of them can be pointed at:
//
//   POST /telephony/generic/inbound
//   Header:  X-Webhook-Signature: hex(HMAC-SHA256(raw request body, secret))
//   Body (JSON): { "from": "+1...", "body": "text of the message",
//                  "message_key": "carrier's own message id, for dedup",
//                  "channel": "sms" | "whatsapp" | "voice" }
//
// Many CPaaS platforms let you customize the webhook payload/template to
// match a target shape; a client's own relay can format this directly. This
// is the real "bring your own carrier" path — it does not require us to
// write and maintain a new adapter for every vendor PACE or a customer might
// already have a relationship with.
//
// DARK BY DESIGN: TELEPHONY_GENERIC_WEBHOOK_SECRET is unset today, so
// isConfigured() is false and verifyWebhook() fails closed. One shared
// secret for now (matches the existing global-env-var convention —
// ANTHROPIC_API_KEY, MS_CLIENT/MS_SECRET, etc. are global too); per-org
// secrets are the natural next step if a customer needs their own carrier
// wired in, at which point this adapter's shape does not need to change,
// only where the secret is looked up.
// ============================================================================
const crypto = require('crypto');

function isConfigured() {
  return !!process.env.TELEPHONY_GENERIC_WEBHOOK_SECRET;
}

function verifyWebhook(req) {
  if (!isConfigured()) return false; // nothing to verify against — fail closed, not open
  const signature = req.get('X-Webhook-Signature');
  if (!signature || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', process.env.TELEPHONY_GENERIC_WEBHOOK_SECRET)
    .update(req.rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const VALID_CHANNELS = new Set(['sms', 'whatsapp', 'voice']);

function normalizeInbound(req) {
  const body = req.body || {};
  if (!body.from || typeof body.body !== 'string') return null;
  const channel = VALID_CHANNELS.has(body.channel) ? body.channel : 'sms';
  return {
    from: String(body.from),
    body: String(body.body),
    messageKey: body.message_key || null,
    channel,
  };
}

function ackResponse(res) {
  res.status(200).json({ ok: true });
}

/** Not implemented: this adapter only defines the INBOUND contract, since
 * outbound send is entirely carrier-specific (different APIs, different
 * auth) and there is no concrete carrier behind "generic" to send through.
 * A real bring-your-own-carrier integration would add its own send function
 * once a specific vendor is chosen — this stays null-returning so callers'
 * "no result means fall back" contract still holds. */
async function sendMessage() {
  return null;
}

module.exports = { name: 'generic', isConfigured, verifyWebhook, normalizeInbound, ackResponse, sendMessage };
