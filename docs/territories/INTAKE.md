# Reading the owner

**Every territory agent reads this.** It is the rule for turning what the owner
actually says into work, and it exists because the input to this system is not a
ticket. It is a sentence typed by the person who uses the product.

The owner is the **product owner and the end user**. They do not read code, do
not use git, and judge PACE the way a customer does — by using it. So what
arrives is one of four things:

| What arrives | Looks like | What it actually is |
|---|---|---|
| **A sentence about something wrong** | "I see a lot of time the menu is repeating" | A bug report, usually more precise than it first reads |
| **A screenshot** | an image, sometimes with no words at all | Evidence. Often the whole diagnosis |
| **An idea** | "I want to text candidates too" | A feature, stated as an outcome, not a spec |
| **A question** | "is the sending working?" | A request to go and look, not to reason |

---

## The eight rules

**1. Reproduce the sentence, not your hypothesis.**
This is the one that costs the most when broken. The owner once wrote *"I see a
lot of time the menu is repeating, no repeats in full menu."* The second clause
was the entire diagnosis — nothing was drawn twice; two nav items carried the
**same icon**, and the 60px rail is icon-only, so expanding it showed different
labels. The first investigation swept five roles for duplicate *items*, found
nothing, and nearly closed the case — because it tested a theory instead of the
sentence. **Read the sentence literally, clause by clause, and reproduce exactly
what it describes.**

**2. A vague-sounding report is data.** "It does nothing" is a real diagnosis,
not a shrug — in this codebase it has twice meant a **shadowed route**, where a
`:param` handler answered with a valid 200 and the page stored that as its
answer. "It's slow", "it flickers", "it went to the wrong person" are all
precise once you take them at face value.

**3. A screenshot is evidence. Name what you see before you theorise.** Say what
is actually on screen — the exact words, the numbers, what is missing, what is
in the wrong place. Half the bugs in this repo's history were visible in the
first image and argued about for an hour anyway.

**4. Never ask the owner to be more technical.** Do not ask which endpoint, which
role, which browser, what the console said, or to check a log. If you need to
know which screen, describe it back in their words — "the page with the list of
candidates and the green pills" — not by its module name.

**5. One question, maximum — and only when two readings lead to genuinely
different work.** Ask it in plain language, offer the two options as things they
would recognise, and say what you will do if they do not answer. Then get on with
everything that does not depend on the answer.

**6. Go and look before you reason.** The habit that has paid off three sessions
running: get to the real thing. Read the live database, call the real model,
render the real screen. **When something works here and fails there, get the
server's Node version and re-run before theorising** — the sandbox is Node 22 and
Render is Node 26, and that difference alone cost a full session.

**7. Deliver a screenshot, not an explanation.** The owner evaluates by using the
product. "I changed `renderDashboard()` to call the briefing endpoint" is not a
deliverable; a picture of the card on the dashboard is. If you cannot show it,
say so plainly and say why.

**8. A decision is not a bug report.** When the owner says *"we will work on this
but not now"*, that is a decision. Record it in your memory as parked, and do not
re-raise it as blocking. Re-open only on a fresh, visible incident.

---

## Where a sentence goes

Real examples, and the territory each belongs to. Match on what the owner can
**see**, never on which file you suspect.

| The owner says something about… | Territory | Real example |
|---|---|---|
| a screen, a button, a layout, a colour, the phone | `surface` | "the menu is repeating" → two nav icons were identical |
| the app being slow, blank, flickering, or not loading | `surface` first, then `gateway` | the screen blinking while reading an email → the render engine rebuilt everything |
| a button that "does nothing" | `gateway` | "Test AI generation" → a shadowed route answered 200 with the wrong body |
| an email that went out wrong, late, or not at all | `harbour` | a batch queued at 3am that "didn't move" → the candidate send window |
| the wording of an email PACE wrote | `observatory` | a draft opening "your background in 3/4 skills" → a matcher string rendered as prose |
| a résumé that would not upload or parse | `observatory` | worked in test, failed live → Node 22 vs Node 26 |
| candidates, job orders, stages, the pipeline board | `guild` | a recruiter able to move a candidate too far |
| logging in, roles, or seeing someone else's data | `rampart` | **always urgent — a tenant leak produces no error message** |
| a number that looks wrong on a report | `guild` for the meaning, `deep` for the data | "sent on X" counting drafts → `sent_at` defaults to today |
| prices, limits, unsubscribes, "can we legally…" | `ledger` | only the explicit opt-out may suppress |
| "is it deployed?", "is it live?", "did the tests pass?" | `foundry` | merging to `main` is the release |
| something missing that was never built | `dispatch` first — it may cross several | "text candidates too" touches six territories |

**When it could be two, take it to `dispatch`.** Guessing wrong costs a whole
round trip; asking the front door costs nothing.

---

## What goes back to the owner

Never the six-line agent report — that is for the orchestrator. The owner gets:

- **what changed, in their words** — "the dashboard now opens with a short
  summary of what came in today";
- **a screenshot of it**, or an honest sentence saying it could not be shown yet;
- **what it cost them**, if anything — a reconnect, a migration to approve, a
  setting to pick;
- **what is still open**, if the job could not be finished, and what you need.

No file paths, no function names, no diffs, no apologies.
