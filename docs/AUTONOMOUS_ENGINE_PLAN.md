# futé — Autonomous Recruiting Engine: the four-step plan

> **Durable record.** The owner asked for this to be written down so it isn't lost
> between sessions. When summarizing futé for a future context window, carry this
> file forward. It extends `CLAUDE.md`; it supersedes nothing in it.

---

## Context — why we're doing this

futé today is a good ATS + lead-management app where **a human does all the finding**.
Every lead and every candidate arrives because someone typed it into a form or
uploaded a spreadsheet. The outreach that follows is heavily automated; the
*discovery* that precedes it is not automated at all.

The owner's proposition: build the missing half — a system that finds the demand
(companies hiring) and the supply (candidates) off the internet against the same
relevance definition, runs outreach on both branches, and then **reads the resulting
conversations** and tells the user where each thread stands and what to do next.
Two branches, one brain, closed loop.

Nothing on the market does both branches off one relevance engine. That is the bet.

### Decisions made by the owner (2026-07-31)

| Decision | Answer | Consequence |
|---|---|---|
| Budget | **₹0 — free tiers only**, pay later once proven | Free/ToS-clean sources only; every cost is a later switch, not a rewrite |
| Markets | **US and India both** | Build market-agnostic. US coverage is strong free; **India is thin free** — stated honestly below |
| Where it runs | **Inside futé**, not Make | Make free = 1,000 ops/month across 2 scenarios ≈ 150 leads/month total, and becomes per-customer cost if we sell. The engine belongs in the product we own |
| Sequence | **All four steps, in order**, each shipping something visible | This document is the durable record of that order |
| Paid job boards / resume DBs | **None** | Candidate branch runs on GitHub + CSV + the existing pool; adapter framework ready for any account bought later |
| **Anthropic AI key** | **Not funded** | **Everything is rules-first.** AI is a seam that switches on when funded — never a dependency |
| Who is a "lead" | **End clients hiring directly** | Target their HR / TA / hiring managers. Aligns perfectly with free ATS boards, which *are* end-client boards. **Staffing firms get filtered out** |

> **Note on the AI key:** Claude being available in the owner's chat session is *not*
> the same as the app having an API key. futé running unattended at 3am needs its own
> funded `ANTHROPIC_API_KEY`. It has none today, so nothing in this plan may depend on
> one.

---

## What already exists (do not rebuild)

Verified by direct code audit, not assumption.

| Capability | Where | State |
|---|---|---|
| Send loop: windows (lead-local TZ), 30–60s jitter, per-domain hourly cap, per-mailbox daily cap, warm-up ramp, atomic send claim | `index.js:1331` `processPendingEmailSends()` | ✅ production |
| Provider dispatch Microsoft Graph + Gmail, threading with self-heal | `index.js:1209` `deliverOutboundEmail()`, `gmail-provider.js` | ✅ |
| **Declarative sequence engine** — workflows are DB rows; channel registry; enroll/tick/exit | `workflow-engine.js`, `migrations/007`, `routes/wf.js`, `public/js/09-page-workflows.js` | ✅ 7 channels |
| Reply sweep → stamps `replied_at`, moves lead to `Connected`, cancels follow-ups, exits enrollment | `index.js:2169` `sweepMailboxReplies()` | ✅ Microsoft only |
| Bounce/NDR sweep → `email_status='invalid'`, auto-pause mailbox >5% | `index.js:2096`, `deliverability.js` | ✅ |
| Warm-up pool (mailboxes email each other, rescue from Junk) | `warmup-engine.js`, `migrations/009` | ✅ off by default |
| Suppression / opt-out, emergency stop (global + per-manager) | `migrations/006`, `/admin/sending/*` | ✅ |
| Email verification: syntax + DNS MX (free, cached 6h) + disposable block | `email-validation.js` | ✅ free tier live |
| Lead → BD distribution (capacity-aware, freshness-sorted, mailbox round-robin) | `index.js:1658` `/distribute/execute` | ✅ |
| Open-tracking pixel + per-recipient tracking rows | `email-tracking.js`, `routes/tracking.js` | ✅ ad-hoc sends only |
| **Candidate sourcing staging table + dedup + review grid** | `migrations/017`, `sourcing_candidates`, `public/js/32-page-sourcing.js` | ✅ CSV only |
| Rule-based JD parser (sections, skills, salary, location) | `jd-parser.js` (~1100 lines) | ✅ leads only |
| Rule-based match scorer (skills .5 / exp .2 / auth .15 / title .1 / loc .05) | `public/js/38-match-score.js` | ✅ browser only |
| Resume parser — regex rules, AI optional | `resume-parser.js` | ✅ works keyless |
| **The keyless convention**: 5 AI call sites, every one falls back to rules with no key | `routes/ai.js`, `index.js:968`, `bd_recruiter_routes.js:410`, `resume-parser.js:112` | ✅ the pattern we extend |
| Multi-tenancy (`withOrg`/`orgStamp`), reporting-chain scoping | `index.js:64-82`, `hierarchy.js` | ✅ |

