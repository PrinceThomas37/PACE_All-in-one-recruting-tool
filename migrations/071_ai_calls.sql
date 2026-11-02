-- ============================================================================
-- 071 — A record of every AI call (owner, 2 Nov 2026, D-0194: "DO it"; kept 120 days).
--
-- "Create a checker to see how much time does it take for AI to read the job description and then write them down
-- and how many times it has to do it to be successful, for us to calculate the cost and AI model later." One row per
-- call to services/ai-provider.js complete(): what it was for, which provider/model answered, how long it took, how many
-- tries, whether it worked, and the text in / out (what a paid model charges by). Read by Admin → AI usage.
-- Rows older than 120 days are deleted by the engine job `ai_calls_purge` (services/ai-call-log.js RETENTION_DAYS).
--
-- Additive, idempotent. org_id NOT NULL (multi-tenancy); RLS on, service role only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_calls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL,
  user_id        UUID,                      -- who it was for, when the caller knows
  feature        TEXT NOT NULL,             -- ai-budget FEATURES key ('other' when the caller gave none)
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok', 'failed', 'over_budget', 'no_provider')),
  provider       TEXT,                      -- the one that answered (or the last one tried)
  model          TEXT,
  tries          INTEGER NOT NULL DEFAULT 0,  -- model requests made, the successful one included
  ms             INTEGER NOT NULL DEFAULT 0,  -- wall time of the whole call, every try included
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  error          TEXT,                      -- the last provider error, capped
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_org_time ON ai_calls (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_time ON ai_calls (created_at);

ALTER TABLE ai_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_ai_calls" ON ai_calls;
CREATE POLICY "service_all_ai_calls" ON ai_calls FOR ALL TO service_role USING (true) WITH CHECK (true);
