# Guild — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## What is true here now
- `bd_recruiter_routes.js` is a **43-line mounter** over
  `routes/recruiting/{job-orders,candidates,submissions,pipeline,lookups,
  sourcing,analytics,outreach}.js`. Shared helpers are built once in
  `services/recruiting-core.js` (+ `services/candidate-fields.js`).
- **63 routes are pinned** by `test/recruiting-routes-mounted.mjs`, which boots
  the real server.
- **11 ATS stages** since Session 6: Sourced, Screening, Submitted to BDM,
  Submitted to Client, Interview Scheduled, Interview Completed, Offer, Joining,
  Placement, Not Accepted, On Hold. `Joining` was "Confirmation"; `Not Accepted`
  merges the old "Rejected" + "Not Joined". `normalizeStage()` maps legacy values
  on read and write.
- Reporting is **hierarchy-scoped** — everyone sees themselves plus everyone
  under them on `manager_id` (`reportingChainIds()`, a BFS). Admin sees the org.
  Response carries `scope` (`own`/`team`/`org`).
- `routes/recruiting/outreach.js` **returns** its send helpers so the outreach
  generator did not have to grow a second send path.
- **A directly-created job order REQUIRES a POC** (name + email; phone and
  LinkedIn optional — D-0023). `clientResolve.readContacts` is the rule, the
  contacts insert is no longer best-effort, and the first POC is primary.
- **The company re-add cooldown applies to `POST /job-orders`** (D-0023).
  `services/company-cooldown.js` is the one definition; a brand-new company is
  skipped so it is never blocked by the lead this request is about to create.
- **`services/company-merge.js` folds a duplicate client into a real one.**
  Four tables carry a `company_id`; `contacts` hangs off `jobs.job_id` and
  follows its leads. A merge RE-POINTS and SOFT-DELETES — never destroys — and
  records what moved before the delete so a half-done merge is readable. A
  fifth table with a `company_id` must be added to `MERGE_TABLES`, and the test
  reads the migrations to make sure it was.
