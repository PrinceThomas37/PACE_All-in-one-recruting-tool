# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file).

**Updated**: 2026-10-20 (Session 51 closing). **Highest ids:** decision **D-0168** · contract C-0038 · roadmap **R-299** (next `R-300`) · next migration **068** (067 `scheduled_sends` APPLIED 20 Oct by the owner in the SQL editor; read back: 14 columns, row security on).

## START HERE (Session 51, 20 Oct) — what is live, what waits

**LIVE (owner approved, merged, deployed):** #353 (keys per company R-067, PACE operator role R-049, per-company emergency stop, org bounces R-243) · #354 (server-waking message + retry, whole-percent Assign, Assign skips contact-less leads R-289, Needs-you rules R-290, speed/memory R-291 part 1 incl. the reply-sweep change) · #355 (continue AND save Gmail/Outlook drafts R-287, per-company AI diagnostics R-288a, Find leads list no longer times out + search + expiry note R-293, outside click minimises a message window R-294, Conversations switch, recruiter Sequence tab + optional My Setup step R-295, "Rejected lead" chip, client digest chunks parallel). Reply sweep: ~15 s (was 54–155 s), first runs error-free; **a real reply caught by the new code is not yet seen — check, revert the sweep change if one is missed.** Save/Continue draft are fakes-only tested: owner's first live try is the test.
**DRAFT, NOT MERGED (owner rule D-0167: never merge unless the owner says so, every time):** PR #356 = database-move tooling (`scripts/db-move/`, `.github/workflows/db-move.yml`, runbook, `test/db-move-guards-smoke.mjs`). Its full Node 22 + 26 runs were killed twice by server restarts and are NOT complete — rerun before it is ever offered for merge.
**THE PLAN (D-0168, pending the owner's word "Singapore"):** one move next month into the PACE accounts, Singapore for server + database; domain `paceconsultant.in` exists and `app.paceconsultant.in` serves the app. No Ohio stopgap.
**Waiting on the owner:** (1) "Singapore" for both; (2) yes to set `PUBLIC_BASE_URL=https://app.paceconsultant.in` on Render (R-296); (3) reconnect `ash@futeglobal.com` and `ash@vhcstaffing.com` Gmail (R-298); (4) try Save draft / Continue writing and Find leads on the live app; (5) older items below (OPERATOR_EMAILS before a second company, Apollo questions to send, R-205 key, paid always-on server).
**Ready when asked:** R-297 region setting in the copy tool; R-299 slim jobs list; R-288b `OPERATOR_EMAILS`.

## START HERE (Session 50, 19–20 Oct) — the owner's "Changes to be done next" doc

**Releases.**
- **#348 MERGED and LIVE** (`e7c2979`, Render live 21:14 UTC 19 Oct): Batches 1–2 — settings crash (R-284), NUL in resumes (R-267), our replies seen by the digest / Needs you (R-268), inline images (R-274), Leads strip follows filters + per-person page size (R-279/R-280), dismissed reminders 7 days (R-281), Finder for everyone (R-276/R-283 card text), fresh manager sees only "Finish your setup" (R-283).
- **#351 = Batches 3 + 4, owner approved (D-0164: "Nothing [is off]. Push it live", "Merge it after the check").** Set to merge once the Node 22 and Node 26 full runs pass on the final head. **First thing next window: check `main` contains #351's merge commit and Render (`list_deploys`, service `srv-d7avlfali9vc73fk4ov0`, workspace `tea-d7av4bnfte5s73d0o3ng`) deployed it; if not, finish it (merge if green; `trigger_deploy` if Render got no event).** The work lives on branch `claude/busy-darwin-fbkb3b` (built in worktree branch `batch3-wip`).

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
