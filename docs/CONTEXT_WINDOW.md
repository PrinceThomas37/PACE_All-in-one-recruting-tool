# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file). The previous version of this file (Session 60) is kept whole at the end of the archive.

**Updated**: 2026-11-04 (Session 61, end). **Highest ids:** decision **D-0208** · contract C-0038 · roadmap **R-392** · next migration **075** (nothing new applied this session). Main = `721c0a2` (#399) **plus the docs-only PR that carries this file**. Live: #396, #397, #398, #399 are all deployed (Render service `srv-d7avlfali9vc73fk4ov0`, last deploy live 16:26 UTC). Full suite **355/355 on Node 22 and Node 26.11.1**.

## START HERE — the owner continues in a NEW chat. Read this block first.

**Who the owner is (again, because it matters):** product owner and end user, NOT an engineer. Does not read code or use git. Evaluates by using the app, screenshots and screen recordings. Short answers. **"Ask me if you have any doubt, do not assume."** **"No shortcuts — we are building for the future and scaling, not for today."** Wants the uncomfortable answer first, confidence tagged ([Certain]/[Likely]/[Guessing]), no agreement openers (their saved preferences). Every reply ends with one line: what was skipped or not checked. The owner prefers **fewer, bigger merges**: batch several safe changes into ONE change so the 35-minute two-version run happens once (they said so on 4 Nov).

**This window ended by design with NOTHING of the list below built** — the owner chose to write it all down and work it in the next window.

### What was merged this session (all live)
- **#396** warm-up: R-375 (Gmail mailboxes count as connected; Start checks the right sign-in), R-376 (a paused / auto-paused / blocked mailbox is out of the warm-up pool — engine and screen).
- **#397** R-377 ("Needs you" snoozes/drops no longer return next day — the day counter was in the fingerprint; clears made before are in the old format and return once), R-378 (expired Google sign-in sentence no longer says "in testing"; the Google app IS published).
- **#398** R-360 (open-rate card note "opens are undercounted", only when emails were tracked), R-373a (`/health/deep` asks the database one question, 503 when it does not answer; `/health` stays the cheap "ok"), R-371a (every response carries `X-Content-Type-Options: nosniff` and a Referrer-Policy), 13 stale roadmap rows corrected.
- **#399** R-379 (Assign screen counts only follow-ups the engine will really queue — ONE shared rule `services/followup-queueable.js`, D-0205), R-382 (mailbox warnings have **Close** with no timer, the Dashboard banner reads the same closes and says how many, a manager gets **Close for me** on a teammate's failed email — D-0206).

### The full list for the next window (everything the owner gave on 4 Nov, in the order I recommend)

Each row is in `docs/ROADMAP.md` with the full text. **Nothing below is built.**

| # | Row | What the owner asked | State | Model |
|---|---|---|---|---|
| 1 | **R-387** | Stop guards failing LATE: update guards in the same change, `--bail`, quick suites first | decided — build FIRST | Sonnet |
| 2 | **R-390** | Remove the "First emails: reply rate AI vs template" table from Outreach Insights; keep the numbers; then update the 17 Nov reminder `trig_01Gq1Nxdb5Eyc2aZspRnrzN8` | decided (owner "Okay") | Sonnet |
| 3 | **R-392** | "Show everything" on the Jobs table does nothing (video 2) | bug — REPRODUCE first, no test covers it | Opus |
| 4 | **R-391** | Opening a client flickers between drawer and list with a ghost layer (video 1) | bug — REPRODUCE first | Opus |
| 5 | **R-388** | "Email this client": pick the client's contacts, add a new contact (name + email) then send | decided | Sonnet |
| 6 | **R-383** | Read ALL versions with an arrow: My Setup (first email + follow-ups) AND per-step versions in the Sequence builder, random pick per lead | decided ("both") — the biggest piece (data model + engine) | **Opus** |
| 7 | **R-384** | Delete a sequence: removes it, stops its people, confirms with the number; sent emails stay | decided | Opus (stops real people) |
| 8 | **R-385** | Remove the "Enrolled leads" list; each sequence says "N people in it now" + **Stop all** | decided | Sonnet |
| 9 | **R-386** | Edit a running sequence freely: wording of steps nobody has reached; structural change makes a copy | decided — design carefully | **Opus** |
| 10 | **R-389** | Email button + Email history tab on EVERY client the person can see | owner said "yes" — **a reversal of D-0035/D-0020, confirm the exact rule first** (question 1) | **Opus** (permissions) |

**Suggested batches (one two-version run each):** A = R-387 alone (tool change, do it first so every later run fails fast); B = R-390 + R-388 (small, UI, safe together); C = R-392 + R-391 (both reproduce-first bugs in the render path — fix at the cause, add tests that fail on the bug); D = R-383..R-386 (the sequence engine — one design, built together, because deleting, stopping and editing all depend on how steps and people are stored); E = R-389 after the owner answers question 1.

### Open questions only the owner can answer (ask these first, one at a time, plain words)
1. **R-389 — who may email a client?** The owner said "yes" to "every client you can see, or the Email history tab" (read as both). Confirm: should **everyone who can see a client** be able to email it and read its Email history — including a manager looking at a teammate's client? From whose mailbox does it go (the sender's own — assumed)? Does the client's owner see those emails in the record's history (assumed yes)? This reverses "only the owner emails the client" (D-0035) and "managers review and prompt, never reach in" (D-0020).
2. **R-380 — the 129 leads with no first email on record** (assigned 8 Oct: BD Lead 2 63, BD Lead 1 57, Ash Sayyad 2; 6 Oct: 7). Re-queue their first emails (month-old leads; the bounce rate is already high), release them to the pool, or leave them? They may have been emailed by hand — nothing in the app can tell.
3. **R-391 — the flicker:** does it happen on every client or only some (the recording is Concept 8, LLC, owned by BD Lead 2)? Which browser?
4. **R-392 — Show everything:** only the Jobs table, or other lists too (My jobs cards, Email → All mail)?
5. **R-390 — Outreach Insights cards** read "—" and "Loading…" in the screenshot (people emailed, opened, replied, bounced, by sequence). Did they stay like that, or was it a half-loaded capture?
6. **R-384 / R-385 — defaults I will use unless told otherwise:** deleting a sequence keeps its past numbers in Outreach Insights by sequence; **Stop all** also cancels that sequence's already-queued (pending) emails.
7. **Which model** to start the next window with — see the suggestion below.

