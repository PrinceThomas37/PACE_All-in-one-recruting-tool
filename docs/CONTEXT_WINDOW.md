# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-23 (Session 28) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #225 (`4a29427`, failed-email retry). **Nothing is
unmerged once it lands.** **D-0031 is the highest decision id** (failed emails retry themselves, Session 29).

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.**

**⚠ THE ARCHIVE IS WRITTEN AS THE WORK LANDS, NOT AT THE END (D-0024).** "End of
session" is a moment that never announces itself — a rate limit or a closed
window ends the session instead, and anything not in a file is gone. Append a
section per round as it completes; only the closing synthesis waits, and it is
additive, so a session that dies loses the summary and not the facts.

If you're picking this up cold: `CLAUDE.md` is the durable source of truth for
anything this file and the archive don't cover — trust it over an old-looking
line here.

## 📋 READ `docs/ROADMAP.md` — THE LIVE LIST (D-0030, new this session)

**Every suggestion made to the owner is a row there**, written in the same turn
it is made. `PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`, nothing ever
deleted. **`CHANGED` is not `DONE`** — such a row keeps what was proposed, what
shipped and why it moved.

**When the owner asks "what's left", read that file.** Do not rebuild the list
from memory or `git log`: a suggestion nobody acted on leaves no trace in
either. Answer grouped by who is blocked — me, them, or an open question.

Mirror every change to the artifact `NQ4HUuMfAWJk34g9Vs5EdQ` (`ArtifactData`,
collections `items`/`shipped`, `doc_id` = the row id). **The file wins any
disagreement.**

## 🧭 READ `docs/territories/README.md` BEFORE STARTING ANY JOB

Nine territories, each a Claude Code subagent with its own border, laws and
**memory file**: `surface` · `gateway` · `deep` · `harbour` · `observatory` ·
`guild` · `rampart` · `foundry` · `ledger`, plus **`dispatch`**, the front door.

- **Arrived as a sentence and a screenshot? → `dispatch`.** It reproduces the
  report, then routes.
- **`docs/territories/DECISIONS.md` is what the owner already settled.** Check
  it before proposing anything or calling anything a bug. **D-0030 is the
  highest id used.** D-0023 in particular: TWO of its three calls went against
  my advice, so read it before "improving" any of them.
- **`docs/territories/CAPABILITIES.md` is what PACE can already DO.** Grep it in
  the owner's words before building. Two live paths to one outcome is the bug.
- **`docs/territories/INTAKE.md` is how to read the owner.** **Reproduce the
  sentence, not your hypothesis.**
- A territory reads its memory FIRST and rewrites it LAST. **The subagent's
  context dies when it finishes.**
- A territory never edits another's paths — it opens a request in
  `_contracts.md`. **C-0020 is the highest id used; C-0019 and C-0020 are now
  CLOSED.**
- **`node scripts/territory-map.mjs` after any restructure.** It fails loudly on
  a file owned by nobody.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## 🔑 THE SANDBOX CAN CALL GROQ — USE IT

`api.groq.com` is allowlisted. **Get to the real thing rather than reasoning
about output you are allowed to look at.** Key: `app_settings` →
`int_groq_api_key`. Verified models (2026-09-05): `openai/gpt-oss-20b` fast,
`openai/gpt-oss-120b` quality. **Free tier is 8,000 tokens/minute.**

## What is live right now

The **leads engine** (import → distribute → cold email → follow-ups → reply
sweep → recycle) and the **ATS** (job orders, candidates, pipeline, submissions,
11 stages). **Outreach generator** (client) and **candidate outreach** (own
queue, own send window, answer buttons in the email). **In-app mailbox** over
Graph and Gmail, plus read-only **All email** across all three pipelines.
**Reminders + "needs you today"**, owner-scoped since Session 24. **The public
apply page** — publish a job order, get a link, applicants land parsed and
deduped in the Sourcing review queue (Session 27). **Creating a
job order** — from a Connected lead, or directly from "+ New Job", which now
resolves the client, captures its address and requires a POC. Billing and
self-serve signup are built and **off**.

## Migrations — next is **047** · 046 APPLIED 2026-09-23 (email retry columns, D-0031) · 045 APPLIED 2026-09-23

