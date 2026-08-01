// ============================================================================
// LOOKUPS — small form-support endpoints used by the RA job-entry form:
// industry list, US zip-code → city/state, and the recent-duplicate email check.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/lookups')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const { fetchWithRetry } = require('../http-client');

// Zip lookup fires per keystroke from the autocomplete, so it gets a short
// budget — a slow third party must never hold an app request handler open.
const ZIP_TIMEOUT_MS = 5000;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, INDUSTRIES } = ctx;

router.get('/industries', auth, (req, res) => res.json(INDUSTRIES));

router.get('/lookup/zipcode', auth, async (req, res) => {
  try {
    const { zip } = req.query;
    if (!zip || zip.length < 3) return res.json([]);
    const resp = await fetchWithRetry(`https://api.zippopotam.us/us/${encodeURIComponent(zip.trim())}`, {}, { timeoutMs: ZIP_TIMEOUT_MS, retries: 1 });
    if (!resp.ok) return res.json([]);
    const data = await resp.json();
    const places = (data.places || []).map(p => ({
      zip: data['post code'], city: p['place name'], state: p['state'],
      state_abbr: p['state abbreviation'],
      display: `${p['place name']}, ${p['state abbreviation']} ${data['post code']}`
    }));
    res.json(places);
  } catch (err) { res.json([]); }
});

router.post('/contacts/check-email', auth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ duplicate: false });
    const twoMonthsAgo = new Date(); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const { data, error } = await supabase.from('contacts')
      .select('id,first_name,last_name,email,created_at,job:jobs(id,position,company:companies(name))')
      .eq('email', email.toLowerCase().trim()).gte('created_at', twoMonthsAgo.toISOString()).limit(1);
    if (error) throw error;
    if (!data?.length) return res.json({ duplicate: false });
    const c = data[0];
    const daysSince = Math.floor((new Date() - new Date(c.created_at)) / 86400000);
    res.json({ duplicate: true, days_ago: daysSince, contact_name: `${c.first_name} ${c.last_name}`.trim(), company: c.job?.company?.name || '', position: c.job?.position || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
