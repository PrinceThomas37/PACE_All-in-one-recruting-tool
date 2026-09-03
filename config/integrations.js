// ============================================================================
// EXTERNAL INTEGRATIONS — API keys managed from the admin UI.
//
// A registry of third-party providers (AI, email verification, contact
// databases, …) and a small store on top of app_settings, so an admin can paste
// a key in the UI and the backend hook picks it up — no redeploy, no env var.
//
// Security posture:
//   - Keys live in app_settings under "int_<id>_<field>" (same store the app
//     already uses for config). Admin-only read/write at the route layer.
//   - Reads for the UI are ALWAYS masked (never return a stored secret to the
//     browser) — the UI shows "configured" + a masked hint, not the value.
//   - getSecret() returns the real value for SERVER-SIDE use only.
//   - Anthropic falls back to the ANTHROPIC_API_KEY env var if no UI key is set,
//     so nothing that works today breaks.
// (Hardening note: values are stored as-is, like the rest of app_settings. A
//  future pass could encrypt-at-rest behind a KMS; out of scope here.)
// ============================================================================

const PREFIX = 'int_';
const ACTIVE_VERIFIER_KEY = 'int_email_verify_active';
const ACTIVE_AI_KEY = 'int_ai_active';

// Registry. `test` names a provider-specific connection test (routes/integrations
// implements them); `env_fallback` lets a value come from an env var if unset.
//
// FIELD FLAGS
//   secret:false  — not a credential (a model name, a server address). Shown in
//                   the admin UI as plain text, and returned unmasked, because
//                   masking a value the operator has to be able to read is just
//                   a way to lose it.
//   optional:true — does not count towards "configured". A model override is a
//                   preference; the key is the connection.
//
// `ai:true` marks a text-generation provider that services/ai-provider.js can
// use. Exactly one is the ACTIVE one (ACTIVE_AI_KEY); the others stay as
// fallbacks, which is what makes a free tier safe to rely on.
const INTEGRATIONS = [
  {
    id: 'anthropic', category: 'AI', label: 'Anthropic (Claude)', ai: true,
    description: 'Paid, highest quality. Powers AI email drafting, resume parsing and summaries.',
    docs: 'https://console.anthropic.com/settings/keys',
    fields: [{ key: 'api_key', label: 'API key', placeholder: 'sk-ant-…' }],
    env_fallback: { api_key: 'ANTHROPIC_API_KEY' }, test: 'anthropic',
  },
  {
    id: 'groq', category: 'AI', label: 'Groq (free tier)', ai: true,
    description: 'Free, fast, no credit card. Runs open models (Llama, Qwen, gpt-oss) on Groq hardware.',
    docs: 'https://console.groq.com/keys',
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'gsk_…' },
      { key: 'model', label: 'Model (optional)', placeholder: 'llama-3.3-70b-versatile', secret: false, optional: true },
    ],
    env_fallback: { api_key: 'GROQ_API_KEY' }, test: 'groq',
  },
  {
    id: 'openrouter', category: 'AI', label: 'OpenRouter (free tier)', ai: true,
    description: 'One key across dozens of open models, several of them free. Useful as a fallback when another free tier is spent.',
    docs: 'https://openrouter.ai/keys',
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'sk-or-…' },
      { key: 'model', label: 'Model (optional)', placeholder: 'meta-llama/llama-3.3-70b-instruct:free', secret: false, optional: true },
    ],
    env_fallback: { api_key: 'OPENROUTER_API_KEY' }, test: 'openrouter',
  },
  {
    id: 'ollama', category: 'AI', label: 'Ollama (self-hosted)', ai: true,
    description: 'An open model running on a server you control. No key, no per-token cost, and no candidate data leaves your network — but the server must be reachable from PACE.',
    docs: 'https://ollama.com/download',
    fields: [
      { key: 'base_url', label: 'Server address', placeholder: 'http://localhost:11434', secret: false },
      { key: 'model', label: 'Model (optional)', placeholder: 'llama3.1:8b', secret: false, optional: true },
    ],
    env_fallback: { base_url: 'OLLAMA_BASE_URL' }, test: 'ollama',
  },
  {
    id: 'zerobounce', category: 'Email verification', label: 'ZeroBounce',
    description: 'Verify an address before the first send, so dead inboxes never get mailed.',
    docs: 'https://www.zerobounce.net/members/api/', verifier: true,
    fields: [{ key: 'api_key', label: 'API key' }], test: 'zerobounce',
  },
  {
    id: 'neverbounce', category: 'Email verification', label: 'NeverBounce',
    description: 'Alternative pre-send email verifier.',
    docs: 'https://developers.neverbounce.com/', verifier: true,
    fields: [{ key: 'api_key', label: 'API key' }], test: 'neverbounce',
  },
  {
    id: 'hunter', category: 'Contact database', label: 'Hunter.io',
    description: 'Find and verify work emails by domain. Can also act as an email verifier.',
    docs: 'https://hunter.io/api-keys', verifier: true,
    fields: [{ key: 'api_key', label: 'API key' }], test: 'hunter',
  },
  {
    id: 'apollo', category: 'Contact database', label: 'Apollo.io',
    description: 'Find POC contacts + emails and enrich companies (used by the future auto-sourcing engine).',
    docs: 'https://apolloio.github.io/apollo-api-docs/',
    fields: [{ key: 'api_key', label: 'API key' }], test: 'apollo',
  },
];

const BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));
const keyName = (id, field) => `${PREFIX}${id}_${field}`;
const mask = (v) => (v ? '••••••' + String(v).slice(-4) : null);

// Real secret for server-side use: stored value first, then env fallback.
async function getSecret(supabase, id, field = 'api_key') {
  const def = BY_ID.get(id);
  if (!def) return null;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', keyName(id, field)).maybeSingle();
    if (data && data.value) return data.value;
  } catch (_) {}
  const envVar = def.env_fallback && def.env_fallback[field];
  return envVar ? (process.env[envVar] || null) : null;
}

async function isConfigured(supabase, id) {
  const def = BY_ID.get(id);
  if (!def) return false;
  for (const f of def.fields) {
    if (f.optional) continue;
    const v = await getSecret(supabase, id, f.key);
    if (!v) return false;
  }
  return true;
}

// Registry + masked status for the admin UI. Never returns raw secrets.
async function getAll(supabase) {
  let rows = [];
  try {
    const { data } = await supabase.from('app_settings').select('key,value').ilike('key', `${PREFIX}%`);
    rows = data || [];
  } catch (_) {}
  const stored = {}; rows.forEach((r) => { stored[r.key] = r.value; });
  const activeVerifier = stored[ACTIVE_VERIFIER_KEY] || null;
  const activeAi = stored[ACTIVE_AI_KEY] || null;

  const items = INTEGRATIONS.map((def) => {
    const fields = def.fields.map((f) => {
      const raw = stored[keyName(def.id, f.key)];
      const envVar = def.env_fallback && def.env_fallback[f.key];
      const fromEnv = !raw && envVar && !!process.env[envVar];
      const isSecret = f.secret !== false;
      return {
        ...f,
        configured: !!raw || fromEnv,
        // A non-secret value is handed back as-is: the operator needs to see
        // which model or server is in force to be able to change it.
        hint: raw ? (isSecret ? mask(raw) : raw) : (fromEnv ? 'set via environment' : null),
        value: (!isSecret && raw) ? raw : null,
        secret: isSecret,
        from_env: fromEnv,
      };
    });
    return {
      id: def.id, category: def.category, label: def.label, description: def.description,
      docs: def.docs, verifier: !!def.verifier, ai: !!def.ai, has_test: !!def.test,
      fields, configured: fields.every((f) => f.optional || f.configured),
      active_verifier: def.verifier ? (activeVerifier === def.id) : undefined,
      active_ai: def.ai ? (activeAi === def.id) : undefined,
    };
  });

  // group by category, preserving registry order
  const order = []; const groups = {};
  items.forEach((it) => { if (!groups[it.category]) { groups[it.category] = []; order.push(it.category); } groups[it.category].push(it); });
  return { categories: order.map((c) => ({ category: c, items: groups[c] })), active_verifier: activeVerifier, active_ai: activeAi };
}

