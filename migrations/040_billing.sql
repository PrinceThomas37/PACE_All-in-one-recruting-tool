-- ============================================================================
-- 040_billing.sql
-- The three columns the Stripe seam needs, and nothing else.
--
-- WHY SO SMALL
-- Plans, limits and enforcement are already real without any schema change:
-- `organizations.plan`, `status` and `seats_limit` arrived with migration 038,
-- and every limit is defined in services/plans.js and checked in code. What is
-- missing is only the link between an organisation and Stripe's idea of it, so
-- that a webhook saying "subscription cancelled" can find the workspace it
-- belongs to.
--
-- SAFE TO APPLY: three nullable columns and one index. Nothing reads them
-- unless STRIPE_SECRET_KEY is set, so applying this changes no behaviour on its
-- own — and NOT applying it changes none either. routes/plans.js works before
-- and after; the webhook simply has nowhere to record the customer id until it
-- is applied, and the webhook cannot fire without Stripe configured anyway.
-- ============================================================================

-- Stripe's ids for this organisation. Nullable forever: an org on the Free plan
-- has never been to checkout, and an org migrated by hand may never go.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_customer_id     text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_subscription_id text;

-- When the current paid period ends. Written from the subscription lifecycle
-- events; used to show "renews on…" rather than to gate anything, because a
-- date in the database is not proof of payment — the webhook is.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_period_end timestamptz;

-- The webhook arrives knowing only Stripe's ids, and has to find the org from
-- one of them. Without this that is a sequential scan on every billing event.
CREATE INDEX IF NOT EXISTS organizations_billing_customer_idx
  ON organizations (billing_customer_id) WHERE billing_customer_id IS NOT NULL;

-- The plan column has been free text since 038. Constrain it now that the tiers
-- are defined in code (services/plans.js) — a typo in a plan id would otherwise
-- silently fall back to Free limits for a paying customer.
DO $$ BEGIN
  ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_chk;
  ALTER TABLE organizations ADD CONSTRAINT organizations_plan_chk
    CHECK (plan IN ('free','starter','pro','business','internal'));
END $$;
