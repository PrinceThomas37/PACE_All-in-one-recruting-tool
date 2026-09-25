# Gateway — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## Session 31 (2026-09-25) — client intelligence
- **The reply sweep no longer stores every inbound message** (index.js
  `processInboundMessages`). `clientIntel.gateMessage` keeps a contact or a
  candidate we emailed, or a reply on a thread PACE started (`emails.
  conversation_id`), and drops noise (job boards, account mail, no-reply),
  our own domain and strangers. Measured before: 3 of 77 stored messages were
  from a lead. Stored text is now ≤1,500 chars; each kept row is stamped with
  the mailbox's `org_id` (it used to fall back to the default org), its
  client's `company_id` and its free `facts`. Retries without the 048 columns
  if they are missing.
- **`routes/client-intel.js`** (mounted after companies): `GET /clients/:id/
  intel` and `POST /clients/:id/summary`. OFF = `{enabled:false}` and no email
  table read. Owner-only (D-0040): the client owner by `own.clientOwnerFrom`;
  an admin only when nobody owns it. Every stored outreach body goes through
  `renderStoredEmail`. Per-person meter `cis_used_<user>_<day>` in
  app_settings (D-0041). AI-unavailable codes are `ai_not_configured` /
  `ai_daily_limit`, deliberately distinct from the person's `daily_limit`.
- `routes/companies.js` merge: `clear` tables are deleted on the duplicate
  instead of moved.

- 2026-09-25 (owner: "do both"): the timeline shows OUR sent emails in full (up to 30k chars, `ci.fullEmailText`); `GET /clients/:id/intel/messages/:mid/full` fetches ONE reply's full original live from the mailbox it arrived in — owner of the client only, the email must belong to that client, and the mailbox must be the viewer's own (Inbox rule); returned as plain text, never stored.
- 2026-09-25 (owner: "just this lead list … let me see what it works with current data"): **the engine now serves a single LEAD too.** `routes/client-intel.js` `register(base, kind)` mounts the three routes for `/clients` AND `/leads`. A lead subject is that lead only (`leadIds:[id]`, `companyId:null` — so another lead's mail at the same company is NEVER in it; a test fails when `companyId` is set); owner = `assigned_to_bd` via `own.recordOwnerId('lead')`; its summary is one app_settings row `lead_summary_<id>` (no migration). **Catch-up of past replies** (index.js `catchUpLeadReplies` / `runClientIntelCatchUp`, engine job `client_intel_catchup` hourly, `POST /admin/client-intel/catch-up`): only while `client_intel_enabled` is on; per mailbox ONCE (done flag `cis_catchup_<user_email_id>`), ≤3 mailboxes per tick; SEARCHES the mailbox only for mail FROM contacts on leads its owner holds, last 90 days, ≤400 messages; files them via `storeConversationMessage` (duplicates are 23505 → ignored). **No side effects** — no stage change, sequence stop or suppression; those belong to the live sweep. A mailbox whose every search failed (dead sign-in) returns `mailbox_unreachable` and is NOT marked done, so it retries after reconnect.

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


## Session 30, round 3 — ownership take-over requests (D-0036/D-0037/D-0038)

New file `routes/ownership-requests.js`, mounted in `index.js` right after
`routes/record-history.js`. It is the database and org-scoping shell around
rampart's pure rule in `services/ownership.js` (`recordOwnerId`,
`clientOwnerFrom`, `canRequestTakeover`, `approverFor`, `canDecide`,
`canCancel`, `takeoverTransition`, `pickAdmin`) — this file never re-derives
who may ask, who approves, or what state comes next; it only loads the record,
builds the requester's scope, calls the rule, and moves data through the
EXISTING assignment paths on approval.

- **Table `ownership_requests` (migration 047) must be applied before this
  router does anything real** — it is already in `models/tables.js`
  `TENANT_TABLES` (deep added it), so `db.forRequest(req).from(...)` works the
  moment the table exists; nothing here creates or alters it.
- **API, matching the brief exactly** (no deviations):
  `GET /ownership-requests/can-request?kind=&record_id=[&via_email=]`,
  `POST /ownership-requests`, `GET /ownership-requests?box=mine|waiting|record`,
  `POST /ownership-requests/:id/approve|decline|cancel`. All literal — no bare
  `:id` GET/PUT in this file, so there is nothing for today's route-shadowing
  scanner to flag, but any new literal here still goes above
  `/ownership-requests/:id/*`.
