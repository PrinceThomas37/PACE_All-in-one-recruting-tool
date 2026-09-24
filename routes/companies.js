// ============================================================================
// COMPANIES
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/companies')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const clientResolve = require('../services/client-resolve');
const companyCooldown = require('../services/company-cooldown');
const companyMerge = require('../services/company-merge');
const { getSetting } = require('../config/settings');
const own = require('../services/ownership');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, withOrg, orgStamp, orgIdFor } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  // ── D-0035 (owner's answer to D2): every BD SEES every client; only the
  // client's OWNER (or admin) may ACT on it — edit, delete, its documents, its
  // email (routes/recruiting/outreach.js — guild's). "Owner of a client" is
  // read off the data, not stored: the BD who runs its job order(s)
  // (job_orders.bd_manager_id) takes precedence — that is the desk actually
  // working it once real recruiting has started — else the BD who owns its
  // lead(s) (jobs.assigned_to_bd), else whoever created the company record.
  // Where several leads/job orders at one company have different owners, the
  // most recently created one wins; a formal "several owners" tie-break is not
  // asked for and is not built.
  // The ladder itself is `own.clientOwnerFrom()` now (services/ownership.js) —
  // the ONE place it lives, per D-0037's "TAKING OVER" section. This function
  // is just the three queries that feed it; if the ladder ever changes it
  // changes there, and this and routes/ownership-requests.js agree by
  // construction rather than by two copies staying in sync.
  async function clientOwnerId(req, companyId) {
    const { data: co } = await withOrg(supabase.from('companies')
      .select('id,created_by').eq('id', companyId), req).maybeSingle();
    if (!co) return null;
    const { data: jos } = await withOrg(supabase.from('job_orders')
      .select('bd_manager_id,created_at,company_id,deleted_at').eq('company_id', companyId), req);
    const { data: leads } = await withOrg(supabase.from('jobs')
      .select('assigned_to_bd,created_at,company_id,deleted_at').eq('company_id', companyId), req);
    return own.clientOwnerFrom({ company: co, jobOrders: jos || [], leads: leads || [] });
  }

  // Loads the company (org-scoped, 404 if foreign/missing) and, unless the
  // caller is admin or the owner, sends a 403 naming whose client it is —
  // same idea as D-0020's closeRefusal: never a bare, unexplained refusal.
  // Returns the company row on success, or null after already responding.
  async function requireClientOwner(req, res, companyId) {
    const { data: co } = await withOrg(supabase.from('companies')
      .select('*').eq('id', companyId).is('deleted_at', null), req).maybeSingle();
    if (!co) { res.status(404).json({ error: 'Not found' }); return null; }
    if (hasRole(req, 'admin')) return co;
    const ownerId = await clientOwnerId(req, companyId);
    if (ownerId && ownerId === req.user.id) return co;
    let ownerName = null;
    if (ownerId) {
      const { data: u } = await supabase.from('users').select('name').eq('id', ownerId).maybeSingle();
      ownerName = u && u.name;
    }
    res.status(403).json({
      error: ownerName
        ? `This client belongs to ${ownerName}, so it is not yours to change. Ask them, or your manager can reassign it.`
        : 'This client is not yours to change. Ask its owner, or your manager can reassign it.',
    });
    return null;
  }

