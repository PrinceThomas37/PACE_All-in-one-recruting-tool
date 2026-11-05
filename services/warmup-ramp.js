// ============================================================================
// THE WARM-UP RAMP — how many emails a mailbox may send today while it is still warming up. ONE home for the rule.
// ----------------------------------------------------------------------------
// The cap is "starting cap + step × days since the start date" (both admin-editable: config/settings.js mailbox_warmup_start /
// mailbox_warmup_step; callers fetch them once per batch and pass them in — the literals below are only a last-resort fallback).
//
// The ramp holds ONLY while the mailbox is still in warm-up. The start date says when it began; the STATUS says whether it is still
// going. A mailbox that finished (graduated by the warm-up engine, or stopped by hand → 'warmed') or never warmed is not held back,
// even though its start date is still on record. 'paused' stays ramped: pausing a warm-up must never loosen the cap.
// (Sam Wilson, 5 Nov 2026: stopped warm-up by hand, the send loop kept capping him at 20 + 5 × days because it looked at the date only.)
//
// null = no ramp. Pure (clock injectable) so the rule can be called by a test instead of grepped.
// ============================================================================
'use strict';

const WARMUP_RAMP_STATUSES = ['warming', 'paused'];

function warmupLimit(mailboxRow, start, step, now) {
  if (!mailboxRow || !mailboxRow.warmup_start_date) return null;
  if (!WARMUP_RAMP_STATUSES.includes(mailboxRow.warmup_status)) return null;
  const startDate = new Date(mailboxRow.warmup_start_date);
  if (isNaN(startDate.getTime())) return null;
  const days = Math.max(0, Math.floor(((now != null ? now : Date.now()) - startDate.getTime()) / 86400000));
  const warmupStart = start != null ? start : 20;
  const warmupStep = step != null ? step : 5;
  return warmupStart + warmupStep * days;
}

module.exports = { warmupLimit, WARMUP_RAMP_STATUSES };
