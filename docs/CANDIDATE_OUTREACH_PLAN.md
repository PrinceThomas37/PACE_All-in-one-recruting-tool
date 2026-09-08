# Candidate outreach — the plan (Session 21)

> The client side is done: paste a job posting, pick a contact, get a researched cold
> email (`services/outreach-generator.js` + `routes/outreach-generator.js` + the
> Email → Compose tab). This is the mirror of it, pointed at candidates.
>
> **Read this before writing any of it.** The three product decisions at the bottom
> were made by the owner on 2026-09-08 and are not open questions.

---

## 1. The one structural difference: the direction is reversed

| | Client outreach (built) | Candidate outreach (this plan) |
|---|---|---|
| Starts from | a job posting **pasted** from the internet | a **job order already in our database** |
| Finds | one hiring contact | **many** candidates who fit |
| Who they are | typed in, or a `contacts` row | a `candidates` row, or someone brand new |
| Volume | one email, written and edited by hand | 10-40 emails off one job |
| The ask | "want to see resumes?" | "are you interested in this role?" |
| The answer arrives as | a reply | **a button click**, or a reply |

Everything else — the mailbox that sends, the signature, the tracking pixel, the
suppression list, the daily cap, the warm-up ramp, the reply sweep — is the same
machinery and must not be duplicated.

---

## 2. What already exists (do not rebuild any of this)

* **The matcher.** `GET /job-orders/:id/matches` ranks the whole candidate pool
  against a job order and returns `{score, band, reasons}` per person
  (`match-engine.js` → `public/js/38-match-score.js`, one file, both sides). It
  scores on skills, title, experience years and location — all resume-derived.
  **This is "ask them based on their experience in their resume", and it is live.**
  `reasons` is an array of plain sentences explaining *why* this person matched.
  That array is the personalisation, and it is free.
* **The send.** `POST /candidates/email` (`routes/recruiting/outreach.js`) already
  sends to candidates through the recruiter's connected mailbox, on both Graph and
  Gmail, with the pixel injected, the signature filled (`filledSignature`), the
  suppression list checked, and an `email_tracking` row written.
* **The mapping columns.** `email_tracking` already carries `candidate_id`,
  `job_order_id`, `to_email`, `subject`, `opened_at`, `open_count`, `replied_at`,
  `org_id`. Nothing needs adding for the message-level record.
* **Reply detection.** The 30-minute inbox sweep (`processInboundMessages`) stamps
  `replied_at` on a tracked send for Outlook *and* Gmail. It keys off
  `email_tracking`, so any send that writes a row is covered automatically.
* **Reading the reply.** `conversation-intel.js` already decides whether a reply is
  positive, and `next-action.js` already emits an advisory `stage_suggested` item
  for a candidate thread with positive intent.
* **The candidate↔job link.** `submissions` (`candidate_id` + `job_order_id` +
  `stage`, unique on the pair where not deleted). This is the ATS's own answer to
  "which candidate is on which job" — do not invent a second one.
* **The drafting pattern.** `services/outreach-generator.js`: pure, two engines
  behind one output shape, `checkDraft()` holding the AI to the rules a machine can
  verify. Copy the *pattern*, not the file.
* **The AI plumbing.** `services/ai-provider.js` (`complete()` returns null, never
  throws) and `services/ai-budget.js` (per-feature ceilings, per-org daily meter).
* **New-candidate creation + dedup.** `services/candidate-fields.js` →
  `findCandidateDuplicates()` (name + email/phone, or profile URL).

---

## 3. The budget problem, and the answer

Groq's free tier is **8,000 tokens per minute** and one generated email costs ~2,100.
Four in quick succession already rate-limits (measured 2026-09-08). Emailing 25
candidates about one job would be 25 calls — it would rate-limit, blow the org's daily
meter, and every other AI feature in the app would silently fall back to rules for the
rest of the day.

**So the AI is called ONCE PER JOB ORDER, not once per candidate.**

