// ============================================================================
// PIPELINE — the sourcing details that travel with a person on a job (rates,
// employer, availability, notice, CTC, source, notes), and the doors for
// putting somebody on a job from the candidate database.
//
// R-075 / D-0057 — THE OWNER: "A candidate when added to job from the candidate
// section or directly gets into Sourced stage. Tagged is for the database.
// Inside a job the stage starts from Sourced."
//
// This file used to be Ceipal's two-step: a candidate was TAGGED (its own status
// list — Tagged, Contacted, Interested, Screening, Shortlisted, Moved to
// Submission, Not Interested, Rejected) and later PROMOTED into a submission. That
// was a second vocabulary living beside the eleven ATS stages, and a person could
// be "on a job" in one table and not in the other. Now:
//   * ON A JOB = A SUBMISSION at `Sourced`. `core.addCandidateToJob` is the ONE
//     writer; nothing in this file inserts into `submissions` or
//     `candidate_pipeline` itself.
//   * A pipeline row has NO STATE of its own. Its state is its submission's
//     stage; every response carries `stage` (see `pipelineView`).
//   * There is no "promote" step and no pipeline status. Moving somebody along
//     is `PATCH /submissions/:id/stage` (routes/recruiting/submissions.js) — the
//     one stage move, where the recruiter gate lives.
//
// REGISTRATION ORDER IS LOAD-BEARING: `/pipeline/bulk` (a literal) is registered
// above every `/pipeline/:id…` route.
// ============================================================================

