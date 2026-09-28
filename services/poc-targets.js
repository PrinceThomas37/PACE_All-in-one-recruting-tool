// ============================================================================
// WHO TO REACH AT A COMPANY FOR ONE OPEN JOB — the POC finder's rules
// (R-053, D-0049; design: docs/CONTACT_FINDER_DESIGN.md §4). PURE: no db, no
// network, no clock.
//
// FOUR SLOTS PER LEAD — two HR people and two hiring managers. Which titles
// fill them depends on the job's FUNCTION (an estimator reports to a chief
// estimator; a service technician to a service manager) and the company's
// SIZE (the owner's table: under ~20 the owner hires; 20-50 match the job to
// the function head; 50-200 the department head; 200+ the function's manager
// and director; 1,000+ the HR pair becomes talent acquisition).
//
// Size is picked on the lead (D-0049). Until somebody picks, "20-50" is
// assumed — owner/president plus the function head, office manager for HR —
// which is what the researchers already choose by hand for these companies
// (President was the single most common title on file, 2026-09-27).
//
// This file also LEARNS A COMPANY'S EMAIL FORMAT from real addresses PACE
// holds there. A format learned from a real address makes a new name's email
// "Likely"; the market-wide prior (first initial + surname — 42 of the 64
// companies whose format was learnable, 2026-09-27) is only ever a GUESS, and
// D-0049 says a guess is never emailed. `emailFor` therefore refuses to build
// an address without a learned format.
// ============================================================================

const SIZE_BANDS = [
  { id: '1-20',     label: 'Under 20' },
  { id: '21-50',    label: '20–50' },
  { id: '51-200',   label: '50–200' },
  { id: '201-1000', label: '200–1,000' },
  { id: '1000+',    label: '1,000+' },
];
const SIZE_IDS = SIZE_BANDS.map(b => b.id);
const DEFAULT_SIZE = '21-50';