- **A job order's client is resolved by the SERVER, from a name.**
  `POST /job-orders` takes `lead.company_name` (or `lead.company_id` when the
  form's typeahead matched one) and find-or-creates inside the caller's org.
  The decision is `services/client-resolve.js` — **pure**, mine, and callable:
  `clientInputError` / `matchCompany` / `companySearchPattern`.

## Fragile — touch with care
- **THE COOLDOWN COUNTS LEADS, AND A JOB ORDER CREATES ONE.** So a client's
  SECOND requirement inside the window is blocked — hardest on the best
  clients. The owner chose this knowing genuine job orders would be refused
  (D-0023); do not quietly soften it, and do not act surprised by it. The fix
  is written down in D-0023's "Re-open when", for when a BD actually reports it.
- **`POST /job-orders` CREATES THE LEAD ITSELF.** It is lead-first by design:
  `jobs` row (stage `Connected`, LD- code) → then the job order. So a refusal
  telling the user to "fill lead info first" describes a step that does not
  exist for them. It said exactly that for four sessions, because the browser
  sent `company_id: null` hard-coded — the Client box was free text that was
  never resolved. **Nobody could create a job from scratch, ever**, and the
  from-lead path masked it. A refusal that names a JSON field is a refusal
  nobody can act on.
- **The name match is EXACT on the normalised name, deliberately.** `Treplar
  Industries` must not fold into `Treplar Inc`: a job order silently on the
  wrong client shows no error anywhere. The SQL `ilike` pattern is a superset
  and `matchCompany` makes the decision — widening the pattern costs a few rows
  read, narrowing it creates a duplicate client.
- **That route's `jobs` and `contacts` inserts had NO `orgStamp`.** The column
  has a DEFAULT, so a second org's job order would have landed in the DEFAULT
  org's leads with no error at all. Fixed and pinned. Check every insert in this
  territory for the same thing.
- **The stage vocabulary lives in six files.** Five are `surface`'s. A rename is
  a contract, not an edit by me.
- **Registration order** — `/job-orders/browse` before `/job-orders/:id`;
  `/candidates/check-duplicate` before `/candidates/:id`.
- `Assigned` vs `Connected`: **Connected means they replied.** It drives the
  funnel, the reports and the 30-day recycler. An outreach send sets `Assigned`.
- An enrollment after a generator send starts **after step 1**
  (`start_after_step`) — the email just sent IS step 1.

## Open here
- `/recruiting-dashboard` is org-scoped but **not hierarchy-scoped** the way
  `/reports/recruiting` is. The owner asked for both, plus reports folded into
  the Dashboard page itself rather than a separate nav item.
- Per-role **permission** differences do not exist yet — `associate_director` and
  `director` are hierarchy/reporting only, no new capabilities.
- Three stale draft PRs (#116, #126, #135) are months behind `main`.

## Session 27 — the apply page's staging path, and an honest provider list

- **Applicants land in `sourcing_candidates` with `provider='apply'`** — the
  same inert staging table CSV import uses, reviewed and imported by a
  recruiter. **There is no second import path and must not be.** A public form
  writing into `candidates` is a spam vector aimed at the most valuable table
  in the product.
- **`config/sourcing.js` was rewritten to stop lying.** It now separates
  **`built`** (does code exist) from **`available`** (can it run today); only
  `apply` and `csv` are built. Every unbuilt provider carries a **`blocker`**
  naming its real precondition — a paid account, not an API key. Full reasoning
  in `CLAUDE.md`; the short version is that six providers rendered as working
  cards for five sessions and the owner found it.
- **`POST /sourcing/search` refuses with `not_built`**, never
  `needs_credentials`, and names what it would take plus the CSV route that
  works today.
- **⚠ KEEP THE HISTORIC PROVIDER IDS** (`apollo`, `indeed`, `monster`,
  `careerbuilder`, `dice`, `linkedin`). Staged rows carry a provider string, so
  dropping one orphans those rows with a blank Source column.
  `test/sourcing-honesty-smoke.mjs` pins each id.
- **`scrubJobDescription` left `job-orders.js`** for `services/jd-scrub.js`, so
  the "re-write job description" button and the public apply page cannot
  disagree about what is safe to publish.

## Log
- **2026-09-17** — Session 26, round 2. Client intake on a direct create: POC
  required, structured address (migration 043), cooldown applied. D-0023.
- **2026-09-17** — Session 26. Fixed "+ New Job" refusing every direct create
  (owner report). Added `services/client-resolve.js` (pure, mine). Org-stamped
  the lead + contacts inserts. `test/new-job-client-smoke.mjs` drives the route
  with a stub database; each guard was verified by reintroducing its own bug.
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-22** — apply-page staging (`provider='apply'`); rewrote `config/sourcing.js` around `built` vs `available`; extracted the JD scrubber to `services/jd-scrub.js`.

- **2026-09-22 (Session 28)** — **APPLICANTS ARE A VIEW, NOT A POOL (D-0028).**
  The first real application landed through a published apply link and nothing
  in the product showed it. Rather than a new store, `GET /sourcing/staged`
  grew two things: **`status=all`** (so an imported applicant still appears,
  marked, instead of vanishing from the list the moment you action them) and
  **`job_order_id`**, which filters to one job's applications. Import still
  goes through `POST /sourcing/staged/:id/import` — one path, pre-tagged with
  the job the applicant chose.

  **THE JOB FILTER IS DONE IN NODE, DELIBERATELY.** The obvious implementation
  is a PostgREST jsonb filter (`raw->>applied_to_job_order_id`). It was written
  and then removed: it **cannot be exercised from this sandbox** (no
  credentials), and its failure mode is an **empty list, not an error** — the
  screen would have read "no applicants yet" forever and looked correct. The
  match now lives in **`services/applicants.js`**, pure, and is pinned by
  `test/applicants-smoke.mjs`. **An untestable filter whose failure looks like
  an empty state is the worst shape available; prefer the testable one.**

  * **`forJob` with no job id returns NOTHING, never everything.** A
    pass-through would show one job's page every other job's applicants — the
    screen's purpose exactly inverted. Pinned, and verified by reintroducing.
  * **`raw` is jsonb, so every shape is defended** — null, a string, an array,
    an older blob. A reader that throws on one takes the page down.
  * **A missing job title is left null, never guessed.** Naming the wrong role
    to a recruiter deciding whether to phone somebody is worse than naming none.
  * **`GET /sourcing/staged/:id/resume`** signs the CV for 10 minutes. An
    application's resume is in the PRIVATE bucket; a CSV row's `resume_url` is
    a public URL somebody typed. One column, two meanings — the endpoint passes
    a URL through untouched and signs a path. Org-scoped, role-gated, **404
    (not 403) for another org's row** so ids cannot be probed.
