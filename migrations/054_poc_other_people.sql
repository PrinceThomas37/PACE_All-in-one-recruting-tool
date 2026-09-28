-- ============================================================================
-- 054 — a person found by the title search may sit OUTSIDE the four slots
-- (R-068, D-0055).
--
-- The owner (2026-09-28): "I need the people from other job also in this
-- employee search. Maybe a search bar to search for title or similar title …
-- and we can click on to see and select which contact we want to uncover."
-- Until now every found person belonged to one of the four slots (two HR, two
-- hiring managers). A person uncovered from a title search — a project manager,
-- an estimator, anybody the user picks — may fit none of them, so they wait in
-- poc_suggestions as slot 'other' ("Other people you picked") with the same
-- Accept / Not this person as everyone else. Everything else about the table —
-- D-0049's "no email without a confidence", the once-per-person index — is
-- unchanged and applies to them too.
--
-- Additive only: widens one CHECK; no row changes. Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE poc_suggestions DROP CONSTRAINT IF EXISTS poc_suggestions_slot_key_check;
ALTER TABLE poc_suggestions ADD CONSTRAINT poc_suggestions_slot_key_check
  CHECK (slot_key IN ('hr1', 'hr2', 'mgr1', 'mgr2', 'other'));
