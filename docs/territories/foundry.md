# Foundry — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## What is true here now
- **`npm test` runs 65 suites** via `test/run-all.mjs` and reports one summary.
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
× 5 roles at 390px) · `outreach-ai-quality-smoke` (every `onclick` a page emits
is defined in that page) · `recruiting-routes-mounted` (all 63) ·
`models-smoke` · `org-scoping-routes-smoke`.

## Open here
- **Nothing shipped since PR #185 has been seen working in the live app** by the
  owner — the rail icon, the ‹ › stepper, opening a sent email, the Rewrite
  button. All pinned by tests; none confirmed by a human.
- Three stale draft PRs (#116, #126, #135), months behind `main`.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
