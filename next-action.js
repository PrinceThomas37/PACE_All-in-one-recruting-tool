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
const reminderSource = require('./services/reminder-source');

const DAY_MS = 24 * 60 * 60 * 1000;

// Kinds, in rough order of how much it costs to ignore one.
const KIND = {
  REPLY_DUE: 'reply_due',           // they wrote, we didn't answer
  COMMITMENT_DUE: 'commitment_due', // we said we'd do something by now
  REMINDER_DUE: 'reminder_due',     // an explicit reminder came due
  PIPELINE_STEP: 'pipeline_step',   // an interview or a submission needs the recruiter's next step (R-297)
};

// THE ORDER THE OWNER GAVE (R-297, D-0168, 20 Oct): the list is sorted by GROUP first, urgency second — so no amount of
// lateness lets a lower group jump a higher one (a reminder 5 days late used to outrank a client's interested reply).
//   1 a client replied positively (interested, wants to talk, rates, send something) and is still unanswered
//   2 a candidate replied positively and is still unanswered
//   3 any other client reply we owe        4 any other candidate reply we owe
//   5 an interview or submission needs a step
//   6 a reminder a PERSON set came due, or they promised something by a date that has passed
//
// ONLY THINGS THAT ARE OWED (owner, 20 Oct, D-0169: "it's better to create a tile if we have received a reply and we have not replied
// back"). The card no longer makes tiles from our own outreach or one-off emails: no "No reply yet" / "you emailed 30 people and nobody
// replied" chases (the follow-up engine chases those), no reminders a SEQUENCE created (they stay on the Reminders page), and no
// separate "replied — interested, move them forward?" row (the reply row itself carries the stage picker; once answered it leaves).
// Kept by the owner's choice: interview / submission steps, reminders a person set, and "they promised a date".
const TIER = { client_hot: 1, candidate_hot: 2, client_reply: 3, candidate_reply: 4, pipeline: 5, reminder: 6 };
// A POSITIVE reply is owed sooner than an ordinary one (owner: "If the user has not replied back in 2 days of a positive reply …
// the card should be on top"). The admin sets the number (config/settings.js needs_reply_positive_after_days); this is the
// fallback for a caller that passes none.
const POSITIVE_REPLY_DUE_AFTER_DAYS = 2;
// Interview / submission steps (owner's three, D-0168). Admin numbers again (pipeline_* settings); fallbacks here.
const CLIENT_SILENT_AFTER_DAYS = 3;
const INTERVIEW_OUTCOME_AFTER_DAYS = 1;

const dayDiff = (a, b) => Math.floor((a - b) / DAY_MS);
const fmtDays = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

