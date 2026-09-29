# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-28 (Session 33 CLOSED — the next chat starts here) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #260 (`eae789f`, 2026-09-28 19:54 UTC — R-069: Gmail follow-up fallback, interrupted-send recovery at boot, a truthful Pending tab), after #259 (`c2a0e74`, merged by the OWNER on GitHub 2026-09-28 17:02 UTC — R-063 firm-aware finder, R-066 the Apollo limit on its card, R-068 title search + Uncover; files identical to the tested head), after #258 (`6d2bd20`, D-0051: the "Already added" pop-up), #257 (`464a1df`, D-0050), #256 (the contrast suite) and #253 (`fc72f36`, the POC finder).
**#252 (R-012) merged 2026-09-27 on the owner's "Merge this change first".** **D-0057 is the highest decision id. C-0030 is the highest contract id
(only C-0030 OPEN). Next roadmap id `R-071` (R-060 is open PR #254's, another chat).**

### Session 33 (2026-09-27 → 28) — CLOSED. Everything below is LIVE (main `eae789f`).
- **R-012** (#252): Jobs / Candidates / Clients rows open in place like Leads (`rowReveal`).
- **R-053 POC finder** (#253, #257): four slots per lead (`services/poc-targets.js`), Apollo
  people search free + one lookup per person = 1 credit, never retried
  (`services/people-apollo.js`); found people wait in `poc_suggestions` for Accept / Not this
  person; company size from Apollo; Apollo ONLY on a click (D-0050).
- **R-064** (#258, D-0051): one duplicate check in the add-a-person path
  (`services/lead-contacts.js`) + the "Already added" pop-up.
- **R-063 / R-066 / R-068** (#259, merged by the OWNER on GitHub): finder knows law /
  accounting / architecture firms; the Apollo daily credit limit on its card (1 PACE credit =
  1 Apollo credit, max 10,000); title search + Uncover (migration 054).
- **R-069** (#260): a Gmail follow-up whose thread lives in ANOTHER mailbox goes out fresh with
  the first email quoted (`services/gmail-delivery.js`, only on a definite 404); a row stuck at
  'sending' moves at boot to Didn't send as "may have gone out" (`services/interrupted-sends.js`);
  Pending says why each email waits. Verified live: 7 of 8 follow-ups sent via the new path.
- Decisions D-0048 … D-0055 — read `DECISIONS.md`. **D-0055: the owner does NOT share their
  organisation's Apollo account — never call the Apollo connector.**

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

## Migrations — next is **055** · 054 APPLIED 2026-09-28 (poc_suggestions slot 'other') · 053 APPLIED 2026-09-28 (companies.employee_count/size_source/size_checked_at/apollo_org_id) · 052 APPLIED 2026-09-27 (poc_suggestions, re-verified 2026-09-28) · 051 APPLIED 2026-09-27 (company size) · 049/050 on 2026-09-26

049: RLS + revoke on the two backup tables. 050: `recruiting_lookups` unique
index is `(org_id, category, lower(value))`. **SQL/migrations are pre-approved
by the owner (D-0047)** — still state a destructive customer-data change first,
and prove a schema change in a rolled-back probe (see 050's archive entry).

## ⏭ PICK THIS UP FIRST

1. **Open draft PR #261** (docs only, branch `claude/resume-previous-session-7npy0y`): the
   session-33 memory. Let the next work ride on it, or merge it when the owner says so.
2. **Finish verifying R-069 (read-only SQL, no re-queueing without the owner's say-so):**
   the skaeng.com follow-up (`438936f6…`, EST lead, 4th try) should have gone 2026-09-29 via the
   new path; the 7 first emails held by the company limit (`ca6e198e`, `201ec72c`, `676f774c`,
   `a8c74d7b`, `d97cd608`, `88b78245`, `d0797893`) should have gone 09-29. Still the OWNER's to
   Retry: 6 given-up follow-ups (`4e975312`, `6c8e8b61`, `73ba0003`, `9ecdeaf0`, `cb67e3c4`,
   `fdf61e53`) and the uncertain Lamons one (`f51c7f63` — check Spencer's Sent first).
3. **Owner DECIDED 2026-09-29 — build these next:** **R-070 / D-0056** — a follow-up goes
   from the mailbox that sent the FIRST email (fall back to the lead's current mailbox + quote
   only when that one cannot send); **R-067 / D-0057** — every company's own Apollo (and other)
   keys, and a plan feature where PACE supplies keys for companies that have none (no plan
   does today; confirm which plan with the owner; check Apollo's terms on shared keys).
   The owner said follow-ups looked "still pending" 2026-09-28 evening — they were outside
   their leads' sending hours; the owner will check them themselves.
4. Deferred, design first: R-057 (matching candidates in emails), R-054 (a playbook per
   industry); POC finder next slices (posting/website readers, automatic run for new leads —
   free rungs only, D-0050). Mine, open: R-049 operator role, R-003, C-0030.
5. Small, noted in `harbour.md`: a row sent after earlier failures keeps a stale
   `fail_kind`/`fail_reason`; the Outlook→Gmail thread-id edge (0 of 411 today).

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

- Email → Didn't send: Retry the 6 follow-ups that gave up (3 orbiss.us, peakengr.com,
  gouldconstruction.com, wightco.com); for the Lamons one check Spencer Brown's Sent first.
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
