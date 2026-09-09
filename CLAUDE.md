# PACE — project memory (read me first, every session)

> **This section is not optional and must be carried into every context window / handoff.**
> If you are summarizing this project for a future session, copy the two sections
> below ("Who I'm working with" and "What we're building") verbatim.

## Who I'm working with

The owner is the **product owner and the end user** — not an engineer.

- They **do not read code** and **do not use git/GitHub**. Never ask them to review a
  diff, read code, resolve a merge, mark a PR ready, or operate GitHub. That work is
  mine, fully.
- They evaluate the product the way a customer would: **by using it** — does it look
  right, feel right, make sense, and actually work? So the things I hand them are the
  **running app, screenshots, and plain-English explanations** — never code.
- **My role is everything behind the system:** coder, planner, architect, tester,
  release engineer. I own the branches, PRs, and (once they've approved a change by
  reacting to it) the merge and the deploy. I confirm before doing something
  outward-facing or hard to reverse, but I don't push code chores onto them.
- I am expected to be **proactive**: after doing what was asked, suggest what else is
  worth building — product trends and high-leverage technical bets — always in plain
  language, framed as choices they can react to, not code.

**The working loop:** I build on the dev branch → I show them (screenshots / the live
app / a short summary) → they react as a user → we iterate → when they're happy, I
merge and deploy so they can use the real thing → I tell them plainly what's now live.

## What we're building

PACE is a **recruiting ATS + lead-management platform sold to other companies**
(SaaS), competitive with the established ATS products (Ceipal, Bullhorn, and the
like). Every decision is a product decision in service of that.

**PACE is the product; Fute Global is a customer.** (It was named "futé" until
Session 9, when the owner renamed it and redefined the business model: enterprises
register their email domain and their people flow in, individuals can sign up
alone, and access is gated by plan. LinkedIn was the reference — per-user
workflows plus organisation-assigned ones.) Anywhere the code still says "Fute
Global" in **outbound customer content** — cold-email templates, the resume
letterhead — that is the CUSTOMER'S identity and must become per-org
configuration, NOT a rename to PACE.

**Build philosophy: spend nothing now, scale later.** Prefer free tiers and infra we
already have. Don't add paid services unless they clearly earn it. But make the
**architecture** choices now that are cheap today and expensive to retrofit later, so
we never have to rewrite to grow (see "Growth bets" below).

---

## The stack (so it isn't re-derived each time)

- **Backend:** Node/Express — `index.js` (the **sales/lead** engine: leads, the send
  loop, follow-ups, mailbox sweeps) + `routes/*.js` + `routes/recruiting/*.js` (the
  ATS). Plus assorted `*.js` engines (mailmerge, warmup, jd-parser, resume-parser).
  - **Session 9 restructure:** `bd_recruiter_routes.js` went from 2,140 lines to a
    **43-line mounter** over `routes/recruiting/{job-orders,candidates,submissions,
    pipeline,lookups,sourcing,analytics,outreach}.js`; the helpers they share are
    built once in `services/recruiting-core.js` (+ `services/candidate-fields.js`).
    `index.js` went 3,403 → **2,868** by moving the recruiting workflow channels and
    the candidate/client email + interview endpoints into
    `routes/recruiting/outreach.js`.
  - **`routes/recruiting/*` register on `app` directly, not as mounted Routers, so
    REGISTRATION ORDER IS LOAD-BEARING** (`/job-orders/browse` before
    `/job-orders/:id`; `/candidates/check-duplicate` before `/candidates/:id`).
    `test/recruiting-routes-mounted.mjs` boots the real server and pins all 63.
  - **REGISTRATION ORDER IS LOAD-BEARING IN EVERY ROUTER, not just those.** It is
    how Express works, not a recruiting quirk: a literal path registered after a
    matching `:param` route is DEAD, and it fails silently because the param
    handler answers with a valid 200. Three were live at once until Session 19 —
    `POST /admin/integrations/ai-test` (the "Test AI generation" button, dead for
    four sessions: `POST /admin/integrations/:id` answered with the integrations
    list, the card stored that as its diagnosis, matched no branch, and redrew
    its placeholder — the button "did nothing"), `POST /admin/integrations/
    email-verify`, and `GET /jobs/export` (matched as a job with id `"export"`).
    **A new literal endpoint goes ABOVE the `:id` routes of its own prefix, never
    appended to the bottom of the file.** `test/route-shadowing-smoke.mjs` scans
    every router in the tree and fails the build on any shadowed literal.
- **Data access: use `models/` — do NOT hand-write `supabase.from()` on tenant
  tables.** `db.forRequest(req).from('candidates')` scopes to the caller's org by
  construction; `db.global.from(…)` is for the 7 tables with no `org_id`;
  `db.crossOrg(…)` is the named, greppable escape hatch. Anything else throws.
  This exists because org scoping used to depend on remembering `withOrg()` on ~574
  hand-written queries, and four cross-org leaks got in that way. `models/tables.js`
  is verified against the live schema (41 tenant / 7 global) — **a migration that
  adds a table with `org_id` must add it there.** Conversion is incremental: raw
  `supabase` still works, so unconverted call sites are unaffected.
- **The OUTBOUND SEND PATH has one rule: the sender is resolved at SEND time,
  from the mailbox that actually sends.** `emails.body`/`subject` keep
  `{{sender}}`/`{{senderemail}}` in storage (queue paths pass
  `DEFER_SENDER`), because a lead's mailbox can change, or a sequence rotate
  it, between queueing and sending — baking a name at queue time is how a cold
  email went out saying "I'm Jennifer Thomas" over Prince Thomas's From line
  and signature (Session 14, 152 emails affected).
  **Therefore EVERY reader of a stored body must call `renderStoredEmail(row,
  mailbox)` first** (`email-vars.js`) — it fills subject and body together so
  a caller cannot render one and forget the other. `GET /emails` renders for
  all screens (no page knows the token exists); `deliverOutboundEmail`,
  `buildQuotedChainFromDb` and the analytics sample each render too. That
  quoted chain is why this matters beyond cosmetics: it was putting the raw
  token inside the *recipient's* own quoted message.
  `test/sender-identity-smoke.mjs` greps for every file reading `emails.body`
  and fails if one does not render.
  **Anything that PREVIEWS an outbound email follows the same rule**: the
  compose preview (Session 15) resolves `{{sender}}`/`{{senderemail}}` from the
  *selected sending mailbox*, never the logged-in user. A preview keyed off the
  session user would have rendered the correct name for the exact case above —
  hiding the bug rather than catching it. A variable that cannot be filled stays
  visible and highlighted; never blank it silently.
- **RELEASING A LEAD TO THE POOL IS ONE OPERATION, AND IT MUST STAMP
  `last_recycled_at` (Session 20).** Three paths return a lead to Unassigned —
  `POST /jobs/bulk-stage`, `PUT /jobs/:id`, the recycle sweep — and all three
  now go through `releaseToPoolUpdate()` in **`services/outreach-cycle.js`**
  (pure), which clears `assigned_to_bd`/`assigned_at`/`sending_email_id` and
  stamps `last_recycled_at`. Two failures came out of them disagreeing, and
  BOTH were silent:
  * `PUT /jobs/:id` changed the stage and left the assignment fields alone, so
    the lead read "Unassigned" on screen while still holding an
    `assigned_to_bd`. The distribution pool requires `assigned_to_bd IS NULL`,
    so those leads were **invisible to distribution** — 11 of the 11 leads in
    the live pool were in this state.
  * The duplicate-cold-email guard (`fetchInitialOutreachedPairs`) blocked on
    ANY prior non-failed initial email, for all of history. A lead that had
    ever been emailed could be re-assigned, reported as assigned, and generate
    **nothing**. The guard is now scoped to the lead's CURRENT cycle
    (`cycleStartOf`/`blocksRegeneration`), which is what `last_recycled_at`
    marks. Inside a cycle it is unchanged — regeneration still cannot duplicate
    a cold email. **A path that clears `assigned_at` without stamping
    `last_recycled_at` re-creates the second bug**, so add release logic to the
    helper, never inline. `test/outreach-cycle-smoke.mjs` pins it.
- **THE "SEND COMPLETE" CARD IS A SNAPSHOT, AND A SNAPSHOT EXPIRES
  (Session 20).** It lives in `app_settings` so it survives a restart, and the
  60s timer meant to clear it only fires while the process lives — on the free
  tier the server sleeps, so the card returned hours later still asserting
  "375 total · 164 waiting" above a pending panel reading 21. A FINISHED run
  now expires 15 minutes after `completedAt` on read (`isStaleProgress` in
  **`services/send-progress.js`**, pure); an ACTIVE run never expires. The
  admin purge (`POST /admin/emails/purge-pending`) clears the card for every
  sender whose queue it emptied — the run it describes no longer exists.
- **Send-queue ORDER is a business decision, not an implementation detail.**
  The queue drains at one email per 75-105s inside an 8-hour window in each
  lead's timezone, so whatever is at the back may not go out at all.
  `send-queue-order.js` (pure) puts fresh outreach ahead of follow-ups, with
  mailbox interleaving preserved inside each band. Do not reorder it casually,
  and never remove the `ORDER BY` from the pending fetch — it paginates with
  `.range()`, which repeats or skips rows without one.
- **KNOWN, UNFIXED (as of Session 14): a dead mailbox sign-in destroys
  emails.** An auth failure marks each email `failed` with no retry, one every
  ~90s, and `emails` has no column to record why — so `friendlySendError`'s
  correct sentence goes only to an in-memory cache and dies with the process.
  Root cause of the 31 Aug incident was Google expiring refresh tokens after
  exactly 7 days for OAuth apps in **"Testing"** publishing status. See
  `docs/CONTEXT_WINDOW.md` § "Pick this up first".
- **All outbound HTTP goes through `http-client.js`** (`fetchWithTimeout` /
  `fetchWithRetry`). Node's `fetch` has no default timeout and a hung Graph/Gmail
  socket used to stall a whole background sweep. **Retries are safe methods only** —
  retrying a `POST /me/sendMail` on a timeout would send the email twice; use
  `retryUnsafe` only where a replay is genuinely idempotent (token refresh).
