// ============================================================================
// A SEND RUN IS A SERIES OF PASSES (owner, 29 Oct 2026).
//
// A run used to take the pending queue ONCE, when it started, and work through that snapshot for hours (each mailbox
// waits between sends). Anything queued meanwhile — the first emails of leads assigned a minute later, the daily
// follow-up batch — waited until the snapshot was finished. Three things the owner saw came from that one fact:
//   * "it shows 41 to go but Pending says 211" — the card counted the snapshot, the list counts the queue;
//   * "on the 28th the follow-ups went first, then the first outreach" — the first emails arrived after the run began,
//     so the agreed order (first outreach → fu1 → fu2, D-0182) only applied inside the stale snapshot;
//   * "sending stops and I have to start it again" — the run ended with new mail still waiting for the next 20-minute pass.
// Now a pass looks every few minutes for mail queued since it began; when there is some, it stops where it is and the
// run starts a fresh pass from the WHOLE queue, in the agreed order. The card adds the passes up, so its numbers are the
// run's, and "still to go" is what is really left. The mailbox spacing carries across passes (no burst at a seam).
// PURE.
// ============================================================================
'use strict';

const ARRIVAL_CHECK_MS = 3 * 60 * 1000;   // how often a pass looks for newly queued mail (one small query)
const MAX_PASSES = 60;                     // a safety stop, never reached by a normal day

// What the progress card shows during a later pass: this pass's numbers on top of the passes before it.
function withPrior(d, prior) {
  if (!prior || !d) return d;
  return Object.assign({}, d, {
    total: (d.total || 0) + prior.handled,
    sent: (d.sent || 0) + prior.sent,
    failed: (d.failed || 0) + prior.failed,
    retrying: (d.retrying || 0) + prior.retrying,
    failDetails: prior.failDetails.concat(d.failDetails || []).slice(-200),
    startedAt: prior.startedAt || d.startedAt,
    pass: prior.passes + 1,
  });
}

// Fold one finished pass into the running totals. Deferred mail is NOT carried: it is still pending and the next pass
// sees it again, so counting it twice would make the card add up wrong the other way.
function addPass(prior, r, startedAt) {
  const p = prior || { handled: 0, sent: 0, failed: 0, retrying: 0, failDetails: [], passes: 0, startedAt };
  return {
    handled: p.handled + (r.sent || 0) + (r.failed || 0) + (r.retrying || 0),
    sent: p.sent + (r.sent || 0),
    failed: p.failed + (r.failed || 0),
    retrying: p.retrying + (r.retrying || 0),
    failDetails: p.failDetails.concat(r.failDetails || []).slice(-200),
    passes: p.passes + 1,
    startedAt: p.startedAt || startedAt,
  };
}

// Should the run go round again? Only when the pass stopped BECAUSE new mail arrived (never for a pause, a daily limit
// or a send window — those wait for their own reason), and only while there is something due to send.
function shouldContinue(r, passes, dueNow) {
  return !!(r && r.restart) && passes < MAX_PASSES && dueNow > 0;
}

module.exports = { withPrior, addPass, shouldContinue, ARRIVAL_CHECK_MS, MAX_PASSES };
