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

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-09** — fixed `getTimezoneFromLocation` state-code substring bug;
  opened C-0014 to deep for the backfill.