## What does not exist (the whole build)

1. **Any internet fetch.** No job-board feed, no scraper, no RSS, no scheduled ingest.
   `POST /sourcing/search` is a hard-coded `501`. Apollo is registered but only its
   `/v1/auth/health` endpoint is ever called.
2. **Any contact discovery.** Nothing turns a company + a name into an email. Hunter
   is wired for *verification* only — `/v2/email-finder` and `/v2/domain-search` are
   never called.
3. **Any conversation analysis.** Reply detection is regex for NDR and opt-out only.
   Email bodies are never read, classified, or scored.
4. **Any next-step suggestion.** Grepped exhaustively — no nudge, no ranking, no
   recommendation anywhere. Reminders are 100% manually created and **nothing ever
   fires them**.
5. **Any durable scheduler.** All seven recurring jobs are `setInterval` inside the
   single Render web service.

### Live defects directly on this path (fixed as part of the work, not filed away)

- **`sourcing_candidates.source_url` is dropped on import.** `importStagedCandidate()`
  never maps it, and the CSV header map sends `linkedin` → `source_url`. **Every
  LinkedIn URL imported through Sourcing is silently lost.** Also drops `external_id`
  and `raw`.
- **The Candidates grid "Add to email sequence" is a dead path.**
  `27-page-applicants.js:232` enrolls `entity_type:'candidate'`, but no channel, no
  context loader, and no `WF_ENTITY_TYPES` entry exists. It silently never sends.
- **Sequence sends are invisible.** The `candidate_email` channel injects no pixel and
  writes no `email_tracking` row. Step 4 cannot work until this is fixed.
- **`jd-parser.js` never runs on `job_orders`.** `primary_skills`/`secondary_skills` —
  the dominant match signal at weight 0.5 — are hand-typed by the BD.
- **`contacts` has no `company_id`** (it hangs off `job_id`). The same person on three
  leads is three unlinked rows; we will cold-email the same human repeatedly.
- **Gmail mailboxes get no reply or bounce detection at all** — both sweeps are
  Graph-only, though `gmail-provider.listMessages/getMessage` exist unused.
- **Org-scoping gaps:** `GET /sourcing/staged`, `/bd-analytics/*`, all of
  `routes/reminders.js` skip `withOrg`.
- **Schema drift:** `schema.sql` no longer matches live (`reminders` especially).

---

## Step 0 — Make automation trustworthy (prerequisite, ~half a day)

**Nothing automated can be believed until this is done.** Render's free tier sleeps
the service on idle, silently killing all seven `setInterval` loops. Today that's
mostly masked by a run-on-boot catch-up. An overnight sourcing crawl would simply
never run.

- `GET /cron/tick?key=…` — shared-secret endpoint that runs due work and reports what
  it did. Idempotent, safe to call repeatedly.
