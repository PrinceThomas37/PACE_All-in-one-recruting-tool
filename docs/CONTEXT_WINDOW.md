# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-09 (end of Session 22) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #191. Nothing is unmerged.

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.**

If you're picking this up cold: `CLAUDE.md` is the durable source of truth for
anything this file and the archive don't cover — trust it over an old-looking
line here.

## 🧭 READ `docs/territories/README.md` BEFORE STARTING ANY JOB

Session 22 divided the repo into **nine territories**, each a Claude Code
subagent with its own border, its own laws and **its own memory file** — so a
session no longer re-reads `CLAUDE.md` end to end before it can touch anything.
`surface` · `gateway` · `deep` · `harbour` · `observatory` · `guild` ·
`rampart` · `foundry` · `ledger`, plus **`dispatch`**, the front door.

- **Not sure which team owns something, or it arrived as a sentence and a
  screenshot? → `dispatch`.** It reproduces the report, then routes.
- **`docs/territories/INTAKE.md` is how to read the owner** — they do not read
  code, and what arrives is a sentence or an image. **Reproduce the sentence,
  not your hypothesis.**
- A territory reads its memory FIRST and rewrites it LAST. **The subagent's
  context dies when it finishes, so anything not written down is lost.**
- A territory never edits another territory's paths — it opens a request in
  `docs/territories/_contracts.md`. **C-0009 is the highest id used.**
- **`node scripts/territory-map.mjs` after any restructure.** It fails loudly
  on a file owned by nobody, and rewrites the island page's data block.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## 🔑 THE SANDBOX CAN CALL GROQ — USE IT

`api.groq.com` is on this environment's allowlist. **Get to the real thing
rather than reasoning about output you are allowed to look at** — the first
real generation once found two bugs in ten minutes that a careful hour of
reading had missed.

- Key is in `app_settings` under `int_groq_api_key`. **Write it to a file and
  read it from there** — an inline credential is refused, and delete the file
  after. **This needs Supabase credentials, which a bare sandbox does not
  have**; without them the key is unreachable and the AI path cannot be tested.
- **Node's `fetch` does not use the proxy; `curl` does.** Build the request in
  Node, POST it with curl, parse the reply in Node.
- **Free tier = 8,000 tokens/minute**, ~2,100 per outreach angle. Sleep ~20s.
- `*.onrender.com` is blocked. The live app is read through Supabase.

## What is live right now

Detail for every line is in `CLAUDE.md`. This is an index.

- The recruiting ATS + BD lead engine, **multi-tenant by `org_id`**, RLS on all
  48 tables. Self-serve signup built and **switched OFF**; pricing `null`; no
  guest bypass.
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, relevance engine,
  lead sourcing, candidate outreach, conversation intelligence.
- **The in-app mailbox** (four inviolable rules — `CLAUDE.md` growth bet §3).
- **The outreach generator**, genuinely AI-written and owner-approved — four
  angles, every draft held to `checkDraft()`, rewritable 3× (capped
  server-side). `openai/gpt-oss-120b`, ~1.5s.
- **Candidate outreach as a drip** — emailed in the candidate's own local free
  time, 6 per tick with a 75-105s pause, two answer buttons in the email.
- **The morning briefing** on all three dashboards (Session 22).
- **Any AI provider behind a daily budget**, quality→fast fallback. Every email
  keeps its text across all six channels.
