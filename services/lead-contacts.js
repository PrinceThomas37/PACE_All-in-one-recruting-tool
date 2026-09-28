// ============================================================================
// ADDING A PERSON TO A LEAD — the one way it happens (R-053).
//
// "Add contact" (POST /contacts) and the POC finder's Accept (POST
// /jobs/:id/poc/suggestions/:sid/accept) both put a person on a lead, and the
// CAPABILITIES rule is that two live paths to one outcome is the bug. So both
// call this: the same row shape, the same email-deliverability classification
// (which is what the send engine reads), the same activity-log line.
//
// The CALLER decides who may add (canTouchJob) — this only does the adding.
// `activityText` lets a caller say where the person came from in the lead's
// history ("…from the POC finder (Apollo)") — a prospect may one day ask
// where PACE got their address, and the answer must exist.
// ============================================================================
const { classifyEmailDeliverability } = require('../email-validation');

async function addLeadContact({ db, req, logActivity, fields, activityText }) {
  const f = fields || {};
  const row = {
    job_id: f.job_id,
    first_name: f.first_name,
    last_name: f.last_name || '',
    designation: f.designation == null ? null : f.designation,
    email: f.email || null,
    phone: f.phone || null,
    linkedin: f.linkedin || null,
    is_primary: !!f.is_primary,
  };
  // org_id is stamped by the models layer.
  if (row.email) { try { row.email_status = await classifyEmailDeliverability(row.email); } catch (_) {} }
  const { data, error } = await db.forRequest(req).from('contacts').insert(row).select().single();
  if (error) throw error;
  if (logActivity) {
    await logActivity(row.job_id, data.id, req.user.id, 'contact_added',
      activityText || `Contact added: ${row.first_name} ${row.last_name || ''}`.trim(), null, null);
  }
  return data;
}

module.exports = { addLeadContact };
