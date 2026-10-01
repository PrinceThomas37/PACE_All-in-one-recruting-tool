# R-101 — Which numbers are counted twice, and where they disagree (audit, 2026-10-01)

**Method:** read every place that works out a "today / week / month / response rate" figure and compared its definition with Lead Insights (`services/bd-insights.js`, `services/ra-insights.js`), which now follow D-0065 (a day is the viewer's own day; 7 and 30 days include today). **Read:** `routes/recruiting/analytics.js` (`/recruiting-dashboard`, `/reports/recruiting`), `routes/workflows.js` (`/stats`), `public/js/05-page-dashboard.js` (period buckets), `01-constants.js` (`todayIST`). **Not read (say so rather than imply it was checked):** the Leads page date filter (`06-page-leads.js:32`), the Email page's own day cut (`07-page-email.js:824`), `39-page-reports.js` drawing code. Nothing here was changed by the audit.

## Where two pieces of code answer the same question differently

| # | Question | Lead Insights (server, one calculation) | Elsewhere | Disagreement |
|---|---|---|---|---|
| 1 | What is "today"? | The viewer's own calendar day (`?tz=`) | `todayIST()` (`01-constants.js`) = **device time + 5.5 h, forced to India**. Used by the Dashboard's Reminders widget ("due" = `return_date <= todayIST()`), the Dashboard period filters (`jobsInPeriod`, `filterPeriod`), the Leads page date filter and the Email page | Anyone outside India sees India's date. A US recruiter's reminders turn "due" ~10 h early; "today's leads" flips at the wrong hour. **Contradicts D-0065.** |
| 2 | What is "this week"? | Seven calendar days including today | Dashboard `weekly`: `date >= now − 7×24 h` (compares a midnight date to a moment → effectively 8 calendar days). `/stats` weekly: same `now − 7 days`. `/recruiting-dashboard`: `weekAgo = now − 7×24 h` | 7 vs 8 days: the same lead can be "this week" on one card and not on the other. |
| 3 | What is "this month"? | Rolling 30 days including today | Dashboard `monthly` = **calendar month** (browser clock). `/stats` monthly and `/recruiting-dashboard` monthStart = first of the **server's** month (Render = UTC) | Names collide ("30 days" vs "this month") and the first of a month is cut at UTC on the server but at the device on the browser. |
| 4 | "Response rate" | Share of leads where a contact **replied** (R-089) | `/stats` → `responseRate = emailed / total` (the share that was *emailed*, not that replied) | The exact bug R-089 fixed in Insights still lives in `GET /stats`. A buyer comparing the two sees different numbers under the same name. |
| 5 | Dashboard lead counts | Server, whole set | Dashboard cards add up `STATE.jobs` / `STATE.leads` in the browser | Only as true as the list the page happened to load — same failure as "0 emails beside 311". |
| 6 | Reports date window | Viewer's day | `/reports/recruiting?from&to` parses `from + 'T00:00:00'` and `to + 'T23:59:59'` on the **server's** clock | A report for "1–7 Oct" asked from India is cut at UTC, 5.5 h off. |

## What agrees (checked, no action)

- **Submission counts.** `/recruiting-dashboard` and `/reports/recruiting` both count a submission by how far it *got* (`reachedOf` → `services/submission-stages.js`), with two published numbers (handed to BD, sent to client). They agree with each other and with D-0029.
- **Scope.** Both are chain-scoped the same way (admin = desk; others = self + reporting chain).

## Proposed fixes, smallest first (new rows; none built)

| Row | Fix | Size |
|---|---|---|
| R-103 | Replace `todayIST()` with the device's own date (D-0065). Check what zone the server stamps `created_date` / `return_date` in before changing the comparison — a mixed zone is how this was introduced. | small, needs care |
| R-104 | `/stats`: make "response rate" the real reply share (reuse `bd-insights`) and take `?tz=`. | small |
| R-105 | `/recruiting-dashboard` and `/reports/recruiting`: accept `?tz=`, cut week = 7 calendar days, month = the same word everywhere (decide: rolling 30 days or calendar month — an owner call). | medium |
| R-106 | Dashboard lead cards: read the server's numbers (`/insights/bd/:id`) instead of adding up `STATE.jobs`. | medium |
