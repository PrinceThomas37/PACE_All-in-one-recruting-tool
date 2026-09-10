# Rampart — memory
> Last written: 2026-09-09 · org-scoping audit (`claude/org-scoping-audit`)

## What is true here now
- Multi-tenancy is **shipped**: `org_id` NOT NULL on all tenant tables
  (migrations 022/023), RLS + service-role policies on all 48 (migration 039,
  applied 2026-08-05). **Verified after: 0 without RLS, 0 without a policy.**
- `models/` makes scoping structural: `db.forRequest(req)` scopes by
  construction, `db.global` covers the 7 tables with no `org_id`, `db.crossOrg()`
  is the named, greppable escape hatch. Anything else throws.
- Migration 039 also gave `microsoft_tokens`/`gmail_tokens` an `org_id` — before
  it, **customers' mailbox refresh tokens were readable with the anon key.**
- Roles: `users_role_check` accepts `associate_director` and `director` (the UI
  had offered them since migration 026 and the DB had rejected them since).
- **Self-serve signup is built and switched OFF** (`SELF_SERVE_SIGNUP`).
  `decide()` in `services/provisioning.js` is PURE. Three destinations only.
- SSO with Microsoft is live. Google **sign-in** needs `GOOGLE_CLIENT_ID`/
  `SECRET` in Render — distinct from per-user Gmail *sending*, which works.
- **No guest / demo mode.** `Bearer guest` and `01-seed-demo.js` are both gone.
- **⚠ THE BACKEND RUNS AS SERVICE ROLE — RLS IS BYPASSED ON EVERY REQUEST.**
  `index.js:73` builds the client with `config.supabaseServiceKey`. Verified,
  not assumed. This is the single most important fact in this territory and it
  was NOT written down before 2026-09-09. Consequences, all of which were being
  got wrong in review:
  * **"RLS + a service-role policy on all 48 tables" is NOT a mitigation for a
    missing `org_id` in a route.** It defends against someone holding the anon
    key — a different attacker. Never again answer a raw-query finding with
    "but RLS is on".
  * **Application code is the only tenant boundary that exists.** Every
    `supabase.from()` on a tenant table without an org or ownership condition is
    a live cross-org hole, today, with no error message.
  * `middleware/authorize.js`'s file header has said this since it was split out
    of index.js. It just never made it into any memory file.
- **A tenant INSERT that omits `org_id` does not fail — it MISFILES.** Migration
  022 gave every tenant table a column DEFAULT of the default org, so company
  B's row lands in company A. This is the quiet half of every scoping bug here
  and it is a data-corruption bug as much as a leak. Check inserts, not just
  reads.
- **`MULTI_ORG` now arms at runtime.** `resolveDefaultOrg()` counts orgs once at
  boot; `services/provisioning.js` exports `onOrgCreated(fn)` and announces from
  `createWorkspace()`, and `index.js` subscribes and sets `MULTI_ORG = true`.
  Before this, the first self-serve workspace left `auth()`'s org-less-session
  refusal disarmed until the next restart.
- **`routes/auth.js` has ONE cross-org choke point: `guardUser(req, res, id)`.**
  Every `/users/:id*` route is keyed on a user id from the URL and none of them
  checked the org. It returns **404** on a miss, never 403. Add new
  `/users/:id` routes through it; do not sprinkle `.eq('org_id', …)`.
  **All 9 `:id` routes are guarded, plus both id arguments of
  `POST /team-assignments`** (they arrive in the request body and were never
  checked). Verify by ENUMERATION, not by eye — see the log entry below.
- **⚠ A BULK EDIT ANCHORED ON A ROLE-GATE STRING WILL MISS A ROUTE, AND THE ONE
  IT MISSES IS NEVER THE ONE YOU ARE LOOKING AT.** The first pass guarded 8 of
  9. `PUT /users/:id/emails/:eid/signature` gates on
  `hasRole(req,'admin','bd_lead','bd')` — the extra `'bd'` meant it did not
  match the anchor the other four shared, and the `assert count >= 4` passed on
  the four that did. It was the **worst** of the nine to miss: any `bd` user
  could set the signature on another org's mailbox, and that signature goes out
  on their live outbound mail. **Enumerate the routes and assert coverage per
  route** (`awk '/^router\.(get|post|put|patch|delete)\(/'` + a per-route
  guard/org/self matrix) rather than counting replacements. This is the same
  lesson as `CLAUDE.md`'s "a syntax check proves a file parses, not that it
  still does anything".
- **`canTouchJob`'s admin bypass is now org-bounded.** It reads the job row
  first (with the org filter) and applies the bypass after. It gates contact
  create/update/delete and the follow-up routes.

