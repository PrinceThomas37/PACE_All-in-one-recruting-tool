# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-01 (Session 15, part 2) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Dev branch**:
`claude/app-structure-redesign-5jp1sq`

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** (It currently runs ~270. Three passes
already removed everything that merely duplicated `CLAUDE.md`; what is left is
live state. If you can genuinely retire something — a parked item that got
resolved, a trap that moved into `CLAUDE.md` — do, and bring it back down.) `docs/CONTEXT_ARCHIVE.md`: everything
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
- **The in-app mailbox** (Session 13, restructured Session 15) — two panes with
  a threaded reader. Its four inviolable rules are in `CLAUDE.md` Growth bets §3.
- **The shared UI kit** (Session 15) — one layout vocabulary for the whole app.
  See "The UI kit" below before building any new screen.
- SSO sign-in with Microsoft. Google sign-in is built but needs
  `GOOGLE_CLIENT_ID`/`SECRET` — **distinct from** the per-user Gmail *sending*
  connection, which is live and working.

## Migrations — 041 is the latest APPLIED (2026-08-24)

`041_lead_recycling.sql` — `jobs.recycled_count` / `jobs.last_recycled_at`,
visibility-only. Everything through `040_billing.sql` is applied; `CLAUDE.md`
Growth bets §1 and §9 are kept current and are the right place to check the
multi-tenancy / RLS / billing state.

**The next migration number is 042. Never apply one to the live DB without a
fresh, explicit go-ahead**, even when the feature itself was already agreed.
042 is most likely the error column on `emails` — see "Parked by the owner".
Sessions 14 and 15 added no migration.

## ✅ Just shipped (Session 15): the app got a structure

The owner benchmarked PACE against **Saleshandy** and asked for it to be made
alike. Four PRs — **#147** through **#150** — all merged and live. The lasting
output is not any one screen but the shared layout vocabulary underneath them,
which the codebase had never had.

- **The UI kit** (`public/ui.css` + `public/js/00-ui-kit.js`) — see the section
  below before building anything.
- **The rail** is grouped Work / Records / Outreach / Insight, 60px, expanding
  on hover as an overlay so content never reflows.
- **Every list page is on the kit**: Candidates, Leads, Clients, Sourced Leads,
  All Jobs, Reports, Email, Inbox.
- **Records open as drawers over their list** — candidates and clients both.
- **The sequence builder is a timeline** (Day 1 → Day 4 → Day 9).
- **Compose has a live preview** with the From picker inside it.
- **The inbox is two panes and shows the whole thread.**
- One new read-only endpoint, `GET /candidates/status-counts`. No migration.

Three latent bugs surfaced on the way and were fixed: a client's email history
had lost its only caller and was dead code; the BD "convert to job" bar was
inserting itself above the page's own identity; and `/mailbox/:mid/threads/:tid`
had existed with no caller since Session 13.

Full narrative and the reasoning behind each trade: archive, "Session 15".

## ⏭ Pick this up first (Session 16)

**1. Finish the UI-kit rollout.** Done: Candidates, Leads, Clients, Sourced
Leads, All Jobs, Reports, Email, Inbox — every list-shaped page. **Still on
their own markup:** the dashboards (`05-page-dashboard.js`, `16-insights.js`),
Admin (`08-page-admin.js`), the pipeline/board (`28-page-pipeline.js`), My Team
(`42-page-myteam.js`), Assign Leads (`21-assign-leads.js`) and the orphaned
Manager Users page. These are card- and board-shaped, not list-shaped, so each
needs its own judgement rather than the same table treatment — which is why they
were left rather than forced. They still look fine; they are simply not
identical to the rest yet.

**2. Growth bets the owner has not been offered recently.** `CLAUDE.md` still
flags **CSV import/export + a small public API** as the highest-leverage
unstarted bet (buyers need to migrate in and integrate). Per-role permissions
and a generalized audit trail are the other two that make PACE sellable rather
than merely usable.

## ⏸ Parked by the owner — do NOT re-raise as blocking

**The Gmail 7-day expiry.** On 2026-09-01 the owner said, in as many words:
*"We will work on this but not now."* That is a decision, not an oversight.
**Do not open a session by asking about it again, and do not treat it as
blocking other work.** Raise it only if it causes a fresh, visible incident, or
if the owner asks what is outstanding.

What is parked, so it is not re-derived from scratch later (full evidence chain
in the archive, Session 14 Part 7):

- **Symptom:** a dead Gmail sign-in destroys queued emails. An auth failure
  marks each email `failed` with no retry, one every ~90s, and the reason is
  never persisted — `emails` has no error column, so `friendlySendError`'s
  correct sentence went only to an in-memory cache during an unattended cron run
  and died with the process. Eleven follow-ups were lost this way on 31 Aug and
  were never delivered; they can still be re-queued.
