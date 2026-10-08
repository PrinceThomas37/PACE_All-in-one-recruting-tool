# What the owner decided, and when

**Read this before proposing anything, and before treating anything as a bug.**
The territory memories record what the code *does*. The archive records what
*happened*. This file records **what the owner chose** — which is the only one
of the three that can make a perfectly good suggestion the wrong thing to say.

The owner is the product owner and the end user. A decision here outranks any
engineering opinion, including a well-argued one. If you think a decision is
wrong, the move is to say so **once**, in plain language, with what changed —
never to quietly work around it or re-litigate it in a later session.

---

## How to use this file

**Before you propose work:** grep it. If your idea is already `PARKED` or
`DECLINED`, do not raise it as new — unless its **Re-open when** condition has
actually been met, in which case say which one and why.

**When the owner decides something:** write it down **immediately**, in the same
turn, not at the end of the session. That is the entire point — a decision that
only exists in a chat window is lost the moment that window closes, and the next
session either re-asks a settled question or silently undoes it.

**Statuses.** `STANDS` — in force. `REVERSED` — the owner changed their mind;
the entry stays, with a pointer to the one that replaced it. `PARKED` — agreed
in principle, deliberately not now. `DECLINED` — asked and refused.

**Ids.** `D-` plus the next number. Allocate it, do not eyeball it:

```
grep -oE '^### D-[0-9]+' docs/territories/DECISIONS.md | sort -u | tail -1
```

**Never edit or delete an entry.** A reversal is a NEW entry that names the old
one; the old one's status line changes to `REVERSED` and nothing else. The
record of having believed something is part of the record.

**Newest first.** New entries go directly below the marker line, so a reader
gets the current picture without scrolling.

**Quote them.** The `Their words` field is the primary evidence and the reason
this file is trustworthy. A paraphrase drifts; a quote does not. If the decision
came from a screenshot or a reaction rather than a sentence, say that plainly.

---
<!-- NEW ENTRIES GO DIRECTLY BELOW THIS LINE -->

### D-0082 · 2026-10-07 · STANDS · The owner's answers on R-146, R-147, R-148 — and a real-world gap (Round 4 merged as #299)

The owner: *"1. Can the AI's writing be edited? No — enable it. I want AI to write the emails the way I want it. Even in the first sequence itself. 2. Yes. BD can edit their own wordings inside the step. 3. A — because today I thought of importing a list of leads directly into BD user profile. But did not find a way to send the outreach."*
**Decisions:** (R-147) build the place to tell the AI how to write — it must reach EVERY AI-written email including the first one of a sequence, not just "Write with AI"; (R-146) merge Outreach Plan into Sequence, and a BD edits their OWN wording inside a step even without permission to change the sequence's shape; (R-148) option A — a BD takes leads for themselves, capped per day, into their own connected mailboxes. **New requirement found in the same breath:** a BD who IMPORTS a list into their own profile has no way to start the outreach — closing that gap is part of R-148, not a separate wish.

### D-0081 · 2026-10-06 · STANDS · Merge Outreach Plan into Sequence, and a place to edit how the AI writes (R-146, R-147)

The owner, mid-round: *"sequence and outreach plan are mostly the same right? so why cant we kind of merge them as one and the outreach plan will come up when the user edit the sequence … first plan and then implement."* And: *"do we have an option of editing the AI written emails right now, like edit the prompt by which the email is written. if yes, where? and if not make space of that too."*
**Facts found:** no screen edits the AI's instructions (the old `aiPrompt` box is dead code since R-007); Sequence → "Write with AI" takes a one-line instruction per email; the lead engine's first email is the person's saved template, rewritten by the AI with fixed code-side instructions when it is on. **Decision:** a PLAN first (shown to the owner), build after their yes; the AI note is a request, never able to switch the machine checks off.

