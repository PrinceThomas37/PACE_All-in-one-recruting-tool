-- ============================================================================
-- 058 — the Lead Finder: saved searches and the cards they produce (R-157, D-0087…D-0091).
--
-- finder_searches  one row per saved search. PERSONAL: a person sees and runs only their own.
-- finder_cards     the companies a search turned up, waiting for a person to Accept, Wait or Reject.
--
-- The owner's rule ("if every search result is added then the storage build will be humongous"): NOTHING from a
-- search is saved as a lead until Accept. A card is a short-lived suggestion — only the best few per person per
-- day are written at all, an unreviewed card is deleted after `finder_card_days`, and a card that is turned down
-- keeps only a small mark (who, which company, when) so it is never shown to that person again. Accepting
-- creates the lead through the same rows a hand-typed lead uses and records its id here.
--
-- Nothing is shared between customers (D-0090): every row carries the organisation and every query goes through
-- the organisation-scoped data layer. Additive and idempotent: safe to re-run; no existing row is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finder_searches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  sector        TEXT,
  titles        JSONB NOT NULL DEFAULT '[]'::jsonb,
  locations     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sizes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_days   INTEGER NOT NULL DEFAULT 14 CHECK (posted_days IN (7, 14, 30)),
  keywords      JSONB NOT NULL DEFAULT '[]'::jsonb,
  domains       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  last_run_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS finder_searches_user_idx ON finder_searches (org_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS finder_cards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_id     UUID REFERENCES finder_searches(id) ON DELETE SET NULL,
  -- The company's identity for "has this person seen it?": Apollo's id, else its website.
  company_key   TEXT NOT NULL CHECK (char_length(company_key) BETWEEN 1 AND 300),
  apollo_org_id TEXT,
  company_name  TEXT NOT NULL CHECK (char_length(company_name) BETWEEN 1 AND 300),
  -- What Apollo said about the company, and (once opened) its postings. Cleared when a card is turned down.
  payload       JSONB,
  postings      JSONB,
  score         NUMERIC(5, 1) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'waiting', 'rejected', 'accepted')),
  wait_until    DATE,
  decided_at    TIMESTAMPTZ,
  lead_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finder_cards_wait_has_date CHECK ((status = 'waiting') = (wait_until IS NOT NULL))
);
-- A person has at most one card per company: this is what keeps a turned-down or waiting company from coming back
-- early, and an accepted one from being offered twice.
CREATE UNIQUE INDEX IF NOT EXISTS finder_cards_once_idx ON finder_cards (org_id, user_id, company_key);
CREATE INDEX IF NOT EXISTS finder_cards_user_idx ON finder_cards (org_id, user_id, status);

-- Default org_id to the platform's default org — the same transitional pattern as 022/024/042/047/052. Routes
-- stamp it through the models layer regardless.
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finder_searches ALTER COLUMN org_id SET DEFAULT %L', default_org);
    EXECUTE format('ALTER TABLE finder_cards ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;

-- Tenant isolation, matching migration 039: RLS on, a service-role policy.
ALTER TABLE finder_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_finder_searches" ON finder_searches;
CREATE POLICY "service_all_finder_searches" ON finder_searches FOR ALL TO service_role USING (true) WITH CHECK (true);
ALTER TABLE finder_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_finder_cards" ON finder_cards;
CREATE POLICY "service_all_finder_cards" ON finder_cards FOR ALL TO service_role USING (true) WITH CHECK (true);
