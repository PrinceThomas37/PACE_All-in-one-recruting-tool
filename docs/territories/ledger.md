# Ledger — memory
> Last written: 2026-09-29 · R-071 (the out-of-office reminder blamed an auto-reply)

## What is true here now
- Billing is **built and payments are switched off** (Session 11).
  `services/plans.js` holds the tiers as data and is PURE;
  `services/entitlements.js` counts usage and gates creates;
  `services/billing.js` is the Stripe seam — **no `stripe` npm package**,
  outbound HTTP goes through `http-client.js` like everything else.
- **Pricing is deliberately `null` on every tier.** That is the owner's call and
  one line in `services/plans.js`. The default org is on the `internal` plan
  (unlimited), so none of this changed the live deployment.
- Open tracking: `email_tracking` (org-scoped), a public pixel at
  `GET /o/:token.gif` that records opens, returns a 1×1 gif and **never errors**.
  Replies stamp `replied_at` off the existing 30-minute inbox sweep.
- The candidate answer page is `GET /i/:token` — **buttons, not a recording
  link.** Three answers: interested, not-this-one, and "do not email me about any
  roles". Only the last writes to `suppression_list`.
- Personal mailbox replies get **no pixel and no `email_tracking` row** —
  tracking belongs to outreach, not to a personal reply.
- **`GET /candidates/:id/email-activity` (routes/tracking.js) splits ENVELOPE
  from LETTER (D-0034, C-0025).** The envelope — to, sender (`sent_by` +
  `sender_name`), mailbox, subject, sent/opened/replied, open count — goes to
  anyone in the org who can open the candidate, because it is what stops two
  recruiters approaching one person about the same role. The `body` goes only
  where `ownership.canSeeEmail(row, null, scope)` holds: the sender, whoever
  they report up to (`hierarchy.js` `reportingChainIds`), and an admin.
  Otherwise `body:null`, `body_visible:false`, and `body_note` — a sentence
  naming the sender. **`body_visible:true` + `body:null` still means "sent
  before migration 042 kept a copy"; the two nulls are kept apart on purpose.**
  Holds whichever way the owner answers D1 (is the candidate pool shared).
  **Subject is envelope, not letter** — my call: every writer puts the ROLE in
  it. If the owner reads it as correspondence, add `'subject'` to `SENDER_ONLY`.
  Org scoping is `db.forRequest(req)` (was a hand-written `if (req.orgId)`).
  The rule is the exported pure `activityRowFor(row, scope, senderName)`.

## Fragile — touch with care
- **A reminder's "why" is a claim about the past — check the WRITER before
  wording it (R-071).** `ooo_return` said *"Their auto-reply said they were
  away… so PACE held the follow-up until they were back"*; both halves false.
  Facts, verified 2026-09-29: the ONLY writer is `PATCH /contacts/:id/
  email-status` (a person picks "Out of office" + types a date); PACE never
  reads an auto-reply to set it (`conversation-intel` only LABELS a thread).
  The reminder's `user_id` is that person, `GET /reminders` is own-only and
  nothing reassigns a reminder, so the reader is always the one who did it —
  hence "You". **The hold:** while a contact is `out_of_office`, scheduled
  fu1/fu2 are withheld (queued row deleted, schedule reset, left `active`) but
  a SEQUENCE email step is SKIPPED and the sequence moves on
  (`workflow-engine.js` "done / skipped → move on"); nothing lifts the status
  on the date (no sweep/trigger reads `ooo_until`; marking the reminder done
  does not touch the contact) — logged as R-080, owner undecided, do not build.
  Surface mirrors the sentence in `public/js/10-page-modals.js` `reminderWhy`.
