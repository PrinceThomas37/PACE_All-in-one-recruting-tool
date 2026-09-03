// ============================================================================
// AI BUDGET — how much a feature is allowed to spend, and what it has spent.
//
// WHY THIS EXISTS
// A free tier is a DAILY ALLOWANCE, not a bill. Nothing here can produce a
// charge — there is no card on a free account — but an allowance can be
// emptied by lunchtime by one careless call, and then every AI feature is
// degraded for the rest of the day for everyone in the org. The failure mode
// is not money, it is "the good version stopped working and nobody knows why".
//
// Three levers, in order of how much they matter:
//
//   1. WHAT WE SEND. Cost is dominated by input length, and input length is
//      whatever a user happened to paste. An uncapped job posting is an
//      uncapped bill. Every feature declares a hard input ceiling here and
//      long input is TRIMMED, not refused — a resume's first pages carry the
//      fields we extract, so trimming costs nothing real.
//   2. WHICH MODEL. Pulling fields out of a resume and writing a cold email
//      are not the same job. Extraction runs on the small fast model; only
//      prose the customer's prospect will read gets the bigger one.
//   3. HOW MANY. A per-org daily ceiling on calls and tokens, checked BEFORE
//      the call, so the allowance is spent evenly over a working day instead
//      of in one import.
//
// Going over budget is NEVER an error and never blocks a user: the call is
// skipped and the feature's rules writer produces the answer, exactly as it
// does on a deployment with no AI at all. That is the whole reason a budget
// can be strict without being risky.
//
// Everything here is PURE except the two functions that read and write the
// counter, which are the only ones that touch the database.
// ============================================================================

'use strict';

// A token is ~4 characters of English. This is an estimate, deliberately: the
// only exact count comes from the provider, after the call, which is too late
// to decide whether to make it. Estimating high is the safe direction, so this
// rounds up.
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

// Trim to a token ceiling on a word boundary, and say so in the text. A model
// that can see it was handed a truncated posting behaves better than one that
// thinks the document simply ended.
function trimToTokens(text, maxTokens) {
  const s = String(text || '');
  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN);
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()
    + '\n\n[…truncated for length]';
}

// Per-feature ceilings. `in` is the input a feature may send; `out` is the
// longest answer it may ask for; `tier` picks the model.
//
// These numbers come from what each feature actually needs, not from a round
// number: a resume's fields are in its first two pages, a rewritten job
// description is about as long as the original, and a cold email is 150 words.
const FEATURES = {
  resume_parse:    { label: 'Resume parsing',        in: 4000, out: 700,  tier: 'fast' },
  jd_scrub:        { label: 'Job description clean', in: 3000, out: 2500, tier: 'fast' },
  outreach_draft:  { label: 'Outreach generator',    in: 3000, out: 1000, tier: 'quality' },
  cold_email:      { label: 'Cold email drafting',   in: 1000, out: 600,  tier: 'quality' },
  import_briefing: { label: 'Daily import briefing', in: 1200, out: 400,  tier: 'fast' },
  lead_ratio:      { label: 'Lead distribution',     in: 1200, out: 400,  tier: 'fast' },
};
// An unnamed caller gets the tightest sensible allowance rather than no limit.
const DEFAULT_FEATURE = { label: 'Other', in: 1000, out: 500, tier: 'fast' };

const featureLimits = (feature) => FEATURES[feature] || DEFAULT_FEATURE;

// Daily ceilings per organisation. Deliberately well under the daily
// allowance of the free tiers, so the day's budget runs out before the
// PROVIDER's does — being throttled by your own settings is diagnosable;
// being throttled by Groq at 2pm is not.
const DEFAULT_DAILY_TOKENS = 150000;
const DEFAULT_DAILY_CALLS = 250;
// 0 means "no AI at all today"; a negative number is meaningless. Blank in the
// admin box means "use the default", which is why null is not zero here.
const numOr = (v, dflt) => {
  const n = Number(v);
  return (v === null || v === undefined || v === '' || !isFinite(n) || n < 0) ? dflt : Math.floor(n);
};

