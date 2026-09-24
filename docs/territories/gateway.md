# Gateway — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## What is true here now
- `index.js` is 3,175 lines (down from 3,403 — the recruiting workflow channels
  and candidate/client email endpoints moved to `routes/recruiting/outreach.js`).
- `routes/` is 36 files, ~9,400 lines. `routes/recruiting/*` belongs to `guild`.
- `models/` is live: `db.forRequest(req)`, `db.global`, `db.crossOrg()`. Raw
  `supabase` still works, so conversion is incremental — unconverted call sites
  are unaffected but unprotected.
- All outbound HTTP goes through `http-client.js`.

- **`GET /companies/:id/intake`** answers everything the "+ New Job" form needs
  about a picked client in ONE call — re-add cooldown, the POCs already known
  there, the address on file. One endpoint because all three are wanted at the
  same instant, and because the cooldown has to be shown THEN rather than at
  Save.
- **The company cooldown is `services/company-cooldown.js` now.** `routes/jobs.js`
  had the only server-side copy and it was gated on `hasRole(req,'ra')`; the
  browser had a third that hard-coded 21 while the real number is admin-editable
  (`company_cooldown_days`). See D-0023.

## Fragile — touch with care
- **Registration order.** `routes/recruiting/*` register on `app` directly, not
  as mounted Routers. Three literals were dead at once until Session 19:
  `POST /admin/integrations/ai-test` (four sessions dead — the button "did
  nothing"), `POST /admin/integrations/email-verify`, `GET /jobs/export`.
  `test/route-shadowing-smoke.mjs` scans every router and fails on any shadowed
  literal.
- **`retryUnsafe`** exists for token refresh only. Anything else that retries a
  POST can double-send.
- **The free-tier instance budget.** Adding any scheduled poll spends hours the
  owner has flagged as a hard limit.

## Open here
- `/bd-analytics/*` is legacy and **un-org-scoped**. Fold into
  `/reports/recruiting` or scope it.
- `/ai/generate-summary` is reachable and uncalled; `/ai/generate-email` is
  reachable only from the orphaned `12-manager-users.js`. One to wire, one to
  delete — waiting on a decision.
- CSV import/export + a small public API is the highest-leverage unstarted bet
  in `CLAUDE.md`, and it lands mostly here.
- **C-0014 open to `deep`**: 81 of 309 leads (26.2%) have a wrong
  `jobs.timezone` written by the old buggy resolver, before this session's fix.
  Backfill needs a fresh, explicit owner go-ahead before it touches the live DB.

## Fixed this session
- **`getTimezoneFromLocation()` (`index.js`) no longer scans for a 2-letter
  state code as a substring anywhere in the location text.** That was matching
  the WRONG state whenever another state's code sat inside a longer word —
  `Denver, CO` matched "de" (Delaware) → EST instead of MST, `Arizona, Arizona`
  matched "ri" (Rhode Island), `Moreno Valley, CA` matched "va" (Virginia),
  `Los Angeles, California` matched "ia" (Iowa). It now: (1) parses a trailing
  `, XX` state code (tolerating trailing punctuation/whitespace), (2) falls
  back to a full state name matched as a whole word, (3) falls back to a short
  list of known metro-area strings with no state at all (`Dallas-Fort Worth`
  etc.), (4) defaults to `EST` if none of those resolve — never a bare
  substring scan again. `US_STATE_NAME_TO_CODE` and `US_METRO_AREA_TZ` are new
  constants next to `US_TZ_MAP`/`LEAD_TZ_IANA` in `index.js`; both callers
  (`routes/jobs.js`, `routes/candidate-outreach.js`) are unchanged — same
  function, same export, same output vocabulary (`EST`/`CST`/`MST`/`PST`).
  **Alaska/Hawaii still map to `PST`, not `AKST`/`HST`**, deliberately —
  `LEAD_TZ_IANA` has no entries for those codes and would silently fall back to
  `America/New_York` if asked for one, which is the same bug from a different
  angle. `test/lead-location-parse-smoke.mjs` (a different, frontend-side
  location parser owned by surface) and the full 68-suite run both pass
  unchanged. Opened `C-0014` to `deep` for the backfill of the 81 already-wrong
  rows, with the measured breakdown; explicitly did not touch the live DB.

## Session 27 — the public apply page

- **`routes/apply.js` is new and it is the second UNAUTHENTICATED surface in
  the product — the first one that WRITES.** `GET|POST /apply/:token`, mounted
  in `index.js` next to `routes/tracking`. Rules are in `CLAUDE.md`; the ones
  that bite here: every miss (unknown / malformed / unpublished / filled)
  answers **byte-identically**, a malformed token **never reaches the
  database**, every query is bounded at **4s**, and a write that did not happen
  is never reported as saved.
- **`applyLimiter`** (`index.js`, 40 requests / 10 min) is new and passed
  through `routeCtx`. A real applicant costs two requests.
- **Publishing is `POST|DELETE /job-orders/:id/apply-link` ONLY.**
  `apply_enabled` is deliberately absent from `JOB_FIELDS`, so a plain
  `PUT /job-orders/:id` cannot put a customer's job on the open internet. Do
  not "tidy" it into the field list.
- Unpublishing KEEPS the token, so re-publishing restores the same URL. A link
  already posted to a job board must not silently rotate.

## Session 30, round 2 — rampart's review of C-0021 (items 1-6)

Rampart read every commit and found two blockers plus more; #1 (email-history)
and items 2-6 below are gateway's (attachment-byte-count regression, item 1 of
the review, is guild's `routes/recruiting/outreach.js` — not touched here).

- **BLOCKER fixed — `routes/email-history.js`.** `visibleJobIds` (renamed
  `ownedJobMap`) used `own.canSeeLead` — which admits a lead's CREATOR and
  whoever it is merely ASSIGNED TO for research, plus the pool — where the
  actual rule for an email is `canSeeEmail`: sender's own scope, OR the lead
  is **OWNED** (`assigned_to_bd`) in the viewer's scope. That let an RA read a
  BD's email body on a lead they only researched, and an RA Lead read the
  prior BD's mail on a recycled pool lead or on their own RAs' leads — exactly
  what D-0036 forbids. Now narrows the SQL `job_id IN (...)` set to jobs whose
  `assigned_to_bd` is `own.inScope`, and runs `own.scopeEmails` over the
  MERGED, capped rows as the final gate rather than trusting the two
  SQL-narrowed queries alone (the "no need to re-check" comment removed —
  narrowing in SQL is the speed optimisation now, not the rule).
  **Foundry should pin:** as an RA whose `created_by` lead has a BD's cold
  email on it, `GET /email/history` returns zero rows for that lead's emails;
  same for an RA Lead against a lead recycled to the pool or owned by an RA
  under them but not by the RA Lead themself. The existing 32/32
  `email-history-smoke` still passes unchanged (it didn't cover this).
- **`POST /companies/:id/merge`** — added `requireClientOwner` on both the
  source (folded away) and target (absorbing everything) company; admin
  passes both, same as every other D-0035 write.
- **`DELETE /companies/:id`** — reverted to admin-only. D-0035 lists edit,
  documents, email and contacts as owner actions, not delete; the
  `created_by` fallback (can be an RA) let one person delete a client
  colleagues still hold live leads on.
- **`GET /companies/:id/contacts` and `/companies/:id/intake`** — a contact is
  seen with its lead (D-0020); both now filter the company's leads through
  `own.canSeeLead(job, scope)` before pulling contacts, so another BD's POCs
  at the same client no longer show (D-0035/D5).
- **`PUT /jobs/:id`** — edit rights narrowed from "anything `canSeeLead`
  admits" to `own.inScope(existing.assigned_to_bd, scope)` (owner or their
  managers per chain) + admin/ra_lead + the existing RA-edit-window rule.
  `canSeeLead` also admits a lead's creator/researcher and the pool — sight,
  not editing (D-0020: review and prompt, not review and edit). A lead the
  caller cannot even SEE is now a 404 before the edit check runs, never a 403.
- **Pre-existing HIGH, `routes/microsoft.js` + `routes/gmail.js` OAuth
  callbacks:** `userEmailId` (and error text) from the base64 `state` was
  written straight into an inline `<script>` — reflected XSS on the app's
  origin, and forgeable (the org check added for C-0016 trusted the same
  unsigned value). `state` is now a **signed JWT** (`jwt.sign(...,
  process.env.JWT_SECRET, {expiresIn:'15m'})`) — the one secret this app
  already requires at startup (`config/env.js` `required('JWT_SECRET')`), no
  new env var; `/connect` signs it, the callback `jwt.verify`s it and answers
  the same generic failure sentence on any tampering, before any field is
  ever read. Every popup message in both files now goes through one
  `popupMessage(payload)` helper that `JSON.stringify`s the whole payload
  object (never a hand-built `'${x}'`) and escapes `<` so a value cannot close
  the `<script>` tag early either. Connect/reconnect verified unchanged for a
  legitimate user (state round-trips through sign → verify with the same
  shape it always carried: `{userEmailId, userId}`).
- **X9** — no code change; the owner is getting a `docs/ROADMAP.md` row
  (D-0030) for the "platform operator role" question. Not gateway's file.

Verified: `node --check` on `routes/email-history.js`, `routes/companies.js`,
`routes/jobs.js`, `routes/microsoft.js`, `routes/gmail.js` — all clean.
`email-history-smoke` 32/32, `route-shadowing-smoke` 9/9,
`org-scoping-routes-smoke` 13/13, `org-scoping-guard-smoke` 14/14,
`ownership-smoke` 69/69, `scope-jobs-smoke` 14/14, `backend-smoke` 107/107,
`recruiting-routes-mounted` 7/7 — all green.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-09** — fixed `getTimezoneFromLocation` state-code substring bug;
  opened C-0014 to deep for the backfill.
- **2026-09-22** — added `routes/apply.js` (public apply page) + `applyLimiter`; publish/unpublish endpoints on job orders. Migration 044 applied live with owner go-ahead.

- **2026-09-22 (Session 28, round 3)** — **THE APPLY PAGE NOW SENDS TWO EMAILS,
  AND `routeCtx` IS COMPLETED AFTER THE MOUNT TO ALLOW IT.**

  `routes/apply.js` is mounted long before `recruitingOutreach` exists, so its
  ctx could not carry the send helpers. **`routeCtx` is handed to every router
  BY REFERENCE and read inside handlers at request time**, so the two keys are
  attached to it *after* `app.use(candidateOutreach.router)` rather than moving
  a mount. **Registration order is load-bearing in this app** — adding a key is
  the cheap change, re-ordering is the expensive one.

  * **BEST-EFFORT, NEVER AWAITED, ALWAYS AFTER THE INSERT.** A stranger's
    application must not be held open — or reported as failed — because a
    mailbox is disconnected. It runs only once the row is saved, because an
    email saying "we have your application" when we do not is the same lie as a
    success page over a failed write.
  * **THE SENDING MAILBOX IS THE JOB OWNER'S, OR NOBODY.** There is no
    logged-in user on a public page and a public page may never choose a From
    address. No connected mailbox means no email, quietly.
  * Every await inside is bounded by the same 4s `withTimeout` the rest of the
    route uses, and every failure is swallowed.

## Session 28 — the rewind button's endpoint

`GET /history/:entity/:id` (`routes/record-history.js`, mounted after
`email-history`). ONE endpoint for five record kinds — `lead`, `candidate`,
`job_order`, `submission`, `company` — because the shapes differ only in which
store is read, and five endpoints is how three stores came to disagree in the
first place.

- **The parent record is loaded and org-checked BEFORE any history is read.**
  A history endpoint keyed on a caller-supplied id is a cross-tenant read
  waiting to happen. A record in another org answers **404, never 403** — a 403
  confirms the id exists, which is how ids get probed. A malformed id never
  reaches the database at all (the apply-page rule).
- **`services/record-history.js` is PURE and is gateway's**, along with
  `record-history-writer.js`. They span leads AND recruiting, so they sit with
  the territory that owns the shared files — the same reasoning that makes
  `index.js` gateway's rather than the domains'.
- **A candidate's history merges their own record changes with every stage move
  on every job they are on.** That is what a recruiter means by "what happened
  to this person": one person, several job orders, one timeline.
- **The general store is read best-effort.** If migration 045 is unapplied the
  rest of the timeline must still draw, rather than the whole panel failing
  over a table that is not there yet.

## Session 29 — retry endpoints for failed emails
- `POST /emails/retry-failed` (literal, registered ABOVE) and
  `POST /emails/:id/retry`, inline in index.js beside the other send-pipeline
  routes. Both read and write through `db.forRequest(req)`; another person's
  email answers 404. `retry-failed` takes optional `ids` (the rows the page is
  showing); a non-admin is always narrowed to `sent_by = self`.
- `GET /emails` now attaches `retry_note` + `can_retry` from
  `services/send-retry.js`, so no page re-derives "can this be retried".
- `recordSendFailure()` checks supabase's returned `error` (a missing column is
  REPORTED, not thrown) and falls back to plain `failed` so a row is never left
  at `sending`.