```
   ONE AI CALL                        FREE, PER CANDIDATE
   ┌──────────────────────┐           ┌────────────────────────────┐
   │ the job brief        │           │ the "why you" sentence     │
   │ • what the role is   │  ──────▶  │ built from the matcher's   │
   │ • the honest hook    │  merged   │ `reasons` array for THIS   │
   │ • the constraint     │   into    │ person, plus their name    │
   │ cached on the job    │  every    │                            │
   └──────────────────────┘  email    └────────────────────────────┘
```

* The **job brief** is written once, cached against the job order, and reused for
  every candidate on that job. Regenerated only when the recruiter asks, or when the
  job description changes.
* The **per-candidate sentence** is rules text assembled from `reasons` — factual by
  construction, because it comes from fields read off their own resume. "Your eight
  years on structural steel and your Dallas location line up with what they're asking
  for" needs no model.
* An **"improve this one with AI"** button on a single candidate, for the person you
  really want. One call, deliberate, rare.

Twenty-five candidates therefore cost the same as one. This is the same rules-first
convention every other AI call site in PACE follows, and it is the reason the feature
works on a deployment with no funded key at all.

---

## 4. What the email contains

The owner's list — name, email, job title, location, JD — plus what the posting
already gives us for free:

| Field | Where it comes from |
|---|---|
| Candidate first name | `candidates.full_name` |
| To address | `candidates.email` |
| Job title | `job_orders.job_title` |
| Location | `job_orders.city/state/country`, else `location` |
| The role, in prose | the AI job brief (or rules) off `job_orders.job_description` |
| Pay range | `job_orders.pay_min/pay_max/pay_cur` — **only if set**, never invented |
| Job type / remote / duration | `job_orders.job_type`, `remote`, `duration` |
| "Why you" | the matcher's `reasons` for this candidate |
| Interested / Not interested | the two buttons (§6) |
| Signature | `filledSignature(mailbox, userId)` — the mailbox's, filled |

### The rules a candidate email is held to (`checkCandidateDraft`, pure)

These are different from the client rules and must be their own checker:

1. **Never claim experience the resume does not show.** Only skills, titles and years
   that are actually on the candidate record may appear.
2. **Never state a pay figure that is not on the job order.** A number we invented and
   cannot honour is the fastest way to lose a candidate permanently.
3. **The job title and the location must both appear.** A candidate cannot answer
   "are you interested" without knowing what and where.
