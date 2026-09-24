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

- **2026-09-22 (Session 28, round 3)** — **"ADD TO JOB" MEANT NOTHING, AND THE
  LIVE RECORD PROVED IT.** The owner imported the first real applicant onto a
  job and reported *"its not added as candidate to the job"*. Checked against
  the live database rather than reasoned about: candidate **created**
  (CN-00037), `candidate_pipeline` row **created** ("Tagged"), **zero
  submissions**. `importStagedCandidate` wrote only the pipeline row — but the
  job order's Candidates list, the pipeline board, the funnel and every report
  read **`submissions.stage`**, so the person was in the database, counted
  nowhere, and the job page kept saying "Candidates (0)".

  **A SECOND MEMBERSHIP TABLE IS NOT MEMBERSHIP.** `candidate_pipeline` is a
  tagging layer; `submissions` is what the product means by "on this job".
  Importing with a `job_order_id` now writes BOTH, at stage **`Sourced`** — the
  same first stage a manual add uses, because this is the existing kind of
  membership, not a new one. `applicants.submissionRowFor()` builds the row so
  the stage is pinned by a test rather than trusted; a `23505` is "already on
  this job" and is not an error.

  * **A PARTIAL SUCCESS IS REPORTED, NEVER SWALLOWED.** The candidate is saved
    before the submission is attempted, so a failure there returns
    `job_link_failed` and the page says "Saved to candidates, but not added to
    the job". Reporting a half-success as a clean one is exactly how "Added"
    came to appear over a job reading Candidates (0).
  * **`candidates.source` HOLDS A WORD, NOT AN ID.** It stored the raw provider
    token, so someone who applied through a job link had a Source column
    reading **"apply"** on the record of a real person. `applicants.sourceLabel`
    maps it to **"Applicant"**; an unmapped id passes through, because losing
    provenance is worse than showing a token. This is NOT
    `config/sourcing.js`'s label ("Apply page") — that names the screen a
    recruiter publishes from, this names what the person is.
  * **AN APPLICANT IS SCORED AGAINST THE JOB THEY CHOSE.** `GET
    /sourcing/staged` attaches `match` from `match-engine`, one fetch for the
    distinct jobs applied to rather than a query per applicant. The number
    means more here than anywhere else in PACE: not "who might suit this role"
    but "how well does the person who put their hand up fit the thing they put
    it up for". Scoring is wrapped — a malformed staged row is a missing
    number, never a 500.

