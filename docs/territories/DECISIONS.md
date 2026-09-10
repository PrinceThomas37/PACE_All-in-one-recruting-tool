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
