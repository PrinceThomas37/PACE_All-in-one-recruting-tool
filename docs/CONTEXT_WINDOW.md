# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-08-31 (end of Session 14) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Dev branch**:
`claude/email-id-signature-mismatch-9yznjk`

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
  env var). Plans/entitlements/Stripe seam are real; pricing is deliberately
  `null` — the owner's call, one line in `services/plans.js` when decided.
  Guest-mode/demo-data bypass is fully removed (Session 11) — there is no
  product tour today.
- **Lead distribution uses every connected mailbox** (Microsoft + Gmail, live
  tokens only); a mailbox going inactive auto-moves its leads
  (`services/mailbox-reassign.js`). Leads silent in `Assigned` 30+ days
  auto-recycle to `Unassigned` (`services/lead-recycle.js`).
- **The in-app mailbox** (Session 13) — a real mail client over connected
  mailboxes. Its four inviolable rules are in `CLAUDE.md` Growth bets §3:
  nothing mirrored into Postgres, your own mailboxes only, nothing destroys
  mail, bodies in a sandboxed iframe with remote images blocked.
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

**042 will most likely be an error column on `emails`** — the send path has
nowhere to record *why* a send failed, which is why the 7-day Gmail expiry was
invisible. Session 14 added no migration.

## ✅ Just shipped (Session 14): the outbound send path, made honest

Five merged PRs, all live. Full narrative in the archive; the load-bearing
outcomes:

