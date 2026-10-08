// ============================================================================
// A LEAD NOBODY OWNS YET BECOMES SOMEONE'S WHEN THEIR FIRST EMAIL IS WRITTEN (D-0110)
// ----------------------------------------------------------------------------
// The owner (8 Oct): an import, and a Find Leads accept, land UNASSIGNED; "when an email is triggered to a POC in the lead the
// stage should be changed to assigned — only then." So writing the first email for a lead that has no owner makes the person
// who wrote it the owner, records the mailbox it goes from, and moves the stage to Assigned. A manager can also hand leads out
// without writing anything (routes/lead-assign.js) — both end in the same three fields, built here.
//
// PURE: no database, no clock (the caller passes `now`). The caller applies the update WITH the pool conditions on it (still
// Unassigned, still unowned), so two people acting together can never both get the same lead.
// ============================================================================
'use strict';
const dist = require('./lead-distribution');

/** Is this lead one that nobody owns yet? Ownership decides, never the stage label (services/ownership.js isPoolLead). */
function isUnowned(job) { return !!job && !job.assigned_to_bd; }

/**
 * Which of `jobs` a person claims by writing their first emails, and from which of THEIR mailboxes.
 *   accounts  the person's connected mailboxes [{id,email_address,display_name,remaining}]
 *   wantedId  a mailbox the person chose ('' = let the system spread them, as everywhere else)
 * → { claims: [{ job_id, mailbox_id }] }
 */
function planClaim(jobs, accounts, wantedId, rand) {
  const mine = (jobs || []).filter(isUnowned);
  if (!mine.length) return { claims: [] };
  const accs = accounts || [];
  let queue;
  if (wantedId) queue = mine.map(() => wantedId);
  else {
    // The same spread rule Assign Leads / Take leads use; with no room recorded anywhere fall back to the first mailbox.
    queue = dist.assignmentQueue(accs.map((a) => ({ ...a, remaining: a.remaining > 0 ? a.remaining : 1 })), mine.length, rand);
    if (queue.length < mine.length && accs[0]) while (queue.length < mine.length) queue.push(accs[0].id);
  }
  return { claims: mine.map((j, i) => ({ job_id: j.id, mailbox_id: queue[i] })) };
}

/** The columns a claim or an assignment writes (the stage word is "Assigned": the lead now has a person and a mailbox). */
function ownerFields(userId, mailboxId, now) {
  const at = now && now.toISOString ? now.toISOString() : now;
  return { assigned_to_bd: userId, assigned_to: userId, sending_email_id: mailboxId, stage: 'Assigned', assigned_at: at, updated_at: at };
}

/**
 * Persist a plan for the leads that really got an email. The pool conditions go ON the update (still unowned), so a lead somebody
 * else was handed a moment ago is NOT taken twice.
 *   jobsTable()  a fresh, org-scoped `jobs` query builder
 *   withEmail    a Set of job ids an email was written for
 * → { claimed: [job_id], lost: [job_id] }  (the caller drops the queued emails of the lost ones)
 */
async function applyClaims({ jobsTable, claims, withEmail, userId, now }) {
  const claimed = [], lost = [];
  for (const c of claims || []) {
    if (!withEmail || !withEmail.has(c.job_id)) continue;
    const { data: got, error } = await jobsTable().update(ownerFields(userId, c.mailbox_id, now)).eq('id', c.job_id).is('assigned_to_bd', null).select('id');
    if (error || !got || !got.length) lost.push(c.job_id); else claimed.push(c.job_id);
  }
  return { claimed, lost };
}

module.exports = { isUnowned, planClaim, ownerFields, applyClaims };
