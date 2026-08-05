// ============================================================================
// LEAD SOURCES + THE SOURCED-LEAD REVIEW QUEUE
//
// Configure which employer job boards to watch, see what was found, and approve
// or reject each posting before it becomes a real lead.
//
// The approval gate is the important part. Sourced postings live in
// `sourced_jobs_raw` and are inert: nothing in the outreach engine can see them.
// Only an explicit approval creates the `companies` / `jobs` / `contacts` rows,
// at which point the lead is indistinguishable from one an RA typed in and flows
// through the existing distribution and sequencing machinery unchanged.
// ============================================================================
const express = require('express');
const { providerList, fetchBoard, getProvider } = require('../lead-sources');
const { runDueSources, ingestSource } = require('../lead-ingest');
const { classifyCompany } = require('../company-classifier');
const { findContacts, normalizeDomain } = require('../enrichment');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, withOrg, orgStamp, orgIdFor, logActivity } = ctx;

  // Sourcing decides who the desk talks to, so it is a BD/admin concern.
  const canManage = (req) => hasRole(req, 'admin', 'bd_lead', 'ra_lead', 'director', 'associate_director');
  const canReview = (req) => hasRole(req, 'admin', 'bd_lead', 'ra_lead', 'bd', 'ra', 'director', 'associate_director');

  // Migration 035 is applied after deploy, as usual. Every read degrades to a
  // clear "not set up yet" rather than a 500.
  const notReady = (err) => /relation .* does not exist|could not find the table/i.test(String(err && err.message));

  // ── providers ─────────────────────────────────────────────────────────────
  router.get('/lead-sources/providers', auth, (req, res) => {
    res.json({ providers: providerList() });
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────
  router.get('/lead-sources', auth, async (req, res) => {
    try {
      const { data, error } = await withOrg(supabase.from('lead_sources')
        .select('*').is('deleted_at', null).order('created_at', { ascending: false }), req);
      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      if (notReady(err)) return res.json([]);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/lead-sources', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      if (!getProvider(b.provider)) return res.status(400).json({ error: 'Unknown provider.' });
      if (!String(b.board_token || '').trim()) return res.status(400).json({ error: 'A board name is required.' });

      const row = Object.assign({
        provider: String(b.provider).toLowerCase(),
        board_token: String(b.board_token).trim(),
        company_name: b.company_name || null,
        company_domain: normalizeDomain(b.company_domain),
        filters: b.filters || null,
        every_hours: Math.max(1, parseInt(b.every_hours, 10) || 24),
        active: b.active !== false,
        created_by: req.user.id
      }, orgStamp(req));

      const { data, error } = await supabase.from('lead_sources').insert(row).select().single();
      if (error) {
        // The unique index is the friendliest place to catch a double-add.
        if (/duplicate key/i.test(error.message)) {
          return res.status(409).json({ error: 'That board is already being watched.' });
        }
        throw error;
      }
      res.status(201).json(data);
    } catch (err) {
      if (notReady(err)) return res.status(503).json({ error: 'Lead sourcing is not set up yet (migration 035 pending).' });
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/lead-sources/:id', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const updates = { updated_at: new Date() };
      for (const f of ['company_name', 'filters', 'active']) if (b[f] !== undefined) updates[f] = b[f];
      if (b.company_domain !== undefined) updates.company_domain = normalizeDomain(b.company_domain);
      if (b.every_hours !== undefined) updates.every_hours = Math.max(1, parseInt(b.every_hours, 10) || 24);

      const { data, error } = await withOrg(
        supabase.from('lead_sources').update(updates).eq('id', req.params.id), req
      ).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Source not found' });
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/lead-sources/:id', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      await withOrg(supabase.from('lead_sources')
        .update({ deleted_at: new Date() }).eq('id', req.params.id), req);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── test a board before saving it ─────────────────────────────────────────
  // Hits the real feed and reports exactly what came back. This exists because
  // getting a board name right is the single most likely thing to go wrong when
  // setting a source up, and because these feeds cannot be reached from every
  // development environment — this is how you confirm one actually works.
  router.post('/lead-sources/test', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      const b = req.body || {};
      const result = await fetchBoard(b.provider, b.board_token, { timeoutMs: 20000 });

      if (!result.ok) return res.json({ ok: false, error: result.error, status: result.status || null });

      const postings = result.postings || [];
      const verdict = classifyCompany({
        name: b.company_name || b.board_token,
        description: postings.map(p => p.description).filter(Boolean).slice(0, 3).join('\n').slice(0, 4000),
        postings, from_ats_board: true
      });

      res.json({
        ok: true,
        found: postings.length,
        company_kind: verdict.kind,
        company_kind_why: verdict.why,
        // A small sample so the person configuring it can see real titles and
        // judge whether this is the right board, without dumping the whole feed.
        sample: postings.slice(0, 5).map(p => ({
          title: p.title, location: p.location, department: p.department,
          posted_at: p.posted_at, url: p.url,
          has_description: Boolean(p.description && p.description.length > 80)
        }))
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Run one source right now rather than waiting for its schedule.
  router.post('/lead-sources/:id/run', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: source } = await withOrg(
        supabase.from('lead_sources').select('*').eq('id', req.params.id).is('deleted_at', null), req
      ).maybeSingle();
      if (!source) return res.status(404).json({ error: 'Source not found' });
      res.json(await ingestSource(source, { supabase }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Run every due source (also driven by the background engine).
  router.post('/lead-sources/run-all', auth, async (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ error: 'Not permitted.' });
      res.json(await runDueSources({ supabase }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── the review queue ──────────────────────────────────────────────────────
  router.get('/sourced-leads', auth, async (req, res) => {
    try {
      const status = String(req.query.status || 'new');
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

      let q = withOrg(supabase.from('sourced_jobs_raw').select('*'), req)
        .order('last_seen_at', { ascending: false }).limit(limit);
      if (status !== 'all') q = q.eq('status', status);
      if (req.query.source_id) q = q.eq('lead_source_id', req.query.source_id);
      if (req.query.q) q = q.or(`title.ilike.%${req.query.q}%,company_name.ilike.%${req.query.q}%`);

      const { data, error } = await q;
      if (error) throw error;

      // Counts per status so the UI can show tabs without a second round trip.
      let counts = {};
      try {
        const { data: all } = await withOrg(supabase.from('sourced_jobs_raw').select('status'), req).limit(5000);
        (all || []).forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
      } catch { /* counts are a nicety */ }

      res.json({ results: data || [], counts });
    } catch (err) {
      if (notReady(err)) return res.json({ results: [], counts: {}, not_configured: true });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sourced-leads/:id/reject', auth, async (req, res) => {
    try {
      if (!canReview(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data, error } = await withOrg(supabase.from('sourced_jobs_raw').update({
        status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date()
      }).eq('id', req.params.id), req).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── approve → become a real lead ──────────────────────────────────────────
  // This is the only path from sourced data into the live system. It builds the
  // same rows an RA's manual entry would, so everything downstream — the
  // distribution engine, the sequence engine, the send loop — is untouched.
  router.post('/sourced-leads/:id/approve', auth, async (req, res) => {
    try {
      if (!canReview(req)) return res.status(403).json({ error: 'Not permitted.' });

      const { data: staged } = await withOrg(
        supabase.from('sourced_jobs_raw').select('*').eq('id', req.params.id), req
      ).maybeSingle();
      if (!staged) return res.status(404).json({ error: 'Not found' });
      if (staged.status === 'promoted') {
        return res.status(409).json({ error: 'Already approved.', job_id: staged.promoted_job_id });
      }

      const b = req.body || {};
      const org = orgStamp(req);

      // 1. Company — reuse an existing one rather than creating a duplicate.
      let companyId = b.company_id || null;
      if (!companyId) {
        const { data: found } = await withOrg(supabase.from('companies')
          .select('id').ilike('name', staged.company_name || '').limit(1), req);
        if (found && found.length) companyId = found[0].id;
      }
      if (!companyId) {
        const { data: created, error: cErr } = await supabase.from('companies').insert(Object.assign({
          name: staged.company_name,
          website: staged.company_domain ? `https://${staged.company_domain}` : null,
          location: [staged.city, staged.state].filter(Boolean).join(', ') || staged.location || null,
          created_by: req.user.id
        }, org)).select('id').single();
        if (cErr) throw cErr;
        companyId = created.id;
      }

      // 2. The lead itself. `research` is populated in the shape the existing
      //    outreach templates already read, so the hiring-reason lands directly
      //    in the email as the opening line with no template changes.
      const parsed = staged.parsed || {};
      const reason = staged.hiring_reason || {};
      const research = {
        requirements: {
          skill_1: parsed.skill_1 || null, skill_2: parsed.skill_2 || null, skill_3: parsed.skill_3 || null,
          skills: parsed.skills || [], suggested_skills: parsed.suggested_skills || [],
          skills_source: 'sourced_jd',
          salary_display: parsed.salary_display || null,
          salary_min: parsed.salary_min || null, salary_max: parsed.salary_max || null,
          location: staged.location || null, city: staged.city || null
        },
        company: { expertise: '', notes: '', headcount: '', hiring_volume: '' },
        outreach: { angle: reason.angle || '', avoid: '' },
        contacts: [],
        jd_raw: (staged.description || '').slice(0, 8000),
        parsed_at: new Date().toISOString(),
        // Provenance — required by the compliance note in the plan, and the
        // thing that lets anyone audit where a lead came from.
        source: {
          kind: 'auto_sourced', provider: staged.provider,
          url: staged.url, external_id: staged.external_id,
          sourced_at: staged.first_seen_at,
          hiring_reason: reason.category || null,
          hiring_reason_headline: reason.headline || null
        }
      };

      const leadRow = Object.assign({
        company_id: companyId,
        position: staged.title,
        location: [staged.city, staged.state].filter(Boolean).join(', ') || staged.location || null,
        source: `Auto · ${staged.provider}`,
        job_url: staged.url || null,
        stage: 'Unassigned',
        notes: reason.headline || '',
        research,
        created_by: req.user.id,
        created_date: new Date().toISOString().split('T')[0]
      }, org);

      const { data: job, error: jErr } = await supabase.from('jobs').insert(leadRow).select('id').single();
      if (jErr) throw jErr;

      // 3. Contacts. Only ones the reviewer actually picked — we never
      //    auto-attach an inferred address, because an inferred address is a
      //    guess and sending to it is a decision a person should make.
      const chosen = Array.isArray(b.contacts) ? b.contacts : [];
      if (chosen.length) {
        const rows = chosen.filter(c => c && c.email).map((c, i) => Object.assign({
          job_id: job.id,
          first_name: (c.name || '').split(/\s+/)[0] || '',
          last_name: (c.name || '').split(/\s+/).slice(1).join(' ') || '',
          designation: c.title || null,
          email: c.email,
          is_primary: i === 0
        }, org));
        if (rows.length) await supabase.from('contacts').insert(rows);
      }

      await supabase.from('sourced_jobs_raw').update({
        status: 'promoted', promoted_job_id: job.id,
        reviewed_by: req.user.id, reviewed_at: new Date()
      }).eq('id', staged.id);

      try {
        if (logActivity) await logActivity(job.id, null, req.user.id, 'lead_sourced',
          `Approved from ${staged.provider} — ${reason.headline || staged.title}`);
      } catch { /* audit is best-effort */ }

      res.status(201).json({ success: true, job_id: job.id, company_id: companyId });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Re-run contact inference for one staged lead, e.g. after adding the domain.
  router.post('/sourced-leads/:id/find-contacts', auth, async (req, res) => {
    try {
      if (!canReview(req)) return res.status(403).json({ error: 'Not permitted.' });
      const { data: staged } = await withOrg(
        supabase.from('sourced_jobs_raw').select('*').eq('id', req.params.id), req
      ).maybeSingle();
      if (!staged) return res.status(404).json({ error: 'Not found' });

      const domain = normalizeDomain((req.body && req.body.domain) || staged.company_domain);
      if (!domain) return res.status(400).json({ error: 'A company website or domain is needed to work out an email.' });

      const people = Array.isArray(req.body && req.body.people) ? req.body.people : [];
      const found = await findContacts({ companyName: staged.company_name, domain, people });

      await supabase.from('sourced_jobs_raw')
        .update({ contacts: found.contacts, company_domain: domain }).eq('id', staged.id);
      res.json(found);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
