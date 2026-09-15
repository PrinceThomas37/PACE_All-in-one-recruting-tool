// ============================================================================
// REMINDER SOURCE — why does this reminder exist, and is it really due today?
// ----------------------------------------------------------------------------
// PURE. No db, no fetch, no clock of its own — `today` is always injected,
// because every function here makes a claim about a date and a test that
// cannot control the clock cannot pin one.
//
// Why this module exists (Session 24). The owner opened Reminders, found five
// rows waiting, and could not tell what any of them were:
//
//   "what are these reminders based on — it's unclear"
//
// They were right, and the row itself is the reason. `reminders` records WHAT
// to do (a note), WHO it concerns (contact_name, email) and WHEN (return_date).
// It records WHY only as `reminder_type` — 'bd_touch' — which is the name of a
// workflow CHANNEL, is never shown, and would mean nothing to a recruiter if it
// were. Every one of those five came from step 3 of the "Standard Sales
// Outreach" sequence, one day after follow-up 1 went out. Nothing on the screen
// said so, so the five rows read as if the app had invented them.
//
// The rule this encodes: A ROW THAT ASKS SOMEONE TO DO SOMETHING MUST SAY WHO
// ASKED. A task with no provenance is indistinguishable from a bug, and the
// owner reported it as one.
//
// Second thing the screen got wrong: all five were dated 2026-09-13 and the
// page announced "5 reminders due today" on the 15th. The list is built with
// `return_date <= today`, which is right — a reminder must not vanish because
// you did not act on the day — but calling a two-day-old task "due today" is a
// statement the user can see is false, and it is the same wording that made the
// daily queue look stuck in Session 23. Overdue is its own state and says so.
// ============================================================================

// What each reminder_type really is, in the owner's terms rather than the
// channel names the workflow engine uses internally. `label` is the badge;
// `why` is the sentence under it. Keys are exactly the values written by the
// four places that create reminders:
//   index.js wfReminderExecutor          → step.channel ('bd_touch' | 'reminder')
//   routes/recruiting/outreach.js        → 'recruiter_task'
//   routes/contacts.js (OOO auto-reply)  → 'ooo_return'
//   public/js/10-page-modals.js          → 'manual' | 'meeting'
const SOURCES = {
  bd_touch: {
    label: 'Sequence step',
    why: 'An outreach sequence reached its "call + LinkedIn" step for this contact — the emails went out, this step is the human one.'
  },
  reminder: {
    label: 'Sequence step',
    why: 'An outreach sequence reached a reminder step for this contact.'
  },
  recruiter_task: {
    label: 'Sequence task',
    why: 'A candidate sequence reached a step that asks a recruiter to do something.'
  },
  ooo_return: {
    label: 'Back from leave',
    why: 'Their auto-reply said they were away until this date, so PACE held the follow-up until they were back.'
  },
  meeting: {
    label: 'Meeting',
    why: 'You scheduled a meeting with them from the Reminders page.'
  },
  manual: {
    label: 'Added by you',
    why: 'You added this reminder yourself.'
  }
};

const UNKNOWN_SOURCE = {
  label: 'Reminder',
  why: 'This reminder predates the record of where reminders come from, so PACE cannot say what created it.'
};

/**
 * Describe where a reminder came from.
 *
 * `seq` is optional context the caller may have resolved from the workflow
 * tables — { name, stepOrder, stepName, totalSteps }. It is never invented: a
 * caller that could not find the enrollment passes nothing, and the sentence
 * degrades to the generic one rather than naming a sequence that may not be
 * the one that fired. A confident wrong provenance is worse than an honest
 * vague one (same reasoning as describePdfFailure's "damaged in transit").
 */
function describeReminder(row, seq) {
  const type = (row && row.reminder_type) || 'manual';
  const base = SOURCES[type] || UNKNOWN_SOURCE;
  const out = { type, label: base.label, why: base.why };

  const isSequence = type === 'bd_touch' || type === 'reminder' || type === 'recruiter_task';
  if (isSequence && seq && seq.name) {
    const step = seq.stepOrder
      ? `Step ${seq.stepOrder}${seq.totalSteps ? ` of ${seq.totalSteps}` : ''}`
      : 'A step';
    const named = seq.stepName ? ` — ${seq.stepName}` : '';
    out.label = 'Sequence step';
    out.why = `${step} of the "${seq.name}" sequence${named}. PACE created this task on the day the sequence reached it; the emails are automatic, this step is not.`;
    out.sequence = { name: seq.name, step_order: seq.stepOrder || null, step_name: seq.stepName || null, total_steps: seq.totalSteps || null };
  }
  return out;
}

/**
 * Is this reminder due today, overdue, or still ahead?
 *
 * Dates are compared as YYYY-MM-DD strings, which is how they arrive from
 * Postgres `date` columns and how `todayIST()` renders on the frontend — no Date
 * parsing, so no timezone can move a day boundary underneath the answer.
 */
function dueState(returnDate, today) {
  const d = String(returnDate || '').slice(0, 10);
  const t = String(today || '').slice(0, 10);
  if (!d || !t) return { state: 'unknown', days: 0 };
  if (d === t) return { state: 'due_today', days: 0 };
  if (d < t) return { state: 'overdue', days: daysBetween(d, t) };
  return { state: 'upcoming', days: daysBetween(t, d) };
}

/** Whole days from the earlier YYYY-MM-DD to the later one. */
function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** The badge a due/overdue card shows. Never says "today" about another day. */
function dueLabel(returnDate, today) {
  const { state, days } = dueState(returnDate, today);
  if (state === 'due_today') return 'Due today';
  if (state === 'overdue') return days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
  if (state === 'upcoming') return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
  return 'Due';
}

/**
 * The heading over the due list. "5 reminders due today" above five two-day-old
 * rows is the claim that started this; it now counts the two states separately
 * and only says "today" about today.
 */
function dueHeadline(rows, today) {
  const list = (rows || []).map(r => dueState(r && r.return_date, today));
  const dueToday = list.filter(s => s.state === 'due_today').length;
  const overdue = list.filter(s => s.state === 'overdue').length;
  const parts = [];
  if (dueToday) parts.push(`${dueToday} due today`);
  if (overdue) parts.push(`${overdue} overdue`);
  if (!parts.length) return '';
  const total = dueToday + overdue;
  return `${total} reminder${total === 1 ? '' : 's'} waiting — ${parts.join(', ')}`;
}

module.exports = { SOURCES, describeReminder, dueState, dueLabel, dueHeadline, daysBetween };
