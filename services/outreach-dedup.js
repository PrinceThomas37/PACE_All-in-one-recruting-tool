// ============================================================================
// OUTREACH DEDUP — may we email this contact again right now, and what has
// already gone out?
// ----------------------------------------------------------------------------
// PURE. No db, no clock of its own — `today` is injected, because every answer
// here is a claim about what happened on a particular day.
//
// WHY THIS IS ITS OWN MODULE (Session 24)
// The rule "a follow-up is already queued, or one went out today, so don't send
// another" lived as two local functions inside index.js and was enforced ONLY at
// the moment of sending. The Reminders page therefore had no idea it existed: it
// drew a "Compose email" button, let the user pick a template, let them edit it,
// and refused at the very last step with
//
//     "Send failed: A follow-up to this contact is already queued or was sent
//      today — skipped to avoid a duplicate email."
//
// The refusal is CORRECT — follow-up 2 had gone out that morning. What was wrong
// is that the screen offered the action at all, and only admitted the problem
// after the work of composing was done. **A rule that decides whether an action
// is allowed belongs where the action is OFFERED, not only where it is taken.**
// So the rule moved here, both callers share it, and the page can now say up
// front what the send path was always going to say at the end.
//
// This deliberately mirrors `services/outreach-cycle.js`: the same repo already
// paid for three copies of "release a lead to the pool" disagreeing with each
// other, and this is the same shape of rule.
// ============================================================================

// Outreach-class email types. The INITIAL outreach is intentionally excluded —
// the cold email is the thing a follow-up follows, so its existence must never
// block one.
const FOLLOWUP_EMAIL_TYPES = ['fu1', 'fu2', 'reminder'];

/**
 * Is this row a reason not to send another follow-up right now?
 *
 * Live means: still queued (it will go out on its own), or already delivered
 * TODAY (a second one would be a same-day duplicate to a real person).
 * Yesterday's send is not live — the point is one touch per day, not one ever.
 */
function isLiveOutreachRow(row, today) {
  if (!row) return false;
  if (row.status === 'pending') return true;
  return !!(row.sent_at && String(row.sent_at).slice(0, 10) === String(today || '').slice(0, 10));
}

/** Only the rows the guard actually considers. */
function outreachRows(rows) {
  return (rows || []).filter(r => r && FOLLOWUP_EMAIL_TYPES.includes(r.followup_type));
}

/** Would a manual follow-up to this contact be refused right now? */
function sendIsBlocked(rows, today) {
  return outreachRows(rows).some(r => isLiveOutreachRow(r, today));
}

/**
 * The whole picture for a screen: what has gone out, and whether another may go
 * now. `rows` are `emails` rows for one (job, contact) pair.
 *
 * The distinction the UI needs is between the two reasons a send is refused,
 * because they read completely differently to a human: something is SITTING IN
 * THE QUEUE and will send itself, versus something ALREADY WENT today.
 */
function describeOutreach(rows, today) {
  const all = outreachRows(rows);
  const queued = all.filter(r => r.status === 'pending');
  const sentToday = all.filter(r => r.status !== 'pending' && isLiveOutreachRow(r, today));

  // The full trail, initial included — the page is reporting history here, not
  // applying the guard, and "we emailed them three times" is the fact that makes
  // a call task make sense.
  const sent = (rows || [])
    .filter(r => r && r.status === 'sent' && r.sent_at)
    .sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));

  const out = {
    sent_count: sent.length,
    last_sent_at: sent.length ? String(sent[sent.length - 1].sent_at).slice(0, 10) : null,
    trail: sent.map(r => ({ type: r.followup_type || 'initial', sent_at: String(r.sent_at).slice(0, 10) })),
    queued_count: queued.length,
    blocked: false,
    block_reason: null,
    block_sentence: null
  };

  if (queued.length) {
    out.blocked = true;
    out.block_reason = 'queued';
    out.block_sentence = queued.length === 1
      ? 'A follow-up to this contact is already waiting in the send queue, so PACE will not queue a second one.'
      : `${queued.length} follow-ups to this contact are already waiting in the send queue, so PACE will not queue another.`;
    return out;
  }
  if (sentToday.length) {
    out.blocked = true;
    out.block_reason = 'sent_today';
    out.block_sentence = 'A follow-up already went to this contact today, so PACE will not send a second one on the same day.';
  }
  return out;
}

/**
 * Can a human actually carry out a "call them / connect on LinkedIn" task?
 *
 * The owner's decision (D-0017, 2026-09-15): if there is no phone number and no
 * LinkedIn on the record, PACE does NOT create the task. Seven live tasks said
 * "Call the POC about this role and connect on LinkedIn" for contacts holding
 * neither — a job nobody could do as written, which is what made the whole
 * Reminders list read as invented work.
 */
function canBeContactedDirectly(contact) {
  const phone = String(contact?.phone || '').trim();
  const linkedin = String(contact?.linkedin || '').trim();
  return !!(phone || linkedin);
}

/**
 * Should this workflow step decline to create its task?
 *
 * Returns a reason string, or null to go ahead. This is a FUNCTION rather than
 * an `if` inside the executor because the executor lives in index.js and cannot
 * be called from a test — the first version of this rule was pinned by grepping
 * index.js for the condition, and that "guard" went on passing when the
 * condition was disabled with `if (false && …)`. A test that greps for source
 * text cannot tell a live rule from a dead one.
 *
 * Only `bd_touch` is gated. That step means "call them and connect on
 * LinkedIn" — a route that is not email — so with no phone and no LinkedIn on
 * the record there is nothing to do. The generic `reminder` channel can be any
 * task at all and is deliberately left alone.
 */
function callTaskSkipReason(step, contact) {
  if ((step && step.channel) !== 'bd_touch') return null;
  if (canBeContactedDirectly(contact)) return null;
  return 'no_phone_or_linkedin';
}

module.exports = {
  callTaskSkipReason,
  FOLLOWUP_EMAIL_TYPES,
  isLiveOutreachRow,
  sendIsBlocked,
  describeOutreach,
  canBeContactedDirectly
};
