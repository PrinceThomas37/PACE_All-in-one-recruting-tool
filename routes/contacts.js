// ============================================================================
// CONTACTS (mutations)
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/contacts')(ctx));
//
// GET /jobs/:job_id/contacts stays inline in index.js with the other /jobs
// sub-routes; this module owns the /contacts write endpoints.
//
// events + email-validation are required directly (Node caches each module, so
// these are the same singletons index.js uses — emit reaches the same bus that
// registerSubscribers listens on).
//
// Converted to the models/ layer. Every query is org-scoped by construction now.
// That closes a real gap: PATCH /contacts/:id/email-status updated a contact BY
// ID with no org filter and — unlike the PUT/DELETE below it — no canTouchJob
// check either, so a BD in one org could have patched another org's contact by
// guessing an id. The OOO reminder it creates was unstamped for the same reason.
// Behaviour today is unchanged (one org; 3,123 contacts, 0 with a null org_id).
// ============================================================================
const express = require('express');
const { classifyEmailDeliverability } = require('../email-validation');
const { EVENTS, emit } = require('../events');

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth, hasRole, canTouchJob, logActivity, isPermanentFollowupBlock } = ctx;

router.post('/contacts', auth, async (req, res) => {
  try {
    const { job_id, first_name, last_name, designation, email, phone, linkedin, is_primary } = req.body;
    if (!job_id || !first_name) return res.status(400).json({ error: 'job_id and first_name required' });
    if (!(await canTouchJob(req, job_id))) return res.status(403).json({ error: 'Forbidden' });
    // org_id is stamped by the models layer — no orgStamp(req) spread needed.
    const contactRow = { job_id, first_name, last_name: last_name || '', designation, email, phone, linkedin, is_primary: !!is_primary };
    if (email) { try { contactRow.email_status = await classifyEmailDeliverability(email); } catch (_) {} }
    const { data, error } = await db.forRequest(req).from('contacts').insert(contactRow).select().single();
    if (error) throw error;
    await logActivity(job_id, data.id, req.user.id, 'contact_added', `Contact added: ${first_name} ${last_name || ''}`.trim(), null, null);
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/contacts/:id', auth, async (req, res) => {
  try {
    const existing = await db.forRequest(req).from('contacts').byId(req.params.id, 'job_id');
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!(await canTouchJob(req, existing.job_id))) return res.status(403).json({ error: 'Forbidden' });
    const fields = ['first_name','last_name','designation','email','phone','linkedin','is_primary','email_status','ooo_until'];
    const updates = { updated_at: new Date() };
    fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    const { data, error } = await db.forRequest(req).from('contacts').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (req.body.email_status !== undefined && isPermanentFollowupBlock(req.body.email_status)) {
      emit(EVENTS.CONTACT_INVALIDATED, { contactId: req.params.id, jobId: existing.job_id, reason: 'manual', actorUserId: req.user.id });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contacts/:id', auth, async (req, res) => {
  try {
    const existing = await db.forRequest(req).from('contacts').byId(req.params.id, 'job_id');
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!(await canTouchJob(req, existing.job_id))) return res.status(403).json({ error: 'Forbidden' });
    await db.forRequest(req).from('contacts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/contacts/:id/email-status', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd', 'bd_lead')) return res.status(403).json({ error: 'BD role required' });
    const { email_status, ooo_until } = req.body;
    const allowed = ['valid','invalid','deactivated','out_of_office'];
    if (!allowed.includes(email_status)) return res.status(400).json({ error: 'Invalid status' });
    const updates = { email_status, updated_at: new Date() };
    if (email_status === 'out_of_office' && ooo_until) updates.ooo_until = ooo_until;
    if (email_status !== 'out_of_office') updates.ooo_until = null;
    const { data: contact, error } = await db.forRequest(req).from('contacts').update(updates).eq('id', req.params.id).select('*, job:jobs(id,position,company:companies(name))').single();
    if (error) throw error;
    if (email_status === 'out_of_office' && ooo_until) {
      const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
      await db.forRequest(req).from('reminders').insert({ job_id: contact.job_id, user_id: req.user.id, contact_name: contactName, company_name: contact.job?.company?.name || '', email: contact.email, return_date: ooo_until, reminder_time: '09:00', note: `${contactName} is back from OOO.`, status: 'pending', reminder_type: 'ooo_return', contact_id: contact.id });
      await logActivity(contact.job_id, contact.id, req.user.id, 'ooo_set', `${contactName} marked OOO until ${ooo_until}`, null, { ooo_until });
    }
    if (isPermanentFollowupBlock(email_status)) {
      emit(EVENTS.CONTACT_INVALIDATED, { contactId: contact.id, jobId: contact.job_id, reason: 'manual', actorUserId: req.user.id });
    }
    res.json(contact);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
