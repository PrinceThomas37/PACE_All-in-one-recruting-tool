# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-17 (end of Session 26) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #215 (`192a3cb`); #216 in flight. **Nothing is
unmerged once it lands.** **D-0024 is the highest decision id.**

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

## 🧭 READ `docs/territories/README.md` BEFORE STARTING ANY JOB

Nine territories, each a Claude Code subagent with its own border, laws and
**memory file**: `surface` · `gateway` · `deep` · `harbour` · `observatory` ·
`guild` · `rampart` · `foundry` · `ledger`, plus **`dispatch`**, the front door.

- **Arrived as a sentence and a screenshot? → `dispatch`.** It reproduces the
  report, then routes.
- **`docs/territories/DECISIONS.md` is what the owner already settled.** Check
  it before proposing anything or calling anything a bug. **D-0024 is the
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
**Reminders + "needs you today"**, owner-scoped since Session 24. **Creating a
job order** — from a Connected lead, or directly from "+ New Job", which now
resolves the client, captures its address and requires a POC. Billing and
self-serve signup are built and **off**.

## Migrations — next is **044** · 043 APPLIED 2026-09-17

**Never apply one to the live DB without an explicit, fresh go-ahead.** A
migration adding a table with `org_id` must also add it to `models/tables.js`.
043 added six postal-address columns to `companies`; verified after by a content
fingerprint identical before and after, 0 rows touched.

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

A whole class of bug is invisible here — it cost a session once. When something
works here and fails there, **get the server's Node and re-run before
theorising**; `nodejs.org/dist` is reachable from this sandbox.

## ✅ RECENTLY SHIPPED — full narratives in `CONTEXT_ARCHIVE.md`

**Session 24 (#208-#211) — the Reminders page and ownership.** A reminder says
who asked and why; "due today" is only said about today; `services/ownership.js`
defines ownership once (**a to-do list containing other people's to-dos is not a
to-do list**); a manager reviews and PROMPTS, never reaches in; merge fields are
filled by the server and then CHECKED; a list is calm and colour is scarce
(D-0019). Theme follows the person, not the browser (D-0022).

**Session 25 (#200, #212).** D-0012 completed — one way to email a candidate
about a job. A float must be OPAQUE (`--card` is glass), and the phone's type
scale must include its own inputs.

**Session 26 (#214) — the button that had never worked.** `+ New Job` sent
`company_id: null`, hard-coded, so **every direct create had always been
refused**; the convert-from-lead path worked and masked it. The Client box is
now a typeahead and the SERVER resolves the name
(`services/client-resolve.js`). Nobody makes a lead first —
`POST /job-orders` creates it. Also: that route's `jobs`/`contacts` inserts
carried **no `orgStamp`**, and the modal's inline grid put its whole right
column 72px off a phone screen.

Then, at the owner's request, **a job order carries its client (D-0023 — READ
IT, two of its three calls went against advice)**: a POC is required (name +
email; phone optional), the address gets real columns (043), and **the 21-day
company cooldown applies here**. `services/company-cooldown.js` is now the one
definition of that rule, replacing three that disagreed — the server's was
gated to RAs only, the browser's hard-coded 21 while the number is
admin-editable. `public/js/52-poc-block.js` is the shared POC block; **the RA
form's older copy is to be retired into it, not joined by a third.**

⚠ **The cooldown counts leads and a job order creates one, so a client's SECOND
requirement inside the window is blocked.** The owner chose this knowing it
would refuse genuine job orders. Do not quietly soften it; D-0023 holds the two
fixes for when a BD actually reports it.

### Session 26, round 4 — the three follow-ups

All three offered at the end of round 3, taken together. **Two of the three
turned up a live bug that nothing was looking for**, and neither was in the
thing being changed.

- **One contact block, not two.** `15-ra-entry-form.js` is migrated onto
  `52-poc-block.js`. `changed` now carries an EVENT: a keystroke must not
  re-render (the RA form redraws wholesale and would take the caret), a shape
  change must (its Intel rows are POSITIONAL — a removal that splices only one
  list attaches one person's notes to another). That form had **no test
  coverage at all** before this.
  **⚠ Found while testing it, in the shared block, affecting BOTH forms:** the
  duplicate-email answer arrives ~300ms after you leave the box, moved
  "+ Add another contact" 20px, and the click was silently lost. Reserved by a
  placeholder of the same shape — **a child's top margin COLLAPSES out of an
  empty wrapper**, so padding reserves space, never margin.
- **Every pop-up measured at 390px** — `test/modal-mobile-smoke.mjs`, 18 of them
  in both themes. **Found: the candidate STAGE modal had a 48px field**, the
  screen recruiters use most. Now 322px. Everything else was already clean.
  `.gc2/.gc3/.gc4` are column-only grids — use these, not `.g2`, to convert an
  inline grid, because `.g2` also sets a gap and would move every screen.
- **Merge a duplicate client** — Clients drawer → *Merge a duplicate in*.
  Re-points four tables, soft-deletes the duplicate, records what moved BEFORE
  the delete. The plan is stated in full and Merge stays disabled until there
  is one.

**⚠ THE MODAL SWEEP WAS VACUOUS TWICE**, both times for a reason that reads as
correct: measuring only "past the viewport" misses a grid that CRUSHES its
columns instead of overflowing, and asking CSS for `overflow-x` is useless
because `overflow-y:auto` makes it compute to `auto` too. Caught only by
reintroducing the original bug and watching the suite stay green.

## ⏭ PICK THIS UP FIRST

**D-0014 — the row-level interaction brief. Still the live piece of work.**

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

## 🧪 TESTS: 87 SUITES

`npm test` — read the COUNT, not just the exit code, and **never pipe it into
`tail`** (that takes `tail`'s exit status). `bash test/verify-frontend.sh` too.

The newest exist because reasoning failed, and each measures what a person saw:

- **`modal-mobile-smoke`** (new) — 18 pop-ups at 390px in both themes,
  measuring content past the viewport, content CLIPPED inside the pop-up, and
  any field squeezed under 90px. An opener that draws nothing is a FAILURE.
- **`poc-block-shared-smoke`**, **`company-merge-smoke`** (new) — the one
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

**⚠ ASSUME YOUR NEW GUARD IS VACUOUS UNTIL YOU HAVE SEEN IT FAIL.** Four have
been caught passing while the thing they guarded was broken or switched off —
twice in Session 23, twice in Session 24. **Reintroduce the bug and watch the
test fail**, every time. When one turns out to be vacuous and you keep it
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
- **Session 26's deploy was never confirmed from the sandbox** — the agent proxy
  refuses the Render host (403 on CONNECT). The merge landed; whether the
  service came up clean is unverified from here. Ask, or check Render.

## ⏸ Parked by the owner — do NOT re-raise as blocking

`docs/territories/DECISIONS.md` is the authority. Notably: pricing stays `null`,
self-serve signup stays off, no backfill of the 81 wrong lead timezones, **no
file attachments on candidate email** (D-0012), and **reassignment of ownership
is deliberately not built** (D-0020).

## Traps that will bite you

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
