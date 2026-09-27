// ============================================================================
// THE POC FINDER — server side (R-053, D-0049; docs/CONTACT_FINDER_DESIGN.md).
// Slice 1: the four slots for a lead, filled from the people already on it,
// the company's email format, and the company-size pick. The RULES are
// services/poc-targets.js (pure); this file is only the database around them.
//
//   GET /jobs/:id/poc           — size, the job's function, the four slots, the
//                                 people who fit none, the company's email
//                                 format, and whether the caller may change it.
//   PUT /jobs/:id/company-size  — the size pick, remembered for the COMPANY.
//
// Seeing follows the lead's own rule (own.canSeeLead → 404 otherwise, the same
// shape as GET /jobs/:id: a 403 would confirm the lead exists). Changing
// follows canTouchJob — the same gate as adding a contact to the lead.
//
// The format is learned from addresses on the company's OTHER leads too, but
// only the pattern and a count leave this file — never another lead's people,
// which the caller may not be allowed to see (D-0034).
// ============================================================================
const express = require('express');
const poc = require('../services/poc-targets');
const own = require('../services/ownership');
const { createDb } = require('../models');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, canTouchJob, orgIdFor } = ctx;
  const db = ctx.db || createDb(supabase);
  const { reportingChainIds } = require('../hierarchy')(supabase);

  async function scopeFor(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  // The lead, if this caller may see it; null otherwise (the caller answers 404).
  async function visibleLead(req, id) {
    const { data } = await db.forRequest(req).from('jobs')
      .select('id,company_id,position,industry,stage,created_by,assigned_to,assigned_to_bd,org_id')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    if (!data) return null;
    return own.canSeeLead(data, await scopeFor(req)) ? data : null;
  }

  async function payload(req, lead) {
    let company = null;
    if (lead.company_id) {
      const { data } = await db.forRequest(req).from('companies')
        .select('id,name,website,size_band').eq('id', lead.company_id).maybeSingle();
      company = data || null;
    }
    const { data: contacts } = await db.forRequest(req).from('contacts')
      .select('id,first_name,last_name,designation,email,email_status,is_primary').eq('job_id', lead.id);

    // Addresses at the same company on its other leads — for the FORMAT only.
    let forFormat = (contacts || []).slice();
    if (lead.company_id) {
      const { data: sibs } = await db.forRequest(req).from('jobs')
        .select('id').eq('company_id', lead.company_id).is('deleted_at', null).limit(50);
      const ids = (sibs || []).map(s => s.id).filter(x => x !== lead.id);
      if (ids.length) {
        const { data: more } = await db.forRequest(req).from('contacts')
          .select('first_name,last_name,email').in('job_id', ids).limit(300);
        forFormat = forFormat.concat(more || []);
      }
    }

    const targets = poc.pocTargets({ position: lead.position, industry: lead.industry }, company && company.size_band);
    const filled = poc.fillSlots(targets, contacts || []);
    const format = poc.learnFormat(forFormat, company && company.website);
    return {
      lead_id: lead.id,
      company_id: lead.company_id || null,
      company_name: (company && company.name) || null,
      size: targets.size,
      size_known: targets.size_known,
      sizes: poc.SIZE_BANDS,
      function: targets.function,
      slots: filled.slots.map(s => ({ key: s.key, kind: s.kind, label: s.label, titles: s.titles, contact_id: s.contact_id })),
      others: filled.others,
      found: filled.slots.filter(s => s.contact_id).length,
      // pattern + domain + how many real addresses agree. `example` shows the
      // shape on a made-up name; null when the format is not known — and then
      // nothing builds an address at all (D-0049: a guess is never emailed).
      format: {
        domain: format.domain,
        pattern: format.pattern,
        learned_from: format.learned_from,
        example: format.pattern ? poc.emailFor('Jane', 'Smith', format) : null,
      },
      can_edit: await canTouchJob(req, lead.id),
    };
  }

  router.get('/jobs/:id/poc', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      res.json(await payload(req, lead));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/jobs/:id/company-size', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can change it.' });
      if (!lead.company_id) return res.status(409).json({ error: 'This lead has no company to size.' });
      const raw = req.body && req.body.size;
      const size = raw === null || raw === '' ? null : poc.normalizeSize(raw);
      if (raw != null && raw !== '' && !size) return res.status(400).json({ error: 'Pick one of the listed sizes.' });
      const { error } = await db.forRequest(req).from('companies')
        .update({ size_band: size, updated_at: new Date() }).eq('id', lead.company_id);
      if (error) throw error;
      res.json(await payload(req, lead));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