// ── the job's function ──────────────────────────────────────────────────────
// Matched on the job TITLE, first match wins, so the more specific families
// come first ("Collision Estimator" is estimating, "Project Engineer" is
// project work, "Technical Recruiter" is HR). A title matching nothing is
// "general" and falls back to the general/operations manager.
const FUNCTIONS = [
  { id: 'estimating', label: 'estimating',
    match: /\b(estimat\w*|pre-?construction|cost engineer\w*|quantity survey\w*)/i,
    heads:     ['Chief Estimator', 'Director of Estimating', 'Estimating Manager', 'Preconstruction Manager'],
    managers:  ['Estimating Manager', 'Chief Estimator', 'Senior Estimator'],
    directors: ['Director of Estimating', 'Director of Preconstruction', 'Vice President of Preconstruction'] },
  { id: 'hr', label: 'HR',
    match: /\b(human resources?|hr|recruit\w*|talent acquisition|people operations|payroll)\b/i,
    heads:     ['HR Director', 'Director of Human Resources', 'Vice President of Human Resources'],
    managers:  ['HR Manager', 'Human Resources Manager'],
    directors: ['HR Director', 'Director of Human Resources', 'Vice President of Human Resources'] },
  { id: 'project', label: 'project management',
    match: /\b(project (manager|engineer|coordinator|executive)|superintendent|construction manager|site manager|foreman|field supervisor)/i,
    heads:     ['Director of Operations', 'Senior Project Manager', 'Construction Manager', 'Vice President of Construction'],
    managers:  ['Senior Project Manager', 'Construction Manager', 'Operations Manager'],
    directors: ['Director of Operations', 'Director of Construction', 'Vice President of Construction', 'Vice President of Operations'] },
  { id: 'service', label: 'field service',
    match: /\b(technician|tech|installer|mechanic|hvac|electrician|plumber|service (advisor|writer|manager)|field service|apprentice|journeyman|lineman|welder|pipefitter)\b/i,
    heads:     ['Service Manager', 'Director of Service', 'Field Service Manager', 'Operations Manager'],
    managers:  ['Service Manager', 'Field Service Manager', 'Service Supervisor'],
    directors: ['Director of Service', 'Director of Field Operations', 'Vice President of Service'] },
  { id: 'engineering', label: 'engineering',
    match: /\b(engineer\w*|designer|draft\w*|architect\w*|cad)\b/i,
    heads:     ['Engineering Manager', 'Director of Engineering', 'Chief Engineer'],
    managers:  ['Engineering Manager', 'Chief Engineer', 'Lead Engineer'],
    directors: ['Director of Engineering', 'Vice President of Engineering'] },
  { id: 'operations', label: 'operations',
    match: /\b(production|plant|warehouse|operator|maintenance|logistics|supply chain|manufactur\w*|assembl\w*|quality|shipping|dispatch\w*|driver)\b/i,
    heads:     ['Operations Manager', 'Plant Manager', 'Production Manager', 'Director of Operations'],
    managers:  ['Operations Manager', 'Plant Manager', 'Production Manager'],
    directors: ['Director of Operations', 'Vice President of Operations', 'Plant Director'] },
  { id: 'sales', label: 'sales',
    match: /\b(sales|account (manager|executive)|business development|customer success)\b/i,
    heads:     ['Sales Manager', 'Director of Sales', 'Vice President of Sales'],
    managers:  ['Sales Manager', 'Regional Sales Manager'],
    directors: ['Director of Sales', 'Vice President of Sales'] },
  { id: 'finance', label: 'finance and accounting',
    match: /\b(accountant|accounting|bookkeep\w*|controller|accounts (payable|receivable)|finance|financial|billing|auditor|tax)\b/i,
    heads:     ['Controller', 'CFO', 'Accounting Manager', 'Finance Manager'],
    managers:  ['Accounting Manager', 'Controller', 'Finance Manager'],
    directors: ['CFO', 'Director of Finance', 'Vice President of Finance'] },
  { id: 'it', label: 'IT',
    match: /\b(developer|software|it|information technology|network|systems administrator|sysadmin|help ?desk|devops|data (analyst|engineer))\b/i,
    heads:     ['IT Manager', 'Director of IT', 'CTO'],
    managers:  ['IT Manager'],
    directors: ['Director of IT', 'CTO', 'CIO'] },
  { id: 'admin', label: 'office and administration',
    match: /\b(office manager|administrative|administrator|admin|receptionist|coordinator|assistant|clerk|secretary|front desk)\b/i,
    heads:     ['Office Manager', 'Operations Manager', 'General Manager'],
    managers:  ['Office Manager', 'Operations Manager'],
    directors: ['General Manager', 'Director of Operations'] },
];
const GENERAL = { id: 'general', label: 'general',
  heads: ['General Manager', 'Operations Manager'], managers: ['General Manager', 'Operations Manager'],
  directors: ['Director of Operations', 'Vice President'] };

// A car dealership's estimators and technicians report into the service or
// collision side, not to a "Chief Estimator". Industry refines the function.
const INDUSTRY_HEADS = [
  { industry: /\b(automotive|motor vehicle|dealership|car dealer|auto dealer)\b/i, fns: ['estimating', 'service'],
    heads: ['Collision Center Manager', 'Body Shop Manager', 'Service Director', 'Fixed Operations Director'],
    managers: ['Collision Center Manager', 'Body Shop Manager', 'Service Manager'],
    directors: ['Service Director', 'Fixed Operations Director', 'General Manager'] },
];

