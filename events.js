// ============================================================================
// In-process domain event bus — the centre of the "spherical" structure.
//
// Features ANNOUNCE what happened (emit) and other features REACT (on) without
// calling each other directly. New behaviour attaches as a subscriber instead
// of editing the code that made the thing happen — that is the "scale from in
// to out" the system is moving toward.
//
// Guarantees:
//  - emit() is fire-and-forget and NEVER throws back into the caller.
//  - subscribers may be async; they run on the next tick, each in its own
//    try/catch, so one failing subscriber cannot break the emitter or the
//    other subscribers.
//  - every event is stamped with an id + ISO timestamp so it can be recorded
//    on the visible timeline (the domain_events table).
// ============================================================================
const { EventEmitter } = require('events');
const crypto = require('crypto');

// Canonical event names. Use these constants everywhere — never raw strings.
const EVENTS = {
  LEAD_ASSIGNED:       'lead.assigned',
  OUTREACH_QUEUED:     'outreach.queued',
  EMAIL_SENT:          'email.sent',
  EMAIL_BOUNCED:       'email.bounced',
  CONTACT_INVALIDATED: 'contact.invalidated',
  FOLLOWUP_QUEUED:     'followup.queued',
  SUBMISSION_ADVANCED: 'submission.advanced',
  SENDING_PAUSED:      'sending.paused',
  SENDING_RESUMED:     'sending.resumed',
  CONTACT_REPLIED:     'contact.replied',
  CONTACT_UNSUBSCRIBED:'contact.unsubscribed',
  // The candidate-side counterparts. Without these a candidate who replied kept
  // receiving the rest of their sequence — replies were recorded against the
  // tracked message and nothing acted on them.
  CANDIDATE_REPLIED:     'candidate.replied',
  CANDIDATE_UNSUBSCRIBED:'candidate.unsubscribed',
  MAILBOX_AUTOPAUSED:  'mailbox.autopaused',
  WARMUP_STARTED:      'warmup.started',
  MAILBOX_WARMED:      'mailbox.warmed',
  WORKFLOW_ENROLLED:      'workflow.enrolled',
  WORKFLOW_STEP_EXECUTED: 'workflow.step_executed',
  WORKFLOW_COMPLETED:     'workflow.completed',
  WORKFLOW_EXITED:        'workflow.exited',
};
const KNOWN_EVENTS = new Set(Object.values(EVENTS));

// A dedicated wildcard channel so one subscriber (the timeline recorder) can
// observe every event without registering for each name.
const ANY = '__any__';

const bus = new EventEmitter();
bus.setMaxListeners(50); // several features subscribe; avoid the default-10 warning

// Register a reaction to a single event. Returns an unsubscribe function.
function on(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

// Register a reaction to EVERY event (used by the recorder). Returns unsubscribe.
function onAny(handler) {
  bus.on(ANY, handler);
  return () => bus.off(ANY, handler);
}

// Announce that something happened. payload is an arbitrary object; if it
// carries `actorUserId` the recorder will store it in its own column.
function emit(event, payload = {}) {
  if (!KNOWN_EVENTS.has(event)) {
    console.warn(`[events] emit of unknown event "${event}" — add it to the EVENTS catalog in events.js`);
  }
  const envelope = {
    id: crypto.randomUUID(),
    event,
    ts: new Date().toISOString(),
    payload: payload || {},
  };
  // Dispatch asynchronously so emit() is non-blocking and exception-safe.
  setImmediate(() => {
    dispatch(event, envelope);
    dispatch(ANY, envelope);
  });
  return envelope;
}

function dispatch(channel, envelope) {
  for (const handler of bus.listeners(channel)) {
    Promise.resolve()
      .then(() => handler(envelope))
      .catch(err => console.error(`[events] subscriber for "${envelope.event}" failed:`, err && err.message));
  }
}

module.exports = { EVENTS, emit, on, onAny };
