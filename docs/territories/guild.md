# Guild — memory
> Last written: 2026-09-29 · Session 34: one add-to-job writer (Sourced), Tagged out of jobs, group stage move

## Session 34 (2026-09-29) — "Tagged is for the database" (R-075, D-0057) and the group stage move (R-077)
Owner's notes: *"A candidate when added to job from the candidate section or directly gets into Sourced stage. Tagged is for the database. Inside a job the stage starts from Sourced."* and *"There is no option to change the stage of the candidate by multiple selection in the candidate or the job section."*

**R-059's claim, checked.** `tagOne()` (Session 31) DID create a Sourced submission for every NEW tag (pinned, ran green). The 15 live rows were tagged on 24 Sep BEFORE that deployed, so they only ever became *visible* (the job page merges tag-only rows and labelled them "Tagged"); `submissions` is still empty. Nobody has tagged since.

### What is true now
- **ONE WRITER for "on a job": `core.addCandidateToJob(req, cand, jobOrder, opts)`** in `services/recruiting-core.js`. Found FIVE hand-written writers, no two alike: the tag button (`tagOne`), `POST /submissions` (stamped `submitted_at`, pipeline row said "Moved to Submission"), the sourcing import (pipeline row with NO `org_id`, submission unlinked, no history, job id never org-checked), `POST /pipeline/:id/promote` (took `req.body.stage` unvalidated — a recruiter could promote straight to Placement, law 3 bypassed), and harbour's candidate-email queue (`routes/candidate-outreach.js`, still hand-written — C-0033).
  * ON A JOB = a `submissions` row at `Sourced` (SB- code, `recruiter_id`, org-stamped, **no `submitted_at`**, D-0029) + the sourcing-details row beside it (`candidate_pipeline`), linked both ways, + a `created` null→Sourced history row.
  * **Idempotent:** finds the membership FIRST, so re-adding burns no SB-/PL- codes; `already` is not an error; a half-membership (legacy tag, no submission) is written. **Takes ROWS** loaded by `loadCandidateFor`/`loadJobOrderFor` (org-scoped) and refuses a row whose `org_id` is another company's. A failed details row is `warning`; a failed submission throws.
  * Callers: `POST /pipeline`, `POST /pipeline/bulk` (who is already on the job is read for the whole batch, not per person), `POST /submissions`, `POST /sourcing/staged/:id/import` + `/import-selected`, the `promote` shim. **A new way of adding somebody calls it.**
- **A pipeline row has no state.** Its stage IS its submission's. `pipelineView(row)` → `stage` (Sourced when unlinked) and `pipeline_status` overwritten with the same value (alias, for old screens). The column is written `'Sourced'` and never read (NOT NULL default 'Tagged' — deep drops it later, C-0035). `PATCH /pipeline/:id/status` → **410** (kept as a route so the pins and a stale cached tab get a sentence); `PATCH /pipeline/:id` **400s** a `pipeline_status` instead of ignoring it; `POST /pipeline/:id/promote` is a **deprecated shim** (ensure-on-job, idempotent, refuses any stage but Sourced). Delete it and the 410 route when surface stops calling promote and the legacy rows are healed (move both pins to `RETIRED`).
- **LAW 3 IS A FUNCTION now:** `submissionStages.moveRefusal / requestRefusal` — an ORDERED rule list (role → not_assigned → recruiter_target → with_bd → details → reason → no_change), the order the single move always checked in; `RECRUITER_STAGES`, `ENTRY_STAGE`, `NOT_ACCEPTED` exported. `level:'request'` rules refuse a whole group up front; `level:'row'` rules refuse one row. (The old "only BD may move INTO Submitted to Client" rule was unreachable once the role rule existed — removed rather than left as decoration.)
- **R-077: `moveSubmissions` in `routes/recruiting/submissions.js` IS the stage move.** `PATCH /submissions/:id/stage` = it called with one row; `POST /submissions/bulk-stage` = it called with ≤200. It judges each row, then ONE update per 100 rows, ONE history insert, ONE reminder insert, one `SUBMISSION_ADVANCED` per moved row. A refused row is reported and never spoils the rest; a failed chunk is refused as a chunk (the single move still 500s on a failed write, as before).
- **`GET /submissions?candidate_ids=a,b,c`** — each person's live submissions per job (id, stage normalised, sub_stage, job code/title/client/status); fail-closed (no ids → nothing), ≤200, no contact details, org-scoped, jobs deleted are dropped. It is the Candidates page's "which job?" read.
- `core.readByIds(ids, run)` reads a list of ids 100 at a time and, if the database refuses a chunk (ONE malformed id does that), asks again id by id — otherwise 100 good ids read as "not found", which looks exactly like a normal answer. Use it for any batch by id.
- `core.db` is now built by the core (`deps.db || createDb(supabase)`): **`index.js` has never passed a `db` to `bd_recruiter_routes`** (its header claimed it did), so every route module's `db` was `undefined` and unused. New code here uses `db.forRequest(req)`.
- `logSubmissionActivity(..., req)` org-stamps through models/ and now LOGS a failed write (R-002 counts from this table); `logSubmissionActivities(rows, req)` is the batch form.
- The partial success is finally REPORTED: the import route returned only the candidate, so `job_link_failed` was computed and dropped (`53-page-applied.js` reads it) — it is now on the response; `import-selected` adds `not_added_to_job`.
- Wording: the team feed (`/team/activity`) says "Added to a job" (not "Added a submission", D-0029; not "Tagged to a job", D-0057); the 409 says "This candidate is already on this job." (`code:'already_on_job'`).

