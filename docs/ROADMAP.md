# PACE — the live list

> **What I have suggested, what is done, what is still open.** This file is the
> record; the artifact at **https://claude.ai/artifact/NQ4HUuMfAWJk34g9Vs5EdQ** is the window
> onto it. If the two disagree, **this file wins** and the artifact gets
> corrected.

**Updated**: 2026-09-23 (Session 28, round 6) · **Next id**: `R-034` · **Artifact**:
`NQ4HUuMfAWJk34g9Vs5EdQ` (collections `items`, `shipped`; one document per row,
`doc_id` = the row id, so marking one thing done is a one-document `update`)

---

## ⚠ HOW THIS FILE IS MAINTAINED (D-0030 — read before editing)

The owner asked for this on 2026-09-23, in their own words: *"keep a list of
things that you have suggested me doing and start marking them completed and
pending… strike off the things that are completed, keep updating those things
when they are being edited or changed in a different way than the proposed. And
then bring it up when asked for like whats left and how we can do it."*

Four rules, and the third is the one that is easy to skip:

1. **A suggestion becomes a row the moment it is made** — in the same turn it is
   said out loud, not at the end of the session. A suggestion that lives only in
   a chat window dies with that window; that is the whole reason `DECISIONS.md`
   exists, and this file has the identical exposure.
2. **Status is one of five**, and they are not interchangeable:
   `PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`.
3. **⚠ `CHANGED` IS NOT `DONE`.** If a thing shipped differently from what was
   proposed, the row says **what was proposed, what actually shipped, and why it
   moved**. A row rewritten to match the outcome is a row that has quietly
   erased the fact that the plan was wrong — and the plan being wrong is the
   most useful thing on this page.
4. **Nothing is deleted.** A dropped item keeps its row and says who dropped it
   and when. The same discipline as `DECISIONS.md`: a reversal is a new state,
   never an erasure.

**When the owner asks "what's left"**, read this file — do not reconstruct the
list from memory or from git. Answer with the `PENDING` rows grouped by who is
blocked: **me**, **them**, or **a decision nobody has made yet**.

**Mirror it to the artifact in the same breath** (`ArtifactData`, collections
`items` and `shipped`). The repo is the record; the artifact is how the owner
sees it without reading a file.

---

## ⏳ PENDING — waiting on me

| id | What I suggested | Where it stands |
|---|---|---|
| `R-001` | **Time in stage** — how long a candidate sits at each ATS stage, and which ones rot. Suggested 2026-09-23 as the highest-value next build now that "submission" is defined. | Not started. Owner has not picked it yet. The data is already on `submissions` + `submission_activity`; this is a read, not a migration. |
| `R-002` | **Count a submission from stage HISTORY, not from where it is now.** | Known under-report, shipped deliberately — see `D-0029` "Re-open when". Someone submitted to a client and later marked `Not Accepted` **stops being counted**. Fix is `submission_activity`'s stage history or a `client_submitted_at` column. |
| `R-003` | **A real `job_order_id` column on `sourcing_candidates`** (plus backfill), replacing the Node-side filter. | Deliberately deferred (`D-0028`). Re-open when applicant volume makes the in-Node filter measurable. |
| `R-004` | **Record *why* a send failed** — an error column on `emails` (border request `C-0004`). | Open. This is the known, unfixed incident: a dead mailbox sign-in marks emails `failed` one every ~90s with no retry and **no column recording the reason**, so the honest error message dies with the process. |
| `R-005` | **Org-scope `/bd-analytics/*`, or retire it into `/reports/recruiting`** (`C-0003`). | Open. Legacy endpoints, un-org-scoped. Rampart raised it; gateway owns it. |
| `R-006` | **Fold Reports into the Dashboard**, and hierarchy-scope `/recruiting-dashboard` the way `/reports/recruiting` already is (`C-0005`). | Open, and **the owner asked for this directly** several sessions ago. Still two separate screens. |
| `R-007` | **Wire `/ai/generate-email` to a real screen, or delete it** (`C-0002`). | Open. Reachable only from the orphaned `12-manager-users.js`, and never invoked even there. |
| `R-008` | **Publish the apply link on more than one job.** | One link produced one real applicant in an afternoon. It is the only candidate source that costs nothing to grow. **Reset to zero 2026-09-23** — the published job order was deleted with everything else, so this now means publishing the first real req. |
| `R-030` | **The OpenRouter card reads "Not configured" after a valid key is saved.** | **Found by the owner 2026-09-23**, in the same screenshot that proved AI works. The Test button answers `✓ Key valid · 50 credits remaining` and the card's own status badge still says *Not configured*. The key IS stored and the health check DOES use it — so this is the status badge reading the wrong thing, not a broken save. **A card that says "not configured" about a working provider is the same class of fault as the Sourcing page (D-0026): the screen contradicts the system.** |
| `R-031` | **Confirm which Groq model actually runs.** | The Groq card's model box shows `llama-3.3-70b-versatile`, while the health check that passed reports `openai/gpt-oss-20b` and `openai/gpt-oss-120b`. One of those is a placeholder rather than a stored value — **but a hard-coded model name silently going stale has already cost this project twice**, so it gets checked rather than assumed. |
| `R-032` | **Clean up the orphaned resume files in storage.** | The production reset deleted 35 `candidate_documents` rows; the files themselves are still in the private `candidate-docs` bucket with nothing pointing at them. Inert and not a leak (the bucket is private), but it is not a clean slate until they are gone. |

