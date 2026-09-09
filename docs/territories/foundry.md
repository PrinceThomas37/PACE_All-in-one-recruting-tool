# Foundry — memory
> Last written: 2026-09-09 · timezone resolver review (C-0014 origin)

## What is true here now
- **`npm test` runs 69 suites** via `test/run-all.mjs` and reports one summary
  (was 68; added `test/timezone-resolver-smoke.mjs` this session).
  Confirmed **69/69 on both Node 22 (sandbox) and Node 26 (Render's
  version)** — full log written to a file and grepped for the summary line
  each time, never piped to `tail`.
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

## C-0012 — the drip survives the send-window switch (closed 2026-09-09)
Observatory's scratchpad proof (`drainDueOutreach` over 8 overdue rows, window
off → 6 sent/capped/5 real 75-104s pauses/0 deferred) is now permanent:
`test/candidate-outreach-drip-smoke.mjs`. Copied its three stub tricks
verbatim because each one cost an hour to find: the fake `candidate_outreach`
query must honour `.limit()` or the 6-per-tick cap looks broken; the chain
needs `.upsert()` for `email_send_log` or every send counts as failed AFTER
the mail has gone; `global.setTimeout` must be swapped to record `ms` and fire
immediately, or the 75-105s pauses are actually waited out. Four cases run
against the REAL router (not a reasoning check): window off (default), window
explicitly on (still defers correctly — a switch that only works one way
isn't a switch), the settings table itself throwing on read (must still drain
as if off — this is the "barricade silently comes back" failure mode the
ledger flagged as hardest to diagnose), and a static check that the router
never calls the leads engine's `isInLeadSendWindow`/`getSendWindowHours` while
`index.js` still defines both. 9/9. Full suite 68/68 on Node 22 and Node 26.
Adversarial read of both commits (`8b50f91`, `5a0c85c`) found nothing else:
daily cap/warm-up/auto-pause/suppression untouched in the drain loop, and the
frontend's `window.sentence`/`window.enabled` match what the route actually
returns.

## C-0014-adjacent — the timezone resolver fix, standing review (closed 2026-09-09)
Gateway rewrote `getTimezoneFromLocation()` in `index.js` (2-letter state code
substring scan -> a real parse: trailing `, XX`, then a full state name as a
whole word, then a short metro-area list, then EST default). Measured live:
81/309 leads (26.2%) had the wrong `jobs.timezone`, always stored EAST of
reality (leads emailed earlier than intended, up to 3h early on the Pacific
coast). Backfill of the 81 wrong rows is `deep`'s (C-0014), needs a fresh
owner go-ahead, and is explicitly not foundry's to do.

**Why `test/lead-location-parse-smoke.mjs` (14 assertions) passed both before
and after this fix, despite a quarter of live rows being wrong — the pointed
question this job asked.** It never calls `getTimezoneFromLocation()`. It
drives the FRONTEND's `bdOpenNewJob()` prefill (`public/js/*`), a
browser-side splitter of a lead's `location` string into `city`/`state` form
fields when converting a Connected lead into a Job Order — a different
function, a different file, a different concern, that happens to share the
word "location" and the word "parse" in its test's name and comment. No test
anywhere called the backend resolver with anything at all. The lesson
applied: name a test for the exact function it exercises, and when a fix
lands with zero adjacent test failures, that absence is itself a finding —
check what the existing test actually calls before treating a green run as
coverage.

**Added `test/timezone-resolver-smoke.mjs` (28/28).** `index.js` boots a real
HTTP server as a side effect of being required (same reason
`backend-smoke.mjs` and `candidate-outreach-drip-smoke.mjs` spawn it as a
child process rather than importing it), so a pure function living inline in
that file cannot be `require()`d directly. Rather than hand-copy the logic
into the test (a copy that could drift from the real function silently — the
same failure class this whole review is about), the test reads the EXACT
source text of `getTimezoneFromLocation` + `US_TZ_MAP` + `US_STATE_NAME_TO_CODE`
+ `US_METRO_AREA_TZ` out of `index.js` between two literal anchors and
evaluates that text via `new Function(...)`. If gateway renames or
restructures the anchors, the test fails loudly (anchor not found) rather
than silently testing stale logic. Covers:
- All 13 real strings named in this job's brief that were wrong before the
  fix, all now correct: `Denver, CO`, `Arizona, Arizona`, `Moreno Valley, CA`,
  `Los Angeles, California`, `Sacramento, CA`, `El Segundo, CA`,
  `Chandler, AZ`, `Austin, TX`, `Milwaukee, WI`, `Eugene, OR`, `Ogden, UT`,
  `Omaha, NE`, `Raleigh-Durham-Chapel Hill Area`.
- The 6 regression strings named in the brief, still correct:
  `Fort Worth, TX ·`, `Houston, TX`, `New Haven, Ct`, `Broomall, PA`,
  `United States`, `NORWOOD, NORFOLK`.