// PURE. Given today's spend and the caps, may this call go ahead?
// `estimated` is input + the most the answer could be, because a budget that
// only counts what was actually returned can be blown past by one long reply.
function checkBudget(spent, estimated, caps) {
  const tokenCap = numOr(caps && caps.tokens, DEFAULT_DAILY_TOKENS);
  const callCap = numOr(caps && caps.calls, DEFAULT_DAILY_CALLS);
  const usedTokens = (spent && spent.tokens) || 0;
  const usedCalls = (spent && spent.calls) || 0;
  if (usedCalls + 1 > callCap) {
    return { allowed: false, reason: 'daily_call_cap', cap: callCap, used: usedCalls };
  }
  if (usedTokens + estimated > tokenCap) {
    return { allowed: false, reason: 'daily_token_cap', cap: tokenCap, used: usedTokens, estimated };
  }
  return { allowed: true, remaining_tokens: tokenCap - usedTokens - estimated, remaining_calls: callCap - usedCalls - 1 };
}

// ── the counter (the only impure part) ──────────────────────────────────────
// Kept in app_settings, keyed per org and per DAY, so it needs no migration
// and expires by simply never being read again. This is a meter, not an audit
// log: it answers "how much is left today", which is the question the budget
// asks. A per-call history is a later upgrade and its own table.
const dayKey = (d) => (d || new Date()).toISOString().slice(0, 10);
const usageKey = (orgId, day) => `ai_usage_${orgId || 'default'}_${day}`;
const CAP_TOKENS_KEY = 'ai_daily_token_cap';
const CAP_CALLS_KEY = 'ai_daily_call_cap';

async function readSetting(supabase, key) {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    return data ? data.value : null;
  } catch (_) { return null; }
}

async function getCaps(supabase) {
  return {
    tokens: numOr(await readSetting(supabase, CAP_TOKENS_KEY), DEFAULT_DAILY_TOKENS),
    calls: numOr(await readSetting(supabase, CAP_CALLS_KEY), DEFAULT_DAILY_CALLS),
  };
}

async function getSpend(supabase, orgId, now) {
  const raw = await readSetting(supabase, usageKey(orgId, dayKey(now)));
  if (!raw) return { tokens: 0, calls: 0, by_feature: {} };
  try {
    const p = JSON.parse(raw);
    return { tokens: p.tokens || 0, calls: p.calls || 0, by_feature: p.by_feature || {} };
  } catch (_) { return { tokens: 0, calls: 0, by_feature: {} }; }
}

// Record what a call cost. Best-effort on purpose: a counter that throws would
// take down the feature it is supposed to protect, which is a worse outcome
// than an under-counted day.
async function recordSpend(supabase, orgId, feature, tokens, now) {
  try {
    const day = dayKey(now);
    const spent = await getSpend(supabase, orgId, now);
    const by = { ...spent.by_feature };
    by[feature || 'other'] = (by[feature || 'other'] || 0) + tokens;
    await supabase.from('app_settings').upsert({
      key: usageKey(orgId, day),
      value: JSON.stringify({ tokens: spent.tokens + tokens, calls: spent.calls + 1, by_feature: by }),
      updated_at: new Date(),
    }, { onConflict: 'key' });
  } catch (_) { /* a meter is not worth an outage */ }
}

module.exports = {
  CHARS_PER_TOKEN, FEATURES, DEFAULT_FEATURE,
  DEFAULT_DAILY_TOKENS, DEFAULT_DAILY_CALLS,
  CAP_TOKENS_KEY, CAP_CALLS_KEY,
  estimateTokens, trimToTokens, featureLimits, checkBudget,
  dayKey, usageKey, getCaps, getSpend, recordSpend,
};
