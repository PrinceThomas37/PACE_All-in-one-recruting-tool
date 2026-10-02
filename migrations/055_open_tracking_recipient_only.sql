-- ============================================================================
-- 055 — open tracking that counts the RECIPIENT's opens, and reaches leads
-- emails (R-110, D-0068).
--
-- The owner (2026-10-02): "the email should only be tracked if the to address
-- opens the email, not us." The pixel used to count every request for the
-- image — the sender reading their Sent folder, a scanner on arrival, Apple
-- Mail pre-loading. services/open-tracking.js now sorts each hit; only a
-- recipient-looking one moves `open_count` / `opened_at` / `last_open_at`
-- (so every existing reader of those columns becomes recipient-only at once).
-- The rest are tallied here so nothing is silently thrown away:
--
--   ignored_open_count   hits judged to be the sender, a scanner, or too early
--   last_ignored_reason  'sender' | 'machine' | 'early' — for diagnosing a
--                        complaint like "my real open was not counted"
--
-- And a leads-engine email can now carry a pixel, so its tracking row must say
-- which email and which contact it belongs to (`lead_id` already exists):
--
--   email_id    emails.id        — one tracking row per leads email
--   contact_id  contacts.id      — the person it went to
--
-- Additive only: four nullable/defaulted columns and one index. No row
-- changes, nothing dropped. Idempotent: safe to re-run. Apply BEFORE the code
-- that uses it is merged (the pixel route writes the two ignored_* columns).
-- ============================================================================

ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS email_id            uuid;
ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS contact_id          uuid;
ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS ignored_open_count  integer NOT NULL DEFAULT 0;
ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS last_ignored_reason text;

CREATE INDEX IF NOT EXISTS idx_email_tracking_email ON email_tracking (email_id);
