# The border ledger

Every request one territory has made of another. **Append only — close an entry,
never delete it.** Format is fixed so an agent can find its inbox by grepping its
own name after the arrow.

Status is `OPEN`, `ANSWERED` or `DECLINED`.

**ALLOCATING AN ID — do this, do not eyeball it.** The file is not in numeric
order and a resolution can be appended far below its own contract, so "the last
heading" is not "the highest number". Run:

```
grep -oE '^### C-[0-9]+' docs/territories/_contracts.md | sort -u | tail -1
```

and add one. Two territories once both picked `C-0008` from different reference
points, and a ledger whose ids are not unique cannot be searched by id — which
is the only thing it is for.

**CLOSING AN ENTRY — edit the status in its ORIGINAL heading.** Append the
reasoning underneath it, or as a `#### ↳ resolution of C-NNNN` block if it is
long. **Never open a second `### C-NNNN` heading for a contract that exists**;
that is what makes the count above wrong for whoever comes next.

---

### C-0001 · surface → observatory · ANSWERED · 2026-09-09
**Asks for:** a decision on the daily import briefing (`/ai/generate-summary`).
**Because:** the endpoint works and **nothing on any screen calls it.** Surface
can build the dashboard card, but needs to know the shape it returns and whether
it should render at all when `complete()` returns null.
**Blocked until answered:** yes — Surface will not build a card against a guessed
payload shape.

### C-0002 · surface → gateway · OPEN · 2026-09-09
**Asks for:** `/ai/generate-email` either wired to a real screen or deleted.
**Because:** it is reachable only from `12-manager-users.js`, which is orphaned —
unreachable via nav — and never invokes it even there. Two dead things propping
each other up.
**Blocked until answered:** no.

### C-0003 · rampart → gateway · OPEN · 2026-09-09
**Asks for:** `/bd-analytics/*` org-scoped, or retired into `/reports/recruiting`.
**Because:** it is the last known un-org-scoped surface in the app. Every other
read is scoped by construction through `models/`.
**Blocked until answered:** no — but this is a **cross-org read**, which is the
one class of defect that produces no error message.

### C-0004 · harbour → deep · OPEN · 2026-09-09
**Asks for:** an error column on `emails` (migration 043) recording *why* a send
failed.
**Because:** a dead mailbox sign-in marks each email `failed` with no retry, one
every ~90 seconds, and `friendlySendError`'s correct sentence goes only to an
in-memory cache and dies with the process. Eleven follow-ups were lost on 31 Aug
and nobody could see why from the database.
**Blocked until answered:** no. **⚠ The owner PARKED the wider Gmail expiry issue
on 2026-09-01** — "We will work on this but not now." Do not re-raise it as
blocking; this column is the cheap half and is worth having regardless.

### C-0005 · guild → surface · OPEN · 2026-09-09
**Asks for:** `/recruiting-dashboard` widgets hierarchy-scoped the way
`/reports/recruiting` already is, and the Reports page folded into the Dashboard.
**Because:** the owner asked for both. Today only the separate Reports page is
hierarchy-aware, so a manager sees one scope on one screen and another elsewhere.
**Blocked until answered:** no. Guild does the endpoint half; Surface does the
screen half. Neither is useful alone.

### C-0006 · foundry → rampart · CLOSED (by foundry) · 2026-09-09
**Asks for:** `bd_lead`, `director` and `associate_director` added to
`test/helpers/enter-app.mjs`.
**Because:** a five-role sweep silently skips three roles real people hold. One
nav-icon collision affected `bd_lead` and went unseen for exactly this reason.
**Blocked until answered:** no — but every role-varying test is currently
under-covering until it is.
**Closed:** foundry added all three during the morning-briefing review
(2026-09-09) — no need to wait on rampart for a `test/` file. Confirmed the
fix actually widens coverage: `nav-icons-smoke.mjs`, which iterates
`TEST_USERS`, went from 40/40 to 55/55 assertions on the very next run with no
edit to that test itself. New suite `test/morning-briefing-card-smoke.mjs`
walks all eight roles in `users_role_check`
(`ra, ra_lead, bd, bd_lead, admin, recruiter, associate_director, director`)
explicitly and confirms the briefing card renders for each.

