// ============================================================================
// RESUME PARSING + RECRUITING LOOKUPS (managed taxonomies).
// Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { parseResume } = require('../../resume-parser');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;

  // RESUME PARSING — file → candidate fields (AI-assisted, rule fallback)
  // ==========================================================================

  // Parse an uploaded resume and return candidate fields for the UI to prefill.
  // Creates nothing — the recruiter reviews before saving.
  app.post('/candidates/parse-resume', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
      const raw = String(b.data_base64).replace(/^data:.*;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'empty file' });
      if (buffer.length > 4.5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });
      const { fields, used_ai, text } = await parseResume(buffer, b.filename, supabase, req.orgId);
      res.json({ fields, used_ai, resume_text: text });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ==========================================================================
  // RECRUITING LOOKUPS — managed taxonomies (Slice 6)
  // ==========================================================================

  const LOOKUP_CATEGORIES = ['work_authorization','source','applicant_status','availability','pay_type'];
  function isLookupAdmin(req){ return hasRole(req, 'admin', 'bd_lead'); }

  // GET /recruiting-lookups        → { category: [value, …] } (active only)
  // GET /recruiting-lookups?all=1  → { category: [{id,value,sort_order,is_active}, …] } (management)
  app.get('/recruiting-lookups', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('recruiting_lookups')
        .select('id,category,value,sort_order,is_active')
        .order('category', { ascending: true }).order('sort_order', { ascending: true });
      if (error) throw error;
      const grouped = {};
      LOOKUP_CATEGORIES.forEach(c => { grouped[c] = []; });
      (data || []).forEach(r => { (grouped[r.category] = grouped[r.category] || []).push(r); });
      if (req.query.all === '1') return res.json(grouped);
      const active = {};
      Object.keys(grouped).forEach(c => { active[c] = grouped[c].filter(r => r.is_active).map(r => r.value); });
      res.json(active);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/recruiting-lookups', auth, async (req, res) => {
    try {
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      const b = req.body || {};
      if (!LOOKUP_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Invalid category.' });
      if (!b.value || !String(b.value).trim()) return res.status(400).json({ error: 'value required' });
      const { data: last } = await supabase.from('recruiting_lookups')
        .select('sort_order').eq('category', b.category).order('sort_order', { ascending: false }).limit(1);
      const nextOrder = (last && last.length) ? (last[0].sort_order + 1) : 0;
      const { data, error } = await supabase.from('recruiting_lookups')
        .insert({ category: b.category, value: String(b.value).trim(), sort_order: nextOrder }).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That value already exists in this list.' });
        throw error;
      }
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/admin/recruiting-lookups/:id', auth, async (req, res) => {
    try {
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      const b = req.body || {};
      const updates = {};
      if (b.value !== undefined) updates.value = String(b.value).trim();
      if (b.is_active !== undefined) updates.is_active = !!b.is_active;
      if (b.sort_order !== undefined) updates.sort_order = parseInt(b.sort_order, 10) || 0;
      const { data, error } = await supabase.from('recruiting_lookups')
        .update(updates).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/admin/recruiting-lookups/:id', auth, async (req, res) => {
    try {
      if (!isLookupAdmin(req)) return res.status(403).json({ error: 'Admin or BD Lead only.' });
      await supabase.from('recruiting_lookups').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
};
