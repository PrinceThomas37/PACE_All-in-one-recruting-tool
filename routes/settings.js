// ============================================================================
// SETTINGS — app_settings (global) + outreach-plan (per-user)
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/settings')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// resolveTemplate is required directly (Node caches it, so it's the same
// singleton index.js uses).
// ============================================================================
const express = require('express');
const { resolveTemplate } = require('../email-vars');
const numberSettings = require('../config/settings');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole } = ctx;

// ── PER-USER PREFERENCES (Session 24, D-0022) ───────────────────────────────
// The owner: "a change in the theme in one user is reflected to other users, it
// should not happen like that."
//
// The light/dark choice lived ONLY in localStorage, which is per BROWSER. Two
// people on two machines never shared it; two logins on the SAME machine did,
// and whoever signed in next inherited the last person's choice. Now the
// account is the authority, so the choice follows the person to any device and
// never carries over to the next person at a shared desk.
//
// NO MIGRATION, deliberately. Stored in `app_settings` under `pref_<user_id>`,
// the same pattern as the next-action dismissals and the AI usage meter, for
// the same reason: a colour is not worth a schema change. If a third preference
// shows up this becomes a real `user_preferences` row — that is D-0022's
// "Re-open when".
const PREF_KEY = (userId) => `pref_${userId}`;
const ALLOWED_PREFS = { theme: ['light', 'dark', 'system'] };

router.get('/me/preferences', auth, async (req, res) => {
  try {
    const { data } = await supabase.from('app_settings').select('value')
      .eq('key', PREF_KEY(req.user.id)).maybeSingle();
    let prefs = {};
    if (data && data.value) {
      prefs = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    }
    res.json(prefs || {});
  } catch (err) {
    // A preference that cannot be read is not a reason to fail the page — the
    // browser's own copy is a perfectly good fallback for one session.
    res.json({});
  }
});

