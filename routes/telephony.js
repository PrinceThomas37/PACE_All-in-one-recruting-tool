// ============================================================================
// TELEPHONY WEBHOOKS — inbound calls/SMS/WhatsApp from ANY carrier.
// Layer-3 Step 3 scaffolding. Public, unauthenticated (a carrier can't carry
// our bearer tokens) — every request is verified by its own adapter's
// verifyWebhook() instead, the same trust model routes/tracking.js uses for
// the open-tracking pixel.
//
// PROVIDER-AGNOSTIC BY DESIGN: this route never talks to a specific vendor's
// API. It looks the provider up in telephony/registry.js, asks that adapter
// to verify + normalize the request, then runs the ONE shared pipeline
// (telephony/inbound.js) regardless of which carrier sent it. Twilio ships
// today; Exotel/Vonage/Plivo/a client's own PBX relay/anything else plugs in
// the same way — see telephony/registry.js for the adapter interface, and
// telephony/generic.js for the bring-your-own-carrier path that needs no new
// code at all, just a shared secret.
//
// DARK UNTIL A REAL ACCOUNT EXISTS behind whichever adapter is hit: every
// adapter's verifyWebhook() fails closed with no credentials configured, so
// these routes reject everything with 403 today — there is nothing calling
// them yet, since no carrier account has been purchased for any provider.
// ============================================================================
const express = require('express');
const registry = require('../telephony/registry');
const { processInboundTelephonyMessage } = require('../telephony/inbound');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase } = ctx;

  // Twilio posts application/x-www-form-urlencoded; the generic adapter (and
  // any future JSON-based carrier) rides on the express.json() already
  // applied globally in index.js (which also captures req.rawBody, which the
  // generic adapter's HMAC check needs).
  router.use(express.urlencoded({ extended: false }));

  router.post('/telephony/:provider/inbound', async (req, res) => {
    const adapter = registry.get(req.params.provider);
    if (!adapter) return res.sendStatus(404); // unknown carrier — not "wrong secret," just not registered

    const rawUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    let valid = false;
    try {
      valid = adapter.verifyWebhook(req, rawUrl);
    } catch (err) {
      console.error(`[telephony:${adapter.name}] verifyWebhook threw:`, err.message);
    }
    if (!valid) return res.sendStatus(403);

    try {
      const normalized = adapter.normalizeInbound(req);
      if (normalized) await processInboundTelephonyMessage(supabase, adapter.name, normalized);
    } catch (err) {
      console.error(`[telephony:${adapter.name}] inbound handling failed:`, err.message);
    }

    // Ack even on a handling failure — the alternative is the carrier
    // retry-storming a webhook whose payload we don't fully trust the shape
    // of, which is worse than losing one message.
    try { adapter.ackResponse(res); }
    catch (_) { res.sendStatus(200); }
  });

  return router;
};
