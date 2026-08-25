// engine-runs.js
// One scheduler for every recurring background job.
//
// THE PROBLEM THIS SOLVES
// Every recurring job in this app is a `setInterval` inside the single Render web
// process. Render's free tier sleeps that process when nobody is using the app,
// which silently stops all of them. Nothing records that they stopped, so "did
// the follow-up engine run last night?" can only be answered by reading logs.
// That is survivable for follow-ups today. It is not survivable for anything we
// promise runs overnight (see docs/AUTONOMOUS_ENGINE_PLAN.md, Step 0).
//
// THE FIX, IN TWO PARTS
//   1. Due-ness lives in the DATABASE (`app_settings.cron_last_<job>`), not in the
//      interval timer. Whoever asks first — the in-process interval, or an
//      external ping to /cron/tick — runs the job and stamps it; the other then
//      sees it as not-due and skips. This is what makes it safe to add a free
//      external pinger (GitHub Actions / cron-job.org) without double-running.
//      It mirrors the pattern `last_followup_run` already uses in index.js.
//   2. Every run is recorded in `engine_runs`, so the question is answerable on
//      screen instead of in logs.
//
// DESIGN NOTES
// - Domain-blind, like workflow-engine.js: it knows nothing about email, leads,
//   or candidates. Jobs register a name, a cadence, and a function.
// - Recording is best-effort. If `engine_runs` is missing (migration 033 not yet
//   applied) or the insert fails, the job still runs. Observability must never be
//   the reason work doesn't happen.
// - A job that throws is caught, recorded as `error`, and does not stop the other
//   jobs in the same tick.

const LAST_RUN_PREFIX = 'cron_last_';

// Deliberately NOT under LAST_RUN_PREFIX: this is not a job, it is the fact that
// the external pinger reached us. See recordPing below for why it has to be a
// separate fact from "a job ran".
const PING_KEY = 'engine_last_external_ping';

