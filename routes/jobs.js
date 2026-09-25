// ============================================================================
// JOBS — list/detail/create/bulk/update/delete/export + JD parsing + research.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/jobs')(ctx));
// Route paths, handler logic, ORDER and behaviour are unchanged from the
// original. Route registration order is preserved exactly (e.g. GET /jobs/:id
// is registered before GET /jobs/export, same as before).
//
// The jobs in-memory cache (jobsCache / loadAllJobs / invalidateJobsCache) stays
// in index.js because the cache-invalidation middleware also uses it; this
// module receives loadAllJobs + JOB_SELECT via ctx. inferSkillsFromJobHistory is
// jobs-only and moves here. jd-parser + email-validation are required directly
// (Node caches them → same singletons index.js uses).
// ============================================================================
const express = require('express');
const { releaseToPoolUpdate } = require('../services/outreach-cycle');
const { parseJobDescription, buildResearchFromLeadData, normalizeJobTitle, titleSimilarity } = require('../jd-parser');
const { annotateContactEmailStatus } = require('../email-validation');
const { getSetting } = require('../config/settings');
const { fillPatch } = require('../services/lead-fill');
// D-0034: who may SEE/edit a lead, on top of the role ladder above it. Read
// services/ownership.js's header before changing any of the scoping below.
const own = require('../services/ownership');
const leadPosting = require('../services/lead-posting');

// Lead stage permission matrix for PUT /jobs/:id — pulled out to a pure
// function (no supabase/Express dependency) so it's directly unit-testable.
// BD / BD Lead own the forward classification of a lead (Connected, Rejected,
// Future, In Discussion) and must also be able to undo it — move it back to
// "Assigned" — without needing an RA Lead/Admin. Ownership of the assignment
// itself (assigned_to_bd) is untouched here; "Unassigned" stays RA Lead/Admin
// only since it's tied to returning a lead to the distribution pool.
// Returns { stage } when the caller may set it, or { error } when not —
// callers must check for `error` rather than assume success.
function resolveLeadStageUpdate(hasRole, req, stage) {
  const bdStages = ['Connected', 'Rejected', 'Future', 'In Discussion', 'Assigned'];
  const systemStages = ['Unassigned', 'Assigned'];
  if (bdStages.includes(stage) && hasRole(req, 'admin', 'bd', 'bd_lead')) return { stage };
  if (systemStages.includes(stage) && hasRole(req, 'admin', 'ra_lead')) return { stage };
  if (hasRole(req, 'admin')) return { stage };
  // No matching branch = the caller isn't allowed to set this specific stage
  // value. This used to fall through silently: the request returned 200 with
  // nothing written, so the UI showed "Stage updated" while the database
  // never changed. Fail loudly instead.
  return { error: `You don't have permission to set this lead's stage to "${stage}".` };
}

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, hasRole, today, logActivity, canTouchJob,
    loadAllJobs, JOB_SELECT, getTimezoneFromLocation, persistLearnedSkills,
    orgIdFor, withOrg, orgStamp, userOrgId, mailboxOrgId,
  } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  // The caller's D-0034 view scope — self + reporting chain, or the whole org
  // for admin. Built once per request; every route below narrows with it.
  async function scopeFor(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  /**
   * Skill inference from the system's own job history.
   *
   * For title-only imports, look up past jobs with similar normalized titles
   * and reuse their verified skills. Past jobs whose skills were themselves
   * guessed (title_inference / history_match) are excluded so guesses never
   * compound. Human-assigned skill_1..3 are preferred over machine-suggested.
   *
   * Returns Map<originalTitle, skills[]>.
   */
  async function inferSkillsFromJobHistory(positions, req) {
    const result = new Map();
    const wanted = [...new Set(positions.filter(Boolean))];
    if (!wanted.length) return result;

    // C-0021 X8: this used to read every org's job history to guess skills for
    // THIS org's import — low severity (skills only, no contact/company detail)
    // but still another customer's lead titles/skills leaking through a guess.
    const { data: history } = await withOrg(supabase.from('jobs')
      .select('position, research')
      .not('research', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1500), req);
    if (!history || !history.length) return result;

    const entries = [];
    for (const row of history) {
      if (!row.position) continue;
      let research = row.research;
      if (typeof research === 'string') { try { research = JSON.parse(research); } catch { continue; } }
      const reqr = research && research.requirements;
      if (!reqr) continue;
      if (reqr.skills_source === 'title_inference' || reqr.skills_source === 'history_match') continue;
      let skills = [reqr.skill_1, reqr.skill_2, reqr.skill_3].filter(Boolean);
      if (skills.length < 2 && Array.isArray(reqr.suggested_skills)) skills = reqr.suggested_skills.filter(Boolean);
      if (!skills.length) continue;
      const norm = normalizeJobTitle(row.position);
      if (!norm.tokens.length) continue;
      entries.push({ norm, skills });
    }
    if (!entries.length) return result;

    for (const pos of wanted) {
      const norm = normalizeJobTitle(pos);
      if (!norm.tokens.length) continue;
      const freq = new Map();
      let matches = 0;
      for (const e of entries) {
        const sim = titleSimilarity(norm.canon, e.norm.canon);
        const headMatch = norm.head && e.norm.head === norm.head;
        // Either nearly identical titles, or same role noun with decent overlap
        if (!(sim >= 0.75 || (headMatch && sim >= 0.45))) continue;
        matches++;
        for (const s of e.skills) {
          const k = String(s).toLowerCase();
          const cur = freq.get(k) || { skill: s, score: 0 };
          cur.score += sim; // weight by similarity
          freq.set(k, cur);
        }
        if (matches >= 25) break; // enough evidence
      }
      if (!freq.size) continue;
      const top = [...freq.values()].sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.skill);
      result.set(pos, top);
    }
    return result;
  }

