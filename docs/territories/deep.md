# Deep — memory
> Last written: 2026-09-30 (Session 35 — C-0035 (a) applied live; territory map: sent-side) · earlier: 2026-09-28 (Session 33)

## Session 35, round 5 (2026-09-30)
`services/bd-insights.js` added to gateway in `scripts/territory-map.mjs`. No migration.

## Session 35 (2026-09-30) — the 15 legacy "Tagged" rows healed on the live database (C-0035 (a))
Applied guild's verified SQL through the Supabase connector on the owner's yes: preview 15 rows → one transaction → check `0 / 0 / 0`, submissions 52 → 67. (b) — dropping the inert `candidate_pipeline.pipeline_status` — stays open until no screen reads the alias. `services/sent-side.js` was added to observatory in `scripts/territory-map.mjs`. **No migration this session** (the next number is 055).


## Session 33 (2026-09-28, later) — migration 054, a found person outside the four slots (R-068, D-0055)
- **`054_poc_other_people.sql` APPLIED 2026-09-28** and verified live: widens
  `poc_suggestions_slot_key_check` to `('hr1','hr2','mgr1','mgr2','other')` so
  somebody uncovered from the POC finder's title search who fits none of the
  four roles can wait as a suggestion. Additive, idempotent (DROP IF EXISTS +
  ADD). Proven first in a rolled-back probe (BEGIN → ALTER → an 'other' row
  accepted, a 'nonsense' one refused → ROLLBACK; the constraint read back
  unchanged, 0 probe rows left).
- **Next migration is 055.**

