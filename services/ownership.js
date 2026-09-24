// ============================================================================
// OWNERSHIP — whose work is this, and what may somebody else do about it?
// ----------------------------------------------------------------------------
// PURE. No db, no clock, no request. Everything is passed in, because who can
// see what is the one class of bug in this app that produces no error message
// and no visible symptom until a customer notices.
//
// WHY THIS EXISTS (Session 24, D-0020)
// The owner asked the question directly: *"reminders information is not just for
// one user who is responsible for it, its been showed to everyone and every user
// as a manager can interact with it… Maybe we can define what ownership or
// responsibility means."*
//
// It had never been defined. `/next-actions` scoped by the REPORTING CHAIN, so a
// manager's own daily list silently carried every report's reminders, unlabelled
// and mixed in with their own. Worse, each of those rows drew a **Done** button
// while the endpoint behind it correctly refused to close a reminder the caller
// does not own — so the button reported success, the toast said "Marked done",
// and the row came back on the next load. A thing you can see, appear to act on,
// and not actually change is worse than either showing it or hiding it.
//
// ── THE DEFINITION ──────────────────────────────────────────────────────────
// Every record has exactly ONE responsible person:
//
//     reminder / task   →  reminders.user_id        (who it was created for)
//     lead              →  jobs.assigned_to_bd
//     submission        →  submissions.recruiter_id
//     contact           →  the owner of the job it hangs off
//     job order         →  job_orders.bd_manager_id           (D-0035)
//     client            →  its job order's BD → its lead's BD → its creator
//                          (`recordOwnerId('client', …)`, section TAKING OVER)
//
// Ownership CHANGES only by a take-over request approved by the current
// owner's manager (D-0036/D-0037) — see section "TAKING OVER" at the foot.
//
// What ownership BUYS you: it appears on your daily list, and you can act on it.
// What it COSTS everyone else: nobody else's daily list carries your work, and
// nobody else can close it.
//
// A manager gets their own list, a COUNT of what is open beneath them, and a
// review screen where they can PROMPT the owner. They cannot do it for them.
// *Review and initiate* — the owner's own words — not reach in.
// ============================================================================

/**
 * Who is responsible for this queue item?
 *
 * `owner_id` is set by whichever builder produced the item (see next-action.js),
 * and is the reminder's user, the lead's BD, or the submission's recruiter. An
 * item with NO owner is nobody's work — it is treated as the viewer's, because
 * the alternative is a row that can never be seen or closed by anyone.
 */
function ownerOf(item, viewerId) {
  const owner = item && item.owner_id;
  return owner || viewerId || null;
}

/** Is this item the viewer's own work? */
function isMine(item, viewerId) {
  if (!viewerId) return false;
  return ownerOf(item, viewerId) === viewerId;
}

/**
 * Split a queue into what the viewer owns and what merely sits beneath them.
 *
 * Returns `{ mine, team }`. The DAILY LIST renders `mine` and nothing else;
 * `team` exists only to be counted and reviewed. That separation is the whole
 * decision — a to-do list containing other people's to-dos is not a to-do list.
 */
function splitByOwner(items, viewerId) {
  const mine = [];
  const team = [];
  for (const it of (items || [])) {
    (isMine(it, viewerId) ? mine : team).push(it);
  }
  return { mine, team };
}

/**
 * The one line a manager sees instead of their team's rows.
 *
 * `names` maps a user id to a display name. A count with no people named is
 * useless ("7 open across your team" — whose?), and naming everybody is a list
 * again, so it names up to three and counts the rest.
 */
