# Foundry — memory
> Last written: 2026-09-28 (Session 33) · 137 suites · +send-recovery-smoke (58)

## Session 33 (2026-09-28, later) — the title search, R-063, the Apollo card
- **136 suites** (`npm test` 136/136, exit 0): +`poc-people-search-ui-smoke.mjs`
  (26, Playwright — real Enter key and real mouse clicks; the stub's "already
  added" 409 is built by the server's own `duplicatePayload`, its slots by the
  real rules). `poc-routes-smoke` 99 → 125 (title search, Uncover, a law firm,
  `/admin/apollo/usage`; the fake enforces migration 054's slot rule),
  `poc-targets-smoke` 75 → 95 (firms, new HR words, leaders),
  `poc-apollo-smoke` 44 → 49 (blank search omits the title filter; the hint;
  the total).
- **Every new server rule was broken on purpose and failed:** always paying for
  a looked-up person; no daily limit on Uncover; the slot ignoring the firm;
  keeping Apollo's guessed email; no duplicate check on Uncover; an empty
  title filter sent. Each named its own failing step.
- **The browser test found a real bug on its first run** (the Apollo card's
  limit box drawn blank — see surface). Its first expectation was also wrong
  (7 credits instead of 8 after two uncovers): **read the count from the
  test's own data, never type it**, or a correct page reads as broken.

## Session 33 (2026-09-28, latest) — "Already added" (D-0051)
- **135 suites** (`npm test` 135/135, exit 0): +`contact-duplicate-smoke.mjs`
  (32 — the pure rules + the REAL `routes/contacts.js` over a projecting fake
  db) and +`already-added-ui-smoke.mjs` (25, Playwright — its stub's 409s are
  built by the server's own `duplicatePayload`, never hand-typed).
  `poc-routes-smoke` 94 → 99 (Accept against an address at ANOTHER company;
  Accept of somebody already on the lead). Its fake db gained `ilike`
  (Postgres semantics: `%`/`_` wildcards, backslash escapes).
- **Every guard was broken on purpose.** Server: no email check, name always
  allowed, name counted at unrelated firms, lead always "visible", deleted
  leads counted — each failed. UI: error body dropped from `apiFetch`, "Add
  anyway" never offered, Accept-of-existing toasting "Added", pop-up without
  `.modal` (transparent) — each failed.
- **One guard was VACUOUS on the first try, and the reason is general:** "a
  typed `_` is not a wildcard" passed with the escape REMOVED, because an exact
  lower-case compare runs after the ILIKE and makes the escape unobservable in
  the OUTCOME. Defense in depth hides the outer layer from an outcome test. The
  fix asserts the PATTERN actually sent (`ilikes` records every ILIKE, and the
  test expects `a\_b@…`). **When a rule has two layers, test each layer where it
  acts, not only the result.**

## Session 33 (2026-09-28, later) — the Leads × and Apollo company lookups
- **133 suites**: +`leads-search-clear-smoke.mjs` (11, Playwright). **It clicks
  with a REAL mouse** (`page.mouse.click` at the element's centre, plus
  `elementFromPoint` to report what is really under the pointer): the broken ×
  had `pointer-events:none`, which `element.click()` from script ignores — a
  script click would have passed on the broken code. 5/11 against the old code,
  reproducing the owner's report exactly (the box still read
  "mmills@saylorconsulting.com" after the click).
- Grown: poc-routes-smoke **94** (size-first, one-slot search, manual never
  overwritten, not-found free + 30-day window, name mismatch, ceiling, gates,
  diagnostics without the key), poc-apollo-smoke **44** (company lookup),
  poc-targets-smoke **75** (bands at every edge, same-company cases),
  poc-finder-ui-smoke **58** (Search contact per slot sends `slot_key`, Look up
  with Apollo, a 390px fit of the slot buttons).
- A UI test step failed because an EARLIER step in the same run left an Add-by-
  hand form open, which (correctly) hides that slot's buttons — shared page
  state between sections is a hazard; the step now closes it first.
- **`org-session-gate` failed once in a full run** ("server did not boot on
  39872", 4/5) and passed alone — **root-caused, not re-run**: a real boot
  takes ~0.5s here, and the suite used FIXED ports 39871/39872 inside Linux's
  ephemeral range, where another process's socket can sit. Holding 39872 with
  a silent listener reproduces the exact failure. It now asks the system for a
  free port per boot (`freePort()`) and fails at once with the server's own
  stderr if the child exits. Passes with the old port held. **Never pick a
  fixed port in 32768–60999 for a test server; listen on 0 and read it back.**

## Session 33 (2026-09-28) — the contrast probe had TWO blind spots
The separate task the POC finder session (R-053 slice 2) raised: its probe,
copied from `theme-contrast-smoke`, never measured a name sharing its element
with a span. Fixed there; this is the same fix in the theme suite.
- **The probe judged LEAF elements only** (`if (el.children.length) continue`),
  so text sharing its element with a child element — a name beside its title
  span, a label beside its icon, a heading beside its count badge — was never
  measured. `CONTRAST_PROBE` now judges each element's OWN text nodes (≥2
  chars). Threshold 2.2, translucent-ancestor compositing and
  decline-on-gradient are unchanged. A leaf's own text IS its textContent, so
  this is a strict superset: at rest it judges **1,056 texts per theme, was
  979** (+77 mixed; 3 more mixed sit on a gradient and are declined as before).
- **The "opened row" pass had never measured the opened PANEL.** Its scope
  named `.lead-expand`, a class that exists nowhere in the app (not in any
  commit this shallow clone holds, back to 15 Sep). The panel is the shared
  `tr.row-exp` (`03-core-render.js`, R-012; Leads adds `lead-exp`), so only
  the row's own cells were ever judged. **Found because the mandated mutation
  check PASSED**: dark ink on a contact name inside that panel went green under
  the new probe too. Scope is now `tr.row-exp *`, and a new step per theme
  asserts the panel is there with text (328 chars). Renaming the class in
  `_rowInsert` fails it in both themes (0 chars), verified. Suite 10 → 12.
- **Mutations, each run against BOTH probes with everything else identical**
  (a scratch copy differing in the one probe line; all restored, `git diff --
  public/` empty after each):
  * `.lx-nm{color:#1a1a1a}` (name + Primary chip, opened lead panel) → own-text
    FAILS dark, "Ada Byron" 1.57:1; leaf-only passes 12/12.
  * `.pgtab.on:has(> .pgtab-n){color:#1a1a1a}` (tab + count badge, AT REST) →
    own-text FAILS dark, "All Candidates"/"Review queue" 1.04:1 on 3 roles;
    leaf-only passes 12/12. (`:has` keeps badge-less tabs — leaves the old
    rule already measured — out of it, or the A/B proves nothing.)
- **No real unreadable text was hiding; no stylesheet changed.** Nothing under
  2.2 at rest, and a one-off diagnostic over POPULATED screens
  (`row-reveal-smoke`'s stub: Jobs, Candidates, Clients lists + open panels,
  the full job page, the candidate drawer, a 2-lead Leads list with a row
  opened) judged **606 texts per theme, 100 of them mixed**. Weakest: 2.61:1
  dark ("Primary" chip, 9.5px accent on its own tint), 2.4:1 light (the gold
  "CE" of the rail wordmark), 2.73:1 light (muted grey on the `is-open` row
  tint). Near-misses, not failures — the first things a raised bar would flag.
- **OPEN (foundry's own): the suite still renders screens EMPTY** (no backend)
  plus one lead row. Populated lists, row panels and record drawers have no
  permanent contrast guard; the sweep above was one-off. `row-reveal-smoke`'s
  stub is the ready-made way in.
- Full run **128/128**, exit 0 (Node 22; the change is browser-side code inside
  `page.evaluate`, so Node 26 was not re-run). #253 (the POC finder) merged to
  `main` while #256 was in review — conflicts only in memory files — and on the
  merged tree: **132/132**, theme-contrast 12/12, poc-finder-ui 50/50. The
  finder's slot cards need the server, and this suite aborts all network, so
  here the panel draws the plain contact list; `poc-finder-ui-smoke` measures
  the cards themselves with the same own-text rule.

## Session 33 (2026-09-28) — R-053 slice 2 suites, one race fixed
- **132 suites**: +`poc-apollo-smoke.mjs` (33, pure, a fake fetch). Grown:
  `poc-routes-smoke` 23→**73** (a fake Apollo; the fake table enforces
  migration 052's CHECKs + unique index and records any refused write),
  `poc-targets-smoke` 57→**71**, `poc-finder-ui-smoke` 25→**50**,
  `models-smoke` (TENANT_TABLES **46**, names poc_suggestions).
- **company-merge-smoke earned its keep**: it scans the migrations for every
  table with a `company_id` and failed until poc_suggestions joined the merge
  list. models-smoke's hard-coded 45 failed the same run — the count is a
  deliberate tripwire, bumped with a named assertion.
- **A guard can pass vacuously because a SECOND check covers for it.**
  Removing the on-file exclusion before picking still passed 69/69: the
  after-lookup check caught the same people. Fixed by making an on-file person
  the BEST fit for the open slot, so the first check decides who gets it.
  Every slice-2 guard was then reintroduced one at a time (8 route, 2 module,
  3 screen, 2 contrast) and each fails.
- **The contrast probe judged LEAF elements only** (copied from
  theme-contrast-smoke) — so a person's NAME, which shares its element with a
  title span, was never measured; a hard-coded dark ink on it passed. The
  poc-finder probe now judges each element's OWN text nodes. **theme-contrast-
  smoke has the same blind spot** — raised as a separate task, not widened
  into this PR. (Closed 2026-09-28 by #256 — see the section above.)
- **`lead-intel-ui-smoke` failed once in a full run (a null `.text`) and
  passed 5/5 alone — not a flake, a race in the test.** Its `openRow` removed
  the open panel by DOM surgery while rowReveal (R-012) still believed j1 was
  open; any repaint in the gap put the panel back and the next click CLOSED
  it. Reproduced deterministically by forcing `rowRevealRefresh()` in the gap
  (same error); fixed by closing through `rowRevealClose()` and waiting for
  the block instead of a fixed sleep; the forced-repaint run then passes.
  **Reset app state through the app's own API, never by removing its DOM.**

## Session 33 (2026-09-27) — R-053 slice 1 suites
- **131 suites** with these three: +`poc-targets-smoke.mjs` (57, pure; the
  never-guess-an-email guard fails 56/57 when a market-prior fallback is put
  back), +`poc-routes-smoke.mjs` (23; the real router on a real Express app
  over an in-memory db that projects to each select; the "another lead's
  people never leave the server" guard and the 404 visibility guard each fail
  22/23 when their bug is reintroduced), +`poc-finder-ui-smoke.mjs` (25,
  Playwright; its stub builds every answer with the REAL rules, never
  hand-typed).
- `innerText` returns CSS-uppercased headings in capitals — a regex for
  "Contacts" misses "CONTACTS". Match headings case-insensitively.

## Session 33 (2026-09-27) — R-012, every list opens in place
- **127 suites** now: +`row-reveal-smoke.mjs` (45, Playwright, stub API at the
  Render host like `session31-flows-smoke`; `SHOTS=<dir>` writes desktop/phone,
  light/dark). Covers Jobs, Candidates and Clients panels, the shared
  mechanism's refresh-restore rule, and a 390px fit walk. Against `origin/main`
  (a scratch `git worktree` with node_modules symlinked in) it scores **5/45**.
- **Two ways a browser test lies, both fixed here before trusting it:**
  `page.click()` on a missing node throws after 30s and CRASHES the run — one
  failure reported, every later failure hidden; use an evaluate-click that
  returns false. And a "still on the same page / drawer not opened" check
  passes vacuously when the click found nothing to do — pair it with "the
  panel is there". Three such checks passed on the old code until paired.
- Full run 127/127, exit 0 (Node 22 sandbox; frontend-only change). With #251's
  `storage-orphans-smoke` merged in from a second chat the same day: 128 suites.

## Session 31 (2026-09-24)
- **109 suites** now: +`session31-flows-smoke.mjs` (Playwright, stub API at
  the Render host — routes `https://fute-lms-backend.onrender.com/**` to a
  fake, so screens can be driven with data and write screenshots via
  `SHOTS=<dir>`) and +`pipeline-tag-membership-smoke.mjs` (mounts the real
  route handlers on a Proxy app with an in-memory PostgREST-shaped db; a
  reusable pattern). Full run 108/108 before the second was added; both new
  suites verified by reintroducing their bugs.
- `overlay-opacity-smoke` step 2 re-pointed from the removed Connected drawer
  to the Leads Stage dropdown.

## Session 31 (2026-09-25) — client intelligence suites
- +`client-intel-smoke.mjs` (34, pure; the 2-year cap guard fails when the cap
  is removed — measured 232k tokens), +`client-intel-routes-smoke.mjs` (20,
  real handlers, in-memory db, stub AI; the owner-only guard fails when opened
  up), +`client-intel-ui-smoke.mjs` (10, Playwright). `company-merge-smoke`'s
  "every company_id table is in the merge list" caught the two 048 tables —
  exactly its job. Full suite 115/116 before that fix.

- 2026-09-25: client-intel-routes-smoke now 27 (full sent text; full reply fetch owner-only, own-mailbox-only, right-client-only, plain text). Full suite 116/116.
- 2026-09-25: client-intel-routes-smoke now 38 (+11 lead checks; the "another lead's mail stays out" guard verified by setting the lead's companyId — 4 checks fail). +`lead-intel-ui-smoke.mjs` (12, Playwright; the stub must `decodeURIComponent` the path — the page sends `in%3A1`). The catch-up itself has no unit test: it only runs against a real mailbox; reviewed by reading.

## What is true here now
- **`npm test` runs 110 suite files** via `test/run-all.mjs` and reports one summary
  (was 105 at the last count in this file; +2 this session —
  `email-attachments-smoke.mjs`, `email-history-scope-smoke.mjs`). Confirmed
  **107/107 on Node 22** this session, full log written to a file and grepped
  for the summary line, never piped to `tail`. (The 69→105 jump in between
  happened across several other sessions' work; this file's own count had
  fallen behind — always trust `test/run-all.mjs`'s own printed total over a
  remembered number.)
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

- **`modal-mobile-smoke.mjs` opens 18 pop-ups at 390px in both themes.**
  `mobile-layout-smoke.mjs` walks PAGES and never opens a modal — that gap let
  a 48px field ship on the stage modal. It measures three things, and the first
  two versions were VACUOUS: measuring only "past the viewport" misses a grid
  that CRUSHES its columns instead of overflowing, and asking CSS for
  `overflow-x` is useless because `overflow-y:auto` makes it compute to `auto`
  too. It now asks whether a box actually scrolls sideways. **An opener that
  renders nothing is a FAILURE, not a skip** — nothing has no overflow.

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
page) · `theme-contrast-smoke` (each element's OWN text on its composited
ground, under 2.2:1 fails; 51 screens × 3 roles × 2 themes, the login screen,
and a hovered + opened lead row whose `tr.row-exp` panel must be present) · `recruiting-routes-mounted` (all 63) · `models-smoke` ·
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

## Session 27 — two new suites, and a THIRD vacuous guard

- **`test/apply-page-smoke.mjs`** (67 assertions) — token secrecy, the
  client-name leak, the shared JD scrubber, refusals, the failed-write path,
  rate limiting. **`test/sourcing-honesty-smoke.mjs`** (31) — registry
  truthfulness, the endpoint's refusal, and a real-browser check that no
  unbuilt provider sits in a panel offering an action. Suite total is now
  **89**.
- **⚠ THE SOURCING GUARD PASSED 30/30 WITH THE BUG FULLY REINTRODUCED.** Third
  vacuous test in this repo's recorded history — treat it as the norm. Two
  independent causes, both worth carrying into every future probe:
  * **`if (!node) continue`.** A probe that CANNOT TAKE ITS MEASUREMENT must
    FAIL, never pass. Deleting the whole list under test made the assertion
    trivially true. `missing` is now its own assertion.
  * **It read `node.parentElement` only**, and the control sat one level
    higher. **Never anchor a DOM assertion on a nesting depth** — ask the
    question the rule is about (`closest('.card')`).
- **A screenshot found what the green suite could not** (a gutted sentence
  reading "Questions? Email or call ." on a public page). Render it and LOOK.
- Every guard added this session was verified by reintroducing its bug and
  watching the right assertions fail. Do that before trusting a new one.

## Session 27, round 3 — a guard for the guards

- **`test/memory-discipline-smoke.mjs`** (25 assertions) pins
  `scripts/memory-check.mjs`, the checker behind the new Stop hook. Suite total
  is now **90**.
- **It is driven by SYNTHETIC file lists**, not a real repository, because a
  checker tested only against the current tree passes for whatever the tree
  happens to contain. The decisive case replays **Session 27's actual
  apply-page commit** and asserts the checker names the six territory memories
  that were really missed that day.
- **The gate this protects is deliberately dumb and must stay that way.** It
  checks that memory was WRITTEN, never that it is any good. Do not add
  quality heuristics — that judgement cannot be automated, and a checker that
  pretends otherwise becomes the most convincing vacuous guard in the repo.
- **A hook that blocks must be SATISFIABLE.** `stop-gate.mjs` offers two exits
  (write it properly, or an honest mid-flight placeholder) and never blocks on
  its own failure — if the checker cannot run, the gate stays silent rather
  than walling off the work. Keep both properties.

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

## 2026-09-11 — 76 suites, and two of them were passing vacuously

**Four new suites, every one written because reasoning had already failed:**
`ageing-layout-smoke` (16 pages x 5 roles at two data scales, fails over 3x DOM
growth), `theme-contrast-smoke` (51 screens x 3 roles x 2 themes plus the
logged-out screen, fails under 2.2:1), `next-action-dismiss-smoke`,
`orphan-followup-guard`.

**THE LESSON OF THE SESSION: A GREEN CHECK IS A CLAIM ABOUT WHAT WAS MEASURED.**
Two suites passed while measuring nothing, in the same session:

* **the ageing seeder** spread 20 "young" records over the same two years as the
  2,000 aged ones, so most of the young case fell outside the 90-day horizon and
  rendered almost nothing — which made an **already-fixed page still measure as
  broken** (5.4x). Young means RECENT, not sparse.
* **the contrast probe** reads `backgroundColor`, which is `rgba(0,0,0,0)` for a
  **gradient**. It walked past the login header's slab to the pale page behind
  it and reported a confident FALSE failure. It now returns null for text on a
  gradient and **declines to judge rather than judging wrongly**.

Both were caught **only** by deliberately reintroducing the bug and watching the
test go red. **Do that for every new guard before trusting it** — it is two
minutes and it is the difference between a test and a decoration.

**A SUITE ONLY COVERS THE SCREENS IT RENDERS.** `theme-contrast-smoke` set
`STATE.page` only, so every multi-tab page drew its DEFAULT tab — Email's Sent
and Outreach Plan were never rendered once. And it calls `enterApp()` first, so
the **login screen was never rendered at all.** Three of the five faults the
owner found on their phone were in those blind spots. `SCREENS` now carries
`[page, subState]` pairs and the logged-out case is a separate assertion.

**Measurement beats reasoning, repeatedly.** Hand-grepping for `.map()` over
state collections produced 32 "offenders", nearly all state UPDATES or bounded
lists — zero real. Rendering the same page at two data scales and comparing
found the two real ones immediately, with numbers (92.1x, 74.3x).

**`org-session-gate` flaked once** under parallel load: "server did not boot on
39872", 5/5 in isolation. A port collision, not a regression — the diff was CSS.
One re-run confirmed, per the flake rule. Do not chase it further.

**Both Node versions, every PR.** 76/76 on 22 and 26 for #203, #204 and #205.
- **2026-09-22** — added `apply-page-smoke` and `sourcing-honesty-smoke` (89 suites total); caught and fixed a vacuous guard that passed 30/30 with its bug reintroduced.
- **2026-09-22** — added `memory-discipline-smoke` (90 suites); reviewed the Stop gate for satisfiability and fail-open behaviour.

- **2026-09-22 (round 2)** — **A CRASHED PAGE IS THE BEST-BEHAVED PAGE IN THE
  APP, AND THAT IS WHY NOTHING CAUGHT IT.** `bd_joborders` threw on every
  render. Five browser suites render that page —
  `theme-contrast`, `screen-stability`, `ui-smoothness`, `ageing-layout`,
  `mobile-layout` — and all five passed on it.

  Not luck. `UI.registerPage` catches a render error and writes one short red
  sentence into `#content`. That page has **excellent contrast** (dark red on
  a plain ground), **three DOM nodes** (so it cannot fail a 3x growth cap),
  **no overflow** (nothing to clip), **no compositing layers** and **perfect
  repaint stability** (nothing to repaint). It scores better than a working
  page on every axis those suites measure. `page.on('pageerror')` does not see
  it either — the error is *caught*, which is the whole point of the handler.

  **A suite measuring the QUALITY of a screen cannot tell you the screen
  exists.** Those are different questions and they need different tests.

  **`test/page-renders-smoke.mjs` (new, 91 suites)** is that second question
  and nothing more: every registered page x five roles x two data shapes —
  **170 screens** — asserting only that `#content` does not contain
  "Could not draw this page" or "Page not found". Deliberately dumb, no layout
  judgement, no per-page knowledge. It also carries a **cannot-measure guard**
  (the modules really loaded), per the vacuous-guard rule.

  **Verified by reintroducing the bug**: 3/7, naming both faults including the
  `applyBlock is not defined` one nobody had seen. Restored: 7/7.
  Full suite **91/91**, `verify-frontend.sh` PASS.

- **2026-09-22 (Session 28, round 2)** — **A PAGE IS NOT ONE SCREEN, SO THE
  RENDER GUARD NOW DRIVES SUB-STATE.** `page-renders-smoke.mjs` set
  `STATE.page` only, which draws every multi-tab page's DEFAULT tab — so the
  new Applicants tab (`STATE.ats.view`) would never have been rendered by it,
  the same hole that let Email's Sent and Outreach Plan tabs ship broken in
  Session 23. Screens are now `[page, sub]` pairs, shallow-merged into STATE,
  and the Candidates page is covered as **three** screens rather than one.
  **190 screens** (was 170). When a page grows a tab, add the pair.

  **Two new suites, 93 total:**
  * `applicants-smoke.mjs` (23 assertions, pure) — the applicant→job contract.
    Written precisely because the alternative implementation was a PostgREST
    filter that **cannot be run from this sandbox**, whose failure mode is an
    empty list. Given a choice between an untestable mechanism and a testable
    one, take the testable one — the guard is the point.
  * `applicants-ui-smoke.mjs` (13 assertions, browser) — both screens, and the
    one that matters: **a job page must not show another job's applicant.**

  **A vacuous pass was caught and fixed inside this suite.** "A job with no
  applicants says so" was pointed at a job id that did not exist, so the page
  drew *"Job not found or still loading"* and the assertion passed **without
  ever rendering the applicants block**. It now uses a REAL job with no
  applicants and asserts that job's own title is on screen first — proof the
  page rendered — before asserting the empty sentence. **An empty-state test
  must prove the thing rendered before it judges what it says.**

  Both guards verified by reintroduction: removing the job filter fails 4 of 13;
  making `forJob` pass through fails 2 of 23.

- **2026-09-22 (Session 28, round 3)** — **94 suites.** One new
  (`applicant-notify-smoke`, 24 assertions) plus 13 more across the applicants
  suites.

  **The emails needed pinning more than most code in this repo:** one of them
  goes to a STRANGER, under the CUSTOMER's name, with nobody reviewing it
  first. So `services/applicant-notify.js` is pure and its exact words are
  asserted — in particular that **the end client's name never appears in the
  applicant's email** (verified by reintroducing the leak: 23/24) and that **no
  timeframe is promised**, because PACE cannot keep one. The recruiter's alert
  is internal and MAY name the client; that asymmetry is asserted both ways.

  **Three guards verified by reintroduction this round:** the client leak
  (1 fail), the submission stage changed to "Tagged" (1 fail), and the source
  label reverted to the raw id (1 fail). Each was restored and re-run green.

  **A live record is evidence and was used as such.** Before writing any fix,
  the claim "it is not added to the job" was checked against the production
  database: candidate present, pipeline row present, submissions empty. That
  turned a vague report into a precise one in a single query, and it is the
  reason the fix was the right one rather than a guess at the UI.

- **2026-09-22 (Session 28, round 4)** — **95 suites.**
  `submission-stages-smoke` (34 assertions) pins the business definition the
  owner gave: Sourced and Screening are NOT submissions, `Submitted to BDM` is
  recruiter output, `Submitted to Client` onward is the real thing, and the
  parts always account for every row.

  **Verified both ways by reintroduction**, which matters because this metric
  can be wrong in two opposite directions: counting every row fails **16**
  assertions, and treating `Submitted to BDM` as a client submission fails
  **3**. A guard that only catches over-counting would have missed the second.

  **A real test failure caught a real relabel.** `recruiter-dashboard-smoke`
  asserted the string "Subs this week", which the fix renamed. The assertion
  was updated AND given a companion that fails if the old ambiguous wording
  ever returns — a renamed label should not be able to quietly revert.

## Session 28 — `record-history-smoke.mjs` (26 assertions)

Covers the pure normaliser, and greps for the wiring faults that actually ship
here. Three were **verified by reintroducing the bug and watching the suite go
red**, per the standing rule that a new guard is assumed vacuous until proven
otherwise:

| bug reintroduced | caught by |
|---|---|
| the job-order button deleted | "all four record screens actually carry the button" |
| the panel repainted on glass `--card` | "the panel paints on --card-solid" |
| a second copy of the panel module | "the panel exists ONCE" |

Also pinned: **every time assertion injects `now`.** `relativeTime` makes a
factual claim about elapsed time, so calling it with the real clock produces a
test that passes on the day it is written and rots silently after — the
conversation-intel rule, applied to a second feature.

`models-smoke.mjs` moved 42 → **43** tenant tables for migration 045, and it
caught the change the moment the registry moved, which is exactly its job.

## Session 29 — `send-retry-smoke.mjs` (20 assertions)
Pure classification and ladder tests, the manual-retry rules, and wiring checks
on index.js (one bare `status:'failed'` left — the no-columns fallback; `isDue`
filter on the pending fetch; auth-failed mailbox skip; route order; org-scoped
model). **Verified non-vacuous**: re-introducing the old bare-failed catch and
removing the `isDue` filter turned two assertions red. Full suite 97/97 on
Node 22 (after `npm ci` — a fresh sandbox has no node_modules, which reads as 54
failing suites and is not a real failure).

## Session 29 — `engine-draft-smoke.mjs` (15 assertions)
Offline, with a stand-in `complete`. Verified non-vacuous: disabling the thin-
posting rule and removing the send-loop call each turned an assertion red.
Suite 98/98. Note: the first run had a vacuous-looking FALSE failure of my own —
the sample email was long enough to pass either floor; the test now asserts the
sample sits between the two floors before judging.

- **2026-09-23** — engine-draft-smoke now 16 (R-041 tier assertion).

## Session 29 — `ai-limits-smoke.mjs` (9 assertions)
Verified non-vacuous by removing one of the two `recordLimits` calls. Suite 99/99.

## Session 29 — two more suites, and one honest test change
`import-columns-smoke.mjs` (11) and `ai-free-models-smoke.mjs` (9).
`ai-provider-smoke`'s "spent free tier falls through" counted EVERY fetch; the
OpenRouter catalogue lookup is a fetch but not an attempt at the answer, so the
mock now counts generation requests only. The assertion's intent (2 providers
tried) is unchanged. Suite 101/101.

## Session 29 — `lead-fill-smoke.mjs` (10)
Verified non-vacuous: letting the fill overwrite a non-empty field turned two assertions red. Suite 102/102.

`import-columns-smoke` 11 → 16 and `lead-fill-smoke` 10 → 11: the owner's real
"LinkedIn URL" rows (Indeed / Glassdoor / LinkedIn jobs) must land in `jobUrl`.
Verified by reverting `valueField` — 3 of the new tests fail. Suite 102/102.

## Session 30, round 2 — fixed the one test D-0034 broke, 105/105 clean

D-0034 moved lead visibility to the SERVER (`GET /jobs` now returns only what
`services/ownership.js` `scopeLeads` allows — `public/js/02-state.js`
`getMyJobs` no longer re-filters client-side). That left
`test/team-structure-smoke.mjs`'s "Individual dashboard shows real leads (own
jobs only, not j4)" step testing a boundary that had moved out from under it:
it injected a foreign-owner job (`j4`, `created_by: 'someone-else'`) straight
into `STATE.jobs` and expected the dashboard to filter it client-side — a
browser-side filter is exactly what D-0034 says is not a boundary.

Fixed by changing what the fixture represents: `STATE.jobs` now holds only
Ora's own three leads (no `j4` at all), i.e. what the server would actually
have handed her, and the step asserts the dashboard renders real lead data
(not the dead `STATE.leads` seed) rather than re-proving the ownership
boundary. A comment in the test points at `test/scope-jobs-smoke.mjs` as where
the "never a foreign lead" guarantee now actually lives (it drives the real
`GET /jobs` route + `scopeLeads`). Did not touch `public/js/*` or `routes/*`.

Ran `test/team-structure-smoke.mjs` alone (20/20) then the full `npm test`
(background job, log written to a file and grepped for the summary line, never
piped to `tail`): **105/105 suites passed, exit code 0.**

## Session 30 — D-0034 visibility work pinned (C-0027 answered, C-0018 closed), 105 suites

The owner's report (D-0034): BD Lead 1 owned 25 leads and saw 49; every user
saw all 119 outreach emails. Six territories landed the fix
(`services/ownership.js`'s `viewScope`/`canSeeLead`/`canSeeEmail`/… plus every
route that now calls them). This session turned that into committed tests that
FAIL when the leak comes back, rather than scratch harnesses that evaporate
with the session that wrote them.

**Three new suites + one extended, 105 suite files total (was 102 per the last log entry, +3 new
files +1 extended file; `test/scope-jobs-smoke.mjs`,
`test/scope-emails-warmup-smoke.mjs`, `test/scope-outreach-pickers-smoke.mjs`
are new, `test/ownership-smoke.mjs` grew from 37 to 69 assertions):**

* **`test/ownership-smoke.mjs`** (69, was 37) — added rampart's exact
  32-assertion D-0034 fixture (the live org shape: BD Lead 1's 25-of-59 leads
  and 56-of-119 emails, reproduced with the owner's own numbers rather than
  rounded stand-ins) plus **all six mutations C-0027 named**: pool shown to
  every role, email sight granted via a lead's creator, no-user-id failing
  OPEN, `role` read before `roles[]` (disagreeing with
  `middleware/authorize.js`'s `hasRole`), a manager seeing every assigned lead
  org-wide instead of just their chain, and `bd_lead` added to `POOL_ROLES`.
  Each mutation is a hand-written LOCAL reimplementation of the real function
  carrying exactly that one bug — the shipped `services/ownership.js` is never
  touched — and the assertion is that the mutation FLIPS the real, already-true
  assertion above it. All six flip. This is what "including the mutations in a
  committed suite" means for a pure function: not re-running the source file
  edited-and-restored (which cannot survive being committed), but pinning the
  BEHAVIOUR the mutation would break.
* **`test/scope-jobs-smoke.mjs`** (14, new) — `GET /jobs`, `GET /jobs/:id`,
  `GET /jobs/export` through the REAL `routes/jobs.js` router, the REAL
  `hierarchy.js` chain walk, and a real `@supabase/supabase-js` client
  answered by a tiny in-memory PostgREST interpreter. A BD Lead sees exactly
  self+chain (25 of a 59-lead org, never a SIBLING BD Lead's 24-lead chain,
  never the pool), a plain BD sees only their own, admin sees all 59 and never
  a foreign org's lead, RA Lead sees the pool plus exactly what their own RA
  researched (35, never a different researcher's leads even when those are
  otherwise assigned within scope by coincidence — the fixture deliberately
  gives BD Lead 2's leads a DIFFERENT researcher so this isn't a fluke), and
  `GET /jobs/:id` answers 404 (never 403, never leaking existence) for a
  same-org-but-out-of-chain id as well as a cross-org one, including for admin
  on a foreign org. Verified non-vacuous: nulling the chain lookup (simulating
  "reporting chain not applied") flipped 3 of 14 assertions red; restored.
* **`test/scope-emails-warmup-smoke.mjs`** (50, new) — adapted from harbour's
  C-0023/C-0015 scratch proof, kept close to verbatim because the fixture and
  every stub trick in it cost real debugging time to find (the same reasoning
  CLAUDE.md gives for the candidate-outreach drip test). Drives `GET /emails`
  (+`?mine=1`, `is_mine`, `can_retry` — a report's failure is never
  retryable-looking on a manager's own screen), `GET /emails/sender-summary`
  (counts only — asserts no subject/body/address/`@` anywhere in the payload),
  `GET /emails/pending-summary`, `DELETE /emails/:id` (404 for a stranger, 403
  — row kept — for a manager who can SEE but not touch a report's email),
  `POST /admin/emails/purge-pending` (scoped to the caller's org even for
  `all_managers`), `POST /emails` (mark-sent refuses a foreign lead/contact by
  404, stamps the caller's org on success), `GET/DELETE /suppression`,
  `/analytics/templates` (RA Lead gets the counts, never a BD's letter as the
  sample), `/admin/deliverability`, and the warm-up mailbox/thread endpoints
  — including a historic cross-org warm-up partner's address being withheld
  while the rest of that thread row still renders.
* **`test/scope-outreach-pickers-smoke.mjs`** (35, new) — adapted from
  observatory's C-0024 scratch proof. `GET /outreach/recipients` and
  `/outreach/company-contacts/:id` scoped per viewer across 7 roles, **and the
  exact case this job's brief asked for by name**: 30 contacts on a
  colleague's lead are seeded FIRST in fetch order so a limit spent before
  filtering would eat every slot, and the caller's own single visible contact
  (sitting behind all 30 invisible ones) must still come back — it does.
  `POST /outreach/send` stamps the sender as the new lead's owner;
  `POST /outreach/convert-lead` is 404 on a colleague's token or tracking-row
  id and 201, owned by the caller, on their own.

**`test/org-scoping-guard-smoke.mjs` was stale on `main` (10/13, three real
drift failures) and is fixed, per the four specific asks:**
* **KNOWN_DEBT refreshed** against the live scan: removed harbour's 15 fixed
  lines (11 `deliverability.js` + 4 `emails.js`), gateway's 5 `companies.js`
  and 3 (not 2 — verified against the live scan rather than trusting the
  job's own count) `jobs.js` lines, and guild's 6 `workflows.js`/`lookups.js`
  lines — every removal checked against `findUnguarded()` actually not
  flagging it any more, not assumed.
* **The handler-splitter bug**: `/\nrouter\.[a-zA-Z]+\(/` required zero
  indentation, so `routes/warmup.js` (handlers wrapped one level deep inside
  `module.exports = function(ctx){…}`) collapsed into ONE unsplit block and
  was **never actually scanned** — indistinguishable from "scanned and clean"
  in the output. Now `/\n[ \t]*router\.[a-zA-Z]+\(/`. This is the same
  vacuous-guard shape CLAUDE.md already has three entries for: a check that
  cannot take its measurement passed anyway.
* **`orgStamp(` added as an accepted guard** alongside `withOrg(` — without it
  the scanner flagged `routes/wf.js`'s `POST /wf/definitions` (which the
  C-0022 fix already stamps correctly via `...orgStamp(req)`) as unguarded, a
  false positive that would have sat in KNOWN_DEBT forever looking like real
  debt.
* **The two microsoft.js/gmail.js OAuth-callback lines are now marked
  DELIBERATE** with the reasoning inline: those routes run pre-authentication
  (no `req.user`/`req.orgId`), and the org check is a comparison of two
  fetched values (`stateUser`'s org vs. `slotForOrgCheck`'s org) rather than a
  filter clause — a real gap in what this regex can see, not in the route.
* **The "catches the original bug" assertion** used to point at
  `routes/emails.js`, which is now fixed — so the assertion had quietly
  degraded into "this file doesn't happen to trip the regex today", which
  proves nothing about the regex. Replaced with a synthetic bad/good fixture
  pair (`fs.mkdtempSync`, cleaned up after) that proves the scanner still
  flags an unguarded `supabase.from('contacts')` read and still stays quiet
  once it carries `withOrg(`.
* **Fixing the handler-splitter widened the scan** into files the OLD, narrower
  scanner had never looked at at all: `candidate-outreach.js` (3 lines),
  `gmail.js` (7, mirroring `microsoft.js`), `lead-sources.js` (1, resolved
  immediately by the `orgStamp(` fix), `sso.js` (1), `warmup.js` (1). None of
  this is new debt from this session's D-0034 work — it was always there,
  unmeasured — but it is not foundry's to fix (`routes/*.js`). **Raised as
  C-0030** to gateway/harbour/guild rather than touched.
* Verified non-vacuous twice: appending a genuinely new unguarded
  `supabase.from('contacts')` read to `routes/jobs.js` turned the "no NEW
  unguarded call" assertion red (restored after); the synthetic fixture pair
  above is itself the non-vacuous proof for the "catches the original bug"
  replacement.

**C-0018 closed** — all four items were already done by whoever landed the
fixes (found while auditing for C-0027, not fixed by foundry): `test/authorize.mjs`
already carries the corrected `canTouchJob` assertions, and its four numbered
asks are exactly `test/org-scoping-guard-smoke.mjs`'s four sections (refreshed
above) plus C-0030 for the newly-surfaced debt. `test/helpers/enter-app.mjs`
already had `bd_lead`/`director`/`associate_director` (closed by foundry itself,
2026-09-09, per this file's own earlier log entry).

**One real, minor finding for harbour, not fixed (routes/emails.js:131).**
Mutation-testing `routes/emails.js` against `test/scope-emails-warmup-smoke.mjs`
caught 16 of 17 hand-reintroduced bugs; the one MISS was removing the final
`allData = own.scopeEmails(allData, jobsById, scope);` gate at line 131 while
leaving the SQL narrowing (`if (senderIds) query = query.in('sent_by',
senderIds);`) and the `emailsOnOwnedLeads()` secondary fetch (which is already
restricted to jobs owned within scope) both in place. In the current code both
of those upstream queries already narrow correctly on their own, so removing
the final predicate is currently a REDUNDANT line, not a live hole — this
harness's fixture could not distinguish "belt" from "belt and suspenders."
Flagging it because CLAUDE.md is explicit that a defence with only one layer is
how a future refactor of either upstream query (e.g. widening
`emailsOnOwnedLeads`'s job filter) would silently become exploitable with no
test catching it — the line at 131 is the ONLY thing that would still be
correct if that happened, and it should stay.

**Ran, not the full suite** (per this job's explicit instruction — surface is
mid-edit on the frontend): every new/changed suite individually, plus
`node test/run-all.mjs ownership scope org-scoping` (6/6) and
`node test/run-all.mjs scope-outreach` (1/1) to confirm auto-discovery via
`test/run-all.mjs`'s glob (no manual registration needed — it globs
`test/*.mjs`). Did not run the Playwright suites or `npm test` as instructed;
the orchestrator runs the full suite once surface lands. Did not touch
`routes/`, `services/`, or `public/js/` — every finding above is reported to
its owning territory rather than fixed here.

## 2026-09-24 — Rampart's two do-not-ship blockers, both now pinned (107 suites)

Rampart's review found two real defects that **105/105 passed with both fully
present** — the fourth and fifth times a green suite here has proven nothing
about a specific fault, not the first. Both are already fixed and committed
(`fb3658b` Gateway, `1671962` Guild); this session's job was to make sure
neither can come back silently.

**1. `test/email-attachments-smoke.mjs` (8 assertions, new).** The C-0022
org-scoping edit deleted `MAX_EMAIL_ATTACH_BYTES` from
`routes/recruiting/outreach.js` while `resolveEmailAttachments` still read it
inside a per-document `try/catch` — every lookup threw `ReferenceError`, was
swallowed, and every attachment silently vanished from candidate/client
emails with no error anywhere. Drives the REAL `POST /candidates/email`
handler (not a reimplementation) through a real express app + a real
`@supabase/supabase-js` client on a fake-fetch PostgREST interpreter, with
`supabase.storage.from().download()` stubbed to real bytes; asserts a real
attachment object (filename, and content that round-trips byte-for-byte)
reaches the send call, and that a document belonging to a **different org**
never comes back — not even by filename.
**Verified non-vacuous twice:** deleting the constant again dropped 4 of 8
assertions to FAIL (empty attachments array); removing the `orgId` filter on
the document lookup made the foreign-org document surface with its real
filename and bytes attached, failing the leak assertion while everything else
still passed — i.e. the guard catches EITHER fault on its own, not just both
together. File restored after each, `node --check` clean.

**2. `test/email-history-scope-smoke.mjs` (12 assertions, new).**
`GET /email/history`'s "leads" source must apply `canSeeEmail` (sender's
scope, OR the lead's CURRENT `assigned_to_bd` owner's scope) as its FINAL
gate over the merged rows — never `canSeeLead`'s wider "created it / was
assigned to research it / pool" rule, which is exactly the C-0021 finding #2
this file's own header comment already names. Fixture: an RA who created a
lead now owned by a BD, an RA Lead managing that RA, the owning BD, the BD's
manager, and admin — real router, real `hierarchy.js` chain walk, fake
PostgREST. Confirms: **the RA who only created the lead sees zero of the BD's
email on it**; **the RA Lead sees zero BD email both on that lead and on a
pool/recycled lead** (assigned_to_bd null) that the same RA created; **the
owning BD and their manager still see it**; **admin sees all**.

**Mid-task addition, addressed before finishing:** the coordinator flagged
rampart's R1 — `LEAD_SELECT` in `routes/email-history.js` omitted `sent_by`,
so a BD lost sight of their OWN sent email the moment its lead was
reassigned or recycled, because the SQL projection itself never returned the
column `canSeeEmail` needs to say "I sent it." Added a fourth job/email pair
(a lead **reassigned to a different BD, not just released to the pool**) and
a dedicated assertion, and — the more general fix — **the fake db now
PROJECTS every returned row to exactly the columns the route's own
`.select(...)` string names**, the same way real PostgREST does. Before this
the fixture returned full objects regardless of the select string, which is
exactly the shape of bug that would have hidden R1 from this suite too: a
column silently missing from a SQL select is invisible to a fake db that
doesn't enforce projection. Confirmed R1 was already fixed on disk
(`LEAD_SELECT` already carries `sent_by`, Gateway's fix landed mid-task) —
12/12 clean.

**Both suites verified non-vacuous by reintroducing the exact bug named in
the brief and watching the right assertions fail, then restoring:**
- deleting `MAX_EMAIL_ATTACH_BYTES` → 4/8 (attachment-content assertions)
- removing the document org filter → 6/8 (the leak assertion, specifically)
- removing `sent_by` from `LEAD_SELECT` → 7/12 (every "sender still sees
  their own email" assertion, including the new reassignment case)
- swapping the final `own.scopeEmails(...)` gate for a `canSeeLead`-based
  filter → 7/12 (a DIFFERENT 5 assertions fail than the `sent_by` case, for a
  reason worth recording: `ownedJobMap`'s jobs query only selects
  `id,assigned_to_bd`, so a `canSeeLead` check run against those rows can't
  even see `created_by` — the swap breaks senders seeing their OWN mail too,
  not just the intended leak. A test that only checked "does the bug leak"
  would have missed that this particular wrong-predicate swap fails
  **differently** than expected; asserting the full set of positive AND
  negative cases is what caught it either way.)
File restored and `node --check`ed clean after each reintroduction.

Ran the full suite (background job, logged to a file, grepped for the summary
line, never piped to `tail`): **107/107 suites passed, exit code 0.** No
`[FAIL]` lines in the log. Did not run Node 26 this round (no parsing/binary
path touched — both new suites are pure Node + in-memory fakes, no file I/O
beyond requiring source). Did not touch `routes/`, `services/`, or
`public/js/` — both fixes were already landed by gateway/guild before this
job started.

## 2026-09-24, round 3 — R-047 take-over requests: 3 new suites, 1 known-failing (gateway mid-flight)

D-0036/D-0037/D-0038 (take-over requests: `services/ownership.js`'s
`recordOwnerId`/`canRequestTakeover`/`approverFor`/`canDecide`/`canCancel`/
`takeoverTransition`, `routes/ownership-requests.js`, migration 047's
`ownership_requests` table — 44th tenant table) landed from gateway/deep/guild.
This job turned two scratch harnesses into committed suites, added the checks
the brief named that neither harness had, and verified every one of the
requested mutations by reintroducing the real bug in the real source and
watching the right assertions fail — never by re-deriving the logic locally.

**`test/models-smoke.mjs`**: `TENANT_TABLES.size` 43 → **44**, plus an explicit
`TENANT_TABLES.has('ownership_requests')` assertion.

**`test/takeover-rule-smoke.mjs` (new, 86 assertions)** — the PURE rule, no
database, no server. Adapted near-verbatim from rampart's scratch review
(`recordOwnerId`/`clientOwnerFrom`/`canRequestTakeover`/`approverFor`/
`pickAdmin`/`canDecide`/`canCancel`/`takeoverTransition`; 83 cases, confirmed
83/83 against the shipped file before converting). Added one embedded
mutation: a hand-written `approverFor_WRONG_askersManager` that routes a
cross-team request to the ASKER's manager instead of the OWNER's — the exact
shape D-0037 explicitly rejected — and asserts it disagrees with the shipped
answer on a real case (bl1 vs bl2). Convention matches `ownership-smoke.mjs`:
the mutation lives in the committed file as its own assertion, not as a
transient edit-and-restore that evaporates with the session.

**`test/ownership-requests-smoke.mjs` (new, 36 assertions)** — the database/
route half, adapted from gateway's scratch harness (kept close to verbatim;
the fixture and the fake-postgrest QB cost real thought). Drives the REAL
router + `services/ownership.js` + `models/index.js` + `hierarchy.js` against
a tiny in-memory fake that PROJECTS every row to the columns the route's own
`.select(...)` names. Covers: the duplicate-email door (same-team and
cross-team, D-0038), identical `not_found` for a genuinely-unrelated ask,
unowned → asker's manager, a manager asking for a report's lead → the
deterministic admin, duplicate-ask 409, `mine`/`waiting` boxes, wrong-decider
403, approve moving the lead (and re-picking or clearing its sending mailbox),
re-decision refused, decline leaving the record untouched, only the requester
may cancel, and the client take-over moving a job order + a lead while
leaving a DIFFERENT owner's lead at the same company alone. Added beyond the
harness (per this job's brief):
* **The body-can't-set-the-flag check, driven behaviourally, not by grep.**
  `viaDuplicateEmailMatch` sent directly in a GET query string or a POST body
  — with no matching (or no) `via_email` — must still answer `not_found`.
  Verified non-vacuous: temporarily made the route trust
  `req.body.viaDuplicateEmailMatch` directly and re-ran — both assertions
  flipped (a stranger's take-over request was created with no verified email
  match); restored, `node --check` clean.
* **A mutation proving the DB-level conditional-update race guard matters,**
  built as an ISOLATED fixture with its own users/jobs/app/server (never
  touching the shared one) whose fake `ownership_requests` UPDATE silently
  drops an `.eq('status', …)` filter — simulating the guard's removal — plus a
  hand-rolled BARRIER that forces both concurrent approvals' `loadOwnRequest`
  read to land at the exact same instant (a fast synchronous fake db can
  otherwise let one request finish entirely before the other starts, which
  proves nothing about a guard meant for a genuine network race). Confirmed
  the barrier itself isn't what causes the double-success — ran the SAME
  barrier against the REAL guarded QB in a throwaway script first and it still
  correctly produced exactly one 200/one 409; only the no-guard mutation
  produces 200/200.

**All four mutations named in the brief verified by reintroducing the real
bug in the real source file, watching the right assertions fail, then
restoring (`git diff --stat` clean, `node --check` clean, after each):**
| bug reintroduced | file | result |
|---|---|---|
| `approverFor`'s owner branch reads `managerOf(requester)` instead of `managerOf(owner)` | `services/ownership.js` | 10/86 fail in takeover-rule-smoke; ownership-requests-smoke crashes outright (a downstream assertion dereferences an approver that no longer exists) |
| body-supplied `viaDuplicateEmailMatch` trusted directly | `routes/ownership-requests.js` | 2/36 fail (a stranger's request is created with no real email match) |
| `.eq('status', 'pending')` dropped from the approve/decline/cancel UPDATE | `routes/ownership-requests.js` (simulated in an isolated test fixture, not the real file — the real file was never edited for this one since the fixture reproduces the exact removed line) | both concurrent approvals return 200 instead of 200/409 |
| client take-over's lead query drops `.eq('assigned_to_bd', oldOwner)` | `routes/ownership-requests.js` | 2/36 fail — the OTHER owner's lead at the same company gets swept up too |

**`test/reminder-lead-visibility-smoke.mjs` (new, 15 assertions)** — R-047 B2
(mid-session addition from the coordinator, ledger's scratch check). Pins
`reminderEmbedFor` (pure, exported from `routes/reminders.js`): a reminder's
embedded lead/contact is kept only when the lead is in the caller's org AND
in view scope (`canSeeLead`, D-0034) and the contact hangs off that same
lead — own lead, cross-org, out-of-scope, contact-on-a-different-lead,
contact-with-no-job, company-in-a-different-org (lead kept, company nulled),
admin exception, and a plain manual reminder (no lead at all) never reads as
withheld. Plus `POST /reminders` driven through the real router with a fake
db: a lead the caller cannot touch, or a contact in a different org/lead,
both answer the identical 404; a touchable lead, a lead derived from the
contact alone, and a manual reminder with no lead all still work. Verified
non-vacuous: commented out the `canTouchJob` gate and re-ran — 14/15
(job `j9` created a reminder with no check); restored, `node --check` clean.

**Open, per the coordinator's explicit instruction — do NOT resolve without
a fresh go-ahead:** gateway is mid-flight changing the take-over API while
this job was running (`routes/ownership-requests.js` uncommitted, live diff
seen): `GET /ownership-requests/can-request` → `POST` (query strings must
never carry a prospect's email, per L3), and the duplicate-email door now
resolves a lead from `via_email` alone with **no `record_id`** at all
(`resolveLeadByEmail`), plus `reassignLead`'s write became conditional on the
live owner (M1 round-2 fix) and returns whether anything actually moved.
`test/ownership-requests-smoke.mjs` was written against the PRE-change API
(`GET` + `record_id`-required `POST`) and now fails outright
(`SyntaxError: Unexpected token '<'` — the GET hits Express's 404 HTML page,
not a JSON one) — **this is the one known, expected failure in the 110-suite
run below, not a regression to chase.** Full suite: **109/110**, the single
failure being exactly this. Do not touch `ownership-requests-smoke.mjs` again
until the coordinator confirms the new API has landed and is stable; the
pure-rule suite (`takeover-rule-smoke.mjs`, 86/86) and the reminder suite
(15/15) are both independent of this and unaffected.

Ran both new/changed suites individually, then the full `npm test` twice
(background jobs, each logged to a file, grepped for the summary line, never
piped to `tail`; the second run added `reminder-lead-visibility-smoke.mjs`,
which hadn't existed when the first run started — **109/110** both times,
same single expected failure). Did not touch `routes/companies.js` or
`tmp_gateway_oreq_scratch.mjs`, both of which appeared mid-session as
gateway's own in-flight work. Did not commit anything, per instruction.

- 2026-09-25: +`send-hours-smoke.mjs` (15: runs the real `getSendWindowHours` extracted from index.js against an in-memory app_settings; route refusal; Playwright popup). Verified non-vacuous: the old reader (plain keys) fails "what an admin saves is what the send loop obeys". Lesson re-learned: my first reintroduction crashed on a missing variable and printed no SUMMARY — a crash is not a demonstration; write the old code out properly.

- 2026-09-25: +`posting-and-company-cap-smoke.mjs` (24: pure posting rules; the REAL /jobs/:id/posting handler with an in-memory db; cap decision + loader run on fake tables; send-loop placement by source order). Non-vacuous: `>=`→`>` in the cap fails "a third contact waits"; removing the route's permission check fails "a BD who does not work this lead cannot change its posting". lead-intel-ui-smoke now 15 (+3 posting box, incl. zero render()).

- 2026-09-26: +`mailbox-alerts-smoke.mjs` (22: rule + live AADSTS65001 sentence; Gmail refresh recording with a stubbed fetch; the real route with scope/org/held) and +`mailbox-alerts-ui-smoke.mjs` (12, Playwright, 1440 + 390px, not-polled check). Non-vacuous: removing the Gmail failure record fails 1; reading `user_emails` without `db.forRequest` fails 2 (another org's mailbox appears). My first "fetched once" assertion was a miscount (4 is right: app open + reset + two forced reloads) — replaced by the real question: idle time and repaints fetch nothing more.

- 2026-09-26: client-intel-routes-smoke now 49 (+11 digest: owner view with their summary line; manager's team view facts-only; no AI; off reads nothing). Non-vacuous: pushing the raw item into the team roll-up fails the D-0040 check. +`client-digest-ui-smoke.mjs` (11, Playwright, 1440 + 390). A screenshot, not a test, caught "You haven't replied" shown to a manager about a report's thread — now asserted.

- 2026-09-26: +`stage-history-reports-smoke.mjs` (10: runs `/reports/recruiting` + `/recruiting-dashboard` from analytics.js with an in-memory db; non-vacuous both ways — counting by current stage again fails 3, reading history without `withOrg` fails 6). submission-stages-smoke now 50 (+16). reports-smoke now 14: asserts the nav item is GONE, the report is on the Dashboard, an old link lands there, the Time-in-stage card, and a **populated** report fits 390px — the existing phone suites never had report data, which is how a 200px overflow lived on three screens.

- 2026-09-26 (R-005/R-007): `recruiting-routes-mounted` gained a RETIRED list (two `/bd-analytics/*` paths must 404) — 9 checks, verified non-vacuous by restoring the handlers (7/9). `backend-smoke` 108: `/ai/generate-email` now expected 404, plus a 401 check that `/ai/generate-summary` beside it is still mounted (so the 404 can't come from routes/ai.js failing to mount). `reports-smoke` stub now carries `client_submissions`; SHOTS captures the whole report (viewport grown for the capture).

- 2026-09-26 (R-030/R-031/R-048/C-0029): new `integration-test-honesty-smoke` (12, browser), `lookups-per-org-smoke` (10, real handlers + migration text), `client-docs-ownership-smoke` (15: real `GET /clients` + browser drawer); `ai-provider-smoke` 71 (+6: hints derived from PROVIDERS, through the real route; config carries no model names), `ai-free-models-smoke` 15 (+6 music/per-request/cache-version). Every new check was run against the pre-change code and failed there. Note: in-memory fakes here do NOT project to the select list — "created_by not leaked" is only meaningful on the new code path.
- 2026-09-26: `overlay-opacity-smoke` 14 (+4: record drawer panes rendered AND opaque, dark + light). Found by looking at a screenshot the suite was green on — the fifth "green suite, broken screen" in this repo.
- 2026-09-27: +`storage-orphans-smoke.mjs` (23) — each deletion guard alone; runner over a fake bucket + db incl. a live candidate past row 1,000 (paging) and failed read/list/delete all deleting nothing. Mutation-tested: 5 separate breaks each fail it.
- 2026-09-28 (R-069): +`send-recovery-smoke.mjs` (58, part 4 is Playwright). Real `services/gmail-delivery.js` against a fake Gmail AND the real `gmail-provider.js` against a fake Google (global fetch stubbed; `http-client` reads `globalThis.fetch` at call time) — the raw MIME Google receives is decoded and checked; `services/interrupted-sends.js` over an in-memory table incl. a row that turns 'sent' between the read and the write; the REAL `routes/emails.js` + `models/` for the four pending buckets across two orgs (settings + router `require.cache` cleared per boot so a stored limit is read, not a cached default). **15 deliberate breaks, 15 caught** — after two test fixes: (1) a mutant that made a follow-up THROW crashed the suite instead of failing a check → every `deliver()` now runs through `attempt()`; and the fix to THAT crashed again, because **a destructuring default (`{ r = {} }`) does not apply to `null`** — `attempt` returns `undefined` on a throw. (2) the wiring check only looked for `createGmailDelivery(` in `deliverViaGmail`, so putting the old inline reply back beside it passed; it now requires the function's single `return` to be the module's answer.

> **STOPPED MID-RUN — Session 34 (2026-09-29), written by the orchestrator:** the owner stopped this run at ~17:10 UTC, before any assertion was proven against its break and before the baseline full run finished. Saved as WIP (not for merge): `test/helpers/fake-postgrest.mjs` (a shared in-memory PostgREST, strict like the real one) and `test/helpers/schema-from-migrations.mjs` (the schema folded out of `migrations/*.sql`), each with its own smoke; `pipeline-tag-membership-smoke` rebuilt on the REAL core (+`rpc` for `next_id`, a `bd` user) — C-0034 item 1, not yet re-run; and **a real find:** three tree-scanning suites (`ai-provider-smoke`, `route-shadowing-smoke`, `sender-identity-smoke`) also scanned `.claude/worktrees/<id>/`, an agent's whole second checkout, and `sender-identity-smoke` failed a green tree on it — they now skip `.claude/`. Everything else in the 17:05 brief (archive) is still to do.

- 2026-10-01: +`resume-first-smoke.mjs` (20: patient reader, endpoint incl. inline-vs-attachment, drawer in a real browser), +`needs-you-today-day-smoke.mjs` (9, two time zones), +`email-cc-chips-smoke.mjs` (13), +`job-candidate-search-smoke.mjs` (12). Each was run with its fix reverted and failed. Lesson (again): a guard on "Send keeps the last typed address" passed with the fix removed because a repaint blurred the input and committed it by accident — assert on a callable the test can spy on, not on a side-effect that has another cause.

- 2026-10-01: +`insights-timezone-smoke.mjs` (11: pure windows/summarise in UTC / Los Angeles / Kolkata at one pinned instant, both routes honour `?tz=`; Date is pinned so it holds on any day) and a zone step in `insights-screens-smoke` (14). Both fail with the zone ignored.

- 2026-10-01: +`insights-ra-team-smoke.mjs` (13: pure calculation in UTC and Kolkata at a pinned instant, both routes incl. scope, and the table in a real browser fed a server row that contradicts the jobs the browser holds). Fails with the week rule or the drawing broken.

- 2026-10-01: +`interview-timezone-smoke.mjs` (13, browser set to Kolkata, NY summer/winter, Auckland) and 4 zone steps in `from-mailbox-smoke` (21); +`ooo-return-smoke.mjs` (15: pure rule, the real sweep over a fake table incl. a status changed between read and write, a failed read, and 1,234 rows across pages — which caught a skipping-pages bug). Reverting the conversion / the zone / the paging each fails them.

- 2026-10-01: +`submission-email-smoke.mjs` (30: the words, the server rules incl. foreign document / foreign mailbox / foreign org / role, and both windows in a real browser incl. "a failed move sends nothing"). A fake-db detail worth keeping: the fake must honour `.limit()` or "latest résumé" returns everything.

- 2026-10-01: +`top-three-complete-smoke.mjs` (12: both lists show three, See all, tick posts the right item, a failed tick un-ticks, a reminder is DONE not snoozed) and 4 completion steps in `client-intel-routes-smoke` (53: the row carries its item, a completed conversation leaves, comes back when they write again, per person). Reverting the cut or the wiring fails them.

- 2026-10-01: +`followup-sender-smoke.mjs` (15: pure rule, the real resolver over a fake db — handed-over lead, Gmail, gone/off/already-right mailbox, explicit choice, first email/reminder, failed read, 450 follow-ups across pages).

- 2026-10-01: +`viewer-day-ui-smoke.mjs` (11, two browsers in different zones, the clock pinned) and steps in `stage-history-reports-smoke` (+3), `insights-timezone-smoke` (+2: `/stats`), `insights-ra-team-smoke` (+3: periods). Lesson kept: when a route's fixtures change meaning (a "this month" fixture), pin `Date` rather than depend on the day the suite runs.

- 2026-10-02 (R-107): `import-columns-smoke.mjs` grew to 23 — behaviour tests for `ImportColumns.checkContacts` using the real shifted sheet (job title in Email, address in Phone), proven to FAIL with the check removed, plus wiring pins on the preview warning, the Import confirm and the `invalidEmails` result line. Open: `needs-you-today-day-smoke` fails on a clean checkout from 2 Oct (pins 1 Oct, the card reads the real clock) — R-108, pin `Date`.

- 2026-10-02 (R-109): `sent-side-smoke.mjs` 31 — date-only join, UTC-day edges, a different day/subject/person/"Re:" NOT joined, exact message id, the half-hour rule not loosened, end-to-end reader, and both date formatters under a Chicago clock; verified to FAIL on the old code (6 failures reproduce the owner's screenshot: the extra row and "01 Oct").

- 2026-10-02 (R-110): `open-tracking-smoke.mjs` (45) — the rules, the DB side against a fake, the pixel over real HTTP, wiring. Verified by removing the sender check, the early rule, and the route's use of `recordOpen`: 9, 2 and 3 steps fail. `sent-side-smoke.mjs` part 3 (timeline carries opens; null when untracked; no token/message id leaks) and `lead-intel-ui-smoke.mjs` (the chip text per row, read from the DOM) extended.

- 2026-10-05: `gmail-preview-entities-smoke` (12) and `mailbox-thread-size-smoke` (15, real browser, desktop + phone, takes `MAILBOX_SHOT_DIR` screenshots) added, each shown failing on the old code. R-108 (main numbering): `needs-you-today-day-smoke` read the REAL clock as well as its pinned NOW, so it failed 3/9 from 2 Oct; the page's `Date` is now pinned in the test (9/9). The résumé/search checks for the owner's "still not working inside a job" report (`resume-first-smoke` 20, `job-candidate-search-smoke` 12) pass — it was a stale browser tab (R-113); a new-version notice is offered as R-116.

- 2026-10-05 (R-114 stage 1): four new suites — `contact-points-smoke` (30, the pure rules), `candidate-contact-points-routes-smoke` (33, the real candidates router over the in-memory PostgREST incl. another company's candidate never matched and the opt-out refusal), `candidate-outreach-optout-smoke` (12, the real queue / drain / one-off email routes), `contact-points-ui-smoke` (33, real browser: Add, résumé offer, duplicate card, Edit, header live saves, browser-vs-server swap parity, phone overflow + 36px targets, screenshots via `CP_SHOT_DIR`). Every safety rule was BROKEN ON PURPOSE and its test failed: duplicates ignoring extras, no opt-out check on make-main, queue/drip/one-off checking only the main, a write wiping unsent extras (this one first slipped past the route test — a case was added), résumé extras added silently. Lesson: a full-window redraw races any scroll/focus restore; edit the block in place.

- 2026-10-05 (R-114 stage 2): `test/helpers/fake-postgrest.mjs` now supports `.contains(col, [..])` (PostgREST `cs`: the jsonb list holds every value asked for; NULL/empty never match; 3 steps in `fake-postgrest-smoke`, 70). New suites: `lead-contact-points-routes-smoke` (30: the real contacts + jobs routers over the real models layer — extras, the 400 sentences, "already added" on any address, the opt-out refusal, the invalid-mark reset, the shifted-sheet import and what it reports; DNS stubbed so no network), `lead-contact-cp-ui-smoke` (16, real browser), `contact-points-smoke` grew to 43 (phones, tidy, send-time), `import-columns-smoke` to 29. Six rules broken on purpose, each failed its test. NOT covered by a mounted test: the leads send loop `processPendingEmailSends` (inside `index.js`) — its rule is the pure `suppressedFor`.
