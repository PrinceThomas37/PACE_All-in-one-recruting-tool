// ============================================================================
// CLIENT RESOLUTION — turning what a BD typed in the "Client" box into a real
// companies row.
//
// A job order belongs to a client. PACE stores that client as a `companies`
// row and the job order points at it by id, so "which client is this?" has to
// be answered before a job order can exist at all.
//
// The New Job form asked for the client as FREE TEXT and never turned it into
// a company. The browser sent `company_id: null` on every direct create, so
// POST /job-orders refused with "lead info must be filled first" — a sentence
// describing a step the server actually performs for you (it creates the lead
// itself). The form let you fill in twenty fields and only then refused, which
// is the shape CLAUDE.md calls out: a rule that decides whether an action is
// ALLOWED belongs where the action is OFFERED, not only where it is taken.
//
// So the NAME is now enough, and the server is what resolves it. These three
// functions are the decision; the route around them does the IO. They are pure
// so the matching rule can be pinned without a database — a rule that matters
// is callable (CLAUDE.md, Session 24).
// ============================================================================

// Trim, collapse runs of whitespace, casefold. This is the ONLY normalisation.
// Deliberately NOT stripping "Inc"/"Ltd"/punctuation: "Acme Inc" and "Acme
// Incorporated" may be two real companies, and silently merging two clients is
// far worse than holding two rows that a human can merge later. The typeahead
// in the form is the real duplicate defence — it shows what already exists
// while you type, before a second row can be created.
function normalizeCompanyName(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Pick the row a typed name refers to, or null when none of them is it.
// Exact match on the normalised name only. `rows` is whatever the org-scoped
// lookup returned — this never reaches past what the caller was allowed to see.
function matchCompany(name, rows) {
  const want = normalizeCompanyName(name);
  if (!want) return null;
  return (rows || []).find(r => r && normalizeCompanyName(r.name) === want) || null;
}

// What is missing, said in the words of the form the person is looking at.
// Returns null when there is enough to proceed.
//
// The old sentence named `lead.company_id` and `lead.position` — field names
// from a JSON body nobody outside this file ever sees — and told the reader to
// go and create a lead first, which is not a thing they need to do.
function clientInputError(lead) {
  const l = lead || {};
  const hasCompany = !!l.company_id || !!normalizeCompanyName(l.company_name);
  const hasPosition = !!String(l.position == null ? '' : l.position).trim();
  if (!hasCompany && !hasPosition) return 'A job needs a job title and a client company.';
  if (!hasCompany) return 'A job needs a client company — type the client name in the Client box.';
  if (!hasPosition) return 'A job needs a job title.';
  return null;
}

// The SQL pattern used to fetch the handful of rows `matchCompany` then judges.
// Whitespace runs become `%` so "Treplar  Inc" still finds "Treplar Inc" — the
// pattern is deliberately a SUPERSET of what counts as a match, because
// matchCompany makes the actual decision. Widening it can only cost a few rows
// read; narrowing it silently creates a duplicate client.
function companySearchPattern(name) {
  return normalizeCompanyName(name).split(' ').join('%');
}

module.exports = { normalizeCompanyName, matchCompany, clientInputError, companySearchPattern };
