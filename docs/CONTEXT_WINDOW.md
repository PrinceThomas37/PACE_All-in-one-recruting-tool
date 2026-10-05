# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md` (the rules only; the full history is `docs/CLAUDE_MD_FULL_SESSION34.md`, open it only for a "why").**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the reasoning behind a past decision.

**Updated**: 2026-10-05 (Session 38) · **Last merged to `main`**: #289 (`38bdc2e`, R-114 several emails/phones) after #288 (`88d83c8`) · **Repo**: `PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging to `main` IS the release.
**Highest ids:** decision D-0068 · contract C-0036 · next roadmap id `R-118` · next migration `057`.

## ▶ SESSION 38 (2026-10-05) — START HERE
**MERGED: #288** (squash `88d83c8`, on the owner's "Okay merge 288"; full suite 166/166 on Node 22 AND Node 26): R-111 Gmail previews show real text (`services/html-entities.js`), R-112 the opened email in a long thread is big + an **Expand message** button, R-108 stale test fixed, R-115 `ARCHITECTURE.md` pass 1, roadmap + roadmap page tidied, ten orphan files claimed. Live after the Render deploy (unverified from the sandbox — ask the owner to hard-refresh, open a long thread, click Expand message).
**The owner's 1 Oct handwritten notes** (once only on the unmerged branch `ccr-63ed4fab-omfwgz`, draft PR #282, now CLOSED as superseded) are **R-111…R-116** on main. R-113 closed (stale tab). **R-116 DROPPED** — the owner said no to a "new version is ready" notice (D-0069). Daily Sentry routine `trig_01TFL3dY7C9jDaTXmZR55Jee` is back ON (next run 07:47 New York).
**MERGED: #289 (5 Oct, squash `38bdc2e`, on the owner's "merge it") — R-114 several emails/phones per person (candidates + lead contacts + phones at import).** Migration 056 was applied to the live DB first (owner's go); the 80 shifted lead contacts were REPAIRED (R-117 DONE; backup `backups.contacts_r117`, private; nothing sent — those 37 leads need re-assigning to generate first emails). Full suite 172/172 on Node 22 AND Node 26. Live after the Render deploy (unverified from the sandbox). **Owner-side checks:** hard-refresh; open a lead's contact (phone shown, "+ add another email / number", Make main); open a candidate ("More emails / More numbers"). Not built: search by an extra address, reply-from-extra-address matching. Gap: `processPendingEmailSends` is not mounted in a test (its rule is the pure `suppressedFor`).
**Found 5 Oct:** the owner's Inbox showed "Invalid token" = their PACE sign-in (8 h JWT) had expired in an open tab, NOT Gmail — sign out/in fixes it. **R-118** (say "your session expired, sign in again" plainly) is offered, awaiting the owner. Memory for the merged state was written on a follow-up docs branch.
**What's left (see `docs/ROADMAP.md`):** owner's call — R-118 (small), **R-096 Boolean search** (design questions first; its own project), R-110 Stage B (open tracking beyond BD Lead 1), R-082 ("remove from a job"), R-081 (Admin shows what last failed), R-057/R-061/R-062 (Apollo/match ideas), R-013 (inline styles, not asked). Mine, when the owner says go: `ARCHITECTURE.md` pass 2 (R-115), **R-067 per-company API keys + R-049 operator role before a SECOND customer**. Nobody decided: R-054 per-industry playbook, R-052, R-053, R-015 SMS, R-016 CSV import for candidates, R-017 seat pricing.

## ▶ SESSION 37 (2026-10-02) — live-data fix + R-107 merged
Owner double-assigned a day's import. By hand on live data (guarded SQL, each step approved): 7 + 27 un-emailed leads returned to Unassigned; the 34 leads' 70 contacts had a shifted import sheet (title in Email, real address in Phone) — repaired, leads re-assigned by the owner, emails now generating. **#283 merged:** the import preview warns about contacts with no usable address, Import asks first, the result line states how many won't be emailed. **Open:** R-108 (`needs-you-today-day-smoke` fails from 2 Oct — pins 1 Oct); offered, not built: show a "no emails generated" failure to the RA Lead right after Assign (today it only lives in `send_progress_<bd>`); the owner's "delete all managers" left BD Lead 2's emails and 2 older BD Lead 1 emails — not explained, run not logged. Detail: `docs/CONTEXT_ARCHIVE.md` § Session 37.

