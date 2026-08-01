-- 033_engine_runs.sql
-- Additive, safe: a visible record of every background job run.
--
-- Why this exists. Every recurring job in the app (follow-ups, bounce sweep,
-- reply sweep, deferred-send retry, workflow tick, warm-up tick) is a
-- setInterval inside the single Render web process. Render's free tier sleeps
-- that process when nobody is using the app, which silently stops all of them —
-- and nothing anywhere records that they stopped. "Is the engine running?" is
-- currently unanswerable without reading logs.
--
-- This table makes it answerable on screen, which is the precondition for
-- trusting anything automated (see docs/AUTONOMOUS_ENGINE_PLAN.md, Step 0).
--
-- The app runs correctly with or without this migration applied: the runner
-- treats a failed insert as non-fatal and still executes the job, so recording
-- can never be the reason work doesn't happen.

CREATE TABLE IF NOT EXISTS engine_runs (
  id            BIGSERIAL PRIMARY KEY,
  job_name      TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'running',   -- running | ok | error
  triggered_by  TEXT,                                     -- interval | cron | manual | boot
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  counts        JSONB,        -- whatever the job wants to report, e.g. {"fu1_queued":3}
  error         TEXT
);

-- The dashboard read is always "latest runs, newest first", optionally per job.
CREATE INDEX IF NOT EXISTS engine_runs_started_idx  ON engine_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS engine_runs_job_idx      ON engine_runs (job_name, started_at DESC);

-- Deliberately NOT org-scoped: these are platform-level jobs that process every
-- org's work in one pass. Reads are admin-only in the route layer.
