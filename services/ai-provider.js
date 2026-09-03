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
// The builders/parsers below are PURE (no network, no db, no clock) so the
// exact bytes we put on the wire for each provider are testable offline.
// ============================================================================

const { fetchWithTimeout } = require('../http-client');
const integrations = require('../config/integrations');

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
  },
  groq: {
    id: 'groq', label: 'Groq', wire: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', wire: 'openai',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  ollama: {
    id: 'ollama', label: 'Ollama (self-hosted)', wire: 'openai',
    // No hosted URL: the operator's own machine is the endpoint, so base_url
    // is what turns this provider on. Keyless by design — a local server has
    // no account to authenticate against.
    url: null, keyless: true,
    model: 'llama3.1:8b',
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
    const model = await integrations.getSecret(supabase, id, 'model');
    chain.push({ id, key, baseUrl, model: model || def.model });
  }
  return chain;
}

async function isAvailable(supabase) {
  return (await resolveChain(supabase)).length > 0;
}

// Ask for text. Returns { text, usage, provider, model } or NULL — and null is
// an ordinary outcome, not an error: it means "write it with the rules".
//
// A provider that fails (bad key, rate limit, timeout, unparseable body) is
// skipped and the next one tried, because a daily free-tier ceiling is the
// expected failure here, not the exceptional one.
async function complete(supabase, opts = {}) {
  const chain = await resolveChain(supabase);
  for (const entry of chain) {
    const req = buildRequest(entry.id, {
      key: entry.key, baseUrl: entry.baseUrl,
      model: opts.model || entry.model,
      system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens,
    });
    if (!req) continue;
    try {
      const response = await fetchWithTimeout(req.url, req.options, { timeoutMs: opts.timeoutMs || AI_TIMEOUT_MS });
      if (!response.ok) throw new Error('ai_http_' + response.status);
      const parsed = parseResponse(entry.id, await response.json());
      if (!parsed) throw new Error('ai_unparseable');
      return { ...parsed, provider: entry.id, model: opts.model || entry.model };
    } catch (err) {
      // Never fatal: the loop moves on, and an empty loop means rules output.
      console.warn(`[ai] ${entry.id} failed (${err.message}) — trying next provider`);
    }
  }
  return null;
}

module.exports = {
  PROVIDERS, PROVIDER_ORDER, AI_TIMEOUT_MS,
  buildRequest, parseResponse, endpointFor,
  resolveChain, isAvailable, complete,
};
