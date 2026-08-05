-- ============================================================================
-- 039_tenant_isolation.sql
-- The isolation batch. THIS MUST BE APPLIED BEFORE SELF-SERVE SIGNUP IS TURNED
-- ON — not after.
--
-- WHY THIS IS ONE MIGRATION AND NOT THREE
-- Until now PACE has been safe partly by accident: every person using it works
-- for one company, so "the database is reachable with the anon key" and "two
-- token tables have no org_id" have never had a second tenant to leak to.
-- Self-serve signup (step 3) ends that in a single deploy. The moment a
-- stranger can create a workspace, every one of these becomes live. So they
-- ship together, and the flag that opens the front door
-- (SELF_SERVE_SIGNUP=on) is only set once this has been applied.
--
-- WHAT IT DOES
--   1. Turns on Row Level Security for the 37 tables that do not have it.
--   2. Gives microsoft_tokens / gmail_tokens an org_id.
--   3. Records how people sign in (last_login_at / last_login_method).
--   4. Widens the users.role CHECK to the roles the UI already offers.
--
-- SAFE TO APPLY: additive columns, plus RLS with a service-role policy on every
-- table. The backend connects with the SERVICE key (config/env.js requires
-- SUPABASE_SERVICE_KEY; there is no anon-key code path anywhere in the app, and
-- the browser never talks to Supabase directly), so the running application is
-- unaffected. What changes is that a leaked anon key stops being a full copy of
-- every customer's database.
-- ============================================================================

-- ── 1. RLS ──────────────────────────────────────────────────────────────────
-- The same pattern already live on users, companies, email_templates,
-- domain_events, suppression_list, warmup_* and gmail_tokens since migrations
-- 005/006/009/010 — this finishes the job on the tables that were added later.
--
-- ENABLE without a permissive policy would lock out anon AND authenticated,
-- which is exactly what we want; the explicit service_role policy is belt and
-- braces (service_role bypasses RLS anyway) and, more usefully, documents the
-- intent for whoever reads the table next.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_log','app_settings','assignment_requests','candidate_documents',
    'candidate_notes','candidate_pipeline','candidates','client_documents',
    'contacts','email_send_log','email_tracking','emails','engine_runs',
    'enrichment_cache','follow_ups','id_sequences','job_orders','jobs',
    'lead_sources','match_scores','microsoft_tokens','organizations',
    'recruiter_assignments','recruiting_lookups','reminders','reports',
    'reviews','sourced_jobs_raw','sourcing_candidates','submission_activity',
    'submissions','team_assignments','user_emails','workflow_definitions',
    'workflow_enrollments','workflow_step_runs','workflow_steps'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_all_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'service_all_' || t, t);
    END IF;
  END LOOP;
END $$;

-- Tables from migrations 037/038, covered here too so they are never the one
-- pair left open. Guarded, so this migration applies cleanly in either order.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_messages','org_domains']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_all_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'service_all_' || t, t);
    END IF;
  END LOOP;
END $$;

-- ── 2. org_id on the OAuth token tables ─────────────────────────────────────
-- These hold refresh tokens for customers' actual mailboxes — the most
-- sensitive rows in the database. They have been reachable only via
-- user_emails (which IS org-scoped), so this was never a live leak; it was one
-- forgotten join away from being one, and "not currently exploitable" is not a
-- property you want protecting somebody's inbox.
ALTER TABLE microsoft_tokens ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE gmail_tokens     ADD COLUMN IF NOT EXISTS org_id uuid;

-- Backfill from the owning user. user_id is on both tables already.
UPDATE microsoft_tokens t SET org_id = u.org_id
  FROM users u WHERE u.id = t.user_id AND t.org_id IS NULL;
UPDATE gmail_tokens t SET org_id = u.org_id
  FROM users u WHERE u.id = t.user_id AND t.org_id IS NULL;

-- Any row whose user_id did not resolve (older rows predate it) falls back to
-- the mailbox's owner via user_emails.
UPDATE microsoft_tokens t SET org_id = u.org_id
  FROM user_emails ue JOIN users u ON u.id = ue.user_id
 WHERE ue.id = t.user_email_id AND t.org_id IS NULL;
UPDATE gmail_tokens t SET org_id = u.org_id
  FROM user_emails ue JOIN users u ON u.id = ue.user_id
 WHERE ue.id = t.user_email_id AND t.org_id IS NULL;

-- Same transitional DEFAULT as every other tenant table (022/024/027/037/038):
-- existing INSERTs that do not mention org_id keep working.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE microsoft_tokens ALTER COLUMN org_id SET DEFAULT %L', default_org);
    EXECUTE format('ALTER TABLE gmail_tokens ALTER COLUMN org_id SET DEFAULT %L', default_org);
    UPDATE microsoft_tokens SET org_id = default_org WHERE org_id IS NULL;
    UPDATE gmail_tokens     SET org_id = default_org WHERE org_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS microsoft_tokens_org_idx ON microsoft_tokens (org_id);
CREATE INDEX IF NOT EXISTS gmail_tokens_org_idx     ON gmail_tokens (org_id);

-- ── 3. Sign-in bookkeeping ──────────────────────────────────────────────────
-- services/sso.js has been writing these two columns since sign-in shipped;
-- they did not exist, so the write was a silent no-op. Support ("I can't log
-- in", "has this person ever signed in?") is the whole point of them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at     timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_method text;

-- ── 4. The role CHECK matches the roles the app offers ──────────────────────
-- Migration 026 added Associate Director and Director everywhere roles are
-- PICKED (Admin user detail, Manager Users, workflow step assignment) but not
-- to the constraint that decides whether they can be SAVED, so choosing either
-- one currently fails at the database. Additive: nothing that was valid before
-- becomes invalid.
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
    role IN ('ra','ra_lead','bd','bd_lead','admin','recruiter','associate_director','director')
  );
END $$;
