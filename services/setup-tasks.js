// ============================================================================
// SETUP TASKS — what PACE asks a person to do first, on their OWN task list (owner, 8 Oct 2026, D-0104).
// ----------------------------------------------------------------------------
// PURE. "At login the user's first task is to set up their mailbox and sequence; it is added to their tasks." A task here is a
// reminder (reminder_type 'setup') — it shows on Reminders and Today like any task, SAYS who asked (PACE, to get them started —
// services/reminder-source.js), and CLOSES ITSELF when the thing is done. A task PACE cannot carry out is not created: the
// sequence task exists only for people who have a sequence to write (bd, bd lead, admin), the mailbox task only for people
// who send outreach.
// ============================================================================
const QUIET_DAYS = 3;
const TITLES = { mailbox: 'Set up your outreach mailbox', sequence: 'Write your first sequence' };
const NOTES = {
  mailbox: 'Connect the Outlook or Gmail mailbox your outreach goes out from, and say which company and title it writes for. Open My Setup. Until then you can still write individual emails from a mailbox an admin gave you, but nothing is sent from you.',
  sequence: 'Write the first email and follow-ups your leads receive — a starter with your company\'s name is one click. Until you have your own sequence PACE will not start outreach for your leads or from the Lead Finder; individual emails are not affected. Open My Setup.',
};

/**
 * What is owed right now.
 * facts = { sends: bool (sends outreach at all), hasSequenceRole: bool (bd / bd lead / admin), connected: number (mailboxes signed in),
 *           hasOwnSequence: bool }
 * Returns the keys that are owed, e.g. ['mailbox', 'sequence'].
 */
function owed(facts) {
  const f = facts || {};
  const out = [];
  if (f.sends && !(f.connected > 0)) out.push('mailbox');
  if (f.sends && f.hasSequenceRole && !f.hasOwnSequence) out.push('sequence');
  return out;
}

/**
 * Compare what is owed with the person's existing setup reminders and say what to do.
 * `existing` = [{ id, contact_name, status }] (their reminder_type 'setup' rows). Returns { create: [key], close: [id] }.
 * Idempotent: running it twice changes nothing the second time.
 */
function plan(owedKeys, existing, now) {
  const titleToKey = {}; Object.keys(TITLES).forEach((k) => { titleToKey[TITLES[k]] = k; });
  const pending = {}; const recentlyClosed = {}; const create = []; const close = [];
  const t = now ? new Date(now).getTime() : Date.now();
  (existing || []).forEach((r) => {
    const key = titleToKey[r.contact_name]; if (!key) return;
    if (r.status !== 'pending') {
      // Marked done without doing it: not asked again for a few days (a task that comes straight back is a nag, not a task).
      const made = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (made && t - made < QUIET_DAYS * 86400000) recentlyClosed[key] = true;
      return;
    }
    if (owedKeys.indexOf(key) >= 0 && !pending[key]) pending[key] = r.id; else close.push(r.id);   // a duplicate, or no longer owed
  });
  owedKeys.forEach((k) => { if (!pending[k] && !recentlyClosed[k]) create.push(k); });
  return { create, close };
}

module.exports = { owed, plan, TITLES, NOTES, QUIET_DAYS };