## Fragile — touch with care
- **`orgIdFor()`'s default-org fallback must stay.** Background sweeps call
  `withOrg()` with no user; null would turn a scoped query into an unscoped one.
  The gate is in `auth()`.
- Raw `supabase` still works, so **unconverted call sites are unprotected**.
  ~574 hand-written queries once depended on remembering `withOrg()`, and four
  cross-org leaks got in that way.
- **`test/helpers/enter-app.mjs` has no entry for `bd_lead`, `director` or
  `associate_director`** — a five-role sweep silently skips roles real people
  hold. One icon-collision bug affected `bd_lead` and went unseen for that reason.

## Open here
- **`/bd-analytics/*` is un-org-scoped.** It is NOT "the last known scoping gap"
  any more — that line was wrong. See the four contracts below.
- **65 raw queries across 8 routers were audited on 2026-09-09.** Findings are
  written up in full, ranked, with the fix pattern, in `_contracts.md`:
  * **C-0015 → harbour** (`routes/emails.js`, `routes/warmup.js`) — includes the
    two worst findings: `GET /emails` returns **every email body in the
    deployment** to an `admin`/`ra_lead`, and `POST /admin/emails/purge-pending`
    with `all_managers` **deletes every org's pending queue**.
  * **C-0016 → gateway** (`routes/microsoft.js`, `routes/gmail.js` — the map
    says gateway, not harbour). The OAuth token routers: `DELETE
    /auth/*/:userEmailId` kills another org's mailbox and rewrites their leads;
    the token inserts misfile refresh tokens into the default org.
  * **C-0017 → guild** (`routes/workflows.js`, `routes/lookups.js` — `lookups.js`
    is guild's per the map, not gateway's). `POST /jobs/bulk-stage` and
    `/bulk-assign` take **unvalidated `job_ids` from the body** and mutate them
    with no org condition; `check-duplicates` / `check-email` are working
    cross-org enumeration oracles.
  * **C-0018 → foundry** — the `test/authorize.mjs` assertion that pins the old
    admin bypass, plus the allow-list grep suite I want.
- **FALSE ALARMS — do not re-raise these.** `routes/settings.js` (5 queries) hits
  only `app_settings` and `routes/events.js` (1) only `domain_events`. Both are
  in `GLOBAL_TABLES` and are correct as written. `routes/microsoft.js`'s
  schema-check/debug routes and `emails.js:70,219,224` are scoped in practice by
  `req.user.id`. **A raw query is not automatically a leak** — check the table
  against `models/tables.js` before reporting one.
- **`routes/org-domains.js` audited clean** — every query carries
  `.eq('org_id', org)` and a miss is a 404.
- Per-role permissions do not exist — roles are hierarchy-only today.
- "Log In with your Organization" routes by domain; **not** full SAML.
- **The owner should consider rotating the Groq key** — it passed through a
  session transcript when it was read from the database.
- `SELF_SERVE_SIGNUP` is off until strangers should be able to sign up.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-09** — org-scoping audit. Confirmed the service-role key from the
  code (the question that set every severity). Audited 65 raw queries in 8
  routers. Fixed what was inside the border: `guardUser()` across all
  `/users/:id*` routes in `routes/auth.js` (+ `org_id` stamped on the
  `user_emails` insert, + the manager loop-walk scoped, + `team_assignments`
  delete scoped), the `canTouchJob` admin bypass in `middleware/authorize.js`,
  and runtime `MULTI_ORG` arming via `provisioning.onOrgCreated`. Raised
  C-0015/16/17/18. Suite 68/69 — the single failure is
  `test/authorize.mjs` line 58, which pins the bypass that was the bug (C-0018a).
  **What would have saved an hour:** the service-role fact was sitting in
  `middleware/authorize.js`'s header the whole time and in no memory file.
- **2026-09-09, round 2** — coordinator review caught that the first pass
  guarded **8 of 9** `/users/:id*` routes. Fixed `PUT
  /users/:id/emails/:eid/signature` (cross-org write onto another customer's
  live outbound signature) and, from a full re-enumeration of all 18 routes in
  the file, `POST /team-assignments` (both ids taken from the body unchecked).
  Re-enumerated: 18/18 routes now carry a guard, an org filter or a
  `req.user.id` ownership filter; 0 `:id` routes unguarded. `foundry` landed
  C-0018 on the same branch — `test/authorize.mjs` fixed and
  `test/org-scoping-guard-smoke.mjs` added (13 assertions, incl. the 404-not-403
  shape and the `onOrgCreated` arming). **Full suite 70/70, exit 0.**
  Note: a suite read mid-write by a concurrently-working agent reports a false
  failure — re-run before believing one on a shared branch.
