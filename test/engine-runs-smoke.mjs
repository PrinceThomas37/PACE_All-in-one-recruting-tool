// Unit test for engine-runs.js — the scheduler that keeps background work
// running when Render's free tier sleeps the web service.
//
// The whole point of this module is that TWO things drive the same jobs (the
// in-process interval and an external /cron/tick ping) and neither may ever
// double-run one. That property is what these tests exist to prove; everything
// else is secondary.
//
// Usage: node test/engine-runs-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createEngineRunner } = require('../engine-runs.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── A fake Supabase good enough for this module ──────────────────────────────
// It only ever touches two tables: app_settings (key/value, upsert on key) and
// engine_runs (insert-only). `failTable` lets us simulate the migration not
// being applied yet.
function fakeSupabase({ failTable } = {}) {
  const settings = new Map();
  const runs = [];

  function from(table) {
    if (table === failTable) {
      const boom = () => { throw new Error(`relation "${table}" does not exist`); };
      return {
        select: () => ({ eq: () => ({ maybeSingle: boom }), order: () => ({ limit: boom }) }),
        insert: boom,
        upsert: boom
      };
    }
    if (table === 'app_settings') {
      return {
        select: () => ({
          eq: (_c, key) => ({ maybeSingle: async () => ({ data: settings.has(key) ? { value: settings.get(key) } : null }) })
        }),
        upsert: async (row) => { settings.set(row.key, row.value); return { data: null }; }
      };
    }
    if (table === 'engine_runs') {
      return {
        insert: async (row) => { runs.push(row); return { data: null }; },
        select: () => ({ order: () => ({ limit: async (n) => ({ data: runs.slice(0, n) }) }) })
      };
    }
    throw new Error('unexpected table ' + table);
  }

  return { client: { from }, settings, runs };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1. A due job runs; an un-due job is skipped ──────────────────────────────
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  let calls = 0;
  runner.register('sweep', { everyMs: 60_000, run: async () => { calls++; return { found: 3 }; } });

  const first = await runner.runDue({ triggeredBy: 'cron' });
  ok('a never-run job is due and runs', calls === 1 && first.ran.length === 1, `calls=${calls}`);

  const second = await runner.runDue({ triggeredBy: 'cron' });
  ok('the same job is skipped immediately after', calls === 1 && second.skipped.includes('sweep'), `calls=${calls}`);

  ok('the run was recorded with its counts',
    fake.runs.length === 1 && fake.runs[0].job_name === 'sweep' && fake.runs[0].counts.found === 3,
    JSON.stringify(fake.runs));
  ok('the recorded run carries who triggered it', fake.runs[0].triggered_by === 'cron', fake.runs[0].triggered_by);
}

// ── 2. THE CRITICAL ONE: interval + external ping cannot double-run ──────────
// Simulates the real race — a slow job (like the reply sweep, which can take
// minutes) already running when the external pinger arrives.
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  let calls = 0;
  runner.register('slow', {
    everyMs: 60_000,
    run: async () => { calls++; await sleep(60); return { done: true }; }
  });

  // Fire both at once, exactly as the interval and the pinger would.
  const [a, b] = await Promise.all([
    runner.runDue({ triggeredBy: 'interval' }),
    runner.runDue({ triggeredBy: 'cron' })
  ]);

  ok('concurrent interval + cron ticks run the job exactly once', calls === 1, `calls=${calls}`);
  const ranCount = a.ran.length + b.ran.length;
  ok('only one of the two ticks reports having run it', ranCount === 1, `ran=${ranCount}`);
  ok('only one run row was recorded', fake.runs.length === 1, `rows=${fake.runs.length}`);
}

// ── 3. Due-ness survives a restart (it lives in the DB, not a timer) ─────────
{
  const fake = fakeSupabase();
  let calls = 0;
  const mk = () => {
    const r = createEngineRunner({ supabase: fake.client });
    r.register('job', { everyMs: 60_000, run: async () => { calls++; } });
    return r;
  };

  await mk().runDue({ triggeredBy: 'boot' });      // process 1 runs it
  await mk().runDue({ triggeredBy: 'boot' });      // process 2 (a redeploy) must not
  ok('a restarted process does not re-run a job that just ran', calls === 1, `calls=${calls}`);
}

// ── 4. A throwing job is contained and recorded, and doesn't stop the others ─
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  let goodRan = false;
  runner.register('bad', { everyMs: 1000, run: async () => { throw new Error('graph exploded'); } });
  runner.register('good', { everyMs: 1000, run: async () => { goodRan = true; } });

  const origError = console.error; console.error = () => {};
  const res = await runner.runDue({ triggeredBy: 'cron' });
  console.error = origError;

  ok('a failing job does not prevent the next job running', goodRan === true);
  ok('the failure is reported, not thrown', res.ran.some(r => r.job === 'bad' && r.ok === false));
  const errRow = fake.runs.find(r => r.job_name === 'bad');
  ok('the failure is recorded with its message',
    errRow && errRow.status === 'error' && /graph exploded/.test(errRow.error), JSON.stringify(errRow));
}

