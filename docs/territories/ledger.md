# Ledger — memory
> Last written: 2026-09-23 · C-0025 (D-0034 on the candidate email-activity card)

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
