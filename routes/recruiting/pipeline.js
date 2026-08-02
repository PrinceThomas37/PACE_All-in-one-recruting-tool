// ============================================================================
// PIPELINE — the candidate tagging layer (Ceipal's "Pipeline" tab). A
// candidate is TAGGED onto a job order, then PROMOTED into a submission.
// Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { EVENTS, emit } = require('../../events');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, notGuest, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    SUBMISSION_SELECT, SUBMISSION_FIELDS,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;

  // PIPELINE — candidate tagging layer (Ceipal "Pipeline" tab)
  // A candidate is TAGGED into a job order, then PROMOTED to a submission.
  // ==========================================================================

  const PIPELINE_STATUSES = ['Tagged','Contacted','Interested','Screening','Shortlisted','Moved to Submission','Not Interested','Rejected'];
  // The Pipeline tab is the FULL roster for a job: promoted rows join their
  // submission so the grid can show the live submission stage instead of the
  // static "Moved to Submission".
  const PIPELINE_SELECT =
    '*, candidate:candidates(id,candidate_code,full_name,email,phone,work_authorization,' +
    'current_title,headline,skills,city,state,country,current_location,experience_years,' +
    'availability,notice_period,current_ctc,bill_rate,pay_rate,source,resume_url), ' +
    'tagger:users!tagged_by(id,name,employee_id), ' +
    'submission:submissions!candidate_pipeline_submission_id_fkey(id,submission_code,stage,sub_stage)';

  // list the pipeline (tagged candidates) for a job order — the Pipeline-tab grid
  app.get('/job-orders/:id/pipeline', auth, async (req, res) => {
    try {
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await supabase.from('candidate_pipeline')
        .select(PIPELINE_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('tagged_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // tag a candidate (from the pool) into a job order's pipeline
  app.post('/pipeline', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // snapshot rate/availability/employer from the candidate (overridable via body)
      const { data: cand } = await supabase.from('candidates')
        .select('work_authorization,bill_rate,pay_rate,current_employer,availability,notice_period,current_ctc,source')
        .eq('id', b.candidate_id).single();
      const c = cand || {};
      const pick = (k, fallback) => (b[k] !== undefined ? b[k] : (fallback || null));
      const row = {
        pipeline_code: await nextId('PL'),
        candidate_id: b.candidate_id, job_order_id: b.job_order_id,
        pipeline_status: b.pipeline_status || 'Tagged',
        work_auth_snap: pick('work_auth_snap', c.work_authorization),
        bill_rate: pick('bill_rate', c.bill_rate),
        pay_rate: pick('pay_rate', c.pay_rate),
        employer_name: pick('employer_name', c.current_employer),
        availability: pick('availability', c.availability),
        notice_period: pick('notice_period', c.notice_period),
        current_ctc: pick('current_ctc', c.current_ctc),
        source: pick('source', c.source),
        notes: b.notes || null,
        tagged_by: req.user.id
      };
      Object.assign(row, orgStamp(req));
      const { data, error } = await supabase.from('candidate_pipeline').insert(row).select(PIPELINE_SELECT).single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This candidate is already tagged to this job.' });
        throw error;
      }
      await logSubmissionActivity(null, b.job_order_id, req.user.id, 'tagged', null, 'Tagged', null);
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // change a pipeline entry's status
  app.patch('/pipeline/:id/status', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const st = req.body.status;
      if (!PIPELINE_STATUSES.includes(st)) return res.status(400).json({ error: `Invalid pipeline status. Allowed: ${PIPELINE_STATUSES.join(', ')}` });
      const { data: row, error: e0 } = await supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !row) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, row.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await supabase.from('candidate_pipeline')
        .update({ pipeline_status: st, updated_at: new Date() }).eq('id', req.params.id).select(PIPELINE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // edit a pipeline entry's snapshot fields (rate / availability / employer …)
  app.patch('/pipeline/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: row, error: e0 } = await supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !row) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, row.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const allowed = ['work_auth_snap','bill_rate','pay_rate','employer_name','availability','notice_period','current_ctc','source','notes','pipeline_status'];
      const b = req.body || {};
      const updates = { updated_at: new Date() };
      allowed.forEach(k => { if (b[k] !== undefined) updates[k] = (b[k] === '' ? null : b[k]); });
      const { data, error } = await supabase.from('candidate_pipeline')
        .update(updates).eq('id', req.params.id).select(PIPELINE_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // promote a pipeline entry into a formal submission
  app.post('/pipeline/:id/promote', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: pl, error: e0 } = await supabase.from('candidate_pipeline')
        .select('*').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !pl) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, pl.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // already promoted → return the linked submission
      if (pl.submission_id) {
        const { data: existing } = await supabase.from('submissions').select(SUBMISSION_SELECT).eq('id', pl.submission_id).single();
        return res.json({ pipeline_id: pl.id, submission: existing, already: true });
      }

      const targetStage = req.body.stage || 'Submitted to BDM';
      let submission;
      const { data: sub, error } = await supabase.from('submissions').insert({
        ...orgStamp(req),
        submission_code: await nextId('SB'),
        candidate_id: pl.candidate_id, job_order_id: pl.job_order_id,
        recruiter_id: req.user.id, stage: targetStage,
        pipeline_id: pl.id, revision_status: 'N/A',
        bill_rate: pl.bill_rate || null, pay_rate: pl.pay_rate || null,
        employer_name: pl.employer_name || null, availability: pl.availability || null,
        notice_period: pl.notice_period || null,
        submitted_rate: pl.pay_rate || null, notes: pl.notes || null,
        submitted_by: req.user.id, submitted_at: new Date()
      }).select(SUBMISSION_SELECT).single();
      if (error) {
        if (error.code === '23505') {
          // a submission already exists for this candidate+job — link to it
          const { data: existing } = await supabase.from('submissions').select(SUBMISSION_SELECT)
            .eq('candidate_id', pl.candidate_id).eq('job_order_id', pl.job_order_id).is('deleted_at', null).single();
          submission = existing;
        } else throw error;
      } else submission = sub;
      if (!submission) return res.status(500).json({ error: 'Could not create or find the submission.' });

      await supabase.from('candidate_pipeline')
        .update({ submission_id: submission.id, pipeline_status: 'Moved to Submission', updated_at: new Date() })
        .eq('id', pl.id);
      await logSubmissionActivity(submission.id, pl.job_order_id, req.user.id, 'promoted', 'Tagged', targetStage, null);
      emit(EVENTS.SUBMISSION_ADVANCED, { submissionId: submission.id, jobOrderId: pl.job_order_id, fromStage: null, toStage: targetStage, actorUserId: req.user.id });
      res.status(201).json({ pipeline_id: pl.id, submission });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/pipeline/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('candidate_pipeline').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
};
