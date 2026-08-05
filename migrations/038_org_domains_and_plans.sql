-- 038_org_domains_and_plans.sql
-- Organisations become real: claimable domains, a plan, and a status.
--
-- WHY
-- PACE is sold to many companies now, not run for one. `organizations` has only
-- a name and a slug, so there is nowhere to record WHICH COMPANY a person
-- signing in belongs to, or WHAT THEY HAVE PAID FOR. This adds both.
--
-- The domain table is the important half. When alice@acme.com signs in, PACE
-- must decide: join Acme's workspace, or give her a personal one? That answer
-- comes from a VERIFIED claim on acme.com.
--
-- VERIFICATION IS THE WHOLE POINT. An unverified claim is an account-takeover
-- primitive: claim microsoft.com and every Microsoft employee who signs in
-- lands in your workspace, under your admin. So `verified_at` starts NULL and a
-- claim grants nothing until a DNS TXT record only the real owner could publish
-- is observed (services/org-domains.js). The partial unique index below is what
-- makes "one org owns a verified domain" true at the DATABASE level rather than
-- merely in application code — two orgs may both have a pending claim on the
-- same domain (a typo, a competitor squatting), but only one can ever hold a
-- verified one.
--
-- SAFE TO APPLY: purely additive. One new table plus nullable columns with
-- defaults on `organizations`. Existing rows keep working untouched — the
-- default org becomes plan 'internal', which is deliberately not a paid tier.

-- ── Plans / status on the organisation ──────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan          text NOT NULL DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'company';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seats_limit   integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_by    uuid;

-- 'company'    — a normal multi-seat customer
-- 'individual' — one recruiter working alone (their own private workspace)
-- 'internal'   — us
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_kind_chk
    CHECK (kind IN ('company','individual','internal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_status_chk
    CHECK (status IN ('active','suspended','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The existing tenant is ours, not a paying customer — don't let it read as one.
UPDATE organizations SET plan = 'internal', kind = 'internal'
 WHERE id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1)
   AND plan = 'free';

-- ── Claimed domains ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_domains (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain            text NOT NULL,
  verified_at       timestamptz,              -- NULL = claimed but PROVING NOTHING
  verification_token text,
  last_checked_at   timestamptz,
  last_error        text,
  -- When true, anyone signing in with a verified address on this domain joins
  -- the org automatically. When false the domain still identifies the org (so
  -- "Log in with your Organization" routes correctly) but an admin must invite.
  auto_join         boolean NOT NULL DEFAULT false,
  auto_join_role    text NOT NULL DEFAULT 'recruiter',
  created_by        uuid,
  created_at        timestamptz DEFAULT now()
);

-- THE load-bearing constraint: at most one org may hold a VERIFIED claim on a
-- domain. Unverified claims are allowed to collide — that is a typo or a
-- squatter, and neither grants anything.
CREATE UNIQUE INDEX IF NOT EXISTS org_domains_verified_uniq
  ON org_domains (domain) WHERE verified_at IS NOT NULL;

-- One org shouldn't claim the same domain twice.
CREATE UNIQUE INDEX IF NOT EXISTS org_domains_org_domain_uniq
  ON org_domains (org_id, domain);

CREATE INDEX IF NOT EXISTS org_domains_org_idx ON org_domains (org_id);
CREATE INDEX IF NOT EXISTS org_domains_lookup_idx ON org_domains (domain) WHERE verified_at IS NOT NULL;

-- Same transitional pattern as every other tenant table (022/024/027/037).
DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE org_domains ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;
