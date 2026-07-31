-- 030_mailbox_refresh_health.sql
-- Additive, safe: records the outcome of each OAuth token refresh so a stuck
-- sending mailbox (failing refresh = can't send) is diagnosable and visible in
-- the UI, instead of only surfacing when someone tries to send.
--
-- All columns are nullable with no default change, so nothing breaks and the app
-- runs correctly with or without this migration applied (the mailbox-health
-- helper falls back to inferring status from expires_at/updated_at).

ALTER TABLE microsoft_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_error TEXT,
  ADD COLUMN IF NOT EXISTS refresh_failed     BOOLEAN;

ALTER TABLE gmail_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_error TEXT,
  ADD COLUMN IF NOT EXISTS refresh_failed     BOOLEAN;