- Driven by **GitHub Actions scheduled workflow** (free, repo already exists) or
  cron-job.org free tier. Keeps the service awake *and* guarantees the tick.
- `engine_runs` table (job, started, finished, counts, error) so the owner can *see*
  that the engine ran last night. **This is the difference between "it's automated"
  and "I trust it."**

---

## Step 1 — The relevance engine (the shared brain)

*Both branches score against the same definition of "relevant." Build it once, first,
or retrofit it painfully later.*

**What the owner sees:** open any job and every candidate in the database is ranked by
fit with a plain-English reason beside each — not just the few already tagged onto
that job. And a job's required skills fill themselves in from the JD instead of being
typed by hand.

### Build
- **Promote match scoring to the server.** Move `public/js/38-match-score.js` logic
  into `match-engine.js` (Node), keeping the exact weights and `{score, band, reasons[]}`
  shape so existing UI and `test/match-score-smoke.mjs` keep working. Expose
  `POST /match/score` and `GET /job-orders/:id/matches` (whole pool, ranked, paged).
  Browser copy becomes a thin caller.
- **Run `jd-parser.js` on `job_orders`.** On create/update, parse `job_description` →
  fill `primary_skills` / `secondary_skills` / `exp_min` / `exp_max` when blank. Fixes
  the weight-0.5 signal being hand-typed. Reuses `parseJobDescription()` as-is.
- **A `requirement` object** — one normalized shape (skills, seniority, location,
  work-auth, industry, rate band) derived from a `job_order` *or* a free-text search
  box. **This is the single input both Step 2 and Step 3 search against.** Persist as
  JSONB on `job_orders.requirement`, mirroring the existing `jobs.research` pattern.
- **Persist scores** (`match_scores`: candidate_id, job_order_id, score, reasons,
  computed_at, engine_version) so ranking doesn't rescan the pool per read — existing
  analytics already full-table-scan and reduce in JS; don't add to that.
- **Semantic matching without cost:** synonym expansion from the existing
  `skill-dictionaries.js` + `learned-skills.json`, not embeddings. Optional AI re-rank
  of the top 20 sits behind the keyless convention — **off, and unnecessary**.

### Files
`match-engine.js` (new) · `jd-parser.js` (reuse) · `bd_recruiter_routes.js` ·
`public/js/38-match-score.js` (becomes a caller) · `27-page-applicants.js` (add the
Match column — the smoke test already claims it exists and it does not) ·
migration `033_match_scores_and_requirement.sql`

---

## Step 2 — The lead branch (find the demand)

*End clients that are hiring → the right POC → why the role exists → outreach.*

**What the owner sees:** a "Find leads" button and a morning review queue. Overnight
the Unassigned pool fills with real companies actively hiring, each carrying a
contact, a verified-or-inferred email, and one line explaining *why* the role is open
— which becomes the opening line of the outreach.

