// ============================================================================
// AI PROVIDER LAYER — one door to every text-generation provider PACE can use.
//
// WHY THIS EXISTS
// Six features call an AI: cold-email drafting, the daily import briefing,
// resume parsing, job-description scrubbing, lead-distribution advice and the
// outreach generator. Each of them used to hold its own copy of Anthropic's
// URL, key header and model name, so "use a different provider" was not a
// setting — it was six edits. This file is the one place that knows how to
// talk to a provider; the features ask for text and get text.
//
// THE RULE THAT DOES NOT CHANGE: AI IS A SEAM, NEVER A REQUIREMENT.
// `complete()` returns null when nothing is configured or every provider
// fails. Every caller already has a rules-based writer behind that null and
// must keep it — the rules path is what runs in production today and is what
// runs the moment a free tier is withdrawn, rate-limited or renamed.
//
// WHY FREE TIERS ARE SAFE TO DEPEND ON *HERE* AND NOWHERE ELSE
// Groq, OpenRouter and a self-hosted Ollama are free but carry no commercial
// promise. Because they sit behind this seam, losing one costs a dropdown
// change and, until then, degrades to the rules output rather than an error.
//
// TWO WIRE FORMATS, NOT FOUR PROVIDERS
//   'anthropic' — x-api-key + {system, messages[]} + content[].text
//   'openai'    — Bearer + messages[] (system as a message) + choices[].message
// Groq, OpenRouter and Ollama all speak the second one, which is why adding
// them is one adapter and not three.
//
// WHAT IT COSTS IS DECIDED HERE, BEFORE THE CALL
// A free tier is a daily allowance, and the way to lose one is to send a
// user's pasted 30,000-character job page to the biggest model 40 times. So
// every call names its FEATURE, and services/ai-budget.js trims the input,
// caps the answer, picks the cheap model for extraction work, and refuses the
// call once the org's daily ceiling is reached. A refusal is the same null as
// "no provider" — the rules writer answers instead.
//
// The builders/parsers below are PURE (no network, no db, no clock) so the
// exact bytes we put on the wire for each provider are testable offline.
// ============================================================================

const { fetchWithTimeout } = require('../http-client');
const integrations = require('../config/integrations');
const budget = require('./ai-budget');

// AI generation is slower than a normal API call but must still be bounded —
// these run inside request handlers a browser is waiting on.
const AI_TIMEOUT_MS = 30000;

// Registry. `wire` picks the request/response shape; `model` is the default a
// deployment gets with no admin override. Order is the fallback order when no
// provider is explicitly chosen.
const PROVIDERS = {
  anthropic: {
    id: 'anthropic', label: 'Anthropic (Claude)', wire: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    // Extraction does not need the big model; prose the customer's prospect
    // will read does. One tier down is typically ~10x cheaper per token.
    models: { fast: 'claude-haiku-4-5-20251001', quality: 'claude-sonnet-4-20250514' },
  },
  groq: {
    id: 'groq', label: 'Groq', wire: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    models: { fast: 'llama-3.1-8b-instant', quality: 'llama-3.3-70b-versatile' },
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', wire: 'openai',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    models: { fast: 'meta-llama/llama-3.2-3b-instruct:free', quality: 'meta-llama/llama-3.3-70b-instruct:free' },
  },
  ollama: {
    id: 'ollama', label: 'Ollama (self-hosted)', wire: 'openai',
    // No hosted URL: the operator's own machine is the endpoint, so base_url
    // is what turns this provider on. Keyless by design — a local server has
    // no account to authenticate against.
    url: null, keyless: true,
    model: 'llama3.1:8b',
    // A self-hosted box has no allowance to spend, so both tiers are whatever
    // the operator pulled. Tiering here would just fail on a model they do
    // not have.
    models: { fast: 'llama3.1:8b', quality: 'llama3.1:8b' },
  },
};

// Registry order = fallback order. Anthropic first only because a deployment
// that has paid for it should not silently prefer a free tier; the admin's
// explicit choice overrides this entirely.
const PROVIDER_ORDER = ['anthropic', 'groq', 'openrouter', 'ollama'];

// Ollama's base_url is given as a server root ("http://localhost:11434"); the
// OpenAI-compatible path is appended here so an operator never has to know it.
function endpointFor(def, baseUrl) {
  if (def.url) return def.url;
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!root) return null;
  return /\/v1(\/|$)/.test(root) ? `${root.replace(/\/v1$/, '')}/v1/chat/completions`
                                 : `${root}/v1/chat/completions`;
}

// PURE. Returns { url, options } ready for fetch, or null if the provider
// cannot be reached with what it was given.
function buildRequest(providerId, opts = {}) {
  const def = PROVIDERS[providerId];
  if (!def) return null;
  const key = opts.key || null;
  if (!def.keyless && !key) return null;
  const url = endpointFor(def, opts.baseUrl);
  if (!url) return null;

  const model = opts.model || def.model;
  const maxTokens = opts.maxTokens || 800;
  const system = opts.system || null;
  const prompt = String(opts.prompt || '');

  if (def.wire === 'anthropic') {
    const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    if (system) body.system = system;
    return {
      url,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      },
    };
  }

  // OpenAI-compatible: the system prompt is the first message, not a field.
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  // OpenRouter asks callers to identify themselves; it is optional but keeps
  // the request off their anonymous-traffic rate limits.
  if (providerId === 'openrouter') headers['X-Title'] = 'PACE';
  return {
    url,
    options: { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: maxTokens, messages }) },
  };
}

