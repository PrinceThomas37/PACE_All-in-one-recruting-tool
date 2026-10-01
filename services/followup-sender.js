// A FOLLOW-UP COMES FROM THE MAILBOX THAT SENT THE FIRST EMAIL (R-070, D-0067).
//
// Owner, 2026-10-01: "R-070 — yes." Until now a follow-up left from whichever mailbox the lead had
// AT THAT MOMENT. When a lead was handed to a colleague (Daniel James → Spencer Brown on 14 leads)
// the prospect got the follow-up from a different person with the first email quoted underneath —
// it read as a colleague chasing, and a Gmail thread belongs to the mailbox that started it.
//
// The rule: an automatic follow-up (fu1, fu2…) is sent from the mailbox that sent the FIRST email to
// that contact — found by the first email's `from_email` address — provided that mailbox is still
// active AND still connected. If it is not, the follow-up goes from the lead's current mailbox, as
// before: a follow-up that cannot leave from its original sender still goes, never stalls.
// An explicit per-email choice (sequence rotation) always wins over this and is never overridden.
//
// `pickFollowupMailbox` is PURE. `resolveFollowupPins` does the reading, with the db injected.

const isFollowup = (e) => /^fu\d/i.test(String((e && e.followup_type) || ''));
const isFirstEmail = (r) => !r.followup_type || String(r.followup_type).toLowerCase() === 'initial';

// rows: this contact's sent emails (any order). Returns the lower-cased from address of the earliest first email.
function firstSenderAddress(rows) {
  const firsts = (rows || []).filter(r => r && r.status === 'sent' && r.from_email && isFirstEmail(r))
    .sort((a, b) => String(a.sent_at || a.created_at || '').localeCompare(String(b.sent_at || b.created_at || '')));
  return firsts.length ? String(firsts[0].from_email).trim().toLowerCase() : '';
}

// byAddress: { 'addr@x.com': mailbox }, connectedIds: Set of mailbox ids with a live token.
// Returns the mailbox to send from, or null (→ keep the lead's current one).
function pickFollowupMailbox({ firstFrom, byAddress, connectedIds, currentMailboxId }) {
  if (!firstFrom) return null;
  const mb = (byAddress || {})[firstFrom];
  if (!mb || mb.is_active === false) return null;
  if (!connectedIds || !connectedIds.has(mb.id)) return null;
  if (mb.id === currentMailboxId) return null;        // already the right one: nothing to change
  return mb;
}

// pending: the send run's pending email rows ({ id, contact_id, followup_type, job:{sending_email_id} }).
// explicit: { emailId: mailboxId } — emails that already carry a deliberate choice; never touched.
// Returns { emailId: mailbox } for the follow-ups that must leave from their first sender.
async function resolveFollowupPins(supabase, pending, explicit) {
  const out = {};
  try {
    const fus = (pending || []).filter(e => isFollowup(e) && e.contact_id && !(explicit && explicit[e.id]));
    if (!fus.length) return out;
    const contactIds = [...new Set(fus.map(e => e.contact_id))];
    const firstBy = {};
    for (let i = 0; i < contactIds.length; i += 200) {
      const { data } = await supabase.from('emails').select('contact_id,from_email,followup_type,status,sent_at,created_at')
        .in('contact_id', contactIds.slice(i, i + 200)).eq('status', 'sent');
      const byContact = {};
      (data || []).forEach(r => { (byContact[r.contact_id] = byContact[r.contact_id] || []).push(r); });
      Object.keys(byContact).forEach(c => { firstBy[c] = firstSenderAddress(byContact[c]); });
    }
    const addrs = [...new Set(Object.values(firstBy).filter(Boolean))];
    if (!addrs.length) return out;
    const { data: mbs } = await supabase.from('user_emails').select('id,email_address,display_name,platform,daily_send_limit,is_active').in('email_address', addrs);
    const byAddress = {}; (mbs || []).forEach(m => { byAddress[String(m.email_address).toLowerCase()] = m; });
    const ids = (mbs || []).map(m => m.id);
    const connectedIds = new Set();
    if (ids.length) {
      const [{ data: ms }, { data: gm }] = await Promise.all([
        supabase.from('microsoft_tokens').select('user_email_id').in('user_email_id', ids),
        supabase.from('gmail_tokens').select('user_email_id').in('user_email_id', ids),
      ]);
      [...(ms || []), ...(gm || [])].forEach(t => connectedIds.add(t.user_email_id));
    }
    for (const e of fus) {
      const mb = pickFollowupMailbox({ firstFrom: firstBy[e.contact_id], byAddress, connectedIds, currentMailboxId: e.job && e.job.sending_email_id });
      if (mb) out[e.id] = mb;
    }
  } catch (_) { /* best-effort: no pins → every follow-up leaves from the lead's mailbox, exactly as before */ }
  return out;
}

module.exports = { isFollowup, firstSenderAddress, pickFollowupMailbox, resolveFollowupPins };
