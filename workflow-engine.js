// ============================================================================
// Workflow engine — the platform core ("pour data in, the workflow runs it").
//
// This module is deliberately DOMAIN-BLIND. It knows about definitions, steps,
// enrollments, delays, and outcomes — it does not know what an email or a call
// is. Concrete behaviour is plugged in from outside:
//
//   - registerChannel(name, executor): executor({ step, enrollment, context })
//     → { outcome: 'done'|'skipped'|'failed'|'defer', detail }
//   - registerContextLoader(entityType, loader): loader(enrollment) → context
//     object handed to executors, or null when the entity no longer exists
//     (the enrollment is then exited with reason 'entity_missing').
//
// That separation is what lets delivery/HR/finance workflows ride the same
// rails later: new domain = new channels + context loaders, zero engine edits.
//
// Semantics:
//   - step N runs when next_step_due_date <= today; delays are calendar days
//     counted from the previous step's execution (step 1: from enrollment).
//   - 'defer' leaves the enrollment due (a gate like send-quota will retry on
//     the next tick); 'failed' pushes due by 1 day and gives up after 3 fails.
//   - every execution is recorded in workflow_step_runs and announced on the
//     event bus, so the audit timeline gets it for free.
// ============================================================================

const { getSetting } = require('./config/settings');

