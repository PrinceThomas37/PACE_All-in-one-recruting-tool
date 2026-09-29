// ============================================================================
// NEXT ACTIONS — "what should I do today", as one ranked list.
// Step 4 of docs/AUTONOMOUS_ENGINE_PLAN.md. Mounted from index.js.
//
// This endpoint assembles the data; the ranking lives in next-action.js and the
// thread reading in conversation-intel.js, both of which are pure and tested
// separately. Everything here is I/O.
//
// SCOPING (rewritten Session 24, D-0020): the LIST is strictly the caller's OWN
// work. It used to be scoped by the reporting chain, which put one person's
// follow-ups on another person's to-do list — exactly the thing the old comment
// here said must not happen, while the code did it.
//
// A manager still needs oversight, so the response also carries a `team` block:
// a COUNT of what is open beneath them, reviewable through /next-actions/team,
// where they can PROMPT the owner (POST /next-actions/:reminderId/prompt).
// They cannot close somebody else's task. Ownership is defined once, in
// services/ownership.js — read that file before changing any scoping here.
//
// ADMINS INCLUDED (R-071, 2026-09-29). Admins used to be exempt from the split,
// so an admin's list carried EVERY user's reminders, each with a Done button
// that closeRefusal() correctly refuses — "This reminder belongs to somebody
// else…", and the row stayed. The owner reported it as "Once the reminders are
// complete it doesn't go off from the dashboard". D-0020 has no admin
// exception for the to-do list ("nobody else's daily list carries your work");
// D-0021's admin exception is about the BRIEFING, and D-0034's is about SEEING.
// What an admin gets that a manager does not is BREADTH OF OVERSIGHT: their
// count and review cover the whole organisation, because the company is their
// desk — whether or not anybody reports to them on manager_id.
//
// THE COUNT AND THE REVIEW ARE ONE READ (`openBeneath`). The count used to be
// built from the list's own items — replies, nudges and promises included —
// while the review screen behind it can only show (and prompt on) reminders, so
// "14 open across your team" opened onto 3 rows. D-0020: "on that screen they
// can see the item". Your team's CONVERSATIONS have their own home in the
// client digest (routes/client-intel.js), which is built for that.
//
// DEGRADES BY DESIGN: conversation_messages arrives with migration 037. Until it
// is applied, threads fall back to what already exists (contacts.replied_at +
// reply_snippet + the emails table), so the queue is thinner but still correct
// and still useful. It never errors because a table is missing.
// ============================================================================
const express = require('express');
const { buildNextActions, summarize } = require('../next-action');
const entitlements = require('../services/entitlements');
const dismissals = require('../services/next-action-dismissals');
const ownership = require('../services/ownership');
const { fillTemplate, buildEmailVars } = require('../email-vars');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, orgIdFor, withOrg, today } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  const MAX_THREAD_PEOPLE = 300;   // bounded so one big org can't stall the request

  // Display names for the owners of a set of items. A count with nobody named
  // ("7 open across your team" — whose?) sends a manager hunting; naming
  // everybody is a list again. One query, names only.
  async function namesFor(req, items) {
    const ids = [...new Set((items || []).map(i => i.owner_id).filter(Boolean))];
    if (!ids.length) return {};
    const { data } = await withOrg(supabase.from('users').select('id,name'), req).in('id', ids);
    const out = {};
    (data || []).forEach(u => { out[u.id] = u.name; });
    return out;
  }

  // Admin is read EXACTLY the way middleware/authorize.js hasRole reads it
  // (ownership.rolesOf), because here it decides whose work a person may review
  // and prompt — a boundary is read one way or it is two boundaries.
  const isAdminReq = (req) => ownership.rolesOf(req.user || {}).includes('admin');

  // WHAT THE VIEWER OVERSEES — never what is on their own list.
  //   admin     → the whole organisation (`others: null`), reports or not
  //   everyone  → their reporting chain minus themselves (hierarchy.js, the
  //               one breadth-first walk in PACE)
  async function oversight(req) {
    if (isAdminReq(req)) return { isAdmin: true, others: null, label: 'org' };
    const chain = await reportingChainIds(req.user.id, orgIdFor(req));
    const others = (chain || []).filter(id => id !== req.user.id);
    return { isAdmin: false, others, label: others.length ? 'team' : 'own' };
  }

  // The team's OPEN reminders. The ONLY reader behind both the count on the
  // daily list and the review screen, so the two can never disagree about how
  // many there are: same filters, same order, same limit — only the columns
  // differ. `null` means there is nobody beneath the viewer.
  //
  // A reminder NOBODY owns is dropped here explicitly: it is nobody's team's
  // work (it sits on an admin's OWN list, where Done closes it), and "Ask
  // them" on it has nobody to ask. SQL's `<>` already skips a NULL owner, but
  // a rule that holds only by NULL semantics is one a test double disagrees
  // with — which is exactly how this line was found.
  const TEAM_LIMIT = 200;
  async function openBeneath(req, view, columns) {
    if (!view.isAdmin && !view.others.length) return null;
    let q = withOrg(supabase.from('reminders').select(columns).eq('status', 'pending'), req);
    q = view.isAdmin ? q.neq('user_id', req.user.id) : q.in('user_id', view.others);
    const { data } = await q.order('return_date').limit(TEAM_LIMIT);
    return (data || []).filter(r => r.user_id);
  }

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

      const me = req.user.id;
      const view = await oversight(req);
      const isAdmin = view.isAdmin;
      // `scope` names what the TEAM block covers; the LIST is always the
      // caller's own. Same vocabulary as before: 'org' | 'team' | 'own'.
      const scope = view.label;

      // ── THE LIST IS WHAT YOU OWN (D-0020) — admin included ────────────────
      // Everyone but admin is narrowed IN SQL to their own rows, so every
      // .limit() below is spent on work that can reach their list. Admin reads
      // the org as before and is narrowed in code (below, before ranking) to
      // their own rows PLUS the unowned ones — ownership.js hands an item nobody
      // owns to the viewer, and admin is the one role whose fetch contains them
      // (a reply on an Unassigned-pool lead must be on SOMEBODY's list). An
      // `.or(eq,is.null)` would narrow admin in SQL too, but nothing in this
      // sandbox can run PostgREST, and that filter failing reads as an empty,
      // perfectly plausible "Nothing waiting on you" (CLAUDE.md, Session 28).
      //
      // ── Leads side: contacts on jobs the caller owns ──────────────────────
      let jobQ = withOrg(supabase.from('jobs').select('id,position,stage,assigned_to_bd,company:companies(name)'), req);
      if (!isAdmin) jobQ = jobQ.eq('assigned_to_bd', me);
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
          stage: job?.stage || null,
          messages,
        };
      });

      // ── Candidates side: submissions the caller owns ──────────────────────
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
      if (!isAdmin) subQ = subQ.eq('recruiter_id', me);
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

      // ── Reminders: the caller's own ───────────────────────────────────────
      // The TEAM COUNT no longer comes from these rows — it is `openBeneath`,
      // the same read the review screen makes.
      //
      // The job and contact come along so the stored note can be RENDERED. That
      // note carries merge fields written in the recruiting vocabulary
      // ({{first_name}}, {{position}}) against the sales one, so every task the
      // default sequence ever made reads "Hi {{first_name}}, I emailed you about
      // the {{position}} role at KB Home". GET /reminders was fixed to render on
      // read; THIS path was missed, which is why the raw tokens stayed visible on
      // the dashboard. One fix, two readers — see email-vars.js VAR_SYNONYMS.
      let remQ = withOrg(
        supabase.from('reminders')
          .select('id,user_id,return_date,note,contact_name,company_name,contact_id,job_id,status,'
            + 'job:jobs(id,position,location,industry,company:companies(name,industry,location)),'
            + 'contact:contacts(id,first_name,last_name,designation)')
          .eq('status', 'pending'),
        req
      );
      if (!isAdmin) remQ = remQ.eq('user_id', me);
      const { data: remRows } = await remQ.limit(200);

      // NARROWED BEFORE RANKING, not after. The ranking keeps the top `limit`
      // and counts the stale nudges and the overflow; done on the whole org it
      // let colleagues' items push an admin's own off the end — "Nothing
      // waiting on you" over a due reminder of their own — and put the org's
      // "gone quiet" count and "N more" under the admin's personal list.
      const ownThreads = threads.filter(t => ownership.isMine(t, me));
      const ownRemRows = (remRows || []).filter(r => ownership.isMine({ owner_id: r.user_id }, me));

      const reminders = ownRemRows.map(r => {
        if (!r.note) return r;
        const vars = r.job
          ? buildEmailVars({ job: r.job, contact: r.contact, senderDisplayName: req.user.name || '' })
          : { fn: (r.contact && r.contact.first_name) || '', company: r.company_name || '', sender: req.user.name || '' };
        return { ...r, note: fillTemplate(r.note, vars) };
      });

      const now = Date.now();
      const built = buildNextActions({
        threads: ownThreads,
        reminders: reminders || [],
        now,
        limit: Number(req.query.limit) || 50,
      });

      // What this user has snoozed. Best-effort: a dismissal store that cannot
      // be read must never take down the queue it is meant to tidy — the user
      // then sees a slightly noisier list, which is the safe direction.
      let store = {};
      try {
        const { data } = await supabase.from('app_settings').select('value')
          .eq('key', dismissals.settingsKey(req.user.id)).maybeSingle();
        if (data && data.value) {
          store = dismissals.prune(
            typeof data.value === 'string' ? JSON.parse(data.value) : data.value, now);
        }
      } catch (_) { store = {}; }

      const after = dismissals.applyDismissals(built, store, now);

      // ── OWNERSHIP (D-0020) — for EVERY role, admin included ───────────────
      // The list is what the caller OWNS. The inputs were narrowed above; this
      // split runs on the OUTPUT and is the guarantee — a future change to a
      // fetch cannot put somebody else's row, and its refusable Done button,
      // back on this list. Anything it holds back is dropped, never shown.
      // (Admin used to be exempt here: "the whole org is their desk, so nothing
      // is somebody else's to them". The Done button disagreed — see header.)
      const { mine } = ownership.splitByOwner(after.items, req.user.id);

      // What is open beneath the caller: a COUNT, from the very rows the review
      // screen lists. For an admin that is the whole organisation.
      const beneath = await openBeneath(req, view, 'id,user_id');
      const team = (beneath || []).map(r => ({ owner_id: r.user_id }));
      const teamBlock = ownership.teamSummary(team, await namesFor(req, team));

      res.json({
        items: mine,
        summary: summarize(mine),
        scope,
        // A manager's oversight, as a count rather than as rows on their list.
        team: teamBlock,
        conversation_storage: msgsByContact.size > 0,
        // Everything held back, and why. A queue that hides things without
        // saying how many is the disease, not the cure.
        snoozed: after.snoozed,
        stale_nudges: built.stale_nudges || 0,
        overflow: built.overflow || 0,
        nudge_max_age_days: require('../next-action').NUDGE_MAX_AGE_DAYS,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DISMISSING AN ITEM (Session 23) ────────────────────────────────────
  // Previously ONLY this endpoint existed, and only reminders had a button, so
  // reply_due / commitment_due / nudge / stage_suggested could not be cleared
  // at all — which is why a 91-day-old lead sat under a heading reading
  // "today". See services/next-action-dismissals.js for why the fix is a
  // fingerprinted SNOOZE and not a delete: the original reasoning (a queue you
  // can empty with a click tells you nothing) is still right.
  router.post('/next-actions/dismiss', auth, async (req, res) => {
    try {
      const item = req.body && req.body.item;
      const scope = (req.body && req.body.scope) || 'today';
      if (!item || !dismissals.itemKey(item)) {
        return res.status(400).json({ error: 'item required' });
      }
      if (!Object.prototype.hasOwnProperty.call(dismissals.SNOOZE_DAYS, scope) && scope !== 'drop') {
        return res.status(400).json({ error: 'unknown scope' });
      }
      const key = dismissals.settingsKey(req.user.id);
      const now = Date.now();
      let store = {};
      try {
        const { data } = await supabase.from('app_settings').select('value')
          .eq('key', key).maybeSingle();
        if (data && data.value) {
          store = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        }
      } catch (_) { store = {}; }

      const next = dismissals.recordDismissal(store, item, scope, now);
      const { error } = await supabase.from('app_settings')
        .upsert({ key, value: JSON.stringify(next) }, { onConflict: 'key' });
      if (error) throw error;
      res.json({ success: true, until: next[dismissals.itemKey(item)].until, scope });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Resolving the REMINDER behind an item — a real state change, not a snooze.
  //
  // ONLY THE OWNER MAY CLOSE IT (D-0020), and a refusal now SAYS SO. This used
  // to scope the update by user_id and report `{success:true}` regardless: a
  // manager clicking Done on a report's reminder matched zero rows, was told
  // "Marked done", and watched the row come back on the next load. Silently
  // doing nothing is the worst of the three possible behaviours.
  router.post('/next-actions/:reminderId/done', auth, async (req, res) => {
    try {
      const { data: row } = await withOrg(
        supabase.from('reminders').select('id,user_id').eq('id', req.params.reminderId), req
      ).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Reminder not found' });
      const refusal = ownership.closeRefusal(row, req.user.id);
      if (refusal) return res.status(403).json({ error: refusal, can_prompt: true });
      // The rule lets the owner close it, and lets ANYONE close a reminder nobody
      // owns. The write must match whichever of those it was: scoped to
      // `user_id = me` alone it matched zero rows on an ownerless reminder and
      // still answered success — the silent no-op D-0020 exists to end, on the
      // one kind of row an admin's list can carry that is not strictly theirs.
      let upd = withOrg(
        supabase.from('reminders').update({ status: 'sent', updated_at: new Date() })
          .eq('id', req.params.reminderId), req
      );
      upd = row.user_id ? upd.eq('user_id', req.user.id) : upd.is('user_id', null);
      const { data: closed, error } = await upd.select('id');
      if (error) throw error;
      // Nothing changed means it moved under us (reassigned, deleted). Say so —
      // "Marked done" over an unchanged row is how this list lost the owner's
      // trust in the first place.
      if (!closed || !closed.length) {
        return res.status(409).json({ error: 'This reminder changed before it could be closed. Refresh and try again.' });
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── WHAT IS OPEN BENEATH ME (D-0020) ──────────────────────────────────────
  // The review screen behind a manager's team count. Read-only by construction:
  // it returns rows and who owns each, and the only write it leads to is the
  // prompt below.
  // An admin's is the whole organisation, whether or not anybody reports to them.
  router.get('/next-actions/team', auth, async (req, res) => {
    try {
      const view = await oversight(req);
      const rows = await openBeneath(req, view,
        'id,user_id,return_date,note,contact_name,company_name,job_id,'
          + 'job:jobs(id,position,company:companies(name)),'
          + 'contact:contacts(id,first_name,last_name)');
      if (!rows) return res.json({ items: [], people: [], total: 0 });

      const items = (rows || []).map(r => {
        const vars = r.job
          ? buildEmailVars({ job: r.job, contact: r.contact, senderDisplayName: '' })
          : { fn: (r.contact && r.contact.first_name) || '', company: r.company_name || '' };
        return {
          id: r.id, owner_id: r.user_id,
          title: r.contact_name || 'Reminder',
          subtitle: (r.job && r.job.position) || r.company_name || null,
          company: (r.job && r.job.company && r.job.company.name) || r.company_name || null,
          due: r.return_date,
          note: r.note ? fillTemplate(r.note, vars) : null,
        };
      });
      const names = await namesFor(req, items);
      items.forEach(i => { i.owner_name = names[i.owner_id] || 'Someone'; });
      res.json({ items, ...ownership.teamSummary(items, names) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── PROMPT THE OWNER (D-0020) ─────────────────────────────────────────────
  // "the count where the manager can review it and initiate the other user to
  // take action on it" — the owner's own words. A prompt does NOT touch the
  // task; it puts a dated note on the OWNER's list, naming who asked. Reusing
  // reminders rather than inventing a second inbox means it lands somewhere
  // they already read every morning.
  router.post('/next-actions/:reminderId/prompt', auth, async (req, res) => {
    try {
      const { data: row } = await withOrg(
        supabase.from('reminders')
          .select('id,user_id,contact_name,company_name,contact_id,job_id,note'), req
      ).eq('id', req.params.reminderId).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Reminder not found' });
      if (row.user_id === req.user.id) {
        return res.status(400).json({ error: 'This one is already yours — no need to ask yourself.' });
      }
      // Nobody owns it, so there is nobody to ask — and copying its empty owner
      // would drop an anonymous "pick this up" on every admin's list. It sits
      // on an admin's own list instead, where Done closes it.
      if (!row.user_id) {
        return res.status(400).json({ error: 'Nobody owns this reminder, so there is nobody to ask.' });
      }

      // Only somebody the owner reports to may prompt them. Without this, any
      // colleague could drop tasks on anyone's morning.
      const org = orgIdFor(req);
      const isAdmin = isAdminReq(req);
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, org);
      if (!isAdmin && !(chain || []).includes(row.user_id)) {
        return res.status(403).json({ error: 'You can only ask somebody on your own team to pick something up.' });
      }

      const note = ownership.promptNote({
        fromName: req.user.name,
        title: row.contact_name,
        subtitle: row.company_name,
        note: (req.body && req.body.message) || null,
      });
      const insert = {
        user_id: row.user_id, job_id: row.job_id || null, contact_id: row.contact_id || null,
        contact_name: row.contact_name, company_name: row.company_name,
        return_date: today(), reminder_time: '09:00',
        note, status: 'pending', reminder_type: 'manager_prompt',
      };
      if (org) insert.org_id = org;
      const { error } = await supabase.from('reminders').insert(insert);
      if (error) throw error;
      res.status(201).json({ success: true, note });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