function teamSummary(teamItems, names) {
  const items = teamItems || [];
  if (!items.length) return { total: 0, people: [], label: '', sentence: '' };

  const byOwner = new Map();
  for (const it of items) {
    const id = it.owner_id || 'unassigned';
    if (!byOwner.has(id)) byOwner.set(id, { owner_id: id, name: (names && names[id]) || 'Someone', count: 0 });
    byOwner.get(id).count += 1;
  }
  const people = [...byOwner.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  const total = items.length;

  const shown = people.slice(0, 3).map(p => `${p.name} (${p.count})`);
  const rest = people.length - shown.length;
  const who = shown.join(', ') + (rest > 0 ? `, and ${rest} other${rest === 1 ? '' : 's'}` : '');

  return {
    total,
    people,
    label: `${total} open across your team`,
    sentence: `${total} open across your team — ${who}.`
  };
}

/**
 * What may the viewer DO with this item?
 *
 * The only two answers are "act" (it is yours) and "prompt" (it is not). There
 * is deliberately no third answer that lets a manager close somebody else's
 * task: the case that would want it — somebody leaves, or goes on holiday — is
 * REASSIGNMENT, a change of who owns the record, and that is a different
 * feature with a different audit trail. See D-0020's "Re-open when".
 */
function actionsFor(item, viewerId) {
  return isMine(item, viewerId)
    ? { can_act: true, can_prompt: false, verb: 'act' }
    : { can_act: false, can_prompt: true, verb: 'prompt' };
}

/**
 * The note a prompt leaves on the owner's own list.
 *
 * It is written as a REMINDER for the owner — reusing the plumbing they already
 * read every morning rather than inventing a second inbox — and it always names
 * who asked. An anonymous "please action this" is how a nudge becomes noise.
 */
function promptNote({ fromName, title, subtitle, note }) {
  const who = String(fromName || 'Your manager').trim() || 'Your manager';
  const what = [title, subtitle].filter(Boolean).join(' · ');
  const lines = [`${who} asked you to pick this up.`];
  if (what) lines.push(what);
  if (note) lines.push(String(note));
  return lines.join('\n');
}

/**
 * May this viewer CLOSE this record? Returns null to allow, or the sentence to
 * refuse with.
 *
 * A FUNCTION rather than an `if` inside the route, for the reason already paid
 * for once this session (services/outreach-dedup.js callTaskSkipReason): a rule
 * pinned by grepping a route file for its condition goes on passing when that
 * condition is disabled with `if (false && …)`. A test that greps for source
 * text cannot tell a live rule from a dead one, so the rule lives where a test
 * can call it with real inputs.
 *
 * The refusal names what the viewer CAN do. "Not allowed" with no alternative is
 * how a person concludes the app is broken rather than that they asked for the
 * wrong thing.
 */
function closeRefusal(record, viewerId) {
  const owner = record && record.user_id;
  if (!owner || owner === viewerId) return null;
  return 'This reminder belongs to somebody else, so it is not yours to close. '
       + 'You can ask them to pick it up instead.';
}

// ============================================================================
// SEEING — who may LOOK at a record (Session 30, D-0034)
// ----------------------------------------------------------------------------
// Everything above is about ACTING. The owner found the other half on
// 2026-09-23, logged in as a BD Lead: *"in leads or in outreach all emails, full
// information is shown to all users … only the ones that they are responsible
// for or given to … but here its complete opposite."* Measured: BD Lead 1 owns
// 25 leads and saw 49 (`GET /jobs` handed every bd_lead every ASSIGNED lead in
// the org — written before the hierarchy existed), and Email → All email showed
// every user all 119 outreach emails. Nothing errored. Visibility bugs never do.
//
// D-0034 extends D-0020's definition of ownership from acting to seeing.
//
// ── THE ROLE → SCOPE TABLE ──────────────────────────────────────────────────
//
//   role                     sees records owned by…                 + the POOL
//   ───────────────────────  ─────────────────────────────────────  ──────────
//   admin                    the whole organisation (all: true)          yes
//   director                 self + reporting chain                      no
//   associate_director       self + reporting chain                      no
//   bd_lead                  self + reporting chain (their BDs and       no
//                            whoever reports to those BDs)
//   bd                       self (+ chain — recruiters report to BDs)   no
//   ra_lead                  self + reporting chain (their RAs)          YES
//   ra                       self (+ chain, if anyone reports to them)   no
//   recruiter                self (+ chain)                              no
//
// Two rules make the table, and the table is only their consequence:
//   1. **The CHAIN is the only thing that widens a view** — never the role. The
//      chain is `hierarchy.js` `reportingChainIds(userId, orgId)`: self plus
//      every direct and transitive report on `users.manager_id`. That helper is
//      the ONE breadth-first walk in PACE; never write a second.
//   2. **A role adds the POOL and nothing else.** The Unassigned pool is a lead
//      nobody owns yet (`assigned_to_bd` null), so ownership cannot place it on
//      anybody's desk. D-0034: it is seen by the roles that DISTRIBUTE it — and
//      the code says exactly who that is: `/distribute/pool-stats`,
//      `/distribute/generate-ratio`, `/distribute/execute` and `/jobs/bulk-assign`
//      are all `hasRole(req,'admin','ra_lead')`, and so are the assignment
//      fields on `PUT /jobs/:id`. bd_lead does NOT distribute (no /distribute
//      route admits it), so bd_lead does not see the pool.
//
// ── ra_lead, decided honestly ──────────────────────────────────────────────
// An RA Lead runs lead INTAKE: their RAs research leads (`jobs.created_by`),
// and they hand the finished pool to BDs. So they see (a) the pool, in full,
// because distributing it is their job; (b) everything their own RAs created,
// for the whole life of the lead, because reviewing research quality is their
// job; and (c) nothing else as a RECORD. Once a lead their team did not
// research is owned by a BD who does not report to them, it is that BD's desk.
// The send-operations work an RA Lead also does today (pausing a BD's sending,
// retrying a BD's queue, the per-BD picker on the Email page) needs COUNTS and
// statuses, not the text of another person's correspondence — aggregates are
// not records, and remain theirs. That consequence is visible on a screen, so
// it is listed for the owner rather than assumed (rampart.md, decision D4).
//
// ── WHAT GRANTS SIGHT OF WHAT ──────────────────────────────────────────────
//   lead      assigned_to_bd in scope (the OWNER, D-0020)
//             · or created_by / assigned_to in scope ("produced by you, or
//               given to you to research") — sight only; ACTING stays with the
//               owner, exactly as D-0020 says
//             · or it is unowned and the viewer distributes the pool
//   contact   whatever its lead is (D-0020: a contact's owner is its job's)
//   email     sent_by in scope · or the lead it was about is OWNED in scope.
//             Deliberately NOT the lead's creator and NOT the pool: an RA who
//             researched a lead does not read the BD's correspondence on it.
//             For the two pipelines not about a lead (email_tracking,
//             candidate_outreach) call it with no job: the sender's scope is
//             the rule until the owner decides whether candidates and clients
//             are shared records (rampart.md, decisions D1/D2).
//   submission recruiter_id or submitted_by in scope · or the job order's
//             bd_manager_id in scope ("Submitted to BDM" is a candidate GIVEN
//             to that BD)
//
// ── FAIL CLOSED ─────────────────────────────────────────────────────────────
// A scope that cannot be built sees NOTHING, never everything — the same rule
// as `applicants.forJob` with no job id. No user id → an empty view. A missing
// chain → self only. The only way to `all: true` is the admin role.
//
// ── HOW A ROUTE USES THIS ───────────────────────────────────────────────────
//   const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
//   const scope = own.viewScope({ role: req.user.role, roles: req.user.roles,
//                                 userId: req.user.id, chainIds: chain });
//   const ids = own.queryOwnerIds(scope);       // null = no owner filter
//   if (ids) q = q.in('sent_by', ids);          // narrow IN SQL, before .limit()
//   rows = rows.filter(r => own.canSeeEmail(r, jobsById[r.job_id], scope));
// Narrow in SQL first so a per-source `.limit()` is spent on rows the viewer can
// see (filtering AFTER a limit silently empties pages); then apply the
// predicate as the boundary. The predicate is the rule; the SQL is the speed.
// ============================================================================

/** Roles that distribute the Unassigned pool — mirrors the /distribute/* gates. */
const POOL_ROLES = Object.freeze(['admin', 'ra_lead']);

/**
 * A user's roles, read EXACTLY the way `middleware/authorize.js` `hasRole`
 * reads them: a non-empty `roles` array wins outright, otherwise the legacy
 * single `role`. Reading them any other way would let this file and the role
 * gates disagree about who is an admin.
 */
function rolesOf({ role, roles } = {}) {
  if (Array.isArray(roles) && roles.length) return roles.filter(Boolean).map(String);
  return role ? [String(role)] : [];
}

/**
 * The viewer's scope. PURE: the caller fetches the chain (hierarchy.js) and
 * passes it in, because this file never touches the database.
 *
 * Returns `{ all, userId, ownerIds, seesPool, label }` where `label` is the
 * same vocabulary `/next-actions` and `/reports/recruiting` already answer
 * with: 'org' | 'team' | 'own' | 'none'.
 */
function viewScope({ role, roles, userId, chainIds } = {}) {
  const rs = rolesOf({ role, roles });
  if (!userId) return { all: false, userId: null, ownerIds: [], seesPool: false, label: 'none' };
  if (rs.includes('admin')) return { all: true, userId, ownerIds: [userId], seesPool: true, label: 'org' };
  const ownerIds = [...new Set([userId, ...(Array.isArray(chainIds) ? chainIds : [])].filter(Boolean))];
  return {
    all: false,
    userId,
    ownerIds,
    seesPool: rs.some(r => POOL_ROLES.includes(r)),
    label: ownerIds.length > 1 ? 'team' : 'own',
  };
}

/** Is this person's work inside the viewer's scope? A null person never is. */
function inScope(personId, scope) {
  if (!scope) return false;
  if (scope.all) return true;
  if (!personId) return false;
  return (scope.ownerIds || []).includes(personId);
}

/** A lead nobody owns yet. Ownership (assigned_to_bd), not the stage label, decides. */
function isPoolLead(job) {
  return !!job && !job.assigned_to_bd;
}

/** May the viewer see this lead? See the header for why each clause exists. */
function canSeeLead(job, scope) {
  if (!job || !scope) return false;
  if (scope.all) return true;
  if (inScope(job.assigned_to_bd, scope)) return true;
  if (inScope(job.created_by, scope) || inScope(job.assigned_to, scope)) return true;
  return isPoolLead(job) && !!scope.seesPool;
}

/** A contact is seen with its lead (D-0020: a contact's owner is its job's owner). */
function canSeeContact(contact, job, scope) {
  if (!contact) return false;
  return canSeeLead(job, scope);
}

/**
 * May the viewer see this email? `job` is the lead it was about, or nothing
 * (individual sends, candidate outreach). Visible to the sender's scope and to
 * the scope of whoever OWNS the lead now — so a lead recycled from one BD to
 * another brings its history to the new owner.
 */
function canSeeEmail(email, job, scope) {
  if (!email || !scope) return false;
  if (scope.all) return true;
  if (inScope(email.sent_by, scope)) return true;
  return !!job && inScope(job.assigned_to_bd, scope);
}

/**
 * May the viewer see this submission (a candidate-on-job record)?
 * `jobOrder` is optional; pass it when the caller has it, so the BD a candidate
 * was submitted to can see it.
 */
function canSeeSubmission(sub, scope, jobOrder) {
  if (!sub || !scope) return false;
  if (scope.all) return true;
  if (inScope(sub.recruiter_id, scope) || inScope(sub.submitted_by, scope)) return true;
  const jo = jobOrder || sub.job_order || sub.job || null;
  return !!jo && inScope(jo.bd_manager_id, scope);
}

/** The owner ids to push into SQL (`.in(col, ids)`), or null for "no filter" (admin). */
function queryOwnerIds(scope) {
  if (!scope) return [];
  return scope.all ? null : [...(scope.ownerIds || [])];
}

/** The leads a viewer may see, from a list already scoped to their org. */
function scopeLeads(jobs, scope) {
  return (jobs || []).filter(j => canSeeLead(j, scope));
}

/**
 * The emails a viewer may see. `jobsById` is a Map or a plain object keyed by
 * job id; an email whose lead is not in it is judged on its sender alone.
 */
function scopeEmails(emails, jobsById, scope) {
  const get = (id) => {
    if (!id || !jobsById) return null;
    return typeof jobsById.get === 'function' ? (jobsById.get(id) || null) : (jobsById[id] || null);
  };
  return (emails || []).filter(e => canSeeEmail(e, get(e && e.job_id), scope));
}

// ============================================================================
// TAKING OVER — who may ASK to own a record, and who says yes (R-047, D-0037)
// ----------------------------------------------------------------------------
// D-0020 said ownership changes by REASSIGNMENT, not by a manager reaching in.
// D-0035 said a client changes owner only "by permission of the manager".
// D-0036 made that a request; D-0037 settled who approves it. This section is
// the ONE place that rule lives: the table (deep), the routes (gateway/guild)
// and the screens (surface) all call these functions and re-derive nothing.
//
// ── WHO OWNS WHAT (recordOwnerId) ──────────────────────────────────────────
//   kind        record shape                          owner
//   ──────────  ────────────────────────────────────  ─────────────────────────
//   lead        a `jobs` row                          assigned_to_bd
//   job_order   a `job_orders` row                    bd_manager_id
//   client      { company, jobOrders, leads }         newest live job order's
//                                                     bd_manager_id → newest
//                                                     live lead's assigned_to_bd
//                                                     → companies.created_by
// The client ladder is `routes/companies.js` `clientOwnerId()` step for step
// (and the copy in routes/recruiting/outreach.js). Those do three queries;
// this takes the three results as arguments and applies the same order —
// "newest" by created_at, rows with deleted_at or a null owner skipped. If
// that ladder ever changes, it changes HERE and both routes call this.
// Null = nobody owns it. An unknown kind THROWS: silently answering "unowned"
// would route the request to the asker's own manager, i.e. fail open.
//
// ── WHO MAY ASK (canRequestTakeover) ───────────────────────────────────────
// Checked in this order; the first failure is the answer.
//   1. The kind is lead / job_order / client.
//   2. SAME ORG, and the requester can SEE it. A record in another company, a
//      deleted one, and one the requester cannot see all answer the SAME
//      sentence with code 'not_found' — a route maps that to 404, because a
//      different answer confirms the record exists (rampart law 3).
//      Sight is the existing rule, never a new one: a lead → `canSeeLead`
//      (D-0034: own + chain; the pool only to distributors); a client or job
//      order → anyone in the org (D-0035: shared to see, owned to touch).
//   3. Not an admin. An admin can already reassign directly; an admin asking
//      would have to be approved by another admin, or by themselves.
//   4. They do not already own it.
//   5. Their role can own that kind — decided from how assignment works today:
//        lead       bd, bd_lead            (the Assign Leads picker, and the
//                                            BD stage gates in routes/jobs.js)
//        job_order  bd, bd_lead,            (`isBDM` in recruiting-core.js,
//        client     associate_director,      minus admin — see 3)
//                   director
//      An RA, RA Lead or recruiter owns none of the three, so cannot ask.
//   6. They have not already got a PENDING request open on this record (if
//      the caller passes `openRequests`). Somebody ELSE's pending request does
//      not block: the approver sees both and chooses.
//
// ── WHO APPROVES (approverFor) ─────────────────────────────────────────────
//   owned, owner has an active manager  → the OWNER's manager (their team is
//                                          losing it; same team = the asker's
//                                          manager too, so D-0036 still holds)
//   owned, owner has no manager         → an admin
//   unowned                             → the ASKER's manager, admin if none
//   the answer would be the asker       → an admin (nobody approves their own
//     (a manager asking for a report's    request)
//      record)
// "Has a manager" means `manager_id` names an ACTIVE, undeleted user in
// `usersById` (same org, if both carry org_id). A departed manager cannot
// approve anything, so it falls to an admin rather than to nobody.
// WHICH ADMIN, when there are several: the longest-serving active admin —
// earliest `created_at`, then smallest id — never the asker. Deterministic, so
// a retried request lands on the same desk. No admin at all → approverId null,
// and the route must refuse to create the request (it would sit forever).
//
// ── WHO DECIDES (canDecide) ────────────────────────────────────────────────
// The recorded approver, or an admin OF THE SAME ORG. Never the requester —
// not even an admin requester. Only a PENDING request can be decided.
// The requester may CANCEL their own pending request (canCancel); nobody else.
//
// ── THE STATES (takeoverTransition) ────────────────────────────────────────
//   pending → approved | declined | cancelled.   Nothing else, ever: the three
// outcomes are final, so a declined request cannot be re-approved by a second
// click — the asker opens a new request, and the history keeps both.
// Approving REASSIGNS through the existing assignment paths (for a lead,
// `releaseToPoolUpdate` / the assignment fields — never an inline write); this
// file only says whether it may happen.
// ============================================================================

const TAKEOVER_KINDS = Object.freeze(['lead', 'job_order', 'client']);

/** Roles that can OWN each kind. Admin is deliberately absent — see rule 3. */
const TAKEOVER_OWNER_ROLES = Object.freeze({
  lead:      Object.freeze(['bd', 'bd_lead']),
  job_order: Object.freeze(['bd', 'bd_lead', 'associate_director', 'director']),
  client:    Object.freeze(['bd', 'bd_lead', 'associate_director', 'director']),
});

const KIND_WORD = Object.freeze({ lead: 'lead', job_order: 'job order', client: 'client' });

const TAKEOVER_STATES = Object.freeze(['pending', 'approved', 'declined', 'cancelled']);
const TAKEOVER_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['approved', 'declined', 'cancelled']),
  approved: Object.freeze([]),
  declined: Object.freeze([]),
  cancelled: Object.freeze([]),
});

