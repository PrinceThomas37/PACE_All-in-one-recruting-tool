# Frontend modules (`public/js/`)

This folder is the former `public/app.js` (8,740 lines) split into focused,
navigable files. This was **Phase 1** of the incremental refactor described in
`FRONTEND_REFACTORING_GUIDE.md`: reorganize first, change behavior later.

## What changed and what did NOT

- **Did NOT change:** any logic, API paths, database schema, authentication,
  visible behavior, or CSS. The split is a pure repartition of the original
  file. Concatenating these files in order reproduces the original `app.js`
  **byte for byte** — see "Verifying" below.
- **Did change:** one 8,740-line file became 26 files, each covering one area,
  and `index.html` now loads them in order instead of the single `app.js`.

## Important: these are ordered classic scripts

They are **not** ES modules. They share a single global scope exactly as the
original monolith did (`STATE`, `render()`, the `window.*` handlers, etc. are
all still globals). Therefore **load order matters and must not be changed.**
`index.html` loads them `01` → `26`; the numeric prefixes make that order
explicit. `26-boot.js` must always load last — it starts the app.

## File map

| File | Contents (former app.js lines) |
|------|--------------------------------|
| `01-seed-demo.js` | Seed data, demo generators (`genLeads`/`genJobs`), format helpers |
| `02-state.js` | The global `STATE` object and its initial seeding |
| `03-core-render.js` | Render engine (`render`, `scheduleRender`, toasts, clock) + shared helpers |
| `04-shell-login.js` | Login screen + app shell / sidebar / topbar |
| `05-page-dashboard.js` | Dashboard page |
| `06-page-leads.js` | Leads page, job detail modal, add job/contact, job/contact actions |
| `07-page-email.js` | Email page (compose, outreach, sequence) |
| `08-page-admin.js` | Admin panel + Deliverability dashboard |
| `09-page-workflows.js` | Workflow engine UI (definitions, builder, enrollments) |
| `10-page-modals.js` | Reminders, mail-merge modal, profile, add lead, add/edit user, toast/modal shells |
| `10a-window-dock.js` | Windows: Minimise / Full screen / Close on every modal, the tray of parked windows, record drawers that park (R-078/R-079) |
| `10b-from-picker.js` | The "From" picker — choose which of MY mailboxes an email leaves from (R-087) |
| `11-bind-and-actions.js` | Event binding + global action functions |
| `12-manager-users.js` | Manager Users administration functions |
| `13-pagination-mailmerge-actions.js` | Pagination + mail-merge actions |
| `14-mailmerge-engine.js` | Mail-merge engine |
| `15-ra-entry-form.js` | RA Lead entry form (Drop P) |
| `16-insights.js` | Insights tab + BD Manager/BD Lead insight pages |
| `17-research.js` | Research section (inside job detail modal) |
| `18-email-status-actions.js` | Email status / OOO / reminder actions + email actions |
| `19-distribution.js` | Distribution actions |
| `20-email-accounts.js` | Email accounts page |
| `21-assign-leads.js` | RA Team Lead bulk-assign UI |
| `22-api.js` | `apiFetch` layer, session restore, `loadAppData`, background polling |
| `23-auth-guest.js` | Auth + guest/demo simulation layer |
| `24-jobs-wired.js` | Jobs actions wired to the backend |
| `25-workflow-bd.js` | BD Manager / recruiter workflow module (IIFE) |
| `27-page-applicants.js` | Applicants / candidate database (ATS Slice 1) — loads after 25, before boot |
| `28-page-pipeline.js` | Job pipeline / tagging tab (ATS Slice 2) — loads after 27, before boot |
| `29-page-submissions.js` | Job submissions grid + lifecycle (ATS Slice 3) — loads after 28, before boot |
| `30-page-candidate.js` | Candidate profile: lifecycle bar + per-job history (ATS Slice 4), notes & documents (Slice 5) — loads after 29, before boot |
| `31-ats-lookups.js` | Managed ATS taxonomies + admin list manager (ATS Slice 6) — loads after 30, before boot |
| `32-page-sourcing.js` | Sourcing connectors: CSV/XLSX import → staging → dedup → import — loads after 31, before boot |
| `33-stage-modal.js` | Shared stage-change modal: sub-stages, note, interview date/location, reminder — loads after 32, before boot |
| `34-recruiting-dashboard.js` | Role-aware recruiting dashboard cards — loads after 33, before boot |
| `26-boot.js` | Boot entry point (must load last) |

## Verifying

Dependency-free checks (syntax of each file + index.html consistency):

```bash
bash test/verify-frontend.sh
```

Full runtime smoke test (boots the app in headless Chromium via guest mode and
walks every major screen, asserting no JS errors):

```bash
npm install --no-save playwright-core
node test/frontend-smoke.mjs
```

Byte-equivalence to the original monolith (valid for the initial split commit,
before any Phase 2 edits):

```bash
# The two-digit prefixes make shell glob order match load order.
diff <(cat public/js/*.js) <(git show <split-commit>^:public/app.js)
```

## Next (Phase 2 — not done here)

Per the guide, once these boundaries and tests exist, migrate **one file at a
time** to: real ES modules with explicit imports/exports, a controlled
`getState`/`setState`/`subscribe` store, `textContent`/DOM rendering (or a
shared `escapeHtml` helper) in place of string-built HTML, event listeners in
place of inline `onclick`, and separation of guest/demo mode from production.
Each of those steps should be its own small, tested change.