router.put('/me/preferences', auth, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const next = {};
    for (const [key, allowed] of Object.entries(ALLOWED_PREFS)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const val = body[key];
      // An allow-list, not a passthrough: this row is written straight back to
      // every one of that user's browsers, so it takes named values only.
      if (!allowed.includes(val)) {
        return res.status(400).json({ error: `${key} must be one of: ${allowed.join(', ')}` });
      }
      next[key] = val;
    }
    if (!Object.keys(next).length) return res.status(400).json({ error: 'No known preference supplied' });

    const key = PREF_KEY(req.user.id);
    const { data: existing } = await supabase.from('app_settings').select('value')
      .eq('key', key).maybeSingle();
    let current = {};
    if (existing && existing.value) {
      current = typeof existing.value === 'string' ? JSON.parse(existing.value) : existing.value;
    }
    const merged = Object.assign({}, current, next);
    const { error } = await supabase.from('app_settings')
      .upsert({ key, value: JSON.stringify(merged) }, { onConflict: 'key' });
    if (error) throw error;
    res.json(merged);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// C-0021 X1/X2 (critical): `app_settings` is a GLOBAL table shared by every
// org in the deployment, and this pair of routes used to read/write ANY key
// in it to ANY logged-in user. That table holds plaintext `int_<provider>_
// api_key` (config/integrations.js says getSecret() is server-only), every
// user's saved templates/signatures (`u_<id>_*`), per-user theme prefs
// (`pref_<id>`) and the AI usage meter (`ai_*`) — all deployment-wide, and
// none of it is what this endpoint is actually FOR.
//
// Grepping every `/app-settings` caller in public/js: the only two keys ANY
// page ever reads back from the GET are `outreach_send_time` and
// `followup_send_time` (public/js/22-api.js:95, public/js/12-manager-users.js
// — the orphaned Manager Users page). Nothing reads anything else through
// this door, so the allow-list is exactly those two, not a guess. The same
// page also writes `template_<key>_subject`/`_body` for the follow-up
// engine's GLOBAL fallback templates — deliberately left OFF the allow-list
// here (that page is unreachable via nav today; when it is wired back up,
// widening this list is a one-line, reviewable change, not a silent gap).
const APP_SETTINGS_ALLOW = Object.freeze(['outreach_send_time', 'followup_send_time']);

router.get('/app-settings', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', APP_SETTINGS_ALLOW);
    if (error) throw error;
    const settings = {};
    (data || []).forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/app-settings', auth, async (req, res) => {
  try {
    // Admin-only (was admin OR ra_lead) and allow-listed keys only — an
    // ra_lead of one org could otherwise overwrite the whole deployment's AI
    // key or another org's user's signature just by naming its key.
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
    if (!APP_SETTINGS_ALLOW.includes(key)) return res.status(400).json({ error: `key must be one of: ${APP_SETTINGS_ALLOW.join(', ')}` });
    const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date() }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, key, value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// OUTREACH PLAN (per-user)
// ══════════════════════════════════════════════════════════════
router.get('/outreach-plan', auth, async (req, res) => {
  try {
    const uid = req.user.id;
    const keys = [`u_${uid}_fu1_day`,`u_${uid}_fu2_day`,`u_${uid}_tmpl_o1_subject`,`u_${uid}_tmpl_o1_body`,`u_${uid}_tmpl_fu1_subject`,`u_${uid}_tmpl_fu1_body`,`u_${uid}_tmpl_fu2_subject`,`u_${uid}_tmpl_fu2_body`,`u_${uid}_signature_html`,`u_${uid}_random_template_mode`,`u_${uid}_compose_style_preset`];
    const { data } = await supabase.from('app_settings').select('key,value').in('key', keys);
    const plan = {};
    (data || []).forEach(r => { plan[r.key.replace(`u_${uid}_`, '')] = r.value; });

    const tmplFields = ['tmpl_o1_subject', 'tmpl_o1_body', 'tmpl_fu1_subject', 'tmpl_fu1_body', 'tmpl_fu2_subject', 'tmpl_fu2_body'];
    const migrations = [];
    tmplFields.forEach(field => {
      const shortKey = field.replace('tmpl_', '');
      const resolved = resolveTemplate(plan[field], shortKey);
      if (plan[field] && resolved !== plan[field]) {
        plan[field] = resolved;
        migrations.push({ key: `u_${uid}_${field}`, value: resolved });
      }
    });
    if (migrations.length) {
      await supabase.from('app_settings').upsert(
        migrations.map(m => ({ key: m.key, value: m.value, updated_at: new Date() })),
        { onConflict: 'key' }
      );
    }

    res.json(plan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/outreach-plan', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'bd', 'bd_lead', 'admin')) return res.status(403).json({ error: 'BD role required' });
    const uid = req.user.id;
    const allowed = ['fu1_day','fu2_day','tmpl_o1_subject','tmpl_o1_body','tmpl_fu1_subject','tmpl_fu1_body','tmpl_fu2_subject','tmpl_fu2_body','signature_html','random_template_mode','compose_style_preset'];
    const { key, value } = req.body;
    if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid key' });
    const fullKey = `u_${uid}_${key}`;
    const { error } = await supabase.from('app_settings').upsert({ key: fullKey, value: String(value), updated_at: new Date() }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, key: fullKey, value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// SYSTEM SETTINGS (admin-only) — operational numbers that used to be
// hardcoded constants. See config/settings.js for the schema.
// ══════════════════════════════════════════════════════════════
router.get('/admin/settings/numbers', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const settings = await numberSettings.getAllSettings(supabase);
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/settings/numbers', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    const updates = (req.body && req.body.values) || {};
    if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) {
      return res.status(400).json({ error: 'values object with at least one setting required' });
    }
    // Sending hours are a PAIR: a start that is not before the end would shut
    // lead sending entirely. Refuse it here, in words, rather than store it.
    if ('send_window_start_hour' in updates || 'send_window_end_hour' in updates) {
      const s = Number('send_window_start_hour' in updates ? updates.send_window_start_hour : await numberSettings.getSetting(supabase, 'send_window_start_hour'));
      const e = Number('send_window_end_hour' in updates ? updates.send_window_end_hour : await numberSettings.getSetting(supabase, 'send_window_end_hour'));
      if (!(s < e)) return res.status(400).json({ error: 'The start hour must be earlier than the stop hour.', key: 'send_window_end_hour' });
    }
    const result = await numberSettings.setSettings(supabase, updates);
    if (result.error) return res.status(400).json({ error: result.error, key: result.key });
    const settings = await numberSettings.getAllSettings(supabase);
    res.json({ success: true, settings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
