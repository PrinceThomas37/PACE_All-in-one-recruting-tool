// ============================================================================
// GOOGLE OAUTH · GMAIL SEND/READ  — the counterpart to routes/microsoft.js.
// Mounted via: app.use(require('./routes/gmail')(ctx));
// ctx = { supabase, auth, hasRole, provider }  (provider = gmail-provider.js)
//
// Gated: every entry point short-circuits with a clear message when Gmail isn't
// configured (GOOGLE_CLIENT_ID/SECRET unset), so mounting this never affects the
// Microsoft path or startup.
// ============================================================================
const express = require('express');
const jwt = require('jsonwebtoken');
const sso = require('../services/sso');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, provider } = ctx;

  const notConfiguredPage = (res) =>
    res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',error:'Gmail is not configured on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).'},'*');window.close();</scr` + `ipt>`);

  router.get('/auth/google/connect', async (req, res) => {
    try {
      if (!provider.isConfigured()) return notConfiguredPage(res);
      const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).send('Unauthorized');
      let reqUser;
      try { reqUser = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).send('Invalid token'); }
      if (!reqUser.roles?.includes('admin') && reqUser.role !== 'admin') return res.status(403).send('Admin only');
      const { userEmailId } = req.query;
      if (!userEmailId) return res.status(400).send('userEmailId required');
      const state = Buffer.from(JSON.stringify({ userEmailId, userId: reqUser.id })).toString('base64');
      res.redirect(provider.authorizeUrl(state));
    } catch (err) { res.status(500).send(err.message); }
  });

  router.get('/auth/google/callback', async (req, res) => {
    let userEmailId = '';
    try {
      if (!provider.isConfigured()) return notConfiguredPage(res);
      const { code, state, error: gErr } = req.query;

      // SIGN-IN vs MAILBOX-CONNECT — same registered redirect URI, told apart by
      // a signed state. See routes/microsoft.js for the full reasoning.
      const signIn = sso.readSignInState(state);
      if (signIn) {
        if (gErr) return res.status(400).send(sso.failurePage(String(gErr)));
        if (!code) return res.status(400).send(sso.failurePage('Google did not return an authorization code.'));
        try {
          const tokens = await provider.exchangeCode(code);
          if (tokens.error) return res.status(400).send(sso.failurePage(tokens.error_description || tokens.error));

          // Prefer the id_token: it carries email_verified, which the userinfo
          // endpoint's plain email does not. An UNVERIFIED address must never
          // start a session — otherwise someone registers a Google account
          // claiming your work address and signs in as you.
          let email = '', verified = null, name = '';
          if (tokens.id_token) {
            try {
              const claims = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1], 'base64').toString());
              email = claims.email || '';
              verified = claims.email_verified;
              name = claims.name || '';
            } catch (_) { /* fall back below */ }
          }
          if (!email) email = await provider.getProfileEmail(tokens.access_token);
          if (verified === false) {
            return res.status(403).send(sso.failurePage('That Google address is not verified. Verify it with Google, then try again.'));
          }

          // `name` is only used if an account is being created for the first
          // time (self-serve signup). Matching is always on the verified address.
          const out = await sso.sessionForEmail(supabase, email, { provider: 'google', name });
          if (!out.ok) return res.status(403).send(sso.failurePage(out.message));
          return res.send(sso.completionPage(out.token, signIn.redirect || '/'));
        } catch (err) {
          console.error('[sso/google] callback failed:', err.message);
          return res.status(500).send(sso.failurePage('Sign-in failed. Please try again.'));
        }
      }

      if (gErr) return res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',error:'${gErr}'},'*');window.close();</scr` + `ipt>`);
      if (!code || !state) return res.status(400).send('Missing code or state');
      const parsed = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());
      userEmailId = parsed.userEmailId; const userId = parsed.userId;

      const tokens = await provider.exchangeCode(code);
      if (tokens.error) return res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',userEmailId:'${userEmailId}',error:${JSON.stringify(tokens.error_description || tokens.error)}},'*');window.close();</scr` + `ipt>`);
      const emailAddress = await provider.getProfileEmail(tokens.access_token);

      // Validate the connected Google account matches the slot before writing.
      const { data: slot } = await supabase.from('user_emails').select('email_address').eq('id', userEmailId).single();
      const expected = (slot?.email_address || '').toLowerCase().trim();
      const actual = (emailAddress || '').toLowerCase().trim();
      if (expected && actual && expected !== actual) {
        const msg = `Wrong account: you signed in as ${emailAddress} but this slot is for ${slot.email_address}. Sign out of Google and retry with the correct account.`;
        return res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',userEmailId:'${userEmailId}',error:${JSON.stringify(msg)}},'*');window.close();</scr` + `ipt>`);
      }

      await supabase.from('gmail_tokens').delete().eq('user_email_id', userEmailId);
      const { error: insErr } = await supabase.from('gmail_tokens').insert({
        user_email_id: userEmailId, user_id: userId, email_address: emailAddress,
        access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), updated_at: new Date(),
      });
      if (insErr) return res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',userEmailId:'${userEmailId}',error:'DB save failed: ${insErr.message}'},'*');window.close();</scr` + `ipt>`);
      if (!tokens.refresh_token) {
        // Google only returns a refresh_token on first consent; prompt=consent
        // forces it, but warn if somehow absent so it can be re-consented.
        console.warn(`[gmail] no refresh_token returned for ${emailAddress} — re-consent may be needed`);
      }
      await supabase.from('user_emails').update({ platform: 'Gmail', is_active: true }).eq('id', userEmailId);
      res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_success',userEmailId:'${userEmailId}',email:'${emailAddress}'},'*');window.close();</scr` + `ipt>`);
    } catch (err) {
      console.error('Google OAuth callback error:', err);
      res.send(`<scr` + `ipt>window.opener&&window.opener.postMessage({type:'google_oauth_error',userEmailId:'${userEmailId}',error:${JSON.stringify(err.message)}},'*');window.close();</scr` + `ipt>`);
    }
  });

  router.get('/auth/google/status/:userEmailId', auth, async (req, res) => {
    try {
      const { data } = await supabase.from('gmail_tokens').select('email_address,expires_at').eq('user_email_id', req.params.userEmailId).single();
      if (!data) return res.json({ connected: false, configured: provider.isConfigured() });
      res.json({ connected: true, configured: provider.isConfigured(), email_address: data.email_address, expired: new Date(data.expires_at) < new Date() });
    } catch { res.json({ connected: false, configured: provider.isConfigured() }); }
  });

  router.delete('/auth/google/:userEmailId', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
      await supabase.from('gmail_tokens').delete().eq('user_email_id', req.params.userEmailId);
      await supabase.from('user_emails').update({ is_active: false }).eq('id', req.params.userEmailId);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