const NOT_FOUND_SENTENCE = 'We could not find that record.';

function assertKind(kind) {
  if (!TAKEOVER_KINDS.includes(kind)) {
    throw new Error(`ownership: unknown take-over kind "${kind}" (expected ${TAKEOVER_KINDS.join(' / ')})`);
  }
}

/** Newest-first by created_at (missing dates last), then id — deterministic. */
function newestFirst(a, b) {
  const ta = a && a.created_at ? Date.parse(a.created_at) : NaN;
  const tb = b && b.created_at ? Date.parse(b.created_at) : NaN;
  const va = Number.isNaN(ta) ? -Infinity : ta;
  const vb = Number.isNaN(tb) ? -Infinity : tb;
  if (va !== vb) return vb - va;
  return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
}

/**
 * The client ladder — `routes/companies.js` `clientOwnerId()` without the
 * queries. `jobOrders` / `leads` are that company's rows (org-scoped by the
 * caller); rows belonging to a different company_id are ignored.
 */
function clientOwnerFrom({ company, jobOrders, leads } = {}) {
  const cid = company && company.id;
  const mine = (r) => r && !r.deleted_at && (!cid || !r.company_id || r.company_id === cid);
  const jo = (jobOrders || []).filter(r => mine(r) && r.bd_manager_id).sort(newestFirst)[0];
  if (jo) return jo.bd_manager_id;
  const ld = (leads || []).filter(r => mine(r) && r.assigned_to_bd).sort(newestFirst)[0];
  if (ld) return ld.assigned_to_bd;
  return (company && company.created_by) || null;
}

