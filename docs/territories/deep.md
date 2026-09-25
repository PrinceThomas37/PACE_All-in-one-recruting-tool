# Deep — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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
