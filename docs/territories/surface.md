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
