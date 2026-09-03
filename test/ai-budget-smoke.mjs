// What an AI call is allowed to cost, and what happens at the ceiling.
//
// A free tier is a daily allowance. The way to lose one before lunch is to send
// a user's pasted 30,000-character job page to the biggest model forty times —
// so input is trimmed per feature, extraction runs on the small model, and the
// org's day has a ceiling that is checked BEFORE the call.
//
// The rule that must not be softened: going over budget is not an error. It
// produces the same null as "no provider configured", and the feature's rules
// writer answers. A budget is only safe to make strict because of that.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const budget = require('../services/ai-budget.js');
const ai = require('../services/ai-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── estimating ───────────────────────────────────────────────────────────────
step('an empty input costs nothing', budget.estimateTokens('') === 0);
step('tokens are estimated at ~4 characters each', budget.estimateTokens('x'.repeat(400)) === 100);
step('a part-token rounds UP, never down', budget.estimateTokens('xyz') === 1 && budget.estimateTokens('x'.repeat(401)) === 101);

// ── trimming: the only real defence against a pasted job page ────────────────
const short = 'A short posting.';
step('input under the ceiling is untouched', budget.trimToTokens(short, 100) === short);
const long = ('word '.repeat(20000));
const trimmed = budget.trimToTokens(long, 500);
step('a 100k-character paste is cut to the ceiling', budget.estimateTokens(trimmed) <= 520, budget.estimateTokens(trimmed) + ' tokens');
step('the model is told the text was cut', /truncated/.test(trimmed));
step('trimming lands on a word boundary, not mid-word',
  !/\bwor$|\bwo$/.test(trimmed.replace(/\n\n\[.*$/s, '')));

// ── per-feature ceilings ─────────────────────────────────────────────────────
step('every feature declares an input ceiling',
  Object.values(budget.FEATURES).every(f => f.in > 0 && f.out > 0 && f.tier));
step('extraction work runs on the small model',
  budget.featureLimits('resume_parse').tier === 'fast' && budget.featureLimits('jd_scrub').tier === 'fast');
step('prose a prospect will read gets the better model',
  budget.featureLimits('outreach_draft').tier === 'quality' && budget.featureLimits('cold_email').tier === 'quality');
// An unnamed caller must not be the way to get an unlimited allowance.
step('an unknown feature gets the tightest allowance, not an unlimited one',
  budget.featureLimits('something_new').in <= budget.FEATURES.cold_email.in);

// ── the daily ceiling ────────────────────────────────────────────────────────
const caps = { tokens: 10000, calls: 5 };
step('a first call of the day is allowed',
  budget.checkBudget({ tokens: 0, calls: 0 }, 2000, caps).allowed);
step('a call that would cross the token ceiling is refused BEFORE it is made',
  budget.checkBudget({ tokens: 9000, calls: 1 }, 2000, caps).reason === 'daily_token_cap');
step('the request-count ceiling is enforced separately from tokens',
  budget.checkBudget({ tokens: 0, calls: 5 }, 10, caps).reason === 'daily_call_cap');
step('a refusal says what was hit and how much was used',
  budget.checkBudget({ tokens: 9999, calls: 1 }, 2000, caps).cap === 10000);
step('an allowed call reports what is left', 
  budget.checkBudget({ tokens: 1000, calls: 1 }, 1000, caps).remaining_tokens === 8000);
// A blank admin box means "use the default"; a typed 0 means "no AI today".
step('a blank cap falls back to the default, not to zero',
  budget.checkBudget({ tokens: 0, calls: 0 }, 1000, { tokens: '', calls: '' }).allowed);
step('a cap of 0 genuinely turns AI off for the day',
  budget.checkBudget({ tokens: 0, calls: 0 }, 1, { tokens: 0, calls: 100 }).allowed === false);
step('the defaults sit under a typical free daily allowance',
  budget.DEFAULT_DAILY_TOKENS <= 200000 && budget.DEFAULT_DAILY_CALLS <= 500);

// ── model tiering per provider ───────────────────────────────────────────────
step('groq extraction uses the small fast model',
  ai.modelFor({ id: 'groq' }, 'fast') === 'llama-3.1-8b-instant');
step('groq prose uses the bigger model',
  ai.modelFor({ id: 'groq' }, 'quality') === 'llama-3.3-70b-versatile');
step('openrouter tiers stay on free models',
  ai.modelFor({ id: 'openrouter' }, 'fast').endsWith(':free') && ai.modelFor({ id: 'openrouter' }, 'quality').endsWith(':free'));
step("an admin's typed model beats the tier — they meant it",
  ai.modelFor({ id: 'groq', model_override: 'qwen-2.5-32b' }, 'fast') === 'qwen-2.5-32b');
step('a self-hosted box does not tier onto a model it may not have pulled',
  ai.modelFor({ id: 'ollama' }, 'fast') === ai.modelFor({ id: 'ollama' }, 'quality'));

// ── end to end: the budget actually stops a call ─────────────────────────────
// app_settings, as the real table stores it: one row per key.
const makeStore = (rows) => ({
  from() {
    const q = { _key: null };
    q.select = () => q;
    q.eq = (_c, v) => { q._key = v; return q; };
    q.ilike = () => q;
    q.maybeSingle = async () => ({ data: rows[q._key] !== undefined ? { value: rows[q._key] } : null });
    q.upsert = async (row) => { rows[row.key] = row.value; return { error: null }; };
    q.delete = () => ({ eq: async (_c, v) => { delete rows[v]; return { error: null }; } });
    return q;
  },
});

const realFetch = globalThis.fetch;
let sent = null, calls = 0;
globalThis.fetch = async (url, options) => {
  calls++; sent = JSON.parse(options.body);
  return { ok: true, status: 200, json: async () => ({
    choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 900, completion_tokens: 100 },
  }) };
};

// A pasted monster goes out trimmed, on the small model, for a resume parse.
const rows1 = { int_groq_api_key: 'gsk' };
const r1 = await ai.complete(makeStore(rows1), { feature: 'resume_parse', prompt: 'x'.repeat(200000), orgId: 'org-1' });
step('a huge input is trimmed before it leaves the building',
  budget.estimateTokens(sent.messages[0].content) <= budget.FEATURES.resume_parse.in + 20,
  budget.estimateTokens(sent.messages[0].content) + ' tokens sent');
step('resume parsing goes to the small model', sent.model === 'llama-3.1-8b-instant', sent.model);
step('the answer length is capped at the feature ceiling', sent.max_tokens === 700, String(sent.max_tokens));
step('the call reports which tier ran', r1 && r1.tier === 'fast');
step('a request over the feature ceiling is clamped down, never up',
  JSON.parse((await (async () => { await ai.complete(makeStore({ int_groq_api_key: 'gsk' }), { feature: 'cold_email', prompt: 'hi', maxTokens: 99999, orgId: 'o' }); return { body: JSON.stringify(sent) }; })()).body).max_tokens === 600);

// The meter records what was actually billed, and the next call sees it.
const rows2 = { int_groq_api_key: 'gsk' };
const store2 = makeStore(rows2);
await ai.complete(store2, { feature: 'cold_email', prompt: 'hi', orgId: 'org-2' });
const spent = await budget.getSpend(store2, 'org-2');
step('what the provider billed is written to the meter', spent.tokens === 1000, JSON.stringify(spent));
step('the meter counts requests as well as tokens', spent.calls === 1);
step('spend is attributed to the feature that caused it', spent.by_feature.cold_email === 1000);
step("one org's spend does not land on another's meter",
  (await budget.getSpend(store2, 'org-3')).tokens === 0);

// At the ceiling: no request is made at all, and the caller gets the same null
// it gets when no provider is configured.
calls = 0;
const rows3 = {
  int_groq_api_key: 'gsk',
  ai_daily_token_cap: '1000',
  [budget.usageKey('org-4', budget.dayKey())]: JSON.stringify({ tokens: 990, calls: 1, by_feature: {} }),
};
const overCap = await ai.complete(makeStore(rows3), { feature: 'cold_email', prompt: 'hi', orgId: 'org-4' });
step('a call over the daily ceiling returns null, not an error', overCap === null);
step('a refused call never reaches the provider', calls === 0, `${calls} requests made`);

// Yesterday's spend must not count against today.
const rows4 = {
  int_groq_api_key: 'gsk',
  ai_daily_token_cap: '1000',
  [budget.usageKey('org-5', '2020-01-01')]: JSON.stringify({ tokens: 999999, calls: 999, by_feature: {} }),
};
step("yesterday's spend does not eat into today", (await ai.complete(makeStore(rows4), { feature: 'cold_email', prompt: 'hi', orgId: 'org-5' })) !== null);

// A cap of 0 is a real setting: it turns AI off without disconnecting the key.
calls = 0;
const off = await ai.complete(makeStore({ int_groq_api_key: 'gsk', ai_daily_token_cap: '0' }), { feature: 'cold_email', prompt: 'hi', orgId: 'org-6' });
step('a zero cap switches AI off for the day without removing the key', off === null && calls === 0);

globalThis.fetch = realFetch;

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
