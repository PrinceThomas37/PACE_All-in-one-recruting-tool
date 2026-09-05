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
const { parseJobDescription, buildResearchFromLeadData, normalizeJobTitle, titleSimilarity } = require('../jd-parser');
const { annotateContactEmailStatus } = require('../email-validation');
const { getSetting } = require('../config/settings');

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
    orgIdFor, withOrg, orgStamp,
  } = ctx;

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
  async function inferSkillsFromJobHistory(positions) {
    const result = new Map();
    const wanted = [...new Set(positions.filter(Boolean))];
    if (!wanted.length) return result;

    const { data: history } = await supabase.from('jobs')
      .select('position, research')
      .not('research', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1500);
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

router.get('/jobs', auth, async (req, res) => {
  try {
    const all = await loadAllJobs(orgIdFor(req));
    let data;
    if (hasRole(req, 'admin', 'ra_lead')) {
      data = all;
    } else if (hasRole(req, 'bd_lead')) {
      data = all.filter(j => j.assigned_to_bd != null);
    } else if (hasRole(req, 'bd')) {
      data = all.filter(j => j.assigned_to_bd === req.user.id);
    } else {
      data = all.filter(j => j.created_by === req.user.id);
    }
    res.json(data);
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
    let query = withOrg(supabase.from('jobs').select('id,position,stage,location,industry,timezone,freshness,salary_range,job_created_date,job_opened_date,bdm_assigned_name,source,created_at,company:companies(name,website,industry,location),contacts(first_name,last_name,designation,email,phone,linkedin),creator:users!created_by(name)').is('deleted_at', null).order('created_at', { ascending: false }), req);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to + 'T23:59:59Z');
    if (stage) query = query.eq('stage', stage);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('jobs').select(JOB_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
    if (error) throw error;
    const reqOrg = orgIdFor(req);
    if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Not found' });
    if (!hasRole(req, 'admin', 'ra_lead', 'bd_lead') && data.created_by !== req.user.id && data.assigned_to !== req.user.id && data.assigned_to_bd !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
      if (research) row.research = research;
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
        const historySkills = await inferSkillsFromJobHistory(needsHistory.map((r) => r.position));
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
          const hist = await inferSkillsFromJobHistory([position]);
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
    const canEdit = hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead') || existing.created_by === req.user.id || existing.assigned_to_bd === req.user.id || raCanEdit;
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
    }
    if (notes !== undefined) updates.notes = notes;
    if (assigned_to !== undefined && hasRole(req, 'admin', 'ra_lead')) updates.assigned_to = assigned_to || null;
    if (assigned_to_bd !== undefined && hasRole(req, 'admin', 'ra_lead')) {
      updates.assigned_to_bd = assigned_to_bd || null;
      updates.assigned_at = assigned_to_bd ? new Date() : null;
      if (assigned_to_bd && stage === undefined) updates.stage = 'Assigned';
    }
    if (sending_email_id !== undefined && hasRole(req, 'admin', 'ra_lead')) updates.sending_email_id = sending_email_id || null;
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

router.patch('/jobs/:id/research', auth, async (req, res) => {
  try {
    const { research } = req.body;
    if (!research) return res.status(400).json({ error: 'research object required' });
    const { data: job } = await supabase.from('jobs').select('created_by,industry').eq('id', req.params.id).single();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!hasRole(req, 'admin', 'ra_lead') && job.created_by !== req.user.id) return res.status(403).json({ error: 'Only the RA who created this lead can add research' });
    const { data, error } = await supabase.from('jobs').update({ research, updated_at: new Date() }).eq('id', req.params.id).select('id,research,industry').single();
    if (error) throw error;
    persistLearnedSkills(data.industry || job.industry, research);
    res.json(data);
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
    const { data: job } = await supabase.from('jobs').select('created_by,industry,company:companies(industry)').eq('id', req.params.id).single();
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
