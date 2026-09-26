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
  furthestReached, countSubmissionsEver, timeInStage,
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

// ── FROM HISTORY (R-002): how far they GOT, not where they are now ─────────
eq('furthest reached reads the whole history', furthestReached(['Not Accepted', 'Sourced', 'Submitted to Client']), 'Submitted to Client');
eq('nothing on the ladder → null', furthestReached(['On Hold', 'Tagged']), null);
const ever = countSubmissionsEver([
  { stage: 'Not Accepted', history: ['Sourced', 'Submitted to BDM', 'Submitted to Client', 'Not Accepted'] },  // rejected by the client
  { stage: 'Not Accepted', history: ['Sourced', 'Submitted to BDM', 'Not Accepted'] },                       // rejected by BD
  { stage: 'Submitted to BDM', history: ['Sourced', 'Submitted to BDM'] },                                   // waiting on BD
  { stage: 'Sourced', history: [] },
]);
eq('a client submission later rejected STILL counts as sent to the client', ever.toClient, 1);
eq('…and every one that reached BD counts as sent to BD', ever.toBdm, 3);
eq('the two the old count would have lost are reported', ever.recovered, 2);
eq('"stalled" is still about NOW: only the one waiting on BD', ever.stalled, 1);
eq('the old count really did lose them (why this exists)', countSubmissions([{ stage: 'Not Accepted' }, { stage: 'Not Accepted' }]).toBdm, 0);

// ── TIME IN STAGE (R-001) ──────────────────────────────────────────────────
{
  const now = Date.parse('2026-09-26T00:00:00Z');
  const rows = timeInStage([
    { id: 1, stage: 'Submitted to BDM', stage_updated_at: '2026-09-06T00:00:00Z', events: [
      { new_stage: 'Sourced', created_at: '2026-09-01T00:00:00Z' },
      { new_stage: 'Submitted to BDM', created_at: '2026-09-06T00:00:00Z' } ] },   // 5 days sourced, 20 days at BDM so far
    { id: 2, stage: 'Placement', stage_updated_at: '2026-08-01T00:00:00Z', events: [
      { new_stage: 'Confirmation', created_at: '2026-07-20T00:00:00Z' },            // legacy name
      { new_stage: 'Placement', created_at: '2026-08-01T00:00:00Z' } ] },
    { id: 3, stage: 'Sourced', stage_updated_at: '2026-09-24T00:00:00Z', events: [] },  // no history: from stage_updated_at
  ], { now, normalize: (s) => (s === 'Confirmation' ? 'Joining' : s) });
  const at = (st) => rows.find(r => r.stage === st) || {};
  eq('a finished stay is measured to the next change', at('Sourced').typical_days, 5);
  eq('someone there now is counted', at('Submitted to BDM').now_there, 1);
  eq('20 days at BDM is STUCK (14+)', at('Submitted to BDM').stuck, 1);
  eq('…measured "so far" when nobody has left that stage yet', at('Submitted to BDM').typical_from, 'still_there');
  eq('a row with no history still counts at its current stage', at('Sourced').now_there, 1);
  eq('a Placement is finished, never "stuck" however long ago', at('Placement').stuck, 0);
  step('legacy stage names are normalised (Confirmation → Joining)', !!at('Joining').stage && !rows.some(r => r.stage === 'Confirmation'));
  eq('rows come in ladder order', rows.map(r => r.stage).join('>'), 'Sourced>Submitted to BDM>Joining>Placement');
  eq('no submissions → no rows, no throw', timeInStage([], { now }).length, 0);
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