/**
 * The one responsible person for a record, or null when nobody owns it.
 *   recordOwnerId('lead', jobsRow)
 *   recordOwnerId('job_order', jobOrderRow)
 *   recordOwnerId('client', { company, jobOrders, leads })
 */
function recordOwnerId(kind, record) {
  assertKind(kind);
  if (!record) return null;
  if (kind === 'lead') return record.assigned_to_bd || null;
  if (kind === 'job_order') return record.bd_manager_id || null;
  return clientOwnerFrom(record);
}

/** The row that carries org_id / deleted_at for a record of this kind. */
function recordRow(kind, record) {
  if (!record) return null;
  return kind === 'client' ? (record.company || null) : record;
}

/**
 * May `requester` ask to take this record over?
 *   requester: { id, role, roles, org_id }
 *   scope:     viewScope(...) for the same requester
 *   openRequests (optional): take-over requests already on this record
 * → { ok: true, reason: null, code: null, ownerId }
 * → { ok: false, reason: '<sentence>', code, ownerId }
 * code ∈ 'bad_kind' | 'not_found' | 'admin' | 'already_owner' | 'role' |
 *        'already_requested'. A route answers 'not_found' with a 404.
 */
function canRequestTakeover({ kind, record, requester, scope, openRequests } = {}) {
  const no = (code, reason, ownerId = null) => ({ ok: false, reason, code, ownerId });
  if (!TAKEOVER_KINDS.includes(kind)) return no('bad_kind', 'That kind of record cannot be taken over.');
  const word = KIND_WORD[kind];

  // 2. same org + can see. Every failure here reads identically.
  const row = recordRow(kind, record);
  const rid = requester && requester.id;
  if (!rid || !row || row.deleted_at) return no('not_found', NOT_FOUND_SENTENCE);
  if (!row.org_id || !requester.org_id || row.org_id !== requester.org_id) return no('not_found', NOT_FOUND_SENTENCE);
  if (!scope || scope.userId !== rid) return no('not_found', NOT_FOUND_SENTENCE);
  const sees = kind === 'lead' ? canSeeLead(row, scope) : true; // D-0035: clients & job orders are shared to see
  if (!sees) return no('not_found', NOT_FOUND_SENTENCE);

  const ownerId = recordOwnerId(kind, record);
  const rs = rolesOf(requester);

  // 3. admin
  if (rs.includes('admin')) {
    return no('admin', `As an admin you can reassign this ${word} directly — there is nobody above you to ask.`, ownerId);
  }
  // 4. already theirs
  if (ownerId && ownerId === rid) return no('already_owner', `This ${word} is already yours.`, ownerId);
  // 5. role can own the kind
  const allowed = TAKEOVER_OWNER_ROLES[kind];
  if (!rs.some(r => allowed.includes(r))) {
    return no('role', `Only business-development roles look after a ${word}, so your role cannot take one over. `
      + 'You can still ask its owner to pick something up.', ownerId);
  }
  // 6. no duplicate pending request from the same person
  const dup = (openRequests || []).some(q => q && q.status === 'pending' && q.requester_id === rid);
  if (dup) return no('already_requested', `You have already asked to take over this ${word}. It is waiting for a decision.`, ownerId);

  return { ok: true, reason: null, code: null, ownerId };
}

