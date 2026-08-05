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
//   4. AN ACCOUNT IS ONLY EVER CREATED BY services/provisioning.js, and only
//      when self-serve signup is switched on (SELF_SERVE_SIGNUP=on). With it
//      off — the shipping default — this file behaves exactly as it always
//      has: an existing, active, non-deleted user gets a session and nobody
//      else does. Where a brand-new address ends up is a decision with real
//      blast radius (route it wrong and somebody is inside another company's
//      candidate database), so it lives in one pure, exhaustively tested
//      function rather than being spread through this callback.
// ============================================================================

const jwt = require('jsonwebtoken');
const provisioning = require('./provisioning');

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
 *
 * `name` is the display name the provider gave us (Microsoft `displayName`,
 * Google `name`). It is only used when an account is being created — matching
 * is always on the verified email address, never on a name.
 */
async function sessionForEmail(supabase, email, { provider, name } = {}) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) {
    return { ok: false, reason: 'no_email', message: `${provider} did not return an email address for this account.` };
  }

  const { data: found, error } = await supabase.from('users').select('*')
    .eq('email', addr).eq('is_active', true).is('deleted_at', null).maybeSingle();

  if (error) return { ok: false, reason: 'lookup_failed', message: 'Could not look up that account. Please try again.' };

  let user = found;
  let created = false;

  if (user) {
    // An existing account still has to belong to a workspace that is allowed to
    // be used. Suspending an org must actually stop its people signing in,
    // otherwise "suspended" is a label rather than a state.
    const org = await provisioning.loadOrg(supabase, user.org_id);
    const verdict = provisioning.decide({ email: addr, user, org, selfServe: provisioning.selfServeEnabled() });
    if (verdict.action === 'refuse') return { ok: false, reason: verdict.reason, message: verdict.message };
  } else {
    // No account. Either self-serve is off — in which case this returns the
    // same "ask your administrator" refusal it always has — or it decides
    // between joining a verified-domain org and a private workspace.
    const routed = await provisioning.routeNewSignIn(supabase, { email: addr, name });
    if (!routed.ok) return { ok: false, reason: routed.reason, message: routed.message };
    user = routed.user;
    created = routed.created;
    console.log(`[sso] provisioned ${addr} via ${provider} — ${routed.reason} (org ${user.org_id})`);
  }

  const roles = user.roles || (user.role ? [user.role] : []);
  const token = jwt.sign(
    { id: user.id, email: user.email, roles, role: roles[0] || 'ra', name: user.name, org_id: user.org_id || null },
    process.env.JWT_SECRET, { expiresIn: SESSION_TTL }
  );

  // Record how they got in — useful for support ("I can't log in") and for
  // spotting an account that has never used SSO. The columns arrive with
  // migration 039; before that this is a no-op, and it must never be allowed to
  // fail a login either way.
  try {
    await supabase.from('users').update({ last_login_at: new Date(), last_login_method: provider }).eq('id', user.id);
  } catch (_) { /* never block a login on bookkeeping */ }

  const { password_hash, ...safeUser } = user;
  return { ok: true, token, user: { ...safeUser, roles }, created };
}

module.exports = {
  signState, readSignInState, completionPage, failurePage, sessionForEmail,
  STATE_TTL_SECONDS, SESSION_TTL,
};
