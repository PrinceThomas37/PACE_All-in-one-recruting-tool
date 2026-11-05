// WHO MAY SEE AND USE A SEQUENCE — one rule, in one place (D-0113, R-395).
//
// Owner, 8 Oct (D-0113): "the system gives a blank template for a user to start with. They decide the templates, emails, counts and
// all." So a person starts BLANK: they see — and may enrol people into — only the sequences THEY made. Not the company's built-in
// "Standard Sales Outreach" (it has no owner), not a colleague's, not their manager's. A BD lead, RA lead, admin or recruiter-designer
// (the roles that design sequences for others) still see every sequence in the company.
//
// Owner, 4 Nov: the Compose dropdown "Add everyone to a sequence" listed BD Lead 1's sequence and the built-in one to a BD who had made
// none, and the server enrolled whatever id it was handed. The Sequences page already applied this rule; the dropdown and the three
// enrol doors did not — "a rule that decides whether an action is allowed lives where the action is OFFERED, not only where it is
// taken". So the page, the dropdown, and every door that enrols a person into a sequence all call THIS.
//
// Pure: no database, no request — `user` is `req.user` ({ id, role, roles }).
const SEES_ALL = ['admin', 'ra_lead', 'bd_lead', 'recruiter'];

function rolesOf(user) {
  const u = user || {};
  return (Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role]).filter(Boolean);
}
// Roles that design sequences for others see all of them; everyone else sees only their own.
function seesAllSequences(user) { return rolesOf(user).some((r) => SEES_ALL.includes(r)); }
// A sequence with no owner (the built-in one) is nobody's own.
function mayUseSequence(def, user) {
  if (!def) return false;
  if (seesAllSequences(user)) return true;
  return !!def.created_by && !!user && def.created_by === user.id;
}
function visibleSequences(list, user) { return (list || []).filter((d) => mayUseSequence(d, user)); }

module.exports = { seesAllSequences, mayUseSequence, visibleSequences, SEES_ALL };
