// ============================================================================
// THE AI CALL RECORD (owner, 2 Nov 2026, D-0194, migration 071 `ai_calls`).
// ----------------------------------------------------------------------------
// "Create a checker to see how much time does it take for AI to read the job description and then write them down and
// how many times it has to do it to be successful, for us to calculate the cost and AI model later."
//
// services/ai-provider.js complete() calls record() once per call — every feature, not only posting reads, because all
// AI goes through that one door. record() NEVER throws and never slows the answer by more than one insert: a record that
// breaks the feature it measures is worse than a missing row.
//
// summarize() is PURE (rows in, table out) so the Admin table is testable without a database. Cost is an ESTIMATE from
// prices the admin types in (config/settings.js ai_price_in_per_million / ai_price_out_per_million) — PACE never quotes
// a vendor's price from memory (CLAUDE.md). Price 0 = "not set", and the table says so instead of showing $0.
// ============================================================================
'use strict';

const RETENTION_DAYS = 120;             // owner, 2 Nov: "Make it 120 days."
const OUTCOMES = ['ok', 'failed', 'over_budget', 'no_provider'];

let fallbackOrg = { id: process.env.DEFAULT_ORG_ID || null, looked: false };
async function orgFor(supabase, orgId) {
  if (orgId) return orgId;
  if (fallbackOrg.id || fallbackOrg.looked) return fallbackOrg.id;
  fallbackOrg.looked = true;
  try {
    const { data } = await supabase.from('organizations').select('id').order('created_at', { ascending: true }).limit(1);
    fallbackOrg.id = (data && data[0] && data[0].id) || null;
  } catch (_) { /* no org: the row is skipped */ }
  return fallbackOrg.id;
}

const int = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0);

/** The row for one call. PURE. `c` = { orgId, userId, feature, outcome, provider, model, tries, ms, usage, error }. */
function buildRow(c) {
  const outcome = OUTCOMES.includes(c && c.outcome) ? c.outcome : 'failed';
  const u = (c && c.usage) || {};
  return {
    org_id: c.orgId,
    user_id: c.userId || null,
    feature: String((c && c.feature) || 'other').slice(0, 60),
    outcome,
    provider: c.provider ? String(c.provider).slice(0, 40) : null,
    model: c.model ? String(c.model).slice(0, 120) : null,
    tries: int(c.tries),
    ms: int(c.ms),
    input_tokens: int(u.input_tokens),
    output_tokens: int(u.output_tokens),
    error: c.error ? String(c.error).replace(/\s+/g, ' ').slice(0, 300) : null,
  };
}

/** Write one row. Best-effort: never throws. */
async function record(supabase, c) {
  try {
    const orgId = await orgFor(supabase, c && c.orgId);
    if (!orgId) return false;
    const { error } = await supabase.from('ai_calls').insert(buildRow(Object.assign({}, c, { orgId })));
    if (error) { console.warn('[ai-calls] not recorded:', error.message); return false; }
    return true;
  } catch (e) { console.warn('[ai-calls] not recorded:', e.message); return false; }
}

/** Delete rows older than the retention window. Returns how many went (best-effort). */
async function purge(supabase, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString();
  try {
    const { data, error } = await supabase.from('ai_calls').delete().lt('created_at', cutoff).select('id');
    if (error) throw error;
    return (data || []).length;
  } catch (e) { console.warn('[ai-calls] purge failed:', e.message); return 0; }
}

/**
 * The Admin table. PURE. rows: ai_calls rows; prices: { in, out } per million tokens (0 = not set).
 * One line per feature (and an "All" line): calls, ok, success rate, average seconds (successful calls), average tries,
 * average text in/out, the models that answered, estimated cost of these calls and per 1,000 calls.
 */
function summarize(rows, prices) {
  const pin = Number(prices && prices.in) || 0, pout = Number(prices && prices.out) || 0;
  const priced = pin > 0 || pout > 0;
  const groups = new Map();
  const add = (k, r) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); };
  (rows || []).forEach((r) => { add(r.feature || 'other', r); add('__all', r); });
  const line = (feature, list) => {
    const ok = list.filter((r) => r.outcome === 'ok');
    const avg = (arr, f) => (arr.length ? arr.reduce((s, r) => s + (Number(f(r)) || 0), 0) / arr.length : null);
    const tin = list.reduce((s, r) => s + (Number(r.input_tokens) || 0), 0);
    const tout = list.reduce((s, r) => s + (Number(r.output_tokens) || 0), 0);
    const cost = priced ? (tin * pin + tout * pout) / 1e6 : null;
    const models = {};
    ok.forEach((r) => { const m = [r.provider, r.model].filter(Boolean).join(' / ') || 'unknown'; models[m] = (models[m] || 0) + 1; });
    return {
      feature,
      calls: list.length,
      ok: ok.length,
      success_rate: list.length ? ok.length / list.length : null,
      avg_seconds: avg(ok, (r) => r.ms) == null ? null : avg(ok, (r) => r.ms) / 1000,
      avg_tries: avg(list.filter((r) => r.tries > 0), (r) => r.tries),
      avg_input_tokens: avg(list, (r) => r.input_tokens),
      avg_output_tokens: avg(list, (r) => r.output_tokens),
      over_budget: list.filter((r) => r.outcome === 'over_budget').length,
      failed: list.filter((r) => r.outcome === 'failed').length,
      models: Object.keys(models).sort((a, b) => models[b] - models[a]).map((m) => ({ model: m, calls: models[m] })),
      est_cost: cost,
      est_cost_per_1000: priced && list.length ? (cost / list.length) * 1000 : null,
    };
  };
  const out = [...groups.keys()].filter((k) => k !== '__all').sort().map((k) => line(k, groups.get(k)));
  out.sort((a, b) => b.calls - a.calls);
  return { lines: out, all: line('All', groups.get('__all') || []), priced, retention_days: RETENTION_DAYS };
}

module.exports = { RETENTION_DAYS, OUTCOMES, buildRow, record, purge, summarize, _reset: () => { fallbackOrg = { id: process.env.DEFAULT_ORG_ID || null, looked: false }; } };
