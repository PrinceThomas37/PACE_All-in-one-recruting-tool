-- ============================================================================
-- 046 — emails remember why they failed, and when they will try again
--
-- Until now every send failure wrote status='failed' and nothing ever read it
-- back: no retry, by hand or automatic, and the reason lived only in an
-- in-memory progress card that died with the process (C-0004, R-004).
-- Measured live 2026-09-23: two emails failed "sign-in expired" while three
-- more from the SAME mailbox sent minutes later — a passing hiccup, lost.
--
-- services/send-retry.js decides; these columns only hold its answer:
--   attempt_count    sends tried so far (0 = never tried, or reset by a person)
--   next_attempt_at  a pending row is not due before this (NULL = due now)
--   fail_kind        temporary | permanent | needs_fix | uncertain
--   fail_reason      the plain-English sentence shown on the Email page
--
-- All nullable / defaulted, so the send loop works before and after this is
-- applied (it falls back to plain 'failed' when the columns are absent).
-- No new table, so models/tables.js is unchanged.
-- ============================================================================

ALTER TABLE emails ADD COLUMN IF NOT EXISTS attempt_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS fail_kind       TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS fail_reason     TEXT;

-- The Email page lists failed rows per sender.
CREATE INDEX IF NOT EXISTS idx_emails_failed_by_sender ON emails (sent_by) WHERE status = 'failed';
