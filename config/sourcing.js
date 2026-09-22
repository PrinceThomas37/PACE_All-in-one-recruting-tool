// ============================================================================
// Sourcing provider registry — WHERE CANDIDATES COME FROM.
//
// ⚠ THIS FILE'S JOB IS TO BE HONEST ABOUT WHAT EXISTS.
//
// It used to list Apollo, Indeed, Monster, CareerBuilder, Dice and LinkedIn
// alongside CSV, each with a "needs_credentials" badge. That badge reads as
// "add a key and this works". It is not true and never was: there is no
// adapter behind any of them, and `POST /sourcing/search` answers **501** for
// every one. They were placeholders from the original plan
// (docs/SOURCING_AND_SCHEDULING_PLAN.md) and they looked like features for
// five sessions. The owner asked, reasonably, which of them were free and
// where to get the keys — the answer was that none of them is connected to
// anything, and the SCREEN had been saying otherwise.
//
// So a provider now declares `built`, and the two facts are kept apart:
//
//   built: false   — no code exists. A key would change nothing.
//   built: true    — the connector is real; `status` says if it can run today.
//
// `blocker` states, in the owner's language, what would actually be needed
// first — and for most of these it is a commercial relationship, not a key.
// See D-0025: paid resume databases are sequenced behind a measurement, not
// declined. When one is bought, its adapter is written and `built` flips.
//
// ⚠ LINKEDIN IS NOT A "GET THE KEY" PROBLEM. There is no LinkedIn API that
// searches people by job title and location, for us or for anybody. Recruiter
// System Connect surfaces data for candidates an ATS ALREADY HOLDS; partner
// approval runs 3-6 months at under 10% acceptance and wants an existing large
// user base. Scraping is against their terms and a due-diligence problem for a
// product we intend to sell. Do not re-file this as "waiting on credentials".
// ============================================================================

const PROVIDERS = [
  // ── real, working today ───────────────────────────────────────────────────
  {
    id: 'apply', label: 'Apply page', kind: 'inbound', built: true,
    note: 'Publish a job order and share its link. Applicants arrive with their resume already read, checked against the people you have, and waiting here.',
  },
  {
    id: 'csv', label: 'CSV / Excel import', kind: 'file', built: true,
    note: 'Export from any job board and import the file here. Works for every board, including the ones below.',
  },

  // ── not built. A key would change nothing. ────────────────────────────────
  {
    id: 'careerbuilder', label: 'CareerBuilder', kind: 'api', built: false,
    note: 'Resume database of around 38 million US resumes.',
    blocker: 'a paid CareerBuilder employer account with resume-database access, AND approval as a CareerBuilder partner. The connector gets written once both are in place.',
  },
  {
    id: 'resume_library', label: 'Resume-Library (US)', kind: 'api', built: false,
    note: 'US resume database with a candidate-search API.',
    blocker: 'a paid recruiter account. Database access comes with a Resume Search subscription, or by advertising jobs with them.',
  },
  {
    id: 'dice', label: 'Dice', kind: 'api', built: false,
    note: 'Tech-focused resume database.',
    blocker: 'a paid Dice account with API access.',
  },
  {
    id: 'monster', label: 'Monster', kind: 'api', built: false,
    note: 'General resume database.',
    blocker: 'a paid Monster account with API access.',
  },
  {
    id: 'indeed', label: 'Indeed', kind: 'api', built: false,
    note: 'Resume search and job posting.',
    blocker: 'an Indeed employer account with API access, which Indeed grants selectively.',
  },
  {
    id: 'apollo', label: 'Apollo', kind: 'api', built: false,
    note: 'Contact search. Finds people and work emails — aimed at sales contacts rather than job seekers.',
    blocker: 'a paid Apollo plan. Their free plan no longer includes API access \u2014 it starts at the Organization plan, 3 users minimum. Saving an Apollo key on the Integrations page does nothing today: nothing in PACE calls it.',
  },
  {
    id: 'linkedin', label: 'LinkedIn', kind: 'api', built: false,
    note: 'Not a search. LinkedIn sells no API that finds people by job title and location — to us or to anyone.',
    blocker: 'a LinkedIn Recruiter seat \u2014 search there, export, and import the file above. A true integration would need LinkedIn Talent Solutions partner status (3-6 months, under 10% accepted), and even that only surfaces data for candidates already in the ATS rather than finding new ones.',
  },
];

const PROVIDER_IDS = PROVIDERS.map(p => p.id);

// What the Sourcing screen renders. `available` drives whether a provider is
// offered as something you can DO; `built` is why. Keeping both means the page
// can show an unbuilt provider as a roadmap note without it looking like a
// button somebody forgot to wire up.
function providerList() {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    note: p.note,
    built: !!p.built,
    blocker: p.blocker || null,
    available: !!p.built,
    status: p.built ? 'ready' : 'not_built',
  }));
}

const isBuilt = (id) => !!(PROVIDERS.find(p => p.id === id) || {}).built;

module.exports = { PROVIDERS, PROVIDER_IDS, providerList, isBuilt };
