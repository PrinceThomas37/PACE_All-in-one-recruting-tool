# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-16 (end of Session 25) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #212. **Nothing is unmerged.**

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.**

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
  it before proposing anything or calling anything a bug. **D-0022 is the
  highest id used.**
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
**Reminders + "needs you today"**, owner-scoped since Session 24. Billing and
self-serve signup are built and **off**.

## Migrations — next is **044** · 043 WRITTEN, NOT APPLIED

**Never apply one to the live DB without an explicit, fresh go-ahead.** A
migration adding a table with `org_id` must also add it to `models/tables.js`.

## ⚠ THE SANDBOX IS NODE 22. RENDER IS NODE 26.

A whole class of bug is invisible here — it cost a session once. When something
works here and fails there, **get the server's Node and re-run before
theorising**; `nodejs.org/dist` is reachable from this sandbox.

## ✅ SHIPPED — Session 24 (PRs #208-#211): the Reminders page, and ownership

Four rounds, all from the owner looking at their own screen. **Full narrative in
the archive; every rule below is also in `CLAUDE.md`.** What is now true:

- **Every reminder says who asked**, and **"due today" is only said about
  today** (`services/reminder-source.js`, pure).
- **Merge fields are filled by the SERVER and then CHECKED.** PACE had two merge
  vocabularies and one filler; `VAR_SYNONYMS` maps one fact to all its names and
  `unresolvedVars()` refuses with a 400. **Blanking sends "Hi ,".**
- **The double-send rule lives where the action is OFFERED**
  (`services/outreach-dedup.js`), not only where it is taken.
- **A task PACE cannot carry out is not created** (D-0017).
- **Ownership is defined once** (`services/ownership.js`, D-0020): a reminder's
  owner is its `user_id`, a lead's `assigned_to_bd`, a submission's
  `recruiter_id`. Your list is yours; a manager gets a COUNT, a review screen,
  and a **prompt** onto the owner's own list. They never reach in.
- **The briefing is about the reader's desk** (D-0021), admin excepted, and
  **the theme follows the person, not the browser** (D-0022).
- **Colour is scarce on a list**: overdue is the ORDINARY state of a to-do list.

## ✅ SHIPPED — Session 25 (PRs #200, #212)

- **#200 finished and merged.** D-0012 is complete: **one** way to email a
  candidate about a job (Email → Compose → Candidates), with the job description
  as a panel INSIDE the email. The old "Email JD to candidates" flow and the
  candidate profile's Email button are gone.
  **⚠ `POST /candidates/email` is still live and must stay** — `remSendMeeting`
  sends Teams interview invites through it.
  Two things went with the removal, both chosen: **file attachments** (D-0012,
  asked and answered) and the one-off "email this person" path (the in-app
  mailbox covers it).
- **#212 — two faults off the owner's phone.** A float must be opaque
  (`--card` is glass; twelve hand-rolled panels were see-through), and the
  phone's type scale must include its own inputs (labels 11.5px against 16px
  fields read as "the fonts are not uniform"; the family was identical). Both
  rules are written up in `CLAUDE.md`.

## ✅ SHIPPED — Session 26: "+ New Job" works without a lead

The owner filled in the New Job form and got *"lead.company_id and
lead.position are required (lead info must be filled first)."* Three faults:

- **`25-workflow-bd.js` sent `company_id: null` — hard-coded.** The Client box
  was free text that was never resolved to a `companies` row, so the direct
  "+ New Job" path could not succeed for anybody, ever. The convert-from-lead
  path was fine, which is why nobody noticed. It is now a **typeahead**
  (`51-company-autocomplete.js`, shared, same idiom as the zip one) and the
  **SERVER** resolves the name — `services/client-resolve.js`, pure — by exact
  normalised match inside the org, else find-or-create. **Nobody has to make a
  lead first: `POST /job-orders` creates it for them.** A refusal naming a JSON
  field is a refusal nobody can act on.
- **That route's `jobs` and `contacts` inserts carried no `orgStamp`.** The
  column has a DEFAULT, so a second org's job order would have landed silently
  in the DEFAULT org's leads. Fixed and pinned.
