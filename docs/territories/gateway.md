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

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
