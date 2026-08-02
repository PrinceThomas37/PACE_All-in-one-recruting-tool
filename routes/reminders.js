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
// ============================================================================
const express = require('express');

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth } = ctx;

router.get('/reminders', auth, async (req, res) => {
  try {
    const { data, error } = await db.forRequest(req).from('reminders')
      .select(`*, job:jobs(id,position,stage,company_id,company:companies(name)), contact:contacts(id,first_name,last_name,email)`)
      .eq('user_id', req.user.id).order('return_date');
    if (error) throw error;
    res.json(data);
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
