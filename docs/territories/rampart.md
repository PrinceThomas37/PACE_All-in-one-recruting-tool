# Rampart — memory
> Last written: 2026-09-23 · D-0034 visibility audit (`claude/tender-noether-fmxgr0`)

## What is true here now
- **Two different questions, and this territory now answers both.**
  * **Cross-company (X-ORG):** could a person at company A reach company B's
    data? That is a breach with no error message. Laws 1-8 exist for it.
  * **Inside one company (D-0034, 2026-09-23):** *"you SEE only what you are
    responsible for, plus your team's if you manage one."* The owner found the
    gap as BD Lead 1: 49 leads shown, 25 owned; all 119 emails shown.
- **THE VISIBILITY RULE IS CALLABLE: `services/ownership.js`, section "SEEING".**
  PURE. `viewScope({role, roles, userId, chainIds})` → `{all, userId, ownerIds,
  seesPool, label}`; predicates `canSeeLead`, `canSeeContact`, `canSeeEmail`,
  `canSeeSubmission`; helpers `scopeLeads`, `scopeEmails`, `queryOwnerIds`,
  `inScope`, `isPoolLead`, `rolesOf`, `POOL_ROLES`. The header holds the
  role → scope table. Two rules make that table:
  1. **Only the CHAIN widens a view, never the role** (admin excepted →
     whole org). The chain is `hierarchy.js` `reportingChainIds` — the one BFS.
  2. **A role adds the POOL and nothing else.** Pool = a lead with no
     `assigned_to_bd`. POOL_ROLES = admin + ra_lead, because every
     `/distribute/*` route and `/jobs/bulk-assign` gate on exactly those two.
     **bd_lead does not distribute, so bd_lead does not see the pool.**
  * **ra_lead, decided:** the pool (they distribute it) + everything their own
    RAs created (`created_by` in chain — reviewing research is their job) +
    COUNTS for send operations. Not other BDs' leads as records, and never BD
    correspondence. The Email page's RA-Lead drill-down loses message bodies —
    owner-visible, so listed as D4.
  * **An email is seen by its sender's scope and by the scope of whoever OWNS
    the lead now** — NOT its creator, NOT the pool. An RA does not read the BD's
    mail on a lead they researched. A recycled lead's history follows the new
    owner.
  * **Fail closed:** no user id → sees nothing; missing chain → self only.
  * **`rolesOf()` reads roles exactly like `hasRole`** (non-empty `roles[]`
    wins over `role`). Reading them any other way lets this file and the role
    gates disagree about who is an admin.
  * Verified by a 32-assertion scratch check on the live org shape and **six
    reintroduced bugs, each caught** — but NOT yet a committed suite (C-0027).
- Multi-tenancy is **shipped**: `org_id` NOT NULL on all tenant tables
  (022/023), RLS + service-role policies on all 48 (039). 0 without RLS, 0
  without a policy.
- **⚠ THE BACKEND RUNS AS SERVICE ROLE — RLS IS BYPASSED ON EVERY REQUEST**
  (`index.js:73`). RLS on 48 tables defends against the anon key, a different
  attacker. **Application code is the only tenant boundary.** Never answer a
  raw-query finding with "but RLS is on".
- **A tenant INSERT that omits `org_id` does not fail — it MISFILES** into the
  default org (column DEFAULT, migration 022). Check inserts, not just reads.
- `models/`: `db.forRequest(req)` scopes by construction; raw `supabase` still
  works, so **unconverted call sites are unprotected.**
- `routes/auth.js` has ONE cross-org choke point, `guardUser()` — 404 on a miss.
  All 18 routes carry a guard, an org filter or a `req.user.id` filter.
- `canTouchJob`'s admin bypass is org-bounded (reads the row first).
- `MULTI_ORG` arms at runtime via `provisioning.onOrgCreated`.
- Self-serve signup built and OFF. `decide()` is PURE. No guest/demo mode.

