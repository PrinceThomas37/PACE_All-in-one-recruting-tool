-- ============================================================================
-- 059  Lead Finder: the form's new choices (owner, 8 Oct 2026, after first live use)
-- ----------------------------------------------------------------------------
--   * "Posted within" becomes a slider from 0 (today) to 30 days. The table only allowed 7, 14 or 30, so a daily search
--     saved at 3 days would be refused by the database. The rule is widened to any whole number from 0 to 30.
--   * Several industries can be picked: `sectors` keeps all of them (`sector` keeps the first, as before).
--   * Companies picked by name: `companies` keeps what the person saw when they chose it — name and where it is — so the
--     saved search can show "Acme Corp, Austin TX" and not a bare website. `domains` stays what Apollo is searched by.
-- Additive and idempotent: safe to re-run; no existing row is changed (every old row already satisfies 0..30, and the new
-- columns start empty).
-- ============================================================================

ALTER TABLE finder_searches DROP CONSTRAINT IF EXISTS finder_searches_posted_days_check;
ALTER TABLE finder_searches ADD CONSTRAINT finder_searches_posted_days_check CHECK (posted_days BETWEEN 0 AND 30);

ALTER TABLE finder_searches ADD COLUMN IF NOT EXISTS sectors   JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE finder_searches ADD COLUMN IF NOT EXISTS companies JSONB NOT NULL DEFAULT '[]'::jsonb;
