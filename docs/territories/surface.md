# Surface — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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
