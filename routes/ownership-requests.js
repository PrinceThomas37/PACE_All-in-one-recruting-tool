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
  async function orgUsers(orgId) {
    let q = supabase.from('users')
      .select('id,name,manager_id,is_active,deleted_at,org_id,created_at,role,roles');
    if (orgId) q = q.eq('org_id', orgId);
    const { data } = await q;
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

  function shapeRequest(row, viewer, usersById) {
    const decide = own.canDecide({
      request: row, deciderId: viewer.id, deciderRoles: viewer.roles, deciderOrgId: viewer.orgId,
    });
    const cancel = own.canCancel({ request: row, actorId: viewer.id });
    return {
      id: row.id,
      kind: row.record_kind,
      record_id: row.record_id,
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
  async function reassignLead(req, jobId, newOwnerId, oldOwnerId) {
    const mailboxId = await pickMailboxFor(req, newOwnerId);
    const now = new Date();
    await db.forRequest(req).from('jobs')
      .update({ assigned_to_bd: newOwnerId, assigned_at: now, sending_email_id: mailboxId, updated_at: now })
      .eq('id', jobId);
    try {
      await logActivity(jobId, null, req.user.id, 'ownership_transfer',
        'Ownership transferred (take-over request approved)',
        { assigned_to_bd: oldOwnerId }, { assigned_to_bd: newOwnerId });
    } catch (_) { /* best-effort, same as every other logActivity call site */ }
    return { mailboxAssigned: !!mailboxId };
  }

  // ── GET /ownership-requests/can-request ─────────────────────────────────
  router.get('/ownership-requests/can-request', auth, async (req, res) => {
    try {
      const kind = String(req.query.kind || '');
      const recordId = String(req.query.record_id || '');
      if (!own.TAKEOVER_KINDS.includes(kind) || !recordId) {
        return res.json({ ok: false, reason: 'Ask about a lead, client or job order by id.', approver: null, why: null });
      }
      const record = await loadRecord(req, kind, recordId);
      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

      let viaDuplicateEmailMatch = false;
      const viaEmail = req.query.via_email ? String(req.query.via_email).trim() : '';
      if (kind === 'lead' && record && viaEmail) {
        viaDuplicateEmailMatch = await emailMatchesLead(req, recordId, viaEmail);
      }

      const { data: openRequests } = await db.forRequest(req).from('ownership_requests')
        .select('id,requester_id,status').eq('record_kind', kind).eq('record_id', recordId).eq('status', 'pending');

      const requester = { id: req.user.id, role: req.user.role, roles: req.user.roles, org_id: orgId };
      const result = own.canRequestTakeover({
        kind, record, requester, scope, openRequests: openRequests || [], viaDuplicateEmailMatch,
      });
      if (!result.ok) {
        return res.json({ ok: false, reason: result.reason, approver: null, why: null });
      }

      const { usersById, adminIds } = await orgUsers(orgId);
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

  // ── POST /ownership-requests ─────────────────────────────────────────────
  router.post('/ownership-requests', auth, async (req, res) => {
    try {
      const kind = String((req.body && req.body.kind) || '');
      const recordId = String((req.body && req.body.record_id) || '');
      const note = (req.body && req.body.note) ? String(req.body.note).slice(0, 1000) : null;
      const viaEmailRaw = (req.body && req.body.via_email) ? String(req.body.via_email).trim() : '';

      if (!own.TAKEOVER_KINDS.includes(kind)) {
        return res.status(400).json({ error: 'bad_kind', reason: 'That kind of record cannot be taken over.' });
      }
      if (!recordId) return res.status(404).json(NOT_FOUND);

      const record = await loadRecord(req, kind, recordId);
      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

      // D-0038: only a route may set this, only after verifying the typed
      // email is really on this lead. Lead-only; ignored for client/job_order.
      let viaDuplicateEmailMatch = false;
      if (kind === 'lead' && record && viaEmailRaw) {
        viaDuplicateEmailMatch = await emailMatchesLead(req, recordId, viaEmailRaw);
      }

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

      const { usersById, adminIds } = await orgUsers(orgId);
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
      res.status(201).json({ request: shapeRequest(inserted, viewer, usersById) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /ownership-requests?box=mine|waiting|record ─────────────────────
  router.get('/ownership-requests', auth, async (req, res) => {
    try {
      const box = String(req.query.box || 'mine');
      const orgId = orgIdFor(req);
      const isAdmin = hasRole(req, 'admin');
      const D = db.forRequest(req);
      const { usersById, adminIds } = await orgUsers(orgId);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };

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
        const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgId);
        const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
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

      res.json({
        requests: rows.map(r => shapeRequest(r, viewer, usersById)),
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

  async function isActiveOrgUser(userId, orgId) {
    const { data } = await supabase.from('users').select('id,is_active,deleted_at,org_id').eq('id', userId).maybeSingle();
    if (!data || data.deleted_at || data.is_active === false) return false;
    if (orgId && data.org_id && data.org_id !== orgId) return false;
    return true;
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

      if (!(await isActiveOrgUser(row.requester_id, orgId))) {
        return res.status(409).json({ error: 'requester_inactive', reason: 'The person who asked is no longer active in this organisation, so this request cannot be approved.' });
      }
      const { record, ownerId: liveOwnerId } = await currentOwnerOf(req, row.record_kind, row.record_id);
      if (!record) return res.status(404).json(NOT_FOUND);
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

      // ── the reassignment, through the existing paths ──────────────────
      const moved = {};
      if (row.record_kind === 'lead') {
        const r = await reassignLead(req, row.record_id, row.requester_id, row.current_owner_id);
        moved.lead = { id: row.record_id, mailbox_assigned: r.mailboxAssigned };
      } else if (row.record_kind === 'job_order') {
        await db.forRequest(req).from('job_orders')
          .update({ bd_manager_id: row.requester_id, updated_at: now }).eq('id', row.record_id);
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
        for (const jo of (jos || [])) {
          await db.forRequest(req).from('job_orders').update({ bd_manager_id: row.requester_id, updated_at: now }).eq('id', jo.id);
        }
        const leadResults = [];
        for (const ld of (leads || [])) {
          const r = await reassignLead(req, ld.id, row.requester_id, oldOwner);
          leadResults.push({ id: ld.id, mailbox_assigned: r.mailboxAssigned });
        }
        await history.record(req, 'company', companyId, {
          action: 'ownership_transfer', field: 'owner',
          from: oldOwner, to: row.requester_id,
          note: `Take-over request approved — moved ${(jos || []).length} job order(s) and ${leadResults.length} lead(s)`,
        });
        moved.client = { company_id: companyId, job_orders_moved: (jos || []).length, leads_moved: leadResults, other_owners_untouched: true };
      }

      const { usersById } = await orgUsers(orgId);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      res.json({ request: shapeRequest(updated, viewer, usersById), moved });
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

      const { usersById } = await orgUsers(orgId);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      res.json({ request: shapeRequest(updated, viewer, usersById) });
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

      const { usersById } = await orgUsers(orgId);
      const viewer = { id: req.user.id, roles: req.user.roles || req.user.role, orgId };
      res.json({ request: shapeRequest(updated, viewer, usersById) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