4. **A way to say no must be present**, and it must be one click, not a sentence.
5. No fee or commission language — that is the client email's vocabulary, not this one.
6. No marketing adjectives, no exclamation marks, no emoji. Same as the client rules.
7. No leftover `{{placeholder}}`; no second sign-off above the appended signature.
8. Greeting on its own line, then identity in sentence one. (Same failure mode as the
   client generator's first live run — the model dropped the greeting entirely.)
9. Length band 70-130 words. A candidate reading on a phone between jobs will not
   read 200.

Angles (the picker, same idea as the client side, each with its own `must`/`never`
so they do not converge):
* **Direct** — here's the role, here's why I thought of you, yes or no.
* **Short** — three sentences, for a passive candidate who will not read more.
* **The specifics** — leads on pay/location/type, for a role whose terms are the draw.
* **Keeping in touch** — no specific job; the nurture form. Reuses the existing
  `DEFAULT_CANDIDATE_NURTURE_EMAIL` reasoning: every job variable degrades to an empty
  string if there is no job, so a jobless email needs its own wording.

---

## 5. Where it is stored, and how the mapping happens

**One new table does the queue, the record and the answer.** It is deliberately not
the `emails` table: that queue is welded to the leads engine (`job_id`, `contact_id`,
a jobs join for the recipient's timezone, `send-queue-order.js` banding) and the send
loop is the most load-bearing code in the app. Threading a candidate through it would
put candidate outreach one bug away from breaking cold email.

```
migration 042_candidate_outreach.sql        ← the next number; 041 is the last applied

candidate_outreach
  id              uuid pk
  org_id          uuid  not null           ← tenant table; ADD IT TO models/tables.js
  candidate_id    uuid  → candidates(id)
  job_order_id    uuid  → job_orders(id)   ← nullable: a nurture email has no job
  submission_id   uuid  → submissions(id)  ← nullable, set only if the box was ticked
  sent_by         uuid  → users(id)
  mailbox_id      uuid  → user_emails(id)
  to_email        text
  subject         text
  body            text                     ← keeps {{sender}} — see the rule below
  angle           text                     ← which framing was picked
  engine          text                     ← 'rules' | 'ai' — for honesty on screen
  status          text  default 'pending'  ← pending | sent | failed | skipped
  send_after      timestamptz              ← THE DRIP. see below
  sent_at         timestamptz
  fail_reason     text
  track_token     text                     ← joins to email_tracking.token
  response        text                     ← null | 'interested' | 'not_interested'
  responded_at    timestamptz
  created_at      timestamptz default now()

unique (candidate_id, job_order_id) where status <> 'failed' and job_order_id is not null
```

That unique index is what stops the same candidate being emailed twice about the same
job — the equivalent of the duplicate-cold-email guard on the lead side.

### The mapping, end to end

```
job_orders ──┐
             ├─▶ candidate_outreach ──▶ email_tracking (token)   opens, replies
candidates ──┘          │                                        (existing sweep)
                        │
                        └─▶ submissions (Sourced)  ← only if the recruiter ticked the box
```

* **Message facts** (opened, replied) stay in `email_tracking`, joined by
  `track_token`. Nothing about the existing tracking or sweep changes.
* **The answer** (interested / not) lives on `candidate_outreach`, because it is a fact
  about *this ask on this job*, not about the person and not about the message.
* **Pipeline position** stays in `submissions`, which is where the rest of the app
  already looks for it.
* **Person-level recency**: stamp `candidates.last_contact_at` on send and
  `last_reply_at` on reply. Both columns exist (migration 036).

### The drip, on a server that sleeps

The free tier spins down after ~15 minutes of no traffic, so a `setInterval` drip does
not survive. Instead **every queued row is stamped with its own `send_after`** at queue
time — `now + i × (75-105s, jittered)` — and the existing 30-minute cron heartbeat
drains whatever is due, applying the same gates the lead loop applies: send window,
daily cap, warm-up ramp, mailbox auto-pause, suppression list.

Consequence to accept: a batch of 25 takes ~40 minutes of wall clock and the heartbeat
is delivered late (measured: every 3-5 hours, not every 30 minutes). Due-ness lives in
the database, so **nothing is ever skipped, only delayed** — the same trade the rest of
the engine already makes. Do not "fix" this with a faster pinger; that spends the
instance-hour budget the owner flagged as hard.

### The one rule that must not be broken

`body` is stored with `{{sender}}` / `{{senderemail}}` **unrendered**, and every reader
calls `renderStoredEmail(row, mailbox)` (`email-vars.js`) before showing or sending it.
This is the Session 14 rule: the mailbox that sends can change between queueing and
sending, and baking a name in at queue time is how 152 cold emails went out saying
"I'm Jennifer Thomas" over Prince Thomas's From line.
`test/sender-identity-smoke.mjs` greps for readers of stored bodies and will fail the
build if this table's reader does not render.

---

## 6. The two buttons — and the trap in them

The email carries **Interested** and **Not interested** as one-click links, in the same
family as the open-tracking pixel `GET /o/:token.gif`: public, no login, never errors.

```
GET /i/:token            → a small page: "Interested in <Job Title>?" + two buttons
POST /i/:token/interested
POST /i/:token/not-interested
```

**Recording must happen on the POST, never on the GET.** Corporate mail scanners
(Outlook Safe Links, Mimecast, Proofpoint) pre-fetch every link in an inbound email to
check it. A `GET /i/:token/yes` that records would mark candidates interested — and
opted out — before a human ever saw the message. The link therefore lands on a page
with two real buttons, and the click is what counts. This is the single most important
detail in this section.

Then:
* **Interested** → `response='interested'`, `responded_at=now()`. It raises a
  `next-action` item for the recruiter and, if a submission exists, *suggests* moving
  to Screening. It never moves a stage on its own — stage vocabulary is owned by
  `services/recruiting-core.js` and moving someone silently is how a board stops being
  trustworthy.
* **Not interested** → `response='not_interested'`, and **the address is added to
  `suppression_list`** for this job at minimum. That is what makes the button a real
  opt-out rather than a survey, and an opt-out is not optional on candidate mass mail.
  Anything already queued for that person is marked `skipped`.

A reply by email still works and still counts — the sweep stamps `replied_at`, and
`conversation-intel` reads the intent. The buttons are the high-signal path; the reply
is the fallback, and neither is required for the other.

---

## 7. The screen

Email page → **Compose** tab gets a switch at the top of the body:

```
   ┌───────────┬──────────────┐
   │  Clients  │  Candidates  │     ← UI.tabs, above the composer
   └───────────┴──────────────┘
```

* **Recruiter** → Candidates only (no switch shown — one mode is not a choice).
* **BD / BD lead** → Clients only, as today.
* **Manager, associate director, director, admin** → both, switchable.

The Candidates side is three steps down one page:

1. **Pick the job.** Search `job_orders` (active first). Shows title, client, location.
2. **Pick the people.** The ranked list straight from `GET /job-orders/:id/matches` —
   score, band, and the `reasons` that produced it, so it is obvious *why* each person
   is there. Tick-boxes. Plus **"Add someone new"**: paste or upload a resume, it goes
   through the existing parser and duplicate check, becomes a real `candidates` row,
   and then joins the same list. There is no second code path for a new person — they
   become a candidate first, and everything after that is identical.
3. **Write and send.** The angle picker, the preview with one real candidate's merge
   fields filled in so you see what a recipient sees, per-angle edits kept, the
   sequence-style tick-box **"add these people to this job's pipeline"** (default off),
   and Send. The send screen says plainly: *"25 emails queued — about one every 90
   seconds, from prince.thomas@… , inside your send window."*

Frontend rules that apply: the module registers with `UI.registerPage`/is drawn by the
Email page's existing body switch (it must not write `#content` itself); anything wide
scrolls in its own `.tbl-wrap`; no inline widths, because an inline style cannot be
responsive at 390px.

---

## 8. Build order

| Step | What ships | Migration | Why this order |
|---|---|---|---|
| **1** | The screen, the job brief, the rules writer, the checker, the queue, the drip, tracking. Sends real email. | 042 | This is the product. Everything after is signal on top of it. |
| **2** | The two buttons + the public handler + suppression on "not interested". | (in 042) | Ship the columns with 042 so there is one migration, but wire the route second. |
| **3** | The pipeline tick-box → `submissions` at Sourced, and the interested→Screening *suggestion*. | none | Depends on 1 and 2 being trustworthy. |
| **4** | Candidate threads into `next-actions` / conversation intel. | none | Mostly wiring; the intel layer already reads candidate threads. |

Tests to write alongside, following the house pattern:
* `test/candidate-outreach-smoke.mjs` — the pure writer + `checkCandidateDraft`, every
  rule in §4, offline.
* extend `test/sender-identity-smoke.mjs` — the new table is a stored-body reader.
* extend `test/route-shadowing-smoke.mjs` coverage — the new literal routes go **above**
  any `:id` route of their prefix.
* `test/mobile-layout-smoke.mjs` picks up the new page automatically at 390px.

---

## 9. Decisions the owner made (2026-09-08) — not open questions

1. **The pipeline is opt-in.** Emailing a candidate does **not** put them on the job's
   board. A tick-box does, default off. The board keeps meaning "people I am working",
   not "people I emailed".
2. **Interested / Not interested buttons in the email**, as the primary answer channel —
   not reply-reading alone. (Reply-reading still works and is already built.)
3. **Pick many, send as a drip** — one every 75-105 seconds, inside the send window,
   under the daily cap and the warm-up ramp. Never a burst.
