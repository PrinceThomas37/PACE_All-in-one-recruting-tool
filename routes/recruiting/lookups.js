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
  // THE UPLOAD CHECKS ITSELF. A resume travels as base64 inside a JSON body,
  // and a PDF whose last bytes are missing fails with pdf.js's "Invalid PDF
  // structure" — a sentence that names neither the cause nor the cure, and that
  // sent a whole session hunting the wrong thing. The browser knows exactly how
  // many bytes it read, so it says so, and this compares. A mismatch is upload
  // damage, stated as such, with both numbers; anything else is genuinely the
  // document. Declared size is a HINT, never a gate — an older cached page
  // sends none, and must keep working.
  app.post('/candidates/parse-resume', auth, async (req, res) => {
    const b = req.body || {};
    let buffer = null;
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
      const raw = String(b.data_base64).replace(/^data:[^,]*;base64,/, '');
      buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'The file arrived empty. Please choose it again and retry.' });
      if (buffer.length > 4.5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });

      const declared = Number(b.size);
      if (Number.isFinite(declared) && declared > 0 && declared !== buffer.length) {
        const lost = declared - buffer.length;
        await recordResumeFailure(supabase, req, b, buffer, 'size_mismatch: ' + buffer.length + ' of ' + declared);
        return res.status(400).json({
          error: 'The file was damaged on the way up — ' + buffer.length.toLocaleString() + ' of '
               + declared.toLocaleString() + ' bytes arrived' + (lost > 0 ? ' (' + lost.toLocaleString() + ' missing)' : '')
               + '. Please try attaching it again.',
        });
      }

      const { fields, used_ai, text } = await parseResume(buffer, b.filename, supabase, req.orgId);
      res.json({ fields, used_ai, resume_text: text });
    } catch (err) {
      // The recruiter gets the sentence; the record keeps what the library
      // actually said, so a failure nobody can reproduce is still diagnosable
      // from the outside. Best-effort — a diagnostic must never be the reason
      // an upload fails.
      await recordResumeFailure(supabase, req, b, buffer, (err && err.cause && err.cause.message) || err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // One row, overwritten: "why did the last resume fail", not a history. Same
  // shape and reasoning as ai_last_error — no migration, and it answers the
  // question from the database rather than asking the user to transcribe it.
  async function recordResumeFailure(store, req, body, buffer, reason) {
    try {
      const len = buffer ? buffer.length : 0;
      await store.from('app_settings').upsert({
        key: 'resume_parse_last_error',
        value: JSON.stringify({
          at: new Date().toISOString(),
          filename: String(body.filename || '').slice(0, 120),
          content_type: String(body.content_type || '').slice(0, 80),
          declared_size: Number(body.size) || null,
          received_size: len,
          // Enough of the bytes to classify the file without storing it.
          head: buffer ? buffer.subarray(0, 8).toString('latin1') : '',
          tail: buffer ? buffer.subarray(Math.max(0, len - 24)).toString('latin1') : '',
          has_eof: buffer ? buffer.subarray(Math.max(0, len - 2048)).toString('latin1').includes('%%EOF') : false,
          base64_len: String(body.data_base64 || '').length,
          reason: String(reason || '').slice(0, 300),
          node: process.version,
          user: req.user && req.user.id,
        }),
        updated_at: new Date(),
      }, { onConflict: 'key' });
    } catch (_) { /* never let the record break the upload */ }
  }

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
