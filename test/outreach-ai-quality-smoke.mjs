// The AI seam: a typed job title beats a scraped one, and a draft is held to
// the house rules a machine can actually verify.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gen = require('../services/outreach-generator.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

const JD = `Construction Superintendent
We are seeking a Superintendent to run commercial ground-up projects in Dallas, TX.
Requirements: 8+ years supervising commercial construction for a General Contractor,
OSHA 30, Procore. Similar roles: Project Engineer, Estimator, Safety Coordinator.`;

const BASE = {
  outreach_type: 'first', contact_first_name: 'Susan', contact_title: 'HR Manager',
  company: 'Rich Contracting', location: 'Dallas, TX', job_description: JD,
  sender: { name: 'Prince Thomas', title: 'Account Manager', email: 'p@x.com' },
};
const good = {
  subject: 'Construction Superintendent — Dallas',
  diagnosis: 'Ground-up commercial plus OSHA 30 and Procore is a narrow pool.',
  email: ['Hi Susan,', '',
    'This is Prince Thomas at Fute Global. I saw your Construction Superintendent opening in Dallas.',
    '',
    'The combination you are asking for is the hard part: eight years running ground-up commercial work for a general contractor, plus OSHA 30 and Procore. That is a narrow pool in this market, and the people who have it are usually already on a project rather than answering postings.',
    '',
    'We have superintendents with exactly that background. Would it help if I sent a few resumes over for you to look at?',
    '',
    'There is no charge for reviewing resumes. We only charge a fee on a successful placement.',
    '', 'Thanks,'].join('\n'),
};

console.log('\nJob title');
t('a typed job title overrides one scraped from the posting', () => {
  const p = gen.draftParts({ ...BASE, job_title: 'Traveling Superintendent' }, {});
  assert.equal(p.role, 'Traveling Superintendent');
});
t('with no typed title it still reads the posting — and can read it loosely', () => {
  // The scraper returns "Superintendent", not "Construction Superintendent".
  // That is exactly the gap the typed field closes: the heuristic is doing its
  // best on pasted clutter, and the user knows the answer outright.
  const p = gen.draftParts(BASE, {});
  assert.equal(p.role, 'Superintendent');
});
t('the payload marks the typed title authoritative', () => {
  const out = gen.buildUserPayload({ ...BASE, job_title: 'Site Manager' });
  assert.match(out, /ROLE BEING HIRED FOR: Site Manager/);
  assert.match(out, /authoritative/);
});
t('the system prompt tells the model to ignore other titles on the page', () => {
  assert.match(gen.buildSystemPrompt('Acme', {}), /ROLE BEING HIRED FOR/);
});
t('a style reference is passed as a reference, never to copy', () => {
  const out = gen.buildUserPayload({ ...BASE, style_reference: 'Hi Susan,\nThis is a sample.' });
  assert.match(out, /HOUSE STYLE REFERENCE/);
  assert.match(out, /Do NOT copy its sentences/);
});
t('no style reference means no style section', () => {
  assert.doesNotMatch(gen.buildUserPayload(BASE), /HOUSE STYLE REFERENCE/);
});

console.log('\nHouse-style check');
const codes = (d, i = BASE, o = {}) => gen.checkDraft(d, i, o).violations.map(v => v.code);

