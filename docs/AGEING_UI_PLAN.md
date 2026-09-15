# Designing for age — the plan

Owner's question, Session 23: *"this kind of view gets very clumsy or crowded
after a couple of years of using… have we considered that while designing
things, not just in this view but also for everything?"*

Honest answer: **no.** Screens were built to look right with the data that
existed the day they were written. Two offenders were confirmed by reading the
code, not by guessing:

* **The "Connected leads — tick to convert" picker** (`25-workflow-bd.js`)
  renders EVERY lead ever marked `Connected`, as a chip, with no date bound and
  no cap — and the ones already converted **stay forever**, greyed out with a
  tick. 19 chips today. ~400 in two years, above the table they are meant to
  help you use.
* **"Needs you today"** (`44-next-actions.js`) showed a lead last contacted **91
  days ago** under a heading that says *today*. Worse, only `reminder_due` items
  had a **Done** button — `reply_due`, `commitment_due` and `nudge` had **no way
  to be dismissed at all.** That is what the owner reported as "the cache or the
  memory does not get cleared after an activity is finished": nothing is stuck
  in memory, finished work simply has no exit from the screen.

## The law

> **Every list has a HORIZON and an EXIT.**
>
> A horizon is how far back it looks by default. An exit is how a finished item
> leaves. A list with neither is a list that works for a year and then breaks,
> on a customer's account rather than ours.

Two corollaries, both learned the hard way above:

* **A picker you scan does not survive its own success.** Ticking one of 19
  chips is pleasant; ticking one of 400 is worse than typing. Past a cap, a
  picker becomes a search field — the interaction changes SHAPE, it does not
  just get taller.
* **"Done" is not a feature of one item type.** Any row that claims to need you
  today must be dismissable, or the screen becomes a monument.

## The seven items

### 1. A time horizon on every list
`services/view-horizon.js` (PURE) owns the vocabulary: `DEFAULT_HORIZON_DAYS`
(90), `withinHorizon()`, and the horizon a caller asks for. Lists default to the
window and offer "show everything" — never the reverse. Pure because a horizon
is date arithmetic and every boundary must be testable without waiting for a
calendar.

### 2. Finished things leave
`CLOSED_STAGES` / `isClosed()` in the same module. Converted, closed, answered,
placed, dead — excluded from working views by default, reachable in one click.
**Excluded, never deleted:** being finished is not a reason to lose a record.

### 3. Dismiss and snooze on every action
All four kinds get **Done / Snooze / Not now**. Persisted per user in
`app_settings` under `na_dismiss_<userId>` — **deliberately no migration**, the
same reasoning as the AI meter: a dismissal set is small, per-user, and expires
by never being read again. Expired entries are pruned on read, so the row cannot
grow without bound either. Plus an age horizon, so a 91-day silence is a
decision to make (chase or drop) and not a chore that re-presents itself daily.

### 4. A picker becomes a search past its cap
`PICKER_CAP` (15). At or below it, chips as today. Above it, a search field plus
the most recent few. Converted items are gone in both cases — that is item 2
applied to the same screen.

### 5. One "All email" view
PACE has **three** email pipelines and the owner correctly felt it:

| Pipeline | Table | In Pending? | In Sent? |
|---|---|---|---|
| Leads engine (cold + follow-ups) | `emails` | yes | yes |
| Individual sends (client, candidate, interview) | `email_tracking` | never — sends instantly | **never** |
| Candidate outreach batches | `candidate_outreach` | never — own queue | **never** |

The bodies of pipelines 2 and 3 **are stored** — they were simply never read
back anywhere central, which is why "I cannot see the preview of sent emails to
clients" was true even though the text was on disk. One read-only endpoint
merges all three chronologically. **Read-only, and no send path is touched** —
the leads send loop is the most load-bearing code in the app.

### 6. Counts before lists
"312 connected leads →" beats 312 chips. A count is O(1) to read and O(1) to
comprehend; a list is neither.

### 7. Ageing is a TEST, not a good intention
`test/ageing-layout-smoke.mjs` renders every screen with ~2 years of synthetic
data and fails the build on unbounded growth. This is the only item that stops
the problem returning — the other six fix what we found today, and this one
finds what we did not. It is the direct sibling of
`test/mobile-layout-smoke.mjs`, which is what made hiding overflow safe on a
phone.

**A buyer's evaluation account is empty. Their third year is what decides
renewal.** That asymmetry is the whole argument for doing this now.

## Order of work

Foundation (1, 2, 6) → the test (7), because it turns the remaining offender
list from opinion into data → then the screens the owner is looking at (3, 4) →
then the unified view (5).

## What the test actually found — SHIPPED

Run at 20 records (a young account, all inside the horizon) against 2,000 over
two years, across 16 pages x 5 roles = 57 screens. Growth ratio in DOM nodes:

| Screen | Before | After |
|---|---|---|
| Jobs (`bd_joborders`) | 326 → 30,026 nodes = **92.1x** | 327 → 410 = **1.25x** |
| My Jobs (`bd_myjobs`) | 162 → 12,042 nodes = **74.3x** | within limit |
| Leads (`leads`) | 3.8x | within limit |

Everything else was already inside the 3x limit. Two notes on getting this
measurement right, both of which produced a WRONG answer first:

* **The scan that preceded the test was useless.** Grepping for `.map()` over
  state collections found 32 "offenders", nearly all of which were state
  UPDATES (`.map` to replace one item) or bounded lists (roles, mailboxes,
  stages). Hand-reasoning about which lists grow does not work; measuring does.
* **A young account must be RECENT, not sparse.** The first seeder spread 20
  records across the same two years, so most of the young case fell outside the
  90-day horizon and rendered almost nothing — which made a FIXED page still
  look broken (5.4x). Young = few and recent; aged = many and old. If both
  scales share a span, the ratio measures the horizon instead of the growth.

Also fixed, found by looking at the screenshot rather than the test: the
horizon bar said "Showing 50 of 400" above a table drawing 25 rows. The bar
reports what passed the HORIZON and the pager reports the PAGE; using the word
"showing" for the first made two controls contradict each other about the same
number. It now reads "50 of 400 jobs — 350 older than 90 days hidden."

Offenders the test finds in future are recorded here as they are found, and
fixed or listed explicitly. Nothing is quietly left.
