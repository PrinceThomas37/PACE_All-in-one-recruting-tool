# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md` (the rules only; the full history is `docs/CLAUDE_MD_FULL_SESSION34.md`, open it only for a "why").**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the reasoning behind a past decision.

**Updated**: 2026-10-01 (Session 36) · **Last merged**: #271 (`28dce9a`, R-102; before it #269 `58d0d15`) · **Repo**: `PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging to `main` IS the release · **Last merged**: #265 (`4984854`, 2026-09-30, Lead Insights).
**Highest ids:** decision D-0066 · contract C-0036 · next roadmap id `R-107` · next migration `055`.

## ▶ NEXT SESSION — START HERE (updated 2026-10-01, Session 36)

**Session 36 built four of the priority list and MERGED them: PR #269, squash `58d0d15`, 2026-10-01 — live after Render deploys. Nothing is waiting on a branch.** Full suite 155/155 on Node 26 (Node 22: the same suites pass individually). The owner ran short of weekly allowance and said to continue next week.
1. **Built and tested (browser + server suites, each fails with its fix reverted):** R-091 candidate opens on the Resume tab and the résumé loads through PACE; R-097 Needs you today = today on the user's clock; R-093 To/Cc address chips in the mailbox; R-094 search inside a job's candidates. Details: `docs/CONTEXT_ARCHIVE.md` § "Session 36".
2. **R-092, R-098, R-099 are BUILT and merged (R-092 #275; R-098/099 in the round-6 PR — see the archive).** Everything on the owner's list except Boolean search is done. **NEXT:** the audit follow-ups R-103 (`todayIST` forces India's date), R-104 (`/stats` "response rate"), R-105 (Dashboard/Reports windows — needs an owner answer: is "month" rolling 30 days or the calendar month?), R-106 (dashboard lead cards add up in the browser); then **R-096 Boolean search** (its own project: design first). Owner-side checks still open: see the archive's list for rounds 1–6.
3. **Round 4 built (R-095 interview time zones, R-080 out-of-office switch-back) — see the archive; R-100/R-101 merged in #273.** **R-102 is DONE and MERGED for Lead Insights** (PR #271, `28dce9a`; full suite 156/156 on Node 26; the owner's check: open Lead Insights from a non-UTC device and see that "today" changes at your own midnight). Then, in order: **R-095** (interview time zones — every zone), **R-100** (RA Team view; it still has a hard-coded +5.5 h India offset in `16-insights.js`), **R-101**, **R-098 + R-099**, **R-080** (NOT decided — ask the owner: auto-switch back to Valid on the return date, or ask first?), **R-096** (its own project).
4. Standing rules: no helper agents without the owner's words (D-0060); plain English, no code shown; owner-approved PRs are merged by me. Check `search_issues` on Sentry `pace-backend` at the start and tell the owner what it shows (daily routine `trig_01TFL3dY7C9jDaTXmZR55Jee`).

## ✅ SESSION 35 — EVERYTHING IS MERGED AND LIVE (PRs #262–#265). Nothing is waiting on a branch.

**Owner's standing rules:** D-0060 no helper agent without their say-so in their own words (this session used none); read only what the next step needs; D-0062 merge their approved PRs without asking again; they never read code or use GitHub — give them the running app, screenshots, plain English. Dev branch `ccr-bed70da8-ctoaet` is restarted from `origin/main` after each merge (permission given).

**Shipped this session (all live after Render deploys):** stage-change screens + group stage move (R-075/077) · windows: minimise / full screen / close + tray (R-078/079) · "Needs you today" rows do the task (R-073) · Write/Email buttons address the person (R-083/084) · AI summary reads our replies from the live Sent folder (R-085) · From-mailbox picker on every email (R-087) · interview confirmation fix (R-086) · 15 legacy "Tagged" rows healed on the live DB (C-0035 a) · Apollo cost shown before the click (sizing already counted against the daily limit of 100) · candidate email addresses open PACE, not the computer's mail program · **Reject with a reason replaces "remove from a job"** (R-082, D-0062) · **Lead Insights (#264, #265, R-089):** emails were read from a column that does not exist (always 0) — fixed; one pure calculation `services/bd-insights.js` feeds personal and Team views (`GET /insights/bd/:id`, `GET /insights/bd-team`); 7/30 days include today (UTC days); "Response rate" now = real replies (`contacts.replied_at`), Replied % column added.
**Dropped by the owner:** R-081 (a "what last went wrong" line on Admin) — "No do not build R-081".

**Tests:** full `node test/run-all.mjs` was 150/150 on Node 22 and on Node 26 (tarball at `/tmp/claude-0/bk/node-v26.10.0-linux-x64` — gone with the sandbox; fetch `nodejs.org/dist/v26.10.0/...`). New suites this session: stage-group-move 29, window-dock 26, email-carries-person 11, needs-you-today-does 16, sent-side 20, from-mailbox 17, from-picker 12, candidate-email-in-pace 5, reject-reason 9, insights-numbers 17, insights-screens 13. `npm install` first (`node_modules` is not in git).

**Owner-side checks not yet done (I cannot do them from the sandbox):**
1. Live Lead Insights: emails ≈ 311 (matches the Email page), 7-day tile = sum of the chart bars, Replied % vs Conv % differ, personal = Team for the same person.
2. Send a test application through an apply link (dead since 22 Sep; I can send one if told).
3. A real lead's Emails tab with a connected mailbox (Sent-folder reading only proven against a fake mailbox).
4. Windows and the From picker on a phone.

**NEW (2026-09-30 evening): the owner's handwritten notes are R-091…R-096 in the ROADMAP (P1: resume first/preview/download, submission email step; P2: CC row, job candidate search, interview time zone; P3: Boolean search). Notes only — NOTHING built; the owner gives the green signal.** Third page added: R-097/098/099 (dashboard noise — Needs you today, its rules, Client conversations). **The ONE sorted to-do list is the 'PRIORITY ORDER' section at the top of docs/ROADMAP.md (R-091…R-102).** Next roadmap id `R-103`.

**Owner said: WAIT for their green signal before starting any of these.** Choices offered, awaiting their pick: (a) the same one-calculation fix for the **RA Team** view (still computed in the browser); (b) audit **Reports / Dashboard** numbers against Lead Insights; (c) a documentation-only correction of any repo notes still calling the first batch "not live" (this rewrite does most of it); (d) R-080 (switch an out-of-office contact back on the return date) — still their call; (e) the UTC-vs-local-day question (a one-line change in `dayKey`, `services/bd-insights.js`).

**R-090 Sentry error reporter: MERGED (#266, `1be62e7`) and live; `SENTRY_DSN` is set in Render.** Sentry org `pace-ek` (EU), project `pace-backend`; alert rule 1319209 "PACE: new error -> #pace-alerts" posts new errors to the private Slack channel `#pace-alerts` in workspace PACE_all_in_one (the Slack connector is now linked to that workspace). **Slack alert verified by the owner (test notification arrived).** **Daily check routine** `trig_01TFL3dY7C9jDaTXmZR55Jee` ("PACE daily error check", 07:47 America/New_York, Sentry attached by the owner in the claude.ai Routines screen, push + email to the owner): reads Sentry, reports "All quiet" or a plain-English list with proposed fixes; REPORT ONLY (never changes code, merges or deploys). A routine made through the tool cannot carry connectors — the owner must attach them in the Routines UI. Its first report is due 2026-10-01; if none arrives or it says Sentry was unreachable, look at the routine first. At a session start, check `search_issues` on `pace-backend` and tell the owner what it shows. A stray `#pace-alerts` remains in the Century Champions workspace (unreachable now; owner may delete it). D-0063.

**Known limits:** the mailbox's inline reply box is not a window and does not park; the reminder compose keeps its own From box; a window that repaints itself while parked must call `Dock.updateParked` (surface.md). **Before a second customer: R-067** (per-company API keys — today they are deployment-wide).
**Border follow-ups still open:** C-0033 (harbour — candidate-outreach's own add → `core.addCandidateToJob`), C-0034 (foundry pins — partly done), C-0035 (b) (drop the inert `pipeline_status` column, later), C-0036 (rampart — BD stage moves not owner-gated; review `bulk-stage` and `GET /submissions` scoping). Session 34's scratch proofs: `docs/handoff/session-34-harnesses.tar.gz` (delete once the owner is happy).

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