// ── professional firms (R-063, D-0052) ──────────────────────────────────────
// A law, accounting or architecture firm is not run like a contractor. Measured
// on the owner's 82 live leads (2026-09-28): 16 are such firms, and for them the
// generic rules looked for a General Manager (a paralegal's boss), a Controller
// or CFO (an accounting FIRM's hiring is done by its partners, not by whoever
// runs its own books) or an Engineering Manager (an architect's) — and read
// Attorney, Shareholder and Founding Member as nobody. The researchers picked
// Partner, Managing Partner, Attorney, Principal and Law Firm Administrator.
//
// Matched on the lead's INDUSTRY (LinkedIn's categories: "Law Practice",
// "Legal Services", "Accounting", "Architecture and Planning"). A PRACTICE job
// (the profession's own work) reports to the firm's practitioners; any other
// job keeps its function's heads, with the firm's administrator first. Either
// way the "top of the company" is the firm's own leadership, never a CEO a law
// firm does not have.
//   hrFirst: HR titles tried first at firms up to 200 people
//   hrAdmin: titles that ARE the HR/people function there at ANY size
//   leaders: practitioner titles that are hiring managers only at this kind of firm
const FIRMS = [
  { id: 'law', label: 'a law firm',
    industry: /\b(law practice|legal services|law firm|legal)\b/i,
    practice: /\b(paralegal|legal (assistant|secretary)|attorney|lawyer|associate|law clerk|docket\w*|litigation|counsel|legal)\b/i,
    fnLabel: 'legal',
    heads: ['Managing Partner', 'Supervising Attorney', 'Managing Attorney', 'Partner'],
    managers: ['Supervising Attorney', 'Managing Attorney', 'Senior Attorney', 'Partner'],
    directors: ['Managing Partner', 'Partner', 'Director of Legal Operations'],
    top: ['Managing Partner', 'Founding Partner', 'Partner', 'Principal'],
    hrFirst: ['Firm Administrator', 'Legal Administrator', 'Director of Administration'],
    hrAdmin: /\b(firm|legal|law firm) administrator\b|\bdirector of administration\b/i,
    leaders: /\b(attorney|counsel|lawyer)\b/i },
  { id: 'accounting', label: 'an accounting firm',
    industry: /\b(accounting|cpa firm|certified public accountants?)\b/i,
    practice: /\b(accountant|accounting|audit\w*|assurance|tax|cpa|advisory|bookkeep\w*)\b/i,
    fnLabel: 'accounting practice',
    heads: ['Managing Partner', 'Partner', 'Shareholder', 'Principal'],
    managers: ['Senior Manager', 'Partner', 'Shareholder'],
    directors: ['Managing Partner', 'Partner', 'Shareholder', 'Principal'],
    // A tax job reports to the tax side, an audit job to the audit side.
    sub: [
      { match: /\btax\b/i, fnLabel: 'tax practice', heads: ['Tax Partner', 'Tax Manager', 'Director of Tax', 'Partner'], managers: ['Tax Manager', 'Senior Tax Manager', 'Tax Partner'] },
      { match: /\b(audit\w*|assurance)\b/i, fnLabel: 'audit practice', heads: ['Audit Partner', 'Audit Manager', 'Assurance Partner', 'Partner'], managers: ['Audit Manager', 'Senior Audit Manager', 'Audit Partner'] },
    ],
    top: ['Managing Partner', 'Partner', 'Shareholder', 'Owner', 'President'],
    hrFirst: ['Firm Administrator', 'Director of Firm Administration', 'Practice Manager'],
    hrAdmin: /\bfirm administrator\b|\bdirector of (firm )?administration\b|\bpractice manager\b/i,
    leaders: null },
  { id: 'architecture', label: 'an architecture firm',
    industry: /\b(architect\w*|architecture and planning|landscape architecture|interior design)\b/i,
    practice: /\b(architect\w*|designer|landscape|interior|drafter|draftsman|draftsperson|bim|revit|cad|planner|urban design)\b/i,
    fnLabel: 'architecture',
    heads: ['Principal', 'Managing Principal', 'Studio Director', 'Design Director'],
    managers: ['Studio Director', 'Associate Principal', 'Senior Associate'],
    directors: ['Principal', 'Managing Principal', 'Director of Architecture', 'Partner'],
    top: ['Principal', 'Founding Principal', 'Partner', 'President', 'Owner'],
    hrFirst: ['Studio Manager'],
    hrAdmin: /\bstudio manager\b/i,
    leaders: null },
];
const FIRM_BY_ID = new Map(FIRMS.map(f => [f.id, f]));
function firmOf(industry) { return FIRMS.find(f => f.industry.test(String(industry || ''))) || null; }
function firmById(x) { return !x ? null : (typeof x === 'string' ? FIRM_BY_ID.get(x) || null : x); }

