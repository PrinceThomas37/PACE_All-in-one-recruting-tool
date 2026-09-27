# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-27 (Session 33, in progress) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #250 (`07b2741`, Session 32 close).
**Open: draft PR #252 (R-012) — built, waiting for the owner's look before
merge.** **D-0048 is the highest decision id. C-0030 is the highest contract id
(only C-0030 OPEN). Next roadmap id `R-060`.**

### Session 33 so far (2026-09-27) — D-0048: "Quickly do R-012 … design R-053"
- **R-012 built (PR #252, not merged):** Jobs, Candidates and Clients rows open
  in place like Leads — one shared `rowReveal` in `03-core-render.js`. Details
  in `surface.md` (Session 33). `row-reveal-smoke` 45/45 (5/45 on old code);
  full suite **127/127**. Merge when the owner says so.
- **R-053 (contact finder) is being DESIGNED with the owner** — the chat's big
  job. Design, not build. Starting point: `docs/SESSION31_DESIGNS.md` §3.

---

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

## Migrations — next is **051** · 049 and 050 APPLIED 2026-09-26

049: RLS + revoke on the two backup tables. 050: `recruiting_lookups` unique
index is `(org_id, category, lower(value))`. **SQL/migrations are pre-approved
by the owner (D-0047)** — still state a destructive customer-data change first,
and prove a schema change in a rolled-back probe (see 050's archive entry).

## ⏭ PICK THIS UP FIRST

1. **Session 33 took two of D-0047's four:** R-012 built (PR #252, awaiting the
   owner's look), R-053 in design. **R-057** (matching candidates in emails)
   and **R-054** (a playbook per industry) are still deferred — design first.
2. **Tell/remind the owner:** reconnect the two dead mailboxes (above); the
   Anthropic key has no credit (harmless — Groq answers); the apply link on
   "Office Manager/ Bookkeeper" needs sharing (R-008, 0 applicants).
3. Mine, open: **R-032** (38 orphaned files / 2.9 MB — needs the Storage API
   with a service key; SQL delete is correctly blocked), **R-049** operator role
   (before customer #2), R-003. **C-0030** (org-scoping debt list) open.
4. Known gap left on purpose: the Pending banner counts a first email held by
   the per-company cap as "ready now" until the send run reaches it.

## 🧪 TESTS: 127 SUITES

`npm test` — read the COUNT; never pipe into `tail`. `bash
test/verify-frontend.sh` too. Newest: `mailbox-alerts-smoke` (22) + `-ui` (12),
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
