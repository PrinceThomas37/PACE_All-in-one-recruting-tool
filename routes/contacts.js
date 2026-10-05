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
const { addLeadContact, duplicateResponse, duplicatePayload } = require('../services/lead-contacts');
const contactPoints = require('../services/contact-points');
const { classifyEmailDeliverability } = require('../email-validation');
const { EVENTS, emit } = require('../events');

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth, hasRole, canTouchJob, logActivity, isPermanentFollowupBlock, ownership, reportingChainIds, orgIdFor, loadSuppressedSet } = ctx;

  // May this caller SEE that lead? The same rule as GET /jobs/:id (D-0034) —
  // the "already added" pop-up names a colleague's lead only when it is.
  async function canSeeLead(req, job) {
    if (!ownership || !job) return false;
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin || !reportingChainIds ? null : await reportingChainIds(req.user.id, orgIdFor ? orgIdFor(req) : req.orgId);
    return ownership.canSeeLead(job, ownership.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain }));
  }

router.post('/contacts', auth, async (req, res) => {
  try {
    const { job_id, first_name, last_name, designation, email, phone, linkedin, is_primary, allow_same_name, extra_emails, extra_phones } = req.body;
    if (!job_id || !first_name) return res.status(400).json({ error: 'job_id and first_name required' });
    if (!(await canTouchJob(req, job_id))) return res.status(403).json({ error: 'Forbidden' });
    // The one way a person is added to a lead — the POC finder's Accept uses
    // the same function (services/lead-contacts.js), and so the same
    // "already added" check: the same email anywhere is refused; the same name
    // on this lead or at this company is asked, and `allow_same_name` is the
    // person's "Add anyway".
    const data = await addLeadContact({ db, req, logActivity, allowSameName: allow_same_name === true,
      fields: { job_id, first_name, last_name, designation, email, phone, linkedin, is_primary, extra_emails, extra_phones } });
    res.status(201).json(data);
  } catch (err) {
    if (err && err.code === 'bad_contact_point') return res.status(400).json({ error: err.message });
    if (err && err.code === 'duplicate_contact') {
      let body;
      try { body = await duplicateResponse({ db, req, dup: err.duplicate, job: err.duplicate.job, canSee: (job) => canSeeLead(req, job) }); }
      catch (_) { body = duplicatePayload(err.duplicate, { visible: false }); }
      return res.status(409).json(body);
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/contacts/:id', auth, async (req, res) => {
  try {
    const existing = await db.forRequest(req).from('contacts').byId(req.params.id, 'job_id,email,phone,extra_emails,extra_phones,email_status');
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!(await canTouchJob(req, existing.job_id))) return res.status(403).json({ error: 'Forbidden' });
    const fields = ['first_name','last_name','designation','email','phone','linkedin','is_primary','email_status','ooo_until'];
    const updates = { updated_at: new Date() };
    fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    // Several emails / phones (D-0070): the extras are cleaned and stored; a typed phone must be a phone;
    // extras the form did not send are left alone.
    if (updates.phone && !contactPoints.looksLikePhone(updates.phone)) return res.status(400).json({ error: '"' + updates.phone + '" does not look like a phone number.' });
    const cp = contactPoints.normaliseForWrite(req.body, existing);
    if (cp.rejected.length) {
      const r = cp.rejected[0];
      return res.status(400).json({ error: r.reason === 'too_many'
        ? 'A person can have at most ' + contactPoints.MAX_EXTRAS + ' extra ' + (r.kind === 'phone' ? 'phone numbers' : 'email addresses') + '.'
        : '"' + r.value + '" does not look like ' + (r.kind === 'phone' ? 'a phone number.' : 'an email address.') });
    }
    Object.assign(updates, cp.columns);
    // THE SAFETY RULE: an address that opted out can never be made the main one.
    const newMain = updates.email !== undefined ? contactPoints.normEmail(updates.email) : '';
    if (updates.email !== undefined && newMain && newMain !== contactPoints.normEmail(existing.email)) {
      if (loadSuppressedSet) {
        const sup = await loadSuppressedSet([newMain]);
        if (sup.has(newMain)) return res.status(409).json({ error: 'That address opted out of email from us, so it cannot be the main address.', code: 'address_opted_out' });
      }
      // Switching to a different address: an "invalid" mark belongs to the OLD address (it bounced or its domain
      // is dead) — the new one is judged on its own, so a good second address brings the person back into the
      // follow-ups. Out of office / deactivated belong to the PERSON and stay.
      if (updates.email_status === undefined && existing.email_status === 'invalid') {
        try { updates.email_status = await classifyEmailDeliverability(newMain); } catch (_) {}
      }
    }
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
    // C-0021 #7: this was the one contact mutation with no canTouchJob gate at
    // all — any BD could mark another BD's contact invalid/OOO (which stops
    // THAT BD's follow-ups) just by knowing its id. Same check as its three
    // siblings (PUT/DELETE /contacts/:id, POST /contacts).
    const existing = await db.forRequest(req).from('contacts').byId(req.params.id, 'job_id');
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!(await canTouchJob(req, existing.job_id))) return res.status(403).json({ error: 'Forbidden' });
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
