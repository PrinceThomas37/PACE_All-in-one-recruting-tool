# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-08-05 (end of Session 10) · **Repo**:
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

## Self-serve signup — built, switched OFF

Steps 1–3 are built and merged. Nothing is open to the public, because the whole
thing sits behind one env var:

1. ✅ Organisations get plan / status / kind
2. ✅ Domain claiming with DNS verification
3. ✅ **Route a sign-in** — `services/provisioning.js`
4. ⬜ Plan entitlements + the Stripe seam (seats *are* enforced at join; nothing
   else is)

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

## Migrations — ALL APPLIED to the live DB (2026-08-05)

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

**The next migration is 040.** Never apply one to the live database without a
fresh, explicit go-ahead — this one had it.

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
- **When a claim about behaviour is load-bearing, test the claim.** Two claims
  died this session: `last_login_at` was being written to a column that did not
  exist, and the role picker offered two roles the database rejects.

## Deliberately open, not forgotten

- **The guest bypass.** `Authorization: Bearer guest` gives read-only access to
  the DEFAULT org — the owner's own live data. Deliberate (it is the product
  tour) and pre-existing, but self-serve signup makes it worth a fresh decision.
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

`npm test` (40 suites, judged by **exit code** — the suites print two different
formats, so grepping stdout mis-reports them) · `bash test/verify-frontend.sh` ·
build on the dev branch → screenshot → draft PR → merge only on an explicit
"merge it" → it deploys. The owner does not read code; show them the running app
and plain English.