- **`viaDuplicateEmailMatch` is set ONLY after a server-side check**
  (`emailMatchesLead`: queries `contacts` for that lead, org-scoped, and
  compares trimmed/lower-cased email) — never copied from the request body.
  Exactly what rampart's contract in `canRequestTakeover`'s doc comment
  requires.
- **`record_label`** is computed once, at creation, and stored — never
  re-derived on read, so a later rename doesn't retroactively change history.
  Lead reached via the duplicate-email door: `"A lead with <email>"` (never the
  position or company). Lead reached via direct sight (a manager asking for a
  report's own lead, D-0038's other door): full `"<position> — <company>"`.
  `job_order`: `"<job_title> — <company>"`. `client`: the company name. All
  capped at 300 chars to match the column's CHECK constraint.
- **`why` on a listed request is NOT re-derived from the live reporting
  chain** — that would drift from the actual, fixed `approver_id` the moment a
  manager changes teams. It is one plain sentence built from the request's own
  stored `current_owner_id`/`approver_id` and current names only ("X owned
  this when the request was made, so it went to Y."). The live `can-request`
  endpoint's `why`, by contrast, IS `approverFor()`'s real explanation, because
  nothing has been decided yet there.
- **Approval reassigns through the existing paths, never an ad-hoc write:**
  - `lead` → `jobs.assigned_to_bd`/`assigned_at` exactly as `PUT /jobs/:id`
    sets them, PLUS a picked sending mailbox (`pickMailboxFor`, mirroring
    `POST /distribute/execute`'s own account-picking: active, CONNECTED —
    working MS or Gmail refresh token — ranked by remaining daily capacity).
    **If the new owner has no connected mailbox, `sending_email_id` is set to
    `null`, not left on the old owner's** — continuing to send under a
    departed owner's identity would be worse than pausing until they connect
    one. Stage is left untouched. `logActivity('ownership_transfer', …)`
    records it on the lead's own activity log (read by
    `routes/record-history.js`), so no `record_history` row is written for
    `lead` — writing both would duplicate the same fact in one merged
    timeline.
  - `job_order` → `job_orders.bd_manager_id`, plus one `record_history` row
    (`services/record-history-writer.js`, entity `job_order` — this table has
    no activity log of its own).
  - `client` → moves the OLD owner's (`row.current_owner_id`) live job orders
    (`bd_manager_id`) and live leads (`assigned_to_bd`, excluding
    `stage='Unassigned'`) at that company to the requester, reassigning each
    lead through the SAME `reassignLead()` helper the plain lead approval
    uses (own mailbox pick, own activity-log row) — **other BDs' job
    orders/leads at the same company are left alone by construction** (the
    query only matches rows whose current owner equals the request's stored
    `current_owner_id`). One `record_history` row on the company itself names
    how many of each moved. The response's `moved` block reports exact counts
    plus per-lead `mailbox_assigned` booleans — surface can render "N job
    orders and N leads moved; M still need a mailbox connected".
  - **The queued-email claim is confirmed, not assumed**: `processPendingEmailSends`
    (index.js) resolves the sending mailbox per email at SEND time from
    `email.job.sending_email_id` (with a per-email override only for sequence
    "from" rotation) — so once a lead's `sending_email_id` is updated here,
    every still-pending queued email for that job goes out under the NEW
    owner's mailbox the next tick, with no send-loop change required.
- **Re-checked at approve time, before anything moves** (per the brief):
  the requester is still active, undeleted and in the org
  (`isActiveOrgUser`); the record's LIVE owner still matches the request's
  stored `current_owner_id` (`currentOwnerOf` re-loads the record and calls
  `own.recordOwnerId` fresh) — a mismatch refuses with a plain sentence rather
  than moving someone else's record out from under them.
- **The race guard is the conditional UPDATE**, not `canDecide` alone:
  `.update({status:'approved',...}).eq('id', id).eq('status', 'pending')` —
  `canDecide` (a synchronous, in-process check) can still let two concurrent
  approvers both pass before either write lands, so the DB-level "0 rows
  updated → 409 `already_decided`" is what actually stops a double
  reassignment. Verified in the scratch harness by firing two real approvals
  at once (`Promise.all`) on the same pending request — exactly one 200,
  the record moved exactly once.
