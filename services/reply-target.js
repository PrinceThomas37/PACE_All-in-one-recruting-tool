// ============================================================================
// WHICH EMAIL DOES "REPLY" ANSWER?  (owner, 8 Oct: "when Reply in the mailbox is clicked, that particular email doesn't open — the
// mailbox does, and the user does not know what to do"; and for a follow-up, "an email button which goes as a reply to the last
// conversation".) One pure rule, used by the lead/client emails route: of a conversation's messages, which is the newest one the
// person can actually answer from their OWN mailbox — and who is on the other end of it.
//
// A message is answerable when we know the mailbox provider's id for it (an inbound row keeps `message_key`; an email we sent keeps
// the provider id in `message_id`) AND it sits in one of THIS person's mailboxes (an inbound one arrived at its `to`; an outbound
// one left from its `from`). A teammate's mailbox is never offered — the in-app mailbox only opens your own (404 otherwise).
//
//   pickReplyTargets(messages, myMailboxes, { email })
//     messages     newest first, as client-intel builds them: { direction, from, to, person, subject, message_key, message_id }
//     myMailboxes  [{ id, email_address }]
//     email        optional: only messages whose OTHER side is this address (a row about one person)
//   → { last, last_inbound }   each null or { message_id, mailbox_id, direction, other_email, other_name, subject }
// ============================================================================
function addr(v) {
  const s = String(v == null ? '' : v);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function describe(m, mine, only) {
  const inbound = m.direction === 'inbound';
  const providerId = inbound ? m.message_key : m.message_id;
  if (!providerId) return null;
  const myAddr = addr(inbound ? m.to : m.from);
  const box = mine.find(b => addr(b.email_address) === myAddr);
  if (!box) return null;
  const other = addr(inbound ? m.from : String(m.to || '').split(/[;,]/)[0]);
  if (!other) return null;
  if (only && other !== only) return null;
  return {
    message_id: String(providerId), mailbox_id: box.id, direction: inbound ? 'inbound' : 'outbound',
    other_email: other, other_name: m.person || null, subject: m.subject || '',
  };
}

function pickReplyTargets(messages, myMailboxes, opts) {
  const mine = Array.isArray(myMailboxes) ? myMailboxes : [];
  const only = opts && opts.email ? addr(opts.email) : '';
  let last = null, lastInbound = null;
  for (const m of (messages || [])) {
    if (last && lastInbound) break;
    if (!m || (m.direction !== 'inbound' && m.direction !== 'outbound')) continue;
    const t = describe(m, mine, only);
    if (!t) continue;
    if (!last) last = t;
    if (!lastInbound && t.direction === 'inbound') lastInbound = t;
  }
  return { last, last_inbound: lastInbound };
}

module.exports = { pickReplyTargets, addr };
