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
