'use strict';
// ============================================================================
// PUBLIC: the website's "Book a walkthrough" form (R-216, D-0137).
// The rules — what a request becomes and where — are services/site-requests.js.
//
// Unauthenticated, so it is rate limited in index.js beside the other public
// endpoints, and it answers the SAME thing for a new email, a repeat and a bot
// (a filled honeypot) — otherwise it would tell a stranger who has asked before.
// Where requests land is the deployment's WEBSITE_LEADS_ORG_ID; read per
// request so a change in Render's environment needs no code.
// ============================================================================
const express = require('express');
const siteRequests = require('../services/site-requests');

module.exports = function siteRequestRoutes(ctx) {
  const router = express.Router();

  router.post('/site/walkthrough-request', async (req, res) => {
    const parsed = siteRequests.parseRequest(req.body);
    if (parsed.spam) return res.json({ ok: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const out = await siteRequests.recordWalkthroughRequest({
        db: ctx.db,
        orgId: process.env.WEBSITE_LEADS_ORG_ID || null,
        request: parsed.request,
        now: new Date(),
      });
      if (out.lead_error) {
        // Kept, but not in anyone's lead list — the operator must be able to see that.
        console.error(`[site] walkthrough request from ${parsed.request.email} was kept but no lead was made: ${out.lead_error}`);
      } else if (out.destination === 'none') {
        console.warn(`[site] walkthrough request from ${parsed.request.email} kept; WEBSITE_LEADS_ORG_ID is not set, so no lead was made`);
      } else {
        console.log(`[site] walkthrough request from ${parsed.request.email} → ${out.new_lead ? 'new lead' : 'existing lead'} ${out.lead_id}${out.reminded ? ', admin reminded' : ', NO admin to remind'}`);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[site] walkthrough request could not be kept:', err.message);
      res.status(500).json({ error: 'Your request could not be sent. Please email info@paceconsultant.in.' });
    }
  });

  return router;
};
