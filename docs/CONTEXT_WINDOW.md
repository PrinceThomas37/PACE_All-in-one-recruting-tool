# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-08-24 (end of Session 12) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Dev branch**: `claude/google-account-connection-hz15uj`

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.** At
the end of a session, append the narrative to the archive, then rewrite this to
describe the new present. Nothing is lost; the read stays short.

**This file had drifted stale for several sessions before this rewrite** (it
still described PR #134 as open; `CLAUDE.md` was the thing actually kept
current in the meantime). If you're picking this up cold: `CLAUDE.md` is the
durable source of truth for anything this file and the archive don't cover —
trust it over an old-looking line here.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id`
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, shared relevance
  engine, lead sourcing, candidate outreach, conversation intelligence
- **Self-serve signup is built end-to-end but switched OFF** (`SELF_SERVE_SIGNUP`
  env var). Plans/entitlements/Stripe seam are real; pricing is deliberately
  `null` — the owner's call, one line in `services/plans.js` when decided.
  Guest-mode/demo-data bypass is fully removed (Session 11) — there is no
  product tour today.
- **Lead distribution now correctly uses every connected mailbox** — Microsoft
  and Gmail, active + working tokens only (Session 12, PR #137). A mailbox
  going inactive auto-moves its open leads to another working one instead of
  stranding them (`services/mailbox-reassign.js`).
- **"Needs you today" no longer floods with stale-Assigned-lead noise** — a
  BD-lead nudge only fires once the lead is `Connected`/`In Discussion`
  (Session 12, PR #138). **Leads silent in `Assigned` for 30+ days now
  auto-recycle back to `Unassigned`** daily (`services/lead-recycle.js`,
  configurable via `app_settings.lead_recycle_days`, default 30).
- SSO sign-in with Microsoft (Google sign-in is built, needs
  `GOOGLE_CLIENT_ID`/`SECRET` — separate from the per-user Gmail *sending*
  connection below, which is live and working)

## Migrations — 041 is the latest APPLIED (2026-08-24)

`041_lead_recycling.sql` — `jobs.recycled_count` / `jobs.last_recycled_at`,
visibility-only. Applied with explicit go-ahead, verified against live schema.
**The next migration number is 042. Never apply one to the live DB without a
fresh, explicit go-ahead**, even when the feature itself was already agreed.

Everything through `040_billing.sql` is applied (see `CLAUDE.md`'s "Growth
bets" §9 and §1 for the fuller multi-tenancy/billing state — that section is
kept current and is the right place to check plan/RLS/billing status).

## 🔜 Next task, explicitly asked for by the owner: a real in-app inbox

PACE has **no general inbox today**. Connected mailboxes (Microsoft + Gmail)
are used for (a) sending outreach/candidate email and (b) a behind-the-scenes
30-min reply-detection sweep that links a reply into its lead/candidate's
conversation thread — but there is no unified "everything that landed in this
mailbox" view, and no reply-from-app UI for anything outside a lead/candidate
thread. The owner wants to work mailboxes from inside PACE instead of
switching to Gmail/Outlook.

**Not started.** Scope it before building:
- v1 is probably read-only: list threads across a user's connected mailboxes,
  open one and read it — using the existing Graph/Gmail read scopes already
  granted (`Mail.ReadWrite` / `gmail.modify`), no new OAuth consent needed.
- Reply-from-app is the natural fast-follow, reusing the existing send
  dispatch (`sendMailboxNewMessage`, platform-aware) rather than building a
  second send path.
- Think about API rate limits per mailbox before polling more than the
  current 30-min sweep, and about Render free-tier instance hours (see
  `CLAUDE.md`'s heartbeat note) before adding any new scheduled poll.
- Storage: `conversation_messages` (migration 037) already stores full bodies
  for tracked lead/candidate threads — decide whether a general inbox reuses
  that table (widening its scope) or needs its own.

## Owner actions outstanding

1. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render if login-with-Google is wanted.
2. **Verify one real Greenhouse/Lever board** via "Test it" — adapters have
   never met a live feed (sandbox blocks those hosts).
3. **Set prices, decide on card payments** — `services/plans.js`, one line.
   Both block nothing technically; plan limits enforce either way.
4. **Turn on `SELF_SERVE_SIGNUP`** whenever the owner wants strangers able to
   sign themselves up — purely an env var flip, not a release.

## Plans — the rules that must not be softened

Free 2 seats / 3 job orders / 50 candidates / 1 mailbox · Starter 5/25/1,000/3 ·
Pro 20/∞/10,000/10 · Business unlimited · `internal` = ours, unlimited (the
default org is on it).

- **Enforced on CREATE** with **402**, not 403 — a billing wall, not a
  permission error. Feature gates: sourcing = Pro+, conversation
  intelligence = Starter+.
- **Being over a limit never deletes anything.** Create-only enforcement.
- **Only the signed Stripe webhook may change a plan.**
- **A failed usage count ALLOWS** — never block a paying customer on a
  timed-out COUNT.

---

## Traps that will bite you (learned the hard way)

**Before moving ANY file** → `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP"
(Session 8). Ten things break on a naive move and several fail *silently*.

