// ============================================================================
// TELEPHONY PROVIDER REGISTRY — one shared inbound/outbound pipeline, many
// carriers plugged in underneath it. Mirrors the pattern already used for
// email: Gmail and Microsoft Graph are two different APIs, but
// gmailProvider.normalizeMessage reshapes Gmail into Graph's shape so exactly
// ONE processInboundMessages function in index.js handles both — "two copies
// is how the stage vocabulary ended up hand-synced across six files" (see
// CLAUDE.md). Telephony follows the same rule: whichever carrier a client
// brings — Twilio, Exotel, Vonage, their own in-house PBX relay, anything —
// plugs in as an adapter here, and routes/telephony.js only ever talks to
// the adapter interface below, never to a specific vendor's API shape.
//
// ADAPTER INTERFACE (every provider module exports exactly this):
//   name          — string, matches the :provider route segment
//   isConfigured()      — bool: are this adapter's credentials present?
//   verifyWebhook(req, rawUrl) — bool: is this inbound request genuinely
//                    from the carrier it claims to be? MUST fail closed
//                    (false) whenever isConfigured() is false — an
//                    unconfigured adapter has nothing to verify against, so
//                    it must never accept anything.
//   normalizeInbound(req) — returns the shared shape:
//                    { from, body, messageKey, channel: 'sms'|'whatsapp'|'voice' }
//                    or null if the payload can't be parsed.
//   ackResponse(res)    — writes whatever response this carrier's webhook
//                    contract expects (Twilio wants TwiML XML; most others
//                    are happy with a 200).
//   sendMessage({ to, from, body, channel }) — outbound send. Returns null
//                    (never throws) when not configured or the send fails —
//                    same "no result means fall back" contract as
//                    conversation-ai.js.
//
// Every adapter here is DARK until its own credentials exist — see each
// file's header. Registering an adapter costs nothing: it is a pure function
// table until a real account is configured behind it.
// ============================================================================

const providers = new Map();

function register(adapter) {
  if (!adapter || !adapter.name) throw new Error('telephony adapter must export a name');
  providers.set(adapter.name, adapter);
}

function get(name) {
  return providers.get(name) || null;
}

function list() {
  return [...providers.keys()];
}

register(require('./twilio'));
register(require('./generic'));

module.exports = { register, get, list };
