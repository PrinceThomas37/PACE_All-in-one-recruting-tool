// ============================================================================
// Pre-send email verification hook.
//
// verifyEmailAddress(supabase, address) asks the ADMIN-configured verifier
// (ZeroBounce / NeverBounce / Hunter — set in the Integrations page) whether an
// address is safe to mail, BEFORE the first send. Until a provider key is set it
// returns { result: 'unknown' } and is a pure no-op — so nothing changes today,
// and the moment a key is added the check goes live.
//
// Normalized result vocabulary:
//   'valid'   — deliverable, safe to send
//   'invalid' — undeliverable / do-not-mail — should be skipped + flagged
//   'risky'   — catch-all / accept-all — deliver, but lower confidence
//   'unknown' — no verifier configured, provider error, or provider unsure
// ============================================================================
const { emailSyntaxValid } = require('./email-validation');
const { getActiveVerifier } = require('./config/integrations');
const httpClient = require('./http-client');

// Thin adapter over the shared client, keeping this file's (url, ms, options)
// argument order so the provider adapters below are unchanged.
async function fetchJson(url, ms = 8000, options = {}) {
  return httpClient.fetchJson(url, options, { timeoutMs: ms });
}

// ── Provider adapters ────────────────────────────────────────────────────────
async function zeroBounce(key, email) {
  const { data } = await fetchJson(`https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`);
  const s = String(data.status || '').toLowerCase();
  const result = s === 'valid' ? 'valid'
    : s === 'catch-all' ? 'risky'
    : (s === 'invalid' || s === 'spamtrap' || s === 'abuse' || s === 'do_not_mail') ? 'invalid'
    : 'unknown';
  return { result, provider: 'zerobounce', detail: data.sub_status || s || null };
}
async function neverBounce(key, email) {
  const { data } = await fetchJson(`https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`);
  const s = String(data.result || '').toLowerCase();
  const result = s === 'valid' ? 'valid'
    : s === 'catchall' ? 'risky'
    : (s === 'invalid' || s === 'disposable') ? 'invalid'
    : 'unknown';
  return { result, provider: 'neverbounce', detail: s || null };
}
async function hunter(key, email) {
  const { data } = await fetchJson(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`);
  const d = data.data || {};
  const r = String(d.result || '').toLowerCase();
  const result = r === 'deliverable' ? 'valid'
    : r === 'risky' ? 'risky'
    : r === 'undeliverable' ? 'invalid'
    : 'unknown';
  return { result, provider: 'hunter', detail: d.status || r || null };
}

const ADAPTERS = { zerobounce: zeroBounce, neverbounce: neverBounce, hunter };

async function verifyEmailAddress(supabase, address) {
  if (!emailSyntaxValid(address)) return { result: 'invalid', provider: null, reason: 'syntax' };
  const active = await getActiveVerifier(supabase);
  if (!active) return { result: 'unknown', provider: null, reason: 'not_configured' };
  const adapter = ADAPTERS[active.id];
  if (!adapter) return { result: 'unknown', provider: active.id, reason: 'no_adapter' };
  try {
    return await adapter(active.key, address);
  } catch (e) {
    return { result: 'unknown', provider: active.id, reason: 'error', error: e.message };
  }
}

module.exports = { verifyEmailAddress, ADAPTERS };