## ⏳ PENDING — waiting on the owner

| id | What I asked for | Where it stands |
|---|---|---|
| `R-011` | **Look at the new "stalled at BDM" number.** | **Deferred by the owner 2026-09-23 — "not now".** Still true, still worth a look once there is production data to look at. |

## ⏳ PENDING — nobody has decided

| id | The question | Where it stands |
|---|---|---|
| `R-012` | **D-0014 — the row-level interaction brief.** The owner's real design ask was *progressive disclosure*; Session 23 answered it with volume control and was corrected. | **The live design work.** Agreed approach: ONE screen first, then repeat. **Ask before building any of it** — they said the revamp is coming "in sometime". |
| `R-013` | **~1,600 inline font sizes and a comparable number of inline colours in `public/js`.** | Offered as a session of invisible work; **the owner has not answered.** This is the shared root cause of the last two rounds of phone and theme faults — an inline value cannot be re-themed, re-scaled or re-laid-out. Do not start it unasked. |
| `R-014` | **PACE holds almost no contact phone numbers**, so sequence step 3 ("call them") correctly skips nearly always. Either start capturing numbers at import, or redesign that step around email. | **Owner has not chosen.** |
| `R-015` | **Text candidates, not just email (SMS).** | Sketched as a cross-territory journey, never costed. Consent is the gate: SMS consent is not email consent, and the opt-out is a legal one. |
| `R-016` | **CSV import for candidates, with a mapping screen and an undo.** | Sketched, never built. Buyers need to migrate in. |
| `R-017` | **Charge for extra seats.** | Billing is built and switched off; every tier's price is deliberately `null`. That is the owner's call and `services/plans.js` is the one place to set it. |

---

## ✅ DONE — last seven days (2026-09-16 → 2026-09-23)

Newest first. A `CHANGED` row says what moved and why.

| id | What shipped | Landed |
|---|---|---|
| `R-033` | **The production reset.** Every lead, company, contact, email, candidate, submission, job order, pipeline row, document and sourcing row deleted from the live database, and the ID counters reset so the next records are `CN-00001` / `JOB-00001`. **`suppression_list` was deliberately kept** — the people who asked never to be emailed. Wiping that would mean emailing them again, which is a compliance problem rather than a data one. Users, the two organisations, all six mailboxes, sequences, templates and settings survive. Owner chose the full wipe with no backup, knowing the Treplar apply link died with it. | live DB, 2026-09-23 |
| `R-018` **CHANGED** | **Define what a submission is.** *Proposed*: publish one corrected submission count. *Shipped*: **two** numbers plus the gap — `Sent to BDM`, `Sent to client`, and `stalled at BDM`. *Why it moved*: the owner corrected the domain mid-build — *"adding a candidate to a job is not submission"* — and chose "count both, shown separately". A single figure would have hidden the candidates stuck between the two. `D-0029`. | #222, 2026-09-23 |
| `R-019` | **Accepting an applicant actually puts them on the job.** It had been writing only the `candidate_pipeline` tag row while every screen read `submissions.stage` — so an accepted person was in the database and counted nowhere. | #222, 2026-09-23 |
| `R-020` | **An applicant gets a receipt and the job owner gets a nudge.** Best-effort, never awaited, only after the row is saved, and **from the job owner's mailbox or nobody**. | #222, 2026-09-23 |
| `R-021` | **Every applicant is scored against the job they chose themselves.** Unscoreable shows "—", never 0. | #222, 2026-09-23 |
| `R-022` | **`candidates.source` reads "Applicant", not "apply".** | #222, 2026-09-23 |
| `R-023` | **Applicants are visible in two places** — a tab on Candidates and a block on each job order — both reading one queue, with no second import path. `D-0028`. | #221, 2026-09-23 |
| `R-024` | **The Jobs page crash**, plus a guard that asks only "did this screen render at all" across 190 screens. Five browser suites had rendered the broken page and passed: a crashed page outscores a working one on every quality metric. | #220, 2026-09-23 |
| `R-025` | **The protocol is enforced by hooks**, not by hoping a session remembers it. `D-0027`. | 2026-09-22 |
| `R-026` | **The Sourcing page stopped advertising six integrations that do not exist.** `built` is now separated from `available`. `D-0026`. | #218, 2026-09-22 |
| `R-027` | **Candidates can apply to us** — a public apply page per job order. `D-0025`. | #217, 2026-09-22 |
| `R-028` | **One contact block, every pop-up measured on a phone, and a client merge tool.** | #216, 2026-09-18 |
| `R-029` | **"+ New Job" works, and carries its client** — POC required, address captured, cooldown applied. `D-0023`. | #214, 2026-09-17 |
