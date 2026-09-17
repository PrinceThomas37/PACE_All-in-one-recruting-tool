# What PACE can already do

**Read this before building anything. It is the answer to "does this already
exist?", and that question is not optional.**

The territory map (`_map.json`) guarantees every FILE has exactly one owner.
This file guarantees every **user-facing capability** has exactly one
implementation. They are different problems, and the second one bit first.

## Why this exists

Session 22 built candidate outreach (Email → Compose → Candidates) without
noticing that **emailing candidates about a job already existed** — the "Email
JD to candidates" flow on a job's Candidates tab, live since Session 3. Two
workflows for one job, ~2,900 lines between them, built months apart by
different territories, neither aware of the other.

**The owner found it, not the system.** In their words: *"these are 2 different
workflow of a same thing, like duplication of workflows… first it takes up lot
of space second it's waste of effort."*

Borders stop a territory writing into another's files. **They do nothing to stop
two territories building the same thing** — in fact they make it *more* likely,
because each team reads only its own memory. This file is the counterweight.

## The rule

**Before building anything user-facing, grep this file for the capability, not
the feature name.** "Email a candidate about a job" is a capability. "Candidate
outreach generator" is a feature name, and searching for it would have found
nothing.

Then one of three things is true:

- **It does not exist** → build it, and add it here in the same change.
- **It exists** → the job is **EXTEND**, not build. Say so plainly, even when
  extending is harder than starting fresh. It usually is; that is not a reason.
- **It exists but is wrong** → the job is **REPLACE**: build the better one,
  mark the old `SUPERSEDED BY`, and **remove its entry points in the same
  change**. A superseded capability left reachable is the duplication, not a
  step towards fixing it.

**Never leave two live paths to one outcome.** If you cannot remove the old one
in the same change, say so in your report and open a contract to whoever owns
its entry points — do not quietly ship the second.

## The register

Status is `LIVE`, `SUPERSEDED BY <capability>`, or `DORMANT` (built, switched
off deliberately — check `DECISIONS.md` before touching it).

---

### Reading back what we sent (any pipeline)
**Status:** `LIVE` — Email → **All email** (Session 23).

**One place, three sources.** PACE sends through three pipelines and each screen
showed exactly one, so "did we email this company, and what did we say" was
three questions in three places:

| Pipeline | Table | Was visible in |
|---|---|---|
| Lead outreach (cold + follow-ups) | `emails` | Pending, then Sent |
| One-off sends (client, candidate, interview invite) | `email_tracking` | **nowhere** |
| Candidate batches | `candidate_outreach` | its own page only |

**Code:** `routes/email-history.js`, `public/js/50-all-mail.js`, tab in
`07-page-email.js`. **READ-ONLY** — it reads three tables and writes none.

**Before adding any "show me what we sent" surface, use this one.** The
per-record views that already exist and are NOT duplicates (they answer a
narrower question about one record) are the candidate profile's Email-activity
card and the client detail's email list. A THIRD general history view would be
the duplication this file exists to prevent.

**The bodies were always stored.** The owner's "I cannot see the email preview
of the sent emails to clients" was a missing READ, not missing data — worth
remembering before concluding something needs to be captured.

---

### Emailing a candidate about a job
**Status:** ✅ **RESOLVED 2026-09-16 — A is the only one left** (owner's call,
`DECISIONS.md` D-0012). B's entry points are deleted and the JD now travels
**inside** A's email as a formatted panel.
**No attachments** — asked and answered; B's document attachment is dropped
deliberately, not overlooked.