function isLiveUser(u, orgId) {
  if (!u || !u.id) return false;
  if (u.deleted_at) return false;
  if (u.is_active === false) return false;
  if (orgId && u.org_id && u.org_id !== orgId) return false;
  return true;
}

function lookup(usersById, id) {
  if (!id || !usersById) return null;
  return typeof usersById.get === 'function' ? (usersById.get(id) || null) : (usersById[id] || null);
}

function nameOf(usersById, id, fallback) {
  const u = lookup(usersById, id);
  return (u && u.name && String(u.name).trim()) || fallback;
}

/**
 * The deterministic admin: longest-serving active admin (earliest created_at,
 * then smallest id), never `excludeId`. Null when there is none.
 */
function pickAdmin(adminIds, usersById, excludeId, orgId) {
  const cands = [...new Set((adminIds || []).filter(Boolean))]
    .filter(id => id !== excludeId)
    .map(id => lookup(usersById, id) || { id })
    .filter(u => isLiveUser(u, orgId));
  if (!cands.length) return null;
  cands.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : NaN;
    const tb = b.created_at ? Date.parse(b.created_at) : NaN;
    const va = Number.isNaN(ta) ? Infinity : ta;
    const vb = Number.isNaN(tb) ? Infinity : tb;
    if (va !== vb) return va - vb;
    return String(a.id).localeCompare(String(b.id));
  });
  return cands[0].id;
}