- **2026-09-22 (Session 28, round 4)** — **"SUBMISSION" MEANT THREE DIFFERENT
  THINGS IN ONE PRODUCT (D-0029).** The owner: *"define submission, ie job
  submission. adding a candidate to a job is not submission."* Correct, and the
  audit found the word counted three ways at once:
  * Reports **headline** — a LOCAL list of stages (`Submitted to BDM` onward).
  * Dashboard **"Subs this week/month"** — **every row**, any stage.
  * Reports **Hot jobs** — **every row**, any stage.

  So sourcing ten candidates on Monday reported ten submissions on the metric a
  buyer asks about first. **The `submissions` table is MISNAMED** — it holds all
  eleven ATS stages and is really the candidate-on-job pipeline record. A
  storage name had become a business metric.

  **`services/submission-stages.js` is now the one definition** (pure, ordered
  ladder, `isSentToBdm` / `isSentToClient` / `isInPipelineOnly` /
  `countSubmissions`). All three call sites read it. The ladder is ORDERED
  rather than a list of names, because "submitted" means "at or past this
  point" and two hand-maintained lists is exactly how this drifted.

  **Two numbers are published, not one (the owner's call):** `submissions`
  (to BDM — recruiter output, internal) and `client_submissions` (the real
  thing), plus **`stalled_at_bdm`**, which is the gap between them and the
  reason two numbers beat one.

  * **`Not Accepted` and `On Hold` sit OFF the ladder** — neither says how far
    somebody got. They are counted as `offLadder` and reported, never hidden.
  * **An unrecognised stage counts as NOTHING**, never as a submission: a
    renamed stage must under-count loudly rather than inflate silently.
  * **A row created by adding somebody to a job carries no `submitted_at`** —
    stamping a submission date on a `Sourced` row is the same mistake as
    counting it, written into the record.
  * **KNOWN LIMIT (D-0029 re-open):** this keys off the stage a candidate is AT
    NOW. Somebody submitted to a client and later marked `Not Accepted` stops
    being counted, which under-reports. The fix is `submission_activity`'s
    stage history or a `client_submitted_at` column; deferred because the bug
    being fixed was three screens disagreeing.

## Session 28 — job orders and candidates finally keep a trail

Both had **no history of any kind**: a job order's status could move all week,
and a candidate's phone number or owner could change, with nothing recording
who did it or when. Leads (`activity_log`) and submissions
(`submission_activity`) had recorded theirs since the beginning.

- `PUT /job-orders/:id` and `PUT /candidates/:id` now call
  `history.recordFields(...)` from `services/record-history-writer.js` (gateway's).
- **The row is read BEFORE the write.** A history built from the request body
  alone cannot tell a real change from a field resent unchanged, and a trail
  full of no-op rows is one nobody reads.
- The tracked lists (`JOB_ORDER_TRACKED`, `CANDIDATE_TRACKED`) are named at the
  top of each router, so adding a field is a list edit rather than another call
  site.
- The write is **awaited** rather than fired and forgotten — a history row must
  not lose a race with the next edit of the same record — but it swallows its
  own errors, exactly as `logActivity` and `logSubmissionActivity` already do.
  Losing one trail entry is strictly better than losing the save it describes.

## Session 29 — `services/lead-fill.js` (R-045)
A re-imported sheet fills what an existing lead is MISSING, never overwrites:
job fields (`job_url`, salary, location, industry, posted date), the company
website, new `import_extra` keys, and blank contact fields matched by EMAIL
(never by name; never an `@` value into LinkedIn). Owned here beside
`company-cooldown`/`client-resolve` as lead-data vocabulary.

`fillPatch` also refuses a non-profile LinkedIn value (a job posting) for a
contact — only `linkedin.com/in|pub/` is a person (2026-09-23, the
"LinkedIn URL" column that held job links).

## Session 30 — D-0034/D-0035 visibility pass (C-0022, C-0017, C-0003)

Rampart's audit found the recruiting side had almost no org scoping at all
outside `job_orders`/`candidates` list reads, and D-0034/D-0035 (mid-job, the
owner's own answer) added a second dimension — not just "which org" but
"which of MY OWN org's records may this viewer see or touch". Both landed in
one pass across every guild-owned route file.

**Cross-org holes closed (C-0022's list, one by one):**
- `outreach.js` — `resolveEmailAttachments` now takes `orgId` and filters
  `candidate_documents`/`client_documents` by it (was the critical
  exfiltration item — attach another company's résumés or client contracts to
  any email). `interview-invite` and `create-meeting` now org-check the
  submission first.
- `candidates.js` — one `requireOwnCandidate()` gate in front of history,
  PUT, DELETE, notes (GET/POST/DELETE) and documents (GET/POST/DELETE); a
  foreign candidate id 404s everywhere, never 403. Every insert
  (`candidate_notes`, `candidate_documents`) now stamps `org_id` — both were
  misfiling into the default org before.
- `job-orders.js` — from-lead, PUT, DELETE, posting-jd, recruiters
  POST/DELETE, request-assignment, `GET /assignment-requests`, decide, and
  `/users/:id/job-orders` are all org-checked or org-scoped now; every insert
  along the way stamps `org_id`.
- `submissions.js` — the job-order/candidate roster read, POST, both
  PATCHes and DELETE all check the job order (and, on create, the candidate)
  belongs to the caller's org; `candidate_pipeline` insert now stamps org too.
- `pipeline.js` — same shape as submissions: a job-order/candidate-pipeline
  org check sits in front of `recruiterCanTouchJob` on all five routes, since
  that helper (rightly, per its own comment) never checked org — it only ever
  narrowed a pure recruiter, and every other role passed through unconditionally.
- `sourcing.js` — the two staged-candidate-by-id import routes are org-scoped.
- `routes/recruiting/lookups.js` — `/recruiting-lookups` (GET/POST/PATCH/
  DELETE) is org-scoped; inserts stamp org. **Known residual gap for `deep`:**
  the `(category, lower(value))` unique index (migration 016) has no org_id in
  it, so two orgs sharing a value (e.g. "LinkedIn" under `source`) will now
  collide on that index once scoping is real. Needs a migration; not fixed here.
- `routes/wf.js` — definitions GET org-scoped; **POST no longer files a new
  sequence under the hard-coded `'fute'` org slug or a body-supplied
  `org_id`** — it is `req.orgId`, always. PUT/status are org-checked.
  `workflow_steps` inserts now stamp org (they never did). `GET /wf/enrollments`
  is org-scoped and then filtered by the enrollment's lead
  (`services/ownership.js` `canSeeLead`) for the ones that have one —
  candidate/submission-type enrollments (`job_id` null by design) are
  untouched by this pass, a separate and larger ownership question.
  `/wf/enrollments/:id/runs`, pause/resume/exit and `/wf/stats` are org-checked
  or org-scoped. `/wf/sending-mailboxes` is org-scoped and bd_lead/ra_lead are
  narrowed to their own reporting chain, not the whole org.
- **Found while fixing wf.js, not on the original list:** `workflow-engine.js`
  `recordRun()` never stamped `org_id` on `workflow_step_runs` — every step
  execution, for every org, misfiled under the column DEFAULT. Same class of
  bug the fix pattern already named for notes/pipeline/recruiter inserts;
  fixed alongside it.
- `routes/workflows.js` — `bulk-stage`/`bulk-assign` now put the org
  condition **ON the update itself** (never check-then-mutate — a race, and
  twice the code) and report the actual matched-row count. `/insights/
  {ra,bd}/:userId` goes through one `inCallerScope()` (self, reporting chain,
  or admin) and 404s outside it. `/stats` is org-scoped even for admin (was
  reading every customer's volume blended into one number).
- `routes/recruiting/analytics.js` — `/recruiting-dashboard`'s submissions
  query used to fall through unscoped for `ra`/`ra_lead` (neither `isBDM` nor
  `isRecruiter`); every non-admin, non-recruiter role is chain-scoped now.
  `/bd-analytics/*` (ex-**C-0003**, misaddressed to gateway — it lives here)
  is org-scoped and, matching `/reports/recruiting`, chain-scoped for
  non-admin.

**D-0035 — job orders (D3), narrowed mid-job by the owner:**
`services/job-order-visibility.js` (new, pure) is the one place a job order's
client-POC field is named. **Owner = `bd_manager_id`** (plus reporting chain,
plus admin) — the live schema's one column for "who runs this client
relationship"; `created_by`/`source_lead_id` are provenance, not ownership.
The only person-identifying column the schema actually has is
`client_manager` (`client`/`end_client`/`client_job_id` name the CLIENT, a
company, not a person, and stay visible to everyone — a recruiter needs to
know which company a role is for). `list`/`browse`/`detail` in
`job-orders.js` all read the same helper so they cannot disagree, and every
response now carries `poc_visible` so a screen can say "Client contact
visible to the job owner" instead of rendering a blank.

The SAME ownership check now also gates **interaction** — edit, delete,
publish/unpublish the apply link — replacing the old "any BDM role" gate,
per the owner's own words: *"Interaction... is the owner's; the recruiters
ASSIGNED to the job keep adding/working their own candidates on it."*
**`GET /job-orders/:id` no longer 403s an unassigned recruiter** — a job
order's basic detail (title, JD, pay, location) is visible company-wide now;
only the candidate/submission machinery underneath stays gated by
`recruiterCanTouchJob`, unchanged.

⚠ **This is a real capability change, not just a leak closed**, and I did not
coordinate a UI update for it: a BD who is not a job's `bd_manager_id` (or in
their chain) will now see Edit/Delete/Publish buttons that 403 when clicked,
the exact "looks actionable, isn't" shape CLAUDE.md warns against (D-0020).
**Flagging for surface**: those buttons should be conditioned on the job's own
`poc_visible`/an equivalent "am I the owner" field the job-order payload now
carries, or hidden for a non-owner.

**Deliberately not tightened**, named rather than silently skipped: recruiter
assignment (POST/DELETE `/job-orders/:id/recruiters`) and
`/assignment-requests/:id/decide` stayed `isBDM`-gated — D-0035 didn't name
them and guessing past what was asked felt like the wrong risk mid-pass.

**D-0035 — clients (D2), gateway's definition, mirrored here:**
`POST /companies/:id/email` (`outreach.js`) now requires
`requireClientOwner()` — a byte-for-byte mirror of gateway's
`routes/companies.js` `clientOwnerId`/`requireClientOwner` (owner =
job order's `bd_manager_id` → lead's `assigned_to_bd` → `companies.created_by`;
admin always passes). Mirrored, not shared, because `routes/companies.js`
exports only its router — **if gateway's version changes, this copy must
change with it**, and that drift risk is exactly why a future contract should
ask gateway to export the function instead.

**D-0035 — D5 (duplicate check), both endpoints PACE has:**
`routes/lookups.js` `POST /contacts/check-email` and `routes/workflows.js`
`POST /jobs/check-duplicates` are both org-scoped now (neither had any org
filter) and answer only **whose lead it is and since when** — never the
matched lead's own contact name, position or full company. The two responses
deliberately use different field names because each already had (or was
given) its own frontend contract: `check-email` → `{duplicate, days_ago,
added_by, company}` (matches `52-poc-block.js`, which already read
`d.added_by` — a field the backend had never once sent, so this also revives
a dead UI feature); `check-duplicates` → `{email, duplicate, owner_name,
since}` (the shape gateway specified for `14-mailmerge-engine.js`, which
surface will adapt to read).

**Verification:** `node --check` on every touched file;
`test/recruiting-routes-mounted.mjs` (7/7, all 64 routes still mounted, order
unchanged), `test/stage-consolidation-smoke.mjs`, `test/workflow-gating-smoke.mjs`,
`test/lead-stage-permission.mjs`, `test/submission-review-smoke.mjs`,
`test/submission-stages-smoke.mjs`, `test/applicants-smoke.mjs`,
`test/job-candidate-updates-smoke.mjs`, `test/candidate-sequence-smoke.mjs`,
`test/org-scoping-routes-smoke.mjs`, `test/ownership-smoke.mjs` — all green.
`test/org-scoping-guard-smoke.mjs` fails on its `KNOWN_DEBT` snapshot, which
is now STALE for entries in `routes/workflows.js` and `routes/lookups.js` that
this pass fixed — that file is foundry's, flagged in their report rather than
edited here. Did not run the full `npm test` (other territories mid-edit in
the same tree).

**For foundry**, worth pinning (none written — `test/` is not mine):
`resolveEmailAttachments` drops a foreign-org document silently rather than
attaching it; `job-orders.js` never returns `client_manager` to a non-owner
and always returns it to the owner/chain/admin; neither `check-email` nor
`check-duplicates` ever includes `contact_name`/`position`/full `company` in
its response; `POST /wf/definitions` never accepts a body-supplied `org_id`
or files under `'fute'`; and `workflow_step_runs` rows always carry the
enrollment's `org_id`.

## Session 30, round 2 — rampart's review fixes (2026-09-24)

Rampart reviewed the C-0022 pass and found ten issues in guild's files (two
blockers, plus eight D-0035 write-gate gaps). All fixed in one pass:

- **BLOCKER, own regression:** `routes/recruiting/outreach.js`'s C-0022 edit
  deleted `const MAX_EMAIL_ATTACH_BYTES` while `resolveEmailAttachments` still
  read it inside a `try/catch` — every document lookup threw, was swallowed,
  and every attachment silently vanished from candidate/client emails.
  Restored above the function. **Verified by actually exercising the handler**
  (stubbed supabase/mailbox, captured what `POST /candidates/email` passed to
  `sendMailboxNewMessage`) rather than trusting `node --check` — a scope error
  is a runtime error and only running the code finds it. Grepped every other
  file this session touched for a deleted top-level `const`/`function` still
  referenced elsewhere; `MAX_EMAIL_ATTACH_BYTES` was the only one.
- `POST /job-orders/from-lead/:jobId` (job-orders.js): now requires the caller
  own the LEAD being converted (`assigned_to_bd` in their reporting-chain scope,
  or admin) — closing the "convert a colleague's Connected lead and take their
  client" hole — and a body-supplied `bd_manager_id` must be a real user in the
  caller's own org AND either the caller or someone in their chain.
- `POST /jobs/bulk-stage` (routes/workflows.js): admin/ra_lead (the pool roles
  that already run `/distribute/*`) keep unrestricted access; bd/bd_lead are
  now narrowed to lead ids whose `assigned_to_bd` is in their own chain scope —
  a lead outside it is silently dropped from the batch, never a 403.
- `DELETE /submissions/:id` and `DELETE /pipeline/:id`: a recruiter may delete
  only their own (`recruiter_id`/`tagged_by`) or one on a job they're assigned
  to (`recruiterCanTouchJob`); BD needs owner/chain/admin, same test as every
  other job-order write.
- `POST /job-orders/:id/parse-jd?apply=1`: the WRITE (not the dry-run preview)
  is now owner/chain/admin-gated, and the returned `job_order` goes through
  `jobOrderVisibility.stripJobOrderPoc` (currently a no-op since only the owner
  reaches that line, kept so the response can never disagree with list/detail
  if the gate ever loosens).
- `POST /job-orders/:id/recruiters` and `POST /assignment-requests/:id/decide`:
  both now require the caller own the job order (owner/chain/admin); the
  recruiters route also verifies every `recruiter_id` in the body is a real
  user in the caller's own org before upserting `recruiter_assignments`.
- `GET /users/:id/job-orders`: now runs through `stripJobOrdersPoc` like every
  other job-order list.
- `GET /wf/enrollments`: the ownership filter used to run AFTER `.limit(500)`,
  which could short a non-admin's page arbitrarily (even to zero, if the first
  500 org rows all belonged to other people). Now pages through in 500-row,
  order-preserved batches, filtering each batch, until 500 VISIBLE rows are
  collected or the org's rows run out. Admin (`scope.all`) still takes the
  first batch, unchanged.
- **Not touched, flagged instead:** `DELETE /job-orders/:id/recruiters/:rid`
  is still "any BDM" — the review only named the POST route, and adding an
  unrequested gate mid-fix felt like the wrong risk; same shape as
  `POST /job-orders/:id/recruiters` and worth the same fix in a follow-up.

**Verification:** `node --check` on every touched file; grepped the whole
C-0022 diff for deleted top-level declarations (only the one regression);
`test/recruiting-routes-mounted.mjs` (7/7), `test/stage-consolidation-smoke.mjs`,
`test/workflow-gating-smoke.mjs`, `test/lead-stage-permission.mjs`,
`test/submission-review-smoke.mjs`, `test/org-scoping-routes-smoke.mjs`,
`test/ownership-smoke.mjs`, `test/candidate-sequence-smoke.mjs`,
`test/submission-stages-smoke.mjs`, `test/applicants-smoke.mjs`,
`test/job-candidate-updates-smoke.mjs` — all green. No suite covers
`bulk-stage`'s ownership narrowing or the new owner gates directly — worth
pinning by foundry (see handback report). Did not run full `npm test`
(gateway/harbour mid-edit in the same tree).

## Session 30 addendum — scripts/territory-map.mjs
Added `services/job-order-visibility.js` to guild's `own` list (a config
entry, same as prior sessions' `client-resolve.js`/`lead-fill.js` additions)
and ran `node scripts/territory-map.mjs` to regenerate `_map.json`/
`island.html` — 27 files, 6,397 lines now attributed here.


## Session 30 round 3 — D-0038 wiring: lead_id + can_request, and one ownership ladder
- **The two D5 duplicate-check responses now carry `lead_id` and
  `can_request`**, so the screen can offer "Ask to take over" straight off the
  warning (D-0038) without a second lookup and without leaking anything new —
  still only `owner_name`/`since` (or `added_by`/`company`) about the OTHER
  lead. `can_request` is the narrow question the field name promises: `false`
  only when the caller already owns that lead (`assigned_to_bd === req.user.id`)
  or there is no lead to ask for; it is deliberately NOT the full
  `ownership.canRequestTakeover` check (role, org, already-pending) — that
  runs for real, server-side, when `POST /ownership-requests` is actually
  called. This just decides whether the button renders.
  - `routes/workflows.js` `POST /jobs/check-duplicates` → `{email, duplicate,
    owner_name, since, lead_id, can_request}` per duplicate.
  - `routes/lookups.js` `POST /contacts/check-email` → `{duplicate, days_ago,
    added_by, company, lead_id, can_request}`.
- **`routes/recruiting/outreach.js`'s `clientOwnerId` no longer re-derives the
  client ownership ladder** — it fetches the same rows (job orders, leads, the
  company) and hands them to rampart's `services/ownership.js`
  `clientOwnerFrom`, the one place D-0038 names for this ladder. Was a
  byte-for-byte mirror of gateway's `routes/companies.js` copy; now both read
  the same function instead of needing to stay in sync by hand.
- **Verification:** `node --check` on all three touched files;
  `test/workflow-gating-smoke.mjs` (25/25), `test/recruiting-routes-mounted.mjs`
  (7/7, 64 routes, order unchanged), `test/lead-stage-permission.mjs` (13/13),
  `test/submission-review-smoke.mjs` (16/16). Did not run full `npm test`; did
  not commit.

## Session 30 round 2 — Rampart re-review R2/R3
`DELETE /job-orders/:id/recruiters/:rid` (routes/recruiting/job-orders.js
~:778) checked `isBDM` only, so any BD manager in the org could unassign a
recruiter from a job order they don't own; it now 404s when the job order
isn't found in the caller's org and applies the same
`jobOrderVisibility.isJobOrderOwner(jo, await pocScope(req))` gate the
assignment POST already uses. Separately, D-0035 says recruiters work their
OWN candidates, but the submission (routes/recruiting/submissions.js ~:249-252)
and pipeline (routes/recruiting/pipeline.js ~:200-203) deletes accepted
`|| recruiterCanTouchJob`, letting a recruiter on a shared job order delete a
colleague recruiter's row — tightened both to `recruiter_id`/`tagged_by ===
req.user.id` only for a pure recruiter; BD owner/chain/admin unchanged.
Verified: `node --check` on all three files; `test/recruiting-routes-mounted.mjs`
(7/7), `test/submission-review-smoke.mjs` (16/16), `test/workflow-gating-smoke.mjs`
(25/25), `test/lead-stage-permission.mjs` (13/13), `test/stage-consolidation-smoke.mjs`
(14/14) — all green. No dedicated pipeline-delete test file exists yet
(foundry writing tests concurrently). Did not run full `npm test`; did not commit.


## Session 30 round 3 — R-047 do-not-ship fixes (lead_id / can_request / clientOwnerId bound)
Rampart's blocker: a lead id on the duplicate responses is handed to exactly
the people D-0034 hides that lead from. Fixed per rampart's chosen option (a)
— **removed `lead_id` from both responses**; the take-over path resolves the
lead from the typed/matched email server-side (D-0038's
`viaDuplicateEmailMatch`), never from an id the browser hands back.
- `routes/workflows.js` `POST /jobs/check-duplicates` → now
  `{email, duplicate, owner_name, since, can_request}` per duplicate (was
  `+lead_id`). `can_request` is no longer `assigned_to_bd !== caller` — it is
  computed with `own.canRequestTakeover({kind:'lead', record: job, requester,
  scope, viaDuplicateEmailMatch:true})` (F2), so an RA, a recruiter or an admin
  never sees a link that would then refuse (role/admin/already-pending are now
  checked before the link is offered). Needs `job.org_id`/`job.deleted_at` in
  the select for that check to run — added.
- `routes/lookups.js` `POST /contacts/check-email` → now
  `{duplicate, days_ago, added_by, can_request}` (was
  `+company, +lead_id`; D5 says owner + date only). Same `canRequestTakeover`
  call, same reasoning. Added `own`/`reportingChainIds` imports (same fallback
  pattern as `workflows.js`/`wf.js` for a narrower mount).
- **Left for gateway/surface — not mine to touch:** `public/js/52-poc-block.js`
  (:139-142) reads `d.company` and gates/builds its "Ask to take over" link on
  `d.can_request && d.lead_id`, and `public/js/14-mailmerge-engine.js`
  (:595-599) does the same for the batch duplicate-import warning. Both fields
  are now gone from these two responses. `otOpen('lead', recordId, viaEmail,
  …)` (`56-ownership-requests.js`) still takes a `recordId` — with no lead id
  to hand it for these two call sites, gateway's `/ownership-requests` (or the
  `can-request` GET) needs a mode that resolves the record from `via_email`
  alone for the lead case, and surface's two files need to stop reading
  `lead_id`/`company` and call `otOpen` with no record id (or whatever shape
  gateway picks). `can_request` alone is now sufficient to decide whether to
  draw the link at all.
- `routes/recruiting/outreach.js`'s `clientOwnerId` (L4): the three queries
  feeding `clientOwnerFrom` had gone unbounded (every JO/lead of a company,
  unordered) when this was centralised onto rampart's ladder — restored the
  original bound (`.not(<owner field>, 'is', null).order('created_at',
  {ascending:false}).limit(1)` on both the job_orders and jobs queries), so an
  old client with years of closed job orders/recycled leads still costs two
  single-row fetches, not two full-table ones.
- **Verification:** `node --check` on all three touched files;
  `test/ownership-smoke.mjs` (69/69), `test/ownership-requests-smoke.mjs`
  (36/36), `test/recruiting-routes-mounted.mjs` (7/7, 64 routes, order
  unchanged), `test/lead-stage-permission.mjs` (13/13),
  `test/route-shadowing-smoke.mjs` (9/9), `test/workflow-gating-smoke.mjs`
  (25/25), `test/submission-review-smoke.mjs` (16/16),
  `test/stage-consolidation-smoke.mjs` (14/14) — all green. Did not run full
  `npm test`; did not commit.