- **The sender's name is resolved in ONE place — the moment of sending, from
  the mailbox that actually sends** (#142, #143). It used to be baked in at
  queue time from a different chain, so changing a lead's mailbox stranded the
  old name: a cold email went out saying "I'm Jennifer Thomas" over Prince
  Thomas's From line and signature. 152 sent emails carried that mismatch.
  The rule this leaves behind is in Traps below and must not be softened.
- **Fresh leads jump ahead of follow-ups in the send queue** (#144). The queue
  drains at one email per 75–105s inside an 8-hour lead-local window, so order
  decides who goes out *at all* — 36 follow-ups were sitting in front of 20
  leads assigned that afternoon. `send-queue-order.js` is pure and tested by
  behaviour; cap, window, pacing and domain spacing all unchanged.
- **The Admin engine card stopped crying wolf** (#144) — it measured "did a job
  run because of cron" rather than "did the ping arrive", and a ping finds
  nothing due whenever the app is awake, so it went amber when healthiest.
- **`ingestSource` takes an injectable clock** (#145), after its test spent
  weeks failing on a *date* rather than a code change.

## ⏭ Pick this up first (Session 15)

**1. PR #146 is OPEN and ready to merge** — reweights `why-hiring.js` so two
openings of the same title outranks "open 60+ days" (owner's decision). Two
openings → 5, three or more → 9, above every `hard_to_fill` combination. All
49 suites green.

**2. The Gmail connection dies every 7 days, and silently destroys emails.**
Fully diagnosed on 31 Aug, **nothing fixed yet** (archive Session 14 Part 7 has
the evidence chain). Eleven follow-ups were marked `failed` with no reason
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

## Plans — the rules that must not be softened

Tiers and limits live in `services/plans.js`; the full table and rationale are
in `CLAUDE.md` Growth bets §9, kept current. The four rules:

- **Enforced on CREATE with 402**, not 403 — a billing wall, not a permission
  error. Sourcing = Pro+, conversation intelligence = Starter+.
- **Being over a limit never deletes anything.** Create-only enforcement.
- **Only the signed Stripe webhook may change a plan.**
- **A failed usage count ALLOWS** — never block a paying customer on a
  timed-out COUNT.

## Traps that will bite you (learned the hard way)

**Before moving ANY file** → `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP"
(Session 8). Ten things break on a naive move and several fail *silently*.

- **Any mailbox-selection path must check BOTH `microsoft_tokens` and
  `gmail_tokens`, exclude `refresh_failed`, and filter `is_active`** — checking
  one table silently made Gmail unselectable and reused dead tokens forever.
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
  `next-action.js` and **`lead-ingest.js`'s `ingestSource`** are the same
  discipline. `lead-sourcing-smoke` failed for weeks on a *date* because the
  ingest read the real clock against fixed fixture dates (Session 14).
- **`emails.body` holds `{{sender}}` until send time — every reader must call
  `renderStoredEmail(row, mailbox)` first.** Miss it and the token reaches a
  screen, or worse a *recipient* (it was being quoted into follow-ups).
  `sender-identity-smoke` greps for readers and fails if one doesn't render.
- **A dead mailbox sign-in currently DESTROYS emails** — auth failure sets
  `failed` with no retry, one every 90s, and the reason is never persisted
  (`emails` has no error column). Diagnosed, not fixed — see "Pick this up
  first". Any send-path work should fix this rather than route around it.
- **`emails.sent_at` defaults to `CURRENT_DATE`**, so an unsent draft already
  carries a send date. Any "sent on X" report is counting drafts.
- **One reply sweep, not two.** `processInboundMessages` serves Outlook *and*
  Gmail; Gmail messages are reshaped into Graph's shape.
- **Graph's `/move` returns a NEW message id** — the old one stops resolving the
  instant the message lands in the destination folder. Gmail's id never changes.
  Any code that moves a message must take the id it is handed back.
- **A new nav item does not get the slot right after Dashboard.** "My Jobs"
  (recruiter) and "My Team" (team lead) each sit there deliberately and both are
  pinned by tests. Tools go at the head of the tools block, before Email.
- **Retries are safe-methods-only** in `http-client.js`. Retrying a
  `POST /me/sendMail` on a timeout sends the email twice.
- **Use `models/` for tenant tables**, not hand-written `supabase.from()`.
- **The stage vocabulary lives in 6 places** (`33-stage-modal.js` canonical,
  `services/recruiting-core.js` on the backend). That is the **ATS candidate**
  vocabulary — BD **lead** stages on `jobs.stage` are a different, smaller set.
  Don't conflate them in lead-side code.
- **Render is on the FREE tier** — instance hours are a hard budget. Ask what
  a new poller costs before adding one.
- **When a claim about behaviour is load-bearing, test the claim.**
- **The browser tests are not allowed to need a production bypass** — use
  `test/helpers/enter-app.mjs`.
- **A destructive DB action always needs, in this order:** check FK cascade
  rules (`information_schema`; `NO ACTION` means clear referencing rows
  yourself), verify scope with counts, take a snapshot, get explicit
  confirmation, verify after. Followed for the 25-follow-up delete (Session 14)
  and the 1,249-lead cleanup (Session 13) without incident.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" —
  that is the **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML yet.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- Growth bets not started: per-role permissions, **CSV import/export + public
  API** (still the one CLAUDE.md flags as highest-leverage next), generalized
  audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker in the UI
  (the API supports it), no shared/delegated mailboxes, unread badge is a 60s
  cached poll not a live push.
- **The 25 final follow-ups deleted on 31 Aug do not regenerate** — their
  `follow_ups` schedules were already marked complete when first queued. Those
  contacts got their initial + one follow-up and no third touch. Deliberate,
  owner's instruction.

## Working rules

`npm test` (49 suites now, judged by **exit code**) · `bash
test/verify-frontend.sh` · build on the dev branch → test → screenshot/show →
draft PR → merge only on an explicit "merge it"/"do it" → for anything
touching the live DB, apply the migration only on a fresh explicit go-ahead,
right before merge, not on general feature agreement. The owner does not read
code; show them the running app and plain English.

**Two habits this session paid for repeatedly:** check whether a failing test
is failing on *live code* or on the *calendar* before calling it a product bug
(and correct yourself out loud if you got it wrong), and when a placeholder is
left in stored data, find EVERY reader before declaring it fixed — the first
attempt at the sender fix taught exactly one screen and left the token leaking
into follow-ups a customer would have read.
