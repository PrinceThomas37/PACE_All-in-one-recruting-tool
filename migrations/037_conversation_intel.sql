-- 037_conversation_intel.sql
-- Step 4 (conversation intelligence): keep the actual conversation, not a snippet.
--
-- WHY
-- Today the ONLY trace of an inbound reply is contacts.reply_snippet — the first
-- 280 characters of the FIRST reply, overwritten by nothing and never added to.
-- A thread of six messages leaves one truncated fragment behind, which is not
-- enough to say who owes whom a reply, whether a question is outstanding, or
-- what someone actually committed to. conversation-intel.js can read a thread;
-- until this table exists there is no thread to read.
--
-- STORAGE IS THE REAL CONSTRAINT (free Supabase), so:
--   * bodies are QUOTE-STRIPPED and trimmed to ~4KB before insert
--     (conversation-intel.cleanForStorage) — a quoted chain otherwise doubles in
--     size with every message in the thread;
--   * only the fields the analyzer actually uses are stored.
--
-- SAFE TO APPLY: purely additive. One new table, no changes to existing ones.
-- The code that writes it is best-effort and guarded, so the app runs correctly
-- both before and after this migration is applied.

CREATE TABLE IF NOT EXISTS conversation_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id),

  -- Who the conversation is with. Exactly one of these is normally set; both
  -- are nullable because a message can arrive from an address we have not
  -- matched to anyone yet, and that is still worth keeping.
  contact_id    uuid REFERENCES contacts(id) ON DELETE CASCADE,
  candidate_id  uuid REFERENCES candidates(id) ON DELETE CASCADE,
  job_id        uuid,

  -- Provider threading. thread_key is the provider's conversation id
  -- (Graph conversationId / Gmail threadId); message_key is the provider's
  -- message id and is what makes re-ingesting the same message a no-op.
  provider      text NOT NULL DEFAULT 'microsoft',
  thread_key    text,
  message_key   text,

  direction     text NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_email    text,
  to_email      text,
  subject       text,
  body          text,                       -- quote-stripped, trimmed
  sent_at       timestamptz NOT NULL,

  -- Cached analyzer output for this message, so a list view does not have to
  -- re-run the rules over every body it renders.
  intent        text,
  has_question  boolean DEFAULT false,

  created_at    timestamptz DEFAULT now()
);

-- A sweep re-reads the same inbox window repeatedly (the `since` bound is
-- deliberately generous so nothing is missed at the boundary), so the same
-- message WILL be offered more than once. This is what makes that idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_msgkey_uniq
  ON conversation_messages (provider, message_key)
  WHERE message_key IS NOT NULL;

-- The two read patterns: "this person's thread, newest last" and
-- "everything in this org since X" (the daily queue).
CREATE INDEX IF NOT EXISTS conversation_messages_contact_idx
  ON conversation_messages (contact_id, sent_at);
CREATE INDEX IF NOT EXISTS conversation_messages_candidate_idx
  ON conversation_messages (candidate_id, sent_at);
CREATE INDEX IF NOT EXISTS conversation_messages_org_sent_idx
  ON conversation_messages (org_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_thread_idx
  ON conversation_messages (thread_key);

-- Match the transitional pattern used by every other tenant table (022/024/027):
-- default org_id to the platform's default org so existing single-tenant code
-- keeps writing valid rows.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversation_messages ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;