// ── 5. Recording is best-effort: no engine_runs table must not stop work ─────
// This matters because the migration is applied to the live DB *after* deploy.
{
  const fake = fakeSupabase({ failTable: 'engine_runs' });
  const runner = createEngineRunner({ supabase: fake.client });
  let calls = 0;
  runner.register('job', { everyMs: 1000, run: async () => { calls++; return { fine: true }; } });

  let threw = false;
  try { await runner.runDue({ triggeredBy: 'cron' }); } catch { threw = true; }
  ok('the job still runs when engine_runs is missing', calls === 1 && !threw, `calls=${calls} threw=${threw}`);
}

// ── 6. Quiet jobs don't spam the log with no-ops ─────────────────────────────
// The daily follow-up check is polled every few minutes but fires once a day.
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  runner.register('daily', { everyMs: 1, quiet: true, run: async () => ({ skipped: 'before_send_time' }) });
  runner.register('loud',  { everyMs: 1, run: async () => ({ skipped: 'nothing_to_do' }) });

  await runner.runDue({ triggeredBy: 'cron' });
  await sleep(5);
  await runner.runDue({ triggeredBy: 'cron' });

  ok('a quiet job reporting "skipped" records nothing',
    fake.runs.filter(r => r.job_name === 'daily').length === 0,
    `rows=${fake.runs.filter(r => r.job_name === 'daily').length}`);
  ok('a normal job still records so it is visibly alive',
    fake.runs.filter(r => r.job_name === 'loud').length === 2,
    `rows=${fake.runs.filter(r => r.job_name === 'loud').length}`);
}

// ── 7. runJob forces a job regardless of cadence; unknown names are reported ─
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  let calls = 0;
  runner.register('job', { everyMs: 60_000, run: async () => { calls++; } });

  await runner.runDue({ triggeredBy: 'cron' });        // now not due
  await runner.runJob('job', { triggeredBy: 'manual' });
  ok('runJob ignores the cadence (the admin "run now" button)', calls === 2, `calls=${calls}`);

  const unknown = await runner.runJob('nope', {});
  ok('an unknown job name is reported, not thrown', unknown.reason === 'unknown_job', JSON.stringify(unknown));
}

// ── 8. status() tells the UI what it needs ───────────────────────────────────
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  runner.register('a', { everyMs: 60_000, description: 'does a thing', run: async () => {} });

  const before = await runner.status();
  ok('a never-run job is flagged overdue', before[0].overdue === true && before[0].last_run_at === null);

  await runner.runDue({ triggeredBy: 'cron' });
  const after = await runner.status();
  ok('after running it is no longer overdue and carries a timestamp',
    after[0].overdue === false && typeof after[0].last_run_at === 'string');
  ok('status carries the description for the UI', after[0].description === 'does a thing');
  ok('names() lists every registered job', runner.names().join(',') === 'a');
}

// ── 8b. The ping timestamp is stored apart from the job timestamps ───────────
// It has to be a separate fact: a ping that finds nothing due runs no job, so
// recording it through a job stamp would make a quiet, healthy period look like
// a dead pinger.
{
  const fake = fakeSupabase();
  const runner = createEngineRunner({ supabase: fake.client });
  runner.register('a', { everyMs: 60_000, description: 'does a thing', run: async () => {} });

  ok('no ping recorded yet reads as null', (await runner.lastPingAt()) === null);

  await runner.recordPing();
  const first = await runner.lastPingAt();
  ok('recordPing stores a timestamp', typeof first === 'string' && !Number.isNaN(Date.parse(first)));

  await runner.recordPing(new Date('2026-01-02T03:04:05.000Z'));
  ok('recordPing overwrites rather than accumulating',
    (await runner.lastPingAt()) === '2026-01-02T03:04:05.000Z');

  // The ping key must not masquerade as a job, or it would show up in the card's
  // job list and could make a job look recently run.
  ok('the ping is not stored under the job prefix, and invents no job',
    (await runner.status()).length === 1 && runner.names().join(',') === 'a');

  // Recording a ping must never be able to stop the work it precedes.
  const broken = fakeSupabase({ failTable: 'app_settings' });
  const brittle = createEngineRunner({ supabase: broken.client });
  let ranAnyway = false;
  brittle.register('b', { everyMs: 60_000, run: async () => { ranAnyway = true; } });
  await brittle.recordPing();
  await brittle.runDue({ triggeredBy: 'cron' });
  ok('a failed ping write is swallowed and the jobs still run', ranAnyway === true);
}