- **A NOTED FINDING, not a bug fixed here:** no role that is ALLOWED to own a
  lead (`bd`/`bd_lead`) can normally SEE the Unassigned pool at all (D-0034:
  only `admin`/`ra_lead` see it), and `admin` is barred from requesting (rule
  3: an admin reassigns directly) while `ra_lead` is not an allowed owner
  role for `lead`. So **"ask to take over an unowned lead" is reachable today
  only through a side door** — a BD who is that lead's `assigned_to`
  researcher, or the duplicate-email door for a lead that happens to be
  unowned — never a plain ask from the pool. Not fixed here because it is not
  what D-0036/D-0037/D-0038 asked for; flagging it in case the owner wants a
  pool lead to be request-able directly.
- **No notification was added.** The brief allowed reusing the reminders
  pattern (`manager_prompt`) "only if it needs no other territory's code
  change" — but `reminder_type: 'manager_prompt'`'s fixed sentence
  ("Somebody you report to reviewed the open work on your desk...",
  `services/reminder-source.js`) is factually wrong for this case (the
  approver is often NOT the requester's manager — D-0037's whole point is
  it's the CURRENT OWNER's manager), and the row shape assumes a
  contact/job-based reminder. A correct sentence needs a new
  `reminder_type` entry in `services/reminder-source.js`, which the header of
  that very file lists as a shared vocabulary read by `public/js` — a
  surface-owned rendering assumption I did not touch. The approver instead
  relies on `waiting_count` on `GET /ownership-requests` (surface can badge
  it); the requester relies on polling their own `box=mine`.
- **`routes/companies.js` `clientOwnerId()`** now calls
  `own.clientOwnerFrom({ company, jobOrders, leads })` instead of hand-running
  its own newest-first tie-break — same three queries (now unfiltered/
  unlimited so the pure function can sort and pick), one ladder.
- **Scratch harness** (uncommitted, NOT under `test/`):
  `tmp_gateway_ownership_harness.mjs` at the repo root. Drives the REAL
  `routes/ownership-requests.js` + `services/ownership.js` +
  `models/index.js` db layer + `hierarchy.js`, against a hand-rolled
  in-memory postgrest-alike (select/eq/neq/is/in/order/limit/single/
  maybeSingle/insert/update/delete, with row PROJECTION to the route's own
  `.select(...)` string — same discipline as foundry's
  `email-history-scope-smoke.mjs`, so a select missing a column fails the
  test rather than passing by accident). **31/31 passing**, covering:
  same-team via the duplicate-email door, cross-team via the same door,
  the "no sight, no email" not_found case (identical sentence either side),
  unowned-record approver-is-asker's-manager, manager-requests-a-report's-lead
  self-approval-collapses-to-a-deterministic-admin, create → duplicate 409 →
  mine/waiting boxes → wrong-decider 403 → approve moves the lead + picks/
  clears the mailbox → re-decision refused → decline leaves the record → only
  the requester may cancel → **a genuine `Promise.all` race resolving to
  exactly one 200** → client take-over moving both a job order and a lead
  while leaving a different BD's lead at the same company untouched.
  **Foundry: this is the harness to turn into `test/ownership-requests-smoke.mjs`** —
  it needs the real `ownership_requests` table shape (migration 047) to stay
  a hand-rolled fake until that migration is live in a test DB, at which
  point the fixture/fake-db half can likely be deleted in favor of driving it
  for real, the way `org-scoping-routes-smoke.mjs` does elsewhere.

Verified: `node --check` on `routes/ownership-requests.js`,
`routes/companies.js`, `index.js` — clean. `route-shadowing-smoke` 9/9,
`recruiting-routes-mounted` 7/7, `backend-smoke` 107/107,
`org-scoping-routes-smoke` 13/13, `ownership-smoke` 69/69 (unchanged — pure
lib, not touched) all green. Scratch harness 31/31. Did not touch `test/`,
`public/js`, or any other territory's files. Not committed.

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

## 2026-09-24 (R-047 review, do-not-ship fix) — B1/B3 + the ownership-request rework (M1/M2/L1/L2/L4)

Rampart's review found `POST /emails/reminder-send` and `POST /emails/generate`
took a body `job_id`/`job_ids` with **no org or owner check at all** — a
foreign company's lead could be named, queued a send off that lead's own
mailbox, and (reminder-send) put the caller's own name on the `sent_by`.
Rampart's cheapest mitigation for the trigger (guild dropping `lead_id` from
duplicate responses) didn't remove the underlying holes, so both got fixed
directly, plus everything the take-over-request review found in gateway's file.

