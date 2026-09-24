-- ============================================================================
-- 047 — ownership_requests: asking to take over somebody else's record
--
-- D-0036 / D-0037. A lead, client or job order has ONE responsible person
-- (services/ownership.js). Changing who that is happens by REQUEST, never by
-- reaching in: the asker files one, the approver decides, and approving moves
-- the record through the existing assignment paths. Declining leaves it alone.
--
-- Who approves (D-0037) is decided by the route, not this table — the current
-- owner's manager; the admin if the owner has none; the asker's manager if the
-- record has no owner; never the asker. This table only RECORDS that answer
-- (approver_id) at the moment the request is made, so a later change to the
-- reporting chain does not silently move a request that is already waiting.
--
-- "Every request, decision and decider is kept" — so nothing here cascades.
--
-- Written 2026-09-24. NOT APPLIED. The owner said "Yes, add it" for a new table
-- at merge time (D-0037); the orchestrator applies it, BEFORE the routes that
-- use it are merged. Idempotent: every statement is safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ownership_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),

  -- WHAT is being asked for. record_id is NOT a foreign key: one table spans
  -- three parents (jobs, companies, job_orders), and the request is history
  -- that must outlive the record it was about.
  record_kind       TEXT NOT NULL
                    CHECK (record_kind IN ('lead', 'client', 'job_order')),
  record_id         UUID NOT NULL,
  -- What the requester SAW when they asked ("Senior Estimator — KB Home"), so
  -- the history still reads true after a rename or a delete.
  record_label      TEXT CHECK (record_label IS NULL OR char_length(record_label) <= 300),

  -- WHO. Users are soft-deleted in PACE (deleted_at / is_active), never hard
  -- deleted, so RESTRICT costs nothing today — and if a hard delete is ever
  -- added, it must not quietly erase who asked, who owned or who decided.
  requester_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  current_owner_id  UUID          REFERENCES users(id) ON DELETE RESTRICT,  -- NULL = was unowned (the pool)
  approver_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  note              TEXT CHECK (note IS NULL OR char_length(note) <= 1000),           -- the asker's reason
  decision_note     TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  decided_by        UUID REFERENCES users(id) ON DELETE RESTRICT,  -- the approver, or the requester on cancel
  decided_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- No trigger (the house has none): the route sets this on every update.
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Nobody approves their own request (D-0037). The route routes it to the
  -- admin instead; this makes the rule true even if a route forgets.
  CONSTRAINT ownership_requests_not_self_approved
    CHECK (approver_id <> requester_id),
  -- A decided request says when; a pending one does not. Cancelling counts.
  CONSTRAINT ownership_requests_decided_has_time
    CHECK ((status = 'pending') = (decided_at IS NULL)),
  -- Approving or declining is never the asker's own act (cancelling is).
  CONSTRAINT ownership_requests_decider_not_requester
    CHECK (status NOT IN ('approved', 'declined') OR decided_by IS DISTINCT FROM requester_id),
  -- A decided request says WHO decided (rampart review). Without this a NULL
  -- decided_by passes the check above ("IS DISTINCT FROM" is true for NULL),
  -- so an approval could be recorded with no decider at all.
  CONSTRAINT ownership_requests_decided_has_decider
    CHECK (status = 'pending' OR decided_by IS NOT NULL)
);

-- The table is CREATE ... IF NOT EXISTS, so on a re-run against a table that
-- predates the constraint above, the inline copy would be skipped. Add it by
-- name if it is missing, so every run ends with the same constraint set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ownership_requests_decided_has_decider'
       AND conrelid = 'public.ownership_requests'::regclass
  ) THEN
    ALTER TABLE ownership_requests
      ADD CONSTRAINT ownership_requests_decided_has_decider
      CHECK (status = 'pending' OR decided_by IS NOT NULL);
  END IF;
END $$;

-- One PENDING request per person per record. Re-asking after a decision is
-- allowed; asking twice while one is waiting is a 23505 the route should read
-- as "you have already asked".
CREATE UNIQUE INDEX IF NOT EXISTS ownership_requests_one_pending_idx
  ON ownership_requests (org_id, record_kind, record_id, requester_id)
  WHERE status = 'pending';

-- "Requests waiting on me."
CREATE INDEX IF NOT EXISTS ownership_requests_approver_idx
  ON ownership_requests (org_id, approver_id, status);

-- "My requests", newest first.
CREATE INDEX IF NOT EXISTS ownership_requests_requester_idx
  ON ownership_requests (org_id, requester_id, created_at DESC);

-- A record's own history ("who has asked for this lead?").
CREATE INDEX IF NOT EXISTS ownership_requests_record_idx
  ON ownership_requests (org_id, record_kind, record_id, created_at DESC);

-- Default org_id to the platform's default org — the same transitional pattern
-- as 022/024/042, so a row from code that predates org threading still lands
-- somewhere valid rather than violating NOT NULL. Routes must still stamp it.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ownership_requests ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;

-- ── tenant isolation, matching migration 039 ────────────────────────────────
-- Every table in this database has RLS on and a service-role policy. A new
-- table without them is readable with the anon key.
ALTER TABLE ownership_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_ownership_requests" ON ownership_requests;
CREATE POLICY "service_all_ownership_requests" ON ownership_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
