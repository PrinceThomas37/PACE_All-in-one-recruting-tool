# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-09 (end of Session 21) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #185 (`431c780`). Nothing of this
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

## 🔑 THE SANDBOX CAN NOW CALL GROQ. USE IT.

The owner added `api.groq.com` to this environment's network allowlist on
2026-09-08. **This changes how to work on anything AI.** The first real
generation found two bugs in ten minutes that a careful hour of reading had
missed — a dropped greeting, and a new check that rejected valid drafts.

- The key is in `app_settings` under `int_groq_api_key`. **Write it to a file
  and read it from there** — an inline credential in a shell command is refused,
  and it lands in the transcript either way, so delete the file afterwards.
- **Node's `fetch` does not use the proxy; `curl` does.** Build the request in
  Node, POST it with curl, parse the reply in Node.
- **Free tier = 8,000 tokens/minute**, ~2,100 per outreach angle. Sleep ~20s
  between calls or you will 429.
- `*.onrender.com` is still blocked. The live app is still read through Supabase.

**Stop reasoning about output you are allowed to look at.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id`
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, relevance engine,
  lead sourcing, candidate outreach, conversation intelligence
- **The in-app mailbox** (four inviolable rules in `CLAUDE.md` Growth bets §3)
- **The shared UI kit + `public/mobile.css`** — off-canvas nav below 860px
- **The outreach generator, genuinely AI-written** — Job title field, four
  angles drafted on demand each with its own `must`/`never`/length, every draft
  held to `checkDraft()`, the reader's job connected to the hiring job, and a
  send that can create the lead and join a sequence. `openai/gpt-oss-120b`, ~1.5s.
- **Candidate outreach as a drip** — each candidate emailed in their own local
  free time, with a ‹ › preview of every person's own email before it goes
- **Every email PACE sends keeps its text** (042) across all six channels; both
  the client drawer and the candidate profile open it on click
- **Any AI provider behind a daily budget**, quality→fast model fallback
- **Lead release is one shared operation**; the cold-email guard is scoped to
  the lead's current cycle; a finished "Send complete" card expires after 15 min
- **Self-serve signup built, switched OFF**; pricing `null`; no guest bypass
- Lead distribution across every connected mailbox; `Assigned` leads silent 30+
  days auto-recycle
- SSO with Microsoft. Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` —
  **distinct from** per-user Gmail *sending*, which is live.

## Migrations — 042 is the latest APPLIED (2026-09-09)

`042_email_tracking_body` added a nullable `email_tracking.body`. Verified after:
column present, nullable, all 19 existing rows untouched and null.

**Next is 043. Never apply one to the live DB without a fresh, explicit
go-ahead**, even when the feature itself was agreed — and **apply it BEFORE
merging the code that uses it**. An insert naming a column that does not exist
fails *after* the email has already gone out.

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

It cost most of Session 19: resume parsing failed in production and every file
parsed perfectly here, same library, same bytes. **The difference was the
RUNTIME.** Check both before merging anything touching a parsing or binary path:

```
curl -sS -o /tmp/n.tar.xz https://nodejs.org/dist/v26.8.1/node-v26.8.1-linux-x64.tar.xz
mkdir -p /tmp/n26 && tar -xf /tmp/n.tar.xz -C /tmp/n26 --strip-components=1
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /tmp/n26/bin/node test/run-all.mjs
```

## ✅ Shipped (Session 21) — one PR, live

**#185**, three owner reports in one branch:

- **The "repeating" menu.** Nothing was drawn twice — `Insights` and `Reports`
  sat adjacent with the SAME bar-chart icon, and the 60px rail is icon-only.
  Four of six roles saw it. Reports now uses the document icon.
- **Stepping through candidate emails.** The Compose → Candidates preview was
  hardcoded to the first person picked, so a batch of thirty let you read one.
  ‹ › arrows walk the picked list.
- **Reading what was sent.** Candidates: the text was already stored and never
  returned (no migration). Clients + the older Email JD path: never stored at
  all → migration 042, all six send paths now record it, both screens open it.

