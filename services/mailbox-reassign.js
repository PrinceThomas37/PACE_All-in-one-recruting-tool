// ============================================================================
// MAILBOX REASSIGNMENT — when a mailbox goes inactive, move its leads
// ----------------------------------------------------------------------------
// Deactivating a mailbox (or disconnecting Microsoft/Gmail) used to leave any
// lead already pointed at it silently stuck: the send loop skips a job whose
// sending_email is inactive rather than failing it, so those emails just sit
// in "pending" forever with nothing telling anyone why. This finds another
// active, connected mailbox for the same user and moves the affected leads
// to it — or reports how many are stranded if there isn't one.
// ============================================================================

async function findFallbackMailbox(supabase, userId, excludeId) {
  const { data: candidates } = await supabase.from('user_emails')
    .select('id,is_primary,daily_send_limit')
    .eq('user_id', userId).eq('is_active', true).neq('id', excludeId);
  if (!candidates || !candidates.length) return null;

  const ids = candidates.map(c => c.id);
  const [{ data: msTokens }, { data: gmailTokens }] = await Promise.all([
    supabase.from('microsoft_tokens').select('user_email_id,refresh_failed').in('user_email_id', ids),
    supabase.from('gmail_tokens').select('user_email_id,refresh_failed').in('user_email_id', ids),
  ]);
  const connectedIds = new Set(
    [...(msTokens || []), ...(gmailTokens || [])]
      .filter(t => !t.refresh_failed)
      .map(t => t.user_email_id)
  );
  const connected = candidates.filter(c => connectedIds.has(c.id));
  if (!connected.length) return null;
  connected.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  return connected[0];
}

// Moves every non-deleted job still pointed at `userEmailId` to another active,
// connected mailbox belonging to the same user. Returns:
//   { reassigned: n, fallback_email_id: id|null, stranded: n }
// `stranded` is the count of jobs left on the deactivated mailbox because no
// working fallback exists — callers should surface this, not swallow it.
async function reassignJobsOffMailbox(supabase, userEmailId, userId) {
  const { data: affectedJobs } = await supabase.from('jobs')
    .select('id').eq('sending_email_id', userEmailId).is('deleted_at', null);
  const affectedCount = (affectedJobs || []).length;
  if (!affectedCount) return { reassigned: 0, fallback_email_id: null, stranded: 0 };

  const fallback = await findFallbackMailbox(supabase, userId, userEmailId);
  if (!fallback) return { reassigned: 0, fallback_email_id: null, stranded: affectedCount };

  const { error } = await supabase.from('jobs')
    .update({ sending_email_id: fallback.id, updated_at: new Date() })
    .eq('sending_email_id', userEmailId).is('deleted_at', null);
  if (error) throw error;
  return { reassigned: affectedCount, fallback_email_id: fallback.id, stranded: 0 };
}

module.exports = { reassignJobsOffMailbox };