**Never apply one to the live DB without an explicit, fresh go-ahead.** A
migration adding a table with `org_id` must also add it to `models/tables.js`.
045 added **`record_history`** — one general trail for the record kinds that
had nowhere to write (job orders, candidates, companies), behind the rewind
clock. Verified after: 11 columns, RLS on, 1 service-role policy, 3 indexes,
0 rows. Applied to an EMPTY database, so there is no backfill and no historic
gap — which is exactly why it was cheap on the day of the production reset.
044 added `apply_token` / `apply_enabled` / `apply_published_at` / `apply_count`
to `job_orders` plus two indexes, for the public apply page.

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

A whole class of bug is invisible here — it cost a session once. When something
works here and fails there, **get the server's Node and re-run before
theorising**; `nodejs.org/dist` is reachable from this sandbox.

## ✅ RECENTLY SHIPPED — full narratives in `CONTEXT_ARCHIVE.md`

**Session 28 (#220, #221, #222) — the applicant actually arrives somewhere.**
The Jobs page was throwing `j is not defined` on every render and **five browser
suites rendered it and passed** — a crashed page has perfect contrast, three DOM
nodes and no overflow, so it outscores a working one on every metric they
collect. `test/page-renders-smoke.mjs` now asks the dumber question (did the
screen render at all) across **190 screens**. Then applicants became visible —
Candidates → **Applicants** and a block on each job order, both reading ONE
queue (`D-0028`) — and accepting one was found, **on the live database**, to
write only the `candidate_pipeline` tag row while every screen reads
`submissions.stage`: accepted people were in the database and counted nowhere.
Import now writes both. Applicants get a receipt, the job owner gets a nudge
(`services/applicant-notify.js`, from the job owner's mailbox **or nobody**),
and each is scored against the job they chose. Finally the owner corrected the
domain — *"adding a candidate to a job is not submission"* — and
`services/submission-stages.js` became the ONE definition: **`submissions` the
TABLE is misnamed**, the word had been counted three different ways at once, and
two of them counted sourced candidates as submissions. `D-0029`, `D-0030`.

**Session 27 (#217, #218) — the front door, and an honest Sourcing page.**
Candidate sourcing was CSV-only; eight of the nine steps were already built, so
the gap was a front door, not a feature. `routes/apply.js` publishes a job order
at `/apply/<token>`; applicants land parsed and deduped in
`sourcing_candidates`, inert, **no second import path**. `services/jd-scrub.js`
was extracted so the JD-rewrite button and the apply page share ONE definition
of "safe to publish". Then `config/sourcing.js` was rewritten to separate
**`built`** from **`available`** — six providers had rendered as working cards
for five sessions with 501s behind them. Also: **OpenRouter's fast model had
been dead since 2026-07-19** (see the AI trap below). D-0025, D-0026.

**Session 26 (#214, #216) — the button that had never worked.** `+ New Job`
sent `company_id: null`, hard-coded, so **every direct create had always been
refused**; the convert-from-lead path masked it. The Client box is a typeahead
and the SERVER resolves the name (`services/client-resolve.js`).
Then **a job order carries its client (D-0023 — READ IT, two of its three calls
went against advice)**: a POC is required, the address gets real columns (043),
and the **21-day company cooldown applies here**.
⚠ **The cooldown counts leads and a job order creates one, so a client's SECOND
requirement inside the window is blocked.** The owner chose this knowing it
would refuse genuine job orders. Do not soften it; D-0023 holds the two fixes.
`services/company-cooldown.js` is the one definition, replacing three that
disagreed. `public/js/52-poc-block.js` is the shared POC block — **the RA
form's older copy is retired into it, never joined by a third.**
⚠ **A child's top margin COLLAPSES out of an empty wrapper**, so reserve space
with padding, never margin (a late duplicate-email answer was moving a button
20px and eating the click).
**`.gc2/.gc3/.gc4` are column-only grids** — use these, not `.g2`, to convert an
inline grid; `.g2` also sets a gap and would move every screen.

**Sessions 24-25 (#200, #208-#212).** Ownership defined once
(`services/ownership.js`); a reminder says who asked and why; merge fields are
filled by the server then CHECKED; a list is calm and colour is scarce (D-0019);
theme follows the person (D-0022); D-0012 completed. A float must be OPAQUE
(`--card` is glass), and the phone's type scale must include its own inputs.

## ⏭ PICK THIS UP FIRST

**0. `docs/ROADMAP.md` holds the full open list.** What follows is the shape of
it, not a replacement for reading it.

**1. The apply page is PROVEN.** A real applicant (John Raya) came through it in
production, reached the Sourcing queue, and was accepted onto a job — the live
record was read directly to confirm it, and repaired by SQL where the
accept-path bug had half-written it. The open question is now volume: it is
published on **one** job order (`R-008`).

**2. D-0014 — the row-level interaction brief. Still the live design work.**

The owner's design ask was **progressive disclosure**, and Session 23 answered
it with **volume control** (horizons, caps, pagination) before being corrected:
*"Its not about limiting the number of things that gets accumulated on screen…
why not just minimilistically reduce elements on screen and shows things when
clicked."* **Do not answer a density complaint with a filter again.**

What is actually wrong (established by probing a real browser):

1. **The actions are not where the eye is** — marking an email invalid takes a
   row click, then a contact card inside a drawer.
2. **A row shows no state and offers no action** — a Jobs row is a checkbox.
3. **The same gesture has two outcomes** — a lead row opens a DRAWER over its
   list; a job row LEAVES for `bd_jodetail`. The second is wrong.

**Agreed approach: ONE screen first, then repeat.** **Ask before building any of
it** — they said the revamp is coming *"in sometime"*.

### Raised this session, not yet decided

- **~1,600 inline font sizes and a comparable number of inline colours in
  `public/js`.** This is the shared root cause of the last two rounds of phone
  and theme faults: an inline value cannot be re-themed, re-scaled or
  re-laid-out. Offered as a session of invisible work on the highest-traffic
  screens; **the owner has not answered.** Do not start it unasked.
- **PACE holds almost no contact phone numbers**, so sequence step 3 ("call
  them") now correctly skips nearly always. Either start capturing numbers at
  import or redesign that step around email. **Owner has not chosen.**
- **The recruiter-seeing-a-manager's-reminders report could not be reproduced**
  on current code, and was stated as such. Ask before treating it as open.

## 🧪 TESTS: 95 SUITES

`npm test` — read the COUNT, not just the exit code, and **never pipe it into
`tail`** (that takes `tail`'s exit status). `bash test/verify-frontend.sh` too.

The newest exist because reasoning failed, and each measures what a person saw:

- **`apply-page-smoke`** (new, 67) — the public apply page: unknown /
  malformed / unpublished / filled tokens answering byte-identically, a
  malformed token never reaching the database, the client's name never
  published, a failed write never reported as saved, and that an applicant
  never lands in `candidates`.
- **`sourcing-honesty-smoke`** (new, 31) — `built` vs `available`, the
  endpoint's `not_built` refusal, and a real-browser check that **no unbuilt
  provider sits in a panel offering an action**.
- **`modal-mobile-smoke`** — 18 pop-ups at 390px in both themes,
  measuring content past the viewport, content CLIPPED inside the pop-up, and
  any field squeezed under 90px. An opener that draws nothing is a FAILURE.
- **`poc-block-shared-smoke`**, **`company-merge-smoke`** — the one
  contact block in both forms, and the client merge (including a guard that
  reads the migrations for any table with a `company_id`).
- **`client-intake-smoke`**, **`new-job-client-smoke`** — the client and
  POC rules, the routes driven with a **stub database** (so the company really
  is found-or-created and the rows really are org-stamped), and the real form
  at 1500px and 390px. Includes the guard that the browser's copy of the POC
  rule and the server's **still agree, case for case** — a drift there means
  the form accepts what the server refuses.
- **`theme-contrast-smoke`** — composites every translucent ancestor; 51 screens
  x 3 roles x 2 themes, plus logged-out, hovering and opening a row.
- **`ageing-layout-smoke`** — 16 pages x 5 roles at 20 records and at 2,000.
- **`overlay-opacity-smoke`** — panel opacity and modal type scale, both widths.
- **`reminder-clarity-smoke`**, **`ownership-smoke`** — the Session 24 rules.

**⚠ ASSUME YOUR NEW GUARD IS VACUOUS UNTIL YOU HAVE SEEN IT FAIL.** **Seven**
have now been caught passing while the thing they guarded was broken or
switched off — two in Session 23, two in Session 24, two in Session 26, one in
Session 27 (which passed **30/30** with its bug fully reintroduced). That is
frequent enough to be the default assumption, not a caveat. **Reintroduce the
bug and watch the test fail**, every time. When one turns out to be vacuous and you keep it
anyway, label it in the suite as a known limit (there is one such note in
`overlay-opacity-smoke`) rather than letting its presence read as coverage.

**And a suite only covers the screens it renders** — `theme-contrast-smoke`
passed clean through twelve transparent panels because it never opened one.
**Nor does it cover what nobody thought to assert:** Session 26's caret-eating
redraw was found in a screenshot with 38 green checks on screen. Produce the
artefact and look at it.

## 🔒 THE APP BYPASSES ITS OWN DATABASE SECURITY

RLS is on all 48 tables, but the server holds the **service-role key**, which is
exempt from RLS by design. So **org scoping is enforced by application code, not
by the database.** Use `models/` — `db.forRequest(req).from('candidates')` —
never a hand-written `supabase.from()` on a tenant table. `rampart` reviews
anything touching scoping, and **a breach here produces no error message.**

## Owner actions outstanding

- **Say whether the 39 legitimate follow-up schedules should keep running.**
  Left running.
- **The accent is Apple blue (`#0071E3`).** One line in `theme.css` to move it.
- **`PICKER_CAP` is 15**, so 19 connected leads becomes a search box. Flagged as
  possibly too eager.
- Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` on Render.
- **Deploys cannot be confirmed from this sandbox** — the agent proxy refuses
  the Render host (403 on CONNECT), and this was true again in Session 27. The
  merge lands; whether the service came up clean is **unverified from here**.
  Say so plainly rather than reporting a deploy as confirmed. Ask the owner, or
  check Render.
- **Publish one job order's apply page and post the link somewhere** — the
  apply page has never been exercised in production (Session 27).
- **Run the AI health check now that an OpenRouter key exists** (Admin →
  Integrations). It reads the account's real `/models` list, which is the only
  way to set a genuinely fast OpenRouter model rather than guessing one — and
  guessing is what killed this twice. Both tiers currently point at the same
  quality model deliberately.

## ⏸ Parked by the owner — do NOT re-raise as blocking

`docs/territories/DECISIONS.md` is the authority. Notably: pricing stays `null`,
self-serve signup stays off, no backfill of the 81 wrong lead timezones, **no
file attachments on candidate email** (D-0012), and **reassignment of ownership
is deliberately not built** (D-0020).

## Traps that will bite you

- **A GUARD IS VACUOUS UNTIL YOU HAVE WATCHED IT FAIL — now three times over.**
  Session 27's newest test passed **30/30 with its bug fully reintroduced**. Two
  causes worth carrying into every probe: **`if (!node) continue`** silently
  counted an unmeasurable case as a pass (**a probe that cannot take its
  measurement must FAIL**), and it read `node.parentElement` when the control
  sat one level higher (**never anchor a DOM assertion on a nesting depth**).
  Before trusting any new guard, put the bug back and watch the right
  assertions break.
- **A screenshot sees what a green suite cannot.** A public page reading
  *"Questions? Email or call ."* shipped past 88 passing suites. Render it and
  look at it.

- **`*.onrender.com` is blocked from this sandbox.** You cannot verify a deploy
  by loading the app. Verify the code is on `main` by content, and check
  `engine_runs` in Supabase. **Do not claim you watched it come up.**
- **Registration order is load-bearing in every router.** A literal path after a
  matching `:param` route is DEAD and fails silently with a valid 200.
- **Every reader of a stored email body must call `renderStoredEmail`.**
- **A page module must not write `#content`** — register with `UI.registerPage`.
- **Prefer an edit anchored on the exact text being replaced** over one anchored
  on a start and an end line. A range edit once silently swallowed two
  functions; `node --check` passed and so did the suite.
- **Never `git add -A`** — stage the paths the commit is about. That is how half
  a feature once reached `main`.
- **`TEST_USERS` is not the user set** — a five-role sweep skips three real ones.
- **This sandbox cannot measure smoothness** — headless Chromium composites in
  software, so a timing assertion passes whatever happens. Judge by layer
  counts, node counts and pixel diffs; how it FEELS is the owner's call.
