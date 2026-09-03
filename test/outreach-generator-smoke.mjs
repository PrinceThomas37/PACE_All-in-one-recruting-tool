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
// The owner read an email opening with "you came up through estimating and
// pre-construction" and called it off topic — and the 30 replied threads agree:
// not one of them mentions the contact's background. A pasted profile is now
// worth NOTHING to the email, which is the correct amount.
ok('a pasted CV produces no sentence at all',
  gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' }) === '',
  JSON.stringify(gen.pickNoteDetail(LINKEDIN, { contactName: 'Ed Jones', contactTitle: 'Vice President' })));
ok('no email built from a pasted profile mentions their career',
  !/came up through|have been at .* for \d/.test(
    gen.rulesVariants({ outreach_type: 'first', contact_first_name: 'Ed Jones',
      contact_title: 'Vice President', company: 'Berks Construction Group, LLC',
      job_description: CONSTRUCTION, notes: LINKEDIN,
      sender: { name: 'Prince Thomas', title: 'Account Manager' } }, { companyName: CO })
      .variants.map(v => v.email).join('\n')));
ok('something about the ROLE is still fair game',
  gen.pickNoteDetail('Re-posted after 22 days.', {}).kind === 'role');
ok('a prior conversation is still fair game',
  gen.pickNoteDetail('We spoke in March about a different role.', {}).kind === 'prior');
ok('a mutual connection is picked over anything else in the notes',
  gen.pickNoteDetail('Mutual connection Priya introduced us. She has been there 9 years.', {}).text === 'we have Priya in common',
  JSON.stringify(gen.pickNoteDetail('Mutual connection Priya introduced us. She has been there 9 years.', {})));
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
const feeAt = (e) => e.search(/no (charge|cost)/i);
const askAt = (e) => e.search(/resumes?[^.]*\?/i);
ok('a Controller sees the fee line BEFORE the ask (rule 9)',
  feeAt(fin.email) >= 0 && feeAt(fin.email) < askAt(fin.email), fin.email);
ok('a non-finance contact sees the ask first (rule 9)',
  askAt(d1.email) < feeAt(d1.email), d1.email);
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
ok('a follow-up is short (rule 12)', gen.wordCount(fu.email) < 85, gen.wordCount(fu.email));
ok('one of the follow-up framings asks whether the role is still open',
  gen.rulesVariants({ ...base, outreach_type: 'followup' }, { companyName: CO })
    .variants.some(v => /still open/i.test(v.email)));
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

// ── The Company box, filled in from a LinkedIn headline ────────────────────
// "Vice President at Berks Construction" is how LinkedIn writes a headline, and
// "Vice President" went into the Company box — so the email read "I came across
// Vice President's Construction Superintendent opening". The posting names the
// employer, so the form is no longer the authority on it.
ok('the employer is read out of the posting',
  gen.extractCompany(CONSTRUCTION) === 'Berks Construction Group', gen.extractCompany(CONSTRUCTION));
ok('and out of postings in other industries',
  gen.extractCompany(NURSE) === 'St. Marina Health Partners' &&
  gen.extractCompany(BACKEND) === 'Northwind Logistics',
  gen.extractCompany(NURSE) + ' / ' + gen.extractCompany(BACKEND));
ok('the city is read out of the posting too',
  gen.extractLocation(NURSE) === 'Toledo, OH', gen.extractLocation(NURSE));
ok('a job title in the Company box is recognised',
  gen.looksLikeJobTitle('Vice President') && gen.looksLikeJobTitle('Senior Estimator'));
ok('a real company is never mistaken for a job title',
  !gen.looksLikeJobTitle('Berks Construction Group, LLC') &&
  !gen.looksLikeJobTitle('Climate HVAC Solutions') &&
  !gen.looksLikeJobTitle("Director's Choice Ltd"));

const misfiled = gen.rulesDraft({
  ...base, company: 'Vice President', contact_title: 'Vice President',
  location: '', job_description: CONSTRUCTION, notes: LINKEDIN
}, { companyName: CO });
ok('a misfiled company never reaches the email',
  !/Vice President/.test(misfiled.email), misfiled.email.split('\n')[2]);
ok('the posting\'s employer is used instead',
  /Berks Construction Group/.test(misfiled.email), misfiled.email.split('\n')[2]);
ok('and the page is told what was refused',
  misfiled.company_rejected === 'Vice President', String(misfiled.company_rejected));
ok('the draft reports what it read, so a wrong value is visible',
  misfiled.used.role === 'Construction Superintendent' &&
  misfiled.used.company === 'Berks Construction Group',
  JSON.stringify(misfiled.used));
ok('a typed company still wins when it is a real company',
  gen.rulesDraft({ ...base, company: 'Robert Caylor Construction Co', job_description: CONSTRUCTION }, { companyName: CO })
    .used.company === 'Robert Caylor Construction Co');
