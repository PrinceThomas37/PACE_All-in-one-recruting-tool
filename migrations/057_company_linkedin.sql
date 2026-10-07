-- ============================================================================
-- 057 — a company's LinkedIn page (R-157, D-0090).
--
-- The owner's add rule (7 Oct 2026): a company already in the system is matched by
-- its WEBSITE, its LINKEDIN page or its NAME — any one is enough — and then the
-- active-job and 30-day rules apply (services/lead-decision.js). The website and
-- name already have columns; the LinkedIn page did not, so that third way of
-- recognising a company had nowhere to look.
--
-- It starts empty. It fills as leads arrive from the Lead Finder (Apollo returns a
-- company's LinkedIn page) and from the lead forms; until a company has one, the
-- website and name matches carry the rule exactly as before.
--
-- Additive only: one nullable column and one index, no row changed. Idempotent:
-- safe to re-run. The code does NOT need this applied to run — until it is, the
-- LinkedIn match simply has nothing to match (services/lead-check.js learns that
-- the column is missing and carries on), which is why it can be applied after the
-- code is live without a window where anything breaks.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- The lookup is "this organisation's companies whose page matches" — one index for exactly that.
CREATE INDEX IF NOT EXISTS companies_linkedin_idx
  ON companies (org_id, lower(linkedin_url))
  WHERE linkedin_url IS NOT NULL AND deleted_at IS NULL;
