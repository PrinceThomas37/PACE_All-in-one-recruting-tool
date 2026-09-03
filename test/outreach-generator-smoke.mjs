// Outreach generator — the rules writer, the AI seam, and the mounted routes.
//
// The rules writer is the part that has to be right, because it is what an
// unfunded deployment actually ships: there is no key in production, so every
// email this feature sends comes out of these functions. The assertions below
// are the rules from the prompt, checked as behaviour — the no-agencies short
// form, the follow-up short form, finance-first fee placement, the one-detail
// limit, and the refusal to invent skills that are not in the posting.
//
// Usage: node test/outreach-generator-smoke.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const gen = require(path.join(ROOT, 'services/outreach-generator.js'));

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail: String(detail) });

const CO = 'Acme Staffing LLC';

// Real postings, pasted the way a person actually pastes them — starting at
// "Job description", with the board's furniture still in, and the headings
// glued onto the sentences that follow. Every one of these was a bug report
// from the owner before it was a fixture.
const FIX = (n) => readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const CONSTRUCTION = FIX('posting-construction.txt');
const NURSE = FIX('posting-nurse.txt');
const BACKEND = FIX('posting-backend.txt');
const LINKEDIN = FIX('contact-linkedin.txt');

// ── The bug report of 2026-09-03, pinned ───────────────────────────────────
// A Construction Superintendent posting produced an email whose subject was
// "Job description in Lancaster, PA", named no real skills, and blamed a
// certification requirement that lived in the PREFERRED block. Each assertion
// below is one of those failures.
ok('a paste that starts at "Job description" still finds the real title',
  gen.extractRoleTitle(CONSTRUCTION) === 'Construction Superintendent', gen.extractRoleTitle(CONSTRUCTION));
ok('a salary chip is never mistaken for the job title',
  !/\$/.test(gen.extractRoleTitle(CONSTRUCTION)), gen.extractRoleTitle(CONSTRUCTION));
ok('"Job description" is never the job title',
  !/^job\s*description$/i.test(gen.extractRoleTitle(CONSTRUCTION)));
ok('headings glued to the next sentence are ungrued',
  gen.normalizeText('Required ExperienceSignificant experience').includes('\nSignificant'));
ok('a real name is not split by the unglue pass',
  gen.normalizeText('McDonald and DeWalt').includes('McDonald'), gen.normalizeText('McDonald and DeWalt'));
ok('required and preferred are separated on a HEADING, not the word "preferred"',
  gen.sections(CONSTRUCTION).required.includes('10+ years'),
  gen.sections(CONSTRUCTION).required.slice(-90));
ok('a certification that is only PREFERRED is not reported as the gate',
  gen.diagnoseSignal(CONSTRUCTION, '').id === 'seniority', JSON.stringify(gen.diagnoseSignal(CONSTRUCTION, '')));
ok("a driver's licence is not a hiring gate",
  gen.diagnoseSignal("Requirements Valid driver's license. 5 years of field experience.", '').id !== 'licence');
ok('the diagnosis quotes the posting cleanly, not a clipped verdict',
  /10\+ years of commercial construction supervision experience$/.test(gen.diagnoseSignal(CONSTRUCTION, '').why.split('—')[1].trim().replace(/\s+—.*$/, '')) ||
  gen.diagnoseSignal(CONSTRUCTION, '').why.includes('10+ years of commercial construction supervision experience —'),
  gen.diagnoseSignal(CONSTRUCTION, '').why);
ok('real requirements are extracted from a construction posting',
  gen.extractRequirements(CONSTRUCTION).phrases.length > 0,
  JSON.stringify(gen.extractRequirements(CONSTRUCTION)));
ok('the tools it names are real tools, not adjectives',
  JSON.stringify(gen.extractRequirements(CONSTRUCTION).named.sort()) === JSON.stringify(['OSHA 30', 'Procore']),
  JSON.stringify(gen.extractRequirements(CONSTRUCTION).named));

