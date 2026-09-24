// ============================================================================
// DOMAIN EVENTS — recent event-log viewer (admins / leads).
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/events')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, orgIdFor } = ctx;

// C-0021 X4: `domain_events` is a GLOBAL table — "org lives inside the
// payload" (models/tables.js) — and until this fix nothing ever put it there
// or read it back, so every org's admin/bd_lead/ra_lead saw every OTHER org's
// events: prospect addresses (EMAIL_SENT.toEmail, CONTACT_REPLIED.from,
// EMAIL_BOUNCED.address) and the job/submission/candidate ids that unlock
// every by-id hole named elsewhere in this contract. `emit()` itself is
// unchanged (events.js is the bus, not this reader) — callers now pass
// `orgId` in the payload where it is cheaply available (see index.js).
// A row with no `orgId` in its payload — every row emitted before this
// change, and any call site not yet updated — is excluded, never shown to
// everyone: the safe default the contract asked for. Admin sees the whole
// ORGANISATION here, not the whole deployment, matching D-0034.
router.get('/events/recent', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const org = orgIdFor(req);
    let q = supabase.from('domain_events')
      .select('id,event,payload,actor_user_id,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.event) q = q.eq('event', req.query.event);
    // Only an org resolves this filter; with none (should not happen past
    // auth()) it falls back to the pre-fix behaviour rather than erroring.
    if (org) q = q.eq('payload->>orgId', org);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
