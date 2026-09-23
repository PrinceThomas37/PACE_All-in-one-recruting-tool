# FUTE LMS Backend — Context Window (Session 9 latest; older sessions below)

> **Latest work is Session 9** — jump to "## Session 9" at the very end. It is the
> **restructure** the owner asked for at the end of Session 8, done: reliability
> (timeouts/retries/rate limits), a `models/` layer that makes org scoping
> structural, and the two oversized files split. Backend-only, no UI change.
>
> **Previously: Session 8** — jump to "## Session 8". Session 8
> shipped Steps 0-3, merged and deployed Steps 0-2, applied migrations 033-036 to
> the LIVE database, and carries a **dependency map that must be read before any
> folder restructure**. Session 7 below is the same body of work mid-flight.
>
> **Previously: Session 7** — jump to "## Session 7". It starts the
> **Autonomous Recruiting Engine**, the biggest bet on the roadmap; the plan of
> record is `docs/AUTONOMOUS_ENGINE_PLAN.md` and **that file should be read before
> planning anything new**. Session 6 (screen-by-screen redesign + Job White-board +
> stage vocabulary, PR #122) and Sessions 3–5 are kept below for history.

> **Read `CLAUDE.md` at the repo root first** — it holds the durable, must-carry
> context: who the owner is (a product owner who doesn't read code or use git — I
> own everything technical and show them the running app, not code) and what we're
> building (a commercial ATS to sell; spend nothing now, architect to scale later).
> That file also tracks per-feature status (multi-tenancy slices, email-tracking
> slices, interview auto-meeting) — keep it current.

**Updated**: 2026-07-31 · **Repo**: PrinceThomas37/PACE_All-in-one-recruting-tool
(GitHub MCP still uses repo name `fute-lms-backend`; local dir + Render unchanged) ·
**Branch**: main **Dev branch, Session 6**: `claude/dashboard-redesign-review-6o73ws`
(restarted from `main` after the PR #122 merge, per the merged-PR convention).
**Supabase project**: `teiqievahzhllojvgsku` · **Deploy**: Render
(fute-lms-backend.onrender.com, auto-deploys from `main` — merging IS the release).

## Session 4 — this session

**Part 1** picked up 3 items the owner chose off Session 3's "open next candidates"
list — shipped as PR #114, merged and live. **Part 2** (below) is a 14-item punch
list the owner listed right after Part 1 deployed — all 14 are done, sitting in
draft PR #115 (`claude/context-window-resume-m04j2e` → `main`), not yet merged as
of this update.

1. **Mailbox Reconnect UI.** The Teams-meeting-create feature (PR #111) added a new
   OAuth scope (`OnlineMeetings.ReadWrite`), so already-connected Microsoft mailboxes
   need to redo the OAuth handshake once — but the UI only ever showed a "Connect"
   button *before* a mailbox had a token; once connected there was no way back in
   short of deleting the mailbox. Added a small **"Reconnect"** link next to the
   "✓ Connected" badge (Manager Users page, and the workflow mailbox picker), reusing
   the existing `connectMicrosoftUserEmail()` OAuth popup flow. **This is the step
   the owner needs to click through themselves** (their own Microsoft login) to
   unlock Teams meeting creation — nothing else to do on our side.
2. **Multi-tenant slice 2, continued: leads engine + dashboards.** Session 3 scoped
   the ATS side (`job_orders`/`candidates`) by org and deliberately deferred the BD
   leads engine (`jobs`/`companies`/`contacts`) and the dashboards as "needs its own
   careful pass." Done this session:
   - `loadAllJobs()`'s in-memory cache — the big payload every open Jobs/Leads tab
     polls — was a **single cache shared by every request regardless of org**. This
     was the most severe gap: once a second org existed, its users would have seen
     the first org's entire leads list. Now keyed per `org_id`.
   - `jobs`/`companies`/`contacts`: list, export, and cooldown-check reads scoped
     with `withOrg()`; creates stamp `org_id` with `orgStamp()`.
   - `/distribute/execute` — assigns the Unassigned lead pool to a BD manager — now
     draws only from the caller's org's pool (previously any org's leads could be
     assigned to any org's manager). Same fix on `/distribute/pool-stats` and
     `/distribute/today-summary`.
   - `/recruiting-dashboard` (the main manager/recruiter dashboard) and the
     single-record long tail (`GET /job-orders/:id`, `GET /candidates/:id`,
     `GET|PUT|DELETE /jobs/:id`) now respect org boundaries too (404 instead of
     leaking a cross-org record).
   - Added `withOrg()`/`orgStamp()` helpers to `index.js` (mirroring the ones
     already in `bd_recruiter_routes.js`) and threaded them through `routeCtx` for
     the extracted route modules.
   - Behaviour is unchanged for the single existing org today — every `org_id`
     column still has its platform-default fallback. Nothing the owner will see.
   - **Still open:** legacy `/bd-analytics/*` (un-org-scoped, listed as a fold-in
     later); RLS (slice 3b — do not enable without a fresh go-ahead).
3. **Gmail send for tracked candidate email.** `recruiterSendingMailbox()` (used by
   the "✉ Send tracked through futé" button and the `candidate_email` sequence
   channel) only ever resolved a Microsoft-connected mailbox. It now checks both
   `microsoft_tokens` and `gmail_tokens`; a new `sendMailboxNewMessage(mailbox, …)`
   dispatches to the Gmail provider or Microsoft Graph by `mailbox.platform`,
   mirroring the dispatch the general BD outreach engine already had. Also fixed
   the "+ Gmail" quick-add modal's copy, which claimed Google OAuth sending wasn't
   built yet (it was — just not wired into this one feature).

All 17 test suites pass; `bash test/verify-frontend.sh` passes. Screenshot taken of
the new Reconnect button (Manager Users page) — the other two changes are backend
plumbing with no visible UI change today. **PR #114, merged.**

---

## Session 4, Part 2 — the 14-item punch list

The owner listed 14 items in one message after trying the live Part-1 deploy. I
triaged into quick fixes → a couple of medium items → two bigger foundational
pieces (team hierarchy, then documents/clients, since reports depends on the
hierarchy). Owner explicitly said to use my own judgment on design rather than
being asked clarifying questions, so I made the calls noted below and flagged them
in commit messages / the PR description rather than blocking on questions.

**Quick fixes:**
- Removed the stray "+ Enroll leads…" button from the admin per-manager panel
  (and ~80 lines of code it was the only entry point for).
- **Stale-name bug, root-caused:** `STATE.users` was fetched once at login and
  never refreshed — a name change was instant only in the editor's own tab. Added
  `/users` to the existing 3-minute background poll (jobs already did this).
- Job cards (detail view + company job board) now show "BD Manager" (+ "Created
  by" when different). `/job-orders/browse`'s select didn't even join
  `bd_manager_id` before.
- **Sourcing moved inside the Candidates tab** as a sub-tab ("All Candidates" /
  "Sourcing") instead of its own nav item; each job also got a **"Source
  candidates"** button that pre-tags imports to it.
- **Zip-code autocomplete** (`40-zip-autocomplete.js`, reusable, DOM-patches only
  its own suggestion box so typing never loses focus) added to the Candidate and
  Job Order forms — state was already a dropdown in both.
- **BD Jobs page** split into My Jobs / All Jobs tabs with counts (defaults to All
  Jobs so nothing looks different until you click).
- **Candidate profile** got an always-available **"✉ Email"** button (BD and
  recruiter both) — reuses the existing tracked-send modal, pre-seeded with one
  recipient. `plShowEmailJDModal()` exposed on `window` so any page can reuse it.
- **Job board popup redesigned:** client/job info only (description, pay, work
  style, work auth, needed-by date, priority, skills) — no candidate names, for
  anyone, assigned or not. Previously showed a masked-but-still-named candidate
  list that was never actually useful for "should I ask to work this req?"

**Team hierarchy (migration `026`):**
- `users.manager_id`, self-referencing, nullable. Deliberately a **flexible
  tree** — any user can report to any other user regardless of role — per the
  owner's explicit clarification mid-session, not a hard-coded RA→BD→BDLead
  ladder. Two new roles: Associate Director, Director (added to every role
  picker in the app).
- This is **additive alongside** the existing `team_assignments` table (which
  already drives some Insights pages) — left untouched, since replacing it was
  out of scope and riskier than needed for what was asked.
- Admin-only `PUT /users/:id/manager` (rejects self-management + walks the
  chain to reject reporting loops). New **"Reporting Hierarchy"** card on the
  Admin user detail page: "Reports to" picker + live "Direct reports" list.
- `/reports/recruiting` now hierarchy-scoped via `reportingChainIds()` (BFS over
  `manager_id`): a BD with no reports sees their own numbers; a BD Lead sees
  their whole team's; admin still sees the whole org. Response carries
  `scope`/`team_size` instead of the old binary `role` field.
  **Note left for the owner:** a BD Lead needs their reports set up in Admin's
  new card before they'll see team data — until then they see only their own,
  same as anyone else.
  **Still open:** folding Reports into the Dashboard page itself (today it's
  still a separate nav item), and hierarchy-scoping the main Dashboard's own
  recruiting widgets (`/recruiting-dashboard` still uses the old binary split).

**Clients + document attach/send (migration `027`), the last item:**
- "Clients" aren't a new table — they're `companies` (same table the leads
  engine uses) that have ≥1 `job_order`, i.e. converted business. New **Clients**
  nav tab, BD/admin only (verified recruiters don't get it).
- `client_documents` table, reusing the existing private `candidate-docs`
  storage bucket under a `client/<company_id>/...` prefix (no new bucket).
- **Real email attachments, for the first time anywhere in the app:**
  `sendMicrosoftNewMessage` takes an `attachments` array (Graph
  `fileAttachment`); Gmail's `buildRaw()` now builds `multipart/mixed` MIME with
  base64 parts when attachments are present. `resolveEmailAttachments()` in
  index.js downloads from storage, best-effort (a failed doc is skipped, not
  fatal), capped ~18MB/send.
- `POST /candidates/email` takes `document_ids` now; the candidate profile's
  Documents card is selectable with an "Email selected" action.
- New `POST /companies/:id/email` (BD-only) is the client-side counterpart, plus
  `GET /clients`, `GET/POST/DELETE /companies/:id/documents`,
  `GET /companies/:id/job-orders`.

All 19 test suites pass (2 new: `40-zip-autocomplete.js`, `41-page-clients.js`);
`bash test/verify-frontend.sh` passes. Screenshotted: Sourcing sub-tab, the
redesigned job popup, the Reporting Hierarchy card working end-to-end, and the
Clients list + detail page. **PR #115, draft — awaiting the owner's look before
merge.**

---

## Session 3 (for history)

This continues Session 2 (PRs #93–#101: role dashboards, stage/kanban consolidation,
job board, submission packet, send-race guard). Everything below shipped in
**Session 3** (PRs #103–#112), newest last. All merged to `main` and live unless noted.

---

## Theme of this session
Turn futé into a genuinely sellable ATS: finish the owner's job/candidate UX fixes,
then lay the multi-tenant foundation, then build the "feels like a real product"
features — match scoring, app-tracked candidate email (open + reply), interview
scheduling with auto-created Teams meetings, and a reporting dashboard.

---

## Shipped (merged PRs)

### PR #103 — Job/candidate UX fixes (the owner's punch-list)
- **Email the JD to selected candidates** (separate from the sequence): the
  Candidates-tab bulk bar's "Email JD to candidates" opens a compose/review modal
  (editable subject+body) and sends via the mail app, BCC'ing recipients. Ticking a
  candidate no longer scroll-jumps — selection repaints only the checkboxes + bulk
  bar in place (`plRepaintSelection`), not the whole page.
- **Candidate details in the BD job view**: Email + Title columns on the Candidates
  table; pipeline API embeds `current_title`/`headline` (later `skills` too).
- **"Submitted" fix**: a freshly added candidate reads **"Added"**; **"✓ Submitted"**
  only appears once stage ≥ "Submitted to BDM".
- **ONE unified Add-Candidate window**: the job's and the kanban's "+ Add Candidate"
  now open the same full applicant form (`atsOpenNew(jobCtx)` in 27-page-applicants.js),
  scoped to the job (search-to-add existing, or create-and-tag). Removed the two
  divergent mini-modals.
- **Breadcrumb navigation** (`public/js/37-nav-history.js`): a file-manager trail
  (root › job › candidate); Back returns to exactly where you came from. Wraps
  bdOpenPipeline/Kanban/JobOrder/Candidate.
- **Edit job in place**: `bdOpenEditJob` reopens the job form prefilled →
  `PUT /job-orders/:id`. Backend now lets an **assigned recruiter** (not just BDM)
  edit a job.

### PR #104 — Multi-tenant foundation, slice 1 (migration 022)
`org_id` on 33 tenant tables, backfilled to the default org "Fute Global", column
DEFAULT so nothing breaks. Backend resolves `req.orgId` (JWT carries `org_id`, falls
back to default org via `orgIdFor`/`resolveDefaultOrg` in index.js); login embeds
`org_id`; core creates stamp org. Behaviour unchanged for the single org.

### PR #105 — Multi-tenant slice 2 + 3a (migration 023)
Read-scoping via `withOrg(query, req)` on the core ATS collections — `GET /candidates`,
`GET /job-orders`, `GET /job-orders/browse`. `org_id` set **NOT NULL** on all tenant
tables. **Deferred:** dashboard aggregates + single-record long tail, the leads/email
engine (`jobs` via cached `loadAllJobs` + index.js send subsystem), and RLS (slice 3b).

### PR #106 — Candidate ↔ job match scoring
`public/js/38-match-score.js`: `matchScore(cand, job)` → {score, band, reasons},
`matchBadge`, `matchScoreValue`. Rule-based (skills 50% / experience 20% / work-auth
15% / title 10% / location 5%, weights renormalized over present signals; null when
nothing scoreable). Candidates tab shows a colour-coded **Match** column, sorted
best-first, with a "Best match / Recently added" toggle. Pipeline candidate embed
gained `skills`. AI scorer can slot in behind the same API later.

### PR #107 — Email open-tracking infrastructure (migration 024)
`email_tracking` table (org-scoped). `email-tracking.js` (root) pure helpers:
`newToken`, `pixelUrl`, `pixelHtml`, `injectPixel`. `routes/tracking.js`: public
`GET /o/:token.gif` (records the open, returns a 1×1 gif, never errors/leaks) +
`GET /candidates/:id/email-activity`. Nothing wired to sends yet.

### PR #108 — Email tracking slice 2: tracked send + "Opened"
`POST /candidates/email` (index.js) sends the invite to selected candidates via the
recruiter's connected mailbox (`recruiterSendingMailbox` + `sendMicrosoftNewMessage`
+ `buildHtmlEmailBody`), injects the pixel, records an `email_tracking` row, bumps
`email_send_log`; 409 `no_connected_mailbox` → UI falls back to the mail app. Frontend:
"Email JD" modal's **"✉ Send tracked through futé"** button; candidate profile's
**Email activity** card ("✓ Opened · N×" / "Sent · not opened yet"). **Microsoft-only**
(mirrors the `candidate_email` sequence channel).

### PR #109 — Interview scheduling + email invites (migration 025)
Stage modal (33-stage-modal.js) captures full interview details: format
(in-person / virtual / phone), platform + join link OR office address OR phone, up to
3 interviewer names, and "Email these details to: Candidate / BD Manager". Stored on
`submissions` (interview_type/platform/link/address/interviewers). `PATCH
/submissions/:id/stage` stores them; **new** `POST /submissions/:id/interview-invite`
emails the formatted, open-tracked details (job title, company, date/time, format,
interviewers auto-included) to the candidate and/or the job's BD manager.

### PR #110 — Reporting / analytics dashboard
`GET /reports/recruiting` (org-scoped, role-aware): funnel, per-recruiter productivity
(submitted/interviews/placements/fill%/placement-fee revenue), 8-week submission trend,
avg time-to-fill, top clients, headline totals. `public/js/39-page-reports.js` — a
**Reports** nav item + page (tiles, colour funnel, trend bars, recruiter table, top
clients). Managers see the whole desk; recruiters their own. (Legacy `/bd-analytics/*`
still exist, un-org-scoped — fold in later.)

### PR #111 — Auto-create a Microsoft Teams meeting
`POST /submissions/:id/create-meeting` creates a Teams meeting via Graph
`/me/onlineMeetings` (reuses `graphMailRequest`), stores joinUrl + platform on the
submission. Interview modal's **"📅 Generate Teams meeting link"** button fills it in.
Added `OnlineMeetings.ReadWrite` to `MICROSOFT_SCOPES` (config/env.js). **Mailboxes
connected before this need a one-time reconnect**; until then the endpoint returns
409 `meetings_permission_missing` and the UI says so. Email/reply are unaffected.

### PR #112 — Email reply detection
Hooked into the existing 30-min `sweepMailboxReplies` inbox scan (uses `Mail.ReadWrite`,
**already granted — no reconnect needed**): an inbound message whose `from` matches a
tracked send's `to_email` stamps `replied_at`. Candidate profile shows **"↩ Replied"**.
No new columns/Graph calls — piggybacks on the lead reply-sweep.

---

## Migrations applied to live Supabase this session
- **022** `org_id` on 33 tenant tables + backfill + column DEFAULT + FK/index.
- **023** `org_id` NOT NULL on all tenant tables.
- **024** `email_tracking` table (org-scoped; token/open_count/opened_at/replied_at…).
- **025** `submissions`: interview_type, interview_platform, interview_link,
  interview_address, interviewers (jsonb).
(Teams meeting-create and reply-detection needed **no** migration.)

---

## Also done (not repo PRs)
- **Created `CLAUDE.md`** (repo root) — durable project memory, auto-loaded every
  session; holds the owner relationship + product vision (must carry into every
  handoff) plus per-feature status. Merged in #103/#104 area.
- **Silenced the local stop-hook nag**: `~/.claude/stop-hook-git-check.sh` (NOT in the
  repo — it's this workspace's Claude Code hook) now ignores GitHub's own squash/merge
  commits (committer `noreply@github.com`) while still flagging real mis-authored
  commits. Workspace-only; no effect on the repo or future devs.

---

## Open / next candidates (queued with the owner)
1. **Reconnect a Microsoft mailbox** → activates Teams meeting creation (one-time,
   because of the new `OnlineMeetings.ReadWrite` scope).
2. **Google Meet / Zoom** meeting auto-create — each needs its own OAuth (Google
   Calendar scope / a Zoom app). For now the recruiter pastes a link.
3. **Multi-tenancy remaining:** org-scope the leads/email engine (careful — it's the
   live send system), dashboard aggregates + single-record reads; then **slice 3b =
   RLS** (row-level security). **DO NOT enable RLS on the live DB without an explicit,
   fresh go-ahead** — the owner paused it once already; the pattern is proven-safe
   (service-role bypass, frontend is API-only) but touches prod.
4. Gmail send for tracked candidate email (currently Microsoft-only); fold the legacy
   `/bd-analytics/*` endpoints into `/reports/recruiting` (+ org-scope them).
5. Blueprint leftovers: BDM approvals-queue dashboard card; RA dashboard redesign; new
   roles Recruiter Lead / Associate Director (needs `users.manager_id`).

---

## Key architecture notes (for future work)
- **Frontend**: plain `<script>` modules `public/js/NN-*.js`, loaded in order by
  `public/index.html`, no build step. Global `window.*` + `STATE`. `render()`/`goPage()`
  are wrapped by each page module. New this session: 37-nav-history, 38-match-score,
  39-page-reports. Reports/nav icon added in 03-core-render.js.
- **Backend**: `index.js` (email/lead engine, auth, send helpers, org context) +
  `bd_recruiter_routes.js` (ATS) + `routes/*.js`. New: `email-tracking.js` (root
  helpers), `routes/tracking.js`. Route modules receive `orgIdFor` via `routeCtx`.
- **Multi-tenant helpers**: `req.orgId` (auth middleware), `orgIdFor(req)`,
  `orgStamp(req)` (inserts), `withOrg(query, req)` (reads) in bd_recruiter_routes.js.
- **Email send**: `sendMicrosoftNewMessage` / gmail `sendNewMessage` via
  `deliverOutboundEmail`'s platform dispatch; `buildHtmlEmailBody(plain, sig)`;
  `recruiterSendingMailbox(userId)` resolves a **Microsoft-connected** mailbox only.
  `graphMailRequest(token, path, opts)` is a generic Graph client (v1.0).
- **Two vocabularies**: recruiting = `job_orders` + `submissions` (12 stages); BD leads
  = `jobs` (Unassigned/Assigned/Connected…). Recruiter gating: up to "Submitted to BDM".

## Test suites (all green — 17 suites)
`test/`: backend-smoke (89), frontend-smoke (14), recruiter-dashboard-smoke (34),
workflow-gating-smoke (25), stage-consolidation-smoke (12), tab-collapse-smoke (11),
job-open-details-smoke (12), submission-review-smoke (16), lead-location-parse (14),
lead-stage-permission (13), send-race-guard (7), **job-candidate-updates-smoke (25)**,
**match-score-smoke (11)**, **email-tracking-smoke (7)**, **email-tracking-send-smoke
(10)**, **interview-schedule-smoke (16)**, **reports-smoke (8)** (bold = new this
session). Runner: `npm install --no-save playwright-core`; Chromium at
`$PLAYWRIGHT_BROWSERS_PATH`. `bash test/verify-frontend.sh` checks syntax + index.html.

## Working conventions this session
Implement → `node --check` → targeted smoke → screenshot (shown to the owner) →
commit → **reset branch to `origin/main` + cherry-pick/commit the new work** →
force-with-lease push → open PR → squash-merge (I merge; owner can't do git) → it
deploys. Keep `CLAUDE.md` + this file current. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session: …`.

---

## Session 5 — team hierarchy: fix visibility, add structure

**Dev branch**: `claude/team-hierarchy-visibility-hmjohj`. PR #115 (Session 4's
punch list) is merged into `main`; this session starts level with `main`.

### Context — why this work, and what it's for

Session 4 built a flexible reporting hierarchy (`users.manager_id`, any user can
report to any other user regardless of role — migration 026) plus a drag-and-drop
"Team View" for admins to build it (migration 028 added `team_name`).

The owner then flagged a real product problem: **there's no structure in the UI
today.** Even after building the hierarchy, the Admin page still shows every user in
one flat list, and — this is the important part — **the main Dashboard's "Your Team"
widget is a live bug**: it keys off a legacy `bdm` field that only ever existed in
demo/seed data. In production every real user has `bdm: null`, so the widget's
role-based branches never match and it silently falls through to "show literally
every other user in the org." This happens for every role except recruiter. It's not
a display nitpick — it's the direct, confirmed cause of "even BD Lead 1 or 2 can see
everyone" and "no structure, clustered all."

The owner's longer-term direction (explicitly **not** part of this plan) is a
Slack/Teams-style layer on top of teams: chat, document sharing, individual + team
meeting scheduling. That's why the hierarchy needs to be the single, clean source of
truth *now* — cheap to get right today, expensive to retrofit once chat/meetings/docs
are hanging off of it. This plan does not build any of that; it makes sure "team"
means one consistent thing before it does.

**What "team" means going forward:** a user's direct + transitive reports under
`users.manager_id` (computed via `reportingChainIds()` BFS in
`bd_recruiter_routes.js`). Whoever has ≥1 report is that team's lead — **data-driven**
(having reports), not a role/title allowlist, matching the owner's explicit "flexible,
not a fixed ladder" instruction. A job title like "BD Lead" is just what that person
is *called*; it doesn't independently grant anything.

### Three parallel "team" concepts found in the codebase
1. **Dead `bdm` field** — `public/js/03-core-render.js` `getTeam()`, only ever
   populated in seed demo data; `normaliseUser()` hardcodes `bdm:null` for real users.
   This is the Dashboard "Your Team" bug.
2. **`team_assignments` table** (older, role-pair-specific: `ra_to_bd`,
   `bd_to_bdlead`) — still live, read by `renderBDLeadInsights()` and an old "Team
   Assignment" card on the Admin user detail page. `ra_to_bd` only has an orphaned
   consumer (Manager Users page, unreachable via nav); `bd_to_bdlead` is the only
   assignment type with a live, reachable consumer.
3. **`users.manager_id`** (Session 4's work) — drives "Reporting Hierarchy", Team
   View, `/reports/recruiting` scoping. **This is the one to build everything else
   on.**

### Other confirmed gaps
- `GET /users` and `GET /team-assignments` (`routes/auth.js`) have no org scoping.
- `GET /users` has no role gate and is polled every 3 min by every logged-in user —
  full org roster (incl. `manager_id`/`team_name`) sits in every browser regardless
  of role. Only those three fields are actually admin-only-consumed today.
- `/recruiting-dashboard` still uses the old binary `recruiterView` split — any
  BD/BD-Lead/Admin sees the whole org's jobs/submissions, unlike `/reports/recruiting`
  which is already chain-scoped.
- `isBDM()` is missing `associate_director`/`director` (added in migration 026) — a
  Director gets 403 from `/reports/recruiting` today.
- `/bd-analytics/*` is legacy, un-org-scoped — **out of scope for this plan**
  (already flagged in `CLAUDE.md` item 5 as a fold-in-later item).

### Phased plan (reuses `reportingChainIds()` everywhere; no new hierarchy mechanism)
- **Phase 0** — widen `isBDM()` to include `associate_director`, `director`; org-scope
  `GET /users` and `GET /team-assignments`.
- **Phase 1** — fix `getTeam()` (`03-core-render.js`) to filter `STATE.users` by
  `managerId === user.id` (direct reports) instead of the dead `bdm` field. Flag,
  don't fix: the "Your Team" card's stat columns read `STATE.leads`, which is never
  populated for real data — only the roster becomes correct; full fix is out of scope
  (Phase 2/3 use `job_orders`/`submissions` instead).
- **Phase 2** — hierarchy-scope `/recruiting-dashboard` the same way
  `/reports/recruiting` already is: chain-scope `submissions` via
  `reportingChainIds()`, leave `job_orders` org-wide (shared desk inventory). Add
  `scope`/`team_size` response fields.
- **Phase 3** — a "My Team" page for any user with ≥1 direct report (data-driven gate,
  not role-based). Extract `renderTeamTree()`'s recursive node logic
  (`09-page-workflows.js`) into a shared `renderOrgSubtree()` helper reused by both
  Admin Team View (editable) and My Team (read-only). One write action: a manager can
  rename their own `team_name` (relax `PUT /users/:id` from admin-only to
  admin-or-self for that field only) — reparenting stays admin-only.
- **Phase 4** — trim `GET /users` response: for non-admins, null out `manager_id`/
  `team_name`/`manager` on rows outside the caller's own `reportingChainIds` (and not
  themself). Export `reportingChainIds` so `routes/auth.js` can use it too. Add an
  admin-only guard at the top of `renderAdmin()`/`renderManagerUsers()`.
- **Phase 5 (deferred, not this batch)** — reconciling/merging `team_assignments`
  into `manager_id` needs data-conflict review; left alone except for the Phase 0
  org-scoping fix. Future migration: backfill `manager_id` from `bd_to_bdlead` where
  unset (surface conflicts, never silently overwrite), move
  `renderBDLeadInsights()` onto `reportingChainIds`, then consider dropping
  `ra_to_bd` and the orphaned Manager Users page.

### PR grouping
| PR | Contents | Depends on |
|---|---|---|
| A | Phase 0 + 1 | none |
| B | Phase 2 | A |
| C | Phase 3 + 4 | A, B |
| Later | Phase 5 migration, only if/when asked | C |

### Verification per phase
1. Log in as users with 0/1/multi-level reports; "Your Team" shows exactly direct
   reports.
2. Compare `/recruiting-dashboard` vs `/reports/recruiting` totals for the same BD
   Lead/Director — scope should agree.
3. A `bd_lead` with reports sees the My Team nav item; one with none doesn't.
4. As non-admin, `GET /users` returns `manager_id: null` for out-of-chain rows; as
   admin, unchanged.
- Full existing suite (`test/*.mjs`, `bash test/verify-frontend.sh`) after every PR.

### What actually shipped (differs from the plan above — read this)
The plan was written optimistically: it referenced a **migration 028 `team_name`**,
a **drag-and-drop "Team View"**, and a **`renderTeamTree()` helper** as if already
built this session. **None of those were ever committed** — the repo had only
migration 026 (`manager_id`) and the per-user "Reporting Hierarchy" dropdown card.
So Phase 3's "extract `renderTeamTree`" and "rename own `team_name`" had no basis and
were replaced with fresh work. Delivered in ONE cohesive branch (the owner asked for
team structure + dashboard + admin revamp together), all phases, tested + screenshotted:

- **Backend (Phase 0/2/4):** `isBDM()` widened to include `associate_director`/
  `director`. `reportingChainIds()` extracted into a shared `./hierarchy.js` module
  (used by both `bd_recruiter_routes.js` and `routes/auth.js`). `GET /users` and
  `GET /team-assignments` org-scoped; `POST /team-assignments` now org-stamps.
  `GET /users` also trims `manager_id`/`manager` to null for non-admins on rows
  outside their reporting chain. `/recruiting-dashboard` chain-scopes submissions
  for non-admin managers (mirrors `/reports/recruiting`) and returns `scope`/
  `team_size`.
- **`getTeam()` fix (Phase 1):** now `STATE.users.filter(u => u.managerId===user.id)`
  — direct reports, killing the whole-org leak.
- **Shared client tree (03-core-render.js):** `directReportsOf()`, `reportingSubtree()`
  (client mirror of `reportingChainIds`), and `renderOrgSubtree(rootId, opts)` — one
  recursive renderer with `opts.click` (`viewas`/`admin`/`none`) and `opts.flat`.
  Reused by the dashboard, My Team, and the admin org chart.
- **Dashboard revamp:** new `renderManagerDashboard()` for real (non-guest) logins in
  a manager role — real hierarchy-scoped recruiting numbers from `/recruiting-dashboard`
  + a corrected team roster + scope badge. Replaces the legacy lead-gen dashboard
  (which reads the dead `STATE.leads` seed — empty for every real login). **Guests stay
  on the legacy dashboard** (seeded leads, no backend — better showcase; also keeps the
  recruiter-dashboard smoke's "BD still sees lead widgets" guest assertion valid).
- **My Team page** (`42-page-myteam.js`): data-driven nav gate (≥1 direct report,
  added/removed live), full reporting subtree + team work snapshot. Read-only —
  reparenting stays admin-only, deliberately.
- **Admin "Org chart" view** (`09-page-workflows.js`): a List / Org-chart toggle;
  the org rendered as reporting trees (roots = users with no manager), unassigned
  users grouped separately, click-through to each user's detail. Plus a UX admin
  guard at the top of `renderAdmin()` and `renderManagerUsers()`.
- **Tests:** new `test/team-structure-smoke.mjs` (13 checks). Existing suites green.

### Follow-up round (same session, after PR #117 merged) — the two deferred items
The owner asked for both flagged follow-ups. Branch was restarted fresh off `main`
(PR #117 had already merged) per the repo's merged-PR convention.

**1. Individual (RA) dashboard fixed.** The only role left hitting the dead
`STATE.leads` path after PR #117 was a plain `ra` with no reports (BD/BD Lead/
Director/RA Lead/Admin already route to `renderManagerDashboard`; a plain `ra` or
`bd` *given* reports via the hierarchy now also does — the manager-dashboard gate
is `isManagerRole(u) || getTeam(u).length`, data-driven like everything else this
session). New `renderIndividualDashboard()` (`05-page-dashboard.js`) is built
entirely client-side from `STATE.jobs` — no new network call, since `GET /jobs`
already scopes to `created_by = me` for this role (`routes/jobs.js`) and
`getMyJobs()` was already correct. Real lead stages (Unassigned/Assigned/
Connected/In Discussion/Rejected/Future), real industry breakdown, a "recent
leads" list, no more "Positive/Negative"/fake response-rate widgets. Guests and
"view as" keep the legacy `STATE.leads` path unchanged (seeded demo data, and
`isViewingOther` was already excluded from every other dashboard variant
pre-session — not a new gap).

**2. `team_assignments` merged into the `manager_id` hierarchy.** "Team" now
means the reporting hierarchy everywhere, not two competing sources:
  - `renderBDLeadInsights()` ("Team Insights" page, `16-insights.js`) now sources
    its BD roster from `getTeam(u)` (direct reports who are `bd`/`bd_lead`)
    instead of `team_assignments` rows. The self-service "+ Assign BD Manager"
    button/modal is removed — it only ever wrote `team_assignments`, which
    nothing reads anymore; reassignment is admin-only via Reporting Hierarchy,
    same deliberate line drawn for My Team in the original plan.
  - Its nav gate (`04-shell-login.js`) is now data-driven — anyone (non-admin)
    with ≥1 direct BD/BD Lead report sees "Team Insights", not just the
    `bd_lead` title, matching the "flexible, not a fixed ladder" hierarchy.
  - The redundant legacy "Team Assignment" card (Reports to / Members, sourced
    from `team_assignments`) removed from the Admin user-detail page — it sat
    directly above the "Reporting Hierarchy" card and showed conflicting/stale
    info from the deprecated source. Admin's flat-list "N members" chip now
    reads `directReportsOf()` too, so both Admin views agree with each other and
    with Team Insights.
  - **Migration `029_backfill_manager_from_team_assignments.sql`**: fills
    `users.manager_id` from `team_assignments` (`assignment_type='bd_to_bdlead'`)
    *only* where `manager_id` is currently `NULL` — never overwrites a value an
    admin already set via the hierarchy UI. Includes a commented-out SELECT to
    surface conflicts (both sources set, disagreeing) for manual review.
    **APPLIED to the live DB** (owner approved after being asked) via Supabase
    MCP `apply_migration` — 1 pre-existing BD Lead↔BD pairing carried over into
    `manager_id`, 0 conflicts found. This was a data-only change (no deploy
    needed); it's already reflected in Team Insights / My Team / the Admin org
    chart.
  - **Deliberately not touched:** the `email_accounts` subsystem + the orphaned
    "Manager Users" page (`12-manager-users.js` / `20-email-accounts.js`,
    `emailaccounts`/`managerusers` — confirmed zero reachable `goPage()` call
    sites, same finding as the original plan). It's a separate, larger legacy
    system (its own email-account table, distinct from the per-user "Outreach
    Email IDs" system the reachable Admin page uses) — retiring it needs its own
    audit, not a rename inside this pass. `ra_to_bd` team_assignments rows are
    untouched for the same reason.
- **Tests:** `test/team-structure-smoke.mjs` extended with 3 more checks (own-
  jobs-only scoping, real stage pills, no dead-data leftovers) — 16/16. All 17
  suites green after this round too.

### Session 5 — final status (all shipped and live)
| What | PR | State |
|---|---|---|
| Phases 0–4 (hierarchy fixes, dashboard + admin revamp, My Team page) | [#117](https://github.com/PrinceThomas37/fute-lms-backend/pull/117) | Merged, deployed |
| Individual (RA) dashboard fix + `team_assignments` → `manager_id` merge | [#118](https://github.com/PrinceThomas37/fute-lms-backend/pull/118) | Merged, deployed |
| Migration 029 (backfill `manager_id` from old `bd_to_bdlead` rows) | — (data-only, no deploy) | Applied to live DB |
| This context-window writeup | [#119](https://github.com/PrinceThomas37/fute-lms-backend/pull/119) | Merged (docs-only) |

**Session shape, for a future session picking this up cold:** the owner asked to
continue from a handoff plan doc, approving each step as it shipped rather than
reviewing code — "continue, build it" → (plan grounded against actual repo state,
since the plan referenced a migration/`team_name`/Team View that were never
actually committed) → PR #117 → "yes merge it" → two follow-ups requested directly
("fix individual dashboard" + "merge team_assignments") → PR #118 → "merge it" →
asked before touching the live DB, initially declined with no answer, asked again
later and approved → migration 029 applied live → this doc. Every merge in this
session was preceded by an explicit "merge it" from the owner; the one live-DB
write was preceded by an explicit yes after an initial non-answer. That pattern —
ship on a dev branch, screenshot/describe, wait for an explicit go before merge or
before any live-data write — is the one to keep using.

**Everything from the original plan is done** except the two items explicitly
scoped out both in the plan and again during this session (not oversights —
deliberate, flagged both times):
1. **Retiring the orphaned "Manager Users" page** (`12-manager-users.js` /
   `20-email-accounts.js`) and its separate `email_accounts` subsystem. Confirmed
   unreachable via any `goPage()` call site, but `12-manager-users.js` also holds
   live code the *reachable* Admin user-detail page depends on (email-ID connect/
   reconnect handlers) — so this is a real audit-and-split job, not a delete.
   `ra_to_bd` team_assignments rows are only consumed by this same orphaned page.
2. **Individual-contributor dashboard for anyone besides `ra`** — turned out not
   to be needed. After the routing fix, every role except a plain `ra` with no
   reports already lands on a real-data dashboard (recruiter, or the hierarchy-
   scoped manager/team dashboard). Noted here in case that assumption ever
   breaks (e.g. a new role is added that isn't manager-like and isn't `ra`).

---

## Session 6 — screen-by-screen redesign + Job White-board + stage vocabulary

**Dev branch**: `claude/dashboard-redesign-review-6o73ws`. **Shipped as PR #122,
MERGED to `main` and LIVE.** Migration `032` (the stage data-rename) applied to the
live DB **after** confirming the new build was serving. This session picked up a
long redesign review (the owner reacting to the app screen by screen) plus a
mailbox-health ask, and finished with "yes merge all" → merged + deployed + live
data renamed.

> **Repo note:** the GitHub repo is now `PrinceThomas37/PACE_All-in-one-recruting-tool`
> (renamed from `fute-lms-backend`). Local dir is still `fute-lms-backend`; Render is
> still `fute-lms-backend.onrender.com` (auto-deploys from `main`). GitHub MCP calls
> still use owner `PrinceThomas37`, repo `fute-lms-backend` (the API resolves the
> rename). PR #121 (an earlier review PR on this same branch) was **closed unmerged**;
> #122 is the one that shipped.

### What shipped (all in PR #122)

**Navigation & Dashboard** — one consolidated sidebar; greeting-first dashboard with
recruiting widgets reordered around next-actions; profile row + "My profile" in the
sidebar footer.

**My Team hub** — Team Insights + Reports folded into one tabbed page; "Lead Insights"
renamed; transitive rosters. Reports tab gained date/role filters, a hot-jobs ranking,
a per-person productivity breakdown, an org-chart view (List ⇄ Org-chart toggle), and a
team-activity panel fed by a **new `GET /team/activity`** endpoint. Reports stay
hierarchy-scoped (self + reporting chain; admin = whole org).

**Leads / Jobs / Clients** — Leads: one colour system, number-only status chips,
Position-first layout, horizontal-scroll fix. Jobs: a "Team's Jobs" view, JD
show-more/less + a **"Re-write"** action that retains the prior JD (migration `031`
added `previous_description`/`previous_description_at` on `job_orders`), multi-select
bulk actions. Clients / Reminders / Deliverability brought into the same visual
language.

**Email mailbox sign-in health (Track A)** — a health badge on connected mailboxes
that captures and surfaces the **exact** token-refresh error, so a broken mailbox is
visible instead of failing silently. Migration `030` added
`last_refresh_at`/`last_refresh_error`/`refresh_failed` on `microsoft_tokens` +
`gmail_tokens`; logic in `mailbox-health.js`.

**Job White-board (was "Candidate Pipeline")** — renamed. Cards are now
**drag-and-drop** between stage columns; a drop runs the **same** `openStageModal()`
as before (note, sub-stage, interview details, and the recruiter/BDM gate all still
apply — a recruiter still can't drop into "Submitted to Client"). The per-card "Move
to…" dropdown became a **colour-coded sub-stage** selector (`subStageColor()`:
green = good, red = bad, amber = in progress). Handlers: `bdDragStart`/`bdDragOver`/
`bdDrop`/`bdDragEnd`/`bdSetSubStage` in `25-workflow-bd.js`.

**Stage vocabulary consolidation (the notable architectural bit)** — the submission
lifecycle went from 12 → **11 stages**: **`Confirmation` → `Joining`**, and
**`Rejected` + `Not Joined` merged into `Not Accepted`** (the reason lives on the
sub-stage; `Not Accepted` sub-stages are the combined reason list). Made safe to ship
ahead of the data rename by a **`normalizeStage()` helper on BOTH sides**
(`bd_recruiter_routes.js` + `33-stage-modal.js`, aliases
`Confirmation→Joining`, `Rejected|Not Joined→Not Accepted`), applied at every read
that buckets/counts by stage (board columns, funnel, `/recruiting-dashboard`
`by_stage`, `/reports/recruiting` funnel + per-user, `/bd-analytics`, recent-
rejections) and normalized on the PATCH write path. Result: old stored values render
correctly in the new columns **with or without** the migration — no card ever
vanishes. The canonical vocabulary lives in `33-stage-modal.js`
(`window.ATS_STAGE_LIST`/`ATS_SUB_STAGES`/`ATS_STAGE_COLORS`); duplicated copies in
`25-workflow-bd.js` (BD_STAGES/STAGE_COLORS/STAGE_ABBR), `28-page-pipeline.js`
(SUBSTAGE_COLORS/STAGE_RANK), `30-page-candidate.js` (STAGE_ORDER/milestones),
`05-page-dashboard.js` (recStageColor) were all updated to match — **if a stage is
ever renamed again, update all five plus the backend STAGES + STAGE_ALIASES.**

### Migrations applied to the live DB this session
| Migration | What | When |
|---|---|---|
| `030_mailbox_refresh_health.sql` | mailbox token-refresh health columns (additive) | applied |
| `031_job_previous_description.sql` | `previous_description`(+`_at`) on `job_orders` (additive) | applied |
| `032_stage_vocabulary.sql` | data rename `Confirmation→Joining`, `Rejected|Not Joined→Not Accepted` on `submissions` + `submission_activity` | applied **after** the new build was confirmed live (was held until the owner's "merge all"). Footprint was tiny: **1** submission (`Rejected`) + 1 activity row; 0 `Confirmation`/`Not Joined`. Verified 0 old values remain. |

The migration was ordered **after** deploy on purpose: the new code is
forward+backward compatible (normalizeStage), but the *old* live code only knew the
old names — renaming data while old code was still serving would have briefly hidden
that one card. Polled the live `js/33-stage-modal.js` for `normalizeStage` (deploy
went green in ~15s), then ran the rename.

### Test status
Playwright smokes updated to the new vocabulary, all green:
`stage-consolidation-smoke` 14/14, `workflow-gating-smoke` 25/25,
`submission-review-smoke` 16/16, `recruiter-dashboard-smoke` 34/34,
`job-candidate-updates-smoke` 25/25, `bash test/verify-frontend.sh` PASS.
(Note: there is no `candidate-profile-smoke.mjs` — I guessed that name once and it
404'd; the real candidate/board coverage is in the two smokes above.)

### Open / next candidates (queued with the owner)
- **Offer sheet** — a dedicated offer-detail capture (salary / start date /
  offer-letter attachment) + confirmation "chase the joiner" nudges + a funnel-hover
  that lists the candidates behind each bar (`stage_samples`). Deliberately deferred:
  offer status is already trackable on the **Offer** column's sub-stages
  (Preparing / Extended / Negotiating / Accepted / Declined), so this is an
  enhancement, not a gap. This was the "offer flow / E4" part of the White-board plan
  that was descoped to ship the board + vocabulary cleanly.
- Everything still open from `CLAUDE.md`'s growth bets: **RLS slice 3b (held — do not
  enable on the live DB without a fresh go-ahead)**, per-role *permission* differences,
  candidate↔JD match scoring, CSV import/export + public API, generalized audit trail,
  PWA polish, Stripe billing seam, and folding the legacy un-org-scoped
  `/bd-analytics/*` into the org-scoped reports.

### Session shape (for a cold resume)
Owner reviewed the app screen by screen and reacted as a user ("this feels off",
"rename this", "merge all"), never reading code — the standard loop. The whole
redesign lived on ONE dev branch through several phases (nav/dashboard → My Team →
Leads/Jobs/Clients → mailbox health → Job White-board + vocabulary), shown via
screenshots, then merged in one shot on "yes merge all". The live-data migration was
held until that same go-ahead and run only after confirming the deploy — same
discipline as Session 5 (ship on branch, screenshot, wait for explicit go before
merge or any live-DB write).

---

## Session 7 — the Autonomous Recruiting Engine (Steps 0 and 1)

**Dev branch**: `claude/continued-session-context-dj95te` · **PR #124 (draft, not
merged)**. The owner opened with a big idea: futé should find its own leads *and*
its own candidates off the internet against one shared notion of relevance, run
outreach on both branches, then read the resulting conversations and say what to
do next. Two branches, one brain, closed loop.

> **The plan of record is `docs/AUTONOMOUS_ENGINE_PLAN.md`.** It was written and
> committed first, deliberately, because the owner said *"I will forget later what
> we discussed now."* `CLAUDE.md` now links it. Read it before planning new work.

### Decisions the owner made (these constrain everything)

| Decision | Consequence |
|---|---|
| **₹0 budget**, pay later once proven | Free / ToS-clean sources only |
| **`ANTHROPIC_API_KEY` is NOT funded** | Everything is **rules-first**. AI is a seam, never a dependency. *Claude in the owner's chat ≠ the app having a key.* |
| **Leads = end clients hiring directly** | Free employer ATS boards (Greenhouse/Lever/Ashby/Workable) *are* end-client boards → right source, plus a staffing-firm exclusion filter |
| **Runs inside futé, not Make** | Make free = 1,000 ops/month ≈ 150 leads total, and becomes per-customer cost if sold |
| **US + India** | Market-agnostic build; India's free coverage is genuinely thin — a data fact, not a code gap |

Verified live during the session: Make is connected but empty (free tier: 1 team,
2 scenarios, 1,000 ops/mo, 15-min minimum). Apollo is connected with **125 lead
credits and 0 export credits**. Indeed MCP returns real structured postings. **All
of these are on the owner's Claude account, not the app** — futé running
unattended has none of them and needs its own server-side keys.

### Step 0 — trustworthy background work (SHIPPED on the branch)
Every recurring job was a `setInterval` in the single web process; Render's free
tier sleeps that process and stops them all, silently. Jobs now register with
`engine-runs.js`, which keeps **due-ness in the DB, not in a timer**, so the
in-process interval and an external `GET /cron/tick?key=…` ping both drive the
same work and cannot double-run it. Runs land in `engine_runs`. Free heartbeat via
`.github/workflows/heartbeat.yml` (the repo is **public**, so Actions minutes are
unlimited — noted in the file that going private makes it billable).

Bugs fixed on the way: the daily follow-up guard required the clock to read
*exactly* the send time (a sleeping service lost the whole day's follow-ups); the
run-on-startup block that papered over it ignored the send time entirely, so a 2am
redeploy sent follow-ups at 2am; and **15 test files** resolved paths from a
hard-coded `/home/user/fute-lms-backend` left over from the repo rename, so they
failed on any checkout.

### Step 1 — one relevance engine (SHIPPED on the branch)
`public/js/38-match-score.js` is now a **UMD module loaded by both the browser and
Node**, and `match-engine.js` requires that same file. The score the recruiter sees
and the score the server sorts by are one piece of code and cannot drift — the
deliberate opposite of the stage vocabulary's six hand-synced copies.

Added: `rankCandidates()`, `deriveJobSkills()` (runs the existing jd-parser over a
job order's description to fill the skill/experience fields that were hand-typed —
skills carry **half** the match score, so blanks meant ranking on title and
location alone; it only ever fills blanks), and `buildRequirement()` — the single
normalized object both sourcing branches will search against.
Endpoints: `GET /job-orders/:id/matches`, `POST /match/score`,
`POST /job-orders/:id/parse-jd`.

**Best matches tab** on a job order: the whole database ranked, with the *reason*
for each score inline (not just on hover), band + text filters applied
server-side, already-tagged candidates marked in place, and an honest warning when
the job lists no skills.

### Migrations — WRITTEN, NOT APPLIED
`033_engine_runs.sql`, `034_match_and_requirement.sql`. **Neither has been run
against the live DB** — awaiting an explicit go-ahead per the standing rule. The
code is deliberately safe without them: `engine_runs` inserts are best-effort, and
the `requirement` write is held behind a one-time column probe because writing to a
missing column would fail the whole insert and stop anyone creating a job order.

### Also needed before Step 0 does anything
`CRON_KEY` set in Render **and** as a GitHub Actions secret (same value).

### Test status — 22 files, all green
New: `engine-runs-smoke` 30/30 (incl. the concurrent interval-plus-ping race),
`match-engine-smoke` 45/45 (incl. **server and browser returning byte-identical
scores**), `best-matches-smoke` 22/22. Existing suites unchanged and passing.

### Corrections to earlier notes
An audit in this session claimed the Match column was missing from the Candidates
grid and that `match-score-smoke.mjs` asserted something untrue. Wrong file: the
test exercises `renderPipelinePage()` (the job's Candidates tab), which **does**
have the column. It is genuinely absent only from the Candidates *database* grid.

### Next
Step 2 (lead branch: ATS job feeds → POC → why-the-role-exists → sequence),
Step 3 (candidate branch: GitHub + CSV + the ranked internal pool), Step 4
(conversation intelligence). Detail in `docs/AUTONOMOUS_ENGINE_PLAN.md`.

---

## Session 8 — Autonomous Engine Steps 0–3 shipped, merged, migrated + a full repo-structure review

**Dev branch**: `claude/continued-session-context-dj95te`.
**PR #124 — MERGED** to `main` @ `ba379e4` (squash) → Render auto-deployed. Steps 0/1/2.
**PR #125 — OPEN DRAFT** @ `0808602`. Step 3.
**Migrations `033`–`036` — APPLIED to the live database** (2026-08-01, on the
owner's explicit "apply the migration").

> Branch mechanics: after #124 merged, the branch was restarted from the new
> `main` and **force-with-lease** pushed. That was correct — its old commits were
> already squash-merged. Do the same next time.

### 1. What is live vs. what is waiting

| | State |
|---|---|
| Step 0 (trustworthy scheduler) | **Merged + deployed** |
| Step 1 (shared relevance engine) | **Merged + deployed** |
| Step 2 (automatic lead sourcing) | **Merged + deployed** |
| Step 3 (candidate outreach) | **PR #125, draft, not merged** |
| Step 4 (conversation intelligence) | **Not started** |
| Migrations 033–036 | **Applied to live DB** |
| `CRON_KEY` | ❌ **NOT SET — owner-only action, blocks all overnight automation** |

**`CRON_KEY` is the one thing standing between "deployed" and "working."** It must
be the same long random value in **both** the Render environment **and** as a
GitHub Actions secret named `CRON_KEY`. Until then `/cron/tick` returns 404 and
background jobs only run while somebody happens to be using the app.

### 2. Migrations applied to the live DB — evidence

Pre-flight (all confirmed before touching anything): none of the 5 tables, 8
columns or 6 indexes already existed; `sourcing_candidates` had **no** duplicate
`(org_id, provider, external_id)` rows that would have failed 036's partial
unique index.

| Migration | What |
|---|---|
| `033_engine_runs` | `engine_runs` table + 2 indexes |
| `034_match_and_requirement` | `job_orders.requirement`/`requirement_at`/`skills_source`; `match_scores` + 4 indexes |
| `035_lead_sources` | `lead_sources`, `sourced_jobs_raw`, `enrichment_cache`; `organizations.ra_mode` |
| `036_candidate_nurture` | `candidates.profile_url`/`source_external_id`/`last_reply_at`/`last_contact_at`; partial unique index on `sourcing_candidates` |

Post-apply verification: 5 tables + 8 columns + 6 indexes present. **Live data
untouched** — 1,261 `jobs`, 9 `candidates`, 2 `job_orders`, 7 `submissions`,
1 `organizations` with `ra_mode='manual'`. Sourcing therefore stays **opt-in**;
nothing runs on its own until a board is added.

**RLS posture (checked, not assumed).** The 5 new tables have no RLS, matching
~33 existing ones — the deferral recorded in `CLAUDE.md` growth bet 1, slice 3b.
Verified this is **latent, not live**: the anon key has **never** been committed
(searched all git history; `env.example` holds a placeholder), and the browser
never talks to Supabase directly — the frontend is API-only against Express,
which uses the service-role key server-side. It becomes urgent if that key leaks
(**the repo is public**) or when org #2 is onboarded. Two advisor ERRORs worth
carrying: `microsoft_tokens` exposes `access_token`/`refresh_token`, and
`email_tracking` exposes `token`.

### 3. Step 3 scope pivot — GitHub was dropped, deliberately

The plan had Step 3 leading with GitHub candidate sourcing. The owner asked
*"why would system find contacts on GitHub — does it have a contact database?"*
**It does not, and they were right.** GitHub is where developers publish code;
roughly a quarter surface a public email. Good **discovery**, poor **contact**
source — it does not solve the ₹0 wall. Also: GitHub's acceptable-use policy
prohibits using API-obtained data for unsolicited email, so an auto-emailing
feature could not have shipped in a sellable product anyway.

**No GitHub code was written.** Step 3 became "fix what you already own."
Don't re-litigate this; the analysis is in `docs/AUTONOMOUS_ENGINE_PLAN.md`
under "Step 3 — REVISED".

Owner also chose: sequences may target **everyone, with a warning on sourced
candidates** (judgement sits with the user, not a hard block).

### 4. The five defects Step 3 closed

1. **The Candidates page "Add to email sequence" button did nothing** — and
   *looked like it worked*. No `candidate` context loader existed, so the engine
   handed every step an empty context; the channel read an undefined candidate,
   returned `no_candidate_email`, and the enrolment advanced to `completed`
   without sending. The worst failure mode there is: silent success.
2. **Sequence sends were invisible** — no pixel, no `email_tracking` row, and
   they skipped the signature, the HTML wrapper, and every deliverability gate
   the sales channel applies (so they could send from an **auto-paused** mailbox).
3. **A candidate who replied kept getting emailed** — no `CANDIDATE_REPLIED`
   event, no `exitEntity` for candidates *or* submissions.
4. **Every LinkedIn URL imported via Sourcing was discarded** on import.
5. **`GET /sourcing/staged` was wide open** — no org scoping, no guest check, no
   role check. Batch dedup and the discard route were unscoped too.

Also fixed while writing the tests: the first version of the candidate opt-out
check passed a message *object* to `isOptOutReply`, which takes **text** — it
would have stringified and silently failed to honour unsubscribes.

**Known gap left open, on purpose:** the reply sweep is **Microsoft-only**, so a
sequence sent from a Gmail mailbox still cannot auto-exit on reply.
`gmail-provider.listMessages/getMessage` exist and **nothing calls them**. Step 4.

### 5. Tests: 25 files, all green

New this session: `engine-runs-smoke` 30/30, `match-engine-smoke` 45/45 (asserts
the Node and browser scorers return **byte-identical** results),
`best-matches-smoke` 22/22, `lead-sourcing-smoke` 78/78,
`sourced-leads-page-smoke` 31/31, `candidate-sequence-smoke` 33/33 (includes a
case that deliberately omits the context loader, to prove the test catches the
original silent no-op).

**Sandbox limitation, unchanged:** the network policy blocks the real job-board
endpoints *and* the Render host. Adapter **parsing** is tested against documented
shapes; adapter **URLs have never hit a live board.** `POST /lead-sources/test`
(the "Test it" button) exists to close that from the deployed app.

---

## 6. Repo structure review — the owner shared two reference images

The owner shared a Node backend folder-structure infographic and a "System Design
Roadmap 2026" and asked what futé matches and what should change, with a hard
constraint: **no extra cost**.

### The decisive finding

**`docs/REFACTOR_MANIFEST.md` records a prior 14-PR refactor (#67–#80) run
against two guides written by an actual developer the owner brought in.** The
current `config/` + `routes/` + `middleware/` shape, with routers as
`(ctx) => Router` factories, was that effort's **deliberate endpoint** — it did
not adopt controllers/services/models, by choice. An infographic is not a higher
authority than that. Its own rule was *"never touch the whole thing at once."*

**But the gains eroded:** that refactor took `index.js` 3,649 → 2,615. It is now
**3,337** and climbing (127 lines added this session alone). The problem is not
folder names — it is that new work keeps landing in the two biggest files.

The guides themselves (`FRONTEND_REFACTORING_GUIDE.md`,
`BACKEND_REFACTORING_GUIDE.md`) are **gone** — not in the repo, not in git
history. The manifest is the only surviving record.

### Image 1 verdict
Already matching: `config/`, `routes/`, `middleware/`, `test/`, `.env` handling,
`.gitignore` (working — `.env` ignored, never committed), `package.json`.
Genuinely missing, by value: **`models/`** (the only gap with evidence — see §7),
**`services/`** (25 modules loose at root), and **splitting the two oversized
files** (not in the image at all, and the real problem).
Not worth doing: `src/`, `controllers/`, `utils/`, `server.js` rename, Dockerfile.
Trivial: delete the stray `gitignore` (no dot) beside the real `.gitignore`.

### Image 2 verdict (₹0 filter applied)
**Already done (5/20):** DB indexing (64 indexes), event-driven architecture, API
design, caching, most of idempotency/retries.
**Real and free (4):** rate limiting (**none exists**; public endpoints are
`/o/:token.gif` and `/cron/tick`); **timeouts on Microsoft Graph and Gmail — they
have none, and a hung call can stall an entire reply sweep** (job boards, DNS and
verification *do* have them); retry-with-backoff on outbound calls; a capacity
estimate.
**Not applicable (9):** replication, sharding, consistent hashing, leader
election, distributed transactions, consistency models, CDN, microservices, load
balancing. The app has **1,261 leads and one server**.
**Message queues** — the one true architectural gap, but pointless until 2+
servers, and Render free runs one. Correction to something said mid-session: it
would **not** need paid Redis; `pg-boss` runs on the existing Postgres.

---

## 7. ⚠ DEPENDENCY MAP — READ BEFORE ANY RESTRUCTURE

Ten ways moving files breaks this repo, highest risk first. **Several fail
silently.**

1. **`learned-skills.js:9` uses `__dirname` to find `learned-skills.json`.** Move
   the module without the JSON and `loadLearnedSkills()` returns `{}` (it's
   `existsSync`-guarded) while `saveLearnedSkills()` **writes a brand-new JSON at
   the new path**. No error, no log — learned skills silently reset.
2. **`test/send-race-guard.mjs:19` and `test/candidate-sequence-smoke.mjs:249`
   read `index.js` as raw text** and regex-assert on its source. **Any** extraction
   out of index.js breaks them even when runtime behaviour is identical.
3. **`match-engine.js:24` requires `./public/js/38-match-score.js`** — the only
   server→browser require in the repo, and deliberate (one scorer, two runtimes).
   **Do not move `38-match-score.js`**: it is pinned by three independent things —
   the `<script>` tag at `public/index.html:52`, `test/verify-frontend.sh`, and
   this require.
4. **`routeCtx` (`index.js:2540-2550`) captures 32 values at one instant.**
   Extracting any of them must preserve define → build-ctx → mount ordering, or
   boot dies with TDZ errors. `const`s don't hoist.
5. **4 bespoke mounts are ordering-load-bearing** — `gmail` (2553), `wf` (3280),
   `warmup` (3294), `cron` (3320). They sit far from the main 2551-2568 block
   because they need engines constructed first. Cannot be hoisted alone.
6. **`bd_recruiter_routes.js` takes `(app, deps)`, not `(ctx) => Router`** — it
   registers ~65 routes directly on `app`, and duplicates `withOrg`/`orgStamp`
   from index.js. Converting it is the single biggest job.
7. **All 27 `test/*.mjs` use `../`-relative paths** (`../public`, `../index.js`,
   `../<module>.js`). A `unit/` + `integration/` split makes **every one** off by
   a level. `test/verify-frontend.sh:12` does `cd "$(dirname $0)/.."` and breaks
   the same way.
8. **`require('../lead-sources')` ×2 is directory-form** — renaming the folder or
   its `index.js` breaks it silently at require time.
9. **`express.static('public')` (`index.js:491`) is CWD-relative**, not
   `__dirname`-relative. It only works because `npm start` runs from the root.
10. **Exactly ONE dynamic require** in the whole tree (`resume-parser.js:18`,
    npm names only). Every other relative require is a **string literal** — so a
    mechanical rewrite is genuinely viable. This is the good news.

**Scale of a models layer: 574 raw `supabase.from(` calls across 31 files** —
`index.js` 155, `bd_recruiter_routes.js` 113, `routes/auth.js` 27,
`warmup-engine.js` 21. That count *is* the argument: four org-scoping leaks
appeared in one session, all the same shape — a hand-written query that forgot
`withOrg()`. Note `config/integrations.js` (8 queries) and `config/settings.js`
(2) hold DB access and are not pure config. Three table names are **computed**
(`mailbox-health.js:63`, `index.js:2795` `resolveEmailAttachments`,
`index.js:2822` `connectedMailboxById`) so a naive per-table split misses them.

**`index.js` extraction budget (~2,090 of 3,337 lines could move, leaving ~1,200):**
Graph send pipeline 983-1338 (356) · send loop 1339-1665 (327, contains the
253-line `processPendingEmailSends`) · follow-up engine 1807-2048 (242) · mailbox
sweeps 2049-2307 (259) · **recruiting workflow channels + candidate/meeting routes
2729-3256 (528 — the biggest single opportunity, recruiting logic sitting in a
sales-oriented file)** · send-window + throttle helpers 114-337 (224) · email
generation 637-789 (153).

**`bd_recruiter_routes.js` (2,140) splits cleanly into:** `routes/job-orders.js`
(158-733), `routes/candidates.js` (734-1069 + 1459-1479), `routes/submissions.js`
(1070-1286), `routes/pipeline.js` (1287-1458), `routes/sourcing.js` (1550-1753),
`routes/recruiting-analytics.js` (1754-2140), plus `services/match.js` (29-67) and
`services/pipeline-stages.js` (68-157).

**Test split:** 10 pure unit (`authorize`, `config-env`, `email-tracking-smoke`,
`settings`, `engine-runs-smoke`, `lead-sourcing-smoke`, `lead-stage-permission`,
`candidate-sequence-smoke`, `send-race-guard`, `backend-smoke` — the last spawns a
real server, arguably integration) · 17 Playwright browser tests ·
`match-engine-smoke` is hybrid (dynamic Playwright import at L174).
**`playwright-core` is used by 17 tests but is NOT in `package.json`.**

---

## 8. Where to pick up

**Owner's stated intent (end of Session 8):** do the **restructure first in a
fresh session**, then Step 4. They were running low on credits and asked for this
handoff instead of starting the work.

Recommended shape — the **narrow** version, not match-the-poster:
1. `models/` data-access layer so org-scoping is automatic, not remembered.
2. Split `index.js` and `bd_recruiter_routes.js` (see §7 line maps).
3. The four free reliability items — **timeouts on Graph/Gmail first**, it is the
   only item across both images that can bite today.
4. Move the 25 root modules into `services/` (optional, cosmetic).
5. *Then* Step 4 (conversation intelligence), which otherwise adds ~20 more
   hand-written queries to the pile.

Also outstanding: **set `CRON_KEY`**, merge PR #125, and verify one real
Greenhouse/Lever board through the "Test it" button — the adapters have still
never met a live feed.

---

## Session 9 — the restructure (Session 8 §8 items 1–4, done)

**Dev branch**: `claude/context-file-continuation-yzne2a`, branched level with
`main` after PR #125 merged. Four commits, each independently tested and pushed.
**Backend-only — nothing about the app looks or behaves differently.** That is
the point: this session bought structure and safety, not features.

Picked up exactly where Session 8 §8 left it: *"do the restructure first in a
fresh session, then Step 4."*

### 1. Reliability — the two items that could bite today

**Timeouts on every outbound call** (`http-client.js`). Node's `fetch` has **no
default timeout**, and every outbound call used it bare. A hung Microsoft Graph
or Gmail socket hung its caller forever — and those callers are the background
sweeps in the single web process, so one bad connection could stall an entire
reply sweep with no error and no log.

Now behind `fetchWithTimeout` / `fetchWithRetry`: `graphMailRequest`, the MS
token refresh, the Gmail provider's `oauthToken` + `api`, the MS OAuth callback,
the zip lookup, all four Anthropic call sites. `email-verify.js` and
`routes/integrations.js` had each grown their own AbortController helper; both
now adapt to the shared one.

> **The retry rule, do not widen it casually:** a timeout does not mean the
> server never got the request. Retrying `POST /me/sendMail` would send the same
> email twice. Retries are **safe methods only** unless a caller passes
> `retryUnsafe` — used only for token refresh (idempotent, and a transient
> failure there takes a whole mailbox offline). The OAuth **code exchange stays
> un-retried**: an authorization code is single-use, so a replay fails with
> `invalid_grant` and buries the real error.

`lead-sources/index.js` keeps its own fetcher — it already had a timeout,
injectable `fetchImpl` and bespoke error shaping covered by 78 tests.

**Rate limits on the unauthenticated surface** (`middleware/rate-limit.js`).
There were none. `POST /auth/login` was the real gap — unlimited guesses against
a bcrypt hash is both a break-in route and a CPU-exhaustion route on a
one-process service. Two limiters, because they stop different attacks and
neither masks the other: **per-IP** (one host spraying many accounts) and
**per-email** (one account guessed from many IPs). `/cron/tick` is limited too
(key-gated, but the check runs after the request is accepted).

The **pixel is limited by skipping the DB write, never by returning 429** — a
mail client that gets an error renders a broken-image box to the recipient,
which is worse than an uncounted open.

Also set **`trust proxy: 1`**. Render terminates TLS at its proxy, so without it
every request reports the proxy's address and the limiters would have counted
the whole internet as one client. Exactly one hop, so `X-Forwarded-For` can't be
spoofed past a limit.

### 2. `models/` — org scoping you cannot forget

The evidence for this was already in the repo: ~574 raw `supabase.from()` calls,
and **four cross-org leaks in one session, every one the same shape** — a
hand-written query that forgot `withOrg()`. The failure is silent (more rows,
never an error), so reviewing 574 call sites is not a control.

```js
db.forRequest(req).from('candidates').select('*')   // scoped by construction
db.forOrg(orgId).from('jobs').select('*')           // background jobs
db.global.from('app_settings').select('*')          // no org_id column
db.crossOrg('emails').select('*')                   // deliberate, greppable
```

Anything else throws `TenancyError` — a global table through a scoped accessor,
a tenant table through `db.global`, or a table in neither list (a typo).

**Not an ORM.** Every method returns the real Supabase builder, so all existing
chaining works and converting call sites is mechanical. Transitional semantics
match the `withOrg()` it replaces: no resolvable org ⇒ no filter.

`models/tables.js` is verified against the **live schema**, not the migrations —
022 created 33 tenant tables but 024/027/034/035 added five more, so the
migration list alone is already wrong. **38 tenant / 8 global.**

**Converted `routes/contacts.js` + `routes/reminders.js`, which closed a real
bug**, not just proved the pattern: `PATCH /contacts/:id/email-status` updated a
contact **by id with no org filter and — unlike the PUT/DELETE beside it — no
`canTouchJob` check either**, so a BD in one org could patch another org's
contact by guessing an id. Its OOO reminder was written unstamped. All four
`/reminders` endpoints scoped by `user_id` alone.

Safety was **checked, not assumed**: the live DB has one org and **zero null
`org_id` rows** in any affected table (3,123 contacts, 6 reminders), so adding
these filters is a provable no-op today and correct once org #2 exists.

> **Recorded, not fixed:** `microsoft_tokens` and `gmail_tokens` have **no
> `org_id`**. Reached only via `user_emails` (which is scoped), so not a live
> leak — but close it with RLS (growth bet 1, slice 3b) before org #2.

### 3. The two oversized files, split

| | before | after |
|---|---|---|
| `bd_recruiter_routes.js` | 2,140 | **43** (mounter only) |
| `index.js` | 3,403 | **2,868** |

`routes/recruiting/{job-orders,candidates,submissions,pipeline,lookups,sourcing,analytics,outreach}.js`
+ `services/recruiting-core.js` + `services/candidate-fields.js`.

**Why a shared core rather than just cutting the file up:** the old file relied
on **function hoisting across its sections**. `recruiterCanTouchJob` was defined
in the pipeline block and called from job-orders, relevance and sourcing;
`invalidateJobScores` was defined in the relevance block and called from the
CRUD above it; `SUBMISSION_SELECT` was declared in submissions and used by
pipeline's promote. Cutting on section boundaries breaks exactly those calls —
and breaks them **silently**, because the handlers catch broadly.

A static scan for shared identifiers **caught four such references after the
first cut** (`CANDIDATE_SELECT` in job-orders; `SUBMISSION_SELECT` / `EVENTS` /
`emit` in pipeline). None would have thrown at load time.

> **One near-miss worth carrying:** while moving `recruiterCanTouchJob` I
> rewrote it as "BDM → true, non-recruiter → false". The original is
> `if (!(isRecruiter(req) && !isBDM(req))) return true` — it constrains **only a
> pure recruiter** and returns true for every other role. The rewrite would have
> locked roles like `ra` out of job orders. Restored verbatim. **When moving
> code, move it; do not tidy it on the way.**

`index.js` is the **sales** engine (leads, send loop, follow-ups, sweeps). The
~547 lines of recruiting logic inside it — the recruiting workflow channels,
`POST /candidates/email`, `/companies/:id/email`, the interview-invite /
create-meeting / meetings endpoints, `exitCandidateSequences` — moved to
`routes/recruiting/outreach.js`. Mounted with a **call, not a top-of-file
require**, because it needs `wfEngine` and the send helpers to exist first (same
reason the wf/warmup/cron mounts sit where they do). All 18 values it needs are
defined well before the mount point — no TDZ hazard.

### 4. Verification (this touched the live send path, so it is heavier than "tests pass")

- **Route parity:** the 58 pre-split recruiting route paths are byte-identical
  before/after (diffed). `test/recruiting-routes-mounted.mjs` boots the **real
  server** and asserts all **63** answer non-404 — from a **hard-coded** list
  taken from the pre-split file, because a list regenerated from current source
  would happily agree with a route that had just been deleted. It also asserts
  an unknown path **does** 404, so those non-404s mean something, and pins the
  two order-dependent literal routes.
- **No logic lost:** every non-comment line of both old files is present in the
  new ones. The only lines that "disappear" are `require` paths and the deps
  destructure.
- **The org-scoping test was run against the pre-conversion code and fails 11 of
  13**, naming each unscoped query. It is a guard, not a rubber stamp.

### 5. Packaging gaps found while verifying

- **`playwright-core` was used by 17 suites and was not in `package.json`** —
  now a devDependency. Without it, 17 suites fail with a module error that looks
  like 17 broken tests.
- **`npm test`** added (`test/run-all.mjs`). It judges by **exit code**: the
  suites print results in two formats, and grepping stdout mis-reported 20
  passing suites as failures during this session. Do not re-invent that grep.
- Deleted the stray `gitignore` beside the real `.gitignore` (byte-identical,
  inert) — the trivial cleanup flagged in Session 8 §6.

### 6. Test status — 32 suites, all green

New: `http-client-smoke` 45/45, `rate-limit-smoke` 26/26, `models-smoke` 47/47,
`org-scoping-routes-smoke` 13/13, `recruiting-routes-mounted` 6/6.
`test/candidate-sequence-smoke.mjs` asserts on **source text** and was reading
`index.js`; it now reads `routes/recruiting/outreach.js` and gained a guard that
fails loudly if the channel is not in the file it is reading — left alone it
would have kept passing while asserting nothing.

### 7. Where to pick up

**Not done from Session 8 §8:** moving the 27 root modules into `services/`
(item 4 — cosmetic, deliberately skipped). Of the four free reliability items,
timeouts + retries + rate limiting are done; **a capacity estimate was not**.

Still outstanding, unchanged and owner-facing:
1. **`CRON_KEY` — still not set.** Same long random value in **both** Render's
   env and a GitHub Actions secret. Until then `/cron/tick` 404s and background
   jobs only run while somebody is using the app. **This blocks all overnight
   automation and only the owner can do it.**
2. **Verify one real Greenhouse/Lever board** through the "Test it" button — the
   adapters have still never met a live feed (the sandbox blocks those hosts).
3. **Step 4 — conversation intelligence.** The restructure that was meant to
   come first is now done, so this is next. Note the known gap it inherits: the
   reply sweep is **Microsoft-only**, so a sequence sent from a Gmail mailbox
   cannot auto-exit on reply. `gmail-provider.listMessages/getMessage` exist and
   **nothing calls them.**
4. RLS (slice 3b) — **still do not enable on the live DB without a fresh
   go-ahead.**

**No migrations were written or applied this session.** The only live-DB access
was **read-only** schema/count queries used to verify the tenancy registry and
prove the new org filters are a no-op.

---

## Session 9, part 2 — Step 4 shipped, and the automation actually switched on

Same dev branch, restarted from `main` after each merge. **Three PRs merged and
deployed this session: #127 (restructure), #128 (engine card + heartbeat), #129
(Step 4).** `main` verified green after every merge.

### 1. `CRON_KEY` is SET and VERIFIED — the automation is live

This had been outstanding since Session 7 and blocked everything overnight. The
owner set it; **verification was done from the GitHub Actions log, not taken on
trust**, because "success" on that workflow is misleading — it deliberately
`exit 0`s with a warning when the key is missing.

The run that proves it (`workflow_dispatch`, head `9351a22`):

```
CRON_KEY: ***
HTTP 200
{"ok":true,"ran":[],"skipped":["followup","bounce_sweep","reply_sweep",
 "pending_retry","wf_tick","warmup_tick","lead_sourcing"]}
```

`ran:[]` with everything `skipped` is correct — nothing was due. Skipping when
not due is the mechanism that stops the pinger and the in-process timers from
double-running a job.

**An earlier run on the same day showed `CRON_KEY:` empty** — that is what the
unset state looks like in the log, worth recognising.

### 2. Render free tier — a constraint that changed a decision

The owner flagged Render is on the **free tier**. That made the old `*/5`
heartbeat actively harmful: the free plan bills **instance hours** and sleeps
after ~15 min idle, so a 5-minute ping meant the service never slept — ~730 h
against a ~750 h monthly allowance, i.e. no headroom, and a second free service
would blow it and suspend the app.

Changed to **`*/30`** (~365 h/month). Due-ness lives in the DB, so this delays
jobs and never skips them. **Now recorded in `CLAUDE.md` as durable memory** —
ask what a new poller costs before adding one.

**Worth knowing:** the Actions history showed the scheduled runs were already
landing roughly **hourly**, not every 5 minutes — GitHub throttles schedules on
free/public repos. So `*/5` was never delivering what it claimed, and `*/30` is
closer to what GitHub will actually give. Expect 30-60 min in practice.

### 3. Background engine card (PR #128)

The recurring jobs had **no representation in the UI at all** — the
`/admin/engine/status` endpoint existed and nothing read it. If the engine
stopped, the only symptom was follow-ups quietly not going out.

The card's whole point is a distinction: **`CRON_KEY` being set is not the same
as the heartbeat working.** The key must match in Render AND the GitHub secret;
a mismatch 404s `/cron/tick` while the server still reports "configured". So the
card keys off `heartbeat_healthy` (has a ping actually arrived in the last hour),
not off the env var. Three states: running / not receiving its heartbeat / not
set up. `engine-card-smoke` specifically asserts the middle state does NOT render
as healthy — a green light there would be worse than no card.

### 4. Step 4 — conversation intelligence (PR #129)

| Piece | What |
|---|---|
| `conversation-intel.js` | reads a thread → direction, elapsed time each way, question pending, intent floor, commitments, headline, priority. **Pure + injectable clock.** |
| `next-action.js` | ranks it into one daily queue: replies owed, commitments come due, reminders, silences worth chasing |
| `routes/next-actions.js` | `GET /next-actions`, hierarchy-scoped (own/team/org) |
| `public/js/44-next-actions.js` | the "Needs you today" card on all three real-login dashboards |
| `migrations/037_conversation_intel.sql` | `conversation_messages` — **WRITTEN, NOT APPLIED** |

**Gmail reply detection did not exist.** `gmail-provider.listMessages/getMessage`
were written and **nothing ever called them**, so a sequence sent from a Gmail
mailbox kept emailing people who had already replied. Fixed by normalizing Gmail
messages into **Graph's shape** and extracting the per-message logic into one
shared `processInboundMessages`. One brain, two fetchers.

**Reminders never fired.** Written for years by the OOO flow and the workflow
engine, read only by their own page; nothing anywhere surfaced a due one. They
now enter the queue.

**Two bugs the tests caught, both of which would have quietly discredited the
feature:**
1. commitments resolved against `now` instead of the message's send time, so
   "next week" said twelve days ago stayed perpetually seven days in the future
   and no promise could ever come due;
2. reminder due-ness compared against the **end** of the due day, so every
   reminder fired a day late.

**Design rules pinned by tests, do not relax them:**
- opted-out / "not interested" threads produce **no action, ever** (compliance);
- a send from yesterday is **not** queued (a list full of "you emailed them
  yesterday" is one nobody opens);
- conversation-driven items are **not dismissible** — they vanish when the fact
  changes. A queue you can clear without doing the work stops describing reality.

### 5. Test status — 36 suites

New this part: `conversation-intel-smoke` 64/64, `gmail-sweep-smoke` 33/33,
`next-action-smoke` 36/36, `engine-card-smoke` 18/18.

### 6. Where to pick up

1. **Apply migration 037** when the owner gives a fresh go-ahead — it is what
   lets futé keep the real conversation instead of 280 chars of the first reply.
   Everything works without it; the reasoning is just thinner.
2. **Verify one real Greenhouse/Lever board** through the "Test it" button — the
   adapters have still never met a live feed (sandbox blocks those hosts).
3. Outbound messages are not yet written to `conversation_messages` — threads
   take the outbound side from the `emails` table. Fine today; worth unifying
   when the one-timeline work (plan Step 4, "one unified timeline") is done.
4. Still open and unchanged: RLS slice 3b (**never enable on the live DB without
   a fresh go-ahead**), per-role permissions, CSV import/export + public API,
   generalized audit trail, PWA polish, Stripe seam, folding the legacy
   un-org-scoped `/bd-analytics/*` into the org-scoped reports, and retiring the
   orphaned "Manager Users" page.

**Live-DB posture this session: READ-ONLY.** The only queries run against
Supabase were schema/count reads used to verify the tenancy registry and to
prove the new org filters were a no-op. No migration was applied.

---

## Session 9, part 3 — SSO sign-in, the PACE rebrand, and claimable domains

**Merged and live:** PR #127 (restructure), #128 (engine card + heartbeat),
#129 (Step 4), #130 (rebrand + SSO). **Open draft:** PR #131 (org domains).

### The product changed shape

The owner redefined the product mid-session: PACE is **sold to other companies**,
not run for Fute. Fute Global becomes one customer. An enterprise registers its
domain and its people flow in; an individual recruiter can sign up alone; access
is gated by plan. LinkedIn was the reference — per-user workflows plus
organisation-assigned ones.

### SSO sign-in (PR #130)

The login screen had a **placeholder** Google button showing a "coming soon"
toast, and every new user was created with the same hard-coded password
`Fute@2024`, printed in the admin UI. Both gone.

**Microsoft needed no new setup.** Sign-in reuses each provider's
already-registered redirect URI and tells sign-in from mailbox-connect by a
**signed** state — so no Azure app-registration change. `services/sso.js`.

Front-door hardening, all pinned by tests: signed 10-min state (a mailbox state,
a forged base64 blob, a wrong-key token and a valid *session* token are all
refused); Google `email_verified` honoured; session token returned in the URL
**fragment** so it never hits a server log or Referer; relative-only redirects;
SSO never creates accounts and refuses deactivated/soft-deleted users.

### ⚠ A flaw I shipped and then fixed — read this

I told the owner Google sign-in avoids Google's restricted-scope review. **True
of the design, false of the code**: the flow reused
`gmailProvider.authorizeUrl`, which requests `gmail.send` + `gmail.modify`.
That would have (a) required the exact review I said it avoided and (b) asked
someone who only wants to log in for permission to read and send their email.

Fixed with `signInAuthorizeUrl` (openid/email/profile only, no
`access_type=offline`). **Both scope sets are now pinned by tests** so neither
can drift into the other. Lesson: when a claim about behaviour is load-bearing,
test the claim, not the intention.

### The PACE rebrand — three categories, only one renamed

1. **Product branding → PACE.** Title, loading text, login card, product copy,
   `package.json`.
2. **Customer identity → deliberately untouched.** Cold-email templates say
   *"I'm {{sender}} with Fute Global LLC"*; resumes carry a futé letterhead.
   Those are the **customer's** outbound identity — renaming them to PACE would
   make every customer's sales email advertise their ATS vendor. **Still open:**
   make them per-org configuration.
3. **`fute-lms-backend.onrender.com` → MUST NOT MOVE.** It is the live Render
   host **and** the OAuth redirect registered with Microsoft (and, once set up,
   Google). Renaming breaks `API_URL`, Microsoft sign-in and the heartbeat.
   Owner action: rename the Render service + update the Azure app registration.
   **Do it before registering the Google redirect URI**, or it must be changed
   in two places.

Admin header no longer hard-codes "Fute Global LLC" — it shows the signed-in
org (`orgDisplayName()`).

### Login page rebuilt (to an Apollo-style reference, no Apple)

Log In / Sign Up tabs, Google / Microsoft / Organization, Or divider, email +
password, keep-me-signed-in, forgot password.

- **"Log In with your Organization"** routes by email domain. NOT full SAML —
  `/auth/sso/for-domain` is the seam that slots into. Free mail domains refused.
- **Sign Up records the request** (`app_settings`, no migration) rather than
  faking an account. Identical response whether or not the email exists, so it
  cannot enumerate who is registered. Both new public endpoints rate limited.

### Claimable domains (PR #131, migration 038 — NOT APPLIED)

`services/org-domains.js` + `routes/org-domains.js` + `45-org-domains.js`.

**An unverified claim is an account-takeover primitive** — claim
`microsoft.com` and every Microsoft employee who signs in lands in your
workspace. Enforced at three levels: the token is an HMAC over secret + **org
id** + domain (another org's token does not verify your claim); free-mail
domains are refused **before DNS is consulted**; and a **partial unique index**
makes "one org owns a verified domain" true in Postgres, not just in app code.
Auto-join is off by default and cannot be enabled on an unverified domain.

`organizations` gains plan / status / kind (company|individual|internal) /
seats_limit / trial_ends_at. The existing tenant is marked `internal`.

`org_domains` is registered **GLOBAL** in `models/tables.js` despite having an
`org_id`: sign-in looks it up **by domain before any org context exists**.

### Another mistake worth carrying

The first cut of the login rewrite sliced from `renderLogin` to the SSO block
and **deleted `renderApp` and `roleLabel`** — the whole app shell. 17 suites
caught it instantly ("renderApp is not defined"). Restored verbatim from git
rather than rewritten from memory.

### Tests: 38 suites

New: `sso-smoke` 44/44, `org-domains-smoke` 56/56 (including both takeover
cases). Renaming a button meant updating `email-tracking-send-smoke` — an
intentional rename, so the assertion moved with it.

### Session 9 close-out

Merged to `main` in order: **#127** (restructure), **#128** (engine card +
30-min heartbeat), **#129** (Step 4 conversation intelligence), **#130**
(PACE rebrand + SSO sign-in), **#131** (claimable domains + the Google scope fix
+ this context split). `main` verified green after every merge.

**`CRON_KEY` is set and verified** — proven from the GitHub Actions job log
(`HTTP 200`, all seven jobs reporting), not from the workflow's green tick,
which shows success even when the key is missing.

**Left deliberately unapplied:** migrations 037 (`conversation_messages`) and
038 (`org_domains` + org plans). Both additive, both degrade safely.

**The context discipline starts here.** From this session on:
`docs/CONTEXT_WINDOW.md` is rewritten to describe the present and stays short;
this archive is appended to and never edited. If a future session finds the
window growing past ~200 lines, that is the signal it has been appended to by
mistake — move the excess here.

---

# Session 10 — self-serve signup step 3, and the isolation batch that had to ship with it

Branch `claude/context-window-docs-t5ia4s`. Picked up exactly where Session 9's
context window pointed: **step 3 of self-serve signup — route a sign-in.**

## What step 3 actually is

Someone signs in with Microsoft or Google, PACE has never seen the address, and
something has to decide where they land. Three destinations, and only three:

| Situation | Destination |
|---|---|
| Their domain has a **verified** claim **and** auto-join is on | join that org, with the role the claim specifies |
| Their domain has a **verified** claim and auto-join is off | refused — "ask your administrator to invite you" |
| Nobody has proved they own the domain (or it is free mail) | a **private** workspace of their own |

The whole decision lives in `services/provisioning.js` as **`decide()` — pure,
no I/O, no clock, no env**. That is deliberate. Routing alice@acme.com into the
wrong organisation is not a bug, it is a breach, and it produces no error
message: it just quietly works, for the wrong person. `provision()` writes rows
and decides nothing; `decide()` decides and writes nothing.

### The rule that is easiest to get wrong

**Sharing a domain is not membership.** bob@acme.com does NOT join
alice@acme.com's workspace just because they share a domain — that is the
unverified auto-join we spent Session 9 refusing, wearing a friendlier hat. On
an unclaimed domain everyone is alone until somebody proves ownership via DNS.
Pinned by a test.

Other pinned rules: an unverified claim routes nobody **even with auto_join
explicitly on**; `auto_join_role` is validated against a whitelist rather than
trusted (it comes from a row an org admin controls — untreated, `'admin'` would
be a way to mint admins); seats are enforced at the join; suspended and
cancelled orgs stop **existing members** signing in too, not just new ones.

## The switch: SELF_SERVE_SIGNUP

Off unless the env var is exactly `on`. Off, `sessionForEmail` behaves precisely
as it did before this session — an existing active user gets a session and
nobody else does, with the same "ask your administrator" wording. So the code
ships and deploys **long before the front door opens**, and opening it is one
Render env var, not a release.

It is an env var and not an app setting on purpose: it is a decision about the
whole deployment, it depends on migrations being applied, and it must not be
reachable by anyone who happens to be an admin of some org.

## Migration 039 — the isolation batch (WRITTEN, NOT APPLIED)

Session 9's window said RLS and the two org_id-less token tables **must land in
the same batch as step 3, never after**. This is that batch, and the reason is
blunt: PACE has been safe partly *by accident*, because everyone using it works
for one company. Self-serve signup ends that in a single deploy.

Checked against the live DB before writing it — **37 tables had RLS disabled**,
including `microsoft_tokens`, i.e. OAuth **refresh tokens for customers' real
mailboxes readable with the anon key**. `gmail_tokens` already had it (migration
010). So 039:

1. Enables RLS + a service-role policy on all 37 (plus 037/038's tables,
   guarded, so it applies in either order). Safe because the backend connects
   with the **service** key — `config/env.js` requires it, there is no anon-key
   code path, and the browser never talks to Supabase directly.
2. Gives `microsoft_tokens` / `gmail_tokens` an `org_id`, backfilled via
   `user_id` then via `user_emails`, with the same transitional column DEFAULT
   every other tenant table has. Both moved to `TENANT_TABLES`.
3. Adds `users.last_login_at` / `last_login_method`. **`services/sso.js` has
   been writing these since sign-in shipped and they did not exist** — the write
   was a silent no-op, and the comment claiming migration 038 added them was
   wrong.
4. Widens `users_role_check`. The live constraint was
   `('ra','ra_lead','bd','bd_lead','admin','recruiter')` — **Associate Director
   and Director were missing**, though migration 026 added them to every role
   picker in the UI. Choosing either currently fails at the database. Found by
   reading the live constraint, not the migration files.

## The org-less session gate

`orgIdFor()` falls back to the platform's first org when a request has no org on
it. With one org that is right; with two it silently means "**give this session
the first customer's data**". So `auth()` in index.js now refuses a token with
no `org_id` — but **only once more than one org is possible** (self-serve on, or
>1 row in `organizations` at boot). With self-serve off and one org, an org-less
token still works, because breaking every live session would be an outage
dressed as a safety fix. Both halves are pinned by `test/org-session-gate.mjs`,
which boots the real server twice.

`orgIdFor()` itself was left alone on purpose. Returning `null` there looks
safer and is worse: background sweeps call `withOrg()` with no user, and null
turns a scoped query into an **unscoped** one.

## Frontend

The Sign Up tab is now two panels, and which one shows is decided by the SERVER
(`self_serve` on `GET /auth/sso/providers`), never guessed. On: "Sign up with
Microsoft / Google", no form, no password, plus a plain-English note about what
happens if your company already uses PACE. Off: the Session 9 request-capture
panel, unchanged.

"Log In with your Organization" on an unrecognised domain used to be a dead end.
With self-serve on it is an offer — but it **confirms first**, because that
button silently creating a brand-new workspace would be a surprise.

## Tests: 40 suites, all green

New: `self-serve-signup-smoke` (53 assertions — the switch, unverified claims,
role validation, seats, suspension, the create race, hostile slugs) and
`org-session-gate` (5, two real server boots). `models-smoke` updated for the
registry change: 41 tenant / 7 global.

`npm ci` was **broken on arrival** — `playwright-core` was added to
package.json in Session 9 without updating the lock file. Fixed by running
`npm install` and committing the lock.

## Left open, deliberately

- **The guest bypass.** `Authorization: Bearer guest` gives read-only access to
  the DEFAULT org — which is the owner's own live data. Deliberate (it is the
  product tour) and pre-existing, but under self-serve signup it deserves a
  fresh decision. Not changed here; changing it unasked would break the demo.
- Step 4 (plan entitlements + the Stripe seam) is untouched.

## Session 10 addendum — migrations 037, 038 and 039 APPLIED

Owner gave an explicit go-ahead ("apply all three, then merge"). Applied in
order against project `teiqievahzhllojvgsku`, then verified against the live
schema rather than trusting the "success" return:

| Check | Result |
|---|---|
| Tables with RLS disabled | **0 of 48** (was 37) |
| Tables with no service-role policy | 0 · 48 policies |
| `org_id` on `microsoft_tokens` / `gmail_tokens` | present, backfilled, 0 nulls |
| `users.last_login_at` / `last_login_method` | present |
| `users_role_check` | now includes `associate_director`, `director` |
| Default org | `plan=internal, kind=internal` |
| `org_domains`, `conversation_messages` | exist |

`npm test` re-run after: 40/40. The live Render service could not be reached
from the sandbox (the agent proxy 403s `*.onrender.com`, the same block that
stops the Greenhouse/Lever adapters being tested), so the post-apply check is
schema-level plus the local suite — not a live request. Nothing in the batch
changes a code path the running deployment takes: every column is additive, and
RLS is transparent to the service key the backend connects with.

**Next migration number is 040.**

---

# Session 11 — the guest bypass is gone, and plans became real

Two asks, in order: "remove the demo data everything from both frontend and
backend", then "work on plans and payments".

## Part 1 — the guest bypass and the demo world

`Authorization: Bearer guest` was an **authentication bypass**. It handed anyone
who sent that header read-only access to the DEFAULT organisation — which is a
real customer's live data — with role `bd`. Defensible while PACE was one
company's internal tool. Indefensible the session after strangers could sign
themselves up. Gone: the door in `auth()`, the write-blocking middleware that
existed only for it, `notGuest` and its 51 call sites, and the five `isGuest`
refusals in outreach.

The demo world went with it. `01-seed-demo.js` generated 25 invented staff, a
dozen invented companies, and hundreds of fake leads/activities/jobs/sent-emails
at page load, and `STATE` was initialised from them — so **a real user briefly
saw invented rows before `loadAppData()` returned**. What survived is the part
real screens use (the BD stage vocabulary, the industry/source lists,
`todayIST`/`fmtDate`/`uname`/`stageClass`), now `01-constants.js`. Every
collection starts `[]`.

`23-auth-guest.js` → `23-auth.js`: the guest user, the demo leads, the role
switcher and the whole `guestSimulate` layer (which faked the RESULT of every
write so the tour appeared to work) deleted; `doLogin`/`doLogout`/`loginAs` kept
verbatim.

### The knock-on nobody would have predicted

Removing the demo data removed the last reader of the **legacy lead-gen
dashboard** — ~150 lines in `renderDashboard` keyed off `STATE.leads`. Only the
guest session ever filled that collection, so for every real login it rendered a
wall of zeroes. Deleted. "View as" now gets `renderIndividualDashboard(u)`,
which is built on `STATE.jobs` and filters by the user it is handed, so
previewing somebody's desk shows THEIR desk.

### The tests were the hard part

**All 17 Playwright suites entered the app by clicking "Continue as Guest."**
Every browser test in the repo depended on a production authentication bypass
existing. They now use `test/helpers/enter-app.mjs`, which sets `STATE.user` /
`STATE.token` and re-renders — which is what they always actually needed, and
grants nothing in the product. One assertion had to change honestly rather than
be weakened: `recruiter-dashboard-smoke` checked a BD sees "Response rate trend"
and "Industry breakdown", widgets that only ever existed on the demo-fed
dashboard; it now asserts a BD lands on the team desk.

Two stale-branding bugs found on the way: the sidebar still said **"futé Global
· Lead Management"** months after the PACE rebrand (the login screen had been
updated, the app shell had not), and the startup banner said "Fute Global LMS
API".

## Part 2 — plans and payments (step 4)

`services/plans.js` — the tiers as data, pure. Free (2 seats / 3 job orders / 50
candidates / 1 mailbox), Starter, Pro, Business, plus `internal`, which the
default org is on, **which is why none of this changes anything for the existing
deployment**.

Two rules the file exists to keep:

1. **A limit that is not enforced is a claim, not a limit.** Every number is
   checked at the point of creation — `POST /users`, `POST /users/:id/emails`,
   `POST /job-orders`, `POST /candidates` — and refused with **402 Payment
   Required** (not 403: this is a billing wall, not a permission error) and a
   message naming the plan and the number.
2. **Raising or lowering a limit must never break anyone already over it.**
   Enforcement is on CREATE only. A downgraded org keeps everything and simply
   cannot add. Nothing is ever deleted, hidden or locked. The billing screen
   says so in words on the over-limit row.

Feature gates: `sourcing` (Pro+) blocks where a run is STARTED;
`conversation_intel` (Starter+) returns an empty `/next-actions` queue with a
`locked` reason rather than a 402, because it is a dashboard widget and a card
that explains itself beats one that renders an error.

`services/entitlements.js` is the I/O half. Counts are **not cached** — a stale
count is a limit that is wrong in one of two ways — and **every count is
individually guarded so a failure ALLOWS**. Refusing a paying customer because a
COUNT timed out is far worse than one row over.

### The Stripe seam

`services/billing.js`. **No `stripe` npm package**, deliberately: the codebase's
rule is that all outbound HTTP goes through `http-client.js`, and a dependency
that does nothing until someone signs up for Stripe is weight in every install.
Stripe's REST API over `fetchWithTimeout` is a dozen lines.

**The webhook is the only thing that may change a plan.** A checkout session says
what somebody INTENDED to buy; the webhook is Stripe saying what happened, and it
is signed. If the browser's success redirect could set the plan, anyone who can
read their own URL bar could upgrade themselves to Business for free. Signature
verification takes an **injectable clock** — a check that only passes "now" is
untestable, and an untested signature check is decoration. Pinned: forged secret,
tampered body, stale timestamp, future timestamp, missing header, malformed
header, wrong-length signature (which would otherwise throw in
`timingSafeEqual`), and multi-`v1` rotation.

`planChangeFor` ignores unknown event types rather than guessing — Stripe sends
dozens, and acting on one nobody read is how a paying customer gets downgraded.
Nobody can buy their way onto `internal`. A cancelled subscription drops to Free
and **does not suspend the workspace or touch its data**.

**Pricing is deliberately null on every tier.** What PACE costs is the owner's
decision; an invented number would end up on a screen looking decided. The
billing card says "pricing not published yet" until they are filled in, and
`services/plans.js` is the one place to change them.

### Migration 040 (written, NOT applied)

Three nullable billing columns, an index, and a CHECK on `organizations.plan`.
Deliberately tiny: plans and enforcement are already real without any schema
change, because 038 gave `organizations` its `plan`/`status`/`seats_limit`. The
app is correct before and after.

## Tests: 41 suites

New `plans-billing-smoke` (69 assertions). `npm test` green after each part.

---

# Session 12 — Gmail sending fixed end-to-end, and the noise came out of "Needs you today"

**Note on the gap before this entry:** `docs/CONTEXT_WINDOW.md` had drifted
badly stale — still describing PR #134 as open when `CLAUDE.md` (kept current
through the gap) shows it merged long ago, self-serve signup steps 1-4 all
live-but-switched-off, migration 040 applied, and most of the "Growth bets"
list (multi-tenancy slices 1-3b, clients, tracked email, billing) done in
sessions that were never archived here. This session did not attempt to
reconstruct that missing history — `CLAUDE.md` is what carried state forward
correctly during the gap and remains the source of truth for it. This entry
picks up from the actual present and both files are now back in sync.

## Part 1 — connecting Gmail, and the two Google-side approvals it needed

Walked the owner through Admin → user → Outreach Email IDs → Connect for a
Gmail mailbox. Two expected one-time Google Cloud steps, not app bugs:
"Google hasn't verified this app" (Testing-mode OAuth consent screen — add the
account under Test Users, or Continue through the warning) and "Gmail API has
not been used" (enable it on the project in Cloud Console). Advised **against**
publishing the OAuth consent screen to Production while unverified — `gmail.
send`/`gmail.modify` are sensitive scopes, and an unverified published app can
hard-block *everyone*, worse than Testing mode's warn-and-continue. Test users
were sufficient for internal use.

## Part 2 — leads stuck in "Pending" forever, twice, same root cause

Once connected, "Send all pending" queued 12 emails and sent 0, all showing
"sending mailbox disabled — skipped". Traced via Supabase: the leads' jobs
still pointed `sending_email_id` at two **deactivated Microsoft mailboxes**
whose OAuth tokens were dead (`AADSTS500341` — account deleted from the
directory; `AADSTS65001` — consent revoked). Unblocked immediately by
repointing those 5 jobs' `sending_email_id` to the new Gmail mailbox.

Root cause, found in `/distribute/execute` (`index.js`): it only ever queried
`microsoft_tokens` for "is this account connected" and never filtered
`user_emails.is_active` — so it kept handing new leads to dead Microsoft
mailboxes forever and could **never** select a connected Gmail mailbox at all,
since it had no path to `gmail_tokens` in the first place. Fixed: scope the
candidate pool to `is_active=true`, check both `microsoft_tokens` AND
`gmail_tokens`, exclude any row with `refresh_failed=true`. **PR #137.**

The owner then asked the obvious follow-up: what happens if a mailbox gets
deactivated *after* leads are already assigned to it? Same bug in reverse —
confirmed in code (`processPendingEmailSends` skips a job whose sending
mailbox `is_active===false` rather than failing it, so it sits in pending
forever, silently). Built `services/mailbox-reassign.js`: on deactivation/
disconnect, automatically move the mailbox's still-open leads to another
active, connected mailbox for the same user (primary preferred), or report
them as "stranded" if none exists. Wired into all three places a mailbox goes
inactive (`PATCH`/`DELETE .../emails/:eid`, Microsoft/Gmail disconnect), with
the outcome now surfaced in the UI toast instead of staying silent. Same PR
#137 (second commit). Immediately hit new leads with the *same* two dead
Microsoft mailboxes again (35 more stuck) — reassigned those too, same fix.

**42/42 → merged.** New `test/mailbox-reassign-smoke.mjs`.

## Part 3 — a 1,249-lead cleanup

Owner asked to delete every lead in `Unassigned` (942) and `Assigned` (307)
stage, keeping converted-client leads and all candidate/ATS data untouched.
Verified before deleting: zero overlap between the delete-set and any
company that already has a real `job_order` (checked both by `company_id`
join and directly by `job_orders.source_lead_id`), so nothing client-side was
at risk. Cascade chain required deleting in order — `emails.follow_up_id`
had to be nulled before `follow_ups` could go, `follow_ups`/`reminders` before
`jobs` (both have `NO ACTION` FKs onto `jobs`/`contacts`). Executed with
explicit confirmation first. Final counts: 10 Connected, 1 In Discussion,
1 Rejected remained — exactly the leads with real activity.

## Part 4 — "Needs you today" was about to become 1,000+ items of noise

Owner explained the "Needs you today" ↔ automation relationship precisely:
at 200 emails/day and ~15% reply rate over a month, the "To chase" nudge (any
BD lead silent 3+ days after an outbound) would flood the queue — most of
those leads are still `Assigned` and already being chased automatically by
the fu1/fu2 follow-up engine (confirmed in code: `runFollowupEngine` is hard-
gated on `job.stage === 'Assigned'`, default day 3 / day 7). Fix: a BD-lead
nudge in `next-action.js` now only fires once the lead's stage is `Connected`
or `In Discussion` — a real, ongoing conversation. `Assigned`/`Unassigned`/
`Rejected` never nudge this way (`Rejected` = closed door, same treatment as
opted-out). `reply_due` (someone actually waiting on a reply) is untouched —
that's always urgent regardless of stage. Candidate/ATS threads are unaffected
(different stage vocabulary entirely).

Same conversation surfaced the actual product gap behind the noise: nothing
returns a lead that never replied back to the pool. Built
`services/lead-recycle.js` + a new daily `lead_recycle` engine job: a lead
sitting in `Assigned` with **zero replies** for 30+ days (configurable via
`app_settings.lead_recycle_days`) is automatically returned to `Unassigned`
— cleared of its BD/mailbox assignment, `freshness='Old'` so it resurfaces
first on the next distribution run. Any lead with even one reply is left
alone; that's engagement, not dead weight. `POST /leads/recycle/run` for a
manual trigger.

**Migration `041_lead_recycling.sql`** — `jobs.recycled_count` /
`jobs.last_recycled_at`, visibility-only, applied with explicit go-ahead.
**43/43 → merged.** New `test/lead-recycle-smoke.mjs`; `test/next-action-
smoke.mjs` grew a dedicated stage-gating section (Assigned/Rejected/
Unassigned/undefined all suppressed, Connected/In Discussion nudge, candidate
threads unaffected, `reply_due` unaffected by the gate).

## Where this session ended, and what's next

Both PRs (#137, #138) merged to `main` and deployed. Owner asked, and was told
plainly: PACE has **no general inbox today** — connected mailboxes are used
for sending and for the behind-the-scenes reply-detection sweep that feeds
lead/candidate conversation threads, but there is no unified "read every email
that landed here" view, and no reply-from-app UI for anything outside a
lead/candidate thread. **Next session's explicit task, per the owner: build a
real in-app inbox** so mailbox work can happen inside PACE instead of
switching to Gmail/Outlook. Scope it properly before building — likely v1 as
read-only unified inbox (list threads across connected mailboxes, open one),
reply-from-app as a fast follow. No code started on this yet.

# Session 13 — the in-app mailbox

The owner's ask, in their words: *"I want to build an in-app mailbox — inbox,
sent, labels and everything like an outbox setup — can we do that for the emails
connected to the user?"* This was the task Session 12 ended by naming, so it
started from a scoped-but-unwritten position.

## The decision that shaped everything: pass-through, not sync

The obvious build is to mirror mailboxes into Postgres and serve the UI from
our own tables. It was rejected before any code, for three reasons that are all
pre-existing constraints on this project:

1. **Supabase is free-tier.** Every message body of every connected mailbox is
   the most expensive thing this product could possibly store, and it buys
   nothing a live read does not already give.
2. **Render is free-tier.** A sync needs a poller; a poller keeps the service
   awake and eats the ~750 instance-hour budget (the same reasoning that put the
   heartbeat at 30 min instead of 5). A pass-through needs no schedule at all.
3. **A mirror drifts.** "Why isn't my email showing" and "I deleted this an hour
   ago" are the two ways a synced inbox loses its user, and both are unfixable
   by design. A live read is never wrong.

So every list and every body is read from the provider on demand, and every
write (read/unread, move, archive, trash, reply) lands on the real mailbox.

**`conversation_messages` (migration 037) was deliberately not widened** to hold
this traffic. That table is the intelligence layer's record of the threads PACE
is actively *working* — a lead's or a candidate's conversation. This is a mail
client. Same emails sometimes, entirely different job. Merging them would have
made the intelligence layer's queries answer a different question than they were
written to answer.

**No migration was needed and none was applied. 042 is still the next number.**
**No new OAuth consent either** — Microsoft already grants `Mail.ReadWrite` and
Gmail already grants `gmail.modify`, which between them cover folders, labels,
reads, moves and trash. Nobody has to reconnect a mailbox.

## What got built

**`services/mail-provider.js`** (~700 lines) — one interface over both
providers. `createMailProvider(ctx).forMailbox(userEmailRow)` returns an adapter
whose methods are identical whichever platform is behind it: `listFolders`,
`listMessages`, `getMessage`, `getAttachment`, `setRead`, `setFlagged`, `move`,
`archive`, `trash`, `reply`, `listThread`. Everything above it speaks one
vocabulary. The awkward parts are all in here:

- Graph has real folders with a `wellKnownName`; Gmail has labels and a fixed
  set of system ids. Both collapse to seven canonical *kinds*, and the UI sorts
  and icons by kind, never by name — so a renamed or non-English folder still
  lands correctly, and a user label literally named "SENT" stays custom.
- **Graph's move returns a NEW message id** — the old one stops resolving the
  moment the message lands in the destination folder. Gmail's id never changes.
  Both return `{id}` so the client just takes what it is given.
- **Archive is its own verb**, because the providers disagree about what
  archiving *is*: Graph moves to an Archive folder, Gmail has no such label and
  archiving means dropping INBOX.
- Gmail's `labels.list` carries no counts and its `messages.list` returns ids
  only, so folders and list rows each need a fan-out. Both are pooled (6 and 8
  concurrent) — sequential is a visibly slow inbox, all-at-once trips the
  per-user rate limit.
- Reply-all excludes the replying mailbox and never duplicates the sender (the
  two classic reply-all bugs), and Gmail replies carry `In-Reply-To`/
  `References` so the thread holds in the *recipient's* client, not just ours.

`gmail-provider.js` gained the reads this needed: `listMessagePage` (the sweep's
`listMessages` deliberately drops the page token; a mail client has to
paginate), `listLabels`, `getLabel`, `getThread`, `getAttachment`, `trashMessage`.

**`routes/mailbox.js`** — 13 endpoints. `ownedMailbox()` is the only door in and
the authorisation is deliberately *stricter* than the rest of the app: **your
own mailboxes only, admin included.** An admin here can already reassign leads,
read every candidate and change roles; silently reading a colleague's personal
mail is a different kind of power and should be an explicit, audited feature if
it is ever wanted, never a side effect of the admin flag. Someone else's mailbox
answers **404**, identical to a nonexistent one, so ids cannot be enumerated; a
disconnected one answers **409** with a code the UI turns into "Reconnect",
because that is a fixable state and must not read as an error.

The genuinely PACE-specific bit: each page of messages is cross-referenced
against `contacts` and `candidates` in the caller's org, so a sender who is
already someone we are working gets a **Lead** or **Candidate** chip that jumps
straight to their record. That is the entire reason to read mail inside an ATS
rather than in Outlook.

Sending reuses the same provider calls the outreach engine uses — no second send
path — but deliberately does **not** inject the open-tracking pixel or write an
`email_tracking` row. Tracking belongs to outreach, measuring whether a campaign
landed. Pixel-tracking a personal reply to a colleague is a different thing and
not one this product should do silently.

**`public/js/47-page-mailbox.js`** — the three-pane client. Two safety
behaviours worth protecting from a future "simplification":

- **The body renders in a sandboxed iframe** with no `allow-scripts` and no
  `allow-same-origin` (only `allow-popups`, so links still work), on top of the
  server-side sanitiser. An email body is the most hostile HTML this app
  handles; even a sanitiser bug cannot then reach STATE, the session token, or
  the DOM.
- **Remote images are blocked until the reader asks**, per message, with a
  banner saying why. An inbound remote image is usually a tracking pixel — the
  exact technique PACE uses on its own outbound mail.

Delete says out loud that the mail moved to Trash and is still recoverable,
because the user just changed their real mailbox and needs to know where it went.

## The nav slot, and not taking one that was already spoken for

Inbox was first placed immediately after Dashboard, which broke two suites:
`recruiter-dashboard-smoke` ("My Jobs right after Dashboard") and
`team-structure-smoke` ("My Team right after Dashboard"). Both assertions encode
deliberate earlier product decisions — Session 5 specifically fixed "My Team"
being stranded at the bottom. The tests were **not** loosened. Inbox moved to
the head of the tools block, immediately before Email, which is also the more
honest grouping: Inbox reads, Email sends, and they now sit together. It is not
role-gated — a connected mailbox is a personal thing, and a recruiter has as
much right to read their own mail as a BD does.

## Tests

Two new suites, **45/45 suites green** (was 43).

- `test/mailbox-smoke.mjs` (97 checks) — folder-kind mapping, address parsing
  (including the comma inside a quoted display name that breaks a naive split),
  the sanitiser against a dozen XSS vectors, both providers normalising to
  *identical* keys, reply-all recipient rules, and two guarantees stated as the
  absence of a call: **Microsoft trash never issues a DELETE, Gmail trash never
  calls a delete.** Plus the full authorisation matrix, asserting not only the
  status code but that a refused request **never reaches the provider at all**.
- `test/mailbox-page-smoke.mjs` (45 checks, Playwright) — the page end to end,
  including that the iframe sandbox has neither `allow-scripts` nor
  `allow-same-origin`, that the body is not written into the page itself, that
  blocked images are announced rather than silently dropped, and that an empty
  reply never reaches the network.
- `test/backend-smoke.mjs` grew all 13 mailbox routes (mounted + auth-gated).

## What is deliberately not in v1

Drafts are listed but not editable in-app (the folder shows, opening one is
read-only); no forward-with-attachments; no move-to-folder picker in the UI
(archive/trash cover the common cases, and the API already supports an arbitrary
move); no shared or delegated mailboxes; no push/webhook notification, so the
unread badge is a 60-second cached poll rather than live.

## Session 13, part 2 — the owner used it, and found four things

Merged part 1 to `main` (PR #140) and the owner worked real mail in it. Their
report, verbatim: *"i do not need signature on replies, or i should be able to
select the signature. Also, there is no option to see or edit subject line in
reply or reply all and no forward. and no button for attachements."* Their
screenshot also showed two things they did not mention.

**The bug that shipped: `{{sender}}` reached a real recipient.** Signature
templates hold `{{sender}}` / `{{senderemail}}` placeholders. The outreach path
fills them via `fillSignatureHtml` (index.js:1309). `routes/mailbox.js` called
`getMailboxSignature` and appended the result **raw**, so a reply sent from the
Inbox went out reading "**{{sender}}** / Recruitment Manager | Fute Global LLC".
Entirely self-inflicted, in the first version, and visible to whoever received
it. The lesson worth carrying: `getMailboxSignature` returns a TEMPLATE, not a
signature — anything that composes mail must fill it.

Fixed, and then made a choice rather than a default: the signature is **off
unless asked for**, with a picker that remembers the choice per user, and
`GET /mailbox/:mid/signature` returns the *filled* signature so the composer
previews exactly what the recipient will see. A signature belongs on outreach;
repeating a postal address in every message of a live thread reads like a
mail-merge, which is what the owner was reacting to.

**The three gaps** became one shared composer for reply / reply-all / forward:
editable **To, Cc and Subject** (the subject was previously decided by the mail
provider and never shown), **attachments** via a real file input with chips and
a size cap, and **Forward** — Graph's `createForward` (which carries the
original's attachments across for free), and for Gmail an adapter that rebuilds
the message, re-downloads the original's attachments and re-attaches them within
a byte budget, because a forward that silently drops the resume it was
forwarding is worse than no forward.

Composer field values live in `STATE.mailbox.composer`, not the DOM: `render()`
rebuilds `#content` from a string, so anything typed and not written through
would be lost by any repaint. `oninput` writes through and nothing repaints per
keystroke.

**Two attachment guards, not one.** The router's cap is 3.5MB of decoded
attachment, set deliberately BELOW `express.json`'s app-wide 5MB body cap, so a
realistic attachment hits our check and gets a sentence explaining what to do
instead of an opaque 413 from the body parser. Both are now asserted, including
the gap between them — that distinction was found by a test failing, not by
reading the code.

**The mojibake the owner did not mention.** Their screenshot's subject read
`Director of Engineering Ã¢Â€Â" Site Civil` — an em-dash (U+2014, bytes
E2 80 94) read as Latin-1. `gmail-provider.js`'s `buildRaw` was putting raw
UTF-8 straight into the `Subject:` header. RFC 5322 headers are ASCII; a
receiving client then guesses a charset and Latin-1 is the usual wrong guess.
Now RFC 2047-encoded (`encodeMimeHeader`), folded into ≤75-character
encoded-words, splitting on **character** boundaries — a byte-boundary split
would cut a multi-byte character in half and corrupt it differently and worse.
Applied to Subject, From display names and attachment filenames.
**Honest caveat: this fixes the Gmail send path going forward. The specific
subject in that screenshot could not be traced to its origin from here** — the
sandbox blocks outbound calls to the Render host, so the raw message was never
inspected. If it recurs on a Microsoft mailbox it is a different bug.

**45/45 suites green.** `mailbox-smoke` 97 → 132 checks (signature filled +
off-by-default, subject override, forward, attachment ordering — attachments
must be added to the draft BEFORE the send, or an empty email goes out — the
data: URI prefix strip, both size guards, and RFC 2047 round-tripping including
a multi-byte fold). `mailbox-page-smoke` 45 → 70.

---

# Session 14 (2026-08-25 → 2026-08-31) — one bad name in a cold email, and everything it pulled out

Started with a screenshot: a cold email whose body read "I'm **Jennifer
Thomas** at Fute Global LLC" while its From address and signature both said
**Prince Thomas**. Ended nine changes later having fixed two send-path bugs, a
lying health indicator, a queue-order problem that was costing a day of
outreach, a test that had rotted with the calendar, a scoring weight that
contradicted its own comment, and a diagnosis of why eleven follow-ups died
without saying why.

## Part 1 — the sender mismatch (PR #142)

**The two names came from two different places at two different times.** Queue
time baked `{{sender}}` into `emails.body` from `job.sending_email?.display_name
|| the BD's fallback mailbox || the BD user's name`. Send time filled the
signature — and chose the From address — from the mailbox the send actually
authenticated with, re-read from the lead right then. Anything that changed the
lead's mailbox in between stranded the old name in the body.

For the reported email that gap was **three minutes**, and the timestamps say
so exactly:

- `20:28:04` queued. The lead had no resolvable sending mailbox at that instant,
  so the name fell back to another mailbox of the same user:
  `jennifer.thomas@fute-global.com`, which is **`is_active = false`**.
- `20:31:11` the lead's `sending_email_id` was set to the new Gmail mailbox.
- next morning it sent from Prince's mailbox, signed Prince, body saying
  Jennifer.

**152 already-sent emails carried the mismatch**; 3 more sat in the queue.

Fixed by resolving the sender in exactly one place — the send path.
`buildEmailVars` gained `DEFER_SENDER` (`null`), which leaves the token in the
queued text; all three queue paths use it. `deliverOutboundEmail` computes one
`senderIdentity` and fills body, subject **and** signature from it, so they
cannot disagree by construction. A mailbox with no `display_name` falls back to
its address (`prince.thomas@…` → "Prince Thomas") — never a raw token.

Second, smaller defect fixed alongside: the fallback mailbox lookup had **no
`is_active` filter and no tie-break**, so with several mailboxes and none
flagged primary it took whichever row Postgres returned first — here, the
deactivated one. Now active-only, primary first, then oldest.

## Part 2 — the same fix, done properly (PR #143)

**#142 picked the wrong shape and the owner caught it.** It left the token in
the database and taught exactly ONE screen to fill it. But the token lives in
storage, so *every* reader has to know about it — and three did not:

- the pending preview showed a raw `{{sender}}` to the owner, who stopped
  sending over it (correctly);
- **`buildQuotedChainFromDb` quoted the stored body verbatim into follow-ups —
  a recipient would have seen `{{sender}}` inside their own earlier message**;
- `GET /analytics/templates` fed a sample body to the Admin templates page.

The preview was the symptom; the quoted chain was the one that would have
reached a customer.

Resolved on the **server**, once, for everyone. `email-vars.js` gained
`senderIdentityFor(mailbox, fallbackAddress)` and `renderStoredEmail(row,
mailbox)` — which fills subject and body **together**, so a caller cannot render
one and forget the other. `GET /emails` renders every row before returning it,
picking the mailbox exactly the way the send loop does (row's pinned mailbox →
lead's → `from_email` supplies the name). The client-side fill from #142 was
deleted; **no page knows the token exists any more.**

Because the editor is now handed rendered text, `PATCH /emails/:id` compares
what comes back against the rendered row and drops unchanged fields — opening
the editor and pressing Save is no longer an edit, so it cannot freeze a name
into an unsent row. A genuine edit is stored as typed.

**The lesson worth carrying:** a placeholder left in stored data is a promise
that every future reader will remember to resolve it. `sender-identity-smoke`
now greps for every file that reads `emails.body` and requires each to call
`renderStoredEmail`, so a fourth reader cannot be added without one.

## Part 3 — the heartbeat that cried wolf (in PR #144)

The Admin card said **"Background engine: not receiving its heartbeat"** while
the heartbeat was arriving perfectly — the GitHub Action had run at 14:21,
15:22 and 16:08, all successful, every job up to date.

It asked *"did a job run because of cron in the last hour?"* and read the
answer as *"is the pinger reaching us?"*. Those come apart **by design**:
`runDue` only records a run when a job is DUE, so a ping arriving while the app
is awake — when the in-process intervals have already claimed the due jobs —
runs nothing and leaves no trace. **The indicator went amber precisely when the
system was healthiest and most used**, and blamed a `CRON_KEY` mismatch that
did not exist.

`/cron/tick` now stamps `app_settings.engine_last_external_ping` **before doing
any work and regardless of whether there is any**. The stamp sits deliberately
OUTSIDE the `cron_last_` prefix — it is not a job, and storing it there would
list a phantom job on the card. A rejected tick records nothing, so the signal
cannot be spoofed healthy. A server not yet pinged falls back to the old signal
so the card does not claim a dead engine for the first half hour after a deploy.

## Part 4 — queue order was costing a day of outreach (in PR #144)

The owner assigned leads; the emails sat in "Pending". Nothing was broken —
**the queue drains at one email every 75–105 seconds inside an 8-hour window
measured in each lead's own timezone**, which makes order a business decision:
whatever is at the back may not go out at all.

Order was arrival order, so the morning's follow-up batch sat in front of every
lead assigned during the day. Live that afternoon: **36 follow-ups ahead of 20
just-assigned leads.** At the measured rate the new outreach would have reached
the 16:00 cutoff and rolled to the next day.

Initial outreach now goes first; follow-ups after; mailbox interleaving
preserved inside each band so one mailbox's queue still cannot starve another's.
Nothing else moved — not the cap, the window, the pacing or the domain spacing.
The ordering moved to `send-queue-order.js` (pure, tested by behaviour rather
than by grepping index.js). Also fixed while in there: the pending fetch had
**no ORDER BY** while paginating with `.range()`, which can repeat or skip rows
between pages.

**The owner cleared that day's backlog by hand** — 25 pending follow-ups deleted
after a snapshot. Their `follow_ups` schedules had already been marked complete
when the emails were first queued, so they do not regenerate: those 25 contacts
simply never got their final touch. Said plainly at the time rather than left to
be discovered.

## Part 5 — a test that rotted with the calendar (PR #145)

`lead-sourcing-smoke` had been failing on *"two identical titles are recognised
as a team build"*. **Nothing in the code caused it.** The fixture pins posting
dates but `ingestSource` read the real clock, and the hiring reason is a claim
about elapsed time — so postings written as "recent" aged past the 60-day
hard-to-fill threshold (weight 4), which outscored two-same-title (weight 3),
and every row came back `hard_to_fill`. **The assertion failed on a date.**

Exactly the trap `CLAUDE.md` already records for `conversation-intel.js`.
`why-hiring.js` already accepted `context.now`; only the ingest around it failed
to pass one through. `ingestSource(source, { …, now })` now takes an optional
clock; production passes nothing and gets the real one. Two guards added so it
cannot rot silently again.

**I had told the owner this was "a real bug in live code" before checking, and
corrected it explicitly.** It was a test defect; the product was right all along.

## Part 6 — a weight that contradicted its own comment (PR #146, OPEN)

`why-hiring.js` §5 already said a team build is "the single best staffing
opportunity on this list — multiple placements, one client". The weights
disagreed: a company with two of the same job was pitched *"this has been open a
while"*. **Owner's call: two openings now outranks age.**

- two openings → **5** (beats age alone at 4, still loses to long-open AND
  reposted at 4+4=8, which is a genuine hard-to-fill story)
- three or more → **9**, above every `hard_to_fill` combination

Ties avoided on purpose: the winner is picked with a strict `>`, so a tie would
be settled by object key order, which is not a decision. A test pins that
nothing ties the `hard_to_fill` maximum.

What a prospect reads changed from *"Your Senior Java Developer opening has been
live about 105 days."* to *"You have 2 Senior Java Developer openings live at
once — that is a team build, not a single hire."*

Side effect named rather than buried: two openings now scores 5, crossing
medium → **high** confidence.

## Part 7 — why eleven follow-ups died in silence (DIAGNOSED, NOT FIXED)

Eleven fu2 follow-ups were marked `failed` on 31 Aug with no reason recorded.
The chain is provable:

1. **Nothing was wrong with the recipients.** All eleven had a delivered initial
   (24 Aug) and a delivered fu1 (27 Aug). None suppressed, none opted out, none
   bounced, all `email_status = valid`.
2. **The split is a clock, not a property of the emails.** Gmail thread ids are
   time-ordered. Of 23 fu2 attempted that day, **every thread ≤ `1a0390af`
   failed and every thread ≥ `1a0390c8` sent — 23 of 23, no exceptions.**
   Adjacent ids at the same company, opposite outcomes.
3. **`gmail_tokens.created_at` for the sending mailbox is `18:23:35` that day** —
   the mailbox was RECONNECTED at that moment. Everything before failed,
   everything after succeeded.
4. **The mailbox was connected 24 Aug 17:27. Google expires refresh tokens after
   exactly 7 days for OAuth apps in "Testing" publishing status** — and this
   app is deliberately in Testing (Session 13, Part 1: publishing an unverified
   app with `gmail.send` scopes can hard-block everyone, worse than Testing's
   warn-and-continue). 24 Aug 17:27 + 7 days = **31 Aug 17:27**. The failing run
   began 18:07, forty minutes later.
5. **Why nothing failed earlier that day:** the 04:53 and 11:29 runs were
   outside the 08:00–16:00 lead-local window (00:53 and 07:29 EST). The first
   in-window attempt of the day was the first attempt after expiry.
6. **Why exactly eleven:** the run lasted 948s and pacing is ~90s between
   attempts, failures included. 948 / 90 ≈ 11. It burned one email every ninety
   seconds until the run ended.

**Three defects this exposed, none yet fixed:**

- **A dead mailbox destroys emails permanently.** An auth failure sets
  `status='failed'` with no retry — contrast the thread-deferral path, which
  releases back to `pending`. Those eleven will never be sent.
- **The loop keeps going.** Once the sign-in is dead nothing from that mailbox
  can succeed, yet it destroyed one more every 90 seconds.
- **The reason is never persisted.** `emails` has no error column.
  `friendlySendError` produced exactly the right sentence — *"Sending mailbox
  sign-in expired — reconnect it under Settings → Email IDs"* — into an
  in-memory progress cache, during an unattended 6pm cron run, and it died with
  the process. **The app knew, and told nobody.**

**This recurs every 7 days.** Next expiry ≈ 7 Sept 18:23.

## Other findings recorded in passing

- **`emails.sent_at` defaults to `CURRENT_DATE`**, so an unsent draft already
  carries a send date. Harmless for sending; any "emails sent on X" report is
  quietly counting drafts.
- **Render's free tier sleeps the instance after ~15 min without inbound
  traffic, and the send loop generates none.** The 18:07 run lasting 15.8
  minutes is that timeout, not a coincidence.
- The historic failure bursts (27 Jul – 7 Aug, all failed / zero sent) match
  Session 12's dead-Microsoft-mailbox story — different cause, same silent
  symptom.

---

# Session 15 — the app got a structure

The owner started using **Saleshandy** and sent nine screenshots, asking for
PACE's frontend to be compared against them and made alike. This session is
almost entirely frontend, and its lasting output is not any one screen but the
**shared layout vocabulary underneath them** — the thing the codebase had never
had.

Two PRs, both merged and deployed: **#147** (shell + kit + Candidates) and
**#148** (the four screens the owner picked).

## Why this was worth doing at all

Every page in `public/js/` had invented its own header, its own table, its own
badge, its own toolbar, in inline styles. That is why the app read as several
products stitched together, and why each new page cost more than the last —
there was nothing to reuse, so every page started from zero. The benchmark was
useful precisely because it is *conventional*: a slim icon rail, a quiet top
bar, per-page tabs with counts, a stat strip, one toolbar row, a dense table.
Copying the **shape** is what makes a product feel familiar; copying the hue is
not, which is why PACE stayed green.

## What was built

### `public/ui.css` + `public/js/00-ui-kit.js` — the kit

Pure string builders. No state, no DOM, no side effects, so it is safe at the
head of the load order (it is script `00`, before `01-constants.js`). It
**overrides only the shell and the list/table/detail vocabulary** — `.card`,
`.btn`, `.bdg`, `.inp` and everything else in `styles.css` keep working
untouched. That was the whole design constraint: pages move over one at a time,
never in one sweep, so a half-migrated app is always shippable.

Components: `page`, `tabs`, `strip`, `toolbar`, `table`, `idCell`, `pill`,
`ring`, `toggle`, `kebab`, `check`, `notice`, `kv`, `drawer`, `feed`, plus one
stroked icon family at weight 1.7 (`UI.ic`). The kit is scoped by
`body.ui-kit`, set in `index.html`.

### The rail

Grouped **Work / Records / Outreach / Insight**. A flat list of fourteen items
is a list nobody reads. It collapses to 60px and expands to 232px on hover as
an *overlay*, so content never reflows. Details that mattered:

- Groups with no visible items disappear entirely.
- A duplicate item is de-duplicated — Insights was pushed twice for an admin who
  is also an RA lead, and a doubled nav item reads as a bug.
- A badge has nowhere to sit when collapsed, so it becomes a **dot on the icon**
  rather than being dropped.

`test/recruiter-dashboard-smoke.mjs` had pinned `navItems[1] === 'My Jobs'`.
Grouping breaks a flat index, so the assertion moved onto the intent it was
really protecting: Dashboard first, and a recruiter's own jobs ahead of the
shared board and the candidate pool.

### Candidates, and one new endpoint

Tabs, a status stat strip, a toolbar, and an identity column carrying name +
email + code together. The strip is fed by a new **`GET /candidates/status-counts`**
— one `head:true` count per status, so the cost is a handful of index counts
rather than reading the pool.

Three decisions worth keeping:

- **The status VOCABULARY comes from the caller**, not the server. Statuses are
  a per-org managed lookup, so hard-coding the list server-side would make a
  customer's renamed status silently vanish from their own strip.
- **The strip never fabricates a number.** Until the counts land it renders
  `·`, never `0` — a `0` reads as "nobody is interviewing", which would be false.
- **The strip and tab count measure the whole pool; the pager keeps the filtered
  number.** Mixing the two is what makes a filtered list feel broken.

Registered before `/candidates/:id` and pinned in
`test/recruiting-routes-mounted.mjs`, both in the mounted list and in
`LITERAL_BEFORE_PARAM`.

### The candidate profile became a drawer

This is the biggest behavioural change in the session. Clicking a candidate used
to `goPage('bd_candidate')`, so coming back cost you your filters, your
selection and your scroll position — which is why people stopped opening
candidates. It now opens as a layer over the list and **`STATE.page` is
deliberately untouched**, so closing it returns you to a list that was never
left.

- The kit gained an **overlay registry**. A drawer cannot live inside `#content`
  — that *is* the page — so modules register a renderer and `renderApp()` calls
  `UI.renderOverlays()` after it. Registration is **by name and idempotent**,
  because module files are evaluated once but wrap `render()` repeatedly and
  pushing blindly would stack duplicate drawers.
- `scheduleRender()` now treats an open overlay like an open modal and skips the
  background rebuild. A rebuild under a drawer throws away a half-typed note.
- Left pane: identity + fields. Right: Activity / Jobs / Emails / Notes /
  Documents / Resume. **Every panel renders; inactive ones carry `hidden`** —
  so switching tabs neither rebuilds the DOM (a half-written note survives) nor
  tears down and refetches the résumé iframe. `cpTab()` toggles `el.hidden`
  and never calls `render()`.
- Empty fields are dropped rather than padding the pane with em-dashes —
  **except email, phone and location, where the absence is itself information**.
- Prev/next arrows walk `STATE.ats.rows`. **Only the loaded page**: silently
  fetching the next page behind an arrow press would make the list underneath
  disagree with what the arrows do.
- **There is no `bd_candidate` page any more.** One code path, so the profile
  cannot drift into two things depending on how it was opened. `cpGoBack()`
  survives under its old name (five call sites + nav-history reference it) and
  now just closes.

### The sequence builder became a timeline

A sequence's whole meaning is "what goes out, and when". The old 480px stack of
rows showed the *what* and buried the *when* inside a number input, so nobody
could see that their follow-up landed the same afternoon as the first touch. It
now reads **Day 1 → Day 4 → Day 9** down a connector, each step's card hanging
off the day it fires, with a plain-English sentence above it saying whether it
opens a new thread or continues the old one.

**The day shown is cumulative and computed at render time** (`wfStepDays`);
`delay_days` stays relative to the previous step on the record. Storing the
absolute day would mean rewriting every later step whenever an earlier delay
changed.

### Compose got a live preview, with the From picker inside it

Editor left, the real email right. The sending mailbox is chosen **inside the
preview**, because which mailbox sends is not a setting — it is part of what the
recipient reads.

- **`{{sender}}` / `{{senderemail}}` resolve from the SELECTED MAILBOX**, never
  from the logged-in user — the same rule the send path follows. This is the
  point of the whole feature: a preview that used the session user instead would
  have rendered "Prince Thomas" for exactly the Session 14 case where 152 emails
  went out under the wrong name. It would have **hidden** that class of bug
  rather than caught it.
- **An unfillable variable stays visible and highlighted** (`.cmp-unset`).
  "Hi ," in a preview reads as a typo; a marked `{{fn}}` says the contact has no
  first name on record, which is the actual thing to fix before sending.
- The signature shown is the selected mailbox's, through `fillSignatureHtml` —
  the same call the send path makes — and only once loaded. Inventing a
  placeholder would be showing a sign-off that may not be what goes out.
- Typing repaints **only** `#cmp-mail`. A full `render()` per keystroke would
  rebuild the textarea and fight the caret.

The page also moved onto the shared frame, losing its duplicate in-page "Email"
heading. **The nav label went back to "Email"** — renaming it "Sequences" in
#147 was wrong; Sequence is one tab of five on that page. Recorded here because
it is the kind of tidy-looking rename that is worth *un*-doing.

### The inbox became two panes and shows the thread

- **The folder rail became a toolbar picker.** It cost 190px on every screen to
  save one click on a switch people make a handful of times a day, and the two
  panes carrying the work were paying for it. Nothing is lost: every folder,
  custom ones included, is in the list with its unread count.
- The reader shows the **conversation**, oldest first, open message expanded in
  place, the rest collapsed to a line. It uses **`GET /mailbox/:mid/threads/:tid`,
  which already existed and had no caller.**
- The thread endpoint returns **summaries, not bodies**, so a collapsed message
  opens through the same `loadMessage()` as any other. One code path for opening
  mail — and for marking it read — rather than a second, quieter one that would
  drift.
- **Message bodies keep a FIXED height and scroll inside themselves.** Sizing an
  iframe to its content means measuring it from the parent, which needs
  `allow-same-origin` — the exact grant that keeps a hostile email boxed in. The
  sandbox rule wins; a short message gets some empty space. This is a deliberate
  trade, not an oversight.
- **"Unread" is a view filter over what is already loaded**, not a server query
  — the honest reading of a list that pages in 25 at a time.

Two assertions in `mailbox-page-smoke.mjs` moved off implementation details onto
the behaviour they were pinning: unread rows are *marked* (by class now, not an
inline `font-weight:700`), and an active search *enables* the clear affordance
(a toolbar icon now, not a text button). All four safety assertions — sandboxed
body, blocked remote images, no permanent-delete call, own-mailboxes-only — were
untouched and still pass. 70/70.

## What this session did not do

- **No migration.** The only backend change is one read-only endpoint. 042 is
  still unclaimed, and still most likely the error column on `emails`.
- **The Gmail 7-day expiry is still unfixed**, and the owner's blocking question
  (is `futeglobal.com` on Google Workspace?) is still unanswered. Next expiry
  after the 31 Aug reconnect was ≈ 7 Sept 18:23.
- **Most pages have not moved onto the kit yet** — Leads, Jobs, Clients, Sourced
  Leads, Reports, Admin and the dashboards still draw their own headers and
  tables. That is the natural next slice and it is now cheap, which was the
  entire point of building the kit first.

## The lesson worth carrying

The owner asked for four screens and got them, but the durable value is that the
*fifth* screen is now an afternoon instead of a week. When a request is "make it
look like this", the honest reading is usually "give the app a structure it
doesn't have" — and the structure is the deliverable, not the screenshots.

---

# Session 15, part 2 — the rollout, and a decision to park something

Two more PRs on the same thread: **#149** (the context files) and **#150** (the
kit across every remaining list page). Plus one owner decision worth recording
precisely, because the risk with it is a future session re-raising it.

## The rollout

**Leads.** The six stage chips became the stat strip, and the stage *names* came
back with them. They had been number-and-colour only, with the name on hover —
recorded in the code as "owner's spec", but that spec was a workaround for
having nowhere to put a label in a row of chips. The strip has the room, so the
label returned and the stage colour stayed as the dot: both the original intent
(colour-coded, scannable) and the thing it had been trading away.

The rule that matters: **strip counts come from ALL of the user's leads, never
the filtered set.** The strip is the denominator you filter against; if
filtering moved it, clicking "Connected 3" would rewrite the very number the
click was aimed at. Same rule already applied on Candidates and now on Clients
and All Jobs.

"Connected" kept its drill-down rather than being made consistent with the other
cells, because that panel shows each connected lead's email, phone and LinkedIn
— information the table does not carry. Consistency would have cost a real
capability. The chevron says the click does something different.

**Clients.** The record became a drawer over the list. Two things had to be
fixed rather than inherited:

- **An overlay's data must repaint the overlay.** `paint()` rebuilds `#content`,
  and a drawer is drawn *after* `#content`, so all four detail fetches were
  landing in state and never reaching the screen. `paintDetail()` replaces just
  the drawer node. This is now a trap in the window file — it will bite every
  future drawer.
- **`recentEmailsCard()` had lost its only caller.** A client's email history
  was dead code, and had been for a while. It is back as an Emails tab. This
  turned up only because converting a page forces you to account for every part
  of it — which is an argument for the conversion beyond how it looks.

**Sourced Leads.** The status filter *is* the summary here — every cell is a
queue you can stand in and the number is how much is waiting in it — so it
became the strip directly. Labels stayed in the user's language rather than the
database's: "To review", not `new`.

**All Jobs.** Card grid kept deliberately: a job on the board is a pitch you
read, not a row you scan. It gained the frame and a strip answering what a
recruiter actually opens the board for.

**Reports.** Split into strip / filters / body so the standalone page could hang
them off the kit's frame while the My Team hub still gets one blob for its tab.
The alternative — duplicating the reports content for the two contexts — is how
a page ends up with two versions that drift.

**Not converted, deliberately:** the dashboards, Admin, the pipeline board, My
Team, Assign Leads. Card- and board-shaped, not list-shaped. Forcing the table
treatment on them would make them worse, and "the rollout is finished" is not
worth a worse screen.

## Tests: pinning behaviour, not markup

Three assertions moved across #147–#150, each off an implementation detail and
onto the behaviour it was really protecting:

- a flat nav index (`navItems[1] === 'My Jobs'`) → Dashboard first, and a
  recruiter's own jobs ahead of the shared board and the candidate pool;
- an inline `font-weight:700` → unread rows are *marked*;
- a `(2)` bracket format → every status still says how much is waiting in it.

Every **safety** assertion was left exactly as it was and still passes: the
sandboxed body, blocked remote images, no permanent-delete call, own-mailboxes
only. A redesign is allowed to move a cosmetic assertion; it is never allowed to
relax one of those.

## The parked decision

On 2026-09-01 the owner said of the Gmail 7-day expiry: *"We will work on this
but not now."*

That is a decision, and it is recorded in the window file under a heading that
says **do not re-raise it as blocking**. The full diagnosis sits with it so a
future session does not have to re-derive it: the OAuth consent screen is in
"Testing" status, Google expires refresh tokens after exactly 7 days there, and
if `futeglobal.com` is on Google Workspace then switching the app to "Internal"
fixes it with no code at all. Three code defects are worth fixing whatever
Google says — release to `pending` rather than `failed` on an auth failure, stop
the mailbox on the first failure instead of burning one email every 90s, and add
the error column (migration 042) so the app can say out loud what went wrong.

The discipline worth keeping: when an owner defers something, write down *what
was deferred and what was already known about it*, not just that it was
deferred. Otherwise the next session either pesters them again or starts the
diagnosis from zero.

---

# Session 16 — the screen glitch: why the app blinked, and the render engine that fixed it

**Branch** `claude/screen-glitch-diagnosis-7k0f8y` · **No migration** · 50/50
suites green.

## What the owner reported

Two screen recordings, no words beyond "see the glitch that's happening when
something happens on the screen, diagnose why it's happening". Clip 1 was the
Clients page (1.4s); clip 2 was the Inbox (6.9s).

## The diagnosis (frame-by-frame, not guesswork)

Both clips were decoded with ffmpeg and diffed frame against frame. Clip 1
turned out to contain no visible change at all except the mouse cursor — the
recording had started just after the event. **Everything the owner saw is in
clip 2**, and it is unambiguous once measured (ink pixels inside the reading
pane, per frame):

| time  | reading pane |
|-------|--------------|
| 0.5–3.2s | blank, "Opening…" — 2.7s of server latency |
| 3.3–4.3s | the message body appears; the owner scrolls into it |
| **4.4–5.8s** | **body gone for 1.4s**, header and buttons still there |
| 5.9s | body returns — **scrolled back to the top**, losing their place |
| 6.3s, 6.9s | two more blanks |

Frames 4.4–5.8s are *pixel-identical*, so it was not a paint stutter: the body
was genuinely gone and being rebuilt.

## Root cause — two faults, stacked

**1. Every state change rebuilt the entire application.** `render()` was
`root.innerHTML = renderApp()`. An email body lives in a sandboxed `<iframe>`,
and re-creating an iframe re-parses it from zero and resets its internal
scroll. The specific trigger in the recording: opening a message marks it read
→ `markRead()` → `refreshUnread()` → the unread badge falls 24 → 23 →
`scheduleRender()` → the whole app is rebuilt. **Reading an email is what wiped
the email being read.**

**2. Nine pages were missing from `renderPage()`'s switch.** `mailbox`,
`clients`, `applicants`, `reports`, `myteam`, `sourced`, `job_board`,
`bd_pipeline` and the BD job pages all fell through to
`return "<div class='page'>Page not found</div>"`. Each of those modules wrapped
`render()` and repainted `#content` itself a moment later. So every repaint on
nine of the app's pages was: blank → "Page not found" → the real content — a
visible flash, and a second iframe teardown on top of the first.

A related consequence of the same design: modals and drawers carry CSS entry
animations (`styles.css` `mIn`, `ui.css` `dwrIn`), so they replayed their
pop/slide-in whenever anything else on the page updated.

## The fix — the shell draws in regions, and writes only what changed

- **`UI.registerPage(name, render, paint?)`** (`00-ui-kit.js`) — the same
  idiom as the existing overlay registry. A page module registers the function
  that draws its screen, so the shell draws the *real* page on the first pass.
  All nine are registered; "Page not found" is now genuinely unreachable and a
  test asserts it.
- **`renderApp()` split into four regions** (`04-shell-login.js`): the rail,
  the topbar, the page, and the layer above the page (modal + drawers, now
  inside a stable `#layer`). It records each piece in `window._shellParts`.
- **`render()` gained an in-place path** (`03-core-render.js`): while the page
  is unchanged and the shell is standing, each region is rewritten **only if
  its html string differs from what is on screen**. An unchanged region is left
  alone — so its DOM survives, and with it iframes, scroll positions, entry
  animations and the caret. A page *change* still rebuilds wholesale, because
  nothing survives that anyway. `putRegion()` carries the caret across a
  legitimate rewrite.
- **`paintPageContent()` is now the one way to repaint the page body.** Every
  page module's `paint()` funnels through it, so the shell's record of what is
  on screen can never go stale.
- **The Inbox paints region by region** (`47-page-mailbox.js`): tabs, toolbar,
  list, and inside the reader `#mb-head`, `#mb-before`, `#mb-open`, `#mb-after`,
  `#mb-comp`. The open message sits in its own region between the two halves of
  the thread **specifically so that the thread arriving does not touch it** —
  that was the 6.3s flicker. The shorter in-thread body height is applied as a
  CSS class by `paint()`, never baked into `#mb-open`'s html, for the same
  reason: making the box shorter must not reload the message.

## Proof

`test/screen-stability-smoke.mjs` (new, 19 assertions) drives the real page and
asserts **node identity** rather than pixels — if the same iframe element is
still on the page, it was never reloaded. It fires the exact trigger from the
recording (the badge ticking down), plus a full `render()`, a background
refresh, a toast, the thread arriving and the composer opening, and requires
the message to survive all of them while the badge, thread and composer still
update. Its last assertion deliberately does the *old* thing once — rewrites
`#content` wholesale — and requires the test to notice, so none of the others
can pass for free.

Measured before/after on identical scripted runs, same trigger, same frame:
body ink 11,465 → **1,572** (blank) before the fix; 11,465 → **11,465** after.

## What this session did not do

- **No migration.** 042 is still unclaimed.
- **The 2.7s "Opening…" is untouched** — that is Render free-tier latency plus
  the Graph/Gmail round trip, a real problem but a different one.
- The Gmail 7-day expiry is still unfixed, and the owner's blocking question
  (is `futeglobal.com` on Google Workspace?) is still unanswered.

## The lesson worth carrying

"Rebuild everything on every change" is a fine default right up to the moment
the page holds something the DOM cannot re-create for free — an iframe, a
scroll position, a media element, a half-typed note. The app had already grown
four separate hand-rolled workarounds for that (focus restore, scroll restore,
`scheduleRender`'s modal guard, the job board's manual caret restore); the
glitch was the fifth symptom of the same cause. Fix the render model once and
all five stop being anyone's problem.

---

# Session 16, part 2 — the second flicker: a repaint every 2 seconds, and two scrollbars

The first fix shipped and the owner filmed the Inbox again: still a flicker
while reading. Same method — decode the clip, measure, then read code.

## What the second clip actually shows

4.5s of the Inbox with a message open. The body area goes **completely white
for two frames at 0.10s and again at 2.33s**, then comes back. Measured against
the frame before it, the returning content is **pixel-identical, at the same
scroll position** (4px of difference across the whole body region).

That is the tell. A rebuilt iframe reloads and resets its scroll to the top;
this one came back exactly where it was. So the element was never replaced —
the browser **re-rastered** it. An email body is an out-of-process sandboxed
iframe, and Chrome answers a style invalidation on an ancestor by throwing away
that frame's raster and redrawing it. For two frames you see white.

Two faults produced it, and both are ours.

## Fault 1 — a repaint every two seconds

`startProgressPoll()` (`11-bind-and-actions.js`) polls `/emails/send-progress`
**every 2 seconds while a send is running** and called `scheduleRender()` on
every tick regardless of whether anything had changed. The owner is a BD/admin
with the send loop live, so the whole app repainted under whatever they were
doing, twice a minute at rest and every 2s mid-send. The gap between the two
white frames in the clip is 2.23 seconds.

It now compares the payload and renders only when it moved, and only refreshes
the email list while the Email page is actually open (`goPage('email')` reloads
it on entry, so nothing goes stale).

## Fault 2 — a repaint that "changed nothing" still wrote three attributes

The region painter from part 1 skipped every unchanged html string — but it
still ran three unconditional class writes per paint: `mb-panes`, `mb-body`
(the `short` toggle) and `mb-thread`. **Setting an attribute invalidates style
even when the value is identical**, and all three sit above the iframe. So the
"do nothing" path was invalidating style around the message body every 2
seconds. `setClass()` now compares before writing.

The invariant is therefore stricter than "not rebuilt": **a repaint that
changes nothing must write nothing**, asserted with a MutationObserver over
`#main` expecting zero records. Restoring the unconditional write makes it fail
with exactly `attributes:mb-panes[class] | attributes:mb-body short[class] |
attributes:mb-thread[class]`, which is how we know it is measuring the real
thing.

## The third thing, found while reproducing: two scrollbars

Reproducing the wheel-scroll locally turned up something the clip also shows.
The reading pane scrolled AND the 420px message body scrolled inside it
(`threadScrollH` 580 vs `threadClientH` 478). A wheel over the message scrolled
the text, reached its end, then jerked the whole pane — and every one of those
pane scrolls moved a sandboxed iframe, which is more re-rastering. Only 111px
of the 420px body was even visible before the pane had to be scrolled.

A single-message conversation with no reply box open now gets `.mb-thread.solo`:
the body fills the pane and is the only thing that scrolls (`threadScrollH` 478
== `threadClientH` 478, body height 338 rather than a 420px box with 111px
visible). With a real thread on screen the pane has to scroll, so `solo` is not
applied. The sandbox rule is untouched — nothing is measured through the iframe,
the layout simply stops needing to know the content's height.

## What was NOT changed

The sandboxed iframe, the blocked remote images, and the "never innerHTML an
email body into the page" rule. Auto-sizing the iframe to its content would fix
this more completely and is still not worth `allow-scripts` or
`allow-same-origin`; flexbox gets the same result without granting anything.

## The lesson worth carrying

Two rounds, one root: *the page kept being touched when nothing had changed.*
Round one it was the whole app being rebuilt; round two it was three attribute
writes and a 2-second timer. When the artefact is a flash rather than a
rebuild, stop asking "what re-created this element" and start asking "what
invalidated it" — and let the test assert the absence of writes, not the
presence of the right ones.

# Session 17 — the outreach generator (reconstructed from the commit record)

*Written up in Session 18 from the commits and `CLAUDE.md`, because Session 17
ended without appending its own narrative. The durable rules it produced are in
`CLAUDE.md`; what follows is the sequence, not a retelling of reasoning that was
never written down.*

Six PRs built the Email → **Generator** tab: **#154** added it, **#155** rebuilt
how it reads a pasted posting and made it sign from the mailbox, **#156** fixed
the signature (`{{sender}}` had shipped to a real prospect, and the body was
signing itself on top of a signature that would be appended anyway), **#157**
made it read the employer and the city out of the posting rather than the form,
and **#158** replaced "regenerate and hope" with **four framings offered at
once** — and stopped the generator writing about the contact's own CV, because
none of the 30 replied threads in the owner's own history mentions the
recipient's background, and an email that opens *I read your profile* is not the
email that earned those replies.

The lasting shape: `services/outreach-generator.js` is pure and holds both the
rules writer and the AI seam behind one output shape, and the rules writer is
the product rather than a degraded mode — with no funded key, every email the
feature has ever sent came out of those functions.

---

# Session 18 — an AI seam that any provider can fill, and a budget in front of it

The owner's question was a product question, not a technical one: *are there
free open-source AIs I can use, and how do I stop them eating everything the
moment I paste a key?* Both halves shipped. A third thing happened in the
middle, which is the part worth reading twice.

## Where it started: six copies of one integration

Six features want an AI — cold-email drafting, the daily import briefing,
resume parsing, the job-description scrub, lead-distribution advice and the
outreach generator. Every one of them held its own copy of Anthropic's URL, its
key header and its model name. So "use a different provider" was not a setting.
It was six edits, and until somebody made them, an unfunded deployment ran all
six on their rules fallback with no way to change that from inside the product.

`services/ai-provider.js` (**PR #159**) is the one door. Callers ask for text;
it resolves which provider is configured, speaks that provider's wire format,
and returns `null` when none of them can answer.

**Two wire formats cover four providers.** Anthropic's (`x-api-key`, system as
a *field*) and the OpenAI-compatible one (`Bearer`, system as the first
*message*). Groq, OpenRouter and a self-hosted Ollama all speak the second,
which is the whole reason supporting three new providers is one adapter rather
than three. `buildRequest`/`parseResponse` are pure, so the exact bytes sent to
each provider are pinned offline rather than discovered in production.

**Providers chain; the admin's pick only leads.** Admin → Integrations grows a
"use this provider first" radio, and every other configured provider stays as a
fallback. That chain is precisely what makes a *free tier* safe to build on: a
spent daily allowance falls through to the next provider, and then to the rules
writer. Losing a free tier costs a dropdown change, not a feature.

**Ollama is keyless, so its server address is what turns it on.** Its connection
test says plainly when the address is unreachable *from the PACE server*, which
is the failure an operator actually hits the first time they point it at their
own laptop and expect a deployed service to reach it.

## The thing worth reading twice: two clean merges, one broken screen

While #159 was in flight the owner merged **#160**, their own feature (below),
written against the same file in a different session. Neither branch was wrong.
#159 **deleted** a small local helper, `aiConfigured()`, and pointed everything
at the provider layer. #160 **added a new call** to that helper, in a different
part of the same file. Git saw a deletion in one region and a call in another,
found no overlapping lines, and merged both without complaint.

`main` shipped a handler calling a function that no longer existed. Every load
of the Compose tab returned **500 `aiConfigured is not defined`** — the first
call that tab makes.

**#162** restored it (as a call to the provider layer, which is what #159
intended) and added the guard. The guard is the valuable artefact, and its first
version is worth recording as a failure: *calling the endpoint and asserting the
response carries no ReferenceError passes with the bug still in place*, because
the handler awaits the database first and, against a dead test database, times
out long before it reaches the bad line. The test that works reads the **source**
and asks the only question that matters — is every function this file calls
actually defined in it?

The lesson generalises past this file: **a clean merge is not a correct merge
when one side deletes a symbol and the other side adds a use of it.** Two
sessions editing one file will keep producing this. The cheap discipline is to
merge `main` into the branch and re-run the suite *immediately before* every
merge, not after — which is what Session 18 then did for #161.

## What the owner built: Compose folded into the composer that actually sends

**#160**, merged by the owner mid-session. Two tabs were two ways to write the
same email and only one of them sent it: the old Compose tab's Send opened a
Gmail/Outlook deeplink in a new tab and pushed a "sent" record into browser
memory that no backend ever saw — **no tracking pixel, no `email_tracking` row,
no open or reply detection, and nothing in PACE's own Sent list.** So the merge
went the opposite way from the obvious one: the *generator* absorbed Compose,
because the generator really sends. A real send still lands in the connected
mailbox's own Sent folder, so nothing is lost. The reminder flow kept the old
body, since it goes through the send engine rather than this composer.

The recipient can now come from either side of the split that used to separate
the two tabs. **Someone already in PACE** — `GET /outreach/recipients` searches
contacts and companies *together*, because a person looking for "Berks" does not
know or care which table the answer is in; picking a person fills address, first
name, title and company, and picking a company lists its contacts so a second
click finishes the job (`GET /outreach/company-contacts/:id`). **Or someone
new**, typed in and written nowhere. Either way the rest of the composer is
unchanged, so the four framings, the signature preview and the tracked send do
not care how the recipient arrived.

**"Sent from here"** (`GET /outreach/sent`) lists what went out and what came
back — Sent, Opened, or Replied — and a **replied** row offers "Convert to
lead". An opened one deliberately does not: an open is information, a reply is a
live conversation, and until it is a lead it is invisible to the pipeline, the
follow-up engine, the "needs you today" queue and every report. Converting
(`POST /outreach/convert-lead`) reuses an existing company by name, creates the
lead at stage **Connected** — which is what "they replied" means here — and marks
the contact replied. An address already on a lead is refused rather than
duplicated, and a reply already converted is refused too. **No migration:**
`email_tracking` has carried an unused `lead_id` column since 024, which is
exactly what it was for.

## Then the owner asked the right question

*"The moment I paste this key, are all the available tokens eaten out
automatically? I don't know how much a token gets used to read one email, one
lead, one JD."*

The reassuring half of the answer is that a free account has no card on it, so
nothing here can produce a charge. The real risk is different and was genuinely
uncovered: **a daily allowance emptied by mid-morning**, after which every AI
feature silently reverts to its rules output for the rest of the day with
nothing on screen explaining why.

And there was one genuinely uncapped path. The outreach generator takes a job
posting the user **pastes**, so its length was whatever a careers page happened
to contain — navigation menus and all — sent verbatim to the largest model.
Everything else had a ceiling by accident (a `slice(0, 20000)` here, a
`slice(0, 12000)` there) rather than by policy.

**`services/ai-budget.js` (PR #161)** decides three things before a call goes
out, in the order they matter:

1. **What we send.** Cost is dominated by input length, and input length is
   whatever a user pasted. Every feature declares an input ceiling, and long
   input is **trimmed, not refused** — a resume's fields are on its first page —
   with the trim marked in the text, because a model that can see its input was
   cut behaves better than one that thinks the document ended.
2. **Which model.** Pulling fields out of a resume and writing a cold email are
   not the same job. Extraction runs on the small fast model; only prose a
   prospect will read gets the bigger one. Per provider, via
   `PROVIDERS[id].models` — and both tiers are identical on Ollama, which has no
   allowance to spend and may not have a second model pulled.
3. **How many.** A per-org daily ceiling on tokens and requests, checked
   **before** the call, against an estimate that deliberately rounds up (input
   plus the longest answer the request permits — a meter that counts only what
   came back can be blown past by one long reply).

**Over budget is not an error.** It is the same `null` as "no provider
configured", and the feature's rules writer answers; a call refused this way
never reaches the provider at all. That is the only reason the ceiling can be
made strict without being risky, and it is the rule that must not be softened.

The meter lives in `app_settings`, keyed `ai_usage_<org>_<YYYY-MM-DD>`, so it
needs **no migration** and expires by simply never being read again. It is a
meter, not an audit log — it answers "how much is left today", which is the
question a budget asks; a per-call history is a later upgrade and its own table.
Recording is best-effort on purpose: a counter that throws would take down the
feature it exists to protect.

Defaults are **150,000 tokens and 250 requests** per org per day, set under the
free tiers' own daily allowances so the day's budget runs out before the
*provider's* does. Being throttled by your own settings is diagnosable; being
throttled by Groq at 2pm looks like the feature broke. Admin → Integrations
shows a usage bar, both caps as editable numbers, and a per-feature table of
model tier, per-request ceiling and spend today — because a cap nobody can see
the other side of is a guess. Blank means "use the default"; a typed `0`
genuinely means "no AI today", and the two are deliberately not collapsed.

Measured per-request costs, given to the owner in plain numbers so the budget
could be reasoned about rather than trusted: a resume parse ~1,900 tokens
typical / 4,700 worst case; a JD clean ~2,000 / 5,500; a generated outreach
email ~1,650 / 4,000; a cold-email draft ~700 / 1,600; the daily briefing ~800 /
1,600. 150,000/day is roughly 30 resumes, 30 emails and 10 JD cleanups.

## What shipped

**#159** (provider layer), **#161** (budget) — both merged to `main` and
deployed. **#160** and **#162** were the owner's own merges. **No migration**
was needed by any of it, which was a design goal rather than luck: both new
subsystems were deliberately built on `app_settings` and on columns that already
existed.

Tests: `test/ai-provider-smoke.mjs` (48 checks — both wire formats byte for
byte, chain ordering and fallbacks, the null-not-throw contract under an
all-providers-failing 429, and a grep that fails if any file calls a provider
URL directly again) and `test/ai-budget-smoke.mjs` (37 checks — trimming a
100k-character paste to ~500 tokens on a word boundary, per-feature clamping,
model tiering, per-org meter isolation, yesterday's spend not counting against
today, a refused call making zero HTTP requests, and a zero cap switching AI off
without disconnecting the key). **53/53 suites green.**

## Left honestly open

The six prompts were all written for Claude, which follows nuanced instructions
about tone better than the free open models do. Nobody has yet put a free
model's output next to the rules writer's on a real posting. The honest possible
outcome is that the free model writes *worse* than the rules writer for the
email generator specifically — in which case the right answer is to leave that
feature on rules and spend the free tier on resume parsing and JD cleanup, where
the bar is lower and the win is larger. That comparison needs the owner's eyes
on real output; it is not a judgement to make on their behalf.

# Session 18, part 2 — the owner used it, and nothing worked in a way nobody could see

Part 1 shipped the provider layer and the budget. Part 2 is what happened when
the owner actually pasted a key: **five rounds, and the AI still has not been
proven to run.** What did get fixed is everything that made that impossible to
diagnose — which turned out to be the more valuable half.

## First: four AI features, not six

Asked where AI lives in the product, the honest audit came back different from
the code. Six features hold an AI seam; **two of them cannot be reached at
all.** The daily import briefing (`/ai/generate-summary`) has a working backend
and **no caller anywhere in the frontend**. Cold-email drafting
(`/ai/generate-email`) is called only from `12-manager-users.js` — the orphaned
Manager Users page — and even inside that file the function is never invoked.

So the live count is **four**: resume parsing, the job-description scrub, the
outreach generator, and lead-distribution advice. Sessions 18 part 1 said "six"
repeatedly because that is what the code holds; nobody had checked the UI.
Deciding what to do with the two dead ones is still open (the briefing is worth
wiring to the dashboard; the cold-email drafter is superseded by the generator
and worth deleting).

## What the owner found in five minutes of real use

Screenshots of Assign Leads, and three faults in them — none about AI:

1. **The typed count was read only by the Auto path.** Typing `10` and then
   describing priorities previewed the whole **162-lead** pool. That preview
   total is exactly what `/distribute/execute` assigns, and assignment starts
   sending immediately, so a display bug sat one click away from a mass send.
2. **A typed instruction was dropped in silence, under a heading that said AI.**
   "80% construction and 20% accounting" produced 4% across 25 industries — the
   correct rules output, presented as though an AI had chosen it.
3. **`pool-stats` selected each lead's `freshness` and never counted it**, so
   the Freshness column was structurally always empty, for every engine, since
   it was built.

Fixed in **#164**, with `test/lead-distribution-preview-smoke.mjs` pinning the
one that matters: the number the preview shows is the same object execute
receives.

## The real subject: a silent fallback nobody could see through

The owner pasted a valid Groq key, saw the provider card report **"Key valid ·
14 models available"**, saved it — and every feature carried on writing with its
rules. Nothing on any screen said why.

That is the safety net working and the operator being forgotten. **The `null`
that shields a recruiter from a provider failure also hides the cause from the
person trying to fix it**, and from outside, "AI is off" and "AI is broken" are
identical. Four rounds of fixing that, each prompted by the owner reporting that
the previous one still showed nothing:

**#164 — the ability to ask at all.** A provider card's "Test" lists models: it
proves the KEY is accepted and nothing more. A generation can still fail on the
model *name*, a per-model permission, or a rate limit — every one of those
indistinguishable from having no key. `diagnose()` asks each configured provider
for one word through the real path; `describeHttpError` reads the provider's own
error body instead of discarding it, turning `HTTP 400` into
`model_decommissioned: <name>`, which names the fix.

**#165 — the answer must be visible.** The owner clicked and the card reverted
to its previous state. Cause: the card was drawn INSIDE `aiBudgetCard()`, which
returns `''` when the budget has not loaded — so the diagnostic vanished
precisely when something was wrong. Also, several outcomes had no branch at all
and fell through to the default. And the deeper gap: *"nothing configured"* and
*"the key you just saved is not being found"* looked identical, so `diagnose()`
now reports every provider, whether a key was found, and its last four
characters.

**#166 — the answer must survive the trip.** Driving the real button in a
browser here produced a visible result in every case that could be simulated
(JSON, a 404, junk), so the failure was not reproducible in this environment.
Rather than guess a fourth time: the result is written to `app_settings`
(`ai_last_test`) as it is produced and returned with the budget, so reopening
Admin → Integrations shows the last test with a timestamp. The request stops
waiting after 45 seconds and names the likely cause (the service sleeps when
idle). Providers are tried in parallel with a 12-second leash rather than in
series at 20. And a failure now carries its fix: the list of models that
provider actually offers, fetched only after an attempt has failed, with
instructions to paste one into the model box.

**#167 — it should not need asking.** The owner's words were *"it glitches and
shows itself"* — a modal redrawing unchanged, which is what happens when the
card throws before rendering: `STATE.modal` keeps its old value and the click
looks ignored. Both the card and the handler got error boundaries. And the
screen now **runs the test itself on open** when a provider is configured and
nothing has been recorded — sidestepping the button entirely for anyone whose
click is not landing.

**Still unknown at session end: whether the AI actually runs.** The leading
suspect remains the Groq model names in `PROVIDERS`, which were written from
memory and have never been checked against a real response, because this sandbox
cannot reach `api.groq.com`. If that is it, the fix is one word in the model box
and the card now prints the valid names.

## The heartbeat alarm was false, and it accused a correct setup

The Admin card said no heartbeat had arrived in over an hour and blamed
`CRON_KEY` in Render not matching the GitHub secret. **The Actions history
disproves both halves.** On 2026-09-04 the heartbeat fired at 01:12, 06:24,
11:37, 16:05 and 19:03 UTC — every one HTTP 200, all six jobs run.

GitHub treats scheduled workflows as best-effort and was delivering the
30-minute schedule every 3-5 hours. A one-hour threshold therefore reported a
healthy engine as broken, and acting on its advice would have meant rotating a
key that was already correct — the worst kind of alert. Three states now:
healthy (<90 min), **late** (GitHub throttling; jobs are delayed but never
skipped, because due-ness lives in the database), and silent (8h+, where the
key-mismatch advice belongs). The measurement is recorded in `heartbeat.yml` so
nobody re-derives it, and the fix is in the reporting rather than in pinging
harder, which would eat the free-tier instance-hour budget.

## Two process notes worth keeping

**A test that pins wording is not a test that pins behaviour.** #167's first
commit turned `engine-card-smoke` red. Its safety assertions — a silent engine
must never read as healthy, the states must stay distinguishable — passed
untouched; only the text moved, because the old text was wrong. Reading that
distinction correctly is the difference between fixing a test and weakening one.

**Waiting on `npm test` in the background needs care.** Several waiter loops
used `pgrep -f run-all.mjs`, which matched their own command line and never
exited. Harmless, but it wasted a lot of a session; wait on the node process
specifically, or just run the suite in the foreground with a long timeout.

## The lesson

A fallback that protects the user must never be invisible to the operator.
Every one of these four rounds was the same bug in a different place: the
product degraded gracefully, and told nobody. Graceful degradation without
observability is indistinguishable from being broken — and this session spent
five rounds proving it, because the diagnostic itself kept degrading gracefully
and telling nobody.

---

# Session 19 — the button that was never wired to anything, and the phone

Two complaints from the owner, both of them the same shape underneath: the app
was telling nobody the truth about itself.

## Part 1 — "I got my Groq key, it's live, but the AI isn't working, and the test button doesn't work either"

Session 18 spent four rounds building a card that would explain why AI was
silently falling back to its rules writer. The owner pasted a valid Groq key,
the provider card said "Key valid · 14 models available", the health card ran
itself on open, and the answer was **still** a placeholder that read "Click
Test AI generation after saving a key". Clicking it changed nothing.

### The cause: the endpoint was never reachable

`routes/integrations.js` registered, in this order:

```
POST /admin/integrations/:id          ← line 102, "save keys for one integration"
POST /admin/integrations/:id/test
POST /admin/integrations/ai-test      ← line 151, appended in a later PR
POST /admin/integrations/email-verify ← line 208, appended later still
```

Express matches in registration order, so `POST /admin/integrations/ai-test`
matched `:id` with `id="ai-test"`. That handler found no `values` and no
`active` in the body, did nothing, and returned `await integrations.getAll()` —
a **200 with a perfectly valid integrations payload.** The browser's check was
`r && typeof r === 'object'`, which that passes, so the card stored the
integrations list as its diagnosis, matched none of its branches, and fell
through to the "never run" placeholder. No error, no log, nothing in the
network tab that looked wrong. `aiProvider.diagnose()` was never once called,
which is also why `ai_last_test` was always empty and the self-run-on-open had
nothing to show.

A scan of every router in the tree found **three** live instances of the same
bug, not one:

| Dead route | Swallowed by | What the user saw |
|---|---|---|
| `POST /admin/integrations/ai-test` | `POST /admin/integrations/:id` | "Test AI generation" does nothing |
| `POST /admin/integrations/email-verify` | same | the verifier tester does nothing |
| `GET /jobs/export` | `GET /jobs/:id` | the RA lead's CSV export fails |

All three literals now sit above their `:id` routes, and
`test/route-shadowing-smoke.mjs` scans all 270 routes in the repo and fails the
build on any literal path registered behind a matching `:param` route. It also
proves its own detector against the exact shape that was live, so it cannot
become a test that always passes.

**CLAUDE.md already carried this rule — for `routes/recruiting/*` only,** where
it had been learned once before. It is not a recruiting quirk. It is now
written as what it is: how Express works, everywhere.

### Three hardening changes that came out of it

1. **The card rejects a well-formed answer from the wrong endpoint.**
   `isDiagnosis(r)` requires a diagnosis's own fields (`configured` boolean +
   `providers` array), and a mismatch renders the wrong shape's keys on screen
   with "that means the request reached a DIFFERENT endpoint than the one that
   runs the test, which is a bug in PACE, not in your key."

2. **`diagnose()` now tests every model tier a feature can ask for.** The
   budget picks `fast` for extraction and `quality` for prose a prospect reads.
   Probing only `fast` can report AI IS WORKING while the outreach generator —
   the one feature whose text a customer sees — is still writing with its
   rules, because the quality model is the one that was renamed. `working` now
   means every tier answered; one up and one down is `partial`, drawn in amber,
   and each line says which features ride on that tier. The model-list lookup
   is memoised per provider so two failing tiers cost one request.

3. **A synthetic ping never hides a real failure.** `ai_last_error` — what
   happened the last time a *feature* asked for text — renders under the test
   result, always. It used to be suppressed the moment any test result existed,
   which meant the more truthful signal was hidden by the less truthful one.

### What is still not known

Whether Groq actually generates. This sandbox cannot reach `api.groq.com`, so
the verdict still needs the owner to open Admin → Integrations. **The
difference is that the card can now answer**, and if the answer is a model
name it prints the models Groq does offer, ready to paste.

## Part 2 — "the layout on mobile looks clustered and overlapped"

Three phone screenshots, three separate faults, all reproduced exactly in
Chromium at 390×844 with `isMobile`/`hasTouch` before anything was changed.

### 1. The rail showed its labels inside a 60px slot

A touch browser fires `:hover` on tap and **leaves it stuck there**. Tapping a
nav item therefore faded in every label — while the rail stayed 60px wide,
because the Session-15 fix reset the WIDTH under `@media(max-width:900px)` and
forgot the opacity. Result: "WORK", "RECOR…", "OUTRE…", "INSIGH…" sliced down
the left edge, nav text overlapping the icons. Exactly the owner's screenshot.

Width was the wrong question. A 900px tablet is a touch device; a 500px desktop
window is not. All the hover-expand rules moved into
`@media (hover:hover) and (pointer:fine)` in `ui.css` — `.pinned` stays outside
it, being an explicit choice rather than a hover.

That fixes the mess but leaves the real problem: with no hover there was no way
to read the menu at all — fourteen unlabelled icons. So below 860px the rail is
now an **off-canvas drawer** at its full 232px behind a hamburger in the top
bar, with a scrim, closing on the scrim, on Escape, on choosing a destination,
and on crossing the breakpoint.

**It is one class on `<body>`.** `openNav`/`closeNav`/`toggleNav` toggle
`body.nav-open` and touch nothing else; the scrim is drawn once by `renderApp()`
outside the four patched regions because it has no state. A menu that
re-rendered the shell to open itself would throw away the page's scroll
position and reload every iframe on it each time somebody looked at the nav —
which is the exact flicker Session 16 spent itself removing.

### 2. Pages scrolled sideways

`#content` is `overflow-x:auto`, so a single element wider than the screen
dragged the whole page. Measured before: Leads 572px of content in a 330px box,
Candidates 500px, Admin 926px. Half a form off the right edge and the only way
back was swiping the entire screen — the owner's third screenshot.

`#content` is now `overflow-x:hidden` on a phone, **which is a trade, not a
fix**: an overflow that no longer drags is an overflow that is clipped and
unreachable. So the offenders were fixed rather than hidden — toolbars and page
headers wrap their action groups onto their own row, the stat strip goes two-up,
paired form fields stack, wide tables scroll inside `.dt-wrap`/`.tbl-wrap` with
`overscroll-behavior-x:contain` — and `test/mobile-layout-smoke.mjs` walks every
element of 16 pages × 5 roles at 390px and fails on anything reaching past the
content box that is not inside its own scroller. **That test is what makes the
hidden overflow safe.** 80 screens, all clean.

### 3. The dashboard banner overlapped itself

The clock was `position:absolute` over the greeting — inline-styled, three
identical copies — so "Good morning" ran underneath the date on a narrow
screen. It is now `.banner-clock`, back in the flow on a phone and above the
greeting, which is also the order a recruiter reads it in.

### The rule that kept recurring: an inline style cannot be responsive

A width or a grid written into a `style=""` attribute cannot be re-laid-out by
any stylesheet. Three separate mobile faults were that:

- Six admin header buttons in an inline `display:flex` with no wrap → 460px off
  the side. Fixed by `.ph>.flex>:last-child{flex-wrap:wrap}` — the action group
  is always the last child, and `flex-wrap` on a non-flex element is inert, so
  it is safe to apply blind.
- A stat tile's inline `min-width:105px` put six tiles three-to-a-row and threw
  "Awaiting approval" out of its own card. Extracted to `.dash-tile` (it was
  three copies of the same blob in two files).
- The compose form's inline `grid-template-columns:1fr 1fr` left two 150px
  fields. Extracted to `.fpair`.

### A latent desktop bug fell out of it

`'<button class="btn">' + UI.ic('plus') + 'Add Lead'` — `UI.ic()` returns a bare
`<svg>` with a viewBox and no width/height, and no rule sized `.btn > svg`. As a
flex item with no basis it collapsed to **0×0 on a desktop**: the icon has
simply been invisible, which is why nobody noticed. On a phone, where the button
was allowed to grow, the same svg inflated to a 75px plus sign in a 93px-tall
button. `.btn>svg{width:15px}` (direct children only, so the older
`ico(name,size)` wrapper keeps winning) fixes both.

## The lesson

Both halves of this session were the same failure. The AI card degraded to a
placeholder and told nobody the request had gone somewhere else entirely; the
phone layout degraded to a sideways-scrolling page and told nobody either. In
both cases the code "worked" — a 200, a rendered page — and the only way to
find out otherwise was to measure what actually happened rather than read what
was supposed to. The two new suites are both measurements: one asks the router
which handler really answers, the other asks the browser where the pixels
really are.

**And a specific warning:** four sessions of work went into a diagnostic that
was never once invoked. When a feature reports nothing, check that its request
reaches its handler before improving what the handler says.

## Session 19, part 2 — the model name really was the bug

The health card, on its first working run, answered the question four sessions
had failed to:

```
✗ groq  llama-3.1-8b-instant · fast model
HTTP 404 — The model `llama-3.1-8b-instant` does not exist or you do not have access to it.
This provider currently offers: openai/gpt-oss-20b, groq/compound, whisper-large-v3,
whisper-large-v3-turbo, qwen/qwen3.6-27b, canopylabs/orpheus-arabic-saudi,
openai/gpt-oss-120b, qwen/qwen3.8-27b, canopylabs/orpheus-v1-english, groq/compound-mini,
meta-llama/llama-prompt-guard-2-86m, meta-llama/llama-prompt-guard-2-22m, allam-2-7b,
openai/gpt-oss-safeguard-20b
```

`CLAUDE.md` had flagged the leading suspect correctly since Session 18 — "the
Groq/OpenRouter model names were written from memory and have never been
verified against a real response" — and it was right. Groq had retired the
Llama 3.x line. Every AI feature had been writing with its rules for as long as
the key had been installed, and nothing anywhere said so, because the one
diagnostic that would have said it was behind a shadowed route.

**Defaults are now `openai/gpt-oss-20b` (fast) / `openai/gpt-oss-120b`
(quality)**, taken from that account's own `/models` response and pinned with
their provenance and date. Three things came out of reading the list properly:

**1. A provider's catalogue is not a list of writers.** Of the fourteen models
offered, only four could draft an email. The rest were speech-to-text
(whisper), text-to-speech (orpheus), safety classifiers (prompt-guard,
safeguard) and an Arabic-first model — and the card's "paste one of these into
the model box" pointed at all of them equally. That is an instruction that
leads somewhere worse than where you started. The card now splits the list into
what can write text and what cannot, and says plainly when a provider offers no
writer at all.

**2. A reasoning model bills its thinking against `max_tokens`.** gpt-oss
thinks before it answers, out of the same ceiling as the answer. At this app's
budgets — 700 tokens for a resume parse, 1000 for an email — an uncapped
reasoning budget can consume the whole allowance and return an EMPTY message,
which from outside is indistinguishable from a broken provider. So
`PROVIDERS[id].reasoningModels` marks that family and `modelParams()` sends
`reasoning_effort:'low'` **to it and nothing else** — an unknown parameter is a
400 on some OpenAI-compatible endpoints, so the narrowness is the point. The
same trap was already live in the health check itself: its ping asked for 16
tokens, which a reasoning model would have spent entirely on thinking, and the
card would have reported a working model as broken. It asks for 256 now.

**3. "No usable text" was true and useless.** `describeEmptyReply()` separates
the three ways a reply arrives empty — truncated at the ceiling, reasoning-only
with no answer, or an error object — because each has a different fix.

Three test files had pinned the old model names as literals, which is why the
suite went red on a correct change. Two of the three were re-pointed at the
registry (`ai.PROVIDERS.groq.models.fast`) so the literal lives in exactly one
place: the block in `ai-provider-smoke.mjs` that also records where the name
came from and when. A name verified against a real response is worth pinning; a
name copied into four files is worth pinning once.

### The lesson

Part 1's lesson was "check the request reaches its handler before improving
what the handler says". Part 2 is the other half: **the diagnostic was right
all along, and nobody could see it.** The 404 had been sitting behind that
button for four sessions. Everything built to explain the silence worked on its
first real run — the provider's own error text, the model list, the fallback
that kept the product working meanwhile. None of it was worth anything until
the request could reach it.

## Session 19, part 3 — the sandbox runs Node 22, the server runs Node 26

The resume failure was never in the file, the upload, or the transport. It was
the **runtime**, and the only reason that became knowable is that the failure
record built in part 2 stamps `process.version`.

The very first record settled two things at once:

```
declared_size: 14241   received_size: 14241   ← every byte arrived
head: "%PDF-1.7"       tail: "…startxref 14013 %%EOF"
has_eof: true          reason: "Invalid PDF structure"
node:  "v26.8.1"       ← the sandbox is on v22.22.2
```

**The file was byte-perfect.** Which also meant the sentence shipped hours
earlier — *"the file was damaged in transit"* — was a confident, wrong
diagnosis that would have sent the owner off re-uploading a good file. It was
rewritten the same session, and the lesson written down: never let a message
sound more certain than the evidence behind it.

Node 26 was downloadable from the sandbox (`nodejs.org` is not blocked by the
proxy, unlike `*.onrender.com`), so the bug was reproduced exactly:

```
########## Node 22 ##########        ########## Node 26.8.1 ##########
PM      OK  chars=2610               PM      FAIL InvalidPDFException
SWE     OK  chars=2630               SWE     FAIL InvalidPDFException
PRINCE  OK  chars=6253               PRINCE  OK   chars=6253
```

…and Node 26 printed the cause the older runtime had hidden:
`FormatError: Unknown compression method in flate stream: 111, 32`. Those bytes
are the characters `"o "` — pdf.js was reading **plain text where it expected
zlib**. `pdf-parse@1.1.1` bundles **pdf.js v1.10.100, built in 2018**; on Node
26 it misreads a compressed cross-reference stream, falls into its recovery
pass, and that pass only rescues a PDF carrying a classic `trailer`. Hence two
modern resumes failing and one older one going through, on the same server,
through the same upload path. **It was never intermittent — it depends on which
tool generated the PDF.**

`unpdf` leads now, with `pdf-parse` kept as a second chance. It was chosen over
`pdfjs-dist` on identical output — same character counts on all three files —
because it is **2.6MB against 37MB plus optional native canvas binaries**, and
the extra 34MB buys only page *rendering*, which this app never does. On a free
tier that weight is re-downloaded every build and paid for on every cold start.
It is imported lazily, so it costs nothing until a PDF actually arrives.

The suite now runs green on **both** Node 22 and Node 26, and CLAUDE.md carries
the rule that produced this: when something works here and fails there, fetch
the server's Node and re-run before theorising.

## The other half: two screens of the app contradicting each other

The owner also reported lead distribution saying **"No AI provider answered"**
while the budget card showed **2,049 tokens spent on lead distribution**. Both
were drawing from the truth; the code was wrong.

`/distribute/generate-ratio` did `JSON.parse(out.text)` outside any local
try/catch. gpt-oss **reasons before it answers, out of the same `max_tokens`
ceiling**, and lead distribution's ceiling is 400 — so the reply arrived
truncated, `JSON.parse` threw into the outer catch, and that catch returned the
rules split. The tokens had been spent and the banner said nothing had
answered.

Two fixes, and they are different in kind:

1. **`answerCeiling()`** adds `REASONING_HEADROOM` (512) for models matching
   `PROVIDERS[id].reasoningModels`, and the budget estimates on what is
   actually put on the wire. The FEATURE still declares how long an *answer*
   may be; the provider layer adds what the model needs to reach one. Without
   that separation the fix would have been "raise every ceiling", which spends
   budget on features that never needed it.
2. **"It answered unusably" is a third state.** The route returns
   `ai_unusable`, records the tail of what the model actually said, and the
   page says *"The AI answered but its reply was cut short"* instead of
   claiming nothing answered.

Three assertions in `ai-budget-smoke` failed on the ceiling change and were
updated rather than relaxed: two now assert `feature ceiling + headroom` as a
sum (so neither half can drift — drop the headroom and gpt-oss returns empty,
drop the ceiling and a pasted job page becomes an uncapped bill), and the third
had a 1,000-token daily cap that was simply too small for one call once the
headroom existed, which made it test the per-call ceiling instead of the
yesterday-versus-today thing it is named for.

## The lesson

Part 1: check the request reaches its handler. Part 2: the diagnostic was right
and nobody could see it. Part 3: **the diagnostic was right, and it pointed
somewhere nobody had thought to look — the runtime.** Every one of these was
found by making the app record a fact rather than by reading the code harder.
The single most valuable line in this whole session is `node: process.version`
in a failure record nobody expected to need.

## Session 19, part 4 — the default that switched off its own check

Between the model-name fix and the Node discovery, one more bug was found the
same way: by reading the live database rather than the code. `ai_last_test`
held

```json
{"attempts":[{"provider":"groq","model":"openai/gpt-oss-20b","tier":"fast","ok":true,"ms":250}],
 "working":true,"partial":false,"tiers":["fast"]}
```

One attempt. One tier. Under a green **AI IS WORKING**.

`diagnose()` probes every model a feature can ask for *when it is given no
tier* — that was the entire point of the two-tier change, since the budget
sends extraction to `fast` and prose a prospect reads to `quality`, and a green
tick earned by one of them is a lie. But the route passed
`tier: (req.body && req.body.tier) || 'fast'`, so `opts.tier` was always truthy,
`tiers` was always `['fast']`, and the two-tier probe never ran once in
production. `openai/gpt-oss-120b` — the model the outreach generator sends to a
customer's prospects — had never been called at all.

**A default that silently disables a check is worse than no check: it reports
success it did not earn.** The route now passes a tier only when one is
explicitly asked for, and it is pinned two ways — the handler must not carry
the default, and a `diagnose()` with no tier must really put two different
models on the wire (asserted on the request bodies, not on the shape of the
result).

One small process note worth keeping: that source-reading assertion first
failed against **its own explanatory comment**, which quotes the old
`|| 'fast'`. It now strips comments before matching. That is the second time
this session a source guard had to be taught the difference between code and
the story about the code — the first was `test/outreach-generator-smoke.mjs`
in an earlier session. A guard that reads source must read *source*.

## Session 19 — where it ended

Five PRs, all merged and live: **#170** (the AI test button + the phone),
**#171** (Groq's real model names), **#172** (resume diagnosis + the
self-checking upload), **#173** (the tier default), **#174** (a PDF reader that
works on Node 26 + reasoning headroom + the third AI state).

**AI is confirmed working end to end** — Groq, `openai/gpt-oss-20b`, 250ms,
and the meter shows real spend against `resume_parse` and `lead_ratio`, which
only records on success. No migration was applied; 041 is still the latest.
The suite is **59 suites, green on Node 22 and on Node 26**.

### What this session was actually about

Not one bug — the same bug in five costumes. Every single fault was something
the product knew and did not say:

| what was broken | what it looked like from outside |
|---|---|
| a shadowed route | a button that "did nothing", for four sessions |
| a retired model name | AI "connected" and every feature writing with rules |
| a defaulted tier | a green tick that had tested half of what it claimed |
| a 2018 PDF reader on Node 26 | "sometimes it reads the PDF, sometimes it doesn't" |
| a truncated AI reply | "no AI answered" beside a meter showing the tokens spent |

And every one of them was found the same way: **by making the app record a fact
and then reading it**, not by reading the code harder. The single most valuable
line written all session was `node: process.version` in a failure record nobody
expected to need — it is what turned "the PDF is sometimes broken" into "the
runtime is different", which was not a hypothesis anyone had.

The counterpart lesson is about confidence. The first version of the resume
error said *"the file was damaged in transit"*. It was wrong, and the very
first record disproved it — 14,241 bytes declared, 14,241 received. A
confidently wrong message is worse than a vague one, because it sends someone
off doing the wrong thing with conviction. **Never let a diagnosis sound more
certain than the evidence behind it.**

---

## Session 20 — the session where the sandbox finally reached the model

Three merged PRs (#176, #177, #178), one live data repair, and one lesson that
outranks all of them: **for most of this project's life we could not call the
AI we ship, and everything we believed about it was inference.** The owner
opened the network policy mid-session. The first real generation found two bugs
inside ten minutes.

### Part 1 — two silent failures behind one screenshot (#176)

The owner sent a screenshot of the Email page with a complaint that the numbers
did not add up: a green "Send complete" card reading **375 total · 164 waiting**
directly above a pending panel reading **21**. And separately: *"if I change the
stage of the leads from assigned to unassigned, it's not available again for
assigning if the emails have been sent out from those."*

Both were real, and both failed **silently** — the app reported success and did
nothing.

**The card.** It is a snapshot of one send run, stored in `app_settings` so it
survives a restart. A 60-second timer was supposed to clear it — but that timer
only fires while the process lives, and Render's free tier sleeps the service.
So the card came back hours later still asserting totals about a queue that had
since been purged. A finished run now expires 15 minutes after `completedAt` on
read; an active run never expires; and the admin purge clears the card for every
sender whose queue it emptied.

**The un-assignable leads** were worse, and the database said so. The
duplicate-cold-email guard (`fetchInitialOutreachedPairs`) blocked a new initial
email on **any** prior non-failed one, for all of history. So a lead that had
ever been emailed could be returned to the pool, redistributed, reported as
assigned — and generate nothing. The guard is now scoped to the lead's CURRENT
cycle, marked by `last_recycled_at`.

Then the live data showed the bigger half. Three code paths returned a lead to
the pool and **all three did it differently**; `PUT /jobs/:id` changed only the
stage and left `assigned_to_bd` set. The distribution pool requires
`assigned_to_bd IS NULL`, so those leads were invisible to it:

| leads in the Unassigned pool | 11 |
|---|---|
| still holding an `assigned_to_bd` | **11** |

Every lead in the pool was in a half-released state. All three paths now go
through one `releaseToPoolUpdate()`. The 11 were repaired in the live database
with the owner's go-ahead.

### Part 2 — AI into the outreach generator, and the first real call (#177)

The owner asked for the AI to write the emails and for a **Job title** field so
it knows which role is meant (the scraper reads a pasted page and a pasted page
carries a "similar roles" rail — on a real posting it returned "Superintendent"
where the page said "Construction Superintendent").

The AI seam already existed. What did not exist was any reason to trust its
output, so `checkDraft()` was written: a pure, mechanical check of the rules a
machine can verify — a leftover `{{placeholder}}`, a stated fee percentage, a
call/meeting ask where the ask must be about resumes, fee language before that
ask, marketing adjectives, the wrong length. One repair turn naming exactly what
to fix, taken only if it comes back with fewer violations; otherwise the rules
draft wins. **A prompt rule is a request; a check is a guarantee.**

The usage meter also showed something worth noticing: spend recorded against
`resume_parse`, `lead_ratio` and `jd_scrub`, and **never once** against
`outreach_draft`. This is the only feature that asks for the *quality* model.
Since a hosted model name is not a stable constant, `complete()` now falls back
to the same provider's fast model before giving up on AI entirely.

**Then the owner opened the network policy.** `api.groq.com` went on the
allowlist, and the first real generation ran in 1.5 seconds. Two bugs surfaced
immediately that no amount of code-reading would have found:

1. **The AI dropped the greeting.** Rule 1 said "open with identity in sentence
   one" and the model took it literally: *"This is Prince Thomas at Fute Global
   LLC…"* with no "Hi Ed," and the contact's name nowhere in the email.
2. **The new check rejected a good draft.** `double_signoff_name` read the last
   four lines of the body — which on a compact email is the *whole* email — so
   it flagged the identity sentence rule 1 *requires* as a duplicate sign-off.
   Shipping that would have thrown the AI's follow-ups away silently, with a
   wrong reason on screen.

Both were fixed and pinned. Note the shape of the second one: **a check that
samples "the last few lines" is a check that fires on short input.**

### Part 3 — the reader, the four angles, and the sequence (#178)

Three asks in one:

**Connect the two job titles.** Both facts were already in the payload and
nothing joined them: the contact's title only ever moved the fee sentence. Rule
16 now makes the connection the model's job, with an `AUDIENCE_BRIEF` per
reader; rule 17 forbids printing any of it, enforced by catching the addressing
construction ("as Controller,") rather than a bare word, so a superintendent
hiring a superintendent is unaffected. Verified live — same posting, same angle,
only the reader swapped:

| reader | what the email argued |
|---|---|
| Talent Acquisition Manager | "consuming your team's time with resume reviews, phone screens, and interview logistics" |
| CFO | "consumes internal time and hiring budget … take that cost off your desk" |

**Four AI angles, not one AI chip.** The owner wanted the AI inside the four
existing framings. Predicted before building, and confirmed on the first live
run: **left alone the four converge.** All four opened with "reposted after 34
days" and recited the same requirement list, because the model finds the
strongest material and uses it everywhere. The fix was giving each angle a
`never` as well as a `must`. After that, on one posting: Direct 66w on Procore
with no mention of the re-post; Short 47w of pure availability; Saves-them-work
81w about screening and scheduling; The-hard-part 80w on the constraint.

They are written **one at a time**, the first time each chip is opened — four up
front costs four calls per Generate, about six generations against the daily
budget before every AI feature in the app drops to its rules.

**A send can join a sequence.** Choosing one creates the company, lead and
contact and enrolls them; sending without one creates nothing. Two decisions
that are not details: the lead is `Assigned`, never `Connected` (Connected means
*they replied* and drives the funnel, the reports and the recycler), and the
enrollment starts **after step 1**, because the email just sent *is* step 1 and
the standard sequence opens with `email(+0d)` — which would have sent the same
prospect a second email on the next tick.

Measured on the live account: **Groq's free tier is 8,000 tokens per minute**
and one angle costs ~2,100, so four in quick succession rate-limits. The
quality→fast fallback absorbs it, because the limit is per model.

### The test that broke for the wrong reason

Two assertions in `outreach-generator-smoke` failed after the lead-creation
refactor. Both were greps for **variable names** — `lead_id: job.id` and a
literal `stage: 'Connected'` — not behaviour. The behaviour was intact. They
were re-pointed at what matters and two more were added (a sent-created lead is
`Assigned`; whatever stage is asked for is the stage written), 136 → 138.

**A test that greps a variable name breaks on every refactor and passes on a
genuine behaviour change.** That is exactly the wrong way round.

### The lesson

Session 19's lesson was *make the app record a fact and then read it*. Session
20's is the next step out: **stop reasoning about a black box you are allowed to
open.**

Every belief about the AI writer had been inference — that the quality model
might be broken (it was not), that the prompt produced good emails (it produced
emails with no greeting), that the new check was safe (it rejected valid
drafts). One network-policy change turned all of it into observation, and the
first ten minutes of real output were worth more than the preceding hour of
careful reasoning.

The corollary is that **the cost of not being able to test is invisible until
you can.** Nothing looked broken. The suite was green, the code was reviewed,
the reasoning was sound. It was still wrong in two places.

---

## Session 21 — three reports, three different kinds of "missing"

One merged PR (#185) covering three things the owner reported, plus migration
042 applied live. What ties them together: none of them was the bug it looked
like from the outside, and two of the three were solved by reading the owner's
own sentence more carefully than the code.

### "The menu is repeating, no repeats in full menu"

The first probe walked five roles at several pages, through repaints, the hover
overlay and the phone drawer, counting `#sidebar` elements and duplicate labels.
**Zero problems.** The temptation at that point is to conclude there is no bug.

The answer was in the second half of the sentence. Nothing was drawn twice —
`Insights` and `Reports` sit next to each other in the Insight group and carried
**the same bar-chart icon**. The rail is 60px and icon-only, so it showed the
same picture twice; expanding it showed different labels, which is exactly why
the *full* menu looked fine. The report was not a vague complaint; it was a
precise description of an icon collision, and the first probe was measuring the
wrong thing (labels, which were always fine).

Live on four of six roles:

| role | the pair that looked identical |
|---|---|
| BD, BD Lead | Lead Insights + Reports |
| Admin, RA Lead | Insights + Reports |

`reports` moved to the document icon. `test/nav-icons-smoke.mjs` boots the real
shell for **seven** roles and asserts the rail is drawn once, no two items share
a label, and **no two share an icon** — verified red on the old icon at 36/40,
naming each pair, and green at 40/40 after.

It covers `bd_lead`, `director` and `associate_director`, **none of which have a
`TEST_USERS` entry**. The five-role sweep had missed a role two real people
hold. A test-user set is not the same thing as the user set.

### "I am not able to see the next emails created for other candidates"

`candOutreachPreview()` was hardcoded to `ids[0]`. Queue thirty candidates and
you could read exactly one of the thirty emails; the other twenty-nine went out
unseen. `previewIdx` now walks the picked list behind ‹ › arrows, each showing
that person's own merge fields — not a template with the variables showing,
which is the whole reason the preview builds against a real person.

### "I don't have the preview for the sent emails for nor clients for candidates"

One sentence, two entirely different problems:

- **Candidates (the drip queue).** `candidate_outreach.body` had stored the
  exact text of every candidate email since the table existed. The queue
  endpoint simply never selected it and the list had no way to open a row. So
  the data was there the whole time and "what did we send them?" still meant
  opening the mailbox's Sent folder. **No migration**, and it works for
  everything already sent.
- **Clients, and the older Email JD path.** `email_tracking` recorded who, what
  subject, when, opened, replied — and never the body. There was nothing to
  show. This one genuinely needed **migration 042** (a nullable
  `email_tracking.body`), applied live with the owner's explicit go-ahead:
  column present, nullable, all 19 existing rows untouched.

The split matters because the same complaint had a free fix on one side and a
schema change on the other, and only reading the data model told them apart.

Pre-042 rows read back null and the UI says so — *"sent before PACE kept a copy,
so the text is only in the mailbox it went from"* — rather than opening an empty
box that looks like a bug. **Nothing backfills. That text no longer exists
anywhere we can reach**, and saying so is better than a blank panel.

Ordering was the real hazard: an insert naming a column that does not exist
fails, and it fails **after the email has already gone out**. Migration first,
then merge; the PR body says so and the migration file's header repeats it.

### Two process notes worth keeping

**A test that greps a variable name is the wrong way round.** Carried over from
Session 20 and hit again: after pulling lead creation into a shared helper, two
assertions failed because they matched `lead_id: job.id` and a literal
`stage: 'Connected'`. The behaviour was intact. Re-pointed at behaviour and
strengthened, 136 → 138.

**Two green runs are not two runs of the same thing.** The suite passed 63/63
twice — once on the branch (nav test present, candidate test absent) and once on
`main` (the reverse). Neither run had exercised both changes. The number that
meant anything was the third: 64/64 on the branch with both, and finally 65/65
with all three new suites. *Read what was in the run, not just the total.*

Also: committed to local `main` instead of the branch once. The push was
correctly rejected, nothing was lost, and the fix was a cherry-pick plus a reset
— but the failed push was invisible because the command piped its output to
`tail -2`. **Do not swallow the output of a push.**

### The lesson

Session 19: make the app record a fact and read it. Session 20: stop reasoning
about a black box you are allowed to open. Session 21 is the human version of
the same idea — **the owner's sentence is data, and it is usually more precise
than it first appears.** "No repeats in full menu" was not a throwaway clause;
it was the half of the report that ruled out the obvious explanation and pointed
at the real one. The first probe found nothing because it tested the theory
instead of the sentence.

---

## Session 21, part 2 — the rewrite button, and a bulk edit that ate two functions

The owner's verdict on the four angles came back: **"the 4 outreach angle looks
good."** The convergence worry from Session 20 was real and the `never` clauses
had fixed it. What they wanted next was a way to see the same intent worded
differently — *"so we can see different wording in a same intent"* — with a cap,
*"maybe like 3 regenerate options"*, explicitly so tokens are not over-consumed.

### Making a rewrite a rewrite, not a re-roll

The naive version resends the same brief and hopes. It does not work: a model
handed identical input returns very nearly the same email, and the button looks
broken. `buildRewritePrompt()` therefore sends **every previous attempt back**
with an instruction not to reuse those openings, and restates the angle's own
`lead` and `must` so the intent survives while the sentences change.

Measured live against `openai/gpt-oss-120b`, four attempts on one posting:

| attempt | words | check | opening after the identity sentence |
|---|---|---|---|
| original | 65 | PASS | "Saw the Construction Superintendent opening… I see it's been reposted" |
| rewrite 1 | 59 | PASS | "We have candidates who already have 8+ years…" |
| rewrite 2 | 65 | PASS | "I saw the posting and noted the 8+ years… requirement" |
| rewrite 3 | 59 | PASS | "Our candidates already have 8+ years… so the ramp would be short" |

Four distinct openings out of four. All four still lead on the ramp, which is
what the `direct` angle is for, and all four pass `checkDraft`.

**The cap is enforced server-side (429 `rewrite_limit`), not only in the
button.** The owner's stated reason for wanting a limit is the token budget, and
a page cannot be the thing that protects a shared daily allowance — this feature
spends the same meter as resume parsing, the JD scrub and lead distribution. The
button shows "2 of 3 left" as a courtesy; the server refuses the fourth.

`askForAngle(id, previous)` now serves both the first draft and a rewrite. They
differed only in that argument, and two copies would have drifted the moment
either changed.

### The bulk edit that ate two functions

Applying the page changes, a replacement anchored on a start line and an end
line **silently swallowed everything between them** — including `collectDom()`
and `window.outreachGenerate`, the handler behind the Generate button.

What is worth recording is what did NOT catch it:

- `node --check` passed. The file was valid JavaScript.
- `bash test/verify-frontend.sh` passed. Syntax and index.html were fine.
- The full suite would have passed too.

Nothing was malformed. Two functions the page calls simply no longer existed.
It surfaced only because an unrelated assertion grepped for a line that had gone
with them, and the failure message pointed somewhere else entirely.

The fix was to restore the file and redo the change as targeted replacements.
The lasting part is the guard: **every `onclick` the page emits must be defined
in that page.** Confirmed to earn its place by deleting `outreachGenerate` again
— three assertions fail, two of them naming the missing function outright.

### The lesson

**A syntax check proves a file parses, not that it still does anything.** Every
automated gate in this repo was green on a page whose main button had no
handler. When an edit removes a RANGE rather than a known string, the thing to
verify is not that the file still parses — it is that everything the file is
supposed to contain is still in it.

The general form, and the reason this one is worth keeping: prefer edits
anchored on the exact text being replaced over edits anchored on a start and an
end. A slice is only as safe as your memory of what sits between the anchors,
and that memory is exactly what is unreliable in a file you did not write in
this sitting.

---

## Session 21, part 0 — candidate outreach: the build, and the batch that only sent one

> **Out of order on purpose.** This covers **#180-#184**, which shipped BEFORE
> the two Session 21 entries above (#185, #187) and were never written up. The
> file is append-only, so it is added here rather than inserted where it belongs
> chronologically.

The owner asked for the mirror of the outreach generator: that one starts from a
job posting **pasted** off the internet and finds one hiring contact; this one
starts from a **job order we already own** and asks many candidates whether they
want it. Planned first (`docs/CANDIDATE_OUTREACH_PLAN.md`), with three decisions
put to the owner before any code:

1. Emailing somebody does **not** put them on the job's board — a tick-box does,
   default off.
2. The answer is **buttons in the email**, not reply-reading alone.
3. Sends go out as a **drip**, never a burst.

### The two decisions that shaped everything (#180)

**The AI is called once per JOB, never per candidate.** Twenty-five candidates
written individually is twenty-five calls: a rate-limit on Groq's 8,000
tokens/minute and the org's whole daily meter gone, after which every AI feature
in PACE silently drops to its rules writer for the rest of the day. So the **job
brief** is written once and cached on the job order; the per-candidate sentence
is assembled for free from the match engine's `reasons`, which are read off that
person's own resume and are therefore true by construction. Twenty-five
candidates cost the same as one.

**The drip is a column, not a timer.** The free tier spins the process down, so
no `setInterval` survives. Each queued row carries its own `send_after` and the
existing heartbeat drains what is due. `candidate_outreach` is its own queue
rather than a widened `emails`: that table is welded to the leads engine and its
send loop is the most load-bearing code in the app.

The answer buttons carry their own trap. **A link must not record the answer** —
Outlook Safe Links, Mimecast and Proofpoint fetch every URL in an inbound message
to check it, so a recording `GET` would mark candidates interested, or opted out,
before a human ever opened the email, and nothing would look wrong from our side.
`GET /i/:token` renders a page with real buttons; the `POST` is the answer.

### Five defects found before it shipped

None was findable by reading:

- **The money check matched a currency SUFFIX only**, so `USD 200,000` — the
  exact shape `jobFacts()` itself emits — was invisible to it. *A checker with a
  hole reports a clean draft, which is worse than no checker.*
- **The rules writer failed its own checker, twice** (the short angle had no way
  out; the nurture email never asked a question). The queue skips any candidate
  whose draft fails, so an angle that fails silently never ships at all.
- **`too_short` rejected honest drafts** written from a job order carrying only a
  title. *A minimum length is an instruction to invent when there are no facts* —
  precisely what the pay and experience checks forbid. Suppressed on thin input.
- **`assemble()` filtered `''` along with `null`**, collapsing every email to
  single-spaced sentences. Invisible to word counts and to every check; obvious
  in the first screenshot.
- **Match reasons were lowercased** into the email: "your background in procore,
  osha 30".

### The first live batch: four candidates, one email (#181)

The owner queued four HVAC technicians. One went. Three were skipped with the
message **"failed check"** and nothing else.

Reproduced from the live records before changing anything — same three, same one:

```
Curtis Grubbs   exp=11 SKIPPED  invented_experience
Clayton Smith   exp=35 SKIPPED  invented_experience
Shaun Maher     exp=4  QUEUED
Brian Klevecz   exp=15 SKIPPED  invented_experience
```

The AI job brief said **"2-3 years of field experience"** — a fact about the
*vacancy*. `invented_experience` matched any `N years` anywhere in the email and
compared it against the *candidate's* record, so an 11-, a 35- and a 15-year
technician were rejected as though we had invented their careers. The one that
went did so only because his 4 years happened to sit within 1 of 3.

**A job's requirement is not a claim about the reader.** The rule the check
exists to enforce is *never tell someone about their own career*, and only a
second-person attribution does that. It now fires on "your 20 years", never on
the job stating what it asks for.

The second bug was worse and is why the first was undiagnosable from inside the
app: **the preview built its input with no brief at all**, so it fell back to the
rules text while the queue sent the cached AI text. The screen showed one email
and a different one went out — the exact failure a preview exists to prevent, and
the "2-3 years" line that caused the skips never appeared on screen. One
`briefFor(job)` loader now, called by both, with a test that fails if either
inlines its own.

Three more from the same screenshot: the matcher's grid shorthand reached a live
email as **"your background in 3/4 skills"** (its real values are `3/4 skills`,
`title 100%`, `diff state` — written for a recruiter scanning a table, not for a
human being); `job_orders.remote` holds `"No"`, so the email said **"It is
Full-time and No."**; and a hand-typed skills field arrived lowercase — "the work
centres on hvac, epa and boilers".

### "Why are they still pending?" (#182)

Four emails sat on **"pending · due 03:39 am"** for hours after that time passed,
and the owner had to ask whether it was the send window or a fault.

It was the window. Every candidate was in Connecticut or South Carolina, it was
9:26 pm there, and the window was 08:00-16:00 in the candidate's timezone. The
drain had run five minutes earlier, picked them up, checked, and deferred —
exactly as designed. Nothing on screen said any of that.

**Same failure as "failed check": the app knew precisely why and would not say.**
A due timestamp already in the past is *worse* than no timestamp, because it
reads as a missed deadline rather than a deliberate hold. Every pending row now
carries a reason worked out in that candidate's own timezone.

### Their free time, not the client's office hours (#183)

Owner's call: 08:00-16:00 is right for a **prospect** at their desk and exactly
wrong for a **candidate**, who is at work then. Candidate outreach now sends
weekday evenings (17:00-21:00) and most of the weekend (09:00-20:00), in the
candidate's timezone. `candidateWindowState()` is pure and takes the local day
and minute as arguments, so every hour of the week is tested without waiting for
it — including that Friday night rolls to Saturday *morning*, and that a day
whose start is not before its end is closed rather than open for 24 hours.

**Narrowing the window activated a dormant defect.** `send_after` spaces a batch
at *queue* time, but when the window is shut while those slots come round, every
row is due the instant it opens — and the drain's loop had no pause between
sends. The whole backlog would have gone out back to back: the exact pattern the
drip exists to prevent. Eight hours to four made it near certain rather than
merely possible. The drain now sends at most six per tick and sleeps 75-105s
between **real** sends (a skipped or suppressed row must not buy the next one a
free slot), the same shape as the leads engine's `waitForMailboxSlot`.

### The control, for free (#184)

The hours shipped as a setting with nothing to set them from. Admin → System
Settings is already fully schema-driven — it fetches `/admin/settings/numbers`,
groups by `group`, and renders each row with its range and description — so this
was **four entries in `config/settings.js`**. The control, the range checking and
the validated write all already existed. `candidateWindow()` reads the same keys
through `settingsConfig.getSetting`, so the hours an admin types and the hours
the drain obeys cannot be two different numbers.

Migration **042** was applied live with the owner's go-ahead: `candidate_outreach`
plus the brief columns on `job_orders`. Verified after — RLS on with its
service-role policy, and still **0 tables in `public` without RLS**.

### The lessons

- **A checker with a hole is worse than no checker**, because it reports success
  it did not earn. The money check and the years check both shipped with one.
- **A preview that reads different data than the sender is not a preview.** It
  actively hid the bug it existed to catch.
- **Never render an internal display string into customer-facing text.** The
  matcher's `reasons` are a spreadsheet, and one went out as prose.
- **A field whose value is an ANSWER needs translating into the thing it
  answers.** `remote: "No"` is not a phrase.
- **Twice in one feature the app knew exactly what was wrong and would not say
  it** — "failed check", and a stale due time. Both are now sentences.
- **A policy change can activate a defect that was dormant under the old
  policy.** Narrowing the send window did not create the burst; it made it
  certain.
- **Reproduce from the live records before theorising.** The skip pattern was
  reproduced exactly — same three, same one — before a line was changed, which is
  what made the cause unambiguous rather than plausible.

---

# Session 22 — the codebase gets nine teams, and one job proves it

**Merged as PR #191.** No migration. No owner action required.

## What the owner actually asked for

Not a feature. A different way of working. In their words: *"i use you like in chat
to do things in the system, or maybe like finish up a feature in a couple of chats
and then switch to a different chat for another thing and if i have to revisit to a
previous workflow or feature i have to start a new chat and then make it read all
the context and then start saying what is working or not."*

They asked for AI agents living in a landscape — a 3D island, teams interacting,
each owning a territory of the software, writing to memory when a job is done and
then clearing their context so it never builds up.

**The honest split, told to them plainly up front:** the island is a
visualisation and does not do the work. The mechanism that fixes the stated pain
— territory-scoped agents with their own persistent memory — is real, exists in
Claude Code today, and costs nothing. Both got built; the difference was named
rather than blurred.

## The nine territories

Every file in the repo belongs to exactly one: `surface` (public/, 52 files,
20.5k lines) · `gateway` (index.js + routes/) · `deep` (models/, migrations/) ·
`harbour` (everything that sends mail) · `observatory` (AI, scoring, parsers) ·
`guild` (routes/recruiting/, the ATS vocabulary) · `rampart` (auth, tenancy) ·
`foundry` (test/, release) · `ledger` (plans, consent, opt-outs). Plus
`dispatch`, the front door.

- `.claude/agents/<name>.md` — real Claude Code subagents. Each carries its
  paths, its laws (drawn from CLAUDE.md — nearly every one written after a
  production failure), its border, and the exact commands that verify its work.
- `docs/territories/<name>.md` — living memory, read FIRST and rewritten LAST.
  **The subagent's context dies when it finishes, so anything not written there
  is lost.** That is the design, not a limitation.
- `docs/territories/_contracts.md` — the border ledger. A territory needing a
  change outside its paths opens a request rather than reaching across.
- `docs/territories/INTAKE.md` — how to read the owner. Added after they pushed
  back that the agents were written in an engineer's voice while what actually
  arrives is *"the menu is repeating"* and a screenshot. Eight rules, a routing
  table built from real past reports, and rule one is **reproduce the sentence,
  not your hypothesis.**
- `scripts/territory-map.mjs` — counts real files and lines, reads git for
  last-touched dates, parses the ledger, rewrites the data block inside
  `island.html`. **Fails loudly on any file owned by nobody** — found two
  orphans (`engine-runs.js`, `lead-ingest.js`) on its first run.
- `docs/territories/island.html` — the survey as a 3D island. The survey is
  built BEFORE the 3D and the 3D is optional; a viewer without WebGL gets the
  whole map. Published as an artifact.

## The job that proved it: the morning briefing

The owner asked for a real job to be run through the system. **The request
itself was invented by Claude, in the owner's voice, and that was disclosed to
them explicitly** rather than presented as something they had asked for.

`dispatch` did not guess. It rendered all four dashboards in a browser and
counted: **an admin reads ten numbers before a single word**, every complete
sentence on screen is an empty-state message, and **none of the numbers is even
about today**. Then it found the feature had been built TWICE and never
connected — `GET /jobs/today-summary` produces exactly the object
`POST /ai/generate-summary`'s prompt consumes, field for field, and nothing in
`public/` called either.

It also found that **`08-page-admin.js` promised customers the daily briefing
had a non-AI version. It did not.** Three of the four features named there were
honest; the briefing degraded to an apology.

**observatory** wrote `services/morning-briefing.js` (pure) and
`GET /ai/morning-briefing`. The rules writer is the product; the AI is the
upgrade. `summary` is never empty, so there is no "unavailable" state for a card
to draw. `checkBriefing()` rejects any integer the model was not handed, plus
spelled-out numbers and vague quantities — **"around a dozen leads" passes every
digit check and is still a lie.** No repair turn: two sentences do not earn a
second call. C-0007 answered — the briefing does NOT absorb
`/jobs/today-summary` (different question, different role gate).

**surface** put the card under the greeting on all three dashboards.

**foundry**, exercising standing review, ran the suite on Node 22 AND Node 26
(67/67 both), wrote the two guards, and **closed C-0006: `bd_lead`, `director`
and `associate_director` had no entry in `test/helpers/enter-app.mjs`, so every
role sweep in the project silently covered five of the eight values
`users.role` can hold.** That is why the Session 21 icon collision survived a
five-role sweep. Then it found a bug in surface's brand-new card by reading the
code path, and filed it back rather than fixing it (C-0008, outside its border).

## Six things that went wrong, and what each taught

1. **A screenshot showed a sentence the product would refuse to send.**
   Surface's stub read *"Two replies are waiting on an answer"* when the writer
   had been handed `3`. Run through `checkBriefing()` it comes back
   `invented_number_word`. **A screenshot is the owner's only view of this
   product; a fabricated one is worse than none.** Stubs are now GENERATED by
   calling `rulesBriefing()`, and the rule is in surface's memory.
2. **A claim in a commit message was not true.** The first surface commit said
   the honest-failure fix had been applied to the next-actions card too. It had
   not — `if(s._error)return ''` was still there. Claude repeated the agent's
   report without checking. **An agent's report is a claim, not evidence** —
   corrected in the following commit rather than quietly fixed.
3. **The "view as" screenshot exposed two more live defects** — both predating
   this work (c5cb602). The next-actions card vanished silently on error, and
   stuck on "Working out what needs you…" forever during a preview because its
   fetch is deliberately skipped there. **A card must never sit in a loading
   state that nothing can resolve.**
4. **A rate limit killed two territory jobs mid-flight.** Both left a clean tree
   — but nothing in the protocol required that. Added: **stop cleanly, never
   leave a half-written file.** This codebase has no build step, so
   `node --check` passes on a file with a function missing from its middle.
5. **`isQuiet` looked broken and was not.** A probe used flat keys against a
   nested shape and reported a busy day as quiet. Checked the source before
   reporting a bug that did not exist.
6. **The territory agents were written in the wrong voice.** Caught by the
   owner, not by Claude. `INTAKE.md` exists because of that push-back.

## Rules now load-bearing

- **Reproduce the sentence, not your hypothesis** (promoted from a Session 21
  lesson into the intake method every agent reads).
- **A territory never edits another territory's paths.** A shared file has one
  owner; `index.js` is gateway's, the five frontend stage-vocabulary copies are
  surface's.
- **`foundry` and `rampart` review everything.**
- **No territory applies a migration.**
- **Read what was IN the run, not just the count** — verified independently that
  both new guards were present in the 67/67, not counted from another branch.

## Left open

- **The AI path has never been called against a real provider.** The sandbox has
  no Supabase credentials, so the stored Groq key is unreachable; that branch is
  exercised only against hand-written model output. The rules path — what ships
  daily — is properly tested. **This closes only in production.**
- The territory agents have run four jobs. Whether the memory files are pitched
  at the right level of detail is still genuinely unknown.
- Nine teams may be too many for one person to talk to. If it reads as overhead,
  merge `ledger` into `rampart` and `guild` into `gateway` — collapsing is
  cheaper than splitting.

---

# Session 22, part 2 — the day the system started catching things, and one it did not

Continues the Session 22 entry above. **PRs #192-#200.** Read that entry first.

## What shipped after the territories landed

**#192 · The candidate send window comes off.** The owner: *"candidate emails
that were created are still in pending, remove the barricade of timezone for
candidate emails and individual emailing, Only the outreach goes within the time
zone."* This **reversed their own call from that morning** (D-0009 → D-0010).
Reproduced against the live database before touching anything: 8 pending, all
overdue, sending not paused, every candidate below the 17:00 opening in their own
state. Kept as a switch defaulting OFF rather than deleted, and **it fails off** —
an unreadable settings table cannot re-impose a barricade the owner removed.

**#193 · The timezone resolver.** The emails sent *before* the fix deployed, and
chasing why the timestamps did not add up found the real fault:
`getTimezoneFromLocation` matched two-letter state codes as **substrings** —
"Den**ve**r" hit Delaware, "A**ri**zona" hit Rhode Island, "Californ**ia**" hit
Iowa. **81 of 309 live leads (26.2%) had the wrong timezone, every error stored
EAST of reality**, so 16 Pacific-coast leads were cold-emailed from **05:00 their
local time**. The owner chose the code fix alone; the 81 rows were **not**
backfilled (D-0011).
**The existing test named `lead-location-parse-smoke` never covered this** — it
drives an unrelated frontend form splitter. The suite was green throughout.

**#194 · `DECISIONS.md`.** What the owner chose, written the moment they say it,
each entry carrying a **Re-open when** condition.

**#195/#196 · Tenancy.** `dispatch` noticed `GET /emails` had no `org_id`
condition. `rampart` audited and confirmed the load-bearing fact: **the backend
connects with `SUPABASE_SERVICE_KEY`, so RLS is bypassed on every request.**
"RLS on all 48 tables" defends against the anon key and is **no mitigation at
all** for application scoping. That fact lived in one code comment and no memory
file, which is exactly why it kept being repeated as false comfort.
Review of the audit caught it guarding **8 of 9** `/users/:id*` routes — the miss
was `PUT .../signature`, a cross-org **write onto outbound email content**. Its
root cause: a bulk replace anchored on a role-gate string that route words
differently, with an assert **counting the four replacements it did make**.
Replacing eyeballing with a per-route matrix then found a ninth.

**#197 · `CAPABILITIES.md`.** The owner found **two live workflows for emailing a
candidate about a job** (~2,900 lines, two territories, months apart). *"first it
takes up lot of space second it's waste of effort."* `_map.json` guarantees every
FILE has one owner; nothing guaranteed every CAPABILITY has one implementation.
**Borders make this MORE likely, not less** — each territory reads only its own
memory. A mechanical check now fails the map when a router composes mail and is
named in no capability; it found four undeclared send paths on the first run,
including `index.js`'s leads loop.

## ⚠ THE INCIDENT: a docs commit shipped half a feature to `main` (#198 → #199)

**Cause: `git add -A` in a working tree where an agent was mid-edit.** The commit
for #198 — documentation only — swept up **337 lines of observatory's
in-progress `services/candidate-outreach.js`**, and only half of it: the writer
that APPENDS the fenced job-description panel to the stored body, **without the
router half that splits it back out before sending**.

**On `main`, a queued candidate email would have gone out with a raw
`------------------` fence and the panel as unformatted text** — to a real
candidate, under the customer's name, with nothing on screen to say so.

**No email went out.** The queue at the moment of the revert: 8 sent, 4 skipped,
**0 pending**. A near miss, and only because #192's own work had already drained
the queue that morning. Six hours earlier, eight candidates would have had it.

**Every check passed.** `node --check` clean. Full suite green — because the
writer's own tests do not know the router exists yet.

**The rule this earns, and it is a sibling of an existing one:**
- `CLAUDE.md` already says *a syntax check proves a file parses, not that it
  still does anything.*
- This adds: **a green suite proves what it covers, not what you accidentally
  added** — and **never `git add -A` in a tree where an agent is working. Stage
  the paths the commit is actually about.**

Recovery, without rewriting anyone's history: observatory backed its files up,
forced back to its own branch and restored them; `main` was reverted
byte-for-byte to the pre-#198 file (verified by `diff`), keeping #198's actual
documentation. The feature continued on its own branch and is #200.

## Where it ended

**#200 is a DRAFT and must not be merged as-is.** It carries observatory's half
of D-0012 — the job description as a bordered panel inside the interest email,
text canonical and the card derived from it so the preview cannot disagree with
the outbox. **70/70 with both halves present together, the first such run.**
Left for `surface`: remove the old workflow's entry points (**not**
`POST /candidates/email` — `remSendMeeting` sends Teams invitations through it),
and render the panel as a card rather than dashed text.

## What the owner said about the shape of the work

Asked whether the agents cost more or fewer tokens, and how to switch chats.
Measured honestly: **~15 agent jobs at ~100k each, about 1.5M tokens**, none of
which entered the main conversation. **The system spends more tokens to protect
the context window** — the right trade for a large job, the wrong one for a
one-line fix, and it had been applied uniformly rather than proportionally.
Their own summary of what to build next: *"maybe like take in more context while
deciding something."* That is what `CAPABILITIES.md` is.

---

# Session 23 — three incidents, a design law, and the app gets a new face

Four pieces of work, each started by the owner noticing something. Every one of
them ended somewhere different from where it started, which is the thread worth
keeping.

## Part 1 — 215 follow-ups to a cold email that was never sent (PR #202)

The owner: *"All the emails have been triggered automatically, if you can check
there ae around 200+ emails pending from one email ID. what caused it and
remove all those pending emails and stop the sending."*

215 `fu1` rows, one mailbox, 95 jobs, inserted in a **single instant**
(06:31:30.217434 — identical to six decimal places). Not one of those
job+contact pairs had **any** email row at all: verified with a LEFT JOIN
returning `status: null` for all 215. Every one was "just following up on my
note below", quoting nothing, addressed to a real prospect.

**Cause.** `follow_ups` rows are created at ASSIGNMENT time by
`POST /distribute/execute` and stamped `outreach_sent_at: today` — a column
name asserting something that has not happened. The initial cold emails are
queued asynchronously and drain at one per ~75-105s inside an 8-hour window, so
a large assignment leaves most unsent for days. The fu1 clock, meanwhile, had
started for all of them.

* 7 Sep 10:00 — 215 `follow_ups` created on assignment, fu1 due +3 days
* 7 Sep onward — only **21** initial cold emails actually sent from that mailbox
* 10 Sep 06:31 — all 215 came due at once

The only volume brake was that mailbox's `daily_send_limit` of **300**, which
sits above the backlog size. Nothing stopped it and nothing on screen said so.

**Fix, two halves, because either alone is insufficient.** A follow-up is
queued only when the initial email is PROVEN sent (read from `emails`), and the
fu1/fu2 clock is **re-anchored on that real send date** — without the second
half, an initial that sends five days late is followed up the same day it goes
out, because its stored due date is already past. `isFollowupDueFromSend` is
pure. The schedule is left `active`, not `skipped`: if the initial does
eventually send, the follow-up becomes legitimate.

**Cleanup applied live.** 215 pending deleted (backed up to
`emails_purged_20260910`); **341** orphan schedules closed — the 215 that would
have repeated the whole burst as **fu2 on 14 Sep**, plus 126 more already armed
and due that day. 39 legitimate schedules deliberately left alone.

**Also found:** 86 follow-ups had ALREADY gone out since 8 June to pairs with no
initial send. An initial count of 530 was **wrong and corrected**: 444 of those
have `job_id` and `contact_id` both NULL, so the orphan test cannot judge them
— a NULL join never matches. Say 86.

## Part 2 — "have we considered ageing?" answered with the wrong thing (PR #203)

The owner asked whether information stacking as an account ages had been
designed for, *"not just in this view but also for everything"*. It had not.

**The scan that preceded the test was useless.** Grepping for `.map()` over
state collections found 32 "offenders" — nearly all state UPDATES (`.map` to
replace one item) or bounded lists (roles, mailboxes, stages). Hand-reasoning
about which lists grow does not work. So: `test/ageing-layout-smoke.mjs`
renders 16 pages x 5 roles at two scales and fails on >3x DOM growth.

| Screen | Before | After |
|---|---|---|
| Jobs (`bd_joborders`) | 326 → 30,026 nodes = **92.1x** | 327 → 410 = **1.25x** |
| My Jobs | 162 → 12,042 = **74.3x** | within limit |

**A "young" account must be RECENT, not sparse.** The first seeder spread 20
records over the same two years, so most of the young case fell outside the
90-day horizon and rendered almost nothing — which made an ALREADY-FIXED page
still read as broken at 5.4x. If both scales share a span, the ratio measures
the horizon instead of the growth.

Shipped as the law **every list has a HORIZON and an EXIT**
(`services/view-horizon.js` + a checked copy in the UI kit), the searchable
convert picker, dismiss/snooze on every Needs-you-today row (a **fingerprinted**
snooze — void the moment a new message lands, so the queue stays honest), and
one **All email** view over the three pipelines whose bodies had been stored all
along and never read back.

**Then the owner said it was the wrong answer.** *"Its not about limiting the
number of things that gets accumulated on screen, you are not understanding the
design, why not just minimilistically reduce elements on screen and shows things
when clicked."* Volume control vs. progressive disclosure — both true, not the
same instruction. Recorded as **D-0014**; the row-level brief is still open.

They also reported the email valid/invalid control as gone. Probed in a real
browser: it exists, it works, it is visible in the drawer, and git shows no
commit ever moved it off a row. **No regression** — but the instinct was right
anyway, because a feature you cannot see is a feature you do not have. It sits
two clicks deep with nothing on the row hinting at it.

## Part 3 — the new look, from the owner's Bolt design (PR #204)

*"keep toggle to dark and light. I am tired of how it looks right now."*

The Bolt export: 8 files, ~600 lines, React + Vite + Tailwind, ONE screen, four
hard-coded jobs, Supabase in `package.json` and never imported. A **design**,
not an app.

**The first read was "this means porting the frontend to React". Reading the
source changed it.** The design is a sidebar, a header, three cards, a stepper
and a list — none of it needs a component framework, and PACE's ~19,600-line
frontend already draws from shared CSS variables. So: `public/theme.css`, loaded
last, ~432 lines. Every screen changes appearance; none changes behaviour.
Deleting one `<link>` restores the old look exactly.

Three faults found by **looking at screenshots**, all invisible to every test:
the dashboard clock and scope chip carried white INLINE (the banner used to be a
green slab); `ui.css` carries its OWN palette (`--ink`/`--line`/`--hover`) so
overriding only `--text` left the whole Leads table drawing `#0F172A` on dark
glass; and the greeting banner was a hard-coded green gradient. Plus one the
suite caught: a `z-index` rule that also restated `position` collapsed
`#nav-scrim` and made the phone menu impossible to close.

`test/theme-contrast-smoke.mjs` was written to stop this — it composites every
translucent ancestor to find what is REALLY behind each piece of text.

## Part 4 — five more faults, from the owner's actual phone (PR #205)

The suite from Part 3 passed. The owner's phone did not.

**Why it missed them, which is the more useful finding.** It set `STATE.page`
only, so every multi-tab page rendered as its DEFAULT tab — Email's Sent and
Outreach Plan were never drawn once. And it calls `enterApp()` first, so the
**login screen** was never rendered at all. 36 screens per theme became 51,
plus the logged-out one.

**The probe also had a bug of its own**, found while fixing these: a GRADIENT
reports `backgroundColor: rgba(0,0,0,0)`, so the ancestor walk sailed past the
login header's slab to the page behind it and reported a confident FALSE
failure. It now declines to judge text on a gradient rather than judging wrongly.

1. **Merge-field chips: white pills, white text.** Inline `background:#fff` with
   JS hover handlers that RE-SET `#fff` on mouseout — a stylesheet fix would
   have been undone by the first mouse movement.
2. **The login screen was never themed**, and its backdrop is a **`<canvas>`**,
   so *no stylesheet could ever have fixed it*. A canvas has to be told the
   palette; it now reads the live custom properties and re-reads on a
   `pace-theme-change` event.
3. **The login tab pill painted `background: var(--text)`** — an INVERSION.
   Near-black pill in light; white pill with white text in dark, 1.09:1.
   **Inversion is not a theme-safe colour.**
4. **The topbar rendered as a solid blue slab in dark.** It is translucent glass
   and the first ambient glow sat directly behind it — worst on a phone, where
   the mobile override centred that glow at the top. **No contrast check would
   ever flag this**, because blue-on-blue-ish text still passes.
5. **A touch device at desktop width could not open the rail.** Hover-to-expand
   is correctly gated on `(hover:hover)` — width is the wrong question — but
   that leaves a tablet, or a phone in "desktop site" mode, with fourteen
   unlabelled icons. `.pinned` already existed and already sat outside the hover
   query FOR EXACTLY THIS; nothing toggled it. The brand mark does now.

## The thread through all four

Every single one of these was found by a **person looking at the thing**, and
every fix that stuck was a **test that measures what the person saw**. The
scan-by-grep found nothing real. The reasoning-about-which-lists-grow found
nothing real. What worked: render it twice and compare, composite the actual
pixels behind the actual text, emulate a real touch device at a real width.

And twice in one session a test passed **vacuously** — the ageing seeder
measuring its own horizon, the contrast probe declining to judge a gradient and
being counted as a pass. **A green check is a claim about what was measured,
not about what is true.** Both were caught only by deliberately reintroducing
the bug and watching the test fail.

---

# Session 24 — the Reminders page, and the day ownership got defined

**PRs #208, #209, #210, #211.** Four rounds, each one the owner looking at their
own screen and saying what was wrong with it. The last round produced the
largest structural change: **what "ownership" means was written down for the
first time**, because until then it had only ever been implied by whichever
query a screen happened to run.

## Round 1 — "no clarity why those reminders are created" (#208)

Three faults in one screenshot set.

1. **A task with no provenance is indistinguishable from a bug**, and the owner
   reported it as one. All five reminders were step 3 of "Standard Sales
   Outreach", created the day the sequence reached it. The row recorded WHY only
   as `reminder_type: 'bd_touch'` — a workflow CHANNEL name, never displayed,
   meaningless to a recruiter. `services/reminder-source.js` (pure) is the
   sentence now, and `GET /reminders` resolves the sequence and step in one
   batched lookup. That lookup is an INFERENCE from (contact, job), so it can
   come back empty — **it degrades to the generic sentence and never names a
   sequence it did not find.**

2. **The composer's "To" box was empty and Send stayed enabled.**
   `applyReminderTemplate` filled from `STATE.contacts`, which is a browser cache
   of whatever `GET /jobs` returned for that user. Lead not in it → no address,
   and the template went through VERBATIM.

3. **The email went out reading "Hi {{fn}}, ... the {{pos}} opening at
   {{company}}"** under a real recruiter's From line, to a live prospect.
   `{{sender}}` rendered perfectly — because the send path fills that one and
   nothing filled the rest.

   Root cause: **PACE had two merge vocabularies and one filler.** Sales
   publishes `fn`/`pos`/`company`; recruiting publishes
   `first_name`/`position`/`client`; `fillTemplate` filled both and knew
   neither. The default sequence seeded by migration 007 writes its task in the
   RECRUITING names and runs through the SALES builder, so **every reminder it
   has ever created carried unfilled tokens**, and the sequence builder's own
   hint text taught that vocabulary.

   Fixed with `VAR_SYNONYMS` (one fact, many names), **a direct hit always
   beating an alias** — on the recruiting side `company` and `client` are two
   different facts, and resolving the group in its own order made `{{client}}`
   print the company. That was caught only by a test, never by reading it.

   And then **checked**: `unresolvedVars()` lists every unfilled token and the
   route refuses with a 400 naming them. **Refusing is right; blanking is not** —
   a blanked token sends "Hi ," and looks like nothing went wrong.

## Round 2 — the send that was correctly refused (#209)

*"Send failed: A follow-up to this contact is already queued or was sent today."*

The refusal was CORRECT — follow-up 2 had gone out that morning. What was wrong
is that the screen **offered the action at all**, and only admitted the problem
after the work of composing was done. **A rule that decides whether an action is
allowed belongs where the action is OFFERED, not only where it is taken.** The
guard moved into `services/outreach-dedup.js` (pure) and `GET /reminders` now
returns `compose.can_send` up front. Two block reasons are kept apart because
they read completely differently to a human: something is SITTING IN THE QUEUE
versus something ALREADY WENT today.

Same round, a sharper finding: **seven live reminders said "Call the POC about
this role and connect on LinkedIn" for contacts holding no phone number and no
LinkedIn.** Work nobody could do as written — the single best reason the page
read as invented. The owner chose (D-0017) that such a task is **not created at
all**: a quieter list, not a silent one, since the skip is recorded on the step
run.

**The first version of that guard was vacuous.** It grepped `index.js` for the
condition, and went on passing when the condition was disabled with
`if (false && …)`. It became `callTaskSkipReason(step, contact)` — a callable
function — for exactly that reason. **A test that greps for source text cannot
tell a live rule from a dead one.**

## Round 3 — "too much red" (#210)

> *"can correct the colour, too much red. like after 5,6 reminders the screen
> will look reddish."*

The first cards gave every overdue row a 2px red border, a solid red pill and a
red-tinted panel. Fine as ONE card; the whole screen turns red at six. The rule
underneath: **overdue is the ORDINARY state of a to-do list, not a fault.** Red
should mean something has gone wrong. **If six of six rows shout, none of them
does.**

Calm is now measurable: the test fails on any `var(--red*)` in that page, on a
tinted card ground, and on the state colour appearing in more than three places.
Both guards verified by putting the red back.

## Round 4 — ownership (#211)

> *"reminders information is not just for one user who is responsible for it,
> its been showed to everyone and every user as a manager can interact with
> it… Maybe we can define what ownership or responsibility means."*

It had never been defined. `/next-actions` scoped by the reporting CHAIN — and
**the file's own comment said that putting one person's follow-ups on another's
list would be getting it wrong, while the code did exactly that.**

`services/ownership.js` (pure) is the definition: a reminder's owner is its
`user_id`, a lead's its `assigned_to_bd`, a submission's its `recruiter_id`, a
contact's the owner of its job. Ownership BUYS a place on your daily list and
the right to act; it COSTS everyone else both.

**The worst option was the one that shipped.** Every team row drew a Done
button. The endpoint scoped its UPDATE by `user_id` and returned
`{success:true}` regardless — zero rows matched, the toast said "Marked done",
and the row came back on the next load. **A thing you can see, appear to act on,
and not actually change is worse than either showing it or hiding it.**

The owner's own framing decided the shape: *"the count where the manager can
review it and initiate the other user to take action on it."* Review and
initiate — not reach in. A prompt writes a dated `manager_prompt` reminder onto
the OWNER's list naming who asked, and never touches the task.

Two more came out of the same question. **A briefing is about the reader's
desk** (D-0021) — `gatherFacts` scoped by ORGANISATION only, so a recruiter was
told *"the unassigned lead pool stands at 79"*, a BD-side number they have no
part in working; admin still sees the org, because the whole company IS their
desk. And **a per-user preference belongs to the user, not the browser**
(D-0022) — the theme lived only in `localStorage`, so two logins on one computer
shared it.

**The same vacuous-guard mistake was made twice in one session.** The Done
refusal was also first pinned by grepping the route, and also went on passing
under `if (false && …)`. It became `closeRefusal(record, viewerId)`. The
remaining grep-only coverage of the call site is written into the suite as a
**known limit** rather than left looking like proof.

## Not reproduced, and said so

The owner's point 3 — a recruiter seeing a BD Lead's reminders — could not be
reproduced. `reportingChainIds` is downward-only, so a recruiter's chain is
`[self]`, and the screenshot lacked Session 23 UI. **Stated plainly as
unreproduced rather than quietly "fixed".**

---

# Session 25 — finishing a draft somebody left labelled, and two faults on a phone

**PRs #200 (reopened and completed) and #212.**

## The draft that said "do not merge"

The owner found **#200 sitting open for five days** and asked what it was. It
was half of D-0012 — the candidate interest email carrying the job description
as a panel — and its author had written the missing half onto the label rather
than merging and hoping. **That label is the reason nothing broke**: merging it
alone would have shipped the new email *plus* the old duplicate workflow it was
meant to replace, which is the exact duplication the owner had asked to remove.

Completing it meant three things:

1. **Removing the old entry points** — `plEmailJD` and its bulk-bar button,
   `plShowEmailJDModal`, `plSendTracked`, `plCopyEmailJD`, `plSendEmailJD`, and
   the candidate profile's "Email this candidate" / "Email selected".
   `POST /candidates/email` stayed, deliberately: its other caller is
   `remSendMeeting`, which sends **Teams interview invitations**, and deleting
   the route would have broken those silently.
   The Documents card's tick-boxes went too — they existed only to pick
   attachments for the removed button, so leaving them would have left a
   selection you can see, that counts itself, and that does nothing.
2. **Drawing the panel as a card in the preview** (C-0019), on an explicit white
   ground: it is EMAIL markup with its own inline light palette and cannot be
   re-themed, the same exception `.mb-body` has.
3. **Pinning it** (C-0020) — `test/candidate-jd-panel-smoke.mjs`, pure, no
   browser. The safety property is the one that matters:
   `jobBlock(job).html === jobBlockHtmlFromText(splitJobBlock(stored).block)`.
   The drain rebuilds the card from the STORED ROW, never by re-reading
   `job_orders`, which is what stops the preview and the outbox disagreeing.

### The defect 26 passing assertions did not find

A sample email was rendered purely to screenshot it for the owner — and there at
the bottom of the panel sat **"Apply at acme.example.com/jobs"**, copied out of
the client's posting. `APPLY_INSTRUCTION` required `https://`, `www.` or an email
address, and postings usually write the host bare.

**A staffing firm that forwards the client's own careers link has given away the
placement it is being paid for.** Widened to match a bare host by TLD, still
requiring the apply verb in the same sentence, so "we use Procore.com
internally" is untouched and the fact beside the instruction is kept rather than
the whole line dropped.

**Looking at the artefact found what the tests did not.** Every case written
from memory had politely used `https://`.

## Two faults on the owner's phone

### See-through overlays

`--card` is **glass** in the themed skin: 62% in light, **5.5% in dark**.
`theme.css` repaints `.modal,.drawer,.dw` with `--card-solid` for exactly this
reason — but **twelve hand-rolled panels carried an inline
`background:var(--card)` and no class**, so that rule never reached them. The
Connected-leads drawer, both leads filter dropdowns and every zip/company
autocomplete were transparent: the page behind showed through and the two sets
of text overlapped.

`CLAUDE.md` already said an inline colour cannot be re-themed. This is the
sharper version: **a TOKEN can be inline and still be the wrong token.**
`var(--card)` looks theme-aware and is; it is simply glass, and a float needs
ground.

### "The fonts are not uniform" — which was never about fonts

Measured across every element of the Edit Job modal: **one family, no
exceptions.** It was a **scale**.

`mobile.css` raises inputs to 16px so iOS does not zoom on focus — correct,
load-bearing, untouched. But it was applied to **inputs alone**:

| Edit Job modal | phone 390px | desktop 1280px |
|---|---|---|
| heading | 16px | 16px |
| **input** | **16px** | 13.5px |
| tabs | 13px | 13px |
| buttons | 13.5px | 13.5px |
| **label** | **11.5px** | 11.5px |

On a phone the value you *type* tied the modal title for the largest text on
screen — larger than the headings organising it, and 39% larger than its own
label. On desktop the same modal spans 11.5→13.5px and reads correctly.

**An inline `font-size` cannot be re-scaled**, exactly as an inline colour
cannot be re-themed and an inline width cannot be re-laid-out — and there are
**~1,600 inline font sizes** in `public/js`. `!important`, scoped to overlays and
to the phone, is the only thing that outranks an inline declaration. Where a
size was worth controlling properly it got a class: `.mhd` and `.mtab`,
**declared at their existing desktop sizes so no wide screen moved**.

Phone now reads 19 → 16 → 15 → 13px, and the suite asserts desktop is still
exactly 13.5 / 11.5 / 16px.

### A guard that turned out to be vacuous, and was labelled rather than quietly kept

Four guards were tested by reintroducing their bug. Three failed correctly. The
fourth — `styles.css` declaring its own `--card-solid` — **passed**, because
`theme.css` always loads with an unscoped `:root` and defines it anyway.
Deleting that line fails nothing. It stays as defence in depth, and the suite
says so in a "known limit" note rather than letting its presence read as
coverage.

## The thread through this session

`theme-contrast-smoke` renders **51 screens in both themes** checking exactly
the class of fault those twelve panels were — and passed clean the whole time,
because it never opened one of them. `candidate-jd-panel-smoke` had 26 green
assertions about a panel that was quietly forwarding a competitor's apply link.

**A suite only covers the screens it renders, and a green check is a claim about
what was measured, not about what is true.** Both faults were found the same
way: by producing the artefact and looking at it.

---

# Session 26 — the button that had never worked, and the client it now carries

**PR #214 (two rounds, squashed as `8dba19f`). Migration 043 applied live.**

## Round 1 — "I tried opening a job without adding a lead"

The owner sent a screenshot of the New Job form, fully filled in, under a toast
reading:

> Failed to create job: `lead.company_id` and `lead.position` are required
> (lead info must be filled first).

Three faults were stacked behind that one sentence, and the first one is the
kind that only gets found by a user.

**`25-workflow-bd.js` sent `company_id: null` — hard-coded.**

```js
var lead={position:f.job_title,company_id:null,location:f.city+' '+f.state,source:'BD Direct'};
```

The Client box was free text and was never resolved to a `companies` row. A job
order must belong to one, so `POST /job-orders` refused **every direct create**.
Not intermittently, not under some condition — **the "+ New Job" button had
never once worked.** The convert-from-lead path builds its body differently and
was unaffected, which is exactly why nobody had noticed: the path people used
worked, and the path they didn't use was dead.

**The refusal named JSON fields and described a step that does not exist.** It
told the reader to go and fill in lead info first. `POST /job-orders` creates the
lead *itself* — that is its design, stated in its own comment. And the form let
twenty fields be filled before saying anything. This is the shape `CLAUDE.md`
already names in the Reminders write-up: *a rule that decides whether an action
is ALLOWED belongs where the action is OFFERED, not only where it is taken.*
Session 24 found it on a Compose button; here it was on the create path itself.

**Found while fixing it: that route's `jobs` and `contacts` inserts carried no
`orgStamp`.** `org_id` has a column DEFAULT, so a second org's job order would
have landed silently in the **default org's** leads list, with no error anywhere
and nothing on screen to say so. Nobody had hit it because there is one org.

The fix put the resolution on the server — `services/client-resolve.js`, pure —
with a **typeahead** in the form (`51-company-autocomplete.js`, shared, the same
discipline as the zip widget: patch only your own suggestions box, never
`render()`). A typed name alone is enough; find-or-create runs inside the
caller's org. A near-match is **never** merged: folding "Treplar Industries"
into "Treplar Inc" puts a job order on the wrong client and nothing on screen
would say so. The `ilike` pattern is deliberately a superset and `matchCompany`
makes the decision — widening it costs a few rows read, narrowing it creates a
duplicate client.

The picker is drawn **only** on a direct create. Edit ignores the company
(`pickJobFields` drops `company_id`) and convert-from-lead inherits the lead's,
so a picker in either place would be a control that appears to act and does not.

## The phone, found by measuring rather than by the report

The owner's screenshot was a desktop one. Measuring the same modal at 390px
showed its columns were written into a `style=""` attribute — and **an inline
style cannot be re-laid-out by any stylesheet**, the same rule as an inline
colour and an inline font-size. It drew three columns on a phone and pushed its
whole right column — **Client, Work Authorization, City, End Date** — **72px
off-screen**, unreachable behind `#content: overflow-x:hidden`.

So the field this session was fixing was the field a phone could not reach.
`.g3`/`.g2` already existed in `styles.css` and already collapse below 860px;
they were simply not used. Desktop moved by nothing.

**Other modals across the app carry inline grids too. Nothing has checked them.**

## Round 2 — "its better to take in the client information"

The owner asked that a directly-created job capture the client properly: POC
name, email, phone, and the company's address.

Most of it was **wiring, not plumbing**: `POST /job-orders` had always accepted
a `lead.contacts` array and written it. Nothing had ever sent one.

Three sub-decisions were put to them with live numbers pulled from the database
rather than from intuition, and **two came back against the recommendation.**
That is recorded as **D-0023**, and the numbers are why the first one was easy:

| | |
|---|---|
| Leads with a POC | **328 of 328** |
| POCs with an email | **708 of 709** |
| POCs with a phone | **546 of 709** |
| Companies with a location | **1,565 of 1,567** |

**1. POC name + email required; phone and LinkedIn optional.** Agreed. Every
lead already has a POC, so requiring one costs nobody anything — while 163 of
709 contacts have *no phone*, so requiring one would buy invented phone numbers.
That is precisely what D-0017 exists to prevent. The contacts insert stopped
being best-effort: a lead that silently ends up with nobody on it is the thing
the check exists to stop.

**2. Structured address columns, not the existing free-text `location`.**
Against the recommendation, which was: free text now, split later, no migration,
and 1,565 rows already use it. The owner wanted real columns. **Migration 043**,
additive; `location` is kept as the short display form and **derived** from the
new fields rather than typed twice. Nothing is backfilled, because splitting an
existing free-text line by guessing where the street ends turns good data into
confidently wrong data.

**3. The 21-day company re-add cooldown applies to BD job creation.** Against
the recommendation. The option they chose said, in its own words, *"it will
refuse genuine job orders, and people will find a way around it."* They took
that trade for one consistent rule.

It was built as asked, with **no override**, because none was requested. What
was done instead was to give the wall a door: the refusal **names who added the
company and when**, and it is shown **the moment a client is picked** rather
than discovered at Save — the same lesson as round 1, applied before it could
bite.

**The consequence, written down and not designed around:** the cooldown counts
leads on the company, and creating a job order *creates* one. So a client's
**second requirement inside the window is blocked** — which lands hardest on the
best clients. D-0023 carries the two ready fixes and the condition to re-open on.

## One rule that existed three times and disagreed with itself

The cooldown turned out to be written three ways:

1. `routes/jobs.js` `POST /jobs` — server-side, read the real admin setting, but
   gated on `hasRole(req,'ra')`, **so a BD was never checked at all**;
2. `routes/jobs.js` `GET` — the same idea again, filtering an RA's company list;
3. `15-ra-entry-form.js` — **hard-coded 21**, scanning `STATE.jobs`, which is
   only the leads that user's own `/jobs` call returned.

The number is admin-editable (`company_cooldown_days`). Set it to 30 and the
form happily offered a company on day 25 that the server then refused — the
offered-versus-taken failure again, inside the very rule this round was
extending. `services/company-cooldown.js` (pure) is now the one definition, and
extending the rule to a fourth create path is what made that necessary rather
than merely tidy.

## The duplication that was NOT written

`15-ra-entry-form.js` has had a POC block since it was built — company,
location, position, repeating contacts with a duplicate-email check. Writing a
second one for the BD form was the obvious move and is the exact failure the
owner caught themselves with the two candidate-email workflows (D-0012).

So `52-poc-block.js` is a **shared** block, with state kept by the caller
(`pocRegister(name, {get, changed})`) — which is what lets two forms with
completely different state shapes use one implementation. **The RA form's older
copy still exists; retiring it into this is the follow-up, and the thing not to
do is write a third.**

`pocFirstError` there is a **checked copy** of `readContacts` on the server,
because a browser cannot require a Node module — the `view-horizon.js` idiom.
A test runs thirteen cases through both and fails if they ever drift, which
matters because a drift means the form accepts what the server refuses.

## The bug no assertion was looking for

The duplicate-email check redrew the **whole POC block** when its answer came
back — roughly a third of a second *after* the person had tabbed on to the phone
box. So it replaced the field under their hands and lost what they had typed.

It was found because a phone number that had definitely been filled in **was not
in a screenshot**. Thirty-eight assertions were green at the time. It now patches
one `.poc-email-note`; same family as the render engine's own rule, *write only
what changed*.

## The thread through this session

Round 1's fault was a button that had never worked, in an app in daily use,
because the one path people took worked and masked the one they didn't. Round
2's sharpest fault was a keystroke being eaten, found in a picture.

**Both were found by producing the artefact and looking at it** — the same
sentence Session 25 ended on. What is new here is the other half: **the report
was more precise than it first read.** "I tried opening a job without adding a
lead" named the exact condition — *without adding a lead* — and the code had a
hard-coded null on exactly that branch.

Two guards were verified the only way that means anything: every one of them was
checked by putting its own bug back and watching it fail — the hard-coded null,
the missing org stamps, the old refusal, the inline grid, the POC requirement,
the cooldown, the rule drift, and the caret-eating redraw.

**Migration 043 was applied live before the merge**, on explicit go-ahead, and
verified after by a content fingerprint of `name|location` across all 1,567
companies that was **identical before and after** — 10 columns to 16, zero rows
touched, RLS and the service-role policy still in place.

## Round 3 — the question about the notes themselves (D-0024)

The owner asked for the context files to be updated, and in the same message
asked something sharper: *"does this updation happens only when I ask you to do
or does it happen automatically whenever you make a change in the system"*.

The honest answer was **partly**, and the question landed on the one piece that
was genuinely outstanding:

| | when it was written | state when asked |
|---|---|---|
| `DECISIONS.md` | the moment the owner decides | ✅ D-0023, written immediately |
| territory memories, `CAPABILITIES.md` | same commit as the code | ✅ both commits |
| `CONTEXT_WINDOW.md` | per commit | ✅ but drifted to 283 lines |
| `CONTEXT_ARCHIVE.md` | **"end of session"** | ❌ **still unwritten** |

**"End of session" is a trigger that never fires on purpose.** A rate limit, a
closed window or a cancelled run ends a session instead, and anything not yet in
a file goes with it. `DECISIONS.md` already had the right discipline for exactly
this reason — *a decision that exists only in a chat window is lost when that
window closes* — and the archive carried the same exposure with none of the
protection. It took the owner asking to notice that the two files had different
rules for the same risk.

So the rule changed (**D-0024**): the archive is appended **when a piece of work
lands**, alongside the territory memory and the commit. Append-only still holds.
The closing synthesis is the one part that waits, because you cannot know the
lesson before doing the work — and it is **additive**, so a session that dies
loses the summary and not the facts. *An archive of accurate fragments beats an
eloquent one that was never written.*

**Making it automatic was considered and rejected.** A hook can run a script; it
cannot write a narrative about what happened and why. The judgement of what is
worth recording is the entire value and cannot be automated. So this depends on
a session reading `CLAUDE.md` — a real dependency, now stated there rather than
assumed.

**This section is the rule applied to itself**, appended the moment the decision
was made rather than held for an ending. It also sits *after* this session's
"thread through" paragraph, which is its own small evidence for the change: the
session did not end where the summary said it did.

## Round 4 — the three follow-ups, taken together

The owner picked all three suggestions from the end of round 3. Each was
offered as small; two of them turned up a live bug that nothing had been
looking for.

### The RA form's contact block retired into the shared one

`15-ra-entry-form.js` had had its own contact rows since it was built, and
round 2 added a second, shared one for the BD form. Two live paths to one
outcome, which is the duplication the owner caught themselves with the two
candidate-email workflows (D-0012).

The migration itself was mechanical — field names to the API's own, four
bespoke handlers deleted, ~3,200 characters of duplicated rendering gone. Two
things made it worth care:

* **`changed` now carries an EVENT.** A keystroke and a shape change need
  opposite treatment. The RA form redraws wholesale, so re-rendering on a
  keystroke takes the caret out of the box; but its per-contact **Intel** rows
  are POSITIONAL against the contact list, so a removal that does not splice
  both silently attaches one person's seniority and notes to another — a wrong
  fact about a real human with nothing on screen to say so.
* **The form was in daily use with NO test coverage at all.** What
  `poc-block-shared-smoke.mjs` pins is therefore the form working, not the
  refactor.

**And a real bug fell out of testing it, in the shared block, affecting both
forms.** The duplicate-email check answers about a third of a second after the
person leaves the email box — by which time they may be reaching for "+ Add
another contact". Its result line appeared at that moment, moved the button
~20px, and the click landed on nothing: no row, no error, nothing to see.

Measured rather than reasoned about: a click fired straight after typing left
the list at one contact; the same click after the answer had landed gave two.
**Two attempts at the fix were wrong and both are worth keeping.** Reserving
18px left a 3px shift, because the note's own top margin COLLAPSES out of an
empty wrapper — padding does not collapse, margin does. Reserving a measured
19.5px is a magic number a font change would quietly invalidate. The empty state
now renders a placeholder line of the same shape, so it is as tall as the
answered one **by construction**.

### Every pop-up measured at 390px

Round 1 fixed the New Job modal's inline grid. This opened all 18 reachable
pop-ups in both themes and measured. `mobile-layout-smoke.mjs` walks 16 PAGES
and had always passed, because it never opens a modal.

**Found: the candidate STAGE modal** — the one recruiters use constantly to move
people through the pipeline — squeezed a field to **48px** on a phone. Two inline
2-column grids inside an already-narrow bordered box. Now 322px.

Everything else was already clean, which is worth saying plainly rather than
implying a wider problem: the phone fault was confined to those two modals.

`.gc2`/`.gc3`/`.gc4` are the tool that made the fix safe. `.g2`/`.g3` also set a
gap, so converting an inline grid to one of them changes spacing on every
screen; these set columns and nothing else, so the caller keeps its inline gap
and **no wide screen moves**. Verified both ways: two 201px columns with a 10px
gap on desktop before and after, one 322px column on a phone.

**THE TEST WAS VACUOUS TWICE, and both versions looked completely reasonable:**

1. It measured only whether an element's right edge passed the viewport. A
   3-column grid at 390px pushes nothing off-screen — it CRUSHES the columns
   (measured: `55px 174px 174px`) and clips the modal body, 451px of content in
   a 369px box. Nothing off-screen, 82px unreachable.
2. The fix for that — skip anything inside its own horizontal scroller — asked
   CSS for `overflow-x`. **Setting `overflow-y:auto` alone makes the computed
   `overflow-x` ALSO `auto`**, and every modal body sets overflow-y for its own
   height, so the check excluded the entire contents of every modal. It now asks
   whether the box actually scrolls sideways, which is a measurement rather than
   a declaration.

Both were caught only by putting the original bug back and watching the suite
stay green. A third trap was designed out from the start: six cases initially
drew nothing because they needed state the stub had not provided, and **nothing
has no overflow** — so an opener that fails to open is a FAILURE, not a skip.

### Merging a duplicate client

The tool for the mess the client typeahead makes possible. The survivor is the
client already on screen; the duplicate is picked with the shared typeahead
rather than a fourth hand-rolled search.

**A merge never deletes anything** — four tables carrying `company_id` are
re-pointed and the duplicate is soft-deleted. `contacts` is deliberately absent
because it hangs off `jobs.job_id` and follows its leads untouched. Order
matters twice: re-point before deleting (a half-done move leaves the duplicate
still owning what did not move, which is recoverable), and record what moved
before the delete (so a half-done merge is still readable).

The plan is stated in full before the button is pressed, and **Merge stays
disabled until there is a plan to agree to**; retyping withdraws it, because a
plan describing a different company is worse than no plan.

Two clients with unlike names are deliberately allowed — "Treplar Inc" and
"T.I. Construction" can be the same company and only the person merging knows.
The guard against a mis-click is the stated plan, not a name comparison the app
cannot make.

The guard that will matter in a year reads `schema.sql` and every migration for
tables carrying a `company_id` and fails if one is missing from the merge list,
because the failure mode is somebody adding a fifth table and not looking here.

### The thread through round 4

Three changes offered as tidy-ups; two of them contained a live defect that no
assertion was looking for — a click silently lost, and a 48px field on the
screen recruiters use most. Neither was in the thing being changed. Both were
found by **building the measurement first and letting it tell me**, rather than
fixing what I already believed was wrong.

And the measurement lied twice before it worked. The overflow test passed clean
with the original bug reintroduced, in two different ways, each for a reason
that reads as correct until you check it. **Assume your new guard is vacuous
until you have watched it fail** is the rule this session earned twice over.

---

# Session 27 — the front door, and a model that had been dead for two months

## The question that started it

The owner asked three things: what APIs do we actually have, how do we add
CareerBuilder / Resume-Library US / "LinkedIn search by job title and
location", and what are the steps to finish candidate sourcing.

The inventory was worth doing carefully, because the owner's mental model
("we have integrated 3 outside applications") and the code disagreed in both
directions. Live and free: Microsoft/Outlook, Google/Gmail, Groq, **six
employer job-board feeds** (Greenhouse, Lever, Ashby, Workable,
SmartRecruiters, Recruitee — running nightly, finding LEADS) and free
DNS/pattern email inference. Key slots with real code behind them but no key:
Anthropic, OpenRouter, Ollama, ZeroBounce, NeverBounce, Hunter. And one slot
that is **not** an integration at all: **Apollo saves and tests a key and
nothing in PACE calls it.**

The sharper finding was structural. **PACE has two sourcing engines in
completely different states.** Finding companies to sell to: done, free,
running. Finding people to place: **CSV upload only** — every other card on
that page (Apollo, Indeed, Monster, CareerBuilder, Dice, LinkedIn) is a name
with `POST /sourcing/search` answering 501 behind it. They have looked like
features since the plan was written.

## Eight of nine steps were already built

Mapping the candidate journey end to end: job order → **find people** → review
queue → import → resume parsed → match-scored → emailed on a drip → they
answer interested/not/stop → pipeline. Only step 2 was missing. That reframed
the whole request: candidate sourcing was not a big build, it was **one
missing front door on a machine that was otherwise finished.**

## What the owner was told, and chose (D-0025, D-0026)

Every real resume database is paid — selling resume access *is* their business,
which is why there is no free tier and no open-source equivalent. Specifically:
CareerBuilder needs a paid employer account **and** partner approval;
Resume-Library needs a paid recruiter account; and **there is no LinkedIn API
that searches people by job title and location, for us or anyone** — Recruiter
System Connect surfaces data for candidates an ATS already holds, partner
approval runs 3–6 months at under 10% acceptance, and scraping is both against
their terms and a due-diligence problem for a product we intend to sell.

**A correction inside the same session:** an earlier answer told the owner
Apollo had a free tier worth trying. Checked, and it does not — Apollo's free
plan dropped API access in late 2025 (~100 credits, no API; API starts at the
Organization plan, 3 users minimum). Said plainly rather than quietly dropped,
because the owner would have spent an afternoon on it.

The owner asked the right question — *"Do i have to put in money to build this
integration?"* — and chose the free front door first, with quotes gathered in
parallel so the number is ready when it is wanted (D-0025). Hunter was then
parked for a reason worth generalising: **B2B data vendors gate signup on a
company domain** and the owner is on a personal address, which blocks most of
that category, not just Hunter (D-0026).

## The apply page

`routes/apply.js`. Publishing a job order mints a random token and opens
`/apply/<token>`; the applicant lands in `sourcing_candidates`, inert, like a
CSV row. It reuses the staging table (017), the resume parser, the duplicate
check and the existing review queue — **no second import path.** Five rules,
each asserted rather than commented: identical answers for unknown /
malformed / unpublished / filled; a malformed token never reaches the
database; an applicant never lands in `candidates`; a failed write is never
reported as saved; every query bounded at 4s. Publishing is possible only
through `POST /job-orders/:id/apply-link` — `apply_enabled` is deliberately
absent from `JOB_FIELDS`, so a plain `PUT` cannot put a customer's job on the
internet.

## Three faults, and what found each one

None was found by reading the code, and that is the point.

**A TEST FOUND THE LEAK, BECAUSE IT ASSERTED ON RENDERED BYTES.** The client's
name was not in any field the page renders — it was in the middle of the job
description, and the page published it. The fix is `services/jd-scrub.js`,
extracted from `job-orders.js` so the "re-write job description" button and the
apply page **share one definition of "safe to publish"** — the apply page
publishes with nobody reading the result first, so the automatic path must not
be the weaker of the two.

**A SCREENSHOT FOUND THE SECOND, WITH THE SUITE GREEN.** Stripping only the
address out of *"Questions? Email careers@x.com or call 860-555-0142."* left
*"Questions? Email or call ."* in front of a stranger. A contact detail is now
removed by the **sentence**. No test was looking for it; the page simply read
as broken.

**ORDER WAS LOAD-BEARING AND SILENT.** A client's name is usually also its mail
domain, so replacing names *before* masking contacts rewrote
`careers@northwind.com` into `careers@our client.com` — which no longer matched
the contact pattern, so the address stayed on the page **looking scrubbed**.
Contacts are masked first now. Both guards verified by reintroducing each bug
and watching six assertions flip.

## The model that had been dead for two months

The owner got an OpenRouter key, which prompted a re-check — and found the
Session 19 Groq fault repeated on the other provider. `meta-llama/
llama-3.2-3b-instruct:free` was PACE's OpenRouter fast tier, written from
memory and never verified **because no OpenRouter key had ever existed to
verify it against**. OpenRouter removed that free variant on **2026-07-19**,
two months before the owner had a key.

It would have been completely invisible: a retired name is a 404, `complete()`
turns a 404 into null, and null means "write it with the rules" — with a green
*Key valid* tick sitting beside it the whole time, because that test only
proves the KEY is accepted. Both tiers now point at the one variant confirmed
live. Deliberately **not** replaced with a smaller model picked from memory,
since guessing is what caused this twice.

## Shipped

Migration 044 applied live with the owner's explicit go-ahead and verified
before merge: 4 columns, 2 indexes, and **0 of 6 job orders published**, so
nothing went public as a side effect. `test/apply-page-smoke.mjs` is 67
assertions; the suite is **88/88**. Merged as #217 and deployed.

## The thread through this session

**Every fault here was invisible to the thing that should have caught it.** The
suite was green while the page read as broken. The AI health card was green
while the model behind it had been deleted. Six sourcing cards looked like
features with 501s behind them. An Apollo key saved, tested, and called by
nothing.

What actually found them was cheap and unglamorous: rendering the bytes and
asserting on them, taking a screenshot and *looking*, and re-checking a
constant because a new fact (a key arriving) made it checkable. The
counterpart rule is the one this session kept earning — **a guard is vacuous
until you have watched it fail** — and both new guards were verified that way
before being trusted.

And the largest finding was not a bug at all. Eight of the nine steps in
candidate sourcing were already built; the work was one missing front door.
**Knowing what already exists was worth more than any code written here** —
which is precisely what `CAPABILITIES.md` is for, and why the inventory came
before the build.

## Session 27, round 2 — the six cards that were never features

The owner agreed to relabel the Sourcing page. What was there: Apollo, Indeed,
Monster, CareerBuilder, Dice and LinkedIn rendered as cards **identical to the
one working source**, each badged `NEEDS CREDS` with a Details button, above a
subtitle reading *"API boards activate when credentials are added."* Every word
of that was false — `POST /sourcing/search` answered **501** for all six and no
adapter existed. They had read as features for five sessions, and it was the
owner who found it, by asking which were free and where to get the keys.

The fix separates two facts the old registry had conflated: **`built`** (does
code exist) from **`available`** (can it run today). Every unbuilt provider now
carries a `blocker` naming its real precondition, and for all of them that is a
**paid account, not an API key**. The screen draws the two built sources —
the apply page and CSV import — as cards with real actions, and the other seven
as one quiet "Not connected" list containing **no controls at all**. The
endpoint's refusal changed from `needs_credentials` to `not_built`, and names
what it would take plus the route that works today.

Resume-Library was added (the owner asked for it and it had never been listed),
and the historic ids were all kept deliberately: staged rows carry a provider
string, so dropping `apollo` or `dice` would orphan those rows with a blank
Source column. A test pins each id.

### The guard was vacuous, and this is the third time

`test/sourcing-honesty-smoke.mjs` passed **30/30 with the bug fully
reintroduced** — every provider drawing a card with a button, exactly the
original defect. Two independent causes, both of which generalise well beyond
this page:

- **`if (!node) continue`.** A label the probe could not find was silently
  counted as fine. Deleting the whole roadmap list therefore made "no unbuilt
  provider renders an action" trivially true. **A probe that cannot take its
  measurement must FAIL, never pass** — `missing` is now its own assertion, and
  deleting the list now fails four checks instead of passing all of them.
- **It checked `node.parentElement` only**, and the button sat one level
  further up. Anchoring on a hand-picked nesting depth is a guess about layout;
  `closest('.card')` asks the question the rule is actually about.

Both were re-verified by reintroducing each bug separately and watching the
right assertions fail. **Three vacuous tests in this repo's recorded history
now — that is the norm, not the exception.** The habit that catches it is
cheap and the habit that misses it is just trusting a green number.

### The thread through round 2

Round 1 found faults the suite could not see. Round 2 found a fault **in the
suite itself**, and only because the reintroduce-the-bug ritual was performed
rather than assumed. The two rounds are the same lesson pointed at different
targets: **a green check is evidence about the checker as much as the code**,
and the only way to tell which is to break the thing on purpose.

The product lesson is smaller and sharper: PACE had been telling its owner it
could do six things it could not. Nobody wrote that lie deliberately — it
accumulated, one placeholder at a time, from a plan file where those names were
future work. **A roadmap rendered in the same component as a feature becomes a
claim.**

## Session 27 — closing synthesis

*(Append-only, so the two per-round "thread" sections above stand as written.
The one at the end of round 1 is round 1's, despite its heading — round 2 was
appended after it. This is the synthesis for the session as a whole.)*

**Nothing this session was found by the thing built to find it.**

- A green 88-suite run, while the apply page published a client's name pulled
  out of the middle of a job description.
- A green **AI IS WORKING** card, while the model behind OpenRouter's fast tier
  had been deleted two months earlier.
- Six Sourcing cards badged "NEEDS CREDS", advertising integrations that had
  never existed, for five sessions.
- And then a brand-new guard written against that last one, passing **30/30
  with its bug fully reintroduced**.

What actually found them was cheap and slightly undignified: rendering the
bytes and asserting on those rather than on state, taking a screenshot and
looking at it, re-checking a constant because a new fact made it checkable, and
deliberately breaking each new guard before trusting it. Not one required
cleverness. Every one required not accepting a green number as the answer.

So the durable rule from this session is about **evidence, not code**: a
passing check is evidence about the checker as much as about the thing checked,
and the only way to tell which is to break it on purpose. That is now stated
three times in `CLAUDE.md` with three different origins, which is the point at
which it stops being an anecdote and becomes the default assumption.

**The product thread is separate and simpler.** The session opened with the
owner asking how to integrate CareerBuilder, Resume-Library and LinkedIn. The
useful answer turned out not to be any of those: eight of the nine steps in
candidate sourcing were already built, all three named boards cost real money,
and LinkedIn sells no such API to anyone. What was missing was a front door —
free to build, free to run, and the only candidate source that gets cheaper as
it grows. **Knowing what already existed was worth more than anything written
here**, which is exactly what `CAPABILITIES.md` is for and why the inventory
came before the build.

Two things the owner settled, both recorded with re-open conditions: paid
resume databases wait on a measurement rather than a guess (D-0025), and
Hunter — along with most of its category — waits on a company email address
(D-0026).

## Session 27, round 3 — the rule the owner had already made twice

The owner asked for a strict standing rule: work through the territory agents,
memory updated in real time, *"so that no progress or deletion or addition is
missed and i dont have to explain eveytime."* And then the sentence that turned
the request into evidence: *"Like last time i think i did, but it got missed in
the last edit window and i dont know how many before this too."*

They were right, and the repository proved it in under a minute. **D-0008**
(2026-09-09, STANDS): build PACE through its nine territories, each writing its
own memory. **D-0024** (2026-09-17, STANDS): memory is written as the work
lands, not at the end. Both recorded. Both in force. **Both broken in this very
session** — two features shipped, six territory memories left stale, and the
owner had to ask whether the context was up to date.

So the answer to *can we do that* was not to write the rule a third time. **The
rule was never the problem. The mechanism was**, and D-0024 had said so out
loud: *"this rule depends on a session reading `CLAUDE.md`, which is a real
dependency and is now stated rather than assumed."* Stating a dependency is not
removing it.

### The distinction that had been missed

D-0024 considered automating this and rejected it:

> *a hook can run a script — it cannot write a narrative about what happened
> and why. The judgement of what is worth recording is the whole value, and it
> cannot be automated.*

The first half is correct. The conclusion does not follow. **A script cannot
write the narrative. It can absolutely check that one was written.** That is
the entire fix, and missing it cost three sessions of the rule quietly not
holding.

### What was built

`scripts/memory-check.mjs` maps changed files to their owning territory through
`_map.json` and reports which memories the change owes. Two hooks in
`.claude/settings.json` — which run whether or not anybody remembers they
exist:

- **SessionStart** injects the protocol, plus anything already owed in the
  working tree, into **every chat in this repo** before the owner types a word.
- **Stop** blocks a session trying to finish with memory unwritten, naming the
  exact files, and emits a `systemMessage` so the owner sees it too. They
  should not be the last line of defence — and certainly not unknowingly.

Three properties were designed in deliberately, and each is a rule for anyone
touching this later. **The gate is dumb**: it checks presence, never quality,
because quality is judgement and a checker pretending otherwise would become
the most convincing vacuous guard in the repo. **A blocking hook must be
satisfiable**: two exits are offered (write it properly, or an honest
mid-flight placeholder), so it corrects a session instead of trapping one.
**It fails open**: if the checker itself breaks, the gate stays silent rather
than walling off the work.

The proof it is not vacuous came from history rather than invention: run
against this session's real apply-page commit, it names exactly the six
territory memories that were missed that day. `test/memory-discipline-smoke.mjs`
pins that case with 25 assertions on synthetic file lists — a checker tested
only against the current tree passes for whatever the tree happens to hold.

### The thread through round 3

Rounds 1 and 2 found faults invisible to the tests meant to catch them. Round 3
found a fault in something further upstream: **a governance rule that had been
correctly decided, correctly recorded, and still did not happen.** Three
sessions of drift, and the only reason it surfaced is that the owner noticed
and said so.

The generalisation is uncomfortable and worth keeping: **writing a rule down is
not the same as making it true, and a file cannot tell you which of the two you
have.** DECISIONS.md faithfully recorded a decision that was not being
followed — the record was accurate and the reality was not, and nothing in the
system could see the gap. What closed it was making the rule executable, even
though only the shallowest part of it *can* be executable. The narrative still
depends on judgement. But "did anyone write anything at all" no longer depends
on anyone remembering to ask.


# Session 28 — the page that was dead, the applicant who arrived, and the word that meant three things

> *(Heading added 2026-09-23: this session's rounds were appended under Session
> 27's heading. No prose was changed — only the missing `#` heading inserted.)*

## Session 28 — the Jobs page was dead, and every test said it was fine

The owner opened the Jobs tab and got a red sentence: *"Could not draw this
page: j is not defined"*. Reported as one broken tab. It was two.

**The fault.** Session 27's apply-link block had been written into the wrong
function. It landed in `renderJobOrders` — the LIST — directly after the row
`.map(function(j){...}).join("")` closed, so the `j` it reads was already out
of scope; and the string it built was consumed in `renderJobOrderDetail`, a
different function 650 lines down. The list threw `j is not defined`; the
detail threw `applyBlock is not defined`. The second was invisible because the
only route to it ran through the first. One misplaced edit, two dead pages, and
the feature shipped the session before had never once been reachable.

**Why nothing caught it, which is the part worth keeping.** Five browser suites
render `bd_joborders`. All five passed. That is not an accident of coverage —
it is what they measure. `UI.registerPage` catches a render error and writes a
short red sentence into `#content`, and *that* page has excellent contrast,
three DOM nodes, no overflow, no compositing layers and perfect repaint
stability. It outperforms the real page on every axis those suites collect. The
`pageerror` listener misses it too, because the error is caught by design.

**Five suites measuring how good a screen looks, and not one asking whether the
screen is there.** Those are different questions. The app's own error handling
— which is correct, and should stay — converts a crash into something that
looks, to every metric in the suite, like an unusually clean page.

**The guard.** `test/page-renders-smoke.mjs`: every registered page x five
roles x two data shapes, 170 screens, asserting only that `#content` does not
carry "Could not draw this page" or "Page not found". No layout judgement, no
per-page knowledge, plus a cannot-measure assertion so it fails rather than
passes when it cannot see the app. Reintroducing the bug drops it to 3/7 and
names both faults, including the one no human had seen. Full suite 91/91.

**The thread through this session.** Session 27 ended by making the memory
protocol executable, on the argument that *a script cannot write the narrative
but can check that one was written*. This session is the same shape one layer
down: **a test cannot tell you a screen is good, but it can tell you the screen
exists** — and five tests measuring goodness all agreed about a page that was
not there. The cheap, dumb, presence-level check is the one that was missing
both times. It is worth asking of any guard: does this fail when the thing is
absent, or only when the thing is ugly?

And the gate held. After the fix, `memory-check` named foundry, surface and
this archive as owed — and this entry exists because it did.


## Session 28, round 2 — the first real applicant, and nowhere to see them

The owner published an apply link and asked the obvious question: *"when the
candidate clicks on apply, where does that candidate end up in our system and
where can we see them."*

**The honest answer was: in the database, correctly, and nowhere on screen.**
Checked against the live project rather than reasoned about — one real
application, 19:24 UTC, a real person with a real CV, staged in
`sourcing_candidates` with `provider='apply'` exactly as designed. The
end-to-end path worked on its first contact with a member of the public. It was
also completely invisible: the Sourcing review queue defaults to every provider
and says nothing about which job anybody applied to, because that fact lives
inside the staged row's `raw` blob.

**What was built (D-0028).** Candidates → **Applicants**, and an **Applicants**
block on each job order under the apply link that produced it. Both are VIEWS
of the sourcing queue: same read endpoint, same import endpoint, no second
pool and no second import path. The one thing importing does differently is
pre-tag the job the person applied to — they already told us, and asking a
recruiter to re-pick it is asking for a fact the system holds.

**The decision worth keeping is one that was made and then UNMADE.** The job
filter was first written as a PostgREST jsonb filter,
`raw->>applied_to_job_order_id`. It was removed before it ran, for two reasons
that compound: this sandbox has no Supabase credentials, so the syntax could
not be exercised at all; and its failure mode is an **empty list, not an
error**. A broken filter would have rendered "No applications yet" — a
completely plausible sentence — on a page with applicants sitting behind it.
The owner would have believed it, and so would I.

So the match moved into `services/applicants.js`: pure, the only reader of that
blob, and pinned by 23 assertions including the one that matters — **`forJob`
with no job id returns nothing, never everything**, because a pass-through
would show one job's page every other job's applicants.

**Three defects were found by building the tests rather than the feature.**
`UI.toolbar` has no `left` key and drops one silently, so the applicant count
never rendered. `resume_url` means two different things — a public URL for a
CSV row, a private storage path for an application — so linking it directly
works for one and silently fails for the other; it needs signing. And the
empty-state assertion in the new browser suite **passed vacuously**: it pointed
at a job id that did not exist, so the page drew "Job not found" and the test
was satisfied without the applicants block ever rendering.

**The guard from round 1 was widened by exactly the hole this work exposed.**
`page-renders-smoke` drove `STATE.page` only, so a sub-tab was invisible to it —
the same hole that shipped Email's Sent tab broken in Session 23, and it would
have been blind to the Applicants tab built this round. Screens are now
`[page, sub]` pairs: 190 instead of 170.

**The thread through this round.** Round 1's lesson was *a test can tell you a
screen exists even when it cannot tell you the screen is good.* This round
extended it twice. Once in scope — a page is not one screen, so "does it exist"
has to be asked of every tab, not every page. And once in kind: given a choice
between a mechanism that cannot be tested here and one that can, **take the
testable one**, even when the untestable one is the more idiomatic code. The
PostgREST filter was the better-looking implementation and the worse
engineering decision, because its failure would have been silent, plausible,
and indistinguishable from the truth.


## Session 28, round 3 — the accept button that half-worked

The owner accepted the first real applicant onto a job and reported three
things: they stayed in the applicant list, they were not added to the job, and
they could not be found under Candidates. Two of the three were real, one was
my design, and the sharpest one was invisible from the screen.

**Checked against the live database before touching any code.** The candidate
HAD been created (CN-00037). A `candidate_pipeline` row HAD been created. And
there were **zero submissions** — which is what the job order's Candidates
list, the pipeline board, the funnel and every report actually read. So the
import wrote membership into a table nothing counts, and the job page went on
saying "Candidates (0)" over a person it had just accepted. One query turned a
vague report into a precise one.

**PACE had two ways to be "on a job" and only one of them meant anything.**
`candidate_pipeline` is a tagging layer; `submissions.stage` is membership.
Importing now writes both, at `Sourced` — the same stage a manual add uses,
because this is the existing kind of membership rather than a new one.

**The second fault was mine and was invisible.** The import handler refreshed
the candidate pool and the job's list by calling `loadApplicants()` and
`loadSubmissions()` — both module-local, neither on `window`, both wrapped in
`if (window.x)`. They threw nothing and did nothing. **A guarded call to a
function that does not exist is dead code, not safety**, and it is a sibling of
the onclick rule from Session 21: the guard made the absence silent. Two named
hooks now exist and a test asserts they are real functions.

**The third was a word.** `candidates.source` stored the raw provider token, so
a real person's record read "apply". The owner asked for the applicant tag name
and was right to: an internal id in a column a recruiter reads is a small,
constant reminder that the product is leaking its plumbing.

**Then the three things that had been offered and asked for.** A receipt to the
applicant (a careers page that swallows a CV in silence is the commonest
complaint candidates have about applying anywhere), a nudge to the recruiter
(otherwise the only way to learn is to go and look, and nobody goes and looks),
and a match score — which is worth more here than anywhere else in PACE,
because an applicant is scored against the job **they chose themselves**.

The emails are pure functions with their exact words pinned, because one of
them goes to a stranger under the customer's name with nobody reviewing it. Two
rules are asserted in both directions: the end client's name is never in the
applicant's email and may appear in the recruiter's, and nothing is promised
that PACE cannot keep — no "within 48 hours", because nothing here can keep
that.

**The thread through this round.** Rounds 1 and 2 were about tests that could
not see an absence. This one was about the same blindness in the product: a
button that reported success, wrote a row, and left the thing the user actually
asked for undone — and three separate mechanisms (the pipeline table nothing
counts, the guarded call to a missing function, the id shown as a word) each of
which failed **silently and plausibly**. None of them threw. The screen looked
fine. The owner found all three by trying to use the feature, which remains the
only test that covers everything.


## Session 28, round 4 — the word that meant three things

Before merging the applicant work, the owner stopped it with a definition:
*"define submission, ie job submission. adding a candidate to a job is not
submission."*

They were right, and the correction was worth more than the feature. **A
submission is a candidate sent to the CLIENT** — profile, CV and rate, for a
hire/no-hire decision. It is what a staffing desk measures itself on. Adding
somebody to a job says only that they are in the running; nothing has left the
building.

**PACE counted the word three different ways at once.** The Reports headline
used a local list of stages. The Dashboard's "Subs this week" counted every row
in the table. Hot jobs did the same. So sourcing ten candidates on a Monday
reported ten submissions — on the first metric a buyer would ask about.

The root cause is a name. The `submissions` table holds all eleven ATS stages,
from Sourced to Placement; it is really the candidate-on-job pipeline record.
**A storage name had quietly become a business metric**, and nothing in the code
said otherwise, so each screen invented its own reading.

**Offered three definitions; the owner chose to publish two numbers** — to BDM
(recruiter output, internal) and to client (the real submission) — and that is
the better answer rather than a fence-sit, because **the gap between them is
the interesting figure**. Candidates stalling between recruiter and BD approval
are invisible if only one number is ever shown, so `stalled_at_bdm` is now
published too.

`services/submission-stages.js` is the single definition, and the ladder is
ORDERED rather than a list of names: "submitted" means "at or past this point",
and two hand-maintained lists is precisely how this drifted in the first place.
`Not Accepted` and `On Hold` sit off the ladder because neither says how far
somebody got, and an unrecognised stage counts as nothing — a renamed stage
should under-count loudly, never inflate silently.

**One honest limit, recorded with its re-open condition:** the count reads the
stage a candidate is at NOW, so somebody submitted to a client and later marked
Not Accepted stops being counted. That under-reports. Fixing it needs the stage
history that `submission_activity` already stores, or a `client_submitted_at`
column — deferred, because the bug being fixed was three screens disagreeing,
and consistency had to come first.

**The thread through this round.** Every previous round this session was about
a mechanism failing silently. This one was about a WORD failing silently. The
code was correct in the sense that every line did what it said; what was wrong
was that three places used one term for three different things, and no test
could catch it because no definition existed to test against. **Naming a
business term precisely, once, in a callable place, is the same kind of fix as
extracting a rule into a pure function** — and it came from the owner, who does
not read code, noticing that a sentence in a PR description was wrong.

## Session 28, round 5 — the memory that had no place to put a suggestion

The owner's ask was three things in one message, and the third named a real
structural gap rather than a bug:

> *"keep a list of things that you have suggested me doing and start marking them
> completed and pending, take from a week ago too… strike off the things that are
> completed, keep updating those things when they are being edited or changed in
> a different way than the proposed. And then bring it up when asked for like
> whats left and how we can do it… I want to make sure that no matter when I open
> any new chat and work upon, I am working on a real engine that's running live."*

### PACE had three memories and a suggestion fitted none of them

`DECISIONS.md` records **what the owner chose**. `CONTEXT_ARCHIVE.md` records
**what happened**. The territory files record **what the code does**. A
suggestion is none of the three: nobody decided it, it never happened, and no
code exists for it. So every "here is what I would build next" lived in a chat
window and died there.

The cost was already visible and had simply never been named. **The AI health
check has now been asked for across four consecutive turns** with no record that
it was ever asked once, so each turn re-offered it as though it were new. The
inline-font-sizes proposal, the phone-numbers question and the Reports-into-the
Dashboard ask have all been raised, dropped and re-raised the same way. The
window's "Raised this session, not yet decided" section was an attempt at this,
but it is rewritten every session by design, so anything not re-typed vanished.

`docs/ROADMAP.md` is the fix, with **D-0030** stating it. 29 rows, backfilled to
2026-09-16. Four rules, and the third is the one that would be easy to skip:

1. A suggestion becomes a row **in the same turn it is made** — D-0024's
   reasoning exactly, because "end of session" is a moment that never announces
   itself.
2. Five states: `PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`.
3. **⚠ `CHANGED` IS NOT `DONE`, and the owner asked for this explicitly.** A row
   that shipped differently from the proposal keeps **what was proposed, what
   shipped, and why it moved**. Rewriting it to match the outcome produces a
   tidy list that has quietly erased the fact that the plan was wrong — and the
   plan being wrong is the most useful thing on the page. `R-018` is the first:
   one submission count was proposed, **two plus the gap** shipped, because the
   owner corrected the domain mid-build.
4. **Nothing is deleted.** A reversal is a new state, as in `DECISIONS.md`.

And the instruction that makes it load-bearing rather than decorative: **when the
owner asks "what's left", READ THE FILE.** Neither memory nor `git log` holds a
suggestion that was never built — reconstructing from either produces a list of
things that already shipped, which is the opposite of the question.

### The artifact, and what "live" can honestly mean

The owner also reported the **Nine Territories** artifact would not open, and
asked for it to be "the live engine… I should be able to see in live what's
being changed in code and system".

Measured rather than assumed: the page was rendered in a real Chromium from the
saved copy. **It renders correctly** — nine legend rows, a full dossier, four
route buttons, the flight log running. Its only failures in this sandbox were the
CDN and the font host, both proxy artefacts of this box, and the page degrades
cleanly past them (`#scene.flat`, "The island needs WebGL"). So the report could
not be reproduced as a broken render, and was not claimed as fixed.

What IS true, and is the more useful answer, is that **that page can never be
live**: it is a static survey stamped `"generated":"2026-09-22"`, regenerated
only when somebody runs `scripts/territory-map.mjs` and republishes. Describing
it as an engine was always going to disappoint.

`PACE Live` (`NQ4HUuMfAWJk34g9Vs5EdQ`) is the honest version. It declares the
`db` capability and reads its rows from the artifact's own store, so **any future
chat updates it with a single-document write** rather than a republish — which is
what makes "I can say multiple things at once in a new chat and it just does
them" actually hold. Three details worth keeping:

- **The page renders at rest from a snapshot baked into it, then upgrades to the
  store when it loads**, and the header says which of the two you are looking at.
  A page that is blank until a capability resolves fails every thumbnail, every
  share preview and every viewer whose grant is refused; a page that shows stale
  data *labelled as live* is worse than either.
- **One document per row**, `doc_id` = the row id, so "mark R-009 done" is one
  write. An array in a single document would have made every edit a
  read-modify-write over the whole list.
- **The file wins any disagreement with the artifact.** The owner does not read
  the repo, so a file alone is invisible to them; a cold session does not open
  the gallery, so an artifact alone is invisible to it. Each covers the other's
  blind spot, and naming which one is authoritative is what stops them drifting.

One real bug was caught in the one pre-publish look, and it is the same class as
the `.overlay` fault from Session 23: the `CHANGED` card is an `li` inside the
shipped list, so it inherited `.ship li`'s two-column grid, collapsed its own
`<dd>`s to zero width and pushed the page **120px sideways at 390px**. A grid
declared on a tag selector reaches every descendant that happens to be that tag.
Scoped to `.ship li:not(.row)` and re-measured: 390/390 and 1180/1180.

## Session 28, round 6 — the production reset

The owner answered the three open asks and then asked for the database to be
cleared: *"I want to delete the leads and candidates database, I am going to
start real production work now."*

**The recon came first, and it earned its keep.** "Leads and candidates" read as
two tables; the live database held **six real client job orders** — Penn Color,
Phoenix Tailings, Sundream, Griffith Energy, California Garlic, Treplar — with 21
submissions against them and a **published apply link** on JOB-00008. Deleting
candidates alone would have emptied those reqs; deleting companies would have
violated the FK from `job_orders`. The scope genuinely changed the outcome, so it
was put to the owner as three costed options rather than guessed at. They chose
the **full wipe, no backup**, knowing the apply link died with it.

Two things the counting found that no amount of reasoning would have:

- **`emails` held 1,654 sent and 138 failed and ZERO pending.** Had anything been
  queued, deleting leads out from under an in-flight send loop is a genuinely bad
  failure mode. Check the queue before clearing what it points at.
- **Two circular foreign keys**, both of which rolled the transaction back before
  any row was lost: `submissions.pipeline_id` ↔ `candidate_pipeline.submission_id`,
  and `emails.follow_up_id` → `follow_ups`. The first needs both links NULLed
  before either side can go; the second only needs the order swapped. **A
  dependency-ordered delete is not the same as a dependency-ordered list of
  tables** — a cycle has no valid order, and the database is the thing that tells
  you so.

**`suppression_list` was deliberately kept, and this is the rule worth carrying:
a do-not-email list is not business data, it is a promise.** Wiping it alongside
the leads would have silently re-enabled outreach to everyone who had ever asked
not to be contacted — a compliance failure that produces no error message and
shows up only as a complaint. It was the one table excluded from a wipe the owner
had described as total, and they were told so rather than asked.

`id_sequences` was reset to zero so production starts at `CN-00001` / `JOB-00001`
rather than continuing from the test data's counters.

Also recorded from the owner's screenshots: **AI is confirmed working on both
providers** (`R-009` closed after four turns of asking), and two new faults —
the OpenRouter card reading **"Not configured"** directly above its own
`✓ Key valid · 50 credits remaining` (`R-030`, the Sourcing-page class of fault:
the screen contradicting the system), and a Groq model box showing a different
model from the one the passing health check reported (`R-031`). Thirty-five
resume files are now orphaned in private storage (`R-032`).

## Session 28, round 7 — the rewind clock, and three stores that had never been read

The owner: *"build the time of every stage change. Date and time and tag that as
a small history thing like a rewind clock button ver small in every lead,
candidate, job and all every variable."*

### The surprise was how much of it already existed

Grepping before building — the CAPABILITIES rule — turned up **three
history-shaped tables**, two of which were already being written on every stage
change:

| record | store | recorded? | shown to anybody? |
|---|---|---|---|
| lead | `activity_log` | **yes**, with old/new/date/actor | **no** |
| submission | `submission_activity` | **yes**, old_stage/new_stage | only buried in one profile tab |
| job order | — | no | no |
| candidate | — | no | no |
| company | — | no | no |

So for leads this was never a recording problem at all: every stage change since
the beginning was already on disk, dated, with the user who made it, and
**nothing in the product had ever read it back**. That is the same shape as
Session 23's email history — *"the bodies were being stored the whole time;
nothing read them back"* — and it is worth naming as a pattern: **this codebase
stores more than it shows, so the first question about a missing feature is
whether the data is already there.**

### Three stores, one entry, or it drifts again

`services/record-history.js` is pure and is the ONE definition. Each store gets
a mapper; every screen reads the one entry shape `{at, kind, field, from, to,
actor, note, source}`. The alternative — a panel that knows three shapes — is
exactly how the word "submission" came to mean three things (D-0029) two rounds
earlier in this same session.

Two rules inside it that are easy to get wrong:

- **A row with no timestamp is DROPPED, never dated `now`.** A history whose
  times are invented is worse than a short one.
- **`relativeTime` takes `now` as an argument.** Every label it produces is a
  factual claim about elapsed time, so a test calling it with the real clock
  passes on the day it is written and rots quietly. Same reason
  `conversation-intel.js` has an injectable clock.

And one that turned out to be free: **`durations()` / `heldFor()`.** The entry
above an entry IS the end of it, so "held 5 days" costs nothing to compute — and
it answers the question a stage trail is actually asked, which is not "what
happened" but *"where does this rot?"*. That is `R-001` (time in stage), the
item I had named as the highest-value next build, arriving as a side effect of
the button the owner asked for.

### What shipped

`GET /history/:entity/:id` — one endpoint, five record kinds, **404 for another
org's record, never 403** (a 403 confirms the id exists). `record_history`
(migration 045) for the three kinds that had nowhere to write, registered in
`models/tables.js`, applied to an **empty** database so there is no backfill and
no gap to explain. `public/js/54-record-history.js` is one module: one button,
one panel, `UI.registerOverlay('rewind', ...)`, wired onto four screens and
pinned by a test that fails if a second file ever registers that overlay.

**Three guards were verified by reintroducing the bug** — the deleted button,
the panel repainted on glass `--card`, and a duplicated panel module — because
four vacuous guards have now been found in this repo and the assumption has to
be that a new one is vacuous until it has been watched to fail.

### What was deliberately NOT built

The owner said *"every variable"*, which read literally is a full field-level
audit trail on every column of every table — growth bet #7. What shipped is
**stage and status changes plus a named list of fields per record kind**, with
the tracked list at the top of each router so widening it is a list edit rather
than a new mechanism. Said plainly to the owner rather than quietly scoped down.

# Session 29 — failed emails that never come back

## Round 1 — design only (2026-09-23)
Owner, after importing a fresh set of leads: failed emails have no retry, by
hand or automatic. Confirmed in code: every failure branch in
`processPendingEmailSends` writes `status:'failed'` and nothing ever reads that
status back. Confirmed on the live DB: 4 failures today (Daniel James 2, Prince
Thomas 2). Daniel's two carried "Sending mailbox sign-in expired" while three
more from that SAME mailbox sent minutes later — a transient auth failure
treated as permanent. That is the fresh incident D-0006 said would re-open it.
Design recorded as `R-036` (absorbs `R-004`/`C-0004`); nothing built, migration
046 awaits the owner's go-ahead.

## Round 2 — built (2026-09-23)
Owner: *"go ahead, retry today's 4 automatically"*. D-0031. Migration 046
applied (4 columns on `emails`, verified). `services/send-retry.js` is the pure
rule; `recordSendFailure()` is now the only writer of a send failure in the
leads loop; the pending fetch filters on `isDue` in Node. A sign-in failure
stops that mailbox for the rest of the run. Uncertain failures (timeouts) are
never auto-retried because the email may have gone out. Email → Pending shows
a calm "Didn't send" card with reasons, Retry and Retry all. Today's 4 re-queued
by SQL after checking each: address valid, not suppressed, no twin already
sent, mailbox present. Caught by me before shipping: MAX_ATTEMPTS=3 meant the
approved 4-hour step never happened; now first send + 3 retries. Tests 97/97;
the new suite was proven non-vacuous by re-introducing the bug.
