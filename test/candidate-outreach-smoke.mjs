// Candidate outreach — the rules writer, the house check, and the mounted routes.
//
// The rules writer is what production actually ships: there is no funded key,
// and even with one the AI writes only the per-JOB brief. Every candidate email
// that leaves this app is assembled by these functions, so the assertions below
// are the rules of §4 of docs/CANDIDATE_OUTREACH_PLAN.md checked as behaviour.
//
// Two of these exist because the first run of the writer broke them:
//   • the rules writer failed its own checker (the short angle had no way out)
//   • the money check had a hole exactly the shape of the string jobFacts emits
//
// Usage: node test/candidate-outreach-smoke.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const gen = require(path.join(ROOT, 'services/candidate-outreach.js'));

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail: String(detail) });

const CO = 'Acme Staffing LLC';
const OPTS = { companyName: CO, omitSignOff: true };

const JOB = {
  id: 'job-1', job_title: 'Construction Superintendent', client: 'Berks Group',
  city: 'Dallas', state: 'TX', pay_min: '110000', pay_max: '130000', pay_cur: 'USD',
  job_type: 'Full-time', primary_skills: 'Procore, OSHA 30, commercial build-out',
  job_description: 'Supervise commercial construction projects end to end.',
};
const THIN_JOB = { id: 'job-2', job_title: 'QA Analyst' };
const CAND = {
  id: 'c1', full_name: 'Maria Alvarez', email: 'maria@example.com',
  current_title: 'Site Superintendent', experience_years: 9, current_location: 'Fort Worth, TX',
};
const REASONS = ['Skills overlap: Procore, OSHA 30', 'Title is a close match'];

const inputFor = (job, cand = CAND, reasons = REASONS) => ({
  candidate: cand, job, reasons, outreach_type: job ? 'job' : 'nurture',
});

// ── THE RULES WRITER MUST PASS ITS OWN CHECKER ─────────────────────────────
// Not a tautology — it caught two real defects on the first run. If the writer
// can fail the check, the angle it fails on silently never ships: the queue
// endpoint skips any candidate whose draft does not pass.
for (const [label, job] of [['a full job order', JOB], ['a job order with only a title', THIN_JOB], ['no job at all', null]]) {
  const input = inputFor(job);
  const variants = gen.rulesVariants(input, OPTS);
  ok(`${label}: the writer produces at least one angle`, variants.length > 0, variants.length);
  for (const v of variants) {
    const q = gen.checkCandidateDraft(v, input, { angle: v.id, omitSignOff: true });
    ok(`${label}: the "${v.id}" rules draft passes the house check`, q.ok,
      (q.violations || []).map(x => x.code).join(', '));
  }
}

// ── THE FACTS A CANDIDATE CANNOT ANSWER WITHOUT ────────────────────────────
{
  const input = inputFor(JOB);
  for (const v of gen.rulesVariants(input, OPTS)) {
    const all = v.subject + ' ' + v.email;
    ok(`"${v.id}" names the role`, /Construction Superintendent/i.test(all), v.subject);
    ok(`"${v.id}" says where the job is`, /Dallas/i.test(all), v.email.slice(0, 80));
    ok(`"${v.id}" ends on a question`, /\?/.test(v.email), v.email.slice(-60));
  }
}

// ── PAY: ONLY WHAT THE JOB ORDER CARRIES ───────────────────────────────────
{
  const f = gen.jobFacts(JOB);
  ok('a plain integer is grouped into money', f.pay === 'USD 110,000-130,000', f.pay);
  ok('a job order with no pay produces no pay string', gen.jobFacts(THIN_JOB).pay === '', gen.jobFacts(THIN_JOB).pay);

  const allowed = f.payFigures;
  // Every shape the checker must catch. The currency-PREFIX form is the one
  // the first version missed — and it is the exact shape jobFacts itself emits,
  // so an invented range would have looked identical to a real one.
  for (const bad of ['We can pay USD 200,000.', 'Budget is $180,000.', 'Around 175,000 a year.',
                     'They pay 95 per hour.', 'It is 240000 annually.', 'Roughly 200,000 EUR.']) {
    ok(`invented pay is caught: ${bad}`, gen.unsupportedMoney(bad, allowed) !== null, bad);
  }
  ok('the range that IS on the order passes', gen.unsupportedMoney('The range on it is USD 110,000-130,000.', allowed) === null);
  // The false positives that would make the check unusable.
  for (const fine of ['OSHA 30 certified.', 'You have 9 years of it.', 'Ref 2026 build.']) {
    ok(`not treated as money: ${fine}`, gen.unsupportedMoney(fine, allowed) === null, fine);
  }

  const input = inputFor(JOB);
  const invented = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent — Dallas', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX, paying USD 200,000.\n\nInterested? If not, just say so.\n\nThanks,' },
    input, { angle: 'direct', omitSignOff: true });
  ok('a draft quoting a pay figure the order does not carry is refused',
    invented.violations.some(v => v.code === 'invented_pay'),
    invented.violations.map(v => v.code).join(','));

  const noPayJob = { ...JOB, pay_min: '', pay_max: '' };
  const r = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX, around $150,000.\n\nInterested? If not, say so.\n\nThanks,' },
    inputFor(noPayJob), { angle: 'direct', omitSignOff: true });
  ok('a figure on a job order with NO pay at all is refused',
    r.violations.some(v => v.code === 'invented_pay'), r.violations.map(v => v.code).join(','));
}

