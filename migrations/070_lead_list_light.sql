-- ============================================================================
-- 070 — The lead list without the posting text (R-348, owner's go 30 Oct).
--
-- Every sign-in loads the company's whole lead list. Each lead carried its pasted
-- job description (`research.jd_raw`, 12 MB of the 14 MB on 2,751 leads) only for
-- the server to throw it away (services/lead-posting.js forList). On 30 Oct the
-- list took 15-35 s and mostly failed against the 8 s statement limit.
--
-- Three columns the database keeps up to date by itself (GENERATED ... STORED),
-- so no code has to remember them:
--   research_list      the research object WITHOUT jd_raw — what the list shows
--   posting_all_chars  length of the trimmed jd_raw (incl. the "Title:" line) —
--                      the "has a posting" test (engine-draft postingOf)
--   posting_chars / posting_words  the pasted part only — what the posting box says
-- Same arithmetic as services/lead-posting.js postingState (trim, drop one leading
-- "Title: …" line, split on whitespace).
--
-- Additive, no backfill by hand (a stored generated column fills itself; the table
-- is ~3k rows). Idempotent. Apply BEFORE the code is merged — though the code falls
-- back to the old read if these columns are missing.
-- ============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS research_list JSONB
  GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(research) = 'object' THEN research - 'jd_raw' ELSE research END) STORED;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posting_all_chars INTEGER
  GENERATED ALWAYS AS (length(btrim(coalesce(research ->> 'jd_raw', ''), E' \t\r\n'))) STORED;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posting_chars INTEGER
  GENERATED ALWAYS AS (length(btrim(regexp_replace(btrim(coalesce(research ->> 'jd_raw', ''), E' \t\r\n'), '^Title:[^\n]*\n*', '', 'i'), E' \t\r\n'))) STORED;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posting_words INTEGER
  GENERATED ALWAYS AS (coalesce(array_length(regexp_split_to_array(nullif(btrim(regexp_replace(btrim(coalesce(research ->> 'jd_raw', ''), E' \t\r\n'), '^Title:[^\n]*\n*', '', 'i'), E' \t\r\n'), ''), '\s+'), 1), 0)) STORED;