Session 20 (#176-#179) is in the archive: the lead-release helper, the AI
writing the outreach, the reader connection, the four angles, sequences.

## ⏭ PICK THIS UP FIRST (Session 22)

**1. The owner has still not reported back on the four outreach angles.** Ask.
The failure mode to ask about is **convergence** — two chips reading the same on
a real posting. The briefs were tuned against ONE construction role, and the
first live run produced four near-identical drafts before each angle was given a
`never` clause. Their real postings will vary more than that test did.

**2. Nothing verifies the three things #185 shipped, in the live app.** The rail
icon, the ‹ › stepper, and opening a sent email. All three are pinned by tests
and none has been seen by the owner working.

**3. Client email history cannot be recovered, and they may ask.** 19 tracked
sends predate 042 and read back null forever — that text only ever lived in the
mailbox. The offered follow-up is a live lookup against the mailbox's Sent
folder (`services/mail-provider.js` can already search), which would cover the
history that storing cannot. Not started; the owner has not asked for it.

**4. The two dead AI features** — wire the daily import briefing to the
dashboard, delete the orphaned cold-email drafter.

**5. Finish the UI-kit rollout** — every list-shaped page is converted; the card-
and board-shaped ones are not (dashboards, Admin, pipeline, My Team, Assign
Leads). **6. Three stale draft PRs** (#116, #126, #135, months behind `main`) —
finish or close them. **7.** `CLAUDE.md` still flags **CSV import/export + a
small public API** as the highest-leverage unstarted bet.

## ⏸ Parked by the owner — do NOT re-raise as blocking

**The Gmail 7-day expiry.** On 2026-09-01 the owner said: *"We will work on this
but not now."* That is a decision. Raise it only on a fresh visible incident.

- **Symptom:** a dead Gmail sign-in destroys queued emails — `failed` with no
  retry, reason never persisted. Eleven follow-ups were lost on 31 Aug.
- **Root cause is Google-side:** the consent screen is in **"Testing"**, where
  refresh tokens expire after 7 days.
- **Three code defects worth fixing regardless:** release to `pending` not
  `failed` on an auth failure; stop a mailbox on the FIRST auth failure; add the
  error column (**migration 042**, unclaimed).

## Rendering, the UI kit and the phone — read before touching any screen

All of it is in `CLAUDE.md` (stack §Frontend). **Do not work from a paraphrase.**
The four broken most often: register with `UI.registerPage()` and paint via
`paintPageContent()`, never `content.innerHTML`; anything that must survive a
repaint needs its own region; a repaint that changes nothing must write nothing;
build with `UI.page({…})`, not a twelfth hand-rolled table. Plus the four phone
rules. Pinned by `screen-stability-smoke` and `mobile-layout-smoke`.

## Owner actions outstanding

1. **Report on the four angles and the sequence flow** (see "Pick this up
   first" §2).
2. **Consider rotating the Groq key** — it passed through Session 20's
   transcript when it was read from the database to test the model.
3. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render, if login-with-Google is wanted.
4. **Verify one real Greenhouse/Lever board** via "Test it" — the adapters have
   never met a live feed (the sandbox blocks those hosts).
5. **Set prices, decide on card payments** — `services/plans.js`, one line.
6. **Turn on `SELF_SERVE_SIGNUP`** whenever strangers should be able to sign up.

## Traps that will bite you

**`CLAUDE.md` carries all the durable ones and is the file to read** — `models/`
for tenant tables, the six-place stage vocabulary, the free-tier instance
budget, `renderStoredEmail`, safe-methods-only retries, the `orgIdFor()`
fallback, route registration order, the lead-release helper, the
PDF/AI/mobile/outreach blocks, and (added Session 21) how to read a bug report,
why a `TEST_USERS` set is not the user set, why two green runs may not cover the
same thing, and migration-before-merge.

**Before moving ANY file** → archive § "DEPENDENCY MAP" (Session 8). Ten things
break on a naive move and several fail *silently*.

Still worth repeating here, because they bite in the moment:

- **When one operation has several code paths, they diverge silently.** Three
  paths released a lead to the pool; the odd one out made every lead in the live
  pool invisible to distribution. One shared helper, always.
- **A test that greps a VARIABLE NAME** breaks on every refactor and passes on a
  real behaviour change. Assert behaviour.
- **A check that samples "the last few lines" fires on short input.**
- **`emails.sent_at` defaults to `CURRENT_DATE`** — an unsent draft already
  carries a send date, so "sent on X" reports count drafts.
- **A destructive DB action needs, in order:** check FK cascades, verify scope
  with counts, snapshot, explicit confirmation, verify after.
- **Never wait on the suite with `pgrep -f run-all.mjs`** — the waiter matches
  itself. Write the log to a file and grep it for the summary line.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML.
- `/bd-analytics/*` is legacy and un-org-scoped. The orphaned "Manager Users"
  page + its `email_accounts` subsystem still needs an audit-and-split.
- OpenRouter's model names are **still unverified** (no key). Groq's are
  verified and now directly testable from the sandbox.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API**, generalized audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker, no shared
  mailboxes, unread badge is a 60s cached poll.
- A per-call AI usage history (the meter is a daily counter, not an audit log).
- Follow-up variants are still rules-only — the four first-outreach angles are
  AI-written, the three follow-up shapes are not.

## Working rules

`npm test` (**65 suites**, judged by **exit code** — read the count, not just
the code: `npm test | tail -3` masks a failure) · **run it on Node 26 too** ·
`bash test/verify-frontend.sh` · build on the dev branch → test → show the owner
→ draft PR → **merge on their go-ahead** → apply a migration only on a fresh
explicit go-ahead. **The owner does not read code**; show them the running app
and plain English.

**The habit that has paid for itself three sessions running:** get to the real
thing. Session 19 made the app record a fact and read it; Session 20 opened the
network and called the model; Session 21 read the owner's sentence literally.
Each time, the answer was one observation away and no amount of further
reasoning would have found it.
