// ============================================================================
// THE JOB DESCRIPTION PANEL INSIDE THE CANDIDATE EMAIL  (D-0012, C-0020)
// ----------------------------------------------------------------------------
// The owner's call: the job description travels INSIDE the "are you interested?"
// email as a formatted panel, not as an attachment and not as a second workflow.
// This suite pins the four properties that would have caught a real fault while
// it was being built — C-0020 names them, and nothing pinned them until now.
//
// PURE. No browser, no database, no clock. The panel is a function of a
// `job_orders` row, which is exactly why it can be tested this cheaply.
//
// ⚠ THE ONE THAT MATTERS MOST is `html === htmlFromText(split(stored).block)`.
// The send path rebuilds the card from the STORED ROW, never by re-reading
// job_orders. That is what stops the preview and the outbox disagreeing when
// somebody edits the job order in between — the Session 21 defect, in which the
// screen showed the rules text while the queue sent the AI text.
// ============================================================================
import gen from '../services/candidate-outreach.js';

const results = [];
const ok = (name, pass, detail) => results.push({ name, ok: !!pass, detail: detail == null ? '' : String(detail) });

const FULL_JOB = {
  job_title: 'HVAC Service Technician',
  client: 'Acme Mechanical',
  city: 'New Britain', state: 'CT',
  job_type: 'Full-time', remote: 'No',
  pay_cur: 'USD', pay_min: 70000, pay_max: 95000,
  exp_min: 3, exp_max: 7,
  primary_skills: 'hvac, epa, boilers',
  work_auth: 'US Citizen or Green Card',
  clearance: 'None',
  job_description: 'Service and repair commercial HVAC systems.\nYou have 5+ years on rooftop units.\nPay up to $3,200 per week! Exciting opportunity!'
};

// ── 1 · the safety property ────────────────────────────────────────────────
{
  const block = gen.jobBlock(FULL_JOB);
  ok('a populated job order produces a panel', !!block);
  ok('the card is exactly the card rebuilt from the stored text',
    block.html === gen.jobBlockHtmlFromText(gen.splitJobBlock('Hi there,\n\nHave a look.\n\n' + block.text).block));

  // And the round trip survives the real storage shape: prose + panel in one body.
  const stored = 'Hi Dana,\n\nThought of you for this.\n\n' + block.text;
  const split = gen.splitJobBlock(stored);
  ok('splitting a stored body returns the prose without the panel',
    split.prose.includes('Thought of you') && !split.prose.includes(gen.BLOCK_FENCE));
  ok('splitting a stored body returns the panel', split.block.includes('HVAC Service Technician'));
  ok('a body with no panel is returned untouched',
    gen.splitJobBlock('Just a note.').prose === 'Just a note.' && gen.splitJobBlock('Just a note.').block === '');
}

// ── 2 · a posting containing its own rule of dashes ────────────────────────
{
  const job = { ...FULL_JOB, job_description: 'About the role\n----------------\nYou will service rooftop units.\n----------------\nBenefits are good.' };
  const block = gen.jobBlock(job);
  const stored = 'Hi,\n\nHave a look.\n\n' + block.text;
  const split = gen.splitJobBlock(stored);
  ok('a posting full of dash rules does not split the email in the wrong place',
    split.prose.trim() === 'Hi,\n\nHave a look.'.trim(), JSON.stringify(split.prose));
  ok('the panel still carries the posting text after its own rules are dropped',
    split.block.includes('rooftop units') && split.block.includes('Benefits are good'));
  ok('the rebuilt card matches, dash rules and all',
    block.html === gen.jobBlockHtmlFromText(split.block));
}

// ── 3 · the checker reads the PROSE, never the panel ───────────────────────
// A client's own posting says "5+ years", "$3,200 per week" and "Exciting
// opportunity!". Those are quotations, not model output. `invented_experience`
// reading them is what silently skipped 3 of 4 real people on the first live run.
{
  const block = gen.jobBlock(FULL_JOB);
  const prose = 'Hi Dana,\n\nYou came up for an HVAC Service Technician role in New Britain, CT. '
    + 'The work is on commercial rooftop systems. Want to hear the details?\n\nThanks,';
  const email = prose + '\n\n' + block.text;
  ok('proseOf() hands the checker the prose alone', !gen.proseOf(email).includes('$3,200'));

  const input = { candidate: { full_name: 'Dana Reed' }, job: FULL_JOB };
  const q = gen.checkCandidateDraft({ subject: 'HVAC Service Technician — New Britain, CT', email },
    input, { angle: 'direct', hasButtons: true, omitSignOff: false });
  const names = (q.violations || []).map(v => v.code || v);
  ok('a quoted pay figure in the panel does not fail the draft', !names.includes('invented_pay'), names.join(','));
  ok('a quoted "5+ years" in the panel does not fail the draft', !names.includes('invented_experience'), names.join(','));
  ok('a quoted exclamation mark in the panel does not fail the draft', !names.includes('exclamation'), names.join(','));

  // But an unresolved token ANYWHERE is still caught — the panel is not a blind spot.
  const bad = gen.checkCandidateDraft({ subject: 'x', email: prose + '\n\n' + block.text.replace('Acme Mechanical', '{{company}}') },
    input, { angle: 'direct', hasButtons: true, omitSignOff: false });
  ok('an unresolved token inside the panel IS still caught',
    (bad.violations || []).some(v => (v.code || v) === 'placeholder'), JSON.stringify(bad.violations));
}

