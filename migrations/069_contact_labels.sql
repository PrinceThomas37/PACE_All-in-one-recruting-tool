-- ============================================================================
-- 069 — Direct / office on an email or phone number (R-342, D-0189).
--
-- The owner (2026-10-29): an added email or number should say whether it is
-- the person's own line (direct) or the company's (office).
--
--   contact_labels  jsonb object   { "e:<email lower-case>": "direct" | "office",
--                                    "p:<last 10 digits>":    "direct" | "office" }
--
-- Keyed by the NORMALISED value, beside the main and the extras lists (056), so a
-- label follows its number when "Make main" swaps it — nothing else changes. The
-- server cleans it (services/contact-points.js cleanLabels): only the person's own
-- values, only the two labels. The CHECK only makes sure it is an object.
--
-- Additive: two defaulted columns, two CHECKs, no backfill. Idempotent: safe to
-- re-run. Apply BEFORE the code that uses it is merged (the lead and candidate
-- selects name the new column).
-- ============================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS contact_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS contact_labels JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_contact_labels_is_object') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_contact_labels_is_object CHECK (jsonb_typeof(contact_labels) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_contact_labels_is_object') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_contact_labels_is_object CHECK (jsonb_typeof(contact_labels) = 'object');
  END IF;
END $$;
