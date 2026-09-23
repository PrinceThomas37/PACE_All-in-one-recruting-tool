// ============================================================================
// RECORD HISTORY — the ONE definition of "what happened to this record, when".
//
// The owner asked for "the time of every stage change ... a small rewind clock
// button in every lead, candidate, job". PACE already recorded two of those and
// showed none of them:
//
//   leads        -> activity_log        (action_type 'stage_change', old/new)
//   submissions  -> submission_activity (old_stage / new_stage)
//   job orders   -> nothing
//   candidates   -> nothing
//   companies    -> nothing
//
// Three stores, two shapes, no reader. That is exactly the drift D-0029 was
// written about: one idea recorded several ways drifts until the screens
// disagree. So every source is normalised HERE, into one entry shape, and every
// screen reads that shape. A new source adds a mapper in this file and nothing
// else changes.
//
// PURE — no database, no fetch, no clock. `relativeTime` takes `now` as an
// argument because every label it produces is a factual claim about elapsed
// time, and a test that passes only on the day it was written is not a test.
// ============================================================================

'use strict';

// The record kinds a history can be asked for. The id is what the URL carries,
// so these strings are an API contract — add, never rename.
const ENTITIES = ['lead', 'candidate', 'job_order', 'submission', 'company'];

function isEntity(kind) { return ENTITIES.indexOf(String(kind || '')) !== -1; }

const str = v => (v == null ? null : String(v).trim() || null);

// A stored old/new value may be a bare string, or the jsonb blob `activity_log`
// writes ({stage:'Assigned'}). Both mean the same thing to a reader, so both
// collapse to a word here rather than at three call sites.
function valueOf(raw, field) {
  if (raw == null) return null;
  if (typeof raw === 'string') return str(raw);
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    if (field && raw[field] != null) return str(raw[field]);
    for (const k of ['stage', 'status', 'value', 'to', 'name']) {
      if (raw[k] != null) return str(raw[k]);
    }
  }
  return null;
}

// ── the one entry shape ─────────────────────────────────────────────────────
// { at, kind, field, from, to, actor, note, source }
// `at` is always an ISO string; a row with no timestamp is DROPPED rather than
// dated now — a history whose times are invented is worse than a short one.
function entry(o) {
  const at = str(o.at);
  if (!at) return null;
  return {
    at,
    kind: str(o.kind) || 'change',
    field: str(o.field),
    from: str(o.from),
    to: str(o.to),
    actor: str(o.actor),
    note: str(o.note),
    source: str(o.source),
  };
}

// ── mappers, one per store ──────────────────────────────────────────────────

// activity_log — the leads engine's trail. Carries far more than stage changes
// (job_created, job_updated, job_deleted, ...), and all of it is real history.
function fromActivityLog(row) {
  if (!row) return null;
  const action = str(row.action_type) || 'change';
  const isStage = action === 'stage_change';
  return entry({
    at: row.created_at,
    kind: isStage ? 'stage' : action,
    field: isStage ? 'stage' : null,
    from: valueOf(row.old_value, 'stage'),
    to: valueOf(row.new_value, 'stage'),
    actor: row.user && row.user.name ? row.user.name : null,
    note: str(row.description),
    source: 'activity_log',
  });
}

// submission_activity — a candidate's progress on one job order.
function fromSubmissionActivity(row) {
  if (!row) return null;
  const from = str(row.old_stage), to = str(row.new_stage);
  return entry({
    at: row.created_at,
    kind: (from || to) ? 'stage' : (str(row.action) || 'change'),
    field: (from || to) ? 'stage' : null,
    from, to,
    actor: row.recruiter && row.recruiter.name ? row.recruiter.name : null,
    note: str(row.note),
    source: 'submission_activity',
  });
}

// record_history — the general store (migration 045), for the record kinds that
// had nowhere to write: job orders, candidates, companies.
function fromRecordHistory(row) {
  if (!row) return null;
  const field = str(row.field);
  return entry({
    at: row.created_at,
    kind: str(row.action) || (field ? 'field' : 'change'),
    field,
    from: valueOf(row.old_value, field),
    to: valueOf(row.new_value, field),
    actor: row.actor && row.actor.name ? row.actor.name : null,
    note: str(row.note),
    source: 'record_history',
  });
}

// ── assembling a timeline ───────────────────────────────────────────────────

// Newest first, nulls dropped. A record may draw on more than one store (a
// submission has its own trail AND its job order's), so merging is the normal
// case rather than the exception.
function timeline(lists) {
  const all = [];
  for (const list of (lists || [])) {
    for (const e of (list || [])) if (e) all.push(e);
  }
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all;
}

// ── saying it in English ────────────────────────────────────────────────────

const ACTION_WORDS = {
  job_created: 'Lead created',
  job_updated: 'Lead updated',
  job_deleted: 'Lead deleted',
  created: 'Created',
  imported: 'Imported',
  assigned: 'Assigned',
  note: 'Note added',
};

function titleCaseField(field) {
  if (!field) return 'Changed';
  return String(field).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

// The sentence a person reads. A stage change names BOTH ends — "Screening" on
// its own does not say whether that is progress — and a first value says so
// rather than pretending there was a previous one.
function describe(e) {
  if (!e) return '';
  if (e.kind === 'stage' || e.field) {
    const label = e.field === 'stage' || e.kind === 'stage' ? 'Stage' : titleCaseField(e.field);
    if (e.from && e.to) return label + ': ' + e.from + ' → ' + e.to;
    if (e.to) return label + ' set to ' + e.to;
    if (e.from) return label + ' cleared (was ' + e.from + ')';
    return label + ' changed';
  }
  if (ACTION_WORDS[e.kind]) return ACTION_WORDS[e.kind];
  if (e.note) return e.note;
  return titleCaseField(e.kind);
}

// ── time ────────────────────────────────────────────────────────────────────
// The owner asked for "date and time", so the EXACT stamp is always available;
// the relative form is the glance. Both, never one.

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

function relativeTime(at, now) {
  const t = Date.parse(at), n = Date.parse(now);
  if (!isFinite(t) || !isFinite(n)) return null;
  const d = n - t;
  if (d < 0) return 'just now';          // clock skew is not a time machine
  if (d < MIN) return 'just now';
  if (d < HOUR) { const m = Math.floor(d / MIN); return m + (m === 1 ? ' min ago' : ' mins ago'); }
  if (d < DAY)  { const h = Math.floor(d / HOUR); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const days = Math.floor(d / DAY);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  const mo = Math.floor(days / 30);
  if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
  const y = Math.floor(days / 365);
  return y + (y === 1 ? ' year ago' : ' years ago');
}

// How long a record SAT at each value before moving on — the question a stage
// history is actually asked ("where do candidates rot?"). The newest entry is
// still open, so its duration runs to `now` and it is marked `open`.
function durations(entries, now) {
  const stages = (entries || []).filter(e => e && e.kind === 'stage' && e.to);
  const out = [];
  for (let i = 0; i < stages.length; i++) {
    const startedAt = stages[i].at;
    const endedAt = i === 0 ? str(now) : stages[i - 1].at;
    const ms = Date.parse(endedAt) - Date.parse(startedAt);
    out.push({
      stage: stages[i].to,
      startedAt,
      endedAt: i === 0 ? null : endedAt,
      open: i === 0,
      ms: isFinite(ms) && ms > 0 ? ms : 0,
    });
  }
  return out;
}

module.exports = {
  ENTITIES, isEntity,
  fromActivityLog, fromSubmissionActivity, fromRecordHistory,
  timeline, describe, relativeTime, durations,
  _valueOf: valueOf, _entry: entry,
};
