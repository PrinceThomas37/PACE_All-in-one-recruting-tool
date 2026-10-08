// ============================================================================
// GMAIL DELIVERY — how one outbound email leaves through a Gmail mailbox.
// ----------------------------------------------------------------------------
// A follow-up goes out as a reply inside the lead's earlier Gmail thread. A
// Gmail thread id belongs to ONE mailbox, so when the lead's sending mailbox
// has been switched since its first email, Gmail refuses the reply with 404
// "Requested entity was not found." Nothing is sent, and every retry is
// refused the same way. Measured live 2026-09-28: 14 first follow-ups from
// spencer.brown@ into threads that live in daniel.james@'s mailbox — the retry
// ladder took four tries and gave up, and pressing Retry started it over to
// the same end.
//
// The Outlook path has always answered this case (sendFollowupFreshWithQuote
// in index.js): send the follow-up as a FRESH email with the earlier message
// quoted underneath and "Re:" removed, so the "original below the follow-up"
// design holds and the email actually goes out. Gmail now does the same, and
// both paths build that fresh email with `freshFollowup` so they cannot drift.
//
// ONLY a definite not-found falls back. A timeout or a dropped connection may
// mean Gmail DID send the reply, and a fresh copy would then email the prospect
// twice — those are rethrown, and services/send-retry.js treats them as
// uncertain (never retried by itself).
//
// No clock, and every dependency is injected, so the tests drive the real
// function with a fake Gmail and a fake database.
// ============================================================================

function isFollowup(email) {
  const t = email && email.followup_type;
  return t === 'fu1' || t === 'fu2' || t === 'fu3' || t === 'fu4' || t === 'fu5';
}

// Gmail refused the request because the thing it names does not exist in
// this mailbox. The status is set by gmail-provider's api(); Google's wording
// is the fallback for an error raised anywhere else.
function isGmailNotFound(err) {
  if (!err) return false;
  if (Number(err.status) === 404) return true;
  return /requested entity was not found/i.test(String(err.message || ''));
}

// A follow-up that cannot be a reply: the earlier email quoted underneath,
// and no "Re:" — a "Re:" with no thread behind it pretends to be a reply.
function freshFollowup({ subject, htmlBody, quote }) {
  return {
    subject: String(subject || '').replace(/^(Re:\s*)+/i, ''),
    htmlBody: quote ? `${htmlBody}<br><br>${quote}` : htmlBody,
  };
}

/**
 * `supabase`: reads the lead's earlier thread id (emails.conversation_id).
 * `gmailProvider`: sendNewMessage / sendThreadReply (gmail-provider.js).
 * `buildQuote({ jobId, contactId, followupType })`: the earlier email as a
 *   quote block, '' when there is none (index.js buildQuotedChainFromDb).
 */
function createGmailDelivery({ supabase, gmailProvider, buildQuote }) {
  // The most recent thread this lead's conversation with this person has.
  async function priorThreadId(email) {
    const { data: prior } = await supabase.from('emails')
      .select('conversation_id').eq('job_id', email.job_id).eq('contact_id', email.contact_id)
      .not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
    return (prior && prior.conversation_id) || null;
  }

  // Returns the ids the send loop stores (persistGraphIds): Gmail's message id
  // and its thread id, in the fields the Graph path uses.
  async function deliver(email, userEmailId, htmlBody, sendingEmail) {
    const fromAddress = (sendingEmail && sendingEmail.email_address) || email.from_email || undefined;
    const to = email.to_email;
    if (!isFollowup(email)) {
      const r = await gmailProvider.sendNewMessage(userEmailId, { to, subject: email.subject, htmlBody, fromAddress });
      return { graphMessageId: r.messageId, conversationId: r.threadId || null, inReplyTo: null };
    }
    const threadId = await priorThreadId(email);
    if (threadId) {
      try {
        const r = await gmailProvider.sendThreadReply(userEmailId, { to, subject: email.subject, htmlBody, fromAddress, threadId });
        return { graphMessageId: r.messageId, conversationId: r.threadId || threadId, inReplyTo: null };
      } catch (e) {
        if (!isGmailNotFound(e)) throw e;
        // The thread is not in THIS mailbox — fall through to a fresh email.
      }
    }
    let quote = '';
    try {
      quote = await buildQuote({ jobId: email.job_id, contactId: email.contact_id, followupType: email.followup_type });
    } catch (_) { quote = ''; }
    const fresh = freshFollowup({ subject: email.subject, htmlBody, quote });
    const r = await gmailProvider.sendNewMessage(userEmailId, { to, subject: fresh.subject, htmlBody: fresh.htmlBody, fromAddress });
    return { graphMessageId: r.messageId, conversationId: r.threadId || null, inReplyTo: null };
  }

  return { deliver, priorThreadId };
}

module.exports = { createGmailDelivery, isGmailNotFound, freshFollowup, isFollowup };
