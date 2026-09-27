// THE POC FINDER'S RULES (R-053, D-0049) — services/poc-targets.js, pure.
//
// Pins, on the owner's real titles where there are any:
//   * the job's FUNCTION decides who the hiring manager is (and a car
//     dealership's estimator reports into the collision/service side);
//   * SIZE decides the slots (the owner's table), and an unknown size is
//     assumed "20-50" and SAID to be assumed;
//   * people already on the lead fill the slots best-fit-first, one each, and
//     nobody on the lead is ever dropped;
//   * the company's email FORMAT is learned from real addresses there (the
//     domain its people actually use, never a free-mail one);
//   * D-0049 — a guess is never emailed: `emailFor` REFUSES to build an address
//     without a learned format. The market prior exists and is never used to
//     send.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const poc = require('../services/poc-targets.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the job's function, on titles from the live leads (2026-09-27) ──────────
const FN = [
  ['Construction Project Manager/Estimator', 'Construction', 'estimating'],
  ['Junior Construction Estimator', 'Construction', 'estimating'],
  ['Heavy Civil Estimator Construction', 'Robotics Engineering', 'estimating'],
  ['Construction Manager', 'Construction', 'project'],
  ['HVAC Service Technician', 'Construction', 'service'],
  ['Building Engineer', 'Transportation Programs', 'engineering'],
  ['Office Manager/ Bookkeeper', 'Construction', 'finance'],
  ['Technical Recruiter', 'IT', 'hr'],
  ['Warehouse Associate', 'Logistics', 'operations'],
  ['Barista', 'Food', 'general'],
];
for (const [t, ind, want] of FN) {
  const got = poc.jobFunction(t, ind).id;
  step(`"${t}" is ${want} work`, got === want, got);
}
const dealer = poc.pocTargets({ position: 'Collision Estimator', industry: 'Automotive' }, '51-200');
step('a dealership estimator reports into the collision/service side, not to a "Chief Estimator"',
  /Collision Center Manager|Body Shop Manager/.test(dealer.slots.find(s => s.key === 'mgr1').titles.join('|')),
  dealer.slots.find(s => s.key === 'mgr1').label);

// ── size decides the slots ─────────────────────────────────────────────────
const est = { position: 'Junior Estimator', industry: 'Construction' };
const tiny = poc.pocTargets(est, '1-20');
step('four slots: two HR, two hiring managers',
  tiny.slots.length === 4 && tiny.slots.filter(s => s.kind === 'hr').length === 2 && tiny.slots.filter(s => s.kind === 'manager').length === 2);
step('under 20 people: the owner hires (Owner / President first)',
  tiny.slots.find(s => s.key === 'mgr1').titles.slice(0, 2).join(',') === 'Owner,President');
const mid = poc.pocTargets(est, '51-200');
step('50-200: the head of the job\'s own department', mid.slots.find(s => s.key === 'mgr1').titles[0] === 'Chief Estimator');
const big = poc.pocTargets(est, '1000+');
step('1,000+: the HR pair becomes talent acquisition',
  /Talent Acquisition/.test(big.slots.find(s => s.key === 'hr1').titles[0]) && /Recruiter/.test(big.slots.find(s => s.key === 'hr2').titles[0]));
const unknown = poc.pocTargets(est, null);
step('an unknown size is assumed 20-50 — and SAID to be assumed', unknown.size === '21-50' && unknown.size_known === false);
step('a known size is reported as known', mid.size_known === true && mid.size === '51-200');
step('a size outside the list is treated as unknown, not trusted', poc.pocTargets(est, 'huge').size_known === false);
step('every slot has a readable label', [tiny, mid, big].every(t => t.slots.every(s => typeof s.label === 'string' && s.label.length > 3)));

// ── who a person on file is ────────────────────────────────────────────────
const KIND = [
  ['human resources manager', '21-50', 'hr'], ['director of human resources', '1000+', 'hr'],
  ['payroll clerk/hr admin assistant', '21-50', 'hr'], ['recruiter', '201-1000', 'hr'],
  ['office manager', '1-20', 'hr'], ['office manager', '201-1000', 'other'],
  ['president', '21-50', 'manager'], ['president/ceo', '21-50', 'manager'], ['business owner', '21-50', 'manager'],
  ['chief estimator', '21-50', 'manager'], ['sr. project manager', '21-50', 'manager'],
  ['vice president operations', '51-200', 'manager'], ['attorney', '21-50', 'other'],
];
for (const [t, size, want] of KIND) {
  const got = poc.contactKind(t, size);
  step(`"${t}" at ${size} counts as ${want}`, got === want, got);
}

