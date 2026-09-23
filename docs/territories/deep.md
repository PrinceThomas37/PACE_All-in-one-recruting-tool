# Deep — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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

**⚠ Applied to an EMPTY database** (the production reset the same day), so there
is no backfill and no historic gap to explain — which is precisely why it was
cheap now and would have been expensive later. `test/models-smoke.mjs` carries
a note that its 43 is only honest once 045 has actually been applied.
