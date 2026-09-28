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
//
// ── ALREADY ADDED? (owner, 2026-09-28) ─────────────────────────────────────
// "If the person or the email id already added. A pop-up should come like that
// they are already added." Until then nothing stopped the same person being
// typed onto a lead twice, or onto a second lead at the same firm — and the
// send engine emails every contact on a lead, so a second row is a second
// cold email to somebody PACE is already talking to. Two rules, deliberately
// different in strength:
//   * ONE ADDRESS IS ONE PERSON. The same email on any live lead in this org
//     is REFUSED — there is no "add anyway" for it.
//   * A NAME IS ONLY A CLUE. The same first + last name on this lead, or on
//     another lead at the same company, is ASKED: two people can share a name,
//     and the person adding may know better. `allowSameName` is their answer.
// The check lives HERE, in the one add path, so no screen can skip it.
// `findDuplicate` and `duplicatePayload` are pure; only `addLeadContact` and
// the lookup touch the database.
// ============================================================================
const { classifyEmailDeliverability } = require('../email-validation');

function emailKey(s) { return String(s || '').trim().toLowerCase(); }
// First AND last name, letters only, accents folded — "José O'Neil" and
// "jose oneil" are one key. A first name alone is never a match: "John" twice
// at one firm is ordinary.
function personKey(first, last) {
  const clean = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const f = clean(first), l = clean(last);
  return f && l ? f + ' ' + l : '';
}
const RANK = { this_lead: 0, company: 1, elsewhere: 2 };

/**
 * Is this person already in PACE?
 *   person:   { first_name, last_name, email } — who is being added
 *   existing: [{ id, first_name, last_name, email, designation, job_id, company_id }]
 *             — people on live leads (the lookup below supplies them)
 *   where:    { jobId, companyId } — the lead being added to
 * Returns { match: 'email'|'name', where: 'this_lead'|'company'|'elsewhere',
 * contact } or null. An email match always beats a name match; nearer beats
 * further. A name counts only on this lead or at the same company — the same
 * name at an unrelated firm is somebody else.
 */
function findDuplicate(person, existing, where) {
  const w = where || {};
  const em = emailKey(person && person.email);
  const nk = personKey(person && person.first_name, person && person.last_name);
  const place = (c) => (c.job_id === w.jobId ? 'this_lead' : (w.companyId && c.company_id === w.companyId ? 'company' : 'elsewhere'));
  let best = null;
  (existing || []).forEach(c => {
    if (!c) return;
    let match = null;
    if (em && emailKey(c.email) === em) match = 'email';
    else if (nk && personKey(c.first_name, c.last_name) === nk && place(c) !== 'elsewhere') match = 'name';
    if (!match) return;
    const hit = { match, where: place(c), contact: c };
    if (!best
      || (hit.match === 'email' && best.match !== 'email')
      || (hit.match === best.match && RANK[hit.where] < RANK[best.where])) best = hit;
  });
  return best;
}

/**
 * What the pop-up says. `visible` is whether the caller may SEE the lead the
 * other person is on (D-0034) — this lead always; a colleague's lead only if
 * their scope reaches it. Nothing from a lead the caller cannot see leaves
 * here but the address they typed themselves.
 *   opts: { visible, lead: { id, position, company } }
 */
function duplicatePayload(dup, opts) {
  const o = opts || {};
  const c = dup.contact || {};
  const visible = dup.where === 'this_lead' || !!o.visible;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'This person';
  const lead = visible && dup.where !== 'this_lead' && o.lead ? o.lead : null;
  const leadWords = lead ? `the ${lead.position || 'untitled'} lead${lead.company ? ' at ' + lead.company : ''}` : null;
  const addr = c.email || '';
  let title, message;
  if (dup.match === 'email') {
    title = 'Already added';
    if (dup.where === 'this_lead') message = `${name} (${addr}) is already on this lead.`;
    else if (dup.where === 'company') message = leadWords
      ? `${addr} is already on another lead at this company: ${leadWords}. PACE keeps one conversation per person.`
      : `${addr} is already on a colleague's lead at this company. PACE keeps one conversation per person.`;
    else message = leadWords
      ? `${addr} is already in PACE, on ${leadWords}. PACE keeps one conversation per person.`
      : `${addr} is already in PACE, on a colleague's lead. PACE keeps one conversation per person.`;
  } else {
    title = 'Already added?';
    if (dup.where === 'this_lead') message = `Someone named ${name} is already on this lead${addr ? ' (' + addr + ')' : ''}. Is this the same person?`;
    else message = leadWords
      ? `Someone named ${name} is already on another lead at this company: ${leadWords}${addr ? ' (' + addr + ')' : ''}. Is this the same person?`
      : `Someone named ${name} is already on a colleague's lead at this company. Is this the same person?`;
  }
  return {
    error: message,
    duplicate: {
      match: dup.match, where: dup.where, title, message,
      can_add_anyway: dup.match === 'name',
      person: visible ? { name, email: c.email || null, title: c.designation || null } : null,
      lead: lead ? { id: lead.id || null, position: lead.position || null, company: lead.company || null } : null,
    },
  };
}

