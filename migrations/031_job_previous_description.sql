-- 031_job_previous_description.sql
-- Additive, safe: keeps the ONE prior job description when a BD replaces a job's
-- JD via "Re-write job description" → "Replace the current job description".
-- The old text stays viewable (a toggle on the job detail) until the job ends.
-- Nullable, no default — nothing breaks with or without this applied.

ALTER TABLE job_orders
  ADD COLUMN IF NOT EXISTS previous_description    TEXT,
  ADD COLUMN IF NOT EXISTS previous_description_at TIMESTAMPTZ;