/**
 * Who approves this request (D-0037).
 *   owner:     the current owner's user id, or null when unowned
 *   requester: the asker's user id
 *   usersById: Map or object of { id, name, manager_id, is_active, deleted_at,
 *              org_id, created_at } — the org's users
 *   adminIds:  the org's admin user ids
 * → { approverId, basis, why }
 * basis ∈ 'owner_manager' | 'owner_no_manager' | 'unowned_requester_manager' |
 *         'unowned_no_manager' | 'self_approval' | 'no_approver'
 * approverId is null only with basis 'no_approver' — refuse to create then.
 */
function approverFor({ owner, requester, usersById, adminIds } = {}) {
  const reqUser = lookup(usersById, requester);
  const orgId = (reqUser && reqUser.org_id) || null;
  const reqName = nameOf(usersById, requester, 'the person asking');

  const managerOf = (id) => {
    const u = lookup(usersById, id);
    const mid = u && u.manager_id;
    if (!mid || mid === id) return null;
    const m = lookup(usersById, mid);
    return isLiveUser(m, orgId) ? mid : null;
  };
  const toAdmin = (basis, lead) => {
    const aid = pickAdmin(adminIds, usersById, requester, orgId);
    if (!aid) {
      return { approverId: null, basis: 'no_approver',
        why: `${lead} and there is no admin who can decide it, so this request cannot be sent yet.` };
    }
    return { approverId: aid, basis,
      why: `${lead}, so it goes to ${nameOf(usersById, aid, 'an admin')}, an admin.` };
  };

  let basis, approverId, why;
  if (owner) {
    const ownerName = nameOf(usersById, owner, 'its owner');
    const mid = managerOf(owner);
    if (!mid) return toAdmin('owner_no_manager', `${ownerName} owns this and has no manager in PACE`);
    basis = 'owner_manager';
    approverId = mid;
    why = `${ownerName} owns this, and ${nameOf(usersById, mid, 'their manager')} manages ${ownerName}, so they decide.`;
  } else {
    const mid = managerOf(requester);
    if (!mid) return toAdmin('unowned_no_manager', `Nobody owns this yet and ${reqName} has no manager in PACE`);
    basis = 'unowned_requester_manager';
    approverId = mid;
    why = `Nobody owns this yet, so ${reqName}'s manager, ${nameOf(usersById, mid, 'their manager')}, decides.`;
  }
  if (approverId === requester) {
    return toAdmin('self_approval', `${reqName} would be approving their own request`);
  }
  return { approverId, basis, why };
}