- **Data:** Supabase (Postgres + storage bucket `candidate-docs`). Project
  `teiqievahzhllojvgsku`. Migrations in `migrations/`.
- **Frontend:** plain `<script>` modules in `public/js/NN-*.js`, loaded in order by
  `public/index.html`. **No build step, no bundler.** Global `window.*` + `STATE`.
  `goPage()` is wrapped by each page module.
  - **THE RENDER ENGINE WRITES ONLY WHAT CHANGED (Session 16).** `render()`
    used to be `root.innerHTML = renderApp()` — every change rebuilt the whole
    app. That is what made the screen blink: an email body lives in a sandboxed
    `<iframe>`, and re-creating an iframe reloads it and resets its scroll, so
    the unread badge ticking 24 → 23 wiped the message being read. Now the
    shell draws in **four regions** (rail, topbar, page, the `#layer` holding
    modal + drawers) and a same-page repaint rewrites a region **only if its
    html string differs from what is on screen**. Untouched regions keep their
    DOM — iframes, scroll positions, entry animations, the caret. A page
    *change* still rebuilds wholesale.
  - **A page module must NOT write `#content` itself.** It registers its
    renderer with **`UI.registerPage(name, renderFn, paintFn?)`** (the same
    idiom as `UI.registerOverlay`) and its own `paint()` calls
    **`paintPageContent()`**. Writing `content.innerHTML` directly leaves the
    shell's record of the screen stale and the flicker returns. Nine pages —
    Inbox, Clients, Candidates, Reports, My Team, Sourced Leads, All Jobs, the
    BD job pages, the pipeline — were missing from `renderPage()`'s switch and
    fell through to **"Page not found"**, which the shell wrote and the module
    overwrote a beat later; all nine are registered and a test keeps it so.
  - **Anything that must survive a repaint needs its own region.** In the Inbox
    the open message is `#mb-open`, sitting between `#mb-before` and
    `#mb-after` precisely so the thread arriving does not touch it, and the
    shorter in-thread body height is a CSS class `paint()` toggles rather than
    part of that region's html. `test/screen-stability-smoke.mjs` pins all of
    this by node identity.
  - **AN IDLE REPAINT MUST WRITE NOTHING — not even the same class back.**
    Surviving as the same element is not enough (Session 16, round 2). Setting
    an attribute always invalidates style, and a style invalidation on an
    ancestor of the message-body iframe makes the browser re-raster that
    out-of-process frame: a white flash, with the content returning identical
    and at the same scroll position. `paint()` therefore goes through
    `setClass()`, which compares before it writes, and the test asserts **zero
    MutationObserver records** for a repaint that changes nothing.
  - **A repaint on a timer is a repaint under the user's hands.** The
    send-progress poll (`11-bind-and-actions.js`) runs **every 2 seconds** while
    a send is in flight and used to `scheduleRender()` on every tick; that is
    the cadence in the owner's second recording. It now renders only when the
    payload actually changed, and only refreshes the email list while the Email
    page is open. Before adding any poll, ask what it repaints.
  - **The Inbox reading pane has ONE scroller for a one-message conversation.**
    `.mb-thread.solo` lets the body fill the pane; the pane itself does not
    scroll. Two nested scrollers meant a wheel over the message scrolled the
    text, hit its end, then jerked the whole pane — and every pane scroll moved
    a sandboxed iframe. With a real thread on screen the pane must scroll, so
    `solo` is simply not applied.
  - **Session 15 gave the app ONE layout vocabulary: `public/ui.css` +
    `public/js/00-ui-kit.js`.** Pure string builders (no state, no DOM, no side
    effects), which is why it can sit at the head of the load order. Build a
    screen with `UI.page({tabs, strip, toolbar, body})` and the parts —
    `UI.tabs/strip/toolbar/table/idCell/pill/ring/toggle/check/kv/notice/feed/
    drawer/ic` — **not another hand-rolled table**; eleven of those is how the
    app came to read as several products. The kit is scoped by `body.ui-kit` and
    overrides **only** the shell and the list/table/detail styles, so
    `.card`/`.btn`/`.bdg`/`.inp` still work and pages migrate one at a time.
    Most pages are NOT converted yet — Leads, Jobs, Clients, Reports, Admin and
    the dashboards still draw their own.
  - **A record detail is a DRAWER over its list, not a page.** Register it with
    `UI.registerOverlay(name, fn)` — by name, idempotent, because module files
    are evaluated once but wrap `render()` repeatedly and pushing blindly stacks
    duplicate drawers. `renderApp()` draws overlays after `#content`, and
    `scheduleRender()` skips a background rebuild while one is open (it would
    throw away a half-typed note). **`STATE.page` must stay untouched when a
    drawer opens** — that is the entire reason closing it returns you to the
    same list with the same filters, selection and scroll. Tab panels inside a
    drawer all render with `hidden` on the inactive ones, toggled directly
    rather than via `render()`.
  - **The rail is grouped** Work / Records / Outreach / Insight and expands on
    hover as an overlay. Nav order is no longer a flat index; de-duplicate items
    by id.
  - **THE PHONE IS A FIRST-CLASS SCREEN — `public/mobile.css` (Session 19).**
    Loaded last, after `styles.css` and `ui.css`; every rule sits inside a
    media query, so it only ever ADDS a narrow screen's behaviour. Below
    **860px** the rail becomes an off-canvas drawer behind a hamburger
    (`.tb-burger` → `toggleNav()`), `#main` loses its left margin, `#content`
    stops scrolling sideways, dialogs become bottom sheets, and paired panels
    stack. Four rules:
    * **HOVER IS A MOUSE FEATURE, GATED ON `(hover:hover) and (pointer:fine)`
      — NEVER ON WIDTH.** A touch browser fires `:hover` on tap and leaves it
      stuck, so tapping a nav item faded every label in while the rail stayed
      60px wide: "WORK", "RECOR…", "OUTRE…" sliced down the left edge with the
      nav text over the icons. The old fix reset the WIDTH under `max-width:900px`
      and forgot the opacity — and width is the wrong question anyway, since a
      900px tablet is a touch device and a 500px desktop window is not.
    * **THE MENU MUST BE A CLASS ON `<body>`, NEVER A RENDER.** `openNav()` /
      `closeNav()` / `toggleNav()` toggle `body.nav-open` and touch nothing
      else. The render engine's rule is that a repaint changing nothing writes
      nothing; a menu that re-rendered the shell to open itself would take the
      page's scroll position and reload every iframe each time somebody looked
      at the nav. The scrim (`#nav-scrim`) is drawn once by `renderApp()`
      OUTSIDE the four patched regions precisely because it has no state.
    * **`#content` IS `overflow-x:hidden` ON A PHONE, SO NOTHING MAY OVERFLOW
      IT.** That trade is what stops one wide toolbar dragging the whole page —
      but it means anything that does overflow is now CLIPPED AND UNREACHABLE.
      A wide thing must scroll in its own box (`.dt-wrap`, `.tbl-wrap`), never
      move the page. `test/mobile-layout-smoke.mjs` walks every element of 16
      pages × 5 roles at 390px and fails on anything past the content box that
      is not inside its own scroller — that test is what makes hiding the
      overflow safe, so do not weaken it.
    * **AN INLINE STYLE CANNOT BE RESPONSIVE.** A width or a grid written into
      a `style=""` attribute cannot be re-laid-out by any stylesheet, which is
      how six admin buttons ran 460px off the side and a stat tile's
      `min-width:105px` put "Awaiting approval" outside its own card. When a
      block needs to reflow, give it a class (`.dash-tile`, `.fpair`,
      `.banner-clock` all came out of inline copies this way).
    Reflow, never shrink: touch targets get BIGGER (40-44px), inputs are 16px
    so iOS does not zoom on focus and never zoom back, and text wraps rather
    than being scaled down.
- **⚠ THE SANDBOX RUNS NODE 22. RENDER RUNS NODE 26. A WHOLE CLASS OF BUG IS
  INVISIBLE HERE (Session 19).** This cost a session. Resume parsing failed in
  production and every file parsed perfectly in the sandbox — same library,
  same lockfile version, same bytes (proven: 14,241 declared, 14,241 received,
  `%%EOF` intact). The difference was the RUNTIME, and the failure record only
  became diagnosable because it stamps `process.version`.
  **When something works here and fails there, get the server's Node and re-run
  before theorising.** `curl -sS https://nodejs.org/dist/v<VER>/node-v<VER>-linux-x64.tar.xz`
  is reachable from this sandbox; extract it and run `test/run-all.mjs` with it.
  The whole suite passes on both today — keep it that way.
- **RESUME PARSING USES A MAINTAINED READER, NOT `pdf-parse` (Session 19).**
  `pdf-parse@1.1.1` bundles pdf.js **v1.10.100, built in 2018**. On **Node 26**
  that build misreads a COMPRESSED cross-reference stream — it hits plain text
  where it expects zlib (`Unknown compression method in flate stream: 111, 32`,
  those bytes being the characters `"o "`), falls into its recovery pass, and
  that pass only rescues a PDF carrying an old-style `trailer`. So a modern
  resume failed and an older one went through, from the same upload path, on
  the same server. Measured on three real files:

  | | Node 22 (sandbox) | Node 26 (Render) |
  |---|---|---|
  | two xref-stream resumes | ok | **FAIL** |
  | one classic-trailer resume | ok | ok |

  It was never intermittent — it depends on which tool generated the PDF.
  **`unpdf` now leads** (a current pdf.js packaged for servers) with `pdf-parse`
  kept only as a second chance. `unpdf` was chosen over `pdfjs-dist` on
  identical output: **2.6MB against 37MB plus optional native canvas binaries**,
  and the extra 34MB buys only page RENDERING, which nothing here does — weight
  that would be re-downloaded every build and paid for on every free-tier cold
  start. Imported lazily, so it costs nothing until a PDF actually arrives.
