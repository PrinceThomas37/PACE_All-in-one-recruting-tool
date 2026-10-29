// ============================================================================
// PENDING, BY EMAIL ID AND STEP (owner, 29 Oct 2026).
//
// "It shows only pending emails, but not how many are follow-up 1 or 2 and how many are first outreach. Remove the time
// zone split. It should say how many emails from each email ID, and within that how many FU1, FU2 and first outreach."
// One row per sending mailbox: the email's own mailbox when it has one (rotation), else its lead's — the same rule the
// send loop starts from. A follow-up is counted under that mailbox too; the send loop may send it from the mailbox that
// sent the first email when that one is still connected (D-0067), which is almost always the same one.
// PURE.
// ============================================================================
'use strict';

function stepOf(t) {
  const k = String(t || '').toLowerCase();
  if (!k || k === 'initial') return 'initial';
  if (k === 'fu1' || k === 'fu2') return k;
  return 'later';                                  // fu3…fu5 and anything newer
}

// rows: [{ sending_email_id, followup_type, job: { sending_email_id } }]; boxes: { id: email_address }
function byMailbox(rows, boxes = {}) {
  const out = {};
  for (const r of (rows || [])) {
    const id = r.sending_email_id || (r.job && r.job.sending_email_id) || null;
    const k = id || 'none';
    if (!out[k]) out[k] = { id, email: id ? (boxes[id] || 'Email ID removed') : 'No email ID on the lead', pending: 0, initial: 0, fu1: 0, fu2: 0, later: 0 };
    out[k].pending++;
    out[k][stepOf(r.followup_type)]++;
  }
  return Object.values(out).sort((a, b) => b.pending - a.pending || String(a.email).localeCompare(String(b.email)));
}

module.exports = { byMailbox, stepOf };
