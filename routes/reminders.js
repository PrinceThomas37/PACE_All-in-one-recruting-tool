// ============================================================================
// REMINDERS
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/reminders')(ctx));
//
// Converted to the models/ layer: every query here goes through
// db.forRequest(req), so the org filter is applied by construction rather than
// remembered. Previously these four queries scoped by user_id ONLY and the
// insert relied on the org_id column DEFAULT — correct while there is one org,
// silently wrong the day there are two. Behaviour today is unchanged (every
// live row carries the default org, verified: 6 rows, 0 with a null org_id).
//
// ── WHAT GET /reminders RETURNS, AND WHY IT IS MORE THAN THE ROW (Session 24)
// The owner opened this page, found five tasks waiting, and asked what they
// were based on. The `reminders` row cannot answer that: it stores the note,
// the person and the date, and records the origin only as `reminder_type` —
// 'bd_touch', a workflow CHANNEL name that was never shown and would mean
// nothing to a recruiter if it were. So the read does three things the row
// cannot:
//
//   1. `source`  — why this exists, in plain English, resolved against the
//      workflow tables when the reminder came from a sequence (one batched
//      lookup for the whole page, never per row).
//   2. `note`    — RENDERED. The stored note carries merge fields written in
//      the recruiting vocabulary ({{first_name}}, {{position}}) against the
//      sales one, so every task ever created by the default sequence read
//      "Hi {{first_name}}, I emailed you about the {{position}} role at KB
//      Home". `fillTemplate` now knows both vocabularies; rendering on read is
//      what gets that fix to rows already in the database. `note_raw` keeps
//      the stored text for anything that needs to edit it.
//   3. `compose` — the contact's email, the role, the company. The Compose
//      button used to depend on the browser's own cache of leads holding this
//      lead; when it did not, the composer opened with an EMPTY "To" field and
//      an unfilled template. The reminder knows all of it. It says so.
// ============================================================================
const express = require('express');
const { fillTemplate, buildEmailVars } = require('../email-vars');
const { describeReminder, dueState, dueLabel } = require('../services/reminder-source');

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth, today } = ctx;

  // Which sequence produced each of these reminders? One query for the page,
  // keyed by "contactId:jobId" — the pair a sales enrollment is unique on.
  //
  // This is best-effort by design. A reminder does not store its enrollment, so
  // this is an inference from the contact + job it names, and an inference can
  // come back empty (the enrollment was deleted, the contact re-enrolled in a
  // different sequence since). An empty answer degrades to the generic
  // sentence; it never guesses a sequence name. A confident wrong provenance
  // would send someone looking at the wrong cadence.
  async function sequenceContext(req, rows) {
    const pairs = rows.filter(r => r.contact_id && (r.reminder_type === 'bd_touch' || r.reminder_type === 'reminder'));
    if (!pairs.length) return {};
    const contactIds = [...new Set(pairs.map(r => r.contact_id))];
    const scoped = db.forRequest(req);
    const { data: enrollments } = await scoped.from('workflow_enrollments')
      .select('workflow_id,contact_id,job_id,current_step_order,workflow:workflow_definitions(id,name)')
      .in('contact_id', contactIds);
    if (!enrollments || !enrollments.length) return {};

    // Step names come from the definitions the enrollments actually point at.
    const wfIds = [...new Set(enrollments.map(e => e.workflow_id).filter(Boolean))];
    const { data: steps } = wfIds.length
      ? await scoped.from('workflow_steps').select('workflow_id,step_order,name,channel').in('workflow_id', wfIds)
      : { data: [] };
    const byWorkflow = {};
    (steps || []).forEach(s => { (byWorkflow[s.workflow_id] = byWorkflow[s.workflow_id] || []).push(s); });

    const out = {};
    enrollments.forEach(e => {
      const all = (byWorkflow[e.workflow_id] || []).slice().sort((a, b) => a.step_order - b.step_order);
      // The step that created a reminder is the one whose channel makes
      // reminders — if the sequence has exactly one, that is the answer without
      // guessing. More than one and we name the sequence but not the step.
      const taskSteps = all.filter(s => s.channel === 'bd_touch' || s.channel === 'reminder');
      const step = taskSteps.length === 1 ? taskSteps[0] : null;
      out[`${e.contact_id}:${e.job_id || ''}`] = {
        name: e.workflow?.name || null,
        stepOrder: step ? step.step_order : null,
        stepName: step ? step.name : null,
        totalSteps: all.length || null
      };
    });
    return out;
  }

router.get('/reminders', auth, async (req, res) => {
  try {
    const { data, error } = await db.forRequest(req).from('reminders')
      .select(`*, job:jobs(id,position,location,industry,stage,company_id,company:companies(name,industry,location)), contact:contacts(id,first_name,last_name,email,designation,linkedin)`)
      .eq('user_id', req.user.id).order('return_date');
    if (error) throw error;

    const rows = data || [];
    const seqByPair = await sequenceContext(req, rows);
    const t = today();

    const enriched = rows.map(r => {
      const job = r.job || null;
      const contact = r.contact || null;
      // Render the stored note the same way the outbound path renders a stored
      // body: with the facts of the record it belongs to. {{sender}} stays a
      // token in storage everywhere else in PACE because the sending mailbox is
      // not known until send time — a note is not sent, it is read by the person
      // whose task it is, so it is filled with their own name.
      const vars = job
        ? { ...buildEmailVars({ job, contact, senderDisplayName: req.user.name || '' }) }
        : { fn: (contact?.first_name) || '', company: r.company_name || '', sender: req.user.name || '' };
      const seq = seqByPair[`${r.contact_id}:${r.job_id || ''}`] || null;
      const due = dueState(r.return_date, t);
      return {
        ...r,
        note_raw: r.note,
        note: r.note ? fillTemplate(r.note, vars) : r.note,
        source: describeReminder(r, seq),
        due_state: due.state,
        due_days: due.days,
        due_label: dueLabel(r.return_date, t),
        // Everything the composer needs, from the record rather than from
        // whatever the browser happens to have cached.
        compose: {
          to_email: contact?.email || r.email || null,
          to_name: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || r.contact_name || '',
          designation: contact?.designation || '',
          company: job?.company?.name || r.company_name || '',
          position: job?.position || '',
          location: job?.location || job?.company?.location || '',
          industry: job?.company?.industry || job?.industry || '',
          job_id: r.job_id || job?.id || null,
          contact_id: r.contact_id || contact?.id || null,
          can_send: !!((contact?.email || r.email) && (r.job_id || job?.id))
        }
      };
    });
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reminders', auth, async (req, res) => {
  try {
    const { job_id, contact_name, company_name, email, return_date, reminder_time, note, contact_id, reminder_type } = req.body;
    if (!return_date) return res.status(400).json({ error: 'Return date required' });
    const { data, error } = await db.forRequest(req).from('reminders').insert({ job_id: job_id || null, user_id: req.user.id, contact_name, company_name, email, return_date, reminder_time: reminder_time || '09:00', note, status: 'pending', contact_id: contact_id || null, reminder_type: reminder_type || null }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/reminders/:id', auth, async (req, res) => {
  try {
    const { status, return_date, reminder_time, note } = req.body;
    const updates = { updated_at: new Date() };
    if (status) updates.status = status;
    if (return_date) updates.return_date = return_date;
    if (reminder_time) updates.reminder_time = reminder_time;
    if (note !== undefined) updates.note = note;
    const { data, error } = await db.forRequest(req).from('reminders').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/reminders/:id', auth, async (req, res) => {
  try {
    await db.forRequest(req).from('reminders').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
