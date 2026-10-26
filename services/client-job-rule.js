'use strict';
// ============================================================================
// WHO MAY OPEN A JOB FOR AN EXISTING CLIENT (D-0174, owner 26 Oct 2026).
//
// "If the client belongs to a user, they should be allowed to open another job — any number of jobs with the same client,
// regardless of the timeline. Only the client owner can create multiple jobs with the same client."
//
//   · the client's OWNER  → always allowed, no waiting period;
//   · the owner's MANAGER (D-0177, owner 26 Oct: "managers create jobs and follow business workflow") → allowed: someone the
//     owner reports to, directly or higher up (hierarchy.js reportingChainIds), opens jobs for their team's clients. The job
//     stays in the owner's pipeline — the route makes the OWNER its BD manager, so the client does not change hands;
//   · an ADMIN who is neither → refused (D-0176: "the admin job is just control, not creation of any job");
//   · anyone else → refused, naming the owner — the client is reassigned or taken over first (the "Ask to take over" flow,
//     R-047), never worked around;
//   · a client NOBODY owns → the company re-add cooldown still applies (services/company-cooldown.js).
//
// Who owns a client is the ONE ladder in services/ownership.js (clientOwnerFrom). `loadClientOwnerId` is only the three
// small queries that feed it — shared by routes/companies.js and routes/recruiting/job-orders.js so the form's warning and
// the save can never disagree. `decide` is pure.
// ============================================================================
const own = require('./ownership');

async function loadClientOwnerId({ supabase, withOrg, req, companyId }) {
  const { data: co } = await withOrg(supabase.from('companies').select('id,created_by').eq('id', companyId), req).maybeSingle();
  if (!co) return null;
  const { data: jos } = await withOrg(supabase.from('job_orders')
    .select('bd_manager_id,created_at,company_id,deleted_at').eq('company_id', companyId)
    .is('deleted_at', null).not('bd_manager_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1), req);
  const { data: leads } = await withOrg(supabase.from('jobs')
    .select('assigned_to_bd,created_at,company_id,deleted_at').eq('company_id', companyId)
    .is('deleted_at', null).not('assigned_to_bd', 'is', null)
    .order('created_at', { ascending: false }).limit(1), req);
  return own.clientOwnerFrom({ company: co, jobOrders: jos || [], leads: leads || [] });
}

// → { allowed: true, why: 'owner' | 'manager' | 'no_owner', jobOwnerId? }  or  { allowed: false, why: 'not_owner', sentence }
// `callerManagesOwner`: the owner is in the caller's reporting chain AND the caller is not acting as an admin (the route works
// that out — callerManages()). `cooldownBlocked` is only consulted when nobody owns the client.
function decide({ ownerId, callerId, ownerName, company, cooldownBlocked, callerManagesOwner }) {
  if (ownerId && ownerId === callerId) return { allowed: true, why: 'owner' };
  if (ownerId && callerManagesOwner) return { allowed: true, why: 'manager', jobOwnerId: ownerId };
  if (ownerId) {
    const who = ownerName || 'another person';
    return { allowed: false, why: 'not_owner',
      sentence: `${company || 'This client'} belongs to ${who}. Only the client's owner (or their manager) can open jobs for it — ask ${ownerName || 'them'} to open it, or ask to take the client over.` };
  }
  return cooldownBlocked ? { allowed: false, why: 'cooldown' } : { allowed: true, why: 'no_owner' };
}

// Is the caller the owner's MANAGER for this rule? The owner sits under them on the reporting tree, and they are not acting as
// an admin (D-0176: an admin's part is control; someone who is BOTH an admin and a BD manager still manages their own team).
//   chainIds   reportingChainIds(caller) — the caller plus everyone under them
//   roles      the caller's roles
function callerManages({ ownerId, callerId, chainIds, roles }) {
  if (!ownerId || ownerId === callerId) return false;
  const rs = (roles || []).filter(Boolean);
  const managesAsBd = rs.some((r) => ['bd', 'bd_lead', 'associate_director', 'director'].includes(r));
  if (!managesAsBd) return false;
  return (chainIds || []).includes(ownerId);
}

module.exports = { loadClientOwnerId, decide, callerManages };
