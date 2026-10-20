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
// Below every live item, so a quiet nudge never pushes a real one down.
const STALE_NUDGE_PRIORITY = 5;

// Kinds, in rough order of how much it costs to ignore one.
const KIND = {
  REPLY_DUE: 'reply_due',           // they wrote, we didn't answer
  COMMITMENT_DUE: 'commitment_due', // we said we'd do something by now
  REMINDER_DUE: 'reminder_due',     // an explicit reminder came due
  NUDGE: 'nudge',                   // we wrote, silence, long enough to chase
  STAGE_SUGGESTED: 'stage_suggested', // a candidate signal worth a manual stage move
  PIPELINE_STEP: 'pipeline_step',   // an interview or a submission needs the recruiter's next step (R-297)
};

// THE ORDER THE OWNER GAVE (R-297, D-0168, 20 Oct): the list is sorted by GROUP first, urgency second — so no amount of
// lateness lets a lower group jump a higher one (a reminder 5 days late used to outrank a client's interested reply).
//   1 a client replied positively (interested, wants to talk, rates, send something) and is still unanswered
//   2 a candidate replied positively and is still unanswered
//   3 any other client reply we owe        4 any other candidate reply we owe
//   5 an interview or submission needs a step (and "replied — interested, move them forward?")
//   6 a reminder came due, or they promised something by a date that has passed
//   7 a lead went quiet
const TIER = { client_hot: 1, candidate_hot: 2, client_reply: 3, candidate_reply: 4, pipeline: 5, reminder: 6, quiet: 7 };
// A POSITIVE reply is owed sooner than an ordinary one (owner: "If the user has not replied back in 2 days of a positive reply …
// the card should be on top"). The admin sets the number (config/settings.js needs_reply_positive_after_days); this is the
// fallback for a caller that passes none.
const POSITIVE_REPLY_DUE_AFTER_DAYS = 2;
// Interview / submission steps (owner's three, D-0168). Admin numbers again (pipeline_* settings); fallbacks here.
const CLIENT_SILENT_AFTER_DAYS = 3;
const INTERVIEW_OUTCOME_AFTER_DAYS = 1;

const dayDiff = (a, b) => Math.floor((a - b) / DAY_MS);
const fmtDays = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

// ONE ROW PER LEAD, NOT ONE PER CONTACT (R-122 step 3).
// A lead is a company, and a sales sequence writes to every person it found
// there. Once ONE of them replies the lead moves to "Connected", and from then
// on each of the others who had simply not answered yet became its own "No reply
// yet" row — 30 near-identical rows for one company, none of which the owner
// could explain ("on what basis is this shown?"). The silence is a fact about
// the LEAD, so it is ONE row that says how many people were written to and how
// long ago the latest email went. Candidates are unaffected (a candidate is a
// person, not a company), and a lead with a single silent contact keeps its own
// row. Rows are grouped per (lead, owner) so the ownership split stays exact.
function groupNudgesByLead(items) {
  const groups = new Map();
  const out = [];
  for (const it of items) {
    if (it.kind !== KIND.NUDGE || it.entity_type !== 'contact' || !it.job_id) { out.push(it); continue; }
    const key = `${it.job_id}|${it.owner_id || ''}`;
    if (!groups.has(key)) { const slot = { members: [] }; groups.set(key, slot); out.push(slot); }
    groups.get(key).members.push(it);
  }
  return out.map(x => {
    if (!x.members) return x;
    if (x.members.length === 1) return x.members[0];
    const m = x.members;
    const latest = m.reduce((a, b) => ((b.overdue_days ?? Infinity) < (a.overdue_days ?? Infinity) ? b : a));
    const days = latest.overdue_days;
    const lastAt = m.reduce((mx, i) => (i.last_activity_at && i.last_activity_at > mx ? i.last_activity_at : mx), '') || null;
    return {
      kind: KIND.NUDGE,
      tier: TIER.quiet,
      last_activity_at: lastAt,
      entity_type: 'lead', entity_id: latest.job_id,
      title: latest.subtitle || 'This lead',
      subtitle: `${m.length} people`,
      email: null,                 // there is no single person to write to — the row opens the lead
      job_id: latest.job_id, owner_id: latest.owner_id || null,
      stale: m.every(i => i.stale),
      reason: `You have emailed ${m.length} people here${Number.isFinite(days) ? ` (the latest ${fmtDays(days)} ago)` : ''} and nobody has replied.${m.every(i => i.stale) ? ' Chase them, or drop the lead.' : ''}`,
      state: latest.state,
      intent: null,
      priority: Math.max.apply(null, m.map(i => i.priority)),
      due_at: null,
      overdue_days: days,
      group_size: m.length,
    };
  });
}

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
// A SILENCE THAT OLD IS A DECISION, NOT A CHORE (Session 23).
// "Needs you today" was showing a lead last contacted 91 days ago. Re-presenting
// that every morning for three months is not a queue, it is wallpaper — and the
// items you scroll past daily are what teach you to ignore the ones that matter.
// Past this age a nudge leaves the daily list and is COUNTED instead (see
// `stale_nudges`), so it becomes one decision — chase them or drop them —
// rather than 90 identical mornings.
// Only NUDGES age out. Someone actually waiting on a reply never does: that is
// a debt we owe, and it does not expire because we ignored it for a quarter.
const NUDGE_MAX_AGE_DAYS = 45;
// A reply is OWED once their email is this old (owner, 20 Oct: "show it if the reply is due after 4 days"). The admin sets the real number
// (config/settings.js needs_reply_after_days); this is only the fallback for a caller that passes none. 0 = at once.
const REPLY_DUE_AFTER_DAYS = 4;