- **Root cause is Google-side:** the OAuth consent screen is in **"Testing"**
  publishing status, where Google expires refresh tokens after exactly 7 days.
  Connected 24 Aug 17:27 → died 31 Aug 17:27. **If `futeglobal.com` is on Google
  Workspace, switching the app to "Internal" removes the 7-day limit and the
  unverified warning, with no code at all.** That question is the one input
  needed, and it is the owner's to answer when they choose to.
- **Three code defects worth fixing whatever Google says:** release to `pending`
  on an auth failure instead of `failed` (the thread-deferral path already does
  this — copy it); stop a mailbox on the FIRST auth failure rather than burning
  one email every 90s after the sign-in is known dead; and add the error column
  (**migration 042**, still unclaimed) so the app can say out loud what went
  wrong.

## The UI kit — read before building any screen

`public/ui.css` + `public/js/00-ui-kit.js`. Everything returns an HTML **string**,
matching the render-to-string convention; no framework, no build step. The
drawer, grouped-rail and hidden-panel rules are written out in `CLAUDE.md`
(stack §Frontend) — this is the practical summary.

- **Build with `UI.page({tabs, strip, toolbar, body})`**, not a bare
  `<div class="page">`. Parts: `tabs`, `strip`, `toolbar`, `table`, `idCell`,
  `pill`, `ring`, `toggle`, `check`, `kv`, `notice`, `feed`, `drawer`, `ic`.
  **Never hand-roll another table** — eleven of those is how the app got here.
- **Scoped by `body.ui-kit`**; it overrides only the shell and list/table/detail
  styles, so `styles.css` still owns `.card`/`.btn`/`.bdg`/`.inp`/modals and an
  unconverted page is unaffected.
- **A drawer is an overlay**: `UI.registerOverlay(name, fn)`, drawn after
  `#content`, and `scheduleRender()` skips a rebuild while one is open.
- **A strip never fabricates a number.** Show `·` until real counts land; a `0`
  is a claim, and it may be false.
- **A strip or tab count measures the whole pool; the pager keeps the filtered
  number.** Mixing them makes a filtered list feel broken.

## Owner actions outstanding

0. ~~Is `futeglobal.com` on Google Workspace?~~ **Parked by the owner on
   1 Sept — see "Parked by the owner" above. Do not re-raise as blocking.**
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
- **A record detail is a drawer; a sandboxed mail body cannot be auto-sized;
  a compose preview resolves `{{sender}}` from the selected mailbox.** All three
  are written out in full in `CLAUDE.md` (stack §Frontend, Growth bets §3, and
  the outbound-send-path rule). Do not "fix" any of them.
- **An overlay's data must repaint the overlay, not `#content`.** A page's own
  `paint()` rebuilds `#content` only, and a drawer is drawn *after* it — so a
  fetch that lands while a drawer is open reaches state and never the screen.
  `41-page-clients.js`'s `paintDetail()` is the pattern.
- **When a claim about behaviour is load-bearing, test the claim.**
- **Browser tests are never allowed to need a production bypass** — use
  `test/helpers/enter-app.mjs`.
- **A destructive DB action always needs, in this order:** check FK cascade
  rules (`information_schema`; `NO ACTION` means clear referencing rows
  yourself), verify scope with counts, take a snapshot, get explicit
  confirmation, verify after.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" —
  that is the **customer's** identity, must become per-org config.
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
- **The 25 final follow-ups deleted on 31 Aug do not regenerate** (their
  schedules were already complete). Deliberate, owner's instruction.

## Working rules

`npm test` (49 suites, judged by **exit code**) · `bash test/verify-frontend.sh`
· build on the dev branch → test → screenshot/show → draft PR → merge only on an
explicit "merge it" → apply a migration only on a fresh explicit go-ahead, right
before merge, never on general feature agreement. **The owner does not read
code**; show them the running app and plain English.

**Habits these sessions paid for:**

- When a test breaks during a redesign, ask whether it pinned **behaviour** or
  **markup**. Session 15 moved three assertions off inline styles and a flat
  nav index onto the behaviour they were really protecting — and left every
  safety assertion (sandbox, blocked images, no permanent delete, own mailboxes
  only) untouched. Never relax one of those to make a redesign pass.
- Check whether a failing test is failing on *live code* or on the *calendar*
  before calling it a product bug — and correct yourself out loud if you got it
  wrong.
- When a placeholder is left in stored data, find EVERY reader before declaring
  it fixed. The first attempt at the sender fix taught exactly one screen and
  left the token leaking into follow-ups a customer would have read.
- When the owner says "make it look like this", the honest reading is usually
  "give the app a structure it doesn't have". The structure is the deliverable;
  the screenshots are the brief.
