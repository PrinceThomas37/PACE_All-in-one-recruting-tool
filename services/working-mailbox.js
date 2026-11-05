// WHICH OF A PERSON'S MAILBOXES CAN ACTUALLY SEND — one rule, in one place (R-399, D-0211, D-0215).
//
// A mailbox is CONNECTED when a stored sign-in exists for it, and REJECTED when Google / Microsoft answered "no" to the last refresh
// (`refresh_failed`, recorded by mailbox-health.js). A rejected mailbox still has its stored sign-in, so "connected" alone is not enough:
// Ash Sayyad's older mailbox (ash@futeglobal.com) was "connected" and rejected, won the "primary first, else oldest" default, and every
// send said "Gmail token refresh failed". Three server places also SAVE the chosen mailbox onto a lead (reminder send, assigning a lead,
// a lead made from a reminder), so a wrong pick sticks. They all ask THIS.
//
// The rule is for NEW choices only. It never rewrites a lead that is already tied to a mailbox (owner, 5 Nov: "absolute no" — those
// recover when the mailbox is reconnected).
//
// `mailboxes` come in the caller's order (primary first, then oldest); this only decides which of them may be picked.

const rejectedIds = (tokenRows) => new Set((tokenRows || []).filter((t) => t && t.refresh_failed === true).map((t) => t.user_email_id));

// The three sign-in tables (Microsoft, Gmail, app-password), read together. A missing table reads as none.
async function loadMailboxHealth(supabase, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return { connected: new Set(), rejected: new Set() };
  const [{ data: ms }, { data: gm }, smRes] = await Promise.all([
    supabase.from('microsoft_tokens').select('user_email_id,refresh_failed').in('user_email_id', list),
    supabase.from('gmail_tokens').select('user_email_id,refresh_failed').in('user_email_id', list),
    supabase.from('smtp_credentials').select('user_email_id,refresh_failed').in('user_email_id', list),
  ]);
  const rows = [...(ms || []), ...(gm || []), ...((smRes && smRes.data) || [])];
  return { connected: new Set(rows.map((t) => t.user_email_id)), rejected: rejectedIds(rows) };
}

// The first active mailbox that is connected AND not rejected. `fallbackToRejected`: when nothing works, return the first connected one
// (a caller that must show the honest "sign-in failed" error rather than "no mailbox"); otherwise null.
function pickWorkingMailbox(mailboxes, health, { fallbackToRejected = false } = {}) {
  const h = health || { connected: new Set(), rejected: new Set() };
  const usable = (mailboxes || []).filter((m) => m && m.is_active !== false && h.connected.has(m.id));
  return usable.find((m) => !h.rejected.has(m.id)) || (fallbackToRejected ? usable[0] : null) || null;
}

module.exports = { rejectedIds, loadMailboxHealth, pickWorkingMailbox };