function buildNextActions({ threads = [], reminders = [], pipeline = [], now = Date.now(), limit = 50, nudgeMaxAgeDays = NUDGE_MAX_AGE_DAYS,
  replyDueAfterDays = REPLY_DUE_AFTER_DAYS, positiveReplyDueAfterDays = POSITIVE_REPLY_DUE_AFTER_DAYS,
  clientSilentAfterDays = CLIENT_SILENT_AFTER_DAYS, interviewOutcomeAfterDays = INTERVIEW_OUTCOME_AFTER_DAYS,
  todayKey = null, tomorrowKey = null, dayKeyOf = null } = {}) {
  const items = [];
  let staleNudges = 0;
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
    } else if (a.priority > 0) {
      // Long silence after our message — worth a chase, but clearly ranked
      // below someone who is actually waiting on us.
      //
      // BD leads only: while a lead is still 'Assigned', the follow-up engine
      // (fu1/fu2) is already chasing it on its own schedule — a silence-nudge
      // on top of that is noise, and at outreach volume it is a LOT of noise
      // (hundreds of leads a month sitting in Assigned with no reply yet is
      // normal, not urgent). 'Rejected' is a closed door same as opted-out —
      // nudging to chase someone who said no is not useful either. So a BD
      // lead only earns a nudge once it has moved to 'Connected' or
      // 'In Discussion' — i.e. there is a real, ongoing conversation to keep
      // alive. Candidate threads (ATS stage vocabulary, unrelated) are not
      // gated by this — ATS stages don't map to "engaged vs not yet".
      const bdLeadNotEngagedYet = t.entity_type === 'contact' && !['Connected', 'In Discussion'].includes(t.stage);
      // See NUDGE_MAX_AGE_DAYS. A 0/negative limit disables the age gate.
      const tooOldToNag = nudgeMaxAgeDays > 0
        && Number.isFinite(a.days_since_outbound)
        && a.days_since_outbound > nudgeMaxAgeDays;
      if (!bdLeadNotEngagedYet && tooOldToNag) staleNudges++;
      // A silence older than the limit is no longer hidden (owner, 20 Oct): it is shown, lower than everything else, as a decision —
      // chase them or drop the lead.
      if (!bdLeadNotEngagedYet) {
        items.push({
          kind: KIND.NUDGE,
          tier: TIER.quiet,
          stale: tooOldToNag,
          last_activity_at: lastAt,
          entity_type: t.entity_type, entity_id: t.entity_id,
          title: t.name || t.email || 'Unknown',
          subtitle: t.company || null,
          email: t.email || null,   // R-073: the row can DO the task, so it must say who to write to
          job_id: t.job_id || null, owner_id: t.owner_id || null,
          reason: tooOldToNag ? `You wrote ${fmtDays(a.days_since_outbound)} ago and heard nothing — chase them, or drop the lead.` : a.headline,
          state: a.state,
          intent: a.intent ? a.intent.id : null,
          priority: tooOldToNag ? Math.min(a.priority, STALE_NUDGE_PRIORITY) : a.priority,
          due_at: null,
          overdue_days: a.days_since_outbound,
        });
      }
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

    // A candidate thread carrying a positive signal (interested, wants to talk,
    // asked for rates/info) — worth a manual look at whether their ATS stage
    // should move. Advisory only, and deliberately does NOT know the stage
    // taxonomy or what the "next" stage would be: that vocabulary lives in
    // services/recruiting-core.js and CLAUDE.md is explicit that it must not be
    // duplicated across more files than it already is. The recruiter decides
    // the actual move; this only says a signal is there worth acting on.
    if (t.entity_type === 'candidate' && t.stage && a.intent && a.intent.tone === 'good') {
      items.push({
        kind: KIND.STAGE_SUGGESTED,
        tier: TIER.pipeline,
        entity_type: t.entity_type, entity_id: t.entity_id,
        title: t.name || t.email || 'Unknown',
        subtitle: t.company || null,
        email: t.email || null,   // R-073: the row can DO the task, so it must say who to write to
        job_id: t.job_id || null, owner_id: t.owner_id || null,
        stage: t.stage,
        reason: `${a.intent.label} — currently at "${t.stage}". Worth moving them forward?`,
        state: a.state,
        intent: a.intent.id,
        priority: 35 + (a.needs_reply ? 5 : 0),
        due_at: null,
        overdue_days: a.days_since_inbound,
      });
    }
  }

  // Silent contacts of one lead are one row (see groupNudgesByLead).
  { const merged = groupNudgesByLead(items); items.length = 0; merged.forEach(i => items.push(i)); }

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
    ((a.tier || TIER.quiet) - (b.tier || TIER.quiet)) ||
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
  shown.stale_nudges = staleNudges;
  shown.reply_not_due_yet = replyNotDueYet;
  return shown;
}

/** Small headline counts for the dashboard card. */
function summarize(items) {
  const by = { reply_due: 0, commitment_due: 0, reminder_due: 0, nudge: 0, stage_suggested: 0, pipeline_step: 0 };
  for (const i of items) if (by[i.kind] !== undefined) by[i.kind]++;
  return { total: items.length, by_kind: by, top: items[0] || null };
}

module.exports = {
  pipelineSteps, TIER, buildNextActions, summarize, groupNudgesByLead, KIND, DAY_MS, NUDGE_MAX_AGE_DAYS, REPLY_DUE_AFTER_DAYS, STALE_NUDGE_PRIORITY };
