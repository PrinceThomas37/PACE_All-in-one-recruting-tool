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
// A bounced address may be somebody's wrong guess at the format — it teaches nothing (design §6 rule 5).
const bounced = poc.learnFormat([
  { first_name: 'John', last_name: 'Smith', email: 'john.smith@bnc.com', email_status: 'invalid' },
  { first_name: 'Ann', last_name: 'Lee', email: 'ann.lee@bnc.com', email_status: 'deactivated' },
  { first_name: 'Bo', last_name: 'Ray', email: 'bray@bnc.com', email_status: 'valid' },
], 'bnc.com');
step('a BOUNCED address never teaches the format (2 dead first.last vs 1 live flast → flast)',
  bounced.pattern === 'flast' && bounced.learned_from === 1, JSON.stringify(bounced));
step('…and when every address there bounced, no format is learned at all',
  poc.learnFormat([{ first_name: 'John', last_name: 'Smith', email: 'jsmith@dead.com', email_status: 'invalid' }], 'dead.com').pattern === null);
step('an out-of-office reply is not a bounce — that address still teaches',
  poc.learnFormat([{ first_name: 'John', last_name: 'Smith', email: 'jsmith@ooo.com', email_status: 'out_of_office' }], 'ooo.com').pattern === 'flast');

// ── the company's size from Apollo's employee estimate (2026-09-28) ────────
const bands = [[1,'1-20'],[20,'1-20'],[21,'21-50'],[50,'21-50'],[51,'51-200'],[200,'51-200'],[201,'201-1000'],[1000,'201-1000'],[1001,'1000+'],[250000,'1000+']];
step('an employee estimate lands in the right band at every edge', bands.every(([n, b]) => poc.sizeBandFor(n) === b),
  bands.map(([n]) => n + ':' + poc.sizeBandFor(n)).join(' '));
step('an unknown, zero or nonsense estimate is "not known", never a size',
  [null, undefined, 0, -3, 'many', NaN].every(x => poc.sizeBandFor(x) === null));
const same = [['Saylor Consulting Group', 'Saylor Consulting'], ['KB Home', 'KBHome'], ['The Walsh Group', 'Walsh Construction'],
  ['Café Núñez LLC', 'Cafe Nunez'], ['Smith & Sons Inc.', 'Smith and Sons']];
step('the same company under a slightly different name is recognised', same.every(([a, b]) => poc.sameCompany(a, b)),
  same.filter(([a, b]) => !poc.sameCompany(a, b)).map(x => x.join(' ~ ')).join(' | '));
const diff = [['Northwind Builders', 'Southgate Holdings'], ['Acme Builders', 'Zenith Construction'], ['', 'Anything'], ['Group Inc', 'LLC']];
step('a different company is NOT taken for ours (and an empty name never matches)', diff.every(([a, b]) => !poc.sameCompany(a, b)),
  diff.filter(([a, b]) => poc.sameCompany(a, b)).map(x => x.join(' ~ ')).join(' | '));

// ── picking people from a search for the EMPTY slots (slice 2) ─────────────
const tg = poc.pocTargets({ position: 'Junior Estimator', industry: 'Construction' }, '21-50');
const slotsNow = poc.fillSlots(tg, [
  { id: 'm', first_name: 'Maria', last_name: 'Lopez', designation: 'HR Manager' },   // fills hr1
]).slots;
const found = [
  { id: 'p1', first_name: 'Olivia', last_name: 'Stone', title: 'Office Manager' },
  { id: 'p2', first_name: 'Dave', last_name: '', title: 'Chief Estimator' },          // surname hidden
  { id: 'p3', first_name: 'Eve', last_name: 'Park', title: 'Estimating Manager' },
  { id: 'p4', first_name: 'Maria', last_name: 'Lopez', title: 'HR Manager' },         // already on the lead
  { id: 'p5', first_name: 'Pat', last_name: 'Nobody', title: 'Warehouse Associate' }, // neither
  { id: 'p6', first_name: 'Carl', last_name: 'Boss', title: 'President' },
];
const picked = poc.pickPeople(slotsNow, found, { ids: [], names: ['Maria Lopez'] }, tg.size, []);
const pk = (k) => (picked.find(x => x.slot_key === k) || {}).person || {};
step('a FILLED slot gets nobody', !picked.some(x => x.slot_key === 'hr1'), JSON.stringify(picked.map(x => x.slot_key)));
step('the best title fit takes an empty slot (office manager → HR 2 at 20–50)', pk('hr2').id === 'p1', pk('hr2').id);
step('the function head beats a lesser title (chief estimator over estimating manager)', pk('mgr1').id === 'p2', pk('mgr1').id);
step('the owner/president slot gets the president', pk('mgr2').id === 'p6', pk('mgr2').id);
step('somebody already on the lead is never picked', !picked.some(x => x.person.id === 'p4'));
step('nobody outside HR or management is picked', !picked.some(x => x.person.id === 'p5'));
step('one person, one slot', new Set(picked.map(x => x.person.id)).size === picked.length);
step('the order is slot order', picked.map(x => x.slot_key).join() === 'hr2,mgr1,mgr2', picked.map(x => x.slot_key).join());
const again = poc.pickPeople(slotsNow, found, { ids: ['p2', 'p6'], names: ['Maria Lopez'] }, tg.size, []);
step('somebody suggested or turned down before is never picked again — the next best fit is',
  !again.some(x => ['p2', 'p6'].includes(x.person.id)) && (again.find(x => x.slot_key === 'mgr1') || {}).person.id === 'p3', JSON.stringify(again.map(x => [x.slot_key, x.person.id])));
