// ============================================================================
// CRON — the external heartbeat.
//
// Render's free tier sleeps the web service when nobody is using the app, which
// silently stops every setInterval in index.js. A free external pinger (GitHub
// Actions / cron-job.org) hitting /cron/tick both wakes the service and runs any
// job that has become due.
//
// Safety: due-ness is persisted in the DB by engine-runs.js, so the pinger and
// the in-process intervals cannot double-run a job — whichever gets there first
// stamps it and the other skips. That means this endpoint is safe to call as
// often as you like.
//
// Auth: a shared secret, NOT a login, because the caller is a machine with no
// session. Set CRON_KEY in the environment. With no key configured the endpoint
// refuses rather than running open to the internet.
// ============================================================================
const express = require('express');

module.exports = (ctx) => {
  const router = express.Router();
  const { runner, auth, hasRole } = ctx;

  // Timing-safe-ish comparison. The secret is low-value (it triggers idempotent
  // background work, exposes nothing), but there's no reason to leak length.
  function keyOk(provided) {
    const expected = process.env.CRON_KEY || '';
    if (!expected) return false;
    const a = String(provided || '');
    if (a.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  // The heartbeat. GET so the simplest possible pinger (curl, a cron service's
  // URL field, a GitHub Action) can call it with no body or headers.
  router.get('/cron/tick', async (req, res) => {
    if (!keyOk(req.query.key)) {
      // 404 rather than 401: an unauthenticated prober learns nothing about
      // whether this endpoint exists or whether a key is configured.
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const result = await runner.runDue({ triggeredBy: 'cron', only: req.query.job || undefined });
      res.json({
        ok: true,
        ran: result.ran.map(r => ({ job: r.job, ok: r.ok, ms: r.ms, counts: r.counts || undefined, error: r.error || undefined })),
        skipped: result.skipped,
        at: result.at
      });
    } catch (err) {
      // Always 200-shaped for the pinger's sake: a non-2xx makes cron services
      // start alerting on transient DB blips. The payload carries the truth.
      res.json({ ok: false, error: err.message });
    }
  });

  // What the admin UI reads: is the engine actually running, and what happened.
  //
  // `cron_configured` only says a key is SET. That is not the same as the
  // heartbeat working — the GitHub Actions secret has to match the Render one,
  // and a mismatch shows up as /cron/tick 404ing, which is invisible from in
  // here. So this also reports whether an external ping has actually arrived
  // recently, which is the thing that is really being asked.
  router.get('/admin/engine/status', auth, async (req, res) => {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Forbidden' });
    try {
      const recent = await runner.recent(req.query.limit || 30);
      const lastCron = recent.find(r => r.triggered_by === 'cron');
      const lastCronAt = lastCron ? lastCron.started_at : null;
      // The heartbeat fires far more often than this; anything older than an
      // hour means it is not arriving, whatever the env var says.
      const heartbeatHealthy = !!lastCronAt && (Date.now() - new Date(lastCronAt).getTime()) < 60 * 60 * 1000;
      res.json({
        jobs: await runner.status(),
        recent,
        cron_configured: Boolean(process.env.CRON_KEY),
        last_cron_ping_at: lastCronAt,
        heartbeat_healthy: heartbeatHealthy,
        server_time: new Date().toISOString(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Force one job now, ignoring its cadence. Admin-only, for when someone wants
  // to see it work rather than wait for the schedule.
  router.post('/admin/engine/run/:job', auth, async (req, res) => {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    try {
      const result = await runner.runJob(req.params.job, { triggeredBy: 'manual' });
      if (result.reason === 'unknown_job') return res.status(404).json({ error: 'unknown_job', jobs: runner.names() });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
