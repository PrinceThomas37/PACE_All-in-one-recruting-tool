-- R-340 / R-363 (owner, 3 Nov 2026: "start recording who assigned a lead, it should come in lead history").
-- WHO handed a lead to its current owner. NULL = not recorded (every lead assigned before this migration, except the ones below).
-- Safe to run twice. ON DELETE SET NULL: removing a person never removes a lead.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- "the leads I assigned" (an RA Lead's view): small partial index, only owned-and-attributed rows.
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_by ON jobs (org_id, assigned_by) WHERE assigned_by IS NOT NULL;

-- Backfill ONLY what the history proves: a lead that became its owner's when the owner wrote the first email ('first_email_claim')
-- was assigned BY that same person. Everything else (the other ~3,000 leads) has no record of who assigned it and stays NULL —
-- nothing is guessed.
UPDATE jobs j SET assigned_by = a.user_id
FROM (SELECT DISTINCT ON (job_id) job_id, user_id FROM activity_log
      WHERE action_type = 'first_email_claim' AND user_id IS NOT NULL ORDER BY job_id, created_at DESC) a
WHERE j.id = a.job_id AND j.assigned_to_bd IS NOT NULL AND j.assigned_by IS NULL AND a.user_id = j.assigned_to_bd;
