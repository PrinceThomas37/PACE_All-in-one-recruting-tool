# Rampart — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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
- `/bd-analytics/*` is **un-org-scoped**. This is the last known scoping gap.
- Per-role permissions do not exist — roles are hierarchy-only today.
- "Log In with your Organization" routes by domain; **not** full SAML.
- **The owner should consider rotating the Groq key** — it passed through a
  session transcript when it was read from the database.
- `SELF_SERVE_SIGNUP` is off until strangers should be able to sign up.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
