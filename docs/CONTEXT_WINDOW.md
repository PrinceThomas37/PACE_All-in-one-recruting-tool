# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file).

**Updated**: 2026-10-26 (Session 53). **Highest ids:** decision **D-0179** · contract C-0038 · roadmap **R-324** (next `R-325`) · next migration **068** (none added this session).

## START HERE (27 Oct, end of Session 53) — the 28-note doc: P0, P1, P2 done; the owner continues in a NEW chat

**Read first:** `docs/PLAN_2026-10-26_28_NOTES.md` — the owner's 28 notes, the P0–P4 ranking, the model/cost answer (agents save
context, not money; Haiku `scout` only for read-only look-ups; Opus on mail/data/security/AI), what shipped in which PR, and the
rulings D-0174…D-0179.

**Live:** #368 (P0), #369 (P1 + client-owner rules + sign-in survives a slow server + reminder → lead), #370 (R-324 speed step 1 +
R-322) — live 27 Oct 02:42 UTC. **P2** (R-316 Outreach Insights click-through + D-0179 bounce split, R-317 interview emails per
person with the client copy + résumé, R-318 mailbox Undo / Star / Pop out / resize) — the P2 PR merges after its clean-worktree runs.

**Next, in the owner's order:** (1) read Render `[SlowReq]` for GET /jobs after a working day on #370; if loads are still 15 s+, plan
R-303 (a list that never loads everything); (2) **plan R-321** (contact data from any provider — ~370 Apollo references in 17 files;
needs vendor docs + a customer key per vendor) and bring the plan to the owner before building; (3) P3 (R-319) items; then R-320 on
top of R-321. Small open bugs: R-306 (95 vs 78 import), R-163 (stalled retry sweep).

**Working rules learned this session:** one PR at a time on the session branch (stash the next piece); full suite on Node 22 AND 26
from a clean `git worktree` of the exact head; screenshots before claiming a screen is right.

## START HERE (26 Oct, Session 53, very last) — #369 merging (clean-worktree runs); R-324 speed step 1 built, next PR

R-324 step 1 (lead-list cache: skip unrelated writes, shared load, parallel pages, 5-min copy) is built and tested in the working tree, committed only after #369 merges, on the branch restarted from main. Then: re-read Render [SlowReq] for GET /jobs after it is live; if still slow → R-303.

## START HERE (26 Oct, Session 53, last) — D-0177 managers open jobs (owner's pipeline); D-0178 reminder → your lead

Both built on #369 with tests; #369 waits on the owner's "merge" (it now carries P1, D-0174/0176/0177, R-323, R-309/D-0178). Find Leads ownership left as D-0111 — owner told it is my reading; re-open if they meant ownership at save time.

## START HERE (26 Oct, Session 53, late night) — sign-in bounce fixed on the branch (R-323); server load is R-324

D-0176: admin's part in clients is control, not opening jobs — D-0174 stands for admins (managers same, as built). Ash's "Log In sends me back to login" = a busy server failing one first-load call and PACE signing her out; fixed on #369 (keep sign-in, retry once, Try again screen). The root cause — GET /jobs 17–32 s, +100 MB per call, a listener leak warning — is R-324, plan first. #369 still waits on the owner's "merge". R-309 (Martin): the "Add as a lead" idea was mine; owner asked where it came from.

## START HERE (26 Oct, Session 53, evening) — P0 LIVE (#368), P1 built on the dev branch (R-315)

