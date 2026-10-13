'use strict';
// ============================================================================
// WALKTHROUGH REQUESTS FROM THE WEBSITE (R-216, D-0137)
// ----------------------------------------------------------------------------
// paceconsultant.in has a "Book a walkthrough" form. It used to open the
// visitor's own email app (mailto:), which does nothing for somebody on webmail
// with no mail app set up: the request was lost and nobody ever knew. Now the
// form posts to the app and the request lands in PACE itself (owner, 13 Oct:
// "make each request land in PACE as a new lead" — "Yes").
//
// WHERE IT LANDS IS A DEPLOYMENT DECISION, NOT A GUESS. `WEBSITE_LEADS_ORG_ID`
// names the organisation whose lead list receives these. The first organisation
// on this deployment is a CUSTOMER's (Fute Global, migration 022), so falling
// back to it would put PACE's own prospects — other staffing firms — into a
// customer's lead pool. With no organisation set, every request is still KEPT
// (app_settings, the same store as /auth/signup-request), nothing is put in
// anybody's lead list, and the route tells the visitor to email instead (D-0138).
//
// What a request becomes in that organisation:
//   * a lead in the Unassigned pool (source "Website · walkthrough request"),
//     the person as its contact. Unassigned leads are never emailed by
//     themselves (D-0110): one becomes somebody's when they write to it or a
//     manager hands it out.
//   * a reminder for the organisation's first admin, due the day it arrives,
//     saying who asked (reminder_type 'website_request', described in
//     services/reminder-source.js) — so it shows in "Needs you today" instead
//     of sitting unseen in a pool.
//   * the same email asking again makes NO second lead: the reminder goes on the
//     lead that person is already on (which may be one you cold-emailed).
//
// PURE apart from the injected `db` (models/) and `now`.
// ============================================================================

const PLANS = ['Not sure yet', 'Start', 'Pro', 'Max', 'Enterprise'];
const LIMITS = { name: 120, email: 200, agency: 200 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SOURCE = 'Website · walkthrough request';
const POSITION = 'PACE walkthrough';

// One line, no control characters, bounded — this text ends up on screens and in reminders.
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// `%` and `_` are wildcards to ILIKE; an email or agency name containing one must match only itself.
function exactLike(s) { return String(s).replace(/[\\%_]/g, (c) => '\\' + c); }

/**
 * Read the form. Returns { request } | { error } | { spam: true }.
 * `website` is a field people never see (a honeypot): only a bot fills it in.
 */
function parseRequest(body) {
  const b = body || {};
  if (clean(b.website, 200)) return { spam: true };
  const name = clean(b.name, LIMITS.name);
  const email = clean(b.email, LIMITS.email).toLowerCase();
  const agency = clean(b.agency, LIMITS.agency);
  const planIn = clean(b.plan, 40).toLowerCase();
  const plan = PLANS.find((p) => p.toLowerCase() === planIn) || 'Not sure yet';
  if (!name) return { error: 'Please add your name.' };
  if (!email || !EMAIL_RE.test(email)) return { error: 'Please enter a valid work email.' };
  if (!agency) return { error: "Please add your agency's name." };
  return { request: { name, email, agency, plan } };
}

function splitName(name) {
  const parts = String(name).split(' ').filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

// The organisation's longest-standing active admin: the person who answers for it.
async function firstAdmin(scoped) {
  const { data, error } = await scoped.from('users').select('id,role,roles,created_at').eq('is_active', true);
  if (error) throw error;
  const admins = (data || []).filter((u) => u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin')));
  admins.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return admins[0] || null;
}

// The live lead this email is already a contact on, if any.
async function knownContact(scoped, email) {
  const { data, error } = await scoped.from('contacts').select('id,job_id').ilike('email', exactLike(email)).limit(5);
  if (error) throw error;
  for (const c of data || []) {
    if (!c.job_id) continue;
    const job = await scoped.from('jobs').select('id,deleted_at').eq('id', c.job_id).maybeSingle();
    if (job.error) throw job.error;
    if (job.data && !job.data.deleted_at) return { contactId: c.id, jobId: c.job_id };
  }
  return null;
}

async function createLead(scoped, request, adminId) {
  const found = await scoped.from('companies').select('id').ilike('name', exactLike(request.agency)).limit(1);
  if (found.error) throw found.error;
  let companyId = found.data && found.data[0] ? found.data[0].id : null;
  if (!companyId) {
    const made = await scoped.from('companies').insert({ name: request.agency, created_by: adminId }).select('id').single();
    if (made.error) throw made.error;
    companyId = made.data.id;
  }
  const lead = await scoped.from('jobs').insert({
    company_id: companyId, position: POSITION, source: SOURCE, stage: 'Unassigned', freshness: 'New',
    notes: `Asked for a 20-minute walkthrough on the website. Plan: ${request.plan}.`,
    created_by: adminId,
  }).select('id').single();
  if (lead.error) throw lead.error;
  const nm = splitName(request.name);
  const contact = await scoped.from('contacts').insert({
    job_id: lead.data.id, first_name: nm.first_name, last_name: nm.last_name, email: request.email, is_primary: true,
  }).select('id').single();
  if (contact.error) throw contact.error;
  // Best-effort, like logActivity: the lead exists either way.
  try {
    await scoped.from('activity_log').insert({
      job_id: lead.data.id, contact_id: contact.data.id, user_id: null, action_type: 'job_created',
      description: 'Lead created from a walkthrough request on the website',
    });
  } catch (_) { /* the history line is not worth failing the request */ }
  return { jobId: lead.data.id, contactId: contact.data.id };
}

/**
 * Keep the request, then (when an organisation is configured) turn it into a
 * lead + a reminder there. Throws only if the request could not be KEPT; a
 * failure after that is returned as `lead_error` — the request is not lost, and
 * the caller logs it for the operator.
 */
async function recordWalkthroughRequest({ db, orgId, request, now }) {
  const at = now.toISOString();
  const kept = await db.global.from('app_settings').upsert({
    key: 'site_request:' + request.email,
    // Only what the person typed and when: the privacy page names exactly these four fields.
    value: JSON.stringify({ ...request, at }),
    updated_at: at,
  }, { onConflict: 'key' });
  if (kept && kept.error) throw kept.error;
  const out = { kept: true, destination: orgId ? 'org' : 'none', lead_id: null, new_lead: false, reminded: false, lead_error: null };
  if (!orgId) return out;

  try {
    const scoped = db.forOrg(orgId);
    const admin = await firstAdmin(scoped);
    const adminId = admin ? admin.id : null;
    const known = await knownContact(scoped, request.email);
    const lead = known || await createLead(scoped, request, adminId);
    out.lead_id = lead.jobId;
    out.new_lead = !known;
    if (adminId) {
      const r = await scoped.from('reminders').insert({
        job_id: lead.jobId, user_id: adminId, contact_id: lead.contactId,
        contact_name: request.name, company_name: request.agency, email: request.email,
        return_date: at.slice(0, 10), reminder_time: '09:00', status: 'pending', reminder_type: 'website_request',
        note: `${request.name} (${request.agency}) asked for a walkthrough on the website${known ? ' again' : ''}. Plan: ${request.plan}. Reply to ${request.email} to set a time.`,
      });
      if (r.error) throw r.error;
      out.reminded = true;
    }
  } catch (err) {
    out.lead_error = (err && err.message) || String(err);
  }
  return out;
}

module.exports = { parseRequest, recordWalkthroughRequest, PLANS, SOURCE, POSITION, LIMITS };