- **B1 `POST /emails/reminder-send` (index.js)** — gated with `canTouchJob`
  (org-bound already; admits creator/researcher/BD owner) before touching
  anything; a `contact_id` is now checked to actually belong to `job_id`
  (org-scoped) before its fields feed the merge pass; every read/write on this
  path switched from raw `supabase` to `db.forRequest(req)`; the insert now
  carries `orgStamp(req)` (belt-and-braces — `emails` auto-stamps via
  `db.forRequest` already, but the row is stamped explicitly too since this
  was the exact defect named).
- **B3 `POST /emails/generate` (index.js)** — the job read is now
  `db.forRequest(req)` (org-scoped), then narrowed AGAIN per id through
  `canTouchJob` — same shape as the C-0021 bulk-stage fix: a foreign or
  untouchable id is silently dropped from the batch rather than erroring.
  `job_ids` is recomputed from the surviving rows before anything downstream
  reads it. The final insert also moved to `db.forRequest(req)` so it stamps
  `org_id` instead of misfiling to the default org.
- **Option (a), `routes/ownership-requests.js`** — a lead-kind ask may now
  come in as `{kind:'lead', via_email}` with **no `record_id` at all**.
  `resolveLeadByEmail()` is the new function: org-scoped, case-insensitive
  match against `contacts.email`, restricted to a live lead not already owned
  by the caller; several matches → the most recently ASSIGNED wins (falls back
  to `created_at`, then id, for determinism) — this resolution itself IS the
  `viaDuplicateEmailMatch` proof (D-0038), never a value trusted from the
  body. Wired into both `POST /ownership-requests` (create) and the new
  can-request endpoint below.
  **`GET /ownership-requests/can-request` is RETIRED.** Replaced by
  **`POST /ownership-requests/can-request`** taking `{kind, record_id?,
  via_email?}` in the body — L3 said a prospect's email must never sit in a
  URL, and keeping a GET that only handled the `record_id`-only case while a
  POST handled the rest would have meant enforcing that law in exactly one of
  two doors. One endpoint, one law. **Surface must switch its can-request
  caller from GET+query-string to POST+body**; the response shape is
  unchanged (`{ok, reason, approver, why}`).
- **M1** — every reassignment write on approve is now CONDITIONAL on the
  record still being owned by `row.current_owner_id` at write time (not just
  at the earlier `currentOwnerOf` re-check, which is itself a TOCTOU window):
  `reassignLead()` guards on `.eq('assigned_to_bd', oldOwnerId)` /
  `.is('assigned_to_bd', null)` and returns `moved:false` on a miss instead of
  writing regardless; the job_order write and each client-transfer's per-row
  writes carry the matching `.eq(ownerCol, oldOwner)` guard + `.select('id')`
  so the row count is checked, never assumed. A lead/job_order approval that
  loses this race calls `revertApproval()` — flips the request back to
  `pending` and answers 409 `owner_changed` — rather than ever reporting
  "approved" over a write that touched nothing.
- **M2** — a client whose ownership only ever traced to `companies.created_by`
  (no live job order or lead owned by `oldOwner`) used to approve with an
  empty `moved` block: nothing moved, nothing said so. The route now performs
  the SAME rung the ladder itself reads: it moves `created_by` to the
  requester (conditional on `created_by` still matching `oldOwner`), and
  reports `moved.client.created_by_transferred: true`. If that write ALSO
  finds nothing to move (ownership drifted elsewhere entirely, or lost its own
  race), the whole approval reverts via the same `revertApproval()` path —
  never a silent no-op success.
- **L1** — approve now re-loads the requester's own row
  (`liveRequester()`, `db.forRequest`) and refuses (`role_changed`) if their
  CURRENT role is no longer one of `own.TAKEOVER_OWNER_ROLES[kind]` — a role
  change between asking and deciding is the same staleness class as an owner
  change, and `canRequestTakeover` already enforces this rule at ask time; it
  just wasn't re-checked at decide time. Also re-checks the record itself is
  still live (`!liveRow.deleted_at`) via the module's existing `recordRow()`
  helper — a soft-deleted lead/job-order/client now 404s at approve exactly as
  it would at ask time.
