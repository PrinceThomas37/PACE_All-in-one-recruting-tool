-- ============================================================================
-- 045 — record_history: one trail for the record kinds that had nowhere to write
--
-- PACE recorded stage changes for LEADS (activity_log) and for SUBMISSIONS
-- (submission_activity), and for nothing else. A job order's status, a
-- candidate's details and a client's record changed with no trace at all.
--
-- This is deliberately GENERAL rather than three more bespoke tables: the
-- reason the existing two disagree in shape is that each was added for one
-- caller. `services/record-history.js` normalises all three into one entry, so
-- a fourth source would be a mapper, not a screen change.
--
-- Applied to an EMPTY database (the production reset, 2026-09-23), so there is
-- no backfill and no historic gap to explain — which is exactly why it is
-- cheap now and expensive later.
--
-- NOT NULL is deliberate on entity_type/entity_id: a history row that cannot
-- say what it is about is noise that can never be read back.
-- ============================================================================

CREATE TABLE IF NOT EXISTS record_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,      -- 'job_order' | 'candidate' | 'company' | ...
  entity_id    UUID NOT NULL,      -- NOT an FK: one table spans several parents,
                                   -- and a history must outlive a deleted record.
  action       TEXT,               -- 'stage' | 'created' | 'imported' | ...
  field        TEXT,               -- the column that moved, when one did
  old_value    JSONB,
  new_value    JSONB,
  note         TEXT,
  actor_id     UUID REFERENCES users(id),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read this table serves: "everything about THIS record, newest first."
CREATE INDEX IF NOT EXISTS record_history_entity_idx
  ON record_history (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS record_history_org_idx
  ON record_history (org_id, created_at DESC);

ALTER TABLE record_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_record_history" ON record_history;
CREATE POLICY "service_all_record_history" ON record_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
