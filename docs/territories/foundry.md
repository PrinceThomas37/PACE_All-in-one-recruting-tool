# Foundry — memory
> Last written: 2026-09-09 · morning-briefing review

## What is true here now
- **`npm test` runs 67 suites** via `test/run-all.mjs` and reports one summary
  (was 65; added `morning-briefing-smoke.mjs` and
  `morning-briefing-card-smoke.mjs` this session). Confirmed **67/67 on both
  Node 22 (sandbox) and Node 26 (Render's version)** — full log written to a
  file and grepped for the summary line each time, never piped to `tail`.
  It judges by **exit code**, not by grepping stdout (the suites print in two
  formats, and a stdout grep mis-reports whole suites as failures).
- **22 suites are Playwright.** `playwright-core` is a devDependency; Chromium is
  at `$PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers`). If they fail at once with
  a module error, that is the missing dep, not 22 broken tests.
- Browser suites enter via `test/helpers/enter-app.mjs`, which sets
  `STATE.user`/`STATE.token` and re-renders. They used to click "Continue as
  Guest" — **never reintroduce a product-side bypass to make a test easier.**
- `bash test/verify-frontend.sh` checks syntax + `index.html`.
- Deploy is Render (`fute-lms-backend.onrender.com`), auto-deploying from `main`.
  **Merging to `main` IS the release.**
- The GitHub heartbeat is **every 30 minutes**; `.github/workflows/heartbeat.yml`
  carries the reasoning. Free tier is ~750 instance hours/month.

## Fragile — touch with care
- **⚠ SANDBOX IS NODE 22, RENDER IS NODE 26.** This cost a whole session: resume
  parsing failed in production and every file parsed perfectly here — same
  library, same lockfile version, same bytes. The difference was the runtime.
  The full suite passes on both today; keep it that way.
- **`npm test | tail -3` takes the exit status of `tail`.** A real failure comes
  back as 0. Session 18 nearly merged on a masked `55/56`.
- **Never wait with `pgrep -f run-all.mjs`** — the waiter matches itself.
- Measured 2026-09-04: GitHub delivered the 30-minute schedule every **3-5
  hours** (every one HTTP 200, all six jobs run). Jobs are delayed, never
  skipped, because due-ness lives in the database. **Do not ping harder.**

## Guards worth knowing by name
`route-shadowing-smoke` (dead literal routes) · `sender-identity-smoke` (any
reader of `emails.body` that does not render) · `screen-stability-smoke` (zero
mutations on an idle repaint, by node identity) · `mobile-layout-smoke` (16 pages
× 5 roles at 390px — **still its own hardcoded 5-role list**, not read from
`TEST_USERS`, so it did not pick up `bd_lead`/`director`/`associate_director`
automatically the way `nav-icons-smoke` did; worth widening later, not urgent) ·
`outreach-ai-quality-smoke` (every `onclick` a page emits is defined in that
page) · `recruiting-routes-mounted` (all 63) · `models-smoke` ·
`org-scoping-routes-smoke` · `morning-briefing-smoke` (the pure writer/checker
in `services/morning-briefing.js`: no-AI path never apologises and is never
empty; `checkBriefing` rejects a bare invented integer, a spelled-out one, and
a vague quantity like "around a dozen") · `morning-briefing-card-smoke`
(browser test, walks all 8 roles in `users_role_check` with `apiGet` stubbed,
confirms the card actually paints on each dashboard branch).

## `test/helpers/enter-app.mjs` — TEST_USERS is now the real 8, not 5
`users_role_check` (migrations/039) allows exactly `ra, ra_lead, bd, bd_lead,
admin, recruiter, associate_director, director`. `TEST_USERS` used to define
only 5 of them — `bd_lead`/`director`/`associate_director` were silently
skipped by every role sweep in the suite (this is what let a `bd_lead`-only nav
bug go unseen for a full session, per `CLAUDE.md` Session 21). Fixed 2026-09-09
(C-0006, closed by foundry itself — it's a `test/` file, no need to wait on
another territory). **Adding a role here retroactively widens every test that
iterates `TEST_USERS`** — confirmed live: `nav-icons-smoke.mjs` went from
40/40 to 55/55 assertions on the next run with zero edits to that file. Any
future role added to `users_role_check` must be added here in the same PR, or
the gap reopens invisibly.

## AI path: still unverified against a live provider
Confirmed this session (not just repeating observatory's claim): this sandbox
has no `SUPABASE_URL`/service-role env var, and the provider key lives in
`app_settings`, read only through a live Supabase connection
(`services/ai-provider.js` config section, `LAST_TEST_KEY`/`LAST_ERROR_KEY`
reads). So **every AI branch in every suite — morning briefing included — is
exercised only against hand-written model output**, never a real Groq/OpenAI
call. Closing this gap needs either Supabase credentials added to a future
sandbox, or a live smoke run kicked off from an environment that already has
them (Render itself, or a local dev box with `.env`). Until then, treat
"engine: ai" as **structurally possible, not empirically observed** for the
morning briefing or any other AI seam.

## Open here
- **Nothing shipped since PR #185 has been seen working in the live app** by the
  owner — the rail icon, the ‹ › stepper, opening a sent email, the Rewrite
  button. All pinned by tests; none confirmed by a human.
- Three stale draft PRs (#116, #126, #135), months behind `main`.
- **C-0008 raised to surface** (2026-09-09): the morning-briefing card can get
  stuck on "Working out what came in today…" forever during "view as", because
  `loadMorningBriefing()` shares the `!isViewingOther` gate written for the
  per-user next-actions queue, but the briefing is org-wide, not per-user —
  found by reading the code path, not reproduced live (this territory doesn't
  edit `public/js/*`).

## Log
- **2026-09-09** — reviewed the morning-briefing feature (observatory +
  surface). Ran the full suite on Node 22 and Node 26 (67/67 both, after adding
  2 new suites). Added `test/morning-briefing-smoke.mjs` (pure
  no-AI/invented-number/vague-quantity guards) and
  `test/morning-briefing-card-smoke.mjs` (all 8 roles, browser). Added the 3
  missing roles to `test/helpers/enter-app.mjs`, closing C-0006. Confirmed
  observatory's honest disclosure that the AI branch is untested against a
  real provider in this sandbox (no Supabase env here). Raised C-0008 to
  surface for the "view as" stuck-loading briefing card.