function jobFunction(title, industry) {
  const t = String(title || '');
  const firm = firmOf(industry);
  if (firm && firm.practice.test(t)) {
    const sub = (firm.sub || []).find(s => s.match.test(t));
    return Object.assign({ id: firm.id, label: (sub && sub.fnLabel) || firm.fnLabel,
      heads: firm.heads, managers: firm.managers, directors: firm.directors },
      sub ? { heads: sub.heads, managers: sub.managers } : {}, { top: firm.top, firm: firm.id });
  }
  const fn = FUNCTIONS.find(f => f.match.test(t)) || GENERAL;
  const ov = INDUSTRY_HEADS.find(o => o.industry.test(String(industry || '')) && o.fns.includes(fn.id));
  const base = ov ? Object.assign({}, fn, { heads: ov.heads, managers: ov.managers, directors: ov.directors }) : fn;
  // Any other job at a firm keeps its function's heads (a construction project
  // manager at a planning firm still reports to the project side), with the
  // firm's own leadership as "the top of the company". The firm's administrator
  // is found in an HR slot — at these firms that is who runs hiring.
  return firm ? Object.assign({}, base, { top: firm.top, firm: firm.id }) : base;
}

function normalizeSize(s) { return SIZE_IDS.includes(s) ? s : null; }

// Apollo's employee ESTIMATE → one of the five bands. Unknown, 0 or nonsense
// → null: "we could not tell" is never the same answer as a size.
function sizeBandFor(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 20) return '1-20';
  if (n <= 50) return '21-50';
  if (n <= 200) return '51-200';
  if (n <= 1000) return '201-1000';
  return '1000+';
}

// Is Apollo's record the same company as ours? The WEBSITE finds the record;
// the NAME is the check that it is the right one — a website that belongs to
// a parent group, or one typed wrong at import, returns somebody else's
// headcount, and a size taken from the wrong company picks the wrong people
// to email. Legal suffixes and filler words are ignored; the first real word
// agreeing, one name inside the other, or the same letters run together
// ("KBHome" / "KB Home") all count as the same company.
const NAME_NOISE = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation',
  'company', 'group', 'the', 'and', 'of', 'plc', 'lp', 'llp', 'pllc', 'pc', 'holdings']);
function nameTokens(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !NAME_NOISE.has(w));
}
function sameCompany(ours, theirs) {
  const a = nameTokens(ours), b = nameTokens(theirs);
  if (!a.length || !b.length) return false;
  if (a[0] === b[0] || a.join('') === b.join('')) return true;
  const A = new Set(a), B = new Set(b);
  return a.every(w => B.has(w)) || b.every(w => A.has(w));
}

// ── the four slots ──────────────────────────────────────────────────────────
function uniq(list) { const seen = {}; return list.filter(x => { const k = String(x).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }); }
function slotLabel(titles) { return titles.length > 1 ? `${titles[0]} or ${titles[1]}` : (titles[0] || ''); }

function hrSlots(size, fn) {
  let a, b;
  if (size === '1-20') {
    a = ['Office Manager', 'HR Manager', 'Human Resources Manager', 'HR Administrator', 'Business Manager'];
    b = ['Office Administrator', 'Administrative Manager', 'Payroll Administrator', 'Executive Assistant', 'HR Assistant'];
  } else if (size === '21-50') {
    a = ['HR Manager', 'Human Resources Manager', 'Office Manager', 'HR Administrator'];
    b = ['Office Manager', 'HR Generalist', 'Payroll Administrator', 'Office Administrator'];
  } else if (size === '51-200') {
    a = ['HR Manager', 'Human Resources Manager', 'HR Director', 'Director of Human Resources'];
    b = ['HR Generalist', 'Recruiter', 'Talent Acquisition Specialist', 'HR Coordinator'];
  } else if (size === '201-1000') {
    a = ['HR Director', 'Director of Human Resources', 'HR Manager'];
    b = ['Talent Acquisition Manager', 'Recruiting Manager', 'Recruiter'];
  } else {
    // 1,000+: the HR pair becomes talent acquisition specifically.
    a = ['Talent Acquisition Manager', 'Director of Talent Acquisition', 'Head of Talent Acquisition'];
    const techy = ['engineering', 'it', 'estimating'].includes(fn.id);
    b = [techy ? 'Technical Recruiter' : 'Recruiter', 'Senior Recruiter', 'Talent Acquisition Partner'];
  }
  // At a law, accounting or architecture firm the people function has its own
  // names (a law firm's Firm Administrator runs hiring whatever its size), so
  // they are tried first — up to 200 people; above that HR is a department.
  const firm = firmById(fn.firm);
  if (firm && ['1-20', '21-50', '51-200'].includes(size)) a = firm.hrFirst.concat(a);
  return [
    { key: 'hr1', kind: 'hr', titles: uniq(a) },
    { key: 'hr2', kind: 'hr', titles: uniq(b) },
  ];
}

