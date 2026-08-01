-- 036_candidate_nurture.sql
-- Additive, safe: the columns candidate nurture and candidate sourcing need.
--
-- Two problems this fixes.
--
-- 1. IMPORTED PROFILE URLS ARE THROWN AWAY. `sourcing_candidates` captures
--    `source_url` (the link to the person on whatever board they came from), and
--    `importStagedCandidate()` never maps it onto the candidate. The CSV header
--    map also sends a "LinkedIn" column into `source_url`, so a LinkedIn profile
--    survives staging and is then silently discarded on import — it never
--    reaches `candidates.linkedin_url`. There was simply nowhere general for a
--    profile URL to land, so this adds one.
--
-- 2. RE-IMPORTING DUPLICATES THE STAGING QUEUE. `sourcing_candidates` has no
--    unique constraint, so running the same import twice stages every row again.
--    Existing candidate dedup cannot help: it requires an exact name match AND
--    an email or phone, and externally-sourced people frequently have neither.
--
-- The app runs correctly with or without this migration — the import path checks
-- for the columns once and degrades to today's behaviour if they are absent, so
-- this can be applied after the deploy as usual.

-- ── where a sourced person came from ────────────────────────────────────────
ALTER TABLE candidates
  -- The person's profile on whatever source they came from (a job board, a
  -- portfolio, a public directory). Deliberately general: `linkedin_url` already
  -- exists and stays LinkedIn-specific, but most sources are not LinkedIn.
  ADD COLUMN IF NOT EXISTS profile_url        TEXT,
  -- The id this person had on that source, so a re-import recognises them even
  -- with no email or phone to match on.
  ADD COLUMN IF NOT EXISTS source_external_id TEXT;

-- Provenance lookups: "have we already imported this exact person?"
CREATE INDEX IF NOT EXISTS candidates_profile_url_idx
  ON candidates (profile_url) WHERE deleted_at IS NULL AND profile_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_source_ext_idx
  ON candidates (source, source_external_id) WHERE deleted_at IS NULL AND source_external_id IS NOT NULL;

-- ── stop the staging queue duplicating on re-import ─────────────────────────
-- Partial, because `external_id` is null for hand-uploaded CSV rows and several
-- of those legitimately coexist. Only rows that carry a real source id are
-- constrained.
CREATE UNIQUE INDEX IF NOT EXISTS sourcing_candidates_ext_idx
  ON sourcing_candidates (org_id, provider, external_id)
  WHERE external_id IS NOT NULL;

-- ── candidate nurture bookkeeping ───────────────────────────────────────────
-- When the candidate last answered us. `email_tracking.replied_at` already
-- records it per message, but the candidate grid and any "went quiet" logic need
-- it on the person, without joining every tracked send.
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS last_reply_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_at  TIMESTAMPTZ;