ok("the contact's title is never printed, only used to aim the email",
  !/Vice President/.test(gen.rulesDraft({ ...base, contact_title: 'Vice President',
    company: 'Berks Construction Group', job_description: CONSTRUCTION }, { companyName: CO }).email));

// ── Four framings, one set of facts ────────────────────────────────────────
// Picking beats regenerating: regenerating gives you another guess, a picker
// gives you the actual choice. Each framing is an opener that earned replies in
// the owner's sent mail.
const vr = gen.rulesVariants({
  ...base, contact_title: 'Vice President', company: 'Berks Construction Group, LLC',
  location: 'Lancaster, PA', job_description: CONSTRUCTION
}, { companyName: CO });
ok('a first outreach offers four framings', vr.variants.length === 4, vr.variants.length);
ok('each carries a label and a one-line explanation of its angle',
  vr.variants.every(v => v.label && v.blurb && v.id), JSON.stringify(vr.variants.map(v => v.id)));
ok('every framing is a distinct email',
  new Set(vr.variants.map(v => v.email)).size === 4);
ok('every framing names the real role',
  vr.variants.every(v => /Construction Superintendent/.test(v.email)),
  vr.variants.map(v => v.email.split('\n')[2]).join(' || '));
ok('no framing ever names a wrong employer',
  vr.variants.every(v => !/Vice President/.test(v.email)));
ok('every framing asks about resumes, and none asks for a call',
  vr.variants.every(v => /resumes?/i.test(v.email) && /\?/.test(v.email)) &&
  vr.variants.every(v => !/\b(call|meeting|15 minutes)\b/i.test(v.email)));
ok('every framing carries the fee line',
  vr.variants.every(v => /no (charge|cost)/i.test(v.email)));
ok('every framing stays inside the length rule',
  vr.variants.every(v => v.words >= 55 && v.words <= 170), JSON.stringify(vr.variants.map(v => v.words)));
ok('each reports its own word count', vr.variants.every(v => v.words === gen.wordCount(v.email)));
ok('only the researched framing states the constraint as its angle',
  !/^This version leads/.test(vr.variants.find(v => v.id === 'researched').diagnosis) &&
  vr.variants.filter(v => v.id !== 'researched').every(v => /^This version leads/.test(v.diagnosis)),
  vr.variants.map(v => v.diagnosis.slice(0, 40)).join(' | '));
ok('the other three say the constraint is background, not what they claim',
  vr.variants.filter(v => v.id !== 'researched').every(v => /Not stated in this version/.test(v.diagnosis)));
ok('a follow-up gets its own three framings',
  gen.rulesVariants({ ...base, outreach_type: 'followup', job_description: CONSTRUCTION }, { companyName: CO })
    .variants.length === 3);
ok('every follow-up framing stays under 85 words',
  gen.rulesVariants({ ...base, outreach_type: 'followup', job_description: CONSTRUCTION }, { companyName: CO })
    .variants.every(v => v.words < 85),
  JSON.stringify(gen.rulesVariants({ ...base, outreach_type: 'followup', job_description: CONSTRUCTION }, { companyName: CO }).variants.map(v => v.words)));
ok('a no-agencies posting offers ONE shape, because rule 6 dictates it',
  gen.rulesVariants({ ...base, no_agencies: true, job_description: CONSTRUCTION }, { companyName: CO })
    .variants.length === 1);
ok('rulesDraft still returns the first framing, for callers with no picker',
  gen.rulesDraft({ ...base, contact_title: 'Vice President', company: 'Berks Construction Group, LLC',
    location: 'Lancaster, PA', job_description: CONSTRUCTION }, { companyName: CO }).email === vr.variants[0].email);
ok('a finance-first reader gets the fee before the ask in EVERY framing',
  gen.rulesVariants({ ...base, contact_title: 'Controller', job_description: CONSTRUCTION }, { companyName: CO })
    .variants.every(v => feeAt(v.email) >= 0 && feeAt(v.email) < askAt(v.email)),
  'a framing put the ask before the fee for a Controller');

// ── The signature, and the two bugs a live send exposed ────────────────────
// A first real send to a real prospect went out with TWO sign-offs — the body's
// own "Best regards, Prince Thomas, Account Manager, Fute Global" and then the
// mailbox signature card under it — and the signature itself was the RAW
// template, so the recipient read "{{sender}}" and "{{senderemail}}".
const signed = gen.rulesDraft({ ...base, job_description: CONSTRUCTION }, { companyName: CO, omitSignOff: true });
ok('with a mailbox signature, the body does not sign itself',
  signed.email.trim().endsWith('Thanks,'), signed.email.slice(-90));
