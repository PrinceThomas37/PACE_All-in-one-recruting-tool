# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-01 (end of Session 16) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Dev branch**:
`claude/screen-glitch-diagnosis-7k0f8y`

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.** At
the end of a session, append the narrative to the archive, then rewrite this to
describe the new present. Nothing is lost; the read stays short.

If you're picking this up cold: `CLAUDE.md` is the durable source of truth for
anything this file and the archive don't cover — trust it over an old-looking
line here.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id`
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, shared relevance
  engine, lead sourcing, candidate outreach, conversation intelligence
- **Self-serve signup is built end-to-end but switched OFF** (`SELF_SERVE_SIGNUP`
  env var). Pricing is deliberately `null` — the owner's call, one line in
  `services/plans.js`. No guest/demo bypass exists (removed Session 11), so
  there is no product tour today.
- **Lead distribution uses every connected mailbox** (Microsoft + Gmail, live
  tokens only); a mailbox going inactive auto-moves its leads. Leads silent in
  `Assigned` 30+ days auto-recycle to `Unassigned`.
- **The in-app mailbox** (Session 13, restructured Session 15) — a real mail
  client over connected mailboxes, now **two panes with a threaded reader**.
  Its four inviolable rules are in `CLAUDE.md` Growth bets §3: nothing mirrored
  into Postgres, your own mailboxes only, nothing destroys mail, bodies in a
  sandboxed iframe with remote images blocked.
- **The shared UI kit** (Session 15) — `public/ui.css` + `public/js/00-ui-kit.js`.
  The app finally has one layout vocabulary: icon rail, top bar, page tabs, stat
  strip, toolbar, dense table, record drawer. See "The UI kit" below before
  building any new screen.
- SSO sign-in with Microsoft. Google sign-in is built but needs
  `GOOGLE_CLIENT_ID`/`SECRET` — **distinct from** the per-user Gmail *sending*
  connection, which is live and working.

## Migrations — 041 is the latest APPLIED (2026-08-24)

`041_lead_recycling.sql` — `jobs.recycled_count` / `jobs.last_recycled_at`,
visibility-only. Applied with explicit go-ahead, verified against live schema.
**The next migration number is 042. Never apply one to the live DB without a
fresh, explicit go-ahead**, even when the feature itself was already agreed.

Everything through `040_billing.sql` is applied (see `CLAUDE.md`'s "Growth
bets" §9 and §1 for the fuller multi-tenancy/billing state — that section is
kept current and is the right place to check plan/RLS/billing status).

**042 will most likely be an error column on `emails`** — the send path has
nowhere to record *why* a send failed, which is why the 7-day Gmail expiry was
invisible. Sessions 14 and 15 added no migration.

## ✅ Just shipped (Session 16): the screen stopped blinking

The owner sent two screen recordings of a "glitch". Decoded frame by frame, the
Inbox clip showed the message body **vanishing for 1.4s and coming back scrolled
to the top**, twice more after that. Cause: `render()` was
`root.innerHTML = renderApp()` — every change rebuilt the whole app, and an
email body lives in a sandboxed `<iframe>`, which reloads when re-created. The
trigger was marking the message read, which ticks the unread badge. **Reading an
email was what wiped the email being read.** Second fault: nine pages were
missing from `renderPage()`'s switch, so every repaint on them wrote
"Page not found" and overwrote it a beat later.

**The render engine now draws in regions and writes only what changed** — see
"The render model" below. Same-page repaints leave untouched regions' DOM
standing, so iframes, scroll positions, modal/drawer entry animations and the
caret all survive. Pinned by `test/screen-stability-smoke.mjs` (19 assertions,
node identity not pixels, including one that proves the test can detect a
rebuild). 50/50 suites green. **No migration.**

## The render model — read this before touching any page

- **`render()` has two paths.** Page changed (or no shell) → full rebuild.
  Same page → **patch**: rail, topbar, page body and the `#layer` above it are
  each rewritten *only if their html string differs from what is on screen*.
- **A page module never writes `#content` itself.** It registers its renderer
  with **`UI.registerPage(name, renderFn, paintFn?)`** — same idiom as
  `UI.registerOverlay` — and its own `paint()` calls **`paintPageContent()`**.
  Writing `content.innerHTML` directly makes the shell's record of the screen
  stale and the flicker comes back.
- **`renderPage()` (05-page-dashboard.js) is now the fallback**, not the only
  route. A page that is registered never reaches it. "Page not found" is
  unreachable and a test keeps it that way.
- **The Inbox paints region by region** (`#mb-head`, `#mb-before`, `#mb-open`,
  `#mb-after`, `#mb-comp`). The open message sits between the two halves of the
  thread **so the thread arriving does not touch it**, and the shorter
  in-thread body height is a CSS class `paint()` toggles — never part of
  `#mb-open`'s html. Bake either into that string and the message reloads.
- **Anything that must survive a repaint needs its own region** — iframes,
  media, canvases, anything with internal scroll.

## ⏭ Pick this up first (Session 17)

