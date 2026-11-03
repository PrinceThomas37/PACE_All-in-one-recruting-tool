# R-349 — the lead list, page by page (plan, written 3 Nov 2026, nothing built yet)

Owner's order (3 Nov, asked and answered): **Leads tab + Dashboard cards first**, then the pipeline board, then Assign / Distribution,
then mail merge and research. One group per PR. Each PR is shown to the owner (screenshots + plain summary) and merged only on their go.
Every PR: targeted suites, then ONE full `node test/run-all.mjs` on Node 22 AND Node 26, count read, never piped.

## Where it stands (measured, not assumed)

- `GET /jobs` (`routes/jobs.js:151`) returns EVERY lead the caller may see (`own.scopeLeads`), from a server-side copy
  (`loadAllJobs`), with an ETag so an unchanged list is a 304. R-348 already made each lead small (no pasted job text).
- The browser keeps all of it in `STATE.jobs` — 85 references in 22 files. The biggest: `06-page-leads.js` (18), `22-api.js` (13),
  `17-research.js` (7), `08-page-admin.js` (7), `21-assign-leads.js` / `19-distribution.js` / `05-page-dashboard.js` (4 each).
- The Leads tab filters in the browser: search, stage chips, industries, assignee, date range, Mine / Team, then pages the result.
  The Dashboard cards and the Leads stat cards (Total / Assigned / Connected / Rejected) count the same list.
- Server work (AI writing, "needs you today", bounce marking, sends) does NOT use the browser's list. Only screens do.

## The idea in one line

The server does the finding and counting; the browser asks for "page 3 of Connected leads matching 'nurse'" and "the counts for my
cards", and holds only what is on screen. **Nothing is read from the database that is not already read today** — the filtering
runs on the server's existing in-memory copy, so no migration and no new database load.

## Stage 1 — the Leads tab and the Dashboard / Leads cards (first PR)

1. `GET /jobs/page` — **registered ABOVE `/jobs/:id`** (the shadowing rule; `route-shadowing-smoke` pins it). Takes the same
   filters the screen has today (search, stages, industries, assignee, dateRange / from / to, who = mine | team, page). Applies
   `own.scopeLeads` FIRST (who-sees-what is never filtered in the browser), then the filters, then sorts, then slices one page.
   Returns `{rows, total, pageCount, hiddenByHorizon}` — the horizon rule (90 days, search reaches all history) stays, and the
   screen still says how many are hidden.
2. `GET /jobs/counts` — the numbers the cards need (per stage, total, assigned, today's), made by the server from the same scoped list.
   The ONE definition of each count lives in a service, not retyped per screen (business terms are defined once).
3. Page size is NOT typed into the code: an admin setting in `config/settings.js` `SETTINGS_SCHEMA`, read with `getSetting()`
   (D-0123); `test/admin-numbers-smoke.mjs` pins it.
4. The Leads tab (`06-page-leads.js`) and Dashboard cards (`05-page-dashboard.js`) call these. `STATE.jobs` STAYS for the other
   screens in this stage — it is not removed until every reader has moved (Stage 5). So nothing else can break in Stage 1.
5. A repaint on a timer stays banned: a refresh of the page must not move rows under the user's hands (render-engine rule).
6. Guards (each must FAIL when the thing is absent): a page for a user with a narrow scope never contains a lead outside it; the
   cards equal the old browser counts for the same data (a side-by-side test on a seeded list — the proof nothing is mis-counted);
   the literal route is not shadowed; an empty result says "no leads match", not a blank.

## Stage 2 — pipeline board · Stage 3 — Assign and Distribution · Stage 4 — mail merge, research, Admin, client digest

Each moves its screens from "filter `STATE.jobs`" to a server call, one screen at a time, each with its own side-by-side count
test. Mail merge and "select all matching" need a server-side "ids matching this filter" call (never a browser list of 2,700).

## Stage 5 — remove the whole-list load

Only when no screen reads `STATE.jobs` (a grep guard that fails if a new reader appears): sign-in stops fetching the list at all;
`22-api.js` keeps single-lead fetches for the drawer. This is the step that makes the app's speed independent of database size.

## Risks, said plainly

- **A count that looks right and is wrong** is worse than a slow screen. That is why every stage carries a side-by-side test of
  old browser count vs new server count on the same seeded data.
- **Selecting across pages** (bulk actions) is where a paged list usually breaks: "select all 40 matching" must mean the server's
  40, not the 25 on screen. Decided in Stage 1 design: bulk actions take a FILTER or explicit ids, and say how many.
- The server's in-memory copy is itself a memory cost on the free server (R-324). Paging the browser does not shrink that copy;
  a later step (query the database per page) is the lasting answer and is NOT part of this plan.

## Owner's answers (3 Nov) — decided, do not re-ask

1. "Select all" with a filter on = **all matching leads across every page**, with the number shown before anything is done.
2. A new company starts at **20 leads per page** (admin-changeable setting, D-0123).

## (Answered) questions that were asked

1. On the Leads tab, if you tick "select all" with a filter on, should it mean **all matching leads (e.g. 140), across every page**,
   or **only the ones on this page**? (Answered: all matching.)
2. How many leads per page should a new company start with? (Answered: 20.)