function managerSlots(size, fn) {
  let a, b;
  // `fn.top` is a professional firm's own leadership (Managing Partner,
  // Principal…) — a law firm has no CEO or General Manager to look for.
  const top = fn.top || null;
  if (size === '1-20') {
    a = top ? top.slice() : ['Owner', 'President', 'CEO', 'Founder'];
    // At a small firm the second person is a practitioner who runs the work
    // day to day (a supervising attorney, a tax manager, a studio director).
    b = top ? fn.managers.slice() : ['Co-Owner', 'Partner', 'Vice President', 'General Manager', fn.heads[0]];
  } else if (size === '21-50') {
    a = fn.heads.slice();
    b = top ? top.slice() : ['President', 'Owner', 'CEO', 'General Manager'];
  } else if (size === '51-200') {
    a = fn.heads.slice();
    b = top ? fn.directors.concat(top) : fn.directors.concat(['Director of Operations', 'General Manager', 'Vice President']);
  } else {
    a = fn.managers.slice();
    b = fn.directors.slice();
  }
  return [
    { key: 'mgr1', kind: 'manager', titles: uniq(a) },
    { key: 'mgr2', kind: 'manager', titles: uniq(b) },
  ];
}

/**
 * The four slots for one lead.
 *   job:     { position, industry }
 *   sizeBand one of SIZE_IDS, or null/unknown → DEFAULT_SIZE (flagged)
 */
function pocTargets(job, sizeBand) {
  const size = normalizeSize(sizeBand);
  const fn = jobFunction(job && job.position, job && job.industry);
  const used = size || DEFAULT_SIZE;
  const slots = hrSlots(used, fn).concat(managerSlots(used, fn))
    .map(s => Object.assign(s, { label: slotLabel(s.titles) }));
  // `firm`: 'law' | 'accounting' | 'architecture' | null — the kind of firm the
  // lead's industry says it is, which changes who counts as HR or a leader.
  const firm = firmOf(job && job.industry);
  return { size: used, size_known: !!size, function: { id: fn.id, label: fn.label }, firm: firm ? firm.id : null, slots };
}

// ── putting the people already on file into the slots ───────────────────────
// "People", "Culture", employee relations, total rewards… are the HR function
// under its newer names (R-063: "People and Culture Director" was the one HR
// person on the owner's leads read as a hiring manager). Checked BEFORE the
// leader words, so "Chief People Officer" or "People Partner" is HR.
const HR_WORDS = /\b(hr|h\.r\.|human resources?|human resource|people (ops|operations)|talent|recruit\w*|payroll|personnel|benefits|people (and|&) culture|chief people|head of people|vp,? (of )?people|vice president,? (of )?people|people (partner|manager|director|lead|business partner)|culture (and|&) (engagement|people)|employee (relations|experience|engagement)|total rewards|compensation|learning (and|&) development|staffing coordinator)\b/i;
// At a small firm the office manager IS the HR department; at a big one an
// office manager is not who hires.
const OFFICE_WORDS = /\b(office manager|office admin\w*|administrat\w*|business manager|executive assistant|admin assistant)\b/i;
const MANAGER_WORDS = /\b(owner|president|ceo|founder|partner|principal|chairman|chief|coo|cfo|cto|cio|vp|vice president|director|head|general manager|manager|superintendent|supervisor|lead|shareholder|founding member|managing member)\b/i;

// `firm`: the lead's firm type (an id from FIRMS, or null). At a law firm an
// attorney is the one a paralegal reports to; at a law or accounting firm the
// Firm Administrator is the people function at ANY size. Elsewhere neither
// applies — an in-house attorney does not hire an estimator.
function contactKind(designation, size, firm) {
  const d = String(designation || '');
  if (HR_WORDS.test(d)) return 'hr';
  const f = firmById(firm);
  if (f && f.hrAdmin && f.hrAdmin.test(d)) return 'hr';
  const small = size === '1-20' || size === '21-50';
  if (OFFICE_WORDS.test(d)) return small ? 'hr' : 'other';
  if (MANAGER_WORDS.test(d)) return 'manager';
  if (f && f.leaders && f.leaders.test(d)) return 'manager';
  return 'other';
}

