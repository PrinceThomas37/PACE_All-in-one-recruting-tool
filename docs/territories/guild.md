# Guild — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

## What is true here now
- `bd_recruiter_routes.js` is a **43-line mounter** over
  `routes/recruiting/{job-orders,candidates,submissions,pipeline,lookups,
  sourcing,analytics,outreach}.js`. Shared helpers are built once in
  `services/recruiting-core.js` (+ `services/candidate-fields.js`).
- **63 routes are pinned** by `test/recruiting-routes-mounted.mjs`, which boots
  the real server.
- **11 ATS stages** since Session 6: Sourced, Screening, Submitted to BDM,
  Submitted to Client, Interview Scheduled, Interview Completed, Offer, Joining,
  Placement, Not Accepted, On Hold. `Joining` was "Confirmation"; `Not Accepted`
  merges the old "Rejected" + "Not Joined". `normalizeStage()` maps legacy values
  on read and write.
- Reporting is **hierarchy-scoped** — everyone sees themselves plus everyone
  under them on `manager_id` (`reportingChainIds()`, a BFS). Admin sees the org.
  Response carries `scope` (`own`/`team`/`org`).
- `routes/recruiting/outreach.js` **returns** its send helpers so the outreach
  generator did not have to grow a second send path.

## Fragile — touch with care
- **The stage vocabulary lives in six files.** Five are `surface`'s. A rename is
  a contract, not an edit by me.
- **Registration order** — `/job-orders/browse` before `/job-orders/:id`;
  `/candidates/check-duplicate` before `/candidates/:id`.
- `Assigned` vs `Connected`: **Connected means they replied.** It drives the
  funnel, the reports and the 30-day recycler. An outreach send sets `Assigned`.
- An enrollment after a generator send starts **after step 1**
  (`start_after_step`) — the email just sent IS step 1.

## Open here
- `/recruiting-dashboard` is org-scoped but **not hierarchy-scoped** the way
  `/reports/recruiting` is. The owner asked for both, plus reports folded into
  the Dashboard page itself rather than a separate nav item.
- Per-role **permission** differences do not exist yet — `associate_director` and
  `director` are hierarchy/reporting only, no new capabilities.
- Three stale draft PRs (#116, #126, #135) are months behind `main`.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
