// ============================================================================
// MAILBOX SIGN-IN ALERTS (R-037). PURE — no db, no clock of its own.
//
// A mailbox whose sign-in has died does not send. The retry ladder (D-0031)
// survives a passing hiccup, but not a sign-in that is genuinely dead: emails
// sit behind it and nothing tells the one person who can fix it — the owner,
// who must reconnect it themselves (the consent screen is theirs). Measured
// 2026-09-26: kristy.scott@fute-global.com had been dead since 21 Jul
// (Microsoft consent withdrawn) and it was recorded in the database the whole
// time; nothing on any screen said so.
//
// This file decides WHICH mailboxes warrant a warning and WHAT it says:
//   * a recorded refresh failure        → certain: "stopped working"
//   * no record, access expired > 90min → probable: "has probably expired"
//     (never stated as certain — the evidence is indirect)
//   * never connected, but mail waits   → "not connected"
//   * never connected, nothing waiting  → no alert (a spare slot is not a fault)
//   * an inactive mailbox               → no alert (switched off on purpose)
// The provider's own words are translated, never shown raw to a recruiter.
// ============================================================================

function reasonSentence(platform, error) {
  const e = String(error || '').toLowerCase();
  const who = platform === 'gmail' ? 'Google' : 'Microsoft';
  if (/aadsts65001|consent/.test(e)) return `${who} withdrew PACE's permission to use this mailbox — reconnect it and accept the permission again.`;
  if (/aadsts7000215|aadsts7000222|invalid_client|client secret/.test(e)) return `PACE's own ${who} connection needs renewing — this affects every ${who} mailbox; an admin should look at Admin → Integrations.`;
  if (/aadsts50173|aadsts700082|aadsts50076|password|mfa|multi-factor/.test(e)) return `The sign-in was ended by a password or security change — reconnect it.`;
  if (platform === 'gmail' && /invalid_grant|expired or revoked|token has been expired/.test(e)) return `Google ended the sign-in (it does this after 7 days while PACE's Google app is in testing, or after a password change) — reconnect it.`;
  if (/invalid_grant|revoked|expired/.test(e)) return `The sign-in expired — reconnect it.`;
  return `The sign-in stopped working — reconnect it.`;
}

// One mailbox → one alert, or null.
//   mailbox: { id, email_address, is_active, user_id }
//   conn:    mailbox-health's deriveTokenStatus shape, plus `certain`
//   held:    emails waiting to go out from this mailbox
function alertFor({ mailbox, conn, held = 0 }) {
  if (!mailbox || mailbox.is_active === false) return null;
  const c = conn || { connected: false, status: 'none' };
  // The provider the connection used, else the one the mailbox was set up as
  // (a never-connected slot has no connection to ask).
  const set = String(mailbox.platform || '').toLowerCase();
  const platform = c.platform || (set === 'gmail' || set === 'google' ? 'gmail' : set ? 'microsoft' : null);
  if (c.status === 'expired') {
    return {
      mailbox_id: mailbox.id, email: mailbox.email_address, platform,
      state: c.certain ? 'failed' : 'probably_expired',
      // When it last WORKED — never the time of the last failed attempt.
      since: c.last_ok_at || c.expires_at || null,
      held,
      sentence: c.certain
        ? reasonSentence(platform, c.error)
        : `This mailbox's sign-in has not renewed when it should have — it has probably expired. Reconnect it to be sure.`,
    };
  }
  if (c.status === 'none' && held > 0) {
    return { mailbox_id: mailbox.id, email: mailbox.email_address, platform, state: 'not_connected', since: null, held,
      sentence: 'This mailbox was never connected, so nothing can send from it.' };
  }
  return null;
}

// Most urgent first: certain failures, then mail waiting, then the rest.
function sortAlerts(list) {
  const rank = { failed: 0, not_connected: 1, probably_expired: 2 };
  return (list || []).slice().sort((a, b) =>
    (rank[a.state] - rank[b.state]) || ((b.held || 0) - (a.held || 0)) || String(a.email).localeCompare(String(b.email)));
}

module.exports = { reasonSentence, alertFor, sortAlerts };
