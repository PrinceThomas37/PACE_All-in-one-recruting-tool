// WHO MAY SEE AND USE A SEQUENCE — one rule, in one place (D-0113, R-395, D-0214).
//
// Owner, 8 Oct (D-0113): "the system gives a blank template for a user to start with. They decide the templates, emails, counts and
// all." A person starts BLANK: they see — and may enrol people into — only the sequences THEY made. Not the company's built-in
// "Standard Sales Outreach" (it has no owner), not a colleague's, not their manager's.
//
// Owner, 4 Nov: the Compose dropdown listed BD Lead 1's sequence and the built-in one to a BD who had made none, and the server enrolled
// whatever id it was handed — so the page, the dropdown and every door that enrols a person now call THIS.
// Owner, 5 Nov (D-0214): managers too — "they only have to see their own". A BD lead, RA lead or admin no longer sees everyone's
// sequences when ADDING people to a sequence or on the Sequences page. What a manager does see across the team is ANALYTICS (Outreach
// Insights: theirs, the team's, each person's) — that is a different question with its own scope (D-0034), not this rule.
//
// Pure: no database, no request — `user` is `req.user` ({ id, role, roles }).
// A sequence with no owner (the built-in one) is nobody's own.
function mayUseSequence(def, user) { return !!def && !!def.created_by && !!user && def.created_by === user.id; }
function visibleSequences(list, user) { return (list || []).filter((d) => mayUseSequence(d, user)); }

module.exports = { mayUseSequence, visibleSequences };
