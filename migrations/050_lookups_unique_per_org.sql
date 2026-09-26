-- 050 — recruiting dropdown values are unique PER COMPANY, not across PACE (R-048).
--
-- Migration 016 made (category, lower(value)) unique across the whole table.
-- That was right when there was one company. Since R-046 (Session 30) the
-- lists are per company (`org_id`, read and written through withOrg), but the
-- uniqueness rule was not: a second customer adding "Remote" to their work
-- types would be refused with "That value already exists in this list" —
-- about a list they cannot see. It must land before a second customer does.
--
-- Checked live before writing (2026-09-26): 41 rows, 1 org, zero duplicates
-- on (org_id, category, lower(value)), so the new index builds cleanly.
-- The new index is created BEFORE the old one is dropped, so there is no
-- moment with no uniqueness rule at all.

CREATE UNIQUE INDEX IF NOT EXISTS recruiting_lookups_org_cat_val_uidx
  ON recruiting_lookups (org_id, category, lower(value));

DROP INDEX IF EXISTS recruiting_lookups_cat_val_uidx;
