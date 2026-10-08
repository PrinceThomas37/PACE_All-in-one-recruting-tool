// ============================================================================
// THE FOLLOW-UP CHAIN STARTS WHEN THE FIRST EMAIL IS SENT (owner, 8 Oct, D-0114)
// ----------------------------------------------------------------------------
// "Every new user … will first set up the sequence for the outreach. When the RA lead assigns the leads to the manager, those leads run
// through the sequence the user set. The user has to enable follow-up 1, 2, 3, 4 — how many they want. If no follow-up is enabled, no
// follow-up email is triggered for that outreach."
//
// Until now a follow_ups row was made only when an admin distributed leads, so a lead that arrived any other way (Assign, Take, Find
// Leads, a first email written by its owner) never got a chain. Now the moment a lead's FIRST email actually goes out, its owner's chain
// is made — the follow-ups THEY turned on, on the days THEY chose — unless the lead already has one.
//
// Never for: a person who turned none on; a lead that already has a chain (any status — a finished or skipped one is not re-made); a
// lead running through a Sequence (the sequence engine sends its own follow-ups). The engine then only sends a follow-up the person has
// written wording for (chain_rules 'own').
// ============================================================================
'use strict';
const steps = require('./followup-steps');

/** The row to insert, or null when this person wants none. PURE. */
function chainRow(settings, userId, { job_id, contact_id, user_email_id }, sentOn) {
  if (!userId || !job_id || !contact_id) return null;
  const due = steps.dueDates(settings, userId, sentOn);
  if (!Object.values(due).some(Boolean)) return null;
  return { job_id, contact_id, user_email_id: user_email_id || null, outreach_sent_at: String(sentOn).slice(0, 10), ...due, status: 'active', chain_rules: steps.RULES };
}

/**
 * Called after a FIRST email was sent. Best effort: a failure here must never undo or hide the send, so it returns what happened.
 *   email  the sent row {job_id, contact_id, sent_by, followup_type}
 *   job    the lead {assigned_to_bd, sending_email_id}
 * → { created: boolean, reason? }
 */
async function scheduleAfterFirstSend(supabase, { email, job, sentOn }) {
  try {
    if (!email || (email.followup_type && email.followup_type !== 'initial')) return { created: false, reason: 'not-first' };
    const userId = (job && job.assigned_to_bd) || email.sent_by;
    if (!userId || !email.job_id || !email.contact_id) return { created: false, reason: 'no-owner' };
    const keys = [`u_${userId}_fu_count`, ...steps.STEPS.map((t) => `u_${userId}_${t}_day`)];
    const { data: rows } = await supabase.from('app_settings').select('key,value').in('key', keys);
    const settings = {}; (rows || []).forEach((r) => { settings[r.key] = r.value; });
    const row = chainRow(settings, userId, { job_id: email.job_id, contact_id: email.contact_id, user_email_id: (job && job.sending_email_id) || null }, sentOn);
    if (!row) return { created: false, reason: 'none-chosen' };
    const { data: had } = await supabase.from('follow_ups').select('id').eq('job_id', email.job_id).eq('contact_id', email.contact_id).limit(1);
    if (had && had.length) return { created: false, reason: 'has-chain' };
    const { data: seq } = await supabase.from('workflow_enrollments').select('id').eq('contact_id', email.contact_id).eq('status', 'active').limit(1);
    if (seq && seq.length) return { created: false, reason: 'in-sequence' };
    const { error } = await supabase.from('follow_ups').insert(row);
    if (error) return { created: false, reason: 'error:' + error.message };
    return { created: true };
  } catch (e) { return { created: false, reason: 'error:' + e.message }; }
}

module.exports = { chainRow, scheduleAfterFirstSend };
