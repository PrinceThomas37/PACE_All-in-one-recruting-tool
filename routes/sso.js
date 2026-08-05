// ============================================================================
// SSO — the "Sign in with Microsoft / Google" entry points.
//
// The callbacks themselves live in routes/microsoft.js and routes/gmail.js,
// which already own each provider's registered redirect URI. They branch to the
// sign-in handler when the state says so (services/sso.js), so enabling this
// needed NO change to the Azure app registration — Microsoft sign-in works with
// the credentials that are already configured.
//
// GET /auth/sso/providers  → which buttons the login screen should show
// GET /auth/sso/:provider  → begins the flow (a redirect, not JSON)
// ============================================================================
const express = require('express');
const sso = require('../services/sso');
const orgDomains = require('../services/org-domains');
const provisioning = require('../services/provisioning');

module.exports = (ctx) => {
  const router = express.Router();
  const { MS_TENANT, MS_CLIENT, MS_REDIRECT, MS_SCOPES, config, gmailProvider } = ctx;

  const microsoftReady = () => Boolean(MS_CLIENT && MS_REDIRECT);
  const googleReady = () => Boolean(gmailProvider && gmailProvider.isConfigured());

  // The login screen asks what to render, so a button only appears when the
  // provider behind it is actually configured. A button that always shows and
  // sometimes fails is worse than no button — that is exactly what the old
  // placeholder "Google Workspace login coming soon" toast was.
  //
  // `self_serve` tells the login screen whether the Sign Up tab can actually
  // create a workspace, or whether it should keep capturing requests for a
  // human to action. Same principle as the buttons: never offer something the
  // deployment cannot do.
  router.get('/auth/sso/providers', (_req, res) => {
    res.json({
      providers: [
        { id: 'microsoft', label: 'Continue with Microsoft', enabled: microsoftReady() },
        { id: 'google', label: 'Continue with Google', enabled: googleReady() },
      ].filter(p => p.enabled),
      self_serve: provisioning.selfServeEnabled(),
    });
  });

  // "Log In with your Organization" — which identity provider does this email
  // domain sign in with?
  //
  // Answered from VERIFIED domain claims first (org_domains), falling back to
  // "do accounts already exist on that domain" while nothing is claimed yet.
  // Only verified claims count — an unverified one proves nothing and must
  // never influence where somebody is sent to sign in.
  //
  // Full SAML/Okta federation (per-org IdP metadata, certificates) is still a
  // separate piece, and THIS ENDPOINT IS THE SEAM IT SLOTS INTO. An unknown
  // domain gets a plain "we don't know you" rather than a dead redirect.
  //
  // Free mail providers are refused outright: nobody's *organisation* is
  // gmail.com, and treating one as an org is how a domain-based system gets
  // hijacked later.
  router.get('/auth/sso/for-domain', async (req, res) => {
    try {
      const domain = orgDomains.normalizeDomain(req.query.domain);
      if (!domain || domain.indexOf('.') < 0) {
        return res.json({ provider: null, message: 'That does not look like a company domain.' });
      }
      if (orgDomains.isFreeMailDomain(domain)) {
        return res.json({
          provider: null,
          message: `${domain} is a personal email provider, not an organisation. Use the Microsoft or Google button above.`,
        });
      }

      // A VERIFIED claim is the authoritative answer. Only verified rows are
      // consulted — an unverified claim proves nothing and must never influence
      // where somebody is sent to sign in.
      try {
        const { data: claimed } = await ctx.supabase.from('org_domains')
          .select('org_id,domain').eq('domain', domain).not('verified_at', 'is', null).maybeSingle();
        if (claimed) {
          const provider = microsoftReady() ? 'microsoft' : googleReady() ? 'google' : null;
          if (provider) return res.json({ provider, domain, org_known: true });
        }
      } catch (_) { /* migration 038 not applied yet — fall through */ }

      // Fallback while no domains are claimed: infer from the accounts that
      // already exist on that domain. Useful today, and superseded the moment a
      // real claim is verified.
      const { data: rows } = await ctx.supabase.from('users')
        .select('id,platform').ilike('email', `%@${domain}`).eq('is_active', true)
        .is('deleted_at', null).limit(5);

      if (!rows || !rows.length) {
        // With self-serve on, an unrecognised domain is not a dead end — it is
        // somebody who can create their own workspace right now. Send them at a
        // provider rather than at their administrator.
        if (provisioning.selfServeEnabled()) {
          const provider = microsoftReady() ? 'microsoft' : googleReady() ? 'google' : null;
          if (provider) return res.json({ provider, domain, org_known: false, new_workspace: true });
        }
        return res.json({
          provider: null,
          message: `We don't recognise ${domain} yet. Ask your administrator to add you, or use Sign Up to request access.`,
        });
      }

      // Prefer whatever the org's own accounts are set up on, then whatever is
      // actually configured on this deployment.
      const prefersGoogle = rows.some(r => String(r.platform || '').toLowerCase() === 'gmail');
      const provider = (prefersGoogle && googleReady()) ? 'google'
        : microsoftReady() ? 'microsoft'
        : googleReady() ? 'google'
        : null;

      if (!provider) return res.json({ provider: null, message: 'No sign-in provider is configured on this deployment.' });
      return res.json({ provider, domain });
    } catch (err) {
      console.error('[sso] for-domain failed:', err.message);
      res.json({ provider: null, message: 'Could not look that up. Please try again.' });
    }
  });

  router.get('/auth/sso/:provider', (req, res) => {
    const provider = String(req.params.provider || '').toLowerCase();
    // Only ever redirect back into this app.
    const redirectTo = String(req.query.redirect || '/').startsWith('/') ? String(req.query.redirect || '/') : '/';

    try {
      if (provider === 'microsoft') {
        if (!microsoftReady()) return res.status(503).send(sso.failurePage('Microsoft sign-in is not configured.'));
        const state = sso.signState({ provider: 'microsoft', redirect: redirectTo });
        const url = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`
          + `?client_id=${encodeURIComponent(MS_CLIENT)}`
          + `&response_type=code`
          + `&redirect_uri=${encodeURIComponent(MS_REDIRECT)}`
          + `&scope=${encodeURIComponent(MS_SCOPES)}`
          + `&state=${encodeURIComponent(state)}`
          + `&prompt=select_account`;
        return res.redirect(url);
      }

      if (provider === 'google') {
        if (!googleReady()) {
          return res.status(503).send(sso.failurePage(
            'Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
          ));
        }
        const state = sso.signState({ provider: 'google', redirect: redirectTo });
        // signInAuthorizeUrl, NOT authorizeUrl: the latter asks for gmail.send +
        // gmail.modify (Google RESTRICTED scopes), which would both demand
        // Google's security review and show a "read and send your email"
        // consent screen to somebody who only wants to log in.
        return res.redirect(gmailProvider.signInAuthorizeUrl(state));
      }

      return res.status(404).send(sso.failurePage('Unknown sign-in provider.'));
    } catch (err) {
      console.error('[sso] start failed:', err.message);
      res.status(500).send(sso.failurePage('Could not start sign-in. Please try again.'));
    }
  });

  // Sign Up — records interest. Self-serve provisioning (a company claiming its
  // domain, or an individual getting a personal workspace) is NOT built yet: it
  // needs organisation provisioning, domain verification and tenant isolation
  // first. Rather than a tab that silently does nothing, this captures the
  // request so nobody who wants in is lost, and becomes the funnel when real
  // signup lands.
  //
  // Unauthenticated, so it is rate limited in index.js alongside login.
  router.post('/auth/signup-request', async (req, res) => {
    try {
      const email = String(req.body?.email || '').toLowerCase().trim();
      const company = String(req.body?.company || '').trim().slice(0, 200);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'Enter a valid work email.' });
      }
      // Stored in app_settings (a global key/value table) rather than a new
      // table, so this needs no migration and cannot block on one. It moves to
      // a real table when self-serve signup is built.
      const key = `signup_request:${email}`;
      await ctx.supabase.from('app_settings').upsert({
        key,
        value: JSON.stringify({ email, company, at: new Date().toISOString(), ua: String(req.headers['user-agent'] || '').slice(0, 200) }),
        updated_at: new Date(),
      }, { onConflict: 'key' });
      console.log(`[signup] access requested by ${email}${company ? ` (${company})` : ''}`);
      // Always the same answer, whether or not this email already asked or
      // already has an account — otherwise this endpoint tells a stranger who
      // is registered.
      res.json({ ok: true });
    } catch (err) {
      console.error('[signup] request failed:', err.message);
      res.status(500).json({ error: 'Could not record that. Please try again.' });
    }
  });

  return router;
};
