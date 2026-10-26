'use strict';
// ============================================================================
// A REMINDER ABOUT SOMEONE PACE DOES NOT KNOW BECOMES A LEAD — AND IT IS YOURS (R-309, D-0178, owner 26 Oct).
//
// Martin's case: a follow-up reminder he typed himself for a person at a company that exists nowhere in PACE. The owner: "show
// a button of add it as new lead and take those information to create the new lead with the user who creates the email as
// owner, same for find leads lead creation." So:
//   · the button is offered only on a reminder that is not on a lead yet and carries an email address (reminderLeadOffer);
//   · the Add Lead window opens filled in from the reminder (person, email, company) and the person adds the position;
//   · the lead is saved OWNED by the person whose reminder it is — Assigned, from their main mailbox — like a Find Leads lead
//     becomes the person's who writes its email (D-0111, services/lead-claim.js); not dropped Unassigned into the pool;
//   · the reminder is then tied to the new lead and its contact, so it no longer reads as "someone PACE does not know".
// PURE: the route (routes/jobs.js POST /jobs, `from_reminder_id`) loads and writes.
// ============================================================================
const { ownerFields } = require('./lead-claim');

// The same test the screen uses to offer the button (public/js/10-page-modals.js canAddReminderAsLead).
// → null when it may become a lead, else the sentence that says why not.
function reminderLeadOffer(reminder) {
  if (!reminder) return 'That reminder was not found.';
  if (reminder.job_id || reminder.contact_id) return 'This reminder is already about a lead in PACE.';
  if (reminder.reminder_type === 'setup' || reminder.contact_name === 'Reconnect your mailbox') return 'This reminder is not about a person.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(reminder.email || '').trim())) return 'This reminder has no email address to make a lead from.';
  return null;
}

// The main mailbox a new lead of theirs sends from: the one marked primary, else their first; none → null (they pick at send).
function mainMailboxId(mailboxes) {
  const list = (mailboxes || []).filter(Boolean);
  const p = list.find((m) => m.is_primary) || list[0];
  return p ? p.id : null;
}

// The owner columns for the new lead — the same three fields a claim or an assignment writes.
function leadOwnerFields(userId, mailboxId, now) { return ownerFields(userId, mailboxId, now || new Date()); }

module.exports = { reminderLeadOffer, mainMailboxId, leadOwnerFields };
