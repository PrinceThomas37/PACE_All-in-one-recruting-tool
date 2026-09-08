-- 042_candidate_outreach.sql
-- Candidate outreach — one table that is the queue, the record AND the answer.
-- Additive and safe: nothing existing reads or writes any of this, so the app
-- runs identically with or without it applied.
--
-- WHY NOT THE `emails` TABLE. That queue is welded to the leads engine — it
-- keys on job_id/contact_id, joins `jobs` for the recipient's timezone, and is
-- drained by processPendingEmailSends(), the most load-bearing loop in the app.
-- Threading a candidate through it would put candidate outreach one bug away
-- from breaking cold email, which is the business. So candidate sends get their
-- own queue and reuse the POLICIES (send window, daily cap, warm-up ramp,
-- suppression) rather than the code path.
--
-- WHY THE ANSWER LIVES HERE and not on the candidate or the message: "are you
-- interested" is a fact about THIS ASK ON THIS JOB. The same person can be
-- interested in one role and not another, and the answer has to survive them
-- being emailed again next month about something else.
--
-- See docs/CANDIDATE_OUTREACH_PLAN.md for the whole design.

-- ── the job brief: written once per job order, reused for every candidate ───
-- One AI call per JOB, not per candidate. Groq's free tier is 8,000 tokens a
-- minute and one generated email costs ~2,100, so 25 candidates written
-- individually would rate-limit and spend the org's whole daily meter — after
-- which every other AI feature in PACE silently falls back to its rules writer
-- for the rest of the day. Caching the brief here is what makes the feature
-- affordable at all.
ALTER TABLE job_orders
  ADD COLUMN IF NOT EXISTS outreach_brief        TEXT,
  ADD COLUMN IF NOT EXISTS outreach_brief_at     TIMESTAMPTZ,
  -- 'rules' | 'ai'. Shown on screen: the page says which engine wrote what you
  -- are looking at, the same honesty the client generator already carries.
  ADD COLUMN IF NOT EXISTS outreach_brief_engine TEXT;

-- ── the queue / record / answer ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_outreach (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         uuid NOT NULL,
  candidate_id   uuid NOT NULL REFERENCES candidates(id),
  -- Nullable on purpose: a "keeping in touch" email has no job attached, and
  -- every job field degrades to an empty string when it is written as though it
  -- did. That is a different email, not the same email with blanks.
  job_order_id   uuid REFERENCES job_orders(id),
  -- Set only when the recruiter ticked "add these people to this job's
  -- pipeline". Emailing somebody is not the same as working them, and a board
  -- that fills with people who never answered stops being worth looking at.
  submission_id  uuid REFERENCES submissions(id),
  sent_by        uuid REFERENCES users(id),
  mailbox_id     uuid,
  to_email       text NOT NULL,
  subject        text,
  -- STORED WITH {{sender}} / {{senderemail}} UNRENDERED. The mailbox that
  -- actually sends is resolved at SEND time and every reader calls
  -- renderStoredEmail(row, mailbox) first. Baking a name in at queue time is
  -- how 152 cold emails went out saying "I'm Jennifer Thomas" over Prince
  -- Thomas's From line (Session 14). test/sender-identity-smoke.mjs enforces it.
  body           text,
  angle          text,
  engine         text,
  status         text NOT NULL DEFAULT 'pending',   -- pending | sent | failed | skipped
  -- THE DRIP, ON A SERVER THAT SLEEPS. The free tier spins the service down
  -- after ~15 minutes, so no setInterval survives. Each row therefore carries
  -- its own due time (queued at now + i x 75-105s, jittered) and the existing
  -- 30-minute heartbeat drains whatever is due. Due-ness lives in the database,
  -- so a late heartbeat DELAYS sends and never skips them.
  send_after     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  fail_reason    text,
  -- Joins to email_tracking.token, which is where opens and replies already
  -- land. Nothing about the existing tracking or the reply sweep changes.
  track_token    text,
  response       text,                              -- null | interested | not_interested
  responded_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The duplicate guard: one live ask per candidate per job. This is the
-- candidate-side equivalent of the duplicate-cold-email guard on leads. A
-- failed send is excluded so a genuine retry is possible; a nurture email
-- (no job) is excluded because "keeping in touch" repeats by design.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_outreach_once_idx
  ON candidate_outreach (candidate_id, job_order_id)
  WHERE job_order_id IS NOT NULL AND status <> 'failed';

-- The drain reads exactly this: what is due, oldest first.
CREATE INDEX IF NOT EXISTS candidate_outreach_due_idx
  ON candidate_outreach (status, send_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS candidate_outreach_candidate_idx ON candidate_outreach (candidate_id);
CREATE INDEX IF NOT EXISTS candidate_outreach_job_idx       ON candidate_outreach (job_order_id);
CREATE INDEX IF NOT EXISTS candidate_outreach_org_idx       ON candidate_outreach (org_id);
CREATE INDEX IF NOT EXISTS candidate_outreach_token_idx     ON candidate_outreach (track_token);

-- Default org_id to the platform's default org — the same transitional pattern
-- as 022/024, so a row inserted by code that predates org threading still lands
-- somewhere valid rather than violating NOT NULL.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE candidate_outreach ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;

-- ── tenant isolation, matching migration 039 ────────────────────────────────
-- Every table in this database has RLS on and a service-role policy. A new
-- table without them is a hole: candidates' names and email addresses would be
-- readable with the anon key. Same shape as the 39 tables 039 fixed.
ALTER TABLE candidate_outreach ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'candidate_outreach'
      AND policyname = 'candidate_outreach_service_role'
  ) THEN
    CREATE POLICY candidate_outreach_service_role ON candidate_outreach
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- email_tracking gains the channel value 'candidate_outreach'. `channel` is a
-- free-text column with no constraint, so there is nothing to alter — this
-- comment exists so the value is greppable from the migrations.
