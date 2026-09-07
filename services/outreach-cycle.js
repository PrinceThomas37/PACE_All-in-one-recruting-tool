// ============================================================================
// OUTREACH CYCLE — which prior emails may block a NEW cold email for a lead.
// ----------------------------------------------------------------------------
// PURE (no db, no fetch, no clock). The rule this encodes:
//
//   A lead that has been sent back to the Unassigned pool and re-assigned is
//   starting a FRESH outreach cycle. The duplicate-cold-email guard must be
//   scoped to the CURRENT cycle, not to all of history — otherwise a lead that
//   was ever emailed can be re-assigned but never re-emailed, and it fails
//   SILENTLY: distribution reports "assigned", generation quietly produces
//   nothing, and the lead sits with a BD who has no outreach to send.
//
// Within one cycle the guard is unchanged: re-running generation for a lead
// that already has a queued or sent initial email adds nothing.
// ============================================================================

// When did this lead's current outreach cycle begin? Assignment is what starts
// one; `last_recycled_at` covers a lead returned to the pool by the recycle
// sweep and not yet re-assigned. Null means "never assigned" — the caller then
// treats every prior email as blocking, which is the safe direction.
function cycleStartOf(job) {
  if (!job) return null;
  const times = [job.assigned_at, job.last_recycled_at]
    .map(v => (v ? new Date(v).getTime() : NaN))
    .filter(t => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

// Does this existing email row block generating a new initial outreach?
function blocksRegeneration(email, cycleStartIso) {
  if (!email || !email.contact_id) return false;
  // A failed/cancelled attempt may legitimately be re-sent.
  if (email.status === 'failed' || email.status === 'cancelled') return false;
  // Follow-ups never block an initial outreach.
  if (email.followup_type && email.followup_type !== 'initial') return false;
  if (!cycleStartIso) return true;
  const created = email.created_at ? new Date(email.created_at).getTime() : NaN;
  // An email with no readable timestamp is treated as current-cycle: blocking
  // is the direction that cannot send a duplicate cold email.
  if (!Number.isFinite(created)) return true;
  return created >= new Date(cycleStartIso).getTime();
}

// The field set that returns a lead to the Unassigned pool. Every path that
// does this — the bulk stage action, a single lead edit, the recycle sweep —
// must write the SAME fields, because `last_recycled_at` is what tells the
// dedup guard above that a new cycle has begun. A path that clears
// `assigned_at` without stamping it leaves the lead assignable but not
// emailable, which is the exact silent failure this module exists to stop.
function releaseToPoolUpdate(now = new Date()) {
  return {
    stage: 'Unassigned',
    assigned_to_bd: null,
    assigned_at: null,
    sending_email_id: null,
    last_recycled_at: now,
    updated_at: now,
  };
}

module.exports = { cycleStartOf, blocksRegeneration, releaseToPoolUpdate };
