// ============================================================================
// TELEPHONY WEBHOOKS — inbound SMS/WhatsApp from Twilio.
// Layer-3 Step 3 scaffolding. Public, unauthenticated (Twilio can't carry our
// bearer tokens) — every request is verified against twilio-provider's
// signature check instead, the same trust model routes/tracking.js uses for
// the open-tracking pixel.
//
// DARK UNTIL A REAL TWILIO ACCOUNT EXISTS: with no TWILIO_ACCOUNT_SID/
// TWILIO_AUTH_TOKEN configured, signature validation always fails closed and
// these routes reject everything with 403 — there is nothing for Twilio to
// call yet, since no number has been purchased. Once a number exists and its
// webhook is pointed here, inbound messages are matched to a candidate
// (candidates.phone_norm, an exact generated-column match) or a contact
// (contacts.phone, a best-effort string match — contacts has no normalized
// phone column yet, unlike candidates; add one if this becomes real traffic)
// and stored the same way an inbound email is (conversation_messages,
// best-effort, guarded for migration 037 not being applied).
// ============================================================================
const express = require('express');
const twilioProvider = require('../twilio-provider');
const conversationIntel = require('../conversation-intel');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase } = ctx;
  router.use(express.urlencoded({ extended: false }));

  async function handleInbound(req, res, { whatsapp }) {
    // Always answer with empty TwiML — Twilio expects XML back, and an error
    // here must never cause Twilio to retry-storm a webhook we don't fully
    // trust the shape of yet.
    const reply = () => res.type('text/xml').send('<Response></Response>');

    if (!twilioProvider.isConfigured()) return res.sendStatus(403); // no account yet — nothing to verify against

    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const signature = req.get('X-Twilio-Signature');
    const valid = twilioProvider.validateSignature({ url: fullUrl, params: req.body || {}, signature });
    if (!valid) return res.sendStatus(403);

    try {
      const from = String(req.body.From || '').replace(/^whatsapp:/, '');
      const body = String(req.body.Body || '');
      const messageSid = req.body.MessageSid || req.body.SmsSid || null;
      const last10 = twilioProvider.last10Digits(from);

      let candidateId = null, contactId = null, jobId = null;
      if (last10) {
        const { data: cand } = await supabase.from('candidates')
          .select('id').eq('phone_norm', last10).is('deleted_at', null).limit(1).maybeSingle();
        if (cand) candidateId = cand.id;

        if (!candidateId) {
          // No normalized column on contacts yet — best-effort suffix match.
          const { data: contactMatches } = await supabase.from('contacts')
            .select('id,job_id,phone').limit(200);
          const hit = (contactMatches || []).find(c => twilioProvider.last10Digits(c.phone) === last10);
          if (hit) { contactId = hit.id; jobId = hit.job_id || null; }
        }
      }

      if (candidateId || contactId) {
        const cleanBody = conversationIntel.cleanForStorage(body);
        try {
          await supabase.from('conversation_messages').insert({
            contact_id: contactId,
            candidate_id: candidateId,
            job_id: jobId,
            provider: whatsapp ? 'twilio_whatsapp' : 'twilio_sms',
            message_key: messageSid,
            direction: 'inbound',
            from_email: from,
            body: cleanBody,
            sent_at: new Date().toISOString(),
            intent: conversationIntel.classifyIntent(cleanBody)?.id || null,
            has_question: conversationIntel.hasQuestion(cleanBody),
          });
        } catch (err) {
          if (!/does not exist|23505/i.test(String(err.message || ''))) {
            console.error('[telephony] store failed:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('[telephony] inbound handling failed:', err.message);
    }
    return reply();
  }

  router.post('/telephony/sms/inbound', (req, res) => handleInbound(req, res, { whatsapp: false }));
  router.post('/telephony/whatsapp/inbound', (req, res) => handleInbound(req, res, { whatsapp: true }));

  return router;
};
