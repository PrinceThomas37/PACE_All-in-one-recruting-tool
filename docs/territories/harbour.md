# Harbour — memory
> Last written: 2026-09-23 · C-0023 + C-0015 (D-0034 visibility, org boundary)

## What is true here now
- **WHO SEES WHICH EMAIL IS `services/ownership.js`, NOT THIS TERRITORY (D-0034).**
  Harbour's routers call it; they never re-derive it. Pattern in every router:
  `viewScopeFor(req)` → `own.viewScope({role, roles, userId, chainIds})` with
  the chain from `hierarchy.js` `reportingChainIds` (admin: no chain, whole org).
  * **`GET /emails`** = what the viewer's people SENT (`sent_by` in
    `queryOwnerIds(scope)`, narrowed IN SQL before `.range()`) **plus** what
    anybody sent about a lead the viewer's people OWN now (`jobs.assigned_to_bd`
    in scope — a recycled lead's history follows the lead; fetched ids-first so
    no body is fetched twice), then `own.scopeEmails` as the final gate.
    Admin: the whole org. **RA Lead: effectively `[]`** — no BD's messages (D4).
    Every row gains **`is_mine`**; **`can_retry` is now false on a row the
    caller did not send** (unless admin), because `POST /emails/:id/retry`
    answers 404 to a non-sender — a Retry button on a report's row would lie.
    **`?mine=1`** narrows to the caller's own queue — what Send all / Retry act on.
    Response is still a plain array; `retry_note`, `ai_written`, `ai_will_write`,
    `sending_email` and the rendered subject/body are unchanged.
  * **`GET /emails/sender-summary`** (new) → `{ scope, senders:[{id,name,
    pending,sent,failed}] }`. admin/ra_lead: every sender in the ORG (scope
    `'org'`) — an RA Lead runs send operations for every BD, so they get the
    numbers; everyone else: their own view (`'own'`/`'team'`). Numbers only —
    no subject, body or address. This replaced the RA Lead picker's old data
    source (every BD's full rows).
  * `pending-summary` is unchanged in meaning (own queue; admin/ra_lead may
    name `manager_id`), now org-bound and ORDERED for pagination.
- **EVERY TENANT READ AND WRITE IN MY ROUTERS GOES THROUGH `db.forRequest(req)`**
  (org condition on reads, on the UPDATE/DELETE itself, `org_id` stamped on
  inserts). `routes/warmup.js` is mounted by index.js with a small ctx that
  has no `db`, so it builds `createDb(supabase)` itself; `emails.js` and
  `deliverability.js` fall back the same way for test harnesses.
  * `DELETE /suppression/:id` is ONE conditional statement (`delete().eq(id)`
    on the org-scoped accessor + `.select('id')`); nothing removed → 404,
    never a false `success`.
  * `DELETE /emails/:id`: other org → 404; same org but not yours → 403 with a
    sentence if you can SEE it, 404 if you cannot; the delete carries
    `.in('status',['pending','failed'])` so a row the send loop just claimed
    is not deleted out from under it (→ 409).
  * `purge-pending`: org-bound fetch AND delete, `.eq('status','pending')` on
    the delete, `deleted` = rows the DB actually removed, a foreign
    `manager_id` → 404, senders taken from the matched rows.
  * `POST /emails` (manual mark-sent, no screen calls it): job must pass
    `canTouchJob`, contact must be in the org, insert stamped.
  * `/analytics/templates`: counts are the org's (paginated — it used to stop
    at 1,000 rows, and its `.in()` of every contact id silently failed and
    reported 0 replies); the SAMPLE is only from mail the viewer may see
    (RA Lead → `sample: null`), and now selects `from_email` so `{{sender}}`
    renders a name instead of blanking.
  * `/admin/deliverability`: exact head counts (was capped at 1,000 rows),
    all org-bound. `/admin/domain-health`: this org's domains only.