- **L2** — `orgUsers` and the old `isActiveOrgUser` (renamed `liveRequester`,
  now also carries role/roles for L1) both switched from a hand-scoped raw
  `supabase.from('users')` to `db.forRequest(req)`. `orgUsers`'s signature
  changed from `orgUsers(orgId)` to `orgUsers(req)` — all six call sites in
  the file updated together; no external caller of this internal function
  exists.
- **L4, `routes/companies.js` `clientOwnerId()`** — the job-orders/leads
  queries feeding `clientOwnerFrom` now filter `deleted_at is null` + the
  owner column not null, order by `created_at desc`, and `limit(1)` — the pure
  function only ever reads the newest live owned row off each list, so
  fetching and sorting the whole table client-side was pure waste. Same
  ladder, same answer, one row instead of N.
- **Not touched (rampart's file):** `services/ownership.js` — none of the
  above re-derives `canRequestTakeover`/`approverFor`/`canDecide`/
  `clientOwnerFrom`; L1's role/live re-checks call the SAME constants/rule
  those already enforce at ask time, they don't duplicate them.

**`test/ownership-requests-smoke.mjs` (foundry's, not touched) WILL fail as
committed** — it calls `GET /ownership-requests/can-request?...` in nine
places, and that route no longer exists (an unmatched Express route answers
its default HTML 404 page, which crashes the harness's `JSON.parse` rather
than reporting a clean failure). I verified the fix is otherwise sound by
copying the file to a scratch location, mechanically rewriting every
`GET .../can-request?a=b&c=d` call to `POST .../can-request` with
`{a:'b',c:'d'}` as the body, and running it: **35/36 passed** against the
real router. The one failure is a pre-existing "MUTATION: remove the
DB-level status guard" test (line ~421) whose OWN comment says it proves that
without `ownership_requests`'s `.eq('status','pending')` guard, two
concurrent approvals both return 200 — it isolates that one guard by
building a fixture with no other protection. **M1's new job/job_order-row
conditional guard now ALSO stops the double-move even with the status guard
disabled**, so the second approval now correctly answers 409 instead of the
200 the test expects — this is the fix working as more defense-in-depth than
that one test isolated, not a regression. That specific assertion needs
updating to check "not both 200" rather than "both 200", or to disable the
row-level guard too if it wants to keep isolating the status guard alone.
Everything else in the file — the D-0038 email-match cases, mine/waiting/
record boxes, approve/decline/cancel, the real (non-mutated) race test, and
the client-transfer case — passed unchanged against the real router with only
the GET→POST call-site rewrite. Scratch copy was deleted, not committed.

Verified: `node --check` on `index.js`, `routes/ownership-requests.js`,
`routes/companies.js` — all clean. `route-shadowing-smoke` 9/9,
`recruiting-routes-mounted` 7/7, `backend-smoke` 107/107,
`org-scoping-routes-smoke` 13/13, `takeover-rule-smoke` 86/86 (pure lib,
untouched), `reminder-lead-visibility-smoke` 15/15 (ledger's file, unaffected)
— all green. Did not touch `test/`, `public/js`, or any other territory's
files. Not committed.



## R-047 re-review round 2 fixes (2026-09-24) — `routes/ownership-requests.js`, `index.js`

- **R47-1 (blocker) CLOSED — `record_id` no longer reaches a viewer who
  cannot `canSeeLead` the lead.** `shapeRequest()` in
  `routes/ownership-requests.js` takes a new `hiddenLeadIds` Set and nulls
  `record_id` for any `record_kind:'lead'` row whose id is in it —
  `withheldLeadIds(req, rows, scope)` computes that set FRESH per response
  (one batched query for every distinct lead id on the page, never per-row),
  because ownership — and therefore visibility — can move between the ask and
  any later read. Wired into every response that shapes a request: the POST
  201, `GET /ownership-requests` (`mine`/`waiting`/`record` all share one
  `scope`, computed once per request via the reporting chain the same way
  `/follow-ups` already does it), and approve/decline/cancel. The approver or
  an admin who can already see the lead is unaffected; only the asker who
  reached it through the `via_email` door (D-0038) — who was never supposed
  to learn the lead's id, only whose it is — loses it, including from their
  own `box=mine` list, which was the actual leak (the duplicate-response
  fields were already scrubbed in the prior round; the request's own stored
  `record_id` was the door still open). `computeScope(req)` is a small shared
  helper for the decision routes; `GET /ownership-requests` computes its own
  scope inline since it was already fetching `orgUsers`/`isAdmin` there and
  reuses it for both the `box=record` visibility check and the withholding.
- **R47-2 CLOSED (reminder-send) / documented-as-intentional (generate).**
  `POST /emails/reminder-send` (`index.js`) no longer gates on `canTouchJob` —
  that helper admits the job's creator and researcher as well as its BD
  owner, which is right for TOUCHING a record but wrong for ACTING as its
  owner (D-0020): this route queues a send from `job.sending_email_id` under
  `sent_by = req.user.id`, i.e. it sends AS the owner, so an RA who merely
  researched the lead could queue a message that goes out under the BD
  owner's mailbox and identity. It now fetches just `assigned_to_bd`,
  computes the caller's D-0034 scope (admin → org; else reporting chain via
  `reportingChainIds`), and requires `ownership.inScope(job.assigned_to_bd,
  scope)` — owner or their managers, same shared definition `/follow-ups`
  already uses. A job with no resolvable owner in scope 404s exactly as an
  unowned job_id would have. **`POST /emails/generate` was checked and left
  on `canTouchJob` deliberately** — it is a documented exception, not an
  oversight: it generates INITIAL outreach, which legitimately runs for a
  pool lead (no owner yet) or a lead an RA/ra_lead researched before
  distribution assigned it. Comment added in place explaining why the two
  routes take different gates for the same helper.
- **R47-3 CLOSED — `resolveLeadByEmail`'s ILIKE is now literal, and both
  reads are bounded.** The typed email is escaped (`\`, `%`, `_` →
  backslash-escaped) before the `ilike`, so a `%` or `_` in a pasted address
  matches itself rather than acting as a wildcard — Postgres/PostgREST's
  default LIKE/ILIKE escape character is backslash, so this is an exact
  transform, not a heuristic. Harmless today because the exact-match filter
  after the query already discards a wildcard's false positives, but it stops
  that filter being the ONLY thing standing between a crafted address and a
  much wider candidate set. Both the `contacts` and the `jobs` fetch in that
  function now carry `.limit(500)`.
- **R47-4 CLOSED — an unowned client can now actually be approved, and the
  prior owner is recorded by value.** The `created_by` transfer rung
  required `record.company.created_by && record.company.created_by ===
  oldOwner` — a truthy check that can never be satisfied when a client is
  genuinely unowned (`created_by` null, no live job order or lead ever owned
  it), so `oldOwner` is also null and every such approval fell through to
  `revertApproval`, forever. The condition is now `priorCreatedBy ===
  (oldOwner || null)` (null-to-null included), and the write switches between
  `.eq('created_by', priorCreatedBy)` and `.is('created_by', null)` because
  PostgREST does not treat `eq.null` as `IS NULL`. The conditional write
  itself is unchanged — still guarded by the live value at write time, still
  reverts if the race is lost. A second, explicit `history.record()` call
  (`field: 'created_by'`, `from: priorCreatedBy`) fires only when the
  transfer actually happened, so the original creator's id survives in the
  record's own history rather than being inferable only from `oldOwner`
  matching by coincidence.
- **Not touched (rampart's file):** `services/ownership.js` — `canSeeLead`,
  `viewScope`, `inScope` are called, not re-derived.
- **Not touched:** `test/` (foundry is concurrently editing
  `test/ownership-requests-smoke.mjs`). **Caution for the next reader:** a
  concurrent process reset `routes/ownership-requests.js` to its pre-edit
  `HEAD` content mid-session (twice observed — once bringing back a stray
  `// MUTATION: transfer removed` placeholder, consistent with a mutation-
  testing harness's mutate/run/restore cycle racing this edit). If this file
  looks like it lost changes, diff it against this section before assuming
  the fix was never applied — re-apply rather than build on top blind.

Verified: `node --check` on `index.js` and `routes/ownership-requests.js` —
clean. `route-shadowing-smoke` 9/9, `recruiting-routes-mounted` 7/7,
`backend-smoke` 107/107, `org-scoping-routes-smoke` 13/13,
`test/ownership-requests-smoke.mjs` (foundry's, read-only — not edited)
48/48 green against these changes. Not committed.