- **RESUME PARSING FAILS IN FIVE DIFFERENT WAYS AND MUST SAY WHICH
  (Session 19).** `Invalid PDF structure` names neither cause nor cure.
  * **`describePdfFailure()` (PURE, in `resume-parser.js`) separates the five
    real cases** — empty, not-a-PDF-inside, cut short, password-protected,
    and intact-but-unreadable — and never repeats pdf.js's jargon at a
    recruiter. The library's own words survive on `err.cause` for the record.
  * **THE UPLOAD CHECKS ITSELF, AND IT PROVED THE UPLOAD WAS INNOCENT.** The
    browser sends the byte count it read; the server compares. The first
    version of the "intact but unreadable" sentence blamed the upload —
    *"damaged in transit"* — and the very first record disproved it. **Never
    let a diagnosis sound more certain than the evidence**: a confident wrong
    message sends someone off re-uploading a perfectly good file. The `%%EOF`
    check owns "cut short"; the other branch says "this reader could not open
    it", which is a different fix. A declared size is a HINT, never a gate —
    an older cached page sends none and must keep working.
  * **A failure is recorded to `app_settings` under `resume_parse_last_error`**
    (one row, overwritten; same shape and reasoning as `ai_last_error`), so a
    fault nobody can reproduce is still readable from the database instead of
    being transcribed by the owner. Best-effort: the record must never be the
    reason an upload fails.
  * **The data-URL strip is `/^data:[^,]*;base64,/`, not `.*`** — a greedy `.*`
    is a silent corruption waiting for a payload that contains a comma.
- **No guest / demo mode, deliberately (Session 11).** `Bearer guest` granted
  read-only access to the DEFAULT org — a real customer's live data — and
  `01-seed-demo.js` generated a fake world that a real user briefly saw before
  their own data loaded. Both gone. If a product tour is wanted, it is its own
  seeded organisation with a real login, never a bypass.
- **Deploy:** Render (`fute-lms-backend.onrender.com`), auto-deploys from `main`.
  → Merging to `main` IS the release. That's how the owner gets to try things live.
- **⚠ Render is on the FREE tier — treat instance hours as a hard budget.**
  The owner flagged this explicitly. The free plan spins the service down after
  ~15 min of no traffic and allows ~750 instance hours/month. Anything that keeps
  the service permanently awake consumes ~730 h/month and leaves no headroom, so
  **a frequent external pinger is a cost, not a free win.** The GitHub heartbeat
  is therefore **every 30 min, not every 5** (`.github/workflows/heartbeat.yml`
  carries the full reasoning). Due-ness lives in the DB, so a slower heartbeat
  delays jobs but never skips them. Before adding anything that polls the server
  on a schedule, ask what it does to instance hours. Cold starts (~30-60s) are a
  normal consequence of this and are why outbound timeouts are generous.
- **Tests: `npm test`** runs all **62** suites via `test/run-all.mjs` and reports
  one summary. It judges by **exit code**, not by grepping stdout — the suites
  print results in two different formats, so a stdout grep silently mis-reports
  whole suites as failures. **Read the count, not just the exit code**: piping it
  (`npm test | tail -3`) takes the exit status of `tail`, so a real failure can
  come back as 0 — Session 18 nearly merged on a masked `55/56`.
  `bash test/verify-frontend.sh` checks syntax + index.html.
  **22** suites are Playwright: `playwright-core` is now a devDependency, Chromium at
  `$PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers`). If they fail at once with a
  module error, that is the missing dep, not 18 broken tests.
  - **Browser suites enter the app via `test/helpers/enter-app.mjs`**, which sets
    `STATE.user`/`STATE.token` and re-renders. They used to click "Continue as
    Guest", which meant every browser test depended on a production auth bypass
    existing. **Never reintroduce a product-side bypass to make a test easier.**
- **Two vocabularies, don't conflate:** recruiting candidate progress lives on
  `submissions.stage` (**11 ATS stages** since Session 6: Sourced, Screening,
  Submitted to BDM, Submitted to Client, Interview Scheduled, Interview Completed,
  Offer, **Joining**, Placement, **Not Accepted**, On Hold — `Joining` was
  "Confirmation"; `Not Accepted` merges the old "Rejected" + "Not Joined"); BD leads
  live in `jobs` (Unassigned, Assigned, Connected, …). Recruiter gating: recruiters
  move a candidate only up to "Submitted to BDM"; BD owns the later stages.
  - **Stage vocabulary is defined in 6 places that must stay in sync** —
    `33-stage-modal.js` is canonical (`window.ATS_STAGE_LIST`/`ATS_SUB_STAGES`/
    `ATS_STAGE_COLORS` + `normalizeStage()`); duplicated copies in
    `25-workflow-bd.js`, `28-page-pipeline.js`, `30-page-candidate.js`,
    `05-page-dashboard.js`, and the backend **`services/recruiting-core.js`**
    (`STAGES` + `STAGE_ALIASES` — moved there from `bd_recruiter_routes.js` in the
    Session 9 split). `normalizeStage()` (backend + frontend) maps any legacy stored
    value to the current name on read and write, so a rename can ship before its data
    migration without breaking boards/funnels/reports.

## Working conventions

- Implement → `node --check` → targeted smoke test → screenshot → commit → push to the
  session's dev branch → open a **draft PR** → when the owner approves, merge + let it
  deploy. Keep commits/PRs clean; the owner won't read them, but future-me and buyers'
  auditors might.
- **Two context files, two different jobs — keep the discipline:**
  - `docs/CONTEXT_WINDOW.md` = **current state only**, kept under ~200 lines and
    **REWRITTEN** each session. This is what a new session reads.
  - `docs/CONTEXT_ARCHIVE.md` = the full history, **APPEND-ONLY**. Never edited,
    never deleted, never summarised away.
  At the end of a session: append the narrative to the archive, then rewrite the
  window to describe the new present. Nothing is lost; the read stays short.
  Keep **this file** current too — it is the durable memory.
- **A BUG REPORT IS DATA, AND USUALLY MORE PRECISE THAN IT FIRST READS
  (Session 21).** "I see a lot of time the menu is repeating, no repeats in full
  menu" — the second clause was the diagnosis. Nothing was drawn twice;
  `Insights` and `Reports` carried the SAME icon and the 60px rail is icon-only,
  so expanding it (the "full menu") showed different labels. The first probe
  swept five roles for duplicate ITEMS, found nothing, and nearly closed the
  case — because it tested a theory instead of the sentence. **Reproduce the
  sentence, not your hypothesis.**
- **A SYNTAX CHECK PROVES A FILE PARSES, NOT THAT IT STILL DOES ANYTHING
  (Session 21).** A bulk edit anchored on a START line and an END line silently
  swallowed `collectDom()` and `window.outreachGenerate` out of
  `48-page-outreach-gen.js` — the handler behind the Generate button. `node
  --check` passed, `verify-frontend.sh` passed, and the full suite would have
  passed: the file was valid JavaScript with two functions the page calls simply
  gone. **Prefer an edit anchored on the exact text being replaced over one
  anchored on a start and an end** — a slice is only as safe as your memory of
  what sits between the anchors, and that memory is what is least reliable in a
  file you did not write this sitting. When an edit removes a RANGE, verify that
  everything the file is supposed to contain is still in it. The guard that
  catches it: **every `onclick` a page emits must be defined in that page**
  (`test/outreach-ai-quality-smoke.mjs`).
- **A `TEST_USERS` SET IS NOT THE USER SET.** `bd_lead`, `director` and
  `associate_director` have no entry in `test/helpers/enter-app.mjs`, so a
  five-role sweep silently skips roles real people hold — `bd_lead` was one of
  the four affected by the icon collision above. When a bug can vary by role,
  cover every value `users.role` can actually take, not every value the helper
  happens to define.
- **TWO GREEN RUNS ARE NOT TWO RUNS OF THE SAME THING.** Session 21 saw 63/63
  twice — once on a branch carrying test A but not B, once on `main` with B and
  not A. Neither run had exercised both changes, and the total looked identical
  either way. **Read what was IN the run, not just the count.**
- **APPLY A MIGRATION BEFORE MERGING THE CODE THAT USES IT.** An insert naming a
  column that does not exist fails, and on a send path it fails *after the email
  has already gone out*.
- **Never pipe `git push` into `tail`** — it swallows a rejection, and a commit
  made on the wrong branch then looks like a successful push.
