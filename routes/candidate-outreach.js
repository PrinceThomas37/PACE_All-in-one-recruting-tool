'use strict';
// ============================================================================
// CANDIDATE OUTREACH — the API behind the Email page's Compose → Candidates side.
//
// Pick a job order we already own, see the candidate pool ranked against it,
// pick the people, queue the emails. The writing itself is in
// services/candidate-outreach.js (pure); this file is the database, the AI
// call, the queue and the drip.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. ONE AI CALL PER JOB, NOT PER CANDIDATE. The brief is written once and
//    cached on the job order (migration 042). See the note in the service.
//
// 2. THE BODY IS STORED WITH {{sender}} UNRENDERED. These emails are queued and
//    drained later, and the mailbox that ends up sending can differ from the
//    one that was current when the recruiter clicked. Every read goes through
//    renderStoredEmail(row, mailbox) — including the preview, which resolves
//    from the SELECTED SENDING MAILBOX and never from the logged-in session. A
//    preview keyed off the session user would have hidden the Session 14 bug
//    rather than caught it.
//
// 3. REGISTRATION ORDER. Literal paths sit above any :param route of the same
//    prefix. test/route-shadowing-smoke.mjs fails the build otherwise.
// ============================================================================

const express = require('express');
const aiProvider = require('../services/ai-provider');
const gen = require('../services/candidate-outreach');
const matchEngine = require('../match-engine');
const { emailSyntaxValid } = require('../email-validation');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('../email-tracking');
const { fillSignatureHtml } = require('../email-signature');
const { renderStoredEmail, senderIdentityFor } = require('../email-vars');

// The drip. One email per candidate every 75-105 seconds, jittered, so a batch
// of twenty does not arrive as twenty near-identical messages inside a minute —
// which is precisely the pattern that gets a sending domain flagged.
const DRIP_MIN_MS = 75 * 1000;
const DRIP_MAX_MS = 105 * 1000;

