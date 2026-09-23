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