// THE THREE PIPELINE STEPS (owner's choice, D-0168). Pure. `rows` = the caller's own submissions:
// [{ submission_id, candidate_id, name, email, company, job_title, job_order_id, owner_id, stage, interview_at, stage_updated_at, submitted_at }].
// `dayKeyOf(ms)` gives the viewer's calendar day ('YYYY-MM-DD'), so "today / tomorrow" is THEIR day, not the server's.
function pipelineSteps(rows, { now = Date.now(), clientSilentAfterDays = CLIENT_SILENT_AFTER_DAYS, interviewOutcomeAfterDays = INTERVIEW_OUTCOME_AFTER_DAYS,
  todayKey = null, tomorrowKey = null, dayKeyOf = null } = {}) {
  const out = [];
  const keyOf = dayKeyOf || ((ms) => new Date(ms).toISOString().slice(0, 10));
  const today = todayKey || keyOf(now), tomorrow = tomorrowKey || keyOf(now + DAY_MS);
  for (const r of rows || []) {
    if (!r || !r.stage) continue;
    const since = Date.parse(r.stage_updated_at || r.submitted_at || '');
    const daysInStage = Number.isFinite(since) ? dayDiff(now, since) : null;
    const iv = Date.parse(r.interview_at || '');
    const base = {
      kind: KIND.PIPELINE_STEP, tier: TIER.pipeline,
      entity_type: 'candidate', entity_id: r.candidate_id, submission_id: r.submission_id || null,
      title: r.name || r.email || 'Candidate',
      subtitle: [r.job_title, r.company].filter(Boolean).join(' · ') || null,
      email: r.email || null, job_id: r.job_order_id || null, owner_id: r.owner_id || null,
      stage: r.stage, state: 'pipeline', intent: null,
      // A snooze is voided when the stage moves or the interview is re-timed (services/next-action-dismissals.js).
      last_activity_at: r.stage_updated_at || r.interview_at || r.submitted_at || null,
    };
    let step = null;
    if (r.stage === 'Interview Scheduled' && Number.isFinite(iv)) {
      const day = keyOf(iv);
      if (day === today || day === tomorrow) {
        const when = day === today ? 'today' : 'tomorrow';
        step = { step: 'interview_soon', reason: `Interview ${when} — confirm the time with them and prepare them.`, priority: day === today ? 95 : 85, due_at: day, overdue_days: 0 };
      } else if (iv < now && interviewOutcomeAfterDays >= 0 && dayDiff(now, iv) >= interviewOutcomeAfterDays) {
        const late = dayDiff(now, iv);
        step = { step: 'interview_no_outcome', reason: `The interview was ${fmtDays(late)} ago and there is no outcome yet — get the feedback and move them on.`, priority: 70 + Math.min(20, late * 4), due_at: null, overdue_days: late };
      }
    } else if (r.stage === 'Interview Completed' && daysInStage != null && daysInStage >= interviewOutcomeAfterDays) {
      step = { step: 'interview_no_outcome', reason: `Interview done ${fmtDays(daysInStage)} ago and no outcome yet — get the client's feedback (offer or not).`, priority: 70 + Math.min(20, daysInStage * 4), due_at: null, overdue_days: daysInStage };
    } else if (r.stage === 'Submitted to Client' && daysInStage != null && daysInStage >= clientSilentAfterDays) {
      step = { step: 'client_silent', reason: `Submitted to the client ${fmtDays(daysInStage)} ago with no movement — chase the client for feedback.`, priority: 60 + Math.min(20, daysInStage * 2), due_at: null, overdue_days: daysInStage };
    }
    if (step) out.push(Object.assign({}, base, step));
  }
  return out;
}

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
// A reply is OWED once their email is this old (owner, 20 Oct: "show it if the reply is due after 4 days"). The admin sets the real number
// (config/settings.js needs_reply_after_days); this is only the fallback for a caller that passes none. 0 = at once.
const REPLY_DUE_AFTER_DAYS = 4;