// ── EXPERIENCE: NEVER TELL SOMEONE ABOUT THEIR OWN CAREER ──────────────────
{
  const body = 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX. Your 20 years on commercial sites stood out.\n\nInterested? If not, just say so.\n\nThanks,';
  const r = gen.checkCandidateDraft({ subject: 'Construction Superintendent — Dallas', email: body },
    inputFor(JOB), { angle: 'direct', omitSignOff: true });
  ok('a years-of-experience claim that contradicts the record is refused',
    r.violations.some(v => v.code === 'invented_experience'), r.violations.map(v => v.code).join(','));

  const unknown = { ...CAND, experience_years: null };
  const r2 = gen.checkCandidateDraft({ subject: 'Construction Superintendent — Dallas', email: body },
    inputFor(JOB, unknown), { angle: 'direct', omitSignOff: true });
  ok('any years claim is refused when the record does not say',
    r2.violations.some(v => v.code === 'invented_experience'), r2.violations.map(v => v.code).join(','));

  const right = body.replace('20 years', '9 years');
  const r3 = gen.checkCandidateDraft({ subject: 'Construction Superintendent — Dallas', email: right },
    inputFor(JOB), { angle: 'direct', omitSignOff: true });
  ok('the number that IS on the record passes',
    !r3.violations.some(v => v.code === 'invented_experience'), r3.violations.map(v => v.code).join(','));
}

