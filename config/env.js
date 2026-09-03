// ============================================================================
// ENVIRONMENT CONFIGURATION
// ----------------------------------------------------------------------------
// Single place that reads process.env, validates it at startup, and hands the
// rest of the app a plain config object. Secrets and deployment settings live
// in environment variables (not the database, not source).
//
// Behaviour is intentionally preserved for existing deployments:
//   - Only the three variables the app genuinely cannot run without are
//     required (fail-fast). A running deployment already has them, so this only
//     turns a late, confusing runtime failure into a clear startup error.
//   - Optional integrations (Microsoft Graph, Anthropic) only warn.
//   - MICROSOFT_REDIRECT_URI is now read from the environment (guide item #2)
//     but falls back to the value that was previously hardcoded, so nothing
//     changes until an env var is set.
// ============================================================================

// Previously hardcoded in index.js; kept as the fallback so current behaviour
// is identical until MICROSOFT_REDIRECT_URI is set in the environment.
const DEFAULT_MICROSOFT_REDIRECT_URI = 'https://fute-lms-backend.onrender.com/auth/microsoft/callback';
// Protocol constant, not a per-deployment secret — safe to keep in code.
const MICROSOFT_SCOPES = 'Mail.Send Mail.ReadWrite OnlineMeetings.ReadWrite offline_access User.Read';

// Gmail / Google Workspace — same shape as Microsoft, fully OPTIONAL. Sending
// stays unavailable for Gmail mailboxes until these are set + Google approves
// the restricted scopes (gmail.send / gmail.modify). Never required at startup.
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://fute-lms-backend.onrender.com/auth/google/callback';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify', // read + label moves (spam rescue)
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadConfig() {
  const config = {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Required — the server cannot function without these.
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
    jwtSecret: required('JWT_SECRET'),

    // Optional integrations. Values are passed through unchanged (may be
    // undefined) so downstream behaviour is identical to reading process.env.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    microsoft: {
      tenantId: process.env.MICROSOFT_TENANT_ID,
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || DEFAULT_MICROSOFT_REDIRECT_URI,
      scopes: MICROSOFT_SCOPES,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || DEFAULT_GOOGLE_REDIRECT_URI,
      scopes: GOOGLE_SCOPES,
    },
  };

  // Surface (but do not fail on) missing optional configuration so operators
  // can see it in the logs instead of discovering it via a failing request.
  const warnings = [];
  if (!config.microsoft.tenantId || !config.microsoft.clientId || !config.microsoft.clientSecret) {
    warnings.push('Microsoft Graph not fully configured (MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET) — email send and OAuth will be unavailable.');
  }
  if (!process.env.MICROSOFT_REDIRECT_URI) {
    warnings.push(`MICROSOFT_REDIRECT_URI not set — defaulting to ${DEFAULT_MICROSOFT_REDIRECT_URI}`);
  }
  if (!config.anthropicApiKey && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OLLAMA_BASE_URL) {
    // Not a failure: every AI feature has a rules writer behind it. This says
    // which half of each feature is running, and that a free provider can be
    // switched on from Admin → Integrations without a redeploy.
    warnings.push('No AI provider set in the environment — AI features run on their rules fallback. Add a free provider (Groq / OpenRouter / Ollama) in Admin → Integrations.');
  }
  if (!config.google.clientId || !config.google.clientSecret) {
    warnings.push('Gmail not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — Gmail connect + send will be unavailable (Microsoft is unaffected).');
  }
  warnings.forEach((w) => console.warn('[config] ' + w));

  return config;
}

module.exports = { loadConfig, DEFAULT_MICROSOFT_REDIRECT_URI, MICROSOFT_SCOPES, DEFAULT_GOOGLE_REDIRECT_URI, GOOGLE_SCOPES };
