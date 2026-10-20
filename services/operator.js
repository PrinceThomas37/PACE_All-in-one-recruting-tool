// ============================================================================
// THE PACE OPERATOR (R-049) — the person who runs the deployment, as opposed to a customer's admin.
//
// A customer's admin runs THEIR company: their people, keys, numbers, their own emergency stop. They must never be able to
// touch the things every customer shares — the background engines, the deployment-wide send times, the platform-wide stop —
// because one company's admin pressing a button there changes every other company's day.
//
// Who is the operator?
//   OPERATOR_EMAILS (comma-separated, on Render) names them. Only an ADMIN whose address is listed counts.
//   Not set: the admins of the FOUNDING organisation are the operator. That is today's truth (one customer, who also runs the
//   platform) and it means nothing changes until a second company exists; set OPERATOR_EMAILS before the second one signs up
//   if the founder's company has admins who should not hold platform powers.
//
// Pure on purpose (the rule is callable, so a test can fail it): no database, no clock.
// ============================================================================

function operatorEmails(env = process.env) {
  return new Set(String((env && env.OPERATOR_EMAILS) || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

function rolesOf(user) {
  return [].concat(Array.isArray(user && user.roles) ? user.roles : [], user && user.role ? [user.role] : []);
}

// user: the session's claims { email, roles|role, org_id }. foundingOrgId: the deployment's first organisation.
function isOperator(user, { foundingOrgId = null, env = process.env } = {}) {
  if (!user || !rolesOf(user).includes('admin')) return false;
  const listed = operatorEmails(env);
  if (listed.size) return listed.has(String(user.email || '').toLowerCase());
  return !!foundingOrgId && user.org_id === foundingOrgId;
}

module.exports = { isOperator, operatorEmails };
