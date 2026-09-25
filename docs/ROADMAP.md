# PACE — the live list

> **What I have suggested, what is done, what is still open.** This file is the
> record; the artifact at **https://claude.ai/artifact/NQ4HUuMfAWJk34g9Vs5EdQ** is the window
> onto it. If the two disagree, **this file wins** and the artifact gets
> corrected.

**Updated**: 2026-09-23 (Session 28, round 7) · **Next id**: `R-056` · **Artifact**:
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
| `R-001` | **Time in stage** — how long a candidate sits at each ATS stage, and which ones rot. | **Half of it arrived for free with `R-034`.** `durations()` / `heldFor()` already show it **per record** ("held 5 days") in the rewind panel, because the entry above an entry is the end of it. What is still missing is the **aggregate**: the report that says which stage rots across the whole desk. That is now a small read over the same data rather than a build from nothing. |
| `R-002` | **Count a submission from stage HISTORY, not from where it is now.** | Known under-report, shipped deliberately — see `D-0029` "Re-open when". Someone submitted to a client and later marked `Not Accepted` **stops being counted**. Fix is `submission_activity`'s stage history or a `client_submitted_at` column. |
| `R-003` | **A real `job_order_id` column on `sourcing_candidates`** (plus backfill), replacing the Node-side filter. | Deliberately deferred (`D-0028`). Re-open when applicant volume makes the in-Node filter measurable. |
| `R-004` | **CHANGED → absorbed into `R-036` (2026-09-23).** Proposed: just an error column. Shipped: the column plus automatic and manual retry, because the owner asked for the retry. Original row: **Record *why* a send failed** — an error column on `emails` (border request `C-0004`). | Open. This is the known, unfixed incident: a dead mailbox sign-in marks emails `failed` one every ~90s with no retry and **no column recording the reason**, so the honest error message dies with the process. |
| `R-005` | **Org-scope `/bd-analytics/*`, or retire it into `/reports/recruiting`** (`C-0003`). | Open. Legacy endpoints, un-org-scoped. Rampart raised it; gateway owns it. |
| `R-006` | **Fold Reports into the Dashboard**, and hierarchy-scope `/recruiting-dashboard` the way `/reports/recruiting` already is (`C-0005`). | Open, and **the owner asked for this directly** several sessions ago. Still two separate screens. |
| `R-007` | **Wire `/ai/generate-email` to a real screen, or delete it** (`C-0002`). | Open. Reachable only from the orphaned `12-manager-users.js`, and never invoked even there. |
| `R-008` | **Publish the apply link on more than one job.** | One link produced one real applicant in an afternoon. It is the only candidate source that costs nothing to grow. **Reset to zero 2026-09-23** — the published job order was deleted with everything else, so this now means publishing the first real req. |
| `R-036` | **Failed emails retry themselves, and can be retried by hand** (owner asked 2026-09-23, after a fresh import). Design: sort every failure into *temporary* (sign-in hiccup, rate limit, Outlook sync) or *permanent* (bad address, opted out, no mailbox); temporary ones go back in the queue after 15 min → 1 h → 4 h, three tries max, then stop and say so; a mailbox whose sign-in fails is paused for that run instead of burning through the queue; the reason is saved on the email; a **Retry** button on each failed row and **Retry all** on the Email page. Needs migration 046 (four columns on `emails`). Absorbs `R-004`. | **DONE 2026-09-23 (D-0031)** — approved as designed; migration 046 applied; today's 4 failures re-queued at the owner's request. One adjustment: the ladder was first coded as three *sends* in total, which would never have reached the 4-hour wait — it is the first send plus three retries. Triggered by a live incident: 2 of Daniel James's emails failed with "sign-in expired" at 18:06 UTC while 3 more from the same mailbox went out fine minutes later — a passing hiccup, marked failed forever. This also re-opens the parked `D-0006` on its own stated condition (a fresh, visible incident). |
| `R-037` | **Warn on the dashboard when a mailbox's sign-in starts failing**, so it is reconnected before emails pile up behind it. | Owner said yes 2026-09-23. Follows `R-036`: retries survive a hiccup but not a sign-in that is genuinely dead; this makes that visible early. |
| `R-038` | **Let AI write the cold emails the leads engine sends** — one draft per lead, written from that lead's own posting, through the same checker the Generator uses; the templates stay as the fallback. | Suggested 2026-09-23 after the owner asked whether the engine's emails are AI-written. **They are not:** measured that day, 119 queued emails, all filled-in templates (56 from 5 rotating variants, 63 from the single default). AI writes only in Email → Compose → Generator. Cost to weigh: an AI call per lead, against a free daily AI allowance shared with resume parsing and the JD scrub. **2026-09-23: owner said yes (D-0032).** Measured before building: one email ≈ 2,100-2,400 tokens (system prompt ~1,335 + lead ~355 + answer ~230 + model thinking); 100/day ≈ 230k tokens, above the app's own default daily AI cap of 150k. And **all 49 leads in that import carried only a job title** — no description, link or notes — so AI can vary wording and fit the reader's role, but cannot write a researched paragraph. Two questions put to the owner before building: raise the daily AI cap, and whether follow-ups are AI-written too. **Answered (D-0033): cap raised to 400k/400 live; first emails only. DONE — merged as #226 on the owner's "merge it".** |
| `R-040` | **DONE 2026-09-23 (#227).** **Show each AI account's real daily limits in PACE** — read the limit numbers Groq/OpenRouter send back with every answer and show "used / allowed today" on the AI card. | Suggested 2026-09-23 when the owner asked whether the free tiers are enough. The honest answer depended on vendor limits I could not open from the sandbox; PACE already receives them with every reply and throws them away. |
| `R-041` | **DONE 2026-09-23 (#226).** **Use the fast model for title-only leads.** With nothing to research, the big model adds little; the fast one halves pressure on the quality model's free daily allowance. | Suggested 2026-09-23 with R-040. Small change inside `engine-draft`/budget tiering. |
| `R-043` | **DONE 2026-09-23.** A lead's own details on screen (job link, website, industry, salary, other imported columns) and an import that keeps the job link and stops misfiling columns. | Owner asked after a lead replied. **Existing leads have no job link stored** — the old importer never kept it — so re-importing the original file is the only way to recover those. |
| `R-044` | **DONE 2026-09-23.** OpenRouter's free model chosen at runtime from OpenRouter's own list. | The hard-coded free model 404'd when the owner connected OpenRouter; third expired model name. |
| `R-045` | **DONE 2026-09-24 (#229).** **Re-importing a file fills in what an existing lead is missing** (job link, extra columns) instead of skipping it as a duplicate. | Suggested 2026-09-23: the 49 leads imported that day never had their job link stored, and today a re-import skips existing leads, so there is no way to recover it from the app. |
| `R-046` | **DONE 2026-09-24.** **Everyone sees only what they are responsible for** (plus their team's, if they manage one; admin sees everything) — Leads, All email, and an audit of every other screen for the same leak (D-0034). | Owner found it 2026-09-23: BD Lead 1 owns 25 leads and saw 49; the All email tab showed every user all 119 outreach emails. Worked through the territory agents (Rampart audits, Gateway/Guild fix, Foundry pins). |
| `R-047` | **DONE 2026-09-24 (D-0037/D-0038).** **Ask to take over a lead / client / job order** — the request goes to the asker's manager (or the admin if they have none); approving it reassigns the record. | Owner said yes 2026-09-23 (D-0036), while answering the visibility questions: only an owner may act on a client, *"until ownership is changed by permission of the manager"*. Today only an admin can reassign. After R-046. |
| `R-048` | **Let two companies use the same dropdown word** (e.g. both have a "Remote" work type) — the recruiting dropdown lists are now per company, but their database uniqueness rule still is not, so the second company's identical value would be refused. A small migration (deep). | Found by guild 2026-09-24 while scoping `/recruiting-lookups` per company (R-046). Harmless today — one real customer — and must land before a second one. |
| `R-049` | **A "PACE operator" role, separate from a customer's admin** — today any customer's admin can pause sending for EVERY customer, run the background engines, change the shared AI keys and the deployment-wide send times. Fine with one customer; must be split before a second. | Raised by rampart's audit 2026-09-23 (C-0021 X9). A design question for the owner, not built. |
| `R-050` | **Protect two old backup tables** (`emails_purged_20260910`, `follow_ups_closed_20260910`) — made during the 10 Sep email clean-up, they have row security OFF, so they are readable with the public app key. Either turn it on or delete them once no longer needed. | Found 2026-09-24 while adding the take-over table. Needs the owner's OK (a database change). |
| `R-030` | **The OpenRouter card reads "Not configured" after a valid key is saved.** | **Found by the owner 2026-09-23**, in the same screenshot that proved AI works. The Test button answers `✓ Key valid · 50 credits remaining` and the card's own status badge still says *Not configured*. The key IS stored and the health check DOES use it — so this is the status badge reading the wrong thing, not a broken save. **A card that says "not configured" about a working provider is the same class of fault as the Sourcing page (D-0026): the screen contradicts the system.** |
| `R-031` | **Confirm which Groq model actually runs.** | The Groq card's model box shows `llama-3.3-70b-versatile`, while the health check that passed reports `openai/gpt-oss-20b` and `openai/gpt-oss-120b`. One of those is a placeholder rather than a stored value — **but a hard-coded model name silently going stale has already cost this project twice**, so it gets checked rather than assumed. |
| `R-032` | **Clean up the orphaned resume files in storage.** | The production reset deleted 35 `candidate_documents` rows; the files themselves are still in the private `candidate-docs` bucket with nothing pointing at them. Inert and not a leak (the bucket is private), but it is not a clean slate until they are gone. |

## ⏳ PENDING — waiting on the owner

| id | What I asked for | Where it stands |
|---|---|---|
| `R-039` | **Check the sending domain's authentication records (SPF, DKIM, DMARC)** for futeglobal.com — a free 2-minute check at mxtoolbox.com, or send me the result. | Suggested 2026-09-23 while answering the owner's deliverability question. The biggest single factor in inbox placement, and invisible from inside PACE. I could not check it: this sandbox's network blocks DNS lookups. |
| `R-042` | **DONE by the owner 2026-09-23** (connected; exposed R-044). **Re-add the OpenRouter key in Admin → Integrations.** It is no longer saved (health check 2026-09-23 15:40: `openrouter: no key saved`), so Groq is PACE's ONLY AI provider and there is no second free tier to fall back on. | Found 2026-09-23 while answering the free-tier question. Likely lost in the production reset. |
| `R-011` | **Look at the new "stalled at BDM" number.** | **Deferred by the owner 2026-09-23 — "not now".** Still true, still worth a look once there is production data to look at. |

## ⏳ PENDING — nobody has decided

| id | The question | Where it stands |
|---|---|---|
| `R-051` | **Client page: the real email conversation + an AI summary** (owner asked 2026-09-24). One read-only timeline per client from all three email pipelines plus stored replies, better reply-to-contact matching, and a cached 4–6 line AI summary (~4–5k tokens each). Design in `docs/SESSION31_DESIGNS.md` §1. | **BUILT 2026-09-25. Timeline switched ON 2026-09-25 (D-0044); AI button still OFF** (D-0039…D-0043). Emails tab = every email with the client + free facts + a "Generate AI summary" button (owner only, per-person daily allowance, 0 tokens when nothing new, ≤~3,400 tokens per click whatever the history — a 2-year test client cost 1,040). Reply sweep now drops noise. Migration 048. **+ Leads list (owner asked 2026-09-25, "just this lead list … current data"):** the same timeline + button inside each lead's row, with a one-time 90-day catch-up of past replies from each BD's own leads (runs once the switch is on). **Still to build:** the manager's team roll-up and the daily-update section. |
| `R-055` | **One real "sending hours" setting** (owner, 2026-09-25: changed the send time in Admin and nothing else changed). Found: Admin's "Outreach send time" is saved and read by nothing; "Follow-up send time" only sets when follow-ups are QUEUED (India time); the hours every screen shows (8:00–16:00 in each lead's own time zone) have no control at all. Proposal: replace the dead box with a working "Send between __ and __ (lead's local time)" in System Settings, label the follow-up one for what it does. | PENDING — proposed to the owner 2026-09-25, awaiting yes. |
| `R-054` | **Make PACE fit any industry — a per-company playbook** (words, lead stages, buying signals, allowed next steps), recruiting as preset #1. First used by the client summary; later the stages and screens themselves (today recruiting-shaped in code — the stage list lives in six places). | Owner asked 2026-09-24 (D-0039). Intelligence part is designed with R-051; the screens/stages part is a larger separate job, before selling to a non-recruiting company. |
| `R-052` | **Create documents, not only upload them** (owner, 2026-09-24: "We'll design the entire thing later"). | **Parked by the owner.** Starting point when picked up: the formatted-resume generator already in PACE. §2 of the design doc. |
| `R-053` | **The contact-finder engine: 4 POCs per open job** (2 HR/TA, 2 hiring managers by firm size), into a sequence or the outreach engine. Design §3. | **Needs the owner's call on the data source.** Nothing in PACE calls Apollo today and Apollo's free tier has no API — the people search is a paid plan. The title rules (`pocTargets`) are free and can be built first. |
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
| `R-050` | **Session 31 batch** — Leads connected/convert rework, JD link + AI rewrite + subscribe pop-up on New Job, bulk add-to-job, bulk resume upload, owner shown not chosen, tagging puts people on the job (15 live rows were invisible), job page lists everyone with Email about this job, candidate-email From picker / no scroll jump / first email at once / shown in Pending. | #233, merged 2026-09-24 on the owner's "merge it" |
| `R-034` | **The rewind clock.** A small clock button on every lead, job order, candidate and client, opening a panel of every change to that record — exact date and time, how long ago, who did it, and **how long it sat at each stage**. Three history stores normalised into one shape by `services/record-history.js`; migration 045 applied for the three record kinds that had nowhere to write. **Leads and submissions had been recording this since the beginning and nothing had ever shown it.** | #224, 2026-09-23 |
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
