# Rampart — memory
> Last written: 2026-09-24 · review of the R-047 take-over build (server, 047, duplicate responses, surface 56)

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
- **THE TAKE-OVER RULE IS CALLABLE (R-047, D-0037, 2026-09-24):
  `services/ownership.js`, section "TAKING OVER".** PURE. deep builds the table,
  gateway/guild the routes, surface the screens — all ON these, re-deriving none.
  * `recordOwnerId(kind, record)` — lead → `assigned_to_bd`; job_order →
    `bd_manager_id`; client → `{company, jobOrders, leads}` through
    `clientOwnerFrom` = `routes/companies.js` `clientOwnerId()` ladder without
    the queries (newest live JO's BD → newest live lead's BD → `created_by`).
    **Unknown kind THROWS** — "unowned" would route to the asker's own manager.
  * `canRequestTakeover({kind, record, requester, scope, openRequests?})` →
    `{ok, reason, code, ownerId}`. Order: kind · same org + can SEE (lead →
    `canSeeLead`; client/JO → shared, D-0035) · not admin · not owner · role
    can own (lead: bd, bd_lead; JO/client: bd, bd_lead, associate_director,
    director) · no own pending duplicate. **Every sight/org/deleted miss is the
    SAME sentence, code `not_found` → route answers 404** (law 3).
  * `approverFor({owner, requester, usersById, adminIds})` →
    `{approverId, basis, why}`: owner's live manager · owner no manager → admin
    · unowned → asker's manager, else admin · would be the asker → admin.
    **Which admin: longest-serving live admin (earliest `created_at`, then
    smallest id), never the asker.** No live admin → `approverId: null`,
    basis `no_approver` → route must refuse to create.
  * `canDecide({request, deciderId, deciderRoles, deciderOrgId})` — recorded
    approver, or admin OF THE SAME ORG (no `deciderOrgId` → refused, fail
    closed). Never the requester, admin or not. Pending only.
    `canCancel({request, actorId})` — requester only, pending only.
  * `takeoverTransition(from, to)` — pending → approved|declined|cancelled;
    the three outcomes are FINAL (re-ask = new row).
  * **~~A consequence the owner has not seen~~ — answered by D-0038
    (2026-09-24):** a BD could not ask for a peer's / pool lead because they
    cannot SEE it. The owner chose "from the duplicate warning". Option
    **`viaDuplicateEmailMatch`** (name fixed — gateway's
    `routes/ownership-requests.js` passes it): when **literally `true`** it
    stands in for lead SIGHT only. Org, deleted, scope-owner, admin,
    already_owner, role and already_requested all still apply; clients/job
    orders ignore it; `not_found` wording is unchanged for every miss.
    **REVIEW POINT for gateway's route:** the flag may be set ONLY after the
    route matched the typed email against that lead's contacts IN THE DB,
    org-scoped — never from a request body field. The asker still never sees
    the lead's details (the approver does); the route's error for a non-match
    must be the same 404 as a nonexistent lead.
  * Scratch check (83 assertions, 16 for D-0038) + **13 + 5 reintroduced
    bugs, all caught** (D-0038's: flag honoured for job_order/client, honoured
    when unset, honoured on truthy non-`true`, flag skipping the org check,
    flag short-circuiting role/admin). Not yet a committed suite; list handed
    to foundry.
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

