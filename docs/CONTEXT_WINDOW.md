# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-29 22:57 UTC (end of Session 34 — handed to a fresh chat to save tokens) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render,
auto-deploys from `main` — merging to `main` IS the release · **Last merged**: #260 (`eae789f`, 2026-09-28, R-069).
**Highest ids:** decision D-0060 · contract C-0036 · next roadmap id `R-089`.

## ⏸ SESSION 35 STARTS HERE — the owner's rules for this round

1. **D-0060: no helper agent is started or resumed without the owner's say-so, in their own words.**
   Session 34's one message fanned out into ~10 agent runs (320k–670k tokens each, up to three at
   once, some killed by the usage limit and re-run cold) and used two of the owner's usage limits.
   Before any agent: say what it is for and roughly what it costs, and wait for a yes.
2. **Spend tokens like they are the owner's money — they are.** Read only what the next step needs:
   this file, the ROADMAP rows of the lot below, DECISIONS D-0056–D-0060, and the ONE territory memory
   (and contract) for the files being touched. Run targeted suites while working; ONE full run
   (`node test/run-all.mjs`, read the count) before merge, plus Node 26 per CLAUDE.md.
3. **R-088 is the owner's call, open:** cheaper ways of working — (1) small, clear fixes done directly
   without an agent; (2) trim `CLAUDE.md` (~140 KB, read by every message and every agent) down to the
   rules, moving the history to the archive; (3) agents on lower effort with targeted tests. Ask which
   they want before any big job.

## The lot in flight — branch `ccr-bed70da8-ctoaet`, draft PR #262 (NOT for merge yet)

The owner's handwritten notes of 29 Sep, morning (R-071–R-079) and evening (R-083–R-087), one batch.
The ROADMAP row is the detail; this is the state.

