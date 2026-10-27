// ============================================================================
// WHEN PACE PAUSES A MAILBOX FOR BOUNCING — the numbers it uses and the decision (D-0183 follow-up, 27 Oct 2026).
// ----------------------------------------------------------------------------
// The owner raised the bounce-rate limit to 10% in Admin and the mailboxes were still paused "in between". The limit is a
// per-ORGANISATION setting (D-0124: stored as sys_bounce_rate_threshold_pct@<org>), but the check read the deployment-wide
// value — the default 5% — so the admin's choice was never seen. The numbers are now read for the MAILBOX'S organisation, here,
// in one place, and the decision is a plain function a test can call.
// ============================================================================
'use strict';

/** The limits that apply to this mailbox: { thresholdPct, minSample } from ITS organisation's settings. */
async function limitsFor(supabase, settingsConfig, userEmailId) {
  let orgId;
  try {
    const { data } = await supabase.from('user_emails').select('org_id').eq('id', userEmailId).maybeSingle();
    orgId = (data && data.org_id) || undefined;
  } catch (_) { orgId = undefined; }      // unreadable: the shared value applies, never a crash
  const [thresholdPct, minSample] = await Promise.all([
    settingsConfig.getSetting(supabase, 'bounce_rate_threshold_pct', orgId),
    settingsConfig.getSetting(supabase, 'bounce_min_sample', orgId),
  ]);
  return { thresholdPct, minSample, orgId: orgId || null };
}

/** Pause only when enough has been sent to judge AND the bounce rate is OVER the limit (equal to the limit is not over it). */
function shouldPause({ bouncesToday, sentToday, thresholdPct, minSample }) {
  return sentToday >= minSample && sentToday > 0 && bouncesToday / sentToday > thresholdPct / 100;
}

module.exports = { limitsFor, shouldPause };