## Session 29 — AI first email in the send loop
`aiWriteFirstEmail()` in index.js runs after the atomic claim and before
`deliverOutboundEmail`, only when `sys_engine_ai_first_email` = 1 and a provider
is configured, only for first emails, and never for a row already
`template_variant = 'ai'` (a retry re-sends the stored AI text, no second
draft). The draft is STORED before sending; if the store fails the template is
sent. The loop variable is now `let email` — the draft replaces it.
`GET /emails` attaches `ai_written` / `ai_will_write`.

- **2026-09-23 (R-041)** — `aiWriteFirstEmail` picks `engine_first_email_thin` when `input.thin_posting`.

- **2026-09-23 (R-040)** — `GET /admin/ai-budget` returns `provider_limits`.

- **2026-09-23** — `POST /jobs/bulk` stores `import_extra` into `research.import_extra` via `cleanImportExtra` (≤40 columns, ≤500 chars each). `job_url` was already accepted; the importer simply never sent it.

- **2026-09-24 (R-045)** — `POST /jobs/fill-missing`: org-scoped (`withOrg` on every read and write), same ownership check as `GET /jobs/:id`, applies `lead-fill.fillPatch`. Jobs cache refresh is the existing write middleware.

## Session 30 — D-0034/D-0035 (C-0021): "you see only what you own"

