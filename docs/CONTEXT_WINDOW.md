# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-08-05 (end of Session 11) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Dev branch**: `claude/context-window-docs-t5ia4s`

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

This split exists because a single ever-growing context file makes every new
session pay to read old news, and eventually the important parts get skimmed.

| File | Job | Rule |
|---|---|---|
| `docs/CONTEXT_WINDOW.md` (this) | **Current state only.** What is live, what is pending, what to do next, what will bite you. | **REWRITE it. Keep it under ~200 lines.** Delete anything that is no longer true. |
| `docs/CONTEXT_ARCHIVE.md` | **Everything that ever happened**, newest last. | **APPEND ONLY. Never edit, never delete, never summarise away.** |

At the end of a session: append the narrative to the archive, then **rewrite**
this file to describe the new present. Nothing is ever lost; the read stays short.

---

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id` on 38 tables
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, shared relevance
  engine, lead sourcing, candidate outreach, conversation intelligence
- **Background automation actually running** — `CRON_KEY` is set and verified
- **SSO sign-in with Microsoft** (Google is built but needs credentials)
- The PACE rebrand and the rebuilt login page
- **Plans, limits and entitlements — enforced, not decorative.** The default org
  is on the `internal` plan (unlimited), so nothing changed for it.
- **No guest / demo mode anywhere.** `Bearer guest` used to grant read-only
  access to the default org's live data; it and all seeded fake data are gone.

## Self-serve signup — built, switched OFF

Steps 1–3 are built and merged. Nothing is open to the public, because the whole
thing sits behind one env var:

1. ✅ Organisations get plan / status / kind
2. ✅ Domain claiming with DNS verification
3. ✅ **Route a sign-in** — `services/provisioning.js`
4. ✅ **Plan entitlements + the Stripe seam** — `services/plans.js` (rules,
   pure), `services/entitlements.js` (counts + gates), `services/billing.js`
   (Stripe, inert until keys are set)

**`SELF_SERVE_SIGNUP` must be exactly `on` for any of it to do anything.** With
it unset — how the service ships and how it is deployed today — a stranger
signing in with Microsoft/Google gets the same "ask your administrator" refusal
they always got, and no account is created. Turning it on is a Render env var,
not a release.

**Its prerequisites are now met** — migrations 038 and 039 are applied (below),
so switching it on is a decision rather than a dependency. 039 is the isolation
batch, and it exists precisely so it landed *before* strangers can create
workspaces, not after.

### How a sign-in routes (the three destinations, and only three)

| Situation | Destination |
|---|---|
| Domain has a **verified** claim **and** auto-join is on | join that org, role from the claim |
| Domain has a **verified** claim, auto-join off | refused — ask your admin to invite you |
| Domain unclaimed, or free mail | a **private** workspace of their own |

**Sharing a domain is not membership.** Two people on an unclaimed domain get
two separate workspaces — never a shared one. That is the unverified auto-join
we deliberately refuse, and it is pinned by a test.

## Owner actions outstanding (only they can do these)

1. **Google sign-in** — create a Google Cloud OAuth client, set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Render. Redirect URI must be
   exactly `https://<host>/auth/google/callback`. The button then appears by
   itself. **Do the host rename first if it is going to happen at all.**
2. **Rename the Render host** (optional) — `fute-lms-backend.onrender.com` is
   still the live address. Needs the Render service renamed **and** the Azure
   app registration updated, together.
3. Verify one real Greenhouse/Lever board via the "Test it" button — the
   adapters have never met a live feed (the sandbox blocks those hosts).

## Plans — what is enforced, and what is not decided

Free 2 seats / 3 job orders / 50 candidates / 1 mailbox · Starter 5/25/1,000/3 ·
Pro 20/∞/10,000/10 · Business unlimited · `internal` = ours, unlimited.

- **Enforced on CREATE** (`POST /users`, `/users/:id/emails`, `/job-orders`,
  `/candidates`) with **402**, not 403 — a billing wall is not a permission
  error. Feature gates: sourcing = Pro+, conversation intelligence = Starter+.
- **Being over a limit never deletes anything.** Enforcement is create-only, so
  a downgrade keeps every row and simply blocks adding. Say this in any UI that
  shows a limit.
- **Pricing is deliberately unset** (`price: null` on every tier). What PACE
  costs is the owner's call; the billing card says "pricing not published yet"
  rather than showing an invented number. `services/plans.js` is the one place
  to fill them in.
- **Payments are off** until `STRIPE_SECRET_KEY` is set. The webhook is the ONLY
  thing that may change a plan — a browser "success" redirect is something
  anyone can type into their own URL bar.

