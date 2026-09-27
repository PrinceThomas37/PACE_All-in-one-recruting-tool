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

function jobFunction(title, industry) {
  const t = String(title || '');
  const fn = FUNCTIONS.find(f => f.match.test(t)) || GENERAL;
  const ov = INDUSTRY_HEADS.find(o => o.industry.test(String(industry || '')) && o.fns.includes(fn.id));
  return ov ? Object.assign({}, fn, { heads: ov.heads, managers: ov.managers, directors: ov.directors }) : fn;
}

function normalizeSize(s) { return SIZE_IDS.includes(s) ? s : null; }

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
  return [
    { key: 'hr1', kind: 'hr', titles: uniq(a) },
    { key: 'hr2', kind: 'hr', titles: uniq(b) },
  ];
}

function managerSlots(size, fn) {
  let a, b;
  if (size === '1-20') {
    a = ['Owner', 'President', 'CEO', 'Founder'];
    b = ['Co-Owner', 'Partner', 'Vice President', 'General Manager', fn.heads[0]];
  } else if (size === '21-50') {
    a = fn.heads.slice();
    b = ['President', 'Owner', 'CEO', 'General Manager'];
  } else if (size === '51-200') {
    a = fn.heads.slice();
    b = fn.directors.concat(['Director of Operations', 'General Manager', 'Vice President']);
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
  return { size: used, size_known: !!size, function: { id: fn.id, label: fn.label }, slots };
}

// ── putting the people already on file into the slots ───────────────────────
const HR_WORDS = /\b(hr|h\.r\.|human resources?|human resource|people (ops|operations)|talent|recruit\w*|payroll|personnel|benefits)\b/i;
// At a small firm the office manager IS the HR department; at a big one an
// office manager is not who hires.
const OFFICE_WORDS = /\b(office manager|office admin\w*|administrat\w*|business manager|executive assistant|admin assistant)\b/i;
const MANAGER_WORDS = /\b(owner|president|ceo|founder|partner|principal|chairman|chief|coo|cfo|cto|cio|vp|vice president|director|head|general manager|manager|superintendent|supervisor|lead)\b/i;

function contactKind(designation, size) {
  const d = String(designation || '');
  if (HR_WORDS.test(d)) return 'hr';
  const small = size === '1-20' || size === '21-50';
  if (OFFICE_WORDS.test(d)) return small ? 'hr' : 'other';
  if (MANAGER_WORDS.test(d)) return 'manager';
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
    const kind = contactKind(c.designation, targets.size);
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
 */
function learnFormat(contacts, website) {
  const byDomain = {};
  (contacts || []).forEach(c => {
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
  SIZE_BANDS, SIZE_IDS, DEFAULT_SIZE, FUNCTIONS, MARKET_PRIOR, FORMATS,
  jobFunction, normalizeSize, pocTargets, contactKind, fitScore, fillSlots,
  detectFormat, normalizeDomain, learnFormat, emailFor, splitName, nameKey,
};
