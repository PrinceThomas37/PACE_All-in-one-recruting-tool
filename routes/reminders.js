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
const { describeOutreach, canBeContactedDirectly } = require('../services/outreach-dedup');
const ownershipRules = require('../services/ownership');

// ── WHOSE LEAD MAY A REMINDER SHOW? (R-047 B2) ──────────────────────────────
// `reminders` stores a job_id and a contact_id, and GET /reminders EMBEDS the
// lead and the contact through PostgREST joins. An embedded join is NOT
// org-filtered — db.forRequest scopes the `reminders` table, not what it
// points at — and POST /reminders used to accept any job_id / contact_id
// unchecked. So creating a reminder naming any lead id, in any company, read
// that lead's position, company and contact's email/phone/LinkedIn back out.
//
// Two halves, because either alone leaves a hole:
//   * WRITE: the lead must be one the caller may touch (canTouchJob, org-bound)
//     and the contact must be that lead's, in the caller's org.
//   * READ: rows written before this fix (or by any other writer) are checked
//     again here — the embed is kept only when the lead is in the caller's
//     org AND in their view scope (ownership.canSeeLead, D-0034), and the
//     contact is in the org and hangs off THAT lead. A row that fails keeps
//     its own stored text (contact_name, company_name, email — written by or
//     for its owner) and loses the embed; it is never deleted or hidden.
//
// PURE: the caller supplies the org and the scope.
function reminderEmbedFor(r, { orgId, scope } = {}) {
  const inOrg = (x) => !!x && (!orgId || x.org_id === orgId);
  let job = r && r.job;
  if (!inOrg(job) || (r.job_id && job.id !== r.job_id) || !ownershipRules.canSeeLead(job, scope)) job = null;
  if (job && job.company && job.company.org_id !== undefined && !inOrg(job.company)) job = { ...job, company: null };
  let contact = r && r.contact;
  if (!inOrg(contact) || !job || contact.job_id !== job.id || (r.contact_id && contact.id !== r.contact_id)) contact = null;
  const withheld = !!((r && r.job && !job) || (r && r.contact && !contact));
  return { job, contact, withheld };
}

const WITHHELD_SENTENCE = 'This lead is no longer on your desk, so PACE will not send from this reminder. Mark it done, or ask the lead\'s owner.';

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth, today, canTouchJob, reportingChainIds } = ctx;

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

  // What has already been emailed to these contacts?
  //
  // One query for the page, keyed by "contactId:jobId". This is what lets a card
  // say "three emails already went, the last one today" BEFORE offering a fourth
  // — the guard that refuses the send has always existed, it was simply invisible
  // until the moment of sending (see services/outreach-dedup.js).
  async function outreachContext(req, rows) {
    const withContact = rows.filter(r => r.contact_id);
    if (!withContact.length) return {};
    const contactIds = [...new Set(withContact.map(r => r.contact_id))];
    const { data: emails } = await db.forRequest(req).from('emails')
      .select('contact_id,job_id,status,sent_at,followup_type')
      .in('contact_id', contactIds);
    const byPair = {};
    (emails || []).forEach(e => {
      const key = `${e.contact_id}:${e.job_id || ''}`;
      (byPair[key] = byPair[key] || []).push(e);
    });
    return byPair;
  }