function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean); }
// How well a person's title fits a slot: the position of the first slot title
// whose every word appears in theirs (lower is better); a person of the right
// kind who matches no listed title still fits, last.
function fitScore(designation, slot) {
  const have = new Set(words(designation).map(w => w === 'vp' ? 'vice' : w));
  for (let i = 0; i < slot.titles.length; i++) {
    const need = words(slot.titles[i]).map(w => w === 'vp' ? 'vice' : w).filter(w => w !== 'of' && w !== 'and');
    if (need.length && need.every(w => have.has(w))) return i;
  }
  return 50;
}

/**
 * Assign contacts to slots — best fits first, one person per slot. Returns the
 * slots with `contact_id` set where filled, and `others` (contacts that fit no
 * slot, kept visible — nobody on file disappears from the lead).
 */
function fillSlots(targets, contacts) {
  const slots = targets.slots.map(s => Object.assign({}, s, { contact_id: null }));
  const list = (contacts || []).filter(c => c && c.id);
  const pairs = [];
  list.forEach(c => {
    const kind = contactKind(c.designation, targets.size, targets.firm);
    slots.forEach((s, si) => { if (s.kind === kind) pairs.push({ si, c, score: fitScore(c.designation, s) + (c.is_primary ? -0.1 : 0) }); });
  });
  pairs.sort((a, b) => (a.score - b.score) || (a.si - b.si));
  const taken = new Set();
  pairs.forEach(p => {
    if (slots[p.si].contact_id || taken.has(p.c.id)) return;
    slots[p.si].contact_id = p.c.id; taken.add(p.c.id);
  });
  return { slots, others: list.filter(c => !taken.has(c.id)).map(c => c.id) };
}

/**
 * For each EMPTY slot, the best person from a people search (Apollo) — one
 * whose title makes them the right KIND for the slot (HR / hiring manager),
 * best title fit first; never somebody already on the lead, already
 * suggested or turned down for it, and never one person for two slots.
 *   slots:   from fillSlots (contact_id null = empty)
 *   people:  [{ id, first_name, last_name, title }]
 *   exclude: { ids: [source ids already suggested or rejected],
 *              names: ['First Last', …] of the people already on the lead }
 *   skip:    slot keys that already have a suggestion waiting
 * Returns [{ slot_key, person }], in slot order.
 */
function pickPeople(slots, people, exclude, size, skip, firm) {
  const ids = new Set(((exclude && exclude.ids) || []).map(String));
  const names = new Set(((exclude && exclude.names) || []).map(nameKey).filter(Boolean));
  const skipSet = new Set(skip || []);
  const open = (slots || []).filter(s => !s.contact_id && !skipSet.has(s.key));
  const pairs = [];
  (people || []).forEach(p => {
    if (!p || !p.id || !p.first_name || ids.has(String(p.id))) return;
    if (p.last_name && names.has(nameKey(p.first_name + ' ' + p.last_name))) return;
    const kind = contactKind(p.title, size, firm);
    open.forEach(s => { if (s.kind === kind) pairs.push({ s, p, score: fitScore(p.title, s) }); });
  });
  const order = (slots || []).map(s => s.key);
  pairs.sort((a, b) => (a.score - b.score) || (order.indexOf(a.s.key) - order.indexOf(b.s.key)));
  const usedSlot = new Set(), usedPerson = new Set(), out = [];
  pairs.forEach(x => {
    if (usedSlot.has(x.s.key) || usedPerson.has(x.p.id)) return;
    usedSlot.add(x.s.key); usedPerson.add(x.p.id);
    out.push({ slot_key: x.s.key, person: x.p });
  });
  return out.sort((a, b) => order.indexOf(a.slot_key) - order.indexOf(b.slot_key));
}