### Deliberate behaviour changes (say so when asked)
1. A role that is neither BD nor recruiter (`ra`, `ra_lead`) can no longer move a stage — the single move let them go to ANY stage except Submitted to Client. 2. `promote` no longer takes a stage (it used to create a submission at any stage). 3. `POST /submissions` no longer stamps `submitted_at`, and a `recruiter_id` must be in the caller's company. 4. A group move refuses somebody already at the stage (the single move never has). 5. The 409 text above (surface's `/already tagged/i` regexes stop matching — C-0032).

### API contract for surface (C-0032)
- **`POST /submissions/bulk-stage`** body `{ids:[submission ids], stage, sub_stage?, note?, rejection_reason?, interview_at/_type/_platform/_link/_address/_location?, interviewers?, reminder_date?, reminder_note?}` → **200 `{moved:[ids], refused:[{id, reason}], stage}`** (`moved` and `refused` are in the order sent; together they account for every distinct id). `reason` is a plain sentence (unknown/foreign/deleted/malformed ids all read "…could not be found on a job — they may have been removed."; "Not assigned to this job order."; "…with the BD team now…"; `Already at "Screening".`; "…could not be saved… try again."). **4xx `{error}` for the whole request:** 400 invalid stage / no ids / >200 / Not Accepted without `rejection_reason` / a recruiter group-submitting to BDM ("one at a time"); 403 a role that may not make this move (recruiter → beyond BDM; ra).
- **`GET /submissions?candidate_ids=a,b,c`** → `{submissions:[{id, candidate_id, job_order_id, stage, sub_stage, recruiter_id, job:{id, job_code, job_title, client, status}}]}` (403 for a role that is neither BD nor recruiter; 400 over 200).
- **Pipeline rows** (`GET /job-orders/:id/pipeline`, `POST /pipeline` 201, `PATCH /pipeline/:id`, `GET /candidates/:id/history` `.pipeline[]`) all carry **`stage`**; `pipeline_status` is the same value (alias). `POST /pipeline` → 201 row, or **409 `{error:'This candidate is already on this job.', code:'already_on_job', healed}`**; `POST /pipeline/bulk` → `{added, already, healed, not_found, failed, errors}`. `PATCH /pipeline/:id/status` → 410; `PATCH /pipeline/:id {pipeline_status}` → 400 `code:'no_pipeline_status'`; `POST /pipeline/:id/promote` `{stage:'Sourced'}` → `{pipeline_id, submission, already}` (400 for any other stage).

