-- 068 — CONTACT DATA FROM ANY PROVIDER (R-321, D-0175, D-0180). APPLIED to the live database 27 Oct 2026 on the owner's go-ahead ("apply migration and merge it"); the three constraints were read back and the 21 suggestions / 46 sized companies already stored were untouched.
--
-- Until now three columns only accepted the one vendor that was hard-wired:
--   poc_suggestions.source        CHECK IN ('apollo', 'website', 'posting')        (migration 052)
--   poc_suggestions.email_source  CHECK IN ('apollo', 'format') or NULL            (migration 052)
--   companies.size_source         CHECK IN ('manual', 'apollo') or NULL            (migration 053)
-- A second contact-data provider (services/contact-data.js) records ITS id there (the provider's integration id, lower-case letters,
-- digits and underscores), so those lists become a pattern. Every value already stored ('apollo', 'website', 'posting', 'format',
-- 'manual') matches it, so nothing existing changes and nothing is rewritten.
--
-- WHEN TO APPLY: before the first non-Apollo adapter is registered (the code writes the provider's id as the source). Safe to run twice. The old named constraints are dropped by looking up
-- whatever check mentions the column, so it does not depend on a generated name.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND ((c.conrelid = 'poc_suggestions'::regclass AND (pg_get_constraintdef(c.oid) LIKE '%source%')
            AND c.conname IN ('poc_suggestions_source_check', 'poc_suggestions_email_source_check'))
        OR (c.conrelid = 'companies'::regclass AND c.conname = 'companies_size_source_check'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE poc_suggestions ADD CONSTRAINT poc_suggestions_source_check
  CHECK (source ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE poc_suggestions ADD CONSTRAINT poc_suggestions_email_source_check
  CHECK (email_source IS NULL OR email_source ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE companies ADD CONSTRAINT companies_size_source_check
  CHECK (size_source IS NULL OR size_source ~ '^[a-z][a-z0-9_]{1,39}$');
