// ============================================================================
// NEXT ACTIONS — "what should I do today", as one ranked list.
// Step 4 of docs/AUTONOMOUS_ENGINE_PLAN.md. Mounted from index.js.
//
// This endpoint assembles the data; the ranking lives in next-action.js and the
// thread reading in conversation-intel.js, both of which are pure and tested
// separately. Everything here is I/O.
//
// SCOPING: a user sees their own work plus everyone under them on the reporting
// hierarchy (users.manager_id), exactly like /reports/recruiting — a BD sees
// their own, a BD Lead sees their team's, admin sees the org. Getting this wrong
// would put one person's follow-ups on another person's to-do list.
//
// DEGRADES BY DESIGN: conversation_messages arrives with migration 037. Until it
// is applied, threads fall back to what already exists (contacts.replied_at +
// reply_snippet + the emails table), so the queue is thinner but still correct
// and still useful. It never errors because a table is missing.
// ============================================================================
const express = require('express');
const { buildNextActions, summarize } = require('../next-action');
const entitlements = require('../services/entitlements');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, orgIdFor, withOrg } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  const MAX_THREAD_PEOPLE = 300;   // bounded so one big org can't stall the request

  router.get('/next-actions', auth, async (req, res) => {
    try {
      // Reading conversations and ranking them is the differentiator, so it is
      // where the paid tiers start. An empty queue with a reason beats a 402
      // here: this is a dashboard widget, and a card that explains itself is
      // better than one that renders an error.
      const feature = await entitlements.featureGate(supabase, req, 'conversation_intel', { orgIdFor });
      if (feature.blocked) {
        return res.json({ items: [], summary: summarize([]), scope: 'none', locked: feature.body });
      }

      const org = orgIdFor(req);
      const isAdmin = (req.user.roles || []).includes('admin') || req.user.role === 'admin';
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, org);
      const scope = isAdmin ? 'org' : (chain && chain.length > 1 ? 'team' : 'own');

      // ── Leads side: contacts on jobs owned by the caller (or their chain) ──
      let jobQ = withOrg(supabase.from('jobs').select('id,position,assigned_to_bd,company:companies(name)'), req);
      if (!isAdmin && chain) jobQ = jobQ.in('assigned_to_bd', chain);
      const { data: jobs } = await jobQ.limit(MAX_THREAD_PEOPLE);
      const jobById = new Map((jobs || []).map(j => [j.id, j]));

      let contacts = [];
      if (jobById.size) {
        const { data } = await withOrg(
          supabase.from('contacts')
            .select('id,first_name,last_name,email,job_id,replied_at,reply_snippet,created_at')
            .in('job_id', [...jobById.keys()]),
          req
        ).limit(MAX_THREAD_PEOPLE);
        contacts = data || [];
      }

      // ── The stored conversation, when it exists ───────────────────────────
      // Guarded: migration 037 may not be applied. A missing table means an
      // empty map, not a failed request.
      const msgsByContact = new Map();
      if (contacts.length) {
        try {
          const { data: msgs, error } = await supabase.from('conversation_messages')
            .select('contact_id,direction,body,sent_at')
            .in('contact_id', contacts.map(c => c.id))
            .order('sent_at', { ascending: true })
            .limit(2000);
          if (!error) {
            for (const m of (msgs || [])) {
              if (!m.contact_id) continue;
              if (!msgsByContact.has(m.contact_id)) msgsByContact.set(m.contact_id, []);
              msgsByContact.get(m.contact_id).push(m);
            }
          }
        } catch (_) { /* table not there yet — fall back below */ }
      }

      // Outbound sends we already record, so a thread has both sides even
      // before 037 is applied.
      const sentByContact = new Map();
      if (contacts.length) {
        try {
          const { data: sent } = await withOrg(
            supabase.from('emails').select('contact_id,sent_at,created_at,subject')
              .in('contact_id', contacts.map(c => c.id)).eq('status', 'sent'),
            req
          ).limit(2000);
          for (const e of (sent || [])) {
            if (!e.contact_id) continue;
            if (!sentByContact.has(e.contact_id)) sentByContact.set(e.contact_id, []);
            sentByContact.get(e.contact_id).push(e);
          }
        } catch (_) { /* best effort */ }
      }

      const threads = contacts.map(c => {
        const job = jobById.get(c.job_id);
        const stored = msgsByContact.get(c.id) || [];
        const messages = stored.length ? stored.slice() : [];

        if (!stored.length) {
          // Fallback shape from what already exists: the sends we logged, plus
          // the single reply snippet the old sweep kept. Thin, but honest.
          for (const e of (sentByContact.get(c.id) || [])) {
            messages.push({ direction: 'outbound', sent_at: e.sent_at || e.created_at, body: e.subject || '' });
          }
          if (c.replied_at) {
            messages.push({ direction: 'inbound', sent_at: c.replied_at, body: c.reply_snippet || '' });
          }
        }

        return {
          entity_type: 'contact',
          entity_id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
          email: c.email,
          company: job?.company?.name || null,
          job_id: c.job_id,
          owner_id: job?.assigned_to_bd || null,
          messages,
        };
      });

      // ── Candidates side: submissions the caller (or their chain) owns ─────
      // Mirrors the contacts block above. Before this, /next-actions only ever
      // looked at BD leads — a recruiter's own candidate conversations never
      // appeared in "needs you today" at all, even though conversation-intel.js
      // and next-action.js were always entity-type-agnostic.
      let subQ = withOrg(
        supabase.from('submissions')
          .select('id,candidate_id,job_order_id,recruiter_id,stage,candidate:candidates(id,full_name,email,last_reply_at),job_order:job_orders(job_title,client)')
          .is('deleted_at', null),
        req
      );
      if (!isAdmin && chain) subQ = subQ.in('recruiter_id', chain);
      const { data: subs } = await subQ.limit(MAX_THREAD_PEOPLE);
      const candIds = [...new Set((subs || []).map(s => s.candidate_id).filter(Boolean))];

      const msgsByCandidate = new Map();
      if (candIds.length) {
        try {
          const { data: msgs, error } = await supabase.from('conversation_messages')
            .select('candidate_id,direction,body,sent_at')
            .in('candidate_id', candIds)
            .order('sent_at', { ascending: true })
            .limit(2000);
          if (!error) {
            for (const m of (msgs || [])) {
              if (!m.candidate_id) continue;
              if (!msgsByCandidate.has(m.candidate_id)) msgsByCandidate.set(m.candidate_id, []);
              msgsByCandidate.get(m.candidate_id).push(m);
            }
          }
        } catch (_) { /* table not there yet — fall back below */ }
      }

      // Outbound sends already recorded via the tracked-send path
      // (POST /candidates/email, interview invites) so a thread has both sides
      // even before 037 is applied.
      const sentByCandidate = new Map();
      if (candIds.length) {
        try {
          const { data: sent } = await withOrg(
            supabase.from('email_tracking').select('candidate_id,sent_at,subject')
              .in('candidate_id', candIds),
            req
          ).limit(2000);
          for (const e of (sent || [])) {
            if (!e.candidate_id) continue;
            if (!sentByCandidate.has(e.candidate_id)) sentByCandidate.set(e.candidate_id, []);
            sentByCandidate.get(e.candidate_id).push(e);
          }
        } catch (_) { /* best effort */ }
      }

      for (const s of (subs || [])) {
        const cand = s.candidate;
        if (!cand) continue;
        const stored = msgsByCandidate.get(cand.id) || [];
        const messages = stored.length ? stored.slice() : [];

        if (!stored.length) {
          // Thinner fallback, same shape as the contacts one: the sends we
          // logged via email_tracking, plus the single last-reply timestamp
          // candidates.last_reply_at keeps (no snippet text exists for
          // candidates today, unlike contacts.reply_snippet — so this message
          // carries timing but an empty body, which is enough for the "waiting
          // on you" / staleness signals even though intent classification
          // degrades to none until 037 is applied and real bodies are stored).
          for (const e of (sentByCandidate.get(cand.id) || [])) {
            messages.push({ direction: 'outbound', sent_at: e.sent_at, body: e.subject || '' });
          }
          if (cand.last_reply_at) {
            messages.push({ direction: 'inbound', sent_at: cand.last_reply_at, body: '' });
          }
        }

        threads.push({
          entity_type: 'candidate',
          entity_id: cand.id,
          name: cand.full_name || cand.email,
          email: cand.email,
          company: s.job_order?.client || s.job_order?.job_title || null,
          job_id: s.job_order_id,
          owner_id: s.recruiter_id || null,
          stage: s.stage,
          messages,
        });
      }

      // ── Reminders: created for years, never surfaced anywhere ─────────────
      let remQ = withOrg(
        supabase.from('reminders')
          .select('id,user_id,return_date,note,contact_name,company_name,contact_id,job_id,status')
          .eq('status', 'pending'),
        req
      );
      if (!isAdmin && chain) remQ = remQ.in('user_id', chain);
      const { data: reminders } = await remQ.limit(200);

      const items = buildNextActions({
        threads,
        reminders: reminders || [],
        now: Date.now(),
        limit: Number(req.query.limit) || 50,
      });

      res.json({
        items,
        summary: summarize(items),
        scope,
        conversation_storage: msgsByContact.size > 0,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dismissing an item just resolves the reminder behind it, where there is one.
  // Conversation-driven items are not dismissible on purpose: they disappear
  // when the underlying fact changes (you reply, they opt out), which keeps the
  // queue honest rather than something you can clear without doing the work.
  router.post('/next-actions/:reminderId/done', auth, async (req, res) => {
    try {
      const q = withOrg(
        supabase.from('reminders').update({ status: 'sent', updated_at: new Date() })
          .eq('id', req.params.reminderId),
        req
      );
      const { error } = await q.eq('user_id', req.user.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
