// ============================================================================
// SHARED TELEPHONY INBOUND HANDLING — ONE pipeline for every carrier.
// Whichever adapter (registry.js) normalized the webhook, it hands off a
// { from, body, messageKey, channel } shape here, and everything past that
// point — matching to a candidate/contact, storing the message — runs
// exactly once. Mirrors index.js's processInboundMessages, which does the
// same job for Gmail + Microsoft Graph behind gmailProvider.normalizeMessage.
// "Two copies is how the stage vocabulary ended up hand-synced across six
// files" (CLAUDE.md) — this file exists so telephony never grows a second one
// per carrier.
// ============================================================================
const { last10Digits } = require('./phone-utils');
const conversationIntel = require('../conversation-intel');

/**
 * @param {object} supabase
 * @param {string} providerName - registry key, e.g. 'twilio' | 'generic'
 * @param {{from:string, body:string, messageKey:?string, channel:string}} normalized
 */
async function processInboundTelephonyMessage(supabase, providerName, normalized) {
  const { from, body, messageKey, channel } = normalized;
  const last10 = last10Digits(from);
  let candidateId = null, contactId = null, jobId = null;

  if (last10) {
    const { data: cand } = await supabase.from('candidates')
      .select('id').eq('phone_norm', last10).is('deleted_at', null).limit(1).maybeSingle();
    if (cand) candidateId = cand.id;

    if (!candidateId) {
      // contacts has no normalized phone column yet (unlike candidates —
      // migration 012's phone_norm) — best-effort suffix match in JS. Worth
      // a dedicated generated column if this becomes real traffic.
      const { data: contactMatches } = await supabase.from('contacts')
        .select('id,job_id,phone').limit(200);
      const hit = (contactMatches || []).find(c => last10Digits(c.phone) === last10);
      if (hit) { contactId = hit.id; jobId = hit.job_id || null; }
    }
  }

  if (!candidateId && !contactId) return { matched: false };

  const cleanBody = conversationIntel.cleanForStorage(body);
  try {
    await supabase.from('conversation_messages').insert({
      contact_id: contactId,
      candidate_id: candidateId,
      job_id: jobId,
      provider: `${providerName}_${channel}`,
      message_key: messageKey,
      direction: 'inbound',
      from_email: from, // conversation_messages' text columns hold phone numbers fine
      body: cleanBody,
      sent_at: new Date().toISOString(),
      intent: conversationIntel.classifyIntent(cleanBody)?.id || null,
      has_question: conversationIntel.hasQuestion(cleanBody),
    });
  } catch (err) {
    // 23505 = we already have this message (dedup on provider+message_key) —
    // expected, not an error. A missing table means migration 037 isn't
    // applied yet — same graceful degradation as the email path.
    if (!/does not exist|23505/i.test(String(err.message || ''))) {
      console.error('[telephony] store failed:', err.message);
    }
  }

  return { matched: true, candidateId, contactId };
}

module.exports = { processInboundTelephonyMessage };