// ── 9. The /cron/tick endpoint itself ────────────────────────────────────────
// This is the contract an external pinger depends on, so exercise the real
// router rather than trusting it. A stub runner keeps the DB out of it.
{
  const express = require('express');
  const makeCronRoutes = require('../routes/cron.js');

  const calls = [];
  const pings = [];
  let recentRows = [];
  let storedPing = null;
  const stubRunner = {
    runDue: async (opts) => { calls.push(opts); return { ran: [{ job: 'sweep', ok: true, ms: 12, counts: { found: 2 } }], skipped: ['wf_tick'], at: 'now' }; },
    runJob: async (name) => (name === 'sweep' ? { job: name, ran: true, ok: true } : { job: name, ran: false, reason: 'unknown_job' }),
    status: async () => [{ job: 'sweep' }],
    recent: async () => recentRows,
    recordPing: async () => { pings.push(Date.now()); storedPing = new Date().toISOString(); },
    lastPingAt: async () => storedPing,
    names: () => ['sweep']
  };
  // Minimal auth stubs matching index.js's real shapes.
  const auth = (req, _res, next) => { req.user = { id: 'u1', role: 'admin', roles: ['admin'] }; next(); };
  const hasRole = (req, ...roles) => roles.some(r => (req.user.roles || []).includes(r));

  const app = express();
  app.use(express.json());
  app.use(makeCronRoutes({ runner: stubRunner, auth, hasRole }));

  const server = await new Promise(res => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => { const r = await fetch(base + path); return { code: r.status, body: await r.json().catch(() => null) }; };

  const prevKey = process.env.CRON_KEY;

  // With no CRON_KEY configured the endpoint must stay shut, not run open.
  delete process.env.CRON_KEY;
  ok('tick is closed when no CRON_KEY is configured', (await get('/cron/tick?key=anything')).code === 404);

  process.env.CRON_KEY = 'sekret';
  ok('tick rejects a wrong key', (await get('/cron/tick?key=nope')).code === 404);
  ok('tick rejects a missing key', (await get('/cron/tick')).code === 404);
  // A prefix must not pass — guards against a sloppy startsWith comparison.
  ok('tick rejects a key prefix', (await get('/cron/tick?key=sek')).code === 404);

  const good = await get('/cron/tick?key=sekret');
  ok('tick accepts the right key', good.code === 200 && good.body.ok === true, JSON.stringify(good.body));
  ok('tick reports what ran, with counts',
    good.body.ran[0].job === 'sweep' && good.body.ran[0].counts.found === 2, JSON.stringify(good.body.ran));
  ok('tick reports what was skipped', good.body.skipped.includes('wf_tick'));
  ok('tick tells the runner it was cron-triggered', calls[calls.length - 1].triggeredBy === 'cron');

  await get('/cron/tick?key=sekret&job=sweep');
  ok('tick passes a ?job= filter through', calls[calls.length - 1].only === 'sweep');

  const unknown = await fetch(base + '/admin/engine/run/nope', { method: 'POST' });
  ok('running an unknown job returns 404 with the valid names', unknown.status === 404);

  // ── the heartbeat signal ──────────────────────────────────────────────────
  // The admin card must answer "is the pinger reaching us", not "did the pinger
  // run a job". Those come apart whenever the app is awake: the in-process
  // intervals get to the due jobs first, the ping finds nothing to do, and the
  // old signal — the last cron-TRIGGERED job run — goes stale on a perfectly
  // healthy system. That is the false alarm this pins.
  const pingsBefore = pings.length;
  await get('/cron/tick?key=sekret');
  ok('every accepted tick records the ping itself', pings.length === pingsBefore + 1);

  const rejected = pings.length;
  await get('/cron/tick?key=nope');
  ok('a rejected tick records nothing', pings.length === rejected);

  // A ping that finds nothing due writes no engine_runs row at all...
  recentRows = [];
  const quiet = await get('/admin/engine/status');
  ok('...and the engine still reports healthy', quiet.body.heartbeat_healthy === true, JSON.stringify(quiet.body.last_cron_ping_at));
  ok('the reported heartbeat time is the ping, not a job run',
    quiet.body.last_cron_ping_at === storedPing && quiet.body.last_cron_job_run_at === null);

  // Jobs running under the in-process interval are not evidence either way.
  recentRows = [{ triggered_by: 'interval', started_at: new Date().toISOString() }];
  const intervalOnly = await get('/admin/engine/status');
  ok('an interval-run job is not mistaken for a heartbeat',
    intervalOnly.body.heartbeat_healthy === true && intervalOnly.body.last_cron_job_run_at === null);

  // A genuinely stale ping is still reported as stale — the alarm has to work.
  storedPing = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const stale = await get('/admin/engine/status');
  ok('a three-hour-old ping reads as unhealthy', stale.body.heartbeat_healthy === false);

  // A server not yet pinged since this shipped falls back to the old signal,
  // so the card does not claim a dead engine for the first half hour.
  storedPing = null;
  recentRows = [{ triggered_by: 'cron', started_at: new Date().toISOString() }];
  const fallback = await get('/admin/engine/status');
  ok('with no ping recorded yet it falls back to the last cron-run job',
    fallback.body.heartbeat_healthy === true && fallback.body.last_cron_ping_at === recentRows[0].started_at);

  storedPing = null; recentRows = [];
  const nothing = await get('/admin/engine/status');
  ok('no ping and no cron run is genuinely unhealthy',
    nothing.body.heartbeat_healthy === false && nothing.body.last_cron_ping_at === null);

  if (prevKey === undefined) delete process.env.CRON_KEY; else process.env.CRON_KEY = prevKey;
  server.close();
}

console.log('\n=== ENGINE RUNS SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