- **Before moving ANY file, read `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP"
  (Session 8).** Ten things break on a naive move and several fail *silently* —
  notably `learned-skills.js` (`__dirname`-relative JSON, resets with no error),
  two tests that read `index.js` as raw text, and the deliberate server→browser
  require in `match-engine.js`. A restructure without it will break production
  quietly.

## How this codebase is worked: NINE TERRITORIES → `docs/territories/README.md`

**Read that protocol before starting any job.** Session 22 divided PACE into nine
teams, each with a border it does not write past, laws it enforces, and a memory
of its own. This replaces the pattern where every session re-read `CLAUDE.md`
end-to-end before it could touch anything.

- **`.claude/agents/<name>.md`** — nine real Claude Code subagents: `surface`,
  `gateway`, `deep`, `harbour`, `observatory`, `guild`, `rampart`, `foundry`,
  `ledger`. Invoke one by name and it loads only its own territory.
- **`docs/territories/<name>.md`** — that territory's living memory. The agent
  reads it FIRST and rewrites it LAST. **Anything not written there is lost**,
  because the subagent's context dies when it finishes. That is the point: the
  memory persists, the context does not.
- **`docs/territories/DECISIONS.md`** — **what the OWNER decided, and when.**
  The territory memories record what the code *does*; the archive records what
  *happened*; this records **what they chose** — the only one of the three that
  can make a good suggestion the wrong thing to say. **Written the moment a
  decision is made, never at the end of a session**, because a decision that
  exists only in a chat window is lost when that window closes. Every entry
  carries a **Re-open when** condition, so a parked thing can be picked up for
  the right reason and not re-raised for the wrong one. Never edited, never
  deleted — a reversal is a new entry naming the old one (see D-0009 → D-0010,
  reversed inside a day).
- **`docs/territories/_contracts.md`** — the border ledger. A territory that
  needs a change outside its paths **opens a request; it does not reach across.**
  Append only; close an entry, never delete it.
- **`docs/territories/_map.json` + `island.html`** — the survey, regenerated by
  **`node scripts/territory-map.mjs`**. It counts real files, reads git for
  last-touched dates and parses the ledger, then rewrites the map block inside
  `island.html`. **Run it after any restructure** — it fails loudly when a file
  belongs to no territory, which is how two orphans were found the day it was
  written.

Three rules that make this worth having:

- **A territory never edits another territory's paths.** Not once, not for a
  one-liner. The silent divergence this prevents is the most expensive class of
  bug in this repo — three lead-release paths, one stage vocabulary in six files.
- **A shared file has one owner.** `index.js` is `gateway`'s. The five frontend
  copies of the stage vocabulary are `surface`'s, not `guild`'s.
- **`foundry` and `rampart` review everything.** Quality and tenant isolation are
  not optional sign-offs, and a breach in the second produces no error message.

This does not replace `CLAUDE.md` or the two context files — it sits under them.
`CLAUDE.md` is the constitution every territory obeys; a territory memory never
repeats it, it points at it.

## The current build: the Autonomous Recruiting Engine → `docs/AUTONOMOUS_ENGINE_PLAN.md`

**Read that file before planning anything new.** It is the owner-approved four-step
plan (Session 7) for the biggest bet on the roadmap: futé finding its own leads *and*
its own candidates off the internet against one shared relevance engine, then reading
the resulting conversations and telling the user what to do next. Two branches, one
brain, closed loop.

It supersedes the older `ENTERPRISE_OUTREACH_PLAN.md` §2 (Module A) as the live plan —
that doc stays as background. Load-bearing decisions locked with the owner
**2026-07-31**, all of which shape the code:

- **₹0 budget.** Free/ToS-clean sources only. Every cost is a later switch, never a
  dependency.
- **No funded `ANTHROPIC_API_KEY`.** Everything ships **rules-first**, extending the
  existing keyless convention (all 5 AI call sites already fall back to rules). AI is a
  seam, not a requirement. *Claude in the owner's chat is not the app having a key.*
- **Leads = end clients hiring directly**, not staffing firms — so free employer ATS
  boards (Greenhouse/Lever/Ashby/Workable) are exactly the right source, and a
  staffing-firm exclusion filter is required.
- **Runs inside futé, not Make** (Make free = 1,000 ops/month ≈ 150 leads, and becomes
  per-customer cost if we sell).
- **US + India**, market-agnostic build — but India coverage at ₹0 is genuinely thin,
  and that is a data fact, not a code gap.

Order: **Step 0** trustworthy scheduler → **Step 1** shared relevance engine →
**Step 2** lead branch → **Step 3** candidate branch → **Step 4** conversation
intelligence. The plan also lists seven live defects sitting on this path (dropped
`source_url` on candidate import, the dead `entity_type:'candidate'` sequence button,
untracked sequence sends, Gmail mailboxes getting no reply detection at all) — these
get fixed as part of the work, not filed away.

**ALL FIVE STEPS ARE NOW SHIPPED AND LIVE** (Steps 0-3 in Sessions 7-8, Step 4 in
Session 9). What that means in practice:

- **`conversation-intel.js`** reads a thread and returns who owes whom a reply,
  elapsed time each way, outstanding questions, an intent floor, commitments, a
  plain-English headline and a priority. **Pure, with an injectable clock** — every
  headline is a factual claim about elapsed time, so never call it with the real
  clock in a test. Rules-first; the AI seam sits behind the same output shape.
- **`next-action.js`** ranks all of that into one "needs you today" queue
  (`GET /next-actions`, hierarchy-scoped like `/reports/recruiting`), surfaced by
  `public/js/44-next-actions.js` on all three real-login dashboards.
  **Opted-out / "not interested" threads must never produce an action** — that is
  a compliance rule, not a preference, and it is pinned by a test.
- **Reply detection now covers Gmail as well as Outlook.** One shared
  `processInboundMessages` in index.js; Gmail messages are reshaped into Graph's
  shape by `gmailProvider.normalizeMessage`. **Do not add a second sweep** — two
  copies is how the stage vocabulary ended up hand-synced across six files.
- **Migration `037_conversation_intel.sql` (`conversation_messages`) is APPLIED**
  to the live DB (owner go-ahead, this session). Full conversation bodies now
  store for both `contacts` and `candidates` — before this session only the
  contact side was ever wired to store there (a latent bug: the two entities
  share one unique index on `(provider, message_key)`, so a second insert for
  the same physical message silently lost to the first). `/next-actions` also
  now surfaces candidate threads, not just BD leads, and carries a new advisory
  `stage_suggested` item when a candidate thread shows a positive-intent reply —
  it never asserts which stage to move to (that vocabulary stays owned by
  `services/recruiting-core.js`). See `docs/AUTONOMOUS_ENGINE_PLAN.md` §4 and
  the architecture-mapping plan this came from for the fuller Layer-3 rollout.

- **EVERY AI CALL GOES THROUGH `services/ai-provider.js` (Session 18).** Six
  features want an AI — cold-email drafting, the daily import briefing, resume
  parsing, the job-description scrub, lead-distribution advice and the outreach
  generator — and each used to hold its own copy of Anthropic's URL, key header
  and model name, so "use a different provider" was six edits rather than a
  setting. Now they call `complete(supabase, {system, prompt, maxTokens})`.
  Four rules:
  * **`complete()` returns NULL, never throws, and null means "write it with
    the rules."** Not configured, key rejected, free tier spent, local box
    unreachable, body unparseable — all the same outcome, because the rules
    writer behind that null is what production actually runs on today. Never
    turn a null into a 500.
  * **Two wire formats, not N providers.** `anthropic` (x-api-key, system as a
    *field*) and `openai` (Bearer, system as the first *message*) — Groq,
    OpenRouter and a self-hosted Ollama all speak the second, which is why
    supporting them is one adapter. `buildRequest`/`parseResponse` are PURE so
    the exact bytes per provider are pinned offline by
    `test/ai-provider-smoke.mjs`, which also greps the tree and fails if any
    file calls a provider URL directly.
  * **Providers chain; the admin's pick only leads.** Admin → Integrations has
    a "use this provider first" radio (`int_ai_active`); the rest stay as
    fallbacks. That chain is what makes a *free tier* safe to build on — losing
    one costs a dropdown, and until then it degrades rather than errors.
  * **A free tier is not a commercial promise.** Groq/OpenRouter are free and
    keyless-to-sign-up, Ollama is the operator's own box (`base_url` is what
    turns it on — no key exists to check). None of them may ever become a
    requirement for a feature to work.

- **WHAT AN AI CALL MAY COST IS DECIDED BEFORE IT IS MADE —
  `services/ai-budget.js` (Session 18).** A free tier is a daily allowance, and
  the way to lose one before lunch is to send a user's pasted 30,000-character
  job page to the biggest model forty times. So `complete()` takes a `feature`
  and an `orgId`, and the budget layer: **trims** input to that feature's
  ceiling (long input is cut, never refused — a resume's fields are on page
  one), **clamps** `max_tokens` down to the feature's ceiling, **tiers** the
  model (`fast` for extraction, `quality` only for prose a prospect reads —
  `PROVIDERS[id].models`), and **refuses** the call once the org's daily
  token/request ceiling is reached. Rules that hold:
  * **Over budget is NOT an error.** It is the same `null` as "no provider",
    and the feature's rules writer answers. That is the only reason a budget
    can be strict without being risky — never turn it into a 4xx.
  * **The check is BEFORE the call, on an estimate that rounds up** (input +
    the longest permitted answer). A meter that only counts what came back can
    be blown past by one long reply.
  * **A caller with no `feature` gets the tightest allowance, not an unlimited
    one** — otherwise "forgot to name it" becomes the way to bypass the budget.
  * **The meter is `app_settings`, keyed `ai_usage_<org>_<YYYY-MM-DD>`** — no
    migration, expires by never being read again, per-org. It is a meter, not
    an audit log; a per-call history is a later upgrade and its own table.
    Recording is best-effort: a counter that throws must never take down the
    feature it protects.
  * Caps live in `app_settings` (`ai_daily_token_cap` / `ai_daily_call_cap`),
    default 150k tokens / 250 requests, edited in Admin → Integrations. **Blank
    means "use the default"; a typed 0 genuinely means "no AI today"** — do not
    collapse those two.

- **AI IS WIRED IN SIX PLACES AND REACHABLE IN FOUR (audited Session 18).**
  Live: resume parsing, the job-description scrub, the outreach generator,
  lead-distribution advice. **Dead:** the daily import briefing
  (`/ai/generate-summary` — works, and nothing in the frontend calls it) and
  cold-email drafting (`/ai/generate-email` — reachable only from the orphaned
  `12-manager-users.js`, and never invoked even there). Do not repeat "six AI
  features" without re-checking the UI; the code count and the product count
  are different numbers.

- **A FALLBACK THAT PROTECTS THE USER MUST NEVER BE INVISIBLE TO THE OPERATOR
  (Session 18, four rounds).** `complete()` returning null is right for a
  recruiter and useless for whoever is trying to find out why nothing happened —
  from outside, "AI is off" and "AI is broken" look identical. So:
  `aiProvider.diagnose()` asks each configured provider for one word through the
  REAL path; `describeHttpError` reads the provider's own error body rather than
  discarding it (`HTTP 400` → `model_decommissioned: <name>` names the fix); a
  failed attempt fetches the models that provider DOES offer; the result is
  stored server-side (`ai_last_test`) so it survives the trip to the browser;
  and the card runs itself on open. **A provider card's "Test" proves only that
  the KEY is accepted — it lists models. It says nothing about whether a
  generation with the model we ask for works, and those two failures have
  identical symptoms.**
  * **A HOSTED MODEL NAME IS NOT A STABLE CONSTANT, and a wrong one is silent.**
    Confirmed the hard way (Session 19): Groq's defaults here were written from
    memory, never verified, and answered `HTTP 404 — The model
    'llama-3.1-8b-instant' does not exist or you do not have access to it`.
    Groq had retired the Llama 3.x line; every AI feature had been writing with
    its rules for as long as the key had been installed. **Groq's are now
    verified against that account's own `/models` list (2026-09-05):
    `openai/gpt-oss-20b` fast / `openai/gpt-oss-120b` quality.** OpenRouter's
    are still unverified — no key is configured, and this sandbox cannot reach
    either host. **If AI goes quiet, check the model name FIRST**, and use the
    health card: it prints the models that account really offers.
  * **A PROVIDER'S CATALOGUE IS NOT A LIST OF WRITERS.** Groq returned whisper
    (speech-to-text), orpheus (text-to-speech), prompt-guard/safeguard (safety
    classifiers) and an Arabic-first model alongside the two that can draft an
    email — and the card's "paste one of these" pointed at all of them equally.
    It now splits the list (`canWriteText()` in `08-page-admin.js`) and says so
    plainly when a provider offers no writer at all.
  * **A REASONING MODEL NEEDS HEADROOM ON TOP OF THE FEATURE'S CEILING.**
    `answerCeiling()` adds `REASONING_HEADROOM` (512) for a model matching
    `PROVIDERS[id].reasoningModels`, and the budget estimates on what is
    actually sent. Without it, lead distribution's 400-token ceiling produced
    **truncated JSON**: billed (2,049 tokens on the meter), unparseable, and
    reported to the user as "no AI provider answered". The FEATURE still
    declares how long an ANSWER may be; the provider layer adds what the model
    needs to reach one.
  * **"IT ANSWERED UNUSABLY" IS A THIRD STATE, NOT "IT DID NOT ANSWER".**
    `/distribute/generate-ratio`'s `JSON.parse` threw into the outer catch,
    which returned the rules split under a banner reading "No AI provider
    answered" — while the meter showed the tokens spent. A user should never
    have to reconcile two screens of the app contradicting each other. The
    route now returns `ai_unusable` and records the tail of what the model
    really said.
  * **A REASONING MODEL BILLS ITS THINKING AGAINST `max_tokens`.** gpt-oss
    thinks before it answers, out of the same ceiling as the answer, so at this
    app's budgets (700 tokens for a resume parse) it can spend the lot thinking
    and return an EMPTY message — indistinguishable from a broken provider.
    `PROVIDERS[id].reasoningModels` marks that family and `modelParams()` sends
    `reasoning_effort:'low'` to it and **nothing else** (an unknown parameter is
    a 400 on some OpenAI-compatible endpoints). `describeEmptyReply()` names
    the three ways an empty reply happens rather than saying "no usable text".
    The diagnose ping is 256 tokens, not 16, for the same reason — 16 reported
    a working model as broken.
  * **NOTHING MAY DEFAULT `diagnose()`'s TIER.** It probes every model a
    feature can ask for when given none, and `routes/integrations.js` passed
    `tier: req.body.tier || 'fast'` — so `opts.tier` was always set and the
    two-tier probe never ran once in production. Caught from the live database,
    which had stored `"tiers":["fast"]` and a single attempt under a green
    "AI IS WORKING": the quality model, the one the outreach generator sends to
    a customer's prospects, had never been called. **A default that silently
    disables a check is worse than no check** — it reports success it did not
    earn.
  * **`diagnose()` TESTS EVERY TIER A FEATURE CAN ASK FOR, not one (Session
    19).** The budget picks `fast` for extraction and `quality` for prose a
    prospect reads, so probing only `fast` can report "AI IS WORKING" while the
    outreach generator — the one feature whose text a customer sees — is still
    falling back on a renamed quality model. Same symptom, different fault. So
    `working` means every tier answered; one tier up and one down is `partial`
    and the card says so in amber.
  * **THE CARD MUST REJECT A WELL-FORMED ANSWER FROM THE WRONG ENDPOINT.**
    "is it an object" was the check, and the shadowed `ai-test` route (above)
    handed it a perfectly valid integrations payload for four sessions. It now
    requires a diagnosis's own fields (`configured` + `providers`) and names
    the wrong shape on screen as a PACE bug.
  * **A SYNTHETIC PING NEVER HIDES A REAL FAILURE.** `ai_last_error` — what
    happened the last time a FEATURE asked for text — renders under the test
    result, always, outside the branch chain that used to suppress it.

- **"Background engine: not receiving its heartbeat" is usually a FALSE ALARM.**
  GitHub treats `schedule` as best-effort: measured 2026-09-04, the 30-minute
  workflow was delivered every 3-5 hours (01:12, 06:24, 11:37, 16:05, 19:03 UTC
  — every one HTTP 200 with all six jobs run). Jobs are delayed, never skipped,
  because due-ness lives in the database. The card now says "running, heartbeat
  arriving late" and reserves the CRON_KEY-mismatch advice for 8h+ of silence.
  **Do not "fix" this by pinging harder** — that spends the free-tier instance
  hours the owner flagged as a hard budget.

## Growth bets (cost ~nothing now, scale later) — pick from these proactively

Ordered by "cheapest to do now vs. most painful to retrofit":

1. **Multi-tenancy (the big one).** Design so one deployment can serve many client
   companies: a tenant/`org_id` on every ATS table + query scoping. Free to add now,
   very expensive to retrofit — and it's the thing that makes futé *sellable* to more
   than one customer. Highest-leverage architectural bet.
   - **Slice 1 DONE** (migration `022`): `org_id` on 33 tenant tables, backfilled to
     the default org "Fute Global", with a column DEFAULT so nothing breaks. Backend
     resolves `req.orgId` (JWT carries `org_id`; falls back to the default org), and
     the core creates (candidates, job orders, pipeline, submissions, new users)
     stamp it. Behaviour is unchanged for the single existing org.
   - **Slice 2 DONE:** the core ATS collection reads are org-scoped via a
     `withOrg(query, req)` helper — `GET /candidates`, `GET /job-orders`,
     `GET /job-orders/browse`. **Also done (this session):** the **leads engine**
     (`jobs`/`companies`/`contacts` in index.js + routes/jobs.js, routes/companies.js,
     routes/contacts.js) is now org-scoped the same way — `withOrg()`/`orgStamp()`
     helpers were added to index.js (mirroring bd_recruiter_routes.js) and threaded
     through `routeCtx`. The `loadAllJobs()` in-memory cache (the big payload every
     open tab polls) is now **keyed per org_id** instead of one shared global cache —
     this was the most severe gap, since a second org would otherwise have seen the
     first org's entire leads list. `/distribute/execute` (assigns the Unassigned
     lead pool to a BD manager) and `/distribute/pool-stats` / `/today-summary` are
     org-scoped too — previously an org's Unassigned pool was assignable to any
     org's manager. Also closed: the `/recruiting-dashboard` aggregate, and the
     single-record long tail on `GET /job-orders/:id` / `GET /candidates/:id` /
     `GET|PUT|DELETE /jobs/:id` (404 instead of leaking a cross-org record).
     **Still open:** the legacy `/bd-analytics/*` endpoints (un-org-scoped — item 5
     below), and RLS (slice 3b, next).
   - **Slice 3a DONE** (migration `023`): `org_id` is now `NOT NULL` on all tenant
     tables (safe — every row backfilled + column DEFAULT).
   - **Slice 3b DONE** (migration `039_tenant_isolation`, applied 2026-08-05): RLS
     + service-role policies on the 37 tables that still had it disabled — which
     included `microsoft_tokens`, i.e. customers' mailbox refresh tokens were
     readable with the anon key. Verified after: **0 of 48 tables without RLS, 0
     without a service-role policy.** Same migration gave `microsoft_tokens`/
     `gmail_tokens` an `org_id` (both now in `TENANT_TABLES`), added
     `users.last_login_at`/`last_login_method`, and widened `users_role_check` to
     accept `associate_director`/`director` — roles the UI had offered since
     migration 026 and the database had rejected ever since. It landed BEFORE
     `SELF_SERVE_SIGNUP` was turned on, which is the whole reason it is one batch.
     **The next migration is 040; never apply one to the live DB without an
     explicit, fresh go-ahead.**
   - **Self-serve signup is built and switched OFF** (`services/provisioning.js`).
     Where a brand-new sign-in lands is a **pure function** (`decide()`) because
     routing somebody into the wrong org is a breach that produces no error message.
     Three destinations only: verified claim + auto-join → join it; verified claim,
     auto-join off → "ask your admin"; anything else → a **private** workspace.
     **Sharing a domain is not membership** — two people on an unclaimed domain get
     two separate workspaces. Nothing happens at all unless `SELF_SERVE_SIGNUP=on`.
   - **`orgIdFor()`'s default-org fallback is deliberate — do not "fix" it to return
     null.** Background sweeps call `withOrg()` with no user, and null turns a scoped
     query into an UNSCOPED one. The hole is closed in `auth()` instead: an org-less
     session token is refused once more than one org is possible.
2. **Configurable roles & permissions per org** — we already have roles; make them
   data so different customers can mirror their own org charts.
   - **Reporting hierarchy DONE** (migration `026`): `users.manager_id`, self-
     referencing, nullable — a *flexible* tree where any user can report to any
     other user regardless of role (not a fixed ladder), per the owner's explicit
     ask. Two new roles added everywhere roles are picked: Associate Director,
     Director. Admin-only `PUT /users/:id/manager` (rejects self-management and
     reporting loops). A **"Reporting Hierarchy"** card on the Admin user detail
     page: a "Reports to" picker + a live "Direct reports" list. This is additive
     alongside the existing RA/BD `team_assignments` table (which already drives
     some Insights and is untouched) — a second, more general hierarchy layer.
     **Still open:** actual per-role *permission* differences (today the new
     roles are hierarchy/reporting-only, no new capabilities); a full
     configurable-permissions system remains future work.
   - **Session 5 DONE: team structure + visibility fix** (PRs #117, #118 +
     migration 029) — see `docs/CONTEXT_ARCHIVE.md` "Session 5" for the full
     writeup. The hierarchy existed but nothing in the UI used it consistently:
     the Dashboard "Your Team" widget had a live bug (keyed off a dead `bdm`
     field, so it silently showed the whole org to everyone but recruiters),
     `GET /users`/`GET /team-assignments` had no org scoping, and
     `/recruiting-dashboard` wasn't chain-scoped like `/reports/recruiting`
     already was. Fixed all of that, plus: a real manager/team dashboard, a new
     "My Team" page (data-driven — anyone with ≥1 report), an Admin "Org chart"
     view (List/Org-chart toggle), the individual RA dashboard rebuilt on real
     `jobs` data (was reading dead demo seed data), and the older
     `team_assignments` table fully retired in favor of `manager_id` (Team
     Insights, Admin views) with a one-time backfill migration applied live.
     "Team" now means one consistent thing everywhere: direct + transitive
     reports under `manager_id`. **Still open, deliberately deferred:** retiring
     the orphaned "Manager Users" page + its separate `email_accounts`
     subsystem — confirmed unreachable via nav, but shares live code with the
     reachable Admin page, so it needs an audit-and-split, not a delete.
3. **App-tracked candidate email** (not just `mailto:`): route candidate emails through
   the sending subsystem we already have → open/reply tracking = a real selling point,
   no new infra.
   - **THE IN-APP MAILBOX IS DONE (Session 13).** A real three-pane mail client
     over the user's connected mailboxes — folders/labels, message list, reading
     pane, reply/reply-all, compose, archive, trash, mark read/unread, search,
     attachments. `services/mail-provider.js` is one adapter over Graph AND
     Gmail (`forMailbox(row)` dispatches on `platform`); `routes/mailbox.js` is
     the API; `public/js/47-page-mailbox.js` is the page. **No new OAuth
     consent** — `Mail.ReadWrite` and `gmail.modify` already cover all of it, so
     nobody reconnects.
     **Session 15 restructured it to TWO panes with a threaded reader**: the
     folder rail became a toolbar picker (it cost 190px on every screen to save
     one click), and the reader shows the whole conversation via the
     `/mailbox/:mid/threads/:tid` endpoint that already existed with no caller.
     The thread endpoint returns SUMMARIES, so a collapsed message opens through
     the same `loadMessage()` as any other — one code path for opening mail and
     marking it read. **A sandboxed body cannot be auto-sized** (measuring an
     iframe from the parent needs `allow-same-origin`, the exact grant that keeps
     a hostile email boxed in), so bodies get a fixed height and scroll inside
     themselves. Do not "fix" that.
     Four rules that must not be softened:
     * **Nothing is mirrored into Postgres.** Every read is a live pass-through.
       Storage is free-tier, a sync needs a poller (instance hours), and a
       mirror drifts in ways that are unfixable by design. **`conversation_messages`
       (037) was deliberately NOT widened to hold general inbox traffic** — that
       table is the intelligence layer's record of threads PACE is *working*.
     * **Your own mailboxes only** — not "yours plus admin's". `ownedMailbox()`
       in routes/mailbox.js is the single door, and it answers **404** for
       someone else's mailbox (indistinguishable from a nonexistent one, so ids
       cannot be probed) and **409** for yours-but-disconnected. Pinned by
       `test/mailbox-smoke.mjs`, including that a refused request never reaches
       the provider at all.
     * **Nothing destroys mail.** Delete is a MOVE to Deleted Items / a call to
       `messages.trash`. Neither provider's permanent-delete is reachable from
       this app, and the tests assert the absence of that call.
     * **The body renders in a sandboxed iframe** (no `allow-scripts`, no
       `allow-same-origin`) on top of server-side sanitising, and **remote
       images are blocked until the reader asks** — an inbound pixel is the same
       technique PACE uses on its own outbound mail.
     Sending reuses the SAME provider calls the outreach engine uses — there is
     deliberately no second send path — but does **not** inject the tracking
     pixel or write `email_tracking` rows: tracking belongs to outreach, not to
     a personal reply.
   - **Composer round 2 (same session), from the owner using it for real:**
     reply/reply-all/forward now share one composer with an **editable To, Cc
     and Subject**, **file attachments** (3.5MB/message — deliberately under
     `express.json`'s 5MB body cap so the friendly refusal fires, not an opaque
     413), and a **Forward** verb (Graph `createForward`; the Gmail adapter
     rebuilds the message and re-downloads the original's attachments).
     **`{{sender}}` SHIPPED TO A REAL RECIPIENT** — signature templates carry
     `{{sender}}`/`{{senderemail}}` and only the outreach path called
     `fillSignatureHtml`; the mailbox router appended the raw template. Fixed,
     and the signature is now **off by default with a picker** (remembered per
     user) — a signature belongs on outreach, not on every message of a live
     thread. **Anything that composes mail must call `fillSignatureHtml`**;
     `GET /mailbox/:mid/signature` returns the filled version so the composer
     previews exactly what the recipient gets.
   - **`gmail-provider.js` now RFC 2047-encodes headers.** Raw UTF-8 in a
     `Subject:` is what turns an em-dash into `Ã¢Â€Â"` in the recipient's
     client. `encodeMimeHeader` folds into ≤75-char encoded-words and splits on
     **character**, not byte, boundaries — a byte-boundary split corrupts
     multi-byte characters differently and worse.
   - **THE OUTREACH GENERATOR IS DONE (Session 17)** — Email → **Generator**
     tab. Paste a job posting plus who you found, get one researched cold email
     and a one-line diagnosis of why the role is hard to fill, edit it, send it.
     `services/outreach-generator.js` is PURE (no db, no fetch, no clock) and
     holds both engines behind ONE output shape `{subject, diagnosis, email}`:
     `rulesDraft()` writes from a sentence plan, and `buildSystemPrompt()` /
     `buildUserPayload()` / `parseAiDraft()` are the AI seam. Three rules:
     * **The rules writer is the product, not a degraded mode.** There is no
       funded `ANTHROPIC_API_KEY`, so in production every email this feature
       sends comes out of those functions — and an AI call that fails or comes
       back unparseable falls back to them rather than erroring. The page says
       which engine wrote what it is showing.
     * **The sending address is never a page parameter.** `/outreach/send`
       resolves the caller's assigned mailbox itself (`recruiterSendingMailbox`,
       handed over by `routes/recruiting/outreach.js` — which now RETURNS its
       send helpers precisely so this router did not have to grow a second send
       path). A From address chosen by the client is an identity chosen by the
       client.
     * **The sending company is a parameter, resolved per request from
       `organizations.name`.** This text goes to a customer's prospects under
       the customer's name; "Fute Global LLC" is one org's identity.
     * **The mailbox signature is a TEMPLATE and the body must not sign itself
       on top of it.** The first real send to a live prospect went out with two
       sign-offs and a signature reading `{{sender}}` / `{{senderemail}}`, so
       `/outreach/generate` now resolves the mailbox signature BEFORE drafting,
       fills it, tells `rulesDraft`/`buildSystemPrompt` to close at "Thanks,"
       when one exists, and returns it as `signature_html` for the page to
       preview. The same omission was live in all four send paths of
       `routes/recruiting/outreach.js` (candidate email, client email, the
       sequence channel, interview invites) — one `filledSignature()` helper
       now, and `test/outreach-generator-smoke.mjs` greps every mail-composing
       router and fails if one appends a raw saved signature.
     * **Four framings, one set of facts — and the POC's CV is not one of the
       facts.** `rulesVariants()` returns every angle at once (Direct, Short,
       Saves them work, The hard part; three more for follow-ups) and the page
       puts a picker above the preview, keeping edits PER VARIANT. Each opener
       is one that earned replies in the owner's 30 replied threads. **NONE of
       those 30 mentions the contact's background**, so `pickNoteDetail` no
       longer emits tenure or career history — an email opening "you came up
       through estimating and pre-construction" reads as *I read your profile*,
       not *I read your posting*. What survives: a mutual connection, a prior
       conversation, something about the ROLE (re-posted, open N days). The
       contact's title still shapes register and fee placement via
       `audienceOf()`; it is never printed.

     * **AN AI DRAFT IS CHECKED, NOT TRUSTED (Session 20).** A prompt rule is a
       REQUEST; `checkDraft()` (pure) is the guarantee. It holds every AI draft
       to the rules a machine can verify — a leftover `{{placeholder}}`, a
       stated fee percentage, a call/meeting ask where the ask must be "want to
       see resumes?", fee language before that ask for a non-finance reader,
       exclamation marks, marketing adjectives, a missing greeting, a second
       sign-off above the appended signature, and the angle's own length band.
       One repair turn naming exactly what to fix, taken only if it comes back
       with FEWER violations; then the rules draft wins. Never ship a draft that
       broke a rule because an AI wrote it.
       Two of these came out of the first live run and neither was findable by
       reasoning: the model read "identity in sentence one" literally and
       dropped the greeting entirely, and `double_signoff_name` read the last
       four lines — which on a compact email is the WHOLE email — so it rejected
       the identity sentence rule 1 REQUIRES. **A check that samples "the last
       few lines" is a check that fires on short input.**
     * **THE READER'S JOB AND THE HIRING JOB ARE ONE FACT (Session 20).** Rule
       16 makes the model connect them (`AUDIENCE_BRIEF` per reader: finance is
       approving a cost, HR wants the screening off their desk, an owner wants
       the seat filled, a hiring manager wants somebody who can run the job on
       Monday); rule 17 forbids printing any of it. Verified live — same
       posting, same angle, reader swapped: a Talent Acquisition Manager got
       "consuming your team's time with resume reviews, phone screens, and
       interview logistics", a CFO got "consumes internal time and hiring
       budget". The check catches the ADDRESSING construction ("as Controller,",
       "in your role as HR Manager"), never a bare word — a superintendent
       hiring a superintendent must be free to use the word.
     * **THE FOUR ANGLES CONVERGE UNLESS EACH IS TOLD WHAT IT MAY NOT DO
       (Session 20).** All four are AI-written now, one at a time, the first
       time each chip is opened (`POST /outreach/generate-angle`) — four up
       front costs four calls a Generate, about six generations against the
       daily budget. The first live run produced four drafts that ALL opened
       with "reposted after 34 days" and recited the same requirement list: the
       model finds the strongest material and uses it everywhere. `ANGLE_BRIEF`
       therefore carries `must`, **`never`** and a length band per angle, and
       `checkDraft` enforces the band. A picker whose options are paraphrases of
       each other is not a picker.
     * **A REWRITE RESENDS THE EARLIER ATTEMPTS, OR IT IS A RE-ROLL
       (Session 21).** `buildRewritePrompt()` sends every previous draft back
       with an instruction not to reuse those openings, and restates the angle's
       own `lead`/`must` so the intent survives while the sentences change — a
       model handed the same brief twice returns very nearly the same email, and
       the button then looks broken. Verified live: four attempts, four distinct
       openings, all passing `checkDraft`. **`REWRITE_LIMIT` is 3 and is
       enforced SERVER-SIDE (429 `rewrite_limit`), not only in the button** —
       the cap exists to protect a token budget shared with resume parsing, the
       JD scrub and lead distribution, and a page cannot be what protects that.
       The number lives in `services/outreach-generator.js` and in
       `48-page-outreach-gen.js`; a test asserts they agree.
     * **⚠ GROQ'S FREE TIER IS 8,000 TOKENS PER MINUTE** and one angle costs
       ~2,100, so four in quick succession rate-limits (429). The
       quality→fast model fallback in `complete()` absorbs it because the limit
       is per model. Measured 2026-09-08 on the live account.
     * **SENDING CAN CREATE THE LEAD AND JOIN A SEQUENCE (Session 20).** The
       generated email is the first outreach for a lead — the same thing the
       send loop produces on assignment. Picking a sequence creates the company,
       lead and contact (via the shared `createLeadFromOutreach`) and enrolls
       them; sending WITHOUT one creates nothing, so a one-off draft never lands
       in somebody's pipeline. **The lead is `Assigned`, NEVER `Connected` —
       Connected means THEY REPLIED and drives the funnel, the reports and the
       30-day recycler.** And the enrollment starts AFTER step 1
       (`workflow-engine.enroll({ start_after_step })`), because the email just
       sent IS step 1 and the standard sequence opens with `email(+0d)` — which
       would otherwise send the same prospect a second email on the next tick.
       A sequence failure never reports the already-sent email as failed.
   - **CANDIDATE OUTREACH IS THE MIRROR OF THE GENERATOR, POINTED THE OTHER WAY
     (Session 21).** Email → Compose now has a **Clients | Candidates** switch
     (recruiters see Candidates, BD sees Clients, anyone leading both desks gets
     the switch; one mode is never drawn as a picker). Clients starts from a
     PASTED posting and finds one contact; candidates starts from a **job order
     we already own** and finds MANY people. `services/candidate-outreach.js` is
     PURE and holds the writer, the three angles and `checkCandidateDraft`;
     `routes/candidate-outreach.js` is the database, the AI call, the queue and
     the drip. See `docs/CANDIDATE_OUTREACH_PLAN.md`. Rules that hold:
     * **THE AI IS CALLED ONCE PER JOB ORDER, NEVER PER CANDIDATE.** 25
       candidates = 25 calls = a rate-limit on Groq's 8k tokens/minute and the
       org's whole daily meter gone, after which EVERY AI feature in PACE falls
       back to rules for the day. So the **job brief** is written once and
       cached on `job_orders.outreach_brief` (migration 042); the per-candidate
       sentence is assembled free from the **match engine's `reasons`**, which
       are read off that person's own resume and are therefore true by
       construction. 25 candidates cost the same as one.
     * **THE BODY IS STORED WITH `{{sender}}` UNRENDERED** — these are QUEUED,
       and the mailbox that sends is resolved at drain time. `checkDraft`'s
       placeholder rule is therefore INVERTED here: `{{sender}}`/`{{senderemail}}`
       are legal and anything else in braces is not. The preview resolves from
       the **selected sending mailbox**, never the session.
     * **THE CANDIDATE RULES ARE NOT THE CLIENT RULES RENAMED.** Fee language is
       right on a client email and refused here. An opt-out is optional there
       and **mandatory** here. Job title and location must appear — a candidate
       cannot answer "are you interested" without them. And two checks exist
       because getting them wrong is unrecoverable: **`invented_pay`** (any
       money figure not on the job order; the first version only matched a
       currency SUFFIX, so `USD 200,000` — the exact shape `jobFacts` emits —
       sailed through, and a checker with a hole reports a clean draft) and
       **`invented_experience`** (a years claim that contradicts the record).
     * **A MINIMUM LENGTH IS AN INSTRUCTION TO INVENT WHEN THERE ARE NO FACTS.**
       `too_short` is suppressed when `materialIn()` < 3. It rejected the rules
       writer's own drafts on a job order carrying only a title — and demanding
       more words there is asking for exactly what `invented_pay` forbids.
     * **THE RULES WRITER MUST PASS ITS OWN CHECKER**, and the queue endpoint
       enforces it: a candidate whose draft fails is skipped, so an angle that
       fails silently never ships. Two real defects came out of this on the
       first run (the short angle had no way out; nurture never asked a
       question). Pinned by `test/candidate-outreach-smoke.mjs`.
     * **`null` MEANS OMIT, `''` MEANS BLANK LINE** in `assemble()`. Filtering
       both collapsed every email to single-spaced sentences — invisible to a
       word count and to every check, visible instantly in a screenshot.
     * **THE DRIP IS A COLUMN, NOT A TIMER.** The free tier spins down, so each
       queued row carries its own `send_after` (now + i × 75-105s, jittered) and
       the heartbeat drains what is due, applying the same gates as the lead
       loop (window in the CANDIDATE's timezone, daily cap, warm-up ramp,
       auto-pause, suppression). A late heartbeat delays and never skips.
       Nothing sends inside a request. `candidate_outreach` is its own queue
       deliberately — `emails` is welded to the leads engine and its send loop
       is the most load-bearing code in the app.
     * **EMAILING IS NOT WORKING THEM.** A submission at `Sourced` is created
       ONLY if the recruiter ticks the box (owner's call, default off).
     * **THE ANSWER IS TWO BUTTONS IN THE EMAIL, AND THE LINK MUST NOT RECORD.**
       `GET /i/:token` renders a page with real buttons; the POST from that page
       is the answer. Corporate mail security (Outlook Safe Links, Mimecast,
       Proofpoint) fetches every URL in an inbound message, so a recording GET
       would mark candidates interested — or opted out — before a human opened
       the email, and nothing would look wrong. Same token as the pixel, written
       to the row BEFORE the send so a tap can never beat its own row. Unknown,
       deleted and malformed tokens are answered identically.
     * **"NOT THIS ONE" IS ABOUT THE JOB; ONLY THE EXPLICIT OPT-OUT SUPPRESSES.**
       `suppression_list` is GLOBAL, so writing to it on a single decline throws
       away a good candidate for every future role over a "wrong city". THREE
       answers: interested, not-this-one, and a quieter "do not email me about
       any roles" — the last is the only one that suppresses, and it also skips
       everything still queued for that address.
     * **A PUBLIC PAGE MAY NEVER HANG ON THE DATABASE.** Measured: `supabase-js`
       retries a refused connection for **7 seconds**. Every query behind `/i/`
       is bounded at 4s and falls through to an honest page. And a write that
       timed out is NEVER reported as saved — the candidate is told, and pointed
       at the reply path.
     * **THE FIRST LIVE BATCH BROKE FIVE WAYS, AND FOUR WERE INVISIBLE TO EVERY
       TEST (Session 21, round 2).** One job, four HVAC technicians, three
       silently skipped. Each of these is now pinned by the real records:
       - **A JOB'S REQUIREMENT IS NOT A CLAIM ABOUT THE READER.** The AI brief
         said *"2-3 years of field experience"* — a fact about the VACANCY — and
         `invented_experience` matched any `N years` anywhere, so an 11-, a 35-
         and a 15-year technician were all rejected. The one that got through
         did so only because his 4 years sat within 1 of 3. The check now fires
         only on a SECOND-PERSON attribution (`YEARS_ABOUT_READER`): "your 20
         years" is a claim, "the role asks for 2-3 years" is the job talking.
       - **THE PREVIEW AND THE QUEUE MUST READ THE BRIEF THROUGH ONE LOADER.**
         The preview built its input with no `brief`, so it showed the RULES
         text while the queue sent the cached AI text — the screen and the
         outbox disagreed, which is the exact failure a preview exists to
         prevent, and it is why the skip above was undiagnosable from the app.
         `briefFor(job)` is now the only reader. Do not inline it again.
       - **`match-engine`'s `reasons` ARE GRID SHORTHAND, NOT PROSE.** The real
         values are `3/4 skills`, `title 100%`, `diff state`, and one went out
         as *"your background in 3/4 skills"*. `sharedSkills()` now computes the
         overlap from the two RECORDS; `reasons` only says whether there was
         one. Never render a matcher string into customer-facing text.
       - **A YES/NO FIELD PRINTED RAW SAYS "No".** `job_orders.remote` holds
         `"No"`, which became *"It is Full-time and No."* `remoteTerm()` turns
         it into "on site" / "remote" / "hybrid" and passes anything else
         through as typed.
       - **A SKILLS FIELD IS TYPED BY HAND AND ARRIVES LOWERCASE.** "The work
         centres on hvac, epa and boilers." `prettySkill()` uppercases an
         all-lowercase token of ≤4 chars (an acronym essentially every time)
         and leaves everything else exactly as entered, so "boilers" stays
         lower and "Procore"/"OSHA 30" are untouched.
       Two more, smaller: a sub-1000 pay range is named as an hourly rate
       (`payPeriod` — no full-time annual salary is a 3-digit number; above that
       we assert nothing), and **a skipped candidate is given the checker's own
       sentence, never the code** — the batch told the recruiter only "failed
       check" while the app knew exactly what was wrong.
     * **A QUEUE THAT IS WAITING MUST SAY WHAT IT IS WAITING FOR (Session 21,
       round 3).** Four emails sat on "pending · due 03:39 am" hours after that
       time passed, and the owner had to ask whether it was the send window or a
       fault. It was the window: every candidate was in Connecticut or South
       Carolina, it was 9:26 pm there, and the window is **08:00-16:00 in the
       CANDIDATE's timezone** — nothing was broken and nothing said so. The
       queue now returns a `wait` per pending row (`window` / `due` / `queued` /
       `paused`) computed with `getTimezoneFromLocation` +
       `formatWindowOpensLabel`, and the row reads "Outside New Britain, CT
       working hours. Goes Tomorrow, 8:00 AM." A due timestamp already in the
       past is never shown as if it were the answer.
     * **CANDIDATES HAVE THEIR OWN SEND WINDOW, AND IT IS NOT THE LEADS ONE
       (Session 21, round 4 — owner's call 2026-09-09).** The leads engine sends
       08:00-16:00 because a PROSPECT is at their desk then. A CANDIDATE is at
       work then — a technician on a roof at 11am is not reading recruiter mail.
       So candidate outreach sends **weekday evenings (17:00-21:00) and most of
       the weekend (09:00-20:00), in the CANDIDATE's timezone**.
       `candidateWindowState(localDay, localMinutes, cfg)` and
       `describeWindowOpens()` are PURE — the caller works out what day and hour
       it is where the candidate is, so every hour of the week is testable
       without waiting for it. Config lives in `app_settings`
       (`candidate_window_weekday_start`/`_end`, `..._weekend_start`/`_end`);
       **a day whose start is not before its end is CLOSED**, which is how
       "weekends only" is expressed without another flag. Nothing here may call
       `isInLeadSendWindow`/`getSendWindowHours` — a test fails if it does.
     * **⚠ A BACKLOG RELEASED BY AN OPENING WINDOW WOULD HAVE BURST.**
       `send_after` spaces a batch at QUEUE time, but if the window was shut
       when those slots came round then every row is due the instant it opens,
       and the drain's loop had no pause — the whole backlog back to back, the
       exact pattern the drip exists to prevent. The drain now sends at most
       **6 per tick and sleeps 75-105s between REAL sends** (a skipped,
       deferred or suppressed row must not buy the next one a free slot), the
       same shape as the leads engine's `waitForMailboxSlot`. Six sends is
       under eight minutes, inside the ten-minute tick.
       The queue-time spacing states the intent; the send-time pause enforces it.
     * **THE SENDING HOURS ARE ON SCREEN BEFORE ANYTHING IS QUEUED**
       (`GET /candidate-outreach/sender` returns `window.label`), because the
       owner queued a batch at 3am and then had to ask why nothing moved.
     * **THE HOURS ARE EDITED IN `config/settings.js`'s SCHEMA, NOT A NEW
       SCREEN.** Admin → System Settings is fully schema-driven — it fetches
       `/admin/settings/numbers`, groups by `group` and renders each row — so
       four entries under `group: 'Candidate outreach'` bought the whole
       control with NO frontend work, and with the range checking and the
       validated write already there. `candidateWindow()` reads the same keys
       through `settingsConfig.getSetting`, so the hours an admin types and the
       hours the drain obeys cannot be two different numbers; a test fails if
       that router queries `app_settings` for them directly. **Reach for this
       schema before building any new numeric setting.** The modal opens from
       the Sequence page toolbar, which is a long way from where the question
       gets asked, so the candidate Compose screen links to the same modal
       rather than growing a second settings surface.
     Rule-shaped behaviour (no-agencies short form, follow-up short form,
     finance-first fee placement, the one-detail-from-notes limit, never naming
     a skill absent from the posting) is pinned by
     `test/outreach-generator-smoke.mjs`. The tab's meter and Recent list are
     localStorage, per browser, deliberately — nothing downstream reads them.
   - **Slice 1 DONE** (migration `024`): open-tracking *infrastructure* — an
     `email_tracking` table (org-scoped), a public pixel endpoint `GET /o/:token.gif`
     (records opens, returns a 1×1 gif, never errors), a `GET /candidates/:id/
     email-activity` read endpoint, and pure helpers in `email-tracking.js`
     (`newToken`/`pixelHtml`/`injectPixel`). Wired into `routes/tracking.js`. Nothing
     writes tracking rows yet — the live send path is untouched.
   - **Slice 2 DONE:** `POST /candidates/email` sends the invite to selected
     candidates via the recruiter's connected mailbox (reuses `recruiterSendingMailbox`
     + `sendMicrosoftNewMessage` + `buildHtmlEmailBody`), injects the pixel, records an
     `email_tracking` row per recipient, bumps `email_send_log`; returns 409
     `no_connected_mailbox` so the UI falls back to the mail app. Frontend: the
     "Email JD" modal's **"✉ Send tracked through futé"** button (mail-app kept as
     fallback); the candidate profile shows an **Email activity** card ("✓ Opened · N×"
     / "Sent · not opened yet") from `GET /candidates/:id/email-activity`.
     **Gmail send DONE (this session):** `recruiterSendingMailbox` now checks both
     `microsoft_tokens` and `gmail_tokens`; a new `sendMailboxNewMessage(mailbox, …)`
     dispatches to the Gmail provider or Microsoft Graph by `mailbox.platform`
     (mirrors `deliverOutboundEmail`'s existing dispatch for the general outreach
     engine). Used by both `POST /candidates/email` and the `candidate_email`
     sequence channel; `connectedMailboxById` (sequence "from" override) is
     platform-aware the same way.
   - **Slice 3 DONE:** reply detection — hooked into the existing 30-min
     `sweepMailboxReplies` inbox scan (uses `Mail.ReadWrite`, already granted, so NO
     reconnect needed): an inbound message whose `from` matches a tracked send's
     `to_email` stamps `replied_at`. Candidate profile Email-activity card shows
     **"↩ Replied"** (green). No new columns/Graph calls — reuses the lead sweep.
   - **Interview scheduling (related, DONE):** the stage modal captures full
     interview details — format (in-person / virtual / phone), platform + join link
     or office address, up to 3 interviewer names — stored on `submissions`
     (migration `025`). `POST /submissions/:id/interview-invite` emails the formatted,
     open-tracked details to the candidate and/or the BD manager (job title, company,
     date/time, format, interviewers auto-included).
   - **Teams meeting auto-create DONE:** `POST /submissions/:id/create-meeting`
     creates a Microsoft Teams meeting via Graph `/me/onlineMeetings` and stores the
     joinUrl on the submission; the interview modal's **"Generate Teams meeting
     link"** button fills it in. Added `OnlineMeetings.ReadWrite` to the MS OAuth
     scopes — **mailboxes connected before this need a one-time reconnect**; until
     then the endpoint returns 409 `meetings_permission_missing` and the UI says so.
     **Reconnect UI added (this session):** a "Reconnect" link now sits next to the
     "✓ Connected" badge (Manager Users, and the workflow mailbox picker) — before
     this there was no way to redo OAuth on an already-connected mailbox short of
     deleting and re-adding it.
     **Next:** Google Meet (needs a Google Calendar scope/connection); Zoom (new OAuth).
4. **Candidate ↔ JD match scoring / ranking** — we already parse resumes and JDs; add a
   match score (AI when a key is set, rule-based fallback). On-trend differentiator.
5. **Reporting/analytics** — funnel, time-to-fill, recruiter productivity. We already
   store the data; surfacing it is a sales lever.
   - **DONE:** a **Reports** page (`39-page-reports.js`, nav item) from one org-scoped
     endpoint `GET /reports/recruiting` — headline totals, pipeline funnel, 8-week
     submission trend, recruiter-productivity table (with fill % + placement-fee
     revenue), avg time-to-fill and top clients. (Legacy `/bd-analytics/*` endpoints
     still exist, un-org-scoped — fold in later.)
   - **Hierarchy-scoped DONE (this session):** replaced the old binary "recruiter
     sees own / any BDM sees the whole desk" split with the reporting hierarchy
     above — everyone sees themselves plus everyone under them on the chain
     (`reportingChainIds()` in `bd_recruiter_routes.js`, a BFS over `manager_id`).
     A BD with no reports sees just their own; a BD Lead sees their whole team's.
     Admin is the one exception and always sees the whole org. Response carries
     `scope` (`own`/`team`/`org`) instead of the old binary `role` field.
     **Still open:** the owner also asked for reports to be *part of the
     Dashboard* page itself (today it's a separate Reports nav item/page), and
     for the main Dashboard's own recruiting widgets (`/recruiting-dashboard`)
     to get the same hierarchy scoping — currently only `/reports/recruiting`
     (the Reports page) is hierarchy-aware.
6. **CSV import/export + a small public API** — buyers need to migrate in and integrate.
7. **Audit trail everywhere** — generalize the submission activity log; buyers want
   accountability.
8. **Mobile-friendly / PWA polish** — recruiters live on phones; cheap CSS work.
9. **Billing — DONE (Session 11), payments switched off.** `services/plans.js`
   holds the tiers as data and is PURE; `services/entitlements.js` counts usage
   and gates creates; `services/billing.js` is the Stripe seam (no `stripe` npm
   package — outbound HTTP goes through `http-client.js` like everything else).
   Three rules that must not be softened:
   - **A limit that is not enforced is a claim.** Every number is checked on
     CREATE and refused with **402** (a billing wall, not a 403 permission error).
   - **Being over a limit never deletes anything.** Enforcement is create-only,
     so a downgrade keeps every row and just blocks adding. Never add a code path
     that removes, hides or locks data because of a plan.
   - **Only the signed webhook may change a plan.** A browser "success" redirect
     is something anyone can type into their own URL bar.
   **Pricing is deliberately `null` on every tier** — that is the owner's call,
   and `services/plans.js` is the one place to set it. The default org is on the
   `internal` plan (unlimited), so none of this changed the live deployment.
10. **Clients as a first-class concept + document attach/send (DONE this session,
    migration `027`).** "Clients" aren't a separate table — they're `companies`
    (the same table the leads engine already uses) that have at least one
    `job_order`, i.e. leads that actually converted into business. New:
    - `client_documents` table (mirrors `candidate_documents`; reuses the private
      `candidate-docs` storage bucket under a `client/<company_id>/...` prefix).
    - **Real email attachments, for the first time anywhere in the app:**
      `sendMicrosoftNewMessage` takes an `attachments` array (Graph
      `fileAttachment`); the Gmail provider's `buildRaw()` builds
      `multipart/mixed` MIME with base64 attachment parts. `resolveEmailAttachments()`
      (index.js) downloads documents from storage and encodes them, best-effort
      and capped at ~18MB total per send.
    - `POST /candidates/email` now accepts `document_ids` — the candidate
      profile's Documents card is selectable with an "Email selected" action.
    - New **Clients** nav tab (BD/admin only — recruiters don't get it): list of
      converted clients, each with its job orders, its own documents
      (upload/select/delete), and a "✉ Email this client" compose modal that can
      attach selected documents. New endpoints: `GET /clients`,
      `GET/POST/DELETE /companies/:id/documents`, `GET /companies/:id/job-orders`,
      `POST /companies/:id/email`.

These are options to offer the owner in plain language — not a mandate to build them
unasked.
