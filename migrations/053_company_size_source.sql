-- ============================================================================
-- 053 — where a company's size came from, and what Apollo said (R-053).
--
-- The owner (2026-09-28): "make apollo search for employee size using company
-- name and website". Apollo's Organization Enrichment returns an employee
-- ESTIMATE for a website (1 credit when found, 0 when not). PACE turns it into
-- the size band the POC finder already uses (051's `size_band`) and keeps:
--
--   employee_count  — Apollo's estimate, shown beside the band ("about 35");
--   size_source     — 'manual' (somebody picked it) or 'apollo'. A size picked
--                     by hand is never overwritten by Apollo;
--   size_checked_at — when Apollo was last asked, so a company Apollo does
--                     not know is not asked (or paid for) again on every click;
--   apollo_org_id   — Apollo's own id for the company, so a later feature
--                     (its open job postings, say) need not pay to find it again.
--
-- Additive only: four nullable columns, no row changed (no company has a size
-- yet — 0 of 82 on 2026-09-28). Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_count  INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS size_source     TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS size_checked_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS apollo_org_id   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_employee_count_check') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_employee_count_check
      CHECK (employee_count IS NULL OR employee_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_size_source_check') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_size_source_check
      CHECK (size_source IS NULL OR size_source IN ('manual', 'apollo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_apollo_org_id_check') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_apollo_org_id_check
      CHECK (apollo_org_id IS NULL OR char_length(apollo_org_id) <= 100);
  END IF;
END $$;
