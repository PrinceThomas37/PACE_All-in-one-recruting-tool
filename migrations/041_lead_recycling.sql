-- ============================================================================
-- 041_lead_recycling.sql
-- Two columns so a recycled lead can be told apart from a fresh one.
--
-- WHY: leads that sit in 'Assigned' with no reply for too long now get
-- automatically returned to Unassigned for redistribution (services/lead-
-- recycle.js + the `lead_recycle` engine job in index.js). Nothing about
-- this needs new columns to FUNCTION — the sweep only ever writes
-- stage/assigned_to_bd/assigned_at/sending_email_id, all of which already
-- exist. These two are purely visibility: how many times has this lead been
-- round-tripped, and when, so a BD Lead looking at the Unassigned pool (or a
-- future report) can tell a recycled lead from a brand-new one instead of it
-- looking identical.
--
-- SAFE TO APPLY: two nullable/defaulted columns, no backfill needed (every
-- existing row is correctly "never recycled"). Nothing reads them until the
-- sweep runs, so applying this changes no behaviour on its own.
-- ============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recycled_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recycled_at timestamptz;
