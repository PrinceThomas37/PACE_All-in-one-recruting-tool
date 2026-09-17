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

## Log
- **2026-09-17** — Session 26, round 2. Client intake on a direct create: POC
  required, structured address (migration 043), cooldown applied. D-0023.
- **2026-09-17** — Session 26. Fixed "+ New Job" refusing every direct create
  (owner report). Added `services/client-resolve.js` (pure, mine). Org-stamped
  the lead + contacts inserts. `test/new-job-client-smoke.mjs` drives the route
  with a stub database; each guard was verified by reintroducing its own bug.
- **2026-09-09** — seeded. No work done by an agent yet.
