-- 062 — up to FIVE follow-ups, the person's choice (owner, 8 Oct 2026, D-0113).
-- Additive and nullable: a row that has only follow-ups 1 and 2 keeps working exactly as before (3–5 stay null = "never scheduled").
-- Apply BEFORE the code that reads these columns is merged.
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS followup3_due_date date,
  ADD COLUMN IF NOT EXISTS followup3_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS followup4_due_date date,
  ADD COLUMN IF NOT EXISTS followup4_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS followup5_due_date date,
  ADD COLUMN IF NOT EXISTS followup5_sent_at  timestamptz;
