// ============================================================================
// CAN THIS COMPANY BE ADDED? — what a screen asks BEFORE the person acts.
//
//   POST /lead-check   { company_id?, name?, website?, linkedin? }
//     → { state: 'free' | 'active_job' | 'cooldown', blocked, company_id, company_name, matched_on,
//         matched_text, owner_name, position, days_left, days_ago, sentence }
//
// The rule is services/lead-decision.js; the loading is services/lead-check.js; the same answer
// is enforced where a lead is really created (approving a sourced lead, POST /jobs), so this
// endpoint only lets a screen say "no" early and plainly — it is never the only guard.
// Only the caller's own organisation is ever looked at (D-0090).
// ============================================================================
const express = require('express');
const leadCheck = require('../services/lead-check');
const { createDb } = require('../models');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole } = ctx;
  const db = ctx.db || createDb(supabase);

  router.post('/lead-check', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin', 'bd', 'bd_lead', 'ra', 'ra_lead', 'director', 'associate_director')) {
        return res.status(403).json({ error: 'Not permitted.' });
      }
      const b = req.body || {};
      const candidate = {
        company_id: b.company_id ? String(b.company_id) : null,
        name: String(b.name || '').slice(0, 300),
        website: String(b.website || '').slice(0, 500),
        linkedin: String(b.linkedin || '').slice(0, 500),
      };
      if (!candidate.company_id && !candidate.name.trim() && !candidate.website.trim() && !candidate.linkedin.trim()) {
        return res.status(400).json({ error: 'Give a company name, website, LinkedIn page or company to check.' });
      }
      const d = await leadCheck.checkCompany({ db, supabase, req, candidate });
      res.json(leadCheck.publicDecision(d));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
