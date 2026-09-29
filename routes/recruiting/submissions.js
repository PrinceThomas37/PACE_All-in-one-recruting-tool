// ============================================================================
// SUBMISSIONS — the per-candidate stage machine with the BD Manager approval
// gate. Split out of bd_recruiter_routes.js; the stage move was rebuilt in
// R-077 so that moving ONE candidate and moving MANY are the same code.
//
// ⚠ THE TABLE IS MISNAMED (D-0029). `submissions` holds the whole
// candidate-on-a-job record, from `Sourced` to `Placement`. A row here is a
// person ON A JOB; it becomes a submission (in the sense a client cares about)
// only at `Submitted to Client`. See services/submission-stages.js.
//
// REGISTRATION ORDER IS LOAD-BEARING. `GET /submissions` and
// `POST /submissions/bulk-stage` are literals and sit above every
// `/submissions/:id…` route; test/route-shadowing-smoke.mjs fails the build if a
// literal ever lands below the `:id` route that would swallow it.
// ============================================================================

const { EVENTS, emit } = require('../../events');
const subStages = require('../../services/submission-stages');
const applicants = require('../../services/applicants');

// One group move is at most this many people. A cap is a product decision (R-077):
// large enough for a real shortlist, small enough that a stray "select all" on a
// long list cannot rewrite the whole desk in one click.
const BULK_STAGE_MAX = 200;

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole,
    orgIdFor, orgStamp, withOrg,
    STAGES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, reportingChainIds,
    logSubmissionActivities, readByIds,
    loadJobOrderFor, loadCandidateFor, addCandidateToJob,
    SUBMISSION_SELECT, SUBMISSION_FIELDS,
  } = core;

  // SUBMISSIONS — pipeline (per-candidate stage, with BDM approval gate)
  // ==========================================================================


  // list submissions for a job order (the kanban data)
  app.get('/job-orders/:id/submissions', auth, async (req, res) => {
    try {
      // A job order in another org must read as not-found, not leak the full
      // candidate roster (email/phone/resume/rates) to any role that is not a
      // pure recruiter — the org check the masked-browse branch never had.
      const { data: jo } = await withOrg(
        supabase.from('job_orders').select('id').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
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

  // ── WHICH JOBS IS EACH OF THESE PEOPLE ON? (R-077) ───────────────────────
  // GET /submissions?candidate_ids=a,b,c
  // A stage is always per (person, JOB): one person can be on several jobs, so
  // a group move started from the Candidates page has to ask "which job?" before
  // it can name the submissions to move. This is the read that lets the page
  // offer only the jobs the ticked people are actually on, and turn
  // (candidate, job) into the submission id `POST /submissions/bulk-stage` takes.
  //
  // FAIL CLOSED: naming no candidates returns NOTHING, never "every submission" —
  // the same rule as `applicants.forJob` with no job id. Live submissions only,
  // in the caller's company only; a candidate from another company is simply
  // absent. Deliberately carries no contact details — stage and job are visible
  // company-wide (D-0035), the candidate's phone and email are not this route's
  // business.
  app.get('/submissions', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const ids = [...new Set(String(req.query.candidate_ids || '').split(',').map(s => s.trim()).filter(Boolean))];
      if (!ids.length) return res.json({ submissions: [] });
      if (ids.length > 200) return res.status(400).json({ error: 'Ask about 200 people or fewer at a time.' });
      const rows = await readByIds(ids, chunk => db.forRequest(req).from('submissions')
        .select('id,candidate_id,job_order_id,stage,sub_stage,recruiter_id,' +
                'job:job_orders(id,job_code,job_title,client,status,deleted_at)')
        .in('candidate_id', chunk).is('deleted_at', null));
      const out = rows
        // A submission on a job order that has since been deleted is not a job
        // anybody can move them on.
        .filter(r => !(r.job && r.job.deleted_at))
        .map(r => {
          const job = r.job ? { id: r.job.id, job_code: r.job.job_code, job_title: r.job.job_title, client: r.job.client, status: r.job.status } : null;
          return Object.assign({}, r, { stage: normalizeStage(r.stage), job });
        });
      res.json({ submissions: out });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // add a candidate (from the shared pool) to a job order
  //
  // R-075: this used to be one of five separate writers of "on a job" — it
  // stamped `submitted_at` on somebody nobody had submitted, and wrote a
  // pipeline row whose status read "Moved to Submission". It is now a thin door
  // onto `core.addCandidateToJob`: the person lands at Sourced, with no
  // submitted_at, exactly as they do from the Candidates page.
  app.post('/submissions', auth, async (req, res) => {
    try {
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
      // Both ids are caller-supplied. A job order or candidate from another org
      // must 404 here — otherwise this becomes a way to read a foreign
      // candidate's rates (below) or attach a foreign job order to a submission.
      const jo = await loadJobOrderFor(req, b.job_order_id);
      if (!jo) return res.status(404).json({ error: 'Job order not found' });
      const cand = await loadCandidateFor(req, b.candidate_id);
      if (!cand) return res.status(404).json({ error: 'Candidate not found' });

      // Whose candidate-on-this-job it is: the caller, unless they name somebody
      // else — who must be in the CALLER'S company. (An unchecked id here would
      // stamp another company's user onto this row, and the joins that draw the
      // recruiter's name would then show it.)
      let recruiterId = req.user.id;
      if (b.recruiter_id && b.recruiter_id !== req.user.id) {
        const { data: u } = await db.forRequest(req).from('users')
          .select('id').eq('id', b.recruiter_id).is('deleted_at', null).maybeSingle();
        if (!u) return res.status(400).json({ error: 'That recruiter is not in your company.' });
        recruiterId = b.recruiter_id;
      }

      const details = {};
      applicants.PIPELINE_DETAIL_KEYS.forEach(k => { if (b[k] !== undefined) details[k] = b[k]; });
      const r = await addCandidateToJob(req, cand, jo, {
        recruiterId, details,
        submission: { submitted_rate: b.submitted_rate || null, revision_status: b.revision_status },
      });
      // 409 only when there was ALREADY a submission. Somebody who was on the
      // job only as a legacy tag has just been given theirs — that is the add
      // this call asked for.
      if (!r.created.submission) return res.status(409).json({ error: 'This candidate is already in this job order.' });
      res.status(201).json(r.submission);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // THE STAGE MOVE — one candidate or many (R-077)
  //
  // The owner: "There is no option to change the stage of the candidate by
  // multiple selection in the candidate or the job section." Leads already had
  // it. The trap in adding it is a SECOND COPY of the rules: recruiters move a
  // candidate only up to "Submitted to BDM", Not Accepted always carries its
  // reason, an unassigned recruiter touches nothing — a group endpoint that
  // re-typed those would be the most direct way to make law 3 mean two things.
  //
  // So there is ONE function. `moveSubmissions` judges each row with
  // `subStages.moveRefusal` (the rules, callable), then writes the accepted rows
  // with one update, one history insert and one reminder insert. The single
  // endpoint below is the same function called with one row; the group endpoint
  // is the same function called with up to 200.
  //
  // A REFUSED ROW IS REPORTED, NEVER SWALLOWED, and one bad row never spoils the
  // rest: the answer to a group move is {moved:[ids], refused:[{id, reason}]}.
  // ══════════════════════════════════════════════════════════════════════════

  // The row, plus the two facts a move needs about the person (their name and
  // address, for the optional reminder).
  const MOVE_SELECT = '*, candidate:candidates(id,full_name,email)';

  /**
   * Move the given submissions (rows already read, org-scoped) to body.stage.
   * opts: { bulk }   group move — no per-person submission details, and a row
   *                  already at the stage is refused rather than re-written;
   *       { single }  a failed write throws (the caller answers 500 as it always did);
   *       { select }  what the update reads back (the single move returns the
   *                   whole updated submission; a group move only needs ids).
   * Returns { moved:[ids], refused:[{id, reason, status, rule}], rows:[updated] }.
   */
  async function moveSubmissions(req, subs, body, opts) {
    const o = opts || {};
    const bulk = !!o.bulk;
    const b = body || {};
    const to = normalizeStage(b.stage);
    const scoped = db.forRequest(req);
    const recruiterScoped = isRecruiter(req) && !isBDM(req);
    const assigned = recruiterScoped ? new Set(await assignedJobOrderIds(req.user.id)) : null;

    // 1. JUDGE EACH ROW — the same rules, in the same order, for one or for many.
    const refused = [], plan = [];
    for (const sub of subs) {
      const why = subStages.moveRefusal({
        isBDM: isBDM(req), isRecruiter: isRecruiter(req),
        assigned: assigned ? assigned.has(sub.job_order_id) : true,
        from: normalizeStage(sub.stage), to,
        fromSubStage: sub.sub_stage || null, subStage: b.sub_stage || null,
        reason: b.rejection_reason,
        // A group move carries no per-person hand-off details (the form is one
        // person at a time), so a recruiter cannot group-submit to BDM.
        details: bulk ? null : b.submission_details,
        bulk,
      });
      if (why) refused.push({ id: sub.id, reason: why.message, status: why.status, rule: why.rule });
      else plan.push(sub);
    }
    if (!plan.length) return { moved: [], refused, rows: [] };

    // 2. ONE UPDATE for every accepted row — the change is identical for all of
    //    them (stage, sub-stage, interview details, reason), so it is written
    //    once. A new stage resets the sub-stage unless one is supplied.
    const now = new Date();
    const updates = { stage: to, stage_updated_at: now, sub_stage: b.sub_stage || null };
    if (b.interview_at !== undefined) updates.interview_at = b.interview_at || null;
    if (b.interview_location !== undefined) updates.interview_location = b.interview_location || null;
    if (b.interview_type !== undefined) updates.interview_type = b.interview_type || null;
    if (b.interview_platform !== undefined) updates.interview_platform = b.interview_platform || null;
    if (b.interview_link !== undefined) updates.interview_link = b.interview_link || null;
    if (b.interview_address !== undefined) updates.interview_address = b.interview_address || null;
    if (b.interviewers !== undefined) updates.interviewers = Array.isArray(b.interviewers) ? b.interviewers : null;
    if (!bulk && b.submission_details !== undefined) updates.submission_details = b.submission_details || null;
    if (to === subStages.NOT_ACCEPTED) updates.rejection_reason = String(b.rejection_reason).trim();
    let action = 'stage_change';
    if (to === BDM_GATED_STAGE && isBDM(req)) {
      updates.bdm_approved_at = now;
      updates.bdm_approved_by = req.user.id;
      action = 'bdm_approved';
    }

    const { data: done, error } = await scoped.from('submissions')
      .update(updates).in('id', plan.map(s => s.id)).is('deleted_at', null).select(o.select || 'id');
    if (error) {
      if (o.single) throw error;
      // Nothing was written: say so for every row rather than 500 the request.
      plan.forEach(s => refused.push({ id: s.id, reason: 'The change could not be saved, so nothing was moved. Please try again.', status: 500, rule: 'write_failed' }));
      return { moved: [], refused, rows: [] };
    }
    const doneRows = done || [];
    const doneIds = new Set(doneRows.map(r => r.id));
    const moved = plan.filter(s => doneIds.has(s.id));
    // Read back fewer rows than we meant to write: somebody removed them in
    // between. Say so — never count them as moved.
    plan.filter(s => !doneIds.has(s.id)).forEach(s => refused.push({
      id: s.id, reason: 'This candidate was removed from the job before the move could be saved.', status: 409, rule: 'vanished',
    }));

    // 3. THE SIDE EFFECTS, for exactly the rows that moved.
    // Optional reminder-to-call, riding the existing reminders plumbing.
    if (b.reminder_date && moved.length) {
      try {
        const { error: remErr } = await scoped.from('reminders').insert(moved.map(s => {
          const c = s.candidate || {};
          return {
            user_id: req.user.id, contact_name: c.full_name || null, email: c.email || null,
            return_date: b.reminder_date,
            note: b.reminder_note || ('Follow up with ' + (c.full_name || 'candidate') + ' — ' + to),
            status: 'pending',
          };
        }));
        if (remErr) console.error('[stage move] reminder write failed:', remErr.message);
      } catch (_) { /* non-fatal */ }
    }
    // The history R-002 counts from, one row per person who moved.
    const note = [b.sub_stage ? ('[' + b.sub_stage + ']') : '', b.note || ''].filter(Boolean).join(' ') || null;
    await logSubmissionActivities(moved.map(s => ({
      submission_id: s.id, job_order_id: s.job_order_id, recruiter_id: s.recruiter_id,
      action, old_stage: s.stage || null, new_stage: to, note,
    })), req);
    moved.forEach(s => emit(EVENTS.SUBMISSION_ADVANCED, {
      submissionId: s.id, jobOrderId: s.job_order_id, fromStage: s.stage, toStage: to, actorUserId: req.user.id,
    }));

    return { moved: moved.map(s => s.id), refused, rows: doneRows };
  }

  // ── MANY AT ONCE (R-077) ─────────────────────────────────────────────────
  // POST /submissions/bulk-stage  { ids:[submission ids], stage, sub_stage?,
  //   note?, rejection_reason?, interview_*?, reminder_date?, reminder_note? }
  //   → { moved:[ids], refused:[{id, reason}], stage }
  //
  // Registered ABOVE every `/submissions/:id…` route (see the file header).
  //
  // Whole-request problems answer with a 4xx and `{error}` — the stage is not
  // one of the eleven, no ids, more than 200, a role that may not make this move
  // at all, a missing reason for Not Accepted. Everything that is about ONE row
  // comes back in `refused` with a plain sentence, and the request still
  // succeeds for the rest.
  app.post('/submissions/bulk-stage', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const to = normalizeStage(b.stage);
      if (!STAGES.includes(to)) return res.status(400).json({ error: `Invalid stage. Allowed: ${STAGES.join(', ')}` });
      const asked = Array.isArray(b.ids) ? b.ids.map(x => String(x == null ? '' : x).trim()).filter(Boolean) : [];
      const ids = [...new Set(asked)];
      if (!ids.length) return res.status(400).json({ error: 'ids required — send the submissions to move.' });
      if (ids.length > BULK_STAGE_MAX) {
        return res.status(400).json({ error: `That is more than ${BULK_STAGE_MAX} candidates in one go. Split it up.` });
      }
      // The rules that do not depend on any one row refuse the WHOLE request:
      // the same sentence two hundred times helps nobody.
      const early = subStages.requestRefusal({
        isBDM: isBDM(req), isRecruiter: isRecruiter(req), to,
        reason: b.rejection_reason, details: null, bulk: true,
      });
      if (early) return res.status(early.status).json({ error: early.message });

      // Read the rows inside the caller's company, live only. An id that is
      // foreign, deleted, malformed or invented all come back the same way —
      // absent — so an id cannot be used to probe for what exists.
      const rows = await readByIds(ids, chunk => db.forRequest(req).from('submissions')
        .select(MOVE_SELECT).in('id', chunk).is('deleted_at', null));
      const byId = new Map(rows.map(r => [r.id, r]));
      const found = ids.filter(id => byId.has(id)).map(id => byId.get(id));

      const out = found.length ? await moveSubmissions(req, found, b, { bulk: true }) : { moved: [], refused: [] };
      const movedSet = new Set(out.moved);
      const why = new Map(out.refused.map(r => [r.id, r.reason]));
      const NOT_FOUND = 'This candidate could not be found on a job — they may have been removed.';
      res.json({
        moved: ids.filter(id => movedSet.has(id)),
        // In the order they were sent, so a screen can line them up.
        refused: ids.filter(id => !movedSet.has(id)).map(id => ({ id, reason: why.get(id) || NOT_FOUND })),
        stage: to,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // move a submission to a new stage — enforces the BDM approval gate.
  // The same `moveSubmissions` as the group move above, called with one row, so
  // the two cannot disagree about who may move whom.
  app.patch('/submissions/:id/stage', auth, async (req, res) => {
    try {
      const body = req.body || {};
      const newStage = normalizeStage(body.stage);
      if (!STAGES.includes(newStage)) return res.status(400).json({ error: `Invalid stage. Allowed: ${STAGES.join(', ')}` });

      const { data: sub, error: subErr } = await db.forRequest(req).from('submissions')
        .select(MOVE_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
      if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

      const out = await moveSubmissions(req, [sub], body, { single: true, select: SUBMISSION_SELECT });
      if (out.refused.length) {
        const r = out.refused[0];
        return res.status(r.status).json({ error: r.reason });
      }
      res.json(out.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // edit a submission's display fields (revision status / rate / employer …)
  app.patch('/submissions/:id', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: sub, error: e0 } = await withOrg(supabase.from('submissions')
        .select('job_order_id').eq('id', req.params.id).is('deleted_at', null), req).single();
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
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: existing } = await withOrg(
        supabase.from('submissions').select('id,recruiter_id,job_order_id').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Submission not found' });

      // Rampart review (D-0035 #4, tightened round 2 R3): any recruiter or
      // BDM in the org could delete ANY submission — the org check above
      // only stops another COMPANY's row. D-0035: recruiters work their OWN
      // candidates — sharing a job order does not give a recruiter the right
      // to delete a colleague's submission row, so a pure recruiter may
      // delete only a row they are recruiter_id on. A BD manager needs the
      // same owner/chain/admin test as every other job-order write.
      let allowed = hasRole(req, 'admin');
      if (!allowed && isRecruiter(req) && !isBDM(req)) {
        allowed = existing.recruiter_id === req.user.id;
      }
      if (!allowed && isBDM(req)) {
        const { data: jo } = await supabase.from('job_orders')
          .select('bd_manager_id').eq('id', existing.job_order_id).maybeSingle();
        const chain = await reportingChainIds(req.user.id, orgIdFor(req));
        allowed = !!jo && chain.includes(jo.bd_manager_id);
      }
      if (!allowed) return res.status(403).json({ error: 'Not permitted to delete this submission.' });

      await supabase.from('submissions').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
};