// ── filling the slots from the people on file ──────────────────────────────
const people = [
  { id: 'a', designation: 'Sr. Project Manager' },
  { id: 'b', designation: 'HR Manager' },
  { id: 'c', designation: 'Director of Estimating' },
  { id: 'd', designation: 'Attorney' },
  { id: 'e', designation: 'Human Resources Generalist' },
  { id: 'f', designation: 'Human Resources Coordinator' },
];
const filled = poc.fillSlots(poc.pocTargets(est, '21-50'), people);
const at = (k) => filled.slots.find(s => s.key === k).contact_id;
step('the best HR fit takes the first HR slot', at('hr1') === 'b', at('hr1'));
step('the function head takes the first hiring-manager slot', at('mgr1') === 'c', at('mgr1'));
step('one person per slot, nobody in two', new Set(filled.slots.map(s => s.contact_id).filter(Boolean)).size === filled.slots.filter(s => s.contact_id).length);
const placed = filled.slots.map(s => s.contact_id).filter(Boolean).concat(filled.others);
step('NOBODY on the lead is dropped — the rest are listed as others', people.every(p => placed.includes(p.id)) && placed.length === people.length, JSON.stringify(filled.others));
step('someone who fits no slot (an attorney) is kept, as another', filled.others.includes('d'));
step('an empty lead leaves all four slots open', poc.fillSlots(poc.pocTargets(est, null), []).slots.every(s => !s.contact_id));

// ── the company's email format ─────────────────────────────────────────────
const fmts = [['John', 'Smith', 'jsmith', 'flast'], ['John', 'Smith', 'john.smith', 'first.last'], ['John', 'Smith', 'john', 'first'],
  ['John', 'Smith', 'johnsmith', 'firstlast'], ['John', 'Smith', 'johns', 'firstl'], ['John', 'Smith', 'john_smith', 'first_last'],
  ['John', 'Smith', 'j.smith', 'f.last'], ['John', 'Smith', 'smith', 'last'], ['José', 'Núñez', 'jnunez', 'flast'], ['John', 'Smith', 'sales', null]];
for (const [f, l, local, want] of fmts) step(`${local}@ is read as ${want}`, poc.detectFormat(f, l, local) === want, String(poc.detectFormat(f, l, local)));

const learned = poc.learnFormat([
  { first_name: 'John', last_name: 'Smith', email: 'jsmith@acmebuild.com' },
  { first_name: 'Ann', last_name: 'Lee', email: 'alee@acmebuild.com' },
  { first_name: 'Bo', last_name: 'Ray', email: 'bo.ray@acmebuild.com' },
  { first_name: 'Cy', last_name: 'Fox', email: 'cy.fox@gmail.com' },
], 'https://www.acme-website.com');
step('the majority format wins (2 of 3 addresses)', learned.pattern === 'flast' && learned.learned_from === 2, JSON.stringify(learned));
step('the domain is the one its PEOPLE use, not just the website', learned.domain === 'acmebuild.com', learned.domain);
const freeOnly = poc.learnFormat([{ first_name: 'Cy', last_name: 'Fox', email: 'cfox@gmail.com' }], 'acme.com');
step('a free-mail address never teaches a company format', freeOnly.pattern === null && freeOnly.domain === 'acme.com', JSON.stringify(freeOnly));
step('the market prior is first initial + surname (measured 2026-09-27)', poc.MARKET_PRIOR === 'flast');

// ── D-0049: a guess is never emailed ───────────────────────────────────────
step('with a learned format, a new name gets its address', poc.emailFor('Dave', 'Reed', { domain: 'acmebuild.com', pattern: 'flast' }) === 'dreed@acmebuild.com');
step('accents and punctuation are handled', poc.emailFor('Zoë', "O'Brien", { domain: 'x.com', pattern: 'first.last' }) === 'zoe.obrien@x.com');
step('WITHOUT a learned format, NO address is built — not even the market prior',
  poc.emailFor('Dave', 'Reed', { domain: 'acmebuild.com', pattern: null }) === null &&
  poc.emailFor('Dave', 'Reed', freeOnly) === null);
step('a format that needs a surname is not applied to a one-word name', poc.emailFor('Dave', '', { domain: 'x.com', pattern: 'flast' }) === null);
step('splitting a name keeps first and last', JSON.stringify(poc.splitName('Mary Jane Smith-Jones')) === JSON.stringify({ first: 'Mary', last: 'Smith-Jones' }));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