- Null/undefined/empty/whitespace/garbage input never throws.
- **The class of bug, not just the instances**: for every 2-letter code in
  `US_TZ_MAP`, builds a location embedding that code as a substring inside an
  unrelated word (e.g. `"Videographer Ave, TX"` embeds `de`, `"Vacation Ave,
  TX"` embeds `ca`) with a genuine, different trailing state code, and
  asserts the resolver follows the real trailing code, never the embedded
  substring — plus the same check with no trailing code at all (must fall
  through to the EST default, never resolve via the embedded letters).
  **Proved this actually catches the old bug**, not just exercises the new
  code: temporarily reverted the function to the original bare
  `Object.entries(US_TZ_MAP)` substring scan in a scratch copy and re-ran —
  12/28 passed, with the exact fixed cases failing (`Denver, CO` -> EST,
  `Los Angeles, California` -> CST, etc.) and both substring-class checks
  failing with every embedded-code combination it found. Restored the real
  file immediately after and re-verified with `node --check`.
- **Downstream contract**: every value `getTimezoneFromLocation` can emit
  (`EST`, `CST`, `MST`, `PST` — confirmed by enumerating `US_TZ_MAP`'s actual
  values, not assumed) has a `LEAD_TZ_IANA` entry. Confirmed gateway's claim
  about Alaska/Hawaii is correct: `LEAD_TZ_IANA` has no `AKST`/`HST` keys at
  all, only `EST/EDT/CST/CDT/MST/MDT/PST/PDT/Unknown`, so mapping AK/HI to
  `PST` (rather than a code `LEAD_TZ_IANA` can't resolve) is the right call,
  verified rather than accepted on faith.

**Did not touch `index.js`** (gateway's) — reviewed only. **One observation
raised, not a contract** (edge case, not proven present in the 309 live
rows measured, so not blocking): a location with a SECOND trailing segment
after the state code (e.g. `"Austin, TX, USA"`) reads the LAST comma segment
first, which would be `"usa"` here, not `"tx"` — falls through past the
state-code check to the full-name/metro checks, finds nothing, returns the
EST default. Not a regression (previous substring scan would also have
missed this shape in some orderings), and gateway's own commit says it
verified 53/53 on real strings including every previously-wrong live row, so
this is a theoretical gap in an untested shape, not a live defect — noting
it here in case a location field ever grows a third segment.

Ran the full suite (69/69, was 68) on **both** Node 22 (sandbox) and Node 26
(`/tmp/n26`, Render's version), each written to a log file and grepped for
the summary line, never piped to `tail`. Zero `[FAIL]` lines in either log.

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
- **2026-09-09** — reviewed gateway's timezone-resolver fix (C-0014 origin).
  Answered the pointed question: `lead-location-parse-smoke.mjs` passed
  through a 26.2%-of-live-rows defect because it tests an unrelated frontend
  function (`bdOpenNewJob`'s city/state splitter), never the backend
  resolver — same-sounding name, different file, different bug class. Added
  `test/timezone-resolver-smoke.mjs` (28/28): extracts the real function's
  source out of `index.js` at test time (cannot `require()` it directly — the
  file boots a server as a side effect), pins the 13 previously-wrong and 6
  regression strings from this job's brief, and asserts the CLASS of bug (no
  bare 2-letter substring match, checked across every `US_TZ_MAP` code) —
  proved the new test actually catches the old bug by reverting to the old
  scan in a scratch copy (12/28) and restoring. Confirmed the
  `LEAD_TZ_IANA` downstream-contract claim rather than accepting it (no
  AKST/HST entries, matches gateway's stated reasoning). Ran the full suite
  on both Node 22 and Node 26 (69/69 both, log-grepped, never piped to
  `tail`). Did not touch `index.js`; raised one non-blocking observation
  (a location with a second comma segment after the state code) rather than
  a contract, since it is not proven present in the live data gateway
  measured against.
- **2026-09-09** — reviewed the morning-briefing feature (observatory +
  surface). Ran the full suite on Node 22 and Node 26 (67/67 both, after adding
  2 new suites). Added `test/morning-briefing-smoke.mjs` (pure
  no-AI/invented-number/vague-quantity guards) and
  `test/morning-briefing-card-smoke.mjs` (all 8 roles, browser). Added the 3
  missing roles to `test/helpers/enter-app.mjs`, closing C-0006. Confirmed
  observatory's honest disclosure that the AI branch is untested against a
  real provider in this sandbox (no Supabase env here). Raised C-0008 to
  surface for the "view as" stuck-loading briefing card.
- **2026-09-09** — closed C-0012: adopted observatory's scratchpad drip proof
  as `test/candidate-outreach-drip-smoke.mjs` (9/9), the guard for "removing
  the candidate send-window gate could silently un-space the queue" (exactly
  the Session 21 round 4 defect, reintroduced). Ran the full suite on both
  Node 22 and Node 26 (68/68 both). Reviewed both send-window commits
  (`8b50f91`, `5a0c85c`) adversarially — nothing else to raise.
