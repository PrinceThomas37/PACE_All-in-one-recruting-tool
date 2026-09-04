// ============================================================================
// DISTRIBUTION (reads + per-manager RA mode config).
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/distribution')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
//
// NOTE: the lead-distribution ACTIONS (POST /distribute/generate-ratio and
// POST /distribute/execute) stay inline in index.js — execute assigns leads and
// can trigger auto-send, so it belongs with the send-pipeline work.
// ============================================================================
const express = require('express');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, normInd, withOrg } = ctx;

router.get('/admin/manager-ra-modes', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const { data } = await supabase.from('app_settings').select('key,value').like('key', 'u_%_ra_mode');
    const modes = {};
    (data || []).forEach(r => {
      const m = /^u_(.+)_ra_mode$/.exec(r.key);
      if (m) modes[m[1]] = r.value === 'manual' ? 'manual' : 'auto';
    });
    res.json({ modes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin/leads set one BD manager to 'auto' or 'manual' RA mode.
router.post('/admin/manager-ra-mode', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const bdId = req.body && req.body.bd_id;
    const mode = req.body && req.body.mode;
    if (!bdId || (mode !== 'auto' && mode !== 'manual')) return res.status(400).json({ error: 'bd_id and mode (auto|manual) required' });
    const { error } = await supabase.from('app_settings').upsert({ key: `u_${bdId}_ra_mode`, value: mode, updated_at: new Date() }, { onConflict: 'key' });
    if (error) throw error;
    console.log(`[RaMode] Manager ${bdId} set to ${mode.toUpperCase()} by user ${req.user.id}`);
    res.json({ success: true, bd_id: bdId, mode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/distribute/pool-stats', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    // Supabase default limit is 1000 — use range to fetch all rows in batches
    let pool = [], from = 0, batchSize = 1000;
    while (true) {
      const { data, error } = await withOrg(supabase.from('jobs')
        .select('id,freshness,industry,timezone,is_duplicate,company:companies(industry)')
        .is('deleted_at', null).eq('stage', 'Unassigned').is('assigned_to_bd', null)
        .range(from, from + batchSize - 1), req);
      if (error) throw error;
      if (!data || !data.length) break;
      pool = pool.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    // by_freshness was missing while `freshness` was being selected — so the
    // preview's Freshness column was structurally always empty, whatever the
    // pool contained and whichever engine produced the split.
    const stats = { total: pool.length, by_freshness: {}, by_industry: {}, by_timezone: {}, duplicates: 0 };
    pool.forEach(j => {
      const rawInd = j.industry || j.company?.industry || '';
      const ind = normInd(rawInd) || 'Unknown';
      const fresh = j.freshness || 'Unknown';
      stats.by_freshness[fresh] = (stats.by_freshness[fresh] || 0) + 1;
      stats.by_industry[ind] = (stats.by_industry[ind] || 0) + 1;
      stats.by_timezone[j.timezone || 'Unknown'] = (stats.by_timezone[j.timezone || 'Unknown'] || 0) + 1;
      if (j.is_duplicate) stats.duplicates++;
    });
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/distribute/today-summary', auth, async (req, res) => {
  try {
    const targetId = req.query.manager_id || req.user.id;
    const { data: jobs } = await withOrg(supabase.from('jobs').select('id,industry,timezone,assigned_at,company:companies(industry)').eq('assigned_to_bd', targetId).gte('assigned_at', today() + 'T00:00:00Z'), req);
    const summary = { total: jobs?.length || 0, by_industry: {}, by_timezone: {} };
    (jobs || []).forEach(j => {
      const rawInd = j.industry || j.company?.industry || '';
      const ind = normInd(rawInd) || 'Unknown';
      summary.by_industry[ind] = (summary.by_industry[ind] || 0) + 1;
      summary.by_timezone[j.timezone || 'Unknown'] = (summary.by_timezone[j.timezone || 'Unknown'] || 0) + 1;
    });
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
