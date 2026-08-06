-- 041_conversation_summaries.sql
-- The running-summary + AI-signal store the conversation-ai.js seam needs.
--
-- WHY
-- conversation-ai.js can already extract structured signals from a message
-- and roll them into an updated running summary — but has nowhere to persist
-- either one. Without this table, every AI call would start from a blank
-- summary, which defeats the point (the blueprint this was designed against
-- sends ONLY the new message + the running summary to the model, never full
-- history, specifically to keep token cost small — that only works if the
-- summary survives between calls).
--
-- DARK UNTIL A KEY IS FUNDED
-- conversation-ai.isConfigured() is false with no ANTHROPIC_API_KEY set, so
-- nothing writes to this table today. Purely additive and safe to apply
-- regardless — same posture as 037.
--
-- One row per POC, mirroring conversation_messages' contact_id/candidate_id
-- pattern (exactly one is normally set).

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid REFERENCES organizations(id),

  contact_id          uuid REFERENCES contacts(id) ON DELETE CASCADE,
  candidate_id        uuid REFERENCES candidates(id) ON DELETE CASCADE,

  running_summary     text,                      -- kept under ~200 words by conversation-ai.js
  signals             jsonb,                      -- last extractSignals() output, keyed by field
  needs_verification  jsonb DEFAULT '[]'::jsonb,   -- signals below CONFIDENCE_FLOOR, RM not yet asked

  -- The message this summary already reflects, so a batch job knows whether
  -- there is anything new to process without re-reading conversation_messages
  -- in full every run.
  last_message_key    text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_summaries_contact_uidx
  ON conversation_summaries (contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_summaries_candidate_uidx
  ON conversation_summaries (candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_summaries_org_idx
  ON conversation_summaries (org_id);

DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversation_summaries ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;
