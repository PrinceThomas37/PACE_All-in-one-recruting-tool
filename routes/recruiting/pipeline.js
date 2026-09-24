// ============================================================================
// PIPELINE — the candidate tagging layer (Ceipal's "Pipeline" tab). A
// candidate is TAGGED onto a job order, then PROMOTED into a submission.
// Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { EVENTS, emit } = require('../../events');
const applicants = require('../../services/applicants');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, today,
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
      // recruiterCanTouchJob only narrows a pure recruiter — every other role
      // passes unconditionally, so the org check has to live here, on the job
      // order itself, or a BDM in another org could read this whole roster.
      const { data: jo } = await withOrg(
        supabase.from('job_orders').select('id').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await supabase.from('candidate_pipeline')
        .select(PIPELINE_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('tagged_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── "ON A JOB" MEANS A SUBMISSIONS ROW (Session 28), SO TAGGING WRITES ONE ──
  // Session 31: the owner tagged candidates to a job from the database and
  // they never appeared on the job's own page. Measured on the live database:
  // all 15 tagged candidates had a `candidate_pipeline` row and NO
  // `submissions` row, while the job page, the board, the funnel and every
  // report read `submissions`. The applicant import was fixed for exactly this
  // in Session 28; the plain Tag button was not. Tagging now writes both, at
  // `Sourced`, with NO submitted_at (D-0029: adding somebody to a job is
  // membership, not a submission), through the same `submissionRowFor` the
  // import uses — one definition of the row, two callers.
  async function writeSourcedSubmission(req, cand, jobOrderId, pipelineId) {
    const row = applicants.submissionRowFor(cand, jobOrderId, req.user.id);
    if (!row) return null;
    const { data, error } = await supabase.from('submissions').insert(Object.assign(row, {
      submission_code: await nextId('SB'), pipeline_id: pipelineId || null,
    }, orgStamp(req))).select('id').single();
    if (!error) {
      await logSubmissionActivity(data.id, jobOrderId, req.user.id, 'created', null, 'Sourced', null);
      return data.id;
    }
    if (error.code !== '23505') throw error;
    // Already on this job — link to what is there rather than fail.
    const { data: existing } = await supabase.from('submissions').select('id')
      .eq('candidate_id', cand.id).eq('job_order_id', jobOrderId).is('deleted_at', null).maybeSingle();
    return existing ? existing.id : null;
  }

  // One candidate onto one job: the tag row, then the membership row. Returns
  // 'added' | 'already' — never throws on a duplicate, because adding somebody
  // who is already there is not a failure worth interrupting a batch for.
  async function tagOne(req, cand, jobOrderId, body) {
    const b = body || {};
    const pick = (k, fallback) => (b[k] !== undefined ? b[k] : (fallback || null));
    const row = Object.assign({
      pipeline_code: await nextId('PL'),
      candidate_id: cand.id, job_order_id: jobOrderId,
      pipeline_status: b.pipeline_status || 'Tagged',
      work_auth_snap: pick('work_auth_snap', cand.work_authorization),
      bill_rate: pick('bill_rate', cand.bill_rate),
      pay_rate: pick('pay_rate', cand.pay_rate),
      employer_name: pick('employer_name', cand.current_employer),
      availability: pick('availability', cand.availability),
      notice_period: pick('notice_period', cand.notice_period),
      current_ctc: pick('current_ctc', cand.current_ctc),
      source: pick('source', cand.source),
      notes: b.notes || null,
      tagged_by: req.user.id
    }, orgStamp(req));
    let status = 'added', pl = null;
    const { data, error } = await supabase.from('candidate_pipeline').insert(row).select(PIPELINE_SELECT).single();
    if (error) {
      if (error.code !== '23505') throw error;
      status = 'already';
      const { data: ex } = await supabase.from('candidate_pipeline').select(PIPELINE_SELECT)
        .eq('candidate_id', cand.id).eq('job_order_id', jobOrderId).is('deleted_at', null).maybeSingle();
      pl = ex || null;
    } else {
      pl = data;
      await logSubmissionActivity(null, jobOrderId, req.user.id, 'tagged', null, 'Tagged', null);
    }
    // The membership row. A failure here is REPORTED, never rolled back — the
    // tag is real and saved (the same rule as the applicant import).
    let linkFailed = null;
    try {
      const subId = await writeSourcedSubmission(req, cand, jobOrderId, pl && pl.id);
      if (subId && pl && !pl.submission_id) {
        await supabase.from('candidate_pipeline').update({ submission_id: subId }).eq('id', pl.id);
        pl.submission_id = subId;
      }
    } catch (e) { linkFailed = (e && e.message) || 'could not add to the job'; }
    return { status, pipeline: pl, link_failed: linkFailed };
  }

  const TAG_CAND_SELECT = 'id,work_authorization,bill_rate,pay_rate,current_employer,availability,notice_period,current_ctc,source';

  // ── MANY CANDIDATES ONTO ONE JOB (Session 31) ─────────────────────────────
  // "If we want to add 12 candidates, we have to individually tag them to the
  // job, and that's too much work." One request, one job check, one candidate
  // read, a count back. Literal path, registered above every /pipeline/:id.
  app.post('/pipeline/bulk', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const ids = Array.isArray(b.candidate_ids) ? [...new Set(b.candidate_ids.map(x => String(x || '').trim()).filter(Boolean))] : [];
      if (!ids.length || !b.job_order_id) return res.status(400).json({ error: 'candidate_ids and job_order_id required' });
      if (ids.length > 500) return res.status(400).json({ error: 'That is more than 500 people in one go. Split it up.' });
      const { data: jo } = await withOrg(
        supabase.from('job_orders').select('id').eq('id', b.job_order_id).is('deleted_at', null), req
      ).maybeSingle();
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      // Org-scoped read: an id from another company is simply not found.
      const { data: cands } = await withOrg(
        supabase.from('candidates').select(TAG_CAND_SELECT).in('id', ids).is('deleted_at', null), req);
      const found = new Map((cands || []).map(c => [c.id, c]));
      const out = { added: 0, already: 0, not_found: 0, failed: 0, errors: [] };
      for (const id of ids) {
        const cand = found.get(id);
        if (!cand) { out.not_found++; continue; }
        try {
          const r = await tagOne(req, cand, b.job_order_id, {});
          out[r.status]++;
          if (r.link_failed) out.errors.push({ candidate_id: id, error: r.link_failed });
        } catch (e) { out.failed++; out.errors.push({ candidate_id: id, error: (e && e.message) || 'failed' }); }
      }
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // tag a candidate (from the pool) into a job order's pipeline
  app.post('/pipeline', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      // Both ids are caller-supplied — a foreign job order or candidate must
      // 404, the same reason submissions.js checks both before inserting.
      const { data: jo } = await withOrg(
        supabase.from('job_orders').select('id').eq('id', b.job_order_id).is('deleted_at', null), req
      ).maybeSingle();
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      const { data: candOwn } = await withOrg(
        supabase.from('candidates').select('id').eq('id', b.candidate_id).is('deleted_at', null), req
      ).maybeSingle();
      if (!candOwn) return res.status(404).json({ error: 'Candidate not found' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // snapshot rate/availability/employer from the candidate (overridable via body)
      const { data: cand } = await supabase.from('candidates')
        .select(TAG_CAND_SELECT).eq('id', b.candidate_id).single();
      const r = await tagOne(req, cand || { id: b.candidate_id }, b.job_order_id, b);
      if (r.status === 'already') return res.status(409).json({ error: 'This candidate is already tagged to this job.' });
      res.status(201).json(Object.assign({}, r.pipeline, r.link_failed ? { job_link_failed: r.link_failed } : {}));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // change a pipeline entry's status
  app.patch('/pipeline/:id/status', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const st = req.body.status;
      if (!PIPELINE_STATUSES.includes(st)) return res.status(400).json({ error: `Invalid pipeline status. Allowed: ${PIPELINE_STATUSES.join(', ')}` });
      const { data: row, error: e0 } = await withOrg(supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null), req).single();
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
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: row, error: e0 } = await withOrg(supabase.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null), req).single();
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
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: pl, error: e0 } = await withOrg(supabase.from('candidate_pipeline')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).single();
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
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: existing } = await withOrg(
        supabase.from('candidate_pipeline').select('id,tagged_by,job_order_id').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Pipeline entry not found' });

      // Rampart review (D-0035 #4, tightened round 2 R3), same shape as the
      // submissions delete: D-0035 says recruiters work their OWN
      // candidates, so a pure recruiter may delete only their own tag
      // (tagged_by) — sharing a job order is not enough. A BD manager needs
      // owner/chain/admin.
      let allowed = hasRole(req, 'admin');
      if (!allowed && isRecruiter(req) && !isBDM(req)) {
        allowed = existing.tagged_by === req.user.id;
      }
      if (!allowed && isBDM(req)) {
        const { data: jo } = await supabase.from('job_orders')
          .select('bd_manager_id').eq('id', existing.job_order_id).maybeSingle();
        const chain = await reportingChainIds(req.user.id, orgIdFor(req));
        allowed = !!jo && chain.includes(jo.bd_manager_id);
      }
      if (!allowed) return res.status(403).json({ error: 'Not permitted to delete this pipeline entry.' });

      await supabase.from('candidate_pipeline').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
};