**R-110 open tracking, Stage A — MERGED (#286, `ec65d7b`) and LIVE for BD Lead 1 only:** the recipient's opens only (sender's own network, scanners, first 2 minutes ignored), a pixel on leads emails ONLY for `app_settings` `open_tracking_users` (= `["9065ce34-d31a-4b1a-95d4-e58bd16e4ea8"]`; set to `all` for everyone), an "opened · likely read" line under each sent email on a lead's Emails tab. Migration 055 applied to the live DB 2 Oct. **Owner-side check:** BD Lead 1's next leads emails carry opens — open a lead's Emails tab a few hours after sending; try opening your own copy and confirm it is NOT counted. Stage B not built: Lead Insights figure, "opened, no reply" in Needs you today, an Admin switch for who is tracked. D-0068.

## ▶ NEXT SESSION — START HERE (2026-10-01, end of Session 36)

**State: everything is merged and deploying. Nothing is waiting on a branch.** Last code merge #279 (`7d55e6c`), last docs merge #280 (`92411e7`). Full suite **163/163 on Node 26** (Render's Node; `nodejs.org/dist/v26.10.0/...`, the sandbox runs 22). `npm install` first.

**The owner's whole priority list is built except Boolean search.** Session 36 merged #269, #271, #273, #274, #275, #276, #278, #279 (+ docs #270, #272, #277, #280). Details of every round: `docs/CONTEXT_ARCHIVE.md` § "Session 36" (rounds 1–8 and the closing synthesis).

1. **NEXT: R-096 Boolean search** (Candidates tab, Recruiter and BDM profiles) — the owner said it is *its own project*. Do NOT start coding: first agree the design in plain words — which syntax (AND / OR / NOT, "quoted phrases", brackets), which fields it searches (name, title, skills, résumé text?), where the box lives, whether searches can be saved, and how a bad query is explained. Reuse the pattern of the job-candidate search box (`plFilterRows`, `28-page-pipeline.js`) only for the in-browser case; a database-wide search must run on the server and respect who-sees-what (D-0034/35/36).
2. **Owner-side checks (I cannot do these from the sandbox) — ask how they went:** (a) open a candidate with a PDF résumé → opens on Resume, preview + Download; (b) Needs you today = today only, top 3, "See all", the checkbox; Client conversations the same; (c) a Cc with several addresses (chips) and the search box on a job's Candidates tab; (d) schedule an interview in another time zone and read the email; (e) submit to the BD Manager and to the client with the email ticked (résumé attached); (f) hand a lead to a colleague, see the next follow-up still leave from the first sender; (g) a US-zone user: reminders not "due" a day early; RA dashboard periods match Lead Insights; (h) Lead Insights / RA Team from a non-UTC device. Plus the Session 35 list below (Lead Insights 311, apply-link test, a real lead's Emails tab, windows + From picker on a phone).
3. **Small known leftovers:** the Reports 8-week `trend` buckets still count weeks from the server's clock; `GET /stats` has no screen reading it; **R-067** (per-company API keys — before a SECOND customer; today keys are deployment-wide); the border follow-ups below.
4. **Decisions of this session (read `docs/territories/DECISIONS.md`):** D-0065 a day is the viewer's own day; D-0066 R-080 auto switch-back / R-092 attach résumé / R-098-099 top 3 + See all + checkbox; D-0067 follow-ups leave from the mailbox that sent the first email. R-105's "month" question was answered by me (Dashboard/Reports = calendar month, Insights = labelled 30 days) and is a one-line change (`monthStart`, `services/viewer-time.js`) if the owner prefers the other.
5. **Standing rules:** no helper agents without the owner's words (D-0060 — none were used in Session 36); plain English, no code shown; owner-approved PRs are merged by me (D-0062); the owner never reads code or uses GitHub; one full `node test/run-all.mjs` (read the count, never pipe it) + Node 26 before a merge; write memory as the work lands. At a session start check Sentry (`search_issues` on `pace-backend`) and tell the owner what it shows; the daily routine `trig_01TFL3dY7C9jDaTXmZR55Jee` is report-only.

## ✅ SESSION 36 — WHAT SHIPPED (all live after Render deploys)