const waitingSkip = poc.pickPeople(slotsNow, found, { ids: [], names: ['Maria Lopez'] }, tg.size, ['hr2', 'mgr2']);
step('a slot with somebody already waiting is left alone', waitingSkip.map(x => x.slot_key).join() === 'mgr1', waitingSkip.map(x => x.slot_key).join());
step('no people, or nothing open → nobody', poc.pickPeople(slotsNow, [], null, tg.size).length === 0 &&
  poc.pickPeople(slotsNow.map(x => Object.assign({}, x, { contact_id: 'z' })), found, null, tg.size).length === 0);

// ── D-0049: a guess is never emailed ───────────────────────────────────────
step('with a learned format, a new name gets its address', poc.emailFor('Dave', 'Reed', { domain: 'acmebuild.com', pattern: 'flast' }) === 'dreed@acmebuild.com');
step('accents and punctuation are handled', poc.emailFor('Zoë', "O'Brien", { domain: 'x.com', pattern: 'first.last' }) === 'zoe.obrien@x.com');
step('WITHOUT a learned format, NO address is built — not even the market prior',
  poc.emailFor('Dave', 'Reed', { domain: 'acmebuild.com', pattern: null }) === null &&
  poc.emailFor('Dave', 'Reed', freeOnly) === null);
step('a format that needs a surname is not applied to a one-word name', poc.emailFor('Dave', '', { domain: 'x.com', pattern: 'flast' }) === null);
step('splitting a name keeps first and last', JSON.stringify(poc.splitName('Mary Jane Smith-Jones')) === JSON.stringify({ first: 'Mary', last: 'Smith-Jones' }));

// ── professional firms (R-063, D-0052) — on the owner's REAL leads ────────
// 16 of 82 live leads (2026-09-28) are law, accounting or architecture firms,
// and the generic rules looked there for a General Manager, a Controller or an
// Engineering Manager, and ignored Attorney / Shareholder / Founding Member.
const law = poc.pocTargets({ position: 'Litigation Paralegal', industry: 'Law Practice' }, null);
const lawT = (k) => (law.slots.find(s => s.key === k) || {}).titles || [];
step('firm: a law practice is recognised from its industry', law.firm === 'law' && law.function.label === 'legal', law.firm + ' / ' + law.function.label);
step('firm: a paralegal\'s hiring manager is a partner or supervising attorney — not a General Manager',
  lawT('mgr1').includes('Supervising Attorney') && lawT('mgr1').includes('Managing Partner') && !lawT('mgr1').concat(lawT('mgr2')).some(t => /General Manager|CEO/.test(t)), JSON.stringify([lawT('mgr1'), lawT('mgr2')]));
step('firm: the top of a law firm is its Managing Partner, not a CEO', lawT('mgr2')[0] === 'Managing Partner', lawT('mgr2').join(', '));
step('firm: at a law firm the Firm Administrator is tried first for HR', lawT('hr1')[0] === 'Firm Administrator', lawT('hr1').join(', '));
const tax = poc.pocTargets({ position: 'Tax Manager', industry: 'Accounting' }, null);
const audit = poc.pocTargets({ position: 'Audit Accountant | CPA Firm', industry: 'Accounting' }, null);
const taxT = (t, k) => (t.slots.find(s => s.key === k) || {}).titles || [];
step('firm: a tax job at an accounting firm reports to the tax side (Tax Partner) — not a Controller or CFO',
  tax.firm === 'accounting' && taxT(tax, 'mgr1')[0] === 'Tax Partner' && !taxT(tax, 'mgr1').some(t => /Controller|CFO/.test(t)), taxT(tax, 'mgr1').join(', '));
step('firm: an audit job reports to the audit side', taxT(audit, 'mgr1')[0] === 'Audit Partner', taxT(audit, 'mgr1').join(', '));
const arch = poc.pocTargets({ position: 'Project Architect', industry: 'Architecture and Planning' }, null);
step('firm: an architect reports to a Principal — not an Engineering Manager',
  arch.firm === 'architecture' && taxT(arch, 'mgr1')[0] === 'Principal' && !taxT(arch, 'mgr1').some(t => /Engineering Manager/.test(t)), taxT(arch, 'mgr1').join(', '));
