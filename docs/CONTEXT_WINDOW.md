# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file).

**Updated**: 2026-10-20 (Session 50 closed; #351 merged). **Highest ids:** decision **D-0164** · contract C-0038 · roadmap **R-288** (next `R-289`) · next migration **068** (067 `scheduled_sends` APPLIED 20 Oct by the owner in the SQL editor; read back: 14 columns, row security on).

## START HERE (Session 50, 19–20 Oct) — the owner's "Changes to be done next" doc

**Releases.**
- **#348 MERGED and LIVE** (`e7c2979`, Render live 21:14 UTC 19 Oct): Batches 1–2 — settings crash (R-284), NUL in resumes (R-267), our replies seen by the digest / Needs you (R-268), inline images (R-274), Leads strip follows filters + per-person page size (R-279/R-280), dismissed reminders 7 days (R-281), Finder for everyone (R-276/R-283 card text), fresh manager sees only "Finish your setup" (R-283).
- **#351 MERGED** (`bd71a25`, 03:04 UTC 20 Oct) after Node 22 and Node 26 full runs were both 283/283 on head `0d91ca4`; **LIVE 03:05 UTC 20 Oct** (Render log: "Your service is live", deploy `dep-dbbdkh59fdbs73e256p0`). Batches 3 + 4, owner approved (D-0164). The pre-merge run found and fixed: dark-mode Today tiles unreadable, a manager's Reports link looping to Today, the builder preview signing with the profile name instead of the sending email ID (archive, 20 Oct).

**What #351 holds (all on screen and tested; screenshots were shown to the owner):**
- **Batch 3:** the new sequence builder is the one door for every sequence (named sequences for leads and candidates, AI on/off for candidates — R-269/R-270, D-0158/D-0159); candidate drawer opened from a job shows that job + stage-move notes under Notes (R-275); lead split equal by default and never above an email ID's daily limit (R-277); manager Today and Outreach Insights as drawn (R-278, D-0160 — morning briefing kept, it was never removed); "My wording" / "AI style" moved into the builder (R-285, D-0161) with nothing lost: per follow-up same thread / new email, Rewrite with AI, spam check (R-286).
- **Batch 4 (inbox):** conversations by default + switch saved per person (R-271); All inboxes with each row labelled (R-272); full formatting bar, Reply all on every message, Schedule send (date + time in the person's zone; free server can send late overnight — D-0163), Scheduled tab (+ reminders) and Draft tab (R-273). The three mailbox sends live in `services/mailbox-send.js` (one path, shared with Schedule send); engine job `scheduled_sends` (`services/scheduled-sends.js`).
- New suites: `mailbox-threads-smoke`, `mailbox-threads-ui-smoke`, `schedule-send-smoke`, `sequence-builder-wording-ui-smoke`, `batch3-screens-smoke`, `outreach-insights-smoke`, `sequence-v2-smoke`.

**Owed by the owner (say it plainly, once):**
1. Try #351 on the live app (Ctrl+Shift+R; free server takes ~30 s to wake): a real conversation reply, All inboxes, one Schedule send to themselves (it may go late if PACE is asleep), a new named sequence.
2. **R-205:** a fresh 64-hex `MAILBOX_SECRET_KEY` on Render, then one live Zoho app-password test.
3. Earlier, still owed: `WEBSITE_LEADS_ORG_ID` = `92cf97db-d216-483a-8cc4-7ecae575415b` on Render (website booking form → PACE lead); a real labelled send (R-244) on the live app; a first real AI-written email seen and checked.
4. **Paid always-on server before other customers use PACE** (owner, D-0163).

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
- **R-288** the live server reports 13 known security holes in outdated add-on code (1 critical) — check which are reachable, update, full runs, release.
- **R-241** a "blocked" bounce must not mark a good contact Invalid · **R-242** bounce auto-pause misses small senders · **R-243** the bounce lookup has no org filter.
- **R-204** numbers still typed into code (7-day reply look-back, the generator's draft counter default).
- **R-206** a window that closes and reopens still blinks.
- **R-262 / R-263** marked DOING from Session 47 (new user's first sign-in; login glitch after sign-out) — **check whether they are actually finished** before anything else is said about them.
- Tidy-up: the dead `tmplHtml` (old My wording editor) in `public/js/07-page-email.js` and its helpers are computed and unused since D-0161.

- The shared to-do page (artifact `NQ4HUuMfAWJk34g9Vs5EdQ`, collection `items`) is BEHIND the ROADMAP: it stops at R-218, plus R-287/R-288 added 20 Oct. Rows R-219…R-286 still need mirroring (one batch of ≤50 per call).

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
