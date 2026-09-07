# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-07 (end of Session 19) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #174 (`c9e0d5c`). Nothing of this
session's is unmerged.

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.**

If you're picking this up cold: `CLAUDE.md` is the durable source of truth for
anything this file and the archive don't cover — trust it over an old-looking
line here.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id`
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, relevance engine,
  lead sourcing, candidate outreach, conversation intelligence
- **The in-app mailbox** — two panes, threaded reader (four inviolable rules in
  `CLAUDE.md` Growth bets §3)
- **The shared UI kit + `public/mobile.css`** — below 860px an off-canvas nav,
  no sideways scroll, bottom-sheet dialogs. Desktop untouched.
- **The outreach generator + composer**; **any AI provider behind a daily budget**
- **AI IS CONFIRMED WORKING** — Groq `openai/gpt-oss-20b`, 250ms, with real
  metered spend on `resume_parse` and `lead_ratio` (recorded only on success)
- **Self-serve signup built, switched OFF**; pricing deliberately `null`; no
  guest/demo bypass
- Lead distribution across every connected mailbox; `Assigned` leads silent 30+
  days auto-recycle
- SSO with Microsoft. Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` —
  **distinct from** per-user Gmail *sending*, which is live.

## Migrations — 041 is the latest APPLIED (2026-08-24)

**Next is 042. Never apply one to the live DB without a fresh, explicit
go-ahead**, even when the feature itself was agreed. Sessions 14-19 added none;
042 is most likely the error column on `emails` (see "Parked").

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26. READ THIS BEFORE DEBUGGING.

It cost most of a session. Resume parsing failed in production while every file
parsed perfectly here — same library, same lockfile, same bytes (proven:
14,241 declared, 14,241 received, `%%EOF` intact). **The difference was the
RUNTIME.**

**When something works here and fails there, get the server's Node and re-run
before theorising.** `nodejs.org` IS reachable from this sandbox (unlike
`*.onrender.com`):

```
curl -sS -o /tmp/n.tar.xz https://nodejs.org/dist/v26.8.1/node-v26.8.1-linux-x64.tar.xz
mkdir -p /tmp/n26 && tar -xf /tmp/n.tar.xz -C /tmp/n26 --strip-components=1
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /tmp/n26/bin/node test/run-all.mjs
```

**59/59 passes on both today — keep it that way**, and check both before
merging anything touching a parsing or binary path.

## ✅ Shipped (Session 19) — five PRs, all live

**#170** the AI test button had been dead four sessions (a shadowed Express
route — two more were dead the same way, including `GET /jobs/export`) + the
phone layout. **#171** Groq was being asked for retired Llama models. **#172**
resume failures now say which of five things went wrong, and the upload checks
its own byte count. **#173** the health card's tier default meant it tested half
the models it claimed. **#174** `unpdf` replaces a 2018 pdf.js that misreads
modern PDFs on Node 26, plus reasoning headroom and the "AI answered unusably"
state.

Every one was something the product knew and did not say, and every one was
found by **making the app record a fact and reading it**. Full narrative:
archive, Session 19 parts 1-4.

## ⚠ AI IS WIRED IN 6 PLACES BUT REACHABLE IN 4

Live: **resume parsing**, **job-description scrub**, **outreach generator**,
**lead-distribution advice**. Dead: the **daily import briefing**
(`/ai/generate-summary` — works, nothing calls it; worth wiring to the
dashboard) and **cold-email drafting** (`/ai/generate-email` — reachable only
from the orphaned `12-manager-users.js`; superseded, worth deleting). Do not
repeat "six AI features" without re-checking the UI.

## ⚠ The merge trap — read before editing a shared file

#159 deleted a helper; #160, written in another session against the same file,
added a call to it elsewhere. Git merged both cleanly and `main` shipped a 500.

- **A clean merge is not a correct merge when one side deletes a symbol and the
  other adds a use of it.** Merge `main` in and re-run the suite *immediately
  before* merging, not after.
- The guard that works reads the **source** (`test/outreach-generator-smoke.mjs`).
  A guard that reads source must read *source* — twice now such a test has
  matched its own explanatory comment. Strip comments before asserting.

## ⏭ PICK THIS UP FIRST (Session 20)

**1. Confirm the last two fixes with the owner.** Both shipped after their last
report, so neither has been seen working: the two sample resumes should now
parse, and lead distribution with "focus more on construction" should weight
construction up rather than showing an even 4% split. If either misbehaves,
**read the database, don't guess** — `resume_parse_last_error` and
`ai_last_error` are written for exactly this.

**2. The quality model has still never been exercised by a real feature.** The
card will now test it, but `openai/gpt-oss-120b` writes the outreach emails and
no prospect-facing text has come out of it yet. Worth one real generation.

**3. Free model vs the rules writer, side by side, on a real posting.** The
prompts were written for Claude; free open models follow tone instructions less
well. The honest verdict for the *email generator* may be "keep the rules
version" while the free tier earns its place on resume parsing and JD cleanup.
**Needs the owner's eyes on real output — do not decide it for them.**

**4. The two dead AI features** — wire the briefing to the dashboard, delete the
cold-email drafter.

