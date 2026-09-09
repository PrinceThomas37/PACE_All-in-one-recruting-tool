# Ledger — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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

## Fragile — touch with care
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

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