// C-0021 #1 / D-0034: the whole role ladder is replaced by the one rule. Before
// this a bd_lead got EVERY assigned lead in the org (49, for an owner of 25);
// ra_lead/admin got the whole org; director/associate_director fell into the
// `else` and saw almost nothing (created_by only). Now: self + reporting
// chain, admin sees the org, and the pool goes only to the roles that
// distribute it (own.POOL_ROLES). This is also what drives the Leads page's
// stat cards (Total/Assigned/Connected/Rejected) — they read this same list.
router.get('/jobs', auth, async (req, res) => {
  try {
    const all = await loadAllJobs(orgIdFor(req));
    const scope = await scopeFor(req);
    res.json(own.scopeLeads(all, scope));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/today-summary', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'Not allowed' });
    const todayStr = today();
    const { data: todayJobs, error } = await withOrg(supabase
      .from('jobs')
      .select('id, position, industry, location, freshness, is_duplicate, timezone, company:companies(name, industry), contacts(id, designation)')
      .gte('created_at', todayStr + 'T00:00:00Z')
      .is('deleted_at', null), req);
    if (error) throw error;
    const total = todayJobs.length;
    const duplicates = todayJobs.filter(j => j.is_duplicate).length;
    const clean = total - duplicates;
    const byIndustry = {};
    todayJobs.forEach(j => { const ind = j.industry || j.company?.industry || 'Unknown'; byIndustry[ind] = (byIndustry[ind] || 0) + 1; });
    const byFreshness = {};
    todayJobs.forEach(j => { const f = j.freshness || 'Normal'; byFreshness[f] = (byFreshness[f] || 0) + 1; });
    const byTimezone = {};
    todayJobs.forEach(j => { const tz = j.timezone || 'EST'; byTimezone[tz] = (byTimezone[tz] || 0) + 1; });
    const byPosition = {};
    todayJobs.forEach(j => { byPosition[j.position] = (byPosition[j.position] || 0) + 1; });
    const topPositions = Object.entries(byPosition).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v]) => `${k} (${v})`);
    const totalContacts = todayJobs.reduce((s, j) => s + (j.contacts?.length || 0), 0);
    const { count: poolSize } = await withOrg(supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('stage', 'Unassigned').is('deleted_at', null), req);
    res.json({ date: todayStr, total, clean, duplicates, totalContacts, byIndustry, byFreshness, byTimezone, topPositions, poolSize: poolSize || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REGISTRATION ORDER IS LOAD-BEARING: this literal path must stay ABOVE
// `/jobs/:id`, or Express matches it as a job whose id is the string "export"
// and the CSV export on the RA entry form silently fails. It sat below for
// exactly that reason until Session 19. test/route-shadowing-smoke.mjs fails
// the build if any literal route ends up behind a matching :param route.
router.get('/jobs/export', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    const { from, to, stage } = req.query;
    // C-0021 #3: ra_lead exported every lead in the org, with every contact's
    // email/phone. Scoped the same way as GET /jobs: self + reporting chain
    // (admin — the whole org — is unaffected, since that role's export was
    // always meant to cover the org).
    let query = withOrg(supabase.from('jobs').select('id,position,stage,location,industry,timezone,freshness,salary_range,job_created_date,job_opened_date,bdm_assigned_name,source,created_at,assigned_to_bd,created_by,assigned_to,company:companies(name,website,industry,location),contacts(first_name,last_name,designation,email,phone,linkedin),creator:users!created_by(name)').is('deleted_at', null).order('created_at', { ascending: false }), req);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to + 'T23:59:59Z');
    if (stage) query = query.eq('stage', stage);
    const { data, error } = await query;
    if (error) throw error;
    const scope = await scopeFor(req);
    res.json(own.scopeLeads(data || [], scope));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('jobs').select(JOB_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
    if (error) throw error;
    const reqOrg = orgIdFor(req);
    if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Not found' });
    // C-0021 #2: bd_lead/ra_lead could open ANY lead by id. Same 404 shape as a
    // foreign-org id — a 403 would confirm the lead exists.
    const scope = await scopeFor(req);
    if (!own.canSeeLead(data, scope)) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function cleanImportExtra(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = {};
  for (const [k, v] of Object.entries(x).slice(0, 40)) {
    const key = String(k).trim().slice(0, 80);
    const val = String(v == null ? '' : v).trim().slice(0, 500);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

router.post('/jobs/bulk', auth, async (req, res) => {
  try {
    const { jobs } = req.body;
    if (!Array.isArray(jobs) || !jobs.length) return res.status(400).json({ error: 'jobs array required' });
    // Filter out companies in cooldown for RA users (admin-editable — config/settings.js)
    const cooldownDays = await getSetting(supabase, 'company_cooldown_days');
    const cooldownDate = new Date(Date.now() - cooldownDays * 24 * 3600 * 1000).toISOString();
    const companyIds = [...new Set(jobs.map(j => j.company_id).filter(Boolean))];
    let cooledDown = new Set();
    if (companyIds.length) {
      const { data: recent } = await withOrg(supabase.from('jobs').select('company_id').in('company_id', companyIds).gte('created_at', cooldownDate).is('deleted_at', null), req);
      cooledDown = new Set((recent || []).map(r => r.company_id));
    }
    const skipped = jobs.filter(j => cooledDown.has(j.company_id)).length;
    const filteredJobs = jobs.filter(j => !cooledDown.has(j.company_id));
    function getFreshness(openedDate, createdDate) {
      const ref = openedDate || createdDate;
      if (!ref) return 'Normal';
      const days = Math.floor((new Date() - new Date(ref)) / 86400000);
      if (days <= 3) return 'New'; if (days <= 10) return 'Normal'; return 'Old';
    }
    const jobRows = filteredJobs.map(j => {
      const research = buildResearchFromLeadData({
        notes: j.notes,
        jdText: j.jd_text,
        position: j.position,
        location: j.location,
        salaryRange: j.salary_range,
        industry: j.industry
      });
      const row = {
        company_id: j.company_id,
        position: j.position || '(unknown)',
        location: j.location || null,
        source: j.source || 'Import',
        job_url: j.job_url || null,
        stage: 'Unassigned',
        notes: j.notes || '',
        created_by: req.user.id,
        assigned_to: null,
        is_duplicate: j.is_duplicate || false,
        duplicate_of: j.duplicate_of || null,
        salary_range: j.salary_range || null,
        job_created_date: j.job_created_date || null,
        job_opened_date: j.job_opened_date || null,
        timezone: getTimezoneFromLocation(j.location),
        freshness: getFreshness(j.job_opened_date, j.job_created_date),
        bdm_assigned_name: j.bdm_assigned_name || null,
        industry: j.industry || null,
        ...orgStamp(req)
      };
      // Columns the importer did not recognise, kept as written (bounded:
      // 40 columns, 500 chars each) so nothing in the owner's sheet is lost.
      const extra = cleanImportExtra(j.import_extra);
      if (research || extra) row.research = { ...(research || {}), ...(extra ? { import_extra: extra } : {}) };
      return row;
    });
    if (!jobRows.length) return res.status(200).json({ imported: 0, contacts: 0, skipped, message: `All ${skipped} companies are in a 21-day cooldown period.` });

    // For title-only leads (skills guessed from the title, or none at all),
    // check the system's own history: similar past titles with verified
    // skills are a better source than archetype guesses.
    try {
      const needsHistory = jobRows.filter((row) => {
        const reqr = row.research && row.research.requirements;
        if (!reqr) return false;
        return reqr.skills_source === 'title_inference' || !(reqr.suggested_skills || []).length;
      });
      if (needsHistory.length) {
        const historySkills = await inferSkillsFromJobHistory(needsHistory.map((r) => r.position), req);
        for (const row of needsHistory) {
          const skills = historySkills.get(row.position);
          if (!skills || !skills.length) continue;
          const reqr = row.research.requirements;
          reqr.skills = skills;
          reqr.suggested_skills = skills;
          reqr.skill_1 = skills[0] || '';
          reqr.skill_2 = skills[1] || '';
          reqr.skill_3 = skills[2] || '';
          reqr.skills_source = 'history_match';
        }
      }
    } catch (e) { /* history lookup is best-effort — never block an import */ }
    const { data: insertedJobs, error: jobErr } = await supabase.from('jobs').insert(jobRows).select('id');
    if (jobErr) throw jobErr;
    const contactRows = [];
    insertedJobs.forEach((job, idx) => {
      const contacts = filteredJobs[idx].contacts || [];
      contacts.forEach((c, ci) => {
        if (!c.first_name && !c.email) return;
        contactRows.push({ job_id: job.id, first_name: c.first_name || '', last_name: c.last_name || '', designation: c.designation || null, email: c.email || null, phone: c.phone || null, linkedin: c.linkedin || null, is_primary: ci === 0, ...orgStamp(req) });
      });
    });
    if (contactRows.length) {
      // Flag dead-domain / malformed addresses on import (Excel sheets included)
      // so the send loop never mails them. Best-effort — never block an import.
      try { await annotateContactEmailStatus(contactRows); } catch (_) {}
      await supabase.from('contacts').insert(contactRows);
    }
    const invalidContacts = contactRows.filter(c => c.email_status === 'invalid').length;
    res.status(201).json({ imported: insertedJobs.length, contacts: contactRows.length, invalidEmails: invalidContacts, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RE-IMPORT FILLS IN WHAT A LEAD IS MISSING (Session 29, R-045) ────────
// The importer sends one entry per lead it recognised as already existing.
// services/lead-fill.js decides; the rule is that only EMPTY fields are
// written, so a re-import can add a job link but never overwrite anything a
// person or PACE already put on the lead. Org-scoped, and the same ownership
// check as GET /jobs/:id — a lead you cannot open is a lead you cannot fill.
router.post('/jobs/fill-missing', auth, async (req, res) => {
  try {
    const leads = Array.isArray(req.body && req.body.leads) ? req.body.leads.slice(0, 1000) : [];
    const ids = [...new Set(leads.map(l => l && l.id).filter(id => typeof id === 'string'))];
    if (!ids.length) return res.json({ leads_updated: 0, fields_filled: 0 });
    const { data: rows, error } = await withOrg(supabase.from('jobs')
      .select('id, org_id, company_id, created_by, assigned_to, assigned_to_bd, job_url, salary_range, location, industry, job_created_date, research, company:companies(id, website), contacts(id, email, phone, linkedin, designation, last_name)')
      .in('id', ids).is('deleted_at', null), req);
    if (error) throw error;
    const seeAll = hasRole(req, 'admin', 'ra_lead', 'bd_lead');
    const byId = {};
    for (const r of rows || []) {
      if (seeAll || r.created_by === req.user.id || r.assigned_to === req.user.id || r.assigned_to_bd === req.user.id) byId[r.id] = r;
    }
    let leadsUpdated = 0, fieldsFilled = 0;
    for (const inc of leads) {
      const row = inc && byId[inc.id];
      if (!row) continue;
      const p = fillPatch({ job: row, company: row.company, contacts: row.contacts }, inc);
      if (!p.filled.length) continue;
      if (Object.keys(p.job).length) {
        const { error: e1 } = await withOrg(supabase.from('jobs').update({ ...p.job, updated_at: new Date().toISOString() }).eq('id', row.id), req);
        if (e1) continue;
      }
      if (Object.keys(p.company).length && row.company && row.company.id) {
        await withOrg(supabase.from('companies').update(p.company).eq('id', row.company.id), req);
      }
      for (const c of p.contacts) await withOrg(supabase.from('contacts').update(c.patch).eq('id', c.id), req);
      leadsUpdated++; fieldsFilled += p.filled.length;
    }
    res.json({ leads_updated: leadsUpdated, fields_filled: fieldsFilled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs', auth, async (req, res) => {
  try {
    const { company_id, position, location, source, job_url, stage, notes, assigned_to, is_duplicate, duplicate_of, contacts, salary_range, job_created_date, job_opened_date, bdm_assigned_name, industry: jobIndustry, research } = req.body;
    if (!company_id || !position) return res.status(400).json({ error: 'company_id and position required' });
    // Company cooldown — block RA from re-adding the same company too soon
    // (admin-editable — config/settings.js).
    if (hasRole(req, 'ra')) {
      const cooldownDays = await getSetting(supabase, 'company_cooldown_days');
      const cooldownDate = new Date(Date.now() - cooldownDays * 24 * 3600 * 1000).toISOString();
      const { data: recent } = await withOrg(supabase.from('jobs').select('id,position,created_at').eq('company_id', company_id).gte('created_at', cooldownDate).is('deleted_at', null).limit(1), req);
      if (recent && recent.length > 0) {
        const daysAgo = Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 86400000);
        const daysLeft = cooldownDays - daysAgo;
        return res.status(409).json({ error: `This company is in a ${cooldownDays}-day cooldown period. ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining (last added: ${recent[0].position}).` });
      }
    }
    const timezone = getTimezoneFromLocation(location);
    let freshness = 'Normal';
    const refDate = job_opened_date || job_created_date;
    if (refDate) { const days = Math.floor((new Date() - new Date(refDate)) / 86400000); if (days <= 3) freshness = 'New'; else if (days <= 10) freshness = 'Normal'; else freshness = 'Old'; }
    // Same skill seeding as bulk import: parse JD/notes if present, otherwise
    // infer from the title — preferring verified skills from similar past jobs.
    let researchObj = research || null;
    if (!researchObj) {
      researchObj = buildResearchFromLeadData({ notes, position, location, salaryRange: salary_range, industry: jobIndustry });
      const reqr = researchObj && researchObj.requirements;
      if (reqr && (reqr.skills_source === 'title_inference' || !(reqr.suggested_skills || []).length)) {
        try {
          const hist = await inferSkillsFromJobHistory([position], req);
          const skills = hist.get(position);
          if (skills && skills.length) {
            reqr.skills = skills;
            reqr.suggested_skills = skills;
            reqr.skill_1 = skills[0] || '';
            reqr.skill_2 = skills[1] || '';
            reqr.skill_3 = skills[2] || '';
            reqr.skills_source = 'history_match';
          }
        } catch (e) { /* best-effort */ }
      }
    }
    const { data: job, error } = await supabase.from('jobs').insert({
      company_id, position, location, source, job_url, stage: stage || 'Unassigned', notes: notes || '',
      created_by: req.user.id,
      assigned_to: (hasRole(req, 'admin', 'ra_lead') ? (assigned_to || null) : null),
      is_duplicate: is_duplicate || false, duplicate_of: duplicate_of || null, salary_range: salary_range || null,
      job_created_date: job_created_date || null, job_opened_date: job_opened_date || null,
      timezone, freshness, bdm_assigned_name: bdm_assigned_name || null, industry: jobIndustry || null,
      research: researchObj,
      ...orgStamp(req)
    }).select().single();
    if (error) throw error;
    if (Array.isArray(contacts) && contacts.length) {
      const rows = contacts.map((c, i) => ({ job_id: job.id, first_name: c.first_name || '', last_name: c.last_name || '', designation: c.designation || null, email: c.email || null, phone: c.phone || null, linkedin: c.linkedin || null, is_primary: i === 0, ...orgStamp(req) }));
      try { await annotateContactEmailStatus(rows); } catch (_) {}
      await supabase.from('contacts').insert(rows);
    }
    await logActivity(job.id, null, req.user.id, 'job_created', `Job created: ${position}`, null, { position, stage: job.stage });
    if (research) persistLearnedSkills(jobIndustry, research);
    res.status(201).json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/jobs/:id', auth, async (req, res) => {
  try {
    const { data: existing } = await supabase.from('jobs').select('*').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const reqOrg = orgIdFor(req);
    if (reqOrg && existing.org_id && existing.org_id !== reqOrg) return res.status(404).json({ error: 'Not found' });
    const isRA = hasRole(req, 'ra') && !hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead');
    // Admin-editable — config/settings.js.
    const editWindowHours = await getSetting(supabase, 'ra_edit_window_hours');
    const hoursSinceCreation = (new Date() - new Date(existing.created_at)) / 3600000;
    const raCanEdit = isRA && existing.created_by === req.user.id && hoursSinceCreation <= editWindowHours;
    // Rampart review (2026-09-24, item #9): `own.canSeeLead` also admits a
    // lead's CREATOR and whoever it is merely ASSIGNED TO for research, and
    // the pool — sight, not editing rights (D-0020). Using it here let every
    // `bd`/`bd_lead` in the reporting chain of a lead's *creator* edit a lead
    // they do not own, which is "review and edit" where D-0020 only grants
    // "review and prompt". Edit = the OWNER (assigned_to_bd) or their own
    // managers per the chain, plus admin/ra_lead's full rights, plus the
    // existing RA-in-window rule. A lead the caller cannot even SEE is a 404,
    // never a 403 — a 403 would confirm the id exists.
    const scope = await scopeFor(req);
    if (!hasRole(req, 'admin', 'ra_lead') && !own.canSeeLead(existing, scope)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const canEdit = hasRole(req, 'admin', 'ra_lead')
      || own.inScope(existing.assigned_to_bd, scope)
      || raCanEdit;
    if (!canEdit) return res.status(403).json({ error: 'Forbidden' });
    if (isRA && !raCanEdit) return res.status(403).json({ error: `Edit window has expired (${editWindowHours} hours)` });
    const { position, location, source, job_url, stage, notes, assigned_to, assigned_to_bd, sending_email_id, salary_range, job_created_date, industry: jobIndustry, research } = req.body;
    const updates = { updated_at: new Date() };
    if (position !== undefined) updates.position = position;
    if (location !== undefined) {
      updates.location = location;
      updates.timezone = getTimezoneFromLocation(location);
    }
    if (source !== undefined) updates.source = source;
    if (job_url !== undefined) updates.job_url = job_url;
    if (stage !== undefined) {
      const resolved = resolveLeadStageUpdate(hasRole, req, stage);
      if (resolved.error) return res.status(403).json({ error: resolved.error });
      updates.stage = resolved.stage;
      // Returning a single lead to the pool must release it the same way the
      // bulk action does — same fields, `last_recycled_at` included, or the
      // lead is re-assignable but silently un-emailable.
      if (resolved.stage === 'Unassigned') Object.assign(updates, releaseToPoolUpdate(new Date()));
    }
    if (notes !== undefined) updates.notes = notes;
    // C-0021 X3: none of these three checked that the id supplied in the
    // request actually belongs to the caller's org before writing it — an
    // admin/ra_lead could hand a lead to another org's user, or point its send
    // path at another org's mailbox, just by knowing the id (neither is
    // secret). A mismatch is a plain 400: this is a bad request, not a
    // record the caller cannot see.
    if (assigned_to !== undefined && hasRole(req, 'admin', 'ra_lead')) {
      if (assigned_to && reqOrg && (await userOrgId(assigned_to)) !== reqOrg) {
        return res.status(400).json({ error: 'That user is not in your organisation.' });
      }
      updates.assigned_to = assigned_to || null;
    }
    if (assigned_to_bd !== undefined && hasRole(req, 'admin', 'ra_lead')) {
      if (assigned_to_bd && reqOrg && (await userOrgId(assigned_to_bd)) !== reqOrg) {
        return res.status(400).json({ error: 'That user is not in your organisation.' });
      }
      updates.assigned_to_bd = assigned_to_bd || null;
      updates.assigned_at = assigned_to_bd ? new Date() : null;
      if (assigned_to_bd && stage === undefined) updates.stage = 'Assigned';
    }
    if (sending_email_id !== undefined && hasRole(req, 'admin', 'ra_lead')) {
      if (sending_email_id && reqOrg && (await mailboxOrgId(sending_email_id)) !== reqOrg) {
        return res.status(400).json({ error: 'That mailbox is not in your organisation.' });
      }
      updates.sending_email_id = sending_email_id || null;
    }
    if (salary_range !== undefined) updates.salary_range = salary_range || null;
    if (job_created_date !== undefined) updates.job_created_date = job_created_date || null;
    if (jobIndustry !== undefined) updates.industry = jobIndustry || null;
    if (research !== undefined) updates.research = research;
    const { data, error } = await supabase.from('jobs').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (stage !== undefined && stage !== existing.stage) {
      await logActivity(data.id, null, req.user.id, 'stage_change', `Stage: ${existing.stage} → ${stage}`, { stage: existing.stage }, { stage });
      if (existing.stage === 'Assigned' && stage !== 'Assigned') {
        await supabase.from('follow_ups').update({ status: 'skipped' }).eq('job_id', req.params.id).eq('status', 'active');
      }
      // Queued outreach belongs to the assignment that just ended.
      if (stage === 'Unassigned') {
        await supabase.from('emails').delete().eq('job_id', req.params.id).eq('status', 'pending');
      }
    } else {
      await logActivity(data.id, null, req.user.id, 'job_updated', 'Job updated', null, null);
    }
    if (research !== undefined) persistLearnedSkills(jobIndustry || data.industry || existing.industry, research);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/jobs/:id', auth, async (req, res) => {
  try {
    const { data: existing } = await supabase.from('jobs').select('created_by,position,org_id').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const reqOrg = orgIdFor(req);
    if (reqOrg && existing.org_id && existing.org_id !== reqOrg) return res.status(404).json({ error: 'Not found' });
    if (!hasRole(req, 'admin') && existing.created_by !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await supabase.from('jobs').update({ deleted_at: new Date() }).eq('id', req.params.id);
    await logActivity(req.params.id, null, req.user.id, 'job_deleted', `Job deleted: ${existing.position}`, null, null);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// C-0021 X6: neither of these two carried an org check at all — a job id from
// another org read (and, worse, wrote) its research by guessing the id.
router.patch('/jobs/:id/research', auth, async (req, res) => {
  try {
    const { research } = req.body;
    if (!research) return res.status(400).json({ error: 'research object required' });
    const { data: job } = await withOrg(supabase.from('jobs').select('created_by,industry').eq('id', req.params.id), req).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!hasRole(req, 'admin', 'ra_lead') && job.created_by !== req.user.id) return res.status(403).json({ error: 'Only the RA who created this lead can add research' });
    const { data, error } = await withOrg(supabase.from('jobs').update({ research, updated_at: new Date() }).eq('id', req.params.id), req).select('id,research,industry').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Job not found' });
    persistLearnedSkills(data.industry || job.industry, research);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// THE JOB POSTING, pasted on the lead row (R-056, D-0046). Narrower than the
// research PATCH above on purpose: it writes `research.jd_raw` and nothing
// else, so the BD who OWNS the lead — the person whose first email the AI is
// about to write — may fill it in, not only the RA who created the lead.
// Who: anyone canTouchJob allows (admin in-org, creator, assigned RA,
// assigned BD) plus an RA Lead. Another org's lead reads as 404.
router.post('/jobs/:id/posting', auth, async (req, res) => {
  try {
    const text = req.body && typeof req.body.text === 'string' ? req.body.text : null;
    if (text === null) return res.status(400).json({ error: 'text required (send an empty string to clear it)' });
    const { data: job } = await withOrg(supabase.from('jobs').select('id,position,research').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!hasRole(req, 'ra_lead') && !(await canTouchJob(req, job.id))) {
      return res.status(403).json({ error: 'Only the people working this lead can add its job posting' });
    }
    const research = leadPosting.withPosting(job.research, job.position, text);
    const { data, error } = await withOrg(supabase.from('jobs').update({ research, updated_at: new Date() }).eq('id', job.id), req)
      .select('id,position,research').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Job not found' });
    res.json({ id: data.id, research: data.research, posting: leadPosting.postingState(data) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/parse-jd', auth, async (req, res) => {
  try {
    const { jd_text, industry } = req.body;
    if (!jd_text || !String(jd_text).trim()) return res.status(400).json({ error: 'jd_text required' });
    const parsed = parseJobDescription(jd_text, industry || '');
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/parse-jd', auth, async (req, res) => {
  try {
    const { jd_text, industry } = req.body;
    if (!jd_text || !String(jd_text).trim()) return res.status(400).json({ error: 'jd_text required' });
    const { data: job } = await withOrg(supabase.from('jobs').select('created_by,industry,company:companies(industry)').eq('id', req.params.id), req).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!hasRole(req, 'admin', 'ra_lead') && job.created_by !== req.user.id) return res.status(403).json({ error: 'Only the RA who created this lead can parse JD' });
    const resolvedIndustry = industry || job.industry || job.company?.industry || '';
    const parsed = parseJobDescription(jd_text, resolvedIndustry);
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:job_id/contacts', auth, async (req, res) => {
  try {
    if (!(await canTouchJob(req, req.params.job_id))) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase.from('contacts').select('*').eq('job_id', req.params.job_id).order('is_primary', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};

module.exports.resolveLeadStageUpdate = resolveLeadStageUpdate;