## REVIEW OF THE FIXES — 2026-09-24 (verdict: do-not-ship until #1 and #2 are fixed — one line each — then ship-with-followups)
Read the code of every commit after `5738e08`, not the messages. Rampart's
seven suites + ownership/scope suites green (13, 5, 17, 53, 44, 56, 26, 69,
14, 50, 35, 14).
**Verified closed:** X1/X2 `/app-settings` (allow-list, admin-only write) ·
X3 `userOrgId`/`mailboxOrgId` on `PUT /jobs/:id`, `/distribute/execute`,
`/jobs/bulk-assign` · X4 `/events/recent` (payload `orgId`; unstamped rows
hidden) · X5 client docs/edit/delete org-bound · X6/X8 jobs research/parse-jd/
skill history · X7 `/follow-ups` · `GET /jobs`, `/jobs/:id` (404), export ·
contacts email-status · record-history (404) · today-summary · `GET /emails`
(SQL narrowing + `scopeEmails` boundary; sender-summary counts only) ·
pending-summary · DELETE/purge (org + status ON the write) · suppression
list/delete · analytics/templates · deliverability · warmup (+partners same
org) · gmail/microsoft slot checks · tracking.js (body per `canSeeEmail`,
token no longer handed out) · candidates/*, pipeline/*, submissions/*,
sourcing import, recruiting lookups, interview invite/meeting org-bound ·
`resolveEmailAttachments` org-bound · wf.js org-bound · insights 404 ·
bd-analytics chain+org · recruiting-dashboard RA/RL · duplicate checks (D5:
owner + date only) · job-order POC strip on list/detail/browse · job-order
edit/delete/apply-link owner-only · outreach pickers + lead ownership.

**Defects found (not rampart's files — reported to the orchestrator):**
1. HIGH regression — `routes/recruiting/outreach.js`: the fix deleted
   `const MAX_EMAIL_ATTACH_BYTES`; line ~168 still reads it inside a
   try/catch, so EVERY document attachment (candidate and client email) is
   silently dropped and the email sends without it.
2. HIGH in-org leak — `routes/email-history.js` `visibleJobIds` uses
   `canSeeLead` (creator, `assigned_to`, pool) where the rule is
   `canSeeEmail` (lead OWNED in scope). An RA reads every BD email body on a
   lead they researched; an RA Lead reads the old BD's emails on recycled
   pool leads and on their RAs' leads — exactly what D-0036 forbids.
3. MED ownership hijack — `POST /job-orders/from-lead/:jobId`: any BDM
   converts ANY Connected lead, `bd_manager_id` from the body unvalidated;
   since `clientOwnerId` prefers `job_orders.bd_manager_id`, converting a
   colleague's lead takes their client (POC, docs, email rights).
4. MED D-0035 writes not owner-gated: `POST /companies/:id/merge`,
   `POST /jobs/bulk-stage` (any BD, any lead id), `DELETE /submissions/:id`
   and `DELETE /pipeline/:id` (any recruiter), `POST /job-orders/:id/parse-jd`
   `?apply=1` (any BDM; also returns unstripped `client_manager`),
   `POST /job-orders/:id/recruiters` + assignment decide (any BDM).
5. MED `DELETE /companies/:id` widened to "owner": no role gate, owner falls
   back to `companies.created_by` (an RA), and one owner can soft-delete a
   client colleagues still hold leads on. D-0035 lists edit/documents/email/
   contacts, not delete.
6. MED `/companies/:id/contacts` and `/intake` still return every BD's POCs
   at a client — D-0035/D5 say another BD's contact details are not shown.
7. LOW `POST /suppression` (deliverability.js:72) does not pass the org to
   `addToSuppression` → misfiled under the DEFAULT org, where that org's admin
   can see and DELETE another company's opt-out.
8. LOW `GET /users/:id/job-orders` returns `client_manager` unstripped.
9. LOW `PUT /jobs/:id` grants EDIT on anything `canSeeLead` admits (creator/
   `assigned_to` in chain) — use `inScope(assigned_to_bd)`; D-0020 says a
   manager reviews and prompts, the comment widens it to "review and edit".
10. LOW `/wf/enrollments` filters after `.limit(500)` (short pages).
11. PRE-EXISTING, HIGH — the OAuth callbacks in `routes/microsoft.js` and
   `routes/gmail.js` interpolate `userEmailId` from the UNSIGNED `state` into
   an inline `<script>` string: reflected XSS on the app's origin. The new
   org check trusts the same forgeable state (userId + slot both attacker-
   chosen), so it adds nothing; sign the state (HMAC) and JSON-encode.
X9 is recorded (C-0021, gateway.md) but has no `docs/ROADMAP.md` row — D-0030
says every suggestion to the owner is one. C-0029 is recorded, OPEN.

## REVIEW OF R-047 TAKE-OVER — 2026-09-24 (verdict: DO-NOT-SHIP as built)
Read b05d1f3 (gateway), 9b0376f (guild), a9c8b05 (deep 047), 5ec3ef7 (surface).
Suites green: 7 rampart + ownership 69 + models + ownership-requests 31 +
route-shadowing 9.
**Verified correct:** `viaDuplicateEmailMatch` is set ONLY by
`emailMatchesLead` (org-scoped `contacts` by `job_id`, case-folded); no body
boolean is read; a non-match is the same 404 + body (POST) / same sentence
(can-request) as a missing lead; `record_label` for that path is "A lead with
<typed email>"; mine box carries no lead details; `box=record` 404s a lead the
viewer cannot see; every read/write is `db.forRequest`; approve = `canDecide`
(same org) + requester active + live owner re-check + `.eq('status','pending')`;
client move filtered by the OLD owner on both JOs and leads; a request cannot
point at another org's record (row and record both loaded org-scoped). 047
matches 039 (RLS + `service_all_*`), constraints sound, registered TENANT.
**BLOCKERS — the new `lead_id` on duplicate responses hands a lead id to
exactly the people D-0034 hides that lead from, and three PRE-EXISTING routes
act on any job id with no org or owner check:**
- B1 CRITICAL `index.js` `POST /emails/reminder-send` (~:835): `job_id` from
  the body, raw fetch, no org/owner check; queues `sent_by=caller` and the send
  loop (~:1863) sends from `job.sending_email_id` — **the lead owner's mailbox
  (another company's, given a foreign id), arbitrary recipient and body.** The
  filled body (pos/company) is then readable in the caller's own GET /emails.
  Insert has no org_id → misfiles to the default org.
- B2 HIGH `routes/reminders.js` `POST /reminders` (:189, ledger): `job_id` and
  `contact_id` unvalidated; `GET /reminders` embeds `job:jobs(position,
  location, company…)` and `contact:contacts(email, phone, linkedin…)` —
  embedded joins are NOT org-filtered. Any lead's details for any id.
- B3 HIGH `index.js` `POST /emails/generate` (~:1090): `.in('id', job_ids)`
  no org/owner; queues cold emails under the owner's mailbox; a POOL lead
  queues `sent_by=caller` (body readable); insert unstamped.
Fix: `canTouchJob` + org on all three (and contact_id org-checked). Cheapest
R-047-side mitigation: drop `lead_id` from both duplicate responses and let
can-request/POST resolve the lead from `via_email` server-side.
**Other findings:** M1 approve flips to `approved` BEFORE reassigning; the
reassign writes ignore errors and are not conditional on the old owner (a
distribute in between is overwritten; a failed write still says "approved —
reassigned"). M2 client whose owner comes from `created_by` fallback (or
unowned): approved, nothing moves, owner unchanged. L1 approve does not
re-check the record is live or the requester's role. L2 `orgUsers`/
`isActiveOrgUser` raw `supabase.from('users')` (law 2; scoped by hand, correct
today). L3 `via_email` in a GET query string (prospect address in logs). L4
`clientOwnerId` (companies.js, outreach.js) now fetches every JO/lead of a
company unordered/unbounded — was order+limit 1. L5 `/contacts/check-email`
still returns the matched lead's `company` (D5 said owner+date). 047: add
`CHECK (status='pending' OR decided_by IS NOT NULL)`; table count is 49 once
applied — law 6's "48" must move with it.
**Surface (56 + call sites):** F1 MED JS-string injection — `esc()`/`htmlEsc()`
inside `onclick="…('…')"` (56 otSlotInner viaEmail + approverName; 14/52 email)
escape neither `'` nor anything that matters AFTER the attribute is decoded:
"O'Brien" breaks the button; a contact email `x');…//@a.co` passes EMAIL_RE →
stored XSS on any BD who hits the duplicate. Use data-attributes. F2 the
duplicate link is drawn from guild's `can_request` (= "not the owner"), so
RA/recruiter/admin see a link that refuses — compute it with
`canRequestTakeover(…, viaDuplicateEmailMatch:true)`. F3 modal reads `can.why`
(null on refusal; server sends `reason`); chip maps `withdrawn`, status is
`cancelled`. Text renders of label/note/names all go through `esc()` — OK.

## RE-REVIEW OF THE FIXES — 2026-09-24, round 2 (verdict: ship-with-followups; land R1 in the same PR)
Read `git diff 71a8006..HEAD` (fb3658b gateway, 1671962 guild, c7b8e6f
harbour, fbd3f5b observatory). Rampart suites + ownership (69) + email-history
(32) green.
**Closed:** #1 (constant restored) · #2 SQL now `inScope(assigned_to_bd)` +
`scopeEmails` final gate · #3 from-lead owner-gated, `bd_manager_id` must be
self/chain in org · #4 merge (owner on BOTH), bulk-stage (bd narrowed, foreign
ids silently dropped), submission/pipeline delete, parse-jd apply, recruiters
assign (+ ids must be in org), decide · #5 admin-only + org 404 · #6
contacts/intake via `canSeeLead` · #7 both suppression writers carry the org
(`loadAnswerRow` selects `org_id`) · #8 stripped · #9 edit = `inScope(owner)`,
unseeable = 404 · #10 batched paging · #11 state is a JWT, every popup value
JSON-encoded with `<` escaped; sign-in states carry `p:'signin'` so the two
flows still separate correctly.
**New:**
- R1 MED regression (fail-CLOSED) — `routes/email-history.js` `LEAD_SELECT`
  does not select `sent_by`, so the new `scopeEmails` gate reads it as
  undefined and the "I sent it" half of `canSeeEmail` is dead: a BD's own
  emails vanish from All email once the lead is reassigned or RECYCLED to the
  pool (the 30-day recycler makes that routine). Proven with ownership.js
  directly. One word: add `sent_by` to `LEAD_SELECT`. No test covers it.
- R2 LOW-MED — `DELETE /job-orders/:id/recruiters/:rid` (job-orders.js:778):
  any BDM, no owner gate, no 404 for an unknown job. In-org only (withOrg on
  the delete). Same class as #4; gate with `isJobOrderOwner(pocScope)`.
- R3 LOW — submission/pipeline delete lets an assigned recruiter delete a
  COLLEAGUE recruiter's row on a shared job (`|| recruiterCanTouchJob`);
  D-0035 says "their own candidates".
- R4 LOW — `ownedJobMap` selects every org lead unbounded (PostgREST caps at
  1,000): fail-closed truncation on a large org. `/wf/enrollments` now walks
  the whole org's table for a user who can see little.
- R5 INFO — the mailbox OAuth state is a JWT_SECRET token with no purpose
  claim; `auth()` would accept it as a session (no id/role/org → refused
  once MULTI_ORG; harmless, but token confusion). Add `p:'mailbox'`, require
  it on verify, and have `auth()` reject any token carrying `p`.
- Behaviour change, intended: a BD who only CREATED a lead can no longer edit
  it via `PUT /jobs/:id` (the frontend only edits own leads' stage/notes).

## Decisions for the owner (raised 2026-09-23 — ANSWERED by D-0035/D-0036)
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
- **R-047 blockers B1-B3** (reminder-send, POST /reminders, /emails/generate —
  body `job_id` with no owner/org check) + F1 (onclick injection). See review.
- **All eleven review findings are closed** (round 2, 2026-09-24). Open:
  R1 (one word, should land before merge), R2-R5 follow-ups — see above.
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
- **2026-09-24 (R-047 review)** — do-not-ship: `lead_id` on duplicate
  responses reaches three pre-existing job-id routes with no owner/org check
  (reminder-send sends from the owner's mailbox). **What would have saved
  time:** when a change HANDS OUT a new id, grep every route that accepts that
  id in a BODY (`req.body.job_id`), not just the `/:id` routes — the `/:id`
  ones were all fixed in the audit; the body ones never were.
- **2026-09-24 (R-047)** — wrote the take-over rule as pure functions in
  `ownership.js`. **What would have saved time:** a fixture lead with
  `created_by` = an RA in the asker's chain is VISIBLE to that asker (D-0034
  research sight), so my "cross-team lead is invisible" case first failed on
  the fixture, not the rule — seed sight-granting fields deliberately.
- **2026-09-24 (round 2)** — re-reviewed the eleven fixes by reading the
  diff. All closed; one new fail-closed regression (R1). **What would have
  saved an hour:** when a fix adds a predicate over fetched rows, check the
  SELECT list carries every field the predicate reads — a missing column is
  `undefined`, and `undefined` fails every ownership test silently.
- **2026-09-09** — org-scoping audit of 65 raw queries; `guardUser()`,
  `canTouchJob`, runtime `MULTI_ORG`; raised C-0015..C-0018. 70/70.
- **2026-09-24** — reviewed every C-0021..C-0029 fix against the audit by
  reading code. Verdict do-not-ship until 2 blockers fixed (attachment
  regression, email-history predicate), 9 more. **What would have saved an
  hour:** grepping every identifier a fix DELETED — a removed constant inside
  a try/catch is a silent regression no suite noticed.
- **2026-09-23** — D-0034 visibility audit of every record-returning endpoint
  (index.js, routes/, routes/recruiting/) plus client-side filters. Added the
  pure "SEEING" rule to `services/ownership.js`. Scratch check 32/32 on the
  live org shape; 6/6 mutations caught; `ownership-smoke` 31/31 and all seven
  rampart suites green. Raised C-0021..C-0027. **What would have saved an
  hour:** reading `GET /app-settings` first — the worst finding was a
  three-line route that returns a whole table.