**5. Finish the UI-kit rollout** — every list-shaped page is converted; the
card- and board-shaped ones are not (dashboards, Admin, pipeline, My Team,
Assign Leads). **6. Three stale draft PRs** (#116, #126, #135, months behind
`main`) — finish or close them. **7.** `CLAUDE.md` still flags **CSV
import/export + a small public API** as the highest-leverage unstarted bet.

## ⏸ Parked by the owner — do NOT re-raise as blocking

**The Gmail 7-day expiry.** On 2026-09-01 the owner said: *"We will work on this
but not now."* That is a decision. Raise it only on a fresh visible incident.

- **Symptom:** a dead Gmail sign-in destroys queued emails — `failed` with no
  retry, reason never persisted. Eleven follow-ups were lost on 31 Aug; they can
  still be re-queued.
- **Root cause is Google-side:** the consent screen is in **"Testing"**, where
  refresh tokens expire after 7 days. If `futeglobal.com` is on Workspace,
  switching to "Internal" removes the limit with no code.
- **Three code defects worth fixing regardless:** release to `pending` not
  `failed` on an auth failure; stop a mailbox on the FIRST auth failure; add the
  error column (**migration 042**, unclaimed).

## Rendering, the UI kit and the phone — read before touching any screen

All of it is written out in `CLAUDE.md` (stack §Frontend). **Do not work from a
paraphrase.** The four broken most often: a page registers with
`UI.registerPage()` and paints via `paintPageContent()`, never
`content.innerHTML`; anything that must survive a repaint needs its own region;
a repaint that changes nothing must write nothing; build with `UI.page({…})`,
not a twelfth hand-rolled table. Plus the four phone rules — hover gated on
`(hover:hover)`, the menu is a body class not a render, `#content` is
`overflow-x:hidden` below 860px, and an inline style cannot be responsive.
Pinned by `screen-stability-smoke` and `mobile-layout-smoke`.

## Owner actions outstanding

1. **Try the two things in "Pick this up first" §1** and report back.
2. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render, if login-with-Google is wanted.
3. **Verify one real Greenhouse/Lever board** via "Test it" — the adapters have
   never met a live feed (the sandbox blocks those hosts).
4. **Set prices, decide on card payments** — `services/plans.js`, one line.
5. **Turn on `SELF_SERVE_SIGNUP`** whenever strangers should be able to sign up.

## Traps that will bite you (learned the hard way)

`CLAUDE.md` carries the durable ones — `models/` for tenant tables, the
six-place stage vocabulary, the free-tier instance budget, `renderStoredEmail`,
safe-methods-only retries, the `orgIdFor()` fallback, route registration order,
and the PDF/AI/mobile blocks. **Read it; these are the ones it does not cover.**

**Before moving ANY file** → archive § "DEPENDENCY MAP" (Session 8). Ten things
break on a naive move and several fail *silently*.

- **Any mailbox-selection path must check BOTH `microsoft_tokens` and
  `gmail_tokens`, exclude `refresh_failed`, and filter `is_active`.**
- **A job whose sending mailbox goes inactive silently skips its pending emails
  forever** — deactivating a `user_emails` row must call `reassignJobsOffMailbox`.
- **`emails.sent_at` defaults to `CURRENT_DATE`** — an unsent draft already
  carries a send date, so "sent on X" reports count drafts.
- **Graph's `/move` returns a NEW message id**; Gmail's never changes.
- **Injectable clocks are not optional** in `conversation-intel.js`,
  `next-action.js`, and `lead-ingest.js`'s `ingestSource`.
- **Browser tests never need a production bypass** — `test/helpers/enter-app.mjs`.
- **"Engine not receiving its heartbeat" is usually NOT a fault.** GitHub
  delivers the 30-min schedule every 3-5 hours; jobs are delayed, never skipped.
  Only 8h+ of silence is worth checking `CRON_KEY` over.
- **A destructive DB action needs, in order:** check FK cascades, verify scope
  with counts, snapshot, explicit confirmation, verify after.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- OpenRouter's model names are **still unverified** — no key configured, and the
  sandbox cannot reach the host. Groq's are verified.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API**, generalized audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker in the UI,
  no shared mailboxes, unread badge is a 60s cached poll.
- A per-call AI usage history (the meter is a daily counter, not an audit log).

## Working rules

`npm test` (**59 suites**, judged by **exit code** — read the count, not just
the code: `npm test | tail -3` masks a failure) · **run it on Node 26 too** ·
`bash test/verify-frontend.sh` · build on the dev branch → test → show the owner
→ draft PR → **merge on their go-ahead** → apply a migration only on a fresh
explicit go-ahead. **The owner does not read code**; show them the running app
and plain English.

**Habits these sessions paid for:**

- **Make the app record a fact, then read it.** Every fault this session was
  found that way — `node: process.version` in a record nobody expected to need
  is what turned "the PDF sometimes breaks" into "the runtime differs".
- **Never let a diagnosis sound more certain than the evidence.** "Damaged in
  transit" was confidently wrong and would have had the owner re-uploading good
  files.
- **When a feature reports nothing, check its request reaches its handler**
  before improving what the handler says.
- **A default that silently disables a check is worse than no check.**
- **Reproduce a visual complaint in the browser before changing CSS**, and know
  whether a red test pinned WORDING or BEHAVIOUR before "fixing" it.
- **Re-run the suite against freshly merged `main` immediately before merging**,
  and never wait on it with `pgrep -f run-all.mjs` (the waiter matches itself).