- **WARM-UP IS ONE ORGANISATION AT A TIME.** `warmup-engine.js` `sendWave`
  pairs a mailbox only with partners of the same `org_id` — before this, a
  warming mailbox at company A sent real mail into company B's opted-in
  mailbox (measured: 11 of 11 sends crossed orgs in a 3-org scratch tick).
  Threads, messages and the send log are stamped with the sender's org.
  `/warmup/:id/*` look the mailbox up org-scoped (404 otherwise);
  `/warmup/mailboxes` shows a non-admin lead their chain's mailboxes, while
  the pool readiness figures stay org-wide (they describe the engine's pool).
  `/warmup/:id/threads` withholds a partner address from another org
  (historic threads).
- Two send engines: the **leads** loop (`emails` table, one per 75-105s inside an
  8-hour window in each *lead's* timezone) and **candidate outreach**
  (`candidate_outreach` table, its own queue, weekday evenings + weekends in the
  *candidate's* timezone, max 6/tick with a 75-105s pause between real sends).
- `candidate_outreach` is a separate queue **deliberately** — `emails` is welded
  to the leads engine and its send loop is the most load-bearing code in the app.
- `services/mail-provider.js` is one adapter over Graph AND Gmail;
  `forMailbox(row)` dispatches on `platform`.
- The in-app mailbox is two panes with a threaded reader. **Nothing is mirrored
  into Postgres.** No permanent-delete call is reachable from this app.
- Reply detection covers Gmail *and* Outlook through **one** shared
  `processInboundMessages`. Do not add a second sweep.
- All six send paths now store the sent text (migration `042_email_tracking_body`).
- Candidate send hours live in `app_settings` and are edited through
  `config/settings.js`'s schema (Admin → System Settings), never queried directly.

- **FAILED SENDS RETRY THEMSELVES (Session 29, D-0031).** `services/send-retry.js`
  (pure) sorts every failure — temporary / permanent / needs_fix / uncertain —
  and `recordSendFailure()` in index.js is the ONLY writer of a failure: a
  temporary one goes back to `pending` with `next_attempt_at` (15m, 1h, 4h; first
  send + 3 retries), everything else to `failed` with `fail_reason`. The pending
  fetch drops rows not yet due via `isDue`, **in Node, not a PostgREST `.or()`**.
  A sign-in failure also puts the mailbox in `authFailedMailboxes` so the rest of
  that run leaves its emails pending instead of failing them ~90s apart.
  **An UNCERTAIN failure (timeout mid-send) is never auto-retried** — the
  provider may have accepted it. Manual retry: `POST /emails/:id/retry`,
  `POST /emails/retry-failed`; refused for `permanent`, and refused when the
  same contact/job/step already has a live twin (`hasLiveTwin`).

## Fragile — touch with care
- **Every reader of `emails.body` must call `renderStoredEmail(row, mailbox)`.**
  `test/sender-identity-smoke.mjs` greps for readers and fails on one that does
  not. This shipped a wrong human name to 152 real recipients once.
- **`releaseToPoolUpdate()` is the only way to return a lead to the pool.** Two
  silent failures came out of three paths disagreeing.
- **Never remove the `ORDER BY` from the pending fetch** — `.range()` repeats or
  skips rows without one.
- Gmail headers are RFC 2047-encoded, split on **character** boundaries.
- **Keep the `GET /emails` select literal: `db.forRequest(req).from('emails').select(\`*…`**
  inside `emailRows()`, and keep `renderStoredEmail(e, mailbox)` +
  `pinnedById[e.sending_email_id]) || e.job?.sending_email` verbatim —
  `test/sender-identity-smoke.mjs` greps for exactly those shapes.
- **`test/org-scoping-guard-smoke.mjs` splits handlers on COLUMN-0 `router.`**,
  so a handler whose only guard lives in a helper (`emailRows`, `viewScopeFor`)
  reads as unguarded. That is why the pinned-mailbox lookup in `GET /emails`
  uses `db.forRequest(req)` explicitly. `routes/warmup.js` indents its
  handlers, so that guard has never scanned it at all.
- **A mutant that CRASHES is not a mutant that was CAUGHT.** First mutation run
  here reported 16/16 caught — every copy had failed to `require('express')`.
  Count a crash as a miss.

## Open here
- **Surface must adapt the Email page (C-0026 #2 + this change):** the RA Lead
  picker must read `GET /emails/sender-summary` (today it groups `GET /emails`,
  which now returns nothing of BDs'), and the drill-down loses message rows.
  For a bd_lead, `GET /emails?status=pending` now includes the chain's rows, so
  "Send all pending (N)" and the Didn't-send panel should count/act on
  `is_mine` rows (or call with `&mine=1`). Until surface lands it, the RA Lead
  picker shows zeros and a bd_lead's Send-all count is inflated (sending itself
  is safe — every send route is `sent_by = me`).
- **`addToSuppression` (index.js, gateway's) stamps no `org_id`** and
  `loadSuppressedSet` checks deployment-wide. Every opt-out is filed under the
  DEFAULT org, so a second org cannot see its own opt-outs (safe direction),
  and the default org's admin could remove one another org recorded. Needs
  gateway (stamp) + ledger (is an opt-out per-org or per-deployment?).
  **Stamp half CLOSED (rampart review):** `POST /suppression` now passes
  `orgOf(req)` as `addToSuppression`'s 6th arg (routes/deliverability.js:72); the
  per-org vs deployment-wide CHECK question stays ledger's.
- `/warmup/tick` and `connectedSet` (Microsoft only — Gmail mailboxes read as
  "not connected" in readiness) are unchanged; the tick is a deployment
  control (C-0021 X9).
- **MOSTLY FIXED 2026-09-23 (D-0031), text below kept for history.** Release
  to pending, stop the mailbox on the first auth failure and the error column
  are all shipped. What remains is the Google "Testing" 7-day expiry itself —
  a truly dead sign-in now gives up after the 4-hour retry instead of instantly.
- **(was) KNOWN, UNFIXED: a dead mailbox sign-in destroys emails.** An auth failure
  marks each email `failed` with no retry, ~one every 90s, and there is no column
  to record why. Root cause is Google-side — the consent screen is in "Testing",
  where refresh tokens expire after 7 days. **The owner parked this on
  2026-09-01: "We will work on this but not now."** Raise only on a fresh
  incident. Three code defects worth fixing regardless: release to `pending` not
  `failed`; stop a mailbox on the FIRST auth failure; add the error column.
- A live lookup against the mailbox's Sent folder would recover the 19 client
  emails whose text predates 042. Not started; the owner has not asked.
- Outbound templates and the resume letterhead still say "Fute Global" — that is
  the **customer's** identity and must become per-org config, not a rename.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.

- **2026-09-23 (Session 29)** — failed-email retry shipped (D-0031, R-036). Live
  incident: Daniel James 2 × "sign-in expired" while 3 sent fine. Today's 4
  failures re-queued by SQL at the owner's request (attempt_count=1).

- **2026-09-23 (Session 29)** — first emails can now be AI-written at send time
  (D-0032/D-0033). `template_variant = 'ai'` marks them, so the Deliverability
  variant comparison shows AI vs templates side by side for free.

- **2026-09-23 (Session 30)** — C-0023 + C-0015 answered (D-0034 + org
  boundary on emails/deliverability/warmup, cross-org warm-up pairing closed).
  Verified by a scratch harness (real routers + real `models/` over an
  in-memory 2-org DB, 50 assertions) with 17 reintroduced bugs, 16 caught; the
  one miss is removing only the final `scopeEmails` gate while the SQL
  narrowing stays — defence in depth, and removing both IS caught. Engine
  check 6/6, and the pre-fix engine fails it. Harness is scratch, not committed
  — foundry to pin (C-0027 family).



- 2026-09-25 (D-0046): **at most N first emails to one company per day** — `services/company-daily-cap.js` (owned here). Setting `company_daily_first_emails` (default 2, 0 = off). First emails only; per company across all its leads and all senders; the day is `emails.sent_at` (UTC date, the same stamp the send path writes). A held email is NOT claimed or failed — it stays pending and goes the next day; progress reads "2 people at this company already emailed today — goes tomorrow". Loader failure → cap off (never stops sending). Known gap: the Pending summary still counts a held email as "ready now" until it is tried.