| id | Ask | State |
|---|---|---|
| R-071 | A finished reminder leaves the Dashboard | **Done on the branch** (surface + observatory + ledger) |
| R-072 | "Your team" card off the Dashboard (D-0056/D-0059) | **Done on the branch** |
| R-076 | Apply links dead since 22 Sep (a select named `job_orders.owner_id`) | **Done on the branch** — after release: open the link, send one test application |
| R-075 | Inside a job everyone starts at Sourced (D-0057) | **Backend done** (guild). Screens half built (C-0032). 15 legacy rows wait on the owner (C-0035) |
| R-077 | Change many candidates' stage at once | **Backend done** (`POST /submissions/bulk-stage`, `GET /submissions?candidate_ids=`). Screens half built |
| R-078 / R-079 | Minimise / maximise / close windows (D-0058) | **Not started** — three runs died or were stopped before changing anything |
| R-073 | "Needs you today" rows that do the task | Not started — after the windows; dispatch's map is in the row |
| R-074 | Where the Apollo credits went | Waiting on the owner's screenshot; PACE's side counted (39 on 28 Sep) |
| R-083 | Email a POC just added to a lead | Noted, not started |
| R-084 | Email buttons forget who was clicked — "mostly missing" across PACE | Noted, not started (overlaps R-073's lead-drawer find) |
| R-085 | The AI summary misses our own replies | Noted, not started |
| R-086 | Interview confirmation email to the candidate (phone too, with job details) | Noted, not started |
| R-087 | Choose the From address on every email | Noted, not started |

**Waiting on the owner:** R-088 (how to work cheaper) · the 15 legacy "Tagged" rows (C-0035 — SQL written
and verified on a throwaway Postgres, **NOT run**; text in `guild.md` Session 34) · R-082 (what "remove from
a job" means once someone has moved along) · R-080 · R-081 · R-074's screenshot.

**Half-done work, and where it is:**
- `public/js/33-stage-modal.js` (WIP `08955fd`): the group stage move — `openStageModal(idOrIds, …)`,
  `stgApplyGroup` over bulk-stage, per-person results, legacy rows without a submission. It stopped at
  "the Teams button guard, the note wording for a group, and the footer". Still to do for C-0032: the job
  page / Pipeline tab / Candidates page ("which job?") wiring, no "Tagged" inside a job, the
  `/already tagged/i` regexes, the import messages. Contract: `_contracts.md` C-0032; API: `guild.md` Session 34.
- Tests (WIP `08955fd`, foundry): `test/helpers/fake-postgrest.mjs` + `test/helpers/schema-from-migrations.mjs`
  (+ their smokes), `pipeline-tag-membership-smoke` rebuilt on the real core (not re-run yet), three
  tree-scanning suites now skip `.claude/`. Still to do: the "what foundry should pin" lists in `surface.md`,
  `gateway.md` (R-076), `guild.md` (C-0034) and `observatory.md` — each item names its deliberate break.
- **Session 34's scratch proofs** (dispatch, observatory, gateway, guild and surface harnesses, with their
  breaks and the legacy SQL checks) are in `docs/handoff/session-34-harnesses.tar.gz`. Extract to a scratch
  directory — never into `test/` — and delete the tarball once they have become tests.
- Last full suite: **136/137** on Node 22; the red one is `pipeline-tag-membership-smoke` (being rebuilt).
  `npm install` first — `node_modules` is not in git.
- Border follow-ups open: C-0033 (harbour — candidate-outreach's own add → `core.addCandidateToJob`),
  C-0036 (rampart — BD stage moves are not owner-gated; review bulk-stage and `GET /submissions` scoping).

**Suggested order once the owner says go:** finish C-0032 (the screens) → foundry pins this round →
the windows (R-078/R-079) → R-073 + R-084 (they share the compose window) → R-083, R-086, R-087, R-085.

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only**, written **as the work lands** (D-0024) —
a section per round, the closing synthesis last.

A **SessionStart hook** injects the working protocol and a **Stop hook** blocks
finishing with memory unwritten (`node scripts/memory-check.mjs`, D-0027).

## 📋 `docs/ROADMAP.md` — THE LIVE LIST (D-0030)

Every suggestion made to the owner is a row there, **written in the same turn**.
`PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`; nothing deleted;
**`CHANGED` keeps both versions.** "What's left?" → read the file, group by who
is blocked. Mirror every change to artifact **`NQ4HUuMfAWJk34g9Vs5EdQ`**
(`ArtifactData`; collections `items` = open, `shipped` = finished).
**⚠ The page shows only three `lane` values — `me`, `owner`, `decide`.** Any
other lane is INVISIBLE (three rows were, until 2026-09-26). A finished row gets
`status:"done"` in `items` AND a document in `shipped` (`when`, `ref`, `title`,
`sub`; `changed` uses `was`/`now`/`why`); lower `ord` = higher on the page.
**The file wins any disagreement.**

## 🧭 `docs/territories/README.md` BEFORE ANY JOB

Nine territories + `dispatch`. `DECISIONS.md` = what the owner settled (check
before proposing); `CAPABILITIES.md` = what PACE already does (grep before
building); `_contracts.md` = cross-border requests. **`node
scripts/territory-map.mjs` after adding any file** — it caught three orphaned
services on 2026-09-25 (`client-intel`, `lead-posting` → observatory;
`company-daily-cap` → harbour).

## What PACE is

A recruiting **ATS + lead-management SaaS**. Fute Global is a customer. The
owner is the product owner and end user — plain English, screenshots, the live
app; never code or git (`CLAUDE.md`, top).

## What is live right now

Leads engine (import → distribute → **AI-written** first email → template
follow-ups → reply sweep → recycle), the ATS, the outreach generator, candidate
outreach, the in-app mailbox, reminders / "needs you today", the public apply
page, ownership + take-over requests, failed-send retry (D-0031), the rewind
clock, client/lead email timelines with the AI summary button. Billing and
self-serve signup built and **off**.

### Session 32 added (all merged, all live) — the owner said "do all these" (D-0047)

- **#246 R-037** — a **dead-mailbox warning** on all three dashboards
  (`services/mailbox-alerts.js`, `GET /mailboxes/alerts`,
  `60-mailbox-alerts.js`): which mailbox, why in plain words, how many emails
  wait behind it, Reconnect for its owner. Gmail now records refresh failures
  too. **Two are dead today:** kristy.scott@fute-global.com (Microsoft withdrew
  permission, AADSTS65001, since 21 Jul) and probably princethomasfute@gmail.com
  (no refresh since 24 Sep). **R-050** — the two backup tables are empty and
  now locked (migration 049); dropping them is offered, not done. **R-039** —
  both sending domains pass SPF/DKIM/DMARC (futeglobal.com DMARC `p=none`).
- **#247 R-051 done** — "Your client conversations" card under "needs you
  today" (`61-client-digest.js`, `GET /client-intel/digest`), plus a manager's
  **facts-only** team roll-up (D-0040/D-0043: no AI, no email text).
- **#248 R-006/R-001/R-002** — **Reports now live at the foot of the
  Dashboard**; the Reports page and nav item are gone. Submissions are counted
  from **stage history** (`countSubmissionsEver`) — D-0029's under-report is
  closed on tiles, hot jobs and the report alike. **Time in stage** card
  (`timeInStage`, stuck = 14+ days).
- **#249** — retired `/bd-analytics/*` (R-005) and `/ai/generate-email`
  (R-007); **Integrations card** keeps a typed key across redraws and says when
  a tested key is unsaved (R-030 — it was wiping the box); model hints derived
  from the provider table (R-031); **Anthropic quality model was retired**
  (now `claude-sonnet-4-6`; that account also has **no credit**); **OpenRouter
  free picker was choosing music models** (fixed, cache versioned);
  **migration 050** — dropdown words unique per company (R-048); `GET /clients`
  `can_edit` hides document Upload/Delete from non-owners (C-0029); **record
  drawer panes were see-through** (5.5% opaque in dark) — now solid.

### Live switches (read from the DB 2026-09-26 — rows that exist)

| setting | value | meaning |
|---|---|---|
| `sys_client_intel_enabled` | **1** | email timeline ON |
| `sys_client_intel_ai_enabled` | **1** | AI summary button **ON** (D-0047) |
| `sys_engine_ai_first_email` | **1** | AI writes first emails |
| `int_ai_active` | **groq** | Groq leads the chain (gpt-oss-20b / 120b — confirmed working) |
| `ai_daily_token_cap` / `call_cap` | 400,000 / 400 | org's daily AI allowance |
| `followup_send_time` | 18:30 | when follow-ups are QUEUED (IST), not sent |
| *no row* | defaults | `company_daily_first_emails` 2, sending hours 8–16 lead-local |

**⚠ A setting with no row reads its schema DEFAULT** (`config/settings.js`) —
read the default before saying what a switch is set to.

## Migrations — next is **055** · 054 APPLIED 2026-09-28 (poc_suggestions slot 'other') · 053 APPLIED 2026-09-28 (companies.employee_count/size_source/size_checked_at/apollo_org_id) · 052 APPLIED 2026-09-27 (poc_suggestions, re-verified 2026-09-28) · 051 APPLIED 2026-09-27 (company size) · 049/050 on 2026-09-26

049: RLS + revoke on the two backup tables. 050: `recruiting_lookups` unique
index is `(org_id, category, lower(value))`. **SQL/migrations are pre-approved
by the owner (D-0047)** — still state a destructive customer-data change first,
and prove a schema change in a rolled-back probe (see 050's archive entry).

## ⏭ PICK THIS UP FIRST

**Session 35 first: the top of this file** (the lot, paused under D-0060). The items below are older and still open.

1. **Session 33 took two of D-0047's four:** R-012 done (#252), R-053 slices
   1–2 live (#253); the D-0050 round (Search contact per slot, size from
   Apollo, the Leads ×) is LIVE too (#257). **Watch the first real Apollo
   search with the owner** — read `apollo_last_call` / `apollo_last_error`. **R-057** (matching candidates in emails)
   and **R-054** (a playbook per industry) are still deferred — design first.
2. **Tell/remind the owner:** reconnect the two dead mailboxes (above); the
   Anthropic key has no credit (harmless — Groq answers); the apply link on
   "Office Manager/ Bookkeeper" needs sharing (R-008, 0 applicants).
3. Mine, open: **R-049** operator role (before customer #2), R-003. **C-0030**
   (org-scoping debt list) open. **R-032 is DONE and verified live** (#251 + #255, 2026-09-28: 62 files
   scanned, 38 deleted, 24 kept — every kept file referenced).
4. **After #260 is live:** the 14 follow-ups need one Retry (Email → Didn't
   send) unless their last automatic try fell after the release; the stuck
   Lamons follow-up shows as "may have gone out" — check Spencer's Sent first.
   (The "held counted as ready now" gap is closed by R-069.) R-070 is the
   owner's call.

## 🧪 TESTS: 137 SUITES

`npm test` — read the COUNT; never pipe into `tail`. `bash
test/verify-frontend.sh` too. Newest: `send-recovery-smoke` (58: the Gmail
fallback against a fake Google, the boot sweep, the real emails router over two
orgs, the Pending tab in a browser), `leads-search-clear-smoke` (11, a REAL
mouse click), `poc-apollo-smoke` (44), `poc-routes-smoke` (94, a fake Apollo +
migration 052's rules), `poc-finder-ui-smoke` (58, incl. light/dark contrast
of the found cards); `mailbox-alerts-smoke` (22) + `-ui` (12),
`client-digest-ui-smoke` (11), `stage-history-reports-smoke` (10, real
handlers), `reports-smoke` (14, incl. a 390px fit walk), `integration-test-
honesty-smoke` (12), `lookups-per-org-smoke` (10), `client-docs-ownership-smoke`
(15), `overlay-opacity-smoke` (14, now opens the record drawer). **Every new
check was run against the old code and failed there.** Two faults this session
(see-through drawer, blank-box Integrations card) were found by LOOKING at a
screenshot of a green suite — take the screenshot.

## Owner actions outstanding

- Reconnect kristy.scott@fute-global.com and princethomasfute@gmail.com.
- Share the apply link; paste job postings on leads (R-056).
- Optional: drop the two empty backup tables (say the word). Google sign-in
  still needs `GOOGLE_CLIENT_ID`/`SECRET`.

## ⏸ Parked — do NOT re-raise as blocking

`DECISIONS.md` is the authority: pricing `null`, signup off, no timezone
backfill, no attachments on candidate email (D-0012), reassignment only by
request (D-0036–38), documents designed later (R-052), R-057 later (D-0046).

## Traps that will bite you

- **`*.onrender.com` is blocked from this sandbox** — a merge lands, a deploy
  is **unverified**. Check `app_settings` `cron_last_*` rows in Supabase for
  signs of life; never claim you watched it come up.
- **Sandbox Node 22, Render Node 26.** Works-here-fails-there → get Node 26.
- **A guard is vacuous until you watched it fail** — and a green suite is not a
  screen: look at the screenshot (Session 32 found two faults that way).
- **Registration order is load-bearing** in every router
  (`route-shadowing-smoke`).
- **Every reader of a stored email body calls `renderStoredEmail`.**
- **A lead row opens without `render()`** — anything inside it (`58-lead-intel`,
  `59-lead-posting`) fills its own element by id, never re-renders.
- **Never `git add -A`**; never pipe `git push` into `tail`.
- **A squash-merged branch conflicts with `main` on its own files** — after a
  merge, restart the dev branch from `origin/main`
  (`git checkout -B <branch> origin/main`) before new work.
- **Secrets live in `app_settings` (`int_*_api_key`)** — never echo them into
  chat, commits or files (query `length(value)`, never `value`).
- **Hard-coded AI model names expire** — five so far. Check the live
  `ai_last_test` row's `available_models` before trusting one.
- **This sandbox cannot measure smoothness** (software compositing).
