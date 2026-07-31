// ============================================================================
// MAILBOX SIGN-IN HEALTH — shared helper
// ----------------------------------------------------------------------------
// Sending mail through Microsoft/Google needs a live OAuth connection per
// mailbox: a short-lived access token the server silently refreshes ~hourly
// using a longer-lived refresh token. When that refresh starts failing (an
// expired app client secret, a revoked/again-consented account, a password
// reset…), sends fail — but until now that only surfaced when someone tried to
// send. This module derives a per-mailbox connection status so the UI can show
// it up front (green "Connected" vs red "Sign-in expired — reconnect").
//
// Works WITH or WITHOUT the migration that adds richer error columns
// (last_refresh_at / last_refresh_error / refresh_failed): if those columns are
// present they're authoritative; otherwise the status is inferred from the
// existing expires_at / updated_at timestamps.
// ============================================================================

// A healthy mailbox refreshes a few minutes BEFORE the access token expires, so
// its expires_at is always in the (near) future. An access token that expired
// well over an hour ago with nothing newer means the refresh loop is failing.
const STALE_MS = 90 * 60 * 1000;

function deriveTokenStatus(row) {
  if (!row) return { connected: false, status: 'none', platform: null };
  const now = Date.now();
  const expMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  let status;
  if (row.refresh_failed === true) status = 'expired';        // authoritative (post-migration)
  else if (row.refresh_failed === false) status = 'ok';
  else status = (expMs && expMs < now - STALE_MS) ? 'expired' : 'ok'; // heuristic (pre-migration)
  return {
    connected: true,
    status,
    expires_at: row.expires_at || null,
    last_refresh_at: row.last_refresh_at || row.updated_at || null,
    error: row.last_refresh_error || null
  };
}

// Map of user_email_id -> connection status, across both providers. Defensive:
// a missing gmail_tokens table (migration 010 not applied) is treated as "no
// Gmail token", never an error.
async function mailboxConnections(supabase, ids) {
  const out = {};
  if (!ids || !ids.length) return out;
  let ms = [], gm = [];
  try { const { data } = await supabase.from('microsoft_tokens').select('*').in('user_email_id', ids); ms = data || []; } catch (_) {}
  try { const { data } = await supabase.from('gmail_tokens').select('*').in('user_email_id', ids); gm = data || []; } catch (_) {}
  const msBy = {}; ms.forEach(r => { msBy[r.user_email_id] = r; });
  const gmBy = {}; gm.forEach(r => { gmBy[r.user_email_id] = r; });
  ids.forEach(id => {
    if (msBy[id]) out[id] = Object.assign({ platform: 'microsoft' }, deriveTokenStatus(msBy[id]));
    else if (gmBy[id]) out[id] = Object.assign({ platform: 'gmail' }, deriveTokenStatus(gmBy[id]));
    else out[id] = { connected: false, status: 'none', platform: null };
  });
  return out;
}

// Best-effort record of a refresh attempt's outcome onto the token row. No-op if
// the columns don't exist yet (pre-migration) — never throws.
async function recordRefreshOutcome(supabase, table, userEmailId, ok, errorMsg) {
  try {
    await supabase.from(table).update({
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: ok ? null : String(errorMsg || 'refresh failed').slice(0, 500),
      refresh_failed: !ok
    }).eq('user_email_id', userEmailId);
  } catch (_) { /* columns absent — ignore */ }
}

module.exports = { deriveTokenStatus, mailboxConnections, recordRefreshOutcome };