router.get('/companies', auth, async (req, res) => {
  try {
    const { data, error } = await withOrg(supabase.from('companies').select('*').is('deleted_at', null).order('name'), req);
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/companies/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const { data, error } = await withOrg(supabase.from('companies')
      .select('id,name,industry,location,website').ilike('name', `%${q}%`).is('deleted_at', null).limit(8), req);
    if (error) throw error;
    const result = await Promise.all((data || []).map(async co => {
      const { count } = await withOrg(supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('company_id', co.id).is('deleted_at', null), req);
      return { ...co, job_count: count || 0 };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies/bulk', auth, async (req, res) => {
  try {
    const { companies } = req.body;
    if (!Array.isArray(companies) || !companies.length) return res.status(400).json({ error: 'companies array required' });
    const rows = companies.map(c => ({ name: c.name, website: c.website || null, industry: c.industry || null, location: c.location || null, created_by: req.user.id, ...orgStamp(req) }));
    const { data, error } = await supabase.from('companies').insert(rows).select('id,name');
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies', auth, async (req, res) => {
  try {
    const { name, website, industry, location, size, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Company name required' });
    const { data, error } = await supabase.from('companies').insert({ name, website, industry, location, size, notes, created_by: req.user.id, ...orgStamp(req) }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/companies/:id', auth, async (req, res) => {
  try {
    const co = await requireClientOwner(req, res, req.params.id);
    if (!co) return; // requireClientOwner already answered (404 foreign/missing, 403 not-yours)
    const { name, website, industry, location, size, notes } = req.body;
    const updates = { updated_at: new Date() };
    if (name !== undefined) updates.name = name;
    if (website !== undefined) updates.website = website;
    if (industry !== undefined) updates.industry = industry;
    if (location !== undefined) updates.location = location;
    if (size !== undefined) updates.size = size;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await withOrg(supabase.from('companies').update(updates).eq('id', req.params.id), req).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/companies/:id', auth, async (req, res) => {
  try {
    // Rampart review (2026-09-24, item #5): D-0035 lists edit, documents,
    // email and contacts as owner actions — DELETE is not one of them. An
    // owner falling back to `companies.created_by` (which can be an RA) let
    // one person soft-delete a client colleagues still hold live leads on.
    // Admin-only, as it was before this session's widening.
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin role required.' });
    const { data: exists } = await withOrg(supabase.from('companies')
      .select('id').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { data, error } = await withOrg(supabase.from('companies')
      .update({ deleted_at: new Date() }).eq('id', req.params.id), req).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Clients — companies with at least one job order, i.e. leads that
// actually converted into paying business. BD/admin only; recruiters don't
// get this tab (they work candidates, not client relationships).
function isBDlike(req) { return hasRole(req, 'admin', 'bd', 'bd_lead'); }

router.get('/clients', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data: jobOrders, error: jErr } = await withOrg(supabase.from('job_orders')
      .select('id,company_id,status,created_at').is('deleted_at', null).not('company_id', 'is', null), req);
    if (jErr) throw jErr;
    const companyIds = [...new Set((jobOrders || []).map(j => j.company_id).filter(Boolean))];
    if (!companyIds.length) return res.json([]);
    const { data: companies, error: cErr } = await withOrg(supabase.from('companies')
      .select('id,name,industry,location,website').is('deleted_at', null).in('id', companyIds), req);
    if (cErr) throw cErr;
    const countByCompany = {}, openByCompany = {};
    (jobOrders || []).forEach(j => {
      countByCompany[j.company_id] = (countByCompany[j.company_id] || 0) + 1;
      if (!['Filled', 'Closed'].includes(j.status)) openByCompany[j.company_id] = (openByCompany[j.company_id] || 0) + 1;
    });
    const result = (companies || []).map(c => ({
      ...c, job_order_count: countByCompany[c.id] || 0, open_job_order_count: openByCompany[c.id] || 0
    })).sort((a, b) => (b.job_order_count - a.job_order_count) || a.name.localeCompare(b.name));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/companies/:id/job-orders', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data, error } = await withOrg(supabase.from('job_orders')
      .select('id,job_code,job_title,status,priority,created_at,bd_manager:users!bd_manager_id(id,name)')
      .eq('company_id', req.params.id).is('deleted_at', null), req).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Points of contact for a client — the contacts on this company's leads,
// deduped by email (primaries first). Powers the "To" dropdown on the client
// email compose.
// Everything the "+ New Job" form needs to know about a client the moment one
// is picked, in ONE round trip: is this company inside its re-add cooldown, who
// do we already talk to there, and what address do we hold.
//
// It exists as one endpoint rather than three because all three answers are
// wanted at the same instant — when a name is chosen from the picker — and
// because the cooldown has to be shown THEN. Learning at Save that the company
// was blocked, after twenty fields are filled, is the failure CLAUDE.md names:
// a rule that decides whether an action is allowed belongs where the action is
// offered, not only where it is taken.
// ── MERGING A DUPLICATE CLIENT INTO THIS ONE ────────────────────────────────
// Since Session 26 a BD can create a client by typing its name, so near
// duplicates accumulate. The resolver never merges two names by itself — a job
// order silently filed under the wrong client shows no error anywhere — so the
// judgement is a person's and these two endpoints are how they make it.
//
// The PREVIEW and the MERGE take the same path to the same counts, so what the
// screen promised and what the button does cannot be two different things.
async function mergeContext(req, sourceId, targetId) {
  const load = async (id) => {
    const { data } = await withOrg(supabase.from('companies')
      .select('id,name').eq('id', id).is('deleted_at', null), req).limit(1);
    return (data && data[0]) || null;
  };
  const [source, target] = await Promise.all([load(sourceId), load(targetId)]);
  if (!source || !target) return { error: 'Client not found.', status: 404 };
  const counts = {};
  for (const t of companyMerge.MERGE_TABLES) {
    // head:true counts without pulling the rows. withOrg is what stops this
    // counting — or later moving — another org's records.
    const { count } = await withOrg(supabase.from(t.table)
      .select('id', { count: 'exact', head: true }).eq('company_id', source.id), req);
    counts[t.table] = count || 0;
  }
  return { source, target, counts };
}

router.get('/companies/:id/merge-preview', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const sourceId = req.query.from;
    const inputError = companyMerge.mergeInputError({ sourceId, targetId: req.params.id });
    if (inputError) return res.status(400).json({ error: inputError });
    const ctx = await mergeContext(req, sourceId, req.params.id);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    res.json({
      source: ctx.source, target: ctx.target, counts: ctx.counts,
      total: companyMerge.totalMoving(ctx.counts),
      sentence: companyMerge.describePlan(ctx.counts, { sourceName: ctx.source.name, targetName: ctx.target.name }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies/:id/merge', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const sourceId = (req.body || {}).from;
    const inputError = companyMerge.mergeInputError({ sourceId, targetId: req.params.id });
    if (inputError) return res.status(400).json({ error: inputError });
    // Rampart review item #2: a merge re-points every job/lead/contact/document
    // at BOTH companies and then deletes one — gate it the same as any other
    // D-0035 write. Owner-or-admin on the SOURCE (being folded away) and the
    // TARGET (absorbing everything); admin passes both.
    const srcOwned = await requireClientOwner(req, res, sourceId);
    if (!srcOwned) return;
    const tgtOwned = await requireClientOwner(req, res, req.params.id);
    if (!tgtOwned) return;
    const ctx = await mergeContext(req, sourceId, req.params.id);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    // ORDER MATTERS. Re-point everything FIRST, soft-delete the duplicate LAST.
    // If a move fails half way, the duplicate still exists and still owns what
    // did not move — recoverable. Deleting first and then failing to move would
    // orphan rows against a record the app no longer shows.
    const moved = {};
    for (const t of companyMerge.MERGE_TABLES) {
      if (!ctx.counts[t.table]) { moved[t.table] = 0; continue; }
      const { error } = await withOrg(supabase.from(t.table)
        .update({ company_id: ctx.target.id }).eq('company_id', ctx.source.id), req);
      if (error) throw new Error(`moving ${t.plural} failed: ${error.message}`);
      moved[t.table] = ctx.counts[t.table];
    }

    // The record of what happened, BEFORE the soft delete, so it exists even if
    // that write fails. `app_settings` rather than a new table — the same
    // reasoning as the AI meter and the dismissal store. A merge is hard to
    // undo from the UI, so what moved has to be readable from the database.
    try {
      await supabase.from('app_settings').upsert({
        key: 'company_merge_' + ctx.source.id,
        value: JSON.stringify({
          merged_at: new Date().toISOString(), by: req.user.id,
          source: ctx.source, target_id: ctx.target.id, target_name: ctx.target.name, moved,
        }),
      }, { onConflict: 'key' });
    } catch (e) { console.warn('[companies] merge record not written:', e.message); }

    const { error: delErr } = await withOrg(supabase.from('companies')
      .update({ deleted_at: new Date(), updated_at: new Date() }).eq('id', ctx.source.id), req);
    if (delErr) throw delErr;

    res.json({
      merged: true, moved, total: companyMerge.totalMoving(moved),
      source: ctx.source, target: ctx.target,
      message: `“${ctx.source.name}” was merged into “${ctx.target.name}”.`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/companies/:id/intake', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    // withOrg is what keeps this from being a probe for another org's clients.
    const { data: co } = await withOrg(supabase.from('companies')
      .select('id,name,location,' + clientResolve.ADDRESS_FIELDS.join(','))
      .eq('id', req.params.id).is('deleted_at', null), req).limit(1);
    if (!co || !co.length) return res.status(404).json({ error: 'Client not found.' });
    const company = co[0];

    const { data: leads } = await withOrg(supabase.from('jobs')
      .select('id,position,created_at,assigned_to_bd,created_by,assigned_to,users:users!created_by(name)')
      .eq('company_id', company.id).is('deleted_at', null), req)
      .order('created_at', { ascending: false });
    const rows = leads || [];
    const last = rows[0];

    const days = await getSetting(supabase, 'company_cooldown_days');
    const state = companyCooldown.cooldownState({
      lastLeadAt: last && last.created_at, now: new Date(), days,
    });

    // D-0035/D5 (rampart review #4): a POC belongs to its lead (D-0020), so a
    // BD sees another BD's client contact only when that BD's leads are in
    // the viewer's own scope — not every lead at the client. Admin sees all.
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    const visibleRows = rows.filter(r => own.canSeeLead(r, scope));

    // The POCs already known at this client, across the leads the viewer may
    // see, newest first and de-duplicated by address — so a BD picks a name
    // instead of retyping one PACE already holds.
    let contacts = [];
    if (visibleRows.length) {
      const { data: cs } = await supabase.from('contacts')
        .select('first_name,last_name,email,designation,phone,linkedin,is_primary,created_at')
        .in('job_id', visibleRows.map(r => r.id)).order('created_at', { ascending: false });
      const seen = {};
      (cs || []).forEach(c => {
        const em = (c.email || '').toLowerCase().trim();
        if (!em || seen[em]) return;
        seen[em] = true;
        contacts.push({
          first_name: c.first_name || '', last_name: c.last_name || '',
          email: c.email, designation: c.designation || null,
          phone: c.phone || null, linkedin: c.linkedin || null, is_primary: !!c.is_primary,
        });
      });
      contacts.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
    }

    const address = {};
    clientResolve.ADDRESS_FIELDS.forEach(k => { if (company[k]) address[k] = company[k]; });

    res.json({
      id: company.id,
      name: company.name,
      location: company.location || null,
      address,
      lead_count: rows.length,
      contacts,
      // `blocked` is the answer the form acts on; the sentence is what it shows.
      cooldown: state
        ? {
            blocked: true, days_left: state.daysLeft, days_ago: state.daysAgo,
            sentence: companyCooldown.cooldownSentence(state, {
              company: company.name, position: last.position,
              addedBy: last.users && last.users.name,
            }),
          }
        : { blocked: false },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/companies/:id/contacts', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    // D-0035/D5 (rampart review #4): a POC is seen with its lead (D-0020) —
    // another BD's contacts at the same client are not shown here either.
    const { data: jobs } = await withOrg(supabase.from('jobs')
      .select('id,assigned_to_bd,created_by,assigned_to').eq('company_id', req.params.id).is('deleted_at', null), req);
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    const jobIds = (jobs || []).filter(j => own.canSeeLead(j, scope)).map(j => j.id);
    if (!jobIds.length) return res.json([]);
    const { data: contacts } = await supabase.from('contacts')
      .select('id,first_name,last_name,email,designation,phone,is_primary').in('job_id', jobIds);
    const seen = {}, out = [];
    (contacts || []).forEach(c => {
      const em = (c.email || '').toLowerCase().trim();
      if (!em || seen[em]) return; seen[em] = true;
      out.push({ id: c.id, name: ((c.first_name || '') + ' ' + (c.last_name || '')).trim(), email: c.email, designation: c.designation || null, phone: c.phone || null, is_primary: !!c.is_primary });
    });
    out.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recent tracked emails to this client (from email_tracking, stamped with
// company_id on POST /companies/:id/email). Powers the "Recent emails" card +
// per-row Reply.
// C-0021 #6 / D-0035: the client (and its email envelope — who/when/opened) is
// visible to every BD, same as the client record itself. Only the email BODY
// is the sender's own correspondence — visible to the sender's scope (self +
// reporting chain, or admin), same split tracking.js uses for a candidate's
// activity. Masked per row, not dropped, so the "who emailed this client and
// when" history stays intact for everyone who can see the client.
router.get('/companies/:id/email-activity', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data } = await withOrg(supabase.from('email_tracking')
      .select('id,to_email,subject,body,sent_at,opened_at,open_count,replied_at,sent_by')
      .eq('company_id', req.params.id).order('sent_at', { ascending: false }).limit(20), req);
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    const rows = (data || []).map((r) => {
      const visible = own.canSeeEmail(r, null, scope);
      const { sent_by, body, ...rest } = r;
      return visible
        ? { ...rest, body, body_visible: true }
        // NOT the same null as "sent before PACE kept a copy" (migration 042) —
        // surface must tell the two apart (see gateway's C-0021 report) or a
        // withheld body will be mis-shown as one this app never stored.
        : { ...rest, body: null, body_visible: false, body_note: 'Sent by a colleague. Only the sender, whoever they report to and an admin can read what it said.' };
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Client documents (stored in the same private candidate-docs bucket,
// under a client/<company_id>/... path prefix) ──────────────────────────────
const CLIENT_DOC_BUCKET = 'candidate-docs';
const MAX_CLIENT_DOC_BYTES = 4.5 * 1024 * 1024;
let _clientBucketEnsured = false;
async function ensureClientDocBucket() {
  if (_clientBucketEnsured) return;
  try { await supabase.storage.createBucket(CLIENT_DOC_BUCKET, { public: false }); } catch (_) { /* exists */ }
  _clientBucketEnsured = true;
}

// D-0035: documents are visible to everyone who can see the client (same as
// the client record) — only upload/delete are owner-gated, below.
router.get('/companies/:id/documents', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data, error } = await withOrg(supabase.from('client_documents')
      .select('*, uploader:users!uploaded_by(id,name,employee_id)')
      .eq('company_id', req.params.id).is('deleted_at', null), req).order('uploaded_at', { ascending: false });
    if (error) throw error;
    const rows = await Promise.all((data || []).map(async (d) => {
      let url = null;
      try {
        const { data: s } = await supabase.storage.from(CLIENT_DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
        url = s ? s.signedUrl : null;
      } catch (_) { /* leave null */ }
      return Object.assign({}, d, { url });
    }));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/companies/:id/documents', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    // D-0035: uploading onto a client is an ACTION — its owner or admin only.
    // Also closes X5's "POST onto a foreign company": requireClientOwner 404s
    // a company outside the caller's org before any file is written.
    const co = await requireClientOwner(req, res, req.params.id);
    if (!co) return;
    const b = req.body || {};
    if (!b.filename || !b.data_base64) return res.status(400).json({ error: 'filename and data_base64 required' });
    const raw = String(b.data_base64).replace(/^data:.*;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'empty file' });
    if (buffer.length > MAX_CLIENT_DOC_BYTES) return res.status(413).json({ error: 'File too large (max ~4.5 MB).' });

    await ensureClientDocBucket();
    const safe = String(b.filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    const path = 'client/' + req.params.id + '/' + Date.now() + '-' + safe;
    const { error: upErr } = await supabase.storage.from(CLIENT_DOC_BUCKET)
      .upload(path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
    if (upErr) throw upErr;

    const { data, error } = await supabase.from('client_documents').insert({
      company_id: req.params.id, doc_type: b.doc_type || 'other', filename: String(b.filename),
      storage_path: path, content_type: b.content_type || null, size_bytes: buffer.length,
      uploaded_by: req.user.id, ...orgStamp(req)
    }).select('*, uploader:users!uploaded_by(id,name,employee_id)').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/companies/:id/documents/:docId', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    // D-0035: deleting a client's document is owner-or-admin, same as upload.
    const co = await requireClientOwner(req, res, req.params.id);
    if (!co) return;
    const { data: doc } = await withOrg(supabase.from('client_documents')
      .select('storage_path').eq('id', req.params.docId).eq('company_id', req.params.id), req).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    await withOrg(supabase.from('client_documents').update({ deleted_at: new Date() })
      .eq('id', req.params.docId).eq('company_id', req.params.id), req);
    if (doc.storage_path) { try { await supabase.storage.from(CLIENT_DOC_BUCKET).remove([doc.storage_path]); } catch (_) {} }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
