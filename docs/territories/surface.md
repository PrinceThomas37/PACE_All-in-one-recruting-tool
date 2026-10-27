# Surface — memory
> Trimmed 2026-10-26 (R-308): 176 KB → live rules + recent work, because every Surface agent reads this file first.
> Nothing was deleted — the full history (every session's entry, every reason) is in `docs/territories/surface-archive.md`;
> grep it by heading or R-/D- number when you need the why. New entries go HERE, at the bottom.

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


## Recent work (2026-10-12 onward; older entries are in surface-archive.md)

## 2026-10-12 (Session 44) — "Review & send" opens one lead; Send selected (R-193)
- `18-email-status-actions.js` `pendingView()` is the ONE home of the Pending tab's narrowing and ticking: a focus (`STATE.pendingFocus = { jobId, label }`) narrows the list to one lead; with a focus the person's OWN rows start ticked, without one nothing is; a tick is `STATE.pendingSel[id]` true/false, "not stored" means that default. Only `is_mine` rows can be ticked. `openSendSelectedConfirm` names the recipients; `submitSendSelected` posts `/emails/send-selected` with exactly the ticked ids (never queue-all). A wrapper on `goPage` and `setEmailTab` drops the focus — it is for one visit.
- `07-page-email.js` Pending (BD view): tick column + header box, a card banner (NOT `ld-box` — that box is unreadable on the Email page in the retro theme), "Send selected (n)" beside "Send all pending (N)" (the latter is the outline button while a focus is on). The banner counts only the person's own emails.
- `68-page-finder.js` `fdGoPending(histId)` sets the focus from the saved lead; "See it" (a failed first email) still opens the tab as it is.
- Not done: the Accept window's job pills and person details (R-197) — a real click selected every pill in a probe; waiting on the owner's exact screen.

## 2026-10-12 (Session 44) — Email setup panel (R-200 step a, D-0120)
- `45-org-domains.js`: an "Email setup" button on each domain opens a panel under the domain list (`STATE.emailSetup`): items with a ✓ / ○ / i mark, the exact record with a Copy value button, a DKIM selector box when DKIM is missing, "Copy for your IT person", "Check again", Close. Nothing is decided in the browser. A connection that does not exist yet is said not to exist (a screen must not advertise it). Not fixed: the Admin header still prints "Fute Global LLC" for every organisation (`09-page-workflows.js` ~line 785) — a customer's admin would see another company's name.

## 2026-10-12 (Session 44) — My Setup: the app-password window (D-0121)
- `69-page-mysetup.js`: "+ Add mailbox with an app password" appears only when `GET /smtp/enabled` says the server can store passwords; an app-password mailbox is labelled "App password" and offers "Enter the app password". The window (`mySetupSmtpOpen`) shows the provider's guide, a hidden password box, and — for a provider PACE does not know — the server boxes; each step the server returns is a ✓ or ✗ with its sentence; success ends on a "Mailbox ready" card that says the in-app inbox is not available. The password is read from the box at the moment of pressing Connect and is never kept in `STATE`. `20-email-accounts.js` labels the type "App password".

## 2026-10-12 (Session 44) — "Mailbox ready" says the admin's limit (D-0122)
- `69-page-mysetup.js`: the card now reads "Its daily limit is N emails, as set by your admin." instead of announcing a starting limit.

## 2026-10-12 (Session 44) — D-0123
`public/js/69-page-mysetup.js` no longer shows a made-up 150 for a mailbox with no number of its own. The numbers shown come from the server (the admin's).

## 2026-10-13 (Session 44) — D-0124
System Settings (`08-page-admin.js`) shows 'Set for your company' or 'Using the shared value' under each number, and a cleared box on a company's own number goes back to the shared one.

## 2026-10-13 (Session 44) — D-0125
No screen code changed; the new numbers appear in System Settings automatically (the screen is generated from the schema). The follow-up count picker still offers 1–5 — a number above the company's maximum is refused in words by the server.

## 2026-10-13 (Session 44) — the window refresh, and the Find Leads screens
`03-core-render.js`: `patchModalInPlace(layer, html)` — when the open window is the same one (same panel class + same heading) and nothing else in the layer changed, only its inside is rewritten; scroll boxes are put back by tree path, focus is restored without scrolling. A different window, or any other layer change, is written whole as before. `68-page-finder.js`: limits from `F.access.limits` (`lim()`), counter/inline message/dimmed pills/Show all in the Accept window; `placesOf`/chips for places; `searchingBox()` (pure-CSS bar, no timer repaint); `fdEditNow()` + `F.lastFind` on the results; `firstEmailToast`. CSS in `retro.css`: `.fd-pill.is-full`, `.fd-progress`, `.fd-bar`, `.fd-spin`.

## 2026-10-13 (Session 44) — Blocked contacts
`CONTACT_STATUSES` / `CONTACT_STATUS_LABELS` (01-constants.js) are the one browser list; both contact menus in 06-page-leads.js use it; a refused change resets the menu (`changeEmailStatus` reloads). `{{jobs}}` added to the sequence builder's accepted names (`WF_VARS`), the chip list and `clientJobsText` (03-core-render.js).

## 2026-10-14 (Session 44) — the owner's handwritten notes (D-0135)
`71-places-data.js` (new, loaded after 70 in index.html): `window.PLACES.suggest(typed, max, skip)` — reference data for the Find Leads place box (US states + cities, India states + cities, Remote). `68-page-finder.js`: `fdPlaceType/Key/Pick/Hide`, a `.fd-sugg` box drawn directly (no repaint); the spinner (`.fd-spin`) is gone, only `.fd-bar` stays. `67-take-leads.js`: `leadTakeSelected(id?)` and `openTakeLeads(ids?)` (window variant for picked ids); `06-page-leads.js`: bulk-bar **Take lead** (BD / BD lead; disabled with a reason when none is Unassigned) and **Take this lead** in `leadExpandHtml`. `59-lead-posting.js`: `leadPostingShow` — an attached posting is read first (`.lxp-read`), Edit inside it.


## 2026-10-14 (Session 44) — page three of the owner's notes (D-0140)
`68-page-finder.js`: the "another" window has the people search (`fdAnFind`, `fdAnReveal`); `reviewLead(leadId, company)` + `fdReview/fdRvSave/fdRvSend/fdRvClose` is the read/edit/send window for a lead's first email (opens after an email is written; "Preview & edit" on `emailRow`). `18-email-status-actions.js`: `openDeletePendingConfirm` / `submitDeletePending`; buttons in `07-page-email.js`. `06-page-leads.js`: `leadFromFinder(j)` → "Lead Finder" pill (replaces NEW) and a "Found by" fact. CSS `.fd-rv-*` in `retro.css`, `.fd-sugg*` earlier.
## 2026-10-14 (Session 45) — the owner's fourth page (D-0141)
`03-core-render.js` `patchShell`: `patchModalInPlace` now runs whenever the layer holds the same window (it used to run only when the overlays were unchanged, so an overlay window — the mailbox label picker — was rewritten on every click). `47-page-mailbox.js`: signature cache is PER MAILBOX (`m.sigCache`/`m.sigBusy`, `loadSignature(acct, force)`; re-fetched each time a window opens; `renderSigRow(on, setFn, acct)`). `01-constants.js`: `PAY_PERIODS`, `jobPayText(j, empty)`, `payPeriodFromText(t)`; `25-workflow-bd.js`: "Per…" select, `bdPayPeriodBody` (the field is sent only when chosen or cleared from a value), default Jobs tab is 'mine'. `22-api.js` `normaliseJob` now carries `auto_replied_at` (a field not listed there never reaches a screen). `06-page-leads.js`: **Auto-replied** pill (stage Assigned only), **Edit lead** button (`canEditLead`), "Found by" clamped to 60 chars in the side panel, a delegated `pointerover`/`touchstart` prefetch on `tr[data-row-id]` lead rows. `62-poc-finder.js` / `58-lead-intel.js`: `leadPocPrefetch` / `leadIntelPrefetch`; a hover-fetched answer is used ONCE (`st.pre`) and not re-fetched on open; later opens re-ask. NEW `72-lead-edit.js` (`openLeadEdit`, `leadEditSet/Save/Close`, advisory hint under Found by / Job link; the server is the rule). `14-mailmerge-engine.js` shows `tidiedNote` after an import. Guards: `mailbox-no-flash-smoke`, `mailbox-signature-per-account-smoke`, `lead-open-prefetch-smoke`, `lead-edit-smoke`, `job-pay-period-smoke` (+ `row-reveal-smoke` now asserts the Jobs default).
## 2026-10-14 (Session 45, later) — suggestions, search, People in Edit lead
`47-page-mailbox.js`: `listPath` sends NO `folder` while `m.q` is set; `lkey` remembers a searched list under '*'; `mbSelectFolder` leaves the search; the folder menu shows "All folders — search results"; each result row gets a `.mb-in-folder` pill and decides sent/inbox display from ITS OWN folder (`rowFolder`). Address suggestions inside `chipField`: `mbSuggestFor(typed, have, acct)` ranks (starts-with address 0, name word 1, contains 2/3; then source memory < open mailbox < PACE contacts), `.chipf-sug` is drawn INSIDE the box (dies with it on a repaint), a suggestion is taken only after arrow keys or a click (never auto-picked on Enter/Tab), `loadRecipients(acct)` asks `GET /mailbox/:mid/recipients` once per 5 min; `suggestAcct()` picks the reply window's mailbox or the open one. `styles.css`: `.chipf{position:relative}`, `.chipf-sug*`. `72-lead-edit.js`: People section from `GET /jobs/:id/edit-rights` (never drawn on a guess), only changed people/fields sent to `PUT /contacts/:id`, a refusal names the person and says the lead itself was saved; `.le-*` in `retro.css`. `68-page-finder.js` `fdAnSave`: a `same_person_elsewhere` 409 opens `showAlreadyAdded` (Add anyway → resend with `acknowledge_repeats`, Don't add → back to the window). Guards: `address-suggest-smoke`, `mailbox-search-all-folders-smoke`, `lead-edit-smoke` (People), `finder-page-smoke` (pop-up).
## 2026-10-14 (Session 45, last) — a search result with no folder
`47-page-mailbox.js` `renderRow`: while searching, a row's folder is `x.folder_id` ONLY (the first draft fell back to the OPEN folder, which would have labelled an archived Gmail result "Inbox"); a Gmail result with no folder reads **All Mail**. Guard: the archived-result step in `mailbox-search-all-folders-smoke`.

## 2026-10-14 (Session 46) — compose/reply windows: draft per window, several at once, tray bottom-right (R-240, D-0145)
- **Why the text vanished:** `Dock.minimise` parked `STATE.modal` (html drawn at paint time, BEFORE the typing) and `snapshot()` read only input/textarea/select — the message body is a `contenteditable`, so it came back blank. `reply-window-smoke` and `window-dock-smoke` checked the hidden store (`#mb-comp-body`, `#mb-c-body`), which was restored, so both stayed green. **Guard now reads the box a person sees** (`#mb-comp-editor`.textContent).
- **`10a-window-dock.js`:** `Dock.onPark(kind,{take,put,render,title})` — minimise calls `take()` (the window's own draft object goes on the chip, the page's single slot is emptied); restore calls `put(ctx)` then `render(ctx)` so the window is DRAWN FROM THE DRAFT. `Dock.parked(kind)` lists chips with their drafts; `Dock.discardCtx(ctx)` removes the chip of a window whose send finished while parked. `snapshot()` also keeps contenteditable boxes (belt-and-braces for windows with no hook). `updateParked` stays but the mailbox no longer needs it.
- **`47-page-mailbox.js`:** `M().compose` / `M().composer` now mean "the window ON SCREEN" — a minimised window's draft lives on its chip (`it.ctx`). `composeHtml(c)` / `composerHtml(c)` are pure builders; `paintComposeModal(open)` / `paintComposer(open)` repaint ONLY a window that is on screen (`winOnScreen(kind)`) unless opening — a late signature/attachment can no longer open a closed window. `parkOnScreen()` minimises what is on screen before another opens. Reply windows are keyed by `draftKey` (mailbox + email + reply/forward); a second Reply on the same email restores the parked one. New message carries `acct` (the mailbox it was started from) — before, switching mailbox while it was minimised changed who it sent as. Send completion closes the right window (screen or chip), never whatever is open.
- **Tray:** `#win-tray` is `right:12px;bottom:12px`, `flex-direction:row-reverse`; a dragged chip is `position:fixed` at `--chip-x/--chip-y` (pointer events, 8px threshold, a drag never opens it, clamped to the screen, remembered until reload). Phone (≤860px) keeps the scrolling row. Chip titles: `New: <subject or first recipient>` / `Reply to <name>`.
- **Known gap:** the position is not kept across a reload; MAX_PARKED stays 6.
- **Reply → Reply all on the same email (found by `mailbox-page-smoke` in the full run):** if the open/parked reply has NO words, it is swapped for the new mode (as before); with words, the started one comes back. `mailbox-page-smoke` 80/80 is the guard.
## 2026-10-14 (Session 46, follow-up) — the narrow-layout tray was still bottom-LEFT (R-240)
- Owner, right after #337 deployed: "the window again minimizes to bottom left". The wide layout was right-anchored; the ≤860px layout (`mobile.css`: `#win-tray{left:8px;right:8px;flex-direction:row}`) left-aligned its chips. That layout is also what a **zoomed-in or narrowed desktop window** gets (the media query sees width AFTER zoom: 1440px at 175% is ~823px). Fix: `justify-content:safe flex-end` on that row (`safe` keeps a long row scrollable instead of clipping its left end). `window-dock-smoke` 40/40 adds a phone-width and an 800px-desktop check that FAIL without the rule (chip 8px from the left).
- The other possible cause, not provable from the sandbox: a tab opened before the deploy keeps the old CSS/JS until reloaded (only `.html` is served no-cache; `.css`/`.js` get the default ETag caching).
## 2026-10-14 (Session 46, labels) — a Label row in the compose windows (R-244, D-0146)
- `47-page-mailbox.js`: `labelRowHtml(which,c)` is drawn in `composeHtml`/`composerHtml` (above the signature row); each window's draft carries `labels:[{id,name}]`. `mbWinLabelAdd/Remove/New` act on the on-screen window (`winBag`), flush pending To/Cc chips first, repaint through the guarded `paintComposeModal`/`paintComposer`. A NEW label is created in the mailbox first (`POST /mailbox/:mid/labels`, the inbox's own route) and a name that already exists (any capitals) is picked, not duplicated. `ensureLabels(acct)` now takes an account and repaints an open window when the list arrives. Hidden for any mailbox whose platform is not Gmail/Microsoft. `ui.css` `.mb-win-lbl`, `.mb-lbl-x`, `.mb-lbl-pick/-new`. Send adds `label_ids` (ids; Outlook's id IS the category name); a `label_error` in the response is a warning toast, never a failed send.
- **Found by the full run (14 Oct, before merging #338):** `winLabels` returned the stored label list as-is; `mailbox-page-smoke` and `screen-stability-smoke` (whose stub answers `{}` for unknown paths) died with `winLabels(...).filter is not a function`. Fixed to `Array.isArray` (a non-list is "no labels"); `reply-window-smoke` 30/30 pins it. A reminder that the targeted suites I ran for the labels work were not the whole run.

## 2026-10-15 (Session 47) — design only: the first-sequence journey mock (R-245, R-247, R-248)
- Mock (not in the repo): https://claude.ai/artifact/63chan7L76bJ919Z4aQehd — six steps (who, write, if missing, when, try and start, after). Decisions behind it: D-0147. The detail picker becomes one grouped drop-down in plain words with an example per line (replaces the `MERGE_VAR_GROUPS` chip bar in `03-core-render.js`); a dashed chip marks a detail that may be missing; each used detail gets a "leave out / backup words / hold" rule; the sequence view is a plain list or a flow chart — **the owner has not chosen**. "Use the starter" in My Setup goes away in favour of an empty, coached box (D-0119).
- **Later 15 Oct (D-0148): the first mock was replaced by three screens.** A customer's first-run screens show only what the customer does: Who → Write → Start; one line of help each; no flow chart, stop-rule list, missing-detail table, AI switch or evidence. The detail menu offers only details every lead has (first name, company, job title, city; candidates: first name, job title, city) as short plain-word highlights inside the text, not bordered chips. Rule for all new-user flows: if a sentence explains our design rather than helping the user act, it does not ship.
## 2026-10-15 (Session 47) — R-258 built: "Write your first sequence" (public/js/73-sequence-setup.js)
- New page `seqsetup` (title "My Setup", the My Setup nav item stays lit — `04-shell-login.js`). Opened by `openSequenceSetup()` from My Setup's sequence step (`69-page-mysetup.js`: "Write my sequence" / "Open it"; "Use the starter" removed from the step).
- The page registers its OWN painter: it rewrites #content only when its skeleton (the page html with editor contents and the live preview blanked) changes, so typing never repaints and the app's timed renders never move the caret. State is written on every input (`onEdit`); `repaint()` must NOT read the editors back (an AI answer arriving after a click is newer than the DOM — that bug was caught by the browser test).
- Editors are contenteditable with details as `.sq-chip` words, stored as `{{field}}` (`tokensToHtml` / `htmlToTokens`). The live preview's `fill()` mirrors email-vars `fillTemplate` incl. the pay-sentence rule; the Start step's email is the server's (`/my-setup/sequence/preview`).
- Look: D-0154 "PACE's look, refined" as scoped `.sq-*` rules at the end of `retro.css` (1.5px ink edges, 3px shadows, 6–8px corners, pixel-font labels, app `.btn` buttons; tokens only, so night/sky themes apply). Tests: `test/sequence-setup-ui-smoke.mjs` (20 checks, desktop + phone dark).

## 2026-10-15 (Session 47, later) — D-0155 the sequence screen matches the app; R-259 "Teach the AI"
- **Look (D-0155, reverses D-0154's "refined" variant):** `.sq-*` in `retro.css` now copies the app: `.card` edges (2px ink, square, `--sh2`), every action a `.btn` (the old `.sq-link` underlined links are gone), inputs 2px `--ctl-brd` square with the app's focus shadow, no pixel font inside the page (eyebrow, steps, labels, tags are plain bold text). Step pills: the current step is `--sun` like the primary button.
- **AI mode (R-259):** "Teach the AI" card (`#sq-purpose`, `.sq-pick` rows for use / end / len, `<details>` with `#sq-voice`), "Your backup email" with "Write it from my answers" (sends `answersPrompt()` to `/my-setup/sequence/draft`), each follow-up gets angle picks + `#sq-fnoteN` and its backup editor inside a `<details>`. Start step in AI mode calls `/my-setup/sequence/ai-test` AND `/preview` (the backup) together and shows "Written by AI" + follow-up 1, the backup in a fold-out, "See what the AI read"; a plain reason when the AI did not write.
- **Repaint rules kept:** input VALUES are left out of the skeleton (`skel?'':value`) so typing never triggers a rewrite; `<details>` open state lives in `Q.open` (a capturing `toggle` listener). `sequence-setup-ui-smoke` 32 checks (AI mode: picks, purpose survives repaints, test, save payload, no-AI fallback).

## 2026-10-15 (Session 48) — Add user / profile password (R-262)
`12-manager-users.js`: optional `#u-pw` in the Add-user window (text no longer says "no password is created"); `adminSetPassword(userId)`. `09-page-workflows.js`: a "Sign-in password" card (`#ud-pw`) on the user detail page.

## 2026-10-15 (Session 48, later) — login repaints (R-263)
`render()` order is now: loading (spinner, skipped when `#app-loading` already stands) → no user (login; skipped when the html equals `window._loginHtml` and `#login-email` is in the DOM) → the app. `apiFetch` never answers a call sent before a deliberate end of session (`endSessionCalls()`, `_sessGen`); an EXPIRED session still answers every failed call with the plain sentence. Never write the login screen twice, and never let an old session's answer touch a new one. Test `login-repaint-smoke`.

## 2026-10-16 (Session 49) — Deactivated users window (R-264)
`09-page-workflows.js` admin list header: "Deactivated users" button (admin only). `12-manager-users.js`: `openDeactivatedUsers` (modal list) and `reactivateUser` (confirm, POST, add back to `STATE.users`, reopen the list).

## 2026-10-16 (Session 49, later) — password eye (R-265)
`pwBox(id, placeholder)` (12-manager-users.js) renders a password input with an eye; `togglePwVisible` flips it. Used by Add user (`u-pw`) and the profile's Set password (`ud-pw`). Classes `.pw-wrap`, `.pw-eye` in `ui.css`. Only typed text is revealed; there is no route that returns a saved password and none should be added.
`render()` (03-core-render.js) keeps the typed text of any `input[data-keep-typed]` through a repaint; `pwBox` sets it. Use it for any box where losing typed text would cost the person something.

## 2026-10-19 (Session 49, later) — mailbox daily limit (R-266)
- surface: R-266 — limit box per mailbox on the user profile (`saveMailboxLimit`, `openMailboxLimitChanges` in `12-manager-users.js`), My Setup "Lower daily limit"; Add email ID window has no typed default.

## 2026-10-19 — R-266 follow-up
- surface: My Setup button is "Edit daily limit"; too-high number shows "an admin set N, type N or less" and asks again.
- R-268 (Session 50): `65-trace.js` leadEmails — when narrowed to one person, THEIR mail is matched by name, OURS by `to` (outbound rows have `person:null`); the 'reply you owe' chip sits on their newest email, 'your last email' on ours.
- Batch 2 (Session 50): Leads strip counts `stripBase` (every filter but the stage buttons, R-279 — reverses "counts from ALL leads"); "Show 10/20/50 per page" (`#leads-per-page`, `STATE.leadsPageSize`, `setLeadsPageSize` saves `/me/preferences.leads_per_page`, loaded in `loadThemePreference`, R-280); Reminders "Recently dismissed" = last 7 days by `updated_at` (R-281); Find Leads searching = `.fd-dots` dot-matrix (R-282, `retro.css`); finder card says "Revenue 52M" (R-276); Today for a bd/bd_lead who owes a sequence = `renderSetupDashboard` only (`isSetupHeld`, `loadSetupOwed` → POST /my-setup/sync; error = ordinary Today) (R-283). `.setup-step*` in `retro.css`.
- Batch 3 (Session 50): named sequences in the new builder — `73-sequence-setup.js` `openSequenceBuilder(opts)` (Q.target: id, entity, cand, name, enrollAfter, back), `namedSteps`/`saveNamed`; candidate detail menu CAND_DETAILS; `09-page-workflows.js` `wfOpenBuilder` = the one door (v2 → new builder, old → `wfOpenLegacyBuilder`), `wfAskWho`, new Sequence-tab list (`.wf-seq*` in retro.css).
- R-275 (Session 50): candidate drawer — `jobPanel(pr)` above the tabs when `pr.fromJob` (set from the opening view's job; `/job-orders/:id` read once), `cpToggleJob` flips hidden in place; stage-move notes (`history.activity[].note`) listed in Notes, read-only, counted. R-277: `70-assign-leads.js` equal `suggest`, `overLimit` disables Assign.
- R-278 (Session 50): manager Today = `renderManagerDashboard` (05) — `loadTodayNumbers` (/insights/bd/me, /leads/assign/mailboxes?user_id=me, /insights/bd-team; 5-min cache), `renderNeedsYou` (naRowHtml + clientDigestMineRows, chips via STATE.todayFilter), `.td-*` in retro.css. Outreach Insights personal = `renderOutreachInsights` (16), `.oi-*`. R-285: builder `perIdHtml`/`showTab`/`savePerId`, AI style via `renderAiStyleCard` in a details.
- Batch 4 (Session 50): `47-page-mailbox.js` — `threaded()` (STATE.mailView, saved as pref `mail_view`), `m.all` (All inboxes; `lkey` is '*all|…'), `rowOf/acctOf/idsOf` (a row's mailbox and the messages it stands for), `appendRows` (dedupe), `mbSetView`, `mbSelectAccount('*')`; bar `mbFmtBar`/`mbFmtVal`/`mbFmtKeep` (selection kept while a select/colour picker has focus); `mbReplyTo(id,mode)`; schedule `mbSchedPanel/Open/Pick/Confirm`; tabs `scheduled` (`loadScheduled`, `renderScheduled`, reminders from STATE.reminders) and `draft` (`deviceDrafts` from localStorage `pace-mb-draft:*`). Styles `.mb-count/.mb-you/.mb-acct/.mb-skipped/.mb-view/.mb-sched*/.mb-sec-*/.mb-fmt-*` in ui.css.
- R-286 (Session 50): builder `fuThreadHtml` (same thread / new email + `#sq-fusubj{i}`), `toolsHtml(slot)` (Rewrite with AI + Undo, spam check), handlers `futhread/rewrite/rwundo/spam`; `mySetupOpenSequence/Style` and `wfEditMyWording` open the builder.

- 2026-10-20: `dashScrollToReports()` returns false for managers (their Today has no report, D-0160) so Reports opens the page; the
  sequence builder preview resolves {{sender}}/{{senderemail}} from the sending email ID (`loadSenders`/`previewSender` in 73), never the
  profile; new cream surfaces (.td-tile/.oi-tile) must join the retro.css dark paper list. Outreach Plan tab tests retired (see archive).

- Session 51 (R-049): `public/js/08-page-admin.js` / `09-page-workflows.js` — Emergency stop wording is "your company"; engine Run buttons and the warm-up tick hide when `/admin/sending/status` says `operator:false` (`STATE.isOperator===false`); the operator sees "Stop every company" (`togglePlatformSending`) only when `multi_org` is true.

- Session 51 (20 Oct): public/js/22-api.js apiFetch reads the body as text — an empty/non-JSON answer to a GET is asked once more after 3 s, then shown as a plain "server may be waking up" sentence (`NOT_JSON_MSG`, error.unreachable); a POST is never repeated. public/js/19-distribution.js: the Assign-leads preview shows shares as whole percents via `ratioPct()` (was raw 44.1860465116279).

- Session 51 (20 Oct): the Assign leads window and page warn when leads in the pool have no contact person with an email (`pool.without_people`, amber line) and the result toast says how many were left in the pool.

- Session 51 (20 Oct, R-290): `61-client-digest.js` `clientDigestMineRows` hides a digest row for a reply that is not yet due (`STATE.nextActions.reply_due_after_days`) unless a promise came due; NOT covered by a UI test (screenshot owed).

- 2026-10-20 (Session 52, R-297): `44-next-actions.js` — `withTz('/next-actions')`; `NA_ALWAYS_TODAY` (reply_due, pipeline_step) bypass the R-097 day split; kind `pipeline_step` labelled "Interview" or "Submission" (`naKindOf`), row button "Open" (opens the candidate), window: Open / Write to / stage picker; chip "interviews / submissions". `05-page-dashboard.js renderNeedsYou`: items of tier ≤ 3, then client conversations needing a reply, then the rest, then other conversations. Screenshot checked (scratch, not committed).

- 2026-10-20 (Session 52): `22-api.js loadAppData` — own mailboxes asked once (shared promise), colleagues' via one `/users-emails` (was `/users` again + `/users/:id/emails` per person). `44-next-actions.js` — nudge / stage_suggested kinds, labels, chips, buttons, `naMoveStageSelect` / `naMoveStage` and the "gone quiet" hidden line removed; candidate reply_due window offers the stage move (`stages`, suggest next stage when `hot`); the row payload now carries `hot`, `step`, `submission_id` (R-297 bug: a pipeline step's snooze keyed per candidate, not per submission). `05-page-dashboard.js todayNeeds` — only conversations that owe a reply.

- 2026-10-21 (Session 52, R-301): the jobs list has no posting text. `22-api.js`: `normaliseJob` keeps `posting` and re-attaches a loaded text from `STATE.jobPostings` (dropped when its length no longer matches `posting.chars`); `window.loadLeadPosting(id)` (GET /jobs/:id), `leadPostingLoaded(j)`, `leadPostingKeep(id,text)`. `59-lead-posting.js` uses `j.posting` for the status/word count and loads before Show / Edit (shows "Loading the job description…", a failed load opens nothing). `15 raFormEdit` loads first, then `raFormEditLoaded`. `17` hasData counts `jd_raw_omitted`. Anything new that reads `research.jd_raw` from STATE.jobs must call loadLeadPosting first.

- 2026-10-21 (Session 52, R-302): `apiFetch(method,path,body,retried,opts)` — `opts.ifTag` sends If-None-Match (fetch `cache:no-store`) and a 304 resolves `{__notModified:true}`; `opts.onTag` receives the ETag. `apiGetJobsList()` → null when not changed, else `{data, keep}`; `applyJobsList(jl)` is the one place a refreshed list lands (poll + refreshJobs); loadAppData always asks in full. The tag is sent only while `STATE.jobs` is the very array it came with, same user; `endSessionCalls` clears it. `/emails?status=sent` is no longer asked anywhere (STATE.sentEmails is gone — nothing read it).

- 2026-10-26 (Session 53, R-312): **Leads → Industry filter filters.** It offered the fixed 44-category list; leads carry Apollo/LinkedIn names, so a tick matched nothing. Now the list is built from the leads on screen (`leadIndustryOf(j)` in 02-state.js = own industry, else company's), most common first with counts, matched ignoring case/spaces; a long list (>8) gets a search box that hides rows in place (`fltDropSearch`, no repaint — focus stays); ticks use `data-v` (an apostrophe no longer breaks the onchange). `test/leads-industry-filter-smoke.mjs`.
- 2026-10-26 (R-312): **Find Leads: background loads no longer rebuild an open dropdown.** The page is ONE region and ~5 loads land on opening, each rewriting it — the open Industry `<select>` was torn down under the cursor ("pulls up many times before settling"). `bgPaint()` in 68-page-finder.js holds a data-arrival paint while a `<select>` inside #content has focus and runs it once on blur. Person-caused paints are unchanged.
- 2026-10-26 (R-310): **My Setup signature: changing a detail ticks "Replace this mailbox's signature".** A mailbox with its own signature opened with the box unticked; changing the phone updated the PREVIEW but Save kept the old stored signature, so compose showed the old number ("it reverted"). `mySetupPreview` now ticks the box when a detail changes (person can untick). `test/mysetup-page-smoke.mjs` R-310 steps. Live data at the time: mailbox b9bd9b21… had the new number in `_sends_as` (23 Oct) and the old in `_signature_html` (19 Oct).

- 2026-10-26 (Session 53, R-315, P1 of the owner's doc):
  - **Reminder "Reconnect your mailbox" has its own Reconnect button** (10-page-modals.js `isReconnectReminder` / `reminderReconnect`): finds the person's mailbox by the address in `company_name`, opens Google's or Microsoft's sign-in (app-password → My Setup), and dismisses the reminder on `*_oauth_success`. `test/reminder-reconnect-smoke.mjs`.
  - **A `mailto:` link in an email opens PACE's New message** (47-page-mailbox.js `routeMailtoLinks` + `hashchange` → `mbComposeTo`). The body is parsed INERT with DOMParser; mailto links become `<this page>#pace-compose=<addr>` with target `_top`; EVERY other link is forced to `_blank`. The frame gained ONLY `allow-top-navigation-by-user-activation` (still no scripts, no same-origin). Pinned in `mailbox-page-smoke` (an email's own `target="_top"` link is forced to a new tab).
  - **Inbox day headings** (Today / Yesterday / Earlier this week / Last week / Two weeks ago / Three weeks ago / Earlier this month / Last month / Older; Mon-start weeks, viewer's calendar): `dayGroup()` = `window.mbDayGroup`, `.mb-day` sticky heading in ui.css. **Rows are no longer the only children of #mb-list** — select rows by message (`[onclick*="mbOpen('id')"]`), never `:nth-child` (mailbox-fast-bulk-smoke fixed that way).
  - **Attachments on EARLIER messages of a thread show on their summary** (`loadThreadFiles`/`renderThreadFiles`): for summaries with `has_attachments`, the message is read once (GET does not mark read; at most 6 per thread) and its non-inline files shown as download buttons.
  - **Job status change asks for a note** (25-workflow-bd.js `askStatus`, both the bulk "Set status" bar and the row's Status): window with an optional note; Save sends `{status, status_note}`; Cancel changes nothing. `test/job-status-note-smoke.mjs`.
  - **All email → Sent: "What went out"** (50-all-mail.js `amSumCard`): real counts by step for Today / Yesterday / Last 7 days / This month / picked dates (viewer's own midnights) from `GET /email/sent-summary`; the note says the list's numbers are what is loaded (it fetches 400 per kind — that was the "Sent 400").
- **26 Oct (night) — a failed FIRST LOAD keeps the sign-in (R-323).** Ash pressed Log In and landed back on the login page (another browser worked). `loadAppData()` (22-api.js) used to sign the person out on ANY failure of its 5–7 first calls and say why in a toast — on a busy server (GET /jobs 17–32 s, R-324) that looked like a refused password. Now: `err.expired` → sessionExpired as before (R-118); otherwise keep the token, retry once after `LOAD_RETRY_MS` (4 s; spinner says "PACE is busy — trying again…" via `STATE.loadNote`, the loading screen changes only its words), then `STATE.loadFailed` → `#app-loadfail` screen in render() ("Signed in as …", Try again = `loadAppDataRetry()`, Sign out = `doLogout()`). Never the login page while a token is held. `test/login-load-fail-smoke.mjs` (reintroducing the old catch fails 5 of 8).
- **26 Oct (night) — "Add as lead" on a reminder (R-309, D-0178).** `canAddReminderAsLead(r)` (10-page-modals.js; same test as the server's `reminderLeadOffer`: no job_id/contact_id, not setup/reconnect, a valid email, a lead-working role) shows the button on the due card and the upcoming row; `reminderAddLead(id)` fills `STATE.addLead` from the reminder (name split first/rest, email, company = `STATE.companies` exact name match else New company by that name, source Other, `fromReminder`) and opens the ordinary Add Lead window, which shows `#al-from-rem` ("From your reminder for X … the lead will be yours"). `submitAddJob` adds `from_reminder_id` and re-asks `/reminders` after saving. Also D-0177's `#bd-for-owner` note on the New Job form (25-workflow-bd.js `bdCooldownBanner`).
- **27 Oct — R-322 fixed: a repaint no longer turns "select all, type a new password" into old+new.** render() (03-core-render.js) restores `data-keep-typed` values after the patch; setting `.value` moves the caret to the end, and it ran AFTER putRegion had put the selection back. Now the kept value goes back first and, for the focused box, the captured selection (`_selStart/_selEnd`) is re-applied. Rule worth keeping: anything that writes `.value` into a focused box must re-apply the selection after it.
- **27 Oct — Outreach Insights click-through (R-316).** The five tiles are `button.oi-tile-btn` (`oiOpen(kind)`; the same tile again closes): an `[data-oi-drill]` card lists the people behind the number (`GET /insights/outreach/people` with the page's from/to/seq/tz; a late answer for an older pick is dropped via `drill.asked`), with "Download for Excel" (`oiCsv` → BOM + CSV, a value starting with = + - @ prefixed with ' so a spreadsheet never runs it; file `outreach-<kind>-<from>-to-<to>.csv`). Changing dates/sequence reloads an open list. BY INDUSTRY and BY TIME ZONE tables under BY SEQUENCE (stacked). Style lesson: `.oi-tile-btn` must NOT set `color:inherit` — it drew the dark theme's cream page text on a cream tile; the retro surface rule gives tiles their colour. `test/outreach-drilldown-smoke.mjs` measures contrast in both themes.
- **27 Oct — R-317/R-318 screens.** Stage window (33-stage-modal.js): "Client" beside Candidate / BD Manager for one person and the BD team (`ivClientOk`), its box shows on tick, the address is pre-filled from `/submissions/:id/submission-email/options?kind=client` (datalist + `data-name`), "Attach the candidate's latest résumé" ticked; the send carries `client_to`, `client_name`, `attach_resume`; the toast names any copy that did not go. Interviewers field asks for titles. Mailbox (47-page-mailbox.js): `holdThenSend` / `mbUndoSend` / `mbUndoButton` (countdown updates only its own number), `mbToggleStar` (Array.isArray guard on m.thread), `mbPopOut`, `#mb-resize` + `mbResizeStart/Key/Reset` setting `--mb-list-w` on `#mb-root` (ui.css `.mb-list{width:var(--mb-list-w,340px)}`, hidden ≤960px, `body.mb-resizing iframe{pointer-events:none}` so a drag over the message frame is not lost), localStorage `pace-mb-list-w` (a per-viewer convenience).
- **27 Oct (Session 54) — P3 / R-319 screens.** (a) Find Leads Accept window: `postingLinks(card, jobs)` (also `window.fdPostingLinks`) — a link per ticked job whose posting has an http(s) address, `.fd-postlinks` (retro.css). (b) Review window: `fdRvRewrite(id)` / `fdRvUndo(id)` — saves the screen first (`rvSave`), `rvCapture()` before every async repaint so typing in another email survives, a note under the buttons, Undo only after a rewrite; calls `POST /emails/:id/rewrite-ai`. (c) Outreach Insights (16-insights.js): chart zoom — `oiZoomWindow`/`oiPanWindow` pure, `oiChartBlock`, `[data-oi-chart]` redrawn alone through `oiPaintChart` (rAF-throttled), gestures on `document` (wheel; pointer events for pinch/drag; the chart element is replaced while a gesture runs, so `liveSvg()` re-queries), `touch-action:pan-y` on the svg. (d) Sidebar (04-shell-login.js + retro.css end): `.rail-arrow` (same element as the touch `.rail-pin`), `toggleRail(true)` writes `pace-rail-arrow`; markup never changes between states (class `pinned` decides the chevron's direction); `PACE_GO` chevron mark beside the word; `#sidebar` and `#sidebar ~ #main` transition on one `.22s` curve (never `all`). NOTE the render engine writes nothing when the sidebar's html is unchanged, so a test of 'what the next visit draws' calls `renderSidebar()` itself. (e) Mailbox (47-page-mailbox.js): `threaded(folderId)` is false for a Drafts folder; `mbOpenRow(id)` (list rows) → `mbContinueDraft(id,true)` for a draft row, reads it if it cannot be opened; lead card (`leadCardFetch/leadCardHtml`, `_lc2` cache per address, `.mb-head-row`/`.mb-leadcard` in ui.css) is part of the HEAD region only — the body frame is never rewritten.