### Where leads come from at ₹0 — and why this fits "end clients" perfectly
- **Employer ATS public job boards — free, documented, ToS-clean, no key:**
  Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co/v0/postings`), Ashby,
  Workable, SmartRecruiters, Recruitee. **These are end clients' own boards** —
  companies running their own hiring, publishing their entire req list as JSON. A
  company with twelve open engineering reqs is a company that needs vendors. Exactly
  the target chosen.
  → New `lead_sources` (org, provider, query config, cadence) + `sourced_jobs_raw`
  (payload, content hash, status new/duplicate/promoted/rejected).
- **Staffing-firm exclusion filter (required).** The owner wants end clients, not
  vendors. A sample Indeed search returned almost entirely staffing firms. Classify
  and drop them: name patterns (Inc/LLC + "staffing|consulting|solutions|technologies"),
  posting volume and title diversity (staffing firms post many unrelated titles across
  many cities), careers-page shape, and a maintained allow/deny list the owner can
  correct from the review queue. Free ATS boards are already mostly end clients, so
  this filter is cheap insurance rather than heavy lifting.
- **Company career pages** via a polite, robots.txt-respecting fetcher for named
  target accounts only — not a crawler.
- **Explicitly NOT:** Indeed or LinkedIn scraping. ToS prohibits it, they actively
  block, and it cannot underpin a product we intend to sell. Already the documented
  principle in `config/sourcing.js` and `SOURCING_AND_SCHEDULING_PLAN.md`.
- **India honesty:** these boards are US/Europe-heavy. **India coverage at ₹0 is
  thin.** For India the free path is career pages for named accounts plus the manual
  entry that already works. Not a code gap — a data-availability fact.

### Finding the POC at ₹0
Tiered, cheapest first, spend nothing unless the free tier fails:
1. **Pattern inference + free verification.** Derive `first.last@`, `flast@`, etc.,
   then run the **existing** `domainHasMx()` + syntax + disposable checks. Confidence-
   scored, never blind-sent.
2. **Free-tier providers, metered:** Hunter free = 25 searches/month —
   `/v2/domain-search` returns the *pattern* for a domain, so one call teaches us
   every person at that company. Cache the pattern, not the person. Apollo free = 125
   lead credits (and **0 export credits**), reserved for high-value accounts only.
3. **`enrichment_cache` keyed by domain** so we never spend twice on one company.
   Also introduce company-level contact identity to fix `contacts`-has-no-`company_id`,
   so the same human isn't cold-emailed once per lead.

### "Why does this job exist" — rule-based, and genuinely strong without AI
The best staffing angle isn't clever prose, it's arithmetic. All of these are free
because we already fetched the posting:
- **Days open + repost count** → *"open 74 days, reposted twice"* — the single most
  persuasive opener a staffing firm has.
- **Simultaneous open reqs at that company** → expansion / team build-out.
- **Same title seen before and reappeared** → backfill / churn.
- **JD language regex** — "newly created role", "due to growth", "backfill",
  "replacing", "expanding the team", "new team" — lifted verbatim from the posting.
- **Seniority mix and salary band vs the market.**

Rules produce a category + confidence + a templated sentence. Lands in the **existing**
`jobs.research.outreach.angle` field the outreach templates already read — **no
template rework**. An AI pass to rephrase it more naturally is a later switch, not a
requirement.

### Then it joins the machine that already exists
Sourced lead → `jd-parser` → staffing-firm filter → dedupe (existing 21-day company
cooldown) → create `jobs` row (`created_by` = system user, stage `Unassigned`) →
**review queue** (approve/reject before distribution — the recommended default so
quality stays controllable) → `/distribute/execute` → sequence engine. **Nothing
downstream of the review queue is new code.**

Add `organizations.ra_mode: manual | auto | hybrid` so today's behaviour is untouched.

### Files
`lead-sources/` (new: one small adapter per board, one shape) · `enrichment.js` (new) ·
`why-hiring.js` (new) · `company-classifier.js` (new) · `routes/lead-sources.js` (new) ·
reuse `jd-parser.js`, `email-validation.js`, `/distribute/execute`, `workflow-engine.js` ·
migration `034_lead_sources.sql` · new **Sourcing → Leads** review screen

---

## Step 3 — The candidate branch (find the supply)

*The mirror image, running off the same Step-1 requirement object.*

**What the owner sees:** on any job order, "Find candidates" → results land in the
existing staging grid, already scored and ranked, dedup-flagged against the current
database. Import the good ones, drop them into a nurture sequence.

### ⚠ The honest constraint — read before expecting parity with Step 2
**At ₹0 there is no legal, free source of candidate contact details at volume.** Not a
build problem — the actual state of the market. LinkedIn is off-limits (ToS, bans, and
Talent Solutions needs partner status). Resume databases are paid and closed, and the
owner confirmed **no existing accounts**. Anyone claiming otherwise is scraping, and
we cannot sell that.

What genuinely works at ₹0:
- **GitHub API** (free, 5,000 req/hr authenticated) — real developers, searchable by
  language/location/activity, many with a public email and a full work history.
  **Legitimate and genuinely good for tech recruiting.** The best free candidate source
  that exists. Ship this first.
- **Stack Overflow / dev.to / public portfolios** — thinner, same mechanism.
- **The existing CSV import path** — already built and working. The moment any board
  account is bought, export → import is high-volume at zero marginal cost.
- **The existing candidate pool** — made dramatically more useful by Step 1's ranking.
  Most desks badly under-mine the database they already own; this is the cheapest real
  win in the whole plan.

Build the adapter framework so a paid source is a small adapter later. Ship GitHub +
CSV + the ranked internal pool now, and be straight that broad multi-vertical candidate
sourcing needs paid data whenever the owner chooses to spend.

### Build
- Implement `POST /sourcing/search` for real (hard-coded `501` today) against the
  **existing** provider registry in `config/sourcing.js` — registry, staging table,
  dedup and review grid are all already built and waiting.
- **Fix the import data loss first** — `source_url`, `external_id`, `raw` must survive
  `importStagedCandidate()`, and `linkedin` must map to `candidates.linkedin_url`.
- Score every staged row with the Step-1 engine; sort the review grid best-fit first.
- **Candidate nurture:** register a real `candidate` entity type — channel + context
  loader + `WF_ENTITY_TYPES` entry — so the dead "Add to email sequence" button works
  and a candidate can be nurtured *before* being attached to a job. Add the tracking
  pixel + `email_tracking` row to the `candidate_email` channel so sequence sends
  become visible (Step 4 depends on this).
- Resume retrieval only where public and permitted; otherwise "request resume" is the
  first sequence step.

### Files
`sourcing/` adapters (new: `github.js` first) · `bd_recruiter_routes.js:1337-1499`
(implement search, fix import mapping) · `index.js` (new `candidate` channel + loader) ·
`public/js/32-page-sourcing.js` (scored results) · migration `035_candidate_sourcing.sql`

---

## Step 4 — Conversation intelligence (close the loop)

*The layer that makes people keep the tab open.*

**What the owner sees:** every lead and candidate carries a plain-English card —
*"They asked about rates on the 12th. You haven't replied in 6 days."* — and the
dashboard opens with a ranked list of what to do today, each with its reason attached.

### Rules-first, and most of the value is in the clock
Without an AI key this is still strong, because the highest-value signals are timing
and direction, not language nuance:
- **Direction + clock** — who spoke last, days since their last message, days since
  ours, whether we ever replied. This alone produces *"waiting on you, 6 days"*, the
  single most useful line in the product.
- **Question detection** — last inbound contains a question → they are blocked on us.
- **Intent keywords** — "not interested", "unsubscribe", "circle back", "next quarter",
  "send me", "rates", "budget", "schedule a call" → a classification floor.
- **Commitment extraction** — dates and "next week"/"after the 15th" via the date
  regexes the parsers already use → promised-date tracking and overdue detection.
- **Reuse `subStageColor()`** in `33-stage-modal.js` — existing regex sentiment
  (green/red/amber), already the closest thing to an outcome signal in the app.

The AI seam (richer summaries, subtle objection detection) plugs in behind the same
keyless convention and switches on when funded. **Nothing in Step 4 waits on it.**

### Build
- **Store the conversation.** Today only the first reply's 280-char snippet survives.
  Add `conversation_messages` (thread id, direction, from, sent_at, quote-stripped
  body). Threading ids are already stored. **Quote-strip and trim** — storage growth
  is the real risk on free Supabase.
- **Extend the sweep to Gmail.** `gmail-provider.listMessages/getMessage` exist and
  **nothing calls them** — Gmail-only mailboxes get no reply detection at all today.
  Worth closing regardless of this plan.
- **Next-best-action** — a ranked daily queue per user across *both* branches, each
  item carrying its reason. Feed it into the **existing** `reminders` table so it
  surfaces in UI already built — and **make reminders actually fire**, since nothing
  fires them today and the feature is inert.
- **One unified timeline.** Today a cross-channel history means manually joining
  `submission_activity` + `email_tracking` + `workflow_step_runs` + `reminders`, and
  one-off sends, opens, replies and notes bypass `submission_activity` entirely. Add
  the missing writes and one read model.

### Files
`conversation-intel.js` (new) · `next-action.js` (new) · `index.js` (sweep extension) ·
`gmail-provider.js` (wire the unused read functions) · `routes/reminders.js` (fire
them; add `withOrg`) · `public/js/05-page-dashboard.js`, `30-page-candidate.js` ·
migration `036_conversation_intel.sql`

---

## Cost reality at ₹0 (stated plainly)

| Thing | Free? | Note |
|---|---|---|
| Employer ATS job feeds (Greenhouse/Lever/Ashby/Workable) | ✅ genuinely free | Backbone of Step 2, and they *are* end-client boards |
| GitHub candidate search | ✅ free, 5k/hr | Backbone of Step 3 |
| Email pattern inference + MX/syntax/disposable verification | ✅ free, already built | Good enough to send on, with confidence scoring |
| Hunter domain-search | 25/month free | Cache the *pattern* per domain, not per person |
| Apollo | 125 lead credits, **0 export credits** | High-value accounts only |
| Scheduler (GitHub Actions / cron-job.org) | ✅ free | Step 0 |
| Supabase, Render | ✅ current free tiers | Watch row growth in Step 4 |
| **Anthropic API** | ❌ **not funded — so nothing depends on it** | Every feature ships rules-first. AI is a switch, not a dependency |

**Volume honesty:** free sources give a real but bounded flow — good for a working desk
and an excellent demo, not a 2,000-seat product. That ceiling is a data contract away,
not a rewrite, because every source is an adapter behind one shape.

## Legal / compliance guardrails (non-negotiable, carry forward)

1. **No scraping of LinkedIn or Indeed.** Public APIs and licensed feeds only.
2. **LinkedIn outreach is prepared, never automated** — profile link + prefilled
   message + log-outcome. The existing `bd_touch` channel already does exactly this.
3. **Candidate PII is regulated in both target markets** — GDPR-style consent and
   deletion under India's DPDP, CAN-SPAM/CCPA in the US. Every sourced person needs a
   provenance record (`source_url`, fetched_at, provider) — another reason the dropped
   `source_url` bug matters.
4. **Unsubscribe honored on both branches.** The suppression list exists; candidate
   sequences must respect it too.

---

## Verification (how each step is proven)

- **Step 0:** leave the app untouched for 2 hours; confirm `engine_runs` still shows
  ticks. Screenshot to the owner.
- **Step 1:** `node --check`; extend `test/match-score-smoke.mjs` (fix its stale
  hard-coded `/home/user/fute-lms-backend/public` path); assert the server and browser
  scorers agree on identical fixtures; screenshot a ranked pool on a real job.
- **Step 2:** point a `lead_source` at a known Greenhouse board, run the tick, show
  real end-client companies in the review queue with POC + reason, and confirm staffing
  firms were filtered. Verify the 21-day cooldown blocks re-import. **Send nothing**
  until the owner approves a queue.
- **Step 3:** run a GitHub search off a real job order; confirm staged rows carry
  `source_url` and score correctly; import one; confirm `linkedin_url` survives.
- **Step 4:** replay a real thread from the test mailbox; confirm the state/next-step
  card reads correctly and a reminder actually fires.
- **Throughout:** `bash test/verify-frontend.sh`; the existing 22 `test/*.mjs` smokes
  stay green; one dev branch, draft PR, screenshots to the owner, merge only on an
  explicit go-ahead. **No live-DB migration without a fresh, explicit approval.**

---

## Suggested first slice

Step 0 + Step 1 together, on one dev branch. It is the smallest piece that is both
visible and load-bearing: the owner sees every candidate in the database ranked
against any job with reasons, and the engine becomes trustworthy enough to build
overnight automation on. It also clears four of the listed defects along the way.
