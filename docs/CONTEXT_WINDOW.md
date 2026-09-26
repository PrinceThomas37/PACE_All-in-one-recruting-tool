# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-26 (Session 31 close) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #244 (`66fca7e`, job posting box +
2 first emails per company per day). Session 31 merged #233 and #240–#244.
**Nothing is left unmerged.** **D-0046 is the highest decision id. C-0030 is
the highest contract id (C-0029, C-0030 OPEN). Next roadmap id `R-060`.**

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
page, ownership + take-over requests (Sessions 29–30), failed-send retry
(D-0031), the rewind clock. Billing and self-serve signup built and **off**.

### Session 31 added (all merged, all live)

- **#233** — the owner's 24 Sep list: Connected filters the Leads table with a
  Convert button per row; job link + AI rewrite on New Job; bulk Add to job
  (tagging now writes a `Sourced` submission); bulk resume upload; owner shown
  not chosen; job page lists its candidates with Email about this job;
  candidate email From picker, no scroll jump, first email goes at once.
- **Client intelligence (D-0039…D-0045)** — `services/client-intel.js` (pure)
  + `routes/client-intel.js` serve **`/clients/:id/…` and `/leads/:id/…`**:
  every email with them (ours in full, their replies as filed; "Open the full
  email" fetches the original live from the viewer's OWN mailbox), a free
  "where things stand" card, and a **Generate AI summary** button. **Owner-only**
  (D-0040; a manager gets a facts roll-up — not built). Per-person daily
  allowance (D-0041, default 15); a summary only on the button, capped per
  click however long the history (D-0042; a 2-year test client = 1,040
  tokens). Lead summaries live in `app_settings` `lead_summary_<id>`; client
  ones in `client_summaries` (migration 048). The reply sweep now files only
  real correspondents (`gateMessage`) with `company_id` + free `facts`.
  A one-time **catch-up** (`runClientIntelCatchUp`, engine job, hourly) pulls
  90 days of replies from each BD's own leads — ran 2026-09-25: 6 of 8
  mailboxes done (2 have no leads), found only the 3 replies already stored,
  because PACE's first outreach went out 2026-09-23.
- **R-055 (#243)** — **one** sending-hours setting (`send_window_start_hour` /
  `_end_hour`, default 8–16 in the LEAD's time zone), read by the send loop and
  every "Send window" line; the Email Engine Schedule popup edits it. The old
  "Outreach send time" box (read by nothing) and an unsaved Timezone picker are
  gone. `followup_send_time` (owner set **18:30 IST**) = when follow-ups are
  QUEUED, not sent.
- **R-056 (#244)** — a **Job posting** box on each lead row
  (`59-lead-posting.js`, `POST /jobs/:id/posting`, `services/lead-posting.js`
  using the AI writer's own thin rule). All 82 live leads were title-only; 80
  link to LinkedIn/Indeed/SimplyHired/Glassdoor, which PACE cannot read.
- **R-058 CHANGED (#244)** — at most **2** first emails per company per day
  (`company_daily_first_emails`, 0 = off); the rest wait a day. First emails
  only; per company across leads and senders; day = `emails.sent_at` (UTC).

### Live switches (as set 2026-09-25)

| setting | value | meaning |
|---|---|---|
| `sys_client_intel_enabled` | **1** | email timeline ON (D-0044) |
| `sys_client_intel_ai_enabled` | *no row → 0* | AI summary button **OFF** until the owner says |
| `sys_engine_ai_first_email` | **1** | AI writes first emails (**default was already 1** — see D-0045 correction) |
| `company_daily_first_emails` | *no row → 2* | 2 per company per day |
| `send_window_*_hour` | *no row → 8 / 16* | lead-local sending hours |
| `ai_daily_token_cap` / `call_cap` | 400,000 / 400 | org's daily AI allowance (Groq primary) |

**⚠ A setting with no row reads its schema DEFAULT.** I told the owner the AI
first-email switch was off; its default was 1 and it had been on since 23 Sep.
Read `config/settings.js` defaults before stating what a switch is set to.

**First live AI emails: 2026-09-25, 23 of 23 first emails AI-written**, ~1,700
tokens each, no errors. Correct and on-rule but samey — thin leads. The fix is
R-056 (posting text) and later R-057.

## Migrations — next is **049** · 048 APPLIED 2026-09-25

048: `conversation_messages.company_id` + `facts`, table `client_summaries`
(RLS + service policy; in `models/tables.js`, 45 tenant tables). **Never apply
one without an explicit, fresh go-ahead.**

## ⏭ PICK THIS UP FIRST

1. **Read `docs/ROADMAP.md`.** Open, mine: **R-051** remainder (manager's team
   roll-up + daily-update section, facts only, no extra AI — D-0040/D-0043),
   R-037 (dashboard warning when a mailbox sign-in fails), R-001/002/005/006/
   007/008, R-030/031/032, R-048. Waiting on the owner: R-039 (SPF/DKIM/DMARC),
   R-050 (two unprotected backup tables — needs OK), R-011. Undecided: R-012
   (the design brief), R-013, R-014, R-049 (operator role — before customer
   #2), R-052/053/054, **R-057 (owner: "later", after "a huge discussion" on
   email design — do not start unasked)**.
2. **Known gap left on purpose:** the Pending banner counts a first email held
   by the per-company cap as "ready now" until the send run reaches it (the run
   then says why). Fix if the owner notices; not asked for.
3. **Watch** whether BDs actually paste postings (R-056) and whether AI emails
   read better where they do — `emails.template_variant='ai'`, compare bodies.

## 🧪 TESTS: 119 SUITES

`npm test` — read the COUNT; never pipe into `tail`. `bash
test/verify-frontend.sh` too. Newest: `client-intel-smoke` (34),
`client-intel-routes-smoke` (38, clients + leads), `client-intel-ui-smoke`,
`lead-intel-ui-smoke` (15, incl. the posting box), `send-hours-smoke` (15 — runs
the real `getSendWindowHours` lifted out of index.js),
`posting-and-company-cap-smoke` (24). **Every one was re-verified by putting the
bug back.** One reintroduction CRASHED instead of failing and printed no
summary — **a crash is not a demonstration; write the old code out properly.**
`timezone-resolver-smoke` slices index.js between text anchors — moving code
near `getSendWindowHours` breaks it (its END_MARK is now that function).

## Owner actions outstanding

- Say when to switch on the **AI summary button** (`client_intel_ai_enabled`).
- Paste job postings on leads (or add a "Job Description" column to imports).
- R-039, R-050 above. Google sign-in still needs `GOOGLE_CLIENT_ID`/`SECRET`.

## ⏸ Parked — do NOT re-raise as blocking

`DECISIONS.md` is the authority: pricing `null`, signup off, no timezone
backfill, no attachments on candidate email (D-0012), reassignment only by
request (D-0036–38), documents designed later (R-052), R-057 later (D-0046).

## Traps that will bite you

- **`*.onrender.com` is blocked from this sandbox** — a merge lands, a deploy
  is **unverified**. Check `app_settings` `cron_last_*` rows in Supabase for
  signs of life; never claim you watched it come up.
- **Sandbox Node 22, Render Node 26.** Works-here-fails-there → get Node 26.
- **A guard is vacuous until you watched it fail** — now ten caught.
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
  chat, commits or files.
- **This sandbox cannot measure smoothness** (software compositing).
