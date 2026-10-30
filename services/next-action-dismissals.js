// ============================================================================
// DISMISSING A "NEEDS YOU TODAY" ITEM — an exit that stays honest.
// ----------------------------------------------------------------------------
// PURE. No db, no clock of its own.
//
// The problem (Session 23). Only `reminder_due` items had a Done button.
// `reply_due`, `commitment_due`, `nudge` and `stage_suggested` had NO way to be
// dismissed at all, so a lead last contacted 91 days ago sat under a heading
// that says "today", forever. The owner reported this as "the cache or the
// memory does not get cleared after an activity is finished". Nothing was
// cached. Finished work had no exit.
//
// Why it was built that way, and why that reasoning still matters: the original
// comment in routes/next-actions.js says conversation-driven items are not
// dismissible on purpose, because they "disappear when the underlying fact
// changes (you reply, they opt out), which keeps the queue honest rather than
// something you can clear without doing the work." That is RIGHT. A queue you
// can empty with a click is a queue that tells you nothing.
//
// So the exit here is not deletion. It is:
//
//   1. A SNOOZE — it comes back. "Not today" is a real answer to "does this
//      need you today", and it is the honest one most of the time.
//   2. FINGERPRINTED — a dismissal is recorded against the FACT it was
//      dismissed against (the last activity on that thread). If a new message
//      arrives, the fingerprint no longer matches and the item returns
//      immediately, however long the snooze had left. You cannot silence a
//      conversation, only the version of it you have already seen.
//
// Storage is `app_settings` under `na_dismiss_<userId>` — deliberately NO
// migration, the same reasoning as the AI meter: it is small, per-user, and
// expires by never being read again. Expired entries are pruned on read so the
// row cannot grow without bound either, which would be the same disease this
// module exists to cure.
// ============================================================================

const SNOOZE_DAYS = { today: 1, week: 7, month: 30 };
// A "drop" is not forever — forever is how a queue quietly stops being true.
// It is long enough to mean "stop asking" and short enough that a lead you
// abandoned in March is reconsidered rather than lost.
const DROP_DAYS = 180;
const MS_DAY = 24 * 60 * 60 * 1000;

function settingsKey(userId) {
  return `na_dismiss_${userId}`;
}

// One stable id for "this action, on this record". Must not include anything
// that changes day to day, or a dismissal would only ever last until midnight.
function itemKey(item) {
  if (!item) return null;
  if (item.reminder_id) return `reminder:${item.reminder_id}`;
  // An interview / submission step is about ONE submission (a candidate can be on several jobs) and one step (R-297).
  if (item.kind === 'pipeline_step' && item.submission_id) return `pipeline_step:${item.submission_id}:${item.step || ''}`;
  const kind = item.kind || 'item';
  const type = item.entity_type || 'unknown';
  const id = item.entity_id || item.job_id || 'none';
  return `${kind}:${type}:${id}`;
}

// The fact being dismissed. Anything that would make this action NEW again
// belongs in here. Currently: the last thing that happened on the thread.
// R-350 (owner, 30 Oct: "even if I drop a to-do in Needs you, it re-emerges the other day … and the list keeps building up"): the
// fingerprint used to carry `overdue_days`, which grows by one EVERY DAY on its own — so every drop and snooze stopped matching at
// midnight and the item came back, though nothing had happened on the thread. Only a real new fact counts now: the last activity
// and the state. (The middle part stays, empty, so a record written before this fix still matches — see sameFact.)
function fingerprintOf(item) {
  if (!item) return '';
  return [item.last_activity_at || '', '', item.state || ''].join('|');
}
// A stored fingerprint and today's describe the same fact when activity and state agree; the old middle part (a day count) is ignored.
function sameFact(stored, current) {
  const a = String(stored || '').split('|'), b = String(current || '').split('|');
  return (a[0] || '') === (b[0] || '') && (a[a.length - 1] || '') === (b[b.length - 1] || '');
}

function horizonFor(scope, now = Date.now()) {
  const days = scope === 'drop' ? DROP_DAYS : (SNOOZE_DAYS[scope] || SNOOZE_DAYS.today);
  return new Date(now + days * MS_DAY).toISOString();
}

// Drop expired entries. Called on every read AND before every write, so the
// stored object stays proportional to what is actually snoozed right now.
function prune(store, now = Date.now()) {
  const out = {};
  if (!store || typeof store !== 'object') return out;
  for (const [k, v] of Object.entries(store)) {
    if (!v || typeof v !== 'object' || !v.until) continue;
    const t = new Date(v.until).getTime();
    if (!Number.isFinite(t) || t <= now) continue;
    out[k] = { until: v.until, fp: typeof v.fp === 'string' ? v.fp : '' };
  }
  return out;
}

function recordDismissal(store, item, scope, now = Date.now()) {
  const next = prune(store, now);
  const key = itemKey(item);
  if (!key) return next;
  next[key] = { until: horizonFor(scope, now), fp: fingerprintOf(item) };
  return next;
}

// Is this item currently snoozed? Only when the snooze is live AND the fact it
// was snoozed against has not changed.
function isDismissed(store, item, now = Date.now()) {
  if (!store) return false;
  const key = itemKey(item);
  if (!key) return false;
  const rec = store[key];
  if (!rec || !rec.until) return false;
  const t = new Date(rec.until).getTime();
  if (!Number.isFinite(t) || t <= now) return false;
  // A new message on the thread voids the snooze — see the header note.
  return sameFact(rec.fp, fingerprintOf(item));
}

// Returns the items still worth showing, plus how many were held back. The
// count matters: a queue that hides things and cannot say how many is the
// problem, not the fix.
function applyDismissals(items, store, now = Date.now()) {
  const all = Array.isArray(items) ? items : [];
  const kept = [];
  let snoozed = 0;
  for (const it of all) {
    if (isDismissed(store, it, now)) { snoozed++; continue; }
    kept.push(it);
  }
  return { items: kept, snoozed };
}

module.exports = {
  SNOOZE_DAYS, DROP_DAYS,
  settingsKey, itemKey, fingerprintOf, horizonFor,
  prune, recordDismissal, isDismissed, applyDismissals,
};
