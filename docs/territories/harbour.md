# Harbour — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## What is true here now
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

## Fragile — touch with care
- **Every reader of `emails.body` must call `renderStoredEmail(row, mailbox)`.**
  `test/sender-identity-smoke.mjs` greps for readers and fails on one that does
  not. This shipped a wrong human name to 152 real recipients once.
- **`releaseToPoolUpdate()` is the only way to return a lead to the pool.** Two
  silent failures came out of three paths disagreeing.
- **Never remove the `ORDER BY` from the pending fetch** — `.range()` repeats or
  skips rows without one.
- Gmail headers are RFC 2047-encoded, split on **character** boundaries.

## Open here
- **KNOWN, UNFIXED: a dead mailbox sign-in destroys emails.** An auth failure
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
