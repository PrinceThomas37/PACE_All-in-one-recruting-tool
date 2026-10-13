-- 063 — mailboxes connected with an APP PASSWORD (SMTP to send, IMAP to read) — Zoho and any other provider
-- (owner, 12 Oct 2026, D-0120, R-200 step b). The counterpart of microsoft_tokens / gmail_tokens for a provider that has no
-- OAuth sign-in in PACE: one row per mailbox, holding where its mail servers are and the password ENCRYPTED (AES-256-GCM, key in
-- the server's MAILBOX_SECRET_KEY — the database never holds the password in clear, and never holds the key).
--
-- The health columns have the SAME names as the token tables' (refresh_failed, last_refresh_at, last_refresh_error, updated_at)
-- so mailbox-health.js reads them with the same rule: "the sign-in works" / "needs reconnecting".
--
-- Additive: a new table, nothing existing is changed. Apply BEFORE the code that reads it is merged (the code degrades to
-- "not connected" while the table is missing, never to an error).

CREATE TABLE IF NOT EXISTS smtp_credentials (
  user_email_id       UUID PRIMARY KEY REFERENCES user_emails(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL,
  user_id             UUID,
  email_address       TEXT NOT NULL,
  username            TEXT NOT NULL,
  password_enc        TEXT NOT NULL,            -- 'v1.<iv>.<tag>.<ciphertext>' — see services/mailbox-secret.js
  smtp_host           TEXT NOT NULL,
  smtp_port           INTEGER NOT NULL,
  smtp_secure         BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE = TLS from the first byte (465); FALSE = STARTTLS, required (587)
  imap_host           TEXT NOT NULL,
  imap_port           INTEGER NOT NULL DEFAULT 993,
  provider            TEXT,                     -- 'zoho' | 'google' | 'microsoft' | 'other' (what the setup checklist found)
  last_refresh_at     TIMESTAMPTZ,
  last_refresh_error  TEXT,
  refresh_failed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smtp_credentials_org ON smtp_credentials (org_id);

ALTER TABLE smtp_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_smtp_credentials" ON smtp_credentials;
CREATE POLICY "service_all_smtp_credentials" ON smtp_credentials FOR ALL TO service_role USING (true) WITH CHECK (true);
