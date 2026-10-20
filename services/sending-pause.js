// ============================================================================
// WHO IS PAUSED (R-049) — the one rule behind every "is this person allowed to send right now?" check.
//
// Three switches, from wide to narrow:
//   platform — the operator's stop for the whole deployment (services/operator.js decides who may press it)
//   org      — a customer admin's stop for THEIR company only
//   manager  — one BD manager's sending
// A person is paused if any of the three covers them. A company's admin can therefore never stop another company's mail.
// The person→company map is how a check that only knows a user id (the send loop, the follow-up sweep) learns the company;
// a person we have never seen is NOT treated as paused (an emergency stop must not invent a pause for a stranger).
// Pure: the caller owns the sets.
// ============================================================================

function isUserPaused({ platform = false, orgs, managers, userOrg }, userId) {
  if (platform) return true;
  if (!userId) return false;
  if (managers && managers.has(userId)) return true;
  const org = userOrg && userOrg.get(userId);
  return !!(org && orgs && orgs.has(org));
}

function isOrgPaused({ platform = false, orgs }, orgId) {
  return !!platform || !!(orgId && orgs && orgs.has(orgId));
}

module.exports = { isUserPaused, isOrgPaused };