**1. The Gmail connection dies every 7 days, and silently destroys emails.**
Fully diagnosed on 31 Aug, **still nothing fixed** (archive Session 14 Part 7
has the evidence chain). Eleven follow-ups were marked `failed` with no reason
recorded because the mailbox's refresh token had expired 40 minutes earlier.

- **Root cause is Google-side:** the OAuth consent screen is in **"Testing"**
  publishing status, where Google expires refresh tokens after exactly 7 days.
  Connected 24 Aug 17:27 → died 31 Aug 17:27. Reconnected 18:23; next expiry
  ≈ **7 Sept 18:23**. Owner was asked whether `futeglobal.com` is Google
  Workspace — if it is, switching the app to **"Internal"** removes the 7-day
  limit *and* the unverified warning, with no code. **Answer still needed.**
- **Three code defects to fix regardless:** an auth failure marks each email
  `failed` forever with no retry (the thread-deferral path releases back to
  `pending` — do that instead); the loop keeps burning one email every 90s
  after the sign-in is known dead (stop that mailbox on the first one); and
  **`emails` has no error column**, so `friendlySendError`'s correct sentence
  ("Sending mailbox sign-in expired — reconnect it") went only to an in-memory
  cache during an unattended cron run and died with the process.
- **The 11 failed follow-ups were never delivered** and can be re-queued.

**2. The 2.7s "Opening…" on the Inbox** (Session 16 measured it, deliberately
did not touch it). It is Render free-tier latency plus the Graph/Gmail round
trip, not a rendering fault — the honest fixes are a warmer service or showing
the list row's preview text while the body loads.

**3. Finish the UI-kit rollout.** Done: Candidates, Leads, Clients, Sourced
Leads, All Jobs, Reports, Email, Inbox. **Still on their own markup:** the
dashboards (`05-page-dashboard.js`, `16-insights.js`), Admin (`08-page-admin.js`),
the pipeline/board (`28-page-pipeline.js`), My Team (`42-page-myteam.js`),
Assign Leads (`21-assign-leads.js`) and the orphaned Manager Users page. Those
are card- and board-shaped rather than list-shaped, so they need a judgement
call per page rather than the same table treatment — which is why they were left
rather than forced.

## The UI kit — read before building any screen

`public/ui.css` + `public/js/00-ui-kit.js`. Everything returns an HTML **string**,
matching the render-to-string convention; no framework, no build step.

- **Use `UI.page({tabs, strip, toolbar, body})`** for a page, not a bare
  `<div class="page">`. `UI.tabs`, `UI.strip`, `UI.toolbar`, `UI.table`,
  `UI.idCell`, `UI.pill`, `UI.ring`, `UI.toggle`, `UI.check`, `UI.kv`,
  `UI.notice`, `UI.feed`, `UI.drawer`, `UI.ic` are the vocabulary. Adding a
  twelfth hand-rolled table is how the app got into this state.
- **The kit is scoped by `body.ui-kit`** and overrides only the shell +
  list/table/detail styles, so an unconverted page is unaffected.
- **A drawer is an overlay, not a page.** `UI.registerOverlay(name, fn)` — by
  name, idempotent, because modules are evaluated once but wrap `render()`
  repeatedly. `scheduleRender()` skips a background rebuild while one is open.
- **Panels behind tabs inside a drawer all render, with `hidden` on the
  inactive ones**, and the tab handler toggles `el.hidden` rather than calling
  `render()`. That is what lets a note survive a tab click and stops an iframe
  being refetched.
- **A stat strip never fabricates a number.** Show `·` until real counts land;
  a `0` is a claim ("nobody is interviewing") and may be false.
- **A strip/tab count measures the whole pool; the pager keeps the filtered
  number.** Mixing them makes a filtered list feel broken.

## Owner actions outstanding

0. **BLOCKING: is `futeglobal.com` on Google Workspace?** Decides the fix for
   the 7-day Gmail expiry above (Internal app = no expiry, no code) vs. living
   with a weekly reconnect. Asked 31 Aug, unanswered.
1. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render if login-with-Google is wanted.
2. **Verify one real Greenhouse/Lever board** via "Test it" — adapters have
   never met a live feed (sandbox blocks those hosts).
3. **Set prices, decide on card payments** — `services/plans.js`, one line.
   Both block nothing technically; plan limits enforce either way.
4. **Turn on `SELF_SERVE_SIGNUP`** whenever the owner wants strangers able to
   sign themselves up — purely an env var flip, not a release.

## Plans and billing

Tiers, limits and the four rules that must not be softened live in `CLAUDE.md`
Growth bets §9, which is kept current — read it there rather than a stale copy
here. The one-line summary: enforced on CREATE with **402**, never deletes
anything, only the signed Stripe webhook may change a plan, and a failed usage
count **allows**.

## Traps that will bite you (learned the hard way)

`CLAUDE.md` already carries the durable ones — `models/` for tenant tables, the
six-place stage vocabulary, the free-tier instance budget, `renderStoredEmail`
on every reader of `emails.body`, safe-methods-only retries, the deliberate
`orgIdFor()` fallback, and `routes/recruiting/*` registration order. **Read it;
these are the ones it does not cover.**

