-- ============================================================================
-- 060  Lead Finder: where a saved search looks (owner, 8 Oct 2026, D-0099)
-- ----------------------------------------------------------------------------
-- A saved search can look in Apollo (the company database, spends the organisation's Apollo credits), in the free job
-- sources (a job-search service the organisation has its own key for), or in both. Every existing search stays 'apollo' —
-- exactly what it did before. Additive and idempotent: safe to re-run; no existing row changes meaning.
-- ============================================================================
ALTER TABLE finder_searches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apollo';
ALTER TABLE finder_searches DROP CONSTRAINT IF EXISTS finder_searches_source_check;
ALTER TABLE finder_searches ADD CONSTRAINT finder_searches_source_check CHECK (source IN ('apollo', 'free', 'both'));
