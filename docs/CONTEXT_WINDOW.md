# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md` (the rules only; the full history is `docs/CLAUDE_MD_FULL_SESSION34.md`, open it only for a "why").**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the reasoning behind a past decision.

**Updated**: 2026-10-06 (end of Session 38) · **Last merged to `main`**: #292 (`94bf8c1`, docs) after #291 (`7818888`, R-118 + R-120 + R-013), #290 (`5a9c446`, R-119), #289 (`38bdc2e`, R-114) · **Repo**: `PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging to `main` IS the release (unverified from the sandbox: the owner hard-refreshes and looks).
**Highest ids:** decision D-0071 · contract C-0036 · next roadmap id `R-122` · next migration `057` (056 APPLIED 2026-10-05).

## ▶ NEXT CHAT — PRODUCT DESIGN & UI (the owner's stated focus, 6 Oct) — START HERE
The owner is moving to **product design and UI**. They are not an engineer: show screenshots and the running app, ask design questions in plain words with choices, build only after they react. No helper agents without their words (D-0060).
- **Where the look lives:** `public/ui.css` (the UI kit; ends with a GENERATED block of type/colour utility classes — do not hand-edit it), `public/theme.css` (light/dark via `data-theme` on `<html>`), `public/mobile.css` (phone ≤860px), `public/styles.css` (older base), `public/js/00-ui-kit.js` (`UI.registerPage`, `UI.table`, drawers). Rules: `CLAUDE.md` § "Frontend and layout" (render engine, phone first-class, themes, lists have a horizon). Earlier design intent: `docs/UI_REVAMP.md` (the new look, D-0015), `docs/ROLE_UX_BLUEPRINT.md`, `docs/AGEING_UI_PLAN.md`.
- **What R-013 just made possible (merged, #291):** all text sizes/colours that used to be inline are classes (`fs-12`, `c-text3` …), so a phone type scale or a palette change can now reach them. **Never write inline `font-size` or `color:var(--…)` again.** ~2,900 other inline declarations (padding, flex, gaps, backgrounds, borders) remain — the "layout half" of R-013, same proof needed. **95 spots stay inline on purpose** (a stylesheet rule would change them): list via `node scripts/inline-to-classes.mjs --report=/tmp/r.json` (dry run changes nothing); 37 are in `16-insights.js`. 114 hard-coded colours (`#fff` …) are untouched (a design call).
- **R-121 (pending, the owner's call):** a real phone text scale using the new classes — a VISIBLE change, so screenshots first.
- **How to prove a "change nothing" job:** `scripts/screens-fingerprint.mjs` — run it on a worktree of the old commit and on the new tree (`--root=…`, `--out=…`), then `--diff a.json b.json`; first diff the old tree against itself (must be zero). **A green suite is not a screen: take screenshots** (`CP_SHOT_DIR=… node test/<suite>.mjs`, then look). Existing look guards: `theme-contrast-smoke`, `mobile-layout-smoke`, `modal-mobile-smoke`, `page-renders-smoke`, `utility-classes-smoke`.
- **Design-shaped open items:** **R-096 Boolean search** (its own project; design questions first: syntax, fields, where the box lives, saved searches, how a bad query is explained); R-121 above; R-110 Stage B (an "opened" figure in Lead Insights, an "opened, no reply" prompt, an Admin switch); R-054 per-industry playbook (screens + words per company); sign-ins last 8 h (a rolling session is a decision, not built).

## ▶ SESSION 38 (2026-10-05 → 06) — what shipped, all MERGED and live after the Render deploy
**#288** R-111 Gmail previews show real text, R-112 big opened email + Expand message, R-108 test fixed, R-115 `ARCHITECTURE.md` pass 1. **#289** R-114 several emails/phones per person (candidates + lead contacts + phones at import; main + extras, "Make main", duplicates on any address, an opted-out address can never be main, every send checks all addresses; `services/contact-points.js`) — **owner confirmed it works live**. Migration 056 applied; the 80 shifted lead contacts repaired (R-117; private backup `backups.contacts_r117`; nothing was sent — **the 37 leads still need re-assigning by the owner** to generate first emails). **#290** R-119 candidate search on a job's own page (name/email/phone incl. extras, numbers typed any way). **#291** R-118 an expired sign-in says so in one sentence and returns the person to page/job/candidate after sign-in (`23-auth.js`, `22-api.js`, `37-nav-history.js` `navResume`); R-120 job page header wraps on a phone; **R-013** 1,704 inline sizes/colours → 34 classes, PROVEN (58,832 elements over 336 screens identical before/after). R-116 (new-version notice) DROPPED by the owner. Daily Sentry routine `trig_01TFL3dY7C9jDaTXmZR55Jee` is ON. Full suite: Node 22 176/176, Node 26 176/176.

## ✅ WHAT'S LEFT (the owner's list, 6 Oct — details in `docs/ROADMAP.md`)
- **Owner-side:** hard-refresh and look (nothing should look different except the job page on a phone); re-assign the 37 repaired leads; share the apply link (R-008); reconnect the two dead mailboxes below if still dead; R-011 "stalled at BDM" look (deferred).
- **Next, owner's call:** R-121 phone text scale · **R-096 Boolean search** · R-110 Stage B · R-053 contact-finder remainder (read the job posting/company site, free sources).
- **Before a SECOND customer (safe today, not later):** **R-067** each company brings its own API keys (today one deployment-wide set), **R-049** a separate PACE-operator role (today any customer's admin can pause sending for everyone), R-016 CSV import for candidates.
- **Mine, on the owner's go:** `ARCHITECTURE.md` pass 2 (R-115).
- **Ideas (safe to leave):** R-057 matching candidates we already hold · R-061 what Apollo knows about a company · R-062 more leads from a company's other open jobs · R-054 per-industry playbook · R-052 create documents · R-015 SMS (consent is a legal question) · R-017 seat pricing · R-003 a real job column on the applicant queue.
- **Known gaps (not built, by design):** search by an extra email/phone on the Candidates list; recognising a reply from an extra address; `processPendingEmailSends` (inside `index.js`) is not mounted in any test — its opt-out rule is the pure, tested `suppressedFor`.

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
clock, client/lead email timelines with the AI summary button, **several emails/phones per candidate and lead contact (Make main)**, **search inside a job's candidates (job page and Pipeline)**, **an expired sign-in that returns you to where you were**. Billing and
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


## Migrations — next is **057** · 056 APPLIED 2026-10-05 (candidates + contacts `extra_emails`/`extra_phones`, alt_phone copied) · 055 APPLIED 2026-10-02 (open tracking) · 054/053 2026-09-28
**SQL/migrations are pre-approved by the owner in principle (D-0047)** — still state a destructive customer-data change first, ask for a fresh go before touching the live DB, apply a migration BEFORE merging the code that uses it, and prove a schema change in a rolled-back probe.

## 🧪 TESTS: 176 SUITES (Node 22 and Node 26 both 176/176 on #291)
`npm test` — read the COUNT; never pipe into `tail`. `bash test/verify-frontend.sh` too. Newest (Session 38): `contact-points-smoke`, `candidate-contact-points-routes-smoke`, `lead-contact-points-routes-smoke`, `contact-points-ui-smoke`, `lead-contact-cp-ui-smoke`, `candidate-outreach-optout-smoke`, `job-page-candidate-search-smoke` (25), `session-expiry-resume-smoke` (20), `job-page-phone-smoke` (10), `utility-classes-smoke` (7). **Every new check was run against the broken code and failed there**; a guard that cannot see the thing FAILS rather than passes.

## Owner actions outstanding
- Reconnect kristy.scott@fute-global.com and princethomasfute@gmail.com (dead mailboxes) if still dead; share the apply link; paste job postings on leads (R-056). Optional: drop the two empty backup tables; drop `backups.contacts_r117` once satisfied. Google sign-in still needs `GOOGLE_CLIENT_ID`/`SECRET`.

## ⏸ Parked — do NOT re-raise as blocking
`DECISIONS.md` is the authority: pricing `null`, signup off, no timezone backfill, no attachments on candidate email (D-0012), reassignment only by request (D-0036–38), documents designed later (R-052), R-057 later (D-0046), no "new version ready" notice (D-0069).

## Traps that will bite you
- **`*.onrender.com` is blocked from this sandbox** — a merge lands, a deploy is **unverified**. Check `app_settings` `cron_last_*` rows for signs of life; never claim you watched it come up.
- **Sandbox Node 22, Render Node 26** (`/tmp/claude-0/node26/...` if you downloaded it). Works-here-fails-there → get Node 26.
- **A guard is vacuous until you watched it fail** — and a green suite is not a screen: look at the screenshot. A suite only covers the screens it renders (R-094's search test only opened the Pipeline page while the job page's own list had none).
- **Registration order is load-bearing** in every router (`route-shadowing-smoke`). **Every reader of a stored email body calls `renderStoredEmail`.**
- **A lead row opens without `render()`** — anything inside it fills its own element by id, never re-renders.
- **A squash-merged branch conflicts with `main` on its own files** — after a merge, restart the dev branch from `origin/main` (`git checkout -B <branch> origin/main`), push with `--force-with-lease` pinned to the old remote sha.
- **Never `git add -A`**; never pipe `git push` into `tail`. `node scripts/territory-map.mjs` regenerates `docs/territories/island.html` and `_map.json` — commit them with the change.
- **Secrets live in `app_settings` (`int_*_api_key`)** — never echo them (query `length(value)`, never `value`).
- **Hard-coded AI model names expire** — five so far. Check the live `ai_last_test` row's `available_models` first.
- **This sandbox cannot measure smoothness** (software compositing) — say how it FEELS is the owner's call.
