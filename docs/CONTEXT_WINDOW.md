# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file).

**Updated**: 2026-10-22 (Session 52 closed). **Highest ids:** decision **D-0172** · contract C-0038 · roadmap **R-304** (next `R-305`) · next migration **068** (none added this session).

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