const applicants = require('../../services/applicants');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole,
    orgIdFor, withOrg,
    normalizeStage,
    isBDM, isRecruiter, recruiterCanTouchJob, reportingChainIds,
    loadJobOrderFor, loadCandidateFor, addCandidateToJob, pipelineView, readByIds,
    PIPELINE_SELECT, MEMBER_CAND_COLS, MEMBER_SUB_COLS, MEMBER_PL_COLS,
    ENTRY_STAGE,
  } = core;

  // The sourcing details a caller may send with an add (and edit later).
  function detailsFrom(b) {
    const d = {};
    applicants.PIPELINE_DETAIL_KEYS.forEach(k => { if (b && b[k] !== undefined) d[k] = b[k]; });
    return d;
  }

  // list the people on a job — the Pipeline-tab grid
  app.get('/job-orders/:id/pipeline', auth, async (req, res) => {
    try {
      // recruiterCanTouchJob only narrows a pure recruiter — every other role
      // passes unconditionally, so the org check has to live here, on the job
      // order itself, or a BDM in another org could read this whole roster.
      const jo = await loadJobOrderFor(req, req.params.id);
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data, error } = await db.forRequest(req).from('candidate_pipeline')
        .select(PIPELINE_SELECT).eq('job_order_id', req.params.id).is('deleted_at', null)
        .order('tagged_at', { ascending: false });
      if (error) throw error;
      // `stage` on every row (the submission's; Sourced for one not yet linked
      // to a submission). Nothing here ever says "Tagged".
      res.json((data || []).map(pipelineView));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── MANY CANDIDATES ONTO ONE JOB (Session 31) ─────────────────────────────
  // "If we want to add 12 candidates, we have to individually tag them to the
  // job, and that's too much work." One request, one job check, one candidate
  // read, a count back. Literal path, registered above every /pipeline/:id.
  //
  // R-075: it is the SAME add as the single one (`addCandidateToJob`), so what
  // is true of one is true of two hundred. Who is already on the job is read
  // for the whole batch in two queries, not asked again for every person.
  app.post('/pipeline/bulk', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const ids = Array.isArray(b.candidate_ids) ? [...new Set(b.candidate_ids.map(x => String(x || '').trim()).filter(Boolean))] : [];
      if (!ids.length || !b.job_order_id) return res.status(400).json({ error: 'candidate_ids and job_order_id required' });
      if (ids.length > 500) return res.status(400).json({ error: 'That is more than 500 people in one go. Split it up.' });
      const jo = await loadJobOrderFor(req, b.job_order_id);
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      const scoped = db.forRequest(req);
      // Org-scoped read: an id from another company is simply not found.
      const cands = await readByIds(ids, chunk => scoped.from('candidates')
        .select(MEMBER_CAND_COLS).in('id', chunk).is('deleted_at', null));
      const found = new Map(cands.map(c => [c.id, c]));
      const foundIds = [...found.keys()];
      const subs = await readByIds(foundIds, chunk => scoped.from('submissions')
        .select(MEMBER_SUB_COLS).eq('job_order_id', jo.id).in('candidate_id', chunk).is('deleted_at', null));
      const pls = await readByIds(foundIds, chunk => scoped.from('candidate_pipeline')
        .select(MEMBER_PL_COLS).eq('job_order_id', jo.id).in('candidate_id', chunk).is('deleted_at', null));
      const subBy = new Map(subs.map(s => [s.candidate_id, s]));
      const plBy = new Map(pls.map(p => [p.candidate_id, p]));

      const out = { added: 0, already: 0, healed: 0, not_found: 0, failed: 0, errors: [] };
      for (const id of ids) {
        const cand = found.get(id);
        if (!cand) { out.not_found++; continue; }
        try {
          const r = await addCandidateToJob(req, cand, jo, {
            existing: { submission: subBy.get(id) || null, pipeline: plBy.get(id) || null },
          });
          out[r.status]++;
          if (r.healed) out.healed++;
          if (r.warning) out.errors.push({ candidate_id: id, error: r.warning });
        } catch (e) { out.failed++; out.errors.push({ candidate_id: id, error: (e && e.message) || 'failed' }); }
      }
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // put a candidate (from the database) on a job — at Sourced
  app.post('/pipeline', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!b.candidate_id || !b.job_order_id) return res.status(400).json({ error: 'candidate_id and job_order_id required' });
      // Both ids are caller-supplied — a foreign job order or candidate must
      // 404, the same reason submissions.js checks both before inserting.
      const jo = await loadJobOrderFor(req, b.job_order_id);
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      const cand = await loadCandidateFor(req, b.candidate_id);
      if (!cand) return res.status(404).json({ error: 'Candidate not found' });
      if (!(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      // Rate / availability / employer are snapshotted from the candidate and
      // overridable from the body. A `pipeline_status` in the body is ignored:
      // there is no such thing any more — everyone starts at Sourced.
      const r = await addCandidateToJob(req, cand, jo, { details: detailsFrom(b) });
      if (r.status === 'already') {
        // Somebody already on the job is not an error worth a stack trace, but
        // the caller is told plainly. (If half of their membership was missing
        // it has just been written — `healed`.)
        return res.status(409).json({ error: 'This candidate is already on this job.', code: 'already_on_job', healed: !!r.healed });
      }
      const body = r.pipeline
        ? pipelineView(r.pipeline)
        : { id: null, candidate_id: cand.id, job_order_id: jo.id, submission_id: r.submission.id,
            submission: { id: r.submission.id, submission_code: r.submission.submission_code, stage: r.submission.stage, sub_stage: r.submission.sub_stage || null },
            stage: normalizeStage(r.submission.stage), pipeline_status: normalizeStage(r.submission.stage) };
      if (r.warning) body.warning = r.warning;
      res.status(201).json(body);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // RETIRED (R-075). A pipeline entry has no status of its own: inside a job the
  // only vocabulary is the eleven ATS stages, and a person's stage is their
  // submission's. Nothing called this — the Pipeline tab moved to the shared
  // stage control in Session 6 — but the words it accepted (Tagged, Contacted,
  // Interested, Shortlisted, Moved to Submission, Not Interested, Rejected) were
  // the second vocabulary, so it now refuses with the answer instead of writing
  // one. It stays a route (answering 410 after sign-in) so an old cached page
  // gets a sentence rather than a silent 404.
  app.patch('/pipeline/:id/status', auth, (req, res) => {
    res.status(410).json({
      error: 'A pipeline entry has no status of its own any more — inside a job the only stages are the eleven ATS stages. Move a person with PATCH /submissions/:id/stage.',
      code: 'retired',
    });
  });

  // edit a pipeline entry's sourcing details (rate / availability / employer …)
  app.patch('/pipeline/:id', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      // Refuse rather than ignore: a caller that sends `pipeline_status` believes
      // it changed somebody's state, and a silent no-op would let it go on
      // believing that.
      if (b.pipeline_status !== undefined) {
        return res.status(400).json({
          error: 'A person’s stage inside a job is changed with the stage control — the pipeline entry only keeps their sourcing details.',
          code: 'no_pipeline_status',
        });
      }
      const scoped = db.forRequest(req);
      const { data: row, error: e0 } = await scoped.from('candidate_pipeline')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !row) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, row.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const updates = { updated_at: new Date() };
      applicants.PIPELINE_DETAIL_KEYS.forEach(k => { if (b[k] !== undefined) updates[k] = (b[k] === '' ? null : b[k]); });
      const { data, error } = await scoped.from('candidate_pipeline')
        .update(updates).eq('id', req.params.id).select(PIPELINE_SELECT).single();
      if (error) throw error;
      res.json(pipelineView(data));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DEPRECATED (R-075) — "promote a pipeline entry into a formal submission".
  // There is nothing to promote: being on a job already IS a submission row.
  // What this still does is the harmless half — make sure the person really is
  // on the job (idempotent; it writes the missing half of a legacy tag) — and
  // answers in the old shape so the one screen that still calls it (a Pipeline
  // row with no submission yet) keeps working until the legacy rows are healed.
  //
  // What it NO LONGER does: create a submission at a chosen stage. It used to
  // take `req.body.stage` unvalidated, so a recruiter could promote straight to
  // "Placement" — law 3 ("recruiters move a candidate only up to Submitted to
  // BDM") bypassed by a side door — and it stamped `submitted_at` on somebody
  // nobody had submitted (D-0029). Moving is `PATCH /submissions/:id/stage`.
  // Delete this route once the screen stops calling it and the legacy rows are
  // healed; move its pin in test/recruiting-routes-mounted.mjs to RETIRED.
  app.post('/pipeline/:id/promote', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: pl, error: e0 } = await db.forRequest(req).from('candidate_pipeline')
        .select('id,candidate_id,job_order_id,submission_id').eq('id', req.params.id).is('deleted_at', null).single();
      if (e0 || !pl) return res.status(404).json({ error: 'Pipeline entry not found' });
      if (!(await recruiterCanTouchJob(req, pl.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });

      const asked = (req.body && req.body.stage) ? normalizeStage(req.body.stage) : ENTRY_STAGE;
      if (asked !== ENTRY_STAGE) {
        return res.status(400).json({
          error: 'Adding somebody to a job puts them at "' + ENTRY_STAGE + '". Move them with the stage control — recruiters up to "Submitted to BDM", the BD team after that.',
          code: 'promote_is_not_a_move',
        });
      }
      const jo = await loadJobOrderFor(req, pl.job_order_id);
      const cand = await loadCandidateFor(req, pl.candidate_id);
      if (!jo || !cand) return res.status(404).json({ error: 'Job order or candidate not found' });
      const r = await addCandidateToJob(req, cand, jo, {});
      res.status(r.created.submission ? 201 : 200).json({
        pipeline_id: pl.id, submission: r.submission, already: !r.created.submission,
        ...(r.warning ? { warning: r.warning } : {}),
      });
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