t('a clean draft passes', () => {
  const r = gen.checkDraft(good, BASE, { omitSignOff: true });
  assert.deepEqual(r.violations.map(v => v.code), []);
  assert.equal(r.ok, true);
});
t('an unfilled placeholder is caught — it has reached a live prospect before', () => {
  assert.ok(codes({ ...good, email: good.email.replace('Susan', '{{first_name}}') }, BASE, { omitSignOff: true }).includes('placeholder'));
});
t('a stated fee percentage is caught', () => {
  assert.ok(codes({ ...good, email: good.email.replace('a fee on a successful placement', 'a 20% fee') }, BASE, { omitSignOff: true }).includes('fee_percentage'));
});
t('asking for a call instead of resumes is caught', () => {
  const email = good.email.replace('Would it help if I sent a few resumes over for you to look at?', 'Do you have 15 minutes for a quick call this week?');
  assert.ok(codes({ ...good, email }, BASE, { omitSignOff: true }).includes('meeting_ask'));
});
t('no question at all is caught', () => {
  assert.ok(codes({ ...good, email: good.email.replace(/\?/g, '.') }, BASE, { omitSignOff: true }).includes('no_ask'));
});
t('marketing adjectives and exclamation marks are caught', () => {
  const c = codes({ ...good, email: good.email.replace('We have', 'We have passionate, world-class') + '\nExcited to help!' }, BASE, { omitSignOff: true });
  assert.ok(c.includes('marketing_word'));
  assert.ok(c.includes('exclamation'));
});
t('a second sign-off above the appended signature is caught', () => {
  const email = good.email.replace('Thanks,', 'Best regards,\nPrince Thomas\nAccount Manager');
  const c = codes({ ...good, email }, BASE, { omitSignOff: true });
  assert.ok(c.includes('double_signoff'), c.join(','));
  assert.ok(c.includes('double_signoff_name'), c.join(','));
});
t('REGRESSION: the required identity sentence is not a second sign-off', () => {
  // Live gpt-oss-120b follow-up, rejected by the first version of this check:
  // rule 1 REQUIRES "This is <sender> at <company>" in sentence one, and on a
  // compact email a last-few-lines window swallows the whole body.
  const email = ['Hi Susan,',
    'This is Prince Thomas at Fute Global. I see the Construction Superintendent role has been open for over a month, and the mix of eight years on large commercial projects, OSHA 30 and Procore makes qualified candidates scarce.',
    'Would you like me to send a few vetted resumes over?', 'Thanks,'].join('\n');
  assert.deepEqual(codes({ ...good, email }, { ...BASE, outreach_type: 'followup' }, { omitSignOff: true }), []);
});
t('a missing greeting is caught — a cold email that opens "This is..." reads as a broadcast', () => {
  const email = good.email.replace('Hi Susan,\n\n', '');
  assert.ok(codes({ ...good, email }, BASE, { omitSignOff: true }).includes('no_greeting'));
});
t('the greeting rule is in the prompt, not only the check', () => {
  assert.match(gen.buildSystemPrompt('Acme', {}), /Greet the contact by first name/);
});
t('the same sign-off is fine when no signature will be appended', () => {
  const email = good.email.replace('Thanks,', 'Best regards,\nPrince Thomas\nAccount Manager');
  assert.deepEqual(codes({ ...good, email }, BASE, { omitSignOff: false }), []);
});
t('fee language before the ask is caught for a non-finance reader', () => {
  const email = ['Hi Susan,', 'This is Prince Thomas at Fute Global and there is no charge to review resumes.',
    'Eight years of ground-up commercial work plus OSHA 30 and Procore is a genuinely narrow pool in Dallas right now, and the people who have it are usually mid-project rather than answering postings, which is why this one sits open.',
    'Would you like me to send a few over?', 'Thanks,'].join('\n\n');
  assert.ok(codes({ ...good, email }, BASE, { omitSignOff: true }).includes('fee_before_ask'));
});
t('the same order is FINE for a Controller — cost is their objection', () => {
  const email = ['Hi Susan,', 'This is Prince Thomas at Fute Global and there is no charge to review resumes.',
    'Eight years of ground-up commercial work plus OSHA 30 and Procore is a genuinely narrow pool in Dallas right now, and the people who have it are usually mid-project rather than answering postings, which is why this one sits open.',
    'Would you like me to send a few over?', 'Thanks,'].join('\n\n');
  const c = codes({ ...good, email }, { ...BASE, contact_title: 'Controller' }, { omitSignOff: true });
  assert.ok(!c.includes('fee_before_ask'), c.join(','));
});
t('a no-agencies posting holds the email under 90 words', () => {
  assert.ok(codes(good, { ...BASE, no_agencies: true }, { omitSignOff: true }).includes('too_long'));
});
t('a follow-up is held under 85 words', () => {
  assert.ok(codes(good, { ...BASE, outreach_type: 'followup' }, { omitSignOff: true }).includes('too_long'));
});
t('a two-line email has no researched paragraph', () => {
  assert.ok(codes({ ...good, email: 'Hi Susan,\n\nWant resumes?\n\nThanks,' }, BASE, { omitSignOff: true }).includes('too_short'));
});
t('an empty body fails immediately and says so', () => {
  const r = gen.checkDraft({ subject: 'x', email: '' }, BASE, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations.map(v => v.code), ['empty']);
});

console.log('\nRepair turn');
t('the repair prompt names every violation and carries the draft back', () => {
  const v = gen.checkDraft({ ...good, email: good.email.replace('a fee on a successful placement', 'a 20% fee') }, BASE, { omitSignOff: true });
  const p = gen.buildRepairPrompt(good, v.violations);
  assert.match(p, /Fix ONLY these problems/);
  assert.match(p, /percentage/i);
  assert.match(p, /YOUR PREVIOUS DRAFT/);
  assert.ok(p.includes(good.subject));
});

console.log('\nWiring');
const route = readFileSync(new URL('../routes/outreach-generator.js', import.meta.url), 'utf8');
t('the route checks the AI draft before showing it', () => {
  assert.match(route, /gen\.checkDraft\(/);
  assert.match(route, /gen\.buildRepairPrompt\(/);
});
t('a draft that still breaks a rule falls back to the rules writer', () => {
  assert.match(route, /ai_error: 'draft_rejected'/);
});
t('the repair is only taken when it is genuinely better', () => {
  assert.match(route, /recheck\.violations\.length < check\.violations\.length/);
});
t('the fallback explains WHY, from the recorded provider error', () => {
  assert.match(route, /ai_last_error/);
  assert.match(route, /ai_error_detail/);
});
const provider = readFileSync(new URL('../services/ai-provider.js', import.meta.url), 'utf8');
t('a failed quality model falls back to the same provider fast model', () => {
  assert.match(provider, /const modelsFor = \(entry\)/);
  assert.match(provider, /limits\.tier !== 'fast'/);
});
t('an admin model override is never second-guessed', () => {
  assert.match(provider, /!entry\.model_override/);
});
const page = readFileSync(new URL('../public/js/48-page-outreach-gen.js', import.meta.url), 'utf8');
t('the page sends the job title and shows which engine wrote the draft', () => {
  assert.match(page, /job_title:f\.job_title/);
  assert.match(page, /og-jobtitle/);
  assert.match(page, /Written by the AI/);
});

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