function buildNextActions({ threads = [], reminders = [], pipeline = [], now = Date.now(), limit = 50,
  replyDueAfterDays = REPLY_DUE_AFTER_DAYS, positiveReplyDueAfterDays = POSITIVE_REPLY_DUE_AFTER_DAYS,
  clientSilentAfterDays = CLIENT_SILENT_AFTER_DAYS, interviewOutcomeAfterDays = INTERVIEW_OUTCOME_AFTER_DAYS,
  todayKey = null, tomorrowKey = null, dayKeyOf = null } = {}) {
  const items = [];
  let replyNotDueYet = 0;

  for (const t of threads) {
    const a = analyzeThread(t.messages, { now });
    // The newest message on the thread — the fact a snooze is taken against.
    const lastAt = (t.messages || []).reduce((mx, m) => {
      const v = m && m.sent_at ? String(m.sent_at) : '';
      return v > mx ? v : mx;
    }, '') || null;

    // An opt-out or a clear no is not an action — it is a closed door, and
    // surfacing it as "to do" is how automated outreach becomes obnoxious.
    if (a.state === 'opted_out' || a.state === 'closed_lost') continue;

    if (a.needs_reply) {
      // Their email is too fresh to be OVERDUE: not listed yet, but counted, never silently dropped. A positive reply is owed
      // sooner (2 days by default) than an ordinary one (4) — and goes to the top when it is.
      const hot = !!(a.intent && a.intent.tone === 'good');
      const wait = hot ? positiveReplyDueAfterDays : replyDueAfterDays;
      if (wait > 0 && Number.isFinite(a.days_since_inbound) && a.days_since_inbound < wait) { replyNotDueYet++; continue; }
      const cand = t.entity_type === 'candidate';
      items.push({
        kind: KIND.REPLY_DUE,
        tier: hot ? (cand ? TIER.candidate_hot : TIER.client_hot) : (cand ? TIER.candidate_reply : TIER.client_reply),
        hot,
        // A reply from a lead already marked Rejected is still owed — it may be a second chance — but the row says so (owner, 20 Oct:
        // "show them as 'rejected lead'"), so the person decides knowingly.
        rejected_lead: t.entity_type === 'contact' && t.stage === 'Rejected',
        // A candidate's reply row offers the stage move itself (it replaced the separate "move them forward?" row, D-0169).
        stage: t.entity_type === 'candidate' ? (t.stage || null) : undefined,
        last_activity_at: lastAt,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        email: t.email || null,   // R-073: the row can DO the task, so it must say who to write to
        job_id: t.job_id || null, owner_id: t.owner_id || null,
        reason: a.headline,
        state: a.state,
        intent: a.intent ? a.intent.id : null,
        priority: a.priority,
        due_at: null,
        overdue_days: a.days_since_inbound,
      });
    }
    // We wrote and they have not answered: NOT a tile (D-0169). The automatic follow-ups chase silence; the card is for what is owed.

    // A commitment THEY made that has come due — "they said they'd come back
    // to us after the 15th, and it is the 20th." Distinct from a reply being
    // due, because the ask is different: chase the thing they promised.
    for (const c of (a.commitments || [])) {
      const due = Date.parse(c.due);
      if (!Number.isFinite(due) || due > now) continue;
      const late = dayDiff(now, due);
      items.push({
        kind: KIND.COMMITMENT_DUE,
        tier: TIER.reminder,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        email: t.email || null,   // R-073: the row can DO the task, so it must say who to write to
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
    // A reminder a SEQUENCE created (its call / LinkedIn / task step) is not a tile (D-0169) — it stays on the Reminders page.
    if (reminderSource.isSequenceMade(r.reminder_type)) continue;
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
      tier: TIER.reminder,
      entity_type: r.contact_id ? 'contact' : 'reminder',
      entity_id: r.contact_id || r.id,
      reminder_id: r.id,
      title: r.contact_name || 'Reminder',
      subtitle: r.company_name || null,
      email: (r.contact && r.contact.email) || null,
      job_id: r.job_id || null, owner_id: r.user_id || null,
      reason: r.note || (late > 0 ? `Reminder was due ${fmtDays(late)} ago.` : 'Reminder due today.'),
      state: 'reminder',
      intent: null,
      priority: 70 + Math.min(25, late * 5),
      due_at: r.return_date,
      overdue_days: late,
    });
  }

  // Interviews and submissions that need the recruiter's next step (R-297).
  for (const it of pipelineSteps(pipeline, { now, clientSilentAfterDays, interviewOutcomeAfterDays, todayKey, tomorrowKey, dayKeyOf })) items.push(it);

  // GROUP first (the owner's order, TIER above), then highest priority, then how overdue, then by name so the order is
  // stable between refreshes (a queue that reshuffles on every load is one nobody trusts).
  items.sort((a, b) =>
    ((a.tier || 99) - (b.tier || 99)) ||
    (b.priority - a.priority) ||
    ((b.overdue_days || 0) - (a.overdue_days || 0)) ||
    String(a.title).localeCompare(String(b.title))
  );

  // `last_activity_at` is what services/next-action-dismissals.js fingerprints
  // a snooze against: when it changes, the snooze is void and the item returns.
  for (const it of items) {
    if (it.last_activity_at === undefined) it.last_activity_at = null;
  }

  const shown = items.slice(0, limit);
  // The overflow is reported, never silently dropped — a queue that truncates
  // without saying so is how "needs you today" starts lying.
  shown.overflow = Math.max(0, items.length - shown.length);
  shown.reply_not_due_yet = replyNotDueYet;
  return shown;
}

/** Small headline counts for the dashboard card. */
function summarize(items) {
  const by = { reply_due: 0, commitment_due: 0, reminder_due: 0, pipeline_step: 0 };
  for (const i of items) if (by[i.kind] !== undefined) by[i.kind]++;
  return { total: items.length, by_kind: by, top: items[0] || null };
}

module.exports = {
  pipelineSteps, TIER, buildNextActions, summarize, KIND, DAY_MS, REPLY_DUE_AFTER_DAYS };
