// ============================================================================
// SSO SIGN-IN — "Sign in with Microsoft / Google", the Claude/Canva flow.
//
// WHAT THIS IS NOT: the existing /auth/{microsoft,google}/connect flows. Those
// look identical to a user but do a different job — they attach a MAILBOX to an
// existing account so futé can send from it. This signs a person IN.
//
// It deliberately reuses each provider's ALREADY-REGISTERED redirect URI and
// tells the two purposes apart by the `state` parameter, so enabling sign-in
// needs no change to the Azure app registration. That matters: the Microsoft
// app is already configured, so "Sign in with Microsoft" works with no new
// credentials and no setup step for the owner.
//
// SECURITY NOTES (this is the front door — the bar is higher here than for the
// mailbox flow, which is admin-gated and starts from an authenticated session):
//
//   1. STATE IS SIGNED, not just base64. The mailbox flow's plain-base64 state
//      is acceptable because you must already be an admin to start it. A
//      sign-in state that anyone can forge is a login-CSRF vector, so it is a
//      short-lived JWT and is verified on the way back.
//   2. ONLY VERIFIED EMAILS. Google returns `email_verified`; an unverified
//      address is refused outright. Otherwise someone registers an account
//      claiming your work address and walks in.
//   3. THE TOKEN COMES BACK IN THE URL FRAGMENT, not the query string.
//      Fragments are not sent to the server, so the session token stays out of
//      access logs, proxy logs and Referer headers. The page clears it from the
//      address bar immediately.
//   4. NO ACCOUNT IS CREATED HERE. Sign-in matches an EXISTING user by email.
//      Self-serve signup (personal workspaces, domain-claimed orgs) is a
//      deliberate separate step — it needs org provisioning, domain
//      verification and the tenant isolation work first.
// ============================================================================

const jwt = require('jsonwebtoken');

const STATE_TTL_SECONDS = 600;          // 10 minutes to complete a sign-in
const SESSION_TTL = '8h';               // matches the password login path

/** Sign the OAuth `state` so a forged callback cannot start a session. */
function signState(payload) {
  return jwt.sign({ ...payload, p: 'signin' }, process.env.JWT_SECRET, { expiresIn: STATE_TTL_SECONDS });
}

/**
 * Is this callback a sign-in (vs a mailbox connect)? Returns the verified state
 * or null. Never throws — a malformed state simply is not ours.
 */
function readSignInState(rawState) {
  if (!rawState) return null;
  try {
    const decoded = jwt.verify(decodeURIComponent(rawState), process.env.JWT_SECRET);
    return decoded && decoded.p === 'signin' ? decoded : null;
  } catch (_) {
    return null;
  }
}

/** The page we hand back after a successful sign-in. Fragment, then scrub. */
function completionPage(token, redirectTo = '/') {
  const safe = String(redirectTo).startsWith('/') ? redirectTo : '/';
  return `<!doctype html><meta charset="utf-8"><title>Signing you in…</title>
<body style="font:15px/1.5 system-ui,sans-serif;padding:40px;color:#374151">Signing you in…
<script>
  // Fragment, not query: never reaches the server, so the session token stays
  // out of access logs and Referer headers.
  location.replace(${JSON.stringify(safe)} + '#sso=' + encodeURIComponent(${JSON.stringify(token)}));
</script></body>`;
}

/** A failure page that says what went wrong without leaking anything useful. */
function failurePage(message) {
  const msg = String(message || 'Sign-in failed.');
  return `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title>
<body style="font:15px/1.5 system-ui,sans-serif;padding:40px;color:#374151">
  <h2 style="margin:0 0 8px;font-size:18px">Sign-in failed</h2>
  <p style="color:#6b7280">${msg.replace(/[<>&]/g, '')}</p>
  <p><a href="/" style="color:#166534">Back to sign in</a></p>
</body>`;
}

/**
 * Turn a verified email into an app session.
 *
 * Returns { ok, token, user } or { ok:false, reason, message }.
 * `reason` is machine-readable; `message` is what a human should be shown.
 */
async function sessionForEmail(supabase, email, { provider }) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) {
    return { ok: false, reason: 'no_email', message: `${provider} did not return an email address for this account.` };
  }

  const { data: user, error } = await supabase.from('users').select('*')
    .eq('email', addr).eq('is_active', true).is('deleted_at', null).maybeSingle();

  if (error) return { ok: false, reason: 'lookup_failed', message: 'Could not look up that account. Please try again.' };

  if (!user) {
    // Deliberately explicit rather than vague. This is a B2B tool where an
    // admin adds people; "no account" is a real, actionable answer, and hiding
    // it just makes the person retry the same thing.
    return {
      ok: false, reason: 'no_account',
      message: `No futé account exists for ${addr}. Ask your administrator to add you, then sign in again.`,
    };
  }

  const roles = user.roles || (user.role ? [user.role] : []);
  const token = jwt.sign(
    { id: user.id, email: user.email, roles, role: roles[0] || 'ra', name: user.name, org_id: user.org_id || null },
    process.env.JWT_SECRET, { expiresIn: SESSION_TTL }
  );

  // Record how they got in — useful for support ("I can't log in") and for
  // spotting an account that has never used SSO.
  try {
    await supabase.from('users').update({ last_login_at: new Date(), last_login_method: provider }).eq('id', user.id);
  } catch (_) { /* columns arrive with migration 038; never block a login on this */ }

  const { password_hash, ...safeUser } = user;
  return { ok: true, token, user: { ...safeUser, roles } };
}

module.exports = {
  signState, readSignInState, completionPage, failurePage, sessionForEmail,
  STATE_TTL_SECONDS, SESSION_TTL,
};
