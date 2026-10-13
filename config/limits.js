// ============================================================================
// THE FEW NUMBERS THAT MUST EXIST IN CODE BECAUSE SOMETHING HAS TO BE USED WHEN AN ADMIN HAS NOT YET CHOSEN (owner, 12 Oct, D-0123).
// ----------------------------------------------------------------------------
// The rule: a number that limits what a customer can do — emails, mailboxes, AI, users, tries, sizes, days — is never written into
// the code that enforces it. The admin decides it (Admin → System Settings, or the page it belongs to). What lives HERE is only the
// value used until the admin chooses one, in ONE place, so no two screens can disagree about it.
//
// DEFAULT_DAILY_SEND_LIMIT is what a mailbox may send per day when no admin has set a default (Admin → Email Engine Schedule →
// default daily limit). A new mailbox is created with the admin's number — never a number typed in a route. It is 150 because every
// mailbox has been created with 150 up to now; the send loop used to say 300 for a mailbox with no number, which disagreed.
// ============================================================================
module.exports = { DEFAULT_DAILY_SEND_LIMIT: 150 };