- **A mailbox "connected" check must cover both platforms and check the token
  is actually alive.** `/distribute/execute` only ever checked
  `microsoft_tokens` with no `is_active`/`refresh_failed` filter — Gmail could
  never be selected, and dead Microsoft tokens kept getting reused forever.
  Fixed Session 12; if you add another mailbox-selection code path, check both
  `microsoft_tokens` AND `gmail_tokens`, exclude `refresh_failed`, filter
  `is_active`.
- **A job whose sending mailbox goes inactive does not fail its pending
  emails — it silently skips them forever.** Any code path that deactivates,
  disconnects, or deletes a `user_emails` row must call
  `services/mailbox-reassign.js`'s `reassignJobsOffMailbox` first, or leads
  strand with zero visible error.
- **`orgIdFor()` falling back to the default org is deliberate — do not "fix"
  it to return null.** Background sweeps call `withOrg()` with no user, and
  null turns a scoped query into an unscoped one.
- **`routes/recruiting/*` register on `app` directly, not as Routers** — so
  **registration order is load-bearing**. `test/recruiting-routes-mounted.mjs`
  boots the real server and pins all mounted routes.
- **`conversation-intel.js` has an injectable clock — never test it against
  the real one.** Every headline it writes is a claim about elapsed time.
  `next-action.js` (the ranking on top of it) is the same discipline.
- **One reply sweep, not two.** `processInboundMessages` serves Outlook *and*
  Gmail; Gmail messages are reshaped into Graph's shape.
- **Retries are safe-methods-only** in `http-client.js`. Retrying a
  `POST /me/sendMail` on a timeout sends the email twice.
- **Use `models/` for tenant tables**, not hand-written `supabase.from()`.
- **The stage vocabulary lives in 6 places.** `33-stage-modal.js` is
  canonical; the backend copy is `services/recruiting-core.js`. Note this is
  the **ATS candidate stage** vocabulary — BD **lead** stages (`Unassigned`,
  `Assigned`, `Connected`, `In Discussion`, `Rejected`) are a *different*,
  smaller vocabulary on `jobs.stage`, not the same 11 stages. Don't conflate
  them when touching lead-side code (distribution, recycling, next-actions).
- **Render is on the FREE tier** — instance hours are a hard budget. Ask what
  a new poller costs before adding one.
- **When a claim about behaviour is load-bearing, test the claim.**
- **The browser tests are not allowed to need a production bypass** — use
  `test/helpers/enter-app.mjs`.
- **A destructive DB action (bulk delete, direct SQL fix) always needs: check
  FK cascade rules first (`information_schema` — `NO ACTION` means you must
  clear the referencing rows yourself, in dependency order), verify scope with
  counts before running, get explicit confirmation, verify after.** Done twice
  this session (stuck-lead mailbox fixes, the 1,249-lead cleanup) without
  incident by following exactly that order.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" —
  that is the **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML yet.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API** (still the one CLAUDE.md flags as highest-leverage next), generalized
  audit trail, PWA polish.
- **The in-app inbox — see "Next task" above. This is the live one.**

## Working rules

`npm test` (43 suites now, judged by **exit code**) · `bash
test/verify-frontend.sh` · build on the dev branch → test → screenshot/show →
draft PR → merge only on an explicit "merge it"/"do it" → for anything
touching the live DB, apply the migration only on a fresh explicit go-ahead,
right before merge, not on general feature agreement. The owner does not read
code; show them the running app and plain English.
