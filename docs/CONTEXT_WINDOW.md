# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md` (the rules only; the full history is `docs/CLAUDE_MD_FULL_SESSION34.md`, open it only for a "why").**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the reasoning behind a past decision.

**Updated**: 2026-10-07 (end of Session 41) · **Last merged to `main`**: #303 (`193e207`, docs) after #302 (`f96918e`, the eight small fixes) after #300 (round 5) after #298/#297/#295/#294 · **Repo**: `PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**: `teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging to `main` IS the release (unverified from the sandbox: the owner hard-refreshes and looks).
**Highest ids:** decision D-0084 · contract C-0036 · roadmap `R-156` (next `R-157`) · next migration `057` (no migration in Sessions 39–41).

## ▶▶▶▶ LEAD FINDER STEPS 2+3 (Session 42) — READ THIS FIRST
**NOW LIVE (merged #306 + #307, migration 058 applied).** Originally built on the dev branch: saved searches, nightly/Run-now Apollo search, cards (Accept/Wait/Reject), Accept window with the 3-contact picker, admin access + limits (rail item "Find Leads"). (Release steps used, for next time:) confirm with the owner (fresh go-ahead), check no emails are mid-send (`emails.status='sending'`, `send_progress_*`), apply 058 to project `teiqievahzhllojvgsku`, then merge (Render restarts), then the admin switches people on in Find Leads → Access & Apollo and presses "Check what my key can do" (~2 credits). Apollo response shapes are from docs, unverified live. Decision D-0092; roadmap R-157 (steps 2–3), R-158/159/160/161 open. Later: D-0093 (first-live-use fixes), D-0094 (Saved & past). Highest ids: D-0094, next migration 059. Open with the owner: they will test the BD first-email flow; R-158/159/160/161 and the three stalled-send flaws remain.

## ▶▶▶ START HERE — `main` HAS EVERYTHING; THE OWNER ASKED TO PAUSE AND RESUME IN A NEW CHAT
**State:** `main` = #302 + #303. 204/204 suites on Node 22 AND Node 26.10.0 at #302. The dev branch `claude/great-heisenberg-jekres` equals `main`; no PR open; nothing waits on a deploy except the owner hard-refreshing and looking.
**What the owner has just been given (Session 41, D-0084, R-151…R-156):** "Needs you today" and client-conversation windows show only that item's own mail (the leak was `/email/history?candidate_id=` pulling lead-engine mail) and carry a "What to do" band — Reply / Chase / Follow up / **Move to <next stage>** (candidates; leads for BD/admin when the lead is loaded) / Mark completed / Not today · My Team opens on **Reports**, one **Team** tab · **Reply & Forward are a dock window** (minimise, go elsewhere, come back; a draft is kept on the DEVICE) · **visual signature editor** · **interview time zone by city** (`ivTzSearch`) · leftover old-look controls (Leads filters, stage/Valid dropdowns, Send all pending, job funnel, candidate status + ID chip, kanban) moved to the kit + **one font scale** (20 → 9 distinct sizes; `retro.css` end). Details: CONTEXT_ARCHIVE "SESSION 41", `docs/territories/surface.md` 2026-10-07.
**FIRST THING TO DO IN THE NEW CHAT — ask the owner (plain words, then build):**
1. *How does it look live?* Hard-refresh; try a "Needs you today" row, a Reply, the signature editor, an interview's time zone, the kanban at night. Anything still off → a screenshot (the font/look audit only measures screens it can load).
2. **R-149 NOTIFICATIONS** (the owner's next topic; today the bell only jumps to Reminders — `04-shell-login.js` `.tb-ico`): (a) WHAT to notify — suggested: a reply came in · a send finished or some failed · a lead assigned/taken · a reminder due/overdue · an applicant applied; (b) WHERE — the bell list first (free; recommended) · an email digest from the person's own mailbox · phone push later (new cost); (c) per-person on/off by kind (recommended; D-0022). Reuse: the "needs you today" queue, reminders (`services/reminder-source.js`), the send summary, the applicants queue. Respect who-sees-what (D-0034/36) and "a screen must not advertise what does not exist".
3. **R-150 industry playbook groundwork** (D-0083, noted not started): move the recruiting-specific hard rules (no fee %, no call ask, placeholders, one sign-off, no naming the reader's job) from `outreach-generator.js` / `sequence-draft.js` / `candidate-outreach.js` checkers + `ai-style.js styleBlock` into ONE named "Recruiting playbook" data block (no screen yet). After notifications, when a second industry is near.
**Offered, not built (owner's call):** save reply drafts into the Gmail/Outlook **Drafts folder** (today: device only) · the rest of the retro redesign (see "NEXT CHAT — CONTINUE THE RETRO REDESIGN" below: Today in the list | record | decide layout, then Leads, Jobs, Candidates, Inbox, Admin).
**Honest limits (repeat to the owner):** drafts are on one device; real mail speed is unmeasurable here; whether the Azure app registration must list `MailboxSettings.ReadWrite` is unverified (if an Outlook connect fails after deploy, set `MICROSOFT_EXTRA_SCOPES=` empty on Render); the live deploy has never been seen from the sandbox; self-assigned leads are in the lead's activity log, not a report column; candidate outreach's AI is not covered; brand purple on its own tint measures 3.8–4.2:1 (owner's call); some date-seeded tests may break on later dates (pin the browser clock); the roadmap artifact mirror (`NQ4HUuMfAWJk34g9Vs5EdQ`) was NOT updated for R-134…R-156 — `docs/ROADMAP.md` wins.
**Standing rules that bit (keep):** a guard must fail when the thing is absent — show it failing; never edit files during a full-suite run; **a new paper surface must be added to the `html :where(#content :where(…))` list in `retro.css` or its text is unreadable at night**; Playwright `click()` scrolls first; write memory as work lands; merge only on the owner's word; after a squash-merge restart the dev branch from `origin/main` and push with `--force-with-lease`.
**Session 40 in one paragraph (details in the archive):** retro look + sky header + search everything (#294); eight fixes (#295); team-work reports + "where this comes from" + Add lead + sequence builder (#297); ten a page, Sent folded into All email, faster Inbox with labels, Primary sequence (#298); dark-mode sweep, Outlook label colours, job row, RA/Admin Insights (#299); AI writing-style note, Sequence = Outreach Plan, Take leads (#300).

## ▶ NEXT CHAT — CONTINUE THE RETRO REDESIGN (R-122) — START HERE
The owner chose a **90s-retro look on top of the AI** and is building it with you step by step, judging by screenshots of the REAL app. Not an engineer: show pictures, ask in plain words with choices, build after they react. No helper agents without their words (D-0060).
- **The design is `docs/design/PACE.ds`** (the owner's Headspace-style format: tokens, components, do/don't) + `docs/design/pace-design-sheet.png`. Decisions: **D-0072** (no Duck Hunt scoreboard; the WHOLE app follows day/night), **D-0073** (default for every customer; build step by step), **D-0074/D-0075** (search built; owner asked to merge 1–2 now to try it). The concepts they loved (cream paper cards, hard purple shadows, sky header, list | record | decide layout, green-screen activity log) are described in PACE.ds and the R-122 roadmap row.
- **Where it lives:** `public/retro.css` (loaded AFTER theme.css; removing its `<link>` in index.html restores the old look). Tokens: day/night palettes restated twice like theme.css; **`--canvas`/`--shelf` are the dark grounds at night — `--bg` stays cream because it is also the groove INSIDE cards**; `--on-canvas*` for text straight on the canvas; `--sun` = the one primary action; `--st-go/stop/wait/info` muted state fills; `--mono` / `--pixel` / `--pixel-label` fonts (self-hosted in `public/fonts/`). Clock: `index.html` head script + `paceClockTheme()` / `paceSkyPhase()` in `04-shell-login.js` (same hours, pinned by `theme-clock-smoke`). Header: `renderTopbar()` → `.tb-sky` (orb/clouds/stars, clipped), `.tb-head` (pixel title + `#tb-clock`), `paceTodayChips()`, `paceSearchBox()` (63-global-search.js), `paceHeaderNew()`. Sidebar: `renderSidebar()` groups My Day / Sales / Recruiting (`GRP_CLS`), `NAV_PIXEL_ICONS`, Setup under the name card (`toggleSetup`), open by default ≥1100px and pushing `#main`.
- **STEP 3 (remainder — the eight fixes above are done):** the shared kit — selects/filter buttons (still Session-23 rounded tan), stage pills and the blue "Contacts 1" chips, round coloured avatars (design: square), the "Needs you today" rows (their buttons overflow on a phone), drawers/modals, the login backdrop (a canvas, still blue dots — it must be TOLD the palette, `loginPalette()` in 11-bind), dashboard tile numbers (`STAGE_COLORS` blues). Then **STEP 4:** Today rebuilt in the list | record | decide layout (the concept: id tab on cards, stage trail, AI match bar as ONE masked element, Send to client / Not a fit / Needs detail, checks, CRT activity log), then **Leads** in the same pattern (company list | lead with contacts + email history + AI brief | Write email / Find contact / Release to pool), then Jobs, Candidates, Inbox, Admin. Phone version of each as you go.
- **How to show it:** the screenshot harness from Session 39 was in the session scratchpad (gone) — rebuild from `scripts/screens-fingerprint.mjs`'s seed (enterApp + seeded STATE, light/dark via `localStorage pace-theme`, `page.clock.install` for a time of day, `pace-rail` for the sidebar). Show before/after side by side.
- **Owner-side right now:** hard-refresh the live app and try it (new colours, sidebar, sky header, search). Their reactions decide step 3's details.

## ▶ SESSION 39 (2026-10-06) — what shipped (merged in #294)
Retro redesign **step 1** (palette, square paper, hard shadows, self-hosted fonts, **Auto/Light/Dark by the clock** — the toggle flips what's on screen; landing on the clock's mode = Auto, saved as `'system'`), **step 2** (sky top bar by clock phase, pixel titles/logo, sidebar by business with pixel icons, "Dashboard" → "Today", RA "Insights" → "My Numbers"), the **tall sky header** (date line, Today's "N NEED YOU"/"N PAST DUE" from real data only, "+ New Job"/"+ New Candidate" by desk, clouds, stars, sun/moon arc), and **R-123 search everything** (`GET /search`, `routes/search.js`: candidates/leads/jobs/clients each gated exactly like its own list, scope in SQL before the limit; the header box with ⌘K). Owner corrections folded in: night was "too much purple" → cream cards on a dark grid; the sidebar and header to match the concepts. New tests: `theme-clock-smoke` (28), `search-everything-smoke` (18), `search-box-smoke` (13); updated on purpose: `mobile-layout-smoke`, `recruiter-dashboard-smoke`, `team-structure-smoke`, `ownership-smoke`, `poc-people-search-ui-smoke`. **179/179 on Node 22 AND Node 26.**

## ✅ WHAT'S LEFT (details in `docs/ROADMAP.md`)
- **The redesign:** step 3 and step 4 above (R-122). Search over emails/notes/résumés is NOT in R-123 (owner may ask).
- **Owner-side:** try the new look; re-assign the 37 repaired leads (R-117) if not done; share the apply link (R-008); reconnect the two dead mailboxes below if still dead.
- **Next, owner's call:** R-121 phone text scale (now part of the redesign's step 3/4) · **R-096 Boolean search** · R-110 Stage B · R-053 contact-finder remainder.
- **Before a SECOND customer:** **R-067** per-company API keys, **R-049** a PACE-operator role, R-016 CSV import for candidates.
- **Known gaps (by design):** search by an extra email/phone on the Candidates list; recognising a reply from an extra address; `processPendingEmailSends` is not mounted in any test.

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only**, written **as the work lands** (D-0024) —
a section per round, the closing synthesis last.

A **SessionStart hook** injects the working protocol and a **Stop hook** blocks
finishing with memory unwritten (`node scripts/memory-check.mjs`, D-0027).

## 📋 `docs/ROADMAP.md` — THE LIVE LIST (D-0030)

Every suggestion made to the owner is a row there, **written in the same turn**.
`PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`; nothing deleted;
**`CHANGED` keeps both versions.** "What's left?" → read the file, group by who
is blocked. Mirror every change to artifact **`NQ4HUuMfAWJk34g9Vs5EdQ`**
(`ArtifactData`; collections `items` = open, `shipped` = finished).
**⚠ The page shows only three `lane` values — `me`, `owner`, `decide`.** Any
other lane is INVISIBLE (three rows were, until 2026-09-26). A finished row gets
`status:"done"` in `items` AND a document in `shipped` (`when`, `ref`, `title`,
`sub`; `changed` uses `was`/`now`/`why`); lower `ord` = higher on the page.
**The file wins any disagreement.**

## 🧭 `docs/territories/README.md` BEFORE ANY JOB

Nine territories + `dispatch`. `DECISIONS.md` = what the owner settled (check
before proposing); `CAPABILITIES.md` = what PACE already does (grep before
building); `_contracts.md` = cross-border requests. **`node
scripts/territory-map.mjs` after adding any file** — it caught three orphaned
services on 2026-09-25 (`client-intel`, `lead-posting` → observatory;
`company-daily-cap` → harbour).

## What PACE is

A recruiting **ATS + lead-management SaaS**. Fute Global is a customer. The
owner is the product owner and end user — plain English, screenshots, the live
app; never code or git (`CLAUDE.md`, top).

## What is live right now

Leads engine (import → distribute → **AI-written** first email → template
follow-ups → reply sweep → recycle), the ATS, the outreach generator, candidate
outreach, the in-app mailbox, reminders / "needs you today", the public apply
page, ownership + take-over requests, failed-send retry (D-0031), the rewind
clock, client/lead email timelines with the AI summary button, **several emails/phones per candidate and lead contact (Make main)**, **the retro look (day/night by the clock, sky header, sidebar by business), search everything (⌘K)**, **search inside a job's candidates (job page and Pipeline)**, **an expired sign-in that returns you to where you were**. Billing and
self-serve signup built and **off**.

### Session 32 added (all merged, all live) — the owner said "do all these" (D-0047)

- **#246 R-037** — a **dead-mailbox warning** on all three dashboards
  (`services/mailbox-alerts.js`, `GET /mailboxes/alerts`,
  `60-mailbox-alerts.js`): which mailbox, why in plain words, how many emails
  wait behind it, Reconnect for its owner. Gmail now records refresh failures
  too. **Two are dead today:** kristy.scott@fute-global.com (Microsoft withdrew
  permission, AADSTS65001, since 21 Jul) and probably princethomasfute@gmail.com
  (no refresh since 24 Sep). **R-050** — the two backup tables are empty and
  now locked (migration 049); dropping them is offered, not done. **R-039** —
  both sending domains pass SPF/DKIM/DMARC (futeglobal.com DMARC `p=none`).
- **#247 R-051 done** — "Your client conversations" card under "needs you
  today" (`61-client-digest.js`, `GET /client-intel/digest`), plus a manager's
  **facts-only** team roll-up (D-0040/D-0043: no AI, no email text).
- **#248 R-006/R-001/R-002** — **Reports now live at the foot of the
  Dashboard**; the Reports page and nav item are gone. Submissions are counted
  from **stage history** (`countSubmissionsEver`) — D-0029's under-report is
  closed on tiles, hot jobs and the report alike. **Time in stage** card
  (`timeInStage`, stuck = 14+ days).
- **#249** — retired `/bd-analytics/*` (R-005) and `/ai/generate-email`
  (R-007); **Integrations card** keeps a typed key across redraws and says when
  a tested key is unsaved (R-030 — it was wiping the box); model hints derived
  from the provider table (R-031); **Anthropic quality model was retired**
  (now `claude-sonnet-4-6`; that account also has **no credit**); **OpenRouter
  free picker was choosing music models** (fixed, cache versioned);
  **migration 050** — dropdown words unique per company (R-048); `GET /clients`
  `can_edit` hides document Upload/Delete from non-owners (C-0029); **record
  drawer panes were see-through** (5.5% opaque in dark) — now solid.

### Live switches (read from the DB 2026-09-26 — rows that exist)

| setting | value | meaning |
|---|---|---|
| `sys_client_intel_enabled` | **1** | email timeline ON |
| `sys_client_intel_ai_enabled` | **1** | AI summary button **ON** (D-0047) |
| `sys_engine_ai_first_email` | **1** | AI writes first emails |
| `int_ai_active` | **groq** | Groq leads the chain (gpt-oss-20b / 120b — confirmed working) |
| `ai_daily_token_cap` / `call_cap` | 400,000 / 400 | org's daily AI allowance |
| `followup_send_time` | 18:30 | when follow-ups are QUEUED (IST), not sent |
| *no row* | defaults | `company_daily_first_emails` 2, sending hours 8–16 lead-local |

**⚠ A setting with no row reads its schema DEFAULT** (`config/settings.js`) —
read the default before saying what a switch is set to.


## Migrations — next is **057** · 056 APPLIED 2026-10-05 (candidates + contacts `extra_emails`/`extra_phones`, alt_phone copied) · 055 APPLIED 2026-10-02 (open tracking) · 054/053 2026-09-28
**SQL/migrations are pre-approved by the owner in principle (D-0047)** — still state a destructive customer-data change first, ask for a fresh go before touching the live DB, apply a migration BEFORE merging the code that uses it, and prove a schema change in a rolled-back probe.

## 🧪 TESTS: 204 SUITES (Node 22 and Node 26.10.0 both 204/204 on #302). Newest (Session 41): `reply-window-smoke`, `signature-editor-smoke`; extended `trace-smoke`, `email-history-replies-smoke`, `interview-timezone-smoke`.
`npm test` — read the COUNT; never pipe into `tail`. `bash test/verify-frontend.sh` too. Newest (Session 38): `contact-points-smoke`, `candidate-contact-points-routes-smoke`, `lead-contact-points-routes-smoke`, `contact-points-ui-smoke`, `lead-contact-cp-ui-smoke`, `candidate-outreach-optout-smoke`, `job-page-candidate-search-smoke` (25), `session-expiry-resume-smoke` (20), `job-page-phone-smoke` (10), `utility-classes-smoke` (7). **Every new check was run against the broken code and failed there**; a guard that cannot see the thing FAILS rather than passes.

## Owner actions outstanding
- Reconnect kristy.scott@fute-global.com and princethomasfute@gmail.com (dead mailboxes) if still dead; share the apply link; paste job postings on leads (R-056). Optional: drop the two empty backup tables; drop `backups.contacts_r117` once satisfied. Google sign-in still needs `GOOGLE_CLIENT_ID`/`SECRET`.

## ⏸ Parked — do NOT re-raise as blocking
`DECISIONS.md` is the authority: pricing `null`, signup off, no timezone backfill, no attachments on candidate email (D-0012), reassignment only by request (D-0036–38), documents designed later (R-052), R-057 later (D-0046), no "new version ready" notice (D-0069).

## Traps that will bite you
- **`*.onrender.com` is blocked from this sandbox** — a merge lands, a deploy is **unverified**. Check `app_settings` `cron_last_*` rows for signs of life; never claim you watched it come up.
- **Sandbox Node 22, Render Node 26** (download `nodejs.org/dist/v26.10.0/node-v26.10.0-linux-x64.tar.xz` into the scratchpad). Works-here-fails-there → get Node 26.
- **The top bar is a render region that repaints when its html moves** (date line, counts). Anything typed in it must live in STATE (the search box does: `STATE.gsearch`), and a focus handler must ignore `STATE._rendering` (the repaint putting focus back is not a click).
- **A guard is vacuous until you watched it fail** — and a green suite is not a screen: look at the screenshot. A suite only covers the screens it renders (R-094's search test only opened the Pipeline page while the job page's own list had none).
- **Registration order is load-bearing** in every router (`route-shadowing-smoke`). **Every reader of a stored email body calls `renderStoredEmail`.**
- **A lead row opens without `render()`** — anything inside it fills its own element by id, never re-renders.
- **A squash-merged branch conflicts with `main` on its own files** — after a merge, restart the dev branch from `origin/main` (`git checkout -B <branch> origin/main`), push with `--force-with-lease` pinned to the old remote sha.
- **Never `git add -A`**; never pipe `git push` into `tail`. `node scripts/territory-map.mjs` regenerates `docs/territories/island.html` and `_map.json` — commit them with the change.
- **Secrets live in `app_settings` (`int_*_api_key`)** — never echo them (query `length(value)`, never `value`).
- **Hard-coded AI model names expire** — five so far. Check the live `ai_last_test` row's `available_models` first.
- **This sandbox cannot measure smoothness** (software compositing) — say how it FEELS is the owner's call.