ok('and it carries no name, title or company in the closing',
  !/Best regards/.test(signed.email) && !new RegExp(CO + '$').test(signed.email.trim()),
  signed.email.slice(-120));
ok('without a signature the body still signs itself',
  gen.rulesDraft({ ...base, job_description: CONSTRUCTION }, { companyName: CO }).email.includes('Best regards,'));
ok('the AI writer is told the same thing, so both engines sign once',
  /close with "Thanks," and NOTHING else/.test(gen.buildSystemPrompt(CO, { omitSignOff: true })));
ok('and told the opposite when no signature follows',
  /Close with the sender.s real name/.test(gen.buildSystemPrompt(CO)));

// The router must FILL the signature template rather than append it raw. This
// is asserted against the source because the alternative is a live send.
const routerSrc = readFileSync(path.join(ROOT, 'routes/outreach-generator.js'), 'utf8');
ok('the send path fills the signature template',
  /fillSignatureHtml/.test(routerSrc), 'routes/outreach-generator.js never calls fillSignatureHtml');
ok('it never appends a raw getMailboxSignature result straight to the body',
  !/const signature = await getMailboxSignature/.test(routerSrc));
ok('the signature is filled from the MAILBOX, not the session user',
  /displayName: mailbox\.display_name/.test(routerSrc));
ok('the page is handed the filled signature so the preview is honest',
  /signature_html/.test(routerSrc) &&
  /signature_html/.test(readFileSync(path.join(ROOT, 'public/js/48-page-outreach-gen.js'), 'utf8')));

// EVERY path that composes mail must fill the signature — this is the guard
// that makes the rule repo-wide instead of a comment in one file. The bug was
// found in routes/mailbox.js once, then shipped again in the outreach generator
// AND was sitting unnoticed in all four send paths of routes/recruiting/
// outreach.js, where it had been reaching candidates and clients.
const composers = ['routes/outreach-generator.js', 'routes/recruiting/outreach.js', 'routes/mailbox.js'];
for (const f of composers) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  if (!/getMailboxSignature/.test(src)) continue;
  ok(`${f} fills the signature template before sending`,
    /fillSignatureHtml/.test(src), 'composes mail but never calls fillSignatureHtml');
  ok(`${f} never passes a raw saved signature into the body`,
    !/=\s*await getMailboxSignature\([^)]*\)(\.catch\([^)]*\))?;/.test(
      src.replace(/const raw = await getMailboxSignature\([^)]*\);/g, '')),
    'a call site still uses the unfilled template');
}

// ── One composer, and a reply that can become a lead ───────────────────────
// Compose and Generator were two ways to write the same email and only one of
// them sent it — the old Compose tab opened a webmail deeplink and recorded the
// send nowhere. The tabs are merged into the one that actually sends.
const emailPage = readFileSync(path.join(ROOT, 'public/js/07-page-email.js'), 'utf8');
ok('there is no separate Generator tab any more',
  !/'generator'/.test(emailPage.split('var tabs=')[1].split('\n')[0]),
  emailPage.split('var tabs=')[1].split('\n')[0]);
ok('the Compose tab draws the composer that really sends',
  /emailTab==='compose'[\s\S]{0,300}renderOutreachGenBody/.test(emailPage));
ok('an old link to the generator tab still lands somewhere real',
  /t==='generator'\)t='compose'/.test(readFileSync(path.join(ROOT, 'public/js/11-bind-and-actions.js'), 'utf8')));

const genPage = readFileSync(path.join(ROOT, 'public/js/48-page-outreach-gen.js'), 'utf8');
ok('the composer can take a recipient from the database',
  /outreach\/recipients/.test(genPage) && /outreachPickContact/.test(genPage));
ok('and can still take one typed in from scratch',
  /outreachRecipMode\('new'\)|recipMode:'new'/.test(genPage));
ok('a replied send offers to become a lead',
  /outreachConvertLead/.test(genPage) && /Convert to lead/.test(genPage));
ok('only a REPLY offers it — an open is information, not a conversation',
  /r\.replied_at[\s\S]{0,400}Convert to lead/.test(genPage) &&
  !/r\.opened_at[\s\S]{0,120}Convert to lead/.test(genPage));

// The conversion reuses the columns that already exist. email_tracking has
// carried an unused lead_id since migration 024, which is what it was for —
// so none of this needs a migration against the live database.
ok('the conversion stamps the tracking row rather than adding a column',
  /lead_id: (job\.id|existing\[0\]\.job_id)/.test(routerSrc), 'convert-lead never records the lead it made');
ok('an address already on a lead is refused, not duplicated',
  /contact_exists/.test(routerSrc));
ok('a reply already converted is refused too',
  /already_converted/.test(routerSrc));
