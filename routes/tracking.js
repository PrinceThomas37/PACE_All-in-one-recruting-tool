// ============================================================================
// EMAIL TRACKING (slice 1 — infrastructure)
// The public open-tracking pixel + a read endpoint for a candidate's email
// activity. Nothing writes tracking rows yet (that's the send-path slice); this
// module is safe and self-contained — it never touches the live send code.
// ============================================================================
const express = require('express');
const { TRANSPARENT_GIF } = require('../email-tracking');
const { clientIp } = require('../middleware/rate-limit');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, pixelLimiter } = ctx;

  // Public tracking pixel — the recipient's email client requests this when the
  // message is opened. Always returns the gif (even for an unknown/blank token)
  // so nothing about our data is revealed, and an open is never allowed to error.
  router.get('/o/:token', async (req, res) => {
    const token = String(req.params.token || '').replace(/\.gif$/i, '').trim();
    // Rate limited by SKIPPING THE DB WORK, never by returning an error: a mail
    // client that gets a 429 instead of an image renders a broken-image box to
    // the recipient, which is worse than an uncounted open. Over the limit, the
    // pixel still returns — we just stop paying for the read+write.
    const withinLimit = pixelLimiter ? pixelLimiter.consume(`pixel:${clientIp(req)}`).allowed : true;
    try {
      if (token && withinLimit) {
        const { data } = await supabase.from('email_tracking')
          .select('id,open_count,opened_at').eq('token', token).maybeSingle();
        if (data) {
          const now = new Date();
          await supabase.from('email_tracking').update({
            open_count: (data.open_count || 0) + 1,
            opened_at: data.opened_at || now,
            last_open_at: now
          }).eq('id', data.id);
        }
      }
    } catch (_) { /* a tracking failure must never break the pixel */ }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.end(TRANSPARENT_GIF);
  });

  // A candidate's tracked email activity (for the "opened / replied" UI to come).
  router.get('/candidates/:id/email-activity', auth, async (req, res) => {
    try {
      let q = supabase.from('email_tracking').select('*')
        .eq('candidate_id', req.params.id).order('sent_at', { ascending: false });
      if (req.orgId) q = q.eq('org_id', req.orgId);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