## Session 33 (2026-09-28) — migration 053, where a company's size came from (D-0050)
- **`053_company_size_source.sql`** — four nullable columns on `companies`:
  `employee_count` INTEGER (CHECK ≥ 0; Apollo's ESTIMATE), `size_source` TEXT
  (CHECK manual/apollo — a picked size is never overwritten by Apollo),
  `size_checked_at` TIMESTAMPTZ (when Apollo was last asked; a company it did
  not know is not asked again for 30 days), `apollo_org_id` TEXT (≤100; so a
  later feature, e.g. its job postings, need not pay to find the company again).
- Proved in a rolled-back probe (valid write accepted; `size_source='guess'`
  and `employee_count=-1` refused; columns absent after rollback), then
  **APPLIED live 2026-09-28** (D-0047) and verified: 4 columns, 3 CHECKs, 0 rows
  with values. No company had a size yet (0 of 82), so nothing to backfill.
- `companies` is already registered; no models/tables.js change.
- **Next migration is 054.**

## Session 33 (2026-09-28) — migration 052, `poc_suggestions` (R-053 slice 2, D-0049)
- **`052_poc_suggestions.sql`** — people the POC finder found for a lead,
  waiting for a person's yes or no. The finder NEVER writes `contacts` itself
  (the send engine emails a lead's contacts), so this is where a found person
  waits. Columns: id, org_id NOT NULL (default = the default org, the 022/042
  pattern), job_id FK jobs **ON DELETE CASCADE**, company_id FK companies SET
  NULL, slot_key CHECK hr1/hr2/mgr1/mgr2, first_name 1–100, last_name, title,
  email, email_confidence CHECK confirmed/likely, email_source CHECK
  apollo/format, source NOT NULL CHECK apollo/**website/posting** (the free
  rungs still to build — allowed now so they need no migration), source_ref,
  linkedin_url, status DEFAULT 'suggested' CHECK suggested/accepted/rejected,
  contact_id FK contacts SET NULL, created_by, decided_by, decided_at,
  created_at.
- **D-0049 IS ENFORCED BY THE TABLE, not only the route:**
  `(email IS NULL) = (email_confidence IS NULL)` — no address is stored
  without 'confirmed' (Apollo verified it) or 'likely' (the company's own
  learned format). Plus `(status='suggested') = (decided_at IS NULL)`.
- **Unique `(job_id, source, source_ref) WHERE source_ref IS NOT NULL`** — one
  person from one source once per lead, which is ALSO what keeps a turned-down
  person from ever coming back. Index `(org_id, job_id, status)`. RLS + policy
  `service_all_poc_suggestions` (the 039 shape).
- **`status='rejected'` with `decided_by` NULL means PACE turned it down
  itself** — opted out anywhere, already on file at the company, or put on
  another lead there before Accept. No address is kept for an opted-out person.
- Proved in a rolled-back probe, **APPLIED live 2026-09-27** (D-0047) and
  **re-verified 2026-09-28 before its code merged**: 20 columns, RLS on, 1
  policy, 3 indexes, 13 CHECKs incl. both D-0049 ones, 0 rows.
- Registered in `models/tables.js` → **TENANT_TABLES = 46** (models-smoke pins
  the number and names the table).
- **A table with `company_id` must join `services/company-merge.js`
  MERGE_TABLES** — company-merge-smoke scans the migrations and failed on this
  one until it did (guild's file; added there, guild memory updated).
- The Apollo credit meter needs no migration: `app_settings` key
  `poc_credits_<org>_<YYYY-MM-DD>` (the AI meter's shape).
- **Next migration is 053.**

## Session 33 (2026-09-27) — migration 051, company size (R-053, D-0049)
- `051_company_size.sql`: `companies.size_band text`, nullable, CHECK in
  ('1-20','21-50','51-200','201-1000','1000+') — the one list is
  services/poc-targets.js `SIZE_IDS`. Additive only; no row changed.
- Proved first in a rolled-back probe (valid value accepted, 'huge' rejected by
  the check, no other row touched; column absent afterwards), then **APPLIED to
  the live DB 2026-09-27** under D-0047's standing SQL permission and verified
  (column + constraint present). **Next migration is 052.**
- `scripts/territory-map.mjs`: `services/poc-targets.js` added to observatory's
  list (it sits beside enrichment.js). No new table, so models/tables.js is
  unchanged.

## Session 31 (2026-09-25) — migration 048, client intelligence
- `048_client_intel.sql`: `conversation_messages.company_id` (FK companies, ON
  DELETE SET NULL) + `facts jsonb`, index `(company_id, sent_at DESC)`; new
  table `client_summaries` (one row per client, unique company_id, org_id NOT
  NULL, RLS + service-role policy). Purely additive. Owner's go-ahead
  2026-09-25 ("Yes, go ahead and build it") after being told exactly this.
  **APPLIED to the live DB 2026-09-25**, verified after: 2 new columns on
  conversation_messages, client_summaries 14 columns, RLS on, 1 policy, the 78
  existing messages untouched. **Next migration is 049.**
  Registered in `models/tables.js` (45 tenant tables). The company-merge list
  now carries both (conversation_messages MOVES; client_summaries is CLEARED on
  the duplicate — `clear: true` in services/company-merge.js).

## What is true here now
- Supabase project `teiqievahzhllojvgsku`. **48 tables: 41 tenant, 7 global.**
- `models/tables.js` is verified against the live schema. A migration adding a
  table with `org_id` **must** add it there.
- **42 migration files. Highest applied: two both numbered `042`** —
  `042_candidate_outreach` (the queue + three `job_orders.outreach_brief*`
  columns) and `042_email_tracking_body` (nullable `email_tracking.body`). Both
  applied and verified 2026-09-09. **Next is 043.**
- The 042 collision is a **naming defect, not a data one**. Deliberately not
  renamed — the filename is the record of what was applied, and alphabetical
  order happens to be the correct replay order.
- RLS: **0 of 48 tables without RLS, 0 without a service-role policy** (verified
  after migration 039).

- **Migration 043 adds a structured postal address to `companies`**
  (`address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`)
  — the owner's call over my recommendation of the existing free-text
  `location` (D-0023). **Additive: `location` stays** as the short display form,
  holds the only address 1,565 of 1,567 rows have, and is now DERIVED from the
  new fields rather than typed twice. Nothing is backfilled — splitting an
  existing free-text line by guessing where the street ends turns good data
  into confidently wrong data.

## Fragile — touch with care
- `emails.sent_at` defaults to `CURRENT_DATE`, so an unsent draft already carries
  a send date. Any "sent on X" report counts drafts unless it filters.
- `conversation_messages` has ONE unique index on `(provider, message_key)`
  shared by contacts and candidates. A second insert for the same physical
  message silently loses to the first.
- `conversation_messages` was **deliberately not widened** to hold general inbox
  traffic. It records threads PACE is *working*, not everything that arrives.
- Migration 039 gave `microsoft_tokens`/`gmail_tokens` an `org_id` — they are now
  in `TENANT_TABLES`.

## Open here
- **Migration 042 for the mailbox error column is unclaimed** (see `harbour`):
  `emails` has no column to record *why* a send failed, so the friendly reason
  dies with the process. Parked by the owner, not forgotten.
- 19 `email_tracking` rows predate `042_email_tracking_body` and read back null
  forever. That text only ever lived in the mailbox.

## Session 27 — migration 044

- **044 APPLIED LIVE 2026-09-22 with the owner's explicit go-ahead.** Adds
  `apply_token` / `apply_enabled` / `apply_published_at` / `apply_count` to
  `job_orders`, a partial unique index on `apply_token`, and
  `sourcing_candidates (org_id, provider, status)`.
- **Verified after applying:** 4 columns with the right defaults, both indexes
  present, and **0 of 6 job orders published**. `apply_enabled` defaults false —
  publishing a customer's job to the open internet is never a migration's side
  effect.
- No new table, so `models/tables.js` is unchanged.
- **Next migration is 045.** Never apply one without a fresh, explicit
  go-ahead.

## Session 27, round 3 — the memory gate lives in scripts/

- **`scripts/memory-check.mjs`** maps changed files to their owning territory
  through `docs/territories/_map.json` and reports which memories that change
  owes. **`whatIsOwed(files)` is PURE**, which is the only way its own test can
  prove it FAILS when it should rather than passing because nothing ran.
- **`scripts/session-brief.mjs`** (SessionStart hook) and
  **`scripts/stop-gate.mjs`** (Stop hook) sit beside it. See D-0027.
- **⚠ `_map.json` IS THIS TERRITORY'S CONTRACT WITH THE GATE.** `ownerOf()`
  resolves by **longest prefix**, so `services/view-horizon.js` (surface) is
  not swallowed by a territory owning `services/`. **A restructure that moves
  paths between territories changes what the gate demands** — regenerate the
  map (`node scripts/territory-map.mjs`) and re-run
  `test/memory-discipline-smoke.mjs`.
- **`.claude/` and `docs/` are deliberately unowned** — territory-map skips
  both. A change confined to them owes the archive but no territory memory.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-22** — applied migration 044 (apply-page columns on `job_orders`) after owner go-ahead; verified column defaults, indexes and that nothing was published.
- **2026-09-22** — added the memory gate (`memory-check`, `session-brief`, `stop-gate`) under `scripts/`; D-0027.

## Session 28 — four services owned nothing, and the survey said so

`scripts/territory-map.mjs` failed loudly with **four files claimed by no
territory** — everything Session 28 added:

| file | owner | why that one |
|---|---|---|
| `services/submission-stages.js` | **guild** | The ONE definition of a submission (D-0029). It is domain vocabulary, so it sits with the stages it orders. |
| `services/applicants.js` | **guild** | The ONE reader of a staged applicant's `raw` blob (D-0028). Same reason. |
| `services/applicant-notify.js` | **harbour** | It composes two outbound messages. The rules about what may appear in one (never the end client's name) are enforced where mail is written. |
| `services/jd-scrub.js` | **observatory** | Sits beside `jd-parser.js`, and is shared by the public apply page and the "re-write job description" button so the two cannot disagree about what is safe to publish. |

**The map is the only thing that catches this**, and it catches it by failing
rather than by warning — which is why it is worth running after any session that
adds a file. Four orphans accumulated across three rounds of one session without
anything else noticing, exactly as the two orphans found the day the script was
written.

**The lesson to keep: a new `services/*.js` file does not inherit an owner.**
`_map.json` guarantees every file has exactly one territory, and that guarantee
is maintained by hand in this script's `own` arrays. Add the entry in the same
change as the file, or the next session's survey is the one that finds it.

## Session 28 — migration 045, `record_history`

One general trail for the record kinds that had nowhere to write: job orders,
candidates, companies. Leads already used `activity_log`; submissions already
used `submission_activity`.

**Deliberately GENERAL rather than three more bespoke tables.** The reason the
existing two disagree in shape is that each was added for one caller, and the
cost of that showed up as a reader that had to know three shapes. A fourth
source is now a mapper in `services/record-history.js`, not a schema change.

- `entity_id` is **NOT a foreign key**: one table spans several parents, and a
  history must outlive the record it describes.
- `entity_type` / `entity_id` are `NOT NULL` — a history row that cannot say
  what it is about is noise that can never be read back.
- `org_id NOT NULL`, RLS on, service-role policy, and **registered in
  `models/tables.js`** (43 tenant tables now). A table with `org_id` that is
  missing from that registry silently escapes org scoping.
- One index for the only read it serves: `(entity_type, entity_id, created_at DESC)`.

**APPLIED 2026-09-23** with the owner's go-ahead, to an EMPTY database (the
production reset the same day) — so there is no backfill and no historic gap to
explain, which is precisely why it was cheap now and would have been expensive
later. Verified after: 11 columns, RLS on, 1 service-role policy, 3 indexes,
0 rows. **Next migration is 046.**

## Session 29 — migration 046, retry bookkeeping on `emails`
Applied 2026-09-23 with the owner's go-ahead (D-0031). Four columns on `emails`:
`attempt_count` (int, default 0), `next_attempt_at` (timestamptz),
`fail_kind` (text), `fail_reason` (text), plus a partial index on `sent_by`
where `status='failed'`. No new table, so `models/tables.js` is unchanged.
Closes C-0004. **Next migration is 047.**

- **2026-09-23 (Session 29)** — `services/send-retry.js` added to harbour's list in `scripts/territory-map.mjs` (the survey flagged it as owned by nobody); map regenerated.

- **2026-09-23 (Session 29)** — `services/engine-draft.js` added to observatory in `scripts/territory-map.mjs`. Live settings changed with the owner's go-ahead (D-0033): `ai_daily_token_cap` 400000, `ai_daily_call_cap` 400. No migration.

- **2026-09-23 (Session 29)** — data repair, live: 119 of 119 contacts had `linkedin` = their own email (import misfile, "Email ID" matched "li"). Cleared where `lower(trim(linkedin)) = lower(trim(email))`; nothing lost, the email column holds the same value. It had also made every contact look reachable on LinkedIn to the D-0017 call-task gate.

- **2026-09-24** — `services/lead-fill.js` assigned to guild in the territory map.

## 2026-09-24 — map registration (noted by the orchestrator)
`scripts/territory-map.mjs` gained `services/job-order-visibility.js` under guild: the D-0035 helper that decides which client-POC fields of a job order a non-owner may see. Added by guild during C-0022 so the file is not an orphan; regenerate `_map.json` with `node scripts/territory-map.mjs` after it lands.

## 2026-09-24 — migration 047, `ownership_requests` (WRITTEN, NOT APPLIED)
Take-over requests, D-0036/D-0037. The owner approved adding the table at
merge time ("Yes, add it"); **the orchestrator applies it, and it must be
applied BEFORE the routes that use it are merged.** 046 was the true highest
file, so this is 047. **Next migration is 048.**

- Columns: `id`, `org_id` (NOT NULL, FK organizations, default-org DEFAULT via
  the 042 DO-block), `record_kind` (lead|client|job_order), `record_id` (**not
  an FK** — spans jobs/companies/job_orders, and history outlives the record),
  `record_label` (≤300, what the asker saw), `requester_id`, `current_owner_id`
  (NULL = was in the pool), `approver_id`, `status`
  (pending|approved|declined|cancelled, default pending), `note` (≤1000),
  `decision_note` (≤1000), `decided_by`, `decided_at`, `created_at`,
  `updated_at` (no trigger — the route sets it; the house has no triggers).
- **Every user FK is `ON DELETE RESTRICT`.** Users are soft-deleted
  (`routes/auth.js` sets `deleted_at`/`is_active`), so this costs nothing today;
  if a hard delete is ever added it must not erase who asked or who decided.
- **Three CHECKs carry the owner's rules into the schema:** approver ≠
  requester (nobody approves their own request); `decided_at` is set exactly
  when status ≠ pending (cancel included); an approve/decline is never decided
  by the requester.
- Partial UNIQUE on `(org_id, record_kind, record_id, requester_id) WHERE
  status='pending'` → a second ask while one waits is a 23505.
- Indexes: approver queue, requester's list, per-record history.
- RLS on + `service_all_ownership_requests`, same as 039.
- Registered in `models/tables.js` → **44 tenant / 7 global in the registry**
  (live stays 43/7 until applied). `test/models-smoke.mjs` pins 43 — that is
  foundry's file; they must bump it to 44 when this lands.
- Not to be confused with `assignment_requests` (020): that asks to be PUT ON a
  job order as a recruiter; this asks to OWN a record.


## 2026-09-24 — 047 gains a fourth CHECK (rampart review), still NOT APPLIED
- Added `ownership_requests_decided_has_decider`:
  `CHECK (status = 'pending' OR decided_by IS NOT NULL)`. The existing
  `decider_not_requester` check uses `IS DISTINCT FROM`, which is TRUE for a
  NULL `decided_by`, so without this an approval could be stored with no decider.
  Named, inline in the CREATE, **and** re-added by a guarded `DO` block
  (`pg_constraint` lookup) so a re-run over a pre-existing table converges.
  Syntax re-read by hand; no Postgres server in the sandbox to dry-run it.
- **THE "48 TABLES" FIGURE IS ALREADY STALE, NOT "48 → 49".** By the registry
  (`models/tables.js`, which `models-smoke` pins against applied migrations):
  live today = **43 tenant + 7 global = 50**; after 047 = **44 + 7 = 51**.
  037, 042 (`candidate_outreach`) and 045 (`record_history`) each added a table
  after the 48 was written, and nobody moved the number. **Not re-verified
  against the live schema this round** (no Supabase tool in this session) —
  confirm with `select count(*) from pg_tables where schemaname='public'`
  before writing the new figure anywhere.
- Files still saying 48 (grep, excluding the append-only archive):
  `CLAUDE.md:1436`, `docs/CONTEXT_WINDOW.md:264`, `docs/territories/_contracts.md:388`,
  `docs/territories/rampart.md:83,86`, `.claude/agents/deep.md:10,34`,
  `.claude/agents/rampart.md:38`, and this file's own header (lines 5, 15 —
  left as-is here pending the live count). **No test pins 48**; the only
  table-total pin is `test/models-smoke.mjs:171-172` (`TENANT_TABLES.size === 44`),
  already at the post-047 value. `models-smoke` 53/53 PASS.

- 2026-09-25: no schema change. New numeric setting `company_daily_first_emails` (app_settings `sys_…`, no migration); the posting lives in the existing `jobs.research.jd_raw`. territory-map regenerated (3 orphan services claimed).

- 2026-09-26: **migration 049 APPLIED** (owner's standing SQL permission, D-0047): `emails_purged_20260910` / `follow_ups_closed_20260910` — both EMPTY and unused — got RLS + a service_role policy and lost every anon/authenticated grant. Verified after: 0 public tables without RLS. Dropping them is offered to the owner, not done. **Next migration 050.**

- 2026-09-26 (R-048, migration **050 APPLIED**): `recruiting_lookups` uniqueness is now PER COMPANY — `recruiting_lookups_org_cat_val_uidx (org_id, category, lower(value))`; the global `recruiting_lookups_cat_val_uidx` from 016 is dropped (new index created first, so never a moment with no rule). Checked before: 41 rows, 1 org, 0 dups. Proven live in a rolled-back probe: another org may add the same word, the same org still cannot (any case). **Next migration is 051.**
- 2026-09-26 (R-032, NOT done — honest status): 62 objects in `candidate-docs`; **38 (2.9 MB) are referenced by nothing** (checked against candidate_documents/client_documents.storage_path, candidates.resume_url/profile_url, sourcing_candidates.resume_url/raw) and none belongs to an existing candidate — all pre-date the 23 Sep reset. `storage.objects` has `protect_objects_delete`, so SQL cannot remove them (correctly — it would orphan the bytes); removal needs the Storage API with a service key, which this sandbox lacks. Harmless (private bucket, far under 1 GB). All 24 files from 24 Sep ARE referenced.

- 2026-09-27 (R-032, owner: "Delete them"): **`services/storage-orphans.js` (owned here)** + one-time engine job `storage_orphan_cleanup` in index.js. Deletes a `candidate-docs` file only when (1) no record names its path — candidate_documents/client_documents.storage_path, candidates.resume_url/profile_url, sourcing_candidates.resume_url/raw; (2) the candidate / company / published job (`apply_token`) it is filed under does not exist at all — soft-deleted counts as existing; (3) it is >1 day old. Unknown path shapes are kept. Reads are paged past 1,000 rows and any failed read/list/delete THROWS, so nothing is marked done on a partial run. Done-marker `storage_orphan_cleanup_v1` in app_settings holds COUNTS only (file names are people's resumes). Expected on first tick: 38 deleted, 24 kept. `test/storage-orphans-smoke.mjs` (23); five deliberate breaks of the guards each fail it.
- 2026-09-28 VERIFIED LIVE: `storage_orphan_cleanup` ran 2026-09-27 07:24 UTC — scanned 62, deleted 38 (2,953,489 bytes), kept 24 (all referenced). `candidate-docs` now holds 24 objects; the next tick (09-28 07:28) skipped as already done. R-032 closed.
- 2026-09-28 (R-069): `scripts/territory-map.mjs` — `services/gmail-delivery.js` and `services/interrupted-sends.js` added to harbour's `own` list; map regenerated (0 unclaimed). No migration: the fixes use migration 046's columns (`attempt_count`, `next_attempt_at`, `fail_kind`, `fail_reason`). Next migration is still 055.

- 2026-10-02 (R-110): migration 055 `055_open_tracking_recipient_only.sql` — `email_tracking` gains `email_id`, `contact_id`, `ignored_open_count` (default 0), `last_ignored_reason` and an index on `email_id`. Additive, idempotent, no new table (so nothing for `models/tables.js`). Next migration is now 056. APPLIED to the live database 2026-10-02 (owner's go-ahead), before the code merged (the pixel route writes the two ignored_* columns).

- 2026-10-05: `scripts/territory-map.mjs` now claims ten files that had no territory (`doc-fetch`, `error-report`, `followup-sender`, `html-entities`, `interview-time`, `ooo-return`, `open-tracking`, `ra-insights`, `submission-email`, `viewer-time`); `node scripts/territory-map.mjs` reports none unclaimed. No schema change; next migration is still 056.

- 2026-10-05 (R-114): **migration 056** `056_extra_emails_phones.sql` written, NOT applied — `candidates` and `contacts` gain `extra_emails` / `extra_phones` jsonb NOT NULL DEFAULT '[]' with array CHECKs, and `candidates.alt_phone` is COPIED into `extra_phones` where it differs from the main phone (the column stays, no longer read or written). Additive and idempotent. No table, no `models/tables.js` change. Apply BEFORE the code merges (the candidate select names the new columns, so the code on a database without them 500s every candidate read).

- 2026-10-05 (R-114/R-117): **migration 056 APPLIED to the live database** (owner's go, tests green on Node 22 + 26 first). Verified: 4 new columns, no `alt_phone` rows existed to carry. Next migration is now **057**. Same day, a one-off data repair (owner's yes): the 80 shifted lead contacts were backed up to a PRIVATE table `backups.contacts_r117` (schema `backups`, all rights revoked from anon/authenticated/public — never in `public`, never exposed by the API), then shifted back one column in ONE statement restricted to the exact signature and the backed-up ids; all 80 `email_status='valid'` (every domain has mail servers). To undo: restore the five fields from the backup by id. The backup may be dropped once the owner is satisfied.

- 2026-10-06 (R-013): two tools added under `scripts/` (deep owns that folder): `inline-to-classes.mjs` (rewrites inline type styles in `public/js` into classes and proves each change in a real browser; also owns the generated block at the end of `public/ui.css`) and `screens-fingerprint.mjs` (before/after look of every element, for work that must change nothing). Neither touches data or schema. Surface owns what they rewrite; foundry owns the proof — see their memories.

- 2026-10-06 (R-125): NO migration. A planned `companies.address` column was dropped — the live table already has `address_line1/2, city, state, postal_code, country` (migration 043). Next migration is still **057**.

- 2026-10-06 (R-131): a new `app_settings` key per person, `wf_primary_<userId>` = JSON {kind: workflow id} — no migration, no new table (same pattern as `mba_hide_<userId>`).