### Foundry list (C-0034) — pin each, and make each fail once on purpose (all 49 breaks below were run against scratch scenarios and CAUGHT)
*Membership (R-075):* a single add, a bulk add, a direct add and an import each write: a Sourced submission with an SB- code and NO `submitted_at`; the pipeline row written `'Sourced'` (break: `'Tagged'`); both rows org-stamped from the CALLER (break: raw insert → default company); linked both ways (break each direction); a `created` null→Sourced history row (break: remove it). Re-adding → 409 `already_on_job`, no new rows, no SB/PL codes spent (break: skip the find-first); a legacy tag with no submission is HEALED on re-add (break: remove the link step); the roster lists a legacy row as `stage:'Sourced'` (break: drop `pipelineView`); `/candidates/:id/history` pipeline entries carry stage. Cross-company: a foreign job id or candidate id → 404 for single, direct and bulk — *isolate each* (own candidate + foreign job; foreign candidate + own job) or one hides the other; the import onto a foreign job saves the person and returns `job_link_failed` and writes nothing (break: pass a raw `{id}`); the helper throws on a row from another company. `promote` with `stage:'Placement'`/`'Submitted to BDM'` → 400 and nothing written (break: remove the check); `PATCH /pipeline/:id/status` 410; `PATCH /pipeline/:id {pipeline_status}` 400 (break: ignore it). One malformed id in a bulk list must not sink its neighbours (break: `readByIds` without the per-id retry). `recruiter_id` from another company → 400. The team feed never says "Tagged"/"Added a submission".
*Stage moves (R-077):* the rule matrix through `moveRefusal` (each rule removed in turn must fail a named case): role, not_assigned, recruiter_target (LAW 3: recruiter → Submitted to Client/Offer/Placement/Not Accepted/On Hold refused), with_bd, details (recruiter → BDM needs a comment), reason (Not Accepted), no_change (bulk only), precedence (unassigned before stage). Bulk: cap 200 (201 → 400, exactly 200 → 200); the same sentence for unknown/foreign/deleted/malformed ids (id probing — break: read outside the caller's company); one history row per moved person, none for a refused one (break: write none / write for planned rows); reminders only for who moved (a case where a row passes judgement but its write fails); `bdm_approved_by/_at` + action `bdm_approved`; chunking (150 rows, second chunk fails → 100 moved, 50 refused once each, no history for them); a row deleted mid-move is refused, never counted; a failed write is a 200 with every row refused for a group, a 500 for the single. Parity: the SAME sentence and status from the single move and the group move for not_assigned / with_bd / recruiter_target. `GET /submissions`: per-person per-job, normalised stage, foreign/deleted/deleted-job rows absent, no ids → `[]`, >200 → 400, role gate. Registration order: `bulk-stage` and `GET /submissions` above every `/submissions/:id…` (route-shadowing-smoke covers the scan; add the two routes to the pin).

### Found, NOT fixed (open)
- **Removing somebody from the Pipeline tab (✕, `DELETE /pipeline/:id`) removes only the sourcing row — their submission stays**, so they vanish from the tab and stay on the job page, board and counts. No screen deletes a submission at all. Since Session 31, not new. Recommendation: soft-delete both while the submission is still below "Submitted to BDM", refuse (409, "move them to Not Accepted instead") beyond it. Needs the owner's word — it decides what "remove" means after progress.
- The stage move never stamps `submitted_at`/`submitted_by` when somebody reaches Submitted to BDM/Client, so the Reports 8-week trend dates by `created_at` for rows made by the helper. (R-002's counts are from history and unaffected.)
- A pipeline row and its submission each carry rate/employer/availability/notice; editing one does not update the other (the two now START equal).
- BD stage moves are not owner-gated (C-0036). ROADMAP/DECISIONS rows for R-075/R-077 are the orchestrator's.

### Verification
Scratch harness (session scratchpad, NOT in `test/`): the REAL routers through the REAL mounter and models/ over an in-memory PostgREST that enforces the partial unique indexes, defaults `org_id` like the live column, refuses malformed uuids like Postgres and PROJECTS rows to each route's select — membership **73/73**, group/single stage move **93/93**, **49/49 deliberate breaks caught** (first table run caught 32/37: three crashed instead of failing by name, one could not tell "planned" from "moved", one mutated a line a request-level check masks — all fixed; a later cross-tenant case showed the candidate check hiding the job-order check). Full `node test/run-all.mjs` before the memory work: **136/137** — the one failure `pipeline-tag-membership-smoke` (3/11) by design (hand-made core; fixed on a scratch copy to 11/11 with assertions untouched).

### Open here — the legacy heal (SQL, NOT RUN; owner's go-ahead needed; deep applies it, C-0035)
Verified on a throwaway **Postgres 16** built from the repo's real migrations (011–025): all 15 live-shape rows get a Sourced submission dated at `tagged_at`, owned by whoever tagged them, filed under their OWN org; a pair that already had a live submission is only linked; a soft-deleted pipeline row and a soft-deleted submission on the same pair are left alone/don't block; a NULL `tagged_by` works; another company's row keeps its company; SB counter advances by exactly the rows created; a second run changes nothing (table + counter fingerprints byte-identical); a duplicate code mid-run leaves nothing half-applied. Run PREVIEW, then FIX, then CHECK (the editor shows only the last result set). No `submission_activity` backfill on purpose: the 15 legacy `tagged` rows already read "Added to a job" in the team feed and a second line per person would double them.
```sql
-- PREVIEW (read-only). Expect 15 rows: all 'Tagged', submission_id empty.
SELECT cp.pipeline_code, cp.candidate_id, cp.job_order_id, cp.pipeline_status, cp.tagged_at, cp.tagged_by, cp.org_id
  FROM candidate_pipeline cp WHERE cp.deleted_at IS NULL AND cp.submission_id IS NULL ORDER BY cp.tagged_at, cp.id;

-- FIX (one transaction; safe to re-run)
BEGIN;
UPDATE candidate_pipeline cp SET submission_id = s.id, pipeline_status = 'Sourced', updated_at = now()
  FROM submissions s
 WHERE cp.deleted_at IS NULL AND cp.submission_id IS NULL AND s.deleted_at IS NULL
   AND s.candidate_id = cp.candidate_id AND s.job_order_id = cp.job_order_id AND s.org_id = cp.org_id;
UPDATE submissions s SET pipeline_id = cp.id
  FROM candidate_pipeline cp
 WHERE cp.deleted_at IS NULL AND cp.submission_id = s.id AND s.deleted_at IS NULL AND s.pipeline_id IS NULL;
DO $$
DECLARE r RECORD; new_id uuid;
BEGIN
  FOR r IN SELECT cp.* FROM candidate_pipeline cp
            WHERE cp.deleted_at IS NULL AND cp.submission_id IS NULL ORDER BY cp.tagged_at, cp.id
  LOOP
    INSERT INTO submissions (org_id, submission_code, candidate_id, job_order_id, recruiter_id, submitted_by,
                             stage, stage_updated_at, created_at, revision_status,
                             bill_rate, pay_rate, employer_name, availability, notice_period, notes, pipeline_id)
    VALUES (r.org_id, next_id('SB'), r.candidate_id, r.job_order_id, r.tagged_by, r.tagged_by,
            'Sourced', r.tagged_at, r.tagged_at, 'N/A',
            r.bill_rate, r.pay_rate, r.employer_name, r.availability, r.notice_period, r.notes, r.id)
    RETURNING id INTO new_id;
    UPDATE candidate_pipeline SET submission_id = new_id, pipeline_status = 'Sourced', updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;
UPDATE candidate_pipeline SET pipeline_status = 'Sourced' WHERE deleted_at IS NULL AND pipeline_status <> 'Sourced';
COMMIT;

-- CHECK (on the live data expect 0, 0, 0, 0 and 15)
SELECT (SELECT count(*) FROM candidate_pipeline WHERE deleted_at IS NULL AND submission_id IS NULL) AS still_unlinked,
       (SELECT count(*) FROM candidate_pipeline WHERE deleted_at IS NULL AND pipeline_status <> 'Sourced') AS still_saying_a_retired_word,
       (SELECT count(*) FROM candidate_pipeline cp JOIN submissions s ON s.id = cp.submission_id WHERE s.pipeline_id IS DISTINCT FROM cp.id) AS links_that_do_not_agree,
       (SELECT count(*) FROM submissions WHERE stage = 'Sourced' AND submitted_at IS NOT NULL) AS wrongly_stamped_as_submitted,
       (SELECT count(*) FROM submissions WHERE deleted_at IS NULL) AS people_now_on_a_job;
```
Once it has run: remove this block, drop the `promote` shim and the 410 route, and ask deep to drop `candidate_pipeline.pipeline_status`.

## Session 33 (2026-09-28) — a merged company takes its found contacts with it
- **`services/company-merge.js` MERGE_TABLES gained `poc_suggestions`**
  (migration 052 — people the POC finder found for a lead; they record the
  lead's company). A MOVE, not a clear: the leads they belong to move in the
  same merge, so the suggestions follow. The plan sentence names them
  ("… 3 suggested contacts will move …"). Found by company-merge-smoke, which
  scans the migrations for every `company_id` column — the list stays the ONE
  place a new company-pointing table is added. No route change: the merge
  route walks the list.

## Session 31 (2026-09-24)
- **Tagging now puts the candidate ON the job.** `POST /pipeline` (and the new
  `POST /pipeline/bulk`, literal, above every `/pipeline/:id`) go through
  `tagOne()` in `routes/recruiting/pipeline.js`: the `candidate_pipeline` row
  AND a `Sourced` submission via `applicants.submissionRowFor` (no
  submitted_at, D-0029), linked. Measured live before fixing: 15/15 tagged rows
  had no submission, so the job page never showed them. Re-tagging an
  already-tagged person heals a missing submission and still answers 409 — that
  is how the 15 legacy rows get fixed without a data migration (the job page
  also lists tagged-only rows meanwhile). Bulk answers
  `{added, already, not_found, failed, errors}`; foreign-org ids are not_found.
- `POST /candidates` always stamps `owner_id = req.user.id` (owner's call: the
  owner is whoever creates it). PUT still accepts owner_id (admin reassignment
  path, D-0020) — the form no longer sends it.
- `POST /job-orders/rewrite-jd` (literal, above `/job-orders/:id`): rewrites a
  PASTED posting for the New Job form. **No rules fallback by design** — returns
  `{used_ai:false, reason:not_configured|daily_limit|no_answer}` so the page can
  show the subscribe pop-up. `posting-jd` now also returns `ai_reason`.
- Known, not fixed: `POST /submissions` still stamps `submitted_at` on a
  Sourced row (D-0029 violation, pre-existing).
- Pinned by `test/pipeline-tag-membership-smoke.mjs` (real handlers, in-memory
  db; fails when the submission write is removed).

## Session 31 (2026-09-25)
- (Not guild code, but guild's world:) the client page's Emails tab can now be
  a timeline + AI summary (`routes/client-intel.js`, off by default). Client
  ownership for it uses `own.clientOwnerFrom` — job order bd_manager first,
  then lead assigned_to_bd, then creator — the same ladder as everywhere.

## What is true here now
- `bd_recruiter_routes.js` is a **43-line mounter** over
  `routes/recruiting/{job-orders,candidates,submissions,pipeline,lookups,
  sourcing,analytics,outreach}.js`. Shared helpers are built once in
  `services/recruiting-core.js` (+ `services/candidate-fields.js`).
- **62 routes are pinned** by `test/recruiting-routes-mounted.mjs`, which boots
  the real server (Session 34 added `GET /submissions` and `POST /submissions/bulk-stage`,
  not pinned yet — C-0034).
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

## Session 30 round 4 — R-047 round-2 review: `/wf/enroll` had no gate at all

Rampart's round-2 blocker (R47-1, HIGH): `POST /wf/enroll` and
`/wf/enroll-bulk` (`routes/wf.js`) checked NOTHING about `workflow_id`,
`entity_id` or `job_id` before handing them to `engine.enroll` — the contact
context loader and `email` channel (`index.js` ~:3376-3460, gateway's, not
touched) then read `job_id` raw and resolved the SENDING MAILBOX from
whatever job it named. So: own contact (any address) + a colleague's (or
another org's) `job_id` + `any_stage:true` → a queued email from the
colleague's mailbox, filled with THAT lead's position/company, `sent_by` the
caller. Foreign ids reached straight into another org.

Fixed with one shared gate, `gateEnrollTarget()`, called from both routes
before `engine.enroll`:
- **The workflow must be the caller's org's** — `loadWorkflowOrgScoped()`,
  same shape as every other by-id fix this session; a foreign/missing
  workflow_id is now the same 404.
- **`entity_type: 'contact'`** — the contact is looked up org-scoped; if a
  `job_id` is supplied it must equal the contact's OWN `job_id` (never someone
  else's, never used to attach a stranger's job to this contact); the
  resulting job (the contact's own, or none) is then org-scoped and the caller
  must be allowed to ACT on it — `canActOnJob()`, owner or reporting chain via
  `own.inScope(job.assigned_to_bd, scope)`, admin always passes. **Checked and
  extended, not invented:** admin/ra_lead (the pool roles) may also act on a
  still-unassigned pool lead (`own.isPoolLead(job) && scope.seesPool`) — the
  same clause `canSeeLead` already carries for sight, extended to acting
  because distributing the pool IS their job and a pool lead has no owner to
  overrule. A plain BD/recruiter cannot enroll a pool lead's contact.
- **`entity_type: 'submission'`** — org-scoped lookup, then
  `recruiterCanTouchJob(req, submission.job_order_id)` (from
  `services/recruiting-core.js`, built locally in this file with no gateway
  ctx change — mirrors this file's existing self-contained `withOrg`), the
  same rule the submissions/pipeline routes already enforce.
- **`entity_type: 'candidate'`** (nurture, no job) — org-scoped lookup only,
  matching `requireOwnCandidate`'s own reasoning elsewhere in this codebase
  (candidates are shared-to-see inside an org; there is no per-user candidate
  ownership column to check against).
- **Every miss is the SAME 404** (law 3) — a foreign, unowned or nonexistent
  id all read identically; nothing here ever answers 403 (which would confirm
  the record exists).
- `enroll-bulk` runs the identical per-item gate rather than trusting the
  batch shape to be safer than the single call — it is the exact shape the
  report used (own ids mixed with a foreign `job_id` inside one payload), so
  batching the check away would have left the bulk path exploitable while the
  single one wasn't.

**R47-5 (LOW, same review):** `resolveFromMailboxes` treated bd_lead/ra_lead
as org-wide — same bug `GET /wf/sending-mailboxes` had before C-0022, just not
yet fixed here. Narrowed to the reporting chain (mirrors that GET, which sits
20 lines above it in the same file); admin keeps the whole org.

**Not touched:** `index.js`'s `wfEngine.registerContextLoader`/`registerChannel`
code (~3376-3460) is gateway's per the border, and needed no change — the gate
now refuses before that code ever runs, so it never sees a foreign job_id.

**Verification:** `node --check routes/wf.js`; `test/recruiting-routes-mounted.mjs`
(7/7, 64 routes, order unchanged), `test/workflow-gating-smoke.mjs` (25/25),
`test/lead-stage-permission.mjs` (13/13), `test/submission-review-smoke.mjs`
(16/16), `test/candidate-sequence-smoke.mjs` (34/34 — calls `wfEngine.enroll`
directly, so it doesn't exercise the new route-level gate but confirms the
engine itself is untouched), `test/backend-smoke.mjs` (107/107, including the
`/wf/enroll-bulk` dependency-resolution check). Did not run full `npm test`
(other territories mid-edit in the same tree, per this session's other rounds).
No dedicated test exists for the enroll gate itself — worth a foundry pin
(own contact + colleague's job_id → 404; pool lead → ra_lead/admin ok, plain
BD refused; foreign submission/candidate id → 404). Did not commit.

- 2026-09-26 (R-002, R-001): **a submission is counted from how far it GOT, not where it is now** — D-0029's known limit is closed. `services/submission-stages.js` gains `furthestReached`, `countSubmissionsEver` (toBdm/toClient from current + `submission_activity` old/new stages; `stalled` stays about NOW; `recovered` = what the old count dropped) and `timeInStage` (a stay ends at the next recorded change; the current stage runs to now; Placement/Not Accepted are FINAL, never "stuck"; `STUCK_DAYS` 14; legacy names normalised). `routes/recruiting/analytics.js` has one `stageHistoryFor(req, ids)` loader (org-scoped, 200 per query, degrades to no history) used by ALL THREE counts — dashboard tiles, hot jobs, report totals — so the screens cannot disagree again; the report also returns `stage_time` + `stuck_days` + `totals.submissions_recovered`. Live on 2026-09-26 there were 0 submissions, so this is proven by `stage-history-reports-smoke.mjs` (the real handlers), not by live data.

- 2026-09-26 (R-005, closes C-0003): **`/bd-analytics/recruiters` and `/bd-analytics/funnel` DELETED** from `routes/recruiting/analytics.js`. Nothing in `public/js` called either (C-0022 had org+chain-scoped them in Session 30, which made them safe but not useful). Reason to delete rather than keep: the recruiter table counted a submission by CURRENT stage — a third definition beside `services/submission-stages.js`, the exact drift D-0029 exists to stop — and `/reports/recruiting` already carries per-person productivity and the funnel with the same scoping. `test/recruiting-routes-mounted.mjs` now pins 62 live routes AND asserts both retired paths answer 404 (verified: restoring the handlers turns it 7/9). **Extend `/reports/recruiting`; do not bring a second analytics surface back.**

- 2026-09-26 (R-048): `PATCH /admin/recruiting-lookups/:id` now answers a rename onto an existing word with the same friendly 409 as `POST` ("That value already exists in this list.") instead of a raw 500. Uniqueness is per company since migration 050 (deep). `test/lookups-per-org-smoke.mjs` (10) runs the real handlers against a table enforcing the 050 index; verified — the old PATCH fails it.

- 2026-10-01 (R-091): `GET /candidates/:id/documents/:docId/file` (routes/recruiting/candidates.js, after the documents list, before the POST) streams a candidate document through PACE using `services/doc-fetch.js` (`fetchStored`: 3 tries, missing→404 vs temporary→503; `docContentType`). **Only a PDF is sent inline; everything else is `attachment` + `application/octet-stream`** (an uploaded .html must never run from PACE's origin). The signed-URL list endpoint is unchanged (other callers). `test/resume-first-smoke.mjs`.
- 2026-10-01 (R-102): `routes/workflows.js` (guild's) — `/insights/bd/:userId` and `/insights/bd-team` take `?tz=<IANA zone>` and pass it to `services/bd-insights.js`; the monthly email read starts 36 h early and `summarise` trims it to the viewer's window. See gateway.md for the calculation; `test/insights-timezone-smoke.mjs`.

- 2026-10-01 (R-100/R-101): `routes/workflows.js` RA insights rebuilt on `services/ra-insights.js` (see gateway.md). The audit of `routes/recruiting/analytics.js` (`/recruiting-dashboard`, `/reports/recruiting`) found their windows cut on the server's UTC clock and a 7×24 h week — follow-ups R-105; submission counts there agree (both go through `services/submission-stages.js`).

- 2026-10-01 (R-095): `routes/recruiting/outreach.js` — `POST /submissions/:id/interview-invite` reads `interview_tz`, `buildInterviewInviteText(…, tz)` states the time via `services/interview-time.js`. No column for the zone (no migration).

- 2026-10-01 (R-092, D-0066): `routes/recruiting/outreach.js` — `GET /submissions/:id/submission-email/options` + `POST /submissions/:id/submission-email` and `services/submission-email.js` (see the archive "Session 36, round 5"). Rules to keep: résumés only from THIS candidate; no list = latest résumé, empty list = none; the client copy is BD-only; sent after the move is saved; `cc` is passed through `sendMailboxNewMessage`.

- 2026-10-01 (R-105): `routes/recruiting/analytics.js` — `/recruiting-dashboard` week/month (and a recruiter's jobs-assigned) and `/reports/recruiting` + activity-feed `from`/`to` use the viewer's zone via `services/viewer-time.js` (`?tz=`); the week is 7 calendar days (was 7×24 h = 8). The Reports 8-week `trend` buckets are unchanged.

- 2026-10-05 (R-114 stage 1, D-0070): a candidate has ONE main email/phone (`email`, `phone` — unchanged, so every reader and send path keeps working) plus `extra_emails` / `extra_phones` (jsonb lists, migration 056, NOT YET APPLIED to the live DB — apply BEFORE merging, owner's fresh go). `services/contact-points.js` is the one home: `cleanEmailList`/`cleanPhoneList` (trim, lower-case emails, no repeats, never the main, max 10, rejects typed junk OUT LOUD), `allEmails`/`allPhones`, `sharesContactPoint` (the duplicate rule: same name + ANY address/number of either), `makeMain` (swap in ONE row), `firstSuppressed` (the opt-out rule), `extractContactPoints` (every email/phone in a résumé), `normaliseForWrite(src, prior)` (extras NOT sent are left alone — an older page or API caller must never wipe them; a new main is removed from the extras). `routes/recruiting/candidates.js`: POST/PUT clean + store extras, 400 with a plain sentence on a bad extra; PUT refuses (409 `address_opted_out`, nothing written) CHANGING the main to an address on `suppression_list`; check-duplicate takes `extra_emails=a,b` / `extra_phones=a;b`; `findCandidateDuplicates` selects the extras and compares any-to-any. `alt_phone` is retired (migration 056 copies it into `extra_phones`; the submission screen's Home Phone reads `extra_phones[0]`). `loadSuppressedSet` is passed into the recruiting core (`index.js` → `bd_recruiter_routes` → `services/recruiting-core.js`). Not built: searching candidates by an extra address/number; a reply from an EXTRA address is not recognised as the person (D-0070 re-open condition); field history does not track the extras (main email/phone changes still do). Stage 2 (lead contacts, same shape, phones at import) is NOT built.

- 2026-10-05 (R-114 stage 2, R-014, D-0070): LEAD CONTACTS get the same main + extras (`contacts.extra_emails` / `extra_phones`, migration 056 — NOT applied). `services/lead-contacts.js` (the ONE add path): `addLeadContact` cleans and stores extras and REFUSES (400 via `ContactPointError`, a sentence) a typed phone that is not a phone or an extra that is not an address; "already added" now compares EVERY address of the new person with EVERY address of anybody in the org — main or extra, either way round (`lookupExisting` also queries `contains('extra_emails', [addr])`; `findDuplicate` takes the shared address into the pop-up text). `services/contact-points.js` grew the phone rules: `looksLikePhone` (7–15 digits, ( ) + - . and an extension), `splitPhones`, `tidyImportedContact` (an address in the Phone cell becomes the email when the Email cell is not an address — a shifted sheet — and the text that sat in Email becomes the title if the title is empty; a second address in Phone is an extra; several numbers in one cell are main + extras; "N/A" is not a phone) and `describeImportFixes` (the sentence), `suppressedFor` (the send-time question). `services/lead-fill.js` never fills a phone that is not a phone. LIVE DATA, read 2026-10-05: of 921 lead contacts 342 hold a real phone, 230 hold something that is not one, and 80 have a real email ADDRESS in the Phone column with a non-address in Email (77 marked invalid — never emailed). The import now prevents new ones; the existing 80 are NOT repaired (owner's decision — see R-117).

- 2026-10-05 (R-117 groundwork): `tidyImportedContact` also recognises a WHOLE ROW one column off — first name empty, Email not an address, Phone holding one, last name and title present (the exact signature of the 80 live contacts) — and puts each field back (first := last_name cell, last := designation cell, title := email cell, email := phone cell); reported as `row_shifted`. With a first name present only the email is rescued. The import preview's "looks shifted" warning (R-107) stays.

- 2026-10-05: `SUBMISSION_SELECT` and `PIPELINE_SELECT` (`services/recruiting-core.js`) now also carry the candidate's `extra_emails` / `extra_phones`, so the job page's candidate search can find a person by a second address or number (R-114 follows the person into the job list). Additive; the columns exist live since migration 056.

## 2026-10-06 (Session 40) — what the reports count (R-125, D-0077)
`services/report-work.js` is THE definition of the team's work: a candidate reaching Submitted to BDM / Submitted to Client / Interview Scheduled / Placement, dated by the first recorded move into that stage or beyond (history from `submission_activity`; a row with none falls back to its last move). Sourced and Screening are inventory and count for nothing; Not Accepted / On Hold are where work ended or paused. `members()` is both the number and the list behind it (`GET /reports/recruiting/rows`). Work is attributed to `submissions.recruiter_id` (the log's recruiter_id is not reliably the actor). Everyone in the team is a row in `by_user` (0 is shown). `fill_rate` = placements ÷ sent to a client, null when none were sent.

- 2026-10-06 (R-126): `services/sequence-templates.js` (pure) — a sequence step's text = the step's own words, then the person's template, then the org's, then the built-in default; slot `initial` is an alias of `o1`. An unknown template key fails the step with a plain message instead of sending something else.

- 2026-10-06 (R-131): `services/sequence-primary.js` — one Primary per kind per person; only an active sequence of the right kind is offered.

## 2026-10-07 (Session 40, round 5)
- `routes/jobs.js` `POST /jobs/bulk` takes `for_me` (honoured only for bd/bd_lead): the imported leads are `Assigned`, owned by the importer, spread over THEIR connected mailboxes (services/lead-distribution.js, `ignoreRoom`); everyone else's import still lands in the pool as `Unassigned`. Response adds `owned` and `job_ids`. The opened job row (25-workflow-bd.js) shows interviews this week / best matches / quick actions (round 4).

## 2026-10-07 (Session 42) — "can this company be added?" (R-157, D-0090, D-0091)
- The add rule for leads is `services/lead-decision.js`: match a company by website / LinkedIn page / name; an open job order (`job_orders.status = 'Active'`) or a live lead (any stage except Rejected and Future) blocks; then the `company_cooldown_days` cooldown (30 on the live site) counts from the most recent lead of any stage. Owner named in the sentence. Nothing crosses organisations (D-0090). `routes/jobs.js` `POST /jobs` applies it to RAs (as the cooldown did); sourced-lead approval applies it to everyone; BD job-order creation, `/jobs/bulk` and BD/RA-lead/admin manual adds are unchanged and still on their older cooldown-only checks — widening is a one-line change each if the owner wants.

## 2026-10-08 (Session 42) — insights answers carry bounce and open rate (D-0109)
- `routes/workflows.js` `loadBdSummary` (the BD insights read) now also reads the contacts' `email_status` and `email_tracking.open_count` for the person's sent emails and hands them to `services/bd-insights.js` `deliveryStats`; the rates are null (shown "—") when not measured or when the read fails. Definitions in D-0109.

## 2026-10-08 (Session 43) — wording per email ID (R-176, D-0111)
- NEW `services/wording-scope.js` (pure): `isEach`, `mailboxOwn`, `mailboxHasOwnSequence`, `pickRaw` (email ID's own → person's → global), `followupTexts`, `neededKeys`. Keys: `u_<id>_tmpl_scope` ('all' default | 'each'), `ue_<mailboxId>_tmpl_<o1|fu1|fu2>_<subject|body>`. A stored email-ID text is DORMANT unless the person chose 'each'.
- `services/lead-outreach-queue.js`: each lead's first email is in the wording of the email ID it goes out from; a person with 'each' may start from an email ID that has its own first email even with no wording of their own (the others are reported in `needsSequence` with the count of stuck leads); an email ID with its own text is left out of the random rotation. `services/sequence-templates.js`: `settingKeys(bdId,key,mailboxId)`, `pickTemplate({mailboxId})`. `index.js` follow-up engine uses `followupTexts` with the lead's mailbox. `routes/my-setup.js` counts a per-email-ID first email as a started sequence.
- Tests: `wording-scope-smoke` (29, each failed when its behaviour was removed).

## 2026-10-08 (Session 43, third round) — sequences a BD makes themselves (D-0112)
- `routes/wf.js` / `09-page-workflows.js`: a plain BD gets `+ New sequence` and edits / activates only sequences they created; the company's standard and the leads' sequences are listed for them but read-only; another BD's personal sequence is not listed. `sequence-own-smoke` (12; the ownership guard fails when removed). Open with the owner: whether a new person should see the company's standard sequence at all (R-182) and more than two follow-ups in My wording (R-181).

## 2026-10-08 (Session 43, fourth round) — sequences start blank for a plain BD (D-0113)
- A plain `bd` sees only the sequences they created (`routes/wf.js`); BD lead / RA lead / admin see all. The seeded "Standard Sales Outreach" is not listed to new BDs.

## 2026-10-08 (Session 43, fifth round) — D-0114
- Follow-up chains (`services/followup-chain.js`, `followup-steps.js`) now begin at the first send and only for follow-ups the person turned on; old chains (`chain_rules` NULL) unchanged. The Sequences builder is untouched (a contact in an active sequence gets no chain).
