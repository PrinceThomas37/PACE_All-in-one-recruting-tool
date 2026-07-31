-- 035_lead_sources.sql
-- Additive, safe: automated lead sourcing from free, ToS-clean employer job
-- boards, plus the staging queue a human reviews before anything is contacted.
--
-- Context (docs/AUTONOMOUS_ENGINE_PLAN.md, Step 2). Today every lead in the
-- system was typed in by a person or uploaded as a spreadsheet — there is no
-- automated ingestion of any kind. This adds it, targeting END CLIENTS hiring
-- directly (the owner's explicit choice), which is exactly what the free
-- employer ATS boards publish: a company running its own hiring, listing its own
-- open reqs as JSON.
--
-- Nothing here writes to `jobs`. Sourced postings land in `sourced_jobs_raw` and
-- only become real leads when someone approves them, so bad data can never reach
-- the outreach engine on its own.
--
-- The app runs correctly with or without this migration: the ingest job reports
-- that sourcing is unconfigured and does nothing.

-- ── where to look ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID,
  provider      TEXT        NOT NULL,        -- greenhouse | lever | ashby | workable | smartrecruiters | recruitee
  -- The employer's board identifier on that provider (Greenhouse calls it a
  -- board token, Lever a site name). One row = one company's board.
  board_token   TEXT        NOT NULL,
  company_name  TEXT,                        -- display name; the feed often carries it too
  company_domain TEXT,                       -- used for POC email-pattern inference
  -- Optional narrowing so a source doesn't drag in every req a company has.
  filters       JSONB,                       -- { titles:[], locations:[], departments:[], exclude_titles:[] }
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  every_hours   INTEGER     NOT NULL DEFAULT 24,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,                        -- ok | error
  last_error    TEXT,
  last_found    INTEGER,                     -- postings seen on the last run
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- One row per company board per org. Re-adding the same board updates it.
CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_unique_idx
  ON lead_sources (org_id, provider, board_token) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_sources_due_idx ON lead_sources (active, last_run_at);

-- ── what was found, before a human has looked at it ─────────────────────────
CREATE TABLE IF NOT EXISTS sourced_jobs_raw (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID,
  lead_source_id  UUID,
  provider        TEXT,
  external_id     TEXT,                      -- the posting's id on the source
  -- Hash of the identity-bearing fields (company + title + location). This is
  -- what stops the same req being re-staged every single day, which would make
  -- the review queue useless within a week.
  content_hash    TEXT        NOT NULL,

  company_name    TEXT,
  company_domain  TEXT,
  title           TEXT,
  location        TEXT,
  city            TEXT,
  state           TEXT,
  country         TEXT,
  remote          BOOLEAN,
  department      TEXT,
  description     TEXT,
  url             TEXT,
  posted_at       TIMESTAMPTZ,

  -- Rule-based enrichment, all computed from data the feed already gave us.
  parsed          JSONB,      -- jd-parser output: skills, salary, seniority
  hiring_reason   JSONB,      -- { category, confidence, headline, signals[] }
  company_kind    TEXT,       -- end_client | staffing_firm | unknown
  company_kind_why TEXT,
  contacts        JSONB,      -- inferred POCs: [{name,title,email,confidence,method}]

  -- new: never seen · duplicate: matches an existing lead or a prior staging row
  -- promoted: approved and turned into a real lead · rejected: dismissed
  status          TEXT        NOT NULL DEFAULT 'new',
  dup_job_id      UUID,       -- the existing jobs row it duplicates, if any
  promoted_job_id UUID,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  -- How many ingest runs this posting has appeared in. This means "still open",
  -- NOT "reposted" — a posting that simply stays up appears every run.
  seen_count      INTEGER     NOT NULL DEFAULT 1,
  -- A genuine repost: the feed's own publish date moved forward for a posting we
  -- already knew about, which is what an ATS does when a req is relisted. This
  -- is the signal behind "open 74 days and reposted twice" — the strongest cold
  -- opener a staffing desk has — so it is tracked separately and honestly.
  repost_count    INTEGER     NOT NULL DEFAULT 0,
  first_posted_at TIMESTAMPTZ,               -- earliest publish date we ever saw
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sourced_jobs_hash_idx
  ON sourced_jobs_raw (org_id, content_hash);
CREATE INDEX IF NOT EXISTS sourced_jobs_status_idx
  ON sourced_jobs_raw (org_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS sourced_jobs_source_idx ON sourced_jobs_raw (lead_source_id);

-- ── paid-lookup cache ───────────────────────────────────────────────────────
-- Contact enrichment is the one genuinely metered cost in this plan (Hunter's
-- free tier is 25 domain searches a month). Its most valuable answer is the
-- EMAIL PATTERN for a domain — learn it once and every future person at that
-- company is free. Cached by domain so we never spend the same credit twice.
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain       TEXT        NOT NULL,
  kind         TEXT        NOT NULL DEFAULT 'email_pattern',
  value        JSONB,
  provider     TEXT,                          -- pattern_inference | hunter | apollo
  confidence   NUMERIC,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS enrichment_cache_key_idx ON enrichment_cache (domain, kind);

-- ── how an org sources ──────────────────────────────────────────────────────
-- manual (today's behaviour, unchanged) | auto | hybrid. Defaulting to 'manual'
-- means applying this migration changes nothing until someone opts in.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ra_mode TEXT NOT NULL DEFAULT 'manual';
