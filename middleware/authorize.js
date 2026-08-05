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

  // Ownership check for a job by id (admins bypass).
  async function canTouchJob(req, job_id) {
    if (hasRole(req, 'admin')) return true;
    const { data } = await supabase.from('jobs').select('created_by,assigned_to,assigned_to_bd').eq('id', job_id).single();
    if (!data) return false;
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
