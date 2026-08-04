// ============================================================================
// NEXT BEST ACTION — one ranked list of what to do today, across both branches.
// Step 4 of docs/AUTONOMOUS_ENGINE_PLAN.md.
//
// The product problem: futé knows a great deal that never reaches the user.
// A lead replied 6 days ago and nobody answered. A candidate asked for the JD.
// A reminder came due — and NOTHING IN THE APP EVER FIRED IT; reminders were
// created and listed, and no code anywhere surfaced a due one. So the work sat
// in tables while the user guessed what to do next.
//
// This turns all of that into one ordered list where every item carries the
// REASON it is there. The reason is not decoration: a ranked queue you cannot
// interrogate is just a different kind of guessing, and the user has to be able
// to disagree with it.
//
// PURE. Takes already-fetched rows, returns a sorted array. No DB, no network,
// injectable clock — so the ranking can be tested against fixed inputs, which is
// the only way to be sure "most urgent" means anything stable.
// ============================================================================

const { analyzeThread } = require('./conversation-intel');

const DAY_MS = 24 * 60 * 60 * 1000;

// Kinds, in rough order of how much it costs to ignore one.
const KIND = {
  REPLY_DUE: 'reply_due',           // they wrote, we didn't answer
  COMMITMENT_DUE: 'commitment_due', // we said we'd do something by now
  REMINDER_DUE: 'reminder_due',     // an explicit reminder came due
  NUDGE: 'nudge',                   // we wrote, silence, long enough to chase
};

const dayDiff = (a, b) => Math.floor((a - b) / DAY_MS);
const fmtDays = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

/**
 * Build the ranked queue.
 *
 * threads:   [{ entity_type:'contact'|'candidate', entity_id, name, company,
 *               job_id, owner_id, messages:[{direction,sent_at,body}] }]
 * reminders: [{ id, user_id, return_date, note, contact_name, company_name,
 *               contact_id, job_id, status }]
 *
 * Returns items: { kind, entity_type, entity_id, title, subtitle, reason,
 *                  priority, due_at, overdue_days, state, intent }
 */
function buildNextActions({ threads = [], reminders = [], now = Date.now(), limit = 50 } = {}) {
  const items = [];

  for (const t of threads) {
    const a = analyzeThread(t.messages, { now });

    // An opt-out or a clear no is not an action — it is a closed door, and
    // surfacing it as "to do" is how automated outreach becomes obnoxious.
    if (a.state === 'opted_out' || a.state === 'closed_lost') continue;

    if (a.needs_reply) {
      items.push({
        kind: KIND.REPLY_DUE,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        job_id: t.job_id || null, owner_id: t.owner_id || null,
        reason: a.headline,
        state: a.state,
        intent: a.intent ? a.intent.id : null,
        priority: a.priority,
        due_at: null,
        overdue_days: a.days_since_inbound,
      });
    } else if (a.priority > 0) {
      // Long silence after our message — worth a chase, but clearly ranked
      // below someone who is actually waiting on us.
      items.push({
        kind: KIND.NUDGE,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        job_id: t.job_id || null, owner_id: t.owner_id || null,
        reason: a.headline,
        state: a.state,
        intent: a.intent ? a.intent.id : null,
        priority: a.priority,
        due_at: null,
        overdue_days: a.days_since_outbound,
      });
    }

    // A commitment THEY made that has come due — "they said they'd come back
    // to us after the 15th, and it is the 20th." Distinct from a reply being
    // due, because the ask is different: chase the thing they promised.
    for (const c of (a.commitments || [])) {
      const due = Date.parse(c.due);
      if (!Number.isFinite(due) || due > now) continue;
      const late = dayDiff(now, due);
      items.push({
        kind: KIND.COMMITMENT_DUE,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        job_id: t.job_id || null, owner_id: t.owner_id || null,
        reason: `They said "${c.phrase}" — that was ${fmtDays(late)} ago.`,
        state: a.state,
        intent: a.intent ? a.intent.id : null,
        priority: 55 + Math.min(25, late * 4),
        due_at: c.due,
        overdue_days: late,
      });
    }
  }

  // Reminders: the feature that existed and never fired.
  for (const r of reminders) {
    if (r.status && r.status !== 'pending') continue;
    const due = Date.parse(r.return_date);
    if (!Number.isFinite(due)) continue;
    // Compare on CALENDAR DAY. return_date is a date, not a moment, so a
    // reminder set for today is due from the start of today — comparing against
    // the raw timestamp (midnight) or the end of the day would make every
    // reminder fire a day late, which for a "chase them back" feature is the
    // whole value gone. Compared as ISO dates so it does not drift with the
    // server's timezone.
    const dueDay = new Date(due).toISOString().slice(0, 10);
    const today = new Date(now).toISOString().slice(0, 10);
    if (dueDay > today) continue;
    const late = Math.max(0, dayDiff(now, due));
    items.push({
      kind: KIND.REMINDER_DUE,
      entity_type: r.contact_id ? 'contact' : 'reminder',
      entity_id: r.contact_id || r.id,
      reminder_id: r.id,
      title: r.contact_name || 'Reminder',
      subtitle: r.company_name || null,
      job_id: r.job_id || null, owner_id: r.user_id || null,
      reason: r.note || (late > 0 ? `Reminder was due ${fmtDays(late)} ago.` : 'Reminder due today.'),
      state: 'reminder',
      intent: null,
      priority: 70 + Math.min(25, late * 5),
      due_at: r.return_date,
      overdue_days: late,
    });
  }

  // Highest priority first; ties broken by how overdue, then by name so the
  // order is stable between refreshes (a queue that reshuffles on every load
  // is one nobody trusts).
  items.sort((a, b) =>
    (b.priority - a.priority) ||
    ((b.overdue_days || 0) - (a.overdue_days || 0)) ||
    String(a.title).localeCompare(String(b.title))
  );

  return items.slice(0, limit);
}

/** Small headline counts for the dashboard card. */
function summarize(items) {
  const by = { reply_due: 0, commitment_due: 0, reminder_due: 0, nudge: 0 };
  for (const i of items) if (by[i.kind] !== undefined) by[i.kind]++;
  return { total: items.length, by_kind: by, top: items[0] || null };
}

module.exports = { buildNextActions, summarize, KIND, DAY_MS };