function createWorkflowEngine({ supabase, emit, EVENTS }) {
  const channels = new Map();
  const contextLoaders = new Map();
  let ticking = false;

  function registerChannel(name, executor, meta) { channels.set(name, { executor, meta: meta || {} }); }
  function registerContextLoader(entityType, loader) { contextLoaders.set(entityType, loader); }
  function listChannels() { return [...channels.keys()]; }
  // Rich channel catalogue for the builder: which entity_type(s) each channel
  // applies to, plus a human label. Lets the UI show only the channels that fit
  // the sequence's entity type (contact vs submission …).
  function describeChannels() { return [...channels.entries()].map(([name, v]) => ({ name, ...(v.meta || {}) })); }

  const todayStr = () => new Date().toISOString().split('T')[0];
  function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (days || 0));
    return d.toISOString().split('T')[0];
  }

  async function loadSteps(workflowId) {
    const { data, error } = await supabase.from('workflow_steps')
      .select('*').eq('workflow_id', workflowId).order('step_order');
    if (error) throw error;
    return data || [];
  }

  // ── Enroll an entity into an active workflow ───────────────────────────────
  // `start_after_step` joins a sequence PART-WAY THROUGH: the caller has already
  // done the work of steps 1..N by hand. The outreach generator is the reason it
  // exists — its email IS step 1, and a sequence whose first step is
  // `email(+0 days)` would otherwise be due immediately and send the same
  // prospect a second email minutes later.
  async function enroll({ workflow_id, entity_type, entity_id, job_id, contact_id, org_id, enrolled_by, metadata, start_after_step }) {
    const { data: wf, error: wfErr } = await supabase.from('workflow_definitions')
      .select('id,entity_type,status,org_id').eq('id', workflow_id).single();
    if (wfErr || !wf) throw new Error('Workflow not found');
    if (wf.status !== 'active') throw new Error('Workflow is not active');
    if (entity_type && wf.entity_type !== entity_type) throw new Error(`Workflow expects entity_type "${wf.entity_type}"`);

    const steps = await loadSteps(workflow_id);
    if (!steps.length) throw new Error('Workflow has no steps');

    // Which step comes next, and when. Skipping every step leaves nothing to
    // run, so that is refused rather than creating an enrollment that can only
    // ever complete.
    const done = Math.max(0, Math.min(Number(start_after_step) || 0, steps.length));
    if (done >= steps.length) throw new Error('That sequence has no steps left after the ones already sent');
    const next = steps[done];

    const row = {
      workflow_id,
      org_id: org_id || wf.org_id || null,
      entity_type: wf.entity_type,
      entity_id,
      job_id: job_id || null,
      contact_id: contact_id || null,
      status: 'active',
      current_step_order: done ? steps[done - 1].step_order : 0,
      next_step_due_date: addDays(todayStr(), next.delay_days),
      enrolled_by: enrolled_by || null,
      metadata: metadata || {}
    };
    const { data, error } = await supabase.from('workflow_enrollments').insert(row).select().single();
    if (error) {
      if (error.code === '23505') throw new Error('Entity is already actively enrolled in this workflow');
      throw error;
    }
    emit(EVENTS.WORKFLOW_ENROLLED, { enrollmentId: data.id, workflowId: workflow_id, entityType: wf.entity_type, entityId: entity_id, jobId: job_id || null, actorUserId: enrolled_by || null });
    return data;
  }

  // ── Exit all active enrollments for an entity (reply/bounce/unsubscribe…) ──
  async function exitEntity({ entity_type, entity_id, reason, job_id }) {
    let q = supabase.from('workflow_enrollments')
      .select('id,workflow_id').eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'active');
    if (job_id) q = q.eq('job_id', job_id);
    const { data: rows } = await q;
    if (!rows || !rows.length) return 0;
    const ids = rows.map(r => r.id);
    await supabase.from('workflow_enrollments')
      .update({ status: 'exited', exit_reason: reason || 'manual', updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .in('id', ids);
    for (const r of rows) emit(EVENTS.WORKFLOW_EXITED, { enrollmentId: r.id, workflowId: r.workflow_id, entityType: entity_type, entityId: entity_id, reason: reason || 'manual' });
    return ids.length;
  }

  async function recordRun(enrollment, step, outcome, detail) {
    try {
      await supabase.from('workflow_step_runs').insert({
        enrollment_id: enrollment.id, workflow_id: enrollment.workflow_id,
        step_id: step.id, step_order: step.step_order, channel: step.channel,
        outcome, detail: detail || {}
      });
    } catch (e) { console.error('[wf] step-run record failed:', e.message); }
  }

  async function updateEnrollment(id, patch) {
    await supabase.from('workflow_enrollments')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  }

  // ── Advance one due enrollment ─────────────────────────────────────────────
  async function advance(enrollment) {
    const steps = await loadSteps(enrollment.workflow_id);
    const idx = steps.findIndex(s => s.step_order > enrollment.current_step_order);
    if (idx === -1) { // nothing left — shouldn't normally happen, close out
      await updateEnrollment(enrollment.id, { status: 'completed', completed_at: new Date().toISOString() });
      return { outcome: 'completed' };
    }
    const step = steps[idx];

    const loader = contextLoaders.get(enrollment.entity_type);
    const context = loader ? await loader(enrollment) : {};
    if (loader && context === null) {
      await updateEnrollment(enrollment.id, { status: 'exited', exit_reason: 'entity_missing', completed_at: new Date().toISOString() });
      emit(EVENTS.WORKFLOW_EXITED, { enrollmentId: enrollment.id, workflowId: enrollment.workflow_id, entityType: enrollment.entity_type, entityId: enrollment.entity_id, reason: 'entity_missing' });
      return { outcome: 'exited' };
    }

    const ch = channels.get(step.channel);
    const executor = ch && ch.executor;
    let result;
    if (!executor) {
      result = { outcome: 'failed', detail: { error: `No executor registered for channel "${step.channel}"` } };
    } else {
      try {
        result = await executor({ step, enrollment, context }) || { outcome: 'done' };
      } catch (e) {
        result = { outcome: 'failed', detail: { error: e.message } };
      }
    }

    if (result.outcome === 'defer') {
      // Gate not open yet (quota, window…) — stay due, retry next tick.
      await recordRun(enrollment, step, 'skipped', { deferred: true, ...(result.detail || {}) });
      return result;
    }

    await recordRun(enrollment, step, result.outcome, result.detail);
    emit(EVENTS.WORKFLOW_STEP_EXECUTED, {
      enrollmentId: enrollment.id, workflowId: enrollment.workflow_id, stepOrder: step.step_order,
      channel: step.channel, outcome: result.outcome, entityType: enrollment.entity_type, entityId: enrollment.entity_id
    });

    if (result.outcome === 'failed') {
      const fails = ((enrollment.metadata || {}).fail_count || 0) + 1;
      const maxStepFailures = await getSetting(supabase, 'wf_max_step_failures');
      if (fails >= maxStepFailures) {
        await updateEnrollment(enrollment.id, { status: 'failed', exit_reason: 'step_failed', completed_at: new Date().toISOString(), metadata: { ...(enrollment.metadata || {}), fail_count: fails } });
      } else {
        await updateEnrollment(enrollment.id, { next_step_due_date: addDays(todayStr(), 1), metadata: { ...(enrollment.metadata || {}), fail_count: fails } });
      }
      return result;
    }

    // done / skipped → move on
    const next = steps[idx + 1];
    if (!next) {
      await updateEnrollment(enrollment.id, { status: 'completed', current_step_order: step.step_order, next_step_due_date: null, completed_at: new Date().toISOString(), metadata: { ...(enrollment.metadata || {}), fail_count: 0 } });
      emit(EVENTS.WORKFLOW_COMPLETED, { enrollmentId: enrollment.id, workflowId: enrollment.workflow_id, entityType: enrollment.entity_type, entityId: enrollment.entity_id });
    } else {
      await updateEnrollment(enrollment.id, { current_step_order: step.step_order, next_step_due_date: addDays(todayStr(), next.delay_days), metadata: { ...(enrollment.metadata || {}), fail_count: 0 } });
    }
    return result;
  }

  // ── Tick: run everything that is due ───────────────────────────────────────
  async function tick() {
    if (ticking) return { skipped: 'already_running' };
    ticking = true;
    const log = { checked: 0, done: 0, skipped: 0, failed: 0, deferred: 0, completed: 0, exited: 0 };
    try {
      const tickBatch = await getSetting(supabase, 'wf_tick_batch');
      const { data: due, error } = await supabase.from('workflow_enrollments')
        .select('*').eq('status', 'active').lte('next_step_due_date', todayStr())
        .order('next_step_due_date').limit(tickBatch);
      if (error) { // table absent (migration 007 not applied) → engine is off
        if (/workflow_enrollments/.test(error.message || '')) return { off: true };
        throw error;
      }
      log.checked = (due || []).length;
      for (const enrollment of (due || [])) {
        try {
          const r = await advance(enrollment);
          if (r.outcome === 'defer') log.deferred++;
          else if (r.outcome === 'completed') log.completed++;
          else if (r.outcome === 'exited') log.exited++;
          else log[r.outcome] = (log[r.outcome] || 0) + 1;
        } catch (e) {
          console.error(`[wf] advance failed for enrollment ${enrollment.id}:`, e.message);
          log.failed++;
        }
      }
      if (log.checked) console.log('[wf] tick:', JSON.stringify(log));
      return log;
    } finally {
      ticking = false;
    }
  }

  return { registerChannel, registerContextLoader, listChannels, describeChannels, enroll, exitEntity, tick };
}

module.exports = { createWorkflowEngine };
