// ============================================================================
// Workflow engine API — /wf/*
// Mounted from index.js: app.use(require('./routes/wf')(ctx));
// ctx = { supabase, auth, hasRole, engine, logActivity }
// Definitions are org data; enrollments are the running state machines.
// ============================================================================
const express = require('express');
const own = require('../services/ownership');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, engine, logActivity } = ctx;
  // This router's own ctx never carried org helpers (unlike routeCtx), but
  // `auth()` in index.js stamps `req.orgId` on every request regardless of
  // which router receives it, so a local, self-contained `withOrg` is all
  // this file needs — no gateway change required.
  const withOrg = (q, req) => (req.orgId ? q.eq('org_id', req.orgId) : q);
  const orgStamp = (req) => (req.orgId ? { org_id: req.orgId } : {});
  const { reportingChainIds } = require('../hierarchy')(supabase);

  const canDesign = (req) => hasRole(req, 'admin', 'ra_lead', 'bd_lead', 'recruiter');

  // Validate + order a set of "from" mailbox ids for rotation. Drops ids that
  // are inactive, non-existent, out of the caller's org, or (for a plain
  // BD/recruiter) not their own. Returns [{ id, email }] in the caller's order.
  // The org filter is NEW (C-0022): a privileged designer could previously
  // rotate a sequence's "from" address across ANY org's mailbox ids —
  // `GET /wf/sending-mailboxes` handed every org's mailbox ids to admin/
  // bd_lead/ra_lead, so this was reachable, not theoretical.
  async function resolveFromMailboxes(req, ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    let q = withOrg(supabase.from('user_emails').select('id,email_address,user_id').in('id', ids).eq('is_active', true), req);
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) q = q.eq('user_id', req.user.id);
    const { data } = await q;
    const byId = {}; (data || []).forEach(m => { byId[m.id] = m; });
    const seen = new Set(); const out = [];
    for (const id of ids) if (byId[id] && !seen.has(id)) { seen.add(id); out.push({ id, email: byId[id].email_address }); }
    return out;
  }

  const DEF_SELECT = '*, steps:workflow_steps(*), creator:users!created_by(id,name)';

  function normalizeSteps(steps) {
    if (!Array.isArray(steps) || !steps.length) throw new Error('At least one step is required');
    const known = new Set(engine.listChannels());
    return steps.map((s, i) => {
      if (!s.channel || !known.has(s.channel)) throw new Error(`Unknown channel "${s.channel}" — available: ${[...known].join(', ')}`);
      const delay = Number(s.delay_days || 0);
      if (!Number.isInteger(delay) || delay < 0 || delay > 90) throw new Error('delay_days must be an integer between 0 and 90');
      return { step_order: i + 1, name: s.name || `Step ${i + 1}`, channel: s.channel, delay_days: delay, config: s.config || {} };
    });
  }

  router.get('/wf/channels', auth, (req, res) => res.json({
    channels: engine.listChannels(),
    catalogue: engine.describeChannels ? engine.describeChannels() : engine.listChannels().map(name => ({ name }))
  }));

  // Sending mailboxes a sequence can rotate its "from" address across.
  // Privileged designers see every active mailbox (with its owner); a plain BD /
  // recruiter sees only their own. `connected` = can actually send right now
  // (Microsoft mailbox with a stored token) — the picker warns on the rest.
  router.get('/wf/sending-mailboxes', auth, async (req, res) => {
    try {
      // C-0022 #5: admin/bd_lead/ra_lead saw every org's mailboxes (this is
      // the id source that later let a sequence send from another org's
      // mailbox — C-0021 X3). Org-scoped now, and a bd_lead/ra_lead is
      // narrowed to their own reporting chain rather than the whole org —
      // "privileged designer" meant "sees their desk's mailboxes", not
      // literally everyone's.
      let q = withOrg(supabase.from('user_emails')
        .select('id,user_id,email_address,display_name,platform,is_active,is_primary,daily_send_limit,owner:users!user_id(name)')
        .eq('is_active', true), req).order('is_primary', { ascending: false });
      if (!hasRole(req, 'admin')) {
        if (hasRole(req, 'bd_lead', 'ra_lead')) {
          const chain = await reportingChainIds(req.user.id, req.orgId || null);
          q = q.in('user_id', chain);
        } else {
          q = q.eq('user_id', req.user.id);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      const ids = (data || []).map(e => e.id);
      const { data: tokens } = ids.length
        ? await supabase.from('microsoft_tokens').select('user_email_id').in('user_email_id', ids)
        : { data: [] };
      const connected = new Set((tokens || []).map(t => t.user_email_id));
      res.json((data || []).map(e => ({
        id: e.id, email: e.email_address, display_name: e.display_name || e.email_address,
        platform: e.platform, is_primary: !!e.is_primary, owner: (e.owner && e.owner.name) || null,
        owner_id: e.user_id, daily_send_limit: e.daily_send_limit,
        connected: e.platform === 'Microsoft' ? connected.has(e.id) : false
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/wf/definitions', auth, async (req, res) => {
    try {
      let q = withOrg(supabase.from('workflow_definitions').select(DEF_SELECT), req).order('created_at', { ascending: false });
      if (req.query.domain) q = q.eq('domain', req.query.domain);
      if (req.query.status) q = q.eq('status', req.query.status);
      const { data, error } = await q;
      if (error) throw error;
      (data || []).forEach(d => (d.steps || []).sort((a, b) => a.step_order - b.step_order));
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/wf/definitions', auth, async (req, res) => {
    try {
      if (!canDesign(req)) return res.status(403).json({ error: 'Forbidden' });
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: 'name required' });
      const steps = normalizeSteps(b.steps);
      // C-0022: this used to look up the org by the hard-coded slug 'fute',
      // or trust a body-supplied `org_id` — either way every new sequence
      // filed under one customer's org (or whichever org a caller named),
      // never the caller's own. `req.orgId` is the one source of truth.
      const { data: wf, error } = await supabase.from('workflow_definitions').insert({
        ...orgStamp(req),
        domain: b.domain || 'sales', name: b.name, description: b.description || null,
        entity_type: b.entity_type || 'contact', trigger_event: b.trigger_event || null,
        status: 'draft', created_by: req.user.id
      }).select().single();
      if (error) throw error;
      const { error: stErr } = await supabase.from('workflow_steps')
        .insert(steps.map(s => ({ ...s, workflow_id: wf.id, ...orgStamp(req) })));
      if (stErr) throw stErr;
      const { data: full } = await supabase.from('workflow_definitions').select(DEF_SELECT).eq('id', wf.id).single();
      res.json(full);
    } catch (err) { res.status(err.message.includes('required') || err.message.includes('channel') ? 400 : 500).json({ error: err.message }); }
  });

  router.put('/wf/definitions/:id', auth, async (req, res) => {
    try {
      if (!canDesign(req)) return res.status(403).json({ error: 'Forbidden' });
      // C-0022: this edited any org's workflow by id. A foreign definition
      // reads exactly like a missing one — 404, never 403, same shape as
      // every other by-id fix in this pass.
      const { data: owned } = await withOrg(
        supabase.from('workflow_definitions').select('id').eq('id', req.params.id), req
      ).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Workflow not found' });
      const b = req.body || {};
      const meta = {};
      ['name', 'description', 'domain', 'trigger_event'].forEach(k => { if (b[k] !== undefined) meta[k] = b[k]; });
      if (Array.isArray(b.steps)) {
        // Replacing steps under running enrollments would corrupt their state.
        const { count } = await supabase.from('workflow_enrollments')
          .select('id', { count: 'exact', head: true }).eq('workflow_id', req.params.id).eq('status', 'active');
        if (count > 0) return res.status(409).json({ error: `Workflow has ${count} active enrollment(s) — exit or complete them before editing steps.` });
        const steps = normalizeSteps(b.steps);
        await supabase.from('workflow_steps').delete().eq('workflow_id', req.params.id);
        const { error: stErr } = await supabase.from('workflow_steps')
          .insert(steps.map(s => ({ ...s, workflow_id: req.params.id, ...orgStamp(req) })));
        if (stErr) throw stErr;
        const { data: cur } = await supabase.from('workflow_definitions').select('version').eq('id', req.params.id).single();
        meta.version = (cur?.version || 1) + 1;
      }
      if (Object.keys(meta).length) {
        meta.updated_at = new Date().toISOString();
        const { error } = await supabase.from('workflow_definitions').update(meta).eq('id', req.params.id);
        if (error) throw error;
      }
      const { data } = await supabase.from('workflow_definitions').select(DEF_SELECT).eq('id', req.params.id).single();
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/wf/definitions/:id/status', auth, async (req, res) => {
    try {
      if (!canDesign(req)) return res.status(403).json({ error: 'Forbidden' });
      const status = req.body?.status;
      if (!['draft', 'active', 'archived'].includes(status)) return res.status(400).json({ error: 'status must be draft | active | archived' });
      // The org condition goes ON the update itself — a foreign id matches
      // zero rows rather than needing a separate check-then-mutate.
      const { data, error } = await withOrg(supabase.from('workflow_definitions')
        .update({ status, updated_at: new Date().toISOString() }), req)
        .eq('id', req.params.id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Workflow not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Enroll a contact (or any entity) into a workflow ───────────────────────
  router.post('/wf/enroll', auth, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.workflow_id) return res.status(400).json({ error: 'workflow_id required' });
      const entityId = b.entity_id || b.contact_id;
      if (!entityId) return res.status(400).json({ error: 'entity_id (or contact_id) required' });
      const metadata = { ...(b.metadata || {}) };
      const rot = await resolveFromMailboxes(req, b.from_mailbox_id ? [b.from_mailbox_id] : b.from_mailbox_ids);
      if (rot.length) { metadata.from_mailbox_id = rot[0].id; metadata.from_mailbox_email = rot[0].email; }
      if (b.any_stage) metadata.any_stage = true;
      const enrollment = await engine.enroll({
        workflow_id: b.workflow_id,
        entity_type: b.entity_type || 'contact',
        entity_id: entityId,
        job_id: b.job_id || null,
        contact_id: b.contact_id || ((b.entity_type || 'contact') === 'contact' ? entityId : null),
        enrolled_by: req.user.id,
        metadata
      });
      if (b.job_id) await logActivity(b.job_id, b.contact_id || null, req.user.id, 'workflow_enrolled', `Enrolled in workflow`, null, null);
      res.json(enrollment);
    } catch (err) {
      const msg = err.message || 'enroll failed';
      res.status(/not found|not active|already|expects|no steps/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });

  // ── Bulk enroll a SELECTION into a workflow ("Start sequence") ─────────────
  // Body: { workflow_id, entity_type, items:[{entity_id, job_id?, contact_id?}] }
  // or { workflow_id, entity_type, entity_ids:[...] , job_id? }. Enrolls each;
  // "already enrolled" is counted as skipped, not an error.
  router.post('/wf/enroll-bulk', auth, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.workflow_id) return res.status(400).json({ error: 'workflow_id required' });
      const entityType = b.entity_type || 'contact';
      const items = Array.isArray(b.items) && b.items.length
        ? b.items
        : (Array.isArray(b.entity_ids) ? b.entity_ids.map(id => ({ entity_id: id })) : []);
      if (!items.length) return res.status(400).json({ error: 'items or entity_ids required' });

      // Validated "from" mailboxes to rotate across (in the order given). A
      // plain BD/recruiter may only rotate through their own mailboxes.
      const rotation = await resolveFromMailboxes(req, b.from_mailbox_ids);
      const anyStage = !!b.any_stage;
      const baseMeta = b.metadata || {};

      const out = { enrolled: 0, skipped: 0, errors: [], rotation: rotation.map(m => m.email) };
      let idx = 0;
      for (const it of items) {
        const entityId = it.entity_id || it.contact_id;
        if (!entityId) { out.errors.push({ entity_id: null, error: 'missing entity_id' }); continue; }
        const jobId = it.job_id || b.job_id || null;
        const chosen = rotation.length ? rotation[idx % rotation.length] : null;
        idx++;
        const metadata = { ...baseMeta, ...(it.metadata || {}) };
        if (chosen) { metadata.from_mailbox_id = chosen.id; metadata.from_mailbox_email = chosen.email; }
        if (anyStage) metadata.any_stage = true;
        try {
          await engine.enroll({
            workflow_id: b.workflow_id, entity_type: entityType, entity_id: entityId,
            job_id: jobId, contact_id: it.contact_id || (entityType === 'contact' ? entityId : null),
            enrolled_by: req.user.id, metadata
          });
          out.enrolled++;
          if (jobId) await logActivity(jobId, it.contact_id || null, req.user.id, 'workflow_enrolled', 'Enrolled in sequence', null, null);
        } catch (e) {
          if (/already/i.test(e.message || '')) out.skipped++;
          else out.errors.push({ entity_id: entityId, error: e.message });
        }
      }
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/wf/enrollments', auth, async (req, res) => {
    try {
      // C-0022 #4: every user saw every enrollment — contact names/emails,
      // lead titles and companies, across the whole org. Org-scoped, and then
      // filtered by the enrollment's LEAD (D-0034 `canSeeLead`) for the
      // enrollments that have one — a contact/job-type sequence is exactly
      // the lead-outreach vocabulary D-0034 already scopes everywhere else.
      // Candidate/submission-type enrollments (job_id null by design) are
      // untouched here; that ownership question is a separate, larger piece
      // of guild's recruiting-side work and is not narrowed by this pass.
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, req.orgId || null);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
      let q = withOrg(supabase.from('workflow_enrollments')
        .select('*, workflow:workflow_definitions(id,name,domain), contact:contacts(id,first_name,last_name,email), job:jobs(id,position,assigned_to_bd,created_by,assigned_to,company:companies(name))'), req)
        .order('created_at', { ascending: false }).limit(500);
      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.workflow_id) q = q.eq('workflow_id', req.query.workflow_id);
      if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []).filter(r => scope.all || !r.job_id || own.canSeeLead(r.job, scope));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/wf/enrollments/:id/runs', auth, async (req, res) => {
    try {
      // Confirm the enrollment is this org's before returning its run
      // history — `workflow_step_runs` rows are keyed by enrollment_id alone.
      const { data: enr } = await withOrg(
        supabase.from('workflow_enrollments').select('id').eq('id', req.params.id), req
      ).maybeSingle();
      if (!enr) return res.status(404).json({ error: 'Enrollment not found' });
      const { data, error } = await supabase.from('workflow_step_runs')
        .select('*').eq('enrollment_id', req.params.id).order('run_at');
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/wf/enrollments/:id/pause', auth, async (req, res) => setEnrollmentStatus(req, res, 'paused', { fromStatuses: ['active'] }));
  router.post('/wf/enrollments/:id/resume', auth, async (req, res) => setEnrollmentStatus(req, res, 'active', { fromStatuses: ['paused'] }));
  router.post('/wf/enrollments/:id/exit', auth, async (req, res) => setEnrollmentStatus(req, res, 'exited', { fromStatuses: ['active', 'paused'], exitReason: req.body?.reason || 'manual', close: true }));

  async function setEnrollmentStatus(req, res, status, { fromStatuses, exitReason, close }) {
    try {
      const patch = { status, updated_at: new Date().toISOString() };
      if (exitReason) patch.exit_reason = exitReason;
      if (close) patch.completed_at = new Date().toISOString();
      // The org condition goes ON the update — pause/resume/exit any org's
      // enrollment by id was reachable before this.
      const { data, error } = await withOrg(supabase.from('workflow_enrollments').update(patch), req)
        .eq('id', req.params.id).in('status', fromStatuses).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: `Enrollment is not in a state that allows "${status}"` });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  }

  router.post('/wf/tick', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
      res.json(await engine.tick());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/wf/stats', auth, async (req, res) => {
    try {
      const { data, error } = await withOrg(
        supabase.from('workflow_enrollments').select('workflow_id,status'), req
      );
      if (error) throw error;
      const byWorkflow = {};
      (data || []).forEach(r => {
        byWorkflow[r.workflow_id] = byWorkflow[r.workflow_id] || { active: 0, paused: 0, completed: 0, exited: 0, failed: 0 };
        byWorkflow[r.workflow_id][r.status] = (byWorkflow[r.workflow_id][r.status] || 0) + 1;
      });
      res.json({ by_workflow: byWorkflow, total: (data || []).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
