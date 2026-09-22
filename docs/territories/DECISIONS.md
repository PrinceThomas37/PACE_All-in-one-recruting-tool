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