## THE AUDIT — 2026-09-23 (the record the fixing territories work from)
Roles: A admin · D director · AD assoc. director · BL bd_lead · BD bd ·
RL ra_lead · RA ra · R recruiter. Verdicts: **LEAK** (wider than D-0034),
**X-ORG** (crosses companies), **NARROW** (shows less than D-0034 allows — the
fix widens it), **DECISION** (owner's call), **OK**. Line numbers as of today.

### gateway — contract C-0021
| where | returns | today | verdict |
|---|---|---|---|
| `routes/jobs.js:118` GET /jobs | leads + nested contacts | A,RL all · BL every assigned lead · BD own · D,AD,RA,R `created_by` only | **LEAK** (BL, RL) · **NARROW** (D, AD) |
| `routes/jobs.js:182` GET /jobs/:id | one lead | A,RL,BL any in org; others owner/creator (403) | **LEAK** (BL, RL) |
| `routes/jobs.js:168` GET /jobs/export | every lead + contacts | A, RL | **LEAK** (RL) |
| `routes/jobs.js:413` PUT /jobs/:id | edits + returns lead | any bd/bd_lead edits any lead; `sending_email_id`/`assigned_to_bd` unvalidated | **LEAK** (acting) · **X-ORG critical** (send as another company, with X3) |
| `routes/email-history.js:79` GET /email/history | 3 pipelines incl. bodies | everyone, whole org | **LEAK** — the owner's report |
| `index.js:2243` GET /follow-ups | follow-ups + contact + lead | pure BD own; everyone else all — **no org filter** | **LEAK + X-ORG** |
| `routes/companies.js:318` /companies/:id/email-activity | client email bodies | A, BD, BL: every BD's | **LEAK** (bodies; D2) |
| `routes/contacts.js:70` PATCH email-status | contact | any BD writes any contact | **LEAK** (acting) |
| `routes/record-history.js:109` /history/lead/:id | lead history | anyone in org | **LEAK** (low) |
| `routes/distribution.js:77` /distribute/today-summary | counts | anyone, any manager_id | **LEAK** (low, counts) |
| `routes/settings.js:82` GET /app-settings | **every `app_settings` row** incl. `int_*_api_key` | **any user, any org** | **X-ORG critical** — secrets |
| `routes/settings.js:92` POST /app-settings | writes any key | A, RL of any org | **X-ORG critical** |
| `index.js:2184` /distribute/execute · `workflows.js:200` bulk-assign | assigns to a body user id | no org check on the user/mailbox | **X-ORG critical** (X3) |
| `routes/events.js:13` GET /events/recent | every org's events (prospect addresses, ids) | A, BL, RL of any org | **X-ORG high** |
| `routes/companies.js:339/385/358/61/77` | client docs (signed URLs), delete, company edit/delete | no org on any | **X-ORG high** |
| `routes/jobs.js:489/512/67` | research, parse-jd, skill history | no org | **X-ORG** med/low |
| `index.js:2993/3007`, `cron.js:115`, sweeps, `integrations.js` | deployment controls | any tenant admin | **X-ORG design** (no platform-operator role) |
| `routes/companies.js:17/25/90/113/228/296` companies, search, clients, intake, contacts | org-wide client records | A,BD,BL (companies: all) | **DECISION** D2 |
| `routes/jobs.js:135` today-summary · `index.js:1218` activity · `jobs.js:525` contacts | counts / canTouchJob | pool roles / owner | **OK** (activity+contacts NARROW for managers) |
| `routes/workflows.js:227` · `lookups.js:37` duplicate checks | another BD's contact on a match | anyone in org | **DECISION** D5 (X-ORG part is C-0017) |

### guild — contract C-0022
| where | returns | today | verdict |
|---|---|---|---|
| `recruiting/analytics.js:33` /recruiting-dashboard | submissions, interviews | RA, RL unscoped (neither isBDM nor isRecruiter) | **LEAK** |
| `recruiting/analytics.js:370,417` /bd-analytics/* | recruiter numbers | every BDM, **no org** | **LEAK + X-ORG** (C-0003, misaddressed) |
| `workflows.js:14,35` /insights/{ra,bd}/:userId | counts | only pure RA/BD restricted | **LEAK** (+X-ORG, C-0017) |
| `wf.js:222` /wf/enrollments | contacts, leads | everyone, **every org** | **LEAK + X-ORG** |
| `wf.js:51` /wf/sending-mailboxes | mailboxes | A,BL,RL: **every org's** | **LEAK + X-ORG** (feeds X3) |
| `wf.js:73/85/106/134/236/245-247/269` | sequences, runs, stats | no org; POST files under `'fute'` or body `org_id` | **X-ORG** |
| `recruiting/candidates.js:128/179/200/226/237/254/266/286/321` | history, edit, delete, notes, **documents (signed resume URLs)** | no org on any; inserts misfile | **X-ORG critical** |
| `recruiting/job-orders.js:42/353/384/517/639/660/670/688/703/729` | job orders, assignment requests (+client names) | no org | **X-ORG high** |
| `recruiting/submissions.js:25/52/109/196/216` | pipeline with candidate PII + rates | no org; DELETE by any recruiter | **X-ORG critical** |
| `recruiting/pipeline.js:37/89/106/125/172` | pipeline | no org | **X-ORG** |
| `recruiting/sourcing.js:282/296` | import staged by id | no org | **X-ORG** |
| `recruiting/outreach.js:98` resolveEmailAttachments | **another org's documents as attachments** | no org | **X-ORG critical — exfiltration** |
| `recruiting/outreach.js:384/446` | interview invite / meeting on a submission | no org | **X-ORG** |
| `recruiting/lookups.js:103/119/138/153` | vocabularies | all orgs; edits any | **X-ORG** |
| `recruiting/candidates.js:35/74/97/115`, `job-orders.js:406` matches, `sourcing.js:90/164` | the candidate pool | every recruiting role, whole org | **DECISION** D1 (org-scoped correctly) |
| `recruiting/job-orders.js:261/296/331`, `candidate-outreach.js:419` | job orders / job board | every BDM, RA, RL (R: assigned; board: all) | **DECISION** D3 |
| `recruiting/analytics.js:180` /reports/recruiting · `:324` /team/activity | chain-scoped | — | **OK** |
| `lead-sources.js` /sourced-leads | ownerless intake queue | reviewer roles | **OK** (pool-like, role-gated) |

### harbour — C-0023 (C-0015 still open and accurate)
| where | today | verdict |
|---|---|---|
| `emails.js:32` GET /emails | RL all BDs' bodies; A/RL **every org** (C-0015#1); BL own only | **LEAK + X-ORG** · NARROW (BL) |
| `emails.js:90` pending-summary | RL/A counts for any manager, every org | OK in-org (counts) · X-ORG (C-0015#4) |
| `warmup.js:51` | BL, RL every mailbox | **LEAK** low + X-ORG (C-0015) |
| `deliverability.js:33/53/68/107` | suppression list, **delete another org's opt-out**, sample bodies, mailboxes | **X-ORG** (DELETE is compliance) |
| `mailbox.js` (all) | own mailboxes only, 404 | **OK** |

### observatory — C-0024
| where | today | verdict |
|---|---|---|
| `outreach-generator.js:373/404` recipient pickers | any user finds any contact in the org | **LEAK** |
| `outreach-generator.js:450` createLeadFromOutreach | lead with no `assigned_to_bd` — invisible to its own sender | ownership bug |
| `next-actions.js` (all), `ai.js:183` briefing, `outreach-generator.js:422`, `candidate-outreach.js:442` | chain / own per D-0020, D-0021 | **OK** (briefing's comment wrongly says bd_lead distributes) |

### ledger — C-0025 · rampart (mine) · surface — C-0026
| where | today | verdict |
|---|---|---|
| `tracking.js:47` /candidates/:id/email-activity | any user reads every recruiter's bodies to a candidate | **DECISION**-linked (D1) |
| `reminders.js` (all) | own `user_id` | **OK** |
| **`auth.js:232` GET /users/:id/emails** (mine) | any colleague's mailbox list + health | **LEAK** low — open here |
| `auth.js:90` GET /users | roster; hierarchy fields trimmed outside chain | **OK** |
| `public/js/02-state.js:24` getMyJobs | re-derives the OLD server ladder | client-side rule (C-0026) |
| `public/js/07-page-email.js:262/304/359` | RA-Lead filters every BD's emails in the browser | **client-side only** |
| `public/js/16-insights.js:~559` | bd_lead filters org-wide leads by subtree in the browser | **client-side only** |

## Decisions for the owner (raised 2026-09-23, not yet answered)
- **D1 — the candidate database.** Today every recruiting role sees every
  candidate, note, document and match. Industry norm (Bullhorn, Ceipal,
  JobDiva): one shared database, "owner" is credit, not visibility; contact
  details lock until assigned (PACE already does this on job pipelines).
  **Recommend: keep shared**; email TEXT on a candidate stays with the sender's
  team.
- **D2 — the client list.** Every BD sees every client, its contacts across all
  BDs' leads, its documents, and every BD's emails to it. Norm: company records
  shared, opportunities owned. **Recommend: client record shared; emails follow
  D-0034.**
- **D3 — job orders.** Shared today, and the recruiter job board is built on it.
  Norm: open reqs visible to the desk. **Recommend: keep shared.**
- **D4 — the RA Lead.** Decided in code as pool + own RAs' research + counts.
  The Email page's per-BD drill-down stops showing message text. **Recommend:
  confirm.** Re-open if RA Leads genuinely operate BDs' mail.
- **D5 — duplicate warnings.** Checking a prospect's email shows the other
  BD's contact, company and role. **Recommend: name who owns it and when, not
  the details.**

## Fragile — touch with care
- **`orgIdFor()`'s default-org fallback must stay.** The gate is in `auth()`.
- **A GLOBAL TABLE CAN HOLD TENANT ROWS.** `domain_events` is in
  `GLOBAL_TABLES`, and its payloads carry prospect addresses and record ids with
  **no org**. The 2026-09-09 audit called `routes/events.js` a false alarm on
  the table name alone — wrong. Judge the ROWS, not the list the table is in.
  (`app_settings` is the same shape: global table, per-user and secret rows.)
- **Unguessable ids are not a boundary.** `/events/recent` and
  `/wf/sending-mailboxes` hand out the very ids the by-id holes need.
- **Filter in SQL before `.limit()`, then apply the predicate.** Filtering after
  a limit makes pages silently short or empty.
- **`test/helpers/enter-app.mjs` has no `bd_lead`, `director` or
  `associate_director`** — and those three are exactly the roles D-0034 changes.

## Open here
- **Nothing in this audit is FIXED yet.** It is a map plus a callable rule.
  Contracts C-0021..C-0027 carry the work; C-0003, C-0015..C-0018 are still open.
- **Lead with C-0021 X1-X3 and C-0022's `outreach.js:98`, `candidates.js:266`,
  `submissions.js:25`** — secrets, sending as another company, and exfiltrating
  another company's resumes. These outrank the owner's in-org report.
- Mine to fix: `GET /users/:id/emails` (self, chain or admin). Not done — the
  Admin and distribution screens call it for other users and were not tested.
- `schema.sql` is stale (still describes `leads`); could not tell whether
  `emails.assigned_to` exists (`workflows.js:74`, `16-insights.js`).
- Owner should rotate the Groq key (seen in a transcript) — and, if X1 is
  confirmed live, **every `int_*` key**, since any logged-in user could read them.
- Per-role permissions do not exist; a tenant admin is a deployment operator.

## Log
- **2026-09-09** — org-scoping audit of 65 raw queries; `guardUser()`,
  `canTouchJob`, runtime `MULTI_ORG`; raised C-0015..C-0018. 70/70.
- **2026-09-23** — D-0034 visibility audit of every record-returning endpoint
  (index.js, routes/, routes/recruiting/) plus client-side filters. Added the
  pure "SEEING" rule to `services/ownership.js`. Scratch check 32/32 on the
  live org shape; 6/6 mutations caught; `ownership-smoke` 31/31 and all seven
  rampart suites green. Raised C-0021..C-0027. **What would have saved an
  hour:** reading `GET /app-settings` first — the worst finding was a
  three-line route that returns a whole table.
