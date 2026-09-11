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
- **`docs/territories/DECISIONS.md` is what the owner already settled.** Check
  it before proposing anything or calling anything a bug — a parked defect is
  not an open one. 11 entries, each with a **Re-open when** condition.
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

**`CLAUDE.md` is the detail; this is the one-line index.** The recruiting ATS +
BD lead engine, multi-tenant by `org_id`, RLS on all 48 tables. The Autonomous
Recruiting Engine, all 5 steps. The in-app mailbox. The outreach generator
(AI-written, every draft held to `checkDraft()`). Candidate outreach as a drip
in the candidate's own local free time. The morning briefing. Any AI provider
behind a daily budget. The shared UI kit, `mobile.css`, and now `theme.css`.
SSO with Microsoft.

**Switched OFF deliberately:** self-serve signup, card payments, pricing
(`null`). **Gone deliberately:** the guest bypass.

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
RUNTIME.** Fetch the current v26 from `nodejs.org/dist/index.json`, extract it,
and run `test/run-all.mjs` with it before merging anything touching a parsing or
binary path. Session 23 ran both on every PR; all 76 suites pass on both.

## ✅ SHIPPED AND LIVE — Session 23 (PRs #202, #203, #204; #205 pending)

**#202 — never follow up on a cold email that was never sent.** 215 `fu1`
emails were queued from one mailbox in a single instant, to 214 real prospects,
for leads whose cold email had NEVER been sent. Cause: `follow_ups` are created
at ASSIGNMENT time and stamped `outreach_sent_at: today`, while the initial
emails drain at one per ~75-105s inside an 8-hour window. The only brake was
that mailbox's 300/day cap, which is above the backlog size. Now a follow-up
requires the initial to be PROVEN sent, and the clock is re-anchored on the real
send date. Live cleanup: 215 pending deleted (backup table
`emails_purged_20260910`), **341** orphan schedules closed
(`follow_ups_closed_20260910`) — including 215 that would have repeated the
whole burst as fu2 on 14 Sep. **86 orphan follow-ups had already gone out since
8 June.**

**#203 — every list gets a horizon and an exit (D-0013).**
`services/view-horizon.js` + a checked copy in `00-ui-kit.js`. 90-day default,
`PICKER_CAP` 15, closed-state exits, counts before lists. The Jobs page went
from **92x DOM growth to 1.25x**. Plus dismiss/snooze on every
Needs-you-today row, and **Email → All email** over all three pipelines.

**#204 — the new look, light and dark (D-0015).** The owner's Bolt design as
one stylesheet, `public/theme.css` (~432 lines), loaded last. No JavaScript
behaviour changed; deleting the one `<link>` restores the old look exactly.
**NOT a React rewrite** — see D-0015 for why that call was reversed after
reading the Bolt source.

**#205 — five faults found on the owner's actual phone.** Open draft at time of
writing. Merge-field chips white-on-white; the login screen never themed (its
backdrop is a **`<canvas>`** — no stylesheet could ever have reached it); the
login tab pill painting `background: var(--text)`, an inversion that becomes
white-on-white in dark; the topbar rendering as a blue slab because the ambient
glow sat behind it; and a touch device at desktop width unable to open the icon
rail.

## ⏭ PICK THIS UP FIRST (Session 24)

**D-0014 — the row-level interaction brief. This is the live piece of work.**

The owner's design ask was **progressive disclosure**, and Session 23 answered
it with **volume control** (horizons, caps, pagination) before being corrected:
*"Its not about limiting the number of things that gets accumulated on screen,
you are not understanding the design, why not just minimilistically reduce
elements on screen and shows things when clicked."* Both are true; they are not
the same instruction. **Do not answer a density complaint with a filter again.**

What is actually wrong, established by probing a real browser (nothing is
broken — the valid/invalid control exists, works, and is visible in the drawer;
git shows nothing ever moved it off a row):

1. **The actions are not where the eye is.** Marking an email invalid takes a
   row click, then finding a contact card inside a drawer. A feature you cannot
   see is a feature you do not have — which is exactly what happened.
2. **A row shows no state and offers no action.** A Jobs row carries a checkbox
   and NOTHING else; a Leads row a checkbox and a stage dropdown.
3. **The same gesture has two outcomes.** A lead row opens a DRAWER over its
   list (keeping filters, selection, scroll — the deliberate rule in
   `CLAUDE.md`); a job row LEAVES the page for `bd_jodetail`. The second is
   wrong.

**Agreed approach: ONE screen first, then repeat.** The owner reacts to one
rebuilt row rather than to thirty screens. **Ask before building any of it** —
they said the revamp is coming *"in sometime"*, and said it immediately after
correcting the previous brief.

Also open and smaller: the **Specific / Random** toggle clips to "Randor" on a
narrow phone (cosmetic, pre-existing, flagged to the owner and left).

## 🧪 TESTS: 76 SUITES. THE FOUR NEWEST EXIST BECAUSE REASONING FAILED

