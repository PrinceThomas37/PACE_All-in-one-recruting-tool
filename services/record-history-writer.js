// ============================================================================
// RECORD HISTORY — the writer.
//
// Separate from `record-history.js` because THAT file is pure and is what the
// tests exercise; this one touches the database. Same split as every other
// rule in PACE: the decision is callable and testable, the IO is thin.
//
// Modelled on `logActivity` (index.js) and `logSubmissionActivity`
// (recruiting-core.js), including the swallow: a history row that fails to
// write must never take down the save it is describing. That is NOT the "a
// write that did not happen is never reported as saved" rule — nothing is
// reported to a user about this row, and losing one trail entry is strictly
// better than losing the record change it describes.
// ============================================================================
'use strict';

// The value a history row stores. jsonb, so a plain string is wrapped — that
// keeps old_value/new_value one shape whether the column held a word or a blob,
// which is what lets the pure reader treat every source the same way.
function packed(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  return { value: String(v) };
}

// changed(a, b) — is this worth a history row at all?
// A save that rewrites a field to the value it already had is not history, and
// a trail full of those is one nobody reads.
function changed(a, b) {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  return x !== y;
}

function makeRecorder(supabase, orgStamp) {
  // record(req, entity, id, {action, field, from, to, note})
  async function record(req, entity, entityId, o) {
    try {
      if (!entity || !entityId) return;
      const opts = o || {};
      const row = Object.assign({
        entity_type: entity,
        entity_id: entityId,
        action: opts.action || (opts.field ? 'field' : 'change'),
        field: opts.field || null,
        old_value: packed(opts.from),
        new_value: packed(opts.to),
        note: opts.note || null,
        actor_id: (req && req.user && req.user.id) || null,
      }, orgStamp ? orgStamp(req) : {});
      await supabase.from('record_history').insert(row);
    } catch (e) {
      // Includes "relation record_history does not exist" while migration 045
      // is unapplied. Deliberately quiet: the feature degrades to the stores
      // that already exist rather than breaking every save in the app.
      if (process.env.DEBUG_HISTORY) console.error('record_history insert failed:', e.message);
    }
  }

  // recordFields(req, entity, id, before, after, fields) — one row per field
  // that genuinely moved. Callers pass the whole before/after so adding a
  // tracked field is a list edit, not another call site.
  async function recordFields(req, entity, entityId, before, after, fields) {
    for (const f of (fields || [])) {
      const from = before ? before[f] : null;
      const to = after ? after[f] : null;
      if (!changed(from, to)) continue;
      await record(req, entity, entityId, { action: f === 'stage' || f === 'status' ? 'stage' : 'field', field: f, from, to });
    }
  }

  return { record, recordFields };
}

module.exports = { makeRecorder, _packed: packed, _changed: changed };
