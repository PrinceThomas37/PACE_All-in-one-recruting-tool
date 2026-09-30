# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md` (now ~19 KB — the rules only; the full history is `docs/CLAUDE_MD_FULL_SESSION34.md`, open it only for a "why").**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the reasoning behind a past decision.

**Updated**: 2026-09-30 (end of Session 35 round 1) · **Repo**: `PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging to `main` IS the release · **Last merged**: #260 (`eae789f`, 2026-09-28, R-069).
**Highest ids:** decision D-0061 · contract C-0036 · next roadmap id `R-089` · next migration `055`.

## ⏸ SESSION 35 — the lot is BUILT on branch `ccr-bed70da8-ctoaet`, draft PR #262 (NOT merged, NOT live)

**The owner's rules, standing:** D-0060 — no helper agent is started or resumed without their say-so in their own words (this whole round used none). Read only what the next step needs. R-088 is DONE (D-0061): small fixes directly, `CLAUDE.md` trimmed, agents on low effort.

| id | What | State |
|---|---|---|
| R-071/072/076 | reminder leaves Dashboard · "Your team" card off · apply links (Session 34) | on the branch; after release open an apply link and send one test application |
| R-075 + R-077 | Sourced inside a job; change many stages at once — screens (C-0032) | **done**; the 15 legacy rows **healed on the live DB 2026-09-30** (C-0035 (a)) |
| R-078/R-079 | minimise / full screen / close windows, tray, records park | **done** (`10a-window-dock.js`) |
| R-073 | Needs-you-today rows do the task | **done** |
| R-083/R-084 | Write button on every contact; Email opens addressed | **done** (`outreachComposeTo`) |
| R-085 | AI summary reads our replies (live Sent folder) | **done** — needs a real mailbox to see; sandbox proves it only against a fake |
| R-086/R-087 | interview confirmation (Gmail bug, default ticked, job details) · From picker everywhere | **done** |
| R-074 | Apollo credits | **answered** (ROADMAP row): the big batches are not PACE; PACE = 1 credit per lookup; suggestion left with the owner |

**Tests:** `node test/run-all.mjs` — 145/146 before the last fix; the one red (`scope-outreach-pickers-smoke`, a test ctx missing the new mailbox rule) is fixed and passes 35/35; **one clean full run + Node 26 (CLAUDE.md) still owed before any merge.** New suites, each verified by deliberate breaks: `stage-group-move-smoke` 29, `window-dock-smoke` 26, `email-carries-person-smoke` 11, `needs-you-today-does-smoke` 16, `sent-side-smoke` 20, `from-mailbox-smoke` 17, `from-picker-smoke` 12. `npm install` first (`node_modules` is not in git).

**Waiting on the owner (all in ROADMAP, plain-English rows):** R-080 (switch a contact back from out-of-office on the return date) · R-081 (a "what last went wrong" line on Admin for the apply page and the resume reader) · R-082 (what "remove from a job" means once someone has moved along) · the Apollo suggestion under R-074 (state the credit cost before the click; count company sizing against the daily limit — today's limit is 100) · **when to merge #262** (it is big: nothing in it is live).

**Known limits, said plainly:** the mailbox's inline reply box is not a window and does not park; the reminder compose keeps its own From box; candidate-row `mailto:` links still open the computer's mail program; a window that repaints itself while parked must call `Dock.updateParked` (surface.md).
**Border follow-ups still open:** C-0033 (harbour — candidate-outreach's own add → `core.addCandidateToJob`), C-0034 (foundry pins — partly done by the new suites), C-0035 (b) (drop the inert `pipeline_status` column, later), C-0036 (rampart — BD stage moves are not owner-gated; review `bulk-stage` and `GET /submissions` scoping).

**Suggested next, once the owner says go:** a real-browser look at the new windows/From picker on a phone (screenshots for the owner) → Node 26 run → merge #262 on their word → then the R-080/R-081/R-082 answers. Session 34's scratch proofs are still in `docs/handoff/session-34-harnesses.tar.gz` (delete once the owner is happy).

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