### Model suggestion for the next window (said once, plainly)
[Likely] **Start with Opus for the sequence engine batch (R-383..R-386) and the permission change (R-389)**, and for the two reproduce-first bugs (R-391, R-392). These are the places where a mistake is costly or hard to see (a data model that stores versions per step, the engine picking one at random, stopping real people, widening who can email a client, a repaint loop in the render engine). **Sonnet is enough for the contained, well-tested pieces** (R-387, R-390, R-388, R-385) — they follow patterns already in the code and each has a clear test. Cost note: do R-387, R-390, R-388 first on Sonnet (cheap, fast), then switch to Opus for the rest. [Guessing] I have no measured difference between the two on this codebase; this is a risk-based judgement, not a benchmark. The owner decides.

### Things only the owner can do (not code)
- Ask the three mailbox owners to **reconnect** once (ash@vhcstaffing.com, prince.thomas@futeglobal.com, ash@futeglobal.com — Google's 7-day limit applied to sign-ins made before the app was published).
- **Start warm-up on a second mailbox on another domain** (e.g. vhcstaffing.com) — with one mailbox in the pool nothing sends.
- **Clear the Needs-you list once** (clears made before #397 returned once) and check it stays cleared tomorrow.
- Look at the Deliverability card (open-rate note) and the Assign window (no follow-up number for leads with no first email) on real data — **none of this session's changes has been seen on real data yet**, all proof is tests.
- Around 17 Nov: the R-353 reminder (first-email replies before/after the switch).

### Still open from earlier (do not lose)
**R-368** inbox-placement test + domain check (decided, not built; sends real test mails — needs the owner's go on frequency) · **R-369** bounce rule, the ADMIN sets every number (D-0123/D-0204) · **R-380** (question 2) · **R-381** why the daily follow-up run fired at 19:57 IST not 18:30 (not investigated; likely the server was asleep/restarting) · **R-371 rest** (content-security policy, anti-framing, narrower CORS — each can break a working screen, owner's go) · **R-373 rest** (request id on every log line; nothing calls `/health/deep` on a schedule) · **R-372** per-user limit on the signed-in API · **R-374** key rotation + privacy page wording · **R-361** Hunter adapter from public docs (owner holds NO key, D-0175) · **R-349 Stage E** (Assign screen and Compose still load the whole list) · **R-370** banner gaps (needs a column = migration + go) · **R-344 / R-307** Google sign-in shows the personal Gmail (waits for the move to company email) · **R-306** leftover (source-name tidy, the owner's 78-row file) · **R-326 / R-345 / R-340-filter / R-329** · **mirror `docs/ROADMAP.md` to the online roadmap artifact `NQ4HUuMfAWJk34g9Vs5EdQ`** (collections `items`, `shipped`) — NOT done this session (CLAUDE.md asks for it).

## Rules and lessons that cost something (keep)
- **Test gate (owner's standing rule):** nothing merges without a clean full run on **Node 22 AND Node 26.11.1** (`node test/run-all.mjs`, read the count, never pipe it), and **nothing else may run on the machine during it** (parallel runs made `login-load-fail` and `screen-stability` miss timing windows; I also do NOT edit repo files during a run). `~/run-both.sh` runs Node 22 then Node 26 (logs `~/logs/n22.log`, `~/logs/n26.log`; Node 26.11.1 at `~/n26dl/node-v26.11.1-linux-x64`, download from nodejs.org if missing); the failing detail is printed at the END of the log. Killing the parent leaves test children alive — list pids then `kill` them (never `pkill -f` with the script name). A run takes ~35 min for both. 355/355 is the current count.
- **A guard that fails on an INTENTIONAL change is working — update it IN THE SAME CHANGE** (R-387). Before a long run, grep `test/` for the text/behaviour you changed. Two guards bit this session late (`mailbox-control-smoke`, `failed-close-smoke`).
- **Prove every new guard by reintroducing the bug (mutants) and watching it fail** — keep doing it. A mutant that does NOT fail means the test cannot see that line (the close-for-me route has two boundary layers, so only removing both fails; the "no first email" line is subsumed by the date check). A test that cannot measure must FAIL, not pass.
- **Migrations:** never applied without the owner's fresh go. Pattern that worked: trial inside a transaction that ends in `RAISE EXCEPTION 'TRIAL OK …'` (rolls back) via `execute_sql`, then `apply_migration`, then read back the grants.
- **Git:** this session's dev branch was `ccr-67e794db-dr330l` (the platform names it per session). NEVER force-push. **After a squash merge ONLY**, merge the remote branch history back with `git merge -s ours origin/<branch>`, push fast-forward, open the PR, mark ready, squash-merge. **If the branch's PR is NOT yet merged, never use `-s ours`** — it drops the unmerged commits (this session reset one such mistake). Never `git add -A`.
- **Reading the live database is allowed and was useful** (Supabase `execute_sql`, project `teiqievahzhllojvgsku`, SELECT only; Render logs via `list_logs`). Writes, migrations and anything outward need the owner's go.
- **Org-scoping guard:** a route block counts as guarded only if it contains `withOrg`/`forRequest`; keep scoped lookups in services. New literal routes go above `/:id` (`POST /emails/failed/close-for-me` sits above `GET /emails`).
- **No number limiting a customer is typed in code (D-0123)**; every customer brings its own keys (D-0055/D-0175); the engines (follow-up, sweeps) are shared across companies → manual runs are PACE-operator-only (`isOperator`).
- **What the screen shows and what the engine does are ONE rule (D-0205):** `services/followup-queueable.js` — lead still Assigned, contact may be emailed, the FIRST email on record as sent, due counting from that real send. A screen must never promise what the engine will refuse. The engine still does quota and the double-send guard itself.
- **Close, not hide (D-0206):** closes are per person, no timer, fingerprinted (state + when the mailbox last worked); the warnings block and the Dashboard banner read ONE store (`mba_hide_<user>`); the count of closed items is always said. A teammate's failed email can be "Close for me" — hides it for that person only, never touches the sender's row (D-0020).
- **Mailbox rules (D-0201/D-0203):** Pause = outreach only (sequences, bulk, candidate outreach, warm-up); Block = locked, stops EVERYTHING sent from it and warm-up; only an admin Unblocks. Delete is refused when mail is on record. Pool membership for warm-up = active + warming/opted-in + live sign-in for its OWN provider + not paused/blocked.
- **Lead list design (D-0202):** scope decided FIRST; ordering `created_at DESC, id DESC`; keyset bookmark; one trigram GIN on `jobs.search_text`; falls back to the in-memory list if a function is missing.
- **Client store facts:** server mode switches on only after the first page answers (`STATE.lv.on`); every successful write to `/jobs|/leads|/distribute|/ownership-requests|/contacts|/companies` re-fetches the page in place; `jobById()` looks in the working set first; sign-out resets everything.
- **Render engine:** a page module never writes `#content` itself; a repaint on a timer is a repaint under the user's hands (relevant to R-391).

## Housekeeping in the sandbox (may not exist next time)
`~/run-both.sh`, `~/logs/`, `~/n26dl/`. The scratchpad holds mutant backups and the frames extracted from the owner's two recordings (`.../scratchpad/sheet_v1_1.jpg`, `sheet_v2.jpg`) — disposable. Everything of value is in main. To read a screen recording: `ffmpeg -i <video> -vf "fps=6,scale=480:-1,tile=4x4" -frames:v 1 sheet.jpg`, then Read the sheet.
