# Harbour — memory
> Last written: 2026-09-30 (Session 35, R-087 one From rule; R-086 interview confirmation) · earlier: 2026-09-28 (Session 33, R-069)

## Session 35 (2026-09-30) — ONE "which of my mailboxes sends" rule (R-087) and the interview confirmation (R-086)
Written by the orchestrator (the owner ruled out helper agents, D-0060); the files are `routes/recruiting/outreach.js`, `routes/candidate-outreach.js`, `routes/outreach-generator.js`, `index.js` ctx.
- **`ownSendingMailboxes(req)` / `sendingMailboxFor(req, id)` live in `routes/recruiting/outreach.js` and are handed to candidate outreach and the generator through `index.js`.** The page NAMES a mailbox id; the server checks it is one of the caller's OWN connected, active mailboxes (else 404 — indistinguishable from nonexistent) — never a free From address. No id = the primary, as before. `POST /companies/:id/email`, `POST /candidates/email`, `POST /submissions/:id/interview-invite` and the generator's `/outreach/{sender,generate,generate-angle,send}` all take `mailbox_id`. `GET /me/sending-mailboxes` is the picker's list. candidate-outreach's private copy was deleted — two copies of an identity rule is how they drift. The generator's old header comment ("sending address is NOT a user choice") was rewritten to the checked-id rule.
- **The interview invite called `sendMicrosoftNewMessage` directly**, so a Gmail mailbox failed every time — one of the reasons no confirmation reached candidates. It now dispatches by platform (`sendMailboxNewMessage`). The candidate's copy carries the role (place, job type, work setting, a 600-char description — no pay figure, no invented fields); the BD manager's does not. The stage window ticks "Candidate" by default (a phone interview is confirmed too; untick to skip).
- Pinned: `test/from-mailbox-smoke.mjs` (17, router mounted against a fake db and spy senders; fails with three deliberate breaks) and `test/from-picker-smoke.mjs` (12, browser).
- **Known limits:** the reminder compose has its own From field (`composeFromEmailId`) and was not moved onto this rule; the leads engine's automatic sends use the lead's assigned mailbox by design.

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

