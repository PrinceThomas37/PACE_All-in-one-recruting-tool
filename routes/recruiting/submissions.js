// ============================================================================
// SUBMISSIONS — the per-candidate stage machine with the BD Manager approval
// gate. Split out of bd_recruiter_routes.js; logic unchanged.
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

  // SUBMISSIONS — pipeline (per-candidate stage, with BDM approval gate)
  // ==========================================================================


  // list submissions for a job order (the kanban data)
  app.get('/job-orders/:id/submissions', auth, async (req, res) => {
    try {
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(req.params.id)) {
          // Job-board browse: an unassigned recruiter may see who is on the job
          // and how far along they are, but candidate contact details (email,
          // phone, resume) unlock only once the recruiter is assigned.
          const { data, error } = await supabase.from('submissions')
            .select('id,job_order_id,stage,sub_stage,created_at,submitted_at,' +
              'candidate:candidates(id,candidate_code,full_name,current_title,city,state,experience_years),' +
              'recruiter:users!recruiter_id(id,name)')
            .eq('job_order_id', req.params.id).is('deleted_at', null)
            .order('created_at', { ascending: false });
          if (error) throw error;
          return res.json({ masked: true, submissions: data || [] });
        }
      }
      const { data, error } = await supabase.from('submissions')
        .select(SUBMISSION_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // add a candidate (from the shared pool) to a job order
  app.post('/submissions', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) {
        return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      }
      // recruiters can only submit into job orders they are assigned to
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(b.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }
      // snapshot rate/availability/employer from the candidate (overridable via body)
      const { data: cand } = await supabase.from('candidates')
        .select('bill_rate,pay_rate,current_employer,availability,notice_period')
        .eq('id', b.candidate_id).single();
      const c = cand || {};
      const pick = (k, fb) => (b[k] !== undefined ? b[k] : (fb || null));
      const { data, error } = await supabase.from('submissions').insert({
        ...orgStamp(req),
        submission_code: await nextId('SB'),
        candidate_id: b.candidate_id, job_order_id: b.job_order_id,
        recruiter_id: b.recruiter_id || req.user.id,
        stage: 'Sourced', submitted_rate: b.submitted_rate || null, notes: b.notes || null,
        revision_status: b.revision_status || 'N/A',
        bill_rate: pick('bill_rate', c.bill_rate),
        pay_rate: pick('pay_rate', c.pay_rate),
        employer_name: pick('employer_name', c.current_employer),
        availability: pick('availability', c.availability),
        notice_period: pick('notice_period', c.notice_period),
        submitted_by: req.user.id, submitted_at: new Date()
      }).select(SUBMISSION_SELECT).single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This candidate is already in this job order.' });
        throw error;
      }
      // Keep the Pipeline tab a full roster: a direct submission add also
      // creates (or links) the candidate's pipeline row for this job.
      try {
        const { data: pl } = await supabase.from('candidate_pipeline').select('id')
          .eq('candidate_id', b.candidate_id).eq('job_order_id', b.job_order_id).is('deleted_at', null).maybeSingle();
        if (pl) {
          await supabase.from('candidate_pipeline')
            .update({ submission_id: data.id, pipeline_status: 'Moved to Submission', updated_at: new Date() }).eq('id', pl.id);
        } else {
          await supabase.from('candidate_pipeline').insert({
            pipeline_code: await nextId('PL'), candidate_id: b.candidate_id, job_order_id: b.job_order_id,
            pipeline_status: 'Moved to Submission', submission_id: data.id, tagged_by: req.user.id
          });
        }
      } catch (_) { /* non-fatal */ }
      await logSubmissionActivity(data.id, b.job_order_id, data.recruiter_id, 'created', null, 'Sourced', null);
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // move a submission to a new stage — enforces the BDM approval gate
  app.patch('/submissions/:id/stage', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const newStage = normalizeStage(req.body.stage);
      if (!STAGES.includes(newStage)) return res.status(400).json({ error: `Invalid stage. Allowed: ${STAGES.join(', ')}` });

      const { data: sub, error: subErr } = await supabase.from('submissions')
        .select('*').eq('id', req.params.id).is('deleted_at', null).single();
      if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

      const recruiterScoped = isRecruiter(req) && !isBDM(req);
      if (recruiterScoped) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(sub.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }

      // ── THE GATE ──────────────────────────────────────────────────────────
      // Recruiters own the stages up to "Submitted to BDM"; everything after
      // (client submission, interviews, offer, placement, rejection) is BD's.
      // Recruiters can still SEE later stages, they just can't change them.
      const RECRUITER_STAGES = ['Sourced', 'Screening', 'Submitted to BDM'];
      if (recruiterScoped) {
        if (!RECRUITER_STAGES.includes(newStage)) {
          return res.status(403).json({ error: 'Recruiters can move candidates up to "Submitted to BDM" — the BD team owns the stages after that.' });
        }
        if (!RECRUITER_STAGES.includes(normalizeStage(sub.stage))) {
          return res.status(403).json({ error: 'This candidate is with the BD team now — only a BD Manager can change this stage.' });
        }
        if (newStage === 'Submitted to BDM') {
          const det = req.body.submission_details;
          if (!det || !String(det.comment || '').trim()) {
            return res.status(400).json({ error: 'Submission details with a comment are required to submit to the BD Manager.' });
          }
        }
      }
      if (newStage === BDM_GATED_STAGE && !isBDM(req)) {
        return res.status(403).json({ error: 'Only a BD Manager can approve "Submitted to BDM" candidates through to the client.' });
      }
      // BD duty: every "Not Accepted" carries its reason (client feedback, no-show,
      // accepted elsewhere…)
      if (newStage === 'Not Accepted' && !String((req.body || {}).rejection_reason || '').trim()) {
        return res.status(400).json({ error: 'Please add the reason.' });
      }

      const bb = req.body || {};
      // A new stage resets the sub-stage unless one is supplied with the move.
      const updates = { stage: newStage, stage_updated_at: new Date(), sub_stage: bb.sub_stage || null };
      if (bb.interview_at !== undefined) updates.interview_at = bb.interview_at || null;
      if (bb.interview_location !== undefined) updates.interview_location = bb.interview_location || null;
      if (bb.interview_type !== undefined) updates.interview_type = bb.interview_type || null;
      if (bb.interview_platform !== undefined) updates.interview_platform = bb.interview_platform || null;
      if (bb.interview_link !== undefined) updates.interview_link = bb.interview_link || null;
      if (bb.interview_address !== undefined) updates.interview_address = bb.interview_address || null;
      if (bb.interviewers !== undefined) updates.interviewers = Array.isArray(bb.interviewers) ? bb.interviewers : null;
      if (bb.submission_details !== undefined) updates.submission_details = bb.submission_details || null;
      if (newStage === 'Not Accepted') updates.rejection_reason = String(bb.rejection_reason).trim();
      let action = 'stage_change';
      if (newStage === BDM_GATED_STAGE && isBDM(req)) {
        updates.bdm_approved_at = new Date();
        updates.bdm_approved_by = req.user.id;
        action = 'bdm_approved';
      }

      const { data, error } = await supabase.from('submissions')
        .update(updates).eq('id', req.params.id).select(SUBMISSION_SELECT).single();
      if (error) throw error;

      // Optional reminder-to-call, riding the existing reminders plumbing.
      if (bb.reminder_date) {
        try {
          const cand = (data.candidate || {});
          await supabase.from('reminders').insert({
            user_id: req.user.id, contact_name: cand.full_name || null, email: cand.email || null,
            return_date: bb.reminder_date,
            note: bb.reminder_note || ('Follow up with ' + (cand.full_name || 'candidate') + ' — ' + newStage),
            status: 'pending'
          });
        } catch (_) { /* non-fatal */ }
      }

      await logSubmissionActivity(data.id, sub.job_order_id, sub.recruiter_id, action, sub.stage, newStage,
        [bb.sub_stage ? ('[' + bb.sub_stage + ']') : '', bb.note || ''].filter(Boolean).join(' ') || null);
      emit(EVENTS.SUBMISSION_ADVANCED, { submissionId: data.id, jobOrderId: sub.job_order_id, fromStage: sub.stage, toStage: newStage, actorUserId: req.user.id });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // edit a submission's display fields (revision status / rate / employer …)
  app.patch('/submissions/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: sub, error: e0 } = await supabase.from('submissions')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !sub) return res.status(404).json({ error: 'Submission not found' });
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(sub.job_order_id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }
      const b = req.body || {};
      const updates = {};
      SUBMISSION_FIELDS.forEach(k => { if (b[k] !== undefined) updates[k] = (b[k] === '' ? null : b[k]); });
      const { data, error } = await supabase.from('submissions')
        .update(updates).eq('id', req.params.id).select(SUBMISSION_SELECT).single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/submissions/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await supabase.from('submissions').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
};
