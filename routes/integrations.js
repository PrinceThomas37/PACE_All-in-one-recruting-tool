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
const aiBudget = require('../services/ai-budget');
const aiProvider = require('../services/ai-provider');
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
async function testProvider(id, key, extra = {}) {
  // Ollama is keyless — its "connection" is a reachable server address, so it
  // is tested before the no-key guard below rather than after it.
  if (id === 'ollama') {
    const root = String(extra.base_url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    if (!root) return { ok: false, error: 'Enter the server address first' };
    try {
      const r = await pingJson(`${root}/api/tags`, 5000);
      const models = (r.data && r.data.models) || [];
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return models.length
        ? { ok: true, detail: `Reachable · ${models.length} model${models.length === 1 ? '' : 's'} (${models.slice(0, 3).map(m => m.name).join(', ')})` }
        : { ok: true, detail: 'Reachable — but no model pulled yet (run: ollama pull llama3.1:8b)' };
    } catch (e) {
      // Nearly always the real cause: a laptop Ollama is not reachable from a
      // deployed server, and saying so beats a bare connect error.
      return { ok: false, error: `Could not reach ${root} from the PACE server — ${e.message}` };
    }
  }
  if (!key) return { ok: false, error: 'No key configured' };
  try {
    if (id === 'anthropic') {
      const r = await pingJson('https://api.anthropic.com/v1/models?limit=1', 8000, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      return r.ok ? { ok: true, detail: 'Key valid' } : { ok: false, error: r.data?.error?.message || `HTTP ${r.status}` };
    }
    if (id === 'groq') {
      const r = await pingJson('https://api.groq.com/openai/v1/models', 8000, { headers: { Authorization: `Bearer ${key}` } });
      const n = (r.data?.data || []).length;
      return r.ok ? { ok: true, detail: n ? `Key valid · ${n} models available` : 'Key valid' }
                  : { ok: false, error: r.data?.error?.message || `HTTP ${r.status}` };
    }
    if (id === 'openrouter') {
      const r = await pingJson('https://openrouter.ai/api/v1/key', 8000, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return { ok: false, error: r.data?.error?.message || `HTTP ${r.status}` };
      const lim = r.data?.data?.limit_remaining;
      return { ok: true, detail: (lim === null || lim === undefined) ? 'Key valid' : `Key valid · ${lim} credits remaining` };
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

  // ── REGISTRATION ORDER IS LOAD-BEARING BELOW THIS LINE ──────────────────
  // Express matches in registration order, so `POST /admin/integrations/:id`
  // matches "/admin/integrations/ai-test" with id="ai-test". These two literal
  // endpoints were appended below it in a later session and were therefore
  // never reachable: the save handler answered instead, and because it returns
  // a perfectly valid integrations payload with a 200, nothing anywhere said
  // so. The symptom was a "Test AI generation" button that appeared to do
  // nothing at all — the exact silence that whole card exists to eliminate.
  // ANY new literal path under /admin/integrations/ goes ABOVE the `:id`
  // routes. test/route-shadowing-smoke.mjs fails the build if one does not.

  // Does an AI actually generate, right now, through the real path?
  //
  // A provider card's "Test" lists models — it proves the KEY is accepted and
  // nothing more. A generation can still fail on the model name, a per-model
  // permission, or a rate limit, and the symptom is identical to having no key
  // at all: the feature quietly writes with its rules. This asks for one word
  // from each configured provider and reports its own words back.
  router.post('/admin/integrations/ai-test', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      res.json(await aiProvider.diagnose(supabase, { tier: (req.body && req.body.tier) || 'fast' }));
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
        // One "active" flag, two registries: an AI provider and an email
        // verifier are each chosen from their own group.
        const def = integrations.BY_ID.get(req.params.id);
        const r = def && def.ai
          ? await integrations.setActiveAi(supabase, b.active ? req.params.id : null)
          : await integrations.setActiveVerifier(supabase, b.active ? req.params.id : null);
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
      const base_url = (req.body && req.body.base_url) || await integrations.getSecret(supabase, req.params.id, 'base_url');
      res.json(await testProvider(req.params.id, key, { base_url }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // What the org has spent on AI today, and the ceilings it is spending
  // against. This is what makes a budget real to the person setting it: a cap
  // nobody can see the other side of is a guess.
  router.get('/admin/ai-budget', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      const [caps, spent] = await Promise.all([
        aiBudget.getCaps(supabase), aiBudget.getSpend(supabase, req.orgId),
      ]);
      res.json({
        caps, spent, day: aiBudget.dayKey(),
        // The last thing that went wrong, so a silent fallback has a reason
        // attached to it instead of being indistinguishable from "switched off".
        last_error: await aiProvider.getLastError(supabase),
        // The last test's OWN result, so the answer survives anything that
        // happens between the server and the browser: reopening this screen
        // shows it again instead of losing it.
        last_test: await aiProvider.getLastTest(supabase),
        defaults: { tokens: aiBudget.DEFAULT_DAILY_TOKENS, calls: aiBudget.DEFAULT_DAILY_CALLS },
        features: Object.entries(aiBudget.FEATURES).map(([id, f]) => ({
          id, label: f.label, max_input_tokens: f.in, max_output_tokens: f.out, tier: f.tier,
          spent_today: spent.by_feature[id] || 0,
        })),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Change the daily ceilings. Blank clears the setting back to the default;
  // 0 is a legitimate value meaning "no AI today", which is why it is not
  // treated as blank.
  router.post('/admin/ai-budget', auth, async (req, res) => {
    try {
      if (!admin(req, res)) return;
      const b = req.body || {};
      const writes = [];
      const set = (key, v) => {
        if (v === undefined) return;
        if (v === '' || v === null) { writes.push(supabase.from('app_settings').delete().eq('key', key)); return; }
        const n = Number(v);
        if (!isFinite(n) || n < 0) return;
        writes.push(supabase.from('app_settings').upsert({ key, value: String(Math.floor(n)), updated_at: new Date() }, { onConflict: 'key' }));
      };
      set(aiBudget.CAP_TOKENS_KEY, b.tokens);
      set(aiBudget.CAP_CALLS_KEY, b.calls);
      await Promise.all(writes);
      res.json({ caps: await aiBudget.getCaps(supabase) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