function createEngineRunner({ supabase }) {
  const jobs = new Map();        // name -> { everyMs, run, description }
  const inFlight = new Set();    // names currently executing in THIS process

  // ── persistence ───────────────────────────────────────────────────────────
  // Both helpers swallow errors: a settings read failing should make a job look
  // due (run it) rather than silently stall the whole engine.

  async function readLastRun(name) {
    try {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', LAST_RUN_PREFIX + name).maybeSingle();
      return data && data.value ? new Date(data.value) : null;
    } catch { return null; }
  }

  async function stampLastRun(name, when) {
    try {
      await supabase.from('app_settings').upsert(
        { key: LAST_RUN_PREFIX + name, value: (when || new Date()).toISOString(), updated_at: new Date() },
        { onConflict: 'key' }
      );
    } catch { /* non-fatal — worst case the job runs again next tick */ }
  }

  // One row per completed run, written at the end rather than opened up front:
  // it halves the writes and there is no half-finished row to interpret. A job
  // that hangs shows up instead through `status().running` and `overdue`.
  async function recordRun(name, triggeredBy, startedAtMs, status, counts, error) {
    try {
      await supabase.from('engine_runs').insert({
        job_name: name,
        status,
        triggered_by: triggeredBy || 'interval',
        started_at: new Date(startedAtMs),
        finished_at: new Date(),
        duration_ms: Date.now() - startedAtMs,
        counts: counts || null,
        error: error ? String(error).slice(0, 1000) : null
      });
    } catch { /* table may not exist yet — never block the job on recording */ }
  }

  // ── registration ──────────────────────────────────────────────────────────

  // `quiet` is for jobs that are polled often but rarely act — the daily
  // follow-up check runs every few minutes but only fires once a day. Without
  // it, engine_runs fills with hundreds of "did nothing" rows and the screen
  // meant to show whether the engine works becomes unreadable. A quiet job is
  // recorded only when it reports actual work (see `skipped` below).
  function register(name, { everyMs, run, description, quiet }) {
    if (!name || typeof run !== 'function') throw new Error('register needs a name and a run function');
    jobs.set(name, { everyMs: everyMs || 0, run, description: description || '', quiet: Boolean(quiet) });
  }

  // ── execution ─────────────────────────────────────────────────────────────

  // Run one job regardless of whether it is due. Returns a result envelope
  // rather than throwing, so a caller looping over jobs never breaks mid-tick.
  async function runJob(name, { triggeredBy } = {}) {
    const job = jobs.get(name);
    if (!job) return { job: name, ran: false, reason: 'unknown_job' };
    if (inFlight.has(name)) return { job: name, ran: false, reason: 'already_running' };

    inFlight.add(name);
    // Stamp BEFORE running, not after. A long job (the reply sweep can take
    // minutes) would otherwise still look due to a concurrent external tick.
    await stampLastRun(name, new Date());

    const startedAt = Date.now();
    try {
      const counts = await job.run();
      // A job may report `{ skipped: '<reason>' }` to mean "checked, nothing to
      // do". Quiet jobs don't record those; loud jobs do, so a sweep that keeps
      // finding nothing is still visibly alive.
      const noop = counts && typeof counts === 'object' && counts.skipped;
      if (!(job.quiet && noop)) {
        await recordRun(name, triggeredBy, startedAt, 'ok', counts && typeof counts === 'object' ? counts : null, null);
      }
      return { job: name, ran: true, ok: true, ms: Date.now() - startedAt, counts: counts || null };
    } catch (err) {
      console.error(`[engine] ${name} failed:`, err.message);
      await recordRun(name, triggeredBy, startedAt, 'error', null, err.message);
      return { job: name, ran: true, ok: false, ms: Date.now() - startedAt, error: err.message };
    } finally {
      inFlight.delete(name);
    }
  }

  async function isDue(name) {
    const job = jobs.get(name);
    if (!job) return false;
    if (!job.everyMs) return false;            // cadence 0 = manual-only
    const last = await readLastRun(name);
    if (!last) return true;                    // never run
    return (Date.now() - last.getTime()) >= job.everyMs;
  }

  // The entry point for BOTH the in-process intervals and the external pinger.
  // `only` restricts the pass to one job (used by the manual admin triggers).
  async function runDue({ triggeredBy, only } = {}) {
    const names = only ? [only] : [...jobs.keys()];
    const ran = [];
    const skipped = [];
    for (const name of names) {
      if (!(await isDue(name))) { skipped.push(name); continue; }
      const result = await runJob(name, { triggeredBy });
      // `isDue` can pass and `runJob` still decline — that's the interval and an
      // external ping arriving together, which is exactly the race this module
      // exists to absorb. Report it as skipped, because it is: this caller did
      // not run anything, and saying otherwise would make /cron/tick's output
      // misreport the work done.
      if (result.ran) ran.push(result);
      else skipped.push(name);
    }
    return { ran, skipped, at: new Date().toISOString() };
  }

  // ── the external heartbeat ────────────────────────────────────────────────
  // "Is the pinger reaching us?" and "did the pinger run a job?" are different
  // questions, and the admin card used to answer the first with the second.
  // That reads backwards: runDue only records a run when something is DUE, so a
  // ping arriving during a busy period — when the in-process intervals have
  // already done the work — leaves no trace and looks like a dead heartbeat.
  // The card therefore went red precisely when the app was healthiest and most
  // used. So record the ping itself, on arrival, whether or not it had work.

  async function recordPing(when) {
    try {
      await supabase.from('app_settings').upsert(
        { key: PING_KEY, value: (when || new Date()).toISOString(), updated_at: new Date() },
        { onConflict: 'key' }
      );
    } catch { /* non-fatal — the ping still ran whatever is due */ }
  }

  async function lastPingAt() {
    try {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', PING_KEY).maybeSingle();
      return data && data.value ? data.value : null;
    } catch { return null; }
  }

  // ── introspection (what the UI shows) ─────────────────────────────────────

  async function status() {
    const out = [];
    for (const [name, job] of jobs) {
      const last = await readLastRun(name);
      out.push({
        job: name,
        description: job.description,
        every_ms: job.everyMs,
        last_run_at: last ? last.toISOString() : null,
        overdue: job.everyMs ? (!last || (Date.now() - last.getTime()) >= job.everyMs * 2) : false,
        running: inFlight.has(name)
      });
    }
    return out;
  }

  async function recent(limit = 50) {
    try {
      const { data } = await supabase.from('engine_runs')
        .select('id,job_name,status,triggered_by,started_at,finished_at,duration_ms,counts,error')
        .order('started_at', { ascending: false })
        .limit(Math.min(Number(limit) || 50, 200));
      return data || [];
    } catch { return []; }
  }

  return { register, runJob, runDue, isDue, status, recent, recordPing, lastPingAt, names: () => [...jobs.keys()] };
}

module.exports = { createEngineRunner };
