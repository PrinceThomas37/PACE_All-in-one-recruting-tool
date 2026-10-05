-- ============================================================================
-- 056 — several emails and phone numbers per person (R-114, R-014, D-0070).
--
-- The owner (2026-10-05): a person has ONE main email and ONE main phone plus
-- any number of extras; the main can be switched with a tick or a click; every
-- email goes to the MAIN only. Same for lead contacts.
--
-- The main stays exactly where it is today (`email`, `phone`) — every reader
-- and every send path keeps working untouched. The extras are two small lists
-- beside it:
--
--   extra_emails  jsonb array of strings   (never contains the main, no repeats)
--   extra_phones  jsonb array of strings   (never contains the main, no repeats)
--
-- A list on the row, not a new table: switching which one is main is then ONE
-- update of ONE row (atomic), the duplicate rule only ever compares the few
-- candidates that already share a name, and there is nothing new to scope or
-- to put under row-level security. The server cleans the lists
-- (services/contact-points.js); the CHECKs below only make sure they are lists.
--
-- Candidates already carry one extra number, `alt_phone` (shown only as "Home
-- Phone" on the submission screen). It is COPIED into extra_phones here when it
-- is a different number from the main phone; the column itself is left in place
-- and is no longer read or written by the app.
--
-- Additive: four defaulted columns, two CHECKs, one backfill that only touches
-- candidates with an alt_phone. Idempotent: safe to re-run. Apply BEFORE the code
-- that uses it is merged (the candidate select now names the new columns).
-- ============================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extra_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extra_phones JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS extra_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS extra_phones JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_extra_lists_are_arrays') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_extra_lists_are_arrays
      CHECK (jsonb_typeof(extra_emails) = 'array' AND jsonb_typeof(extra_phones) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_extra_lists_are_arrays') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_extra_lists_are_arrays
      CHECK (jsonb_typeof(extra_emails) = 'array' AND jsonb_typeof(extra_phones) = 'array');
  END IF;
END $$;

-- Carry the old "home phone" over, once, when it is a different number.
UPDATE candidates
   SET extra_phones = jsonb_build_array(btrim(alt_phone))
 WHERE coalesce(btrim(alt_phone), '') <> ''
   AND extra_phones = '[]'::jsonb
   AND right(regexp_replace(alt_phone, '[^0-9]', '', 'g'), 10) <> coalesce(phone_norm, '');