// Save fields for one integration. Empty string clears (disconnects) that field.
async function setIntegration(supabase, id, values) {
  const def = BY_ID.get(id);
  if (!def) return { error: `Unknown integration "${id}"` };
  const valid = new Set(def.fields.map((f) => f.key));
  const upserts = []; const deletes = [];
  for (const [k, v] of Object.entries(values || {})) {
    if (!valid.has(k)) continue;
    if (v === '' || v === null) deletes.push(keyName(id, k));
    else upserts.push({ key: keyName(id, k), value: String(v), updated_at: new Date() });
  }
  if (upserts.length) { const { error } = await supabase.from('app_settings').upsert(upserts, { onConflict: 'key' }); if (error) return { error: error.message }; }
  for (const k of deletes) { try { await supabase.from('app_settings').delete().eq('key', k); } catch (_) {} }
  return { success: true };
}

async function clearIntegration(supabase, id) {
  const def = BY_ID.get(id);
  if (!def) return { error: `Unknown integration "${id}"` };
  for (const f of def.fields) { try { await supabase.from('app_settings').delete().eq('key', keyName(id, f.key)); } catch (_) {} }
  return { success: true };
}

async function setActiveVerifier(supabase, id) {
  const def = id ? BY_ID.get(id) : null;
  if (id && (!def || !def.verifier)) return { error: 'Not an email-verification provider' };
  if (!id) { try { await supabase.from('app_settings').delete().eq('key', ACTIVE_VERIFIER_KEY); } catch (_) {} return { success: true }; }
  const { error } = await supabase.from('app_settings').upsert({ key: ACTIVE_VERIFIER_KEY, value: id, updated_at: new Date() }, { onConflict: 'key' });
  return error ? { error: error.message } : { success: true };
}

// The AI provider the features should prefer. Only a *choice* is stored here —
// whether it is usable (key present, server reachable) is decided at call time
// by services/ai-provider.js, so choosing a provider and then losing its key
// degrades to the next one rather than turning AI off.
async function setActiveAi(supabase, id) {
  const def = id ? BY_ID.get(id) : null;
  if (id && (!def || !def.ai)) return { error: 'Not an AI provider' };
  if (!id) { try { await supabase.from('app_settings').delete().eq('key', ACTIVE_AI_KEY); } catch (_) {} return { success: true }; }
  const { error } = await supabase.from('app_settings').upsert({ key: ACTIVE_AI_KEY, value: id, updated_at: new Date() }, { onConflict: 'key' });
  return error ? { error: error.message } : { success: true };
}

async function getActiveAi(supabase) {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', ACTIVE_AI_KEY).maybeSingle();
    return data?.value || null;
  } catch (_) { return null; }
}

// The verifier the send-time hook should use: the explicitly-active one if its
// key is set, else the first configured verifier. Returns { id, key } or null.
async function getActiveVerifier(supabase) {
  let activeId = null;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', ACTIVE_VERIFIER_KEY).maybeSingle();
    activeId = data?.value || null;
  } catch (_) {}
  const order = activeId ? [activeId, ...INTEGRATIONS.filter((i) => i.verifier && i.id !== activeId).map((i) => i.id)]
                         : INTEGRATIONS.filter((i) => i.verifier).map((i) => i.id);
  for (const id of order) {
    const def = BY_ID.get(id);
    if (!def || !def.verifier) continue;
    const key = await getSecret(supabase, id, 'api_key');
    if (key) return { id, key };
  }
  return null;
}

module.exports = {
  INTEGRATIONS, BY_ID, keyName,
  getSecret, isConfigured, getAll, setIntegration, clearIntegration,
  setActiveVerifier, getActiveVerifier,
  setActiveAi, getActiveAi,
};
