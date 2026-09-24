// ============================================================================
// SOURCING CONNECTORS — pull candidates from a source into the database.
// Split out of bd_recruiter_routes.js; logic unchanged.
// ============================================================================

const { PROVIDER_IDS, providerList, PROVIDERS } = require('../../config/sourcing');
const { parseResume } = require('../../resume-parser');
const createCandidateFields = require('../../services/candidate-fields');

const applicants = require('../../services/applicants');
const matchEngine = require('../../match-engine');
// Same bucket routes/apply.js writes into.
const APPLY_DOC_BUCKET = 'candidate-docs';

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
      // `status=all` is how the Applicants view shows someone who has already
      // been imported. The review queue still defaults to 'new', so nothing
      // else changes shape.
      const st = String(req.query.status || 'new');
      if (st !== 'all') q = q.eq('status', st);
      if (req.query.provider) q = q.eq('provider', req.query.provider);
      // WHICH JOB SOMEONE APPLIED TO LIVES IN `raw`, NOT IN A COLUMN. The apply
      // route records it there (`raw.applied_to_job_order_id`) and this is the
      // only reader, so the filter is expressed once, here, rather than in the
      // page. It is deliberately NOT a migration yet: at this volume a jsonb
      // filter is free, and a column that has to be backfilled is worth adding
      // when the number of applicants makes it measurable, not before.
      if (req.query.job_order_id) q = q.eq('provider', 'apply');
      const { data, error } = await q;
      if (error) throw error;
      let rows = data || [];
      // The job match is done HERE, in Node, not as a PostgREST jsonb filter.
      // A `raw->>key` filter cannot be verified from the sandbox, and its
      // failure mode is an EMPTY list rather than an error — it would read as
      // "no applicants yet" forever, which is the worst way for this to break.
      // `services/applicants.js` is pure, so the rule is pinned by a test.
      if (req.query.job_order_id) rows = applicants.forJob(rows, req.query.job_order_id);
      // AN APPLICANT IS SCORED AGAINST THE JOB THEY CHOSE THEMSELVES, which
      // makes the number unusually meaningful — this is not "who might suit
      // this role", it is "how well does the person who put their hand up
      // actually fit the thing they put it up for". With forty applicants that
      // is the difference between a list and a shortlist.
      //
      // One fetch for the whole page: the distinct jobs applied to, not one
      // query per applicant.
      const jobIds = [...new Set(rows.map(r => applicants.appliedJobId(r)).filter(Boolean))];
      const jobsById = {};
      if (jobIds.length) {
        const { data: jobs } = await withOrg(supabase.from('job_orders')
          .select('id,job_title,primary_skills,secondary_skills,exp_min,exp_max,city,state,country,job_description')
          .in('id', jobIds), req);
        for (const j of (jobs || [])) jobsById[j.id] = j;
      }
      // The page never parses `raw`. One reader, one shape.
      res.json(rows.map(r => {
        const aj = applicants.appliedJob(r);
        let match = null;
        if (aj && jobsById[aj.id]) {
          // Scoring must never take the list down — a malformed staged row is
          // a missing number, not a 500.
          try { match = matchEngine.scoreCandidate(r, jobsById[aj.id]); } catch (_) { match = null; }
        }
        return Object.assign({}, r, { applied_job: aj, match });
      }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // THE APPLICANT'S CV LIVES IN A PRIVATE BUCKET, SO IT NEEDS SIGNING.
  //
  // `sourcing_candidates.resume_url` holds two different things depending on
  // where the row came from: a CSV row carries a public URL somebody typed,
  // and an APPLICATION carries a storage PATH inside the private
  // `candidate-docs` bucket. Rendering either one as a plain link works for the
  // first and silently 400s for the second — so the page never links straight
  // to it, it asks here and gets a short-lived signed URL.
  //
  // Org-scoped and role-gated exactly like /sourcing/staged: this is a real
  // person's CV. A row belonging to another org answers 404, not 403, so an id
  // cannot be probed for existence.
  app.get('/sourcing/staged/:id/resume', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: row, error } = await withOrg(
        supabase.from('sourcing_candidates').select('id,resume_url').eq('id', req.params.id).limit(1), req);
      if (error) throw error;
      const rec = (row || [])[0];
      if (!rec) return res.status(404).json({ error: 'Not found.' });
      const stored = String(rec.resume_url || '');
      if (!stored) return res.status(404).json({ error: 'No resume on this application.' });
      // Already a URL (a CSV row) — hand it back untouched rather than trying
      // to sign something that was never in our bucket.
      if (/^https?:\/\//i.test(stored)) return res.json({ url: stored, signed: false });
      const { data: sig, error: e2 } = await supabase.storage.from(APPLY_DOC_BUCKET).createSignedUrl(stored, 600);
      if (e2 || !sig || !sig.signedUrl) return res.status(404).json({ error: 'That file is no longer available.' });
      res.json({ url: sig.signedUrl, signed: true });
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
      candidate_code: await nextId('CN'), applicant_status: 'New lead', owner_id: userId, created_by: userId,
      // A RECRUITER READS THIS COLUMN, SO IT HOLDS A WORD, NOT AN ID. It used
      // to store the raw provider token, so somebody who applied through a job
      // link had a Source reading "apply". One mapping, in services/applicants.
      source: applicants.sourceLabel(provider) || provider,
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

      // AND A SUBMISSION, BECAUSE THAT IS WHAT "ON THE JOB" MEANS EVERYWHERE
      // ELSE (Session 28, round 3).
      //
      // Importing with a job used to write ONLY the `candidate_pipeline` row
      // above. But the job order's own Candidates list, the pipeline board, the
      // funnel and every report read `submissions.stage` — so an applicant the
      // owner had explicitly added to a job landed in the database, counted
      // nowhere, and the job page kept reading "Candidates (0)". Verified on the
      // live record: candidate created, pipeline row created, **zero
      // submissions**. The owner reported it as "its not added as candidate to
      // the job", which was exactly right.
      //
      // `Sourced` is the first ATS stage and the same one a manual add uses —
      // this is not a new kind of membership, it is the existing one.
      try {
        const subRow = applicants.submissionRowFor(cand, opts.job_order_id, userId);
        // NO `submitted_at` (D-0029). Adding somebody to a job is membership,
        // not a submission — stamping a submission date on a `Sourced` row is
        // the same mistake as counting it, written into the record itself.
        const { error: subErr } = await supabase.from('submissions').insert(Object.assign(subRow, {
          submission_code: await nextId('SB'),
        }, orgStamp(req)));
        // 23505 is "already on this job" — a second import of the same person
        // is not an error, and must never undo the import that just succeeded.
        if (subErr && subErr.code !== '23505') throw subErr;
      } catch (e) {
        // A submission that did not land must be VISIBLE, not swallowed. The
        // candidate is already saved, so this is reported and never rolled back.
        return { candidate: cand, job_link_failed: (e && e.message) || 'could not add to the job' };
      }
    }
    return { candidate: cand };
  }

  app.post('/sourcing/staged/:id/import', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: staged, error: e0 } = await withOrg(
        supabase.from('sourcing_candidates').select('*').eq('id', req.params.id), req
      ).single();
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
      const { data: staged } = await withOrg(
        supabase.from('sourcing_candidates').select('*').in('id', ids).eq('status', 'new'), req
      );
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

  // People-search against an outside board.
  //
  // NOTHING IS BUILT BEHIND THIS YET, and the refusal says so in those words.
  // It used to answer `needs_credentials` — "add a key and this works" — which
  // was false for every provider and is what made six placeholder cards read
  // as working features for five sessions. The honest answer names what would
  // actually be needed, which for all of them is a commercial account rather
  // than a key. See config/sourcing.js and D-0025.
  app.post('/sourcing/search', auth, async (req, res) => {
    try {
      if (!isBDM(req) && !isRecruiter(req)) return res.status(403).json({ error: 'Not permitted.' });
      const provider = (req.body && req.body.provider) || '';
      const def = PROVIDERS.find(p => p.id === provider);
      if (!def) return res.status(400).json({ error: 'Unknown provider.' });
      if (provider === 'csv') return res.status(400).json({ error: 'Use file import for CSV.' });
      if (provider === 'apply') return res.status(400).json({ error: 'Applicants arrive on their own — publish a job order\u2019s apply page and share the link.' });
      return res.status(501).json({
        error: 'not_built', provider,
        message: (def.blocker || 'No connector exists for this source yet.') +
                 ' Until then, export from that board and use the CSV import.',
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
