# futé — project memory (read me first, every session)

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

futé is a **recruiting ATS + lead-management platform being built to sell
commercially** (SaaS), competitive with the established ATS products (Ceipal,
Bullhorn, and the like). Every decision is a product decision in service of that.

**Build philosophy: spend nothing now, scale later.** Prefer free tiers and infra we
already have. Don't add paid services unless they clearly earn it. But make the
**architecture** choices now that are cheap today and expensive to retrofit later, so
we never have to rewrite to grow (see "Growth bets" below).

---

## The stack (so it isn't re-derived each time)

- **Backend:** Node/Express — `index.js` (email/lead engine) + `bd_recruiter_routes.js`
  (ATS: candidates, pipeline, submissions, job orders). Plus assorted `*.js` engines
  (mailmerge, warmup, jd-parser, resume-parser).
- **Data:** Supabase (Postgres + storage bucket `candidate-docs`). Project
  `teiqievahzhllojvgsku`. Migrations in `migrations/`.
- **Frontend:** plain `<script>` modules in `public/js/NN-*.js`, loaded in order by
  `public/index.html`. **No build step, no bundler.** Global `window.*` + `STATE`.
  `render()` / `goPage()` are wrapped by each page module.
- **Deploy:** Render (`fute-lms-backend.onrender.com`), auto-deploys from `main`.
  → Merging to `main` IS the release. That's how the owner gets to try things live.
- **Tests:** `test/*.mjs` Playwright smokes that serve `public/` statically and drive
  the real modules in headless Chromium (guest login, inject `STATE`, assert on
  render output). `bash test/verify-frontend.sh` checks syntax + index.html.
  Run: `npm install --no-save playwright-core`; Chromium at `$PLAYWRIGHT_BROWSERS_PATH`.
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
    `05-page-dashboard.js`, and the backend `bd_recruiter_routes.js` (`STAGES` +
    `STAGE_ALIASES`). `normalizeStage()` (backend + frontend) maps any legacy stored
    value to the current name on read and write, so a rename can ship before its data
    migration without breaking boards/funnels/reports.

## Working conventions

- Implement → `node --check` → targeted smoke test → screenshot → commit → push to the
  session's dev branch → open a **draft PR** → when the owner approves, merge + let it
  deploy. Keep commits/PRs clean; the owner won't read them, but future-me and buyers'
  auditors might.
- Keep a session summary in `docs/CONTEXT_WINDOW.md` and keep **this file** current —
  it is the durable memory.
- **Before moving ANY file, read `docs/CONTEXT_WINDOW.md` § "DEPENDENCY MAP"
  (Session 8).** Ten things break on a naive move and several fail *silently* —
  notably `learned-skills.js` (`__dirname`-relative JSON, resets with no error),
  two tests that read `index.js` as raw text, and the deliberate server→browser
  require in `match-engine.js`. A restructure without it will break production
  quietly.

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
   - **Slice 3b DEFERRED by owner decision:** enabling RLS (row-level security) with
     org-keyed / service-role policies to close the anon-key exposure. Proven-safe
     pattern (already live on 8 tables; frontend is API-only) but touches the live
     prod DB, so hold it until closer to onboarding a second org. **Do NOT enable RLS
     on the live DB without an explicit, fresh go-ahead.**
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
     migration 029) — see `docs/CONTEXT_WINDOW.md` "Session 5" for the full
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
9. **Billing later, stubbed now (Stripe)** — leave a seam for self-serve signup +
   subscription so it plugs in without a rewrite.
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