| | A · Compose → Candidates | B · "Email JD to candidates" |
|---|---|---|
| Owner | `observatory` (writer), `harbour` (send) | `guild` |
| Entry | Email → Compose → Candidates | ~~a job's Candidates tab, multi-select; also the candidate profile's Email button~~ **removed** |
| Code | `services/candidate-outreach.js`, `routes/candidate-outreach.js`, `public/js/49-page-candidate-outreach.js` | `public/js/28-page-pipeline.js` (`plEmailJD`), `POST /candidates/email` in `routes/recruiting/outreach.js` |
| Picks people | ranked against the job order by the match engine | manual multi-select |
| Writes | AI brief once per job + per-candidate sentence, held to `checkCandidateDraft` | one JD body, BCC'd to everyone |
| Sends | queued drip, warm-up ramp, daily cap, suppression | immediately, one message BCC'd |
| Answering | three buttons in the email (interested / not this one / never) | reply only |
| **Attachments** | **none** | **`document_ids` → real file attachments** |

**⚠ `POST /candidates/email` DOES DOUBLE DUTY AND MUST NOT BE DELETED WITH B.**
It has two frontend callers, and only one is the JD flow:
`public/js/28-page-pipeline.js:369` (B, being removed) and
**`public/js/10-page-modals.js:220` — `remSendMeeting`, which sends a Teams
MEETING INVITE** and merely reuses this endpoint as a generic "email this
person". Removing B means removing its **entry points**, not the endpoint.
Deleting the route would silently break meeting invitations, and nothing on
screen would say so. The `candidate_email` sequence channel is unaffected — it
goes through `wfEngine.registerChannel`, not the endpoint.

**A is the survivor.** What went with B, both deliberately:
* **File attachments** — D-0012 is explicit, asked and answered. Do not restore
  them as a missing feature; re-open the decision instead.
* **The one-off "email this person" path** from a candidate's profile. The
  in-app mailbox (Email → Mailbox) is a full mail client and is where that lives.

The Documents card's tick-boxes went too: they existed only to pick attachments
for the removed button, and a selection with nothing left to act on is a dead
affordance.

`test/email-tracking-send-smoke.mjs` now asserts B stays gone — a capability the
owner asked to have removed needs a guard, for the same reason the duplication
survived unnoticed for months.

---

### Emailing a prospect (client-side cold outreach)
**Status:** LIVE · owner `observatory` + `harbour`
`services/outreach-generator.js` + `routes/outreach-generator.js` +
`public/js/48-page-outreach-gen.js`. Email → Generator. Paste a posting, get four angles, every draft held to
`checkDraft()`. Sending can create the lead and enroll it in a sequence.
**Do not build a second cold-email writer** — extend the angles instead.

### Sending cold outreach to a lead on a sequence
**Status:** LIVE · owner `harbour`
The leads send loop in **`index.js`** — the oldest and most load-bearing send
path in the app. Drains `emails` at one per 75–105s inside the lead's window,
ordered by `send-queue-order.js`. Follow-ups, sequence steps and mailbox
rotation all run through it. **`routes/outreach-generator.js`** hands it the
first email when a generated draft is sent with a sequence attached.
**Nothing may grow a second send loop** — `candidate_outreach` is a separate
queue deliberately, and that was argued for, not assumed.

### Connecting a mailbox
**Status:** LIVE · owner `gateway`
`routes/microsoft.js` and `routes/gmail.js` — OAuth, token refresh, and the
test send that proves a new connection works. That test send is why these
routers compose mail; it is not an outreach path and must not become one.

### Emailing a client company
**Status:** LIVE · owner `guild`
Clients page → "✉ Email this client", with document attachment.
`POST /companies/:id/email`.

### Reading and replying to your own mail
**Status:** LIVE · owner `harbour`
`routes/mailbox.js` + `public/js/47-page-mailbox.js`. The in-app mailbox over
Graph and Gmail. **Nothing is mirrored into Postgres**
and there is deliberately no second send path — anything that composes mail
reuses these provider calls.

### Sending an interview invitation
**Status:** LIVE · owner `guild`
`POST /submissions/:id/interview-invite`, from the stage modal. Includes Teams
meeting creation.