// ── THE FIRST LIVE BATCH, PINNED ───────────────────────────────────────────
// Four real HVAC candidates, one real job order. Three of four were silently
// skipped because the AI job brief said "2-3 years of field experience" — a
// requirement of the VACANCY — and the check read it as a claim about each
// PERSON. The one that got through only did so because his 4 years happened to
// land within 1 of 3. Every assertion below is that batch.
{
  const HVAC_JOB = {
    id: 'hvac', job_title: 'HVAC Service Technician', client: 'Griffith Energy Services, Inc.',
    city: 'Westminster', state: 'Maryland', pay_min: '25', pay_max: '35', pay_cur: 'USD',
    job_type: 'Full-time', remote: 'No', duration: '', primary_skills: 'hvac, epa, boilers, commercial',
  };
  // Verbatim from the job order's stored outreach_brief.
  const AI_BRIEF = {
    hook: 'We are looking for a full-time HVAC Service Technician in Westminster, MD to diagnose, maintain, and repair residential and commercial climate control systems.',
    detail: 'The position requires a valid EPA Section 608 certification, 2-3 years of field experience, and involves field repairs, refrigerant handling, and customer communication using digital service software.',
    engine: 'ai',
  };
  const BATCH = [
    ['Curtis Grubbs', '11', 'Owner/Operator', 'HVAC, residential, commercial, EPA Universal, brazing'],
    ['Clayton Smith', '35', 'HVAC Technician', 'HVAC installation, HVAC repair, commercial HVAC, refrigeration'],
    ['Shaun Maher', '4', 'HVAC Service Technician', 'HVAC installation, oil boilers, heat pumps, ductwork'],
    ['Brian Klevecz', '15', 'Foreman', 'HVAC, Installation, EPA certification, Ductwork'],
  ];
  for (const [name, years, title, skills] of BATCH) {
    const cand = { id: name, full_name: name, email: 'x@example.com', current_title: title, experience_years: years, skills };
    // The match engine's REAL output shape — grid shorthand, not prose.
    const input = { candidate: cand, job: HVAC_JOB, brief: AI_BRIEF, reasons: ['3/4 skills', 'title 67%', 'diff state'], outreach_type: 'job' };
    const v = gen.rulesVariants(input, { ...OPTS, hasButtons: true }).find(x => x.id === 'direct');
    const q = gen.checkCandidateDraft(v, input, { angle: 'direct', omitSignOff: true, hasButtons: true });
    ok(`${name} (${years} yrs) is not skipped over the JOB's stated experience requirement`,
      q.ok, (q.violations || []).map(x => x.code).join(','));
    ok(`${name}'s email never prints the matcher's grid shorthand`,
      !/\d\/\d\s*skills|title \d+%|diff state/i.test(v.email), v.email);
  }

  // The rule the check is actually for still holds.
  const cand = { id: 'x', full_name: 'Shaun Maher', email: 'x@example.com', current_title: 'HVAC Technician', experience_years: '4', skills: 'HVAC' };
  const input = { candidate: cand, job: HVAC_JOB, brief: AI_BRIEF, reasons: [], outreach_type: 'job' };
  const base = 'Hi Shaun,\n\nThis is {{sender}} at Acme. HVAC Service Technician in Westminster, Maryland. ';
  const tail = '\n\nInterested? If not, just say so.\n\nThanks,';
  ok('a SECOND-PERSON years claim that contradicts the record is still refused',
    gen.checkCandidateDraft({ subject: 'HVAC Service Technician — Westminster', email: base + 'With your 22 years on commercial sites, this fits.' + tail },
      input, { angle: 'direct', omitSignOff: true }).violations.some(v => v.code === 'invented_experience'));
  ok('"you have N years" is caught too',
    gen.checkCandidateDraft({ subject: 'HVAC Service Technician — Westminster', email: base + 'You have 22 years of it.' + tail },
      input, { angle: 'direct', omitSignOff: true }).violations.some(v => v.code === 'invented_experience'));
  ok('the JOB asking for N years is not a claim about the reader',
    !gen.checkCandidateDraft({ subject: 'HVAC Service Technician — Westminster', email: base + 'The role asks for 2-3 years of field experience.' + tail },
      input, { angle: 'direct', omitSignOff: true }).violations.some(v => v.code === 'invented_experience'));
  ok('the reader\'s own correct number still passes',
    !gen.checkCandidateDraft({ subject: 'HVAC Service Technician — Westminster', email: base + 'Your 4 years line up well.' + tail },
      input, { angle: 'direct', omitSignOff: true }).violations.some(v => v.code === 'invented_experience'));

  // "It is Full-time and No." — a yes/no field printed raw.
  const f = gen.jobFacts(HVAC_JOB);
  ok('a remote field of "No" becomes "on site", never the word No',
    f.terms.includes('on site') && !f.terms.includes('No'), JSON.stringify(f.terms));
  ok('"Yes" becomes remote and "Hybrid" stays hybrid',
    gen.remoteTerm('Yes') === 'remote' && gen.remoteTerm('Hybrid') === 'hybrid');
  ok('an unrecognised remote value is passed through as typed',
    gen.remoteTerm('2 days in office') === '2 days in office');
  ok('an empty remote field says nothing', gen.remoteTerm('') === '' && gen.remoteTerm(null) === '');

  // A two-digit range is a rate; a five-digit one is a salary and we say nothing.
  ok('a sub-1000 range is named as an hourly rate', f.payPeriod === ' an hour', JSON.stringify(f.payPeriod));
  ok('a salary-sized range asserts no period',
    gen.jobFacts({ ...HVAC_JOB, pay_min: '110000', pay_max: '130000' }).payPeriod === '');
  ok('a mixed/unclear range asserts no period',
    gen.jobFacts({ ...HVAC_JOB, pay_min: '25', pay_max: '65000' }).payPeriod === '');

  // The skills the two records actually share, in the candidate's own spelling.
  const shared = gen.sharedSkills({ skills: 'HVAC installation, oil boilers, ductwork' }, HVAC_JOB);
  ok('shared skills are computed from the records, not parsed from a display string',
    shared.length > 0 && shared.every(x => !/\d\/\d/.test(x)), JSON.stringify(shared));
  ok('a lowercase acronym in the job field is uppercased', gen.prettySkill('hvac') === 'HVAC' && gen.prettySkill('epa') === 'EPA');
  ok('an ordinary lowercase word is left alone', gen.prettySkill('boilers') === 'boilers');
  ok('anything already capitalised is untouched',
    gen.prettySkill('Procore') === 'Procore' && gen.prettySkill('OSHA 30') === 'OSHA 30');
  ok('no overlap falls back to the record rather than inventing one',
    /4 years/.test(gen.whyYouClause([], { experience_years: '4', current_title: 'Technician' }, HVAC_JOB)));
}

// ── THE CANDIDATE EMAIL IS NOT THE CLIENT EMAIL ────────────────────────────
{
  const input = inputFor(JOB);
  const fee = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent — Dallas', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX. We only charge a placement fee on success.\n\nInterested? If not, say so.\n\nThanks,' },
    input, { angle: 'direct', omitSignOff: true });
  ok('fee language is refused in a candidate email — it belongs to the client side',
    fee.violations.some(v => v.code === 'fee_language'), fee.violations.map(v => v.code).join(','));

  for (const v of gen.rulesVariants(input, OPTS)) {
    ok(`"${v.id}" never mentions a fee`, !/\b(fee|commission|contingency|retainer)\b/i.test(v.email), v.email);
  }
}

// ── A WAY OUT IS MANDATORY ─────────────────────────────────────────────────
{
  const r = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent — Dallas', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX.\n\nAre you interested?\n\nThanks,' },
    inputFor(JOB), { angle: 'direct', omitSignOff: true });
  ok('a candidate email with no way to say no is refused',
    r.violations.some(v => v.code === 'no_optout'), r.violations.map(v => v.code).join(','));
  for (const v of gen.rulesVariants(inputFor(JOB), OPTS)) {
    ok(`"${v.id}" gives an explicit way out`, /just say so|not right|timing is not|if not/i.test(v.email), v.email.slice(-90));
  }
}

