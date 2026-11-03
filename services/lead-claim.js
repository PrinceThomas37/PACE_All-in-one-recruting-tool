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

/**
 * The columns a claim or an assignment writes (the stage word is "Assigned": the lead now has a person and a mailbox).
 * `byUserId` is WHO handed it over (R-340, owner 3 Nov 2026) — the person themselves when they claim or take a lead, the manager or RA Lead
 * when they hand it out. Defaults to the new owner: a claim is nobody's but the claimer's.
 */
function ownerFields(userId, mailboxId, now, byUserId) {
  const at = now && now.toISOString ? now.toISOString() : now;
  return { assigned_to_bd: userId, assigned_to: userId, sending_email_id: mailboxId, stage: 'Assigned', assigned_at: at, assigned_by: byUserId || userId, updated_at: at };
}

/** The sentence the lead history shows, said ONCE for every way a lead gets an owner. */
function assignmentSentence({ by, to, how }) {
  const b = by || 'someone', t = to || 'someone';
  if (t === 'themselves') return `${b} assigned it to themselves`;
  if (how === 'claim') return `Became ${t}'s lead when ${t} wrote the first email`;
  if (how === 'take') return `Taken from the pool by ${t}`;
  if (how === 'edit') return `Assigned to ${t} by ${b} (lead edited)`;
  return `Assigned to ${t} by ${b}`;
}

/**
 * RA Lead / admin hands a batch of unassigned leads to a manager (POST /distribute/execute). `byBox` is { mailbox_id: [job ids] }.
 * Each write takes a lead ONLY while it is still Unassigned and unowned, so two assignments made back to back can never hand the same lead
 * to two people. Returns the leads that were really assigned, with the mailbox each went from. (Moved out of index.js so it can be tested;
 * the fields and the conditions are the ones that were inline there, plus assigned_by.)
 */
async function assignToManager({ jobsTable, byBox, managerId, byUserId, now }) {
  const assigned = [];
  for (const emailId of Object.keys(byBox || {})) {
    for (let i = 0; i < byBox[emailId].length; i += 200) {
      const { data: took, error } = await jobsTable()
        .update({ assigned_to_bd: managerId, sending_email_id: emailId, stage: 'Assigned', assigned_at: now, assigned_by: byUserId || null, updated_at: now })
        .in('id', byBox[emailId].slice(i, i + 200)).eq('stage', 'Unassigned').is('assigned_to_bd', null).select('id');
      if (error) throw error;
      (took || []).forEach((j) => assigned.push({ job_id: j.id, user_email_id: emailId }));
    }
  }
  return assigned;
}

/** History rows for a batch (one insert per 200, not one per lead — Seoul is ~200 ms a trip). */
function historyRows(jobIds, { byUserId, sentence, toUserId }) {
  return (jobIds || []).map((id) => ({ job_id: id, user_id: byUserId || null, action_type: 'assigned', description: sentence,
    old_value: null, new_value: { assigned_to_bd: toUserId, assigned_by: byUserId || null } }));
}
async function writeHistory(activityTable, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await activityTable().insert(rows.slice(i, i + 200));
    if (error) return false;          // the history is a record, never the point: the assignment already happened
  }
  return true;
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
    const { data: got, error } = await jobsTable().update(ownerFields(userId, c.mailbox_id, now, userId)).eq('id', c.job_id).is('assigned_to_bd', null).select('id');
    if (error || !got || !got.length) lost.push(c.job_id); else claimed.push(c.job_id);
  }
  return { claimed, lost };
}

module.exports = { isUnowned, planClaim, ownerFields, applyClaims, assignmentSentence, assignToManager, historyRows, writeHistory };