### Reminding a user to do something on a date
**Status:** LIVE · owner `surface` (page) + `ledger` (`routes/reminders.js`,
`services/reminder-source.js`)
The Reminders page, and the bell badge. **Four things write a reminder and they
must all set `reminder_type`:** `wfReminderExecutor` in index.js (a sequence's
`bd_touch`/`reminder` step), `routes/recruiting/outreach.js` (`recruiter_task`),
`routes/contacts.js` (`ooo_return`, from an out-of-office auto-reply) and the
page itself (`manual`/`meeting`). That column is the ONLY record of where a
reminder came from, so a new writer that leaves it null produces a task nobody
can explain — `services/reminder-source.js` turns it into the sentence on the
card, and a type it does not know says so rather than claiming the user added
it. `GET /reminders` also returns `compose` (address, role, company, read from
the reminder's own contact + job rows) — **do not resolve a reminder's
recipient out of `STATE.contacts`**, which only holds the leads this user's
`GET /jobs` returned.

### Knowing whose work a record is
**Status:** LIVE · owner `rampart` (the rule) · `services/ownership.js`
**The definition, since Session 24 (D-0020):** a reminder belongs to its
`user_id`, a lead to `jobs.assigned_to_bd`, a submission to
`submissions.recruiter_id`, a contact to the owner of its job. **Anything that
builds a per-user list scopes to the OWNER, never to the reporting chain** —
chain scoping is for REPORTS (`/reports/recruiting`, My Team), which describe a
team, not for work queues, which belong to a person. A manager gets a count and
a review screen (`GET /next-actions/team`) where they can PROMPT the owner
(`POST /next-actions/:id/prompt`); they cannot close somebody else's task. Before
adding any "manager can also…" affordance, read D-0020 — the answer to holiday
cover is reassignment, not acting on another person's behalf.

### Telling a user what to do next
**Status:** LIVE · owner `observatory`
`GET /next-actions`, on all three dashboards. **Opted-out threads never produce
an action** — compliance rule, pinned by a test.

### Summarising what came in today
**Status:** LIVE · owner `observatory`
`GET /ai/morning-briefing`, on all three dashboards. Rules-written, AI as the
upgrade.

### Creating a job order (a "job")
**Status:** LIVE · owner `guild` (route) + `surface` (form) · Session 26
Two ways in, ONE route each, and they are not duplicates — they differ in where
the lead comes from:
* **From a CONNECTED lead** — `POST /job-orders/from-lead/:jobId`. The lead
  already exists; the job order inherits its company and position.
* **Direct, from the "+ New Job" button** — `POST /job-orders`. The server
  creates the underlying lead (`jobs` row, stage `Connected`, LD- code) ITSELF.
  **Nobody has to make a lead first** — the refusal that said so was wrong.

**A job order must belong to a `companies` row.** The Client box is a NAME, and
the SERVER resolves it (`services/client-resolve.js`, pure): exact match on the
normalised name within the caller's org, else find-or-create. The form's
typeahead (`companyAcHTML`, `public/js/51-company-autocomplete.js`) is the
duplicate defence — it shows what already exists while you type. A near-match is
never merged: folding "Treplar Industries" into "Treplar Inc" puts a job on the
wrong client and nothing on screen would say so.

### Scoring a candidate against a job
**Status:** LIVE · owner `observatory`
`match-engine.js`. Its `reasons` are grid shorthand — **never render one into
customer-facing text.**

### Deciding when an email may send
**Status:** LIVE · owner `harbour`
Leads: 08:00–16:00 in the lead's timezone. Candidates: **no window** since
D-0010 (switch off by default). One resolver, `getTimezoneFromLocation`.

### Signing up and landing in the right organisation
**Status:** DORMANT · owner `rampart` · see `DECISIONS.md` D-0002
`services/provisioning.js`. **Off until the open tenancy contracts close.**

### Charging for a plan
**Status:** DORMANT · owner `ledger` · see `DECISIONS.md` D-0003
Built, prices `null`, payments off.
