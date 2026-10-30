// ============================================================================
// AN ASSIGNED LEAD THAT NEVER GOT ITS FIRST EMAIL IS FOUND AND WRITTEN (R-346)
// ----------------------------------------------------------------------------
// The owner (30 Oct): BD Lead 1's 65 leads were assigned and NOTHING was written — the one database insert for all 138 first
// emails was cut off (statement timeout while the server was slow), the error lived only in a progress note cleared after five
// minutes, and the leads sat "Assigned" with their follow-up schedule and no email. BD Lead 2 had 10 the same way on 29 Oct.
// "I have to come back every day on this outreach issue." So PACE checks itself: every run of this job looks for those leads
// and writes their first emails, the same way the assignment would have.
//
// Which leads: assigned by Assign Leads in AUTO mode — the only path that creates `follow_ups` rows at assignment — between
// 10 minutes and 7 days ago, still at stage Assigned, with NO email of any kind for the lead. A manager's hand-out
// (routes/lead-assign.js) writes no follow-ups ("owning is not sending") and a MANUAL-mode person is skipped, so neither is
// ever written for here. Writing goes through the caller's generateEmailsForJobs, which itself skips a person+lead that
// already had a first email — this job can never send a second cold email.
//
// A lead that still gets nothing (no sequence written yet, no valid contact) is not retried for COOLDOWN_MS, so a lead that
// cannot be written does not cost the database a heavy read every run.
// ============================================================================
'use strict';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SETTLE_MS = 10 * 60 * 1000;        // leave the assignment's own writer time to finish first
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CHUNK = 200;

/**
 * PURE. Which leads to write, grouped by their owner.
 *   assigned   [{id, assigned_to_bd}]   leads at stage Assigned in the window
 *   withEmail  Set of job ids that have any email
 *   withFollow Set of job ids that have follow_ups rows (= assigned in auto mode)
 *   manual     Set of user ids in MANUAL mode
 *   tried      Map job id → last attempt ms
 * → { [userId]: [jobId] }
 */
function planRepair({ assigned, withEmail, withFollow, manual, tried, now }) {
  const out = {};
  for (const j of assigned || []) {
    if (!j || !j.id || !j.assigned_to_bd) continue;
    if (withEmail.has(j.id) || !withFollow.has(j.id)) continue;
    if (manual.has(j.assigned_to_bd)) continue;
    const last = tried.get(j.id);
    if (last && now - last < COOLDOWN_MS) continue;
    (out[j.assigned_to_bd] = out[j.assigned_to_bd] || []).push(j.id);
  }
  return out;
}

async function idsHaving(supabase, table, ids) {
  const have = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select('job_id').in('job_id', ids.slice(i, i + CHUNK));
    if (error) throw error;
    (data || []).forEach(r => have.add(r.job_id));
  }
  return have;
}

/**
 * The job. deps: { supabase, generateEmailsForJobs(jobIds, userId) → count, getRaMode(userId) → 'auto'|'manual',
 * onWritten(userId) — kick that person's send, clock?, tried? (a Map kept across runs) }
 */
function createFirstEmailRepair(deps) {
  const tried = deps.tried || new Map();
  const clock = deps.clock || (() => Date.now());
  return async function runFirstEmailRepair() {
    const { supabase } = deps;
    const now = clock();
    const from = new Date(now - WINDOW_MS).toISOString();
    const to = new Date(now - SETTLE_MS).toISOString();
    const assigned = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabase.from('jobs').select('id,assigned_to_bd').is('deleted_at', null).eq('stage', 'Assigned')
        .not('assigned_to_bd', 'is', null).gte('assigned_at', from).lte('assigned_at', to).order('id', { ascending: true }).range(off, off + 999);
      if (error) throw error;
      assigned.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    if (!assigned.length) return { skipped: 'nothing_missing', checked: 0 };
    const ids = assigned.map(j => j.id);
    const withEmail = await idsHaving(supabase, 'emails', ids);
    const open = ids.filter(id => !withEmail.has(id));
    const withFollow = open.length ? await idsHaving(supabase, 'follow_ups', open) : new Set();
    const owners = [...new Set(assigned.filter(j => withFollow.has(j.id) && !withEmail.has(j.id)).map(j => j.assigned_to_bd))];
    const manual = new Set();
    for (const u of owners) if ((await deps.getRaMode(u)) === 'manual') manual.add(u);

    const plan = planRepair({ assigned, withEmail, withFollow, manual, tried, now });
    const result = { checked: assigned.length, missing: 0, written: 0, people: 0, failed: 0 };
    for (const [userId, jobIds] of Object.entries(plan)) {
      result.missing += jobIds.length;
      jobIds.forEach(id => tried.set(id, now));
      try {
        const n = await deps.generateEmailsForJobs(jobIds, userId);
        console.log(`[FirstEmailRepair] ${jobIds.length} assigned lead(s) of ${userId} had no first email — wrote ${n}`);
        if (n > 0) { result.written += n; result.people += 1; await deps.onWritten(userId); }
      } catch (e) {
        result.failed += jobIds.length;
        jobIds.forEach(id => tried.delete(id));   // a failed write (e.g. the database was busy) is tried again next run
        console.error(`[FirstEmailRepair] writing for ${userId} failed:`, e && e.message);
      }
    }
    // forget attempts older than the window, so the map never grows without bound
    for (const [id, t] of tried) if (now - t > WINDOW_MS) tried.delete(id);
    return result.missing ? result : { skipped: 'nothing_missing', checked: result.checked };
  };
}

/** A database error that means "busy, try again" — never one that could have half-written (a cancelled statement is rolled back). */
function isRetryableDbError(err) {
  const m = String((err && (err.message || err.details)) || '');
  return (err && err.code === '57014') || /statement timeout|canceling statement/i.test(m);
}

module.exports = { planRepair, createFirstEmailRepair, isRetryableDbError, WINDOW_MS, SETTLE_MS, COOLDOWN_MS };
