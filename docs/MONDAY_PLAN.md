# Monday execution plan — PACE (prepared 2026-10-01, nothing executed)

## Context
The owner has ~7% of their weekly allowance until **Monday 2 PM** and asked for a detailed plan to review; on Monday they say "go" and I execute. They sent three new problems (R-108, R-109, R-110) plus a screenshot pair; I added R-111. The full sorted open list (23 rows + 3 to check) is already in `docs/ROADMAP.md` § PRIORITY ORDER and on the roadmap page (artifact `NQ4HUuMfAWJk34g9Vs5EdQ`). This plan says HOW each row is executed, in what order, how it is proven, and where the owner must decide. Everything is explained to the owner in plain English — no code shown, no GitHub chores asked of them.

**Standing rules that bind this plan:** no helper agents without the owner's yes (D-0060) — I do the work directly on Sonnet; before any agent I say what for and what it costs. Dev branch `ccr-63ed4fab-omfwgz`; draft PR #282 (docs only) is open; merge only after the owner approves by reacting to it (D-0062). A migration is applied BEFORE merging the code that uses it, and never to the live DB without the owner's fresh go. One full `node test/run-all.mjs` (read the count, never pipe it) + Node 26 before any merge. Memory written as the work lands (territory memory + `docs/CONTEXT_ARCHIVE.md` + ROADMAP row + page mirror).

