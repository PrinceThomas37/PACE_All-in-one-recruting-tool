# Surface — memory
> Last written: 2026-09-30 (Session 35 — group stage move screens, windows, addressed email, rows that do the task, From picker) · earlier: 2026-09-29 (Session 34)

## Session 35 (2026-09-30) — the group stage move screens (C-0032, R-077/R-075) and windows (R-078/R-079, D-0058)

**Also Session 35 — email opens addressed, rows that do the task, the From picker (R-084/R-083, R-073, R-087):**
- **`outreachComposeTo({id,name,email,title,company,location,job_id,job_title,outreach_type})` in `48-page-outreach-gen.js` is the ONE way any "Email" button opens the composer addressed to somebody.** The lead drawer's button set a field the composer never read (landed on an empty "Send to"). Every contact row (`leadContactRowHtml` — the lead row AND the POC finder's slots) now has a **✉ Write** button when there is an address. `test/email-carries-person-smoke.mjs` (11).
- **"Needs you today" rows do the task (`44-next-actions.js` `naAct`):** Reply (mailbox searched to that person), Follow up / Chase (the addressed composer as a follow-up), Write (the reminder's own composer), Move to… (the stage window on their submission for that job); a candidate is answered in the mailbox, never the client composer; no address = says so. Nothing is sent. `test/needs-you-today-does-smoke.mjs` (16).
- **`10b-from-picker.js` (`FromPick.slot/value`)** is the shared "From" row for the client email window and the interview block; it fills itself by DOM id (never a render). One mailbox is a plain "From x", none says to connect one. The generator's own sender card offers the choice and CLEARS the draft when it changes (the wording names the sender). `test/from-picker-smoke.mjs` (12).
- The interview block of the stage window ticks **Candidate** by default; `.stg-*` and `.win-*` styles are in `styles.css`, `.win-*` phone rules in `mobile.css`.

**Group stage move — LIVE ON THE BRANCH (PR #262), pinned by `test/stage-group-move-smoke.mjs` (29 checks, real browser; fails with each of three deliberate breaks).**
- `33-stage-modal.js` (finished from the Session 34 WIP): `openStageModal(idOrIds, stage, onDone, opts)` — more than one id sends ONE `POST /submissions/bulk-stage` and draws a per-person result panel (moved / refused with the server's own sentence / "Not included" for ticked people with no stage on the job). `stageGroupSelect(count, onchange)` is the ONE "Change stage…" control (a stage the caller cannot use is greyed WITH its reason — "one at a time" for a recruiter's Submitted-to-BDM, "BD team only"), `stageOpenGroup` (job page + Pipeline tab) and `stageMoveUnlinked` (one person with no submission: `POST /pipeline/bulk` first — the one add path — then the ordinary move). The `.stg-*` styles never existed and are now in `styles.css` (tokens only).
- Wired: job page roster (`bdMoveGroup`, `bdMoveTagged`, in `25-workflow-bd.js`), Pipeline tab (`plMoveGroup`; the retired second vocabulary `PIPELINE_STATUSES` is deleted; columns read "Added By/On"), Candidates page (`atsMoveSelected` → asks WHICH JOB via `GET /submissions?candidate_ids=` when the ticked people are on several; `atsMoveOnJob`; ticked people not on the chosen job are named). `30-page-candidate.js` reads `p.stage`; `27-page-applicants.js` reads "Sourced" not "Tagged" and matches `/already (tagged|on this job)/i`; `32-page-sourcing.js` says when an import saved the person but not the job link (`job_link_failed`, `not_added_to_job`).
- **Lessons:** a stage window that has no CSS renders as an unstyled stack and every functional test still passes — look at it. Three older tests encoded the superseded behaviour ("Tagged", the promote shim) and were updated to D-0057.

**Windows — `public/js/10a-window-dock.js`, pinned by `test/window-dock-smoke.mjs` (26 checks; fails with each of four deliberate breaks).**
- It DECORATES `renderModal()`; PACE's single modal slot and the drawers are untouched. A modal gets a slim `.win-bar` (title + Minimise / Full screen / Close) and the tray `#win-tray` rides in the same `#layer` html string, so it repaints only when it changed. MINIMISE parks the html + everything typed (read from the DOM — typed text lives nowhere else) + scroll on a chip; bringing one back restores it, and parks the one on screen (swap; ≤6 parked).
- **FULL SCREEN IS A CLASS TOGGLED ON THE LIVE ELEMENT, NEVER A `render()`** — a render rebuilds the window and empties what was typed. `D.max` is also written into the next render's html so a repaint agrees.
- **A PARKED WINDOW THAT REPAINTS ITSELF MUST NOT POP OPEN.** The mailbox composer repaints when a signature or attachment finishes loading; `paintComposeModal` now calls `Dock.updateParked('mailCompose', html)` first. Any new window that paints asynchronously must do the same (`data-win="kind"` on its root + that call + `Dock.onDiscard(kind, fn)` if it keeps state elsewhere). Closing a chip discards the window AND its draft.
- Not parkable: `role="alertdialog"`, `data-nowin`, and object modals (jobDetail/addJob/addContact). Drawers park by reopening (`UI.drawer({onmin})`; candidate and client registered in the dock file): a record is data, not a form. The phone hides `.dwr-nav`, so drawers do not minimise there.
- **Known limits:** the mailbox's inline reply box is not a window; a window that updates itself asynchronously without `updateParked` (the stage result panel's invite progress) goes stale while parked.

## Session 34 (2026-09-29) — a closed reminder leaves every screen (R-071), the Dashboard's "Your team" card is gone (R-072), an honest apply label (R-076), C-0031
Owner: *"Once the reminders are complete it doesn't go off from the dashboard."* Four screen faults, every server endpoint was already right.
- **A reminder has ONE close step: `window.reminderClosed(rid)`, in `10-page-modals.js`.** Every SERVER-CONFIRMED close calls it and nothing else does: `dismissReminder` (now defined THERE, beside its buttons), Compose → Send (`sendReminderViaEngine`, 03-core-render.js) and `naDone` (44). It marks the row `sent` in `STATE.reminders` (Reminders page, Dashboard card, rail badge, Email page out-of-office card all read that), takes the row out of `STATE.nextActions.items` and its count AT ONCE, then calls the named global `refreshNextActions(true)` to reconcile. If `STATE.nextActions===undefined` (never loaded) it only `render()`s — there is no copy on screen to correct, and reading it would hand a "view as" preview the VIEWER's own queue.
- **The original fault 1 was a same-name global.** `window.dismissReminder` was defined twice in the orphaned `12-manager-users.js`; the second (browser-only `filter`) silently replaced the server-backed one, so Dismiss, Remove and the Email page's "has returned from OOO" card never made a request and the row came back on load and on the 3-minute re-read. Both copies, `sendReminderEmail` and `sendAllDue` are gone from that file (a comment there says why). **Do not define a reminder handler in `12-manager-users.js`.**
- **`refreshNextActions(quiet)`** — `quiet===true` re-reads WITHOUT blanking the card (a closed row is already gone; no flicker); the Refresh button and "try again" still blank it. **`loadNextActions(force)` arriving while a read is in flight sets `_naAgain` and re-reads once that read lands** — that read may have been answered before the close, and ignoring the request put the closed row back (proved by a deliberate break: scenario G).
- **The Dashboard Reminders card (`renderRemindersWidget`, 05) has ONE action: "Compose email" → `composeReminderEmail(id, contactId)`** — the path that queues through the engine, fills merge fields on the server, applies the double-send rule and closes the reminder. "Send", "Send all due", `sendReminderEmail` and `sendAllDue` are removed: they opened web Gmail with a body signed "Fute Global LLC" (one customer's name in every org's mail) and marked the reminder done in the browser only. A row offers the button only when it has an address AND `compose.can_send!==false` (the Reminders page's gate); otherwise it says why — the server's `blocked_sentence`, "No email on record.", or "Not linked to a lead, so PACE cannot send from it." Fields are `contact_name` / `company_name` / `compose.*` (the old `r.name` / `r.company` never existed: every name line was blank and the company line showed the address). Wording is `reminderDue(r)` from the Reminders page ("Overdue by 2 days", never "Due today" over an old row). Calm by D-0019: ONE tinted chip, no dot, no solid amber button. Classes `.dash-rem*` are in `styles.css` inside the REMINDERS region — **tokens only, `reminder-clarity-smoke` scans that region for hex**. Draws at most `DASH_REM_MAX` (5) due rows then "N more due · View all"; the header now counts ALL upcoming (it counted the 4 drawn). Wraps under the name at 390px.
- **R-072:** `renderManagerDashboard` no longer builds or draws the "Your team" card (roster + "Open team view →", or "No one reports to you yet", D-0056/D-0059). The My Team page is untouched. ⚠ `recruiter-dashboard-smoke` step "BD lands on the team desk" asserts `includes('Your team')` and STILL passes only because "Your team's pipeline" / "Your team's desk" contain the substring — it no longer proves the card.
- **R-076 (surface half): `applyPageState(j)` in `25-workflow-bd.js` (also `window.bdApplyPageState`) is the ONE decision** — `live` only when `apply_enabled` AND the job status is empty/Active/Open, a CHECKED COPY of `loadJob()` in `routes/apply.js` (the public page also requires it; gateway found the separate server fault, a non-existent `owner_id` column in that select). The Jobs row panel says "Switched on, page closed · N applicants" + one sentence; the job page header says "· switched on, page closed" + the same sentence and keeps Copy link / Turn off; the publish toast (warning) and both Copy-link toasts say it too. Checked against the REAL public route for eight statuses.
- **Job D:** `NA_KIND.stage_suggested` = "Replied — interested" (pale green pair, like its siblings) and the header chip "N interested"; a kind the file does not know says "Needs a look" — the old fallback was `nudge`, which asserts "No reply yet" about every kind added later. "1 reminders" → "1 reminder".
- **C-0031 (observatory) closed:** `renderNextActionsCard`'s EMPTY branch returned before `naTeamLine`/`naHiddenLine`; it now draws both under "Nothing waiting on you." `/next-actions` no longer exempts admins, so the owner (an admin who owns nothing there) would otherwise have lost the count and the Review route to the BD Lead's reminders. The count wording ("open across your team") is server text (rampart's `teamSummary`) and was left as is — for an admin it means the company.
- The `ooo_return` fallback sentence in `reminderWhy` equals `services/reminder-source.js` byte for byte (ledger's wording; foundry pins that the two agree and that neither mentions an auto-reply — **keep the word out of the comment above it too**).
- **Seen, not fixed:** a plan-gated org gets `locked` from `/next-actions` and the card says "Nothing waiting on you" (the server's message is never drawn); `todayIST()` (browser) vs the server's UTC date in `/next-actions` can disagree about "due today" for a few hours; the rail badge counts every pending reminder, upcoming included; `openNewReminder` / `saveReminder` / `editReminder` / `renderSetReminderModal` have no caller (dead legacy, browser-only add); the Email page's OOO card "Compose Email" is not gated on `can_send` (`composeReminderEmail` refuses with a toast).
- **Verified (isolated copy of HEAD + my `public/`, so other territories' uncommitted work could not colour it):** dispatch's harness extended to `r071-after` — paths A–F + the 3-minute re-read + reopen + G (a read in flight) + H (a blocked send): ALL PASS, and each old fault reintroduced on a copy fails it (B1 duplicate dismiss → 14 failures; B2 `naDone` → 1; B3 local-only flip → 4; B4 no re-read → 1; B5 old card → 2; B6 ignore `can_send` → 2). Also `other-checks` (no team card with/without reports; the label vs the real public page, 8 statuses) and `c0031-check` (real `/next-actions` + `/next-actions/team`, an admin owning nothing). Suites: `verify-frontend.sh` PASS; the 21 browser suites that touch these screens were green on the untouched HEAD copy and green with my `public/` (the 12 dashboard-facing ones re-run after the last edit); the ONE full `node test/run-all.mjs` on the live tree read **136/137** — the single red is guild's `pipeline-tag-membership-smoke` (by design, foundry fixes). Screenshots (light theme) are in the scratchpad `shots-round1/`; the scripts (`repro/r071-after.cjs`, `other-checks.cjs`, `c0031-check.cjs`, `breaks.sh`, `shots-round1.cjs`) are scratchpad only — **not** in `test/`, which is foundry's.

**What foundry should pin — each with the deliberate break that must turn it red (all of these were run, not just described):**
1. **R-071, browser, dispatch's harness shape (real `routes/reminders.js` + `routes/next-actions.js` over a fake db).** Six ways to close, each asserting: the request it made, the server row is `sent`, BOTH Dashboard cards drop the reminder at once, still gone after the 3-minute re-read (`page.clock.install()` then `runFor(181000)`), still gone after reopening, and no `window.open`. A Needs-you-today Done → `POST /next-actions/:id/done` · B Dashboard card "Compose email" → composer → send → `POST /emails/reminder-send` · C Reminders-page Dismiss → `PATCH /reminders/:id` · D Reminders-page Compose → send · E Remove on an upcoming row · F the Email page's "has returned from OOO" Dismiss. Breaks → red: *append a browser-only `window.dismissReminder` to `12-manager-users.js`* (C, E, F: 14 failures); *`naDone` re-reads only its own list* (A: 1); *`sendReminderViaEngine` flips the local status only* (B, D: 4); *restore the old Dashboard card* (B: no "Compose email", a "Send all due" present). Also grep: no `sendReminderEmail` / `sendAllDue` in `public/`; exactly ONE `window.dismissReminder=` in `public/js` (break: add a second).
   * **G — a read in flight:** hold the first `/next-actions` answer ~1.2s IN THE BROWSER (the route must map the API host to the local server or the hold never happens — my first version was vacuous that way; assert the read WAS held), close a reminder meanwhile, expect it stays gone. Break: delete `if(force)STATE._naAgain=true;` → red.
   * **H — a send the server refuses is not offered:** a follow-up already sent today → `compose.can_send:false`; the Dashboard row has NO button and prints the server's sentence. Break: `var canSend=!!toEmail;` → red.
2. **R-072:** `renderManagerDashboard(user)` for a manager WITH reports and one with NONE — no "Open team view", no "No one reports to you yet", no roster; "Your team's pipeline" still there. Break: restore the old `05-page-dashboard.js` → both red. **`recruiter-dashboard-smoke` step "BD lands on the team desk" is now weak** (`includes('Your team')` matches "Your team's pipeline"); make it assert the roster is absent.
3. **The honest "Live" label:** for statuses Active, active, Open, On Hold, Filled, Closed, '' and null, `bdApplyPageState({apply_enabled:true,status}).live` must equal whether the REAL `GET /apply/:token` (routes/apply.js over the fake db) answers 200; switched off is never live; an On Hold job's row panel and job page say "page closed" and never "Live" / "Anyone with this link can apply". Break: `var open=true;` in `applyPageState` → On Hold, Filled, Closed red.
4. **C-0031 (+ Job D):** real `/next-actions` + `/next-actions/team`, an admin owning nothing while a BD Lead holds three reminders: the card says "Nothing waiting on you", "3 open across your team" and a Review button; Review opens `.na-team` with an "Ask them" per row; the "gone quiet / hidden by you" line shows on an empty list. A `stage_suggested` row reads "Replied — interested" with a "1 interested" chip; an unknown kind reads "Needs a look", never "No reply yet"; one reminder reads "1 reminder". Break: restore the old `44-next-actions.js` → red at the team count.
5. **The out-of-office sentence:** `reminderWhy({reminder_type:'ooo_return'}).why` equals `SOURCES.ooo_return.why` in `services/reminder-source.js`, and neither matches `/auto-?reply/i`. Break: edit either copy.

## Session 33 (2026-09-28, later) — "Find anyone at <company>" (R-068) and the Apollo card's daily limit (R-066)
- **`62-poc-finder.js` `peopleSearch(id, d)`**: drawn only when the caller
  works the lead AND Apollo is connected. A `<form>` (Enter submits) with the
  title box + Search (+ Clear once there are results), the server's message
  line, and a results list (`.lxc-ppl-list`, scrolls in its own box at 360px):
  name with Apollo's masked hint, title, safe LinkedIn, and either a state
  ("On file" / "Waiting below" / "On this lead" / "Turned down") or
  **"Uncover · 1 credit" / "Uncover · free"**. State lives in
  `C[id].people` ({q, list, msg, loading, uncovering}) because the block is
  repainted whole after every answer — the typed title survives. Uncover's
  answer is the lead's payload (the person then shows in their slot or under
  **"Other people you picked"** — slot 'other', which the slot loop did not
  draw until this change); a 409 `duplicate` opens `showAlreadyAdded` and the
  row turns "On file".
- **`08-page-admin.js` `apolloLimitBlock()`** on the Apollo card: "Credits a day,
  for everyone", the number box, Save limit, "Used today: N of M"
  (`GET /admin/apollo/usage`, loaded after the integrations list).
  `saveApolloLimit()` refuses a non-integer or out-of-range value before
  sending, then posts to `/admin/settings/numbers` and reloads the figure.
  ⚠ **Found by the new test, not by reading:** `renderIntegrationsModal()`
  carries every box's value across a redraw, so an empty box drawn while
  usage was loading was carried back OVER the real limit (the box read blank).
  The block draws no box until the numbers arrive. **Any new input in that
  modal must not render before its value exists.**
- Styles `.lxc-ppl*`, `.lxc-uncover`, `.intg-apollo-*` in `theme.css`, tokens only.

## Session 33 (2026-09-28, latest) — the "Already added" pop-up (D-0051, R-064)
- **`showAlreadyAdded(dup, {onAddAnyway, onClose})`** in `10-page-modals.js` —
  the ONE pop-up for a repeated person. It draws the server's `duplicate`
  (`title`, `message`, `person`, `lead`) as a `.modal` string in `STATE.modal`
  (so `overlayWrap` puts it over the page and `theme.css` paints it
  `--card-solid`). **Buttons follow `can_add_anyway`:** an address match gets
  only **OK**; a name match gets **Don't add / Add anyway** — and only if the
  caller passed `onAddAnyway`. `dupClose` / `dupAddAnyway` run the stored
  callbacks. Styles `.dup-msg/.dup-person/.dup-name/.dup-sub/.dup-where` in
  `theme.css`, tokens only.
- **`22-api.js` `apiFetch` now puts `status` and the JSON `body` on the thrown
  Error** — a 409 used to reach the page as a bare message, so a structured
  answer (`duplicate`) was unreadable. Every existing catch still reads
  `e.message`, unchanged.
- Wired: **Add contact** (`24-jobs-wired.js` `submitAddContact` →
  `sendAddContact(jid, body)`, which keeps the typed body for "Add anyway"
  because the pop-up replaces the form modal; OK/Don't add go back to the
  lead's detail); the finder's **Add by hand** (`leadPocSave(id, allowSame)` —
  the inline form stays underneath, so "Don't add" keeps what was typed); the
  finder's **Accept** (a 409 `duplicate` is the pop-up, not a red line in the
  block; a 200 with `already_on_lead` is the pop-up, not "Added to the lead").
- ⚠ **`06-page-leads.js` still declares its own `submitAddContact`** — a global
  function that `24-jobs-wired.js`'s `window.submitAddContact` replaces at load.
  Dead while that order holds; its failure path would show the server's
  sentence in a toast, not the pop-up. Not touched (surface cleanup).
- Pinned by `already-added-ui-smoke` (25, new): real mouse clicks, geometry
  (covers the viewport, is what a click hits), opaque panel + ≥4.5:1 text in
  light and dark, 390px bottom sheet with ≥40px buttons.

## Session 33 (2026-09-28, later) — "Search contact" in every empty slot; size from Apollo; the Leads × (D-0050)
- **The Leads search box's × did nothing when only a search was typed** (owner:
  *"The cross button do not work"*). It was "Clear all filters": cleared
  stage/industry/date but NOT `STATE.jobsFilter.search`, and was drawn `.off`
  (`pointer-events:none` in ui.css) whenever only a search was active — so it
  could not even be clicked, including after the client-conversations card
  (61-client-digest.js) fills the search in. Now `clearFilters` clears the
  search too, the icon is on when `anyActive || f.search`, and its title is
  "Clear search and filters". Candidates' × already cleared its search; the
  Inbox's is "Clear search" and was right. `test/leads-search-clear-smoke.mjs`
  (11) clicks with a REAL mouse — `element.click()` ignores pointer-events and
  would pass on the broken code (5/11 on the old code).
- **62-poc-finder.js:** "Find the rest" is now **"Search contacts"** (every
  empty slot, top right), and every empty slot has its own **"Search contact"**
  (primary) beside "Add by hand" → `POST /jobs/:id/poc/find {slot_key}`. One
  search at a time (`st.finding`/`st.findingSlot`; "Searching…" on the pressed
  button, the rest disabled). An open Add-by-hand form hides its slot's buttons.
- **"Look up with Apollo"** (an `.lx-link`) beside the Company size select, only
  while no size is set → `POST /jobs/:id/company-size/lookup`. The size note is
  `sizeNote(d)`: "From Apollo: about N people." when `size_source==='apollo'`;
  "Apollo had no size for this company." when checked and still unknown.
- Styles: `.lxc-want > .lxc-want-acts` (the `> div` rule grows the text column,
  so the actions need the more specific selector or they stretch); ≤560px the
  actions drop under the text. poc-finder-ui-smoke (**58**) now also asserts
  one-slot searches send `slot_key`, the lookup flow, and a 390px fit of a
  slot's two buttons.

## Session 33 (2026-09-28) — "Find the rest" and found-person cards (R-053 slice 2, D-0049)
- **`62-poc-finder.js`** now draws, in each slot, the people Apollo found for
  it: name · title, the address with ONE chip for how sure it is
  (**Confirmed** = Apollo verified it · **Likely** = built from the company's
  own format · no chip + "No email" = PACE will not guess one), a source line,
  and **Accept / Not this person**. A suggestion for a slot filled by hand
  meanwhile still shows under it — a suggestion never vanishes unanswered.
- **"Find the rest" is drawn ONLY when the server would do it**: Apollo
  connected, a slot with nobody on it AND nobody waiting, and `can_edit`.
  While in flight it reads "Looking…" and is disabled. The answer's sentence
  shows under the heading (`.lxc-msg`); the heading adds "· N to review".
- Accept → the server adds the contact → `refreshJobs()` (STATE.contacts is
  what the slots read) → repaint from the answer already in hand. A 409 (the
  server decided — already decided, or on another lead at the company) shows
  its sentence and re-asks the server. Not this person → repaint from the
  answer. **Never render()** — paints only `#lx-poc-<id>`.
- Foot line: "Apollo: N of M credits used today…" when connected; when not,
  **only an admin** is told "Connect Apollo in Admin → Integrations" (nobody
  else can act on it).
- **A LinkedIn link is only ever a real `https://…linkedin.com/` address**
  (`safeLinkedIn`), `target=_blank rel="noopener noreferrer"` — the URL is
  third-party data; a `javascript:` value never becomes a link.
- Styles `.lxc-find/.lxc-msg/.lxc-slot.is-found/.lxc-found*/.lxc-conf/
  .lxc-credits` in theme.css: calm — one 3px accent stripe, at most ONE
  tinted chip per card, tokens only.
- **The found cards exist only after a find, so the app-wide contrast suite
  never draws them** — poc-finder-ui-smoke measures them itself in light AND
  dark (≥2.2:1, the theme suite's compositing). Pinned by
  `test/poc-finder-ui-smoke.mjs` (**50**); three screen rules reintroduced
  (button without Apollo, unsafe link, note to non-admins) each fail it.

## Session 33 (2026-09-27) — the POC finder's four slots on the lead row (R-053 slice 1, D-0049)
- **`62-poc-finder.js`** draws "People to reach" inside the lead row panel:
  two HR slots, two hiring-manager slots, "Also on this lead" for anyone who
  fits no slot, and a company-size select. The SERVER decides everything
  (`GET /jobs/:id/poc` → services/poc-targets.js); this file only draws.
- **The slots REPLACE the plain Contacts list, in the same element**
  (`#lx-poc-<id>`), once the answer arrives. Until then — or forever, if the
  server never answers — the plain list shows exactly as before, so the
  email valid/invalid control is never missing. `leadExpandHtml` calls
  `leadPocSlot(j, plainHtml)`.
- **One contact row for both:** `window.leadContactRowHtml(c)` (06-page-leads.js)
  draws a person with the email-status control; the plain list and every
  filled slot use it. Never a second copy.
- **Nobody on the lead disappears:** any contact the last server answer did
  not place (added a moment ago) is drawn under "Also on this lead".
- **Add by hand** is an inline form in the empty slot (name, title prefilled
  with the slot's first title, email). Typing a name fills the email from the
  company's LEARNED format until the person edits the email; with no learned
  format the email stays empty and the note says PACE will not guess (D-0049).
  Saves through the existing `POST /contacts`, then `refreshJobs()` — the row's
  contact count changes, the list redraws, `rowRevealRestore` puts the panel
  back, and the slots are re-asked.
- **`pocEmailFor` is a CHECKED COPY of poc-targets.emailFor** —
  poc-finder-ui-smoke runs 10 name/format cases through both.
- Viewers who can see but not work the lead (`can_edit:false`) get the slots
  with no size select and no Add by hand. Styles `.lxc*` in theme.css
  (tokens only; the size select is compact on desktop, 16px on a phone).
- Pinned by `test/poc-finder-ui-smoke.mjs` (25). A heading drawn with
  `text-transform:uppercase` reads back UPPERCASE from `innerText` — two
  checks failed on that before they were made case-insensitive.

## Session 33 (2026-09-27) — every record list opens in place (R-012, D-0048)
- **ONE gesture, ONE mechanism.** `rowReveal(id, ev, build, cls)` lives in
  `03-core-render.js` next to the render engine (it is the engine's sibling:
  a DOM change that must NOT re-render). Leads, Jobs, Candidates and Clients
  all call it; each supplies only its panel html (`leadExpandHtml`,
  `jobRowPanel`, `candRowPanel`, `clientRowPanel`). `leadRowToggle` is now a
  thin caller and still tags its panel `lead-exp` (its test pins that class);
  every panel row carries `row-exp`. The rows themselves need `data-row-id` —
  `UI.table` emits it for `{id, cells, onclick}` rows; the hand-rolled Jobs
  table writes it itself.
- **The same three rules as 11 Sep** (built on demand, one at a time; no
  render(); `STATE.page` untouched) **plus two new ones:**
  * **A REFRESH MUST NOT SNAP AN OPEN ROW SHUT.** `paintPageContent()` calls
    `rowRevealRestore()` after it writes: the open panel is rebuilt from current
    data under its row (gone if the row is gone). A page CHANGE (render's
    wholesale branch) calls `rowRevealForget()` so returning to a list later
    never pops an old panel open. This is what lets "change status from the
    panel → render()" keep the panel open.
  * **A change made INSIDE a panel that the list does not show** (an apply
    page going live) writes nothing to the list html, so nothing restores —
    the action calls `rowRevealRefresh()` itself. NEVER call it from render():
    rebuilding a panel on every repaint would wipe a half-typed box (the lead
    posting textarea lives in a panel).
- **A PANEL FITS THE PART OF THE LIST YOU CAN SEE.** On a phone a table
  scrolls sideways in its own box, so a panel as wide as the TABLE put its
  buttons off screen (measured 1,069px on a 390px phone — the Leads panel had
  this since 11 Sep and nothing measured it). `_rowFit` measures the nearest
  sideways-scrolling ancestor and sets `--rx-w` on the panel cell; theme.css
  pins `.lx` there with `position:sticky;left:0;max-width:var(--rx-w)`. No
  sideways scroll (desktop) → nothing set, nothing moves. Re-fit on resize.
- **Each panel fetches its one extra fact on open and paints it by id**
  (`lx-jo-pipe-<id>` who is on the job by stage; `lx-cand-jobs-<id>` the
  candidate's jobs from `/candidates/:id/history`; `lx-cl-jobs-<id>` the
  client's job orders) — cached 60s, never a render(). Stage counts share ONE
  function with the My Jobs cards (`stageCountsOf`); job status changes share
  ONE path with the bulk bar (`setJobStatus`).
- **Never draw a button the server refuses:** job status/copy/publish only when
  `poc_visible !== false` (owner, their chain, admin — the same set `PUT
  /job-orders/:id` allows); "Email this client" only when `can_edit !== false`
  — in the panel AND now in the client drawer's action row, which offered it to
  everyone while `POST /companies/:id/email` refused non-owners (C-0029's rule,
  missed there).
- **Candidates lost the per-row "Add to Job" button** (it is in the panel; the
  selection bar's bulk Add to job is unchanged) and the name no longer opens
  the drawer by itself — the whole row does one thing. Owner told plainly.
- **The Jobs page header is classes now** (`.jobs-head`/`.jobs-tools` in
  ui.css): on a phone the search box had been squeezed to an unusable pill.
- Pinned by `test/row-reveal-smoke.mjs` (45 checks, real browser, stub API;
  SHOTS=<dir> for screenshots). **Run against the old code: 5/45** — the five
  are "no panel before you click" and preconditions. Two lessons from writing
  it: a `page.click` on a missing node CRASHES the run and hides every later
  failure (use an evaluate-click that returns false), and "still on the same
  page" passes vacuously when the click found nothing — pair every "did not
  navigate" with "the panel is there".
- Seen but NOT fixed (not this job): the hand-rolled Jobs table's header row
  stays light in dark mode, and its status badges lose their pill ground there.

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


- 2026-09-25 (R-055): the **Email Engine Schedule** popup (`12-manager-users.js`, opened from the Workflows page) now shows the real sending hours — "Send lead emails between __ and __" in each lead's own time zone (admin edits; ra_lead sees them read-only) — and "Queue the day's follow-ups at (India time)". Removed: the dead "Outreach send time" box and a Timezone picker whose value was never saved. Saving clears `STATE.sysSettings` and calls `loadPendingSummary()`, so the "Send window: …" line re-reads.

- 2026-09-25 (R-056): `59-lead-posting.js` — a "Job posting" box on the expanded lead row (between Contacts and Emails): "The AI only knows the job title" / "✓ The AI has the job posting · N words", and a paste box for the people working the lead. Fills only `#lx-post-<id>`, never render(). Styles `.lx-post`/`.lxp-*` in theme.css.

- 2026-09-26 (R-037): `60-mailbox-alerts.js` — a calm amber-striped card above "needs you today" on all three dashboards (`renderMailboxAlerts()` next to `renderNextActionsCard()`), loaded once per dashboard visit like next-actions, never polled, never for a "view as" preview. Draws NOTHING when all mailboxes are fine; a failed check says so. Reconnect reuses `connectGmailUserEmail`/`connectMicrosoftUserEmail` (no second OAuth path) and reloads the alerts on the popup's success message. Styles `.mba-*` in theme.css.

- 2026-09-26 (D-0040/D-0043): `61-client-digest.js` — "Your client conversations" (+ "Your team's conversations — facts only" for managers) under "Needs you today" on all three dashboards; a STATUS view, not a second to-do list. Row click → Leads searched to that company (`STATE.jobsFilter.search`). Once per visit, never polled, nothing drawn when off or empty. Styles `.cd-*` in theme.css.

- 2026-09-26 (R-006): **Reports are on the Dashboard.** `withDashReports()` in 05-page-dashboard.js appends the SAME `renderReportsBody()` (39) inside the page wrapper of all three dashboards (not for "view as"); loaded once per session via `reportsLoadQuiet` (a background failure shows "No data yet", never a red toast). The standalone Reports nav item is gone; `goPage('reports')` lands on the Dashboard section (`dashScrollToReports`); "Full reports ↓" scrolls there. My Team keeps its Reports tab (same component). **Phone fix found on the way:** the report had an inline 2-column grid and fixed-width Hot-jobs rows (190px + 200px) — ~200px off a 390px screen on the Reports page and in My Team too; now classes `.rep-2col` / `.rep-hot*` that stack below 860px. + a "Time in stage" card (R-001, `.rep-tis`).

- 2026-09-26 (R-007): `window.generateAI` removed from the orphaned `12-manager-users.js` — it had no caller in any markup or script (grep for `generateAI` finds only the removal note). The rest of that orphaned page (and its `aiPrompt*` state in 02-state.js) is untouched; retiring the page is still the separate audit-and-split CLAUDE.md describes.

- 2026-09-26 (R-030): **the Integrations modal wiped typed keys on every redraw.** It is rebuilt as a string (Test result, budget load, health check), and a rebuilt input is empty — so the owner typed an OpenRouter key, pressed Test, saw "✓ Key valid", the box emptied, the badge still said "Not configured", and Save said "Enter a value first". `renderIntegrationsModal()` now carries typed input/textarea values and the modal's scroll across `render()`; `saveIntegration()` empties its own secret boxes first so a saved key is not put back. A Test result on a TYPED key says it is not saved yet (`.intg-unsaved`, two wordings: nothing saved / a different key is saved). `test/integration-test-honesty-smoke.mjs` (12, real browser) reproduces the exact 23 Sep screen on the old code (8/12).
- 2026-09-26 (C-0029): client drawer Documents tab draws Upload and the per-row Delete only when `c.can_edit !== false`; a non-owner gets a one-line `.cl-doc-note` and can still select + email documents. Absent flag (older server) = old behaviour.
- 2026-09-26: **record drawer panes were see-through** — `.dwr-pane` painted `var(--card)` in ui.css (0.055 alpha dark, 0.78 light, no blur), so the client/candidate list read through the open record. `theme.css` now paints `.dwr-pane{background:var(--card-solid)}`. Found in a screenshot, not a test: `overlay-opacity-smoke`'s source scan reads only `public/js`. It now opens the client drawer and measures both panes in both themes (fails 12/14 without the fix).
- 2026-09-28 (R-069): **Email → Pending says what each email is waiting for.** `pendingSplitLine(ps)` (07-page-email.js, on `window`) is the line under the tab: "N ready now · N waiting for the send window" plus "N waiting to retry" / "N held until tomorrow" when non-zero. A row in `STATE.pendingSummary.held_ids` gets `<span class="retry-chip held-chip">Held · goes tomorrow</span>` (tooltip names the limit) instead of the green "Ready now"; the retry chip still wins on a retrying row. The schedule banner (11-bind-and-actions.js `renderPendingScheduleBanner`) adds the two counts and one sentence each ("Held until tomorrow: the company already got its N first emails today (First emails per company per day, in Admin → System Settings). Nothing is dropped."). The count above the list says "N pending emails" (it said "N emails ready" for every pending row). Missing fields (older server) read as 0 — nothing changes. Pinned in a real browser by `send-recovery-smoke` part 4.

> **STOPPED MID-RUN — Session 34 (2026-09-29), C-0032, written by the orchestrator:** the owner stopped this run at ~17:10 UTC, mid-edit in `public/js/33-stage-modal.js` (the group stage move, +467 lines: `openStageModal(idOrIds, …)`, `stgApplyGroup` over `POST /submissions/bulk-stage`, per-person results, the recruiter/BDM refusals up front, legacy rows without a submission — `stgFixUnlinked`/`stageMoveUnlinked`). Its last words: "Now the Teams button guard, the note wording for a group, and the footer." Saved as WIP (not for merge); `node --check` passes, nothing else verified. Not started as far as the diff shows: the job page / Pipeline tab / Candidates page wiring, the "Tagged" labels, the `/already tagged/i` regexes, the import messages. The windows job (R-078/R-079) was stopped too, before it changed anything.

## Session 35, round 2 (2026-09-30)
- **The Apollo cost is on the button** (`62-poc-finder.js` `costText`, server `estimate` in `routes/poc.js`): "up to N credits" = sizing (0/1) + one per person searched; tooltip says searching is free and how many are left today. Sizing was already counted against the daily limit.
- **A candidate's email address opens PACE**, not `mailto:`: `mbComposeTo(email)` (47-page-mailbox.js) opens the New message window (a window — it minimises). Pipeline row + candidate record. `test/candidate-email-in-pace-smoke.mjs`. Do not reintroduce a `mailto:` for a person PACE holds.

- **Lead Insights draws the server's numbers (R-089, 2026-09-30):** `16-insights.js` `bdTeamData()` / `bdStatsFromServer()` read `GET /insights/bd-team` (cached 60 s); the admin BD Team, Team overview and drill-down do NO arithmetic on leads or emails — **do not reintroduce a browser-side calculation for these figures** (it is how 0 sat beside 311). `test/insights-screens-smoke.mjs` gives the browser no leads at all to prove it. The RA Team view is still computed in the browser.

- 2026-10-01 (R-091/093/094/097): **Candidate drawer opens on Resume** (`30-page-candidate.js`: `resumeInner`/`paintResume`/`cpLoadResume`; the card is its own region `data-cpresume`; the file is fetched through the server into a blob; Try again on failure; document list retried once). **Needs you today = today on the viewer's clock** (`44-next-actions.js`: `naSplitToday`, `naOlderLine`, `STATE.naShowOlder`). **Address chips** for To/Cc in the in-app mailbox (`47-page-mailbox.js` `chipField`/`mbChip*`, hidden input keeps the old id; `mbChipFlush` before send; `.chipf*` in styles.css + mobile.css). **Search inside a job's candidates** (`28-page-pipeline.js` `plFilterRows`/`plSearch`/`plTableHtml`, `#pl-table` region). Tests: resume-first, needs-you-today-day, email-cc-chips, job-candidate-search.

- 2026-10-01 (R-102): `16-insights.js` `insightsTzQ()` adds `?tz=<browser zone>` to `/insights/bd-team` and `/insights/bd/:id`. The RA Team view is still computed in the browser (+5.5 h India offset) — R-100.

- 2026-10-01 (R-100): the RA Team table in `16-insights.js` draws `GET /insights/ra-team` (`raTeamData`, 60 s cache, loading/error panel) — no arithmetic on leads in the browser; `+5.5 h` offset removed there. `todayIST()` (`01-constants.js`) is still India-forced for the Dashboard/Leads/Email — R-103.

- 2026-10-01 (R-095): stage window interview form has a Time zone picker (`ivZoneSelect`, `ivZonedToInstant`, `ivOffsetMin` in `33-stage-modal.js`); `stgApply` saves the converted instant and passes `interview_tz` to both `interview-invite` calls (`mv.ivTz`). R-080: the `ooo_return` reminder's explanation (`10-page-modals.js`) now says PACE switches the contact back itself.

- 2026-10-01 (R-092): `33-stage-modal.js` `subEmailHtml/Load/Read/Send` — an "Email these submission details" section in the recruiter's Submit-to-BD-Manager window and the "Submitted to Client" stage window (single move). Read before the window closes, sent after the move is saved. Reuses the address chips (`window.mbChipField`, `47-page-mailbox.js`).
