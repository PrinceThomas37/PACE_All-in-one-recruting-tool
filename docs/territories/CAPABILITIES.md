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

**A direct create also captures the client** (Session 26, D-0023): the company's
postal address (migration 043) and **at least one POC — name and email
required**, phone and LinkedIn optional. The POC block is
`public/js/52-poc-block.js`, **shared**, and is the one implementation: the RA
lead form's older copy is the thing to retire into it, not a second one to keep.
`GET /companies/:id/intake` answers everything about a picked client in one
call — cooldown, the POCs it already has, the address on file.

**The company re-add cooldown applies here**, same as the RA form (D-0023,
owner's call, against advice). One definition, `services/company-cooldown.js`
(pure), replacing three that disagreed. It is shown when a client is PICKED, not
at Save.

**A job order must belong to a `companies` row.** The Client box is a NAME, and
the SERVER resolves it (`services/client-resolve.js`, pure): exact match on the
normalised name within the caller's org, else find-or-create. The form's
typeahead (`companyAcHTML`, `public/js/51-company-autocomplete.js`) is the
duplicate defence — it shows what already exists while you type. A near-match is
never merged: folding "Treplar Industries" into "Treplar Inc" puts a job on the
wrong client and nothing on screen would say so.

### Merging two client records into one
**Status:** LIVE · owner `gateway` (routes) + `guild` (rule) · Session 26
Clients drawer → **Merge a duplicate in**. `POST /companies/:id/merge` re-points
the four tables carrying a `company_id` (`jobs`, `job_orders`,
`client_documents`, `email_tracking`) and **soft-deletes** the duplicate —
nothing is destroyed, and what moved is recorded in `app_settings` under
`company_merge_<id>`. `GET /companies/:id/merge-preview` is the same path to the
same counts, so the plan on screen and what the button does cannot differ.
`services/company-merge.js` is the rule. **`contacts` is deliberately not in the
list** — it hangs off `jobs.job_id` and follows its leads.

### Capturing the people at a client (POC rows)
**Status:** LIVE · owner `surface` · `public/js/52-poc-block.js`
**ONE implementation**, used by the BD New Job form and the RA lead form. The RA
form's older copy was retired into it in Session 26. Do not write a third.
`pocRegister(name, {get, changed})` keeps state with the caller; `changed`
receives an event so a keystroke never re-renders and a shape change does.

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

---

## Candidates apply to us — the public apply page

**Status:** LIVE (migration 044 pending) · owner `gateway` (route) + `surface`
(the control) · `routes/apply.js`, `services/jd-scrub.js`,
`POST|DELETE /job-orders/:id/apply-link`, the Apply-link block in
`public/js/25-workflow-bd.js`.

**What it is.** A job order can be **published**, which mints a random token and
opens `/apply/<token>` to the open internet. Anyone with the link fills in a
short form, attaches a resume, and lands in `sourcing_candidates` — the same
inert staging table the CSV import uses. A recruiter reviews and imports.

**Why it matters more than it looks.** Before this, every candidate in PACE was
one somebody typed in or exported from a board. That makes the candidate
database cost money or labour to grow, permanently. This is the only source that
costs neither, and it is the reason a paid resume database is a *later*,
measured purchase rather than a prerequisite (D-0025).

**Grep before building anything near this.** It reuses, and must keep reusing:
the staging table (017), the resume parser, the duplicate check, the match
engine and the candidate outreach reply loop. It adds **no** second import path.

**The five rules it holds, each with a reason that cost something:**
| Rule | Why |
|---|---|
| Unknown / malformed / unpublished / filled answer **byte-identically** | the token is what stops a stranger enumerating a customer's whole req list |
| A malformed token **never reaches the database** | otherwise the page is a free way to make us do work |
| The **client's name is never published** | it is the asset a staffing desk is paid for; asserted on rendered bytes, not promised in a comment |
| A write that did not happen is **never reported as saved** | an applicant thanked for a dropped application does not apply twice |
| An applicant **never lands in `candidates`** | a public form writing into the ATS is a spam vector aimed at the most valuable table in the product |

**The description is scrubbed, and `posting_description` beats the scrubber.**
`services/jd-scrub.js` is shared with the recruiter's "re-write job description"
button — one definition of "safe to publish", because the apply page publishes
with **nobody reading the result first**, so the automatic path must not be the
weaker one. Two faults found by writing it down, both invisible to reasoning and
both now pinned:
* **Contacts are masked BEFORE names are replaced.** A client's name is usually
  also its mail domain, so scrubbing names first rewrote `careers@northwind.com`
  into `careers@our client.com` — which no longer matches the contact pattern,
  so the address stayed on the page *looking* scrubbed.
* **A contact goes by the SENTENCE, not the character.** Deleting just the
  address left *"Questions? Email or call ."* on a page a stranger reads. Found
  in a screenshot; no test was looking for it.

**What it deliberately does NOT do (yet):** no careers page listing every open
role (one link per job), no email to the recruiter on each application (the
Sourcing queue is the surface), no auto-submission to a pipeline.

---

## Where candidates come from — the Sourcing screen

**Status:** LIVE · owner `guild` (registry + route) + `surface` (the screen) ·
`config/sourcing.js`, `routes/recruiting/sourcing.js`,
`public/js/32-page-sourcing.js`. Candidates → **Sourcing** tab.

**Two sources are built and nothing else is:** the **apply page** (inbound,
Session 27) and **CSV / Excel import**. Both land in `sourcing_candidates`,
inert, reviewed and imported by a recruiter.

**⚠ THE OTHER SEVEN ARE ROADMAP, NOT INTEGRATIONS.** CareerBuilder,
Resume-Library (US), Dice, Monster, Indeed, Apollo and LinkedIn have **no
adapter** — `POST /sourcing/search` answers **501 `not_built`** for every one.
They are listed so the roadmap is visible, and each states what it would really
take, which for all of them is **a paid account, not an API key**.

**How this went wrong, and the rule that came out of it.** They used to render
as cards identical to the working one, badged **"NEEDS CREDS"** with a Details
button. That badge says *add a key and this works*. It was false for all seven,
they looked like features for five sessions, and **the owner found it** — by
asking which were free and where to get the keys. Same shape as the team-Done
button (Session 24): **a thing you can see, appear to act on, and not actually
change is worse than either showing it plainly or not showing it.**

So the registry separates two facts that had been conflated:
`built` (does code exist) from `available` (can it run today). `blocker` is the
sentence naming the real precondition. `test/sourcing-honesty-smoke.mjs` pins
it — including, measured in a real browser, that **no unbuilt provider sits in
a panel offering an action**, and that nothing anywhere claims
`needs_credentials`.

**⚠ The historic provider ids are kept** (`apollo`, `indeed`, `monster`,
`careerbuilder`, `dice`, `linkedin`) because staged rows carry a provider
string; dropping one orphans those rows with a blank Source column. A test
pins each id.

**Apollo is NOT wired anywhere** — see `CLAUDE.md`. The Integrations page saves
and tests an Apollo key and nothing calls it. Adding a key changes nothing.


## Seeing who applied to us — **Candidates → Applicants**, and a block on each job order

**Grep here before building anything that lists applicants.** Added Session 28,
after the first real application arrived through a published apply link and
nothing in the product showed it.

* **Candidates → Applicants** (`public/js/53-page-applied.js`, `renderApplied`)
  — everyone who applied, any job, newest first.
* **The job order page** (`renderJobApplicants`, embedded by
  `25-workflow-bd.js` under the apply-link block) — that job's applicants only.

**Both are VIEWS of the sourcing queue (D-0028), not a second pool.** They read
`GET /sourcing/staged?provider=apply&status=all` and import through
`POST /sourcing/staged/:id/import` — the same two endpoints the Sourcing review
queue uses. **Do not add a third list of applicants or a second import path.**
If a new screen needs applicants, call those endpoints and render them.

* **`services/applicants.js` is the ONLY reader of `raw`.** Which job somebody
  applied to is recorded in the staged row's `raw` blob, not a column; the
  router attaches a normalised `applied_job` so no page parses it.
* **A CV needs signing** — `GET /sourcing/staged/:id/resume` returns a 10-minute
  signed URL, because an application's resume sits in the PRIVATE
  `candidate-docs` bucket. A plain link works for a CSV row's public URL and
  silently fails for an application. Never link `resume_url` directly.
