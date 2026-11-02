// THE AI CALL RECORD (D-0194, migration 071). Owner, 2 Nov 2026: "create a checker to see how much time does it take for AI
// to read the job description … and how many times it has to do it to be successful, for us to calculate the cost and AI
// model later." Pins: a row is built right; record() never throws; the Admin summary's numbers (success rate, seconds,
// tries, cost only when prices are typed); AND that complete() itself writes a row — the guard fails if the call to the
// record is removed from ai-provider.js, not only if the row is malformed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const log = require('../services/ai-call-log.js');
const provider = require('../services/ai-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// 1. buildRow
const r = log.buildRow({ orgId: 'o1', userId: 'u1', feature: 'outreach_email', outcome: 'ok', provider: 'groq', model: 'm', tries: 2, ms: 1530.4, usage: { input_tokens: 400, output_tokens: 120 } });
step('A row carries what, which model, how long, how many tries, text in/out', r.org_id === 'o1' && r.feature === 'outreach_email' && r.outcome === 'ok' && r.tries === 2 && r.ms === 1530 && r.input_tokens === 400 && r.output_tokens === 120 && r.model === 'm', JSON.stringify(r));
step('An unknown outcome is recorded as failed, never as ok', log.buildRow({ orgId: 'o', outcome: 'weird' }).outcome === 'failed');
step('No feature named is recorded as "other"', log.buildRow({ orgId: 'o' }).feature === 'other');
step('Retention is the owner\'s 120 days', log.RETENTION_DAYS === 120);

// 2. record() never throws
const inserted = [];
const fakeDb = (fail) => ({ from: (t) => ({
  insert: async (row) => { if (fail) throw new Error('db down'); inserted.push({ t, row }); return { error: null }; },
  select: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'org-default' }] }) }) }),
}) });
step('record() writes one row to ai_calls', await log.record(fakeDb(false), { orgId: 'o1', feature: 'x', outcome: 'ok' }) === true && inserted.length === 1 && inserted[0].t === 'ai_calls');
let threw = false; try { await log.record(fakeDb(true), { orgId: 'o1', outcome: 'ok' }); } catch (_) { threw = true; }
step('record() on a broken database does not throw (the feature it measures must not break)', !threw);
log._reset(); inserted.length = 0;
await log.record(fakeDb(false), { feature: 'x', outcome: 'ok' });
step('A call with no company lands on the founding company (org_id is never null)', inserted.length === 1 && inserted[0].row.org_id === 'org-default', JSON.stringify(inserted[0] && inserted[0].row));

// 3. summarize
const rows = [
  { feature: 'jd_parse', outcome: 'ok', provider: 'groq', model: 'a', tries: 1, ms: 2000, input_tokens: 1000, output_tokens: 200 },
  { feature: 'jd_parse', outcome: 'ok', provider: 'groq', model: 'a', tries: 2, ms: 4000, input_tokens: 1000, output_tokens: 200 },
  { feature: 'jd_parse', outcome: 'failed', provider: 'groq', model: 'a', tries: 3, ms: 9000, input_tokens: 0, output_tokens: 0 },
  { feature: 'outreach_email', outcome: 'over_budget', tries: 0, ms: 5 },
];
const s0 = log.summarize(rows, { in: 0, out: 0 });
const jd = s0.lines.find((l) => l.feature === 'jd_parse');
step('Per kind: requests, success rate', jd && jd.calls === 3 && jd.ok === 2 && Math.abs(jd.success_rate - 2 / 3) < 1e-9, JSON.stringify(jd));
step('Average seconds counts only requests that worked', jd && jd.avg_seconds === 3, String(jd && jd.avg_seconds));
step('Average tries counts every request that tried', jd && jd.avg_tries === 2, String(jd && jd.avg_tries));
step('No prices typed → no cost shown (never $0 pretending to be a price)', s0.priced === false && jd.est_cost === null && s0.all.est_cost === null);
step('The "All" line adds every kind up', s0.all.calls === 4 && s0.all.over_budget === 1 && s0.all.failed === 1);
const s1 = log.summarize(rows, { in: 1, out: 4 });
const jd1 = s1.lines.find((l) => l.feature === 'jd_parse');
step('With prices: cost = tokens × price per million', s1.priced && Math.abs(jd1.est_cost - (2000 * 1 + 400 * 4) / 1e6) < 1e-12, String(jd1.est_cost));
step('…and per 1,000 requests', Math.abs(jd1.est_cost_per_1000 - jd1.est_cost / 3 * 1000) < 1e-9);

// 4. complete() records — the wiring, not only the module
const writes = [];
const fakeSupabase = { from: (t) => {
  const q = { _t: t,
    select() { return q; }, eq() { return q; }, in() { return q; }, like() { return q; }, order() { return q; }, limit() { return q; },
    maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }),
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
    insert: async (row) => { writes.push({ t, row }); return { error: null }; },
    upsert: async () => ({ error: null }), delete() { return q; },
  };
  return q;
} };
const ans = await provider.complete(fakeSupabase, { feature: 'jd_parse', orgId: 'org-x', prompt: 'hi' });
const w = writes.find((x) => x.t === 'ai_calls');
step('complete() with no AI set up still answers null (rules write it)…', ans === null);
step('…and leaves a "no_provider" row in ai_calls for that company and feature', !!w && w.row.outcome === 'no_provider' && w.row.org_id === 'org-x' && w.row.feature === 'jd_parse', JSON.stringify(w && w.row));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
