# Plan for the week of 2 Nov 2026 — what is left, in order

Written 30 Oct 2026 (Session 56) at the owner's request: "document the plan for the rest, we will do it next week".
Done this session and live (or going live): #378 confirmed live; **R-342** Direct / Office (#380); **R-333** every Find Leads
industry a real filter, checked live (#380); **R-320** Compose → "Find at a company" (its own PR, merged after its tests).

## 1. BUILD — R-343: every outreach email from AI-written template versions (D-0188, owner chose "All templates")

The owner's decision stands (do not re-ask). The measured risk is recorded and must be watched: AI first emails got about twice
the replies of templates (1.23 % vs 0.54 %, 1–29 Oct, 55 replies in all). Full numbers: `docs/PLAN_2026-10-29_AI_TEMPLATE_VARIANTS.md`.

What the person will see:
- In the sequence builder, each step (first email, follow-up 1, follow-up 2 …) has a **mother template** the person writes, and
  a button **"Write versions with AI"** that makes up to **10** versions of it, written ONCE (not per email). The person can read,
  edit, delete or add versions. PACE picks one at random for each lead, so 10 leads do not get the same words.
- Each lead's job posting is read **once** when it is queued, for the blanks: skills, industry, project area, on-site / remote
  (plus what PACE already holds in the lead's research). Every step for that lead reuses that one reading.
- No AI call per email any more. If a blank cannot be filled the email is held and the person is told, never sent with a gap
  (the existing rule: a merge field is filled by the server and checked, refuse rather than blank).
- **A switch to turn AI first emails back on** (admin, per company), because of the recorded risk.

Build steps (each its own commit, tested, screenshots before merge):
1. `services/sequence-versions.js`: raise the version limit from 2 to a number the ADMIN sets (default 10) — D-0123, no limit in
   code: new `SETTINGS_SCHEMA` entry, read with `getSetting()`; `test/admin-numbers-smoke.mjs` pins it.
2. "Write versions with AI": one AI call per step that returns N versions, each checked by the existing draft checker
   (`checkDraft`); a version that fails the checker is dropped and the count said. Through `services/ai-provider.js` and its budget.
3. The once-per-lead posting reading: extend the lead's stored research with `on_site_remote`, `project_area`, `industry`,
   `skills` (cheap model, once, cached on the lead; rules-first when AI is off or over budget). New merge fields wired into
   `VAR_SYNONYMS` and the "Add a detail" menu.
4. Queuing: pick a version at random per lead per step; fill the blanks; never call the AI writer per email when the company
   is on "templates".
5. The admin switch "AI writes first emails" (off by default per D-0188), in Admin settings.
6. Reporting: first-email reply rate before / after, in Outreach Insights, so the owner can see it ~2 weeks after launch.
   Put a dated reminder in ROADMAP to report it (target: mid-November).

Size: the largest item left. Likely 2 PRs (steps 1–3, then 4–6). Touches observatory (AI), harbour (queue), surface (builder).

## 2. ASK THE OWNER (once, plainly) — nothing is built until answered

| Row | Question in plain words |
|---|---|
| R-326 | The lead card beside an email: what should it show and let you do — and should a CANDIDATE's email get a card too? |
| R-345 | The notification centre: when a mailbox is paused or a run finishes, what should you be able to DO from the alert? |
| R-340 follow-up | Start recording WHO assigned each lead, so an RA Lead can see "only the leads I assigned"? (needs one small database field) |
| R-344 | Google sign-in: the steps on your side in Google Cloud (company Workspace project, Internal, redirect `https://app.paceconsultant.in/auth/google/callback`); then I switch the setting on Render with your go-ahead |
| Render plan | The paid Render instance (~$7/month) removes the slow first log-in after the server sleeps — your call |
| R-329 | A second contact-data vendor (ZoomInfo, Lusha …): which one, plus a customer's test key, to build it honestly |
| R-306 | Old unreplied leads: what to do with them (you said "later") |

## 3. SMALL THINGS I CAN DO WITHOUT A DECISION

- The server log repeats `MaxListenersExceededWarning: 11 finish listeners added to [ServerResponse]` on many requests (seen
  before #378 too). Harmless today; find which per-request hooks pile up and fold them into one (gateway). No behaviour change.
- Re-check the Media industry filter live (one credit) next time a Find Leads search runs for media anyway — it was narrowed
  after the 30 Oct check (software publishers), not re-checked.

## 4. WHEN PACE MOVES TO THE PAID RENDER SERVICE — R-328 (parked by the owner)

The security and sending fixes from the outside review (mailbox tokens encrypted at rest, etc.) — listed in ROADMAP R-328.
Do them as part of that move, not before.