## Migrations — 037-039 APPLIED to the live DB (2026-08-05)

`037_conversation_intel`, `038_org_domains_and_plans` and `039_tenant_isolation`
were applied together with the owner's explicit go-ahead, and verified against
the live schema afterwards:

| Verified | Result |
|---|---|
| Tables with RLS disabled | **0 of 48** (was 37, including `microsoft_tokens`) |
| Tables missing a service-role policy | 0 · 48 policies total |
| `org_id` on `microsoft_tokens` / `gmail_tokens` | present, backfilled, **0 nulls** |
| `users.last_login_at` / `last_login_method` | present — `sso.js` was writing to columns that did not exist |
| `users_role_check` | now accepts `associate_director` and `director` |
| Default org | `plan=internal, kind=internal` — reads as ours, not a paying customer |

`conversation_messages` and `org_domains` exist, so conversation intelligence
stores real threads and domain claiming answers for real.

**Migration `040_billing.sql` is WRITTEN and NOT APPLIED.** Three nullable
billing columns, an index, and a CHECK on `organizations.plan`. Nothing reads
them unless Stripe is configured, so the app is correct before and after — it
only needs applying before payments are switched on. **The next number is 041.
Never apply a migration to the live database without a fresh, explicit
go-ahead.**

---

## Traps that will bite you (learned the hard way)

**Before moving ANY file** → `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP"
(Session 8). Ten things break on a naive move and several fail *silently*.

- **Where a sign-in lands is a pure function** (`provisioning.decide`) for a
  reason: getting it wrong puts somebody inside another company's data and
  produces no error. Keep the deciding out of the writing.
- **`orgIdFor()` falling back to the default org is deliberate — do not "fix" it
  to return null.** Background sweeps call `withOrg()` with no user, and null
  turns a scoped query into an unscoped one. The hole is closed in `auth()`
  instead, which refuses an org-less *session* once multi-org is possible.
- **`routes/recruiting/*` register on `app` directly, not as Routers** — so
  **registration order is load-bearing** (`/job-orders/browse` before
  `/job-orders/:id`; `/candidates/check-duplicate` before `/candidates/:id`).
  `test/recruiting-routes-mounted.mjs` boots the real server and pins all 63.
- **`conversation-intel.js` has an injectable clock — never test it against the
  real one.** Every headline it writes is a claim about elapsed time.
- **One reply sweep, not two.** `processInboundMessages` serves Outlook *and*
  Gmail; Gmail messages are reshaped into Graph's shape.
- **Retries are safe-methods-only** in `http-client.js`. Retrying a
  `POST /me/sendMail` on a timeout sends the email twice.
- **Use `models/` for tenant tables**, not hand-written `supabase.from()`. Four
  cross-org leaks arrived the old way. A migration adding an `org_id` table must
  add it to `models/tables.js` (now 41 tenant / 7 global).
- **The stage vocabulary lives in 6 places.** `33-stage-modal.js` is canonical;
  the backend copy is `services/recruiting-core.js`.
- **Render is on the FREE tier** — instance hours are a hard budget. The
  heartbeat is every 30 min for that reason. Ask what a new poller costs.
- **When moving code, move it — do not tidy it on the way.**
- **When a claim about behaviour is load-bearing, test the claim.** Claims that
  have died this way: `last_login_at` written to a column that did not exist;
  a role picker offering two roles the database rejected; a dashboard whose
  widgets only ever had demo data behind them.
- **A failed usage count must ALLOW, not refuse.** Blocking a paying customer
  because a COUNT query timed out is far worse than one row over a limit.
- **The browser tests are not allowed to need a production bypass.** All 17
  entered the app by clicking "Continue as Guest". They use
  `test/helpers/enter-app.mjs` now — drive STATE from the test instead.

## Deliberately open, not forgotten

- **There is no product tour any more.** The guest bypass was how one existed.
  If a demo is wanted again it must be its own seeded organisation with a real
  login — never a bypass, and never pointed at a customer's live org.
- Cold-email templates and the resume letterhead still say "Fute Global" —
  that is the **customer's** identity and must become per-org config, not a
  rename to PACE.
- "Log In with your Organization" routes by domain; it is **not** full SAML yet
  — `/auth/sso/for-domain` is the seam.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- Growth bets not started: per-role permissions, CSV import/export + public API,
  generalized audit trail, PWA polish, Stripe billing.

## Working rules

`npm test` (41 suites, judged by **exit code** — the suites print two different
formats, so grepping stdout mis-reports them) · `bash test/verify-frontend.sh` ·
build on the dev branch → screenshot → draft PR → merge only on an explicit
"merge it" → it deploys. The owner does not read code; show them the running app
and plain English.