### D-0080 · 2026-10-06 · STANDS · The owner's answers after round 3, and fourteen new points (R-132 … R-145)
**Their words (answers):** job-row blank space → *"interviews this week, quick actions, best-matching candidates"* · Outlook label colours → *"yes, since none of the outlook is connected now, if any has to be connected they will be connected after this"* (i.e. ask for the extra `MailboxSettings` permission at the next connect) · RA/Admin Insights restyle → *"Yes"* · "+ New" → *"Keep it same, if permission is not there, it should be greyed out"* (keep it on every page; a person who may not create the thing sees it greyed, not hidden).
**Their words (new points, five screenshots, 6 Oct):** (6) *"Can a BD assign lead to themselves, to the email ID assigned to their user profile? If yes, how would we design that, merging it with the current assigning design"* · (7) *"When the pace logo is clicked, the left hand side tab minimizes, but do not goes since the mouse is on the tab, but the background page pushed to the left thus covering the area, can you remove that minimize effect, i think its not required now, since we are doing the retro style now"* · (8) *"when the PACE is clicked, can we have an animation where PACE gets typed. increase the purple contrast for PACE, now it looks dull"* · (9) *"the email still loads a bit slow for the first time, once its loaded, it switches mail boxes easily, but not the tabs within, like from inbox to sent to spam and all, it still takes 3 secs"* · (10) *"in dark mode, when its activated, things written there are not visible"* (My Team header: "5 direct reports · 12 in your reporting line" and the Overview / Team Insights / Reports tabs) · (11) *"these information are still shown. its not required. i miss the simplicity in the UI"* (Email page: Upcoming OOO Returns, Today's assignment summary, Pending send schedule) · (12) *"these details are not readable in dark mode. the visibility issue is persistent across the UI"* (All email filter row: All / Received / Sent / Every kind / Lead outreach / One-off / Candidate batch; also the assignment summary card) · (13) *"when some button in the email tab, in compose, or in pending, or all email, or outreach (like i click on follow up-2 button) the page resets to up, like it don't reload, but scrolls up automatically"* · (14) *"1- overlaping, 2nd is blank space. maybe we can align this preview to the middle in between the space, that its equal on both sides"* (Outreach Plan preview overlaps the left column at its left edge and leaves a blank strip on the right).
**Chosen:** all of the above are to be done next, in this order of care — the dark-mode visibility sweep (10, 12) is cross-cutting and is the one the owner says is persistent ("across the UI"), so it is done as a SWEEP with a guard that fails when text has no contrast in the dark palette, not screen by screen.

### D-0079 · 2026-10-06 · STANDS · A "Primary" switch on a sequence pre-selects it in Start sequence; the editor says upfront when people are mid-sequence; Today no longer carries the per-person table (R-131)
**Their words:** *"do we have option to make primary outreach sequence, like a enable button, left to right. which make a sequence primary and will be used for the next outreach"* — asked "pre-select, start automatically, or both?", the owner chose **"Pre-select it"**. · *"What does this error means? I am not able to edit the sequence."* (screenshot: "Save failed: Workflow has 3 active enrollment(s) — exit or complete them before editing steps.") · *"i dont need this table on the opening page of the dash board, the user can see this report in the report section right?"* (screenshot: Work by person)
**Chosen (and built):**
- **Primary = pre-select only.** One sequence per KIND of record (leads, candidates…) per PERSON is marked Primary with a left-to-right switch on each ACTIVE sequence card. "Start sequence" opens with **"Start with <Primary>"** as one big button, the others under "Or pick another". It never sends or enrolls by itself and does not replace the Outreach Plan's automatic follow-ups (automatic start would compete with them and could email one person twice — not chosen). Stored per person in `app_settings` (`wf_primary_<userId>`, no migration); a Primary later archived/drafted is simply not offered (and comes back on Reactivate).
- **The 409 is a safety rule, not a bug** (steps cannot change under people already mid-sequence). The editor now says so AT THE TOP with the number, disables Save, and offers **"Save as a new sequence"** (a draft; the old one carries on unchanged).
- **Today's Reports section no longer draws "Work by person"**; it stays in My Team → Reports (the same body), and a team lead gets a one-line pointer.
**Not decided:** "start automatically for new leads" (offered as "Both"; not chosen).

### D-0078 · 2026-10-06 · STANDS · Round 3: Sent folds into All email (both directions), a finished send is one line, jobs show ten people a page, the chart purple is softer, Lead Insights joins the kit (R-127)
**Their words (ten points, five screenshots):** *"Merge the above worked changes now"* · *"The candidate list inside a job keeps on scrolling down, i only need 10 candidate at once and then next page"* · *"there is a lot of blank space here … what information can we give here … lets brainstorm"* · *"the font are very small are not readable"* · *"the system should not show this every time after the outreach has completed … Once its done, this information is shows on the dashboard anyway. or just a small AI summary"* · *"Remove the sent tab from the email, all email will have both outbound and inbound list … the user can click just like now and can see the inbound and outbound emails in full"* · *"a lot of blank space … when no email has been created, this area looks off"* · *"The email takes a lot of time to load … there is no multiselect option to delete or label emails … the system should enable user to label emails"* · *"The purple colour in the graphs is very poppy … sometimes i feel like it should be there for the character"* · *"the lead insight page has not converted into our theme"*
**Chosen (and built):**
- **Merged #297** (round 2) on the owner's word.
- **A job's candidate list shows ten people a page** with Prev/Next (`25-workflow-bd.js`); "All" becomes "This page" (it never ticks people you cannot see — the 5 Oct rule); ticks survive paging; a search starts at page 1.
- **Sidebar section labels and other small pixel-font labels are bigger** (13px bold / 12px) — Silkscreen at 10px was not readable.
- **A send that finished cleanly is one quiet line** ("Send finished at 3:33 pm — 0 sent, 1 waiting · why"), self-clearing, never an hour-old run, and it does not come back on the next poll (the 30-second auto-dismiss used to be undone by the poll). The full panel stays for a send in flight and for anything that needs a person (failures, retries). The assignment summary no longer draws an empty column.
- **The Sent tab is gone.** "All email" holds what went out AND what came back: All · Received · Sent, a "Received" row names the sender and the mailbox it reached, and "Read the full email" fetches the whole reply live (never stored). Replies are visible by the email-ownership rule (a lead you OWN, or anything that reached YOUR mailbox; admin sees the company's) — decided in SQL.
- **The Outreach Plan editor has a live preview** where the right half was empty — filled in for a marked example person, signed by the mailbox picked above.
- **The Inbox is quicker to switch and can work on many at once:** a folder or message seen a moment ago comes back at once and is re-read behind the screen; hovering a row fetches the message ahead of the click; server folder lists are held 30s per mailbox and dropped on any change. Tick rows → a bar (Archive, Delete, Mark read/unread, Label…, Clear). **Delete is still only a move to Trash, bulk or not** (nothing here can destroy mail). Labels are Gmail's own labels and Outlook's categories (applied by name — needs no new permission).
- **The chart purple is the pastel one** (`tone-brand` #A894DB, in the family of the other chart tones); the brand purple stays on buttons and the logo. *This is a first answer to "I don't know" — it is a taste call the owner can reverse.*
- **Lead Insights (personal, team, one person) is on the shared kit** — same tiles, bars and columns as Reports; every bar says what it is on hover.
**Not decided / asked:** what fills the blank area in an opened job row (ideas offered, owner picks — R-128); the RA/Admin "Insights" page still has the old look (R-129); Outlook label *colours* need a one-time extra permission (R-130).
**Rule it sets:** a rule that decides who may see a reply lives in the SQL, not the browser; a list never rewrites itself under hands that have ticked it; the thing that finished shows one line, not a panel.

### D-0077 · 2026-10-06 · STANDS · The reports measure the team's WORK, every number shows its people, every to-do shows its emails, Add lead can add a company and many contacts (R-125)
**Their words (seven points, five screenshots):** *"The add lead page looks like old theme … no option of adding a new company name. No option to add another POC … No address bar of the company"* · *"No option to add the template or edit, and no option to write with AI when given the right prompt"* · *"this table shows whats pending … but when clicked on it, it does not show the email from which this information is inferred … how do we design the traceback system for these reminders and to-do list"* · *"The same for client conversation"* · *"Submission means a real submission to a manager or client, being added to the system or a job is not submission, thus this data is wrong. Also when we hover over the datapoints or click them nothing happens, it does not show the data from which this table is drawn. Same for all graphs and tables across all users"* · *"datasets being added to the system do not need to be evaluated, only the work thats being done by the team (every user assigned inside a team) needs to be evaluated"* · *"time in stage table … same as team's pipeline, same numbers but different tables and graphs, feels repetitive"*.
**Chosen (and built — items 1, 3–7; item 2 designed, not built):**
- **The definition (one rule, `services/report-work.js`):** work = a candidate REACHING a stage, counted on the day they first reached it, from the recorded stage changes — sent to the BD manager, sent to the client, interview scheduled, placed. Sourced and Screening are inventory and count for nothing. Not Accepted / On Hold are shown as where work ended or paused. This finishes D-0029: the 8-week trend, the per-person "Total"/"Fill %", the funnel's Sourced/Screening bars and "Candidates added"/"Open jobs" all counted rows put on jobs and are gone. "Placed %" is placements out of those sent to a client. Work is attributed to the person the candidate is assigned to (the stage log does not reliably record who moved them).
- **Everyone in the team is evaluated** — a person with no work shows 0, not nothing.
- **One table, not three:** the "Your team's pipeline" card is removed; time-in-stage lives inside the funnel rows (typical days, how many stuck).
- **Every number opens its people** (`GET /reports/recruiting/rows`, drawer `64-evidence-drawer.js`): tiles, funnel bars, trend columns, per-person numbers, hot jobs, top clients, "stuck" chips. The list and the number are the same rows by construction (`members()`).
- **Every to-do row opens its evidence** (`65-trace.js`): the rule in plain words, the emails it was worked out from (from the owner-only lead timeline), a reply readable in full, a reminder's own source; the old jump to the lead is a button in the drawer. Your client conversations the same; a teammate's stay facts-only (D-0040).
- **Add lead:** the shared form kit (retro look); existing company OR a new one (name, website, the full postal address — street, suite, city, state, ZIP, country — checked against yours first, never doubled) and as many contacts as the person has. **No migration:** the structured address columns already exist (migration 043, live); a first plan to add a single `address` column was dropped after reading the live table.
- **Sequence builder (item 2) — built after the owner's "Yes" (and "fix the template mismatch in the same round — Yes"):** an email step is a saved template (Outreach 1 / Follow-up 1 / Follow-up 2, by name) OR its own subject + body (the engine already sent a step's own text first), with merge-field chips, a live preview that MARKS a field PACE cannot fill (and saving is refused for it), "Edit a copy for this step", and "Write with AI" (`POST /wf/draft-email`, checked, one repair turn, then a ready-made starter that says it is one; "Start from an example" needs no AI). **The mismatch was a real bug:** a step's `initial` template was looked up as `initial_*`, which never existed (the person's own Outreach 1 is `o1`), so the live "Standard Sales Outreach" step 1 ended in `No template for key "initial"`; `services/sequence-templates.js` now maps `initial` → `o1`.
- **Also fixed on the way:** pop-ups (`#layer`) sat under the sidebar now that it is open by default, hiding the left edge of wide windows.
**Re-open when:** the owner wants Sourced/Screening back as context, or work attributed to who MOVED the stage rather than who owns it.

### D-0076 · 2026-10-06 · STANDS · Redesign step 3, first round: the owner's eight fixes from the live Today screen (R-124)
**Their words:** *"continue step 3 - main … remove AI recruiting and can you make pace in a motion, like typing kind … What is this 31 needed, and when clicked does nothing, so if does nothing remove it … theres max command button, but we also use it on windows, so that command not required or command or ctrl+k should be mentioned … The + symbol should be to add not only job, but also for a lead, candidate, a job or an email or a sequence like a dropdown … user should be able to hide these kind of notification or send a message to the user to complete the task, persistent notifications like these makes the page clumsy and crowded … what is this not replied yet … on what basis is this shown … 2 reminder windows on the same screen … remove this reminder box … those bars are not retro styled"* (five screenshots).
**Chosen (and built):** (1) logo "PACE" types itself out, "AI RECRUITING" gone; (2) the "N NEED YOU" chip is REMOVED (it did nothing; "N PAST DUE" stays because it opens Reminders); (3) the search hint says "Ctrl K" on Windows/Linux and "⌘K" on a Mac, either key works; (4) the yellow button is now "+ New ▾" on EVERY page (was Today only) with Job / Candidate / Lead / Email / Sequence, each offered only to a role that already has that action; (5) a mailbox warning can be hidden for a week (per person, counted, comes back sooner if the mailbox fails in a new way) and a manager's "Ask X to reconnect it" became a real "Remind X" that puts a task naming the asker on the owner's own list; (6) "No reply yet" is one row per LEAD (it was one per contact — 30 rows for one company) that says how many people were written to and how long ago, with a hover explaining the basis; (7) the second Reminders box under "Needs you today" is removed from all three dashboards (every due reminder is already a row above it); (8) the report's bars and columns are square, outlined, segmented, coloured by what a stage means.
**Judgement calls the owner can reverse:** the + New button on every page (the earlier rule was "no second yellow button beside a page's own"); "hide" is a week, not forever; the group row opens the lead rather than writing to one person.
**Also found and fixed:** the "PAST DUE" chip read a field (`due_date`) that real reminders do not have (`return_date`), so it could never show with real data; last session's test used the same wrong name, so it passed.
**Re-open when:** the owner dislikes the + New button on pages that already have their own add button.

### D-0075 · 2026-10-06 · STANDS · Merge the redesign so far (steps 1–2, the sky header, search) now — the owner wants to try it live
**Their words:** *"okay update the context and i will resume in the next chat. and merge these, let me see how it looks and works around"*
**Chosen:** reverses D-0074's "release only after Today + Leads": #294 merges now (179/179 on Node 22 and Node 26). The page LAYOUTS below the frame are still the old ones until steps 3–4; the owner accepts the half-new look in order to try it. D-0074's search decision stands.
**Re-open when:** the live look causes trouble for the team (then removing the `retro.css` <link> restores the old look in one line).

### D-0074 · 2026-10-06 · REVERSED (the release timing — see D-0075; the search part stands) · Build the header search (R-123); release the redesign only once Today and Leads are rebuilt
**Their words:** *"Should I build the search box (R-123)? Yes"*. On releasing steps 1–2 they first answered *"it's done, the leads have been assigned and the emails have been triggered and sent"* — read as the day's work, not the screens — so the question was asked again plainly; answer: **"Wait for Today + Leads (Recommended)"**.
**Chosen:** search finds candidates, leads (also by company / contact), jobs and clients, each limited to what the person's own lists show. Nothing from R-122/R-123 merges to `main` until the Today and Leads screens are rebuilt in the list / record / decide layout and the owner has seen them.
**Re-open when:** the owner asks to release sooner, or wants the search to cover more (emails, notes, documents).

### D-0073 · 2026-10-06 · STANDS · The retro look is the DEFAULT for every customer; build it step by step without breaking the app (R-122)
**Their words:** *"Default for everyone, go ahead and build it. step by step, i dont want to break the application"*
**Chosen:** `docs/design/PACE.ds` is the design to build. It replaces the current look for every company (not an opt-in theme); each person keeps Auto (follows the clock) / Light / Dark, saved per person. Built in small steps, each tested and shown before the next: (1) colours + clock switch, (2) sidebar + sky header, (3) the shared UI kit, (4) Today, then Leads, then the rest. Nothing merges to `main` (= live) until the owner has seen it.
**Re-open when:** a customer objects to the look, or a step breaks something the owner relies on.

### D-0072 · 2026-10-06 · STANDS · Retro redesign (R-122): the Duck Hunt scoreboard goes; the WHOLE app follows day and night
**Their words:** on concept 2, asked *"Can the scoreboard go?"* — *"Yes"*; asked *"Should the whole app follow day and night, or only the header?"* — *"Yes"* (to the recommended option, the whole app).
**Chosen:** (1) No Duck Hunt scoreboard / grass strip on the default screen; the duck may return only as a brief celebration (e.g. a placement). (2) The whole app follows the viewer's own clock: light cream pages by day, the dark version in the evening and at night, with the header sky (dawn/day/dusk/night, sun or moon on an arc) on top. Earlier in the same thread the owner chose the 90s retro direction (Stamply layout, Launch Week colours and pixel type, Duck Hunt touches) and asked for muted state colours — concept 2 did that.
**Still open:** pixel lettering in the frame only (recommended) or everywhere; the new look for everyone or offered as a theme first.
**Re-open when:** customers or the owner find the clock-driven switch distracting (a fixed light/dark choice per user would then override it — per-user, not per-browser, D-0022).

### D-0071 · 2026-10-05 · STANDS · Stage 2 (lead contacts + phones at import) ships in the SAME merge as stage 1 (R-114)
**Their words:** *"Do the Stage 1 screenshots feel right? - Yes"* · *"Should Stage 2 … go in this same merge, - Same merge, Do this now."*
**Chosen:** one PR (#289), one migration (056, which already carries the lead-contact columns), one go from the owner to apply it BEFORE merging. The leads sending engine keeps sending to `contacts.email` (the main) and now also honours a person-level opt-out across all of a contact's addresses.
**Re-open when:** the leads engine misbehaves after the merge (then stage 2 can be reverted on its own: it touches `routes/contacts.js`, `routes/jobs.js`, `index.js`, `services/lead-contacts.js`).

### D-0070 · 2026-10-05 · STANDS · Several emails and phone numbers per person: one MAIN you can switch, extras kept (R-114, R-014)
**Their words:** on which address emails go to — *"Option to tick the email which email is primary, or a small option when clicked the emails turns primary."* · duplicates, résumé upload, where to add/edit — *"Recommended"* (each) · phones at import — *"Both candidates and leads."*
**Chosen:** (1) A person has ONE main email and ONE main phone plus any number of extras; the recruiter makes an extra the main with a tick or a small "make primary" click. Every email goes to the MAIN address only (candidate outreach batches too). (2) A candidate counts as a duplicate when the name matches and ANY of their emails/phones matches ANY of the other person's. (3) A résumé upload reads every email and phone it finds: the first becomes the main, the rest appear as extras ticked for the user to confirm before saving — nothing is added silently. (4) Add Candidate, Edit Candidate and the candidate's header all carry the same small "+ add another" control. (5) The same main-plus-extras applies to lead contacts, and phone numbers are captured at lead import — for BOTH candidates and leads (so R-014 is answered: capture phones, do not redesign the call step around email).
**Re-open when:** the owner wants emails to go to more than one address, or wants the extras to take part in reply matching (a reply from an extra address today would not be recognised as the person).

### D-0069 · 2026-10-05 · STANDS · No "new version is ready — refresh" notice (R-116); several emails/phones per candidate is next (R-114)
**Their words:** *"Should I add a 'new version is ready, refresh' notice - No"* · *"Several emails and phone numbers per candidate (R-114). Five plain questions first. - let's work on this after the merge"* · and *"Okay merge 288."*
**Chosen:** (1) R-116 is DROPPED — PACE will not tell people an update is waiting; after a deploy someone with PACE already open refreshes by hand (the résumé scare of 1 Oct was exactly an old tab). (2) #288 (Gmail previews, bigger opened email + Expand, test fix, ARCHITECTURE.md pass 1, roadmap tidy) was approved and merged by me (squash `88d83c8`). (3) The next piece of work is R-114 — design questions first, no code until they are answered.
**Re-open when:** the owner is again misled by an out-of-date tab, or a deploy changes something that breaks an open tab (not merely looks old).

### D-0068 · 2026-10-02 · STANDS · Open tracking: the recipient's opens only; leads emails; BD Lead 1 first; no real read receipts (R-110)
**Their words:** *"the email should only be tracked if the to address opens the email, not us. like even i can open to sent emails to see how it looks, i think now the system tracks that too."* · on real read receipts: *"yes"* (skip them) · on the rollout, first *"Everyone"*, then, a minute later, *"okay only for BDLEAD 1"*. The doubled rows (R-109): *"yes do this"* / *"yes"* (merge).
**Chosen:** (1) A pixel hit counts as an OPEN only when it looks like the recipient: not from a network the sender recently signed in to PACE from, not a scanner/bot/empty user agent, not inside the first two minutes. The rest are tallied as `ignored_open_count` with a reason. This applies to EVERY pixel (candidate emails, interview invites, BD-manager sends), so their open counts now drop to recipient-looking opens. (2) Leads/sales emails get a pixel, ONLY for senders listed in `app_settings` `open_tracking_users` (`"all"` or a JSON list of user ids; absent = nobody). The owner's last word is BD Lead 1 only; "all" is one value away. (3) "Opened" = ≥1 recipient-looking open; "Likely read" = opened again ≥1 minute after the first. (4) Real read receipts are not built and not recommended. (5) It is an approximation and says so on screen: a sender opening their own copy from a phone/new network, or from Gmail's image proxy, still counts.
**Not built yet (Stage B):** an Opened / Likely-read figure in Lead Insights, an "opened, no reply" prompt in Needs you today, an Admin switch for `open_tracking_users` (today it is a database row).
**Re-open when:** the owner sees opens that were clearly their own or a scanner's (read `last_ignored_reason`), or wants everyone on, or the figures need to feed another screen.

### D-0067 · 2026-10-01 · STANDS · A follow-up comes from the mailbox that sent the first email (R-070)
**Their words:** *"R-070 - yes."* (to: *"Should a follow-up come from the mailbox that sent the first email?"*)
**Chosen:** an automatic follow-up (fu1/fu2) leaves from the mailbox that sent the FIRST email to that contact, found by the first email's from-address, when that mailbox is still active and connected. If it is not, the follow-up goes from the lead's current mailbox as before — it never stalls. An explicit per-email choice (sequence rotation) always wins. First emails and reminders are not affected.
**Re-open when:** a person wants the follow-up to come from whoever owns the lead now, or a mailbox owner objects to a colleague's follow-ups leaving from their address.

### D-0066 · 2026-10-01 · STANDS · R-080, R-092, R-098/099: what the owner answered
**Their words:** R-080 *"yes it should change back once emailing is completed"* · R-092 *"yes it should be able to attach resume"* · R-098/099 *"can do both, only top 3 priority shows and then a button to see all and a check box to check which shows that it's completed."* (And: *"Keep Boolean search to later part."*)
**Chosen:** (1) R-080 — an out-of-office contact switches back to Valid BY ITSELF on the return date, so follow-ups resume (no click). (2) R-092 — the submission email can attach the résumé. (3) R-098 + R-099 — "Needs you today" and "Client conversations" each show only the TOP 3 by priority, with a button to see all, and each row has a checkbox that marks it completed (a completed row leaves the list; it is a snooze, not a delete, and comes back if they reply). This replaces the proposed owner-defined rules/settings. Boolean search (R-096) stays last.
**Re-open when:** the automatic switch-back emails someone who should have stayed quiet; or the owner wants the top-N changed.

### D-0065 · 2026-09-30 · STANDS · A "day" is the user's own day
**Their words:** R-102 *"should a 'day' follow each person's own time zone? — yes, system timing"* · R-097 *"what counts as 'today'? — that date according to system of the user"*.
**Chosen:** every "today / this week / last 7 days" in PACE follows the viewing person's own time zone (their device clock), not the server's UTC. "Needs you today" shows what is dated today on that clock. Supersedes the UTC-days note in R-089 / `services/bd-insights.js` (`dayKey` becomes per-request). Built with R-095 (interview time zones).
**Re-open when:** a report must be identical for two people in different zones (a team total), then it needs one declared zone.

### D-0064 · 2026-09-30 · STANDS · The handwritten-notes batch: what the owner confirmed
**Their words:** R-092 *"when candidate is submitted to BDM or to client, a send email option should be there with submission details. I need that"* · R-096 *"this can be a different thing to develop itself"* · R-091 "the first thing shown" — *"yes"* · R-095 *"All time zones. Our product should be used worldwide."* — and *"Plan these, not act."*
**Chosen:** R-091/092/093/094/095 are planned together (plan in the chat, rows in the ROADMAP); nothing built until the owner's green signal. R-096 (Boolean search) is its own separate project. Interview time zones: the full world list, not a short list.
**Re-open when:** the owner changes the order or scope.

### D-0063 · 2026-09-30 · STANDS · Sentry yes; the Apollo connector is another organisation's; keep sending from people's own mailboxes
**Their words:** *"Yes do this: [Sentry] shows real errors from a running app … could replace the dropped R-081"* · *"the key in PACE is of a different organisation, I think I have told you this before"* (the Apollo connector is a different account from PACE's Apollo key) · asked whether Resend could send PACE's email.
**Chosen:** (1) Sentry error reporting built (R-090), off until `SENTRY_DSN` is set, nothing personal sent. (2) The Apollo connector is NOT used to read PACE's credit usage — it is a different account, so it would say nothing about PACE's key (PACE's own meter stays the source). (3) No change to how email is sent: PACE already sends through each person's own connected Microsoft OR Gmail mailbox; Resend is not wired in (it would mean a new sending identity, reply capture and a paid service per customer). Re-open Resend only for PACE's own system mail (sign-up/invite), never for recruiter outreach.
**Re-open when:** a customer cannot connect a mailbox, or PACE needs to mail people who have no mailbox connected to it.

### D-0062 · 2026-09-30 · STANDS · R-082: reject, don't remove; R-081 dropped; merge PR #263 without asking
**Their words:** *"No do not build R-081. For R-082 - give an option to reject the candidate to a user in a job not remove them. Sub options like out of budget, travel issue, did not like the company, skills do not match, over qualified, not interested, other with type column … merge it all after this edit, no need for my permission, merge this change."*
**Chosen:** the Pipeline ✕ becomes **Reject** (BD), moving the person to Not Accepted with a required reason from that list ("Other" is typed). R-081 is dropped. **The owner authorised merging this PR (#263) without further permission — for this change only.**
**Re-open when:** they want the reasons reported on (they are stored to be counted), or want recruiters to reject too.

### D-0061 · 2026-09-30 · STANDS · Work cheaper (R-088 yes), heal the 15 old rows, and the order of the rest
**Their words:** *"yes do R-088"* · *"15 old 'Tagged' candidate rows (C-0035) … yes"* · then, for the order: finish the stage-change screens myself without agents, rebuild the failing test and re-run everything once, then windows (R-078/R-079), "Needs you today" rows that do the task (R-073), emailing a contact you just added (R-083), email buttons forgetting who was clicked (R-084), the AI summary missing our own replies (R-085), the interview confirmation email (R-086), choosing the From address on every email (R-087). And, about Apollo: *"one click sometimes consumes a lot of apollo credit, i think our credit and their credit system is not the same."*
**Chosen:** all three of R-088's ways: small fixes done directly, `CLAUDE.md` trimmed to the rules (full text kept in `docs/CLAUDE_MD_FULL_SESSION34.md`), helpers on low effort with targeted tests. The 15 legacy rows were healed on the live database the same day (C-0035 (a) closed). D-0060 stands.
**Re-open when:** a rule that was trimmed out of `CLAUDE.md` is needed and nobody could find it — then the fix is a better pointer, not a longer file.

### D-0060 · 2026-09-29 · STANDS · No helper agent runs without the owner's say-so
**Their words:** *"Do not continue those agents before my saying. I think those agents are eating a lot of token. By now I have exhausted 2 session token on a single message that I gave you this morning."*

**Chosen:** no territory agent is started or resumed until the owner says so, in
their own words. That includes the three runs they stopped at ~17:10 UTC
(foundry, surface on C-0032, the windows job), whose partial work is saved in WIP
commit `08955fd`. The territories still OWN their paths (D-0008 stands for who
owns what); what changes is WHEN work runs — on the owner's go-ahead, not mine.
While work is paused, nothing wakes the session on a timer (no hourly PR
check-ins; PR #262's activity subscription is off).

**Why:** this morning's one message (the nine handwritten asks) fanned out into
about ten agent runs — several at once, some cut off by the usage limit and run
again. Each run first reads CLAUDE.md (~140 KB) plus its own memory (up to
90 KB) and then runs the full suite; measured runs used ~320k–670k tokens each.
The owner's plan limit was reached twice.

**Re-open when:** the owner says to resume, or picks a cheaper way of working
(`R-088`).


### D-0059 · 2026-09-29 · STANDS · D-0056 means the "Your team" card
**Their words:** *"Yes, the Your team block is the one"* — answering which Dashboard block D-0056 removes.

**Chosen:** the Dashboard's **"Your team"** card goes — the list of people who
report to you, with "Open team view →" (both its forms: the roster, and "No one
reports to you yet"). Nothing else on the Dashboard moves: the Reports section
at its foot, "Your team's pipeline", "Your team's conversations" and "Needs you
today" all stay. The team view lives on the My Team page (`R-072`).

**Re-open when:** the owner wants a small team summary back on the Dashboard.

### D-0058 · 2026-09-29 · STANDS · PACE gets windows: minimise, maximise and close — for compose and for other windows too
**Their words** (answering the read-back of their handwritten notes): *"Screenshot for apollo usage I wil give you later. Leave anytime can be. You have enough context for that. Yes, it's minimize and maximise windows in PACE. For compose and also for other windows too."*

**Chosen:**
- **R-078 + R-079 are one feature, and it is decided:** a compose window can be
  minimised (parked, like Gmail/Outlook), maximised and closed — and so can
  PACE's other windows (records such as client details, reminders, messages).
  The missing word in note 9 was "maximise". Compose comes first.
- **D-0057's reading stands.** The unreadable phrase in note 5 ("any time can
  be used"?) does not change it — the owner: *"Leave anytime can be. You have
  enough context for that."*
- **R-074 waits on the owner:** they will send the Apollo credit-usage
  screenshot later.

**Re-open when:** the owner finds parked windows getting in the way of the
page behind them, or wants a window to open somewhere other than over the page.

### D-0057 · 2026-09-29 · STANDS · Inside a job everyone starts at Sourced; "Tagged" belongs to the candidate database, not to a job
**Their words** (handwritten notes, photographed and sent 2026-09-29): *"A candidate when added to job from the candidate section or directly gets into Sourced stage. Tagged is for the database. Inside a job the stage starts from Sourced. Tagged is like when added the candidate to the database or added. any time can be used"* — the last four words are my best reading of the handwriting, not certain.

**Chosen:**
- Adding a person to a job — from the Candidates page or on the job itself —
  puts them at **Sourced**, the first of the eleven stages (the D-0029 ladder is
  unchanged).
- **"Tagged" is not a step inside a job.** It describes a person being in the
  candidate database.
- Today the job page still labels some people "Tagged" (pipeline-only rows,
  `25-workflow-bd.js`), and the pipeline's own status list
  (`28-page-pipeline.js`) begins with "Tagged". `R-075` carries the change.
  The reading was sent back to the owner on 2026-09-29.

**Re-open when:** the owner wants a step before Sourced inside a job (a
"considering" or shortlist state), or the reading above turns out to be wrong.

### D-0056 · 2026-09-29 · STANDS · The team view comes off the Dashboard; My Team is its own page
**Their words** (handwritten notes, photographed and sent 2026-09-29): *"My team view (the big column view) in dashboard is not required. Remove that, My Team has a tab for itself"*

**Chosen:** the Dashboard stops drawing the team view; it lives on the My Team
page only (`R-072`). **Which block** is being confirmed with the owner: my
reading is the "Your team" card (the people reporting to you, with "Open team
view →"), not the Reports section at the foot of the Dashboard (R-006), which
My Team also shows.

**Re-open when:** the owner wants a small team summary back on the Dashboard.

### D-0055 · 2026-09-28 · STANDS · Claude never uses the owner's organisation's Apollo account; every customer company brings its own API keys
**Their words** (asked whether Claude may read their Apollo account's credit balance): *"No I cannot give you the access, its my organization's. there are 183.3k credits left. Now this is just for text [test] … i am testing it within my company. When i see this, i use that particular company's apollo API key to pull out details or any other API keys in the system. All are changeable. Because this is a SAAS product."* — and in the same message: *"I need the people from other job also in this employee search. Maybe a search bar to search for title or similar title and that will search in the employee list from apollo and show us, and we can click on to see and select which contact we want to uncover."*

**Chosen:**
- **The Apollo connector in Claude's chat is off-limits** — it is the owner's
  organisation's account. Credit figures come from the owner (183.3k left on
  2026-09-28, a test account inside their own company) or from PACE's own meter.
- **Every customer company uses its OWN Apollo key — and its own keys for every
  other integration.** Measured the same day: **today they are shared across the
  whole deployment** (`config/integrations.js` stores `int_<id>_<field>` with no
  company in it), so a second company would see, spend and be able to overwrite
  the first company's keys. Harmless while there is one company; must change
  before a second (R-067, with R-049).
- **A title search inside the POC finder** (R-068): type a title, Apollo lists
  that company's people with it or a similar title (free), and the user picks
  whom to uncover (a credit each).

**Re-open when:** the owner wants Claude to read their Apollo account after all,
or decides a shared operator key should serve customers who have none.

### D-0054 · 2026-09-28 · STANDS · Apollo credits: one daily number for everyone, set by an admin, and the owner wants it higher
**Their words:** *"I want to increase the credit usage of the apollo, give the admin to set what's the number of credit that can be used per day for all users. how much of our credit system is apollo's credit system? Give me that number"*

**Chosen:** the daily Apollo credit ceiling stays ONE number shared by every user
of the company account (it already is: the meter is per organisation per day),
and an ADMIN sets it — somewhere an admin will find it. Today it lives only in
System Settings ("Contact finder", default 20/day). **Not built yet:** the owner
stopped the run before the work began (R-066). The question "how much of our
credit system is Apollo's" is answered from the code — every PACE credit is one
Apollo credit — and from Apollo's own figures only if the owner allows reading
their Apollo account.

**Re-open when:** the owner wants per-user limits instead of one shared number.

### D-0053 · 2026-09-28 · DECLINED · No automatic first email for a person added to a lead that was already emailed
**Their words** (asked plainly after D-0051): *"People added to a lead that was already emailed: should they get their first email automatically?- No"*

**Chosen:** today's behaviour stays. A person added after a lead's first round —
by hand, or accepted from the POC finder — gets NO automatic email; someone
emails them by hand. First emails are generated only when a lead is assigned.
R-065 is DROPPED.

**Re-open when:** the owner asks for it, or people added later are found sitting
un-emailed in numbers.

### D-0052 · 2026-09-28 · STANDS · The POC finder learns how law, accounting and architecture firms are run (R-063)
**Their words:** *"The contact finder at law, accounting and architecture firms: should it look for the right people there? - Yes"*

**Chosen:** build R-063 as re-scoped (see ROADMAP): at law, accounting and
architecture firms the finder looks for the firm's own leaders — Managing
Partner, Partner, Supervising/Managing Attorney, Shareholder, Principal, Studio
Director, Firm Administrator — instead of General Manager / Controller /
Engineering Manager, and recognises Attorney, Shareholder and Founding Member
titles as leaders. Rules only; no Apollo cost. **Not started yet:** the owner
stopped the run before building began; it resumes on their word.

**Re-open when:** another firm type (e.g. engineering consultancies, medical
practices) shows the same mismatch.

### D-0051 · 2026-09-28 · STANDS · "Already added": a pop-up whenever a person or an email address is already in PACE
**Their words** (answering whether PACE should queue a first email for someone
accepted onto an already-emailed lead): *"I do think that happens. If the person
or the email id already added. A pop-up should come like that they are already
added kinda."*

**Chosen (the pop-up is theirs; the two strengths are my design, shown to them
for a reaction):**
- Every way a person is added — **Add contact** on a lead, the POC finder's
  **Add by hand**, and its **Accept** — goes through ONE check
  (`services/lead-contacts.js`), and the answer is ONE pop-up
  (`showAlreadyAdded`).
- **The same email address anywhere in PACE (this company's account) is
  refused** — "Already added", with who and where, and only **OK**. One address
  is one person; a second row would be a second cold email to someone PACE is
  already talking to.
- **The same first + last name on this lead, or on another lead at the same
  company, is asked** — "Already added? Is this the same person?" with **Don't
  add / Add anyway**. Two people can share a name; the person adding decides.
- The pop-up names a colleague's lead only if the person looking may see it
  (D-0034); otherwise it says "a colleague's lead".

**Not decided — the question it was answering:** whether PACE should queue the
first email by itself for somebody added to a lead that was already emailed.
Measured the same day: **today it does NOT** — initial emails are generated only
when a lead is assigned; a person added afterwards gets nothing until someone
emails them by hand. *"I do think that happens"* reads either as "it should" or
as "I believe it already does", and it sends real email under a real person's
name, so it is asked again plainly rather than built on a guess (R-065).

**Re-open when:** the owner wants a name match refused outright (or not asked
at all), wants duplicates checked across imports as well, or answers R-065.

### D-0050 · 2026-09-28 · STANDS · Apollo is used only when a person presses a button; it also sizes the company (by website and name)
**Their words** (after saving an Apollo key, with two screenshots of a lead's
People to reach block): *"this looking for should be automatic using apollo
key, but only when a button is click 'search contact'"* · *"Can you also make
apollo search for employee size using company name and website. What all can we
get from apollo from what all information we have?"* Earlier the same day:
*"what guardrail are we creating that it do not eat away everything."*

**Chosen:**
- **Apollo is spent only on a click.** Each empty "Looking for" slot has its own
  **Search contact** button (that slot only); **Search contacts** at the top
  searches every empty slot; **Look up with Apollo** sizes the company. Nothing
  calls Apollo when a lead is opened, imported or assigned. This answers
  D-0049's open question ("whether Apollo may reveal emails automatically or
  only on the button" — **only on the button**) and narrows D-0049 D2: the
  automatic run for new leads, when built, uses the FREE rungs only.
- **Company size from Apollo**, looked up by the company's WEBSITE and checked
  against its NAME (a record under a different name is not used). It runs as the
  first step of a search when nobody has picked a size, or on its own button.
  **A size picked by hand is never overwritten.** 1 credit when Apollo finds the
  company, 0 when it does not; counted against the same daily ceiling (20).
- Found people still wait for **Accept** — nothing reaches a lead, and so
  nothing can be emailed, until a person says yes (design §6 rule 2). Offered
  to the owner as a choice to change.

**Not built, and why:** a search by company NAME alone (for a company with no
website) — every one of the 82 companies has a website today, a name search
costs credits and can return a same-named stranger. Re-open when leads start
arriving without websites.

**Re-open when:** the owner wants found people to skip Accept, wants Apollo to
run without a click, or name-only lookups become necessary.

### D-0049 · 2026-09-27 · STANDS · The POC finder (R-053): Apollo with API as the source; runs automatically and on a button; a guess is never emailed; size is picked on the lead
**Their words** (answers to the four design questions in
`docs/CONTACT_FINDER_DESIGN.md` §9): *"I will connect the Apollo account which
allows API integration."* · When it runs: *"Both"* · May PACE email a guess:
*"Never"* · Company size: *"A size pick on the lead"*. Earlier the same day:
*"Merge this change first and then work on the poc finder."*

**Chosen:**
- **D1 — source:** the owner will connect an Apollo account whose plan allows API
  use. The one they have today does not (a People API Search was refused on
  2026-09-27). So the paid rung (R5) is **Apollo**, keyed in Admin →
  Integrations; the free rungs (people PACE knows, the posting, the website, the
  company's email format) still run first and cost nothing.
- **D2 — when:** **both** — automatically for new leads *and* a "Find the rest"
  button on every lead. Automatic runs spend Apollo credits, so they are held to
  a daily credit ceiling set in Admin (a setting, not a constant).
- **D3 — a guessed address is NEVER emailed.** Only *Confirmed* (published by
  the company, or returned verified by Apollo) or *Likely* (built from the
  company's own format, learned from a real address there) may send.
- **D4 — company size:** a size pick on the lead (five bands), remembered for the
  company. Until picked, "under ~50" is assumed.

**Not decided (asked when it matters):** the daily credit ceiling's number, and
whether Apollo may reveal emails automatically or only on the button.

**Re-open when:** the Apollo key is connected and its first real results are
seen, or credits run out faster than the ceiling expects.

### D-0048 · 2026-09-27 · STANDS · R-012 now, quickly; designing R-053 is this chat's big job
**Their words:** *"Quickly do R-012 / I think it's going to a small work? / We
have to design R-053. That's the big job in this chat."* — the reply to being
shown the four items D-0047 deferred (R-057, R-012, R-054, R-053).

**Chosen:** (a) R-012 is built now, without a separate design round — this is
the go-ahead D-0014's "ask before building any of it" was waiting for. The first
screen (Leads) was already built on 2026-09-11 and has been in use since, so
"doing R-012" means carrying the same gesture to the other record lists: a row
click opens a panel **under the row** with its state and its few actions; the
full record is one explicit button away. Told the owner honestly it is mostly
small: Jobs still leaves the page, Candidates and Clients open a side drawer.
(b) R-053 (the contact finder) is **designed** in this chat — a design
conversation, not a build. (c) R-057 and R-054 stay deferred (not dropped).

**Re-open when:** the owner reacts to the new rows (screenshots), or asks for
the same gesture on a list not covered here.

### D-0047 · 2026-09-26 · STANDS · AI summary button ON; SQL is pre-approved; do everything "waiting on me"; the undecided four go to the next chat
**Their words:** *"when to switch on the AI summary button - do it"* ·
*"Also accept any sql request automatically. I have given you the
permission."* · *"Do these too"* (the waiting-on-me list: the manager's team
update + daily-update client section, the mailbox sign-in warning, "a few
older items") · on SPF/DKIM/DMARC: *"i think we already have"* · on the backup
tables: *"what all?"* · *"mentioning our own matching candidates …, the screen
redesign, a playbook per industry, the contact finder — we will do this in the
next chat."* · *"Do not cut corners."*

**Done / chosen:**
- `sys_client_intel_ai_enabled` = 1 live (2026-09-26). Allowance stays 15 per
  person per day (D-0041).
- **SQL and migrations no longer need a fresh go-ahead each time** — this
  supersedes the standing "never apply a migration without an explicit, fresh
  go-ahead" rule for THIS owner. It does not cover deleting customer data the
  owner has not asked to delete: destructive data changes are still stated
  first.
- R-039 verified from real received mail (DNS is blocked from the sandbox):
  futeglobal.com (Google) SPF/DKIM/DMARC **pass**, DMARC policy `none`;
  fute-global.com (Microsoft) all **pass**, DMARC `quarantine`.
- R-050: both backup tables were EMPTY and unused; migration 049 protected them
  (RLS + service policy, anon grants revoked). Dropping them is offered, not done.
- R-057, R-012, R-054, R-053 → next chat.

**Re-open when:** the owner withdraws the SQL permission, or a second customer
arrives (then SQL touching shared tables needs rampart review regardless).

### D-0046 · 2026-09-25 · STANDS · Build R-056 (get the job posting in) and cap first emails at 2 contacts per company per day; R-057 later
**Their words:** *"R-056, and email 2 contacts per company one day. No R-057
we will build that later. All the intrinsic designs and they need huge
discussion. Just do this for now."*

**Chosen:** (a) R-056 — give the AI the posting text: a place to paste it on
each lead, and a description column accepted by the import. (b) R-058 CHANGED
from "one contact per company per day" to **two**: a third contact at the same
company waits for the next day. (c) R-057 (mentioning our own matching
candidates) is deferred — not dropped. Keep both builds plain; deeper design
(research automation, angles per contact) is a separate conversation.

**Re-open when:** the owner starts the "huge discussion" on email design, or
2/day proves too many or too few.

### D-0045 · 2026-09-25 · STANDS · AI writes the engine's first emails — switched ON, including today's queued ones; and the send-hours control is made real
**Their words:** asked *"if i ask you to enable to AI email writing now. will
all the leads that are assigned today go out with AI emails? or are the emails
already generated?"* — told: the AI writes at SEND time, so all 84 queued first
emails would be rewritten just before each goes (~200k of the 400k daily AI
allowance; a busy free AI means that one goes as its template). Asked "switch it
on now?" and "shall I fix the send-hours control?" — answered **"Yes"**.

**Done:** live `sys_engine_ai_first_email` = 1 (2026-09-25 ~12:00 UTC).
**Correction, same day:** the switch's schema default is 1 and no row had ever
been saved, so it was ALREADY on since D-0033 — I had told the owner it was
off. Writing the row changed nothing in behaviour; the owner was told plainly.
No email has ever gone out AI-written (0 rows with `template_variant='ai'` as
of 12:00 UTC today) — today is its first live run, checked at 13:13 UTC.
Follow-ups stay templates (D-0033). R-055 (one working "send between" setting)
taken as approved by the same "Yes" — both questions were open and it was
the reply to both.

**Re-open when:** AI reply rates vs template (Deliverability → variants) say
the AI loses, or the daily AI allowance is hit before the queue drains.

### D-0044 · 2026-09-25 · STANDS · The email timeline is switched ON (leads + clients); the AI summary button stays OFF
**Their words:** *"Just this lead list. Let me see what it works with current
data that it has, not just the future"* — then *"Yes"* to: switch on the email
timeline (not the AI button) so the 90-day bring-in of past replies starts.

**Done:** live `app_settings` `sys_client_intel_enabled` = 1 (2026-09-25).
`sys_client_intel_ai_enabled` has no row, so it stays at its default 0 — the
"Generate AI summary" button is NOT offered. The catch-up runs on the hourly
engine tick, once per mailbox, ≤3 mailboxes a tick, last 90 days, only mail
from contacts on that mailbox owner's own leads, no side effects (#241).

**Re-open when:** the owner says to switch the AI button on (D-0041's per-person
allowance then applies), or the timeline shows mail that should not be there.

### D-0043 · 2026-09-25 · STANDS · The client's Emails tab shows the emails plus a "Generate AI summary" button; saved summaries feed the daily update
**Their words:** *"So the email section will have the emails of the client
being shown and generate ai summary button and this AI summary till date is
created. This data can also be fed to daily updates or summarise if needed."*

**Chosen:** the client page's **Emails** tab holds the timeline (every email to
and from that client's contacts) with a **Generate AI summary** button above
it; the summary covers everything to date and is saved. The **daily update**
(the morning briefing) re-uses what is already saved — the free facts and any
summary the owner generated — and makes **no new AI call per client**. Same
visibility rule (D-0040): an owner's daily update may quote their own clients'
summaries; a manager's team roll-up uses facts only.

**Re-open when:** the owner wants summaries generated automatically for the
daily update (that would reverse D-0042's button-only rule and costs tokens).

### D-0042 · 2026-09-25 · STANDS · A client summary is made only when the user presses a button, and its cost is capped however long the history is
**Their words:** *"maybe we can put a button where those summaries should be
created in the client section. So when the user clicks on it the summary is
generated, than a summary for every email in the inbox, because re-reading
every email when a company scales to 100+ managers … a lot of token processing
can be saved … it should be taken care that a bd clicks to generate summary
till day on a client with 2 years of email data, it should not over eat the
tokens and still work fine. Optimization should be key factor."*

**Chosen:** no automatic summaries at all — not on arrival, not on opening.
A **"Summarise" button** on the client. Every click has a **hard ceiling**
(~4k tokens in) whatever the history: older history reaches the AI only as
compact free facts, never as raw email text; only the latest few messages go
in as text. A repeat click with nothing new costs zero. Supersedes the
"when someone opens the client" trigger in D-0039's design.

**Re-open when:** users say the capped summary misses something important
from older history — then add the one-time monthly digests described in the
design, not a bigger ceiling.

### D-0041 · 2026-09-25 · STANDS · The summary limit SCALES with the company — per user, driven by activity — and is never sized from test data
**Their words:** *"Does the summary count depends on the number of users and
emails and outreach number and active clients and all right. Don't take out
test data as an example."*

**Chosen:** no fixed company-wide number. The limit is **per owner per day**
(each person gets their own allowance, so one busy user cannot use up the
team's), and the company ceiling is that × the number of users, never more
than a set share of the company's AI allowance. The live database is early
test data and is **not** used to size anything — worked examples use a
described company instead, and real numbers are read only after real use.

**Re-open when:** two weeks of real use show the per-user figure is far off.

### D-0040 · 2026-09-25 · STANDS · Client email text and its AI summary are the OWNER's alone; a manager gets a TEAM roll-up, not individual summaries
**Their words:** *"1. Only the owner. The manager of a team can get total
summary of the team. Maybe a change that happened to a user in a team. Not the
individual AI summary that the owner gets, since sometimes the manager is also
a owner to his database."* On the daily AI limit: *"I don't know. How should I
calculate that?"*

**Chosen:**
* **Email text, the client timeline and the per-client AI summary: the record's
  OWNER only.** Not their manager, not admin-by-default. This is narrower than
  D-0034/D-0035 (where a manager may review a report's records) — for email
  content specifically, the owner is the only reader.
* **A manager gets a TEAM ROLL-UP**: what changed across their reports' clients
  (replied, waiting on us N days, promise due, stage moved, went quiet). Built
  from the free facts only — **no email text is shown to the manager and none
  is sent to AI for the roll-up**, so the roll-up cannot leak what the owner
  alone may read. A manager who also owns clients gets the normal owner view
  for those, and the roll-up for the team's.
* **The daily limit** is explained to the owner as a method (share of the
  allowance → number of summaries) with a recommended starting value; it stays
  an adjustable setting, reviewed on real use. Not yet chosen by the owner.

**Re-open when:** a manager needs to read a report's client email (holiday
cover, dispute) — that is reassignment (D-0020/D-0036), not a wider read.

### D-0039 · 2026-09-24 · STANDS · Client email timeline + AI summary: build it first, OFF until the owner says, token use designed first; PACE must fit any industry
**Their words:** *"Build the client email timeline and AI summary first. Don't
switch it on till I say. If it's switched on just like that, all the emails will
be read and unlimited tokens will be used so we have to design that token usage
to read the emails and make sense of it and match the to and from emails to the
lead emails we have and store that data and retrieve it when needed and rewrite
it … Which is not storage intensive, not AI intensive yet, give the right
summary and suggested next steps based on current situation."* And: *"a lead
management system that can run for any industry not just recruiting … flexible
enough to work right. Right means relevant to that industry and company
process."*

**Chosen:** R-051 is next. Design in `docs/CLIENT_INTEL_DESIGN.md`: a gate that
stores only mail matched to a lead contact or our own thread (noise never
stored), ~2 KB per kept message, free rule-based facts on arrival, and an AI
summary that runs only when a client is opened AND something changed,
incremental from the last summary, fingerprinted, checked, with its own daily
cap. Every switch ships OFF. Industry fit comes from a per-company
**playbook** (words, stages, signals, allowed next steps), recruiting as the
first preset (R-054).

**Measured when decided:** 77 stored inbound messages, 3 tied to a contact; the
rest job-board alerts, account mail and unknown senders.

**Re-open when:** the owner says to switch it on (per company), or the measured
cost of a summary is far from the ~2.5k-token estimate.

### D-0038 · 2026-09-24 · STANDS · A lead take-over starts from the duplicate warning
**Their words:** asked where a BD's request for a colleague's lead should start
(a BD cannot see a colleague's lead since D-0034), they chose **"From the
duplicate warning"** over "only via the client" and "managers only".
**Chosen:** when adding/importing a lead hits "Already on <owner>'s lead since
<date>" (D-0035 D5), that message carries **Ask to take over**. The asker still
never sees the other lead's details — the approver does. Proof of the right to
ask is that the asker typed a contact email that is on that lead; the server
verifies the match, never the browser. Clients and job orders get the button on
their own page (they are visible company-wide, D-0035). Managers can still ask
for their own team's leads from the lead itself.
**Re-open when:** the owner wants BDs to browse colleagues' leads to request them.

### D-0037 · 2026-09-24 · STANDS · Take-over requests: the CURRENT OWNER's manager approves; a new table is fine
**Their words:** *"okay, build the take-over request next"*. Asked who approves a
request for a record owned by someone on a DIFFERENT manager's team, they chose
**"Current owner's manager"** (over "asker's manager only" and "both managers").
Asked whether a new table may be added to the live database at merge: **"Yes, add
it"**.

**The rule (refines D-0036's approver):**
* A request to take over a lead / client / job order goes to **the current
  owner's manager** — it is their team losing the record. Same team: that is
  also the asker's manager, so D-0036 still reads true there.
* The current owner has **no manager** → the **admin**.
* The record has **no owner** (e.g. Unassigned pool) → the **asker's manager**
  (admin if none), per D-0036.
* **Nobody approves their own request** — if the approver would be the asker
  (a manager asking for a report's record), it goes to the admin.
* The current owner is TOLD (a line on their list), and does not have to agree.
* Approving reassigns through the existing assignment paths; declining leaves
  everything as it was. Every request, decision and decider is kept (the table).

**Re-open when:** the owner wants the current owner to be able to object, or a
second approver on cross-team moves.

### D-0036 · 2026-09-23 · STANDS · RA Lead scope confirmed; ownership changes by request, approved by the requester's manager
**Their words:** on the RA Lead (rampart's D4): *"YEs thats fine"*. On a
"request to take over this client" step: *"yes to the person to which the user
is assigned to , if the no one is assigned, to the admin"*.

**Chosen:**
* **RA Lead (D4) — confirmed:** sees the Unassigned pool, the leads their own
  RAs researched, and each BD's email COUNTS — never the text of BDs' emails.
* **Ownership changes by REQUEST.** A user asks to take over a lead/client/job
  order; the request goes to **the person that user reports to**
  (`users.manager_id`); if nobody is assigned as their manager, it goes to the
  **admin**. Approving it reassigns the record (through the existing release /
  assignment paths, never an inline field write). Built after R-046, as
  **R-047**. Interpretation recorded: "the user" = the one making the request.

**Re-open when:** a cross-team request (the record belongs to another manager's
report) needs that owner's manager to agree too — not asked yet, raise it when
R-047 is designed rather than assume.

### D-0035 · 2026-09-23 · STANDS · Shared to SEE, owned to TOUCH: candidates, clients, job orders
**Their words** (answering rampart's D1–D5): *"do the fixing, only people
responsible of the data based on our design shuld be seeing and interacting with
it, no one else.*
*1. Should every recruiter see every candidate? - Yes, the wonership of a
candidate in a job is defined, not in the system. which means, that same
candidate can be added to a different job too by a different recruiter.*
*2. Yes, every BD can see every client, but interaction is limited to only owner
of the lead or the client until ownership is changed by permission of the
manager.*
*3. Yes, full job list shows all jobs in the company, but interaction is
limited. just to candidate infomation, JD, job location, website and all. No POC
details shown other than to owner*
*4. mark as duplicate. what does how it to other BD contact details means?"*

**Chosen:**
* **Candidates (D1):** the candidate database is SHARED across the company — every
  recruiter sees every candidate. Ownership exists only per candidate-on-a-JOB
  (`submissions.recruiter_id`): the same person can be added to a different job
  by a different recruiter, and each such submission is its recruiter's.
* **Clients (D2):** every BD SEES every client. Only the OWNER of the lead / client
  may ACT on it (edit, documents, email it, contacts). Ownership changes only
  with the manager's permission — a reassignment, not a free-for-all.
* **Job orders (D3):** every job in the company is visible to everyone, but a
  non-owner sees the candidate-facing parts only — JD, title, location, website,
  pay, requirements. **Client POC details (name, email, phone) are shown to the
  owner only.** Interaction (edit, delete, workflow actions) is the owner's (and
  the recruiters assigned to it, for adding their candidates).
* **D5 duplicate check:** a new lead whose contact is already on someone else's
  lead is MARKED DUPLICATE. The owner asked what "show the other BD's contact
  details" meant — explained in chat; pending their reply, the default is the
  recommendation: say whose lead it is and since when, not that lead's details.
* **D4 (RA Lead)** was not answered; rampart's default stands until they do.

**Also (same message):** the import must not keep a spreadsheet's own serial
number column ("S,no") as a lead detail — PACE gives every record its own id.

**Re-open when:** the owner wants a manager able to ACT on a report's client or
job order (today: review and prompt, D-0020), or wants a formal "request
ownership change" flow built — the words "until ownership is changed by
permission of the manager" describe one; today reassignment is done by an admin.

### D-0034 · 2026-09-23 · STANDS · You SEE only what you are responsible for (plus your team's, if you manage one)
**Their words** (with screenshots of the Leads page and Email → All email as
BD Lead 1): *"in leads or in outreach all emails, full information is shown to
all users. Like earlier we did designed what information to be show to each
user, only the ones that they are responsible for or given to, like the
particular set of lead assigned to a particular user, a particular set of
emails being generated from the email assigned to particular user, like that,
but here its complete opposite. whys that? … can this be prevalent all across
the system, look into that and work on it. Use agents we built."*

**The rule.** D-0020 defined who OWNS a record (a lead → `assigned_to_bd`, a
submission → `recruiter_id`, a reminder → `user_id`, a contact → its job's
owner). This extends it from *acting* to *seeing*:
* **You see what you own**, and what was given to you (an email is visible to
  the owner of the lead or record it was sent about, and to whoever sent it).
* **A manager also sees what their reporting chain owns** — review, per
  D-0020, using the one chain helper (`hierarchy.js` `reportingChainIds`).
* **Admin sees the whole organisation.**
* A record nobody owns yet (the Unassigned pool) is seen by the roles that
  distribute it, not by everyone.

**Measured when decided:** BD Lead 1 owns 25 leads and saw 49 (`GET /jobs`
gave every `bd_lead` all ASSIGNED leads org-wide — written before the
hierarchy existed); Email → All email (`routes/email-history.js`) was scoped
by organisation only, so every user saw all 119 outreach emails.

**Not decided here, and must be asked rather than assumed:** whether a
genuinely SHARED resource — the candidate talent pool, the client list —
stays shared. Most ATS products share the candidate database across
recruiters; hiding it would break duplicate checks and sourcing. Those are
listed for the owner, never silently narrowed.

**Re-open when:** the owner wants a role to see more than its chain (e.g. a
BD Lead covering another team), which is reassignment/cover — D-0020's
re-open condition — not a visibility leak.

### D-0029 · 2026-09-22 · STANDS · A submission is a candidate sent to the CLIENT, and PACE counts two numbers

**Their words:** *"define submission, ie job submission. adding a candidate to a
job is not submission."*

**They are right, and PACE had it wrong in two places.** A submission is the
moment a candidate's profile, CV and rate go **to the client** for a hire/no-hire
decision. It is the unit a staffing desk measures itself on. **Adding a candidate
to a job is not that** — it says only "this person is in the running", nothing has
left the building, and usually they have not even been screened.

**The table is misnamed and the name leaked into the numbers.** PACE stores all
eleven ATS stages, from `Sourced` to `Placement`, in a table called
`submissions`. That is a storage name, not a meaning. But two screens counted
**every row** as a submission:
* **Dashboard → "Submissions this week / this month"** — source ten candidates
  on Monday and it reported ten submissions.
* **Reports → "Active reqs with the most submissions"**.

Meanwhile the Reports **headline** "Submissions" counted only `Submitted to BDM`
and beyond. **Two numbers in one product, the same label, different maths** —
and the wrong one inflates the metric a buyer asks about first.

**What was decided — count BOTH, shown separately.** Offered three options
(client-only, BDM-onward, or both); the owner chose both:
* **Sent to BDM** (`Submitted to BDM` onward) — recruiter output, an internal
  handoff.
* **Sent to client** (`Submitted to Client` onward) — the real submission.

The reason this is the better answer and not the fence-sitting one: the GAP
between the two is the interesting number. Candidates stalling between recruiter
and BD approval are invisible if you only ever publish one figure.

**What this does NOT change:** adding a candidate to a job still creates the
pipeline row at `Sourced` (D-0028's applicant import included) — that is
membership, and it is correct. It simply is not a submission and is no longer
counted as one. A row created that way must **not** stamp `submitted_at`.

**Re-open when:** the count needs to be "EVER reached this stage" rather than
"is at or past it now". Today a candidate who was submitted to the client and
then marked `Not Accepted` **stops being counted**, which under-reports real
submissions — the honest limitation of keying off the current stage. The fix is
to read stage history from `submission_activity` (which already records
`old_stage`/`new_stage`), or to add a `client_submitted_at` column. Deferred
because it is a bigger query on a metric that is now at least consistently
defined, and consistency was the bug being fixed.


### D-0028 · 2026-09-22 · STANDS · Applicants are a VIEW of the sourcing queue, not a second pool

**Their words:** *"when the candidate clicks on apply, where does that candidate
end up in our system and where can we see them. can we create an applicant part
in candidate section and inside job section where we can find those applied
candidates."*

**The question was asked with a real applicant already in the system.** The
first application through a published link arrived at 19:24 UTC — a real
person, resume stored, staged correctly — and there was nowhere in the product
that said so. The path worked end to end and was invisible.

**What was decided.** Two places show applicants, and they are the two the
owner named:
* **Candidates → Applicants** — everyone who applied, across all jobs, newest
  first, with the job each person applied for.
* **A block on the job order's own page** — just that job's applicants, under
  the apply link that produced them.

**What was deliberately NOT decided: a new pool.** An applicant stays in
`sourcing_candidates`, inert, and both screens read the SAME endpoint and
import through the SAME endpoint as the Sourcing review queue. The rule from
CLAUDE.md holds — a public form never writes into `candidates` — and a second
import path is how two screens come to disagree about what "imported" means
(Session 22 shipped candidate outreach twice for exactly that reason). This is
a new QUESTION asked of existing data, not a new store.

**One thing importing does differently:** it pre-tags the job the person
applied to, because they already told us. Making a recruiter re-pick it is
asking for a fact the system holds.

**Re-open when:** applications are numerous enough that reading them costs
something measurable. Which job somebody applied to currently lives inside the
staged row's `raw` blob, so filtering is done in Node over the provider-filtered
set. That is free at tens and wrong at tens of thousands. The upgrade is a real
`job_order_id` column plus a backfill — deliberately deferred, because a column
worth backfilling is one the numbers have asked for, and the reader is already
isolated in `services/applicants.js` so the swap touches one file.


### D-0027 · 2026-09-22 · STANDS · The working protocol is enforced by hooks, not by remembering it

**Their words:** *"make a very strict rule while working on this project in any
chat that i start in the PACE. it has to be completed by the agents we have
build earlier and should be updated real time, so that no progress or deletion
or addition is missed and i dont have to explain eveytime to update the
context. Can we do that."* — and, crucially: *"Like last time i think i did,
but it got missed in the last edit window and i dont know how many before this
too."*

**They were right, and the record proves it.** They had decided this TWICE —
**D-0008** (PACE is worked through its nine territories) and **D-0024** (memory
is written as the work lands). Both were recorded, both say STANDS, and both
were broken in Session 27: the work was done directly rather than through the
territories, and six territory memories were left stale until the owner asked,
again, whether the context had been updated. **The rule was never the problem.
The mechanism was.**

**What changes.** Two hooks in `.claude/settings.json`, which run whether or
not anybody remembers they exist:
* **SessionStart** injects `scripts/session-brief.mjs` — the protocol, plus any
  memory already owed in the working tree — into **every chat in this repo**,
  before the owner types anything. They never restate a settled decision again.
* **Stop** runs `scripts/stop-gate.mjs`, which **blocks** a session trying to
  finish with memory unwritten, naming the exact files. It also emits a
  `systemMessage`, so the owner sees it too — they should not be the last line
  of defence, and should certainly not be it unknowingly.

`scripts/memory-check.mjs` is the mechanism: it maps changed files to their
owning territory through `_map.json` and asks whether those memories changed in
the same breath. `test/memory-discipline-smoke.mjs` (25 assertions) keeps the
checker honest, and it was verified against Session 27's real apply-page
commit — it names exactly the six memories that were missed.

**This reverses one judgement inside D-0024, and only one.** That entry
rejected automation because *"a hook can run a script — it cannot write a
narrative about what happened and why."* The first half is right; the
conclusion did not follow. **A script cannot write the narrative. It can
absolutely check that one was written.** Missing that distinction is why the
rule depended on memory for three more sessions. D-0024 otherwise stands
unchanged — including its judgement that *what* to record cannot be automated,
which is why the gate is deliberately dumb and never rates quality.

**The honest limits, stated so nobody mistakes the gate for more than it is:**
* It cannot tell a real memory entry from one blank line.
* It cannot force a session to USE the territory subagents (D-0008) — it only
  notices, afterwards, that a territory's paths moved without its memory.
* Hooks live in the repo, so they bind any Claude Code session working in this
  checkout. They do not reach a chat that never touches these files.

**Re-open when:** the gate blocks work it should not — a session genuinely
mid-flight finding the placeholder escape more obstruction than help — in which
case soften Stop from `block` to a `systemMessage` warning and keep the
SessionStart brief. Or if memory starts being written to satisfy the checker
rather than to be read, which would mean the gate is measuring the wrong thing
and the answer is review, not more automation.

---

### D-0026 · 2026-09-21 · PARKED · Hunter.io waits on a company email address

**Who:** the owner, in session.

**Their words:** *"lets pause on the hunter thing as i dont have a company
email and hunter gets register on company domains."*

**What was decided.** Hunter.io is not being signed up for. It was offered as
the one remaining free, genuinely-wired integration worth having (~25 lookups a
month; it finds a work email from a name plus a company domain, used on the BD
side to reach a POC). Parked, not declined — the tool is still the right one,
the owner just cannot open an account yet.

**Why — and this is bigger than Hunter.** B2B data vendors gate signup on a
**business domain** and reject free consumer addresses. The owner is on a
personal address today, so this blocks not just Hunter but most of that whole
category. **Treat "needs a company email" as a standing precondition, not a
Hunter quirk** — check it before proposing any vendor in this class, so the
owner is not sent off to sign up for something that will refuse them at the
form. Nothing in PACE depends on Hunter: `enrichment.js` infers an address
from the company's pattern and verifies the domain by DNS, free and unlimited,
and that is what runs today.

**Re-open when:** the owner has a mailbox on a domain they control. That is
likely to arrive on its own — PACE's own self-serve signup design assumes an
organisation registers its email domain — so this may resolve as a side effect
of the product rather than as a separate task.

---

### D-0025 · 2026-09-21 · STANDS · Candidate sourcing starts with the free front door, not a paid resume database

**Who:** the owner, in session.

**Their words:** *"Do i have to put in money to build this integration?"* — then,
on being shown that the three boards they named (CareerBuilder, Resume-Library
US, LinkedIn) are all paid and that the apply page is free: *"Yes"*, to building
the apply page first.

**What was decided.** PACE gets a **public apply page** — free to build, free to
run — before any paid candidate source is bought. The paid boards are not
declined; they are **sequenced behind a measurement**. The owner gets quotes in
the meantime so the number is ready when it is wanted.

**Why this and not the boards.** Eight of the nine steps in the candidate
journey were already built (job order → find people → review queue → import →
resume parsed → matched → emailed → answered → pipeline). Only step 2, *finding
people*, was CSV-only. Buying a resume database before knowing how many
candidates the desk is actually short of is buying a tool for an unmeasured job,
and it contradicts the project's standing free-tier-first rule.

**What the owner was told plainly, and accepted:**
* Every real resume database is paid. There is no free CareerBuilder,
  Resume-Library or LinkedIn — selling resume access *is* their business.
* **There is no LinkedIn API that searches people by job title and location**,
  for us or for anyone. Recruiter System Connect is not a search; it surfaces
  LinkedIn data for candidates an ATS *already has*. Partner approval runs
  3–6 months at under a 10% acceptance rate and wants an existing large user
  base. The legitimate path today is a Recruiter seat plus CSV export.
* **Apollo's free tier no longer includes API access** (it changed in late
  2025 — the free plan is ~100 credits and no API; API starts at the
  Organization plan, 3 users minimum). An earlier answer in this same session
  said Apollo was free to try; that was corrected the moment it was checked.
  The Apollo key slot on the Integrations page is therefore **still dead**, and
  saying "we have integrated Apollo" is wrong — it can be saved and tested,
  and nothing calls it.

**Re-open when:** the apply page has been live for roughly a month and the
Sourcing queue shows either (a) too few applicants to staff the open reqs, or
(b) applicants in the wrong skills or geographies. Either is the measurement
that makes a paid board the right purchase. Re-open sooner if a client demands
a volume the inbound flow plainly cannot meet.

---

### D-0024 · 2026-09-17 · STANDS · The archive is written as the work lands
**Their words:** *"Like I have a question, does this updation happens only when
I ask you to do or does it happen automatically whenever you make a change in
the system"* — then **"Yes"** to making write-as-you-go the standing rule.

**What prompted it.** The owner asked me to update the context files and, in the
same breath, asked how that upkeep actually works. The honest answer was
*partly*: `DECISIONS.md`, the territory memories and `CAPABILITIES.md` were
being written in the same commit as the code, and `CONTEXT_WINDOW.md` per
commit — but `CONTEXT_ARCHIVE.md` was defined as an **end-of-session** job and
was, at that exact moment, **still unwritten for the session in progress.** The
question found the one thing that was genuinely outstanding.

**Why "end of session" is the wrong trigger.** It is a moment that never
announces itself. A rate limit, a closed browser or a cancelled run ends a
session instead, and anything not yet in a file is gone with it. `DECISIONS.md`
already carried the right discipline for precisely this reason — *a decision
that exists only in a chat window is lost when that window closes* — and the
archive has the same exposure with none of the protection.

**Decided.** The archive is appended **when a piece of work lands**, alongside
the territory memory and the commit. Open the session heading the first time
there is something real to say; add a section per round. Append-only still
holds — add sections, never rewrite one.

**The one part that stays at the end, and why that is honest.** The closing
synthesis — *the thread through this session* — genuinely requires the whole
session; you cannot know the lesson before doing the work. So it is appended
last and it is **additive**. If a session dies before it, the facts are already
safe and only the summary is missing. **An archive of accurate fragments beats
an eloquent one that was never written.**

**What was considered and rejected: making it automatic.** Claude Code supports
hooks, and a hook can run a script — it cannot write a narrative about what
happened and why. The judgement of what is worth recording is the whole value,
and it cannot be automated. So this rule depends on a session reading
`CLAUDE.md`, which is a real dependency and is now stated in `CLAUDE.md` rather
than assumed.

**Re-open when:** a session is lost mid-way and the archive still turns out to
have a gap — which would mean the append points are too coarse and should move
closer to each commit. Or if the archive starts reading as disconnected
fragments, which would mean the closing synthesis is doing more work than this
rule assumes.

### D-0023 · 2026-09-17 · STANDS · A job order carries its client: POC required, address structured, cooldown applies
**Their words:** *"its better to take in the client information like POC contact
name, email ID, phone number and address of the company to create the lead and
then the job in that. How does that sound?"*

**Context.** Session 26 had just fixed "+ New Job", which could never create a
job at all. With it working, the owner asked that it capture the client
properly. Three sub-decisions were put to them with live numbers from the
database, and **they went against my recommendation on two of the three.** That
is recorded here so neither is re-litigated by a future session reading only the
code.

**1. A POC is REQUIRED — name and email. Phone and LinkedIn stay optional.**
Chosen: *"Require name + email (Recommended)."* Agreed with my recommendation.
The evidence put to them: all **328** live leads already have a POC and **708 of
709** contacts have an email, so requiring it costs nobody anything — while
**163 of 709 have no phone**, so requiring a phone would buy invented phone
numbers. That is the same failure D-0017 exists to prevent.

**2. The company address gets PROPER FIELDS, not one free-text line.**
Chosen: *"Proper address fields."* **Against my recommendation**, which was the
existing free-text `companies.location` (filled on 1,565 of 1,567 rows, no
migration, splittable later). The owner wanted street / city / state / zip /
country as real columns. **Migration 043**, additive; `location` is kept as the
short display form and derived from the new fields so nothing types it twice.
My stated reason for preferring free text — that structured address earns its
keep at invoicing time and the retrofit is cheap — was heard and overruled.

**3. The 21-day company re-add cooldown DOES apply to BD job creation.**
Chosen: *"Yes — block it, same as the RA form."* **Against my recommendation.**
The option they picked said so in as many words: *"it will refuse genuine job
orders, and people will find a way around it."* They took that trade for one
consistent rule with no exceptions to remember.

**What I did to make the block survivable, without softening it.** The refusal
names **who** added the company and **when**, so there is somebody to go and
talk to — `closeRefusal()`'s rule, that a refusal names what you CAN do instead.
And it is shown **the moment a client is picked**, not discovered at Save: the
whole of Session 26 is about rules that are enforced where an action is taken
but not where it is offered. There is deliberately **no override**, because the
owner did not ask for one.

**The consequence to watch, stated plainly and not designed around.** The
cooldown counts leads on the company, and creating a job order creates a lead.
So a client who sends a **second requirement inside the window will be blocked**
— which lands hardest on the best clients. I did not soften this, because they
chose it knowing genuine job orders would be refused.

**Re-open when:** a BD reports being blocked from entering a second, real
requirement from a client that is already theirs. The two fixes ready to go, in
order of preference: exempt a company that already has a **job order** (won
business is not cold outreach), or add a recorded override with a reason. Also
re-open if the owner wants the cooldown's number editable per role rather than
one org-wide setting.

**Pinned by** `test/client-intake-smoke.mjs`, including the boundary day, a
cooldown of 0 meaning *no* cooldown, and the refusal naming a person.

### D-0022 · 2026-09-15 · STANDS · The theme follows the person, not the browser
**Their words:** *"a change in the theme in one user is reflected to other
users, it should not happen like that."* Chosen: **"Follow the person."**

**What was actually happening.** The light/dark choice is written to
`localStorage` and never to the server, so it is per BROWSER. Two different
people on two different machines never shared it; two logins on the SAME
machine did, and the next person to sign in inherited the last one's choice.
Told to the owner plainly before they chose.

**The decision.** The choice is stored against the USER, so it follows them to
any device and never carries over to whoever signs in next on a shared
computer. `localStorage` stays as the instant-apply cache (the page must not
flash the wrong theme while a fetch is in flight) but the account is the
authority on load.

**No migration.** Stored in `app_settings` under `theme_<user_id>`, the same
pattern as the next-action dismissals and the AI meter, for the same reason:
a per-user preference does not justify a schema change, and migration 043 is
not something to spend on a colour.

**Re-open when:** a second per-user preference appears (density, default
landing page, notification settings). At two or three, this becomes a real
`user_preferences` row rather than a key per setting.

### D-0021 · 2026-09-15 · STANDS · The briefing line is about YOUR desk
**Their words:** chosen — **"Yours — your replies, your leads."**

**What was happening.** `gatherFacts` in `routes/ai.js` scopes by ORGANISATION
only. Every user — recruiter, BD, lead, admin — was shown the same sentence:
*"Two replies came in today, and the unassigned lead pool stands at 79."* The
unassigned lead pool is a BD-side number a recruiter has no part in working,
and it was presented as if it were their morning.

**The decision.** The line reports the reader's own work. A recruiter is told
about their candidates and their replies; a BD about their leads. **Admin is
the exception and still sees the organisation**, because the whole company IS
their desk — the same exception `/reports/recruiting` already makes.

**Re-open when:** the owner wants a company-wide line back for leads as well as
admin, or wants the team number alongside the personal one.

### D-0020 · 2026-09-15 · STANDS · You own your list; a manager reviews and PROMPTS
**Their words:** *"reminders information is not just for one user who is
responsible for it, its been showed to everyone and every user as a manager can
interact with it."* … *"Maybe we can define what ownership or responsibility
means."* Chosen: own list plus a count, **"And the count where the manager can
review it and initiate the other user to take action on it."**

**THE DEFINITION OF OWNERSHIP, since the owner asked for one.** A record has ONE
responsible person:
* a **reminder / task** is owned by its `user_id` — the person it was created for;
* a **lead** by `jobs.assigned_to_bd`;
* a **candidate submission** by `submissions.recruiter_id`;
* a **contact** by the owner of the job it hangs off.

**What ownership buys you:** it appears on your daily list, and you can act on
it. **What it costs everyone else:** nobody else's daily list carries your work,
and nobody else can close it.

**What a manager gets instead.** Their own list, plus a COUNT of what is open
across their reporting chain, and a review screen behind it. On that screen they
can see the item, see whose it is — and **PROMPT the owner to act**. They cannot
do it for them. That is the whole shape of the decision: *review and initiate*,
not reach in.

**Why this is not a smaller change than it looks.** Today the daily queue is
chain-scoped, so a manager's list already carries their reports' reminders — and
carries a **Done button that silently does nothing**, because the endpoint
behind it correctly refuses to close a reminder the caller does not own. The
button reported success and the row came back on the next load. Under this
decision that button is never drawn on someone else's work at all, which is the
honest fix rather than making a manager able to close a task they did not do.

**Re-open when:** a manager says prompting is not enough — the case to watch is
somebody leaving or going on holiday, where the answer is probably REASSIGNMENT
(changing who owns it) rather than acting on another person's behalf. Ownership
transfer is the right shape for that, and is deliberately not built yet.

### D-0019 · 2026-09-15 · STANDS · A list is calm; colour is a scarce resource
**Their words:** *"can correct the colour, too much red. like after 5,6
reminders the screen will look reddish."*

**What was happening.** The reminder cards marked every overdue row with a 2px
red border, a solid red pill and a red-tinted panel, on top of an amber-washed
card ground. One card looked deliberate. Six looked like an alarm — and the
owner spotted the scaling problem from a screenshot of two.

**The decision, generalised past this one page.** **Overdue is the ordinary
state of a to-do list, not a fault.** Red means something has gone wrong, so it
is not used to mark the normal condition of a row. A list is calm by default:
the card sits on `--card` with a 1px border, and state is carried by a **3px
left stripe plus one tinted chip** — amber for overdue, the brand accent for
today. Roughly a tenth of the coloured ink of the first version, and red does
not appear on the page at all.

**Why this is a decision and not a tweak.** It sets the default for every list
PACE draws next. The temptation on each new screen is to colour the rows that
need attention; the owner's point is that when most rows need attention, that
colours everything and communicates nothing.

**Pinned**, because a future session will reach for red again:
`test/reminder-clarity-smoke.mjs` fails on any red token in the page, on a
tinted card ground, and on the state colour being painted in more than three
places. Verified by reintroducing both.

**Re-open when:** a genuinely exceptional row appears that needs to outrank
everything else on the page — a failed send, a bounced address, a compliance
hold. Red is still available for that, which is the whole point of not spending
it on "this is two days old".

### D-0018 · 2026-09-15 · STANDS · A task stays open when its sequence moves on
**Their words:** *"Now i think the reminder was created inspite of follow up
email being triggered."* Chosen from three options: **"Stays open, but shows
what's happened since."**

**What was happening.** Step 3 of Standard Sales Outreach created a call task on
13 Sep. Step 4 sent follow-up 2 on 15 Sep and the enrollment completed. The task
sat there untouched, with a "Compose email" button, and the send path refused
the click:

> Send failed: A follow-up to this contact is already queued or was sent today —
> skipped to avoid a duplicate email.

The refusal was CORRECT. What was wrong is that the screen offered the action at
all, and only admitted the problem after the email had been composed.

**The decision.** A sequence finishing does not close the human task it created.
Two unanswered emails is precisely when a call is worth making, so the task
survives — it just stops pretending nothing has happened since. The card now
carries the email trail ("2 emails already sent, last on 2026-09-15") and, when
another send would be refused, says so **before** offering it rather than after.

**Why not the alternatives.** "Close it when the sequence finishes" loses the
call on exactly the leads that never replied. "Close it as soon as a later email
goes out" makes the automated email cancel the human step, which is the opposite
of what step 3 exists for.

**The rule this creates:** a rule that decides whether an action is ALLOWED
belongs where the action is OFFERED, not only where it is taken.
`services/outreach-dedup.js` is that rule, now shared by the send path and the
page instead of living only inside index.js.

**Re-open when:** the owner finds the open tasks pile up faster than they get
worked, or asks for a way to clear a batch of them at once.

### D-0017 · 2026-09-15 · STANDS · No call task when there is nobody to call
**Their words:** chosen from three options, in response to being shown that all
five contacts on the live call tasks had no phone number and no LinkedIn:
**"Don't create it at all."** Offered with the trade-off stated — *"a lead
quietly stops being chased and nobody is told"* — and taken anyway.

**What was happening.** Seven live tasks read *"Call the POC about this role and
connect on LinkedIn."* Every contact named held **neither a phone number nor a
LinkedIn URL**. The task was not merely unhelpful, it was impossible as written,
and it is the single biggest reason the Reminders page read as the app inventing
work.

**The decision.** A `bd_touch` step does not create its task when the contact has
no phone and no LinkedIn. It records `skipped` with reason
`no_phone_or_linkedin` on the step run, so a lead that stops being chased for
this reason is answerable from the data — **the owner accepted a quieter list,
not a silent one.** The generic `reminder` channel is deliberately NOT gated: it
can be any task at all, and reachability is not its precondition.

**Not applied retroactively.** The seven tasks already in the database stay
(that is D-0018). They now say plainly that there is no phone or LinkedIn on the
record, rather than asking for a call that cannot be made.

**Re-open when:** contact records start carrying phone numbers routinely — at
which point the skip should become rare on its own and is worth re-measuring —
or if the owner notices leads going quiet and wants the skipped ones surfaced as
a "find a number for these" list rather than only in the step-run record.

### D-0015 · 2026-09-10 · STANDS · The new look, from the owner's Bolt design; light AND dark
**Their words:** *"I was thinking of revamping the UI. and i worked on
something in BOLT."* … *"keep toggle to dark and light. I am tired of how it
looks right now. out system / visual reference given to you"* — with a Bolt
export (ZIP) and two phone screenshots as the reference.

**Decided:** PACE takes the visual language of the owner's Bolt design — glass
panels on a soft ground, Apple-ish palette, generous radii, quiet rows — in
**both** light and dark, with a toggle. `docs/UI_REVAMP.md` holds the detail.

**The reference, described honestly:** 8 files, ~600 lines, React + Vite +
Tailwind, ONE screen, four hard-coded jobs, no data layer (Supabase is in
`package.json` and never imported). It is a DESIGN, not an app — which is the
right thing for it to be.

**NOT a React rewrite, and this is the load-bearing call.** The first read of
this was "your Bolt work means porting the frontend to React". Reading the
actual source changed that: the design is a sidebar, a header, three cards, a
stepper and a list. None of it needs a component framework — the beauty is
entirely in the CSS. And PACE's ~19,600-line frontend already draws everything
from shared CSS variables, so the whole app re-skins from ONE stylesheet with
no JavaScript touched. `public/theme.css`, loaded last. **Deleting that one
`<link>` restores the old look exactly** — which is what makes a change this
broad safe.

**Consequences that are not up for debate:**
* **Three theme states, not two:** `light`, `dark`, or no attribute at all,
  which means "follow the OS". The toggle only moves between the two explicit
  ones.
* **The theme is applied INLINE IN `<head>`, before first paint.** Deferring it
  by a tick paints light then snaps to dark.
* **Toggling touches ONE attribute and calls nothing else** — no `render()`.
  Re-rendering to change a colour would reload every sandboxed iframe and lose
  the page's scroll, which the render engine exists to prevent.
* **A colour is never defined ONLY inside a media query**, or the toggle cannot
  beat the OS.
* **A theme must reach EVERY palette in the app.** `ui.css` carries its own
  (`--ink`/`--line`/`--hover`) separate from `styles.css`'s (`--text`/
  `--border`); overriding only the second left the entire Leads table drawing
  `#0F172A` ink on dark glass. Both are bridged now.
* **An inline colour cannot be re-themed**, exactly as an inline width cannot
  be re-laid-out. The dashboard clock and scope chip carried white inline (the
  banner used to be a green slab) and went white-on-white. They are classes now.

**`test/theme-contrast-smoke.mjs` is what keeps this true**: it composites every
translucent ancestor to find what is REALLY behind each piece of text, across
12 pages x 3 roles x 2 themes, and fails the build under 2.2:1. Verified by
reintroducing the `--ink` bug and watching it fail. **Do not weaken it** — both
faults above were invisible to every other test and were found by looking at a
screenshot, which does not scale.

**Re-open when:** the owner wants the accent moved off Apple blue (one line,
`--accent`), or wants a screen restructured rather than re-skinned — this entry
covers the LOOK. The row-level interaction brief is D-0014 and is still open.

### D-0014 · 2026-09-10 · STANDS · The UI is being revamped; the model is PROGRESSIVE DISCLOSURE
**Their words:** *"Its not about limiting the number of things that gets
accumulated on screen, you are not understanding the design, why not just
minimilistically reduce elements on screen and shows things when clicked"* …
*"those lead row or the job rows and all and not interactive they don't show
anything, like earlier … we were able to change the email stage, to valid or
invalid and all. Now those things and all are not there. So i feel the design
that to revamped a bit."* … *"we are going to change the entire fucking UI of
the product in sometime."*

**The correction, recorded because it was MISREAD once already:** D-0013
answered "things accumulate on screen" with **volume control** — horizons,
caps, pagination. That was not the ask. The ask is **DENSITY AND DEPTH**:

> **Show little by default. Reveal on click.**

Both are true and they are not the same instruction. D-0013 stands (the 92x DOM
growth was real and measured); it is simply not this. **Do not answer a density
complaint with a filter again.**

**What was investigated and is NOT broken** (probed in a real browser, both row
types, Session 23): a lead row is clickable → opens the detail drawer; a job row
is clickable → navigates to `bd_jodetail`; the valid / invalid / deactivated /
out-of-office control still exists, still works, and is visible in the drawer
(`changeEmailStatus` in `18-email-status-actions.js`, called from
`renderJobDetailModal()` in `06-page-leads.js`). No regression was found and git
shows no commit that moved it off a row.

**What is ACTUALLY wrong, and is the brief for the revamp:**
1. **The actions are not where the eye is.** Marking an email invalid takes a
   row click, then finding a contact card inside a drawer. Nothing on the row
   says it is possible, so a capability that exists reads as missing — which is
   exactly what happened.
2. **A row shows no state and offers no action.** A Jobs row carries a checkbox
   and NOTHING else; a Leads row carries a checkbox and a stage dropdown. The
   same gesture on two lists does two different things.
3. **The same gesture has two different outcomes.** A lead row opens a DRAWER
   over its list (keeping filters, selection, scroll — the deliberate rule in
   `CLAUDE.md`); a job row LEAVES the page for `bd_jodetail`. One of those two
   is wrong and it is the second.

**Direction agreed for the revamp:** a row is quiet until asked, then reveals
its state and its actions **in place** — not a wall of controls, and not a
2-click trip into a drawer to change one field. The drawer stays for the full
record.

**Re-open when:** the revamp starts. This entry is the brief; it is not a
mandate to start building it — the owner said "in sometime", and said it
**after** telling me I had misread the last one. **Ask before building any of
it.**

### D-0013 · 2026-09-10 · STANDS · Every list gets a horizon and an exit
**Their words:** *"I think what's also important is the stacking of information
on the screen or the UI when aging, have we considered that while designing
things, not just in this view but also for everything. Like if we design like
that what changes would be carried out"* — then, after the seven-point answer:
*"Convert this 1-7 into a proper concrete plan and work on it and solve this
full issue then we will touch something else."*

**Decided:** ageing is a first-class design constraint, applied app-wide rather
than to the screen that prompted it. The law: **every list has a HORIZON (how
far back it looks by default, 90 days) and an EXIT (how a finished item
leaves).** Full plan and measurements in `docs/AGEING_UI_PLAN.md`.

**Consequences that are not up for debate:**
* A picker past `PICKER_CAP` (15) becomes a SEARCH FIELD, not a taller list of
  chips. The interaction changes shape.
* Finished things are EXCLUDED from working views, never deleted.
* A list that hides rows must SAY how many and why. The horizon bar is not
  decoration — a filtered list that does not admit it is filtered is a lie the
  user cannot see.
* Anything claiming to need you today must be dismissable.
* `test/ageing-layout-smoke.mjs` fails the build on unbounded growth, and is
  the reason this does not silently come back. Do not weaken it — it is the
  sibling of `mobile-layout-smoke.mjs`, and the argument is the same: a buyer's
  evaluation account is empty, and their THIRD YEAR is what decides renewal.

**Also settled here:** PACE has **three** email pipelines (`emails`,
`email_tracking`, `candidate_outreach`) and the owner correctly felt it. They
stay three — merging them for SENDING would break the one that works — but they
now have ONE read view (Email → All email). Do not "unify" the send paths.

**Re-open when:** the owner finds a screen where the 90-day default or the
15-item picker cap is wrong for their actual work. Both are single constants
(`services/view-horizon.js` + the checked copy in `00-ui-kit.js`), deliberately
easy to retune; the LAW is what stands, not the numbers.

### D-0012 · 2026-09-10 · STANDS · One candidate-email workflow, JD inside the email
**Decided:** Merge the two ways of emailing a candidate about a job into one.
**"Email JD to candidates"** (a job's Candidates tab, multi-select) is removed;
**Email → Compose → Candidates** survives. The job description goes **inside**
the email as a formatted block — title, location, pay, requirements — not as an
attachment.
**Their words:** *"these are 2 different workflow of a same thing, like
duplication of workflows… remove the job description sending thing and attach
the job description in a formatted window format when asking the candidates
about their interest to jobs."*
**And explicitly, asked and answered:** **no file attachments.** The old flow
could attach documents and the new one cannot; the owner was shown that and
chose the formatted block alone. **This is a decision, not an oversight** — do
not "restore" attachments as a missing feature.
**Why it matters beyond the feature:** this duplication is what caused
`CAPABILITIES.md` to exist. ~2,900 lines, two territories, months apart, and the
owner found it rather than the system.
**Re-open when:** a recruiter actually needs to send a file with an interest
email — evidence from real use, not a guess.


### D-0011 · 2026-09-09 · STANDS · No backfill of the 81 wrong lead timezones
**Decided:** Fix `getTimezoneFromLocation()` in code only. The 81 existing
`jobs.timezone` rows that are wrong stay wrong until something touches them.
**Their words:** *"yeah just fix the code"* — said after being shown that 81 of
309 leads (26.2%) carried the wrong zone, all stored east of reality, with 16
Pacific-coast leads being cold-emailed from 05:00 their local time.
**Why it matters:** the evidence is in C-0014 against `deep`. **This is a
decision, not an unfixed defect** — do not re-raise it as a bug. New and edited
leads self-correct.
**Re-open when:** the owner asks, or a reply-rate problem is traced to it.

### D-0010 · 2026-09-09 · STANDS · Candidate emails ignore the send window
**Decided:** Candidate outreach sends as soon as it is due, wherever the person
is. BD lead outreach keeps its timezone window. The 75–105s drip pacing stays.
**Their words:** *"candidate emails that were created are still in pending,
remove the barricade of timezone for candidate emails and individual emailing,
Only the outreach goes within the time zone"*
**Reverses:** D-0009, the same day. Real use beat the prediction.
**Kept as a switch** (`candidate_send_window_enabled`, default off) rather than
deleted, precisely because it was reversed once.
**Re-open when:** reply rates soften, or a batch is seen landing at ~2am local.

### D-0009 · 2026-09-09 · REVERSED by D-0010 · Candidates emailed in their free time
**Decided:** Candidate outreach sends weekday evenings 17:00–21:00 and weekends
09:00–20:00, in the candidate's own timezone — because a technician on a roof at
11am is not reading recruiter mail, unlike a prospect at their desk.
**Reversed the same day** when it left eight emails sitting pending. The
reasoning was sound and the outcome was not; that is why the hours were kept
behind a switch rather than deleted.

### D-0008 · 2026-09-09 · STANDS · The codebase is worked in nine territories
**Decided:** Build and maintain PACE through territory agents with their own
borders and memory, rather than one long conversation per session.
**Their words:** *"i was thinking of creating AI agents to create this
application in a much better way… go and talk to individual agents, about a new
feature in that territory… once a job is done, the agent should write the
updates in the memory and then clear out the cache so the context build up is
not there."*
**Note:** the owner also asked for the island view, and was told plainly that it
is a map over the mechanism, not the mechanism. **If nine teams ever reads as
overhead, collapse `ledger` into `rampart` and `guild` into `gateway`** —
merging teams is far cheaper than splitting them later.

### D-0007 · 2026-09-08 · STANDS · The four outreach angles are approved
**Decided:** The four AI-written first-outreach angles are good enough to send
to real prospects. That question is closed.
**Follow-up they asked for and got:** a Rewrite button, three attempts per
angle, capped server-side.

### D-0006 · 2026-09-01 · PARKED · The Gmail 7-day token expiry
**Their words:** *"We will work on this but not now."*
**What is parked:** a dead Gmail sign-in destroys queued emails — each is marked
`failed` with no retry and no recorded reason. Root cause is Google-side: the
consent screen is in "Testing", where refresh tokens expire after 7 days.
**Do NOT re-raise this as blocking.** It is a decision.
**Re-open when:** a fresh, visible incident occurs — not on a code review.

### D-0005 · Session 21 · STANDS · Emailing a candidate is not working them
**Decided:** A submission at `Sourced` is created only when the recruiter ticks
the box. Default off.
**Why:** sending someone an email is not the same as putting them in a pipeline,
and a queue that fills itself is a queue nobody trusts.

### D-0004 · Session 11 · STANDS · No guest or demo mode, ever
**Decided:** No read-only bypass, no seeded fake world.
**Why:** `Bearer guest` granted access to a real customer's live data, and the
demo seed showed a fake world to real users before their own data loaded.
**Never reintroduce a product-side bypass to make a test easier** — browser
tests enter through the test helper instead. If a product tour is wanted, it is
its own seeded organisation with a real login.

### D-0003 · Session 11 · STANDS · Prices are unset and card payments are off
**Decided:** Every tier's price stays `null` until the owner sets it.
`services/plans.js` is the one place. Do not invent a number, and do not switch
on payments to "test the flow".

### D-0002 · Ongoing · STANDS · Self-serve signup stays switched off
**Decided:** `SELF_SERVE_SIGNUP` is off until strangers should be able to sign
up. Built, tested, dormant.
**Re-open when:** the owner says they want public signups.

### D-0001 · Ongoing · STANDS · The free tier is a hard budget
**Decided:** Render's free plan (~750 instance hours/month) is a real
constraint, not a detail to design around later.
**Consequences that are not up for debate:** the GitHub heartbeat is every 30
minutes, not 5; cold starts are normal and are why outbound timeouts are
generous; **before adding anything that polls on a schedule, ask what it does to
instance hours.** "Not receiving its heartbeat" is usually GitHub delivering a
scheduled workflow late — **do not fix it by pinging harder.**

---

## D-0016 — A palette has states, and a screenshot of one state is not the palette
**When:** Session 23, round 3 (2026-09-11)
**Who:** the owner, from their phone: *"this happening in dark mode. those details
are not visible under selection. Also, 4th screenshot, that button do not work.
Also, theres small glitche in the UI and the screens, like a lag or sometimes
early animations and all. Its not smooth."*

**What was decided:**

1. **A literal colour in a base stylesheet is as un-themeable as an inline one.**
   `tr:hover td{background:#FAFBFC}` (styles.css) set the hover tint on the CELL,
   and a cell paints over its row — so the themed `tr:hover` and the `tr.is-open`
   tint were both correct and both invisible, and an opened Leads row read
   white-on-white at **1.05:1**. The theme layer now re-declares every hard-coded
   light ground whose text comes from a token. Tinted chips (`.pill.*`, `.st-*`,
   `.av-*`) stay as they are: each pairs its own dark text with its own pale
   ground and is legible in both themes. `.mb-body` stays `#fff` deliberately —
   that is an email's own page.

2. **The contrast suite must drive interactive states.** It rendered 51 screens
   at REST — it never hovered, never opened a row, and therefore never once saw
   this colour. It now hovers a row and opens one, in both themes, with an
   explicit "there was a row to drive" assertion so it cannot pass empty.

3. **A modal panel is only a panel.** `renderModal()` wrapped every modal in
   `.overlay` except three it special-cased — `jobDetail`, `addJob`,
   `addContact` — which were returned raw and so landed in normal flow BELOW the
   whole page. "Open full record" set the right state, rendered the right 6.7KB
   of html, threw nothing, and was invisible. Everything entering `#layer` now
   goes through one wrapper, and the guard asserts GEOMETRY (does it cover the
   viewport) rather than state, because state was never the thing that was wrong.

4. **Glass belongs to surfaces that float over content, not to controls.**
   `backdrop-filter` had been written onto every input, select, textarea,
   outline button and chip — **25 blur layers on one phone screen**. Removing it
   changes Leads and Admin by at most **3/255** per channel and Email by at most
   25/255 on 3% of pixels. The budget is now 12 layers per screen and a test
   enforces it.

5. **`transition: all` is banned.** Nine rules used it. `all` includes width,
   height and padding, so a button whose label changes animates its own size and
   nudges its neighbours — an animation nobody asked for, which is what "early
   animations" describes. Every rule now names the paint-only properties it
   wants, and a stylesheet grep fails the build on a new one.

**Re-open when:** someone wants the frosted look back on controls (it is one
token and five selectors), or a real device profile shows the blur budget is
either too tight or still too loose.

**What this did NOT decide:** whether the app now *feels* smooth on the owner's
phone. This sandbox's Chromium composites in **software** — a scroll measures
exactly 17ms/frame with 25 blur layers and with none — so no timing claim was
made from it. Layer counts and pixel diffs are real and were used; frame times
were measured, found vacuous, and discarded.

---

## D-0030 — Every suggestion is a row in a file, and the owner gets a live window onto it

**Decided**: 2026-09-23 (Session 28) · **Asked for by the owner, unprompted.**

Their words: *"from today onwards keep a list of things that you have suggested
me doing and start marking them completed and pending, take from a week ago too.
And keep those in your live memory. This live memory keeps things that are
pending, strike off the things that are completed, keep updating those things
when they are being edited or changed in a different way than the proposed. And
then bring it up when asked for like whats left and how we can do it."*

Underneath the request is an accurate diagnosis. PACE already had three durable
memories — `DECISIONS.md` (what the owner chose), `CONTEXT_ARCHIVE.md` (what
happened), the territory files (what the code does) — and **a suggestion is none
of those three.** It is not a decision, because nobody decided it. It is not
history, because it never happened. So every "here is what I would build next"
lived only in a chat window and died with it, which is why the same three items
kept being re-offered and the AI health check has now been asked for four turns
running with no record that it was ever asked once.

**The decision:**

1. **`docs/ROADMAP.md` is the record.** A suggestion becomes a row **in the same
   turn it is made** — the D-0024 rule, for the same reason: "end of session" is
   a moment that never announces itself.
2. **Five states**: `PENDING` · `DOING` · `DONE` · `CHANGED` · `DROPPED`.
   **Nothing is deleted**, ever — a reversal is a new state, exactly as in this
   file.
3. **⚠ `CHANGED` is a first-class state, and it is not `DONE`.** The owner asked
   for this explicitly — *"when they are being edited or changed in a different
   way than the proposed"*. A row that shipped differently keeps **what was
   proposed, what shipped, and why it moved.** Rewriting it to match the outcome
   erases the evidence that the plan was wrong, and that evidence is worth more
   than the tidy row. The first such row is `R-018`: one submission count was
   proposed, two plus the gap shipped, because the owner corrected the domain
   mid-build.
4. **"What's left" is answered by READING THE FILE**, never reconstructed from
   memory or from `git log` — neither holds a suggestion that was never built.
   The answer is grouped by who is blocked: me, them, or an undecided question.
5. **The artifact `NQ4HUuMfAWJk34g9Vs5EdQ` is the window**, one document per row
   in its `items` / `shipped` collections, so marking something done from any
   future chat is a single-document write rather than a republish. **The file
   wins any disagreement** and the artifact is corrected to it.

**Why a file AND an artifact, rather than one of them:** the owner does not read
code or open the repo, so a file alone is invisible to them; and an artifact
alone is invisible to a cold session, which reads the repo and not the gallery.
Each one covers the other's blind spot. The artifact renders from a snapshot
baked into the page and upgrades itself to the live store when it loads, so it
is never blank and never silently stale — the header says which of the two you
are looking at.

**Re-open when:** the list outgrows a hand-maintained file (roughly, when
"what's left" stops fitting on one screen), or the owner wants to tick items off
themselves — which would make the artifact the writer and invert rule 5.

**What this did NOT decide:** automating it. A script can check that a row
exists; it cannot judge that a thing said in passing was a suggestion worth
recording. Same split as D-0027 — the gate is dumb on purpose, the judgement
stays here.

## D-0031 — Failed emails retry themselves on a ladder; D-0006 is re-opened

**Decided**: 2026-09-23 (Session 29) · **Asked for by the owner**, after
importing a fresh set of leads: *"when email sending gets failed, i dont see the
re-try option to send the failed email or the automatic version of it in the
engine after sometime from the failed email ID. can we design that part"* —
then, on the design: *"go ahead, retry today's 4 automatically"*.

**This re-opens D-0006 on its own stated condition** ("a fresh, visible
incident"): two of Daniel James's emails failed "sign-in expired" at 18:06 UTC
while three more from the same mailbox sent minutes later.

**The decision:**
1. A failure is sorted: **temporary** (sign-in, throttling, provider hiccup),
   **permanent** (a fact about the recipient — opted out, bad address),
   **needs fix** (a fact about our setup — no mailbox on the lead), and
   **uncertain** (a timeout mid-send, which may have been delivered).
2. Temporary ones retry **after 15 min, then 1 h, then 4 h** — the first send
   plus three retries — then stop and say so.
3. **Only temporary retries automatically.** Uncertain never does (it could
   email a prospect twice); permanent is never offered a Retry button at all.
4. A mailbox whose sign-in fails is skipped for the rest of that run.
5. The reason is stored on the email (migration 046) and a person can press
   **Retry** / **Retry all** on the Email page.
6. Today's 4 failed emails were re-queued by hand at the owner's request.

**Not decided here:** the Google "Testing" 7-day token expiry itself (D-0006's
root cause). Retries survive a hiccup; they do not survive a sign-in that is
genuinely dead — those give up after the 4-hour retry and wait for a reconnect.

**Re-open when:** a retried email is found to have gone out twice, or failures
that are really permanent are seen cycling through the ladder.

## D-0032 — AI writes the engine's cold emails (approved in principle)

**Decided**: 2026-09-23 (Session 29). Owner: *"yes, let AI write the engine
emails"*, then asked whether it writes per email or per batch, and what one email
and 100 a day would cost.

**What was established before building:** one AI call per LEAD (each lead is a
different company and role; a batch would re-create the sameness problem), about
2,100-2,400 tokens each, ≈230k tokens for 100/day — above the app's default
daily cap (150k). Groq's free tier also caps tokens per minute (8,000, measured
2026-09-08), which the engine's one-email-per-~90s pace stays under.
**Material caveat given to the owner:** imported leads carry only a job title
(49 of 49 on 2026-09-23), so the AI cannot research the role — the gain is
varied wording and reader-fit, not insight, unless imports start carrying the
job description or link.

**Open, asked of the owner:** raise the daily AI cap; AI for follow-ups too or
first emails only. Templates stay as the automatic fallback either way.

**Re-open when:** the owner answers those two questions.

## D-0033 — AI first emails: daily AI limit raised, first emails only

**Decided**: 2026-09-23 (Session 29), answering D-0032's two open questions.
Owner: *"raise it, first emails only. Do this"*.
**Done:** `ai_daily_token_cap` 150,000 → **400,000** and `ai_daily_call_cap`
250 → **400** (live `app_settings`, 2026-09-23). Follow-ups stay templates.
An on/off switch lives in Admin → System Settings ("AI writes first emails").
**Owner's follow-up question, answered:** adding job descriptions does not add
a separate AI step — the JD is read inside the same one call per lead — but it
makes that call bigger (roughly +700-1,100 tokens), so ~100 emails/day with JDs
is ≈ 300-350k tokens, still inside 400k if other AI use stays modest.
**Re-open when:** JD-carrying imports push daily use near the cap, or the AI
vs template reply rates (Deliverability → variants) say one of them loses.

---

## D-0083 — 2026-10-07 — Industry rules: no second free-text box now; playbook groundwork is on the roadmap, notifications come first
**Owner asked:** whether a second space below the AI-writing note (to define rules for the AI) is needed, "because later when the multi-industry playbook is scaled, not every industry will have the same rules or prompts as recruiting."
**Advice given (and accepted — the owner said to add it to the to-do list):** keep ONE note per person (how it sounds). The hard rules are a different kind of thing — guarantees the app CHECKS — and today they are recruiting-specific and in code. A free-text "rules" box would be a second prompt that looks like a guarantee. Right shape later: an admin-owned **playbook** of STRUCTURED rules (instruction + optional machine check + on/off). Groundwork (move today's rules into one named "Recruiting playbook" data block, no screen) is `R-150`, not started.
**Also decided:** the next topic is **notifications** (`R-149`); the owner will continue in another chat; scope (what / where / per-person switches) is still theirs to answer.
**Re-open when:** a second industry's customer is real, or a customer asks to change what the AI may never say.


## D-0084 — 7 Oct 2026 — The owner's eight small fixes (Session 41)
**Decided (owner, in their words, from five screenshots):** (1–2) a "Needs you today" / client-conversation window shows ONLY what that suggestion was worked out from, and lets the person DO the step (email, call, stage change) — "the user can see information but cant do anything about it, thus nullifying the intent of this feature". (3) My Team opens on **Reports**, and Overview + Team Insights are **one tab**. (4) **Reply / Forward open as a window** (minimise, go elsewhere in the app, come back) and are saved as a draft — what is typed must never be lost. (5) The **signature editor shows the signature, not HTML**. (6) The interview **time zone is chosen by typing a city**. (7–8) Leftover old-look controls (Stage/Industry/Date, stage dropdowns, Valid dropdown, Send all pending, the job-page funnel, candidate status + ID) move to the new look, and **one font scale** everywhere. Then: **"Merge these changes after it's completed."**
**Built as:** a "What to do" band in the shared evidence window (`64-evidence-drawer.js` `cfg.task`); reply = dock window `mailReply` with a device draft (NOT the provider's Drafts folder — offered, not built); signature stored as the SAME template HTML, edited visually (name/email as chips); time zone: hidden `#stg-iv-tz` kept, `ivTzSearch()` is the rule; type scale snapped in the real rules (CSS + inline), the `.fs-*` classes snapped in `retro.css` (a test pins their names to values in `ui.css`).
**Re-open when:** the owner wants the draft in the Gmail/Outlook Drafts folder, or a screen still looks off (send a screenshot — the audit measures only the screens it can load).

## D-0085 — 7 Oct 2026 — Company re-add cooldown is 30 days (R-157 groundwork)
**Decided (owner, in their words):** "Should I change the cooldown to 30 days? … yes". The owner's lead-creation flow says a company may be re-added only after 30 days with no active jobs.
**Done:** live `app_settings` row `sys_company_cooldown_days` = `30` (before: no row, so the built-in default 21 applied). Written once through the Supabase tool with the owner's explicit yes, read back as 30. No code changed; the 60-second settings cache means it applies within a minute. The code default in `config/settings.js` is still 21 — a fresh database or another customer's org still starts at 21; change the default only if the owner wants it for every customer.
**Also learned (owner, same message), not yet decided:** the owner has a paid Apollo plan "of organisations" and thought of connecting it to Claude. That connector only lets Claude query Apollo in a chat; PACE calls Apollo with an API key saved in Admin → Integrations (`services/people-apollo.js`). Apollo's API terms (read 2026-10-07) prohibit selling or giving a third party access to the API and using it to replicate or compete with Apollo; PACE is sold to other companies, so each customer must use their OWN key (D-0055 → R-067).
**Re-open when:** the owner wants 30 days as the product default for every customer.

## D-0086 — 7 Oct 2026 — Fute Global's Apollo account may be used for PACE lead discovery (R-157)
**Decided (owner, in their words):** "I also need you to confirm you're allowed to use Karen Smith's account this way — Yes"; one test search through the Apollo connector — "Use it". Target market for lead discovery: "IT jobs as well as non IT jobs — medical, manufacturing, construction, legal, accounting, property management, engineering and all; big, small and medium companies."
**Facts recorded:** the connected Apollo profile is Karen Smith, RA Manager, futeglobal.com (the customer's account, not the owner's). The owner says they ticked every endpoint when creating the PACE API key; the proof is the Test button on Admin → Integrations, never a key pasted into chat. One Organization Search through the connector (accountant postings, Texas, 51–500 staff, posted since 23 Sep, 5 results) returned 49 matches and cost **6** credits (172,100 → 172,094: 1 export + 5 direct-dial), not the 1 the docs promise for the API — the API cost must be measured when PACE calls it.
**Re-open when:** the owner chooses a different discovery source, or Apollo's terms/plan change.

## D-0087 — 7 Oct 2026 — How the Lead Finder behaves (owner's answers, R-157 / R-158)
**Decided (owner, in their words):**
- **A review card has three choices: accept, reject, wait.** "The wait time can be fixed by the admin of the organization." (Reject = never shown again to that person; wait = comes back after the admin's number of days.)
- **Saved searches are personal** ("its personal"), run nightly for the person who made them.
- **Contacts are picked in the same window, before anything is saved.** "Yes, saved into the system or the database, if every search result is added then the storage build will be humongous" — so NOTHING from a search result is stored as a lead until Accept; only a small "seen/rejected/waiting" mark is kept.
- **Ownership:** the lead goes to the user who creates it, and only people the admin has enabled for the feature can use it ("the recruiter don't have access to job opening"). First enabled for RA, BD manager and RA lead.
- **New direction (R-158):** feature access is managed per FEATURE — "now we have features for users, I want users for features."
- The 30-day rule, owner shown on a duplicate, up to 3 contacts a person accepts, Boolean search and notifications later — all "okay".
**Open (asked, not yet answered):** an RA does not send the emails (a BD's mailbox does) — where does an RA-created lead go for outreach; the default daily card cap; how a lead without the posting text gets its email (see below).
**The big gap, owner's words:** "this is a big gap … the time to add the lead will be more if the user is asked to copy paste the JD". Design response: adding a lead never waits on the posting text; the email writer already has a "thin posting" mode (`THIN_POSTING_CHARS` 300, never invents duties) — the plan is a tiered posting fetch (employer's own ATS page, the employer's own site, a licensed Google-Jobs-style source if it proves to carry the text) and, where none works, short emails built from Apollo's FACTS (open roles and since when, headcount growth, industry), never invented.

## D-0088 — 7 Oct 2026 — Lead Finder: the daily number is the admin's, and RA leads go to the pool
**Decided (owner, in their words):** the daily number of leads per person should not be a fixed 25 — "maybe the admin can set n number of leads to be generated per day per user assigned this feature", because "in this market I think it's less". An RA-accepted lead: "goes to the unassigned pool".
**Raised, not yet decided (R-159):** when many organisations run similar searches they get the same companies; the owner asked how Apollo's cost and the overlap are handled at scale. Each organisation must bring its own Apollo key (D-0055, R-067); there is no shared Apollo cache across customers.
**Re-open when:** the owner chooses between the crowding signal and plain per-organisation limits, or Apollo confirms what a customer may cache.

## D-0089 — 7 Oct 2026 — Lead Finder: BD leads go straight to the BD; a company claim before launch; credit model
**Decided (owner, in their words):** a BD manager's accepted lead goes "straight to them". The Apollo-credit ceiling per organisation per day is "set by admin, because they are going to buy it on credit based from us". The crowding idea must NOT show anybody a count or a message — "it reduces the trust within us, because later when 100+ users joins, it will be shown to everyone of them" — but protection against organisations chasing the same company "should be built before I push it in the market"; the owner's open worry is "the real time check on that and how it works". Per-person reveal limits per list, possibly charged for. The owner asked whether PACE can buy Apollo under its own domain and let customer organisations use those credits.
**Answer recorded (R-160):** not under Apollo's standard terms; needs a written Apollo agreement or the approved OAuth partner route. This also corrects D-0055's "customers paste their own key" — the terms say integrating the API with a product needs Apollo's approval.
**Design for the claim (R-159):** a shared claims list keyed by the company's website, no names, no counts; checked when a card is shown and when it is opened; claimed atomically on Accept; 30 days, ending early if released/closed/unworked. Rampart reviews it.
**Open:** whether the claim starts at Accept or at the first email actually sent; whether to approach Apollo now.

## D-0090 — 7 Oct 2026 — Company claims stay INSIDE one organisation; the cross-organisation claim is dropped (reverses part of D-0089)
**Decided (owner, in their words):** "we are not building competition within the customers. It can be shown within users of one organizations" and, again, "not cross companies, within organization is fine". The claim starts "when someone accepts".
**What this means:** the shared claims list across customers (R-159) is NOT built. The only "who has this company" rule is the one inside an organisation: the website / LinkedIn / name check, the owner shown, the 30-day company cooldown (`company_cooldown_days` is now 30 on the live site, D-0085) and the active-job rule. The mockup case "taken elsewhere" was removed. Customers can still chase the same company; the answer to that is ranking and the daily limits, not a claim.
**Still to guard (small):** two people in the SAME organisation pressing Accept on the same company at the same second — the claim is made in one conditional step so only one lead is created.
**Also answered (owner asked "after they connect their Apollo, can they use the credits we have bought?"):** no. A registered Apollo partner app connects each customer's OWN Apollo account and spends THEIR credits. Spending credits PACE bought is a resale arrangement that needs a separate written Apollo agreement (R-160). The owner's wish that organisations "buy it on credit from us" therefore depends on that agreement; the partner app alone does not give it.
**Re-open when:** the owner wants any protection between customers after launch, or Apollo agrees to a resale arrangement.

## D-0091 — 7 Oct 2026 — Build step 1 (the add rule) first, test it live, then finesse, then judge the Lead Finder
**Decided (owner, in their words):** "Build the decision one then, we will test it how it working on live model and then work on the finesse and then see if the lead finder really works." The "decision" is the add check ("can I add it?"): website / LinkedIn / name match, the owner named, the active-job rule, the 30-day cooldown. The owner will not hold the Apollo email for a website: "I have to buy domain and set it up and all" — so the email waits for the domain.
**Also said:** in practice RAs and recruiters find leads on ZipRecruiter, SimplyHired, Indeed, LinkedIn, Glassdoor and company career pages — not only through a data provider (R-161: a quick add from a job link).
**Built as (dev branch, not merged):** `services/lead-decision.js` (pure rule), `services/lead-check.js` (loads one organisation's companies, leads, job orders, people), `routes/lead-check.js` (`POST /lead-check`), enforced in `routes/lead-sources.js` approve and `routes/jobs.js` `POST /jobs` (RA), shown in `43-page-sourced-leads.js` and `15-ra-entry-form.js`, `retro.css` `.ld-box`. Migration 057 adds `companies.linkedin_url` (APPLIED to the live database 7 Oct, before the merge, on the owner's "Yes change the database and merge it"; the code also runs without it).
**What "active" means (my call, owner may change it):** a lead in any stage except Rejected and Future, or a job order with status Active. The cooldown counts from the most recent lead of any stage.
**Deliberately not changed:** `POST /jobs` is still refused only for RAs (a BD / RA lead / admin adding by hand is not blocked, as before); `/jobs/bulk` still filters by the cooldown only; BD job-order creation keeps its own cooldown check. Widening these is one line each if the owner wants the full rule everywhere.
**Re-open when:** the owner wants admins or BDs held to the same rule on every path, or "active" defined differently.

## 2026-10-07 — D-0092: Lead Finder steps 2 and 3 are built for the owner to try live (R-157)
**Owner said:** "okay in RA this works. Now build stage 2 and 3 for me to see how this thing really works."
**Built (dev branch, awaiting the owner's go to apply migration 058 and merge):** saved searches (personal, up to 20; sector presets fill job titles), a daily run per search and a "Run now" button (one Apollo company-search page, staffing firms left out, companies the add rule already blocks left out, only the best N cards per person per day written), cards with Accept / Wait / Reject, and the one Accept window (job, up to 3 contacts with revealed verified emails or typed by hand, where it goes). Access is per person, switched on by an admin (admins always have it); every Apollo spend is counted on an organisation daily credit meter and a per-person reveal meter.
**My calls (owner may change):** defaults — 25 cards a person a day, wait 14 days, an unreviewed card is deleted after 5 days, 300 Apollo credits a day per organisation, 30 email reveals a person a day (Admin → Settings → Lead Finder). A search can be re-run at most once a minute. Opening a company's job list is a separate credit, taken only when asked. Only the lead title and Apollo's counts go into the lead's email notes — Apollo cannot give the posting text, so no duties are ever invented.
**Honest limit:** the Apollo response shapes are from its documentation, not yet seen live; "Check what my key can do" (Admin tab, about 2 credits) is how we find out first.
**Re-open when:** the first live run shows a different Apollo shape, or the owner wants different defaults.

## 2026-10-07 — D-0093: the Lead Finder's first live use — five reactions and what they decided (R-157)
**Owner said (after trying it live):** both searches showed "Running…" together; one lead should be able to cover several open jobs without paying credits again; a person found for one title vanished when another title was searched; a saved lead did not show in Leads until a browser refresh (wants a refresh button like the Inbox's); and no email is written for a Finder lead — how should that part work?
**Built:** only the search that is running says Running…; cards from several searches get a row of choices to view one search at a time; one lead can carry up to 5 jobs (the first is the main job, the rest are kept as "also hiring" in the lead's notes and email facts — no extra credit, the list is already on the card); a new people search ADDS to the list and keeps anyone already revealed or ticked; the Leads page has a refresh button and refreshes itself after a Finder Save.
**Email (my call, the owner can overrule):** a Finder lead that goes to a BD manager gets "Write the first email now" ticked in the Accept window. It writes into Email → Pending for the person to read, using the same `/emails/generate` step Take-leads and Import use; NOTHING is sent until a person presses Send. A lead that goes to the pool gets no email until a BD takes it. Automatic sending on lead creation was deliberately not built: the lead's job text is only a title plus Apollo's counts, a wrong contact would damage the sending domain, and the owner's own double-send and cooldown rules assume a human sends.
**Re-open when:** the owner wants an admin setting that sends automatically after a delay, or a way to add another job to a lead that already exists.

## 2026-10-07 — D-0094: Find Leads keeps a record of what its searches found (R-157)
**Owner said:** "The leads which are saved are not stored anywhere in Find Leads. Saved searches are missing which should show the leads that were pulled out earlier."
**Built:** a "Saved & past" tab — what each person's searches found, in three groups: saved as leads (with the job and stage, and an Open lead button), waiting (with the date it comes back and a Show now button), turned down (name only; never shown again). Filter by search; search by company name; each saved search on My searches says what it found before, with a See them button. 90 days by default, "Show everything" reaches the rest and the page says how many are hidden.
**Limits I kept on purpose (owner's earlier storage rule, D-0087):** a card nobody decided on is still removed after 5 days (admin setting), and a turned-down company keeps only its name. A lead is described only to the person who made it or now holds it. Turned-down companies cannot be brought back (their details were dropped).
**Re-open when:** the owner wants undecided cards kept longer, or turned-down ones restorable.

## 2026-10-07 — D-0095: fix the three stalled-send flaws (R-162)
**Owner said:** "Yes build it and merge it. It only works when there is an error in email sending right?" **Answered:** no — it is not about a sending error. (a) and (b) matter when a server restart kills a send or when someone clicks Send all pending twice; (c) is on the card every time a send runs.
**Built:** a stored send record that still says `active` with no live run in this server process (and older than 90 s) is served as "Sending stopped early" — how far it got, that the rest are still in Pending, and what to press — and is kept like any finished run (gone after 15 min), never auto-dismissed; Send all pending decides before it answers (a second click is told "already running" and gets its rows back on the list); the card shows "Still to go" for a run in flight so the numbers add up to the Total. **Not fixed:** why the 20-minute pending-retry sweep did not catch the stranded rows (R-163).
**Re-open when:** a second server instance is ever run (the liveness check is per process).

## 2026-10-07 — D-0096: the Finder lead's job and mailbox are the owner's choice (R-157)
**Owner asked (after seeing the email trigger):** is the "from" mailbox taken at random, which job is used when several are ticked, and can both be chosen?
**Found:** the mailbox came from `assignmentQueue(…, 1)` — for one lead that is the mailbox with the biggest daily limit, else the first in the list: not random, not chosen, almost always the same one. The email is written from the lead's `position` (the first job ticked) only; the extra jobs and Apollo's counts are saved on the lead but the email writer (`engine-draft.js`) is never given them — an earlier statement of mine that the email would mention "3 open roles" was wrong, and was corrected to the owner. (AI first emails are ON live, `sys_engine_ai_first_email`=1: Pending shows the template; the AI rewrite happens at send.)
**Built:** the Accept window has an explicit **Main job** choice (the lead and its email are for it; the other ticked jobs ride along as "also hiring") and, for a BD manager, a **Send from** list of their own connected mailboxes with how many each has sent today, pre-selecting the one that has sent the fewest (then bigger limit, then address). The server refuses a mailbox that is not the person's own or is not connected (nothing is saved).
**Not built (offered):** making the email MENTION the other jobs — that changes what the email writer is told and needs its own rules and checks.
**Re-open when:** the owner wants the email to mention the other jobs, or a mailbox choice for pool leads.

## 2026-10-07 — D-0097: Find Leads has two ways to search — Daily run and Find leads now — and saved leads show their POCs and jobs (R-157)
**Owner said:** merge or combine Find Leads and Sourced Leads, or show the found/created leads with their POCs and jobs; add two sections — a daily run (saved criteria, searched every day) and a single search for open jobs now, because after Run now the search stays active every day. **Chose (my recommendation A, answered "okay" / "Do this"):** two sections plus expandable POCs and jobs in Saved & past; NOT a merge of the two pages (different pipelines: Apollo company search vs. watching named companies' career pages; Sourced Leads' queue means "waiting for approval", a saved lead is already a real lead).
**Found:** every saved search was already a daily search from the moment it was saved; Run now never changed that — there was simply no way to search without saving.
**Built:** tabs Today's cards · Find leads now · Daily run · Saved & past. **Find leads now** (`POST /finder/find`): criteria in, cards out, nothing saved or scheduled (cards carry no search id), 1 Apollo credit from the organisation's daily limit, its own ceiling per press (`finder_cards_per_run`, 25, 0 = off — my call), one press a minute, and its cards are NOT counted in the person's daily number. "Also run this every day" is the only way it becomes a daily search. **Daily run** says plainly that these run every morning and that Run now does not change that. **Saved & past** rows expand to the lead's POCs (from its contacts) and jobs (the main one, "also hiring", and what Apollo listed).
**Not done:** Sourced Leads stays its own page (option B — moving it inside Find Leads as a tab — was offered, not chosen).
**Re-open when:** the owner wants one menu item for both, or a different ceiling for one-off searches.

## 2026-10-08 — D-0098: the Find Leads search form — more industries, tick-able titles, a 0–30-day slider, preferred companies by name (R-157, R-165)
**Owner said (after first live use, with a screenshot):** rename "Name" to "name of the run"; "we have very limited industry … the kind of leads that are created are very limited" — show the rest of the industries, let the user pick several; once an industry is picked "very limited type of job titles are shown and the user cannot select, multiselect or select all"; replace "posted within yesterday / 3 days" with a bar the user can swipe, 0 to 30 days; replace "only these companies" with "preferred companies" — type a name, "can AI search the correct name with location and suggest", and let the user add as many as they want. Also asked how Apollo gets live postings and what else could supply them for a small customer with no Apollo budget (answered; see R-164).
**Chose / built (my calls where the owner left them open):** (1) The box is "Name of the run". (2) About forty industries instead of eight (the first eight keep their ids), several can be picked; an industry is a SHORTCUT that offers 9–14 typical titles to tick — it does not filter companies (the search runs on titles, place, size, industry words, preferred companies). (3) Titles: tick any, Select all / Clear per industry, type your own; up to 40 at once (was 15) so "select all" across industries still fits one Apollo query. Nothing is pre-ticked — the old page pre-filled six titles, which hid the choice. (4) Posted-within is a slider, any whole number 0 (today) to 30; 0 is a real answer and is stored as 0. (5) Preferred companies: the person types a name and presses Look up; PACE asks Apollo for companies with that name and lists the real matches with city/state, website and size; they pick; repeat for as many as they like (30). A pasted website is added directly, free. **AI was NOT used for the name lookup (my call, the owner asked "can AI…"):** an AI asked for a company's website writes a plausible one that may belong to another company, and the website is what the search is narrowed by; Apollo's own company list is the dependable source. The cost is 1 Apollo credit per lookup that finds something (counted in the organisation's daily limit, never retried, one press per 2 seconds), so it is a button, not search-as-you-type.
**Needs a migration (059):** the table only allowed 7/14/30 days, so a slider value would be refused; 059 widens it to 0–30 and adds `sectors` (all picked industries) and `companies` (the chosen companies with their place). Applied to the live database 2026-10-08 on the owner's "Yes" (no sends running), before the code merged.
**Not done / honest limits:** Apollo's company rows may not carry a city for every company — the list then says "No location on file" and shows the website instead (Apollo's company-search sample response in its docs shows no city field; live shapes were not checked). An edited search remembers all its industries only from the first save after 059.
**Re-open when:** the owner wants name suggestions as they type (costs a credit each keystroke batch — would need a free source), or wants an industry to filter companies as well as suggest titles.

## 2026-10-08 — D-0099: Find Leads must also work by job title alone, with no paid database — for customers who cannot afford Apollo or ZoomInfo (R-164)
**Owner said:** "what if the user does not know which company to search from, and just wants to search with job title … that company search idea is also good, build that, but search by job title is what I am looking for … I am thinking to cater all type of companies, people who do not have too much money to take an Apollo subscription or ZoomInfo subscription." Earlier: a choice per search — Apollo credits or the other sources.
**Direction (the owner's; my design, not yet built):** a "Search with" choice on the form — Apollo / Free job sources / Both. Free job sources = a job-search service (JSearch first — its sample returns the employer's website; Adzuna second) queried by title, place and recent days; same cards, same Accept. Preferred companies stays (optional; empty = every company). **Each organisation brings its own key** (R-067) — one shared free key would be used up in days. A free-source card shows only what the source knows (no company size/phone/growth); contacts are typed by hand until a finder is chosen. The six company job-board readers (`lead-sources/index.js`) cannot search by title across companies — they need a company's board address; a "board finder" for Preferred companies is a free add-on.
**Not decided / to check before building:** both vendors' terms and free allowances (a third-party page said JSearch 200 requests/month, Adzuna 2,500 calls/month — unverified); how much the owner will pay per customer; whether a paid contact finder is offered.
**Order proposed to the owner:** release the form (migration 059) first; then read the terms and build "Search with". **Re-open when:** the owner picks a different first source or wants PACE to hold one paid key for everyone.

## 2026-10-08 — D-0100: "Search with" — Apollo, free job sources, or both — built on JSearch with a key per organisation (R-164, D-0099)
**Owner said:** "Do you want me to start that build now? — yes build it" (after being told: free job data is not free at scale, so each organisation brings its own key; JSearch first; Adzuna's terms look wrong for lead generation).
**Built:** a "Search with" choice on both forms and on every saved search (migration 060 adds `finder_searches.source`, default 'apollo' — every existing search is unchanged). **Free job sources** = `services/jobs-jsearch.js` (the only JSearch caller; `GET api.openwebninja.com/jsearch/search-v2`, key in the `x-api-key` header, one page of ≤10 jobs = one request, never retried). A run asks for up to N "title jobs in place" searches (N = admin setting `finder_jsearch_requests_per_run`, default 3; a daily run rotates through a long list by the day number, a one-off takes the first), trims results to the exact posted-within days (the service only has today/3 days/week/month), groups jobs by employer into the SAME cards (the jobs ride on the card, so "See their open jobs" costs nothing), leaves out staffing firms and companies the organisation already works. With preferred companies chosen, it searches by company name and keeps only those companies' jobs that fit a chosen title. **Both** = Apollo plus free, a company in both is one card (Apollo's record + the free source's jobs); if one source fails the other still delivers and the note says so.
**The key is the ORGANISATION's own (my calls on where it lives):** stored per organisation (`int_jsearch_api_key__org_<id>` in `app_settings`), set and checked on Find Leads → "Access & job sources" (admin only), shown only as "••••1234", never returned; NOT on the global Admin → Integrations page (those keys are deployment-wide, R-067). Requests are counted per organisation per day (`finder_jsearch_daily_requests`, default 10 — the free plan is 200 a month; written before the call is trusted, so over-counting is the safe direction).
**Limits shown to the person:** company size and industry words are Apollo-only; free-source cards show employer, place, jobs, how fresh and where seen, never a size they do not know; no people or emails — with no Apollo, or a company with no known website, the Accept window says so and opens "Add someone by hand".
**Not done / honest limits:** not run against the real service (no key here) — the request and answer shapes are the vendor's published docs (read 8 Oct), so the first real Check-my-key is the live proof; the vendor's terms do not say whether ONE PACE key may serve many customers (hence a key per organisation — ask them in writing before ever changing that); the "board finder" for preferred companies and a paid contact finder are not built (R-166).
**Re-open when:** the owner wants PACE to hold one paid key for everyone (needs the vendor's written yes and a price), or a different first source.

## 2026-10-08 — D-0101: the free-source daily default is 6 requests, not 10; and which JSearch front door is unconfirmed (R-164, D-0100)
**Owner asked** (pasting what a request costs: one credit per page of up to 10 jobs, any endpoint; errors partly charged) "Are we designing like this?" **Found:** yes on cost per search (one page per request, no other endpoints, "Check my key" is one search). **Changed (my call):** the default `finder_jsearch_daily_requests` is 6 (a free plan is 200 a month ≈ 6 a day; 10 a day would run it out mid-month and every later search would fail with "used up"). **Open:** the code talks to OpenWeb Ninja's own address with an `x-api-key` header; the owner's text describes RapidAPI (a different address and different headers) — a key bought there would be refused. Which one the owner signs up on decides whether a second "where did you buy it" choice is built. We count a request BEFORE sending it whatever happens (over-counting is the safe direction); the claim that 5xx/429 are not charged is unverified and not relied on.

## 2026-10-08 — D-0102: eight things from the owner's first look at the live Find Leads — login scroll, key moved, AI status folded, Sourced Leads becomes a tab, calmer form, new cards first, rename, and the "new manager" question (R-167, R-168)
**Owner said (with five screenshots):** (1) on a 13-inch laptop the login page could not be scrolled to the password box; (2) "the JSearch key is in the wrong place — it should be in API and integrations in the admin tab, under Apollo"; (3) the Integrations window shows a lot of AI diagnostics that "remain forever"; (4) "Sourced Leads and Find Leads are still different — I remember asking you to merge them and put the leads we have pulled into Sourced Leads as a section in Find Leads"; (5) the Find Leads form shows too much information; (6) new cards must come first in Today's cards, the older ones below; (7) rename Lead Insights to Outreach Insights; (8) a new manager should not get a sequence already set up — and an example: their VP connected his other company's mailbox and sent three emails that said Fute Global, with the wrong title and signature.
**Built (1–7), my calls:**
- (1) The login wrapper was a fixed-height box with its overflow hidden: a card taller than the window lost its bottom with no scrollbar. It now scrolls and the card centres with `margin:auto` (centring with `align-items` would cut the top off first). `test/login-scroll-smoke.mjs`.
- (2) The JSearch card is in Admin → Integrations & API Keys directly under Apollo's. I kept the existing per-organisation server routes (`/finder/admin/jobsource`: save, check, remove — the key is still the ORGANISATION's own, masked, never returned) and moved only the screen; Find Leads' admin tab now shows a status and a button that opens that window. Supersedes D-0100's "set on Find Leads → Access & job sources".
- (3) "Show once": the AI status is one sentence by default ("AI IS NOT WORKING" + a note when a real feature fell back), the provider lines and model lists open with "Show details" and a test you just ran opens them ONCE — the next visit starts folded. The AI intro is two sentences; the per-feature budget table is folded. A real failure is never dropped (it stays in the sentence).
- (4) D-0097 had chosen two sections and NOT a merge (I offered "Sourced Leads as a tab" as option B; the owner answered "okay / do this" to A). They have now said B is what they meant. Sourced Leads is a TAB of Find Leads ("Sourced leads" with its count): one menu item, the badge counts the queue. Someone who may review sourced leads but is not switched on for the Lead Finder sees only that tab. `goPage('sourced')` and an old saved place land on the same page.
- (5) The form lost its explainer paragraph, the description beside each radio (now tooltips), the long hints on every label and the three lines under Preferred companies. What a press costs sits beside the button ("Uses 1 Apollo credit", "up to 3 job-source requests", both). Company size, industry words and Preferred companies fold under "More filters" (open by themselves when something is in them; the button counts how many are in use). The stat strip and the long blurb are gone: the day's usage is one quiet line ("Today: Apollo 3/300 · emails 1/30 · job sources 0/6").
- (6) Server: every card of a run is stamped with ONE time (cards used to get their own moments), and Today's cards are ordered newest run first, best match first inside a run; the screen draws "New · found 5 min ago · 2" above them and "Earlier cards · 1" above the rest (only when both exist). No migration.
- (7) "Lead Insights" is "Outreach Insights" (menu, top bar, page heading); the page id is unchanged.
**Found while testing:** the selected-pill tint was see-through, so at night it left ink-coloured text on the dark ground (1.05:1) — the night-contrast suite caught it; the tint is now laid over the cream paper.
**(8) NOT built — it is a design choice for the owner (R-168).** Findings are in the roadmap row.
**Re-open when:** the owner wants the key box back on Find Leads, the old two-page layout, or the stat strip.

## 2026-10-08 — D-0103: any person sets up their own outreach — their own mailbox, and what it WRITES FOR ("sends as") (R-168 stage 1)
**Owner said (answering the open questions after D-0102):** people who have never saved a sequence "are asked to set up their own during their login or as a task on the dashboard — now we have to design what all they can set up and how"; for the VP's case "lets try [a 'sends as' per mailbox] to see how it looks"; and "it's not about new managers — any user. Also right now only admin can add an outreach mailbox to a user — can the user themselves set up their outreach mailbox?"
**Built (stage 1), my calls:**
- **Self-serve mailbox.** Any person adds, signs in to, and removes THEIR OWN mailbox (Outlook or Gmail): `routes/microsoft.js` and `routes/gmail.js` connect/disconnect now allow the slot's own person or an admin (`403` for anyone else's; a foreign organisation's is `404` as before); `POST /users/:id/emails` already allowed self — for a non-admin it now FORCES the default daily limit (150) and not-primary, and REQUIRES "sends as"; `PATCH` of the daily limit is admin/team-lead only. The plan wall (`402 plan_limit`, e.g. Free = 1 mailbox) still applies and its sentence reaches the person.
- **"Sends as"** = per mailbox: company, job title, postal address (all required for a self-serve mailbox — the anti-spam law requires the sender's own address), phone and website optional. Stored as JSON `ue_<mailboxId>_sends_as` in `app_settings` (no migration), set by `PUT /users/:id/emails/:eid/sends-as` (the mailbox's own person, or an admin/team lead). It builds the mailbox's signature (`email-signature.js` `signatureFromSendsAs`; `{{sender}}`/`{{senderemail}}` stay merge fields; saved when the mailbox has none, or on "rewrite from these details") and is what the AI writes under: `/outreach/*` (company name + title) and the engine's first email use the SENDING mailbox's company and title, else the organisation's name and the profile's title as before.
- **A signature with its own address is never given Fute Global's.** `ensureSignatureAddress` used to add Fute's Dallas address to every saved signature lacking it (the anti-spam address rule, written for one customer); it now leaves a signature alone when it carries the hidden marker or any ZIP of its own. Existing Fute signatures behave as before.
- **My Setup** (new page, `public/js/69-page-mysetup.js`; menu: under Setup for everyone): three steps (connect a mailbox · say who each writes for · write your first sequence — the last only for people who have one), the mailboxes with who each writes for, add/edit window with the signature shown as it is typed. **Today** shows a calm card "Finish setting up your outreach · n of 3 done" for people who send outreach, until done (draws nothing after, nothing before the mailboxes have loaded).
**Not done (R-169, stage 2 — owner's design call):** (1) the STOCK sequence wording still spells out "Fute Global LLC" for a person with no sequence of their own — the My Setup step says so plainly; making it use the sending mailbox's company needs a new send-time merge field (`{{sendercompany}}`) filled at every send path, and a decision on whether a person with no sequence may send at all; (2) what else a person sets up (see R-169), and how a person with no sequence is asked at login.
**Re-open when:** the owner wants a different home for the page, an admin approval step before a person's mailbox may send, or the limit raised by the person.

## 2026-10-08 — D-0104: My Setup stage 2 — a sequence of your own is needed to START outreach; first-login tasks; sending days and hours; a logo and formatting in the signature (R-169 c–g)
**Owner said:** "Setup list: mailboxes and 'sends as' are done. Next: the first sequence (with a neutral starter to copy), a link to the AI writing-style note, and sending days and hours, with the daily number staying with admins." / "daily number with admin." / "At login, the user's first task is to set up mailbox and sequence; it will be added to their tasks. Once the mailbox is set up they can send individual emails. If they want to send outreach emails or leads outreach from Lead Finder, they need to set up a sequence, which is shown to them and they can set up easily." / "Login walk-through [first, before the sender's-company fix]." / "During mailbox setup the signature section should also have logo embedding; the signature will have the logo or can use the logo theme for its creation; it should be optional. In the signature preview, formatting should be enabled: font size, type, colours, italics, bold, underline and other formattings." / "Update the context window and archives and then merge these changes along with the context."
**Built, my calls:**
- **The gate is at the START of outreach only.** Without a sequence of their own (`tmpl_o1_body` saved, > 20 characters, not the legacy marker — `services/sequence-starter.js hasOwnSequence`) a person's leads are skipped when emails are WRITTEN (`services/lead-outreach-queue.js buildPendingEmailsFromJobs`, used by `/emails/generate` and `generateEmailsForJobs`) and the Lead Finder's "write the first email now" is off and says why. Already-queued mail, follow-ups and individual emails are untouched. Chosen over blocking sends because nobody has a sequence today (live DB): blocking sends would have stopped every existing person the day it shipped. The response names who was skipped (`needs_sequence`) and the screen says so in a window.
- **The starter** (`POST /my-setup/sequence/starter`, bd / bd_lead / admin): the stock three emails with the person's own company (from their mailbox's "sends as") in place of "Fute Global LLC", days 3 and 7; 409 if they already have one unless they confirm replacing; the person edits it after in Email → Sequence. The AI writing-style note is linked from the same page.
- **First-login tasks.** `POST /my-setup/sync` (called once per sign-in and after each step) puts "Set up your outreach mailbox" and "Write your first sequence" on the person's Reminders list (type `setup`, "Getting started"), closes them when done, and does not re-raise one the person closed without doing for 3 days. They also appear in "Needs you today". Pure planner: `services/setup-tasks.js`.
- **Sending days and hours per person** (`GET/PUT /my-setup/send-window`, `services/send-window.js`): the organisation's window stays the outer limit; a person can only NARROW it (days, start, end hour; days read in the lead's local zone). The send loop and the pending summary use it. **The daily number stays admin / team lead only.**
- **Signature logo (optional) and formatting.** Logo ≤ 200 KB, resized in the browser (120px tall), type sniffed by bytes on the server, stored in a PUBLIC bucket `signature-logos` (migration 061 — **NOT applied; needs the owner's go-ahead**; until it exists the upload answers 503 and the mailbox saves WITHOUT a logo with a plain sentence). The logo sits beside the words (not embedded in the mail); "use the logo's colour" takes the dominant brand colour for the name and links. The signature preview is a real editor: font, size, colour, bold, italic, underline, strike, align, link, clear; font/size/colour are inline styles on the selected words; the locked name/email chips are formatted as a whole; saved HTML is sanitised server-side (`sanitizeEmailHtml`) and hand-formatted signatures are kept (a "Rebuild from the details above" button returns to the built one).
**Not done:** the send-time `{{sendercompany}}` field (R-169 f) — probably unnecessary now that outreach cannot start without the person's own sequence; Random-template mode (`random_template_mode`) still uses the stock presets even with an own sequence; an organisation-level Company profile (R-169 h); the logo bucket.
**Re-open when:** the owner wants sending blocked too, an admin to set another person's window, or the logo embedded in the mail itself.

## 2026-10-08 — D-0105: the signature-logos bucket is created (migration 061 APPLIED)
**Owner said:** "Go ahead with logo storage bucket." Applied to the live database (project `teiqievahzhllojvgsku`) through the Supabase tools: bucket `signature-logos`, public, 200 KB limit, png/jpeg/gif/webp only; verified by reading `storage.buckets` back (the private `candidate-docs` bucket is unchanged). No policies were added, so nobody can list or write it except PACE with its service key. The code merged in #313 needs no change: the logo upload (`POST /users/:id/emails/:eid/signature-logo`) stops answering 503 `not_ready`. Not yet exercised with a real picture on the live app — the owner's first logo upload is the proof. Next migration: 062.

## 2026-10-08 — D-0106: no wording is created for a person — the sequence is theirs (owner's answers to the three open R-169 items)
**Owner said:** (1) the company name in an email "should depend on the sequence template, not coded in the backend" — so NO send-time `{{sendercompany}}` field (R-169 f is DROPPED); (2) a company profile per new organisation "can work, but where will it be used?" — a question, answered in chat, not yet decided; (3) Random-template mode still using Fute's stock wording: "no — each company will have its own template and wording; we don't create anything and give it, and the system does not create anything and give it; each user creates it and sets it up."
**What this means in the code (found by reading, NOT yet changed):** (a) Random-template mode (`buildRotatingTemplateDeck`, `getVariantById` in `email-vars.js`; used by `services/lead-outreach-queue.js` and the follow-up builder in `index.js`) writes first emails and follow-ups from PACE's built-in presets, which name "Fute Global LLC" — even for a person who has their own sequence. (b) A follow-up with no saved follow-up text falls back to `DEFAULT_TEMPLATES` (same Fute wording), and `resolveTemplate` does the same for an empty first email. (c) The "starter" built in D-0104 is the stock recruiting pitch with the person's company swapped in — that IS the system giving wording. **Proposed, awaiting the owner's yes:** remove Random-template mode's presets (hide the switch); make the starter a blank editor with the merge fields listed and hints, not a pre-written pitch; decide what happens to follow-ups when a person has no follow-up text of their own (the owner's own team currently sends the stock follow-ups — stopping them is the owner's call).
**Re-open when:** the owner wants a library of example sequences people may choose to copy (an opt-in gallery is different from the system filling the box).

## 2026-10-08 — D-0107: one prompt, not two; details not explanations; a failure can be closed (owner's three screenshots)
**Owner said:** (1) the same setup prompt showed twice (a "Finish setting up your outreach" card on Today AND the same task under "Needs you today") — "repeat notifications or reminders need to be removed from the system"; (2) the mailbox list showed "Writes for: not said yet … use the organisation's standard name…" with two buttons doing the same thing — "similar duplication; just the signature and sender details are to be written, not explanation"; (3) the "Didn't send" panel on Pending stays for ever — "once this error is shown, the user should be able to retry or close it; showing it always is not the best UI design."
**Done, my calls:** (1) the Today card is REMOVED (the reminder is the one prompt; `renderMySetupCard` no longer exists). RULE for the future: a thing PACE asks a person to do appears in ONE place (their Reminders / Needs you today), never as a second banner of the same ask. (2) a mailbox row shows only the sender details ("Recruitment Manager · Company" + phone/website/address) or "Sender & signature: not set", and ONE button ("Set up…" / "Edit sender & signature"). (3) each of the person's OWN failed emails has Close (always) and Retry (only when the server says it can be retried); the header has Close all (own rows) and Retry all; a teammate's failed row, visible to a manager, has neither (acting is the sender's, D-0020). Close deletes only the failed row through the existing `DELETE /emails/:id` (the server refuses anything not pending/failed or not the sender's); nothing is sent; an address marked invalid stays marked.
**Not done:** a sweep of the whole app for other duplicated prompts — only this pair was reported; if the owner sees another, it is a screenshot away.

## 2026-10-08 — D-0108: "Reply" opens THAT email; a follow-up goes as a reply inside the conversation (owner, two screenshots + a bug report)
**Owner said:** (1) "When Reply in the mailbox is clicked, that particular email doesn't open — the mailbox does; this will confuse the user. Better a reply button integrated there, or open that email so the user replies to it particularly." (2) On a conversation where WE wrote last: "now we have to follow up or reply again as a follow-up, but that option is not here — an email button which goes as a reply to that last conversation would be great, then these suggestions would make sense." (3) "When Write the email is clicked, it takes to the lead; the email-writing window doesn't open."
**Done, my calls:** the server says which email a button answers (`services/reply-target.js`, returned as `reply_target {last, last_inbound}` by `GET /leads/:id/intel`, optionally narrowed with `?email=`): the newest message that sits in one of THE PERSON'S OWN mailboxes and has the provider's message id. "Reply" (their email) and "Write the email" (our newest email, so a follow-up lands in the same thread) now open the in-app mailbox on that exact message with the reply window already open (`mbOpenMessage`; replying to an email WE sent addresses the people it was sent to, never ourselves). Same behaviour on the "Needs you today" rows (reply owed, stage-suggested reply, chase a promise, nudge). Nothing is sent by opening it. When the exact email cannot be found or opened the person is TOLD in words and lands somewhere useful (their messages in the mailbox, or the addressed composer) — never silently on the lead. (3) was a silent fallback: `Write the email` required a timeline-derived address and otherwise opened the lead without a word; it could not be reproduced with a normal timeline, so the dependence on that timing is gone and the fallback now explains itself.
**Not done / honest limits:** the in-thread reply window is the mailbox's plain reply box — it does not have the AI "write it for me" help the addressed composer has (that stays as the fallback when no email of ours exists to answer); a candidate's thread still opens the mailbox searched to their address (candidates have no lead timeline); a lead's contact whose mail arrived in a TEAMMATE's mailbox cannot be opened by someone else (the mailbox only opens your own) — they get the fallback with the reason.
**Re-open when:** the owner wants the AI draft inside the reply window, or a candidate's conversation opened the same way.

## 2026-10-08 — D-0109: Deliverability is the admin's; bounce and open rates live on Outreach Insights; the spam check lives in the sequence editor
**Owner said:** the Deliverability tab "feels worthless" for a BD manager; it "should be with the admin"; "push the bounce rate and open rate to Outreach Insights if that's the only metric worth calculating"; then, to the plan put to them: yes to (1) the spam checker moving into the sequence editor, (2) dropping "reply rate by template", (3) admin-only (menu AND page).
**Done:** (1) the menu item and the page are admin-only, and `GET /admin/deliverability` and `GET /admin/domain-health` answer 403 to anyone else (the suppression and template-analytics routes are untouched — they have no screen of their own any more). The page lost "Reply rate by template", the stand-alone spam checker and the Personal / My team toggle; its "Bounced" tile now says what it counts — **invalid addresses** (all-time contacts marked invalid). (2) **Bounce rate** and **open rate** are on Outreach Insights — the person's own page, the manager's team table (two new columns) and a person's detail card — computed in `services/bd-insights.js` from the SAME sent emails the page already counts. **Bounce rate** = of the people emailed in the last 30 days, the share whose address has since turned out invalid (a bounce marks the contact invalid and a known-bad address is never emailed), to one decimal. **Open rate** = of the emails sent WITH open tracking, the share opened by someone who looks like the recipient (scanners, the sender's own network and opens within two minutes never count — `services/open-tracking.js`); tracking is on for some people only, so the base is the tracked emails. Not measured = **"—"**, never 0% (also when the read fails). (3) the spam check is a "Check for spam triggers" button under each email in Email → Sequence → My wording: it checks what is typed right now, saved or not, and answers in its own box without repainting the editor.
**Honest limits:** the bounce rate is "turned out invalid", not a count of bounce messages (PACE keeps no per-email bounce record; the daily per-mailbox bounce counter that drives auto-pause is separate and unchanged); a BD lead no longer sees whether a teammate's mailbox was auto-paused for bounces — the pause banner on the person's own Email page remains, and a "mailbox paused" notice on a lead's Today card is NOT built (offered); the spam check is not in the Sequences (workflow) step editors.
**Re-open when:** the owner wants leads to see their team's mailbox pauses, or reply rate per person broken down by wording.

### D-0110 · 2026-10-08 · STANDS (part) · Imports start Unassigned; managers hand leads out from the Leads tab (reverses part of D-0082)
**The owner said:** a manager's import was automatically stage Assigned, "thus they cannot assign those leads for outreach"; "when a lead is imported by anyone into the system, it should be unassigned stage, when an email is triggered to a POC in the lead the stage should be changed to assigned — only then." On the question of whether a manager may hand their unassigned imports to their own team: "yes … options to be given to assign the leads to themselves or any manager assigned under them as an assign button in the leads tab."
**Decided:** (1) every import lands Unassigned (D-0082's "a BD's import is theirs" no longer holds for imports); (2) the Leads tab gets an **Assign** button for the manager: to themselves or to anyone in their own reporting chain — nobody outside it. **Not yet decided (asked):** whether Find Leads leads follow the same rule; whether the person can choose how many leads go from each email ID (today the system spreads them by remaining room, shuffled); the owner has not said "build" — nothing is built. **Re-open when:** the owner answers those two, or a manager outside a chain needs to be handed leads.

### D-0111 · 2026-10-08 · STANDS · "Build all the changes" — Unassigned starts, Assign with per-email-ID counts, saved-card actions, wording per email ID
**The owner said:** on wording — "Option 1 [wording per email ID, not only per person] — because we are building a production system"; on the blank-page risk — "there can be an option to select one email for all from email ID outreach or individual, which solves that problem"; on whether the system or the person chooses which email ID sends which and how many from each — a question, answered "yes, the person can"; then "Build all the changes from the start of this chat that we have discussed now."
**Built (dev branch, not merged):** (1) every import AND every Find Leads accept lands **Unassigned**, owned by nobody (reverses D-0082/D-0089's "comes straight to the person"); the stage becomes **Assigned** when someone is GIVEN the lead (Assign) or when the **first email for it is written** — that moment, not the later Send, is "triggered" (the email sits in the writer's Pending, so it needs a sender); `services/lead-claim.js`. (2) **Assign** on the Leads page — to me or anyone in my reporting chain (an admin: the company), ticked leads or every Unassigned lead I can see, and **how many go from each of the assignee's email IDs** (starts on the automatic split; must add up; more than a mailbox can send today is allowed — the extra go on later days); `routes/lead-assign.js`, `70-assign-leads.js`. (3) On a saved Find Leads card: the first email's state (not written / waiting in Pending / sent from X / didn't send) with Review & send, and **Email another job / person** — a second lead at the same company. (4) **Wording per email ID**: "one wording for all my email IDs" (default, unchanged) or "a different wording for each"; an email ID with none sends the person's, so no blank page; covers the first email, both follow-ups and a sequence's steps; `services/wording-scope.js`, keys `ue_<mailbox>_tmpl_*`, `u_<id>_tmpl_scope`.
**I softened one thing I told the owner:** a split is NOT refused for exceeding a mailbox's room today (owning is not sending); the window shows the room and says the rest wait.
**Honest limits:** an admin's Assign Leads page draws from every Unassigned lead in the company, so a manager's fresh import can be handed out by an admin before the manager assigns it (same pool, D-0034); an Unassigned lead only becomes owned when its first email is WRITTEN — an owner-less lead can still be seen by whoever created it; merge fields `{{sendercompany}}` (the cheap half of R-176) are NOT built; the random-template mode still uses stock presets for an email ID with none of its own; none of this has been seen on the live site. **Re-open when:** the owner wants an admin's Assign Leads to skip a manager's own imports, or wants the stage to change only on SEND.

### D-0112 · 2026-10-08 · STANDS · Follow-up 8 Oct (after #317): company field, thread choice, own sequences, bulk stage, per-person view
**The owner said (with screenshots / a recording):** the Outreach Plan should switch its wording with the Sending email, like the signature, and not show a list of email IDs; "your company name section, so it can be added easily for different email IDs"; "no option to enable the same thread or different thread emailing in the follow-ups" and no way to add more follow-ups; a BD has "no new sequence creation option"; "when a user logs in for the first time the standard template is already added"; clicking a merge field reset the subject; "the user or admin is not able to change the stage of the leads while multiselect … the admin should be able to see leads per user assigned and then select what time range"; "re-write with AI … keeping the variables", AI variants of the same outreach — **"we will build on the AI thing next"**; whether a person can turn off "AI writes first emails".
**Done (dev branch):** all of the above except the three it could not decide alone — (1) more than two follow-ups in My wording, (2) hiding the standard sequence / starting My wording blank for a new person, (3) the AI work (R-177, R-178), which the owner scheduled next. **Decided by the owner's own words:** the wording follows the Sending email (no list of email IDs); the company is said per email ID and filled at send; a follow-up's thread choice is the person's; a BD may create sequences; the admin's multiselect may release leads to Unassigned.
**Honest limits:** the company field is held, not blanked, when an email ID has no company (the email lands in "Didn't send" with the reason); a sequence a BD makes is visible to them and to leads/admins, not to other BDs; bulk stage changes are limited per role by the same server rules as before.

### D-0113 · 2026-10-08 · STANDS · A new person starts BLANK; the person chooses how many follow-ups (0–5)
**The owner said:** "the system gives a blank template for a user to start with. They decide the templates, emails, counts and all. That's why the first job of a user when they get onboarded is setting up mailboxes and setting up sequences and email templates to start with." On more than two follow-ups: "Do the database change. It's the user's choice to select the number of follow-ups, if any needed."
**Decided / built (dev branch, not merged):** (1) My wording starts with empty boxes — no stock subject or body is put in front of a new person; (2) a plain BD sees only the sequences THEY made (the company's standard, a lead's and other people's are not listed; BD lead / RA lead / admin still see all); (3) the person picks 0, 1, 2, 3, 4 or 5 follow-ups (two — day 3 and day 7 — until they choose), a day for each (each after the one before; moving one pushes the later ones after it) and, for each, same thread or a new email; migration 062 adds the follow-up 3–5 date columns (additive, NOT yet applied to the live database).
**Honest limits:** follow-up 1 and 2 left unwritten still send PACE's standard wording (the engine's fallback, as before) while 3–5 left unwritten are skipped — asked of the owner whether the standard should stop; follow-up rows are only created by the admin's distribution, so a lead handed out another way gets no follow-up chain yet (asked). **Re-open when:** the owner answers those two, or wants the standard sequence offered back with an "Add the standard one" button.

### D-0114 · 2026-10-08 · STANDS · The new architecture: a person sets up their own outreach first; the follow-up chain starts at the first SEND; nothing goes out that the person did not turn on and write
**The owner said:** (on "which other leads?") "The leads that were assigned till today will go from old architecture. New architecture — every new user, a manager who has to enable email outreach from the system, will first set up the sequence for the outreach. And when the RA lead assigns the leads to the manager, those leads will run through the sequence set by the user (manager, lead or normal ones). Standard wording — the user has to enable follow-up 1, 2, 3, 4, how many they want per sequence. If no follow-up is enabled then no follow-up email is triggered for that outreach."
**Decided / built (dev branch #319, not merged):** (1) a person who has not chosen has **no** follow-ups (the default of two is gone, for new chains); (2) the follow-up chain is made **when the first email is actually sent** (`services/followup-chain.js`, hooked in the send loop) for any lead, however it reached the person — Assign, Take, Find Leads, a first email written by its owner, or admin distribution — dated from the send day, only the follow-ups they turned on; not for a lead already in a Sequence or already holding a chain; (3) a chain made under the new rules (`follow_ups.chain_rules = 'own'`) sends **only wording the person wrote** — no organisation text, no PACE standard text; an unwritten follow-up sends nothing; (4) **old architecture is untouched**: every `follow_ups` row that exists today has `chain_rules` NULL and keeps its dates and its old fallback wording. Migration 062 gained the `chain_rules` column (still NOT applied).
**Reading I took (tell me if wrong):** "the sequence the user sets up" = the person's own Outreach Plan (first email + the follow-ups they turn on), not the separate Sequences builder.
**Honest limits:** the send-loop hook and the engine's strict switch are wired in `index.js` and covered by tests only through their pure parts (`followup-chain-smoke`) — not exercised end to end here; the chain's owner in the hook is the person who wrote the email when the lead row does not carry one; Random template mode still rotates PACE's preset wording for the follow-ups of a chain made under the new rules (an explicit choice, unchanged); admin distribution still makes its chain at assignment time (the engine only sends after the first email is proven sent, as before). **Re-open when:** the owner wants the Sequences builder to be "the sequence", or Random mode to stop using PACE's presets.

### D-0115 · 2026-10-08 · STATED, NOT BUILT · The admin controls the application; lead assignment is the RA lead's
**The owner said:** "the admin is never running lead assignment. The admin is only for controlling the application — how it runs and all, for each organisation."
**State:** today `POST /distribute/execute` (index.js) accepts `admin` and `ra_lead`, and the Unassigned pool is visible to both (D-0034). Nothing has been changed. **Asked:** (1) take admins out of lead assignment (the Assign Leads page and the endpoint) — yes/no; (2) should the RA lead's Assign Leads leave a manager's fresh imports alone for N days (recommended 3). **Re-open when:** the owner answers; then also decide whether the admin's bulk stage bar and "Assigned to" filter (built at their request, 8 Oct) stay.

### D-0116 · 2026-10-08 · STANDS · Admins stay in lead assignment; the RA lead's Assign Leads does NOT skip a manager's imports (answers D-0115's questions)
**The owner said:** on skipping a manager's fresh imports — "that's the default way of lead assignment in a company: the person who heads lead generation assigns the leads. But in case a BD manager wants to assign some leads for themselves they should be able to. That's why we designed this." On taking admins out of lead assignment: **"No."**
**Decided:** nothing is removed or hidden — the RA lead's Assign Leads and a manager's own Assign button both stay, over the same pool, first to act wins (the pool conditions on the update; the loser is told). Admin keeps its present access. D-0115's statement ("the admin is only for controlling the application") stands as the owner's description of the admin's purpose, not as a request to remove anything. **Nothing built for either.** **Re-open when:** the owner wants admin's day-to-day lead handling taken away.

### D-0117 · 2026-10-08 · STANDS · Write with AI follows the instruction; a person can turn AI first emails on or off; a minimised window can be dragged
**The owner said:** the email from their AI prompt is too short and off the topic. Tune the writer that already exists ("Write with AI" / `POST /wf/draft-email`), not the one that replaces the first email at send time. The instruction is the brief. Do not switch to a generic "I have candidates" pitch unless they ask. Default 140–200 words, 3–4 short paragraphs. If they ask for shorter, follow that. If the result misses the topic, do not ship it. If it is still short after one repair, ship it and say it came out shorter. Rewrite with AI and Write a variant must keep every {{variable}} exactly; if they cannot, return the person's own text, never a stock starter. Also a personal on/off for "AI writes first emails" (same as the company / on for me / off), per mailbox only when wording is per email ID. Follow-ups stay the person's own wording. And, from a screenshot of the parked "New message" chip: drag it all across the bottom. A drag must not open it. A later click still opens it. The × still closes it. The spot lasts until reload. Phone stays a scrolling row.
**Built on the dev branch, not merged:** `services/sequence-draft.js` (length, topic, rewrite, variant), `services/ai-first-choice.js` (the send loop and the pending-list chip), the switch and the two buttons on My wording and on a sequence step, drag on `10a-window-dock.js`. **Not retuned:** `services/engine-draft.js`. **Not started:** formatting on New message and Reply (R-192). **Re-open when:** the owner wants the send-time writer changed, or the automatic "a variant for every email" switch.
