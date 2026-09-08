# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-08 (end of Session 20) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #178 (`e70f4f08`). Nothing of this
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
- **The in-app mailbox** — two panes, threaded reader (four inviolable rules in
  `CLAUDE.md` Growth bets §3)
- **The shared UI kit + `public/mobile.css`** — below 860px an off-canvas nav,
  no sideways scroll, bottom-sheet dialogs. Desktop untouched.
- **The outreach generator, now genuinely AI-written** (Session 20) — a Job
  title field; all four angles AI-drafted **on demand**, each with its own
  `must`/`never`/length band; every draft held to `checkDraft()`; the reader's
  own job connected to the role being hired; and a send that can create the lead
  and join a sequence. Confirmed working against `openai/gpt-oss-120b`, ~1.5s.
- **Any AI provider behind a daily budget**, with a quality→fast model fallback
- **Lead release is one shared operation** — `releaseToPoolUpdate()`; the
  cold-email guard is scoped to the lead's current cycle, so an un-assigned lead
  is emailable again. A finished "Send complete" card expires after 15 minutes.
- **Self-serve signup built, switched OFF**; pricing deliberately `null`; no
  guest/demo bypass
- Lead distribution across every connected mailbox; `Assigned` leads silent 30+
  days auto-recycle
- SSO with Microsoft. Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` —
  **distinct from** per-user Gmail *sending*, which is live.

## Migrations — 041 is the latest APPLIED (2026-08-24)

**Next is 042. Never apply one to the live DB without a fresh, explicit
go-ahead**, even when the feature itself was agreed. Sessions 14-20 added none;
042 is most likely the error column on `emails` (see "Parked").

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

It cost most of Session 19. Resume parsing failed in production while every file
parsed perfectly here — same library, same lockfile, same bytes. **The
difference was the RUNTIME.** When something works here and fails there, get the
server's Node and re-run before theorising:

```
curl -sS -o /tmp/n.tar.xz https://nodejs.org/dist/v26.8.1/node-v26.8.1-linux-x64.tar.xz
mkdir -p /tmp/n26 && tar -xf /tmp/n.tar.xz -C /tmp/n26 --strip-components=1
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /tmp/n26/bin/node test/run-all.mjs
```

Check both before merging anything touching a parsing or binary path.

## ✅ Shipped (Session 20) — three PRs, all live

**#176** two silent failures behind one screenshot: a "Send complete" card that
outlived its queue, and un-assigned leads that could be re-assigned but never
re-emailed. The live pool turned out to be worse than reported — **11 of 11**
leads were half-released (stage changed, `assigned_to_bd` left set) and
therefore invisible to distribution. Repaired in the live DB with the owner's
go-ahead. **#177** the AI actually writes the outreach now: a Job title field,
`checkDraft()`, the quality→fast fallback, and the page saying which engine
wrote what. **#178** the reader's job connected to the hiring job, all four
angles AI-written on demand, and a send that creates the lead and joins a
sequence after step 1.

Full narrative: archive, Session 20 parts 1-3.

## ⏭ PICK THIS UP FIRST (Session 21)

**1. THE MENU REPEATS — reported by the owner, NOT yet diagnosed.** Their exact
words: *"I see a lot of time the menu is repeating, no repeats in full menu."*
De-duplication by `id` exists (`04-shell-login.js` ~line 158) and looks correct,
so the cause is something else — the rail drawn twice, two different ids sharing
a label, or a repaint duplicating a region. **Reproduce it in the browser
first.** A probe harness was written but never run; rebuild it with
`test/helpers/enter-app.mjs`, walk every role, repaint, and open the phone
drawer, counting `#sidebar` elements and duplicate `.nav-txt` labels. Ask the
owner for a screenshot and their role if it does not reproduce.

**2. The owner is judging the four angles right now.** They have not reported
back. The failure mode to ask about is **convergence** — two chips reading the
same on a real posting. The briefs were tuned against ONE construction role.

