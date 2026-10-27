// send-queue-order.js
// The ORDER the pending-email queue is worked in. Pure, so it can be tested
// without a database or a mailbox.
//
// WHY THIS IS ITS OWN THING
// The send loop drains at one email every 75-105 seconds, inside an 8-hour
// window measured in each lead's own timezone. That makes queue order a
// business decision, not an implementation detail: whatever is at the back may
// simply not go out today.
//
// It used to be arrival order, which put a whole morning batch of follow-ups in
// front of every lead assigned during the day. On 2026-08-31 that was 36
// follow-ups ahead of 20 just-assigned leads — the new outreach would have hit
// the 16:00 cutoff and rolled to the next day, which is the one thing a freshly
// assigned lead cannot afford. A third-touch follow-up on a two-week-old thread
// can wait a day; a lead a recruiter just picked up cannot.
//
// Within the follow-ups the order is fu1, then fu2, then fu3–fu5, then reminders (see BAND_ORDER).
//
// This only decides WHO GOES FIRST. It never drops an email, never changes the
// daily cap, the send window, the pacing, or the domain spacing.

// Two mailboxes' emails are interleaved rather than sent mailbox-by-mailbox, so
// one mailbox's long queue can't starve another's for the whole window.
function interleaveByMailbox(emails) {
  const buckets = new Map();
  emails.forEach((e) => {
    const mb = e.job?.sending_email_id || '_none';
    if (!buckets.has(mb)) buckets.set(mb, []);
    buckets.get(mb).push(e);
  });
  const keys = [...buckets.keys()];
  const out = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const k of keys) {
      const q = buckets.get(k);
      if (q && q.length) { out.push(q.shift()); progress = true; }
    }
  }
  return out;
}

// A first touch. `null` is what the queue writes for initial outreach;
// 'initial' is accepted because the follow-up tables use that spelling.
function isInitialOutreach(email) {
  return !email?.followup_type || email.followup_type === 'initial';
}

// The business order of a day's basket (owner, 27 Oct 2026): first outreach, then follow-up 1, then follow-up 2, then 3, 4, 5, then
// reminders — REGARDLESS of when each email was generated. Anything with a type not listed here goes last, never dropped.
const BAND_ORDER = ['initial', 'fu1', 'fu2', 'fu3', 'fu4', 'fu5', 'reminder'];
function bandOf(email) {
  if (isInitialOutreach(email)) return 0;
  const i = BAND_ORDER.indexOf(String(email.followup_type).toLowerCase());
  return i < 0 ? BAND_ORDER.length : i;
}

/**
 * One band at a time in BAND_ORDER (first outreach, fu1, fu2 …); mailbox interleaving preserved inside each band. Input order is
 * otherwise kept, so the caller's ordering (oldest first) still decides who goes first within a band.
 */
function orderPendingForSend(emails) {
  const bands = BAND_ORDER.map(() => []).concat([[]]);
  (emails || []).forEach((e) => bands[bandOf(e)].push(e));
  return bands.reduce((out, b) => out.concat(interleaveByMailbox(b)), []);
}

module.exports = { interleaveByMailbox, isInitialOutreach, orderPendingForSend, bandOf, BAND_ORDER };