const archPm = poc.pocTargets({ position: 'Construction Project Manager', industry: 'Architecture and Planning' }, null);
step('firm: a NON-practice job at a firm keeps its own function\'s heads (a construction PM is not sent to the office manager)',
  taxT(archPm, 'mgr1')[0] === 'Director of Operations' && !taxT(archPm, 'mgr1').some(t => /Office Manager|Studio Manager/.test(t)) && taxT(archPm, 'mgr2')[0] === 'Principal',
  JSON.stringify([taxT(archPm, 'mgr1'), taxT(archPm, 'mgr2')]));
const tinyLaw = poc.pocTargets({ position: 'Litigation Paralegal', industry: 'Law Practice' }, '1-20');
step('firm: at a tiny firm the second hiring manager is a practitioner, not a repeat of the partners',
  taxT(tinyLaw, 'mgr1')[0] === 'Managing Partner' && taxT(tinyLaw, 'mgr2')[0] === 'Supervising Attorney', JSON.stringify([taxT(tinyLaw, 'mgr1'), taxT(tinyLaw, 'mgr2')]));
const estFirm = poc.pocTargets({ position: 'Junior Estimator', industry: 'Construction' }, null);
step('firm: a construction lead is untouched (no firm, the same heads as before)',
  estFirm.firm === null && taxT(estFirm, 'mgr1')[0] === 'Chief Estimator' && taxT(estFirm, 'mgr2').join() === 'President,Owner,CEO,General Manager', JSON.stringify([estFirm.firm, taxT(estFirm, 'mgr2')]));
step('firm: "Attorney", "Senior Litigation Attorney", "Managing Attorney" are leaders AT A LAW FIRM',
  ['Attorney', 'Senior Litigation Attorney', 'Managing Attorney'].every(t => poc.contactKind(t, '21-50', 'law') === 'manager'));
step('firm: …but not at a construction company (an in-house attorney does not hire an estimator)',
  poc.contactKind('Attorney', '21-50', null) === 'other');
step('firm: the Firm Administrator is the people function at a law firm at ANY size — even 51-200',
  poc.contactKind('Law Firm Administrator', '51-200', 'law') === 'hr' && poc.contactKind('Law Firm Administrator', '51-200', null) === 'other');
step('leaders everywhere: Shareholder, CPA/Shareholder, Founding Member, Managing Member',
  ['Shareholder', 'CPA/Shareholder', 'Founding Member', 'Managing Member'].every(t => poc.contactKind(t, '21-50') === 'manager'));
step('…but a "Team Member" or "Board Member" is not a leader', poc.contactKind('Team Member', '21-50') === 'other' && poc.contactKind('Board Member', '21-50') === 'other');
step('HR under its newer names is HR — never a hiring manager ("People and Culture Director" was the one misread on the live leads)',
  ['People and Culture Director', 'People & Culture Manager', 'Chief People Officer', 'Head of People', 'VP People', 'People Partner', 'Employee Relations Manager', 'Total Rewards Manager'].every(t => poc.contactKind(t, '21-50') === 'hr'),
  ['People and Culture Director', 'Chief People Officer', 'People Partner'].map(t => t + '=' + poc.contactKind(t, '21-50')).join(' '));
step('…and "People Operations Manager", "HR Business Partner" still are', poc.contactKind('People Operations Manager', '21-50') === 'hr' && poc.contactKind('HR Business Partner', '51-200') === 'hr');
// The real before/after: every one of these is a title on the owner's live leads.
const liveLaw = ['Attorney', 'Senior Litigation Attorney', 'Managing Attorney'];
step('on the live leads: the three attorneys at law firms were read as nobody and are now leaders',
  liveLaw.every(t => poc.contactKind(t, '21-50', 'law') === 'manager'));
// pickPeople takes the firm too: an attorney found by Apollo can fill a law firm's slot.
const lawFilled = poc.fillSlots(law, []);
const lawPicks = poc.pickPeople(lawFilled.slots, [{ id: 'a1', first_name: 'Amy', last_name: 'Cho', title: 'Supervising Attorney' }], null, law.size, [], law.firm);
step('firm: a supervising attorney Apollo finds fills a law firm\'s hiring-manager slot', lawPicks.length === 1 && lawPicks[0].slot_key === 'mgr1', JSON.stringify(lawPicks.map(x => x.slot_key)));
step('firm: …and without the firm she would not (the rule is the firm\'s, not everyone\'s)',
  poc.pickPeople(lawFilled.slots, [{ id: 'a1', first_name: 'Amy', last_name: 'Cho', title: 'Attorney' }], null, law.size, [], null).length === 0);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
