// ============================================================================
// PRIMARY SEQUENCE — "the one I start by default" (owner, 6 Oct).
// PURE. No db, no clock.
//
// A person marks ONE sequence per kind of record (leads/contacts, candidates, …)
// as their Primary. It does one thing: when they press "Start sequence" on a
// selection, that sequence is already chosen and one click confirms. It never
// sends by itself and never replaces the Outreach Plan's automatic follow-ups —
// the owner chose "pre-select", not "start automatically" (D-0079), because an
// automatic switch would compete with the follow-ups already running and could
// email the same person twice.
//
// It is PER PERSON (D-0022: a person's preferences live with the person, not in
// the browser). Stored in app_settings under `wf_primary_<userId>` as
// { "<entity_type>": "<workflow id>" } — no migration.
//
// A Primary that is later archived, turned back to draft, or deleted is simply
// not offered (resolve() only returns active sequences of the right kind); the
// stored id is not repaired, because "Reactivate" should bring it back.
// ============================================================================
'use strict';

const ENTITY_TYPES = ['contact', 'candidate', 'job'];

const primaryKey = (userId) => `wf_primary_${userId}`;

function parse(raw) {
  let v = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (_) { return {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, id] of Object.entries(v)) if (typeof id === 'string' && id && ENTITY_TYPES.includes(k)) out[k] = id;
  return out;
}

// Switch one sequence on or off. Turning one ON replaces the previous Primary of
// the same kind (there is one per kind); turning OFF only clears it when it IS
// the Primary — switching off some other sequence changes nothing.
function toggle(store, entityType, workflowId, on) {
  const next = Object.assign({}, parse(store));
  if (!ENTITY_TYPES.includes(entityType) || !workflowId) return next;
  if (on) next[entityType] = workflowId;
  else if (next[entityType] === workflowId) delete next[entityType];
  return next;
}

// What the screens may use: only a Primary that is an ACTIVE sequence of that kind.
function resolve(store, defs) {
  const s = parse(store), out = {};
  for (const [et, id] of Object.entries(s)) {
    const d = (defs || []).find(x => x && x.id === id);
    if (d && d.status === 'active' && (d.entity_type || 'contact') === et) out[et] = id;
  }
  return out;
}

module.exports = { ENTITY_TYPES, primaryKey, parse, toggle, resolve };