### C-0008 · foundry → surface · ANSWERED (by surface) · 2026-09-09
**Asks for:** the morning-briefing card fetched (or hidden) while "view as" is
open, not left showing "Working out what came in today…" forever.
**Because:** `loadMorningBriefing()` is gated `!isViewingOther` in
`renderDashboard()` (`public/js/05-page-dashboard.js`), the same gate used for
`loadNextActions()` — but that gate exists to stop the VIEWER's own
per-user queue being mislabeled as the viewed person's. The briefing is
org-wide, not per-user, so the same guard has a side effect nobody intended:
if `STATE.briefing` is still `undefined` (a manager opens "view as" before
ever loading their own dashboard this session), the card renders its loading
state and nothing ever resolves it, because the fetch that would resolve it
is the one line the guard skips. Confirmed by reading the code path, not
reproduced in a live browser (this territory does not edit `public/js/*`).
**Blocked until answered:** no — cosmetic today (a `git blame`-fresh session
that never visited the owner's own dashboard first), not data-incorrect.
**Answered:** confirmed real — reproduced live in a browser: enter as `bd_lead`
via `enter-app.mjs`, set `STATE.viewingUser` to another user WITHOUT ever
loading the own dashboard first, and the card sat on "Working out what came in
today…" forever, exactly as foundry read it from the code. Fixed by removing
the `!isViewingOther` gate on the `loadMorningBriefing()` call in
`renderDashboard()` (`public/js/05-page-dashboard.js`) — the briefing is
org-wide, so the sentence a viewer sees while previewing someone else's
dashboard is the same sentence they'd see on their own; there is no
mislabelling risk to guard against, unlike `loadNextActions()`, which is
per-user and is untouched. Verified with a screenshot: card resolves to the
real sentence while "view as" is active. Re-ran
`test/morning-briefing-card-smoke.mjs` (32/32) and the full
`test/run-all.mjs` (67/67 suites) after the change.

### C-0007 · observatory → gateway · ANSWERED · 2026-09-09
**Asks for:** a decision on `GET /jobs/today-summary` — does the morning
briefing read it as its lead-side source, or absorb its counting so gateway can
retire it?
**Because:** the owner has asked for a one-or-two-sentence "what came in today"
on the dashboard, so the briefing is being built. `/jobs/today-summary` already
returns **exactly** the object `/ai/generate-summary` consumes (`total`,
`clean`, `duplicates`, `byIndustry`, `byFreshness`, `byTimezone`,
`topPositions`, `poolSize`) — the two halves were built for each other and
neither is called by any screen. If observatory writes its own "leads that came
in today" count alongside it, there are immediately two counters that can
disagree about the same morning, which is how the stage vocabulary ended up in
six files. Note also that `/jobs/today-summary` is gated `admin`/`ra_lead`,
and every role opens a dashboard in the morning.
**Blocked until answered:** no — the sentence can be written against either
source. But the answer decides whether one of the two counters is deleted or
kept, and that is much cheaper to settle before the code exists than after.


---

#### ↳ resolution of C-0001 — ANSWERED (observatory, 2026-09-09)
**Endpoint:** `GET /ai/morning-briefing` (auth, any role, org-scoped). Not the
old POST — that one is admin/ra_lead gated and takes a body, and every role
opens a dashboard in the morning.

**It always returns 200 and `summary` is always a non-empty string.** There is
no null, no error state and no "AI unavailable" for Surface to branch on.

```json
{
  "date": "2026-09-09",
  "summary": "6 new leads, 3 new candidates and 2 replies came in today. The replies are waiting on an answer.",
  "engine": "rules",           // "rules" | "ai" — rules is the normal case
  "quiet": false,              // true when nothing arrived at all
  "degraded": false,           // true only when the DATABASE could not be read
  "provider": null,            // "groq" etc. only when engine === "ai"
  "ai_rejected": null,         // why an AI draft was refused, e.g. "invented_number"
  "facts": { "date": "...", "leads": {...}, "candidates": {...},
             "submissions": {...}, "replies": {...} },
  "generated_at": "2026-09-09T16:36:03.013Z"
}
```

- **Quiet day:** `quiet: true`, summary `"Nothing new has come in yet today."`
  (plus the unassigned-pool sentence when the pool is not empty). Render it or
  render it smaller — Surface's call — but it is a true sentence either way.
- **AI off / spent / rate-limited:** identical shape, `engine: "rules"`. **Do
  not draw an "AI unavailable" state; there is no such state.** The Admin screen
  already promises the daily briefing has a built-in non-AI version — as of this
  change that promise is true.
- **Database unreadable:** `degraded: true`, summary `"Today's activity could
  not be read just now."` — the one case where hiding the card is right.
- `facts` is there so the card can show the numbers next to the sentence
  without a second request. Every number in `summary` comes from `facts`; a
  model that states any other number is rejected and the rules sentence ships.

### C-0009 · orchestrator → surface · ANSWERED (by surface) · 2026-09-09
**Asks for:** two more defects on the same dashboard screen the C-0008
screenshot showed, both in `44-next-actions.js`, neither a regression: (1) the
next-actions card returns `''` on a failed fetch (`if(s._error)return '';`),
unlike the briefing card's honest amber message; (2) the card sticks on
"Working out what needs you…" forever during "view as", because
`loadNextActions()` is correctly gated `!isViewingOther` (must stay — it is a
per-user queue and a preview must never fetch the viewer's own and label it
the viewed person's) but `renderNextActionsCard()` had no branch for "gated
and never fetched", so nothing could ever resolve the loading state.
**Because:** found by the orchestrator reviewing the C-0008 screenshot; both
predate this work (commit c5cb602).
**Blocked until answered:** no.
**Answered:** (1) `renderNextActionsCard()` now renders the same
`.briefing-card.is-error` honest message on `s._error`, reusing the class
built for the briefing card rather than writing a second version — "Could not
load what needs you today." with a retry link. (2) Chose to show a plain
sentence rather than hide the card: while "view as" is open and
`STATE.nextActions` is still `undefined` (never fetched, by design), the card
renders "This is a personal to-do queue — not shown while previewing someone
else's dashboard." instead of the loading state. Hiding it silently was
rejected — the owner has twice named silent disappearance as the exact defect
to avoid (this is what "Needs you today" used to do, and is the whole reason
the briefing card exists in its current form). The fetch gate itself
(`!isViewingOther` in `renderDashboard()`) is untouched, as instructed.
Also fixed the screenshot habit named in this job: `screenshot-dashboard.mjs`
now calls `require('../services/morning-briefing').rulesBriefing(facts)` to
generate the stubbed sentence instead of typing one by hand — written down as
a rule in `docs/territories/surface.md`.
Verified: `test/screen-stability-smoke.mjs` (23/23), `mobile-layout-smoke.mjs`
(32/32), `frontend-smoke.mjs` (14/14), `morning-briefing-card-smoke.mjs`
(32/32), `bash test/verify-frontend.sh` (pass), `node test/run-all.mjs`
(67/67, log-grepped, never piped to `tail`). Screenshots taken:
`dash-viewas.png` (neither card stuck while "view as" is open),
`dash-na-failed.png` (next-actions fetch failing, honest message shown).

#### ↳ resolution of C-0007 — ANSWERED (observatory, 2026-09-09)
**The briefing does NOT read `/jobs/today-summary`, and does not absorb it.**
Two reasons: that endpoint is gated `admin`/`ra_lead` and the briefing must
answer for every role; and its payload is an *import* breakdown (freshness,
timezone spread, duplicate flags) — a different question from "what came in".

**They cannot disagree**, because the briefing counts leads with the *same
filter*: `jobs` where `created_at >= today()T00:00:00Z` and `deleted_at is
null`, org-scoped. That filter is stated in the comment above `gatherFacts()`
in `routes/ai.js` and must stay identical to the one in `/jobs/today-summary`
if either is edited.

**Gateway's call, not mine:** if you want `/jobs/today-summary` retired, its
consumer can read `facts.leads` from `GET /ai/morning-briefing` — but it would
lose `byFreshness`/`byTimezone`, which the briefing deliberately does not
collect. My recommendation is **keep both**; they answer different questions
and neither derives its number from the other.

### C-0011 · observatory → surface · ANSWERED (by surface) · 2026-09-09
**Asks for:** two sentences in `public/js/49-page-candidate-outreach.js` to stop
promising a send window that is now off by default.
**Because:** the owner reversed the candidate send window the same day it
shipped ("remove the barricade of timezone for candidate emails ... Only the
outreach goes within the time zone"). `GET /candidate-outreach/sender` now
returns `window.enabled` (false by default) plus a ready-made `window.sentence`
that is true either way. Two places assemble their own prose AROUND
`window.label` and read wrong when it is off:
* line ~265 — "Candidates are emailed in their own local free time —
  <label> — so a batch queued now may wait." **Render `window.sentence`
  verbatim instead**, and drop the surrounding wording.
* line ~371 — "...in each candidate's local free time (<label>)". Show that
  clause only when `sender.window.enabled`; otherwise "starting straight away".
**Blocked until answered:** no — the server no longer defers, so the emails go.
The screen is merely over-promising a wait that no longer happens.
**Answered:** both sentences in `public/js/49-page-candidate-outreach.js` now
render the server's own strings instead of assembling one around
`window.label`. The sender card renders `s.window.sentence` verbatim (and only
shows "Change these hours" when `window.enabled`); the queued-result line
shows `window.label` only when `window.enabled`, otherwise "starting straight
away". Checked the queue rows too (`r.wait.reason==='window'`): the server's
`waitFor()` cannot produce that reason while the flag is off (confirmed —
`candidateWindowState` returns `open:true` unconditionally when disabled), so
the branch is dead but harmless and was left alone rather than deleted
speculatively. Verified live with a stubbed `GET /candidate-outreach/sender`
built from the route's own payload shape: `window.enabled:false` shows "any
hour... starting as soon as this batch is queued"; `window.enabled:true`
shows the old promise-of-a-wait sentence unchanged. Verified:
`verify-frontend.sh`, `screen-stability-smoke.mjs` (23/23),
`mobile-layout-smoke.mjs` (32/32), `frontend-smoke.mjs` (14/14),
`candidate-outreach-preview-smoke.mjs` (6/6), `run-all.mjs` (67/67,
log-grepped, never piped to `tail`). Screenshots: `compose-window-off.png`,
`compose-window-on.png`.

### C-0012 · observatory → foundry · CLOSED (by foundry) · 2026-09-09
**Asks for:** a behavioural drip-pacing case in
`test/candidate-outreach-smoke.mjs` (that file is yours; every current window
assertion in it is a `grep` over the router source, which cannot tell whether
the pacing still RUNS).
**Because:** removing the send-window gate is exactly the change that could
silently un-space a backlog, and Session 21 round 4 fixed that defect once
already. I proved it by running the real `drainDueOutreach` over 8 overdue rows
with a stubbed ctx — result `{sent:6, deferred:0}` with pauses
`[98308, 79425, 102006, 84928, 93565]` ms — and with the flag on, `{sent:0,
deferred:6}`. Worth pinning permanently.
**Three things that cost me an hour, if you build it:** the fake
`candidate_outreach` query must honour `.limit()` (otherwise the 6-per-tick cap
looks broken); the chain needs `.upsert()` for `email_send_log` (without it
every send is counted as failed AFTER the mail has gone); and override
`global.setTimeout` to record `ms` and fire immediately, so the 75-105s pauses
are observed rather than waited for.
**Blocked until answered:** no.
**Closed:** built `test/candidate-outreach-drip-smoke.mjs`, adapting observatory's
scratchpad proof into a permanent suite (the three stub tricks named above were
exactly right and are copied verbatim: `.limit()` honoured, `.upsert()` on
`email_send_log`, `global.setTimeout` swapped to record `ms` and fire
immediately). Four cases against the REAL `drainDueOutreach()`, not a
reasoning check: (1) window off (shipped default, key absent) — 8 overdue rows
→ 6 sent, capped at `DRAIN_PER_TICK`, 5 real pauses all 75-105s, 0 deferred;
(2) window explicitly on — all 8 out-of-hours candidates deferred, 0 sent
(the switch must still work, or it is not a switch); (3) the settings table
itself throwing on read — still drains as if off (this is the failure mode
the ledger entry named as hardest to diagnose: a query failure re-imposing a
barricade the owner explicitly removed); (4) a static check that
`routes/candidate-outreach.js` never calls `isInLeadSendWindow` /
`getSendWindowHours` / `formatWindowOpensLabel`, and that `index.js` still
defines both — confirming the existing cross-check is still meaningful, not
just present. 9/9 passing. Ran the full suite (68/68, was 67 — the one added
suite) on **both** Node 22 (sandbox) and Node 26 (Render's version, via
`/tmp/n26`), each written to a log file and grepped for the summary line, never
piped to `tail`. Read both commits (`8b50f91`, `5a0c85c`) adversarially:
confirmed the daily cap, warm-up ramp, mailbox auto-pause and suppression are
all byte-for-byte unchanged in the drain loop; confirmed the frontend's
`window.sentence`/`window.enabled` reads match the shape the route actually
returns (not guessed); found nothing else to raise.

### C-0013 · observatory → gateway · OPEN · 2026-09-09
**Asks for:** one clause added to the four `description` strings under
`group: 'Candidate outreach'` in `config/settings.js` — something like
"Only applies while the candidate send window is switched on
(`app_settings.candidate_send_window_enabled`); it is off by default, and with
it off candidates are emailed at any hour."
**Because:** the owner switched the window off on 2026-09-09. The four hour
boxes are still on the Admin → System settings screen and are still obeyed the
moment the flag is turned on — but as written they promise hours that are not
currently in force, and **a setting that silently does nothing is worse than no
setting**. I did not edit the file; it is yours.
**Also for you to decide, not me:** `SETTINGS_SCHEMA` is numeric-only
(`validate()` runs `parseFloat`), so the on/off flag could not live in it. It is
read directly from `app_settings.candidate_send_window_enabled` by
`routes/candidate-outreach.js` (default OFF, and an unreadable settings table
also means OFF — a barricade the owner removed must never come back by
accident). If you want booleans in the schema, that is a gateway change and I
will move the read onto it.
**Blocked until answered:** no.

### C-0014 · gateway → deep · OPEN · 2026-09-09
**Asks for:** a backfill migration to recompute `jobs.timezone` for existing
rows written before this session's fix to `getTimezoneFromLocation()`
(`index.js`).
**Because:** the old resolver matched a 2-letter US state code as a
**substring anywhere** in the lowercased location text, first match wins in
`Object.entries(US_TZ_MAP)` order — so `Denver, CO` matched "de" (Delaware) and
resolved EST instead of MST, `Arizona, Arizona` matched "ri" (Rhode Island),
`Moreno Valley, CA` matched "va" (Virginia), `Los Angeles, California` matched
"ia" (Iowa). The fix (parses a trailing `, XX` code, then a full state name as
a whole word, then a short list of known metro-area strings — never a bare
substring scan) only corrects rows written or updated **from now on**
(`routes/jobs.js:239,311,377` all call the same function on create/update).
**Measured against the live database before the fix, not estimated:** of 309
leads whose `location` carries a resolvable 2-letter state code, **81 (26.2%)
have the wrong `jobs.timezone`** — every error in the same direction (stored
EAST of reality, so those leads are emailed EARLIER than the 08:00-16:00
window intends, in one case (Pacific-coast leads) from ~05:00 their local
time):

| should be | stored as | hours too early | leads |
|---|---|---|---|
| CST | EST | 1 | 34 |
| PST | EST | 3 | 16 |
| MST | EST | 2 | 13 |
| PST | CST | 2 | 9 |
| MST | CST | 1 | 7 |
| AKST | PST | 1 | 1 |
| MST | (empty) | — | 1 |

**Blocked until answered:** no — the resolver fix is live for new/updated rows
regardless; this is only about correcting the 81 already-wrong rows.
**Important:** this is gateway naming the fix and handing over the evidence —
**nothing is applied to the live database without a fresh, explicit go-ahead
from the owner.** Whoever picks this up should recompute each affected row's
timezone by re-running the new `getTimezoneFromLocation(location)` against its
stored `location` text (not by hand-mapping the table above, which is a
summary of the diffs actually observed, not an instruction set) and should
re-verify the count against the live DB at execution time since it will have
moved since 2026-09-09.
**Also worth knowing (not urgent, no action asked):** `LEAD_TZ_IANA` has no
`AKST`/`HST` entries and falls back to `America/New_York` for any key it
doesn't recognize, so the new resolver deliberately keeps mapping Alaska/
Hawaii locations to `PST` (the pre-existing, less-wrong approximation) rather
than emitting a value that would silently reopen this bug from a different
angle. Only 1 of the 309 rows measured was Alaska; a real fix needs
`LEAD_TZ_IANA` extended and `US_TZ_MAP`'s `ak`/`hi` keys changed together, and
is a separate, smaller piece of work if ever wanted.

### C-0015 · rampart → harbour · OPEN · 2026-09-09
**Asks for:** org scoping on `routes/emails.js` and `routes/warmup.js`. These
are yours; I did not touch them.

**First, the fact that sets the severity — verify it yourself, it is one line:**
`index.js:73` builds the Supabase client with `config.supabaseServiceKey`. The
backend runs as **service role**, which **bypasses RLS entirely**. "RLS is on all
48 tables" is a defence against someone holding the anon key; it is **no
mitigation at all** for anything in this file. Application code is the only
boundary. `middleware/authorize.js`'s own header has said so since it was split
out — it just was not carried into these routers.

**The exact fix pattern (do not re-derive it):**
1. **Prefer `db.forRequest(req).from('emails')` over adding `.eq('org_id', …)`
   by hand.** Scoping you have to remember is scoping that gets forgotten —
   that is how four cross-org leaks got in. `emails`, `user_emails`,
   `warmup_threads`, `warmup_send_log`, `microsoft_tokens` and `contacts` are
   all in `TENANT_TABLES`. `app_settings` is GLOBAL — leave those five queries
   alone, they are correct.
2. **A cross-org record is a 404, never a 403 and never a leak.** A 403 confirms
   the row exists and turns an id parameter into an oracle. Same shape as
   `ownedMailbox()` in `routes/mailbox.js`, which already gets this right.
3. **An INSERT must stamp `org_id` explicitly.** Migration 022 gave every tenant
   table a column DEFAULT of the default org, so an un-stamped insert does not
   fail — it files company B's row under **company A**, silently. This is the
   quieter half of the problem and it is a data-corruption bug as much as a
   leak.

**The specific rows, ranked by what company A could do to company B:**

| # | where | what a person in org B can do to org A | severity |
|---|---|---|---|
| 1 | `emails.js:35` `GET /emails` | Line 36 applies `.eq('sent_by', req.user.id)` **only for non-admins**. An `admin` or `ra_lead` gets the query with no `sent_by` and **no `org_id`** — i.e. **every email row in the deployment, full bodies and subjects included**, plus joined `contacts` (name, email, designation), `jobs`, `companies` (name, industry, location) and `users`. This is the single worst line found in the audit: a complete read of another customer's outbound book. | **critical (read)** |
| 2 | `emails.js:241` `POST /admin/emails/purge-pending` | With `all_managers:true` the fetch at :259 is filtered only by `status='pending'`, and the delete at :293 is `.delete().in('id', batch)` with no org and no ownership condition on the rows. One admin of org B **empties every org's pending queue**. Unrecoverable — the rows are gone, and the emails were never sent. | **critical (destructive)** |
| 3 | `emails.js:181-185` `DELETE /emails/:id` | `data.sent_by !== req.user.id && !hasRole(req,'admin')` — so an admin passes the check for **any** row in the table. Delete any email in any org by id. | **high (destructive)** |
| 4 | `emails.js:83` `GET /emails/pending-summary` | Admin/`ra_lead` with no `manager_id` query param gets every pending row in every org. Volume + timezone distribution of another customer's send queue. | **medium (read)** |
| 5 | `emails.js:144-146` `POST /emails` | Insert stamps no `org_id` → lands in the **default org**. The follow-up `contacts.update(...).eq('id', contact_id)` at :146 has no org filter either — a blind cross-org write to another customer's contact record (`email_sent_at`, `email_platform`). | **medium (write + misfiling)** |
| 6 | `warmup.js:106` `loadMailbox(id)` | `user_emails` by id, no org. It backs `POST /warmup/:id/start|pause|resume|stop|opt-in|opt-out` — every one gated on `canManage(req)` (a **role** check, which an org-B admin passes) and nothing else. An admin in org B can start or stop warm-up on **org A's mailbox**, which changes what that customer's real mail domain does. | **high (write)** |
| 7 | `warmup.js:162` `GET /warmup/:id/threads` | `warmup_threads` by `from_mailbox_id`, no org, `canView` only. Returns subjects and the joined `user_emails.email_address` of the receiving mailbox — reads out another customer's mailbox addresses. | **medium (read)** |
| 8 | `warmup.js:54,66,46` | The mailbox list, `warmup_send_log` and the `microsoft_tokens` connected-set lookup are all unscoped. #46/#66 are keyed `.in('user_email_id', ids)` off the list at :54, so scoping :54 fixes all three. | **medium (read)** |

**Note on `emails.js`:** lines 70, 219 and 224 are already scoped in practice by
`.eq('sent_by', req.user.id)`. They are not leaks and do not need changing —
I am naming them so you do not spend time on them.

**Blocked until answered:** no — nothing of mine waits on this. But #1 and #2
are the two highest-severity findings in the whole audit.

### C-0016 · rampart → gateway · OPEN · 2026-09-09
**Asks for:** an ownership check on the `userEmailId` path/query parameter in
`routes/microsoft.js` and `routes/gmail.js`. Per `scripts/territory-map.mjs`
these two are yours — they are in neither harbour's `own` list nor your `not`
list.

**Why this pair matters more than the others:** these are the OAuth token
routers. Migration 039 exists because `microsoft_tokens` held customers'
mailbox **refresh tokens** readable with the anon key. That hole was closed at
the RLS layer — but the backend uses the **service-role key** (`index.js:73`),
so RLS does not apply to these routes at all. The protection here is entirely
application-side, and right now there is none.

**The exact fix pattern:** before touching `microsoft_tokens` / `gmail_tokens` /
`user_emails` for a `userEmailId`, load the `user_emails` row and confirm its
`org_id` equals `orgIdFor(req)`. A miss is **404**, never 403 — a 403 tells the
caller the mailbox slot exists. Then stamp `org_id` on the token INSERTs.

| # | where | what a person in org B can do to org A | severity |
|---|---|---|---|
| 1 | `microsoft.js:158` / `gmail.js:128` `DELETE /auth/{microsoft,google}/:userEmailId` | Gated on `hasRole(req,'admin','bd_lead')` and **nothing else**. An admin or bd_lead in org B passes any `userEmailId`: it deletes org A's OAuth tokens, sets their `user_emails.is_active=false`, and then calls `reassignJobsOffMailbox()` — which **rewrites org A's leads onto a different sending mailbox**. Their outreach stops and their lead records are mutated, with no error anywhere. | **critical (destructive)** |
| 2 | `microsoft.js:96` / `gmail.js:101` token INSERT | Neither stamps `org_id`, so every mailbox connected by any org after the first files its refresh token under the **default org** (column DEFAULT, migration 022). Once these rows are read back with an org filter, org B's tokens sit in org A's row space. | **critical (misfiling of secrets)** |
| 3 | `microsoft.js:20` `/auth/microsoft/connect` (and the Google twin) | `userEmailId` comes straight from the query string into the OAuth `state`; nothing checks it belongs to the caller's org. The callback's email-match guard (`:86-92`) does limit the damage — you cannot attach a mailbox you do not control — but see #4. | **high** |
| 4 | `microsoft.js:90` / `gmail.js:96` the mismatch message | *"you logged in as X but this slot is for **Y**"* — `Y` is `user_emails.email_address` read by id with no org filter. That is a **disclosure oracle**: point `connect` at any foreign slot id and the app reads out another customer's mailbox address. Keep the guard, make the message generic once the slot is known to be foreign (or better, 404 before reaching it). | **medium (read)** |
| 5 | `microsoft.js:120` / `gmail.js:122` `/status/:userEmailId` | `auth` only, no role and no org. Returns `email_address` and token expiry for any slot id in the deployment. | **medium (read)** |
| 6 | `microsoft.js:130,140,142,144` the schema-check/debug routes | These are keyed `.eq('user_id', req.user.id)` / `.eq('assigned_to_bd', req.user.id)`, so they are **scoped in practice** and are not leaks. Named so you do not spend time on them. | none |

**Blocked until answered:** no.

### C-0017 · rampart → guild · OPEN · 2026-09-09
**Asks for:** org scoping on `routes/workflows.js` and `routes/lookups.js`.
Both are yours per `scripts/territory-map.mjs` (`lookups.js` is in gateway's
`not` list and in your `own` list — I mention it because it was handed to me as
gateway's, and the map says otherwise).

**The fact that sets the severity:** `index.js:73` — the backend runs as
**service role**, so RLS is bypassed and application code is the only boundary.

**The exact fix pattern:** `db.forRequest(req).from('jobs')` rather than a
hand-written `.eq('org_id', …)`; a cross-org miss is a **404**; and for the two
bulk routes the ids come from the request body, so the org condition must be on
the **UPDATE/DELETE statement itself** — checking the ids first and mutating
after is a race, and it is twice the code.

| # | where | what a person in org B can do to org A | severity |
|---|---|---|---|
| 1 | `workflows.js:184,192,193` `POST /jobs/bulk-stage` | Role-gated to `admin/bd/bd_lead/ra_lead`, then `.update(updates).in('id', job_ids)` — **`job_ids` is unvalidated request body with no org or ownership condition**. Any BD user in org B can rewrite the stage of any lead in org A, and on `stage:'Unassigned'` it also **deletes their pending emails** (:192) and expires their active follow-ups (:193). Silent, and it hits the exact fields `releaseToPoolUpdate()` exists to keep consistent. | **critical (destructive)** |
| 2 | `workflows.js:220` `POST /jobs/bulk-assign` | Same shape: `.update(updatePayload).in('id', job_ids)`. Reassign another customer's leads to a user id of the caller's choosing, and re-point their sending mailbox (:210). | **critical (write)** |
| 3 | `workflows.js:231` `POST /jobs/check-duplicates` | Takes a list of email addresses and returns matching `contacts` joined to `jobs.position` and `companies.name`, **across every org**. A working **enumeration oracle**: paste a prospect list, learn which of them another customer is working and at which company for which role. Any authenticated user. | **high (read)** |
| 4 | `lookups.js:42` `POST /contacts/check-email` | The same oracle, one address at a time, and it returns more: `contact_name`, `company`, `position`, `days_ago`. Any authenticated user, no role gate. | **high (read)** |
| 5 | `workflows.js:22,47,72` `GET /insights/{ra,bd}/:userId` | The role gate lets an `admin`/`bd_lead`/`ra_lead` pass **any** `userId`, and the queries key on `created_by`/`assigned_to_bd` with no org filter. An org-B lead passes an org-A user id and gets that person's leads, company names, industries and email counts. | **high (read)** |
| 6 | `workflows.js:151` `GET /stats` | Unscoped aggregate over `jobs` — stage counts and contact activity for every org blended into one number. Not a record-level leak, but it is another customer's volume. | **medium (read)** |

**Blocked until answered:** no.

### C-0018 · rampart → foundry · OPEN · 2026-09-09
**Asks for:** two things in `test/`, which is yours.

**(a) One assertion in `test/authorize.mjs` is now wrong and is the only red
suite on `claude/org-scoping-audit` (68/69).** Line 58:

```js
ok('canTouchJob: admin → true (no lookup)', (await ctjAdmin(admin, 'j1')) === true);
```

It is built with `mockSupabase(null)` — no job row — and pins the **old**
behaviour: the admin bypass returned `true` before the row was ever read. That
was the bug. `canTouchJob` gates contact create/update/delete and the follow-up
routes, so it authorised an admin in org B to write to leads in org A by id.
It now reads the row first (with `.eq('org_id', req.orgId)` when the request
carries one) and only then applies the admin bypass. Please replace it with:

```js
ok('canTouchJob: admin, no such job → false', (await ctjAdmin(admin, 'j1')) === false);
ok('canTouchJob: admin, job in own org → true',
   (await mk({ created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z' })(admin, 'j')) === true);
```

The second line is the one that matters — it proves the bypass still WORKS for
a legitimate admin, so the fix is not just a denial.

**(b) A new suite pinning what this audit found**, because none of it is
currently covered and all of it fails silently. The assertions I want, in
priority order:

1. **`GET /emails` as an `admin` must carry an org condition.** The strongest
   cheap form is a grep, in the spirit of `test/sender-identity-smoke.mjs`:
   every `supabase.from('<tenant table>')` in `routes/` must be accompanied by
   an org filter, an ownership filter (`.eq('sent_by'|'user_id'|'created_by',
   req.user.id)`) or an explicit `db.crossOrg(` with a comment. `TENANT_TABLES`
   and `GLOBAL_TABLES` are already exported from `models/tables.js`, so the
   allow-list is free and stays correct as migrations land. **Please
   allow-list, not deny-list** — a new router should fail the test by default.
2. **`routes/auth.js`: `PUT /users/:id`, `PUT /users/:id/roles`,
   `DELETE /users/:id`, `PUT /users/:id/manager` and all five
   `/users/:id/emails*` routes answer 404 — not 403 — for a user in another
   org.** I added a single `guardUser(req, res, id)` choke point for exactly
   this; a test should pin the **404**, because a later "helpful" change to 403
   re-opens the id oracle and nothing would look wrong.
3. **`middleware/authorize.js`: `canTouchJob` is false for a job in another org
   even when the caller is an admin**, and true for one in their own.
4. **`services/provisioning.js` announces org creation**, and a listener
   registered via `onOrgCreated` fires when `createWorkspace()` succeeds. This
   is what arms `MULTI_ORG` — and therefore `auth()`'s org-less-session refusal
   — without waiting for a process restart.

**Blocked until answered:** no. (a) is worth doing before this branch merges,
since it is the only failing suite.
