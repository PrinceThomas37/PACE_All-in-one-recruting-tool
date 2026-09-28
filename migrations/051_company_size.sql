-- 051 — a company's size, picked on the lead (R-053, D-0049).
--
-- The POC finder decides WHO to look for at a company from its size — the
-- owner's table: under 20 the owner hires; 20-50 the head of the job's
-- function; 50-200 the department head; 200+ the function's manager and
-- director; 1,000+ the HR pair becomes talent acquisition
-- (docs/CONTACT_FINDER_DESIGN.md §4). Nothing held a company's size anywhere
-- (checked 2026-09-27), and the owner chose a one-click pick on the lead,
-- remembered for the company (D-0049).
--
-- Nullable on purpose: unknown is the normal state until somebody picks, and
-- the rules assume "20-50" meanwhile (services/poc-targets.js DEFAULT_SIZE).
-- The five values are the ONE list in services/poc-targets.js SIZE_IDS; the
-- check keeps a typo out of the table. Additive only — no row changes.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS size_band TEXT;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_size_band_check;
ALTER TABLE companies ADD CONSTRAINT companies_size_band_check
  CHECK (size_band IS NULL OR size_band IN ('1-20', '21-50', '51-200', '201-1000', '1000+'));