**Before moving ANY file** → `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP"
(Session 8). Ten things break on a naive move and several fail *silently*.

- **Any mailbox-selection path must check BOTH `microsoft_tokens` and
  `gmail_tokens`, exclude `refresh_failed`, and filter `is_active`** — checking
  one table silently made Gmail unselectable and reused dead tokens forever.
- **A job whose sending mailbox goes inactive does not fail its pending emails
  — it silently skips them forever.** Any path that deactivates, disconnects or
  deletes a `user_emails` row must call `reassignJobsOffMailbox`
  (`services/mailbox-reassign.js`) first, or leads strand with no visible error.
- **A dead mailbox sign-in currently DESTROYS emails** — `failed` with no retry,
  one every 90s, reason never persisted. Diagnosed, not fixed; see "Pick this up
  first". Any send-path work should fix this rather than route around it.
- **`emails.sent_at` defaults to `CURRENT_DATE`**, so an unsent draft already
  carries a send date. Any "sent on X" report is counting drafts.
- **Graph's `/move` returns a NEW message id** — the old one stops resolving the
  instant the message lands. Gmail's id never changes. Take the id you're handed.
- **Injectable clocks are not optional** in `conversation-intel.js`,
  `next-action.js` and `lead-ingest.js`'s `ingestSource`. Every headline is a
  claim about elapsed time; `lead-sourcing-smoke` failed for weeks on a *date*.
- **The rail is GROUPED (Work / Records / Outreach / Insight)**, so nav order is
  no longer a flat index. A new item joins a group; de-duplicate by id (an admin
  who is also an RA lead used to get two "Insights" rows). Still pinned by
  tests: Dashboard first, and a recruiter's "My Jobs" ahead of "All Jobs" and
  "Candidates".
- **The candidate profile is a DRAWER; `STATE.page` must stay untouched when it
  opens.** That is the whole reason closing it returns you to the same list with
  the same filters, selection and scroll. There is no `bd_candidate` page — do
  not reintroduce one "for deep links". Two paths to one screen is how the stage
  vocabulary ended up hand-synced across six files.
- **A sandboxed message body cannot be auto-sized.** Measuring an iframe from
  the parent needs `allow-same-origin`, the exact grant that keeps a hostile
  email boxed in. Mail bodies get a fixed height and scroll inside themselves.
  Do not "fix" this.
- **Anything previewing an outbound email resolves `{{sender}}` from the
  SELECTED MAILBOX, never the logged-in user.** A preview using the session user
  would have shown the right name for the exact Session 14 bug where 152 emails
  went out under the wrong one — hiding it instead of catching it. An unfillable
  variable stays visible and highlighted, never silently blanked.
- **When a claim about behaviour is load-bearing, test the claim.**
- **Browser tests are never allowed to need a production bypass** — use
  `test/helpers/enter-app.mjs`.
- **A destructive DB action always needs, in this order:** check FK cascade
  rules (`information_schema`; `NO ACTION` means clear referencing rows
  yourself), verify scope with counts, take a snapshot, get explicit
  confirmation, verify after.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML yet.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- **The card/board pages are not on the UI kit yet** — the dashboards, Admin,
  the pipeline board, My Team, Assign Leads. Every list page is converted; see
  "Pick this up first" §2 for why these were left.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API** (still the one CLAUDE.md flags as highest-leverage next), generalized
  audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker in the UI
  (the API supports it), no shared/delegated mailboxes, unread badge is a 60s
  cached poll not a live push.
- **The 25 final follow-ups deleted on 31 Aug do not regenerate** (deliberate,
  owner's instruction) — those contacts got an initial + one follow-up only.

## Working rules

`npm test` (50 suites, judged by **exit code**) · `bash test/verify-frontend.sh`
· build on the dev branch → test → screenshot/show → draft PR → merge only on an
explicit "merge it" → apply a migration only on a fresh explicit go-ahead, right
before merge, never on general feature agreement. **The owner does not read
code**; show them the running app and plain English.

**Habits these sessions paid for:**

- When a test breaks during a redesign, ask whether it pinned **behaviour** or
  **markup** — and never relax a safety assertion (sandbox, blocked images, no
  permanent delete, own mailboxes only) to make a redesign pass.
- Check whether a failing test is failing on *live code* or on the *calendar*
  before calling it a product bug — and correct yourself out loud if you got it
  wrong.
- When a placeholder is left in stored data, find EVERY reader before declaring
  it fixed. The first attempt at the sender fix taught exactly one screen and
  left the token leaking into follow-ups a customer would have read.
- When the owner says "make it look like this", the honest reading is usually
  "give the app a structure it doesn't have". The structure is the deliverable;
  the screenshots are the brief.
- **When the owner reports something visual, measure it before theorising.**
  Session 16's two clips were decoded frame by frame; one turned out to contain
  no glitch at all, and the other pinned the fault to a single 1.4s window with
  a specific trigger. Say plainly when a piece of evidence shows nothing.
- A "rebuild everything" render is fine until the page holds something the DOM
  cannot re-create for free. The app had grown four separate workarounds for
  that (focus restore, scroll restore, `scheduleRender`'s modal guard, the job
  board's manual caret restore) before the glitch made it a fifth.