// ── {{sender}} IS LOAD-BEARING HERE AND NOWHERE ELSE ───────────────────────
{
  const input = inputFor(JOB);
  for (const v of gen.rulesVariants(input, OPTS)) {
    ok(`"${v.id}" stores the sender as a token, not a baked-in name`,
      /\{\{sender\}\}/.test(v.email), v.email.slice(0, 70));
  }
  const q = gen.checkCandidateDraft(gen.rulesVariants(input, OPTS)[0], input, { angle: 'direct', omitSignOff: true });
  ok('{{sender}} does not trip the placeholder check', !q.violations.some(v => v.code === 'placeholder'),
    q.violations.map(v => v.code).join(','));

  const leak = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent — Dallas', email: 'Hi Maria,\n\nThis is {{sender}} at Acme, about the {{job_title}} in Dallas, TX. Construction Superintendent.\n\nInterested? If not, say so.\n\nThanks,' },
    input, { angle: 'direct', omitSignOff: true });
  ok('any OTHER {{token}} is still refused', leak.violations.some(v => v.code === 'placeholder'),
    leak.violations.map(v => v.code).join(','));
}

// ── TONE ───────────────────────────────────────────────────────────────────
{
  const input = inputFor(JOB);
  const base = 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX. ';
  const tail = '\n\nInterested? If not, just say so.\n\nThanks,';
  for (const [code, text] of [
    ['exclamation', 'This one is great!'],
    ['marketing_word', 'It is an exciting opportunity.'],
    ['emoji', 'Worth a look 🚀'],
  ]) {
    const r = gen.checkCandidateDraft({ subject: 'Construction Superintendent — Dallas', email: base + text + tail },
      input, { angle: 'direct', omitSignOff: true });
    ok(`"${code}" is caught`, r.violations.some(v => v.code === code), r.violations.map(v => v.code).join(','));
  }
  const nogreet = gen.checkCandidateDraft(
    { subject: 'Construction Superintendent — Dallas', email: 'This is {{sender}} at Acme. Construction Superintendent in Dallas, TX.\n\nInterested? If not, say so.\n\nThanks,' },
    input, { angle: 'direct', omitSignOff: true });
  ok('a missing greeting is caught', nogreet.violations.some(v => v.code === 'no_greeting'),
    nogreet.violations.map(v => v.code).join(','));
}

