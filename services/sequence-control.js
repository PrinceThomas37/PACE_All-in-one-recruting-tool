'use strict';
// CONTROLLING A SEQUENCE THAT HAS PEOPLE IN IT (R-384, R-385, R-386; D-0216, D-0217).
//
// Owner, 4–5 Nov 2026: Delete a sequence (stops its people, kept for a few days so it can be brought back); "N people in it now" with Stop all
// (emails already queued still go out, steps not yet queued do not run); edit a running sequence freely — the WORDING of a step may
// change while people are inside, but adding, removing, reordering or retiming steps makes a copy.
//
// Findings that shaped it (read from the code, 5 Nov): "Turn off" only stopped NEW enrolments — workflow-engine.js picks due steps by
// each person's own enrolment status and never re-checks the sequence; and an edit used to delete and re-insert every step, which is why
// it refused while anyone was inside. No database change is needed: the sequence's `status` is plain text ('deleted' is one more value),
// an enrolment's `exit_reason` is plain text, and a step's versions live in its existing `config` JSON (config.versions, picked at random
// per lead by services/sequence-v2.js).
//
// Pure functions + small database helpers that take the client. Queued emails are NEVER touched here.

const STOP_REASON = 'sequence_stopped';
const DELETE_REASON = 'sequence_deleted';
const WORDING_KEYS = ['subject', 'body', 'versions'];
const RUNNING = ['active', 'paused'];           // "in it now"

const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}
const same = (a, b) => JSON.stringify(sortKeys(a == null ? null : a)) === JSON.stringify(sortKeys(b == null ? null : b));
const withoutWording = (cfg) => { const c = clone(cfg || {}); WORDING_KEYS.forEach((k) => { delete c[k]; }); return c; };
const wordingOf = (cfg) => { const c = cfg || {}; return { subject: c.subject == null ? '' : c.subject, body: c.body == null ? '' : c.body, versions: Array.isArray(c.versions) ? c.versions : [] }; };

/**
 * What kind of change is this? `oldSteps` as stored, `newSteps` as sent (both [{step_order?, name, channel, delay_days, config}]).
 *   none      — nothing changed;
 *   wording   — only the words (subject, body, versions) or a step's name changed → may be done in place, even with people inside;
 *   structure — a step was added, removed or moved, or a step's kind, timing or any other setting changed → needs a copy while people are inside.
 * `changed` lists the (1-based) steps whose wording changed.
 */
function classifyEdit(oldSteps, newSteps) {
  const o = (oldSteps || []).slice().sort((a, b) => a.step_order - b.step_order);
  const n = newSteps || [];
  if (o.length !== n.length) return { kind: 'structure', why: 'the number of steps changed', changed: [] };
  const changed = [];
  for (let i = 0; i < o.length; i++) {
    if (o[i].channel !== n[i].channel) return { kind: 'structure', why: `step ${i + 1} now uses a different kind of step`, changed: [] };
    if (Number(o[i].delay_days || 0) !== Number(n[i].delay_days || 0)) return { kind: 'structure', why: `step ${i + 1} now waits a different number of days`, changed: [] };
    if (!same(withoutWording(o[i].config), withoutWording(n[i].config))) return { kind: 'structure', why: `a setting of step ${i + 1} changed`, changed: [] };
    if (!same(wordingOf(o[i].config), wordingOf(n[i].config)) || String(o[i].name || '') !== String(n[i].name || '')) changed.push(i + 1);
  }
  return { kind: changed.length ? 'wording' : 'none', changed };
}

// How many of these people have ALREADY received step `order` (the engine stores the last step done in current_step_order).
function receivedStep(enrollments, order) { return (enrollments || []).filter((e) => Number(e.current_step_order) >= Number(order)).length; }

// { [workflowId]: { active, paused, total } } for the given sequences — one read.
async function peopleCounts(supabase, workflowIds, orgId) {
  const ids = (workflowIds || []).filter(Boolean);
  const out = {}; ids.forEach((id) => { out[id] = { active: 0, paused: 0, total: 0 }; });
  if (!ids.length) return out;
  let q = supabase.from('workflow_enrollments').select('workflow_id,status').in('workflow_id', ids).in('status', RUNNING);
  if (orgId) q = q.eq('org_id', orgId);
  const { data, error } = await q;
  if (error) throw error;
  (data || []).forEach((r) => { const c = out[r.workflow_id]; if (c) { c[r.status] += 1; c.total += 1; } });
  return out;
}

// Everyone still going through this sequence stops: no later step runs. Emails ALREADY QUEUED are left alone and still go out.
async function stopEveryone(supabase, { workflowId, orgId, reason = STOP_REASON, now = new Date() }) {
  let q = supabase.from('workflow_enrollments')
    .update({ status: 'exited', exit_reason: reason, completed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('workflow_id', workflowId).in('status', RUNNING);
  if (orgId) q = q.eq('org_id', orgId);
  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data || []).length;
}

// A deleted sequence keeps its row (so past numbers in Outreach Insights keep their name); 'deleted' is its status, and updated_at is when.
// shortcut: the deletion time is the row's updated_at — nothing else may touch a deleted sequence (the status and edit routes refuse),
// so it holds; add a deleted_at column the day a migration is needed for something else.
function restorable(def, { now = new Date(), days }) {
  if (!def || def.status !== 'deleted') return { ok: false, why: 'This sequence is not deleted.' };
  const at = new Date(def.updated_at || 0).getTime();
  const until = new Date(at + Number(days) * 86400000);
  if (!Number.isFinite(at) || at === 0) return { ok: false, why: 'This sequence cannot be restored.' };
  if (now.getTime() > until.getTime()) return { ok: false, why: `It was deleted more than ${days} days ago, so it can no longer be restored.`, until };
  return { ok: true, until };
}

module.exports = { STOP_REASON, DELETE_REASON, WORDING_KEYS, RUNNING, classifyEdit, receivedStep, peopleCounts, stopEveryone, restorable };
