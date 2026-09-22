// WHAT COUNTS AS A SUBMISSION (Session 28, D-0029).
//
// The owner's correction: *"adding a candidate to a job is not submission."*
// They were right, and PACE had it wrong in two of the three places it counted.
//
// This suite exists because the word had THREE different meanings in one
// product at once: the Reports headline used a local list of stages, while the
// Dashboard's "Subs this week" and the Hot-jobs ranking counted every row in
// the table — so sourcing ten people on Monday reported ten submissions. The
// table is named `submissions` and holds all eleven ATS stages, which is how a
// storage name became a business metric.
//
// Usage: node test/submission-stages-smoke.mjs

import {
  isSentToBdm, isSentToClient, isInPipelineOnly, countSubmissions, LADDER, OFF_LADDER,
} from '../services/submission-stages.js';

const results = [];
const step = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const eq = (n, got, want) => step(n, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── THE CORRECTION ITSELF ─────────────────────────────────────────────────
// These four are the whole point of the decision. If any of them flips, the
// metric is lying again.
step('Sourced is NOT a submission', !isSentToBdm('Sourced') && !isSentToClient('Sourced'));
step('Screening is NOT a submission', !isSentToBdm('Screening') && !isSentToClient('Screening'));
step('Submitted to BDM is recruiter output, NOT sent to the client',
  isSentToBdm('Submitted to BDM') && !isSentToClient('Submitted to BDM'));
step('Submitted to Client IS a real submission',
  isSentToClient('Submitted to Client') && isSentToBdm('Submitted to Client'));

// Anything past the client counts too — a candidate at Offer was obviously sent.
for (const s of ['Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement']) {
  step(`${s} still counts as sent to the client`, isSentToClient(s));
}

// ── being in the running is its own state ─────────────────────────────────
step('Sourced and Screening are "in the pipeline only"',
  isInPipelineOnly('Sourced') && isInPipelineOnly('Screening'));
step('Submitted to BDM is no longer pipeline-only', !isInPipelineOnly('Submitted to BDM'));

// ── off-ladder stages assert NOTHING ──────────────────────────────────────
// `Not Accepted` and `On Hold` do not say how far somebody got. Treating them
// as submissions would over-count; this is the known limit in D-0029.
for (const s of OFF_LADDER) {
  step(`${s} is not counted either way`, !isSentToBdm(s) && !isSentToClient(s) && !isInPipelineOnly(s));
}
// An unknown or junk stage must never be silently counted as a submission —
// that is how a renamed stage inflates a metric with nobody noticing.
for (const s of ['', null, undefined, 'Submitted', 'submitted to client', 'Totally Made Up']) {
  step(`an unrecognised stage (${JSON.stringify(s)}) counts as nothing`, !isSentToBdm(s) && !isSentToClient(s));
}

// ── the two numbers, and the gap between them ─────────────────────────────
const rows = [
  { stage: 'Sourced' }, { stage: 'Sourced' }, { stage: 'Screening' },
  { stage: 'Submitted to BDM' }, { stage: 'Submitted to BDM' },
  { stage: 'Submitted to Client' }, { stage: 'Offer' }, { stage: 'Placement' },
  { stage: 'Not Accepted' }, { stage: 'On Hold' },
];
const c = countSubmissions(rows);
eq('sent to BDM counts everything handed over or further', c.toBdm, 5);
eq('sent to client counts only what reached the client', c.toClient, 3);
// THE GAP IS THE POINT — this is why the owner chose two numbers over one.
eq('stalled = handed to BD, not yet with the client', c.stalled, 2);
eq('in the pipeline but sent nowhere', c.inPipeline, 3);
eq('off-ladder rows are reported, not hidden', c.offLadder, 2);
eq('total is every row', c.total, rows.length);
step('toBdm always includes toClient', c.toBdm >= c.toClient);
step('the parts account for every row', c.toBdm + c.inPipeline + c.offLadder === c.total,
  `${c.toBdm} + ${c.inPipeline} + ${c.offLadder} vs ${c.total}`);

// An all-sourced job — the exact case that used to report submissions.
const sourcedOnly = countSubmissions([{ stage: 'Sourced' }, { stage: 'Sourced' }, { stage: 'Sourced' }]);
eq('ten sourced candidates are ZERO submissions', sourcedOnly.toBdm, 0);
eq('and zero client submissions', sourcedOnly.toClient, 0);
eq('but they are visibly in the pipeline', sourcedOnly.inPipeline, 3);

// Empty input must not throw — the dashboard renders for brand-new orgs.
eq('no rows counts zero', countSubmissions([]).total, 0);
eq('undefined rows counts zero', countSubmissions(undefined).total, 0);

// ── the ladder matches the product's stage vocabulary ─────────────────────
// If a stage is renamed in 33-stage-modal.js and not here, this file starts
// silently answering "no" for it — which under-counts rather than erroring.
const CANON = ['Sourced', 'Screening', 'Submitted to BDM', 'Submitted to Client',
  'Interview Scheduled', 'Interview Completed', 'Offer', 'Joining', 'Placement'];
eq('the ladder is the ATS stage order', LADDER.join('|'), CANON.join('|'));
step('Not Accepted and On Hold are deliberately off the ladder',
  OFF_LADDER.includes('Not Accepted') && OFF_LADDER.includes('On Hold')
  && !LADDER.includes('Not Accepted') && !LADDER.includes('On Hold'));

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
