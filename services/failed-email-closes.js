'use strict';
// ============================================================================
// "CLOSE FOR ME" ON SOMEONE ELSE'S FAILED EMAIL (R-382, owner 4 Nov: a teammate's "Sending was interrupted" email sat on the manager's Pending
// screen for days with no button at all).
//
// The sender can already Close their own failed email — that DELETES the row, so it is the sender's act (D-0020: managers review and prompt, never
// reach in). A manager must not delete a teammate's row, but must be able to stop looking at it. So this is a per-viewer CLOSE: it hides the row for
// THAT viewer only, never touches the email, and never changes what the sender or anyone else sees.
//   * it is closed against the FACT it was closed against (the failure reason): if the same email is retried and fails in a different way it returns;
//   * a closed row that is gone (sent, deleted) simply stops mattering; the record is small and capped (the newest MAX kept).
// PURE: no database, no clock of its own. Storage (routes/emails.js): one app_settings row per person, `failed_closed_<userId>`.
// shortcut: capped at the newest MAX closes per person, and the screen does not show a "N closed" line for these (they stay on the sender's own
// list); upgrade if managers ask to see what they closed.
// ============================================================================
const MAX = 500;
const key = (userId) => `failed_closed_${userId}`;
const fpOf = (email) => String((email && email.fail_reason) || '');

/** Add these (someone else's) failed emails to the person's closed set. Returns the new store; the oldest beyond MAX fall away. */
function addCloses(store, emails, now = Date.now()) {
  const next = { ...(store && typeof store === 'object' ? store : {}) };
  (emails || []).forEach((e) => { if (e && e.id) next[e.id] = { fp: fpOf(e), at: new Date(now).toISOString() }; });
  const ids = Object.keys(next);
  if (ids.length > MAX) ids.sort((a, b) => String(next[a].at).localeCompare(String(next[b].at))).slice(0, ids.length - MAX).forEach((id) => { delete next[id]; });
  return next;
}
const isClosed = (store, email) => !!(store && email && store[email.id] && store[email.id].fp === fpOf(email));

/** The failed emails still worth showing this person — and the viewer's OWN rows are never hidden here (they Close those themselves). */
function withoutClosed(emails, store, viewerId) {
  return (emails || []).filter((e) => e.sent_by === viewerId || !isClosed(store, e));
}

module.exports = { MAX, key, fpOf, addCloses, isClosed, withoutClosed };
