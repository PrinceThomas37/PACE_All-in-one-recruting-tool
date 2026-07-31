-- 032: submission stage vocabulary consolidation
--
--   "Confirmation"              → "Joining"
--   "Rejected" + "Not Joined"   → "Not Accepted"   (the reason lives on sub_stage)
--
-- The application already normalizes these names on both read and write
-- (normalizeStage() in bd_recruiter_routes.js + public/js/33-stage-modal.js), so
-- the app behaves correctly whether or not this migration has run. This is a
-- one-time cleanup that rewrites the stored values so the raw data matches the
-- vocabulary. It is idempotent and safe to re-run.
--
-- ⚠️  HELD BY OWNER DECISION — this touches the live `submissions` table.
--     Apply it only with a fresh, explicit go-ahead. Until then the app runs
--     fine on the old stored values thanks to normalizeStage().

BEGIN;

UPDATE submissions SET stage = 'Joining'      WHERE stage = 'Confirmation';
UPDATE submissions SET stage = 'Not Accepted' WHERE stage IN ('Rejected', 'Not Joined');

-- Keep the candidate lifecycle history (stage-move audit log) consistent.
UPDATE submission_activity SET old_stage = 'Joining'      WHERE old_stage = 'Confirmation';
UPDATE submission_activity SET old_stage = 'Not Accepted' WHERE old_stage IN ('Rejected', 'Not Joined');
UPDATE submission_activity SET new_stage = 'Joining'      WHERE new_stage = 'Confirmation';
UPDATE submission_activity SET new_stage = 'Not Accepted' WHERE new_stage IN ('Rejected', 'Not Joined');

COMMIT;
