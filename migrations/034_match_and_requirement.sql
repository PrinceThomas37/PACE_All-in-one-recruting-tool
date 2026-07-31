-- 034_match_and_requirement.sql
-- Additive, safe: persisted candidate↔job match scores, and the normalized
-- "requirement" object that both sourcing branches will search against.
--
-- Why persist scores at all. Ranking a whole candidate pool against a job means
-- scoring every candidate. Today's analytics already pull entire tables and
-- reduce them in JS, which is the app's main scaling weak spot; recomputing the
-- pool on every page view would make that worse. Scores are cheap to compute but
-- pointless to recompute when neither side changed, so they are cached here and
-- invalidated by engine_version.
--
-- The app runs correctly with or without this migration: match-engine.js scores
-- in memory, and the read endpoints fall back to computing on the fly when the
-- cache table is absent or empty. Applying it makes ranking fast, not possible.

-- ── the normalized requirement, one per job order ───────────────────────────
-- JSONB rather than columns, mirroring the existing jobs.research pattern: the
-- shape will grow as the sourcing branches learn what they need, and we would
-- rather not migrate a table each time.
ALTER TABLE job_orders
  ADD COLUMN IF NOT EXISTS requirement     JSONB,
  ADD COLUMN IF NOT EXISTS requirement_at  TIMESTAMPTZ,
  -- Records where primary/secondary skills came from, so a human's typed skills
  -- are never silently overwritten by the parser on a later save.
  ADD COLUMN IF NOT EXISTS skills_source   TEXT;

-- ── cached scores ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_scores (
  id             BIGSERIAL PRIMARY KEY,
  org_id         UUID,
  candidate_id   UUID        NOT NULL,
  job_order_id   UUID        NOT NULL,
  score          INTEGER,                 -- NULL = not enough detail to score
  band           TEXT,                    -- strong | good | fair | low | none
  reasons        JSONB,                   -- the plain-English "why", shown on hover
  engine_version INTEGER     NOT NULL DEFAULT 1,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One cached score per pair. Recomputing upserts rather than accumulating rows.
CREATE UNIQUE INDEX IF NOT EXISTS match_scores_pair_idx
  ON match_scores (candidate_id, job_order_id);

-- The dominant read: "rank this job's pool", best first.
CREATE INDEX IF NOT EXISTS match_scores_job_idx
  ON match_scores (job_order_id, score DESC NULLS LAST);

-- The inverse read, for later: "which jobs suit this candidate".
CREATE INDEX IF NOT EXISTS match_scores_candidate_idx
  ON match_scores (candidate_id, score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS match_scores_org_idx ON match_scores (org_id);