**Owner's rulings 26 Oct:** D-0174 — only a client's owner opens jobs for that client, any number, any time (anyone else, admin included, refused; built on this branch, replaces #368's looser R-311). D-0175 — no contact-data vendor hard-wired; every company brings its own (R-321, plan first). Martin (R-309) explained; owner to answer. P0 merged and deployed (21:25 UTC). P1's six items are built with tests (see R-315 / surface.md 26 Oct): reminder Reconnect button, email-address links → PACE compose, inbox day headings, earlier-message attachments, job status note, "What went out" counts on Sent. **Next after P1 merges: P2 (R-316 Outreach Insights drill-down, R-317 interview emails, R-318 undo/pop-out/resize/star).** Owner still owes answers on: Martin's "Add as a lead" button (R-309), the own-client reading of the cooldown (R-311), and Apollo compose (R-320).

## START HERE (26 Oct, Session 53, later) — the owner's 28-note doc: P0 built, P1 next (R-308…R-320)

**The doc** ("In find leads", 28 notes) is on the ROADMAP as R-309…R-320 by priority. **P0 is built on the dev branch** (R-310…R-314: industry filter + search, Find Leads dropdown repaint, re-search guard, second job for own client, signature "Replace" box, Gmail bounces) with tests; R-309 (Martin) was a manual reminder, not lead generation — the owner's call. **Next: P1 (R-315)** — reconnect button on the reminder, email address → PACE compose, inbox grouped by day, client attachments in a thread, notes on stage change, Sent split into first/FU1/FU2. **Model team (R-308):** I build small things directly; a Sonnet agent only for a big feature AND only with the owner's yes (D-0060) — they asked about cost and were told agents save context, not money. New read-only Haiku `scout` agent. Surface memory trimmed to 38 KB (`surface-archive.md` holds the rest). **Owner to-do from P0:** re-open My Setup → their mailbox → Save once (the stored signature still has the old phone until rebuilt). Seen: prince.thomas@futeglobal.com is connected under THREE PACE users.

## START HERE (26 Oct, Session 53) — assigned leads never come back; 95-vs-78 import is OPEN

**D-0173:** the owner ruled "once a lead is assigned it's assigned" — the 30-day auto-return sweep is removed (dev branch, not merged until the full run is green). 76 leads it had already returned (23/25 Sep) were soft-deleted in the live DB at the owner's word (undo in `docs/territories/deep.md`). **R-306 OPEN:** the owner imported "78" but 95 landed in ONE insert today; asked for the 78 companies / the file. Do not delete any of the 95 without that answer. Owner's word: "very dangerous" — find the cause, do not guess.

## START HERE (22 Oct) — DO R-304 FIRST when the owner asks

**The one-day measurement (D-0171) is in.** Crash watch CLOSED: no server_failed/restart since 20 Oct 22:15 UTC, peak 302 MB. But **[Certain] GET /jobs got SLOWER after R-301/R-302**: 7-10 s before → 13-20 s typical, worst 57 s; memory per load unchanged (+60-150 MB, so the job-description trim did NOT save memory as predicted); and a 304 "not changed" still costs 15-20 s because the server cache (60 s) is older than the 3-min poll, so every check rebuilds the list (3 sequential trips to Seoul from the 500-row batching + a sha1 of the whole list on 0.1 CPU). **R-304 is the fix** (one read again + 5-min server cache; see ROADMAP). Then re-read `[SlowReq]` (`list_logs` text `*SlowReq*`).

**Top slow things (21-22 Oct):** 1 GET /jobs (every tab every 3 min, 13-20 s); 2 GET /mailbox/unread-count (the most frequent, 3-8 s, worst 44 s); 3 the sign-in burst (~15 small requests at once — /next-actions, /ai/morning-briefing, /client-intel/digest, /insights/bd/:id — each 8-13 s): CPU starvation on the free 0.1-CPU server. After R-304 the owner's choice is R-303 (paged lead list, free, big) or the $25/mo Standard instance (10x CPU). Be plain: code alone will not fix #3 on the free server.

## START HERE (21 Oct) — speed work released; WAITING ONE DAY FOR MEASUREMENTS (D-0171)

**Released 21 Oct (both after Node 22 + 26 full runs, owner: "merge once the test is passed"):**
- **#363** (2d54c6b) R-301 — the Jobs list carries no pasted job description (7.7 MB of 8.7 MB of research text; GET /jobs had grown the server 65-110 MB per load). Read in pages (`services/lead-list.js`), `posting` summary instead, text loaded per lead on demand (`22-api loadLeadPosting`), saves from a list copy keep the stored text (`lead-posting.keepStoredPosting`).
- **#364** R-302 / D-0170 — sign-in no longer downloads every SENT email (4,421, read by no screen); GET /emails look-ups in parallel; GET /jobs answers 304 "not changed" (`services/list-tag.js`, `22-api apiGetJobsList`); `[SlowReq]` log for any request ≥3 s; list batch 500.

**THE OWNER'S CALL (D-0171): wait one day, read what is slow, then decide.** Build nothing more for speed until then. The scheduled check `trig_01UBp12zL5oHbvPtWRd5zTUF` (22 Oct 10:40 UTC, fires into this session) does the final crash verdict AND ranks `[SlowReq]` / `[MemWatch]` lines (`list_logs` text `*SlowReq*`, `*MemWatch*`) with one recommended next step. A NEW session: do that reading yourself. Candidates it will choose between: R-303 (server-paged lead list — the lasting answer to a very big database), R-292 (database out of Seoul), or whatever the numbers show. Day-1 crash check (21 Oct) was clean: no restart, peak 242 MB.

## START HERE (Session 52, 20 Oct) — the crashes are fixed; "Needs you today" reworked

**The owner's report:** "PACE did not answer properly — the server may be waking up" appearing mid-use, then "very very slow". **Root cause (found with a watcher, not guessed):** a new `Intl.DateTimeFormat` per row (native memory, never freed) — `/insights/bd` alone took the server 170 → 542 MB. Fixed in **#360** (`services/date-format.js`, one formatter per kind; `test/date-format-smoke.mjs` bans the old pattern). Owner after release: "its working fine right now"; memory ~155 MB after Today (was 464–549 MB). **RULE: never `new Intl.DateTimeFormat` / `toLocale*String({timeZone})` in server code.**

**Released this session (all MERGED and LIVE, Node 22 + 26 full runs green before each):**
- **#357** (409925d) R-296 / D-0167 — "did we reply?" learned in the background: the reply sweep reads each Gmail/Outlook Sent folder (`services/sent-sweep.js`) and keeps our replies to people who wrote to us as outbound `conversation_messages`; no list asks a mailbox while it loads.
- **#358** (60a68ea) R-297 / D-0168 — owner's order on Needs you today (group first), positive replies owed after 2 days, Interview / Submission rows, owed replies kept in today's list, sent mail back to 90 days a slice per visit.
- **#359** (6429803) R-298 — memory watcher (`services/memory-watch.js`): `[MemWatch]` lines in Render logs name the requests / engine jobs running above 380 MB and any request growing memory 60+ MB. Read with `list_logs` text `*MemWatch*`. Leave it on.
- **#360** (fc69dc8) R-298 — the fix above.
- **#361** (b13d76d) R-299 + R-300 / D-0169 — the app asks once for everyone's mailboxes (`GET /users-emails`, was once per person); **Needs you today holds only what is owed**: replies we owe, interview / submission steps, reminders a PERSON set, promises that came due. No "No reply yet" tiles, no sequence-made reminders (`reminder-source.isSequenceMade`), the "move them forward?" row folded into the candidate's reply row; `nudge_quiet_after_days` removed. Also fixed: a pipeline row's snooze keyed per candidate (payload lacked `submission_id` / `step`).

**FIRST THING NEXT WINDOW:** `list_events` (service `srv-d7avlfali9vc73fk4ov0`, workspace `tea-d7av4bnfte5s73d0o3ng`) since 2026-10-20T22:15Z for `server_failed` / `oomKilled`, and `list_logs` text `*MemWatch*` — tell the owner plainly whether any crash came back. A two-day crash watch is scheduled in this session (owner: "keep it on for 2 days and see if there is any crash. If not close it"): day 1 on 21 Oct 10:40 UTC (`trig_01YMqGj17MV3vSaUL6dZG3G7`), final on 22 Oct 10:40 UTC (`trig_01UBp12zL5oHbvPtWRd5zTUF`) — no crash → say "sorted" and stop; a crash → name the cause from the watcher and propose the fix. If you are a NEW session, do the check yourself anyway.

**21 Oct — R-301:** the Jobs list no longer carries each lead's pasted job description (7.7 MB of 8.7 MB of research text; GET /jobs had grown the server 65-110 MB per load). Read in pages, text loaded per lead on demand (`services/lead-list.js`, `22-api loadLeadPosting`). `/emails` was measured — 2.9 MB in total, not heavy; it only appeared in MemWatch alongside /jobs. **Still open:** the database in Seoul (R-292, decided: after the current outreach). Not covered by the sent sweep: Zoho / IMAP mailboxes.

**Owed by the owner (say it plainly, once):** a paid always-on server before other customers use PACE (D-0163/D-0165; the $25 Render "Pro" WORKSPACE adds no memory — the Standard INSTANCE, $25/mo, 2 GB, does); R-205 `MAILBOX_SECRET_KEY`; `WEBSITE_LEADS_ORG_ID` on Render.

## Process lessons from Session 52 (read before building)
- **Measure inside the process before naming a culprit.** Hours went on R-268 because crashes followed its bursts in time; one watcher line (heap 50 MB, rss 540 MB → native memory) found the real cause in minutes. Render keeps no request log for this service — the watcher is the only way to see what ran.
- **Never `git reset --hard origin/main` over a pushed notes-only commit.** Notes written after a merge and pushed to the dev branch were overwritten three times this session by the next reset; they had to be rewritten at the close. Put notes in the PR before it merges, or merge a notes PR.
- **When the owner says "don't screw up", ask which tiles stay before building** — the answer (D-0169) changed what was removed.
- A row's serialized copy of an item (`data-na-item`) is a whitelist: a new field the buttons need must be added there, or the window and the snooze silently lose it.

## THE TO-DO LIST (owner asked for it; read `docs/ROADMAP.md` for the full rows)

*Decided, build later (owner's go needed to START each):*
- **R-287** continue a Gmail / Outlook draft inside PACE (owner: "yes, build it later", D-0164).
- **R-250** several sequences per person, one Primary for sales.
- **R-246 / R-254** the AI learns from the user's own emails and workflow.
- **R-247 / R-248** plain-words detail picker; what happens when a detail is missing.
- **R-260** candidates: "let the AI read each resume" switch (one credit per candidate).
- **R-255** a plain automatic reply (no return date) stops the follow-ups.
- **R-256** the test email built exactly like a real lead's first email.
- **R-252** "why they are hiring / how long open" as a usable detail.

*Fixes and safety (not started, no go given):*
- **R-241** a "blocked" bounce must not mark a good contact Invalid · **R-242** bounce auto-pause misses small senders · **R-243** the bounce lookup has no org filter.
- **R-204** numbers still typed into code (7-day reply look-back, the generator's draft counter default).
- **R-206** a window that closes and reopens still blinks.
- **R-262 / R-263** marked DOING from Session 47 (new user's first sign-in; login glitch after sign-out) — **check whether they are actually finished** before anything else is said about them.
- Tidy-up: the dead `tmplHtml` (old My wording editor) in `public/js/07-page-email.js` and its helpers are computed and unused since D-0161.

*Parked by the owner:* **R-253** real count of matching candidates in client emails.

## Process lessons from Session 50 (read before building)
- **A decision that removes a screen is not done until that screen's old TESTS have been run** — they list what it did (R-286 found three lost controls and three dead buttons that way).
- **Building a layout "as drawn" must not drop what the drawing did not mention** (the morning briefing vanished for six roles until the full run caught it).
- **Look at screenshots of every new screen before showing the owner** — they caught three bugs the suites passed (an archive count that said 0, a panel below the window's edge, "To —").
- The engine runner treats a job's `skipped` field as "nothing to do": never name a counter that. `execCommand('fontSize')` reports success and does nothing inside the app window.
- `pkill -f "node test/"` (or `run-all.mjs`) kills your own shell command too — its text matches. Use the PID.
- Supabase `apply_migration` may be cancelled at the permission step: the owner can paste the file into the SQL editor; always read the table back afterwards.
- Run the Node 22 and Node 26 full runs one after the other, on the exact head being merged; never merge on targeted suites.

**Render facts learned this session (read these):** the Render tools (`list_services`, `list_deploys`, `list_events`, `list_logs`, `get_metrics`) work and are read-only; service `fute-lms-backend` = `srv-d7avlfali9vc73fk4ov0`, workspace `tea-d7av4bnfte5s73d0o3ng`, free plan, 512 MB (one OOM kill 14 Oct 16:00 UTC; normal use ~230–265 MB). **`trigger_deploy` was denied on 14 Oct, allowed on 15 Oct** — the owner starts a deploy by hand (Manual Deploy → Deploy latest commit) or adds a permission rule. **A Render incident (19:32–22:18 UTC, 14 Oct) paused deploys for free services**: #337 merged at 20:53 UTC and never deployed on its own, the app instance vanished ~21:30 and a restart did not bring it back until 22:19 (the static website kept working because it needs no instance). After an outage, check `list_deploys` — a merge during the pause deploys nothing. **15 Oct: #340 did not auto-deploy with NO incident (Render got no event at all) — after every merge, check `list_deploys` for the merge commit; if missing, `trigger_deploy` (allowed on 15 Oct). Sandbox curl to onrender.com is blocked; use Firecrawl or the Render tools.** `status.render.com/incidents/<id>` is readable.