- **The shared UI kit + `public/mobile.css`** — off-canvas nav below 860px.
- SSO with Microsoft. Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` —
  **distinct from** per-user Gmail *sending*, which is live.

## Migrations — next is **043**

**Never apply one to the live DB without a fresh, explicit go-ahead**, even when
the feature itself was agreed — and **apply it BEFORE merging the code that uses
it.** An insert naming a column that does not exist fails *after* the email has
already gone out.

**`ls migrations/` for the highest number before choosing one** — do not trust
this heading. Two files are both numbered `042` (both applied and verified,
2026-09-09) because someone trusted a heading. That is a naming defect, not a
data one, and deliberately not renamed: the filename is the record of what was
applied. `deep` owns this territory and **never applies a migration itself.**

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

It cost most of Session 19: resume parsing failed in production and every file
parsed perfectly here — same library, same bytes. **The difference was the
RUNTIME.** Run both before merging anything touching a parsing or binary path:

```
curl -sS -o /tmp/n.tar.xz https://nodejs.org/dist/v26.8.1/node-v26.8.1-linux-x64.tar.xz
mkdir -p /tmp/n26 && tar -xf /tmp/n.tar.xz -C /tmp/n26 --strip-components=1
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /tmp/n26/bin/node test/run-all.mjs
```

## ✅ Shipped (Session 22) — PR #191, live

**Nine territories** (above), the front door, `INTAKE.md`, the border ledger,
`scripts/territory-map.mjs` (found two files owned by nobody on its first run)
and `docs/territories/island.html` — the survey as a 3D island, published as an
artifact. **The survey is built BEFORE the 3D and the 3D is optional.**

**The morning briefing** — the first job run through the system, by four
territories. `dispatch` rendered all four dashboards in a browser and counted:
**an admin reads ten numbers before a single word**, every complete sentence on
screen is an empty-state message, and none of the numbers is even about today.
The feature turned out to be **already built twice and never connected**.

- `services/morning-briefing.js` is PURE; `GET /ai/morning-briefing` is the
  route. **`summary` is never empty**, so there is no "unavailable" state to
  draw. `checkBriefing()` rejects any integer the model was not handed, plus
  spelled-out numbers and vague quantities — **"around a dozen leads" passes
  every digit check and is still a lie.**
- **This closed a lie in the product**: `08-page-admin.js` promises the customer
  the daily briefing has a non-AI version. Until now it degraded to an apology.
- **C-0006 closed: `bd_lead`, `director` and `associate_director` had no entry
  in `test/helpers/enter-app.mjs`** — every role sweep covered five of the eight
  values `users.role` can hold. That is why Session 21's icon collision survived
  a five-role sweep.
- C-0008/C-0009: the next-actions card vanished silently on error and stuck
  loading forever during "view as". Both predate this work (c5cb602), both fixed.

## ⏭ PICK THIS UP FIRST (Session 23)

**1. The morning briefing's AI path has NEVER been called against a real
provider.** The sandbox has no Supabase credentials, so the stored Groq key is
unreachable; that branch is exercised only against hand-written model output.
The rules path — what ships every day — is properly tested. **Check the live
app and `ai_last_error`; this closes only in production.**

**2. Nothing shipped since #185 has been seen working live by the owner** — the
rail icon, the ‹ › candidate stepper, opening a sent email, the Rewrite button,
and now the briefing card. All pinned by tests; none confirmed by a human.

**3. The territory system has run four jobs.** Whether the memory files are
pitched at the right level of detail is genuinely unknown. **If nine teams reads
as overhead, collapse `ledger` into `rampart` and `guild` into `gateway`** —
merging teams is far cheaper than splitting them later.

**4.** `/ai/generate-email` is still dead — reachable only from the orphaned
`12-manager-users.js`. Delete it or wire it. **5.** Finish the UI-kit rollout
(dashboards, Admin, pipeline, My Team, Assign Leads). **6.** Three stale draft
PRs (#116, #126, #135). **7.** CSV import/export + a small public API is the
highest-leverage unstarted bet; `dispatch` has already mapped the six
territories it touches (the island's route runner shows the order).

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

1. **Try the morning briefing live** and say whether that sentence is useful.
2. **Consider rotating the Groq key** — it passed through a Session 20
   transcript when it was read from the database.
3. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render, if wanted.
4. **Verify one real Greenhouse/Lever board** via "Test it" — the adapters have
   never met a live feed.
5. **Set prices, decide on card payments** — `services/plans.js`, one line.
6. **Turn on `SELF_SERVE_SIGNUP`** whenever strangers should be able to sign up.

## Traps that will bite you

**`CLAUDE.md` carries all the durable ones**, and each territory's memory
carries its own — read those two, not a paraphrase. Still worth repeating here
because they bite in the moment:

- **Reproduce the sentence, not your hypothesis.** The owner's throwaway clause
  is usually the diagnosis.
- **An agent's report is a claim, not evidence.** A Session 22 commit message
  repeated one without checking and was wrong. Verify, then write it down.
- **Read what was IN the run, not just the count.** Two green runs can cover
  different things, and `npm test | tail -3` returns `tail`'s exit status.
- **When one operation has several code paths, they diverge silently.**
- **A test that greps a VARIABLE NAME** passes on a real behaviour change.
- **A check that samples "the last few lines" fires on short input.**
- **A card must never sit in a loading state that nothing can resolve.**
- **`emails.sent_at` defaults to `CURRENT_DATE`** — an unsent draft already
  carries a send date, so "sent on X" reports count drafts.
- **A destructive DB action needs, in order:** check FK cascades, verify scope
  with counts, snapshot, explicit confirmation, verify after.
- **Never wait on the suite with `pgrep -f run-all.mjs`** — the waiter matches
  itself. Write to a log file and grep it.
- **Before moving ANY file** → archive § "DEPENDENCY MAP" (Session 8).

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- `/bd-analytics/*` is legacy and **un-org-scoped** (C-0003). The orphaned
  "Manager Users" page + its `email_accounts` subsystem needs an audit-and-split.
- OpenRouter's model names are **still unverified** (no key).
- Growth bets not started: per-role permissions, **CSV import/export + public
  API**, generalized audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker, no shared
  mailboxes, unread badge is a 60s cached poll.
- Follow-up variants are still rules-only; a per-call AI usage history would be
  its own table.

## Working rules

`npm test` (**67 suites**, judged by **exit code** — read the count, not just
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