The owner, logged in as BD Lead 1, saw 49 leads while owning 25, and 119
outreach emails while owning far fewer. `services/ownership.js` (rampart's)
defines the rule once — `viewScope`/`canSeeLead`/`canSeeEmail`/
`canSeeSubmission`/`scopeLeads`/`scopeEmails`/`queryOwnerIds`/`POOL_ROLES` —
and this session applied it across every endpoint C-0021 named that is
gateway's, plus D-0035's owner-vs-viewer split for clients and C-0016's OAuth
mailbox holes. **Pattern used everywhere:** compute the chain via
`hierarchy.js` `reportingChainIds` (never a second BFS), build `viewScope`,
narrow in SQL before any `.limit()`/`.range()`, and a by-id miss is a **404**,
never 403.

**`GET /jobs` (routes/jobs.js) now reads `own.scopeLeads(all, scope)`** — the
entire role ladder (admin/ra_lead/bd_lead/bd/else) is gone. This is also what
feeds the Leads page's stat cards, so BD Lead 1's Total/Assigned/Connected/
Rejected cards now read off the same 25-lead list they own. `GET /jobs/:id`
and `GET /jobs/export` use the same scope (`canSeeLead` / `scopeLeads`).
`PUT /jobs/:id`'s `canEdit` no longer admits every `bd`/`bd_lead` in the org —
only the owner, admin/ra_lead, an RA in their edit window, or a manager whose
chain includes the owner (`own.canSeeLead` reduces to exactly that for a
non-chain bd, so nothing else widened).

**X3 — an id from the request body/query is validated against the caller's
org before being written**, never trusted because it "isn't secret":
`userOrgId(userId)` / `mailboxOrgId(userEmailId)` (index.js, exported on
`routeCtx`) back `PUT /jobs/:id` (`assigned_to`, `assigned_to_bd`,
`sending_email_id` — 400 on mismatch, not 404: this is the caller's bad
input, not someone else's record) and `POST /distribute/execute`
(`manager_id`, plus `withOrg` on the mailbox-account fetch that follows it).
**`routes/workflows.js` (`/jobs/bulk-assign`) is guild's per `_map.json`
despite living outside `routes/recruiting/`** — same misaddress C-0017 already
named for `lookups.js`/`workflows.js`. Not touched; flagged in the C-0021
report instead of reached across.

**`GET /email/history` (routes/email-history.js)** — the leads-engine source
(`emails`, tied to a `job_id`) runs two SQL-narrowed queries (`sent_by IN
ownIds`, `job_id IN` the viewer's visible leads, chunked at 200), merges and
re-caps at `PER_SOURCE`; `email_tracking`/`candidate_outreach` (not tied to a
lead) narrow to the sender's own scope only, pending rampart's D1/D2. **Also
fixed the same session, on ledger's flag:** the 'individual' source was
sending `email_tracking.token` to the browser as the row id — the bearer
secret behind the open pixel *and* `POST /i/<token>/opt-out`, which writes the
GLOBAL suppression list. It now selects and returns the real `id` column;
confirmed the only frontend reader (`public/js/50-all-mail.js`) uses that id
only to toggle a row open/closed client-side, never to call another endpoint,
so the swap is behaviour-neutral.

**`GET /follow-ups` (index.js)** used to narrow only for a pure `bd`, and
carried **no org filter at all**. Now `withOrg` + `canSeeLead` on the row's
job. **`routes/companies.js:318` email-activity** and **`:70`
`PATCH /contacts/:id/email-status`** (added the `canTouchJob` gate its three
siblings already had — this was the one contact mutation with none),
**`routes/record-history.js`** (`canSeeLead`/`canSeeSubmission` gate `lead`/
`submission` history reads; `candidate`/`job_order`/`company` unchanged,
pending D1/D3), and **`routes/distribution.js` `/distribute/today-summary`**
(`inScope(manager_id) || scope.seesPool`) are all done per C-0021's table.

**D-0035 (the owner's answer to D2), applied in `routes/companies.js`:**
every BD still SEES every client (unchanged — `GET /clients`,
`/companies/:id/*` reads). Only the client's OWNER (or admin) may ACT —
`PUT`/`DELETE /companies/:id`, document upload/delete. **"Owner of a client"
is read off the data** (`clientOwnerId()`): the most-recently-created job
order's `bd_manager_id` at that company wins if one exists, else the
most-recent lead's `assigned_to_bd`, else `companies.created_by`. A non-owner
gets a 403 naming who it belongs to when a name is resolvable
(`requireClientOwner()`, same idea as `closeRefusal`), never a bare
"Forbidden". **Widened, deliberately, per the owner's own words** ("every
ACTION... is allowed only to the client's OWNER (and admin)"): `DELETE
/companies/:id` used to be admin-only; the owning BD can delete their own
client now too. Email bodies on `/companies/:id/email-activity` follow
D-0034's sender-scope split (envelope stays visible to every BD, `body` masks
to `body_visible:false` + `body_note` for a non-owner) — **surface must not
reuse the existing "sent before PACE kept a copy" null-body fallback for
this**; see the report for the exact line.
**`POST /companies/:id/email` lives in `routes/recruiting/outreach.js`
(guild's) and D5's duplicate check lives in `routes/workflows.js` (guild's)**
— both flagged to guild in the C-0021 report with the frontend read exactly
as it stands today, not touched here.

**C-0016 closed** — `routes/microsoft.js` / `routes/gmail.js`. Every
`userEmailId` path/query parameter now goes through `ownedMailboxSlot(orgId,
userEmailId)` before the mailbox is touched: `/auth/{microsoft,google}/connect`
refuses to mint OAuth state for a foreign-org slot; the callback re-checks the
same thing (state is base64, not signed, so this is defence in depth against
a hand-crafted state, not just a UI guard) and on a mismatch sends the same
generic failure message rather than the old "this slot is for `<email>`"
disclosure; `/status/:userEmailId` answers `{connected:false}` for a foreign
slot exactly as it does for a disconnected one (no new response shape); the
`DELETE` (which also calls `reassignJobsOffMailbox`) 404s a foreign mailbox
instead of a bare role check. `routes/gmail.js` is mounted with its own small
ctx (`{ supabase, auth, hasRole, provider }`), not the shared `routeCtx` — had
to add `orgIdFor` to that mount call too, or this fix could not reach it.

**X4 (`domain_events`)** — the table is GLOBAL, "org lives inside the
payload" (models/tables.js's own comment, unactioned until now). `emit()`
itself (events.js) is unchanged; `routes/events.js` now filters
`payload->>orgId = <caller's org>` and **excludes any row with no `orgId` in
its payload** — the safe default the contract asked for. Stamped `orgId` on
every `emit()` call site in index.js where it was cheaply available without
touching send/queue behaviour: `OUTREACH_QUEUED`, `LEAD_ASSIGNED` (both have
`req`), and the reply/bounce sweeps' `EMAIL_BOUNCED`/`CONTACT_INVALIDATED`/
`CONTACT_REPLIED`/`CONTACT_UNSUBSCRIBED`/`CANDIDATE_REPLIED`/
`CANDIDATE_UNSUBSCRIBED` (added `org_id` to the existing `microsoft_tokens`/
`gmail_tokens` mailbox-list selects that feed those sweeps — one more column,
same rows, same order, same timing). **Left un-stamped, deliberately, given
"do not change send/queue behaviour":** `MAILBOX_AUTOPAUSED`, `EMAIL_SENT`
(inside the per-email send loop itself), `FOLLOWUP_QUEUED` (the follow-up
engine has no cheap per-bd org lookup in scope). Every `emit()` call outside
index.js (guild's, observatory's, ledger's) still carries no `orgId` — their
rows are excluded by the same safe default until those territories add it,
which is worth a small follow-up contract rather than a silent gap.

**X8 (low)** — `inferSkillsFromJobHistory` (routes/jobs.js) read every org's
job history to guess skills for an import; now `withOrg`'d.

**X1/X2 (critical) — `routes/settings.js`.** `GET /app-settings` returned
**every** `app_settings` row — plaintext `int_<provider>_api_key`s, every
user's `u_<id>_signature_html`, `pref_<id>` themes, the `ai_*` usage meter —
to any logged-in user of any org. Grepped every `/app-settings` caller in
`public/js`: the only two keys ever read back are `outreach_send_time` /
`followup_send_time` (both from the orphaned `12-manager-users.js`).
`APP_SETTINGS_ALLOW = ['outreach_send_time', 'followup_send_time']` now gates
both GET and POST; POST is also admin-only (was admin-or-ra_lead). **Not
allow-listed, on purpose:** the same orphaned page's `template_<key>_subject/
body` writes (the follow-up engine's global fallback templates) — those still
work exactly as before at the DB layer, just not through this door until that
page is wired back up, at which point widening the list is a one-line,
reviewable change.

**Harbour's ask, same session:** `addToSuppression()` (index.js) didn't stamp
`org_id`, so every opt-out filed under the default org once a second org
exists. Added an optional trailing `orgId` param (additive — every existing
caller in harbour's/observatory's own files still works unchanged, just
un-stamped until they pass one too) and threaded it through index.js's own
two call sites (the reply sweep) via `tokenRow.org_id`, which needed `org_id`
added to the `microsoft_tokens`/`gmail_tokens` selects feeding that sweep —
same additive, no-behaviour-change shape as X4 above. **The suppression
CHECK before a send stays deployment-wide, unchanged** — that scoping
decision is ledger's, per harbour's own framing; this only fixes who a row is
recorded as belonging to. `routes/deliverability.js:72` (harbour's) and
`routes/candidate-outreach.js:374` (observatory's) both have a cheap `orgId`
already in scope at their call sites and can pass it as the new 6th argument
whenever those territories touch that file next — not edited here.

**X9 — NOT built, raised to the owner as instructed.** A "platform operator"
role (today's global send-pause, `/admin/sending/pause|resume`, the
deployment-wide AI keys and caps) is a real design question for selling to a
second customer, not a bug fix. Logged here so it is not silently re-raised
as a defect.

**Known-debt snapshot needs a foundry update** — running
`test/org-scoping-guard-smoke.mjs` after this work: `routes/companies.js` (5
lines) and `routes/jobs.js` (2 lines, the research/parse-jd fixes) are fixed
and should come OFF `KNOWN_DEBT`; two NEW lines appear in
`routes/microsoft.js` (the org-comparison reads inside the OAuth
connect/callback handlers — `supabase.from('users')...eq('id', userId)` and
`supabase.from('user_emails')...eq('id', userEmailId)`, both intentionally
unscoped by an org `.eq()` because the whole point of that code is comparing
two different orgs' values against each other) and need adding, with that
justification, rather than "fixing" — the test's own comment anticipates
exactly this shape ("a public route with no org context at all, like an OAuth
callback"). Did not touch `test/` myself. Full detail in the C-0021 report to
the orchestrator.

Verified: `route-shadowing-smoke` (9/9), `recruiting-routes-mounted` (7/7),
`backend-smoke` (107/107), `org-scoping-routes-smoke` (13/13),
`ownership-smoke` (31/31), `sender-identity-smoke` (29/29) — all green.
`org-scoping-guard-smoke` fails only on the known-debt snapshot needing the
update named above (not a new leak). `node --check` clean on every file
touched.


**2026-09-24 (rampart round-2 R1/R5):** `routes/email-history.js:147` `LEAD_SELECT`
was missing `sent_by` — `own.scopeEmails`'s final gate (services/ownership.js
`canSeeEmail`) reads `email.sent_by` OR `job.assigned_to_bd`, so with `sent_by`
absent a recycled/reassigned lead's history silently lost the "I sent it" half
of the rule for its original sender; added `sent_by` to the select (companies.js
email-activity, emails.js `emailRows`, and tracking.js `ACTIVITY_SELECT` were
already correct — checked all three). Also R5: the mailbox-connect OAuth
`state` JWT (`routes/microsoft.js:68/119`, `routes/gmail.js:59/113`) is signed
with the same `JWT_SECRET` as a real session token and carried no purpose
claim, so a leaked/logged state could have verified as a session in `auth()`
(index.js:222, gateway-owned — not rampart's middleware/authorize.js); both
now sign `p:'mailbox'` and require it on verify (mirroring sso.js's existing
`p:'signin'`), and `auth()` (index.js:233) now refuses any token carrying a
`p` claim at all, whatever its value. `node --check` clean on
routes/email-history.js, routes/microsoft.js, routes/gmail.js, index.js;
`email-history-smoke` 32/32, `backend-smoke` 107/107, `route-shadowing-smoke`
9/9, `recruiting-routes-mounted` 7/7, `org-scoping-routes-smoke` 13/13. Did
not touch `test/` (foundry is concurrently writing there). Not committed.
