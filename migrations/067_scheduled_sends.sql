-- 067 — SCHEDULE SEND in the in-app mailbox (owner, 19 Oct 2026, R-273, D-0162 / D-0163).
-- A New message, Reply or Forward written now and sent at a date and time the person picks (in THEIR time zone, which is kept
-- so the screen can show it back the way they chose it). One row per scheduled email; the engine sends the due ones through the
-- same send path as the Send button (services/mailbox-send.js), from the mailbox that was chosen.
--
-- status: scheduled → sending → sent | failed;  scheduled → cancelled (the person cancelled it).
--   'sending' is CLAIMED atomically before the send, so two ticks never send one email twice. A row left at 'sending' by a
--   process that died mid-send is moved to 'failed' at boot ("check your Sent folder before trying again") — never re-sent,
--   because nobody can know whether it went (the same rule as the outreach queue).
-- payload: what the window held — to, cc, subject, body, formatted, include_signature, reply_all, label_ids, attachments
--   (base64, ≤3.5 MB, the same cap as Send). Attachments are removed from the row once the email is sent or cancelled.
--
-- Additive: a new table, nothing existing changes. Apply BEFORE the code that uses it is merged (owner's go-ahead: D-0163,
-- "Yes, add it at release").

CREATE TABLE IF NOT EXISTS scheduled_sends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  user_id     UUID NOT NULL,
  mailbox_id  UUID NOT NULL REFERENCES user_emails(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('new', 'reply', 'forward')),
  message_id  TEXT,                         -- the provider's id of the email a reply / forward answers
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  send_at     TIMESTAMPTZ NOT NULL,
  timezone    TEXT,                         -- the scheduler's own zone, e.g. 'America/Chicago'
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_sends_due ON scheduled_sends (status, send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_sends_user ON scheduled_sends (org_id, user_id, status);

ALTER TABLE scheduled_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_scheduled_sends" ON scheduled_sends;
CREATE POLICY "service_all_scheduled_sends" ON scheduled_sends FOR ALL TO service_role USING (true) WITH CHECK (true);
