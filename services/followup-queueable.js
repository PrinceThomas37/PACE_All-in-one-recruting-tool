'use strict';
// ============================================================================
// "WILL THIS FOLLOW-UP REALLY BE QUEUED?" — defined once (R-379, owner 4 Nov: "if there are no follow-ups for that day in the queue then no
// number in the assign table").
//
// The follow-up engine (index.js runFollowupEngine) queues a follow-up only when (a) the lead is still Assigned, (b) the contact may be emailed,
// (c) the FIRST email is on record as really sent (the 10 Sept guard: 215 follow-ups once went to people whose first email never left), and (d) the
// step is due counting from that REAL send date, not from the date the row was made at assignment. The Assign screen used to count a row the moment
// its stored date came, so it promised follow-ups the engine then refused (4 Nov: 132 shown as due, 129 of them for leads with no first email at all,
// `skipped_no_initial: 129`). A rule that decides whether an action is allowed lives where the action is OFFERED, not only where it is taken — so the
// screen and the engine now read these same functions.
//
// PURE: no database, no clock of its own. What the engine still does itself, on purpose, because it has side effects or is not about this question:
// the mailbox's room for the day (quota) and the "already queued today" double-send guard.
// shortcut: the screen does not apply the double-send guard (a pair already queued today leaves the follow-up row as 'sent', so it falls out of
// the count anyway); upgrade if a case where it does not turns up.
// ============================================================================
const steps = require('./followup-steps');

/** Is a follow-up due, counting from the day the first email really sent? `sentAt` 'YYYY-MM-DD' (or a timestamp), `dayGap` the configured offset. */
function isDueFromSend(sentAt, dayGap, todayDate) {
  if (!sentAt || !todayDate) return false;
  const gap = Number.isFinite(dayGap) ? dayGap : parseInt(dayGap, 10);
  if (!Number.isFinite(gap)) return false;
  const start = new Date(`${String(sentAt).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return false;
  start.setUTCDate(start.getUTCDate() + Math.max(0, gap));
  return start.toISOString().slice(0, 10) <= String(todayDate).slice(0, 10);
}

/** Rows of emails that really sent as a FIRST email (status sent, no follow-up type) → Map 'job:contact' → the EARLIEST real send. A null send time counts as none. */
function initialSentMap(rows) {
  const out = new Map();
  (rows || []).forEach((r) => {
    const key = `${r.job_id}:${r.contact_id}`;
    const prev = out.get(key);
    // Earliest real send is the anchor — that is the note being followed up on.
    if (!prev || (r.sent_at && r.sent_at < prev)) out.set(key, r.sent_at || prev || null);
  });
  return out;
}

/**
 * Why the engine would NOT queue this due follow-up, or null when it would (quota and the double-send guard aside). Same order the engine checks in.
 *   fu        a follow_ups row with `job` ({stage, assigned_to_bd}) and `contact` joined
 *   step      which follow-up (1..5) is due
 *   settings  app_settings rows as { key: value } (the per-person day offsets)
 */
function blockReason({ fu, step, todayDate, settings, initialSent, isEligibleContact }) {
  const job = fu && fu.job;
  if (!job || job.stage !== 'Assigned') return 'stage';
  if (!isEligibleContact(fu.contact)) return 'contact';
  const sentAt = initialSent && initialSent.get(`${fu.job_id}:${fu.contact_id}`);
  if (!sentAt) return 'no_initial';
  if (!isDueFromSend(sentAt, steps.dayFor(settings, job.assigned_to_bd, step), todayDate)) return 'not_due_yet';
  return null;
}

/** Per email ID: how many follow-ups the engine would queue today, by step — { [user_email_id]: { fu1, fu2, later } }. What the Assign screen shows. */
function dueNowByMailbox(rows, { todayDate, settings, initialSent, isEligibleContact }) {
  const out = {};
  (rows || []).forEach((f) => {
    const n = steps.nextDue(f, todayDate);
    if (!n) return;
    if (blockReason({ fu: f, step: n, todayDate, settings, initialSent, isEligibleContact })) return;
    const k = f.user_email_id;
    out[k] = out[k] || { fu1: 0, fu2: 0, later: 0 };
    out[k][n === 1 ? 'fu1' : n === 2 ? 'fu2' : 'later']++;
  });
  return out;
}

module.exports = { isDueFromSend, initialSentMap, blockReason, dueNowByMailbox };