// ── 4 · nothing to panel means NO panel ────────────────────────────────────
// An empty frame reads as a broken system, and a card carrying only a title says
// less than the subject line already did.
{
  ok('a title-only job order gets no panel at all', gen.jobBlock({ job_title: 'Estimator' }) === null);
  ok('a job order with no title gets no panel', gen.jobBlock({ client: 'Acme' }) === null);
  ok('no job at all gets no panel', gen.jobBlock(null) === null);
  ok('an absent panel renders as an empty string, not an empty card',
    gen.jobBlockHtmlFromText('') === '');

  // A FILLED-IN FIELD MEANING "NOTHING" IS STILL NOTHING: clearance "None".
  const rows = gen.jobBlockRows(FULL_JOB).map(r => r.label);
  ok('"Clearance: None" is not printed as a row', !rows.includes('Clearance'), rows.join(','));
  ok('real rows are printed', rows.includes('Company') && rows.includes('Location') && rows.includes('Pay'));
  ok('no row is ever blank', gen.jobBlockRows(FULL_JOB).every(r => r.value && r.value.trim()));
}

// ── 4b · the panel never forwards the client's own apply link ──────────────
// A staffing firm that passes on "apply at careers.acme.com" has given away the
// placement it is being paid for. Found by LOOKING at a rendered email, not by a
// test: every case written from memory had politely used "https://", and a bare
// domain — which is how postings usually write it — went straight through.
{
  const strip = d => gen.cleanDescription(d).join(' | ');
  for (const [label, text] of [
    ['a bare domain with a path', 'Company van provided. Apply at acme.example.com/jobs'],
    ['a full URL',                'Company van provided. Apply at https://acme.com/jobs'],
    ['a www address',             'Company van provided. Submit your CV at www.acme.com'],
    ['an email address',          'Company van provided. Send your resume to jobs@acme.com'],
    ['a careers subdomain',       'Great team. Apply at careers.acme.io today']
  ]) ok(`an apply instruction using ${label} is stripped`, !/acme/i.test(strip(text)), strip(text));

  // …and the surrounding fact is KEPT. Dropping the whole line loses real content.
  ok('the fact beside the apply instruction survives',
    strip('Company van provided. Apply at acme.example.com/jobs').includes('Company van'));

  // Not everything with a dot in it is an apply link.
  ok('an ordinary sentence is untouched',
    strip('Rooftop units and boilers. On-call rotation, one week in four.').includes('On-call rotation'));
  ok('a tool named with a domain is not mistaken for an apply link',
    strip('We use Procore.com internally for project tracking.').includes('Procore.com'));
  ok('a decimal number does not trip the matcher',
    strip('Requires 3.5 years of experience. Send us your availability.').includes('3.5 years'));
}

// ── 5 · the two live defects this work fixed, in text a candidate reads ────
{
  const html = gen.jobBlock(FULL_JOB).html;
  ok('skills are printed properly-cased, not raw lowercase', /HVAC/.test(html) && /EPA/.test(html), html.slice(0, 200));
  ok('an acronym title takes "an", not "a"', /^an /.test(gen.indefinite('HVAC Service Technician')),
    gen.indefinite('HVAC Service Technician'));
  ok('a consonant title still takes "a"', /^a /.test(gen.indefinite('Superintendent')), gen.indefinite('Superintendent'));
}

// ── 6 · the card is EMAIL markup ───────────────────────────────────────────
// Outlook has no flexbox, no grid, and strips <style>. Inline attributes only.
{
  const html = gen.jobBlock(FULL_JOB).html;
  ok('the card is a table, not a flex/grid div', /^<table/.test(html) && !/display:\s*(flex|grid)/.test(html));
  ok('the card carries no class= (no stylesheet reaches an inbox)', !/\sclass=/.test(html));
  ok('the card escapes what it prints',
    !gen.jobBlockHtmlFromText(gen.jobBlock({ ...FULL_JOB, job_title: 'Tech <script>x</script>' }).text).includes('<script>'));
}

let failed = 0;
console.log('\n=== CANDIDATE JD PANEL ===');
for (const r of results) { if (!r.ok) failed++; console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`); }
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