`npm test` — read the COUNT, not just the exit code, and **never pipe it into
`tail`** (that takes `tail`'s exit status).

- **`ageing-layout-smoke`** — renders 16 pages x 5 roles at 20 records and at
  2,000 over two years; fails over 3x DOM growth.
- **`theme-contrast-smoke`** — composites every translucent ancestor to find
  what is REALLY behind each piece of text; 51 screens x 3 roles x 2 themes plus
  the logged-out screen, fails under 2.2:1.
- **`next-action-dismiss-smoke`**, **`orphan-followup-guard`** — the two
  incidents above, pinned by their real records.

**TWO TESTS PASSED VACUOUSLY IN ONE SESSION. Assume yours can too.**
* the ageing seeder spread 20 "young" records over the same two years, so the
  young case fell outside the 90-day horizon and rendered almost nothing — an
  ALREADY-FIXED page still measured as broken (5.4x). **Young means RECENT, not
  sparse.**
* the contrast probe reads `backgroundColor`, which is `rgba(0,0,0,0)` for a
  **gradient** — so it walked past a slab to the page behind it and reported a
  confident FALSE failure. It now declines to judge rather than judging wrongly.

Both were caught **only** by deliberately reintroducing the bug and watching the
test fail. Do that before trusting a new guard.

**And a suite only covers the screens it RENDERS.** The contrast suite set
`STATE.page` only, so every multi-tab page drew its DEFAULT tab and Email's Sent
and Outreach Plan were never tested; it called `enterApp()` first, so the login
screen — the first thing anyone sees — was never tested at all. Both shipped
broken.

## 🎨 THEMING: FOUR RULES THAT COST REAL BUGS

Full detail in `docs/UI_REVAMP.md` and `CLAUDE.md`. The four that bit:

1. **A theme must reach EVERY palette.** `ui.css` carries its own
   (`--ink`/`--line`/`--hover`), separate from `styles.css`
   (`--text`/`--border`). Bridging one left the Leads table drawing `#0F172A`
   on dark glass.
2. **An inline colour cannot be re-themed**, exactly as an inline width cannot
   be re-laid-out. And watch for **JS hover handlers that re-set the colour** —
   the merge chips had `onmouseout` restoring `#fff`, which would have undone
   any stylesheet fix on the first mouse movement.
3. **Inversion is not a theme-safe colour.** `background: var(--text)` is a
   near-black pill in light and a white pill with white text in dark.
4. **Anything that paints ITSELF must be told the palette.** The login backdrop
   is a `<canvas>`; no stylesheet could ever have fixed it. It reads the live
   custom properties and re-reads on a `pace-theme-change` event.

Plus: **never restate `position` in a rule whose job is `z-index`** — that
collapsed `#nav-scrim` and made the phone menu impossible to close.
`mobile-layout-smoke` caught it.

## 📱 HOVER IS A MOUSE FEATURE — AND THAT LEAVES A GAP

Hover-to-expand on the rail is gated on `(hover:hover) and (pointer:fine)`,
**never on width** — a 900px tablet is touch, a 500px desktop window is not.
Correct, and it left a real hole: a tablet, or a phone in **"desktop site"
mode**, is above the 860px breakpoint and has no hover, so it got 14 unlabelled
icons with no way to read one. `.pinned` already existed for this and nothing
toggled it; the brand mark does now, and the affordance only renders where
hover is unavailable. Pinned by a 1024px **touch** context in
`mobile-layout-smoke`.

## ⚠ WHAT WENT WRONG EARLIER — read before your first commit

**`git add -A` put half a feature on `main`** (2026-09-10, reverted by #199).
A documentation-only commit swept up 337 lines of another territory's
in-progress file — the half that appends a JD panel to a stored email body,
without the half that splits it back out before sending. A queued candidate
email would have gone out with a raw `------------------` fence to a real
person. **Every check passed.** Stage the paths your commit is about, nothing
else.

**Never pipe `git push` into `tail`** — it swallows a rejection, and a commit
made on the wrong branch then looks like a successful push.

**A squash-merged branch is only safe to force-push after you verify its
commits are in `main` BY CONTENT.** Session 23 did this twice; both times
checked `git show origin/main:<file>` first.

## 🔒 THE APP BYPASSES ITS OWN DATABASE SECURITY

RLS is on all 48 tables, but the server holds the **service-role key**, which is
exempt from RLS by design. So **org scoping is enforced by application code, not
by the database.** Use `models/` — `db.forRequest(req).from('candidates')` —
never a hand-written `supabase.from()` on a tenant table. `rampart` reviews
anything touching scoping, and a breach here produces **no error message**.

## Owner actions outstanding

- **Say whether the 39 legitimate follow-up schedules should keep running.**
  They are real — those prospects did receive a cold email. Left running.
- **The accent is Apple blue (`#0071E3`), taken from the Bolt design.** PACE was
  green. One line (`--accent` in `theme.css`) if they want it moved.
- **`PICKER_CAP` is 15**, so 19 connected leads becomes a search box. Flagged as
  possibly too eager; they have not said.
- Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` on Render.

## ⏸ Parked by the owner — do NOT re-raise as blocking

`docs/territories/DECISIONS.md` is the authority; grep it before proposing
anything. **D-0015 is the highest id used.** Notably: pricing stays `null`,
self-serve signup stays off, no backfill of the 81 wrong lead timezones.

## Traps that will bite you

- **`*.onrender.com` is blocked from this sandbox.** You cannot verify a deploy
  by loading the app. Verify the code is on `main` by content, and check the
  server is alive via `engine_runs` in Supabase. **Do not claim you watched it
  come up.**
- **Registration order is load-bearing in every router.** A literal path after
  a matching `:param` route is DEAD and fails silently with a valid 200.
  `route-shadowing-smoke` scans the tree.
- **Every reader of a stored email body must call `renderStoredEmail`** —
  `sender-identity-smoke` greps for new readers and fails if one forgets.
- **A page module must not write `#content`** — register with
  `UI.registerPage`.
- **Prefer an edit anchored on the exact text being replaced** over one anchored
  on a start and an end line. A range edit once silently swallowed two
  functions; `node --check` passed and the suite passed.
- **`TEST_USERS` is not the user set** — all eight roles now have entries, but
  a five-role sweep still skips three.
