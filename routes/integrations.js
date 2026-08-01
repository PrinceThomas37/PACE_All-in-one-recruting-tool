// ============================================================================
// INTEGRATIONS — admin-managed API keys for external providers (AI, email
// verifiers, contact databases). Mounted from index.js:
//   app.use(require('./routes/integrations')(ctx));  ctx = { supabase, auth, hasRole }
//
// Admin-only. Reads are masked (config/integrations never returns raw secrets to
// the browser); the actual keys are used server-side by the hooks.
// ============================================================================
const express = require('express');
const integrations = require('../config/integrations');
const { verifyEmailAddress } = require('../email-verify');
const httpClient = require('../http-client');

// Thin adapter over the shared client, keeping this file's (url, ms, options)
// argument order so the provider tests below are unchanged. No retry: these are
// "is this key valid" pings where a fast honest answer beats a slow one.
async function pingJson(url, ms = 8000, options = {}) {
  return httpClient.fetchJson(url, options, { timeoutMs: ms, retries: 0 });
}

// Provider-specific, cheap connection tests (validate the key without spending
// real work / tokens where possible).
async function testProvider(id, key) {
  if (!key) return { ok: false, error: 'No key configured' };
  try {
    if (id === 'anthropic') {
      const r = await pingJson('https://api.anthropic.com/v1/models?limit=1', 8000, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      return r.ok ? { ok: true, detail: 'Key valid' } : { ok: false, error: r.data?.error?.message || `HTTP ${r.status}` };
    }
    if (id === 'zerobounce') {
      const r = await pingJson(`https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(key)}`);
      const credits = Number(r.data?.Credits);
      return (r.ok && credits >= 0) ? { ok: true, detail: `${credits} credits` } : { ok: false, error: 'Invalid key' };
    }
    if (id === 'neverbounce') {
      const r = await pingJson(`https://api.neverbounce.com/v4/account/info?key=${encodeURIComponent(key)}`);
      return (r.data?.status === 'success') ? { ok: true, detail: 'Key valid' } : { ok: false, error: r.data?.message || 'Invalid key' };
    }
    if (id === 'hunter') {
      const r = await pingJson(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`);
      return r.ok ? { ok: true, detail: r.data?.data?.plan_name ? `Plan: ${r.data.data.plan_name}` : 'Key valid' } : { ok: false, error: r.data?.errors?.[0]?.details || 'Invalid key' };
    }
    if (id === 'apollo') {
      const r = await pingJson(`https://api.apollo.io/v1/auth/health?api_key=${encodeURIComponent(key)}`);
      return (r.ok && (r.data?.is_logged_in || r.data?.logged_in)) ? { ok: true, detail: 'Key valid' } : { ok: false, error: 'Invalid key' };
    }
    return { ok: true, detail: 'Saved — no automated test for this provider' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole } = ctx;
  const admin = (req, res) => { if (!hasRole(req, 'admin')) { res.status(403).json({ error: 'Admin only' }); return false; } return true; };

  router.get('/admin/integrations', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      res.json(await integrations.getAll(supabase));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Save keys for one integration. Body: { values:{api_key:'…'}, active?:true }.
  // Empty-string value clears that field. `active` (verifiers only) sets it as
  // the provider the send-time hook uses.
  router.post('/admin/integrations/:id', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      const b = req.body || {};
      if (b.values && typeof b.values === 'object') {
        const r = await integrations.setIntegration(supabase, req.params.id, b.values);
        if (r.error) return res.status(400).json({ error: r.error });
      }
      if (b.active !== undefined) {
        const r = await integrations.setActiveVerifier(supabase, b.active ? req.params.id : null);
        if (r.error) return res.status(400).json({ error: r.error });
      }
      res.json(await integrations.getAll(supabase));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/admin/integrations/:id', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      const r = await integrations.clearIntegration(supabase, req.params.id);
      if (r.error) return res.status(400).json({ error: r.error });
      res.json(await integrations.getAll(supabase));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Test a connection — uses the key in the body if given (test before save),
  // otherwise the stored key.
  router.post('/admin/integrations/:id/test', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      if (!integrations.BY_ID.has(req.params.id)) return res.status(404).json({ error: 'Unknown integration' });
      const key = (req.body && req.body.api_key) || await integrations.getSecret(supabase, req.params.id, 'api_key');
      res.json(await testProvider(req.params.id, key));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Try the active email verifier against a real address (for the UI tester).
  router.post('/admin/integrations/email-verify', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      const address = (req.body && req.body.address) || '';
      if (!address) return res.status(400).json({ error: 'address required' });
      res.json(await verifyEmailAddress(supabase, address));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