// How many due emails one heartbeat may send. The free tier's heartbeat is
// delivered every 3-5 hours in practice rather than every 30 minutes, so a tick
// can find a large backlog; this keeps one tick bounded rather than holding the
// process open for an hour.
const DRAIN_PER_TICK = 25;

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, today, withOrg, orgStamp, buildHtmlEmailBody, getMailboxSignature,
    loadSuppressedSet, recruiterSendingMailbox, sendMailboxNewMessage, connectedMailboxById,
    loadMailboxDelivState, warmupLimit, settingsConfig,
    isSendingPaused, isManagerPaused, getSendWindowHours, isInLeadSendWindow,
    getTimezoneFromLocation, friendlySendError, logActivity,
  } = ctx;

  const txt = (v) => String(v == null ? '' : v).trim();

  async function orgCompanyName(req) {
    try {
      if (!req.orgId) return 'our team';
      const { data } = await supabase.from('organizations').select('name').eq('id', req.orgId).maybeSingle();
      return (data && data.name) || 'our team';
    } catch (_) { return 'our team'; }
  }

  // The signature, filled from the MAILBOX — never from the session. Same rule
  // and the same helper shape as routes/outreach-generator.js.
  async function mailboxSignature(mailbox, userId) {
    if (!mailbox) return '';
    try {
      const raw = await getMailboxSignature(mailbox.id, userId);
      return fillSignatureHtml(raw, {
        displayName: mailbox.display_name || mailbox.email_address || '',
        emailAddress: mailbox.email_address || '',
      });
    } catch (_) { return ''; }
  }

  async function lastAiError(feature) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_last_error').maybeSingle();
      const rec = data && JSON.parse(data.value);
      const f = rec && rec.feature === feature && (rec.failures || [])[0];
      return f ? `${f.provider}/${f.model}: ${f.error}` : null;
    } catch (_) { return null; }
  }

  // ── WHICH JOB ────────────────────────────────────────────────────────────
  // Literal path, registered before anything with a :param under the same
  // prefix. Active jobs first: you do not cold-email candidates about a role
  // that is filled.
  router.get('/candidate-outreach/jobs', auth, async (req, res) => {
    try {
      const q = txt(req.query.q);
      let query = withOrg(supabase.from('job_orders')
        .select('id,job_code,job_title,client,city,state,country,status,positions,outreach_brief_at')
        .is('deleted_at', null), req);
      if (q) query = query.or(`job_title.ilike.%${q}%,client.ilike.%${q}%,job_code.ilike.%${q}%`);
      const { data } = await query.order('created_at', { ascending: false }).limit(40);
      const rows = (data || []).map(j => ({
        id: j.id, job_code: j.job_code, job_title: j.job_title, client: j.client || '',
        place: [j.city, j.state].filter(Boolean).join(', ') || j.country || '',
        status: j.status, positions: j.positions,
        has_brief: !!j.outreach_brief_at,
      }));
      // Active first, then everything else — both are returned, because a
      // recruiter chasing a role that just went on hold still needs it.
      rows.sort((a, b) => (a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // What is already queued or sent, so the page can show state without
  // guessing. Literal, so it goes above /candidate-outreach/:id-shaped routes.
  router.get('/candidate-outreach/queue', auth, async (req, res) => {
    try {
      let q = withOrg(supabase.from('candidate_outreach')
        .select('id,candidate_id,job_order_id,to_email,subject,status,send_after,sent_at,fail_reason,response,responded_at,angle,engine,track_token,candidates(full_name)')
        .eq('sent_by', req.user.id), req);
      const jobId = txt(req.query.job_order_id);
      if (jobId) q = q.eq('job_order_id', jobId);
      const { data } = await q.order('created_at', { ascending: false }).limit(100);
      res.json((data || []).map(r => ({
        id: r.id, candidate_id: r.candidate_id, job_order_id: r.job_order_id,
        name: (r.candidates && r.candidates.full_name) || '', to_email: r.to_email,
        subject: r.subject, status: r.status, send_after: r.send_after, sent_at: r.sent_at,
        fail_reason: r.fail_reason, response: r.response, responded_at: r.responded_at,
        angle: r.angle, engine: r.engine, track_token: r.track_token,
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Who this will send as, and whether an AI writer is available. The page must
  // be able to say "this will send from X" before anybody writes anything.
  router.get('/candidate-outreach/sender', auth, async (req, res) => {
    try {
      const [mailbox, companyName] = await Promise.all([
        recruiterSendingMailbox(req.user.id), orgCompanyName(req)
      ]);
      res.json({
        company_name: companyName,
        ai: await aiProvider.isAvailable(supabase),
        mailbox: mailbox ? {
          id: mailbox.id, email: mailbox.email_address,
          display_name: mailbox.display_name || null, platform: mailbox.platform || 'Microsoft',
        } : null,
        signature_html: await mailboxSignature(mailbox, req.user.id),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE RANKED POOL ──────────────────────────────────────────────────────
  // The same ranking the job-order page shows, returned with the outreach state
  // attached so the list can grey out anyone already emailed about this job.
  // Reuses match-engine directly rather than calling our own HTTP endpoint.
  router.get('/candidate-outreach/jobs/:id/candidates', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const q = txt(req.query.q).replace(/[,()]/g, ' ').trim();
      let query = withOrg(supabase.from('candidates')
        .select('id,candidate_code,full_name,email,current_title,current_location,city,state,skills,experience_years,applicant_status,last_contact_at')
        .is('deleted_at', null), req);
      if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,current_title.ilike.%${q}%`);
      const { data: pool } = await query.limit(2000);

      const ranked = matchEngine.rankCandidates(pool || [], job, {});

      // Who has already had this ask. The unique index refuses a duplicate at
      // insert time; showing it here means the recruiter never picks somebody
      // only to be told no afterwards.
      const { data: already } = await withOrg(supabase.from('candidate_outreach')
        .select('candidate_id,status,response,sent_at').eq('job_order_id', job.id), req);
      const seen = {};
      (already || []).forEach(r => { seen[r.candidate_id] = r; });

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      res.json({
        job_order: {
          id: job.id, job_code: job.job_code, job_title: job.job_title,
          client: job.client || '', place: [job.city, job.state].filter(Boolean).join(', ') || job.country || '',
        },
        // Surfaced so the page can say WHY scores look thin rather than leaving
        // the recruiter to wonder — a job with no skills scores on title and
        // location alone.
        scoreable: Boolean(txt(job.primary_skills) || txt(job.secondary_skills)),
        pool_size: (pool || []).length,
        results: ranked.slice(0, limit).map(r => {
          const c = r.candidate || {};
          const prior = seen[c.id] || null;
          return {
            candidate_id: c.id, name: c.full_name, email: c.email || '',
            title: c.current_title || '', location: c.current_location || [c.city, c.state].filter(Boolean).join(', '),
            experience_years: c.experience_years, applicant_status: c.applicant_status || '',
            score: r.score, band: r.band, reasons: r.reasons || [],
            // No email address means no outreach. Said plainly here so the row
            // can explain itself instead of silently failing at queue time.
            emailable: !!(c.email && emailSyntaxValid(c.email)),
            prior: prior ? { status: prior.status, response: prior.response, sent_at: prior.sent_at } : null,
          };
        }),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE JOB BRIEF — ONE AI CALL, REUSED BY EVERY CANDIDATE ───────────────
  router.get('/candidate-outreach/jobs/:id/brief', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });
      const cached = txt(job.outreach_brief);
      if (cached) {
        let parsed = null;
        try { parsed = JSON.parse(cached); } catch (_) { /* fall through to rules */ }
        if (parsed && txt(parsed.hook)) {
          return res.json({ ...parsed, engine: job.outreach_brief_engine || 'rules', written_at: job.outreach_brief_at, cached: true });
        }
      }
      res.json({ ...gen.rulesJobBrief(job), cached: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/candidate-outreach/jobs/:id/brief', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const rules = gen.rulesJobBrief(job);
      const store = async (brief) => {
        try {
          await supabase.from('job_orders').update({
            outreach_brief: JSON.stringify({ hook: brief.hook, detail: brief.detail }),
            outreach_brief_at: new Date(),
            outreach_brief_engine: brief.engine,
          }).eq('id', job.id);
        } catch (_) { /* caching is a saving, never the point of the request */ }
      };

      if (!(await aiProvider.isAvailable(supabase))) {
        await store(rules);
        return res.json({ ...rules, ai_available: false });
      }

      const system = gen.buildBriefSystemPrompt();
      const ask = (prompt) => aiProvider.complete(supabase, {
        maxTokens: 500, feature: 'candidate_brief', orgId: req.orgId, system, prompt,
      });

      // The job description is the one uncapped input here — a pasted or
      // imported JD can be enormous. Trim the AI's copy; the rules writer still
      // reads the fields, which is where the facts it uses actually live.
      const payload = aiProvider.budget.trimToTokens(gen.buildBriefPayload(job), 2200);
      const out = await ask(payload);
      if (!out) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'ai_unavailable', ai_error_detail: await lastAiError('candidate_brief') });
      }
      const parsed = gen.parseBrief(out.text);
      if (!parsed) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'ai_unparseable' });
      }
      // A brief is written once and then read by every candidate on this job, so
      // it is checked once here rather than 25 times downstream. No repair turn:
      // a second call per job is affordable, but the rules brief is a genuinely
      // good answer and this is not prose a prospect judges us on.
      const check = gen.checkBrief(parsed, job);
      if (!check.ok) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'brief_rejected', violations: check.violations });
      }
      await store(parsed);
      res.json({ ...parsed, ai_available: true, engine_model: out.model, engine_provider: out.provider });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  // Every angle for ONE candidate, rendered as the recipient will see it. The
  // {{sender}} tokens are resolved here from the mailbox that will actually
  // send — never from req.user — so what is on screen is what goes out.
  router.post('/candidate-outreach/preview', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const candidateId = txt(b.candidate_id);
      if (!candidateId) return res.status(400).json({ error: 'candidate_id is required.' });

      const { data: candidate } = await withOrg(supabase.from('candidates')
        .select('id,full_name,first_name,email,current_title,current_location,city,state,skills,experience_years')
        .eq('id', candidateId).is('deleted_at', null), req).maybeSingle();
      if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

      let job = null;
      const jobId = txt(b.job_order_id);
      if (jobId) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', jobId).is('deleted_at', null), req).maybeSingle();
        if (!data) return res.status(404).json({ error: 'Job order not found' });
        job = data;
      }

      const [mailbox, companyName] = await Promise.all([
        recruiterSendingMailbox(req.user.id), orgCompanyName(req)
      ]);
      const signatureHtml = await mailboxSignature(mailbox, req.user.id);
      const input = {
        candidate, job,
        reasons: job ? (matchEngine.rankCandidates([candidate], job, {})[0] || {}).reasons || [] : [],
        outreach_type: job ? 'job' : 'nurture',
      };
      const check = gen.validateInput(input);
      if (!check.ok) return res.status(400).json({ error: 'Missing: ' + check.missing.join(', ') + '.' });

      const opts = { companyName, omitSignOff: !!signatureHtml.trim() };
      const variants = gen.rulesVariants(input, opts).map(v => {
        const q = gen.checkCandidateDraft(v, input, { angle: v.id, omitSignOff: opts.omitSignOff });
        const shown = renderStoredEmail({ subject: v.subject, body: v.email }, mailbox);
        return {
          ...v,
          // Stored form (tokens intact) and shown form (tokens resolved from the
          // sending mailbox) travel together. The page previews `preview_*` and
          // queues nothing — the server rebuilds the stored form at queue time.
          preview_subject: shown.subject, preview_email: shown.body,
          quality: { ok: q.ok, violations: q.violations },
        };
      });

      res.json({
        candidate: { id: candidate.id, name: candidate.full_name, email: candidate.email },
        job_order: job ? { id: job.id, job_title: job.job_title, client: job.client || '' } : null,
        sends_as: mailbox ? mailbox.email_address : null,
        signature_html: signatureHtml,
        variants,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── QUEUE ────────────────────────────────────────────────────────────────
  // Many candidates, one job, one angle. Nothing sends here: every row lands
  // `pending` with its own send_after, and the heartbeat drains what is due.
  router.post('/candidate-outreach/queue', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.candidate_ids) ? b.candidate_ids.map(txt).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: 'Pick at least one candidate.' });
      if (ids.length > 200) return res.status(400).json({ error: 'That is more than 200 people in one go. Split it up.' });

      const angle = txt(b.angle) || 'direct';
      const mailbox = await recruiterSendingMailbox(req.user.id);
      if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });

      let job = null;
      const jobId = txt(b.job_order_id);
      if (jobId) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', jobId).is('deleted_at', null), req).maybeSingle();
        if (!data) return res.status(404).json({ error: 'Job order not found' });
        job = data;
      }
      if (!gen.angleBrief(angle)) return res.status(400).json({ error: 'Unknown angle.' });
      if (!job && angle !== 'nurture') return res.status(400).json({ error: 'That angle needs a job. Pick one, or use "Keeping in touch".' });

      const { data: candidates } = await withOrg(supabase.from('candidates')
        .select('id,full_name,first_name,email,current_title,current_location,city,state,skills,experience_years')
        .in('id', ids).is('deleted_at', null), req);

      const companyName = await orgCompanyName(req);
      const signatureHtml = await mailboxSignature(mailbox, req.user.id);
      const opts = { companyName, omitSignOff: !!signatureHtml.trim() };

      // Cached brief, read once for the whole batch — the entire reason this
      // feature is affordable.
      let brief = job ? gen.rulesJobBrief(job) : null;
      if (job && txt(job.outreach_brief)) {
        try {
          const p = JSON.parse(job.outreach_brief);
          if (p && txt(p.hook)) brief = { hook: p.hook, detail: p.detail, engine: job.outreach_brief_engine || 'rules' };
        } catch (_) { /* keep the rules brief */ }
      }

      const suppressed = await loadSuppressedSet((candidates || []).map(c => c.email).filter(Boolean));
      const ranked = job ? matchEngine.rankCandidates(candidates || [], job, {}) : [];
      const reasonsFor = {};
      ranked.forEach(r => { reasonsFor[r.candidate_id] = r.reasons || []; });

      const org = orgStamp(req);
      const rows = [];
      const skipped = [];
      let offset = 0;
      for (const c of (candidates || [])) {
        const to = txt(c.email);
        if (!to || !emailSyntaxValid(to)) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'no_valid_email' }); continue; }
        if (suppressed.has(to.toLowerCase())) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'opted_out' }); continue; }

        const input = { candidate: c, job, brief, reasons: reasonsFor[c.id] || [], outreach_type: job ? 'job' : 'nurture' };
        const variant = gen.rulesVariants(input, opts).find(v => v.id === angle);
        if (!variant) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'angle_not_applicable' }); continue; }

        // The house check runs on every queued email, not just the previewed
        // one. A batch is where a bad draft does real damage, and the recruiter
        // only ever looked at one of them.
        const q = gen.checkCandidateDraft(variant, input, { angle, omitSignOff: opts.omitSignOff });
        if (!q.ok) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'failed_check', detail: q.violations.map(x => x.code).join(', ') }); continue; }

        // Each row carries its own due time. Jittered rather than exactly 90s
        // apart, because a perfectly regular cadence is itself a signature.
        offset += DRIP_MIN_MS + Math.floor(Math.random() * (DRIP_MAX_MS - DRIP_MIN_MS));
        rows.push(Object.assign({
          candidate_id: c.id,
          job_order_id: job ? job.id : null,
          sent_by: req.user.id,
          mailbox_id: mailbox.id,
          to_email: to,
          subject: variant.subject,
          // STORED WITH {{sender}} INTACT — see the file header.
          body: variant.email,
          angle,
          engine: (brief && brief.engine) || 'rules',
          status: 'pending',
          send_after: new Date(Date.now() + offset),
        }, org));
      }

      if (!rows.length) return res.status(400).json({ error: 'Nothing could be queued.', skipped });

      // The unique index refuses anyone already asked about this job. Insert
      // one at a time so one duplicate does not lose the other twenty-four —
      // a batch insert is all-or-nothing and the whole point of the guard is
      // that hitting it should be harmless.
      const queued = [];
      for (const row of rows) {
        const { data, error } = await supabase.from('candidate_outreach').insert(row).select('id,candidate_id,send_after').single();
        if (error) {
          skipped.push({ candidate_id: row.candidate_id, reason: /duplicate|unique/i.test(error.message) ? 'already_asked' : error.message });
          continue;
        }
        queued.push(data);
      }

      // Add to the job's pipeline — ONLY if asked. Emailing somebody is not the
      // same as working them, and a board that fills with people who never
      // answered stops being worth looking at. The owner chose this default.
      let pipeline = null;
      if (job && b.add_to_pipeline && queued.length) {
        pipeline = { added: 0, existing: 0, failed: 0 };
        for (const row of queued) {
          try {
            const { data: existing } = await withOrg(supabase.from('submissions')
              .select('id').eq('candidate_id', row.candidate_id).eq('job_order_id', job.id)
              .is('deleted_at', null), req).maybeSingle();
            if (existing) {
              await supabase.from('candidate_outreach').update({ submission_id: existing.id }).eq('id', row.id);
              pipeline.existing++;
              continue;
            }
            const { data: made, error } = await supabase.from('submissions').insert(Object.assign({
              candidate_id: row.candidate_id, job_order_id: job.id,
              recruiter_id: req.user.id, stage: 'Sourced',
              notes: 'Added when candidate outreach was queued.',
            }, org)).select('id').single();
            if (error) throw error;
            await supabase.from('candidate_outreach').update({ submission_id: made.id }).eq('id', row.id);
            pipeline.added++;
          } catch (_) {
            // A pipeline failure must never report the queued email as failed —
            // the email is the deliverable and it is already queued.
            pipeline.failed++;
          }
        }
      }

      try {
        if (logActivity && job) await logActivity(null, null, req.user.id, 'candidate_outreach_queued',
          `${queued.length} candidate email(s) queued for ${job.job_title}`);
      } catch (_) { /* audit is best-effort */ }

      res.status(201).json({
        queued: queued.length,
        skipped,
        pipeline,
        mailbox: mailbox.email_address,
        // What the page tells the user, computed here so the two cannot drift.
        first_at: queued.length ? queued[0].send_after : null,
        last_at: queued.length ? queued[queued.length - 1].send_after : null,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Pull one back before it goes. Only your own, and only while still pending.
  router.post('/candidate-outreach/cancel/:id', auth, async (req, res) => {
    try {
      const { data: row } = await withOrg(supabase.from('candidate_outreach')
        .select('id,status,sent_by').eq('id', req.params.id), req).maybeSingle();
      // 404 rather than 403 for someone else's row: an id must not be probeable.
      if (!row || row.sent_by !== req.user.id) return res.status(404).json({ error: 'Not found' });
      if (row.status !== 'pending') return res.status(409).json({ error: 'That one has already gone out.' });
      await supabase.from('candidate_outreach')
        .update({ status: 'skipped', fail_reason: 'cancelled by sender' }).eq('id', row.id);
      res.json({ cancelled: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE DRAIN ────────────────────────────────────────────────────────────
  // Called by the heartbeat, not by a request. Sends what is due, applying the
  // same gates the lead send loop applies — pause, send window, daily cap,
  // warm-up ramp, mailbox auto-pause, suppression. A candidate email that
  // ignored those would burn the same domain the cold email depends on.
  async function drainDueOutreach(limit = DRAIN_PER_TICK) {
    if (isSendingPaused && isSendingPaused()) return { sent: 0, skipped: 0, reason: 'paused' };

    const { data: due } = await supabase.from('candidate_outreach')
      .select('*')
      .eq('status', 'pending')
      .lte('send_after', new Date().toISOString())
      .order('send_after', { ascending: true })
      .limit(limit);
    if (!due || !due.length) return { sent: 0, skipped: 0, failed: 0 };

    const window = await getSendWindowHours();
    const suppressed = await loadSuppressedSet(due.map(r => r.to_email).filter(Boolean));
    const delivState = await loadMailboxDelivState([...new Set(due.map(r => r.mailbox_id).filter(Boolean))]);
    const [warmupStart, warmupStep] = await Promise.all([
      settingsConfig.getSetting(supabase, 'mailbox_warmup_start'),
      settingsConfig.getSetting(supabase, 'mailbox_warmup_step'),
    ]);

    let sent = 0, skipped = 0, failed = 0, deferred = 0;
    const sentToday = {};

    for (const row of due) {
      try {
        if (isManagerPaused && isManagerPaused(row.sent_by)) { deferred++; continue; }
        if (suppressed.has(String(row.to_email || '').toLowerCase())) {
          await supabase.from('candidate_outreach')
            .update({ status: 'skipped', fail_reason: 'recipient opted out' }).eq('id', row.id);
          skipped++; continue;
        }

        const mailbox = row.mailbox_id ? await connectedMailboxById(row.mailbox_id) : null;
        if (!mailbox) { deferred++; continue; }
        if (mailbox.is_active === false) { deferred++; continue; }
        if (delivState[mailbox.id] && delivState[mailbox.id].auto_paused_at) { deferred++; continue; }

        // The candidate's own working hours, not ours. Same treatment the lead
        // engine gives a prospect — an email landing at 3am is a deleted email.
        const { data: cand } = await supabase.from('candidates')
          .select('id,current_location,city,state').eq('id', row.candidate_id).maybeSingle();
        const tz = getTimezoneFromLocation(
          (cand && (cand.current_location || [cand.city, cand.state].filter(Boolean).join(', '))) || ''
        );
        if (!isInLeadSendWindow(tz, new Date(), window)) { deferred++; continue; }

        // Daily cap and warm-up ramp, counted per mailbox across this tick.
        if (sentToday[mailbox.id] === undefined) {
          const { data: log } = await supabase.from('email_send_log')
            .select('emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
          sentToday[mailbox.id] = (log && log.emails_sent) || 0;
        }
        const base = mailbox.daily_send_limit || 150;
        const wl = warmupLimit(delivState[mailbox.id], warmupStart, warmupStep);
        const cap = wl ? Math.min(base, wl) : base;
        if (sentToday[mailbox.id] >= cap) { deferred++; continue; }

        // THE SENDER IS RESOLVED HERE, FROM THE MAILBOX THAT IS ACTUALLY
        // SENDING — the whole reason the body was stored with the token in it.
        const rendered = renderStoredEmail(row, mailbox);
        const signature = await mailboxSignature(mailbox, row.sent_by);
        const token = row.track_token || newTrackToken();
        const htmlBody = injectTrackPixel(buildHtmlEmailBody(rendered.body, signature), token);

        await sendMailboxNewMessage(mailbox, { to: row.to_email, subject: rendered.subject, htmlBody });

        await supabase.from('candidate_outreach').update({
          status: 'sent', sent_at: new Date(), track_token: token,
        }).eq('id', row.id);

        // Tracking must never fail a send that has already gone out.
        try {
          await supabase.from('email_tracking').insert({
            token, channel: 'candidate_outreach',
            candidate_id: row.candidate_id, job_order_id: row.job_order_id,
            to_email: row.to_email, subject: rendered.subject,
            sent_by: row.sent_by, mailbox_email: mailbox.email_address || null,
            ...(row.org_id ? { org_id: row.org_id } : {}),
          });
        } catch (_) { /* the send is what matters */ }

        sentToday[mailbox.id] += 1;
        await supabase.from('email_send_log').upsert(
          { user_email_id: mailbox.id, send_date: today(), emails_sent: sentToday[mailbox.id] },
          { onConflict: 'user_email_id,send_date' }
        );
        try { await supabase.from('candidates').update({ last_contact_at: new Date() }).eq('id', row.candidate_id); } catch (_) {}
        sent++;
      } catch (e) {
        // The failure reason is WRITTEN DOWN. On the lead side an auth failure
        // marks emails failed with nowhere to record why, so the one useful
        // sentence dies with the process (CLAUDE.md, "KNOWN, UNFIXED"). This
        // table has a column for it, so use it.
        try {
          await supabase.from('candidate_outreach').update({
            status: 'failed',
            fail_reason: (friendlySendError ? friendlySendError(e.message) : e.message || 'Send failed').slice(0, 500),
          }).eq('id', row.id);
        } catch (_) {}
        failed++;
      }
    }
    return { sent, skipped, failed, deferred };
  }

  return { router, drainDueOutreach };
};