- **A GMAIL FOLLOW-UP WHOSE THREAD IS IN ANOTHER MAILBOX GOES OUT FRESH
  (2026-09-28, R-069).** `services/gmail-delivery.js` (owned here) is how an
  email leaves a Gmail mailbox; index.js `deliverViaGmail` only delegates. A
  follow-up replies into the lead's earlier thread (`emails.conversation_id`),
  and a Gmail thread id belongs to ONE mailbox — so once a lead's sending
  mailbox is switched after its first email, Gmail answers 404 "Requested
  entity was not found." to every try, and `classifyFailure` (not knowing the
  words) called it TEMPORARY: four tries, give up, Retry restarts the same
  four. Live: 14 first follow-ups (Daniel James's threads, Spencer Brown's
  mailbox). Now a DEFINITE not-found (`isGmailNotFound`: `err.status === 404`
  or Google's words) sends a fresh email with the earlier one quoted and "Re:"
  stripped — exactly what the Outlook path always did. **A timeout or any other
  error is rethrown, never followed by a fresh copy**: it may mean the reply
  WAS sent. `freshFollowup()` builds the fresh email for BOTH providers
  (index.js `sendFollowupFreshWithQuote` uses it), so they cannot drift. A
  follow-up with NO earlier thread also goes fresh-with-quote now (it used to
  go as a bare "Re:" with nothing quoted — the fake-threaded shape the Outlook
  comment already called wrong). `gmail-provider.js` `api()` errors now carry
  `.status`. Whether a follow-up should instead come from the mailbox that
  STARTED the conversation is R-070, the owner's call.
  **Open edge, measured not guessed:** a lead that moved from an OUTLOOK
  mailbox to a Gmail one would hand Gmail a Graph conversationId as the
  thread; Google may answer that with a 400 "invalid id" rather than a 404,
  which this fallback does not catch. Live on 2026-09-28: 0 of 411 stored
  thread ids are Outlook-style and every lead mailbox is Gmail, so it cannot
  happen today — fix it with the real error in hand, not a guessed regex.
- **A SEND CUT OFF MID-FLIGHT IS SHOWN, NOT LOST (2026-09-28).** The loop
  claims a row (pending → 'sending') before handing it over and writes the
  answer after; a process that dies in between (deploy, restart, sleep) left it
  at 'sending' — on no screen, never picked up. `services/interrupted-sends.js`
  (owned here) runs once at boot: each 'sending' row → `sendRetry.interruptedUpdate`
  (failed / UNCERTAIN / "may or may not have gone out"), written ONLY if the
  row is still 'sending', so an overlapping old process's own 'sent' lands and
  stands. Never retried by itself; a person may Retry after checking Sent.
- **THE PENDING SUMMARY IS FOUR BUCKETS, IN THE SEND LOOP'S ORDER (2026-09-28).**
  `GET /emails/pending-summary`: not due (`sendRetry.isDue`) → `waiting_retry`;
  first email at a company already at today's limit (`companyDailyCap.capCheck`
  over `loadSentToday(db.forRequest(req), …)` — org-scoped, a test proves
  another org's sends never hold ours) → `held_company` + `held_ids`; then the
  window → `ready_now` / `waiting_window`. `held_ids` only for admin or the
  caller's own queue — an RA Lead gets counts (D4). Also `company_daily_cap`.
  "Held" means the company is ALREADY full today; a company with room left is
  not marked held even if it has more waiting than the room (never mislabels a
  sendable email). Closes the D-0046 known gap ("counts a held email as ready
  now"). A bd_lead's teammate rows are not in their summary, so those rows
  keep the old window chip.

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

- 2026-09-26 (R-037, D-0047): **a dead mailbox sign-in is now visible.** `gmail-provider.getToken` records every refresh attempt via `mailbox-health.recordRefreshOutcome` (it never did — only Microsoft did), except network failures and Google's own `temporarily_unavailable`/`server_error`, which say nothing about the credential. `deriveTokenStatus` gained `certain` (a RECORDED failure vs the stale-expiry guess) and `last_ok_at` (= `updated_at`, written only on success — never show the last failed attempt as "last worked"). `services/mailbox-alerts.js` (PURE, owned here) decides which mailboxes warrant a warning and translates the provider's words (AADSTS65001 → "Microsoft withdrew PACE's permission…"; Gmail `invalid_grant` → the 7-day testing expiry). Live on 2026-09-26: kristy.scott@fute-global.com dead since 21 Jul (consent withdrawn), princethomasfute@gmail.com not refreshed since 24 Sep. Reconnecting deletes + re-inserts the token row, so the flag clears itself.

- 2026-09-28 (R-069, owner: *"Check why some emails are in pending and a couple of them are not getting send after retry"*): read off the live queue — 22 rows. **14** fu1 from spencer.brown@ (Gmail) into threads that live in daniel.james@'s mailbox (same BD user; the leads' mailbox was switched after the 23 Sep first emails) → Gmail 404 forever (5 failed "gave up", 9 pending on their 3rd retry). **1** fu1 stuck at 'sending' since 26 Sep (its own thread; process died mid-send; whether it went is unknowable here). **7** first emails correctly held by D-0046 (each company already had 2 today). Fixed as above (PR #260, not live). Nothing was re-queued by SQL.

- 2026-10-01 (R-080, D-0066): contacts marked Out of office go back to Valid on their return date (daily-ish sweep `ooo_return`, `services/ooo-return.js`), so follow-ups resume; skipped sequence steps are not sent late. R-095: the interview invite email now names the time zone (`services/interview-time.js`).

- 2026-10-01 (R-092): a third kind of one-off candidate mail — the submission email (`email_tracking.channel = 'submission'`), sent from `routes/recruiting/outreach.js`; `sendMailboxNewMessage` now forwards `cc`. It does not touch `emails` or `candidate_outreach` (the three pipelines stay three).

- 2026-10-01 (R-070, D-0067): follow-ups (fu1/fu2) leave from the mailbox that sent the FIRST email to that contact (`services/followup-sender.js`, wired in the send loop in `index.js` as a per-email override beside the rotation override), only while that mailbox is active and connected; else the lead's current one. Never overrides an explicit rotation choice; first emails and reminders untouched. Sender identity, signature and quota follow the pinned mailbox (resolved at send time as always).

- 2026-10-02 (R-110, D-0068): `services/open-tracking.js` — a pixel hit is sorted into sender (network seen on the sender's recent signed-in requests, salted hash in `app_settings` `u_<id>_seen_ips`) / machine (empty or bot-like user agent; Google's image proxy is NOT a machine) / early (<2 min after send) / recipient; only recipient moves `open_count/opened_at/last_open_at`, the rest bump `ignored_open_count` + `last_ignored_reason`. `prepareLeadTracking` gives a leads email a token+`email_tracking` row (one per `emails.id`, reused on a retry; no row = no pixel) only for senders in `app_settings` `open_tracking_users` (`all` | JSON ids | absent = nobody). The pixel is injected in `deliverOutboundEmail` into the SENT html only — the stored body never carries it, so previews and quoted follow-ups never load it. `PENDING_EMAIL_JOB_SELECT` now includes `sent_by`. Migration 055 (email_id, contact_id, ignored_open_count, last_ignored_reason).

- 2026-10-05 (R-111): Gmail HTML-escapes `snippet` ("what&#39;s", "&lt;a@b&gt;"); PACE used it raw and the screen escaped again. `services/html-entities.js` (`decodeEntities`, `&amp;` decoded LAST so `&amp;lt;` is not turned into a tag) is the ONE decoder: used in `services/mail-provider.js` `normalizeGmailMessage` (`preview`), `gmail-provider.js` `normalizeMessage` (`bodyPreview` — which the reply sweep stores as `contacts.reply_snippet` and feeds `isOptOutReply`, so "don&#39;t email me" now matches opt-out wording), and on read in `routes/next-actions.js` (older stored `reply_snippet` rows keep their codes in the DB; nothing is migrated). `services/candidate-outreach.js` lost its private copy and imports it. Microsoft's `bodyPreview` is plain text and is NOT decoded. `test/gmail-preview-entities-smoke.mjs` (12; 2 steps fail on the old code). Also claimed in `scripts/territory-map.mjs` for harbour: `followup-sender`, `open-tracking`, `ooo-return`, `submission-email`, `html-entities` (they had been unclaimed).

- 2026-10-05 (R-114, D-0070): EVERY candidate send checks ALL of a person's addresses against `suppression_list`, not just the main (`contactPoints.firstSuppressed`): the batch queue (`routes/candidate-outreach.js` — selects `extra_emails`), the drip (loads the candidate of each due row, so a row queued to the main is skipped if they have since opted out on another address), the workflow "Email the candidate" step (`routes/recruiting/outreach.js`, `candidates(*)` already carries the extras) and the one-off `POST /candidates/email` (recipients carrying a `candidate_id`). Every email still goes to the MAIN address only. `test/candidate-outreach-optout-smoke.mjs` (12) mounts the real queue, drain and one-off routes; each of the three rules fails when broken. Not covered by a mounted test: the workflow step (same helper).

- 2026-10-05 (R-114 stage 2): the LEADS engine now honours the person-level opt-out too — `processPendingEmailSends` loads each pending email's contact with `extra_emails` and skips (`recordSendFailure 'suppression'`) when the address on the email OR any other address of that contact is on `suppression_list`; the sequence step (`index.js` ~3654) does the same. Emails still go to the MAIN (`contacts.email`) only. A reply from an EXTRA address is still not matched to the contact (D-0070 re-open condition).

## 2026-10-06 (Session 40) — mailbox warning: hide + remind (R-124)
`services/mailbox-alerts.js` gained pure rules: `recordHide/isHidden/applyHidden/pruneHidden` (a hide is for 7 days AND against the alert's fingerprint `state|since` — a new failure returns at once; per person; counted) and `askRefusal` (chain-or-admin only, never yourself, never an unowned mailbox). The reminder written by "ask" is `contact_name 'Reconnect your mailbox'`, `company_name <the mailbox email>`, `reminder_type 'manager_prompt'`; the same triple is how "already asked" is found. Only the owner can complete the provider's consent screen, so a manager PROMPTS (D-0020).

- 2026-10-06 (R-127): `services/mail-provider.js` — adapters gain `listLabels/createLabel/setLabels` (Gmail labels; Outlook categories by NAME — the master list needs `MailboxSettings`, not granted, so an unreadable list is "no list", R-130); messages carry `label_ids` (Gmail: only `Label_…`). `gmail-provider.js` — `createLabel`. Nothing destroys mail: bulk delete is the same move-to-Trash.

## 2026-10-06 (Session 40, round 4) — Outlook label colours (R-136)
- `config/env.js`: `MICROSOFT_SCOPES` = base + `MailboxSettings.ReadWrite` (asked ONCE, when a mailbox is connected). `MICROSOFT_EXTRA_SCOPES` overrides it; set it EMPTY to switch the extra permission off (a tenant that refuses it can still connect; labels just have no colour). **If an Outlook connect ever fails right after this deploy, that permission is the first suspect — and whether the Azure app registration must list it first is NOT verified from here.**
- `services/microsoft-oauth.js` (new, pure): `refreshParams()` — a token refresh sends NO scope. It used to send the shared list, so adding a permission would have taken every already-connected mailbox offline at its next refresh. `index.js` calls it; `microsoft-oauth-smoke` pins both.
- `services/mail-provider.js`: Outlook category presets (`preset0…24`) map to hex (`OUTLOOK_PRESET_COLOURS`); Gmail already returned hex. `47-page-mailbox.js` draws a coloured square beside the label name.

## 2026-10-07 (Session 42) — a send killed by a restart is no longer "Sending…" (D-0095, R-162)
- `services/send-progress.js`: `reconcileProgress(progress,{alive})` (an `active` record with no live run in this process and older than `DEAD_RUN_GRACE_MS` = 90 s becomes `{active:false, done:true, interrupted:true, completedAt}`), `tryStartRun(set, userId)` (check + register in one step). `isStaleProgress` is unchanged (an ACTIVE run still never expires by age).
- `GET /emails/send-progress` (`routes/emails.js`) reconciles and writes the stopped-early record back; `index.js` supplies `isSendAlive(userId)` = `activeSendByUser` (Send all / auto) or `selectedSendsByUser` (Send selected, new: register + `finally`). `POST /emails/queue-all` now decides BEFORE it answers: a live run → `{queued:0, already_running:true, pending}`.
- Per process: with a second web instance the liveness check would be wrong (it would call the other instance's run dead). Render runs one.
- Open: R-163 (the 20-minute `pending_retry` sweep did not pick the rows up that day).

## 2026-10-08 (Session 42) — "sends as" and the signature (D-0103)
- `email-signature.js`: `sendsAsKey`, `cleanSendsAs` (company 80 / title 80 / address 200 / phone 40 / website 120), `sendsAsProblem` (company, title and a postal address are required), `signatureFromSendsAs` (a signature with `OWN_SIGNATURE_MARK`; `{{sender}}`/`{{senderemail}}` stay merge fields). `resolveSignatureHtml` returns a marked signature untouched, and `ensureSignatureAddress` no longer adds Fute Global's Dallas address to a signature that carries the marker or any ZIP of its own. NOT done: the stock sequence wording in `email-vars.js` still names Fute Global LLC (R-169: a send-time `{{sendercompany}}`).
