// ============================================================================
// MERGING TWO CLIENT RECORDS INTO ONE.
//
// PACE holds 1,567 companies, and since Session 26 a BD can create one just by
// typing a client name into the New Job form. That is the right trade — a
// typeahead shows what already exists while you type, and refusing an unknown
// name would block a real job order — but it means near-duplicates
// ("Treplar Inc" / "Treplar Incorporated") will accumulate. The client resolver
// deliberately never merges a near-match by itself, because a job order
// silently filed under the wrong client shows no error anywhere. So the
// judgement is a person's, and this is the tool for making it.
//
// WHAT A MERGE IS: everything that points at the duplicate is re-pointed at the
// survivor, and the duplicate is SOFT-DELETED. Nothing is destroyed — the row
// stays, and what moved is recorded so a mistake can be picked apart by hand.
//
// PURE — no db, no clock. The route does the IO around it.
// ============================================================================

// Every table that points at a company. A merge that misses one leaves orphan
// rows attached to a record the app no longer shows, so this list is the ONE
// place to add a new one — and `test/company-merge-smoke.mjs` checks it against
// the live schema's own columns rather than trusting it.
//
// `contacts` is deliberately absent: it hangs off `jobs.job_id`, so contacts
// follow their leads without being touched.
const MERGE_TABLES = [
  { table: 'jobs',             label: 'lead',     plural: 'leads' },
  { table: 'job_orders',       label: 'job',      plural: 'jobs' },
  { table: 'client_documents', label: 'document', plural: 'documents' },
  { table: 'email_tracking',   label: 'email',    plural: 'emails' },
  // Migration 048 (client intelligence): replies filed to a client move with it.
  { table: 'conversation_messages', label: 'reply', plural: 'replies' },
  // A saved AI summary describes ONE client's emails. After a merge it would
  // describe only half of them, so the duplicate's summary is CLEARED rather
  // than moved (there is at most one per client — a move could collide with
  // the survivor's). The survivor's own summary reads "N new" and is simply
  // re-generated when its owner next presses the button.
  { table: 'client_summaries', label: 'saved summary', plural: 'saved summaries', clear: true },
];

// What makes a merge impossible, in words the person reading the screen can act
// on. Returns null when it may proceed.
function mergeInputError({ sourceId, targetId } = {}) {
  if (!sourceId || !targetId) return 'Pick the duplicate client to merge in.';
  if (sourceId === targetId) return 'That is the same client — pick a different one to merge in.';
  // Deliberately NOT refused: two clients whose names look nothing alike.
  // "Treplar Inc" and "T.I. Construction" can be the same company, and only the
  // person merging them knows. The guard against a mis-click is that the plan
  // is stated in full before the button is pressed, not a name comparison the
  // app cannot actually make.
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The sentence shown BEFORE the button is pressed. A merge is hard to undo, so
// what is about to move is stated in full — including when nothing will move,
// which is a legitimate and reassuring answer rather than an error.
function describePlan(counts, { sourceName, targetName } = {}) {
  const moving = MERGE_TABLES.filter(t => !t.clear)
    .map(t => ({ t, n: Number((counts || {})[t.table] || 0) }))
    .filter(x => x.n > 0)
    .map(x => plural(x.n, x.t.label, x.t.plural));
  const from = sourceName || 'the duplicate';
  const to = targetName || 'this client';
  if (!moving.length) {
    return `“${from}” has nothing attached to it. It will be removed from your clients and “${to}” will be untouched.`;
  }
  const list = moving.length === 1 ? moving[0]
    : moving.slice(0, -1).join(', ') + ' and ' + moving[moving.length - 1];
  return `${list} will move from “${from}” to “${to}”, and “${from}” will be removed from your clients. Nothing is deleted.`;
}

// Is there anything to do at all? Used to keep the button honest.
function totalMoving(counts) {
  return MERGE_TABLES.filter(t => !t.clear).reduce((n, t) => n + Number((counts || {})[t.table] || 0), 0);
}

module.exports = { MERGE_TABLES, mergeInputError, describePlan, totalMoving };
