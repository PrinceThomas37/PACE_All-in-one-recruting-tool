# R-349 — the lead list at 2,000 leads a day (design written 3 Nov 2026; owner said yes to A and B)

Owner's question: "when the company is adding 2000 leads per day, what after a year … what should the design be so the app does not slow down for an infinite number of leads (do not think of Render now)". This REPLACES the "hold" advice in `PLAN_R-349_lead_list_paged.md` (that was about today's slowness; this is about growth).

## The rule
**How fast a screen is depends on the size of a PAGE, never on the size of the table.** Nothing returns an unbounded list; nothing counts "everything".

## Measured 3 Nov (live database, read-only)
- `jobs` 3,139 rows, 14 MB (≈4.5 KB a lead); `emails` 10,255 rows, 11 MB (≈1.1 KB each); `contacts` ≈6.3k; `activity_log` ≈5.2k.
- At 2,000 leads/day: ≈60,000 a month, ≈730,000 a year → leads ≈3.3 GB + emails (assuming 3 per lead) ≈2.4 GB in year one. **Check the Supabase plan's storage limit before this volume** — it is a cost decision, not a code one.
- Indexes today on `jobs`: org, stage, created_by, assigned_to, company, created_date, lead_code. **None on `assigned_to_bd`** (the owner of a lead — what every list filters on), none combining owner + stage + date, no trigram (`pg_trgm` is not installed) for search.

## A — the database finds the page (migration 072, owner's go BEFORE merge)
1. `pg_trgm` + indexes: `(org_id, assigned_to_bd, stage, created_at desc, id desc) WHERE deleted_at IS NULL`, `(org_id, stage, created_at desc, id desc)`, trigram on `jobs.position`, `jobs.location`, `companies.name`, `contacts` name/email.
2. ONE SQL function `leads_page(org, viewer scope, filters, cursor, limit)` that does what `services/lead-query.js` does today (scope FIRST, then search / industry / mine-team / assignee / date / stage / Connected-newest-first), returning one page + the cursor of the next. **Keyset paging** (`created_at, id` bookmark), never OFFSET.
3. The scope rule of `services/ownership.js` (who sees what, D-0034/35/36) is written in SQL ONCE and proven EQUAL to the JavaScript rule on the same seeded leads (a side-by-side test like `lead-query-smoke`). The JavaScript rule stays the reference.
4. `GET /jobs/page` calls the function; the in-memory copy (`loadAllJobs`) is no longer used for this screen. Page size max enforced in the route and the function.
5. **Tested on a REAL Postgres 16** (installed in the sandbox: `initdb` in a temp dir), not a fake — a fake cannot run SQL. A probe that cannot start Postgres FAILS, never passes.

## B — counts without counting everything
`GET /jobs/counts`: one grouped query per person over the indexed owner+stage columns (bounded by the working set, see E), memoised ~30 s per user on the server and dropped by the existing "a write may change a lead" hook. A separate running-totals table is added ONLY if a measurement shows the grouped query slow (it adds a trigger on every lead write and can drift) — said plainly to the owner: same result, simpler mechanism.

## C — screens move, one group per PR (proof: old browser count == new count on the same data)
Leads tab + Dashboard cards → pipeline board → Assign / Distribution → mail merge / research / admin / client digest.

## D — sign-in stops downloading the list
Only when no screen reads `STATE.jobs` (a guard fails if a new reader appears).

## E — keep the working set small, forever (later, with the owner)
Old, unreplied leads leave the working list on the 90-day rule into a searchable archive (never deleted); `emails` split by month, old months to cold storage; background jobs page through due items with keyset queries (the R-352 lesson).

## Risks said plainly
- A count that looks right and is wrong is worse than a slow screen — hence the side-by-side proofs.
- The SQL scope rule is the dangerous part (another person's leads): `rampart` reviews it; a test seeds people with no visibility and asserts they get nothing.
- Migration 072 builds indexes on a live table: small today (3k rows), so instant; the same migration on 700k rows would need `CREATE INDEX CONCURRENTLY` — write it that way now.


## BUILT AND MEASURED (3 Nov 2026, night) — A and B, server side
Real Postgres 16, **700,000 synthetic leads** (`scripts/lead-list-bench/run.sh` re-runs it; ~1 GB, ~40 s to load). One page / one set of numbers, best of 3, with the machine also busy running the test suite:

| Case | Time |
|---|---|
| Admin, no filter | 5–9 ms |
| A BD's own leads | 12–36 ms |
| Manager with 20 / 100 reports | 8–10 ms |
| Search, common word ('registered', ⅙ of all leads) | 4–5 ms |
| Search, rare word | 9–16 ms (**was 11.8 s** with per-row matching) |
| Admin, deep page (180 days back) | 5 ms (**was 0.7–0.85 s**) |
| Created this week / custom dates | 5 ms (**was 0.2–0.27 s** until the date test became a range) |
| Manager, team + email search | 40–50 ms |
| Counts: admin (700k) / one BD / manager (100 reports) | 130–160 ms / 25–35 ms / 280–400 ms |

**Known limit, said plainly:** a filter COMBINATION that matches nothing at all over a very large scope (e.g. a 100-report manager × stage × a common word × "team") can take 2–4 s at 700,000 leads, because the database proves "nothing matches" by walking the list. Ordinary typos take the fast trigram path (5 ms). Step E (old leads leave the working list) shrinks the walk. Counts for the whole company grow with the table (≈1.5 s at 7 million): that is when the running-totals table (B2) is built, not before.

What was built: `migrations/073_lead_list_in_database.sql` (search column kept by triggers, 6 indexes, `lead_where_sql` / `leads_page` / `leads_counts`), `services/lead-page.js`, `GET /jobs/page` (bookmark paging) and `GET /jobs/counts`, `test/lead-list-sql-smoke.mjs` (real Postgres; the SQL equals the JavaScript reference on 130 viewer × filter cases + paging + counts + search + triggers), `test/jobs-page-route-smoke.mjs`. **Not wired to any screen yet (C), nothing applied to the live database (owner's go).**
