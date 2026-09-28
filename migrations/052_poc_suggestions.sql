-- ============================================================================
-- 052 — poc_suggestions: people the POC finder found for a lead, waiting for a
-- person to accept or turn them down (R-053, D-0049).
--
-- The finder never writes into `contacts` by itself: the send engine emails a
-- lead's contacts, so a person the finder merely FOUND must not be one until a
-- human accepts them (docs/CONTACT_FINDER_DESIGN.md §6). This table is where a
-- suggestion waits. Accepting creates the contact through the same code path
-- as "Add contact" (services/lead-contacts.js) and records it here.
--
-- D-0049 — A GUESSED ADDRESS IS NEVER EMAILED — is made true by the table, not
-- only by the route: an email may be stored only with a confidence of
-- 'confirmed' (the source verified it) or 'likely' (built from the company's
-- own format, learned from real addresses there). Anything else stores no
-- email at all, and the suggestion is still useful as a name and a title.
--
-- A turned-down person stays here as 'rejected', so they are never suggested
-- for that lead again. Deleting the lead deletes its suggestions (they are
-- about that lead and nothing else). Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS poc_suggestions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id),
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id       UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- Which of the four slots it was found for (services/poc-targets.js).
  slot_key         TEXT NOT NULL CHECK (slot_key IN ('hr1', 'hr2', 'mgr1', 'mgr2')),
  first_name       TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 100),
  last_name        TEXT CHECK (last_name IS NULL OR char_length(last_name) <= 100),
  title            TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  email            TEXT CHECK (email IS NULL OR char_length(email) <= 320),
  email_confidence TEXT CHECK (email_confidence IS NULL OR email_confidence IN ('confirmed', 'likely')),
  email_source     TEXT CHECK (email_source IS NULL OR email_source IN ('apollo', 'format')),
  -- Where the PERSON came from. 'website' and 'posting' are the free rungs
  -- still to be built (design §8 step 3); allowed now so they need no migration.
  source           TEXT NOT NULL CHECK (source IN ('apollo', 'website', 'posting')),
  source_ref       TEXT CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  linkedin_url     TEXT CHECK (linkedin_url IS NULL OR char_length(linkedin_url) <= 500),
  status           TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'accepted', 'rejected')),
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- D-0049, at the table: no email without a confidence, no confidence without an email.
  CONSTRAINT poc_suggestions_email_has_confidence
    CHECK ((email IS NULL) = (email_confidence IS NULL)),
  -- A decided suggestion says when; a waiting one does not.
  CONSTRAINT poc_suggestions_decided_has_time
    CHECK ((status = 'suggested') = (decided_at IS NULL))
);

-- The same person from the same source is suggested for a lead at most once —
-- which is also what keeps a turned-down person from coming back.
CREATE UNIQUE INDEX IF NOT EXISTS poc_suggestions_once_idx
  ON poc_suggestions (job_id, source, source_ref) WHERE source_ref IS NOT NULL;

-- "What is waiting on this lead?"
CREATE INDEX IF NOT EXISTS poc_suggestions_job_idx
  ON poc_suggestions (org_id, job_id, status);

-- Default org_id to the platform's default org — the same transitional pattern
-- as 022/024/042/047. Routes stamp it through the models layer regardless.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE poc_suggestions ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;

-- Tenant isolation, matching migration 039: RLS on, a service-role policy.
ALTER TABLE poc_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_poc_suggestions" ON poc_suggestions;
CREATE POLICY "service_all_poc_suggestions" ON poc_suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
