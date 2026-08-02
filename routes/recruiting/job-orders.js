// ============================================================================
// JOB ORDERS — lead conversion, CRUD, relevance ranking, recruiter assignment.
// Split out of bd_recruiter_routes.js. Routes and logic are unchanged; the
// helpers they share now come from services/recruiting-core.js.
// ============================================================================

const matchEngine = require('../../match-engine');
const { fetchWithTimeout } = require('../../http-client');
const createCandidateFields = require('../../services/candidate-fields');

const AI_TIMEOUT_MS = 30000;

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, notGuest, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;
  // The relevance ranking reads candidates with the same shape the candidates
  // routes use, so it shares that service rather than re-declaring the select.
  const { CANDIDATE_SELECT } = createCandidateFields(core);

  // CONVERSION — lead -> job order
  // ==========================================================================

  // Convert an existing CONNECTED lead (a jobs row) into a job order.
  app.post('/job-orders/from-lead/:jobId', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can convert leads to job orders.' });

      const { data: lead, error: leadErr } = await supabase
        .from('jobs').select('*').eq('id', req.params.jobId).is('deleted_at', null).single();
      if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });
      if (lead.stage !== 'Connected') {
        return res.status(409).json({ error: `Lead must be at stage "Connected" to convert (currently "${lead.stage}").` });
      }

      // guard against double-conversion of the same lead
      const { data: existing } = await supabase
        .from('job_orders').select('id,job_code').eq('source_lead_id', lead.id).is('deleted_at', null).limit(1);
      if (existing && existing.length) {
        return res.status(409).json({ error: `This lead was already converted (${existing[0].job_code}).`, job_order_id: existing[0].id });
      }

      // ensure the lead has an LD- code (older rows backfilled by migration, but be safe)
      let leadCode = lead.lead_code;
      if (!leadCode) {
        leadCode = await nextId('LD');
        await supabase.from('jobs').update({ lead_code: leadCode }).eq('id', lead.id);
      }

      const b = req.body || {};
      const jobCode = await nextId('JOB');
      const jobRow = Object.assign({
        job_code: jobCode,
        source_lead_id: lead.id,
        lead_code: leadCode,
        company_id: lead.company_id,
        job_title: lead.position,                   // title carries over from the lead
        priority: 'Normal',
        status: 'Active',
        bd_manager_id: b.bd_manager_id || req.user.id,
        created_by: req.user.id
      }, pickJobFields(b), orgStamp(req));
      // never let the client blank out the inherited title
      if (!jobRow.job_title) jobRow.job_title = lead.position;
      const { data: jobOrder, error } = await supabase.from('job_orders')
        .insert(jobRow).select(JOB_ORDER_SELECT).single();
      if (error) throw error;

      const openedDate = new Date().toISOString().slice(0, 10);
      await supabase.from('jobs').update({
        job_opened_date: openedDate,
        updated_at: new Date()
      }).eq('id', lead.id);

      res.status(201).json(jobOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // BD creates a job order directly. Lead-first: a jobs (lead) row is created,
  // gets an LD- code, THEN the job order is created from it and gets a JOB- code.
  app.post('/job-orders', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can create job orders.' });

      const b = req.body || {};
      const lead = b.lead || {};
      const job = b.job || {};

      if (!lead.company_id || !lead.position) {
        return res.status(400).json({ error: 'lead.company_id and lead.position are required (lead info must be filled first).' });
      }

      // 1) create the underlying lead (jobs row), pre-stamped Connected since it
      //    is a real, client-confirmed opening originating from the BD directly.
      const leadCode = await nextId('LD');
      const { data: leadRow, error: leadErr } = await supabase.from('jobs').insert({
        company_id: lead.company_id,
        position: lead.position,
        location: lead.location || null,
        source: lead.source || 'BD Direct',
        stage: 'Connected',
        notes: lead.notes || '',
        created_by: req.user.id,
        assigned_to_bd: req.user.id,
        lead_code: leadCode
      }).select().single();
      if (leadErr) throw leadErr;

      // optional contacts on the lead, reusing the existing contacts table shape
      if (Array.isArray(lead.contacts) && lead.contacts.length) {
        const rows = lead.contacts.map((c, i) => ({
          job_id: leadRow.id, first_name: c.first_name || '', last_name: c.last_name || '',
          designation: c.designation || null, email: c.email || null, phone: c.phone || null,
          linkedin: c.linkedin || null, is_primary: i === 0
        }));
        await supabase.from('contacts').insert(rows);
      }

      // 2) create the job order from that lead
      const jobCode = await nextId('JOB');
      const jobRow = Object.assign({
        job_code: jobCode,
        source_lead_id: leadRow.id,
        lead_code: leadCode,
        company_id: leadRow.company_id,
        job_title: leadRow.position,
        priority: 'Normal',
        status: 'Active',
        bd_manager_id: job.bd_manager_id || req.user.id,
        created_by: req.user.id
      }, pickJobFields(job), orgStamp(req));
      if (!jobRow.job_title) jobRow.job_title = leadRow.position;
      // Fill the skill/experience fields from the JD when the BD left them blank,
      // and attach the normalized requirement. Skills carry half the match score
      // and were previously hand-typed, so a blank field meant every candidate
      // scored on title and location alone.
      Object.assign(jobRow, await applyDerivedJobFields(jobRow));
      const { data: jobOrder, error } = await supabase.from('job_orders')
        .insert(jobRow).select(JOB_ORDER_SELECT).single();
      if (error) throw error;

      res.status(201).json(jobOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // JOB ORDERS — list / read / update / soft-delete
  // ==========================================================================

  app.get('/job-orders', auth, async (req, res) => {
    try {
      let query = withOrg(supabase.from('job_orders').select(JOB_ORDER_SELECT).is('deleted_at', null), req);

      // recruiters only see job orders they are assigned to
      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.length) return res.json([]);
        query = query.in('id', ids);
      }
      if (req.query.status) query = query.eq('status', req.query.status);

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      const list = data || [];
      // Attach assigned recruiters to every job order (the single-get already
      // does this; the list did not — which made the recruiter "My Jobs" filter
      // return nothing and showed everyone as "Unassigned" on the BDM list).
      if (list.length) {
        const { data: assigns } = await supabase.from('recruiter_assignments')
          .select('job_order_id, id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
          .in('job_order_id', list.map(j => j.id));
        const byJob = {};
        (assigns || []).forEach(a => { (byJob[a.job_order_id] = byJob[a.job_order_id] || []).push(a); });
        list.forEach(j => { j.recruiters = byJob[j.id] || []; });
      }
      res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Company-wide job board — every recruiter can see every job (title, client,
  // location, who's on it, how busy it is) so they can ask to be assigned.
  // Candidate contact details stay locked until assignment (see the masked
  // branch of GET /job-orders/:id/submissions).
  // NOTE: registered before /job-orders/:id so "browse" isn't parsed as an id.
  app.get('/job-orders/browse', auth, async (req, res) => {
    try {
      if (!isRecruiter(req) && !isBDM(req)) return res.status(403).json({ error: 'Recruiting roles only.' });
      const { data: jobs, error } = await withOrg(supabase.from('job_orders')
        .select('id,job_code,job_title,client,city,state,country,status,priority,positions,job_type,emp_level,remote,work_auth,primary_skills,secondary_skills,job_description,pay_cur,pay_min,pay_max,start_date,created_at,company:companies(id,name,industry),bd_manager:users!bd_manager_id(id,name)')
        .is('deleted_at', null), req).order('created_at', { ascending: false });
      if (error) throw error;
      const list = jobs || [];
      const ids = list.map(j => j.id);
      const assignsByJob = {}, subCounts = {}, myReqs = {};
      if (ids.length) {
        const { data: assigns } = await supabase.from('recruiter_assignments')
          .select('job_order_id, recruiter_id, recruiter:users!recruiter_id(id,name)')
          .in('job_order_id', ids);
        (assigns || []).forEach(a => { (assignsByJob[a.job_order_id] = assignsByJob[a.job_order_id] || []).push(a); });
        const { data: subs } = await supabase.from('submissions')
          .select('job_order_id').in('job_order_id', ids).is('deleted_at', null);
        (subs || []).forEach(s => { subCounts[s.job_order_id] = (subCounts[s.job_order_id] || 0) + 1; });
        const { data: reqs } = await supabase.from('assignment_requests')
          .select('id,job_order_id,status').eq('recruiter_id', req.user.id).in('job_order_id', ids);
        (reqs || []).forEach(r => {
          const prev = myReqs[r.job_order_id];
          if (!prev || r.status === 'pending') myReqs[r.job_order_id] = r;
        });
      }
      res.json(list.map(j => ({
        ...j,
        recruiters: (assignsByJob[j.id] || []).map(a => (a.recruiter && a.recruiter.name) || '').filter(Boolean),
        submission_count: subCounts[j.id] || 0,
        assigned_to_me: (assignsByJob[j.id] || []).some(a => a.recruiter_id === req.user.id),
        my_request: myReqs[j.id] ? { id: myReqs[j.id].id, status: myReqs[j.id].status } : null
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/job-orders/:id', auth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('job_orders')
        .select(JOB_ORDER_SELECT).eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !data) return res.status(404).json({ error: 'Job order not found' });
      const reqOrg = orgIdFor(req);
      if (reqOrg && data.org_id && data.org_id !== reqOrg) return res.status(404).json({ error: 'Job order not found' });

      if (isRecruiter(req) && !isBDM(req)) {
        const ids = await assignedJobOrderIds(req.user.id);
        if (!ids.includes(data.id)) return res.status(403).json({ error: 'Not assigned to this job order.' });
      }

      // attach assigned recruiters
      const { data: assigns } = await supabase.from('recruiter_assignments')
        .select('id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
        .eq('job_order_id', data.id);
      data.recruiters = assigns || [];
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/job-orders/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      // BD managers can edit any job order; recruiters can edit a job they are
      // assigned to (so the people actually working the req can keep it current).
      if (!isBDM(req) && !(isRecruiter(req) && await recruiterCanTouchJob(req, req.params.id))) {
        return res.status(403).json({ error: 'Only BD Managers or an assigned recruiter can edit this job order.' });
      }
      const b = req.body || {};
      const updates = Object.assign({ updated_at: new Date() }, pickJobFields(b));
      if (b.bd_manager_id !== undefined) updates.bd_manager_id = b.bd_manager_id || null;

      // Re-derive against the row as it will be AFTER this edit, not just the
      // fields being sent: a BD who pastes a JD and nothing else should still get
      // skills filled in, and one who types skills by hand must keep them.
      const { data: current } = await supabase.from('job_orders')
        .select('*').eq('id', req.params.id).maybeSingle();
      Object.assign(updates, await applyDerivedJobFields(Object.assign({}, current || {}, updates)));

      const { data, error } = await supabase.from('job_orders')
        .update(updates).eq('id', req.params.id).select(JOB_ORDER_SELECT).single();
      if (error) throw error;
      // The job changed, so every cached score against it is stale.
      invalidateJobScores(req.params.id);
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/job-orders/:id', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can delete job orders.' });
      await supabase.from('job_orders').update({ deleted_at: new Date() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // RELEVANCE — rank the candidate pool against a job order
  //
  // The browser has scored candidates for a while, but only the handful already
  // tagged onto a job's pipeline, because that is all it ever holds. Ranking the
  // whole database against a job has to happen server-side. Same scoring rules
  // in both places — literally the same file (see match-engine.js).
  // ==========================================================================

  // GET /job-orders/:id/matches — the whole pool, best fit first.
  //   ?limit=      how many to return (default 50, max 200)
  //   ?min_score=  only return candidates at or above this score
  //   ?q=          narrow the pool by name/email/title first
  app.get('/job-orders/:id/matches', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;

      const { data: job, error: jobErr } = await withOrg(
        supabase.from('job_orders').select('*').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (jobErr) throw jobErr;
      // 404 rather than an empty list: an out-of-org id must not be
      // distinguishable from one that doesn't exist.
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const q = String(req.query.q || '').trim().replace(/[,()]/g, ' ').trim();
      let query = withOrg(supabase.from('candidates')
        .select(CANDIDATE_SELECT).is('deleted_at', null), req);
      if (q) query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,candidate_code.ilike.%${q}%,current_title.ilike.%${q}%`
      );
      // Bounded so one enormous org can't turn this into a full-table scan; the
      // app's analytics already have that problem and this shouldn't add to it.
      const { data: candidates, error } = await query.limit(2000);
      if (error) throw error;

      const minScore = req.query.min_score != null && req.query.min_score !== ''
        ? parseInt(req.query.min_score, 10) : null;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

      const ranked = matchEngine.rankCandidates(candidates || [], job, {
        minScore: Number.isNaN(minScore) ? null : minScore
      });
      persistScores(ranked, job.id, req);

      res.json({
        job_order: { id: job.id, job_code: job.job_code, job_title: job.job_title, client: job.client },
        // Surfaced so the UI can say *why* scores look thin — a job with no
        // skills listed scores everyone on title and location alone.
        scoreable: Boolean(
          String(job.primary_skills || '').trim() || String(job.secondary_skills || '').trim()
        ),
        engine_version: matchEngine.VERSION,
        total: ranked.length,
        pool_size: (candidates || []).length,
        results: ranked.slice(0, limit)
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /match/score — score one candidate against one job, by id or inline.
  // Inline lets the sourcing branches score a person who isn't in the DB yet.
  app.post('/match/score', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const b = req.body || {};

      let candidate = b.candidate || null;
      if (!candidate && b.candidate_id) {
        const { data } = await withOrg(supabase.from('candidates')
          .select(CANDIDATE_SELECT).eq('id', b.candidate_id).is('deleted_at', null), req).maybeSingle();
        candidate = data;
      }
      let job = b.job || null;
      if (!job && b.job_order_id) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', b.job_order_id).is('deleted_at', null), req).maybeSingle();
        job = data;
      }
      if (!candidate || !job) {
        return res.status(400).json({ error: 'Provide candidate (or candidate_id) and job (or job_order_id).' });
      }

      res.json(Object.assign({ engine_version: matchEngine.VERSION },
        matchEngine.scoreCandidate(candidate, job)));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /job-orders/:id/parse-jd — re-derive skills/experience from the JD on
  // demand, for job orders created before this existed. Returns what it would
  // write; `?apply=1` persists it. Only ever fills blanks.
  app.post('/job-orders/:id/parse-jd', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      const { data: job } = await withOrg(
        supabase.from('job_orders').select('*').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });
      if (!isBDM(req) && !(isRecruiter(req) && await recruiterCanTouchJob(req, req.params.id))) {
        return res.status(403).json({ error: 'Only BD Managers or an assigned recruiter can edit this job order.' });
      }

      const derived = await applyDerivedJobFields(job);
      if (!Object.keys(derived).length) {
        return res.json({ applied: false, derived: {}, message: 'Nothing to fill — the skill fields are already set, or the description has no parseable detail.' });
      }
      if (String(req.query.apply || '') !== '1') return res.json({ applied: false, derived });

      const { data, error } = await supabase.from('job_orders')
        .update(Object.assign({ updated_at: new Date() }, derived))
        .eq('id', req.params.id).select(JOB_ORDER_SELECT).single();
      if (error) throw error;
      invalidateJobScores(req.params.id);
      res.json({ applied: true, derived, job_order: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── anonymized posting JD ──────────────────────────────────────────────────
  // Rewrite the job description with the client/company identity removed so it
  // can be published on job boards. AI rewrite when a key is configured;
  // otherwise a rule-based scrub (replace client names with "our client",
  // strip emails/phones/URLs). Returns the text — saving is a separate PUT.
  function scrubJobDescription(jd, names) {
    let out = String(jd || '');
    names.filter(Boolean).forEach(n => {
      const safe = String(n).trim();
      if (safe.length < 3) return;
      out = out.replace(new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'our client');
      // also scrub without common suffixes (Acme Corp → Acme)
      const base = safe.replace(/[,.]?\s+(inc|llc|llp|ltd|corp|co|company|group|pllc|pc)\.?$/i, '').trim();
      if (base.length >= 4 && base.toLowerCase() !== safe.toLowerCase()) {
        out = out.replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'our client');
      }
    });
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')     // emails
             .replace(/https?:\/\/\S+|www\.\S+/gi, '')                           // urls
             .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '')  // phones
             .replace(/(our client)(\s+\1)+/gi, 'our client')
             .replace(/[ \t]{2,}/g, ' ').trim();
    return out;
  }

  app.post('/job-orders/:id/posting-jd', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      if (!(await recruiterCanTouchJob(req, req.params.id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data: j, error } = await supabase.from('job_orders')
        .select('job_title,client,end_client,client_manager,job_description,company:companies(name)')
        .eq('id', req.params.id).is('deleted_at', null).single();
      if (error || !j) return res.status(404).json({ error: 'Job order not found' });
      if (!j.job_description || !j.job_description.trim()) return res.status(400).json({ error: 'This job has no description to rewrite.' });

      const names = [j.client, j.end_client, j.client_manager, j.company && j.company.name];
      const key = process.env.ANTHROPIC_API_KEY;
      if (key && key !== 'your_anthropic_api_key_here') {
        try {
          const prompt = `Rewrite this job description for public posting on job boards. Remove ALL identifying details of the hiring company: company names (${names.filter(Boolean).join(', ') || 'any company names present'}), people's names, emails, phone numbers, URLs, and street addresses. Refer to the company only as "our client". Keep every requirement, responsibility, pay/benefit detail, and location (city/state is fine). Keep the same structure and roughly the same length. Reply with ONLY the rewritten description — no preamble.

JOB TITLE: ${j.job_title || ''}

DESCRIPTION:
${String(j.job_description).slice(0, 12000)}`;
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] })
          }, { timeoutMs: AI_TIMEOUT_MS });
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text?.trim();
          // belt-and-braces: scrub the AI output too, in case a name slipped through
          if (text) return res.json({ posting: scrubJobDescription(text, names), used_ai: true });
        } catch (_) { /* fall through to rules */ }
      }
      res.json({ posting: scrubJobDescription(j.job_description, names), used_ai: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ==========================================================================
  // RECRUITER ASSIGNMENT
  // ==========================================================================

  app.post('/job-orders/:id/recruiters', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can assign recruiters.' });
      const recruiterIds = req.body.recruiter_ids || (req.body.recruiter_id ? [req.body.recruiter_id] : []);
      if (!recruiterIds.length) return res.status(400).json({ error: 'recruiter_ids required' });

      const rows = recruiterIds.map(rid => ({
        job_order_id: req.params.id, recruiter_id: rid, assigned_by: req.user.id
      }));
      // upsert avoids duplicate-assignment errors thanks to the unique index
      const { error } = await supabase.from('recruiter_assignments')
        .upsert(rows, { onConflict: 'job_order_id,recruiter_id', ignoreDuplicates: true });
      if (error) throw error;

      const { data: assigns } = await supabase.from('recruiter_assignments')
        .select('id, assigned_at, recruiter:users!recruiter_id(id,name,employee_id)')
        .eq('job_order_id', req.params.id);
      res.json(assigns || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/job-orders/:id/recruiters/:rid', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can unassign recruiters.' });
      await supabase.from('recruiter_assignments')
        .delete().eq('job_order_id', req.params.id).eq('recruiter_id', req.params.rid);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Assignment requests: recruiter asks to be put on a job ────────────────
  app.post('/job-orders/:id/request-assignment', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isRecruiter(req)) return res.status(403).json({ error: 'Recruiters only.' });
      const jid = req.params.id, uid = req.user.id;
      const assigned = await assignedJobOrderIds(uid);
      if (assigned.includes(jid)) return res.status(400).json({ error: 'You are already assigned to this job.' });
      const { data: existing } = await supabase.from('assignment_requests')
        .select('id,status').eq('job_order_id', jid).eq('recruiter_id', uid).eq('status', 'pending').maybeSingle();
      if (existing) return res.json(existing);
      const { data, error } = await supabase.from('assignment_requests')
        .insert({ job_order_id: jid, recruiter_id: uid, note: (req.body && req.body.note) || null })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // BDM: the queue of recruiters asking for jobs. Recruiter: their own requests.
  app.get('/assignment-requests', auth, async (req, res) => {
    try {
      let q = supabase.from('assignment_requests')
        .select('id,status,note,created_at,decided_at,job_order_id,recruiter_id,' +
          'job:job_orders(id,job_code,job_title,client),recruiter:users!recruiter_id(id,name,employee_id)')
        .order('created_at', { ascending: false }).limit(100);
      if (isBDM(req)) { if (req.query.status) q = q.eq('status', req.query.status); }
      else if (isRecruiter(req)) q = q.eq('recruiter_id', req.user.id);
      else return res.status(403).json({ error: 'Recruiting roles only.' });
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/assignment-requests/:id/decide', auth, async (req, res) => {
    try {
      if (notGuest(req, res)) return;
      if (!isBDM(req)) return res.status(403).json({ error: 'Only BD Managers can decide assignment requests.' });
      const action = (req.body && req.body.action) || '';
      if (!['approve', 'decline'].includes(action)) return res.status(400).json({ error: "action must be 'approve' or 'decline'" });
      const { data: reqRow } = await supabase.from('assignment_requests')
        .select('id,job_order_id,recruiter_id,status').eq('id', req.params.id).maybeSingle();
      if (!reqRow) return res.status(404).json({ error: 'Request not found' });
      if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Request already decided.' });
      if (action === 'approve') {
        const { error: aerr } = await supabase.from('recruiter_assignments')
          .upsert({ job_order_id: reqRow.job_order_id, recruiter_id: reqRow.recruiter_id, assigned_by: req.user.id },
            { onConflict: 'job_order_id,recruiter_id', ignoreDuplicates: true });
        if (aerr) throw aerr;
      }
      const { data, error } = await supabase.from('assignment_requests')
        .update({ status: action === 'approve' ? 'approved' : 'declined', decided_by: req.user.id, decided_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Job orders a specific user is assigned to — lets an admin/BDM see a
  // recruiter's assignments from that recruiter's profile (the recruiter's own
  // /job-orders is scoped to themselves; this is the "view someone else" version).
  app.get('/users/:id/job-orders', auth, async (req, res) => {
    try {
      if (!isBDM(req)) return res.status(403).json({ error: 'Admin or BD Manager only' });
      const ids = await assignedJobOrderIds(req.params.id);
      if (!ids.length) return res.json([]);
      const { data, error } = await supabase.from('job_orders')
        .select(JOB_ORDER_SELECT).in('id', ids).is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
