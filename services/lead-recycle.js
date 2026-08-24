// ============================================================================
// LEAD RECYCLING — a lead that has sat in 'Assigned' with no reply for too
// long is dead weight: nobody is going to nudge it (the follow-up engine has
// already run its course by then, and a stale-silence chase-nudge on top of
// it is exactly the noise the "To chase" gate in next-action.js was built to
// avoid), and it just occupies a BD manager's Assigned list forever. This
// returns leads like that to the Unassigned pool so they can be
// redistributed — to the same BD or a different one — for a fresh attempt,
// instead of sitting there indefinitely.
//
// PURE decision logic only — no DB, no `new Date()` without an injectable
// clock. The sweep that actually reads/writes jobs lives in index.js
// (runLeadRecycleSweep), mirroring the pattern in conversation-intel.js /
// next-action.js: reason about time and state in one small, testable place.
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Should this job be recycled back to Unassigned?
 *
 * job:      { stage, assigned_at }
 * contacts: [{ replied_at }, ...]  — every contact on the job
 * now:      epoch ms
 * thresholdDays: how many days of silence since assignment before recycling
 */
function isRecyclable(job, contacts, now, thresholdDays) {
  if (!job || job.stage !== 'Assigned') return false;
  if (!job.assigned_at) return false;
  const assignedAt = new Date(job.assigned_at).getTime();
  if (!Number.isFinite(assignedAt)) return false;
  if (now - assignedAt < thresholdDays * DAY_MS) return false;
  // Any reply at all means there is a real, live conversation — recycling
  // that would throw away engagement, not just clear out dead weight. (If
  // the lead genuinely went quiet after replying once, that's exactly the
  // "To chase" nudge's job once the stage reflects the engagement.)
  const everReplied = (contacts || []).some(c => c && c.replied_at);
  if (everReplied) return false;
  return true;
}

module.exports = { isRecyclable, DAY_MS };