- **The modal drew three columns on a phone.** Its grid was inline, and an
  inline style cannot be re-laid-out — the whole right column (Client, Work
  Authorization, City, End Date) sat 72px off-screen, unreachable behind
  `overflow-x:hidden`. `.g3`/`.g2` already existed and already collapse.
  **Other modals almost certainly have the same fault; nothing has checked.**

## ✅ SHIPPED — Session 26, round 2: a job order now carries its client (D-0023)

The owner asked that a directly-created job capture the client properly — POC
name, email, phone, and the company address. Most of it was wiring: `POST
/job-orders` already accepted a contacts list and nothing ever sent one.

**Three decisions were theirs, and TWO WENT AGAINST MY RECOMMENDATION.** Read
D-0023 before touching any of it:
- **POC name + email required**, phone and LinkedIn optional. (Agreed. The live
  data: 328 of 328 leads have a POC, 708 of 709 contacts have an email, but 163
  of 709 have no phone — requiring one would buy invented numbers, per D-0017.)
- **Structured address columns**, not the existing free-text `location`.
  **Migration 043 — WRITTEN, NOT YET APPLIED.** Additive; `location` stays as
  the short display form and is derived. The address write is deliberately
  non-fatal so an unapplied migration costs an address, never the job order.
- **The 21-day company cooldown applies here**, same as the RA form. They took
  the stated trade ("it will refuse genuine job orders"). **⚠ The cooldown
  counts leads and a job order creates one, so a client's SECOND requirement
  inside the window is blocked.** Do not quietly soften it; D-0023 holds the
  two fixes for when a BD actually reports it.

Also: `services/company-cooldown.js` is now the ONE definition of that rule,
replacing three that disagreed (the server's was gated to RAs only; the
browser's hard-coded 21 while the real number is admin-editable).
`public/js/52-poc-block.js` is the shared POC block — **the RA form's older copy
is the thing to retire into it, not a second one to keep.**

Found by screenshot, not by a test: the duplicate-email check redrew the whole
POC block when its answer arrived, replacing the box the person had moved on to
and eating what they had typed. It patches one note now.

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

## 🧪 TESTS: 84 SUITES

`npm test` — read the COUNT, not just the exit code, and **never pipe it into
`tail`** (that takes `tail`'s exit status). `bash test/verify-frontend.sh` too.

The newest exist because reasoning failed, and each measures what a person saw:

- **`client-intake-smoke`** (new) — the POC rule, the address, the cooldown at
  its boundaries, the route on a stub database, and the form in a real browser.
  Includes the guard that the browser's copy of the POC rule and the server's
  still agree, case for case.
- **`new-job-client-smoke`** — the pure client rule, the route driven with
  a **stub database** (so the company really is found-or-created and the rows
  really are org-stamped), and the real form in a real browser at 1500px and
  390px. Every guard was verified by reintroducing its own bug and watching it
  fail.
- **`overlay-opacity-smoke`** — panel opacity in both themes, and the
  modal type scale at 390px AND 1280px.
- **`candidate-jd-panel-smoke`** (new) — the JD panel, including that the card
  is always a rendering of the stored text.
- **`theme-contrast-smoke`** — composites every translucent ancestor; 51 screens
  x 3 roles x 2 themes, plus logged-out, hovering and opening a row.
- **`ageing-layout-smoke`** — 16 pages x 5 roles at 20 records and at 2,000.
- **`reminder-clarity-smoke`**, **`ownership-smoke`** — the Session 24 rules.

**⚠ ASSUME YOUR NEW GUARD IS VACUOUS UNTIL YOU HAVE SEEN IT FAIL.** Four have
been caught passing while the thing they guarded was broken or switched off —
twice in Session 23, twice in Session 24. **Reintroduce the bug and watch the
test fail**, every time. When one turns out to be vacuous and you keep it
anyway, label it in the suite as a known limit (there is one such note in
`overlay-opacity-smoke`) rather than letting its presence read as coverage.

**And a suite only covers the screens it renders.** `theme-contrast-smoke`
passed clean through twelve transparent panels because it never opened one.

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
