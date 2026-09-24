// ============================================================================
// JOB ORDER VISIBILITY — D-0035: every job order is visible company-wide, but
// only its OWNER (plus their reporting chain, plus admin) sees the client's
// point of contact.
// ----------------------------------------------------------------------------
// The owner, answering rampart's D3 question, in their own words: "full job
// list shows all jobs in the company, but interaction is limited. just to
// candidate infomation, JD, job location, website and all. No POC details
// shown other than to owner."
//
// OWNER OF A JOB ORDER = `job_orders.bd_manager_id` — the one column the live
// schema (migration 011) uses to name who is responsible for the client
// relationship. `created_by`/`source_lead_id` are provenance, not ownership —
// a BD Manager can create a job order on someone else's behalf, or convert a
// lead somebody else worked, and the person who then owns the client
// conversation is whoever `bd_manager_id` names.
//
// A RECRUITER ASSIGNED TO THE JOB (recruiter_assignments) is NOT automatically
// in this set. D-0035 draws two separate lines: INTERACTION (add/work your own
// candidates) belongs to an assigned recruiter regardless of POC visibility,
// while SEEING the client's contact belongs to the owner and their manager
// chain. This file only ever hides the client's contact — it never touches
// interaction, and it never removes a candidate-facing field.
//
// PURE. No db, no request — the caller resolves the reporting chain
// (hierarchy.js `reportingChainIds`) and passes the ids in, the same shape
// `services/ownership.js` already uses, so this file never re-derives that
// walk and can never disagree with it about who manages whom.
//
// WHAT COUNTS AS "POC" TODAY. `job_orders` has no dedicated poc_email/
// poc_phone column — the only person-identifying field in the live schema is
// `client_manager` (the client-side hiring/engagement contact's name,
// migration 011). `client` / `end_client` / `client_job_id` name the CLIENT'S
// identity (a company), not a PERSON's, and stay visible — a recruiter needs
// to know which company a role is for to do candidate-facing work at all,
// which is exactly the line the owner drew ("candidate information, JD,
// location, website and all"). If a POC email/phone column is ever added to
// job_orders, add it to POC_FIELDS here — ONE list, so the list, detail and
// browse endpoints in routes/recruiting/job-orders.js cannot disagree about
// what "POC" means.
//
// NOTE FOR OTHER TERRITORIES: the client's actual contact record (name,
// email, phone) lives in `contacts`, hung off the originating lead
// (`jobs.job_id`, not `job_orders`) — routes/contacts.js and routes/jobs.js
// are gateway's, not read or joined by anything in this file. If either ever
// joins contact rows onto a job-order-shaped response, the same D-0035 rule
// applies there and belongs in a matching gateway-owned helper, not here.
// ============================================================================

// The one list. Add a column here, nowhere else, if job_orders ever grows a
// dedicated POC email/phone.
const POC_FIELDS = ['client_manager'];

/**
 * May this viewer see the job's client POC? `ownerIds` is the viewer's own id
 * plus their reporting chain (hierarchy.js `reportingChainIds`) — the same
 * "self + everyone under me" set D-0034 uses. Admin always may. A job with no
 * `bd_manager_id` (should not happen post-011, but a defensive default) is
 * visible to nobody but admin — fail closed, never fail open.
 */
function canSeeJobOrderPoc(job, { isAdmin, ownerIds } = {}) {
  if (!job) return false;
  if (isAdmin) return true;
  const bd = job.bd_manager_id;
  if (!bd) return false;
  return Array.isArray(ownerIds) && ownerIds.includes(bd);
}

/**
 * Returns a NEW object: POC_FIELDS nulled out unless the viewer may see them,
 * and a `poc_visible` boolean always attached so a screen can say "Client
 * contact visible to the job owner" rather than rendering a blank. Never
 * mutates the row passed in.
 */
function stripJobOrderPoc(job, ctx) {
  if (!job) return job;
  const visible = canSeeJobOrderPoc(job, ctx);
  const out = Object.assign({}, job, { poc_visible: visible });
  if (!visible) POC_FIELDS.forEach((f) => { if (out[f] !== undefined) out[f] = null; });
  return out;
}

/** Apply stripJobOrderPoc across a list. */
function stripJobOrdersPoc(jobs, ctx) {
  return (jobs || []).map((j) => stripJobOrderPoc(j, ctx));
}

/**
 * May this viewer ACT on the job order itself — edit its fields, delete it,
 * publish/unpublish the apply link? D-0035, the owner's own words: "Interaction
 * (edit, delete, publish apply link, workflow/stage actions on the job itself)
 * is the owner's; the recruiters ASSIGNED to the job keep adding/working their
 * own candidates on it." So this is deliberately NOT "any BDM role" (the gate
 * every one of those routes used before D-0035) and NOT an assigned recruiter
 * (who keeps `recruiterCanTouchJob` for pipeline/submission actions — a
 * different, narrower permission this file does not touch) — only the job's
 * `bd_manager_id`, their reporting chain, or admin.
 *
 * Same computation as canSeeJobOrderPoc today; kept as its own name because
 * "may see the contact" and "may edit the job" are two different questions
 * that happen to share an answer right now and are allowed to diverge later
 * without one silently changing the other's meaning.
 */
function isJobOrderOwner(job, ctx) { return canSeeJobOrderPoc(job, ctx); }

module.exports = {
  POC_FIELDS, canSeeJobOrderPoc, stripJobOrderPoc, stripJobOrdersPoc, isJobOrderOwner,
};
