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
//   - WHOSE KEY (R-067, D-0055): every key belongs to ONE organisation. It is stored under
//     "int_<id>_<field>__org_<orgId>" and read only for that organisation. The keys that existed
//     before this (no suffix) and the env-var fallbacks belong to the deployment's FIRST
//     organisation (the founding customer) and to nobody else: another organisation with no key of
//     its own gets NOTHING, never someone else's. A caller that names no organisation is served
//     the old keys only while the deployment has a single organisation.
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
      { key: 'model', label: 'Model (optional)', placeholder: "Leave blank for PACE's default", secret: false, optional: true },
    ],
    env_fallback: { api_key: 'GROQ_API_KEY' }, test: 'groq',
  },
  {
    id: 'openrouter', category: 'AI', label: 'OpenRouter (free tier)', ai: true,
    description: 'One key across dozens of open models, several of them free. Useful as a fallback when another free tier is spent.',
    docs: 'https://openrouter.ai/keys',
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'sk-or-…' },
      { key: 'model', label: 'Model (optional)', placeholder: "Leave blank for PACE's default", secret: false, optional: true },
    ],
    env_fallback: { api_key: 'OPENROUTER_API_KEY' }, test: 'openrouter',
  },
  {
    id: 'ollama', category: 'AI', label: 'Ollama (self-hosted)', ai: true,
    description: 'An open model running on a server you control. No key, no per-token cost, and no candidate data leaves your network — but the server must be reachable from PACE.',
    docs: 'https://ollama.com/download',
    fields: [
      { key: 'base_url', label: 'Server address', placeholder: 'http://localhost:11434', secret: false },
      { key: 'model', label: 'Model (optional)', placeholder: "Leave blank for PACE's default", secret: false, optional: true },
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
    description: 'Finds the people to reach on a lead — Search contact, the title search and Uncover in the POC finder — and a company\'s size. Needs a plan with API access and a master API key. Searching is free; each person uncovered or company sized costs one credit, capped per day below.',
    docs: 'https://docs.apollo.io/docs/create-api-key',
    fields: [{ key: 'api_key', label: 'API key' }], test: 'apollo',
  },
];

const BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));
const keyName = (id, field) => `${PREFIX}${id}_${field}`;
const mask = (v) => (v ? '••••••' + String(v).slice(-4) : null);
const orgField = (id, field, orgId) => `${keyName(id, field)}__org_${orgId}`;
const suffixed = (key, orgId) => (orgId ? `${key}__org_${orgId}` : key);

// ── whose is the un-suffixed key? ─────────────────────────────────────────────────────────────────────────────
// The founding organisation (oldest row, or DEFAULT_ORG_ID) inherits every key that was stored before keys had
// owners. Resolved lazily and remembered; a failed lookup is NOT remembered, and until it succeeds nobody
// inherits (a key withheld for a moment is better than a key handed to the wrong company).
let legacy = { id: process.env.DEFAULT_ORG_ID || null, multi: null };
async function loadOrgFacts(supabase) {
  if (legacy.id && legacy.multi !== null) return legacy;
  try {
    const { data } = await supabase.from('organizations').select('id').order('created_at', { ascending: true }).limit(2);
    if (Array.isArray(data)) {
      if (!legacy.id && data[0]) legacy.id = data[0].id;
      legacy.multi = data.length > 1;
    }
  } catch (_) { /* organizations table absent — a single-tenant database */ if (legacy.multi === null) legacy.multi = false; }
  return legacy;
}
function noteOrgCreated() { legacy.multi = true; }
function _resetForTests(over) { legacy = Object.assign({ id: process.env.DEFAULT_ORG_ID || null, multi: null }, over || {}); }

// Who is asking, and which keys are theirs: { org, inherits }.
//   org      — the organisation whose own keys are read/written (null: none named)
//   inherits — may this caller fall back to the pre-ownership keys and the env vars?
async function scopeFor(supabase, orgId) {
  const f = await loadOrgFacts(supabase);
  // One organisation on the whole deployment: the older keys can only be that organisation's, whichever id the caller carries.
  if (orgId) return { org: orgId, inherits: f.multi === false || (!!f.id && orgId === f.id) };
  return { org: null, inherits: f.multi === false };
}

async function readKey(supabase, key) {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    return (data && data.value) || null;
  } catch (_) { return null; }
}

