// ============================================================================
// COMPANIES
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/companies')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, withOrg, orgStamp } = ctx;

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
    const { name, website, industry, location, size, notes } = req.body;
    const updates = { updated_at: new Date() };
    if (name !== undefined) updates.name = name;
    if (website !== undefined) updates.website = website;
    if (industry !== undefined) updates.industry = industry;
    if (location !== undefined) updates.location = location;
    if (size !== undefined) updates.size = size;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase.from('companies').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/companies/:id', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    await supabase.from('companies').update({ deleted_at: new Date() }).eq('id', req.params.id);
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
router.get('/companies/:id/contacts', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data: jobs } = await withOrg(supabase.from('jobs').select('id').eq('company_id', req.params.id).is('deleted_at', null), req);
    const jobIds = (jobs || []).map(j => j.id);
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
router.get('/companies/:id/email-activity', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data } = await withOrg(supabase.from('email_tracking')
      .select('id,to_email,subject,sent_at,opened_at,open_count,replied_at')
      .eq('company_id', req.params.id).order('sent_at', { ascending: false }).limit(20), req);
    res.json(data || []);
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

router.get('/companies/:id/documents', auth, async (req, res) => {
  try {
    if (!isBDlike(req)) return res.status(403).json({ error: 'BD role required.' });
    const { data, error } = await supabase.from('client_documents')
      .select('*, uploader:users!uploaded_by(id,name,employee_id)')
      .eq('company_id', req.params.id).is('deleted_at', null).order('uploaded_at', { ascending: false });
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
    const { data: doc } = await supabase.from('client_documents')
      .select('storage_path').eq('id', req.params.docId).eq('company_id', req.params.id).maybeSingle();
    await supabase.from('client_documents').update({ deleted_at: new Date() })
      .eq('id', req.params.docId).eq('company_id', req.params.id);
    if (doc && doc.storage_path) { try { await supabase.storage.from(CLIENT_DOC_BUCKET).remove([doc.storage_path]); } catch (_) {} }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