- **`routes/reminders.js`: an EMBEDDED JOIN IS NOT ORG-FILTERED (R-047 B2).**
  `db.forRequest` scopes `reminders`; the `job:jobs(...)` / `contact:contacts(...)`
  embeds in `GET /reminders` are not. `POST /reminders` used to take any
  `job_id`/`contact_id`, so a reminder naming another company's lead read back
  its position, company and the contact's email/phone/LinkedIn. Now BOTH ends:
  * **write** — `contact_id` must be an org contact with a `job_id` (its lead
    becomes the reminder's lead, or must equal the `job_id` sent), and the lead
    must pass `canTouchJob` (org-bound). Every miss is the same **404** "Lead or
    contact not found". `org_id` stamped by `db.forRequest`. No frontend caller
    sends either id today (manual + meeting reminders), so nothing changed there.
  * **read** — `reminderEmbedFor(row, {orgId, scope})` (PURE, exported off the
    router module) keeps the job only if in-org, matches `job_id` and passes
    `ownership.canSeeLead` (D-0034 scope; the chain is fetched only when some
    lead is not visibly the caller's), the company only if in-org, the contact
    only if in-org AND on THAT lead. A failing row keeps its own stored text,
    loses the embed, is **never deleted or hidden**, and is send-blocked through
    the existing `outreach.blocked` channel (`block_reason:'not_on_desk'`) so
    the page refuses up front with no new branch. Sequence / sent-mail lookups
    run on the safe rows, so a withheld contact cannot leak via enrichment.
  * Consequence worth knowing: a reminder on a lead since recycled to the pool
    or handed to someone outside the caller's chain now shows its stored
    name/company only. That is D-0034, not a regression.
- **`email_tracking.token` is a BEARER SECRET and must never be sent to a
  browser.** It is the pixel token AND the candidate answer-page token —
  `POST /i/<token>/opt-out` needs nothing else and writes the GLOBAL
  suppression list. The activity endpoint used `select('*')` and shipped it to
  every user in the org. Now an explicit column list AND an allow-list on the
  way out (`ENVELOPE_FIELDS`), so a future `select('*')` still cannot leak it.
  **Still leaking elsewhere (not my files):** `routes/email-history.js` selects
  `token` and uses it as the row `id` for Email → All email, including
  `candidate_outreach` rows — raised to the orchestrator (C-0025 report).
- **`suppression_list` is GLOBAL.** Writing to it on a single "wrong city"
  decline throws that candidate away for every future role.
- **A mail scanner fetches every URL in an inbound message.** Outlook Safe Links,
  Mimecast and Proofpoint would answer for the candidate if the GET recorded.
  The token is written to the row **before** the send, so a tap cannot beat its
  own row. Unknown, deleted and malformed tokens answer identically.
- **`supabase-js` retries a refused connection for 7 seconds.** Every query
  behind `/i/` is bounded at 4s. **A write that timed out is never reported as
  saved** — the candidate is told and pointed at the reply path.
- An opted-out or "not interested" thread must never produce a next-action.
  `test/next-action-smoke.mjs` pins it.

## Open here
- **The owner has not set prices and has not decided on card payments.** One line
  in `services/plans.js` when they do.
- No generalized audit trail yet — the submission activity log is the only one,
  and buyers ask for accountability across the board (`CLAUDE.md` growth bet 7).
- Data-retention policy is unwritten. Nothing deletes on a schedule today.
- **The candidate card still says the wrong thing for a withheld body** until
  surface ships its half: `public/js/30-page-candidate.js` (~:306) renders any
  null `body` as *"sent before PACE kept a copy"*. It must render `body_note`
  when `body_visible === false`. Needs a surface contract (not opened by me —
  the orchestrator limited my `_contracts.md` edit to C-0025's status line).
- **Three more untrue sentences in `services/reminder-source.js`, found in the
  R-071 audit and deliberately NOT changed (coordinator: keep R-071 to one
  sentence). None is on a live row today (all 3 live reminders are
  `ooo_return`):** `bd_touch` generic says *"the emails went out"* — the
  executor never checks, and a skipped email step still advances (propose:
  *"…for this contact. The emails in a sequence are automatic; this step is
  not."*, matching the resolved sentence); `manager_prompt` says *"Somebody you
  report to"* and labels *"Asked by your manager"* — an ADMIN may prompt anyone
  (`routes/next-actions.js` bypasses the chain; propose label *"Asked by your
  manager or admin"*, still matches the test's `/manager/i`); `UNKNOWN_SOURCE`
  says the row *"predates the record"*, but it is only reached by a NON-EMPTY
  unrecognised type (null → `manual`), i.e. a row that does carry a record.
- **`sequenceContext` (routes/reminders.js) can name the WRONG sequence.** It
  keys by contact:job and the last enrollment wins; `workflow_enrollments` is
  unique only per (workflow, active), so two sequences or an old + new
  enrollment collide, and a sequence with NO task step can be named. Fix: drop
  the name on a collision, and never name a workflow without a bd_touch/reminder
  step. Also `POST /reminders` passes any `reminder_type` through (own list
  only, so it can only mislead its author) — allow-list `manual`/`meeting`.
- **Guild's stage-move reminder (`routes/recruiting/submissions.js`) writes no
  `reminder_type`** → read as `manual` / "You added this reminder yourself",
  which is TRUE (the person typed the date). `CAPABILITIES.md` ~176 still says
  `ooo_return` comes "from an out-of-office auto-reply" and that all writers
  set a type — shared file, reported, not edited.
- **Unpinned (R-071):** nothing asserts the OOO sentence never claims an
  auto-reply, or that surface's copy equals mine — foundry.
- **Unpinned:** no committed test covers `activityRowFor` or the route. A
  18-assertion scratch check (fake supabase through the real `db` layer) passed
  and caught all six reintroduced bugs; foundry should commit it (see C-0025
  report for the list).

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-23** — C-0025 answered. Email-activity card: envelope to the org,
  body to the sender's scope, `token` removed from the payload (it could opt a
  candidate out of every role), org scoping moved onto `db.forRequest`, a
  bounded `.limit(200)`, sender names in one best-effort query. Verified:
  `node --check`; plans-billing 69/69, email-tracking 7/7, next-action PASS,
  candidate-outreach PASS, rate-limit PASS, route-shadowing 9/9, ownership
  31/31, recruiting-routes-mounted PASS; scratch 18/18 with 6/6 mutations
  caught and a no-op control surviving. **Lesson re-learned in the scratch
  run:** my first mutation pass reported every bug "caught" because the copied
  module failed to LOAD (exit 1, zero FAIL lines) — count FAIL lines, never
  trust a non-zero exit as a catch.
- **2026-09-24** — R-047 B2 closed in `routes/reminders.js`: POST validates
  lead (canTouchJob) + contact (org, same lead), 404 on any miss; GET drops
  cross-org / out-of-scope embeds via `reminderEmbedFor`, send-blocks those
  rows. Verified: `reminder-clarity` 50/51 (the 1 failure is surface's
  in-flight `.ot-chip.approved` hex appended after the REMINDERS block in
  `public/styles.css`, not mine), next-action 49/49, org-scoping-routes 13/13,
  ownership 69/69, backend 107/107, models 53/53, route-shadowing 9/9. A
  14-assertion scratch check (pure rule + POST handler on a fake db) passes and
  FAILS with the `canSeeLead` clause or the `canTouchJob` gate removed.
  **Unpinned:** foundry should commit it.
- **2026-09-29** — R-071: `ooo_return` "why" rewritten to *"You marked them
  out of office until this date, which created this reminder. PACE sends them
  no automatic follow-ups until their status is set back to Valid."* Label
  unchanged. Header comment corrected. Verified: `node --check` OK;
  reminder-clarity 51/51, ownership 69/69. Lesson: the brief's own example
  sentence ("…so PACE held the follow-up until they were back") was still
  false. Trace the half of a sentence nobody questioned, too.
- 2026-10-01 (R-080, D-0066): contacts marked Out of office are set back to Valid by `services/ooo-return.js` on the return date, so automatic follow-ups can resume (the stop on automatic mail for an out-of-office contact is lifted by the date, not by a person). Invalid/deactivated contacts are never switched — the suppression of a bad address is not undone by a holiday ending. The `ooo_return` reminder explanation (`services/reminder-source.js`) says so.

- 2026-10-02 (R-110, D-0068): open tracking now covers leads emails (cold outreach to people who have not opted in). Ships limited to `open_tracking_users`; the owner chose BD Lead 1 first. Open questions for later: disclosure/consent wording for recipients in regions that expect it (EU/UK), and whether tracking should honour the suppression list (it does not touch it). Stored per open: only counters + a reason; the sender's networks are salted hashes.