**3. Length is deliberately per angle now** (Short 35-65, Direct 55-90, Effort
60-95, The hard part 75-120) — the owner chose that over one band. If drafts
feel wrong-length, change `ANGLE_BRIEF`, not `checkDraft`.

**4. The two dead AI features** — wire the daily import briefing to the
dashboard, delete the orphaned cold-email drafter.

**5. Finish the UI-kit rollout** — every list-shaped page is converted; the card-
and board-shaped ones are not (dashboards, Admin, pipeline, My Team, Assign
Leads). **6. Three stale draft PRs** (#116, #126, #135) — finish or close them.
**7.** `CLAUDE.md` still flags **CSV import/export + a small public API** as the
highest-leverage unstarted bet.

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
The four broken most often: a page registers with `UI.registerPage()` and paints
via `paintPageContent()`, never `content.innerHTML`; anything that must survive a
repaint needs its own region; a repaint that changes nothing must write nothing;
build with `UI.page({…})`, not a twelfth hand-rolled table. Plus the four phone
rules — hover gated on `(hover:hover)`, the menu is a body class not a render,
`#content` is `overflow-x:hidden` below 860px, and an inline style cannot be
responsive. Pinned by `screen-stability-smoke` and `mobile-layout-smoke`.

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

## Traps that will bite you (learned the hard way)

`CLAUDE.md` carries the durable ones — `models/` for tenant tables, the
six-place stage vocabulary, the free-tier instance budget, `renderStoredEmail`,
safe-methods-only retries, the `orgIdFor()` fallback, route registration order,
and the PDF/AI/mobile/outreach blocks. **Read it; these are the ones it does not
cover.**

**Before moving ANY file** → archive § "DEPENDENCY MAP" (Session 8). Ten things
break on a naive move and several fail *silently*.

- **When one operation has several code paths, they will diverge, and the
  divergence will be silent.** Three paths released a lead to the pool; the odd
  one out made every lead in the live pool invisible to distribution. One shared
  helper, always.
- **A test that greps a VARIABLE NAME breaks on every refactor and passes on a
  real behaviour change.** Assert behaviour. Two did exactly this in Session 20.
- **A check that samples "the last few lines" fires on short input.** The
  double-sign-off check rejected the identity sentence rule 1 requires.
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
- **A destructive DB action needs, in order:** check FK cascades, verify scope
  with counts, snapshot, explicit confirmation, verify after.
- **A clean merge is not a correct merge** when one side deletes a symbol and
  the other adds a use of it. Re-run the suite against merged `main` immediately
  before merging.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- OpenRouter's model names are **still unverified** — no key configured. Groq's
  are verified and now directly testable.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API**, generalized audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker, no shared
  mailboxes, unread badge is a 60s cached poll.
- A per-call AI usage history (the meter is a daily counter, not an audit log).
- Follow-up variants are still rules-only — the four first-outreach angles are
  AI-written, the three follow-up shapes are not.

## Working rules

`npm test` (**61 suites**, judged by **exit code** — read the count, not just
the code: `npm test | tail -3` masks a failure) · **run it on Node 26 too** ·
`bash test/verify-frontend.sh` · build on the dev branch → test → show the owner
→ draft PR → **merge on their go-ahead** → apply a migration only on a fresh
explicit go-ahead. **The owner does not read code**; show them the running app
and plain English.

**Habits these sessions paid for:**

- **Test against the real thing when you can.** Session 20's whole lesson: every
  belief about the AI writer was inference until the network opened, and two of
  those beliefs were wrong.
- **Make the app record a fact, then read it** — for everything you still
  cannot reach.
- **Never let a diagnosis sound more certain than the evidence.**
- **When a feature reports nothing, check its request reaches its handler**
  before improving what the handler says.
- **A default that silently disables a check is worse than no check.**
- **Reproduce a visual complaint in the browser before changing CSS**, and know
  whether a red test pinned WORDING or BEHAVIOUR before "fixing" it.
- **Never wait on the suite with `pgrep -f run-all.mjs`** — the waiter matches
  itself. Write the log to a file and grep it for the summary line.
