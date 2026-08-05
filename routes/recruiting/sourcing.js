// ============================================================================
// SOURCING CONNECTORS — pull candidates from a source into the database.
// Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { PROVIDER_IDS, providerList } = require('../../config/sourcing');
const { parseResume } = require('../../resume-parser');
const createCandidateFields = require('../../services/candidate-fields');

module.exports = function (app, core) {
  const {
    supabase, db, auth, hasRole, today,
    orgIdFor, orgStamp, withOrg,
    hasRequirementColumns, applyDerivedJobFields, persistScores, invalidateJobScores,
    STAGES, STAGE_ALIASES, normalizeStage, BDM_GATED_STAGE,
    isBDM, isRecruiter, assignedJobOrderIds, recruiterCanTouchJob, reportingChainIds,
    nextId, logSubmissionActivity,
    JOB_ORDER_SELECT, JOB_FIELDS, JOB_DATE_FIELDS, pickJobFields,
  } = core;
  const { CANDIDATE_FIELDS, CANDIDATE_SELECT, pickCandidateFields,
          normName, normEmail, normPhone, findCandidateDuplicates } = createCandidateFields(core);

  // SOURCING CONNECTORS — pull candidates from a source into the database
  // (Slice A: framework + CSV/file import + staging + dedup import.)
  // ==========================================================================

  app.get('/sourcing/providers', auth, async (req, res) => { res.json(providerList()); });

  // stage rows parsed client-side (CSV/XLSX) with a batch duplicate check
  app.post('/sourcing/import-file', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const provider = PROVIDER_IDS.includes(b.provider) ? b.provider : 'csv';
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
      if (rows.length > 2000) return res.status(413).json({ error: 'Too many rows in one import (max 2000). Split the file.' });

      // batch dedup against existing candidates (2 queries, matched in JS)
      const emails = [...new Set(rows.map(r => normEmail(r.email)).filter(Boolean))];
      const phones = [...new Set(rows.map(r => normPhone(r.phone)).filter(Boolean))];
      const dupSel = 'id,candidate_code,full_name,name_norm,email_norm,phone_norm';
      let cands = [];
      // Org-scoped: without this the batch check can flag a row as a duplicate
      // of a candidate belonging to a different org, and leak their code + name.
      if (emails.length) { const { data } = await withOrg(supabase.from('candidates').select(dupSel).is('deleted_at', null).in('email_norm', emails), req); cands = cands.concat(data || []); }
      if (phones.length) { const { data } = await withOrg(supabase.from('candidates').select(dupSel).is('deleted_at', null).in('phone_norm', phones), req); cands = cands.concat(data || []); }
      const byId = {}; cands.forEach(c => { byId[c.id] = c; }); cands = Object.values(byId);
      const findDup = (r) => {
        const n = normName(r.full_name), e = normEmail(r.email), p = normPhone(r.phone);
        if (!n || (!e && !p)) return null;
        return cands.find(c => c.name_norm === n && ((e && c.email_norm === e) || (p && c.phone_norm === p))) || null;
      };

      const toInsert = rows.map(r => {
        const dup = findDup(r);
        const exp = parseFloat(r.experience_years);
        return {
          provider, external_id: r.external_id || null,
          full_name: r.full_name || null, first_name: r.first_name || null, last_name: r.last_name || null,
          email: r.email || null, phone: r.phone || null,
          current_title: r.current_title || null, current_employer: r.current_employer || null,
          location: r.location || null, city: r.city || null, state: r.state || null, country: r.country || null,
          work_authorization: r.work_authorization || null,
          experience_years: isFinite(exp) ? exp : null,
          skills: r.skills || null, resume_url: r.resume_url || null,
          // A LinkedIn column now arrives as linkedin_url; everything else as
          // source_url. Both land in the existing source_url column (staging has
          // no separate field, and adding one would mean writing to a column
          // that does not exist until migration 036 runs). importStagedCandidate
          // recognises a LinkedIn URL and routes it to candidates.linkedin_url.
          source_url: r.linkedin_url || r.source_url || null,
          raw: r.raw || null, status: 'new', dup_candidate_id: dup ? dup.id : null, created_by: req.user.id,
          ...orgStamp(req)
        };
      });
      const { data, error } = await supabase.from('sourcing_candidates').insert(toInsert).select('id,dup_candidate_id');
      if (error) throw error;
      const dupCount = (data || []).filter(x => x.dup_candidate_id).length;
      res.status(201).json({ staged: (data || []).length, duplicates: dupCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // the review queue
  app.get('/sourcing/staged', auth, async (req, res) => {
    try {
      // Previously this had no org scoping, no guest check and no role check, so
      // any authenticated session — guests included — could read every org's
      // staged candidates. These are real people's contact details; they get the
      // same treatment as the candidates table itself.
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      let q = withOrg(supabase.from('sourcing_candidates')
        .select('*, dup:candidates!dup_candidate_id(id,candidate_code,full_name), imported:candidates!imported_candidate_id(id,candidate_code,full_name)')
        .order('created_at', { ascending: false }).limit(500), req);
      q = q.eq('status', req.query.status || 'new');
      if (req.query.provider) q = q.eq('provider', req.query.provider);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Does this candidates table have the provenance columns yet? Migration 036 is
  // applied after deploy, and writing to a missing column fails the whole insert
  // — which would break importing entirely. Probe once and degrade.
  let _provColsPromise = null;
  function hasProvenanceColumns() {
    if (!_provColsPromise) {
      _provColsPromise = supabase.from('candidates').select('profile_url').limit(1)
        .then(r => !r.error).catch(() => false);
    }
    return _provColsPromise;
  }

  // A LinkedIn profile deserves the dedicated column the candidate form already
  // reads; anything else is a generic profile URL.
  function isLinkedInUrl(u) { return /(^|\/\/|\.)linkedin\.com\/(in|pub)\//i.test(String(u || '')); }

  // import one staged row into `candidates` (honours dedup; optional tag to a job)
  async function importStagedCandidate(staged, opts, userId, req) {
    const provider = staged.provider;
    const profileUrl = staged.profile_url || staged.source_url || null;
    const payload = pickCandidateFields({
      full_name: staged.full_name, first_name: staged.first_name, last_name: staged.last_name,
      email: staged.email, phone: staged.phone, current_title: staged.current_title,
      current_employer: staged.current_employer, current_location: staged.location,
      city: staged.city, state: staged.state, country: staged.country,
      work_authorization: staged.work_authorization, experience_years: staged.experience_years,
      skills: staged.skills, resume_url: staged.resume_url, source: provider,
      // Previously dropped on the floor: a LinkedIn URL imported through Sourcing
      // survived staging and then vanished, because nothing mapped it across.
      linkedin_url: isLinkedInUrl(profileUrl) ? profileUrl : null
    });
    if (!payload.full_name) throw new Error('Staged row has no name.');
    if (!opts.force) {
      const dups = await findCandidateDuplicates({
        full_name: staged.full_name, email: staged.email, phone: staged.phone,
        // Externally sourced people often have neither an email nor a phone, and
        // the name+contact rule can't see them at all. The profile URL is the
        // only stable identity such a person has.
        profile_url: profileUrl, source: provider, source_external_id: staged.external_id, req
      });
      if (dups.length) return { duplicate: true, matches: dups };
    }
    const row = Object.assign(payload, {
      candidate_code: await nextId('CN'), applicant_status: 'New lead', owner_id: userId, created_by: userId
    }, orgStamp(req));
    if (await hasProvenanceColumns()) {
      row.profile_url = profileUrl;
      row.source_external_id = staged.external_id || null;
    }
    const { data: cand, error } = await supabase.from('candidates').insert(row).select(CANDIDATE_SELECT).single();
    if (error) throw error;
    await supabase.from('sourcing_candidates')
      .update({ status: 'imported', imported_candidate_id: cand.id, imported_at: new Date() }).eq('id', staged.id);
    if (opts.job_order_id) {
      try {
        await supabase.from('candidate_pipeline').insert({
          pipeline_code: await nextId('PL'), candidate_id: cand.id, job_order_id: opts.job_order_id,
          pipeline_status: 'Tagged', work_auth_snap: cand.work_authorization || null, source: provider, tagged_by: userId
        });
      } catch (_) { /* already tagged / non-fatal */ }
    }
    return { candidate: cand };
  }

  app.post('/sourcing/staged/:id/import', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: staged, error: e0 } = await supabase.from('sourcing_candidates').select('*').eq('id', req.params.id).single();
      if (e0 || !staged) return res.status(404).json({ error: 'Staged candidate not found' });
      if (staged.status === 'imported') return res.status(409).json({ error: 'Already imported.' });
      const b = req.body || {};
      if (b.job_order_id && !(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const result = await importStagedCandidate(staged, { force: !!b.force, job_order_id: b.job_order_id || null }, req.user.id, req);
      if (result.duplicate) return res.status(409).json({ error: 'possible_duplicate', duplicates: result.matches });
      res.status(201).json(result.candidate);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/sourcing/import-selected', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? b.ids : [];
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      if (b.job_order_id && !(await recruiterCanTouchJob(req, b.job_order_id))) return res.status(403).json({ error: 'Not assigned to this job order.' });
      const { data: staged } = await supabase.from('sourcing_candidates').select('*').in('id', ids).eq('status', 'new');
      let imported = 0, skipped = 0;
      for (const s of (staged || [])) {
        try {
          const r = await importStagedCandidate(s, { force: !!b.force, job_order_id: b.job_order_id || null }, req.user.id, req);
          if (r.duplicate) skipped++; else imported++;
        } catch (_) { skipped++; }
      }
      res.json({ imported, skipped, total: (staged || []).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/sourcing/staged/:id', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      await withOrg(supabase.from('sourcing_candidates').update({ status: 'discarded' }).eq('id', req.params.id), req);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // people-search for API providers — scaffolded; honest not-configured response
  app.post('/sourcing/search', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const provider = (req.body && req.body.provider) || '';
      if (!PROVIDER_IDS.includes(provider)) return res.status(400).json({ error: 'Unknown provider.' });
      if (provider === 'csv') return res.status(400).json({ error: 'Use file import for CSV.' });
      return res.status(501).json({ error: 'needs_credentials', provider,
        message: 'This provider is scaffolded. Add credentials and enable its connector to search.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
