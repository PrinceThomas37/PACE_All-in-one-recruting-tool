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

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-22** — applied migration 044 (apply-page columns on `job_orders`) after owner go-ahead; verified column defaults, indexes and that nothing was published.
