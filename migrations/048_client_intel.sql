-- 048_client_intel.sql
-- The client email timeline and its "Generate AI summary" button
-- (docs/CLIENT_INTEL_DESIGN.md; owner decisions D-0039 … D-0043).
--
-- WHAT THIS ADDS — nothing existing is changed or deleted:
--   1. conversation_messages.company_id — which client an incoming email
--      belongs to, stamped when it is filed, so a client's timeline is one
--      indexed read instead of a walk through leads → contacts → messages.
--   2. conversation_messages.facts — the free rule-based facts noted from that
--      email once, when it arrived (intent, a question, promises). ~300 bytes.
--      The summary button reads these; the inbox is never re-read.
--   3. client_summaries — ONE saved summary per client: its text, the next
--      steps, what it covered (covers_until) and what it cost. A repeat click
--      with nothing new is answered from here for zero tokens.
--
-- SAFE TO APPLY: purely additive. Two nullable columns on an existing table,
-- one new table. The code checks for them and runs correctly before and after.
-- Owner's go-ahead: "Yes, go ahead and build it" (2026-09-25), after being told
-- exactly this change. Every feature switch that uses it ships OFF.

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS facts jsonb;

CREATE INDEX IF NOT EXISTS conversation_messages_company_idx
  ON conversation_messages (company_id, sent_at DESC)
  WHERE company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_summaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  summary        text NOT NULL,
  next_steps     jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine         text NOT NULL DEFAULT 'rules',   -- 'ai' | 'rules'
  model          text,
  covers_until   timestamptz,                      -- newest email it saw
  message_count  integer NOT NULL DEFAULT 0,
  tokens_used    integer NOT NULL DEFAULT 0,
  forced_at      timestamptz,                      -- last "rewrite anyway"
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_summaries_company_uniq
  ON client_summaries (company_id);
CREATE INDEX IF NOT EXISTS client_summaries_org_idx
  ON client_summaries (org_id);

ALTER TABLE client_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_client_summaries" ON client_summaries;
CREATE POLICY "service_all_client_summaries" ON client_summaries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