// Real secret for server-side use: the organisation's own value first, then (founding organisation only) the
// older un-suffixed value, then the env fallback.
async function getSecret(supabase, id, field = 'api_key', orgId = null) {
  const def = BY_ID.get(id);
  if (!def) return null;
  const sc = await scopeFor(supabase, orgId);
  if (sc.org) { const own = await readKey(supabase, orgField(id, field, sc.org)); if (own) return own; }
  if (!sc.inherits) return null;
  const old = await readKey(supabase, keyName(id, field));
  if (old) return old;
  const envVar = def.env_fallback && def.env_fallback[field];
  return envVar ? (process.env[envVar] || null) : null;
}

async function isConfigured(supabase, id, orgId = null) {
  const def = BY_ID.get(id);
  if (!def) return false;
  for (const f of def.fields) {
    if (f.optional) continue;
    const v = await getSecret(supabase, id, f.key, orgId);
    if (!v) return false;
  }
  return true;
}

// Registry + masked status for the admin UI. Never returns raw secrets. Shows ONLY the asking organisation's keys.
async function getAll(supabase, orgId = null) {
  const sc = await scopeFor(supabase, orgId);
  const wanted = [];
  INTEGRATIONS.forEach((def) => def.fields.forEach((f) => {
    if (sc.org) wanted.push(orgField(def.id, f.key, sc.org));
    if (sc.inherits) wanted.push(keyName(def.id, f.key));
  }));
  wanted.push(suffixed(ACTIVE_VERIFIER_KEY, sc.org), suffixed(ACTIVE_AI_KEY, sc.org));
  if (sc.inherits) wanted.push(ACTIVE_VERIFIER_KEY, ACTIVE_AI_KEY);
  let rows = [];
  try {
    const { data } = await supabase.from('app_settings').select('key,value').in('key', wanted);
    rows = data || [];
  } catch (_) {}
  const stored = {}; rows.forEach((r) => { stored[r.key] = r.value; });
  const pick = (id, field) => (sc.org && stored[orgField(id, field, sc.org)]) || (sc.inherits ? stored[keyName(id, field)] : undefined);
  const activeVerifier = (sc.org && stored[suffixed(ACTIVE_VERIFIER_KEY, sc.org)]) || (sc.inherits ? stored[ACTIVE_VERIFIER_KEY] : null) || null;
  const activeAi = (sc.org && stored[suffixed(ACTIVE_AI_KEY, sc.org)]) || (sc.inherits ? stored[ACTIVE_AI_KEY] : null) || null;

  const items = INTEGRATIONS.map((def) => {
    const fields = def.fields.map((f) => {
      const raw = pick(def.id, f.key);
      const envVar = def.env_fallback && def.env_fallback[f.key];
      const fromEnv = !raw && sc.inherits && envVar && !!process.env[envVar];
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

// Where a write goes: the organisation's own key. A caller that names no organisation writes the old key, but only on a
// single-organisation deployment — with several, "which company's key is this?" has no answer, so the write is refused.
async function writeScope(supabase, orgId) {
  const sc = await scopeFor(supabase, orgId);
  if (!sc.org && !sc.inherits) return { error: 'No organisation named for this key' };
  return sc;
}
async function deleteKeys(supabase, keys) {
  for (const k of keys) { try { await supabase.from('app_settings').delete().eq('key', k); } catch (_) {} }
}

// Save fields for one integration. Empty string clears (disconnects) that field.
async function setIntegration(supabase, id, values, orgId = null) {
  const def = BY_ID.get(id);
  if (!def) return { error: `Unknown integration "${id}"` };
  const sc = await writeScope(supabase, orgId);
  if (sc.error) return sc;
  const valid = new Set(def.fields.map((f) => f.key));
  const upserts = []; const deletes = [];
  for (const [k, v] of Object.entries(values || {})) {
    if (!valid.has(k)) continue;
    const key = sc.org ? orgField(id, k, sc.org) : keyName(id, k);
    if (v === '' || v === null) {
      deletes.push(key);
      if (sc.org && sc.inherits) deletes.push(keyName(id, k));   // the founding organisation's "clear" must clear the older key too
    } else upserts.push({ key, value: String(v), updated_at: new Date() });
  }
  if (upserts.length) { const { error } = await supabase.from('app_settings').upsert(upserts, { onConflict: 'key' }); if (error) return { error: error.message }; }
  await deleteKeys(supabase, deletes);
  return { success: true };
}

async function clearIntegration(supabase, id, orgId = null) {
  const def = BY_ID.get(id);
  if (!def) return { error: `Unknown integration "${id}"` };
  const sc = await writeScope(supabase, orgId);
  if (sc.error) return sc;
  const keys = [];
  for (const f of def.fields) {
    if (sc.org) keys.push(orgField(id, f.key, sc.org));
    if (sc.inherits) keys.push(keyName(id, f.key));
  }
  await deleteKeys(supabase, keys);
  return { success: true };
}

async function setActive(supabase, baseKey, id, orgId) {
  const sc = await writeScope(supabase, orgId);
  if (sc.error) return sc;
  const key = suffixed(baseKey, sc.org);
  if (!id) { await deleteKeys(supabase, sc.org && sc.inherits ? [key, baseKey] : [key]); return { success: true }; }
  const { error } = await supabase.from('app_settings').upsert({ key, value: id, updated_at: new Date() }, { onConflict: 'key' });
  return error ? { error: error.message } : { success: true };
}
async function readActive(supabase, baseKey, orgId) {
  const sc = await scopeFor(supabase, orgId);
  if (sc.org) { const own = await readKey(supabase, suffixed(baseKey, sc.org)); if (own) return own; }
  return sc.inherits ? readKey(supabase, baseKey) : null;
}

async function setActiveVerifier(supabase, id, orgId = null) {
  const def = id ? BY_ID.get(id) : null;
  if (id && (!def || !def.verifier)) return { error: 'Not an email-verification provider' };
  return setActive(supabase, ACTIVE_VERIFIER_KEY, id, orgId);
}

// The AI provider the features should prefer. Only a *choice* is stored here —
// whether it is usable (key present, server reachable) is decided at call time
// by services/ai-provider.js, so choosing a provider and then losing its key
// degrades to the next one rather than turning AI off.
async function setActiveAi(supabase, id, orgId = null) {
  const def = id ? BY_ID.get(id) : null;
  if (id && (!def || !def.ai)) return { error: 'Not an AI provider' };
  return setActive(supabase, ACTIVE_AI_KEY, id, orgId);
}

async function getActiveAi(supabase, orgId = null) {
  return readActive(supabase, ACTIVE_AI_KEY, orgId);
}

// The verifier the send-time hook should use: the explicitly-active one if its
// key is set, else the first configured verifier. Returns { id, key } or null.
async function getActiveVerifier(supabase, orgId = null) {
  const activeId = await readActive(supabase, ACTIVE_VERIFIER_KEY, orgId);
  const order = activeId ? [activeId, ...INTEGRATIONS.filter((i) => i.verifier && i.id !== activeId).map((i) => i.id)]
                         : INTEGRATIONS.filter((i) => i.verifier).map((i) => i.id);
  for (const id of order) {
    const def = BY_ID.get(id);
    if (!def || !def.verifier) continue;
    const key = await getSecret(supabase, id, 'api_key', orgId);
    if (key) return { id, key };
  }
  return null;
}

// ── a key that belongs to ONE ORGANISATION (D-0099) ──────────────────────────────────────────────────────────
// Since R-067 every key above is per organisation too; this pair is the older, stricter form for a key that must NEVER be inherited
// (not even by the founding organisation): a free-job-source key is bought on the organisation's own plan and its allowance is that organisation's alone, so it lives under "int_<id>_api_key__org_<orgId>" and
// is only ever read for the organisation asking. Reads for the browser are masked, like every other secret here.
const orgKeyName = (id, orgId) => `${PREFIX}${id}_api_key__org_${orgId}`;
async function getOrgSecret(supabase, id, orgId) {
  if (!orgId) return null;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', orgKeyName(id, orgId)).maybeSingle();
    return (data && data.value) || null;
  } catch (_) { return null; }
}
async function setOrgSecret(supabase, id, orgId, value) {
  const v = String(value || '').trim();
  if (!orgId) return { error: 'No organisation' };
  if (!v) { try { await supabase.from('app_settings').delete().eq('key', orgKeyName(id, orgId)); } catch (_) {} return { success: true, cleared: true }; }
  const { error } = await supabase.from('app_settings').upsert({ key: orgKeyName(id, orgId), value: v, updated_at: new Date() }, { onConflict: 'key' });
  return error ? { error: error.message } : { success: true };
}
const orgMask = mask;

module.exports = {
  INTEGRATIONS, BY_ID, keyName,
  getSecret, isConfigured, getAll, setIntegration, clearIntegration,
  setActiveVerifier, getActiveVerifier,
  setActiveAi, getActiveAi,
  orgKeyName, getOrgSecret, setOrgSecret, orgMask,
  noteOrgCreated, scopeFor, _resetForTests,
};