// ── the company's email format ──────────────────────────────────────────────
// Ids match enrichment.js PATTERNS where they overlap, so a format learned here
// can be handed to it.
const FORMATS = [
  { id: 'flast',      build: (f, l) => f[0] + l },
  { id: 'first.last', build: (f, l) => f + '.' + l },
  { id: 'first',      build: (f) => f },
  { id: 'firstlast',  build: (f, l) => f + l },
  { id: 'firstl',     build: (f, l) => f + l[0] },
  { id: 'first_last', build: (f, l) => f + '_' + l },
  { id: 'f.last',     build: (f, l) => f[0] + '.' + l },
  { id: 'last',       build: (f, l) => l },
];
// Measured 2026-09-27 on the live data: first initial + surname at 42 of the
// 64 companies whose format could be learned. A PRIOR, never a basis to send.
const MARKET_PRIOR = 'flast';
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|gmx|zoho|mail|comcast|att|sbcglobal|verizon|bellsouth|cox|charter|earthlink)\.[a-z.]+$/i;

function nameKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}
function detectFormat(first, last, local) {
  const f = nameKey(first), l = nameKey(last), lp = String(local || '').toLowerCase();
  if (!f || !l || !lp) return null;
  const hit = FORMATS.find(x => x.build(f, l) === lp);
  return hit ? hit.id : null;
}
function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/**
 * The company's email domain and format, from the addresses PACE holds there.
 *   contacts: [{ first_name, last_name, email }], website: the company's site
 * The DOMAIN is the one its people's addresses actually use (a dealership's
 * website and its staff mail often differ); free-mail addresses never count.
 * The FORMAT is the majority among addresses on that domain; ties go to the
 * market prior's order. `learned_from` is how many real addresses agree.
 * An address that BOUNCED (email_status invalid/deactivated) teaches nothing —
 * it may be somebody's wrong guess at the format, and learning from it would
 * repeat the mistake on every new name (design §6 rule 5).
 */
const DEAD_STATUSES = new Set(['invalid', 'deactivated']);
function learnFormat(contacts, website) {
  const byDomain = {};
  (contacts || []).forEach(c => {
    if (c && DEAD_STATUSES.has(String(c.email_status || '').toLowerCase())) return;
    const d = normalizeDomain(c && c.email);
    if (!d || FREE_MAIL.test(d)) return;
    (byDomain[d] = byDomain[d] || []).push(c);
  });
  const site = normalizeDomain(website);
  const ranked = Object.keys(byDomain).sort((a, b) => (byDomain[b].length - byDomain[a].length) || ((b === site) - (a === site)));
  const domain = ranked[0] || site || null;
  const votes = {};
  (byDomain[domain] || []).forEach(c => {
    const id = detectFormat(c.first_name, c.last_name, String(c.email).split('@')[0]);
    if (id) votes[id] = (votes[id] || 0) + 1;
  });
  const order = FORMATS.map(f => f.id);
  const best = Object.keys(votes).sort((a, b) => (votes[b] - votes[a]) || (order.indexOf(a) - order.indexOf(b)))[0] || null;
  return { domain, pattern: best, learned_from: best ? votes[best] : 0, prior: MARKET_PRIOR };
}

/**
 * An address for a new name — ONLY from a learned format (D-0049: a guess is
 * never emailed, so this never builds one). Returns null when the format is
 * unknown or the name will not fit it.
 */
function emailFor(first, last, format) {
  if (!format || !format.pattern || !format.domain) return null;
  const f = nameKey(first), l = nameKey(last);
  const spec = FORMATS.find(x => x.id === format.pattern);
  if (!spec || !f || (!l && spec.id !== 'first')) return null;
  const local = spec.build(f, l || '');
  return local ? `${local}@${format.domain}` : null;
}

// Split "Jane Q. Smith-Jones" → { first: 'Jane', last: 'Smith-Jones' }.
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

module.exports = {
  SIZE_BANDS, SIZE_IDS, DEFAULT_SIZE, FUNCTIONS, FIRMS, MARKET_PRIOR, FORMATS,
  jobFunction, firmOf, normalizeSize, sizeBandFor, sameCompany, pocTargets, contactKind, fitScore, fillSlots, pickPeople,
  detectFormat, normalizeDomain, learnFormat, emailFor, splitName, nameKey,
};
