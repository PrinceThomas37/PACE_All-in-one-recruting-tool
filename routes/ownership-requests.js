// ============================================================================
// OWNERSHIP REQUESTS — asking to take over somebody else's lead, client or
// job order (D-0036 / D-0037 / D-0038).
// ----------------------------------------------------------------------------
// The RULE lives in `services/ownership.js` (rampart's) — `recordOwnerId`,
// `clientOwnerFrom`, `canRequestTakeover`, `approverFor`, `canDecide`,
// `canCancel`, `takeoverTransition`, `pickAdmin`. This file is the database
// and the org scoping around those pure functions, and nothing else — it
// never re-derives who may ask, who approves, or what state comes next.
//
// Table: `ownership_requests` (migration 047 — NOT applied by this file; the
// orchestrator applies it before this router is merged). "One PENDING request
// per person per record" is a DB unique index; a race that slips past the
// in-app duplicate check still lands on a 23505, mapped to 409 here.
//
// ⚠ REGISTRATION ORDER: every literal path here sits above `/ownership-
// requests/:id/...` — there are no bare `:id` GET/PUT routes in this file, so
// there is nothing for a literal to collide with today, but a NEW literal
// path must still go above `/ownership-requests/:id/*`, never appended below.
// ============================================================================
const express = require('express');
const own = require('../services/ownership');
const { makeRecorder } = require('../services/record-history-writer');

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, db, auth, hasRole, orgIdFor, today,
    logActivity, orgStamp,
  } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);
  const history = makeRecorder(supabase, orgStamp);

  const NOT_FOUND = { error: 'not_found', reason: 'We could not find that record.' };

  // ── loading a record by kind, org-scoped ────────────────────────────────
  async function loadRecord(req, kind, id) {
    const D = db.forRequest(req);
    if (kind === 'lead') {
      const { data } = await D.from('jobs')
        .select('id,position,stage,assigned_to_bd,created_by,assigned_to,deleted_at,org_id,company_id,company:companies(id,name)')
        .eq('id', id).maybeSingle();
      return data || null;
    }
    if (kind === 'job_order') {
      const { data } = await D.from('job_orders')
        .select('id,job_title,bd_manager_id,deleted_at,org_id,company_id,company:companies(id,name)')
        .eq('id', id).maybeSingle();
      return data || null;
    }
    if (kind === 'client') {
      const { data: company } = await D.from('companies')
        .select('id,name,created_by,deleted_at,org_id').eq('id', id).maybeSingle();
      if (!company) return null;
      const { data: jobOrders } = await D.from('job_orders')
        .select('id,bd_manager_id,created_at,deleted_at,company_id').eq('company_id', id);
      const { data: leads } = await D.from('jobs')
        .select('id,assigned_to_bd,created_at,deleted_at,company_id,stage').eq('company_id', id);
      return { company, jobOrders: jobOrders || [], leads: leads || [] };
    }
    return null;
  }

  function recordRow(kind, record) {
    return kind === 'client' ? (record && record.company) : record;
  }

  // What the requester is allowed to know (D-0035 D5 / D-0038): a lead reached
  // only through the duplicate-email match never surfaces the lead's own
  // details — just whose it is and that it exists. Everything else is shared
  // to see already, so its full label is safe.
  function labelFor(kind, record, { viaDuplicateEmailMatch, viaEmail } = {}) {
    if (kind === 'lead') {
      if (viaDuplicateEmailMatch) {
        return `A lead with ${viaEmail || 'a matching contact'}`.slice(0, 300);
      }
      const company = record.company && record.company.name;
      return [record.position, company].filter(Boolean).join(' — ').slice(0, 300) || 'A lead';
    }
    if (kind === 'job_order') {
      const company = record.company && record.company.name;
      return [record.job_title, company].filter(Boolean).join(' — ').slice(0, 300) || 'A job order';
    }
    if (kind === 'client') {
      return (record.company && record.company.name) ? String(record.company.name).slice(0, 300) : 'A client';
    }
    return null;
  }

  // ── users of the org, for approverFor/canDecide/display names ──────────
  // `db.forRequest(req)` (L2, R-047 review round 2) — a raw `supabase.from`
  // read on a tenant table is exactly the "unconverted call site" CLAUDE.md
  // warns is unprotected the moment a second org exists; this table already
  // carries `org_id`, so there is no reason for this file to hand-scope it.
  async function orgUsers(req) {
    const { data } = await db.forRequest(req).from('users')
      .select('id,name,manager_id,is_active,deleted_at,org_id,created_at,role,roles');
    const list = data || [];
    const usersById = new Map(list.map(u => [u.id, u]));
    const adminIds = list.filter(u => !u.deleted_at && u.is_active !== false && own.rolesOf(u).includes('admin')).map(u => u.id);
    return { usersById, adminIds, list };
  }

  function nameObj(id, usersById) {
    if (!id) return null;
    const u = usersById.get(id);
    return { id, name: (u && u.name) || 'Someone' };
  }

  // The viewer's D-0034 scope, computed the same way every other route in the
  // app computes it (chain via hierarchy.js, admin sees everything).
  async function computeScope(req) {
    const orgId = orgIdFor(req);
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  // R47-1: the lead's own id (record_id) is exactly the thing D-0038's
  // duplicate-email door is built to withhold from the asker — a request
  // "about" a lead resolved from `via_email` must never hand that lead's id
  // back on the response, in `box=mine`, or anywhere else a request shapes.
  // The approver/admin who can already SEE the lead is unaffected; only a
  // viewer who could not see it under `canSeeLead` loses the id. Batched
  // (one query for every distinct lead id in the page) rather than per-row,
  // and re-checked fresh here — never trusted from what was stored at ask
  // time, because ownership (and therefore visibility) can move.
  async function withheldLeadIds(req, rows, scope) {
    const ids = [...new Set((rows || []).filter(r => r.record_kind === 'lead').map(r => r.record_id))];
    if (!ids.length) return new Set();
    const { data } = await db.forRequest(req).from('jobs')
      .select('id,assigned_to_bd,created_by,assigned_to,deleted_at').in('id', ids);
    const byId = new Map((data || []).map(j => [j.id, j]));
    const hidden = new Set();
    ids.forEach(id => {
      const lead = byId.get(id);
      if (!lead || lead.deleted_at || !own.canSeeLead(lead, scope)) hidden.add(id);
    });
    return hidden;
  }

  // A plain, factual sentence from what is STORED on the row — never a
  // re-derivation of who approves (that answer is fixed at request time and
  // lives in approver_id; the reporting chain may since have changed).
  function whyForRow(row, usersById) {
    const approverName = (usersById.get(row.approver_id) && usersById.get(row.approver_id).name) || 'the approver';
    if (row.current_owner_id) {
      const ownerName = (usersById.get(row.current_owner_id) && usersById.get(row.current_owner_id).name) || 'its owner';
      return `${ownerName} owned this when the request was made, so it went to ${approverName}.`;
    }
    return `Nobody owned this when the request was made, so it went to ${approverName}.`;
  }

  function shapeRequest(row, viewer, usersById, hiddenLeadIds) {
    const decide = own.canDecide({
      request: row, deciderId: viewer.id, deciderRoles: viewer.roles, deciderOrgId: viewer.orgId,
    });
    const cancel = own.canCancel({ request: row, actorId: viewer.id });
    // R47-1: withhold record_id for a lead the viewer cannot canSeeLead — the
    // asker who reached this through the via_email door must never learn the
    // lead's id, however the request is looked at afterwards.
    const withheldId = row.record_kind === 'lead' && hiddenLeadIds && hiddenLeadIds.has(row.record_id);
    return {
      id: row.id,
      kind: row.record_kind,
      record_id: withheldId ? null : row.record_id,
      record_label: row.record_label,
      status: row.status,
      note: row.note || null,
      decision_note: row.decision_note || null,
      created_at: row.created_at,
      decided_at: row.decided_at || null,
      why: whyForRow(row, usersById),
      requester: nameObj(row.requester_id, usersById),
      current_owner: nameObj(row.current_owner_id, usersById),
      approver: nameObj(row.approver_id, usersById),
      decided_by: row.decided_by ? nameObj(row.decided_by, usersById) : null,
      can_decide: decide.ok,
      can_cancel: cancel.ok,
    };
  }

  // ── the sending mailbox a newly-assigned BD gets, best-effort ───────────
  // Mirrors POST /distribute/execute's own picking logic (index.js): active,
  // CONNECTED (a working refresh token, Microsoft or Gmail) accounts, ranked
  // by remaining daily capacity. Returns null when the new owner has none —
  // the lead still changes hands; sending simply waits until they connect one,
  // rather than continuing to send under the PREVIOUS owner's identity.
  async function pickMailboxFor(req, userId) {
    const D = db.forRequest(req);
    const { data: userEmails } = await D.from('user_emails')
      .select('id,daily_send_limit').eq('user_id', userId).eq('is_active', true);
    if (!userEmails || !userEmails.length) return null;
    const emailIds = userEmails.map(e => e.id);
    const [{ data: msTokens }, { data: gmailTokens }] = await Promise.all([
      D.from('microsoft_tokens').select('user_email_id,refresh_failed').in('user_email_id', emailIds),
      D.from('gmail_tokens').select('user_email_id,refresh_failed').in('user_email_id', emailIds),
    ]);
    const connectedIds = new Set(
      [...(msTokens || []), ...(gmailTokens || [])].filter(t => !t.refresh_failed).map(t => t.user_email_id)
    );
    const connected = userEmails.filter(e => connectedIds.has(e.id));
    if (!connected.length) return null;
    const todayDate = today();
    const { data: sendLogs } = await D.from('email_send_log')
      .select('user_email_id,emails_sent').eq('send_date', todayDate).in('user_email_id', connected.map(e => e.id));
    const sentToday = {};
    (sendLogs || []).forEach(l => { sentToday[l.user_email_id] = l.emails_sent || 0; });
    const withRemaining = connected
      .map(a => ({ ...a, remaining: (a.daily_send_limit || 150) - (sentToday[a.id] || 0) }))
      .filter(a => a.remaining > 0);
    if (!withRemaining.length) return null;
    withRemaining.sort((a, b) => b.remaining - a.remaining || String(a.id).localeCompare(String(b.id)));
    return withRemaining[0].id;
  }

  // Reassign one lead to a new owner — the same fields `/distribute/execute`
  // and `PUT /jobs/:id` set on assignment. Stage is left untouched. The send
  // loop resolves the sender at SEND time from `job.sending_email_id`
  // (index.js `processPendingEmailSends`), so any still-queued outreach for
  // this lead goes out under the NEW owner's mailbox the moment this commits —
  // nothing in the send loop itself needs to change.
  //
  // The write is CONDITIONAL on the owner still being `oldOwnerId` (M1,
  // R-047 review round 2): a distribute or a second approval landing in the
  // gap between the live-owner re-check above and this write must not be
  // silently overwritten. `.select()` reports exactly what moved, so the
  // caller can tell "reassigned" from "nothing moved" rather than assuming.
  async function reassignLead(req, jobId, newOwnerId, oldOwnerId) {
    const mailboxId = await pickMailboxFor(req, newOwnerId);
    const now = new Date();
    let q = db.forRequest(req).from('jobs')
      .update({ assigned_to_bd: newOwnerId, assigned_at: now, sending_email_id: mailboxId, updated_at: now })
      .eq('id', jobId);
    q = oldOwnerId ? q.eq('assigned_to_bd', oldOwnerId) : q.is('assigned_to_bd', null);
    const { data, error } = await q.select('id');
    if (error) throw error;
    const moved = !!(data && data.length);
    if (!moved) return { mailboxAssigned: false, moved: false };
    try {
      await logActivity(jobId, null, req.user.id, 'ownership_transfer',
        'Ownership transferred (take-over request approved)',
        { assigned_to_bd: oldOwnerId }, { assigned_to_bd: newOwnerId });
    } catch (_) { /* best-effort, same as every other logActivity call site */ }
    return { mailboxAssigned: !!mailboxId, moved: true };
  }

  // Verifies, server-side, that `email` is a contact on lead `jobId` — the
  // ONLY thing that may set `viaDuplicateEmailMatch` (D-0038). Never trust a
  // browser-supplied boolean for this.
  async function emailMatchesLead(req, jobId, email) {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return false;
    const { data } = await db.forRequest(req).from('contacts')
      .select('id,email').eq('job_id', jobId);
    return (data || []).some(c => String(c.email || '').trim().toLowerCase() === needle);
  }

  // Resolves a lead from a typed contact email alone — no record_id at all —
  // for the case guild's duplicate-warning no longer hands out a lead id
  // (option (a)). Org-scoped (db.forRequest), case-insensitive, and this
  // resolution itself IS the server-side proof `viaDuplicateEmailMatch`
  // requires: it is never copied from anything the browser sent.
  //   - excludes a lead already deleted
  //   - excludes a lead the CALLER already owns (nothing to take over)
  //   - several matching leads → the most recently assigned wins (ties broken
  //     by id), stated here rather than left to guess: a contact email can sit
  //     on more than one lead over its life (recycled, re-researched), and the
  //     freshest assignment is the one a colleague is most likely mid-workflow
  //     on right now.
  async function resolveLeadByEmail(req, email, requesterId) {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return null;
    const D = db.forRequest(req);
    // R47-3: `needle` is typed by a user, not a pattern — a literal `%` or `_`
    // in it must match itself, never act as an ILIKE wildcard (Postgres's
    // default LIKE/ILIKE escape character is backslash, so escaping with `\`
    // here is exact, not a heuristic). The exact-match filter below already
    // makes a wildcard harmless today, but this stops it silently WIDENING the
    // candidate set the moment that filter is ever relaxed. Bounded so a typed
    // address that happens to match a great many contacts cannot balloon the
    // read.
    const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const { data: contacts } = await D.from('contacts').select('id,job_id,email')
      .ilike('email', escaped).limit(500);
    const jobIds = [...new Set((contacts || [])
      .filter(c => String(c.email || '').trim().toLowerCase() === needle)
      .map(c => c.job_id).filter(Boolean))];
    if (!jobIds.length) return null;
    const { data: jobs } = await D.from('jobs')
      .select('id,position,stage,assigned_to_bd,created_by,assigned_to,deleted_at,org_id,company_id,assigned_at,created_at,company:companies(id,name)')
      .in('id', jobIds).limit(500);
    const candidates = (jobs || []).filter(j => !j.deleted_at && j.assigned_to_bd !== requesterId);
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ta = a.assigned_at ? Date.parse(a.assigned_at) : (a.created_at ? Date.parse(a.created_at) : -Infinity);
      const tb = b.assigned_at ? Date.parse(b.assigned_at) : (b.created_at ? Date.parse(b.created_at) : -Infinity);
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return candidates[0];
  }

  // ── POST /ownership-requests/can-request ─────────────────────────────────
  // Body, not query string (L3): `via_email` is a prospect's address and must
  // never sit in a URL that ends up in an access log. `{kind, record_id?,
  // via_email?}` — a lead may be named either by `record_id` (the requester
  // already sees it) or by `via_email` alone (the duplicate-warning door,
  // D-0038; resolved server-side, see resolveLeadByEmail above). The GET
  // version of this endpoint is retired — one door, one law, rather than two
  // endpoints that could silently drift on which one enforces L3.
  router.post('/ownership-requests/can-request', auth, async (req, res) => {
    try {
      const kind = String((req.body && req.body.kind) || '');
      let recordId = req.body && req.body.record_id ? String(req.body.record_id) : '';
      const viaEmail = req.body && req.body.via_email ? String(req.body.via_email).trim() : '';
      if (!own.TAKEOVER_KINDS.includes(kind) || (!recordId && !viaEmail)) {
        return res.json({ ok: false, reason: 'Ask about a lead, client or job order by id.', approver: null, why: null });
      }

      let viaDuplicateEmailMatch = false;
      let record = null;
      if (!recordId && kind === 'lead' && viaEmail) {
        const resolved = await resolveLeadByEmail(req, viaEmail, req.user.id);
        if (!resolved) return res.json({ ok: false, reason: NOT_FOUND.reason, approver: null, why: null });
        recordId = resolved.id;
        record = resolved;
        viaDuplicateEmailMatch = true;
      } else {
        record = await loadRecord(req, kind, recordId);
        if (kind === 'lead' && record && viaEmail) {
          viaDuplicateEmailMatch = await emailMatchesLead(req, recordId, viaEmail);
        }
      }

      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

      const { data: openRequests } = await db.forRequest(req).from('ownership_requests')
        .select('id,requester_id,status').eq('record_kind', kind).eq('record_id', recordId).eq('status', 'pending');

      const requester = { id: req.user.id, role: req.user.role, roles: req.user.roles, org_id: orgId };
      const result = own.canRequestTakeover({
        kind, record, requester, scope, openRequests: openRequests || [], viaDuplicateEmailMatch,
      });
      if (!result.ok) {
        return res.json({ ok: false, reason: result.reason, approver: null, why: null });
      }

      const { usersById, adminIds } = await orgUsers(req);
      const approver = own.approverFor({ owner: result.ownerId, requester: req.user.id, usersById, adminIds });
      if (!approver.approverId) {
        return res.json({ ok: false, reason: approver.why, approver: null, why: null });
      }
      return res.json({
        ok: true, reason: null,
        approver: nameObj(approver.approverId, usersById),
        why: approver.why,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /ownership-requests ─────────────────────────────────────────────
  router.post('/ownership-requests', auth, async (req, res) => {
    try {
      const kind = String((req.body && req.body.kind) || '');
      let recordId = String((req.body && req.body.record_id) || '');
      const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 1000) : null;
      const viaEmailRaw = (req.body && req.body.via_email) ? String(req.body.via_email).trim() : '';

      if (!own.TAKEOVER_KINDS.includes(kind)) {
        return res.status(400).json({ error: 'bad_kind', reason: 'That kind of record cannot be taken over.' });
      }
      if (!recordId && !(kind === 'lead' && viaEmailRaw)) return res.status(404).json(NOT_FOUND);

      // Option (a): the duplicate warning no longer hands out a lead id — a
      // lead-kind request with no record_id resolves it here, server-side,
      // from the typed contact email alone. That resolution IS the
      // viaDuplicateEmailMatch proof; nothing is trusted from the body.
      let record;
      let viaDuplicateEmailMatch = false;
      if (!recordId && kind === 'lead' && viaEmailRaw) {
        const resolved = await resolveLeadByEmail(req, viaEmailRaw, req.user.id);
        if (!resolved) return res.status(404).json(NOT_FOUND);
        recordId = resolved.id;
        record = resolved;
        viaDuplicateEmailMatch = true;
      } else {
        record = await loadRecord(req, kind, recordId);
        // D-0038: only a route may set this, only after verifying the typed
        // email is really on this lead. Lead-only; ignored for client/job_order.
        if (kind === 'lead' && record && viaEmailRaw) {
          viaDuplicateEmailMatch = await emailMatchesLead(req, recordId, viaEmailRaw);
        }
      }

      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

      const { data: openRequests } = await db.forRequest(req).from('ownership_requests')
        .select('id,requester_id,status').eq('record_kind', kind).eq('record_id', recordId).eq('status', 'pending');

      const requester = { id: req.user.id, role: req.user.role, roles: req.user.roles, org_id: orgId };
      const result = own.canRequestTakeover({
        kind, record, requester, scope, openRequests: openRequests || [], viaDuplicateEmailMatch,
      });
      if (!result.ok) {
        if (result.code === 'not_found') return res.status(404).json(NOT_FOUND);
        if (result.code === 'already_requested') return res.status(409).json({ error: result.code, reason: result.reason });
        return res.status(403).json({ error: result.code, reason: result.reason });
      }

      const { usersById, adminIds } = await orgUsers(req);
      const approver = own.approverFor({ owner: result.ownerId, requester: req.user.id, usersById, adminIds });
      if (!approver.approverId) {
        return res.status(409).json({ error: 'no_approver', reason: approver.why });
      }

      const recordLabel = labelFor(kind, record, { viaDuplicateEmailMatch, viaEmail: viaEmailRaw });

      const insertRow = {
        record_kind: kind,
        record_id: recordId,
        record_label: recordLabel,
        requester_id: req.user.id,
        current_owner_id: result.ownerId || null,
        approver_id: approver.approverId,
        status: 'pending',
        note,
      };
      const { data: inserted, error } = await db.forRequest(req).from('ownership_requests')
        .insert(insertRow).select().single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'already_requested', reason: `You have already asked to take over this ${kind === 'job_order' ? 'job order' : kind}. It is waiting for a decision.` });
        }
        throw error;
      }

      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      const hidden = await withheldLeadIds(req, [inserted], scope);
      res.status(201).json({ request: shapeRequest(inserted, viewer, usersById, hidden) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /ownership-requests?box=mine|waiting|record ─────────────────────
  router.get('/ownership-requests', auth, async (req, res) => {
    try {
      const box = String(req.query.box || 'mine');
      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const D = db.forRequest(req);
      const { usersById, adminIds } = await orgUsers(req);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      // R47-1: computed once, used by both the record-visibility check below
      // and to withhold record_id from any lead-kind row this viewer cannot
      // canSeeLead (box=mine included — an asker who reached a lead through
      // via_email must never learn its id back from their own list either).
      const chainForScope = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chainForScope });

      // waiting_count is always answered — it is the approver's badge, not a
      // page-specific number, so a caller reading `mine` still learns it.
      let waitingQuery = D.from('ownership_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (!isAdmin) waitingQuery = waitingQuery.eq('approver_id', req.user.id);
      const { count: waitingCount } = await waitingQuery;

      let rows = [];
      if (box === 'mine') {
        const { data } = await D.from('ownership_requests')
          .select('*').eq('requester_id', req.user.id).order('created_at', { ascending: false });
        rows = data || [];
      } else if (box === 'waiting') {
        let q = D.from('ownership_requests').select('*').eq('status', 'pending');
        if (!isAdmin) q = q.eq('approver_id', req.user.id);
        const { data } = await q.order('created_at', { ascending: false });
        rows = data || [];
      } else if (box === 'record') {
        const kind = String(req.query.kind || '');
        const recordId = String(req.query.record_id || '');
        if (!own.TAKEOVER_KINDS.includes(kind) || !recordId) {
          return res.status(400).json({ error: 'kind and record_id are required for box=record' });
        }
        const record = await loadRecord(req, kind, recordId);
        if (!record) return res.status(404).json(NOT_FOUND);
        const row = recordRow(kind, record);
        if (!row || row.deleted_at) return res.status(404).json(NOT_FOUND);
        // Shared-to-see records (client/job order, D-0035) are visible to
        // anyone in the org; a lead follows its own D-0034 visibility.
        const sees = kind === 'lead' ? own.canSeeLead(row, scope) : true;
        if (!sees) return res.status(404).json(NOT_FOUND);
        const { data } = await D.from('ownership_requests')
          .select('*').eq('record_kind', kind).eq('record_id', recordId).order('created_at', { ascending: false });
        rows = data || [];
      } else {
        return res.status(400).json({ error: 'box must be mine, waiting or record' });
      }

      const hidden = await withheldLeadIds(req, rows, scope);
      res.json({
        requests: rows.map(r => shapeRequest(r, viewer, usersById, hidden)),
        waiting_count: waitingCount || 0,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Loads a pending-or-not request the caller may act on the URL of, org-
  // scoped; a foreign-org or missing id is the same 404.
  async function loadOwnRequest(req, id) {
    const { data } = await db.forRequest(req).from('ownership_requests').select('*').eq('id', id).maybeSingle();
    return data || null;
  }

  // Is the record's live owner still the one this request was made about?
  // Re-checked at approve time (never at decline/cancel — nothing moves then).
  async function currentOwnerOf(req, kind, recordId) {
    const record = await loadRecord(req, kind, recordId);
    if (!record) return { record: null, ownerId: null };
    return { record, ownerId: own.recordOwnerId(kind, record) };
  }

  // Loads the requester's own current row (L2: db.forRequest, not a
  // hand-scoped raw `supabase.from`) so approve-time can re-check BOTH that
  // they are still active in the org AND (L1) that their role can still own
  // this kind of record — a role change between asking and deciding is the
  // same class of staleness as an owner change, and canRequestTakeover
  // already refuses the ask itself on this exact rule.
  async function liveRequester(req, userId) {
    const { data } = await db.forRequest(req).from('users')
      .select('id,is_active,deleted_at,org_id,role,roles').eq('id', userId).maybeSingle();
    return data || null;
  }

  // ── POST /ownership-requests/:id/approve ─────────────────────────────────
  router.post('/ownership-requests/:id/approve', auth, async (req, res) => {
    try {
      const row = await loadOwnRequest(req, req.params.id);
      if (!row) return res.status(404).json(NOT_FOUND);
      const orgId = orgIdFor(req);
      const decide = own.canDecide({
        request: row, deciderId: req.user.id, deciderRoles: req.user.roles || req.user.role, deciderOrgId: orgId,
      });
      if (!decide.ok) {
        return res.status(403).json({ error: 'cannot_decide', reason: decide.reason });
      }

      const requesterUser = await liveRequester(req, row.requester_id);
      if (!requesterUser || requesterUser.deleted_at || requesterUser.is_active === false
        || (orgId && requesterUser.org_id && requesterUser.org_id !== orgId)) {
        return res.status(409).json({ error: 'requester_inactive', reason: 'The person who asked is no longer active in this organisation, so this request cannot be approved.' });
      }
      // L1: the requester's role may have changed since they asked (a
      // recruiter promoted from BD, say) — canRequestTakeover's own rule 5
      // (TAKEOVER_OWNER_ROLES) is re-run here rather than re-derived.
      const allowedRoles = own.TAKEOVER_OWNER_ROLES[row.record_kind] || [];
      if (!own.rolesOf(requesterUser).some(r => allowedRoles.includes(r))) {
        return res.status(409).json({ error: 'role_changed', reason: 'The person who asked no longer holds a role that can own this, so this request cannot be approved.' });
      }

      const { record, ownerId: liveOwnerId } = await currentOwnerOf(req, row.record_kind, row.record_id);
      if (!record) return res.status(404).json(NOT_FOUND);
      // L1: the record itself must still be live — a soft-deleted lead/job
      // order/client is the same "cannot be approved" answer as one that was
      // never there.
      const liveRow = recordRow(row.record_kind, record);
      if (!liveRow || liveRow.deleted_at) return res.status(404).json(NOT_FOUND);
      if ((liveOwnerId || null) !== (row.current_owner_id || null)) {
        return res.status(409).json({ error: 'owner_changed', reason: 'This record\'s owner has already changed since the request was made — ask again if it is still needed.' });
      }

      const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 1000) : null;
      const now = new Date();
      const { data: updated, error } = await db.forRequest(req).from('ownership_requests')
        .update({ status: 'approved', decision_note: note, decided_by: req.user.id, decided_at: now, updated_at: now })
        .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(409).json({ error: 'already_decided', reason: 'Someone else already decided this request.' });

      // M1 (R-047 review round 2): the status flip above is optimistic — it
      // only proves nobody else DECIDED this request twice. It says nothing
      // about whether the underlying record is still owned by who it was
      // when the request was made. Every write below is therefore CONDITIONAL
      // on that same old-owner match, and its row count is checked before the
      // outcome is ever reported — a write that touches nothing must never be
      // reported as "approved — reassigned". A single-record kind (lead,
      // job_order) that loses that race reverts the approval back to
      // `pending` rather than leaving an "approved" request that moved
      // nothing; "flip status, then verify the write actually happened" is
      // the shape used here, deliberately, so the revert only ever undoes a
      // status flip that already happened — never a half-completed move.
      const revertApproval = async (reason) => {
        await db.forRequest(req).from('ownership_requests')
          .update({ status: 'pending', decision_note: null, decided_by: null, decided_at: null, updated_at: new Date() })
          .eq('id', row.id).eq('status', 'approved');
        return res.status(409).json({ error: 'owner_changed', reason });
      };

      // ── the reassignment, through the existing paths ──────────────────
      const moved = {};
      if (row.record_kind === 'lead') {
        const r = await reassignLead(req, row.record_id, row.requester_id, row.current_owner_id);
        if (!r.moved) {
          return await revertApproval("This lead's owner changed just as the request was being approved, so nothing moved. Ask again if it is still needed.");
        }
        moved.lead = { id: row.record_id, mailbox_assigned: r.mailboxAssigned };
      } else if (row.record_kind === 'job_order') {
        const { data: joUpdated, error: joErr } = await db.forRequest(req).from('job_orders')
          .update({ bd_manager_id: row.requester_id, updated_at: now })
          .eq('id', row.record_id).eq('bd_manager_id', row.current_owner_id).select('id');
        if (joErr) throw joErr;
        if (!joUpdated || !joUpdated.length) {
          return await revertApproval("This job order's owner changed just as the request was being approved, so nothing moved. Ask again if it is still needed.");
        }
        await history.record(req, 'job_order', row.record_id, {
          action: 'ownership_transfer', field: 'bd_manager_id',
          from: row.current_owner_id, to: row.requester_id, note: 'Take-over request approved',
        });
        moved.job_order = { id: row.record_id };
      } else if (row.record_kind === 'client') {
        const companyId = record.company.id;
        const oldOwner = row.current_owner_id;
        const { data: jos } = await db.forRequest(req).from('job_orders')
          .select('id,bd_manager_id').eq('company_id', companyId).is('deleted_at', null).eq('bd_manager_id', oldOwner);
        const { data: leads } = await db.forRequest(req).from('jobs')
          .select('id,assigned_to_bd').eq('company_id', companyId).is('deleted_at', null).eq('assigned_to_bd', oldOwner)
          .neq('stage', 'Unassigned');
        // Each write is re-guarded by the same old-owner match at write time —
        // the SELECT above can be stale by the time the UPDATE runs, and a
        // job order or lead that moved in between must be skipped, not
        // silently taken from whoever it moved to.
        let jobOrdersMoved = 0;
        for (const jo of (jos || [])) {
          const { data: joUpd, error: joErr } = await db.forRequest(req).from('job_orders')
            .update({ bd_manager_id: row.requester_id, updated_at: now })
            .eq('id', jo.id).eq('bd_manager_id', oldOwner).select('id');
          if (joErr) throw joErr;
          if (joUpd && joUpd.length) jobOrdersMoved++;
        }
        const leadResults = [];
        for (const ld of (leads || [])) {
          const r = await reassignLead(req, ld.id, row.requester_id, oldOwner);
          if (r.moved) leadResults.push({ id: ld.id, mailbox_assigned: r.mailboxAssigned });
        }

        // M2 (R-047 review round 2): the ownership ladder (recordOwnerId /
        // clientOwnerFrom) has a THIRD rung below job orders and leads —
        // `companies.created_by`. A client with no live job order or lead
        // owned by `oldOwner` is only "theirs" through that fallback, and if
        // this approval moved zero job orders and zero leads that is exactly
        // the case: nothing above moved because there was nothing above to
        // move. Reporting "approved" with an empty `moved` block then would
        // be the no-op M2 calls out — so make the SAME rung the ladder reads
        // the write: hand `created_by` to the requester, the same way owning
        // this client made the previous person its owner. Conditional on
        // `created_by` still matching `oldOwner` for the same race reason as
        // every other write here.
        //
        // R47-4: `oldOwner` and `record.company.created_by` are BOTH null for
        // a genuinely unowned client (created_by never set, no job order or
        // lead ever owned it) — the original `&&` here required a TRUTHY
        // created_by, so that exact case could never satisfy it and every
        // approval of an unowned client's take-over reverted to pending
        // forever, with no way to ever approve one. The match is now on
        // equality (null === null included), and the write itself switches
        // between `.eq()` and `.is()` because Postgres/PostgREST do not treat
        // `eq.null` as "IS NULL".
        let createdByTransferred = false;
        const priorCreatedBy = record.company.created_by || null;
        if (!jobOrdersMoved && !leadResults.length && priorCreatedBy === (oldOwner || null)) {
          let coQuery = db.forRequest(req).from('companies')
            .update({ created_by: row.requester_id, updated_at: now })
            .eq('id', companyId);
          coQuery = priorCreatedBy ? coQuery.eq('created_by', priorCreatedBy) : coQuery.is('created_by', null);
          const { data: coUpd, error: coErr } = await coQuery.select('id');
          if (coErr) throw coErr;
          createdByTransferred = !!(coUpd && coUpd.length);
        }
        if (!jobOrdersMoved && !leadResults.length && !createdByTransferred) {
          // Nothing above moved and the created_by rung either does not apply
          // (this client's ownership never actually traced to `oldOwner`) or
          // lost its own race — either way, this approval must not report a
          // reassignment that did not happen.
          return await revertApproval("This client's owner changed just as the request was being approved, so nothing moved. Ask again if it is still needed.");
        }
        if (createdByTransferred) {
          // R47-4: the previous creator/owner is recorded explicitly — by
          // VALUE, not by re-deriving it from `oldOwner` — so the original
          // creator is never simply lost from the record's own history, even
          // though nothing here changes who gets CREDIT for having made it.
          await history.record(req, 'company', companyId, {
            action: 'ownership_transfer', field: 'created_by',
            from: priorCreatedBy, to: row.requester_id,
            note: 'Take-over request approved — this client had no owning job order or lead, so the requester became its new owner (created_by).',
          });
        }
        await history.record(req, 'company', companyId, {
          action: 'ownership_transfer', field: 'owner',
          from: oldOwner, to: row.requester_id,
          note: `Take-over request approved — moved ${jobOrdersMoved} job order(s), ${leadResults.length} lead(s)`
              + (createdByTransferred ? ', and the client record itself (no owned job order or lead existed)' : ''),
        });
        moved.client = {
          company_id: companyId, job_orders_moved: jobOrdersMoved, leads_moved: leadResults,
          created_by_transferred: createdByTransferred, other_owners_untouched: true,
        };
      }

      const { usersById } = await orgUsers(req);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      const scope = await computeScope(req);
      const hidden = await withheldLeadIds(req, [updated], scope);
      res.json({ request: shapeRequest(updated, viewer, usersById, hidden), moved });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /ownership-requests/:id/decline ─────────────────────────────────
  router.post('/ownership-requests/:id/decline', auth, async (req, res) => {
    try {
      const row = await loadOwnRequest(req, req.params.id);
      if (!row) return res.status(404).json(NOT_FOUND);
      const orgId = orgIdFor(req);
      const decide = own.canDecide({
        request: row, deciderId: req.user.id, deciderRoles: req.user.roles || req.user.role, deciderOrgId: orgId,
      });
      if (!decide.ok) return res.status(403).json({ error: 'cannot_decide', reason: decide.reason });

      const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 1000) : null;
      const now = new Date();
      const { data: updated, error } = await db.forRequest(req).from('ownership_requests')
        .update({ status: 'declined', decision_note: note, decided_by: req.user.id, decided_at: now, updated_at: now })
        .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(409).json({ error: 'already_decided', reason: 'Someone else already decided this request.' });

      const { usersById } = await orgUsers(req);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      const scope = await computeScope(req);
      const hidden = await withheldLeadIds(req, [updated], scope);
      res.json({ request: shapeRequest(updated, viewer, usersById, hidden) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /ownership-requests/:id/cancel ──────────────────────────────────
  router.post('/ownership-requests/:id/cancel', auth, async (req, res) => {
    try {
      const row = await loadOwnRequest(req, req.params.id);
      if (!row) return res.status(404).json(NOT_FOUND);
      const cancel = own.canCancel({ request: row, actorId: req.user.id });
      if (!cancel.ok) return res.status(403).json({ error: 'cannot_cancel', reason: cancel.reason });

      const orgId = orgIdFor(req);
      const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 1000) : null;
      const now = new Date();
      const { data: updated, error } = await db.forRequest(req).from('ownership_requests')
        .update({ status: 'cancelled', decision_note: note, decided_by: req.user.id, decided_at: now, updated_at: now })
        .eq('id', row.id).eq('status', 'pending').select().maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(409).json({ error: 'already_decided', reason: 'This request was already decided.' });

      const { usersById } = await orgUsers(req);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      const scope = await computeScope(req);
      const hidden = await withheldLeadIds(req, [updated], scope);
      res.json({ request: shapeRequest(updated, viewer, usersById, hidden) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