class DuplicateContactError extends Error {
  constructor(dup) { super('This person is already added.'); this.code = 'duplicate_contact'; this.duplicate = dup; }
}

// What a lead row must carry for ownership.canSeeLead to judge it.
const JOB_COLS = 'id,company_id,position,stage,created_by,assigned_to,assigned_to_bd,deleted_at';
const PERSON_COLS = 'id,first_name,last_name,email,designation,job_id';

/**
 * The people a new person could be a repeat of: everybody on the live leads
 * at this company (for the name check), plus anybody anywhere in the org with
 * the same address (for the email check). Org-scoped by construction
 * (db.forRequest). Returns { people (each with its lead's company_id), jobs }.
 */
async function lookupExisting({ db, req, jobId, companyId, email }) {
  const D = db.forRequest(req);
  const jobs = {};
  let companyJobIds = [jobId];
  if (companyId) {
    const { data } = await D.from('jobs').select(JOB_COLS).eq('company_id', companyId).is('deleted_at', null).limit(200);
    (data || []).forEach(j => { jobs[j.id] = j; });
    companyJobIds = [...new Set([jobId].concat((data || []).map(j => j.id)))];
  }
  const { data: nearby } = await D.from('contacts').select(PERSON_COLS).in('job_id', companyJobIds).limit(2000);
  const people = (nearby || []).slice();
  const em = emailKey(email);
  if (em) {
    // Typed by a person, so a literal % or _ must match itself, never act as
    // an ILIKE wildcard (same reasoning as routes/ownership-requests.js); the
    // exact comparison after it is what decides.
    const escaped = em.replace(/[\\%_]/g, ch => '\\' + ch);
    const { data: byEmail } = await D.from('contacts').select(PERSON_COLS).ilike('email', escaped).limit(50);
    const hits = (byEmail || []).filter(c => emailKey(c.email) === em && !people.some(p => p.id === c.id));
    const need = [...new Set(hits.map(c => c.job_id).filter(id => id && !jobs[id]))];
    if (need.length) {
      const { data: js } = await D.from('jobs').select(JOB_COLS).in('id', need).limit(200);
      (js || []).forEach(j => { if (!j.deleted_at) jobs[j.id] = j; });
    }
    // Somebody on a DELETED lead is not "already added" — that lead is gone.
    hits.forEach(c => { if (jobs[c.job_id]) people.push(c); });
  }
  return {
    people: people.map(c => Object.assign({}, c, {
      company_id: jobs[c.job_id] ? jobs[c.job_id].company_id : (c.job_id === jobId ? companyId || null : null),
    })),
    jobs,
  };
}

/**
 * The 409 body for a repeat, naming the other lead only when the caller may
 * see it. `canSee(job)` is the route's own visibility rule (ownership.canSeeLead
 * over the caller's scope).
 */
async function duplicateResponse({ db, req, dup, job, canSee }) {
  const visible = dup.where === 'this_lead' || (!!job && typeof canSee === 'function' && !!(await canSee(job)));
  let lead = null;
  if (visible && dup.where !== 'this_lead' && job) {
    let company = null;
    if (job.company_id) {
      const { data } = await db.forRequest(req).from('companies').select('id,name').eq('id', job.company_id).maybeSingle();
      company = (data && data.name) || null;
    }
    lead = { id: job.id, position: job.position || null, company };
  }
  return duplicatePayload(dup, { visible, lead });
}

async function addLeadContact({ db, req, logActivity, fields, activityText, companyId, allowSameName }) {
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
  // Already added? Checked BEFORE anything is written, for every caller.
  let co = companyId;
  if (co === undefined) {
    const { data: lead } = await db.forRequest(req).from('jobs').select('id,company_id').eq('id', row.job_id).maybeSingle();
    co = lead ? lead.company_id || null : null;
  }
  const found = await lookupExisting({ db, req, jobId: row.job_id, companyId: co, email: row.email });
  const dup = findDuplicate(row, found.people, { jobId: row.job_id, companyId: co });
  if (dup && (dup.match === 'email' || !allowSameName)) {
    throw new DuplicateContactError(Object.assign(dup, { job: found.jobs[dup.contact.job_id] || null }));
  }
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

module.exports = {
  addLeadContact, lookupExisting, duplicateResponse,
  // pure
  findDuplicate, duplicatePayload, personKey, emailKey, DuplicateContactError,
};