function deciderRoleList(deciderRoles) {
  if (Array.isArray(deciderRoles)) return deciderRoles.filter(Boolean).map(String);
  if (typeof deciderRoles === 'string') return [deciderRoles];
  if (deciderRoles && typeof deciderRoles === 'object') return rolesOf(deciderRoles);
  return [];
}

/**
 * Move a request between states. → { ok, reason }
 * pending → approved | declined | cancelled; everything else is refused.
 */
function takeoverTransition(from, to) {
  if (!TAKEOVER_STATES.includes(from) || !TAKEOVER_STATES.includes(to)) {
    return { ok: false, reason: 'That is not a state a take-over request can be in.' };
  }
  if (!TAKEOVER_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: from === 'pending'
      ? 'A waiting request can only be approved, declined or withdrawn.'
      : `This request was already ${from}, so it cannot be changed. Ask again if something has changed.` };
  }
  return { ok: true, reason: null };
}

/**
 * May this person approve or decline the request? → { ok, reason }
 *   request:      { requester_id, approver_id, status, org_id }
 *   deciderRoles: ['admin', …] | 'admin' | { role, roles }
 *   deciderOrgId: required for the admin path when the request carries org_id
 * The recorded approver, or an admin of the same org. Never the requester.
 */
function canDecide({ request, deciderId, deciderRoles, deciderOrgId } = {}) {
  if (!request || !deciderId) return { ok: false, reason: NOT_FOUND_SENTENCE };
  if (request.requester_id && request.requester_id === deciderId) {
    return { ok: false, reason: 'You cannot decide your own request — somebody else has to.' };
  }
  const st = takeoverTransition(request.status, 'approved');
  if (!st.ok) return st;
  if (request.approver_id && request.approver_id === deciderId) return { ok: true, reason: null };
  const isAdmin = deciderRoleList(deciderRoles).includes('admin');
  const sameOrg = !request.org_id || (deciderOrgId && deciderOrgId === request.org_id);
  if (isAdmin && sameOrg) return { ok: true, reason: null };
  if (isAdmin && !sameOrg) return { ok: false, reason: NOT_FOUND_SENTENCE };
  return { ok: false, reason: 'This request is waiting for somebody else to decide it.' };
}

/** Only the requester may withdraw, and only while it is pending. → { ok, reason } */
function canCancel({ request, actorId } = {}) {
  if (!request || !actorId) return { ok: false, reason: NOT_FOUND_SENTENCE };
  if (request.requester_id !== actorId) {
    return { ok: false, reason: 'Only the person who asked can withdraw this request.' };
  }
  return takeoverTransition(request.status, 'cancelled');
}

module.exports = {
  ownerOf, isMine, splitByOwner, teamSummary, actionsFor, promptNote, closeRefusal,
  // seeing (D-0034)
  POOL_ROLES, rolesOf, viewScope, inScope, isPoolLead,
  canSeeLead, canSeeContact, canSeeEmail, canSeeSubmission,
  queryOwnerIds, scopeLeads, scopeEmails,
  // taking over (R-047, D-0037)
  TAKEOVER_KINDS, TAKEOVER_OWNER_ROLES, TAKEOVER_STATES, TAKEOVER_TRANSITIONS,
  recordOwnerId, clientOwnerFrom, canRequestTakeover, approverFor, pickAdmin,
  canDecide, canCancel, takeoverTransition,
};
