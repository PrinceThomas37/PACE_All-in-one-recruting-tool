// ============================================================================
// CANDIDATES — the shared applicant pool, plus per-candidate notes and
// documents. Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { parseResume } = require('../../resume-parser');
const entitlements = require('../../services/entitlements');
const createCandidateFields = require('../../services/candidate-fields');

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
  const { CANDIDATE_FIELDS, CANDIDATE_SELECT, pickCandidateFields,
          normName, normEmail, normPhone, findCandidateDuplicates } = createCandidateFields(core);

  // CANDIDATES — shared pool (Ceipal-style Applicants database)
  // ==========================================================================
  // GET /candidates
  //  - legacy (no ?page): returns a plain array (used by the job-page add modal)
  //  - paged  (?page=N):  returns { data, total, page, limit } for the Applicants grid
  app.get('/candidates', auth, async (req, res) => {
    try {
      const paged = req.query.page !== undefined;
      const q = (req.query.q || '').trim().replace(/[,()]/g, ' ').trim();  // strip or()-structural chars
      let query = withOrg(supabase.from('candidates')
        .select(CANDIDATE_SELECT, paged ? { count: 'exact' } : undefined)
        .is('deleted_at', null), req);
      if (q) query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,phone.ilike.%${q}%,current_title.ilike.%${q}%`
      );
      if (req.query.applicant_status) query = query.eq('applicant_status', req.query.applicant_status);
      if (req.query.source) query = query.eq('source', req.query.source);
      if (req.query.state) query = query.eq('state', req.query.state);
      if (req.query.work_authorization) query = query.eq('work_authorization', req.query.work_authorization);
      if (req.query.owner_id) query = query.eq('owner_id', req.query.owner_id);
      if (req.query.availability) query = query.eq('availability', req.query.availability);
      if (req.query.experience_min) query = query.gte('experience_years', parseFloat(req.query.experience_min));
      if (req.query.experience_max) query = query.lte('experience_years', parseFloat(req.query.experience_max));
      if (req.query.created_from) query = query.gte('created_at', req.query.created_from);
      if (req.query.created_to) query = query.lte('created_at', req.query.created_to);
      if (req.query.has_resume === '1') query = query.or('resume_url.not.is.null,resume_filename.not.is.null');
      query = query.order('created_at', { ascending: false });

      if (paged) {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const from = (page - 1) * limit;
        const { data, error, count } = await query.range(from, from + limit - 1);
        if (error) throw error;
        return res.json({ data: data || [], total: count || 0, page, limit });
      }
      const { data, error } = await query.limit(100);
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /candidates/check-duplicate?full_name=&email=&phone=
  // Registered before /candidates/:id so the literal path wins the match.
  app.get('/candidates/check-duplicate', auth, async (req, res) => {
    try {
      const dups = await findCandidateDuplicates({
        full_name: req.query.full_name, email: req.query.email,
        phone: req.query.phone, excludeId: req.query.exclude_id, req
      });
      res.json({ duplicate: dups.length > 0, duplicates: dups });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /candidates/status-counts?statuses=a,b,c
  //
  // Feeds the stat strip at the top of the Candidates page: how many people sit
  // in each status, right now, across everything the caller can see. Answered
  // with one HEAD count per status (`head:true` returns the number and no rows),
  // so the cost is a handful of index counts rather than reading the pool.
  //
  // The status VOCABULARY comes from the caller, not from here. Statuses are a
  // per-org managed lookup, so the page that renders the strip is the only thing
  // that knows the current list; hard-coding it here would make a customer's
  // renamed status silently vanish from their own strip.
  //
  // Registered before /candidates/:id so the literal path wins the match.
  app.get('/candidates/status-counts', auth, async (req, res) => {
    try {
      const asked = String(req.query.statuses || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 24);
      const base = () => withOrg(
        supabase.from('candidates').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        req
      );
      const [{ count: total }, ...rest] = await Promise.all([
        base(),
        ...asked.map(s => base().eq('applicant_status', s)),
      ]);
      const counts = {};
      asked.forEach((s, i) => { counts[s] = rest[i].count || 0; });
      res.json({ total: total || 0, counts });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/candidates/:id', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidates')
        .select(CANDIDATE_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !data) return res.status(404).json({ error: 'Candidate not found' });
      const reqOrg = orgIdFor(req);
      if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Candidate not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // A candidate's recruiting history across every job — pipelines, submissions,
  // and the stage-change activity that drives the profile lifecycle bar.
  app.get('/candidates/:id/history', auth, async (req, res) => {
    try {
      const cid = req.params.id;
      const JOB = 'job:job_orders(id,job_code,job_title,client)';
      const { data: pipeline } = await supabase.from('candidate_pipeline')
        .select('id,pipeline_code,pipeline_status,job_order_id,tagged_at,submission_id,' + JOB)
        .eq('candidate_id', cid).is('deleted_at', null).order('tagged_at', { ascending: false });
      const { data: submissions } = await supabase.from('submissions')
        .select('id,submission_code,stage,job_order_id,submitted_at,created_at,bdm_approved_at,pipeline_id,revision_status,' + JOB)
        .eq('candidate_id', cid).is('deleted_at', null).order('created_at', { ascending: false });
      let activity = [];
      const subIds = (submissions || []).map(s => s.id);
      if (subIds.length) {
        const { data: act } = await supabase.from('submission_activity')
          .select('id,submission_id,job_order_id,action,old_stage,new_stage,note,created_at')
          .in('submission_id', subIds).order('created_at', { ascending: true });
        activity = act || [];
      }
      res.json({ pipeline: pipeline || [], submissions: submissions || [], activity });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      const b = req.body || {};
      if (!b.full_name || !String(b.full_name).trim()) return res.status(400).json({ error: 'full_name required' });

      // Duplicate catch — name + (email or phone). Warn-and-offer: unless `force`,
      // return the matches (409) so the UI can offer "open existing" over a copy.
      if (!b.force) {
        const dups = await findCandidateDuplicates({ full_name: b.full_name, email: b.email, phone: b.phone, req });
        if (dups.length) return res.status(409).json({ error: 'possible_duplicate', duplicates: dups });
      }

      const code = await nextId('CN');
      const row = Object.assign(pickCandidateFields(b), {
        candidate_code: code,
        applicant_status: b.applicant_status || 'New lead',
        owner_id: b.owner_id || req.user.id,
        created_by: req.user.id
      }, orgStamp(req));
      if (Array.isArray(b.tags)) row.tags = b.tags;
      const { data, error } = await supabase.from('candidates').insert(row).select(CANDIDATE_SELECT).single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/candidates/:id', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      const b = req.body || {};
      const updates = Object.assign(pickCandidateFields(b), { updated_at: new Date(), updated_by: req.user.id });
      if (b.owner_id !== undefined) updates.owner_id = b.owner_id || null;
      if (Array.isArray(b.tags)) updates.tags = b.tags;
      const { data, error } = await supabase.from('candidates')
        .update(updates).eq('id', req.params.id).select(CANDIDATE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      await supabase.from('candidates').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // CANDIDATE NOTES & DOCUMENTS (Slice 5)
  // ==========================================================================

  const NOTE_TYPES = ['job_posting', 'applicant_reference'];
  const DOC_BUCKET = 'candidate-docs';
  const MAX_DOC_BYTES = 4.5 * 1024 * 1024;   // fits the 5mb express json limit after base64
  let _bucketEnsured = false;
  async function ensureDocBucket() {
    if (_bucketEnsured) return;
    try { await supabase.storage.createBucket(DOC_BUCKET, { public: false }); } catch (_) { /* exists */ }
    _bucketEnsured = true;
  }

  // ── notes ────────────────────────────────────────────────────────────────
  app.get('/candidates/:id/notes', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidate_notes')
        .select('*, author:users!created_by(id,name,employee_id)')
        .eq('candidate_id', req.params.id).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates/:id/notes', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      const b = req.body || {};
      if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: 'body required' });
      const noteType = NOTE_TYPES.includes(b.note_type) ? b.note_type : 'applicant_reference';
      const { data, error } = await supabase.from('candidate_notes').insert({
        candidate_id: req.params.id, job_order_id: b.job_order_id || null,
        note_type: noteType, body: String(b.body), created_by: req.user.id
      }).select('*, author:users!created_by(id,name,employee_id)').single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id/notes/:noteId', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      await supabase.from('candidate_notes').update({ deleted_at: new Date() })
        .eq('id', req.params.noteId).eq('candidate_id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── documents (stored in the private candidate-docs bucket) ────────────────
  app.get('/candidates/:id/documents', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('candidate_documents')
        .select('*, uploader:users!uploaded_by(id,name,employee_id)')
        .eq('candidate_id', req.params.id).is('deleted_at', null)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      // attach a short-lived signed URL for each (private bucket)
      const rows = await Promise.all((data || []).map(async (d) => {
        let url = null;
        try {
          const { data: s } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
          url = s ? s.signedUrl : null;
        } catch (_) { /* leave null */ }
        return Object.assign({}, d, { url });
      }));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/candidates/:id/documents', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      const b = req.body || {};
      if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
      const raw = String(b.data_base64).replace(/^data:.*;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'empty file' });
      if (buffer.length > MAX_DOC_BYTES) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });

      await ensureDocBucket();
      const safe = String(b.filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      const path = req.params.id + '/' + Date.now() + '-' + safe;
      const { error: upErr } = await supabase.storage.from(DOC_BUCKET)
        .upload(path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;

      const docType = ['resume', 'cover_letter', 'other'].includes(b.doc_type) ? b.doc_type : 'resume';
      const { data, error } = await supabase.from('candidate_documents').insert({
        candidate_id: req.params.id, doc_type: docType, filename: String(b.filename),
        storage_path: path, content_type: b.content_type || null, size_bytes: buffer.length,
        uploaded_by: req.user.id
      }).select('*, uploader:users!uploaded_by(id,name,employee_id)').single();
      if (error) throw error;

      // convenience: if this is the first résumé, backfill candidate.resume_url metadata
      if (docType === 'resume') {
        try { await supabase.from('candidates').update({ resume_filename: String(b.filename) }).eq('id', req.params.id); } catch (_) {}
      }
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/candidates/:id/documents/:docId', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const gate = await entitlements.gate(supabase, req, 'candidates', { orgIdFor });
      if (gate.blocked) return res.status(gate.status).json(gate.body);
      const { data: doc } = await supabase.from('candidate_documents')
        .select('storage_path').eq('id', req.params.docId).eq('candidate_id', req.params.id).single();
      await supabase.from('candidate_documents').update({ deleted_at: new Date() })
        .eq('id', req.params.docId).eq('candidate_id', req.params.id);
      if (doc && doc.storage_path) { try { await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]); } catch (_) {} }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
