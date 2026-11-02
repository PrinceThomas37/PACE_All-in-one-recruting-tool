// ============================================================================
// IMPORTS IN PROGRESS, AND "IMPORT FINISHED" (R-343 step 4, owner 2 Nov 2026, D-0194 / D-0195).
// ----------------------------------------------------------------------------
// "Does it show a progress bar in the leads tab for RA lead or the user who imports the data to show how many leads have been
// read … and then once complete show a notification that the import is completed?" — owner: the importer and THEIR OWN TEAM's
// RA Lead (admins see the company, as everywhere, D-0034).
//
// A running import lives in this process's memory (one server; an import is one request — if the server restarts mid-import,
// the import itself is gone too, so nothing is lost by not storing it). A FINISHED import is written to activity_log
// (action_type 'import_finished') so the RA Lead who was not looking still sees it later. PURE apart from the injected
// store; the clock is injectable for tests.
// ============================================================================
'use strict';

const FINISHED_SHOWN_MS = 24 * 60 * 60 * 1000;     // a finished import is shown for a day, then leaves (never deleted)
const runs = new Map();                             // id -> run
let seq = 0;

function start({ orgId, userId, userName, total, now = Date.now() }) {
  const id = 'imp_' + now.toString(36) + '_' + (++seq);
  const run = { id, org_id: orgId || null, user_id: userId, user_name: userName || '', total: Math.max(0, total | 0), done: 0,
    status: 'running', started_at: new Date(now).toISOString(), finished_at: null, summary: null };
  runs.set(id, run);
  return run;
}
function progress(id, done) { const r = runs.get(id); if (r && r.status === 'running') r.done = Math.min(r.total, Math.max(r.done, done | 0)); return r || null; }
function finish(id, summary, now = Date.now()) {
  const r = runs.get(id); if (!r) return null;
  r.status = summary && summary.failed ? 'failed' : 'finished'; r.done = r.status === 'finished' ? r.total : r.done;
  r.finished_at = new Date(now).toISOString(); r.summary = summary || {};
  return r;
}
/** Forget finished runs older than a day (memory only). */
function sweep(now = Date.now()) {
  for (const [id, r] of runs) if (r.status !== 'running' && now - Date.parse(r.finished_at) > FINISHED_SHOWN_MS) runs.delete(id);
}

/**
 * The runs this viewer may see: their own, their team's (ids in `teamIds` — an RA Lead's reporting chain), or the whole
 * company for an admin. `stored` = finished runs read back from activity_log (merged by id, memory wins).
 */
function visible({ orgId, viewerId, teamIds, isAdmin, stored = [], now = Date.now() }) {
  sweep(now);
  const team = new Set([viewerId].concat(teamIds || []));
  const byId = new Map();
  stored.forEach((r) => byId.set(r.id, r));
  for (const r of runs.values()) byId.set(r.id, r);
  return [...byId.values()]
    .filter((r) => (!orgId || !r.org_id || r.org_id === orgId) && (isAdmin || team.has(r.user_id)))
    .filter((r) => r.status === 'running' || now - Date.parse(r.finished_at || r.started_at) <= FINISHED_SHOWN_MS)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 10);
}

/** The activity_log row for a finished import. */
function logRow(run) {
  return { user_id: run.user_id, action_type: 'import_finished', org_id: run.org_id,
    description: `Imported ${run.summary && run.summary.imported != null ? run.summary.imported : run.done} of ${run.total} leads`,
    new_value: { run_id: run.id, user_name: run.user_name, total: run.total, started_at: run.started_at, finished_at: run.finished_at, summary: run.summary } };
}
/** A run read back from an activity_log row. */
function fromLog(row) {
  const v = row.new_value || {};
  return { id: v.run_id || row.id, org_id: row.org_id, user_id: row.user_id, user_name: v.user_name || '', total: v.total || 0,
    done: v.total || 0, status: v.summary && v.summary.failed ? 'failed' : 'finished', started_at: v.started_at || row.created_at,
    finished_at: v.finished_at || row.created_at, summary: v.summary || {} };
}

module.exports = { FINISHED_SHOWN_MS, start, progress, finish, sweep, visible, logRow, fromLog, _reset: () => { runs.clear(); seq = 0; } };
