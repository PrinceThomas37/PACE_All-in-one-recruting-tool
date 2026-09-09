// Unit test for services/morning-briefing.js — the one-or-two-sentence card
// at the top of the dashboard saying what actually came in today.
//
// Three things this pins, in the order they matter:
//
//   1. THE NO-AI PATH NEVER APOLOGISES. This endpoint used to answer "AI
//      summary unavailable" — the one sentence a customer must never be shown
//      by a feature the Admin screen promises has a built-in non-AI version.
//      `rulesBriefing()`/`chooseBriefing(null, facts)` must always produce a
//      real, non-empty sentence, on a quiet day and a busy one.
//
//   2. `checkBriefing()` REJECTS A NUMBER THE MODEL WAS NOT HANDED — a bare
//      invented integer, a spelled-out one ("Two replies" when the facts said
//      3 — the exact shape a hand-written screenshot stub used), and a vague
//      quantity ("around a dozen leads"). This is the whole reason the AI path
//      is safe to ship without a funded key: the checker, not the prompt, is
//      the guarantee.
//
// Usage: node test/morning-briefing-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const briefing = require('../services/morning-briefing.js');
const { rulesBriefing, chooseBriefing, checkBriefing, allowedNumbers } = briefing;

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const busyFacts = {
  date: '2026-09-09',
  leads: { new: 6, duplicates: 1, pool: 12, topIndustries: [{ name: 'Construction', count: 4 }] },
  candidates: { new: 3 },
  submissions: { new: 1 },
  replies: { inbound: 2, from_candidates: 1, from_contacts: 1 },
};

const quietFacts = { date: '2026-09-09' };

// ── 1. The no-AI path never apologises, and summary is never empty ─────────
{
  const busy = rulesBriefing(busyFacts);
  ok('rules writer on a busy day: summary is non-empty', typeof busy.summary === 'string' && busy.summary.length > 0);
  ok('rules writer on a busy day: not quiet', busy.quiet === false);
  ok('rules writer on a busy day: engine is rules', busy.engine === 'rules');
  ok('busy summary never says AI is unavailable',
    !/ai\s+(summary\s+)?(is\s+)?unavailable/i.test(busy.summary) && !/no ai provider/i.test(busy.summary));

  const quiet = rulesBriefing(quietFacts);
  ok('rules writer on a quiet day: summary is non-empty', typeof quiet.summary === 'string' && quiet.summary.length > 0);
  ok('rules writer on a quiet day: quiet is true', quiet.quiet === true);
  ok('quiet summary never says AI is unavailable', !/unavailable/i.test(quiet.summary));

  // chooseBriefing(null, facts) is exactly what the route calls when
  // ai.complete() returns null — the normal case, not a failure.
  const chosenNoAi = chooseBriefing(null, busyFacts);
  ok('chooseBriefing(null, facts) still returns a real sentence', chosenNoAi.summary.length > 0);
  ok('chooseBriefing(null, facts) reports engine "rules", not an error', chosenNoAi.engine === 'rules');
  ok('chooseBriefing(null, facts) never apologises for missing AI',
    !/unavailable|no ai provider|could not generate/i.test(chosenNoAi.summary));
  ok('chooseBriefing(null, facts) has no ai_rejected reason (there was no draft to reject)',
    chosenNoAi.ai_rejected === null);

  // Never crash on an empty/undefined facts object either.
  const empty = rulesBriefing(undefined);
  ok('rules writer on undefined facts still returns a non-empty sentence', empty.summary.length > 0);
}

// ── 2. checkBriefing rejects a number the model was not handed ─────────────
{
  const allowed = allowedNumbers(busyFacts);
  ok('sanity: 2 (replies) is an allowed number for busyFacts', allowed.has(2));
  ok('sanity: 999 is not an allowed number for busyFacts', !allowed.has(999));

  // A bare invented integer.
  const bareInvented = 'There were 6 new leads and 999 replies waiting on an answer.';
  ok('bare invented integer is rejected', checkBriefing(bareInvented, busyFacts).includes('invented_number'));

  // A spelled-out invented number — exactly what a hand-written stub used:
  // "Two replies are waiting" when the facts said 2 replies is FINE (2 is
  // allowed), so use a count the facts do NOT contain.
  const spelledInvented = 'Six new leads came in today. Seven replies are waiting on an answer.';
  ok('spelled-out invented number is rejected',
    checkBriefing(spelledInvented, busyFacts).includes('invented_number_word'));

  // The exact real-world case: the facts say 3, the draft says "Two".
  const threeFacts = { date: '2026-09-09', replies: { inbound: 3 } };
  const twoStub = 'Two replies came in today and are waiting on an answer.';
  const v = checkBriefing(twoStub, threeFacts);
  ok('"Two replies" against facts of 3 is rejected as an invented number word',
    v.includes('invented_number_word'), JSON.stringify(v));

  // A vague quantity survives every digit check and must still be rejected.
  const vague1 = 'Around a dozen new leads came in today.';
  ok('"around a dozen" is rejected as a vague quantity', checkBriefing(vague1, busyFacts).includes('vague_quantity'));
  const vague2 = 'Several new candidates and a handful of replies came in today.';
  ok('"several"/"a handful" is rejected as a vague quantity', checkBriefing(vague2, busyFacts).includes('vague_quantity'));

  // A clean draft using only allowed numbers, spelled or digit, must pass.
  const clean = 'Six new leads, three new candidates and two replies came in today. The replies are waiting on an answer.';
  ok('a clean draft using only allowed numbers passes', checkBriefing(clean, busyFacts).length === 0,
    JSON.stringify(checkBriefing(clean, busyFacts)));

  // And chooseBriefing must fall back to the rules writer for every bad draft.
  const chosenBad = chooseBriefing(twoStub, threeFacts);
  ok('chooseBriefing falls back to rules when the AI draft invents a number',
    chosenBad.engine === 'rules' && chosenBad.ai_rejected && chosenBad.ai_rejected.includes('invented_number_word'));
}

console.log('\n=== MORNING BRIEFING SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
