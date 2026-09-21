-- ============================================================================
-- 044 — The public apply page
--
-- A job order can be PUBLISHED, which mints a random token and turns on a
-- public page at /apply/<token>. Someone fills it in, their resume is parsed,
-- and they land in `sourcing_candidates` — the same inert staging table the CSV
-- import already uses. Nothing reaches the real candidate database until a
-- recruiter reviews and imports, exactly as with every other source.
--
-- WHY A RANDOM TOKEN AND NOT job_code. `JO-0041` is guessable, so a token
-- derived from it would let anyone walk the whole list of what a customer is
-- hiring for — including the roles they have not published. Same reasoning as
-- the candidate answer page's track_token: the id is the secret.
--
-- OFF BY DEFAULT. apply_enabled is false for every existing row. Publishing a
-- customer's job to the open internet is a decision somebody makes on purpose,
-- never a migration's side effect.
--
-- Additive and idempotent.
-- ============================================================================

ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS apply_token        TEXT;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS apply_enabled      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS apply_published_at TIMESTAMPTZ;
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS apply_count        INTEGER NOT NULL DEFAULT 0;

-- The token is the lookup key for every hit on the public page, and it must be
-- unique across the whole platform (the page has no org context until this row
-- resolves one). Partial, so the many unpublished rows do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS job_orders_apply_token_idx
  ON job_orders (apply_token) WHERE apply_token IS NOT NULL;

-- An applicant arrives with no account and no recruiter, so `created_by` is
-- null on these rows — the existing column already allows it. What we do need
-- is a cheap way to find them: the review queue filters by provider='apply'.
CREATE INDEX IF NOT EXISTS sourcing_candidates_org_provider_idx
  ON sourcing_candidates (org_id, provider, status);