// ── A MINIMUM LENGTH IS AN INSTRUCTION TO INVENT WHEN THERE ARE NO FACTS ───
{
  ok('a thin job order is recognised as thin', gen.materialIn(inputFor(THIN_JOB)) < 3, gen.materialIn(inputFor(THIN_JOB)));
  ok('a full job order is not', gen.materialIn(inputFor(JOB)) >= 3, gen.materialIn(inputFor(JOB)));
  const short = { subject: 'QA Analyst', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. QA Analyst.\n\nInterested? If not, say so.\n\nThanks,' };
  const thin = gen.checkCandidateDraft(short, inputFor(THIN_JOB), { angle: 'direct', omitSignOff: true });
  ok('too_short is not raised when there is nothing to write about',
    !thin.violations.some(v => v.code === 'too_short'), thin.violations.map(v => v.code).join(','));
  const rich = gen.checkCandidateDraft(short, inputFor(JOB), { angle: 'direct', omitSignOff: true });
  ok('too_short IS raised when the job order is full and the draft is lazy',
    rich.violations.some(v => v.code === 'too_short'), rich.violations.map(v => v.code).join(','));
}

// ── THE NURTURE EMAIL MENTIONS NO JOB ──────────────────────────────────────
{
  const input = inputFor(null);
  const vs = gen.rulesVariants(input, OPTS);
  ok('with no job there is exactly one angle', vs.length === 1, vs.map(v => v.id).join(','));
  ok('the nurture angle is the nurture angle', vs[0].id === 'nurture', vs[0].id);
  ok('it names no role, client, place or figure',
    !/Superintendent|Berks|Dallas|USD/i.test(vs[0].email), vs[0].email);
  ok('it still asks a question', /\?/.test(vs[0].email), vs[0].email);
}

// ── THE SKILL LIST READS AS ENGLISH ────────────────────────────────────────
// The clause names the skills the two RECORDS share, computed here — it is
// never parsed out of the match engine's grid shorthand, which is what put
// "your background in 3/4 skills" into a real email.
{
  const withSkills = { ...CAND, skills: 'Procore, OSHA 30, commercial build-out' };
  const clause = gen.whyYouClause(REASONS, withSkills, JOB);
  ok('proper nouns keep their capitals', /Procore/.test(clause), clause);
  ok('the skill list is joined with "and", not left as raw CSV', / and /.test(clause), clause);
  ok('the matcher\'s shorthand never reaches the reader',
    !/\d\/\d|%/.test(clause), clause);
  ok('with no shared skills it falls back to the record',
    /9 years/.test(gen.whyYouClause([], CAND, JOB)), gen.whyYouClause([], CAND, JOB));
  ok('with nothing on either side it stays silent rather than guessing',
    gen.whyYouClause([], { full_name: 'X' }, JOB) === '', gen.whyYouClause([], { full_name: 'X' }, JOB));
}

// ── NO ANGLE IS A PARAPHRASE OF ANOTHER ────────────────────────────────────
{
  const vs = gen.rulesVariants(inputFor(JOB), OPTS);
  const bodies = vs.map(v => v.email);
  ok('the angles differ from each other', new Set(bodies).size === bodies.length, bodies.length);
  const words = vs.map(v => v.words);
  ok('and they differ in length, not just wording', new Set(words).size > 1, words.join('/'));
  // The one that must actually be short.
  const short = vs.find(v => v.id === 'short');
  ok('the "short" angle is the shortest', short && Math.min(...words) === short.words, words.join('/'));
}

// ── THE BRIEF ──────────────────────────────────────────────────────────────
{
  const b = gen.rulesJobBrief(JOB);
  ok('the rules brief names the role and the client', /Construction Superintendent/.test(b.hook) && /Berks Group/.test(b.hook), b.hook);
  ok('the brief does NOT carry the terms — termsLine prints those',
    !/Full-time/i.test(b.hook + ' ' + b.detail), b.hook + ' | ' + b.detail);
  ok('a thin job order still produces a usable brief', gen.rulesJobBrief(THIN_JOB).hook.length > 0);

  ok('an AI brief inventing pay is rejected',
    !gen.checkBrief({ hook: 'They are hiring a Superintendent paying USD 250,000.' }, JOB).ok);
  ok('an AI brief with marketing language is rejected',
    !gen.checkBrief({ hook: 'An exciting opportunity with a dynamic team.' }, JOB).ok);
  ok('an AI brief that greets the reader is rejected',
    !gen.checkBrief({ hook: 'Hi there, they are hiring a Superintendent in Dallas.' }, JOB).ok);
  ok('a good AI brief passes',
    gen.checkBrief({ hook: 'They are hiring a Superintendent to run commercial build-outs in Dallas.', detail: 'The work is Procore-heavy and site-based.' }, JOB).ok);
  ok('parseBrief reads a fenced JSON answer',
    (gen.parseBrief('```json\n{"hook":"A role.","detail":""}\n```') || {}).hook === 'A role.');
  ok('parseBrief refuses an answer with no hook', gen.parseBrief('{"detail":"x"}') === null);
}

// ── validateInput ──────────────────────────────────────────────────────────
{
  ok('a candidate with no email cannot be written to',
    !gen.validateInput({ candidate: { full_name: 'A' }, job: JOB }).ok);
  ok('a job email with no job is refused',
    !gen.validateInput({ candidate: CAND, outreach_type: 'job' }).ok);
  ok('a nurture email needs no job',
    gen.validateInput({ candidate: CAND, outreach_type: 'nurture' }).ok);
}

// ── THE STORED BODY IS RENDERED BEFORE IT IS READ ──────────────────────────
// The same grep test/sender-identity-smoke.mjs runs over the leads engine.
// candidate_outreach.body holds {{sender}}, so its reader must render.
{
  const route = readFileSync(path.join(ROOT, 'routes/candidate-outreach.js'), 'utf8');
  ok('the drain renders the stored body before sending', /renderStoredEmail\(row, mailbox\)/.test(route));
  ok('the preview renders from the sending mailbox, not the session',
    /renderStoredEmail\(\{ subject: v\.subject, body: v\.email \}, mailbox\)/.test(route));
  // Everything before the drain is request-handling. If a send call appears
  // there, a recruiter clicking Queue would sit through 25 network round-trips
  // and the drip would not exist.
  ok('nothing sends inside the queue request',
    !/await sendMailboxNewMessage/.test(route.split('async function drainDueOutreach')[0]));
  ok('the drip is stored per row, not held in a timer',
    /send_after: new Date\(Date\.now\(\) \+ offset\)/.test(route) && !/setInterval/.test(route));
  ok('the queue checks every draft, not just the previewed one',
    /checkCandidateDraft\(variant, input/.test(route));
}

// ── WHEN A CANDIDATE IS ACTUALLY READING ───────────────────────────────────
// The leads engine sends 08:00-16:00 because a prospect is at their desk then.
// A candidate is AT WORK then. Owner's call (2026-09-09): weekday evenings and
// most of the weekend, in the CANDIDATE's timezone.
{
  const st = (day, hour, min = 0) => gen.candidateWindowState(day, hour * 60 + min);
  const opensAt = (day, hour, min = 0) => gen.describeWindowOpens(st(day, hour, min), day);

  // Shut during the working day — the entire point.
  for (const [label, day, hour] of [['Mon 9am', 1, 9], ['Wed 11am', 3, 11], ['Fri 2pm', 5, 14]]) {
    ok(`${label} is shut — they are at work`, !st(day, hour).open);
  }
  // Open in the evening.
  for (const [label, day, hour] of [['Mon 5pm', 1, 17], ['Tue 7pm', 2, 19], ['Thu 8:59pm', 4, 20]]) {
    ok(`${label} is open`, st(day, hour).open);
  }
  ok('9pm on a weekday is shut — nobody wants a work email at bedtime', !st(1, 21).open);
  ok('3am is shut', !st(1, 3).open);

  // The weekend is the daytime, because they are not at work.
  ok('Saturday 11am is open', st(6, 11).open);
  ok('Sunday 7pm is open', st(0, 19).open);
  ok('Saturday 8am is still too early', !st(6, 8).open);
  ok('Sunday 9pm is shut', !st(0, 21).open);

  // Where it goes next, said the way a person would.
  ok('a weekday morning waits until that evening', opensAt(1, 9) === 'today, 5:00 PM', opensAt(1, 9));
  ok('after 9pm it rolls to the next day', opensAt(1, 22) === 'tomorrow, 5:00 PM', opensAt(1, 22));
  ok('Friday night rolls to Saturday MORNING, not Saturday evening',
    opensAt(5, 22) === 'tomorrow, 9:00 AM', opensAt(5, 22));
  ok('Sunday night rolls to Monday evening', opensAt(0, 22) === 'tomorrow, 5:00 PM', opensAt(0, 22));
  ok('an open window says now', gen.describeWindowOpens(st(1, 18), 1) === 'now');

  // Configurable, and a day can be switched off entirely.
  const evenings = { weekday: [18, 22], weekend: [10, 18] };
  ok('a configured weekday window is honoured',
    !gen.candidateWindowState(1, 17 * 60, evenings).open && gen.candidateWindowState(1, 18 * 60, evenings).open);
  const weekendOnly = { weekday: [0, 0], weekend: [9, 20] };
  ok('start >= end closes that day rather than opening it for 24 hours',
    !gen.candidateWindowState(1, 12 * 60, weekendOnly).open &&
    !gen.candidateWindowState(1, 0, weekendOnly).open);
  ok('with weekdays closed a Monday waits for Saturday',
    gen.describeWindowOpens(gen.candidateWindowState(1, 12 * 60, weekendOnly), 1) === 'Saturday, 9:00 AM',
    gen.describeWindowOpens(gen.candidateWindowState(1, 12 * 60, weekendOnly), 1));
  ok('a config with every day closed returns never, and does not spin',
    gen.candidateWindowState(1, 600, { weekday: [0, 0], weekend: [0, 0] }).opensInMinutes === null);

  // Garbage in settings must not open the floodgates.
  const bad = gen.normalizeWindow({ weekday: ['x', 99], weekend: null });
  ok('a non-numeric hour falls back to the default', bad.weekday[0] === 17 || bad.weekday[0] === 0, JSON.stringify(bad));
  ok('an out-of-range hour is clamped', bad.weekday[1] <= 24, JSON.stringify(bad));
  ok('a missing half falls back to the default weekend',
    bad.weekend[0] === 9 && bad.weekend[1] === 20, JSON.stringify(bad));

  // The hours an admin types and the hours the drain obeys must be the same
  // number. One schema, one screen, one reader — not a second settings surface.
  const schema = require(path.join(ROOT, 'config/settings.js')).SETTINGS_SCHEMA;
  const winKeys = ['candidate_window_weekday_start', 'candidate_window_weekday_end',
                   'candidate_window_weekend_start', 'candidate_window_weekend_end'];
  for (const k of winKeys) {
    const def = schema.find(d => d.key === k);
    ok(`${k} is in the admin settings schema`, !!def, 'missing');
    if (def) {
      ok(`${k} is grouped so the admin screen renders it`, def.group === 'Candidate outreach', def.group);
      ok(`${k} is bounded to real hours`, def.min >= 0 && def.max <= 24, `${def.min}-${def.max}`);
    }
  }
  // The schema's defaults ARE the shipped window — a mismatch would mean the
  // screen showed one thing on a fresh install and the sender did another.
  const dflt = (k) => (schema.find(d => d.key === k) || {}).default;
  ok('the schema defaults match the shipped candidate window',
    dflt('candidate_window_weekday_start') === gen.CANDIDATE_WINDOW.weekday[0] &&
    dflt('candidate_window_weekday_end') === gen.CANDIDATE_WINDOW.weekday[1] &&
    dflt('candidate_window_weekend_start') === gen.CANDIDATE_WINDOW.weekend[0] &&
    dflt('candidate_window_weekend_end') === gen.CANDIDATE_WINDOW.weekend[1],
    JSON.stringify(gen.CANDIDATE_WINDOW));

  ok('the clock label reads like a clock',
    gen.clockLabel(17 * 60) === '5:00 PM' && gen.clockLabel(9 * 60) === '9:00 AM' &&
    gen.clockLabel(0) === '12:00 AM' && gen.clockLabel(12 * 60 + 30) === '12:30 PM');
}

// ── THE ANSWER BUTTONS ─────────────────────────────────────────────────────
{
  const html = gen.answerButtonsHtml('https://pace.example.com/', 'abc123def456', {});
  ok('both buttons are rendered', /a=yes/.test(html) && /a=no/.test(html), html.slice(0, 60));
  ok('the links point at the answer page, not at a recording endpoint',
    /\/i\/abc123def456\?a=(yes|no)/.test(html) && !/interested|not-interested|opt-out/.test(html), html.slice(0, 120));
  ok('a trailing slash on the base url does not double up',
    !/\/\/i\//.test(html.replace('https://', '')), html.slice(0, 80));
  // Outlook has no flexbox and strips <style>; a div-and-class button is an
  // unstyled link there, which looks broken next to a working one.
  ok('the markup is table-and-inline-style, for mail clients',
    /<table/.test(html) && /style="/.test(html) && !/class=/.test(html));
  ok('a label with markup in it is escaped',
    !/<b>/.test(gen.answerButtonsHtml('https://x.test', 't', { yesLabel: '<b>yes</b>' })));

  ok('escapeHtml handles the five characters that matter',
    gen.escapeHtml('<a href="x" \'y\'>&') === '&lt;a href=&quot;x&quot; &#39;y&#39;&gt;&amp;',
    gen.escapeHtml('<a href="x" \'y\'>&'));
}

// With buttons present the closing line points at them rather than contradicting
// them, and the checker accepts the buttons as the way out.
{
  const input = inputFor(JOB);
  const withBtns = gen.rulesVariants(input, { ...OPTS, hasButtons: true });
  for (const v of withBtns) {
    ok(`"${v.id}" points at the button instead of "just say so"`,
      !/just say so and I will leave it there/.test(v.email), v.email.slice(-80));
    const q = gen.checkCandidateDraft(v, input, { angle: v.id, omitSignOff: true, hasButtons: true });
    ok(`"${v.id}" still passes the check with buttons on`, q.ok, (q.violations || []).map(x => x.code).join(','));
  }
  // And the sentence comes back when there are no buttons to carry it.
  const noBtns = gen.rulesVariants(input, OPTS);
  ok('without buttons the opt-out sentence returns',
    noBtns.some(v => /just say so/.test(v.email)), noBtns[0].email.slice(-60));
  // hasButtons must not become a way to ship an email with NO way out at all.
  const bare = { subject: 'Construction Superintendent — Dallas', email: 'Hi Maria,\n\nThis is {{sender}} at Acme. Construction Superintendent in Dallas, TX.\n\nAre you interested?\n\nThanks,' };
  ok('no_optout is waived only because the buttons are there',
    gen.checkCandidateDraft(bare, input, { angle: 'direct', omitSignOff: true, hasButtons: true }).violations.every(v => v.code !== 'no_optout') &&
    gen.checkCandidateDraft(bare, input, { angle: 'direct', omitSignOff: true }).violations.some(v => v.code === 'no_optout'));
}

// ── THE TRAP: A LINK MUST NOT RECORD ───────────────────────────────────────
// Outlook Safe Links and friends fetch every URL in an inbound message. If GET
// recorded, candidates would be marked interested — or opted out — before a
// human ever opened the email, and nothing would look wrong.
{
  const route = readFileSync(path.join(ROOT, 'routes/candidate-outreach.js'), 'utf8');
  const getHandler = route.split("router.get('/i/:token'")[1].split('async function recordAnswer')[0];
  ok('the GET answer page writes nothing',
    !/\.update\(|\.insert\(|addToSuppression/.test(getHandler), 'a write appears in the GET handler');
  ok('the answers are recorded on POST only',
    /router\.post\('\/i\/:token\/interested'/.test(route) &&
    /router\.post\('\/i\/:token\/not-interested'/.test(route) &&
    /router\.post\('\/i\/:token\/opt-out'/.test(route));

  // "Not this one" must not delete a good candidate from the whole database.
  const notInterested = route.split("router.post('/i/:token/not-interested'")[1].split('router.post')[0];
  ok('"not this one" does not suppress the address globally',
    !/suppress: true/.test(notInterested), notInterested.slice(0, 120));
  ok('only the explicit opt-out writes to the suppression list',
    (route.match(/addToSuppression\(/g) || []).length === 1 && /o\.suppress/.test(route),
    String((route.match(/addToSuppression\(/g) || []).length));
  // A public page may never hang on the database: measured at SEVEN SECONDS
  // with an unreachable Supabase, which is a spinner on a candidate's phone.
  ok('every database call behind the public page is time-bounded',
    /function withTimeout/.test(route) &&
    /withTimeout\(supabase\.from\('candidate_outreach'\)/.test(route) &&
    /withTimeout\(supabase\.from\('job_orders'\)/.test(route));
  ok('a write that did not happen is never reported as saved',
    /if \(wrote === undefined \|\| \(wrote && wrote\.error\)\) return unsurePage\(res\);/.test(route));
  ok('opting out also stops anything still queued for them',
    /status: 'skipped', fail_reason: 'recipient opted out'/.test(route));
  ok('the token is written before the send, not after',
    route.indexOf("update({ track_token: token })") < route.indexOf('await sendMailboxNewMessage'));
  ok('an unknown token is indistinguishable from a deleted one',
    /Deliberately identical for an unknown token/.test(route));
  // The preview showed the RULES brief while the queue sent the cached AI one,
  // so the screen and the outbox disagreed — and that is what hid the real
  // reason three of four candidates were skipped.
  ok('the preview and the queue read the brief through ONE loader',
    (route.match(/= briefFor\(job\)|brief: briefFor\(job\)/g) || []).length === 2 &&
    !/let brief = job \? gen\.rulesJobBrief/.test(route),
    String((route.match(/= briefFor\(job\)|brief: briefFor\(job\)/g) || []).length));
  ok('a skipped candidate is given the reason in words, not a code',
    /detail: q\.violations\.map\(x => x\.instruction\)/.test(route));
  // A pending row whose due time has passed looks broken, and the owner had to
  // ask whether it was the send window or a fault. The server knows; it must say.
  ok('a pending row carries WHY it has not gone yet',
    /const waitFor = \(r\) =>/.test(route) && /reason: 'window'/.test(route) &&
    /reason: 'due'/.test(route) && /reason: 'paused'/.test(route) && /reason: 'queued'/.test(route));
  ok('the wait reason names the hour it will actually go',
    /gen\.describeWindowOpens\(state, at\.day\)/.test(route));
  ok('the window is judged in the CANDIDATE\'s local day and hour',
    /function localPartsFor/.test(route) && /gen\.candidateWindowState\(at\.day, at\.minutes, win\)/.test(route));
  // The leads window is for prospects at their desks and must not leak back in.
  // Read through config/settings.js, so the admin screen and the sender share
  // one source rather than two hand-synced copies of four numbers.
  ok('the window is read through the shared settings schema, not a private query',
    /settingsConfig\.getSetting\(supabase, 'candidate_window_weekday_start'\)/.test(route) &&
    !/from\('app_settings'\)[\s\S]{0,200}candidate_window_/.test(route));
  ok('candidate sending does NOT use the leads engine window',
    !/isInLeadSendWindow|getSendWindowHours|formatWindowOpensLabel/.test(route));
  // A backlog released by an opening window would otherwise go out back to back.
  ok('the drain sleeps between real sends, so a backlog cannot burst',
    /if \(sent > 0\) await sleep\(DRIP_MIN_MS/.test(route));
  ok('a skipped or deferred row does not buy the next one a free slot',
    /if \(sent > 0\) await sleep/.test(route) && !/if \(true\) await sleep/.test(route));

  ok('the preview shows the buttons with a dead token',
    /answerButtonsHtml\(resolveBaseUrl\(\), 'preview'/.test(route));
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

function req(method, p, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout },
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
  ok('the server boots with candidate outreach mounted', booted, stderr.slice(-300));
  if (booted) {
    const unknown = await req('GET', '/definitely-not-a-route-xyz');
    ok('an unknown path 404s (so 401 below means the route exists)', unknown === 404, unknown);
    for (const [m, p] of [
      ['GET', '/candidate-outreach/sender'],
      ['GET', '/candidate-outreach/jobs'],
      ['GET', '/candidate-outreach/queue'],
      ['GET', '/candidate-outreach/jobs/x/brief'],
      ['POST', '/candidate-outreach/jobs/x/brief'],
      ['GET', '/candidate-outreach/jobs/x/candidates'],
      ['POST', '/candidate-outreach/preview'],
      ['POST', '/candidate-outreach/queue'],
      ['POST', '/candidate-outreach/cancel/x'],
    ]) {
      const s = await req(m, p);
      ok(`${m} ${p} is mounted and requires a token`, s === 401, s);
    }
    // The answer page is PUBLIC by design — a candidate has never signed in to
    // anything of ours. It must not 401, and with an unreachable database it
    // must still render a page rather than an error.
    for (const [m, p] of [['GET', '/i/deadbeefdeadbeef'], ['POST', '/i/deadbeefdeadbeef/interested'],
                          ['POST', '/i/deadbeefdeadbeef/not-interested'], ['POST', '/i/deadbeefdeadbeef/opt-out']]) {
      // 12s, because the handler's own bound is 4s and this suite runs against
      // an unreachable database on purpose — the point is that it ANSWERS.
      const started = Date.now();
      const s = await req(m, p, 12000);
      const took = Date.now() - started;
      ok(`${m} ${p} is public (never 401) and never 500`, s !== 401 && s !== 500, s);
      ok(`${m} ${p} answers within seconds even with the database down`, took < 9000, took + 'ms');
    }
    // A malformed token gets the same page as an unknown one.
    ok('a malformed token is answered with the same page as an unknown one',
      (await req('GET', '/i/not-a-token')) === 404);
  }
} catch (err) {
  ok('route harness completed', false, err && err.message);
} finally {
  child.kill('SIGKILL');
}

let failed = 0;
console.log('\n=== CANDIDATE OUTREACH ===');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