router.get('/reminders', auth, async (req, res) => {
  try {
    const { data, error } = await db.forRequest(req).from('reminders')
      .select(`*, job:jobs(id,org_id,position,location,industry,stage,company_id,assigned_to_bd,created_by,assigned_to,company:companies(org_id,name,industry,location)), contact:contacts(id,org_id,job_id,first_name,last_name,email,designation,linkedin,phone)`)
      .eq('user_id', req.user.id).order('return_date');
    if (error) throw error;

    // Scope first with the caller alone (no query); fetch the reporting chain
    // only if some lead is not visibly theirs — most pages never need it.
    const orgId = req.orgId || req.user?.org_id || null;
    const who = { role: req.user.role, roles: req.user.roles, userId: req.user.id };
    let scope = ownershipRules.viewScope({ ...who, chainIds: [] });
    if (!scope.all && reportingChainIds && (data || []).some(r => r.job && !ownershipRules.canSeeLead(r.job, scope))) {
      const chain = await reportingChainIds(req.user.id, orgId).catch(() => []);
      scope = ownershipRules.viewScope({ ...who, chainIds: chain || [] });
    }
    // Every downstream lookup (sequence, sent mail) runs on the SAFE rows, so a
    // withheld contact cannot leak back through the enrichment either.
    const rows = (data || []).map(r => {
      const e = reminderEmbedFor(r, { orgId, scope });
      return { ...r, job: e.job, contact: e.contact, _withheld: e.withheld };
    });
    const lookupRows = rows.map(r => (r._withheld ? { ...r, contact_id: r.contact ? r.contact_id : null } : r));
    const [seqByPair, mailByPair] = await Promise.all([
      sequenceContext(req, lookupRows),
      outreachContext(req, lookupRows)
    ]);
    const t = today();

    const enriched = rows.map(({ _withheld, ...r }) => {
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
      const pairKey = _withheld && !contact ? '__withheld__' : `${r.contact_id}:${r.job_id || ''}`;
      const seq = seqByPair[pairKey] || null;
      const described = describeOutreach(mailByPair[pairKey] || [], t);
      // A withheld lead (R-047 B2) is not something this page may send from:
      // it rides the same `blocked` channel the page already honours, so no
      // screen needs a new branch to refuse it up front.
      const outreach = _withheld
        ? { ...described, blocked: true, block_reason: 'not_on_desk', block_sentence: WITHHELD_SENTENCE }
        : described;
      const due = dueState(r.return_date, t);
      // A bd_touch step asks for a CALL. Whether that is even possible is a
      // property of the record, and the card must say so rather than offering a
      // phone icon with nothing behind it.
      const isCallTask = r.reminder_type === 'bd_touch';
      const reachable = canBeContactedDirectly(contact);
      return {
        ...r,
        note_raw: r.note,
        note: r.note ? fillTemplate(r.note, vars) : r.note,
        source: describeReminder(r, seq),
        due_state: due.state,
        due_days: due.days,
        due_label: dueLabel(r.return_date, t),
        // What the sequence has already sent this contact, and whether another
        // email may go out right now. The page reads `blocked` to decide whether
        // to OFFER a send at all.
        outreach,
        // How this person can actually be reached, for a task that asks for a
        // call. `null` on a task that is not a call task.
        reach: isCallTask ? {
          phone: contact?.phone || null,
          linkedin: contact?.linkedin || null,
          reachable,
          sentence: reachable ? null
            : 'No phone number or LinkedIn is on this contact record, so there is no way to make this call yet. PACE no longer creates these — this one predates that.'
        } : null,
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
          job_id: _withheld ? (job?.id || null) : (r.job_id || job?.id || null),
          contact_id: _withheld ? (contact?.id || null) : (r.contact_id || contact?.id || null),
          can_send: !_withheld && !!((contact?.email || r.email) && (r.job_id || job?.id)) && !outreach.blocked,
          // Why a send is not on offer — stated here so the page can say it
          // BEFORE somebody composes an email the send path will refuse.
          blocked_sentence: outreach.blocked ? outreach.block_sentence : null
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
    // R-047 B2: a reminder may only point at a lead the caller may touch, and
    // at that lead's own contact, in the caller's org. Every miss — unknown,
    // other company, not yours, contact on a different lead — answers the same
    // 404, so an id cannot be probed. org_id is stamped by db.forRequest.
    const NOT_FOUND = { error: 'Lead or contact not found' };
    let jobId = job_id || null;
    const contactId = contact_id || null;
    if (contactId) {
      const { data: c } = await db.forRequest(req).from('contacts').select('id,job_id').eq('id', contactId).maybeSingle();
      if (!c || !c.job_id || (jobId && String(c.job_id) !== String(jobId))) return res.status(404).json(NOT_FOUND);
      jobId = c.job_id;
    }
    if (jobId && !(await canTouchJob(req, jobId))) return res.status(404).json(NOT_FOUND);
    const { data, error } = await db.forRequest(req).from('reminders').insert({ job_id: jobId, user_id: req.user.id, contact_name, company_name, email, return_date, reminder_time: reminder_time || '09:00', note, status: 'pending', contact_id: contactId, reminder_type: reminder_type || null }).select().single();
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
module.exports.reminderEmbedFor = reminderEmbedFor;
