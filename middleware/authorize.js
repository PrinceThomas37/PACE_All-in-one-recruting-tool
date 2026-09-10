// ============================================================================
// AUTHORIZATION HELPERS
// ----------------------------------------------------------------------------
// The Supabase client uses the service-role key, which bypasses row-level
// security, so every route must enforce authorization in application code.
// These helpers were previously defined inline in index.js and are moved here
// verbatim (behaviour unchanged) so authorization lives in one place.
//
// Factory form because canTouchJob needs the Supabase client:
//   const { hasRole, canTouchJob, requireRole } =
//     require('./middleware/authorize')({ supabase });
// ============================================================================

module.exports = function createAuthorize({ supabase }) {
  // Role helper — works with both old single role and new roles array.
  function hasRole(req, ...roles) {
    const u = req.user;
    if (!u) return false;
    // New: roles array
    if (Array.isArray(u.roles) && u.roles.length) {
      return roles.some(r => u.roles.includes(r));
    }
    // Legacy: single role field
    return roles.includes(u.role);
  }

  // Ownership check for a job by id (admins bypass — WITHIN THEIR OWN ORG).
  //
  // The admin bypass used to return true before the row was ever read, so an
  // admin of company B was authorised to touch any lead in company A just by
  // pasting its id — and this helper gates contact create/update/delete and the
  // follow-up routes, i.e. real writes on somebody else's data.
  //
  // The non-admin path was accidentally safe (a foreign job's created_by /
  // assigned_to / assigned_to_bd can never equal a foreign user's id), but
  // "accidentally safe" is not a guarantee, so the org filter is now on the
  // query itself and BOTH paths go through it. `req.orgId` is set by auth() for
  // every authenticated request; when it is absent the query is unfiltered,
  // which matches orgIdFor()'s deliberate default-org behaviour for internal
  // callers rather than silently denying them.
  async function canTouchJob(req, job_id) {
    let q = supabase.from('jobs').select('created_by,assigned_to,assigned_to_bd,org_id').eq('id', job_id);
    const org = req && req.orgId;
    if (org) q = q.eq('org_id', org);
    // .single() (not .maybeSingle()) deliberately: it is what the original used,
    // and on no-rows it returns data:null, which is the answer we want anyway.
    const { data } = await q.single();
    if (!data) return false;
    if (hasRole(req, 'admin')) return true;
    return data.created_by === req.user.id || data.assigned_to === req.user.id || data.assigned_to_bd === req.user.id;
  }

  // Reusable role-gate middleware for routes that only need a role check.
  // (Available for new routes; existing routes keep their inline hasRole checks.)
  function requireRole(...roles) {
    return (req, res, next) => {
      if (!hasRole(req, ...roles)) return res.status(403).json({ error: 'Forbidden' });
      next();
    };
  }

  return { hasRole, canTouchJob, requireRole };
};
