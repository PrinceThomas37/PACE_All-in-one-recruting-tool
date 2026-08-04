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

module.exports = (ctx) => {
  const router = express.Router();
  const { MS_TENANT, MS_CLIENT, MS_REDIRECT, MS_SCOPES, config, gmailProvider } = ctx;

  const microsoftReady = () => Boolean(MS_CLIENT && MS_REDIRECT);
  const googleReady = () => Boolean(gmailProvider && gmailProvider.isConfigured());

  // The login screen asks what to render, so a button only appears when the
  // provider behind it is actually configured. A button that always shows and
  // sometimes fails is worse than no button — that is exactly what the old
  // placeholder "Google Workspace login coming soon" toast was.
  router.get('/auth/sso/providers', (_req, res) => {
    res.json({
      providers: [
        { id: 'microsoft', label: 'Continue with Microsoft', enabled: microsoftReady() },
        { id: 'google', label: 'Continue with Google', enabled: googleReady() },
      ].filter(p => p.enabled),
    });
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
        return res.redirect(gmailProvider.authorizeUrl(state));
      }

      return res.status(404).send(sso.failurePage('Unknown sign-in provider.'));
    } catch (err) {
      console.error('[sso] start failed:', err.message);
      res.status(500).send(sso.failurePage('Could not start sign-in. Please try again.'));
    }
  });

  return router;
};
