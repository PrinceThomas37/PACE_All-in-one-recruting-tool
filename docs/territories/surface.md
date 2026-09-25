# Surface — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## Session 31 (2026-09-24) — owner's list, what changed on screen
- **Leads: the "Select connected leads to convert" bar and chip picker are GONE.**
  It was injected into the DOM once by a `render` wrapper in `25-workflow-bd.js`;
  the render engine only rewrites regions that changed, so its Convert button
  never re-lit (and once lit, never went out). Connected is now a plain strip
  filter (newest first) and every Connected row carries its own Convert button
  (`leadConvertBtn` in `06-page-leads.js` → `bdConvertLead`). **Converting never
  calls `goPage`** — Cancel leaves you on Leads. The Connected side drawer is
  gone too (`leadsShowConnected` now just filters); job link + website moved into
  the row's expand panel. `overlay-opacity-smoke` step 2 now measures the Stage
  dropdown instead of the drawer.
- **New Job form: the Job Description box is on the FIRST tab** (moved from
  Organizational) with the lead's posting link beside it and "✨ Rewrite with AI"
  (`POST /job-orders/rewrite-jd`) + Undo. No AI → `aiSubscribePopup(reason)`, a
  small opaque corner card (NOT a modal — the form is the modal). The in-job
  "Re-write job description" shows the same pop-up when it fell back to rules.
- **`putRegion` now preserves the scroll of any `[data-keep-scroll="name"]` box**
  inside a region (`03-core-render.js`). The candidate-outreach pool jumped to
  the top on every tick because its 420px box was re-created. Mark any inner
  scroller a user clicks inside.
- Candidate outreach: **From picker** (the user's own connected mailboxes, from
  `/candidate-outreach/sender.mailboxes`), `candOutreachStartFor(job, ids)` opens
  Compose → Candidates on the preview with job + people picked (used by the job
  page and the job Candidates list — ONE workflow, D-0012). Back-to-list now
  loads the pool. Email → **Pending** shows "Candidate emails waiting to go"
  (`renderCandidatePendingPanel`), and recruiters get a Pending tab.
- Candidates: selection bar has **Add to job** (one `POST /pipeline/bulk`);
  **Upload resumes** (`57-bulk-resume.js`: pick ≤25 → read one at a time with a
  progress bar → editable table → add one at a time with a count; reuses
  parse-resume, POST /candidates, documents, /pipeline — no new server path).
  New Candidate shows **Owner (you)** read-only; no picker, never sends owner_id.
- Job page: "Candidates on this job" sits right under the job card, lists
  submissions AND tagged-only rows (from `/job-orders/:id/pipeline`), selection is
  by candidate id, with Upload resumes / Email about this job / Start sequence.
- Pinned by `test/session31-flows-smoke.mjs` (30 checks, real browser, stub API;
  the scroll and owner guards were verified by reintroducing each bug).

## Session 31 (2026-09-25) — client Emails tab
- `41-page-clients.js`: loads `GET /clients/:id/intel`; when `enabled:false`
  the Emails tab is EXACTLY the old list. When on: owner sees a card (saved AI
  summary + next steps, or the free "Where things stand · from the emails, no
  AI"), the button ("✨ Generate AI summary" / "Update summary (N new)" /
  "✓ Up to date" + "Rewrite anyway", with "Uses 1 of your N today"), then every
  email newest first, expandable. A non-owner reads "Only <owner> can read this
  client's emails". AI unavailable → `aiSubscribePopup`. Pinned by
  `test/client-intel-ui-smoke.mjs` (10 checks, screenshots via SHOTS).

- 2026-09-25: an opened reply offers "Open the full email" (`clientsOpenFullMail`); our sent emails show in full.
- 2026-09-25 (owner: "just this lead list … current data"): **`58-lead-intel.js`** puts the same Emails block inside a lead's expanded row on the Leads list (`leadIntelSlot(j)` called from `leadExpandHtml`). It fills ONLY its own `#lx-intel-<id>` element and never calls render() (the lead row opens without render — rule 2 in 06-page-leads.js). Cached per lead in `STATE.leadIntel`, painted at once, refreshed on every open. Switched off → the slot is `hidden` and the row is exactly as before. Styles `.lx-intel`/`.lxi-*` in theme.css next to the lead-row block (tokens only). Pinned by `test/lead-intel-ui-smoke.mjs` (12, incl. zero render() calls; screenshots via SHOTS).

## What is true here now
- 48 modules in `public/js/`, ~19,000 lines, loaded in order by `index.html`.
  No build step. Global `window.*` + `STATE`.
- The render engine writes **only what changed**, in four regions: rail, topbar,
  page, `#layer`. A same-page repaint rewrites a region only if its html differs.
- The UI kit (`public/ui.css` + `00-ui-kit.js`) is the one layout vocabulary.
  **Every list-shaped page is converted.** The card- and board-shaped ones are
  NOT: dashboards, Admin, pipeline, My Team, Assign Leads.
- `public/mobile.css` loads last; every rule sits inside a media query. Below
  860px the rail becomes an off-canvas drawer behind `.tb-burger` → `toggleNav()`.
- The Inbox reading pane has ONE scroller for a solo message (`.mb-thread.solo`).
- **`52-poc-block.js` is the shared POC block** — the repeating contact rows,
  the duplicate-email check and "+ add another". State stays with the caller
  (`pocRegister(name, {get, changed})`), which is what lets two forms with
  different state shapes share it. **`15-ra-entry-form.js` still has its own
  older copy — retiring it into this is the follow-up**, not writing a third.
  `pocFirstError` here is a CHECKED COPY of `readContacts` in
  `services/client-resolve.js`; `test/client-intake-smoke.mjs` runs 13 cases
  through both and fails if they drift.
- **`51-company-autocomplete.js` is the shared client picker** — same shape and
  same discipline as `40-zip-autocomplete.js`: it patches only its own
  suggestions box, never `render()`, so the caret survives typing.
  `companyAcHTML(inputId, value, onPick, onType, placeholder)`. The BD New Job
  form uses it; `15-ra-entry-form.js` still has its own older copy.
- Email → **Generator** (clients) and Email → **Compose** (Clients | Candidates
  switch) are the two outreach screens. `49-page-candidate-outreach.js` has a
  ‹ › stepper that walks the picked list.