## What the read-only investigation found (2026-10-01)
1. **There is only ONE candidate drawer.** Every click on a candidate — in a job's Pipeline, in lists, from the mailbox — goes through `bdOpenCandidate` (`public/js/30-page-candidate.js:40`). So the in-job path cannot be a separate résumé code path.
2. **The current code never puts a Supabase address in the résumé frame.** The drawer fetches the file through PACE (`/candidates/:id/documents/:docId/file`, `routes/recruiting/candidates.js:332`) and shows it from a local blob (`30-page-candidate.js:133-156`, Download + Try again). It opens on **Résumé** whenever a résumé or extracted text exists (`:405`). The job candidate search box is `28-page-pipeline.js:287`.
3. **The owner's screenshot shows the OLD behaviour** (an iframe pointing at `…supabase.co`, Activity tab first, no search) — all three R-110 symptoms match the pre-Session-36 code. The strongest explanation: the owner's browser tab was opened before the deploy, and PACE is a single-page app that never reloads itself; or the Render deploy lagged/failed. **This is a hypothesis, not proven.** (I could not reach the live site from the sandbox.)
4. **R-111 root cause (likely):** Gmail's `snippet` field is HTML-escaped by Google. It is used raw as the preview (`gmail-provider.js:292`, `services/mail-provider.js:258`) and the screen escapes it again, so `<` shows as `&lt;` and `'` as `&#39;`. Microsoft's `bodyPreview` is plain, so only Gmail mailboxes are affected.
5. **R-108:** the opened message body is a fixed-height frame (`public/ui.css:669-670`: 420 px, `short` 260 px); it only fills the pane when ONE message is on screen (`.mb-thread.solo`, `:677-687`). In a 6-message thread (the owner's screenshot) it stays small. The frame must stay a sandboxed iframe (CLAUDE.md mailbox rule).

## Monday, in order

### Step 0 — start-of-session (≈2k tokens)
- Read top of `docs/CONTEXT_WINDOW.md`; Sentry `search_issues` on `pace-backend`, tell the owner what it shows.
- Ask: **re-enable the daily error-check routine** `trig_01TFL3dY7C9jDaTXmZR55Jee`? (paused on their yes). Only on their word.
- Ask the owner to approve merging docs PR #282 (it only holds the notes and the lists).

### Step 1 — R-110 (P1) · Sonnet · medium · ≈15–25k
1. **Owner test first (costs me nothing):** ask them to hard-refresh (Ctrl+Shift+R, or close and reopen the tab), open the same candidate from inside the same job, and tell me: does it open on Résumé? does the résumé show? is the search box above the candidates?
2. **If fixed** → it was a stale tab. Record it, close R-110 as "stale tab, not a bug". Then offer the small product fix this exposes (new row **R-112**, ≈10k): the app tells people "A new version is ready — Refresh" (check on window focus / next API reply via a build id header — NO timer, NO pinger: Render is on the free tier and a repaint on a timer is banned).
3. **If NOT fixed** → reproduce the owner's exact sentence in Playwright (`test/helpers/enter-app.mjs`): seed a job + a candidate with a PDF résumé, open from the job's Pipeline and from the job's drawer Candidates tab. Check each of the three symptoms separately: (a) the frame source is a `blob:` address, never `supabase.co`; (b) the first tab is Résumé; (c) the search box exists on every in-job candidate view. Fix at the root (likely candidates: a second place that renders job candidates without `plSearch`; the document list failing so `resumeDoc` is empty and the tab falls back to Activity — add the same "ask twice" the Résumé card has). Ask the owner for a screenshot of Render's latest-deploy status if the deploy itself is suspect (I have no Render connection).
4. **Proof:** the new/updated guard must FAIL with the fix reverted (rule: reintroduce the bug and watch the guard fail); `node --check`, `bash test/verify-frontend.sh`, targeted candidate/pipeline smokes, then one full suite.
5. Memory: ROADMAP R-110 → DONE/CLOSED with the finding; `surface.md`; archive; page mirror.

### Step 2 — R-108 + R-111 · Sonnet · low · ≈8–15k
- **R-111:** one small decoder for the HTML entities Gmail leaves in `snippet`, applied where the preview is built (`gmail-provider.js:292`, `services/mail-provider.js:258`) — one helper, no second copy. A pure test with the owner's two examples (`&lt;neil.patrick@futeglobal.com&gt;`, `what&#39;s`) plus `&amp;`, `&quot;`, numeric entities; stored rows already saved with entities are fixed on read, not by a data migration.
- **R-108:** in a multi-message thread give the opened message a much taller body (fills the pane, with a sensible minimum) and add an **expand to full screen** control that reuses the existing window/full-screen mechanism from R-079 if it fits, otherwise a simple toggle. Keep: sandboxed iframe, `#mb-open` paint region untouched on idle repaints, phone layout (`mobile.css` — hover gating, nothing overflows), all themes (opaque float `--card-solid`).
- **Proof:** screenshots desktop (dark + light) and phone width of a 6-message thread with the open message; `mobile-layout-smoke`, `page-renders-smoke`, the mailbox smokes; **how it FEELS is the owner's call** (this sandbox cannot measure smoothness) — I send the screenshots and a plain-English summary.
- Memory: `surface.md` + `harbour.md` (preview text), archive, ROADMAP, page.

### Step 3 — chore: tidy the roadmap · Sonnet · low · ≈5–10k
Move rows that are DONE out of the "waiting" sections; verify R-071/R-072/R-076/R-053 against #262 and later (read the code/tests, not guess); correct statuses; mirror to the page. No code.

### Step 4 — R-107 ARCHITECTURE.md · Sonnet · low→medium · ≈10–15k first pass, 25–40k full
- **Pass 1 (index, from existing notes):** root `ARCHITECTURE.md` with the eight sections — (1) what's in the system, (2) who's responsible for what (the nine territories, "one home" modules), (3) why (index into `DECISIONS.md` by D-id, not copies), (6) never-break (points to the CLAUDE.md rules), (8) stop-and-ask rule written once: **STOP → name the conflict → show what it affects → suggest the smallest fix that doesn't break it.** CLAUDE.md gets one line pointing to it.
- **Pass 2 (only on the owner's yes — reads code):** (4) the layering direction (browser → routes → services → `models/` → Supabase; banned crossings: browser filtering, hand-written `supabase.from()` on tenant tables, direct outbound HTTP outside `http-client.js`, AI outside `ai-provider.js`, a second email pipeline), (5) four end-to-end flows (lead→email→reply→recycle · applicant→candidate→submission · send pipeline · signup/login/provisioning), (7) an "adding X → put it in Y" table.
- Proof: every file path named in it exists (a tiny script check), links resolve. Memory: foundry/ledger-free — docs only; archive + ROADMAP + page.

### Step 5 — R-109 several emails/phones per candidate (+ R-014) · design chat then build
**Design chat (Sonnet · low · ≈5k) — plain-English questions to the owner, answered before any code:**
1. One **main** email/phone plus extras — which one do emails go to by default, and can the recruiter pick?
2. Duplicate detection: should a candidate be flagged as already existing if ANY of their addresses/numbers matches?
3. Résumé upload: pull every address/number found in the résumé, or only the first (then offer the rest to confirm)?
4. Where shown: Add Candidate, Edit Candidate, the drawer header; and does the candidate-outreach batch send to the main only?
5. Phone: also capture at lead import (R-014), or candidates only for now?
**Build (Opus · high · ≈50–80k) — only after the answers:** guild (record, forms, parser), deep (**migration 055**, `models/tables.js` entry if a table, backfill from the existing single fields), observatory (résumé parser), harbour (which address a send uses). **Gates:** apply 055 to the live DB only with the owner's fresh go and BEFORE merging the code; org-scoped through `db.forRequest`; RLS on any new table. One **independent reviewer** (rampart for scoping, foundry for tests) at the end — about 10–20k — offered with a cost note and only on the owner's yes.
**Proof:** unit tests for duplicate matching across all addresses; scope tests (another org's candidate never matches); browser suite for Add/Edit; Node 26 full suite.

### Step 6 — R-096 Boolean search · design chat then build
**Design chat (Sonnet · low · ≈8k):** syntax (AND / OR / NOT, "quoted phrases", brackets) · fields searched (name, title, skills, résumé text?) · where the box lives (Candidates tab, Recruiter and BDM profiles) · saved searches? · how a bad query is explained in plain words. **Build (Opus · high · ≈50–90k):** a server-side search (never in the browser) that respects who-sees-what (`viewScope`, D-0034/35/36 — narrow in SQL before any limit; unseeable → 404); reuse `plFilterRows` (`28-page-pipeline.js:203`) only for the in-browser case. **Proof:** a parser test table (precedence, brackets, malformed input), a scope test, a 1,000-row performance check, screenshots.

### Later (not scheduled; each needs the owner's go) — see the table in `docs/ROADMAP.md`
R-067 (per-company keys, Opus·high, before a SECOND customer) · R-049 (operator role) · R-016 CSV import · R-053 remaining slices · R-004 · R-003 · R-061/R-062 (Apollo, spend credits) · R-057 · R-013 · R-017 · R-054 · R-052 · R-015 · R-011/R-008/R-074 (owner's).

## Order and budget
Steps 1–2 fit inside 7% (≈25–40k ≈ 2–3%). From Monday 2 PM: 3, 4, then 5 (design chat) and 6 (design chat) back-to-back so the owner can answer both in one sitting, then the two builds. Rough: rows 1–6 ≈ 15% of a weekly allowance; R-067 + R-049 ≈ 11% more. Estimates are mine (Session 36's measured rate: ~14k tokens ≈ 1%).

## Verification for every step
`node --check` on touched files → targeted suite for what I touched → screenshot (desktop dark/light + phone) → ONE full `node test/run-all.mjs` (count read, not piped) + the same on Node 26 (`nodejs.org/dist/v26.10.0/…`) before a merge → `bash test/verify-frontend.sh` → `node scripts/memory-check.mjs` → commit (stage named paths, never `git add -A`) → push to the dev branch → draft PR → tell the owner in plain words what changed and what to check on the live app → on their yes, merge and confirm it deployed.

## Where the owner is asked (and only here)
Step 0 (routine on/off, merge docs PR) · Step 1 (hard-refresh test) · Step 2 (does the bigger box feel right) · Step 4 (go for pass 2) · Step 5 (five design questions, migration go) · Step 6 (design questions) · any agent use (what for + cost first).