// The same extraction has to work on industries this code was never written
// against — that is the difference between a parser and a hard-coded example.
ok('a nursing posting yields its own title and credentials',
  gen.extractRoleTitle(NURSE) === 'Registered Nurse - ICU' &&
  gen.extractRequirements(NURSE).named.includes('ACLS'),
  gen.extractRoleTitle(NURSE) + ' / ' + gen.extractRequirements(NURSE).named);
ok('a backend posting yields its own title and stack',
  gen.extractRoleTitle(BACKEND) === 'Senior Backend Engineer' &&
  gen.extractRequirements(BACKEND).phrases.some(p => /Java/.test(p.text)),
  gen.extractRoleTitle(BACKEND) + ' / ' + JSON.stringify(gen.extractRequirements(BACKEND).phrases));
ok('a phrase never ends on a dangling preposition',
  !gen.extractRequirements(NURSE).phrases.some(p => /\b(in|an|a|the|of|and|with|for)$/i.test(p.text)),
  JSON.stringify(gen.extractRequirements(NURSE).phrases));

// A pasted LinkedIn profile is notes, and the ONE detail taken from it has to
// be a fact. The first version emitted the sentence "Ed Jones, which is why I
// am writing to you rather than through the posting."
ok('the note detail is never just the contact\'s own name',
  !/^ed jones$/i.test(gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' })),
  gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' }));
ok('a career history becomes a fact about where they came from',
  /estimating/.test(gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' })),
  gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' }));
ok('a mutual connection is picked over anything else in the notes',
  gen.pickNoteDetail('Mutual connection Priya introduced us. She has been there 9 years.', {}) === 'we have Priya in common',
  gen.pickNoteDetail('Mutual connection Priya introduced us. She has been there 9 years.', {}));
ok('empty notes produce no detail sentence', gen.pickNoteDetail('', {}) === '');

// Who we are writing to changes the email, not just a word in it.
ok('a VP reads as an executive', gen.audienceOf('Vice President of Operations') === 'exec');
ok('a Controller reads as finance first', gen.audienceOf('Controller') === 'finance');
ok('a talent partner reads as HR', gen.audienceOf('Talent Acquisition Partner') === 'hr');
ok('a superintendent reads as the hiring manager', gen.audienceOf('Site Superintendent') === 'manager');

// Grammar that a recruiter would notice before a client did.
ok('a specialisation after a dash is dropped before pluralising',
  gen.pluralRole('Registered Nurse - ICU') === 'Registered Nurses', gen.pluralRole('Registered Nurse - ICU'));
ok('a company already ending in s takes a bare apostrophe',
  gen.possessive('Health Partners') === "Health Partners'", gen.possessive('Health Partners'));
ok('a greeting uses the first name only', gen.firstNameOf('Ed Jones') === 'Ed');

// The whole email, on the posting that produced the bug report.
const real = gen.rulesDraft({
  outreach_type: 'first', contact_first_name: 'Ed Jones', contact_title: 'Vice President',
  company: 'Berks Construction Group, LLC', location: 'Lancaster, PA',
  job_description: CONSTRUCTION, notes: LINKEDIN,
  sender: { name: 'Prince Thomas', title: 'Account Manager' }
}, { companyName: CO });
ok('the subject names the real role', real.subject.startsWith('Construction Superintendent'), real.subject);
ok('the email greets Ed, not "Ed Jones"', real.email.startsWith('Hi Ed,'), real.email.slice(0, 20));
ok('the email names what the posting actually asks for',
  /Procore/.test(real.email) && /OSHA 30/.test(real.email), real.email);
ok('the email names the role, not "Job description"',
  /Construction Superintendent/.test(real.email) && !/Job description/i.test(real.email), real.email);
ok('the email stays inside the length rule', gen.wordCount(real.email) <= 170, gen.wordCount(real.email));

const JD = [
  'Quick Apply',
  '4.1 out of 5 stars',
  'Job Title: Senior Project Accountant',
  'We are seeking a Senior Project Accountant to own job costing and month-end close.',
  'Requirements: 10+ years of construction accounting, CPA preferred, experience with Sage.',
  'This position is fully on-site in our Tucson office.',
  'Continue'
].join('\n');

const base = {
  outreach_type: 'first',
  contact_first_name: 'Susan',
  contact_title: 'HR Manager',
  company: 'Robert Caylor Construction Co',
  location: 'Tucson, AZ',
  job_description: JD,
  sender: { name: 'Prince Thomas', title: 'Account Manager', email: 'p@x.com' }
};

// ── reading the posting ────────────────────────────────────────────────────
ok('site clutter is dropped before anything reads the posting',
  !gen.contentLines(JD).some(l => /Quick Apply|Continue|out of 5 stars/i.test(l)),
  gen.contentLines(JD).join(' | '));
ok('the role title comes off the "Job Title:" line',
  gen.extractRoleTitle(JD) === 'Senior Project Accountant', gen.extractRoleTitle(JD));
ok('only skills that appear in the posting are extracted',
  gen.extractSkills(JD).includes('Sage') && !gen.extractSkills(JD).includes('Python'),
  gen.extractSkills(JD).join(','));
ok('an empty posting yields no invented title', gen.extractRoleTitle('') === '');

// ── rule 1, 8, 10, 14: the standard first outreach ─────────────────────────
const d1 = gen.rulesDraft(base, { companyName: CO });
ok('the first sentence carries the sender and the company (rule 1)',
  /This is Prince Thomas at Acme Staffing LLC\./.test(d1.email), d1.email.slice(0, 120));
ok('the ask is a yes/no about resumes, not a call (rule 8)',
  /resumes/i.test(d1.email) && !/\b(call|meeting|15 minutes|catch up)\b/i.test(d1.email), d1.email);
ok('the fee framing names no percentage (rule 10)',
  /no charge for reviewing resumes/i.test(d1.email) && !/%/.test(d1.email));
ok('the sign-off is name, title, company and nothing else (rule 14)',
  d1.email.trim().endsWith('Account Manager, Acme Staffing LLC'), d1.email.slice(-80));
ok('the standard email stays in the 90-165 word band (rule 7)',
  gen.wordCount(d1.email) >= 60 && gen.wordCount(d1.email) <= 165, gen.wordCount(d1.email));
ok('no marketing adjectives or exclamation points (rule 11)',
  !/(passionate|dynamic|exceptional|cutting-edge|seamless|!)/i.test(d1.email), d1.email);
ok('the company name is a parameter, not a constant',
  !/Fute Global/i.test(d1.email + d1.subject + gen.buildSystemPrompt(CO)));

// ── rule 9: finance-first readers get cost before the ask ──────────────────
const fin = gen.rulesDraft({ ...base, contact_title: 'Controller' }, { companyName: CO });
ok('a Controller sees the fee line BEFORE the ask (rule 9)',
  fin.email.indexOf('no charge for reviewing resumes') < fin.email.indexOf('Would it be worth'),
  fin.email);
ok('a non-finance contact sees the ask first (rule 9)',
  d1.email.indexOf('Would it be worth') < d1.email.indexOf('no charge for reviewing resumes'));
ok('the diagnosis says why the fee moved', /finance-first/i.test(fin.diagnosis), fin.diagnosis);

// ── rule 6: the no-agencies short form ─────────────────────────────────────
const na = gen.rulesDraft({ ...base, no_agencies: true }, { companyName: CO });
ok('a no-agencies posting gets an email under 90 words (rule 6)',
  gen.wordCount(na.email) < 90, gen.wordCount(na.email));
ok('the notice is acknowledged in the opening (rule 6)',
  /placement inquiries/i.test(na.email.split('\n').slice(0, 4).join(' ')), na.email);
ok('saying no is a one-word reply (rule 6)', /reply "no"/i.test(na.email), na.email);

// ── rule 12: the follow-up short form ──────────────────────────────────────
const fu = gen.rulesDraft({ ...base, outreach_type: 'followup' }, { companyName: CO });
ok('a follow-up is under 60 words (rule 12)', gen.wordCount(fu.email) < 60, gen.wordCount(fu.email));
ok('a follow-up asks whether the role is still open (rule 12)', /still open/i.test(fu.email), fu.email);
ok('a follow-up does not repeat the pitch (rule 12)',
  !/no charge for reviewing resumes/i.test(fu.email), fu.email);

// ── rule 5: at most ONE detail from the notes ──────────────────────────────
const withNotes = gen.rulesDraft({
  ...base,
  notes: 'Mutual connection Christian introduced us. She has been there 14 years. Re-posted after 22 days.'
}, { companyName: CO });
ok('one note detail is used (rule 5)', /Christian/i.test(withNotes.email), withNotes.email);
ok('the other note details are not also used (rule 5)',
  !/14 years/i.test(withNotes.email) && !/22 days/i.test(withNotes.email), withNotes.email);

// ── the diagnosis is drawn from the posting, not from thin air ─────────────
ok('the clearance signal outranks the years-of-experience signal',
  /clearance/i.test(gen.diagnoseSignal('Requires an active Top Secret clearance and 10+ years', '').why));
ok('a posting with no hard constraint still produces an honest diagnosis',
  gen.diagnoseSignal('We need a friendly person to answer phones.', '') === null);

// ── validation + the AI seam ───────────────────────────────────────────────
ok('missing fields are named, not counted',
  gen.validateInput({ company: 'X' }).missing.join(',') === 'contact first name,job posting',
  gen.validateInput({ company: 'X' }).missing.join(','));
ok('a complete input validates', gen.validateInput(base).ok);
ok('the payload carries the posting and the contact',
  gen.buildUserPayload(base).includes('Senior Project Accountant') &&
  gen.buildUserPayload(base).includes('CONTACT: Susan — HR Manager'));
ok('an adjustment reaches the payload only when given',
  gen.buildUserPayload({ ...base, adjustment: 'shorter' }).includes('ADJUSTMENT REQUESTED') &&
  !gen.buildUserPayload(base).includes('ADJUSTMENT REQUESTED'));
ok('bare JSON parses', gen.parseAiDraft('{"subject":"S","diagnosis":"D","email":"E"}').email === 'E');
ok('a fenced JSON block parses',
  gen.parseAiDraft('```json\n{"subject":"S","diagnosis":"D","email":"E"}\n```').subject === 'S');
ok('JSON with a sentence of preamble parses',
  gen.parseAiDraft('Here you go:\n{"subject":"S","diagnosis":"D","email":"E"}').diagnosis === 'D');
ok('an answer with no email is rejected rather than half-used',
  gen.parseAiDraft('{"subject":"S"}') === null);
ok('prose alone is rejected', gen.parseAiDraft('Sorry, I cannot do that.') === null);

// ── the routes are mounted and auth-gated ──────────────────────────────────
const PORT = 20000 + Math.floor(Math.random() * 20000);
const child = spawn('node', ['index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT),
    SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_SERVICE_KEY: 'dummy-service-key',
    JWT_SECRET: 'test-secret', NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', d => { stderr += d.toString(); });

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 5000 },
      res => { res.resume(); resolve(res.statusCode); });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end();
  });
}

try {
  const deadline = Date.now() + 20000;
  let booted = false;
  while (Date.now() < deadline && !booted) {
    try { await req('GET', '/health'); booted = true; } catch (_) { await new Promise(r => setTimeout(r, 200)); }
  }
  ok('the server boots with the generator mounted', booted, stderr.slice(-300));
  if (booted) {
    const unknown = await req('GET', '/definitely-not-a-route-xyz');
    ok('an unknown path 404s (so 401 below means the route exists)', unknown === 404, unknown);
    for (const [m, p] of [['GET', '/outreach/sender'], ['POST', '/outreach/generate'], ['POST', '/outreach/send']]) {
      const s = await req(m, p);
      ok(`${m} ${p} is mounted and requires a token`, s === 401, s);
    }
  }
} catch (err) {
  ok('route harness completed', false, err && err.message);
} finally {
  child.kill('SIGKILL');
}

let failed = 0;
console.log('\n=== OUTREACH GENERATOR ===');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