| PR | What |
|---|---|
| #269 | R-091 the candidate opens on the Resume (file read through PACE, 3 tries, Try again) · R-097 Needs you today = today on the user's clock · R-093 To/Cc address chips · R-094 search inside a job's candidates |
| #271 | R-102 Lead Insights days = the viewer's own (`?tz=`) |
| #273 | R-100 RA Team view on one server calculation (`services/ra-insights.js`) · R-101 audit (`docs/AUDIT_NUMBERS_R101.md`) · D-0066 |
| #274 | R-095 interview time zones (picker, every zone; email states the zone; no migration) · R-080 out-of-office contacts switch back to Valid on the return date (`ooo_return`, every 6 h) |
| #275 | R-092 email the submission details with the résumé (recruiter→BD manager, BD→client; sent after the move is saved; client copy starts unticked) |
| #276 | R-098 + R-099 top 3, "See all", and a "completed" checkbox on Needs you today and Client conversations |
| #278 | R-070 a follow-up leaves from the mailbox that sent the first email (D-0067) |
| #279 | R-103 `todayIST()` = the device's own day · R-104 `/stats` response rate = replies · R-105 dashboard/Reports/`/stats` windows in the viewer's zone, 7-day week · R-106 RA dashboard draws the server's `periods` |

**Dropped earlier by the owner:** R-081. **Not built, by design:** per-person/company rules for which suggestions show (the owner chose top-3 instead).

## ✅ SESSION 35 (summary) — merged and live (PRs #262–#265)

Stage-change screens + group stage move, windows (minimise/full screen/tray), "Needs you today" rows do the task, addressed email, From-mailbox picker, Reject-with-a-reason, Lead Insights on one server calculation (R-089), Sentry reporter (R-090). **Session 35 owner-side checks still open:** (1) live Lead Insights: emails ≈ 311, 7-day tile = sum of the chart bars, Replied % vs Conv % differ; (2) send a test application through an apply link (dead since 22 Sep); (3) a real lead's Emails tab with a connected mailbox; (4) windows and the From picker on a phone.

**R-090 Sentry error reporter: MERGED (#266, `1be62e7`) and live; `SENTRY_DSN` is set in Render.** Sentry org `pace-ek` (EU), project `pace-backend`; alert rule 1319209 "PACE: new error -> #pace-alerts" posts new errors to the private Slack channel `#pace-alerts` in workspace PACE_all_in_one (the Slack connector is now linked to that workspace). **Slack alert verified by the owner (test notification arrived).** **Daily check routine** `trig_01TFL3dY7C9jDaTXmZR55Jee` ("PACE daily error check", 07:47 America/New_York, Sentry attached by the owner in the claude.ai Routines screen, push + email to the owner): reads Sentry, reports "All quiet" or a plain-English list with proposed fixes; REPORT ONLY (never changes code, merges or deploys). A routine made through the tool cannot carry connectors — the owner must attach them in the Routines UI. Its first report is due 2026-10-01; if none arrives or it says Sentry was unreachable, look at the routine first. At a session start, check `search_issues` on `pace-backend` and tell the owner what it shows. A stray `#pace-alerts` remains in the Century Champions workspace (unreachable now; owner may delete it). D-0063.

**Known limits:** the mailbox's inline reply box is not a window and does not park; the reminder compose keeps its own From box; a window that repaints itself while parked must call `Dock.updateParked` (surface.md). **Before a second customer: R-067** (per-company API keys — today they are deployment-wide).
**Border follow-ups still open:** C-0033 (harbour — candidate-outreach's own add → `core.addCandidateToJob`), C-0034 (foundry pins — partly done), C-0035 (b) (drop the inert `pipeline_status` column, later), C-0036 (rampart — BD stage moves not owner-gated; review `bulk-stage` and `GET /submissions` scoping). Session 34's scratch proofs: `docs/handoff/session-34-harnesses.tar.gz` (delete once the owner is happy).
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
   (The "held counted as ready now" gap is closed by R-069.) R-070 is DONE (D-0067).

## 🧪 TESTS: 163 SUITES

`npm test` — read the COUNT; never pipe into `tail`. `bash
test/verify-frontend.sh` too. Newest (Session 36): `viewer-day-ui-smoke` (11), `top-three-complete-smoke` (12), `submission-email-smoke` (30), `followup-sender-smoke` (15), `ooo-return-smoke` (15), `interview-timezone-smoke` (13), `insights-ra-team-smoke` (16), `insights-timezone-smoke` (13), `resume-first-smoke` (20), `needs-you-today-day-smoke` (9), `email-cc-chips-smoke` (13), `job-candidate-search-smoke` (12). Older: `send-recovery-smoke` (58: the Gmail
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