- **The morning briefing card is live on all three dashboards** (recruiter,
  manager, individual) — `renderMorningBriefingCard()` in `44-next-actions.js`,
  fetched once via `loadMorningBriefing()` from `GET /ai/morning-briefing`
  (observatory's, C-0001) and placed right after the banner, before
  `renderNextActionsCard()` and the tiles, in all three `render*Dashboard()`
  functions in `05-page-dashboard.js`. It is deliberately NOT the same pattern
  as "Needs you today": that card returns `''` on a failed fetch (silent), this
  one renders an honest amber "Could not load this morning's summary" instead
  — the owner watched the silent-vanish defect happen and named it as the one
  thing to avoid. `degraded:true` (DB unreadable) is the one case it hides,
  per observatory's contract answer. `.briefing-card`/`.briefing-*` classes
  live in `styles.css`, no inline width/grid, reflows fine at 390px.
- **C-0009 fixed (2026-09-09):** two more defects on the SAME screen the
  C-0008 screenshot showed, both in `44-next-actions.js`, neither a
  regression (predate this work, commit c5cb602). (1) `renderNextActionsCard()`
  used to `return ''` on `s._error` — silent, unlike the briefing card. It now
  reuses the SAME `.briefing-card.is-error` markup/classes the briefing card
  already had rather than writing a second version of the honest-failure
  pattern. (2) The card sat on "Working out what needs you…" forever during
  "view as", because `loadNextActions()` is correctly gated `!isViewingOther`
  (per-user queue — must stay gated) but the render had no branch for
  "gated, never fetched", so `STATE.nextActions===undefined` looked identical
  to "still loading" and nothing could ever resolve it. Fixed by adding a
  third render branch: when `isViewingOther` (computed the same way
  `renderDashboard()` does: `STATE.viewingUser && STATE.viewingUser.id !==
  STATE.user.id`) and `STATE.nextActions` is still `undefined`, render "This
  is a personal to-do queue — not shown while previewing someone else's
  dashboard." instead of the loading state. **Chose to say so plainly rather
  than hide the card** — the owner has twice named silent disappearance as
  the exact defect to avoid, and hiding it would have been indistinguishable
  from that. The fetch gate itself is untouched.
  **Rule for the next screenshot job:** never type a stubbed AI/rules-writer
  sentence by hand for a screenshot. `require('../services/morning-briefing')`
  and call `rulesBriefing(facts)` (or the matching pure function for whatever
  is being stubbed) to generate the exact text the product would actually
  produce — two screenshots in this job's own history shipped sentences the
  real checker would have rejected (`invented_number_word`) or that didn't
  match the rules writer's actual phrasing ("Six" vs "6").
- **C-0008 fixed (2026-09-09):** `loadMorningBriefing()` in `renderDashboard()`
  no longer sits behind `!isViewingOther`. Confirmed live (headless browser) that
  the old gate stuck the card on "Working out what came in today…" forever if a
  manager opened "view as" before ever loading their own dashboard this session
  — the fetch that resolves the card was the one line the guard skipped. The
  briefing is org-wide (same sentence for the viewer and the viewed person), so
  it now always fetches, unlike `loadNextActions()` (still gated — that one IS
  per-user and mislabelling risk is real there; left untouched per the
  contract's own instruction).

- **C-0011 fixed (2026-09-09):** the candidate Compose sender card and the
  queued-result line no longer assemble their own prose around
  `sender.window.label` — that is exactly the preview-vs-queue defect shape
  from Session 21 (two screens disagreeing about the same fact). The sender
  card now renders `s.window.sentence` verbatim (server-built, true either
  way — "any hour... starting as soon as this batch is queued" when the
  window flag is off, the old promise-of-a-wait sentence when it's on); the
  "Change these hours" link only shows when `window.enabled`. The queued
  banner shows the hours only when `window.enabled`, otherwise "starting
  straight away". The queue-row `reason==='window'` branch is now
  server-unreachable while the flag is off (`candidateWindowState` returns
  `open:true` unconditionally when disabled) but was left in place rather
  than deleted — it is data-driven and comes back correctly the moment the
  flag is switched on.

## Fragile — touch with care
- **`05-page-dashboard.js`, `25-workflow-bd.js`, `28-page-pipeline.js`,
  `30-page-candidate.js`, `33-stage-modal.js` each carry a copy of the ATS stage
  vocabulary.** `33-stage-modal.js` is canonical. A rename touches five of my
  files and one of `guild`'s — coordinate, never do half.
- **`48-page-outreach-gen.js`** lost `collectDom()` and `window.outreachGenerate`
  to a range-anchored edit once; `node --check` passed and the Generate button
  silently did nothing. Anchor edits on the exact text being replaced.
- **AN ANSWER THAT ARRIVES FROM THE NETWORK PATCHES ITS OWN ELEMENT, NEVER ITS
  BLOCK.** `pocCheckEmail` redrew the whole POC block when the duplicate check
  came back — about a third of a second AFTER the person had tabbed on to the
  phone box, so it replaced the field under their hands and lost what they had
  typed. **Found in a screenshot**, where a filled phone number simply was not
  there; no assertion in the suite was looking for it. It now writes one
  `.poc-email-note`. Same family as the render engine's own rule.
- **`.gc2`/`.gc3`/`.gc4` are the tool for converting an inline grid.** `.g2`/
  `.g3` also set a gap, so swapping to one of those changes spacing on every
  screen; the `.gc*` classes set columns only, so the caller keeps its inline
  gap and no wide screen moves. Use them, not `.g2`, when fixing an existing
  inline grid.
- **ANYTHING ARRIVING FROM THE NETWORK MUST NOT MOVE A CONTROL.** The POC
  block's duplicate-email answer lands ~300ms after the person has left the
  box, pushed "+ Add another contact" 20px down, and the click was silently
  lost. The empty state now reserves the line with a placeholder of the same
  shape — **by construction, not by a measured pixel count**, and note that a
  child's top margin COLLAPSES out of an empty wrapper, so padding is what
  reserves space, never margin.
- **A MODAL'S COLUMNS MUST BE A CLASS.** The New Job / Edit Job modal wrote
  `grid-template-columns:1fr 1fr 1fr` into a `style=""`, and an inline style
  cannot be re-laid-out by any stylesheet. At 390px it drew three columns and
  pushed its whole right column — **Client, Work Authorization, City, End
  Date** — past the viewport, where `#content: overflow-x:hidden` made it
  unreachable. Measured 72px off-screen. `.g3`/`.g2` already exist in
  `styles.css` and already collapse below 860px; they were simply not used.
  **Grep the other modals for inline grids before assuming this was the only
  one.** Pinned at 390px in both themes by `test/new-job-client-smoke.mjs`.
- `REWRITE_LIMIT` is duplicated here and in `services/outreach-generator.js`.
  A test asserts they match.
- `12-manager-users.js` is **orphaned** — unreachable via nav, but shares live
  code with the reachable Admin page. Needs an audit-and-split, not a delete.

## Open here
- Finish the UI-kit rollout: dashboards, Admin, pipeline, My Team, Assign Leads.
- Nothing shipped since PR #185 has been **seen working** by the owner: the rail
  icon fix, the ‹ › candidate stepper, opening a sent email, the Rewrite button,
  and now the morning-briefing card.
- ~~The daily import briefing (`/ai/generate-summary`) works server-side and
  nothing on any screen calls it.~~ CLOSED — superseded by the purpose-built
  `GET /ai/morning-briefing` (observatory, C-0001). `/ai/generate-summary`
  itself is still unwired, but is now a lower-priority, separate question.

## Session 27 — the apply-link control and an honest Sourcing screen

- **`25-workflow-bd.js` gained the Apply-link block** on the job-order detail,
  under the job description. Published is a STATE, so it offers only the action
  that state allows (Publish / Copy + Turn off) — a single toggle would leave
  the recruiter guessing whether the link is live, which is the one thing they
  must be sure of before pasting it anywhere. Handlers `bdSetApplyLink` and
  `bdCopyApplyLink` are defined in that page, per the onclick rule.
- **`32-page-sourcing.js` no longer draws unbuilt providers as cards.** Two
  built sources get cards with real actions; the other seven are one quiet
  "Not connected" list with **no controls at all**. `srcProviderInfo` was
  removed with its only caller.
- **The rule this enforces, measured:** no unbuilt provider may sit inside a
  `.card` that contains a control. See `CLAUDE.md` — same shape as the
  team-Done button.
- The apply page itself (`routes/apply.js`) renders its own standalone HTML and
  is **not** part of this territory's render engine. It has no stylesheet, no
  framework and no `STATE` — deliberately, because it loads on a stranger's
  phone over a bad connection.

## Log
- **2026-09-09** — C-0011: candidate Compose no longer over-promises a send
  window that's off by default. Verified: `verify-frontend.sh`,
  `screen-stability-smoke.mjs` (23/23), `mobile-layout-smoke.mjs` (32/32),
  `frontend-smoke.mjs` (14/14), `candidate-outreach-preview-smoke.mjs` (6/6),
  `run-all.mjs` (67/67, log-grepped). Screenshots: `compose-window-off.png`,
  `compose-window-on.png`.
- **2026-09-09** — C-0009: next-actions card no longer silent on error, no
  longer stuck loading forever during "view as". Verified: `verify-frontend.sh`,
  `screen-stability-smoke.mjs` (23/23), `mobile-layout-smoke.mjs` (32/32),
  `frontend-smoke.mjs` (14/14), `morning-briefing-card-smoke.mjs` (32/32),
  `run-all.mjs` (67/67, log-grepped). Screenshots: `dash-viewas.png`,
  `dash-na-failed.png`, both generated with `rulesBriefing()`-produced text.
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-09** — morning-briefing card built and wired into all three
  dashboards (recruiter, manager, individual). `bash test/verify-frontend.sh`,
  `screen-stability-smoke.mjs` (23/23), `mobile-layout-smoke.mjs` (32/32),
  `frontend-smoke.mjs` (14/14), `nav-icons-smoke.mjs` (40/40) all pass.
  Screenshots taken with a stubbed endpoint (busy morning, quiet day, failed
  fetch) across admin/recruiter/mobile — filenames in the report.

## 2026-09-11 — the app got a new face, and four ways a theme leaks

**`public/theme.css` (~432 lines) re-skins every screen by redefining tokens.**
Loaded last. No JS behaviour changed; deleting the one `<link>` in
`index.html` restores the old look exactly. That reversibility is what made a
change this broad safe — keep it true.

**Three theme states, not two:** `light`, `dark`, or **no `data-theme`
attribute at all**, which means follow the OS. The complete light palette is on
bare `:root`; dark is defined under BOTH `prefers-color-scheme` and
`[data-theme]`, so an explicit choice always wins. Never define a colour only
inside a media query.

**Applied inline in `<head>`, before first paint.** Deferring by one tick paints
light and snaps to dark. **`toggleTheme()` sets ONE attribute and calls nothing
else** — no `render()`; the render engine's whole point is that a repaint
changing nothing writes nothing, and re-rendering to change a colour would
reload every sandboxed iframe.

**Four ways the theme leaked, all found by the owner looking at their phone:**
1. **`ui.css` has its own palette** — `--ink`/`--ink2`/`--ink3`/`--line`/
   `--line2`/`--hover`/`--sel` — separate from `styles.css`'s `--text`/
   `--border`. Bridging one left the entire Leads table drawing `#0F172A` on
   dark glass. **Both are bridged at the top of `theme.css`; do not remove it.**
2. **Inline colours cannot be re-themed.** Swept: the dashboard clock and scope
   chip (`.bclock-time`/`.bclock-date`/`.banner-chip`), the merge-field chips
   (`.var-chip`), the Subject/Body toggle (`.seg-btn`), the login tab
   (`.login-tab`), two `#fffbeb` panels (`.warn-panel`). **And check for JS
   hover handlers that re-set the colour** — the chips had `onmouseout`
   restoring `#fff`, which would have undone any CSS fix instantly.
3. **Inversion is not theme-safe.** `background: var(--text)` = near-black pill
   in light, white pill with white text in dark.
4. **A `<canvas>` paints itself.** The login backdrop filled `#e8f5ee` with
   green particles in JS — no stylesheet could ever have reached it.
   `loginPalette()` in `11-bind-and-actions.js` reads the LIVE custom
   properties (never a duplicated hex) and re-reads on `pace-theme-change`.

**The topbar and rail have their OWN ground**, not borrowed glass. They are
translucent and the first ambient glow sat directly behind them — on a phone the
mobile glow is centred at the top, so the whole topbar rendered as a blue slab.
No contrast check flags that, because blue-on-blue-ish text still passes.

**`#nav-scrim` must never be given `position`.** It is `position:fixed`
z-index 65 in `mobile.css`; a `z-index` rule that also restated `position`
collapsed it and made the phone menu impossible to close. Never restate
`position` in a rule whose job is `z-index`.

**The rail is tappable now.** Hover-expand stays gated on `(hover:hover) and
(pointer:fine)` — width is the wrong question — but a tablet or a phone in
"desktop site" mode is wide AND touch, and got 14 unlabelled icons.
`toggleRail()` on the brand mark toggles the pre-existing `.pinned`, persisted
to `pace-rail`, and `.rail-pin` only renders under `(hover:none),
(pointer:coarse)`.

**Also this session (PR #203):** `UI.partition/horizonBar/pager/clampPage/
searchBox/countLink` + `HORIZON_DAYS` 90 / `PICKER_CAP` 15 / `PAGE_SIZE` 25,
mirroring `services/view-horizon.js` (a test fails if the constants drift). The
Jobs page went from 92x DOM growth to 1.25x. The convert picker becomes a
SEARCH past the cap, and selected items stay pinned even when a search excludes
them. `public/js/50-all-mail.js` is the All-email view.

Verified: 76/76 on Node 22 and Node 26, `verify-frontend.sh`,
`theme-contrast-smoke` 6/6, `mobile-layout-smoke` 39/39,
`ageing-layout-smoke` 4/4, `screen-stability-smoke`, `nav-icons-smoke`.
Screenshots in both themes: dashboard, leads, jobs, email, login, outreach plan.


## 2026-09-11 — the Leads row reveals itself (D-0014, first screen)

**The owner's complaint was about DISCOVERABILITY, not a missing feature.** The
email valid/invalid control existed, worked, and was visible — behind a row
click, a drawer, and a hunt for a contact card. Nothing on the row said so.

`leadRowToggle(id, ev)` + `leadExpandHtml(j)` in `06-page-leads.js`. Clicking a
Leads row opens a panel **beneath that row**, showing every contact with its
email-status select (the same `changeEmailStatus` the drawer calls — one
implementation, two doors) plus stage/industry/assignment and **Open full
record**. `UI.table` now emits `data-row-id` when a row carries `id`.

**Three rules this must keep, each protecting something already paid for:**
1. **Built on demand, one at a time.** The panel is NEVER part of the table's
   html. A hidden panel per row turns a 400-row list into 400 panels — the
   growth `ageing-layout-smoke` exists to catch.
2. **No `render()`.** It inserts and removes one `<tr>`, like `toggleNav()` /
   `toggleRail()` / `toggleTheme()`.
3. **`STATE.page` untouched.** Expanding is not navigation, and the drawer is
   not opened.

**A note on what the test can and cannot prove.** Adding a stray `render()` did
NOT fail the suite — because the render engine rewrites a region only when its
html string differs, and the panel is not in that html, so the call writes
nothing. "No render called" and "render called, wrote nothing" are the same
thing for the user, and node identity is what actually matters. The test asserts
node identity (table, scroll container and first row all survive) and that IS
the property worth holding. It does catch the break that matters: removing the
close-the-previous-panel line fails it immediately.

**And one assertion was vacuous before it was fixed** — `scrollTop` on a page
that does not scroll (Leads paginates at 20), reported as "0 → 0" and passing.
Replaced with node identity, which cannot pass emptily.

Verified: `lead-row-expand-smoke.mjs` 20/20, full suite **77/77**. Screenshots
in dark and light, desktop and phone.
- **2026-09-22** — Apply-link block on the job-order detail; rebuilt the Sourcing provider list so unbuilt sources render no action.

- **2026-09-22 (round 2)** — **THE JOBS PAGE WAS DEAD ON ARRIVAL, AND FIVE
  BROWSER SUITES CALLED IT FINE.** The owner opened Jobs and got
  `Could not draw this page: j is not defined`.

  **A BLOCK THAT READS A ROW VARIABLE MUST LIVE INSIDE THE ROW LOOP — AND A
  BLOCK CONSUMED BY ONE FUNCTION MUST BE BUILT IN THAT FUNCTION.** The
  apply-link block was written into `renderJobOrders` (the LIST) immediately
  after the row `.map(function(j){...}).join("")` closed, so the `j` it reads
  had already gone out of scope; and the `applyBlock` string it produced was
  consumed 650 lines away in `renderJobOrderDetail`, which is a different
  function. **One misplaced edit, two dead pages** — the list threw `j is not
  defined`, the detail threw `applyBlock is not defined`, and only the first
  was ever reported because nobody could reach the second. Both now sit in
  `renderJobOrderDetail`, defined directly after `jdBlock` and used ten lines
  below it.

  **`node --check` passed, and so did every existing suite.** This is the
  Session 21 rule restated with a new edge: a syntax check proves a file
  parses, and a file can parse perfectly while a variable it names does not
  exist at the point it is read. **A scope error is a RUNTIME error, so only
  running the code can find it.**

- **2026-09-22 (Session 28)** — **THE APPLICANTS SCREENS**
  (`public/js/53-page-applied.js`). Candidates gains a third tab beside All
  Candidates and Sourcing, and a job order's page carries the same list scoped
  to itself, directly under the apply link that produced it.

  **ONE LIST IN STATE, RENDERED TWICE.** `renderApplied()` and
  `renderJobApplicants(jobId)` read the same `STATE.applied.rows`; the job page
  filters that array rather than fetching its own. Two fetches would drift, and
  a preview disagreeing with the real thing is a failure this repo has already
  paid for (Session 21, the brief the queue sent vs the one the preview showed).

  * **An imported applicant stays on the list, marked `Imported`.** A list that
    drops the person you just actioned reads as though the application was lost.
  * **The tab count and the job block count NEW only** — the number is "how many
    need me", not "how many exist".
  * **Applicants are fetched WITHOUT being awaited** when a job opens. Somebody
    applying through a public link must never be able to delay a recruiter
    opening their own job; the block renders "Loading…" and fills in.
  * **`UI.toolbar` HAS NO `left` — passing one is dropped SILENTLY.** It takes
    `search`, `icons` and `right`. The first version put the applicant count in
    `left` and it simply never rendered, with no error. **Check a kit builder's
    real signature before passing it a key.**
  * **A private CV is never a plain `href`.** `appliedOpenResume` asks the
    server for a signed URL. `resume_url` holds a public URL for a CSV row and a
    private storage PATH for an application — linking it directly works for one
    and silently fails for the other.
  * Every onclick these screens emit is defined in this file (Session 21 rule),
    and `test/applicants-ui-smoke.mjs` asserts it by scanning the rendered html.

- **2026-09-22 (Session 28, round 3)** — **A GUARDED CALL TO A FUNCTION THAT
  DOES NOT EXIST IS DEAD CODE, NOT SAFETY.** The Applicants import handler
  called `loadApplicants()` and `loadSubmissions()` after a successful import so
  the candidate pool and the job's own list would refresh. **Both are
  module-local** — neither is on `window` — and both calls were wrapped in
  `if (window.x)`. So they threw nothing, did nothing, and the lists silently
  never refreshed, which is a large part of why the owner reported the import
  as having done nothing at all.

  Two named hooks now exist for exactly this: **`window.atsReloadCandidates`**
  (27-page-applicants) and **`window.bdReloadSubmissions(joId)`**
  (25-workflow-bd). `applicants-ui-smoke` asserts both are real functions —
  the sibling of the onclick rule, for calls JS makes rather than markup.

  * **THE TOAST NAMES WHAT ACTUALLY HAPPENED**, including the half that did
    not: "Saved to candidates, but not added to the job: …" when the server
    reports `job_link_failed`.
  * **A MATCH SCORE SHOWS "—" WHEN IT CANNOT BE COMPUTED, NEVER 0.** "We could
    not tell" and "a bad fit" are different answers, and a zero sorts a good
    person to the bottom of a shortlist. On a JOB's page applicants sort
    best-fit-first (everyone there applied for the same role, so the score is
    the only thing separating them) with unscoreable last; the Candidates-tab
    list stays newest-first.

- **2026-09-22 (Session 28, round 4)** — **A TILE READING "SUBS" WAS AMBIGUOUS
  AND THE NUMBER BEHIND IT WAS WRONG (D-0029).** Dashboard and My Team said
  *"Subs this week"* over a count of every pipeline row; Reports had one
  **Submissions** tile computed a third way. Labels now name what they are:
  **"To BDM this week/month"** on the dashboards, and Reports shows **two**
  tiles — **Sent to BDM** and **Sent to client**. Hot jobs reads
  *"N to client · N to BDM · N intv"* instead of a bare "subs".

  **The label is half the fix.** Two tiles that say what they count cannot
  quietly disagree the way two tiles both saying "Submissions" did.

## Session 28 — the rewind clock: one button, one panel, every record

`public/js/54-record-history.js` — `rewindBtn(entity, id)` and `openRewind()`,
with the panel registered as `UI.registerOverlay('rewind', ...)`. Wired onto
four screens: the lead modal, the job order detail, the candidate drawer and
the client drawer.

**It is ONE module on purpose.** The most expensive bug class in this repo is
the same idea implemented per screen — three lead-release paths, one stage
vocabulary in six files. A page adds history by emitting `rewindBtn(...)` and
nothing else, and a test fails if a second file ever registers that overlay.

- **A new `rewind` icon was added to the kit** (a clock with a counter-clockwise
  arrow). One mark for "what happened before now", everywhere — a history that
  looks different per screen reads as a different feature each time.
- **Date AND time AND relative AND who AND how long it held.** The owner asked
  for "date and time", so the exact stamp is always on screen and the relative
  form sits beside it as the glance — never one without the other.
- **`heldFor()` is free and is the real question.** The entry above an entry IS
  the end of it, so "held 5 days" costs nothing to compute and answers "where
  does this rot?", which is what a stage trail is actually asked.
- **Colour is scarce (D-0019): only a STAGE change earns the accent dot.** A
  field edit stays neutral. If every row shouted, none of them would.
- The panel floats, so it paints on **`--card-solid`** — `--card` is glass
  (.62 light / .055 dark) and was see-through on a phone in Session 25. A test
  reads that rule out of `ui.css` and fails if it is softened.
- No inline colours or font sizes anywhere in it: on a phone the scale comes up
  to meet the 16px input floor via classes, not `style=""`.

## Session 29 — "Didn't send" on the Email → Pending tab
Failed emails used to be visible only in the send-complete card, which expires
after 15 minutes; after that they were nowhere on screen. The Pending tab now
draws a **Didn't send** card (`.failed-panel`, calm per D-0019 — neutral ground,
3px amber stripe) listing each failed email, its stored reason, the sentence
from `retry_note`, and a **Retry** button only where `can_retry` is true, plus
**Retry all**. A pending row waiting on its backoff shows a `.retry-chip`
("Retry 1 of 3 in 14 min") in place of the window badge. The send-progress card
gained a **Will retry** chip. Loader: `STATE.failedEmails` from
`GET /emails?status=failed`; actions `window.retryFailedEmail` /
`window.retryAllFailedEmails` in `11-bind-and-actions.js`. Verified by
screenshot at 1280 light, 1280 dark and 390 phone.

## Session 29 — AI chips on Email rows
`.ai-chip` (accent tint, one chip): Pending shows "AI writes at send" on a first
email while `ai_will_write` (the template on screen is the fallback, not the
final text); Sent shows "AI-written" when `ai_written`.

## Session 29 — R-040 block on the AI budget card
`aiProviderLimitsBlock()` in `08-page-admin.js` under the Daily budget table: per provider/model, "N of M requests left today" / "tokens left this minute", amber under 15%, "Reported N min ago" ("Last reported" when older than a day). Classes `.ail*` in styles.css.

## Session 29 — lead details, and an import that stops misfiling columns
* **The lead window never drew the lead's own details.** `normaliseJob` had
  `company_web`, `job_url`, industry, salary and dates all along;
  `renderJobDetailModal` showed stage, source, notes and contacts only. The
  owner opened a lead that had just replied and could not find the posting or
  the company site. `leadDetailsBlock(j)` now draws them, plus "Other details
  from the import" (`research.import_extra`). Links go through `leadSafeUrl`
  (http/https only, bare domains get https). The Connected panel rows carry
  "Job link ↗ / Website ↗" with `stopPropagation`.
* **`55-import-columns.js` (pure, Node-loadable) replaces `COL_MAP` matching.**
  The old matcher accepted any column whose name CONTAINED a short word, so
  "Email ID" (contains "li") became LinkedIn on **all 119** live contacts, and
  "Job URL" (contains "url") could land in the company WEBSITE. There was no
  job-link field at all. Now: exact names first, partial matches only on
  distinctive words, `jobUrl` is a field, and unrecognised columns are kept in
  `_extra`. `mapCol` delegates to it; `COL_MAP` is the fallback only.
* **A COLUMN'S NAME IS A GUESS; ITS VALUE IS EVIDENCE (2026-09-23).** The
  owner's sheet headed its job-posting column **"LinkedIn URL"** (Indeed,
  Glassdoor, linkedin.com/jobs links), so name-matching filed every job link
  as the contact's LinkedIn. `valueField()` keeps a LinkedIn value only when
  it is a `/in/` or `/pub/` profile; any other web address becomes `jobUrl`,
  anything else an extra. The preview uses `columnField(name, rows)` (majority
  of the first 50 values) and says "(these are job postings, not LinkedIn
  profiles)" when it re-files a column.


- **R-045** — the import no longer drops existing leads: it sends them to `/jobs/fill-missing` and says so in the preview ("won't be added again, but anything they are missing will be filled in"). The column-mapping preview reads `ImportColumns.fieldFor` and says "kept as an extra detail" instead of "not mapped".

## 2026-09-24 — the spreadsheet's own row number is not a lead detail (D-0035)

The owner's screenshot showed a lead's "Other details from the import" listing
`S,no 94` — the sheet's own serial column, not a fact about the lead.
`55-import-columns.js` gained `isSerialColumn(name)`: normalises the column
name (`normKey`) and matches an EXPLICIT list — `sno`, `slno`, `srno`,
`serial`, `serialno`, `serialnumber`, `row`, `rowno`, `index`, `id`, `no`, plus
a raw `"#"` (which `normKey` would otherwise strip to `''`). `mapRow` drops a
matching column entirely — it never reaches `_extra`. A bare `id`/`no`/`#`
counts ONLY when the WHOLE column name is exactly that, so "Job ID", "Req ID"
and "Requisition #" still survive as extras — verified by hand
(`node -e`) against both lists before wiring it in.

- **One list, two readers.** `14-mailmerge-engine.js`'s column-mapping preview
  now says "ignored — PACE numbers records itself" for a serial column
  (instead of "kept as an extra detail"); `06-page-leads.js`'s
  `leadDetailsBlock` filters `research.import_extra` through the same
  `ImportColumns.isSerialColumn` so the 49 already-imported leads stop showing
  `S,no` immediately, before any backend cleanup of the stored rows.
- Confirmed live in a headless render: a lead imported with `S,no`,
  `Requisition #` and `Shift` in its extras shows only `Requisition #` and
  `Shift` under "Other details from the import" — the serial number is gone
  from both the modal and the import preview.

Files: `public/js/55-import-columns.js`, `public/js/14-mailmerge-engine.js`
(~:373), `public/js/06-page-leads.js` (`leadDetailsBlock`).
Verified: `node --check` on all three, `import-columns-smoke.mjs` 16/16 (still
green — no case in that suite exercises a serial column, so foundry should add
one; see below), `verify-frontend.sh`, `screen-stability-smoke` 23/23,
`mobile-layout-smoke` 39/39, `frontend-smoke` 14/14, `nav-icons-smoke` 55/55,
plus screenshots (lead-details modal, import preview).

**What foundry should pin** (none of this is covered by
`import-columns-smoke.mjs` yet):
1. `isSerialColumn` true for: `S,no`, `S.No`, `S No`, `SNo`, `Sl No`,
   `Sl. No.`, `Sr No`, `Sr. No.`, `Serial`, `Serial No`, `Serial Number`, `#`,
   `No`, `No.`, `Row`, `Row No`, `Index`, `ID`, `Id`.
2. `isSerialColumn` FALSE for: `Job ID`, `Req ID`, `Requisition #`,
   `Employee ID`, `Candidate ID`, `SSN`, `Position`, `Row Number Requested`.
3. `mapRow({'S,no':'94','Job ID':'REQ-1234','Company':'Acme'})` — the result
   has no `S,no` key anywhere (not even in `_extra`), and `_extra['Job ID']`
   is `'REQ-1234'`.
4. A lead whose `research.import_extra` already contains `S,no` (simulating an
   already-imported row) does not render it in `leadDetailsBlock`'s "Other
   details from the import" section, while a sibling key does render.

## 2026-09-24 — the candidate email card stops claiming a withheld body was never kept (D-0034/C-0025 follow-up)

Ledger's `GET /candidates/:id/email-activity` change (`routes/tracking.js`)
now withholds a `body` outside the sender's reporting scope: such a row comes
back `body_visible:false, body:null, body_note:'<sentence>'`. The candidate
profile (`30-page-candidate.js` ~:304-315) used to treat ANY null `body` as
"sent before PACE kept a copy" — which would now be a false statement for a
withheld one. Three states are now rendered distinctly:
- `body_visible===false` → the server's `body_note`, calm/muted
  (`color:var(--text3)`, no red — D-0019), never the "before PACE kept a copy"
  sentence.
- `body_visible!==false && body` → the real text, unchanged.
- `body_visible!==false && !body` → the old "sent before PACE kept a copy"
  sentence, now reserved for genuinely pre-migration rows.

Verified live: a fixture with all three states (own send with a body, a
colleague's send withheld, and a pre-migration row with no body) rendered all
three sentences correctly in one screenshot.

Files: `public/js/30-page-candidate.js` (~:304-317).
Verified: `node --check`, `verify-frontend.sh`, plus the same four browser
suites listed above.

## 2026-09-24 — C-0026 (rampart) and C-0028 (observatory): rendering what the server now scopes

Both closed; full text in `docs/territories/_contracts.md` C-0026/C-0028. In
this territory's own words:

- **`getMyJobs` (`02-state.js`) is now `return STATE.jobs.slice()`** — it used
  to re-implement the server's OLD role ladder in the browser (a bd_lead saw
  every ASSIGNED lead org-wide, 49 of them when they owned 25). `GET /jobs` is
  the boundary now; a page renders what it returns.
- **The Email page's RA Lead picker/drill-down (`07-page-email.js`) no longer
  reads message content to build its numbers.** `GET /emails/sender-summary`
  (new `loadSenderSummary()` in `11-bind-and-actions.js`, `STATE.senderSummary`)
  feeds the picker; the drill-down is now a **counts-only** card (pending/sent/
  failed + the by-timezone breakdown from the pre-existing
  `pending-summary?manager_id=`) — no row, subject or body of another BD's
  mail is ever drawn there again (D-0036). `STATE.allBDEmails` is gone.
- **A bd_lead's Pending tab now shows their team's queued/failed rows too**
  (the backend includes them per D-0034), each carrying `is_mine`. A
  teammate's row is labelled with their name; Retry and the preview's Edit
  button are hidden on it (the backend 404s/403s those for anyone but the
  sender or an admin); "Send all pending (N)", "Retry all (N)" and the confirm
  modal all count **only `is_mine`** rows, because `/emails/queue-all` only
  ever queues the caller's own regardless of what the list shows — the number
  promised has to match the number actually sent.
- **`16-insights.js`'s `e.assigned_to` counts were dead twice over**: `emails`
  has never had an `assigned_to` column (only `sent_by`, confirmed by grepping
  every migration), AND the array they read (`STATE.emails`, fetched as
  `?status=queued`) was always empty because nothing in the backend ever
  writes that status. Both fixed: `sent_by`, and reading `STATE.sentEmails`/
  `STATE.pendingEmails` instead — both already scoped to the viewer's own
  chain by the backend, so the "team overview" numbers are now both non-zero
  and correctly bounded.
- **`48-page-outreach-gen.js`'s "Convert to lead" is keyed on `r.id`, never
  `r.token`** — a token is a credential (drives the open pixel + tap-through),
  an id is a handle. `outreachConvertLead(id)` posts `{id:...}`.

Files: `public/js/02-state.js`, `public/js/07-page-email.js`,
`public/js/11-bind-and-actions.js`, `public/js/18-email-status-actions.js`,
`public/js/16-insights.js`, `public/js/48-page-outreach-gen.js`.
Verified: `node --check` on all six, `verify-frontend.sh`,
`screen-stability-smoke` 23/23, `mobile-layout-smoke` 39/39, `frontend-smoke`
14/14, `nav-icons-smoke` 55/55, `outreach-generator-smoke` 138/138, plus
screenshots (bd_lead Pending tab with an own + a teammate row, the RA Lead
picker reading sender-summary, the RA Lead drill-down showing counts only).

**What foundry should pin, none of it covered today:**
1. A bd_lead's `GET /emails?status=pending` fixture with one `is_mine:true`
   and one `is_mine:false` row renders: the teammate's row carries their name
   and NO Retry/Edit control anywhere in that row's markup; "Send all pending"
   and "Retry all" counts equal the `is_mine` count, not the total.
2. An RA Lead's Pending-tab picker, given only `STATE.senderSummary` (no
   `STATE.pendingEmails`/`allBDEmails`), still renders every BD with correct
   numbers — the old bug (grouping an empty/narrowly-scoped `GET /emails`)
   would have shown every BD at zero.
3. An RA Lead's drill-down never emits a recipient address, a subject or a
   message body anywhere in its rendered html — only digits and the BD's own
   name/timezone labels.
4. `outreachConvertLead` and the Sent-list button never reference `.token`
   anywhere in `48-page-outreach-gen.js` (grep), only `.id`.

## 2026-09-24 (round 2) — three more D-0034/D-0035 follow-ups mid-session

- **`41-page-clients.js`'s `recentEmailsCard`** gets the same three-state fix
  as the candidate card: `body_visible===false` renders `a.body_note` (calm,
  muted); the "sent before PACE kept a copy" sentence is reserved for a
  genuinely empty-but-visible body. **Checked and NOT changed:** there is no
  Edit-client or Delete-client control anywhere in this file today (grepped
  for `apiPut`/`apiDelete` against `/companies/:id` with no sub-path) — so
  there is nothing to hide there yet. Upload-document and delete-document
  already toast `e.message` verbatim, which is the server's exact 403
  sentence (`apiFetch` in `22-api.js` throws `new Error(d.error||...)` on any
  non-ok response) — confirmed by reading the code path, not assumed.
  **Left for gateway/a later pass:** `GET /clients` does not carry an owner
  id/name today, so the Upload/Delete-document buttons on a non-owner's
  client are still drawn unconditionally (they will 403 correctly if clicked,
  named plainly, but the Session 24 "don't draw a button that will refuse"
  rule is not fully met here the way it now is on job orders). Needs a
  contract to gateway for an `owner_id`/`can_edit` field on `GET /clients` /
  `GET /companies/:id` before that can be fixed properly.
- **D5 duplicate-lead check (`14-mailmerge-engine.js` `dupEmailMap` +
  `renderDuplicateWarningModal`)** now reads guild's shipped shape from
  `POST /jobs/check-duplicates` — `{email, duplicate:true, owner_name, since}`
  — and says "already on `<owner_name>`'s lead since `<date>`", never the
  other lead's company/position/contact. Verified in a screenshot with two
  fixture rows (one with an owner name, one without, to check the fallback
  sentence: "already on someone else's lead").
- **Job orders carry `poc_visible` now (D-0035, `services/job-order-visibility.js`,
  gateway).** `client_manager` is the only POC field in the live schema. In
  `25-workflow-bd.js`'s `renderJobOrderDetail`: a `canOwn=j.poc_visible!==false`
  gates the "Edit job" button and every apply-link control (Copy link / Turn
  off / Publish apply page) — those endpoints now 403 a non-owner, and Session
  24's rule is never draw a button that will refuse. A non-owner still sees
  the apply link's live/off state and applicant count (candidate-facing
  information stays visible per D-0035), just no controls to change it. Where
  "Client Manager" would show, a non-owner sees a quiet
  "Client contact: visible to the job owner" line instead of a blank row.
  **Checked:** no Delete-job-order control exists anywhere in this file
  (grepped) — nothing to hide there either. **Verified a recruiter (or any
  non-owner) opening a job they don't own renders sensibly** — screenshot with
  `poc_visible:false` shows the full candidate-facing page (title, client
  company name, JD, apply-link status, applicants, recruiters, candidates)
  with no crash and no leaked contact name.

Files: `public/js/41-page-clients.js` (~:229-239), `public/js/14-mailmerge-engine.js`
(~:557-596), `public/js/25-workflow-bd.js` (~:987-1036).
Verified: `node --check` on all three, `verify-frontend.sh`,
`screen-stability-smoke` 23/23, `mobile-layout-smoke` 39/39, `frontend-smoke`
14/14, `nav-icons-smoke` 55/55, `applicants-ui-smoke` 14/14 (shares
`25-workflow-bd.js`'s job-detail render path), plus screenshots: the
duplicate-lead modal, and a job-order detail rendered both as owner and as
non-owner.

**Open contract worth raising (not opened yet, noted for next session or the
orchestrator):** `GET /clients` needs an owner hint so the client Upload/
Delete-document buttons can be hidden for a non-owner the same way job orders
now are — today they are drawn unconditionally and rely on the 403 toast alone.

## 2026-09-24 (round 3) — "Ask to take over" (R-047, D-0036/D-0037/D-0038)

**One new module, `public/js/56-ownership-requests.js`, is the whole feature.**
Every door — the client page, the job-order detail, the lead drawer, the
import's duplicate-warning modal, the new-contact "already exists" note, and
the manager's approval screen — calls into this one file. Coded to the API
shape gateway/guild described (not landed yet at time of writing): `GET
/ownership-requests/can-request`, `POST /ownership-requests`, `GET
/ownership-requests?box=mine|waiting|record`, `POST .../:id/approve|decline|
cancel`; guild's `lead_id`+`can_request` on `POST /jobs/check-duplicates` and
`/contacts/check-email`.

* **`otSlot(kind, recordId, viaEmail)` draws NOTHING until the server answers,
  and draws nothing at all if the answer is no** (Session 24's rule, restated
  for a new feature: never a button that will refuse). Three outcomes only:
  empty, "Ask to take over" + "\<name\> decides.", or "Requested · waiting on
  \<name\>" + Withdraw. **Cached per (kind, record, via_email)** so a tab
  switch or an unrelated repaint renders the answer synchronously — no
  flicker, no repeat network call — until a submit/withdraw invalidates it.
  Patches its own `<div>` when the answer lands, same family as the POC
  duplicate-email check (52-poc-block.js).
* **The ask modal uses the app's existing plain `STATE.modal` idiom**
  (clientsOpenEmail / bdOpenAssign / the duplicate-warning modal all do this
  already) rather than a second overlay mechanism — one fewer pattern in the
  app, not a new one.
* **The duplicate-warning link needs no pre-check**: the server already
  computed `can_request` when it found the duplicate (proof of the right to
  ask is that the person just typed that exact email), so the link is
  conditional on the flag alone. Opening its modal does its OWN can-request
  fetch (no approver name known yet) to confirm eligibility and get the
  approver's name before Send is enabled — a genuine race is possible between
  "duplicate found" and "click the link".
* **Placement mirrors each screen's existing ownership gate** — never a new
  one: the client page always asks the server (no owner id on `GET /clients`
  yet, see the open contract above); the job-order detail reuses `canOwn =
  j.poc_visible!==false` (D-0035); the lead drawer reuses `canEdit` (already
  exactly "am I this lead's owner").
* **Approvals live next to "Needs you today"**, not on the Reminders page. The
  app had already decided a manager reviews their team's open work there
  (`naTeamLine`/`naOpenTeam`, D-0020) — a take-over request is exactly that
  kind of review, and the Reminders page (`10-page-modals.js`) is personal-only
  (`myReminders` filtered by `user_id`), which is the wrong shape for
  something a manager approves. `renderOwnershipSummaryCard()` is a quiet
  standalone card (own line, `.na-hidden` styling, D-0019: no red, appears
  only when `waiting_count` or "my requests" count is non-zero) placed right
  after `renderNextActionsCard()` on all three dashboards. Loaded once per
  visit like next-actions/the morning briefing — **nothing here polls on a
  timer**. Clicking either half opens one modal with two tabs, "Waiting on
  you" (Approve/Decline, decline reveals an inline optional-note box, never
  `prompt()`) and "My requests" (pending/approved/declined/withdrawn, a stripe
  + one chip, no red — D-0019, verified by screenshot with all three
  non-pending states).
* **After a decision, three named globals refresh the lists that show
  ownership** — `refreshJobs()` (already a top-level global in `22-api.js`),
  and two new ones added for this: `window.clientsReload` (`41-page-
  clients.js`) and `window.bdReloadJobOrders` (`25-workflow-bd.js`). Called
  directly, not behind `if(window.x)` — CLAUDE.md's rule that a guard around a
  call that is SUPPOSED to happen converts a crash into a silence. (The
  `otSlot`/`rewindBtn`-style `window.x?x():''` guards used at the three button
  placements are a different case — an optional decoration that may
  legitimately not exist yet on a page mid-render, the same precedent
  `rewindBtn` already set in this codebase.)
* New CSS: `.ot-*` classes appended to the end of `styles.css` (no inline
  colours, no inline widths — reuses `.na-act`/`.na-act-quiet`/`.btn`/`.modal`
  for everything that already has a themed class). Reflows at 390px: the panel
  becomes the existing bottom-sheet dialog treatment, Approve/Decline get
  40px touch targets under `@media (max-width:860px)`.

**Verified:** `node --check` on all seven touched files; `bash
test/verify-frontend.sh`; `node test/page-renders-smoke.mjs` 7/7; `node
test/mobile-layout-smoke.mjs` 39/39; `node test/theme-contrast-smoke.mjs`
10/10; `node test/frontend-smoke.mjs` 14/14; `node test/nav-icons-smoke.mjs`
55/55; `node test/screen-stability-smoke.mjs` 23/23. Screenshots taken with a
stubbed `apiGet`/`apiPost` (Playwright, run from the scratchpad — not added to
`test/`) at 1280px and 390px: client page as non-owner with the button, the
request modal, the duplicate-warning modal (one row with the link, one
without — `can_request:false`), the approvals panel with two waiting requests,
the "My requests" tab (pending + declined), the dashboard summary line, the
lead drawer as a non-owner, the job-order detail as a non-owner, and the
approvals panel reflowed on a 390px phone.

**Not run:** the full `npm test` (task said not to). **Files I did not touch:**
`test/*` and every other territory's paths — did not touch them.

**What foundry should pin** (none of this is covered by any existing suite):
1. `otSlot` renders nothing while `can-request` is pending, the button+
   "\<approver\> decides" once `ok:true` lands, and "Requested · waiting on
   \<approver\>" once a record-scoped pending request from the caller is
   found — never more than one of the three at once.
2. A duplicate-warning / already-exists note with `can_request:false` never
   renders the "Ask to take over" link; one with `can_request:true` does, and
   clicking it opens the modal with `kind:'lead'` and the typed email as
   `via_email` — with NO `record_id` anywhere in the request (see round 3 log
   below: `lead_id` is gone from this response entirely).
3. Approving/declining in the panel calls `refreshJobs()`,
   `window.clientsReload`, and `window.bdReloadJobOrders` — and none of them
   throw when the corresponding page has never been visited this session
   (module-scope `STATE.bd`/`STATE.clients` may not exist yet).
4. The "My requests" tab never shows Approve/Decline (`can_decide` is a
   `waiting`-box-only concept); the "Waiting on you" tab never shows Withdraw.
5. A repeated `otSlot()` call for the same (kind, record, via_email) within one
   session does not re-issue the network call — the cache is genuinely used
   (this is the property the render-engine "idle repaint writes nothing" rule
   depends on here, at the level of network calls rather than DOM writes).

## 2026-09-24 (round 4) — R-047 review fixes: data-attributes, not JS-string interpolation (F1/F3), and the `lead_id` removal

Fixed everything rampart's re-review flagged in this territory (R-047 review,
"Surface (56 + call sites)" section).

* **F1 (script injection).** `otSlotInner`'s Withdraw / "Ask to take over"
  buttons, and the duplicate-warning links in `14-mailmerge-engine.js` and
  `52-poc-block.js`, used to build `onclick="fn('...')"` by concatenating
  `esc()`/`htmlEsc()`-escaped values straight into the JS-string literal.
  **That escaping only protects the HTML ATTRIBUTE — the browser decodes the
  attribute before the JS string inside it is ever parsed**, so an escaped
  `'` still closes the string early: an owner name like `O'Brien` broke the
  button (truncated the call, threw on click), and a contact email such as
  `x');alert(1);//@a.co` — which still matches the app's own email shape check
  — was stored XSS, fired the moment a BD's screen rendered that duplicate
  warning. Every one of those values now travels as a `data-*` attribute
  (`data-kind`, `data-record-id`, `data-via-email`, `data-approver-name`,
  `data-req-id`, `data-slot-id`), read back with `el.dataset` by two new
  handlers — `otOpenFromEl(this)` / `otWithdrawFromEl(this)` — which never
  re-enter JS-string parsing at all. Verified live (headless Playwright, both
  screenshots below): the hostile email renders as inert text with no popup,
  clicking the link still opens the modal, and `O'Brien` renders correctly as
  the owner name without breaking anything.
* **F3.** The ask-modal's refusal read `can.why`, which the server never
  sends (it sends `reason`) — every real refusal sentence was silently
  swallowed and replaced by the generic fallback. Now reads `can.reason`.
  The status-chip map had `withdrawn` as a key; the stored status is
  `cancelled` — the chip fell through to the raw word "cancelled" instead of
  saying "Withdrawn". Fixed the map key; added `.ot-chip.cancelled` /
  `.ot-row.st-cancelled` alongside the pre-existing `.withdrawn` classes in
  `styles.css` (kept both — harmless, and cheap insurance against a future
  caller that does emit "withdrawn").
* **No more `lead_id` on duplicates (guild's option (a)).** The
  duplicate-warning link in both `14-mailmerge-engine.js` and
  `52-poc-block.js` now checks only `d.can_request` (no `lead_id` in the
  condition or stored in `dupEmailMap`) and posts `{kind:'lead', via_email}`
  with no `record_id` — the server resolves the lead from the email itself
  (D-0038's `viaDuplicateEmailMatch`).
* **`can-request` moved from a GET query string to POST**, body
  `{kind, record_id?, via_email?}` — per gateway's new contract and rampart's
  L3 finding (a prospect's email address in a GET query string ends up in
  server access logs). Both call sites (`otFetch`, used by every `otSlot()`,
  and `otCheckForModal`, used by the ask modal) now POST.
* **`52-poc-block.js` was already safe on `company`** — `d.company` was
  already rendered behind `d.company ? … : ''`, so guild dropping that field
  from `/contacts/check-email` needs no change here; confirmed by reading the
  code path, not assumed.

Files: `public/js/56-ownership-requests.js`, `public/js/14-mailmerge-engine.js`,
`public/js/52-poc-block.js`, `public/styles.css` (`.ot-chip.approved` — a
pre-existing hard-coded `#E7F7EC`/`#166534` in the same file, flagged by the
coordinator via `reminder-clarity-smoke.mjs`'s "palette is tokens only" check
because it sits in the CSS block after the REMINDERS marker that test scans —
now `var(--green-l)`/`var(--green)`).

Verified: `node --check` on all three touched `.js` files; `bash
test/verify-frontend.sh`; `node test/page-renders-smoke.mjs` 7/7; `node
test/mobile-layout-smoke.mjs` 39/39; `node test/theme-contrast-smoke.mjs`
10/10; `node test/screen-stability-smoke.mjs` 23/23; `node
test/reminder-clarity-smoke.mjs` 51/51 (was 50/51 before the CSS token fix).
Screenshots (headless Playwright, stubbed `apiGet`/`apiPost`, run from the
scratchpad — not added to `test/`): the duplicate-warning modal with the
hostile email + apostrophe owner name rendering as plain text, and the
resulting "Ask to take over" modal after clicking through, showing
`Manager O'Hara decides.` intact and the POST body correctly shaped
`{kind:'lead', via_email:"x');alert(1);//@a.co"}` with no `record_id`.

**What foundry should pin, none of it covered today:**
1. `otSlotInner`'s Withdraw and "Ask to take over" buttons carry their kind/
   record id/via-email/approver-name as `data-*` attributes, never inside the
   `onclick` string itself (grep `onclick="ot(Open|Withdraw)FromEl\(this\)"`
   and assert the values live on the element, not in the handler call).
2. A record/name/email containing a single quote (`O'Brien`, or an email
   containing `');`) renders as literal text in the duplicate-warning link and
   the ask modal, AND clicking the link still opens the modal and issues the
   correct `can-request` POST body — i.e. both "doesn't break" and "still
   works" are asserted, not just the first.
3. `otFetch`/`otCheckForModal` call `apiPost('/ownership-requests/can-request', …)`,
   never `apiGet` with a query string containing `via_email`.
4. A duplicate-warning response with `can_request:true` and no `lead_id`
   field at all still renders the link, and clicking it posts
   `{kind:'lead', via_email:<the email>}` with `record_id` absent (not `null`,
   not `undefined` as a literal key — genuinely absent from the JSON body).
5. `otStatusChip('cancelled')` renders "Withdrawn"; `otStatusChip('withdrawn')`
   (should the server ever send that word) still renders "Withdrawn" too.

