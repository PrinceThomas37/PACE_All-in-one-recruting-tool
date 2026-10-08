// ============================================================================
// SAME THREAD OR A NEW EMAIL — per follow-up (owner, 8 Oct: "no option to enable the same thread or different thread emailing in the
// follow-ups"). Follow-up 1 and Follow-up 2 of the Outreach Plan used to ALWAYS reply inside the first email's thread. Now each is the
// person's choice, saved as `u_<id>_fu1_thread` / `u_<id>_fu2_thread` = 'same' (the default, and how it has always been) | 'new'.
// A 'new' follow-up goes out as a fresh email with its OWN subject, like a first email, from the same email ID. (A sequence's steps
// already have this choice: "Keep it in the same thread" in the sequence builder.)
// PURE: no database, no clock.
// ============================================================================
'use strict';

const STEPS = ['fu1', 'fu2'];
const threadKey = (userId, step) => `u_${userId}_${step}_thread`;

/** Only the exact word 'new' means a new email — anything else (missing, odd, 'same') stays a reply in the thread. */
function wantsNewThread(settings, userId, step) {
  if (!STEPS.includes(step)) return false;
  return !!settings && settings[threadKey(userId, step)] === 'new';
}

/**
 * The email as the DELIVERY step should see it. A follow-up that wants a new thread is handed over as a plain "reminder" — the provider
 * adapters send anything that is not fu1/fu2 as a fresh message — while the stored row stays fu1/fu2 (follow-up counts, the double-send
 * guard and the history all keep reading it as a follow-up).
 */
function forDelivery(email, settings) {
  const t = email && email.followup_type;
  if (!STEPS.includes(t)) return email;
  return wantsNewThread(settings, email.sent_by, t) ? { ...email, followup_type: 'reminder' } : email;
}

module.exports = { STEPS, threadKey, wantsNewThread, forDelivery };