// PURE. Pulls the text out of either wire format. Returns { text, usage } or
// null when the payload carries no usable text (an error body, a refusal, a
// truncated stream) — null is the caller's signal to try the next provider.
function parseResponse(providerId, data) {
  const def = PROVIDERS[providerId];
  if (!def || !data || typeof data !== 'object') return null;

  if (def.wire === 'anthropic') {
    const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return null;
    const u = data.usage || {};
    return { text, usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 } };
  }

  const msg = data.choices && data.choices[0] && data.choices[0].message;
  const text = String((msg && msg.content) || '').trim();
  if (!text) return null;
  const u = data.usage || {};
  return { text, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } };
}

// ── Configuration (async: keys live in app_settings, with env fallback) ──────

// The providers that are actually usable right now, in the order to try them:
// the admin's chosen provider first, then the rest of the registry order.
async function resolveChain(supabase) {
  if (!supabase) return [];
  let active = null;
  try { active = await integrations.getActiveAi(supabase); } catch (_) {}
  const order = active && PROVIDERS[active]
    ? [active, ...PROVIDER_ORDER.filter(id => id !== active)]
    : PROVIDER_ORDER.slice();

  const chain = [];
  for (const id of order) {
    const def = PROVIDERS[id];
    const key = def.keyless ? null : await integrations.getSecret(supabase, id, 'api_key');
    const baseUrl = def.url ? null : await integrations.getSecret(supabase, id, 'base_url');
    // A placeholder left in an env var is not configuration.
    if (!def.keyless && (!key || /^your_.*_here$/i.test(key))) continue;
    if (!def.url && !baseUrl) continue;
    // An admin-typed model is an OVERRIDE, kept distinct from the default so
    // the per-feature tiering below can tell "they chose this" from "nobody
    // chose anything".
    const model = await integrations.getSecret(supabase, id, 'model');
    chain.push({ id, key, baseUrl, model_override: model || null, model: model || def.model });
  }
  return chain;
}

async function isAvailable(supabase) {
  return (await resolveChain(supabase)).length > 0;
}

// Which model this provider should use for this kind of work. An admin's
// explicit model override wins outright — they typed it, they meant it — and
// otherwise the feature's tier picks between the provider's fast and quality
// models.
function modelFor(entry, tier) {
  if (entry.model_override) return entry.model_override;
  const def = PROVIDERS[entry.id];
  return (def.models && def.models[tier]) || entry.model || def.model;
}

// Ask for text. Returns { text, usage, provider, model } or NULL — and null is
// an ordinary outcome, not an error: it means "write it with the rules".
//
// Callers pass `feature` (a key of ai-budget's FEATURES) and `orgId`. Both are
// optional and both should be given: without a feature the call gets the
// smallest allowance rather than an unlimited one, and without an org the
// spend lands on the default meter.
//
// A provider that fails (bad key, rate limit, timeout, unparseable body) is
// skipped and the next one tried, because a daily free-tier ceiling is the
// expected failure here, not the exceptional one.
async function complete(supabase, opts = {}) {
  const chain = await resolveChain(supabase);
  if (!chain.length) return null;

  // 1. What may this feature send, and how long an answer may it ask for?
  const limits = budget.featureLimits(opts.feature);
  const system = opts.system ? budget.trimToTokens(opts.system, limits.in) : null;
  const prompt = budget.trimToTokens(opts.prompt, limits.in);
  const maxTokens = Math.min(opts.maxTokens || limits.out, limits.out);

  // 2. Would this call fit inside what is left of today? Estimated high, on
  //    purpose: input plus the longest answer the request permits.
  const estimated = budget.estimateTokens(system) + budget.estimateTokens(prompt) + maxTokens;
  const spent = await budget.getSpend(supabase, opts.orgId);
  const verdict = budget.checkBudget(spent, estimated, await budget.getCaps(supabase));
  if (!verdict.allowed) {
    // Not an error, and not a provider problem: today's allowance is spent, so
    // the feature writes with its rules until tomorrow.
    console.warn(`[ai] ${opts.feature || 'other'} skipped — ${verdict.reason} (used ${verdict.used} of ${verdict.cap})`);
    return null;
  }

  for (const entry of chain) {
    const model = opts.model || modelFor(entry, limits.tier);
    const req = buildRequest(entry.id, {
      key: entry.key, baseUrl: entry.baseUrl, model,
      system, prompt, maxTokens,
    });
    if (!req) continue;
    try {
      const response = await fetchWithTimeout(req.url, req.options, { timeoutMs: opts.timeoutMs || AI_TIMEOUT_MS });
      if (!response.ok) throw new Error('ai_http_' + response.status);
      const parsed = parseResponse(entry.id, await response.json());
      if (!parsed) throw new Error('ai_unparseable');
      // Charge the meter with what the provider actually billed, falling back
      // to the estimate when it reports nothing — never to zero, or a provider
      // that omits usage would be free forever.
      const actual = (parsed.usage.input_tokens + parsed.usage.output_tokens) || estimated;
      await budget.recordSpend(supabase, opts.orgId, opts.feature, actual);
      return { ...parsed, provider: entry.id, model, tier: limits.tier, budget_remaining: verdict.remaining_tokens };
    } catch (err) {
      // Never fatal: the loop moves on, and an empty loop means rules output.
      console.warn(`[ai] ${entry.id} failed (${err.message}) — trying next provider`);
    }
  }
  return null;
}

module.exports = {
  PROVIDERS, PROVIDER_ORDER, AI_TIMEOUT_MS,
  buildRequest, parseResponse, endpointFor, modelFor,
  resolveChain, isAvailable, complete,
  budget,
};
