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

// ── THE POC ──────────────────────────────────────────────────────────────────
// A lead with no contact is a record, not a lead: nothing in PACE can email it,
// follow it up, sequence it or put it on anybody's list. The owner made a name
// and an email REQUIRED on a directly-created job order (Session 26), and the
// live data says that costs nothing — all 328 leads have a POC and 708 of the
// 709 contacts have an email.
//
// Phone and LinkedIn stay OPTIONAL, and that is a decision, not an oversight:
// 163 of those 709 contacts have no phone. Requiring one would make people type
// something to get past the field, and an invented phone number is worse than
// an empty one — D-0017 exists because tasks were being created against contact
// details nobody could actually use.

// Deliberately loose. This rejects what is obviously not an address; it does not
// try to decide whether a real mailbox is behind it. `POST /contacts/check-email`
// and the email-verification engine are what judge deliverability — a regex that
// tries to be clever here just refuses somebody's real address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function looksLikeEmail(value) {
  return EMAIL_SHAPE.test(String(value == null ? '' : value).trim());
}

// Trim every field and casefold the email. The email is the identity we compare
// and store, so "  Dana@Treplar.com " and "dana@treplar.com" must not become two
// contacts.
function normalizeContact(c) {
  const t = (v) => String(v == null ? '' : v).trim();
  return {
    first_name: t(c && c.first_name),
    last_name: t(c && c.last_name),
    designation: t(c && c.designation) || null,
    email: t(c && c.email).toLowerCase(),
    phone: t(c && c.phone) || null,
    linkedin: t(c && c.linkedin) || null,
  };
}

// A row the person left completely blank is not an error — it is the empty
// "add another" slot they never filled in. Dropping those silently is right;
// refusing them would make the form scold you for a box you did not touch.
function isBlankContact(c) {
  const n = normalizeContact(c);
  return !n.first_name && !n.last_name && !n.email && !n.phone && !n.linkedin && !n.designation;
}

// Returns { contacts, error }. `contacts` is ready to insert; `error` is a
// sentence naming the ONE thing to fix, in the words on the form.
function readContacts(list) {
  const rows = (Array.isArray(list) ? list : []).filter(c => !isBlankContact(c)).map(normalizeContact);
  if (!rows.length) {
    return { contacts: [], error: 'Add the client contact — a name and an email address. A lead with nobody on it cannot be emailed or followed up.' };
  }
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const which = rows.length > 1 ? ` for contact ${i + 1}` : '';
    if (!c.first_name) return { contacts: [], error: `Enter a first name${which}.` };
    if (!c.email) return { contacts: [], error: `Enter an email address${which}.` };
    if (!looksLikeEmail(c.email)) return { contacts: [], error: `"${c.email}" does not look like an email address${which}.` };
  }
  // Two rows with one address is a mis-click, not two people. Saying so beats
  // creating a duplicate contact that the send path would then email twice.
  const seen = {};
  for (const c of rows) {
    if (seen[c.email]) return { contacts: [], error: `${c.email} is entered twice — each contact needs their own address.` };
    seen[c.email] = true;
  }
  return { contacts: rows, error: null };
}

// ── THE COMPANY'S POSTAL ADDRESS (migration 043) ─────────────────────────────
// Every part is optional — a BD entering a won job may have the client's city
// and nothing else, and refusing that would block real work over a suite number.
const ADDRESS_FIELDS = ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'];

function readAddress(src) {
  const out = {};
  ADDRESS_FIELDS.forEach((k) => {
    const v = String((src && src[k]) == null ? '' : src[k]).trim();
    if (v) out[k] = v;
  });
  return out;
}

// The short display form (`companies.location`), which 1,565 of 1,567 rows
// already carry as "City, ST". Derived so a client entered through this form
// still shows up the way every other screen expects, without anyone typing it
// twice. Returns '' when there is nothing worth showing.
function displayLocation(addr) {
  const a = addr || {};
  return [a.city, a.state].filter(Boolean).join(', ');
}

module.exports = {
  normalizeCompanyName, matchCompany, clientInputError, companySearchPattern,
  looksLikeEmail, normalizeContact, isBlankContact, readContacts,
  ADDRESS_FIELDS, readAddress, displayLocation,
};