ok('the new lead lands on the stage that means "they replied"',
  /stage: 'Connected'/.test(routerSrc), 'a converted reply should not start at Unassigned');
ok('the sent list only ever shows this user their own sends',
  /\.eq\('sent_by', req\.user\.id\)/.test(routerSrc));
ok('every new read is org-scoped',
  (routerSrc.match(/withOrg\(supabase\.from/g) || []).length >= 5,
  String((routerSrc.match(/withOrg\(supabase\.from/g) || []).length));

// ── CALLED BUT NEVER DEFINED ───────────────────────────────────────────────
// The bug this exists for: two Claude sessions edited routes/outreach-generator
// at the same time. One replaced the local aiConfigured() helper with
// services/ai-provider; the other added a NEW call to that helper elsewhere in
// the same file. Neither branch was wrong. Git saw no conflict — a deletion in
// one region, a call in another — merged both, and main shipped a handler
// calling a function that no longer existed. Every load of the Compose tab
// returned 500.
//
// Calling the endpoint does NOT catch this: the handler awaits the database
// first, and against a dead test database it times out before it ever reaches
// the bad line. So this reads the source instead and asks the only question
// that matters — is every function this file calls actually defined in it?
const JS_GLOBALS = new Set(['require','String','Number','Boolean','Object','Array','JSON','Promise',
  'Date','Math','parseInt','parseFloat','isNaN','isFinite','setTimeout','clearTimeout','setInterval',
  'clearInterval','console','Error','TypeError','RangeError','RegExp','Buffer','process','Set','Map',
  'Symbol','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','structuredClone','fetch',
  'if','for','while','switch','catch','return','typeof','function','new','await','do','else','throw','case',
  'of','in','delete','void','yield','instanceof']);

function undefinedCalls(src) {
  // Everything this file brings into scope: declarations, destructured imports
  // and ctx fields, function parameters, and catch bindings.
  const declared = new Set();
  const add = (n) => { if (n) declared.add(n); };
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
  // const { a, b: c } = require(...) / = ctx
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece.includes(':') ? piece.split(':')[1] : piece;
      add(name.trim().replace(/\s.*$/, ''));
    }
  }
  for (const m of src.matchAll(/(?:function\s*[A-Za-z_$\w]*|=>)?\s*\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const piece of m[1].split(',')) add(piece.trim().split(/[\s=]/)[0].replace(/[{}.]/g, ''));
  }
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);

  // Every bare call that is not a method call (no dot before it).
  const bad = new Set();
  for (const m of src.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = m[2];
    if (JS_GLOBALS.has(name) || declared.has(name)) continue;
    bad.add(name);
  }
  return [...bad];
}

for (const f of composers) {
  // Comments name helpers in prose, and a Supabase select string like
  // "jobs!inner(position)" looks exactly like a function call. Neither is code,
  // so both come out before anything is counted.
  const src = readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const missing = undefinedCalls(src);
  ok(`${f} calls no function it does not define`, missing.length === 0, missing.join(', '));
}

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
    // A 401 only proves the route is MOUNTED. It says nothing about whether the
    // handler runs — and the handler is where a merge breaks things. Two Claude
    // sessions worked this file at once: one replaced the local aiConfigured()
    // helper with services/ai-provider, the other added a new CALL to that
    // helper in a different part of the same file. Git saw no conflict, both
    // merged, and main shipped a handler that called a function nobody defined.
    // Every load of the Compose tab got a 500 that no test noticed.
    //
    // So each read endpoint is also called WITH a token: a fast
    // "is not defined" is the failure; anything else — including a timeout
    // against the dead dummy database — means the handler got past its own
    // dependencies, which is all this can prove without a real database.
    const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));
    const authed = (p) => new Promise((resolve) => {
      const token = jwt.sign({ id: 'u1', email: 'a@b.c', roles: ['bd'], role: 'bd', name: 'T', org_id: 'o1' }, 'test-secret');
      const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET', timeout: 8000,
        headers: { Authorization: `Bearer ${token}` } },
        (res) => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve(b)); });
      r.on('timeout', () => { r.destroy(); resolve('__timeout__'); });
      r.on('error', () => resolve('__error__'));
      r.end();
    });
    for (const p of ['/outreach/sender', '/outreach/sent', '/outreach/recipients?q=ed']) {
      const body = await authed(p);
      ok(`GET ${p} runs its handler (no ReferenceError)`,
        !/is not defined|is not a function/i.test(body), body.slice(0, 160));
    }

    for (const [m, p] of [['GET', '/outreach/sender'], ['POST', '/outreach/generate'], ['POST', '/outreach/send'],
                          ['GET', '/outreach/recipients'], ['GET', '/outreach/company-contacts/x'],
                          ['GET', '/outreach/sent'], ['POST', '/outreach/convert-lead']]) {
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
