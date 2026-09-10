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

### Emailing a candidate about a job
**Status:** ⚠ **DUPLICATED — A survives, B is being removed** (owner's call,
`DECISIONS.md` D-0012). The JD moves **inside** A's email as a formatted block.
**No attachments** — asked and answered; B's document attachment is dropped
deliberately, not overlooked.

| | A · Compose → Candidates | B · "Email JD to candidates" |
|---|---|---|
| Owner | `observatory` (writer), `harbour` (send) | `guild` |
| Entry | Email → Compose → Candidates | a job's Candidates tab, multi-select; also the candidate profile's Email button |
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

**A is the survivor. B's only unique capability is document attachment** — that
is the thing a careless merge loses, and the reason this table exists rather
than a one-line "duplicate, delete B".

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

### Telling a user what to do next
**Status:** LIVE · owner `observatory`
`GET /next-actions`, on all three dashboards. **Opted-out threads never produce
an action** — compliance rule, pinned by a test.

### Summarising what came in today
**Status:** LIVE · owner `observatory`
`GET /ai/morning-briefing`, on all three dashboards. Rules-written, AI as the
upgrade.

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
