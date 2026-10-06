// ============================================================================
// SEARCH EVERYTHING — the box in the sky header (R-123).
// ----------------------------------------------------------------------------
// GET /search?q=  →  { q, candidates, leads, jobs, clients }, up to 5 of each.
//
// THE RULE: a search shows NOTHING its lists would not. Every kind applies the
// same gate as the list that owns it, narrowed in SQL BEFORE the limit (a
// limit-then-filter would hide a visible match behind invisible ones):
//   candidates — the shared pool (GET /candidates): the person's org; offered
//                to the recruiting desks only (BD desk, recruiter), the people
//                whose menu has Candidates.
//   leads      — D-0034 (GET /jobs): own + reporting chain, the pool only for
//                POOL_ROLES, the org for admin. SQL narrows by the owner ids,
//                then ownership.canSeeLead re-checks every row.
//   jobs       — GET /job-orders: a BD desk sees the org's job orders, a pure
//                recruiter only the ones they are assigned to.
//   clients    — GET /clients: BD desk only; a company counts as a client when
//                it has a job order.
// Matches: candidates by name / email / phone / code / title; leads by position,
// company name, or a contact's name / email; jobs by title / code / client;
// clients by name. Through models/ (db.forRequest) — org-scoped by
// construction.
// ============================================================================
const express = require('express');
const own = require('../services/ownership');

const PER_KIND = 5;

// Typed text → a safe ilike needle. The PostgREST or() grammar uses , ( ) and
// the pattern uses % _ *; none of them is something a person searches for.
function cleanQuery(raw) {
  const q = String(raw || '').replace(/[,()%*_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return q.length >= 2 ? q : '';
}

module.exports = (ctx) => {
  const router = express.Router();
  const { db, auth, hasRole, orgIdFor, reportingChainIds } = ctx;

  const isBDDesk = (req) => hasRole(req, 'admin', 'bd', 'bd_lead', 'associate_director', 'director');
  const isRecruiter = (req) => hasRole(req, 'recruiter');
  const isClientDesk = (req) => hasRole(req, 'admin', 'bd', 'bd_lead');

  async function leadScope(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }
  // The D-0034 lead rule as SQL, so the narrowing happens before .limit().
  function leadScopeOr(scope) {
    if (scope.all) return null;
    const ids = (scope.ownerIds || []).filter(Boolean).join(',');
    if (!ids) return 'id.is.null'; // matches nothing — a null scope sees nothing
    const parts = [`assigned_to_bd.in.(${ids})`, `created_by.in.(${ids})`, `assigned_to.in.(${ids})`];
    if (scope.seesPool) parts.push('assigned_to_bd.is.null');
    return parts.join(',');
  }

  async function searchCandidates(req, q) {
    if (!isBDDesk(req) && !isRecruiter(req)) return [];
    const { data, error } = await db.forRequest(req).from('candidates')
      .select('id,full_name,current_title,email,candidate_code')
      .is('deleted_at', null)
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,candidate_code.ilike.%${q}%,current_title.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(PER_KIND);
    if (error) throw error;
    return (data || []).map(c => ({
      id: c.id, title: c.full_name || c.email || c.candidate_code,
      sub: [c.current_title, c.candidate_code].filter(Boolean).join(' · '),
    }));
  }

  async function searchLeads(req, q) {
    const scope = await leadScope(req);
    const scopeOr = leadScopeOr(scope);
    const cols = 'id,position,location,stage,assigned_to_bd,created_by,assigned_to,company:companies(name)';
    const leadsWhere = (build) => {
      let x = build(db.forRequest(req).from('jobs').select(cols).is('deleted_at', null));
      if (scopeOr) x = x.or(scopeOr);
      return x.order('created_at', { ascending: false }).limit(PER_KIND);
    };
    const s = db.forRequest(req);
    const [byPos, cos, cts] = await Promise.all([
      leadsWhere(x => x.ilike('position', `%${q}%`)),
      s.from('companies').select('id').is('deleted_at', null).ilike('name', `%${q}%`).limit(25),
      s.from('contacts').select('job_id,first_name,last_name,email')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`).limit(25),
    ]);
    for (const r of [byPos, cos, cts]) if (r.error) throw r.error;
    const companyIds = (cos.data || []).map(c => c.id);
    const contactByJob = {};
    (cts.data || []).forEach(c => { if (c.job_id && !contactByJob[c.job_id]) contactByJob[c.job_id] = c; });
    const contactJobIds = Object.keys(contactByJob);
    const [byCo, byContact] = await Promise.all([
      companyIds.length ? leadsWhere(x => x.in('company_id', companyIds)) : { data: [] },
      contactJobIds.length ? leadsWhere(x => x.in('id', contactJobIds)) : { data: [] },
    ]);
    for (const r of [byCo, byContact]) if (r.error) throw r.error;
    const seen = new Set(); const out = [];
    for (const j of [...(byPos.data || []), ...(byCo.data || []), ...(byContact.data || [])]) {
      if (out.length >= PER_KIND) break;
      if (seen.has(j.id) || !own.canSeeLead(j, scope)) continue; // the list's own rule, again
      seen.add(j.id);
      const c = contactByJob[j.id];
      const who = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email : null;
      out.push({
        id: j.id, title: [j.position, j.company && j.company.name].filter(Boolean).join(' · '),
        sub: [who, j.location, j.stage].filter(Boolean).join(' · '),
      });
    }
    return out;
  }

  async function searchJobs(req, q) {
    const bd = isBDDesk(req);
    if (!bd && !isRecruiter(req)) return [];
    let query = db.forRequest(req).from('job_orders').select('id,job_code,job_title,client,status')
      .is('deleted_at', null)
      .or(`job_title.ilike.%${q}%,job_code.ilike.%${q}%,client.ilike.%${q}%`);
    if (!bd) { // a pure recruiter: only the jobs they are on (GET /job-orders)
      const { data: as, error: aErr } = await db.forRequest(req).from('recruiter_assignments')
        .select('job_order_id').eq('recruiter_id', req.user.id);
      if (aErr) throw aErr;
      const ids = [...new Set((as || []).map(a => a.job_order_id))];
      if (!ids.length) return [];
      query = query.in('id', ids);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(PER_KIND);
    if (error) throw error;
    return (data || []).map(j => ({
      id: j.id, title: j.job_title || j.job_code,
      sub: [j.job_code, j.client, j.status].filter(Boolean).join(' · '),
    }));
  }

  async function searchClients(req, q) {
    if (!isClientDesk(req)) return [];
    const { data: cos, error } = await db.forRequest(req).from('companies')
      .select('id,name,industry,location').is('deleted_at', null).ilike('name', `%${q}%`).limit(25);
    if (error) throw error;
    const ids = (cos || []).map(c => c.id);
    if (!ids.length) return [];
    const { data: jos, error: jErr } = await db.forRequest(req).from('job_orders')
      .select('company_id').is('deleted_at', null).in('company_id', ids);
    if (jErr) throw jErr;
    const isClient = new Set((jos || []).map(j => j.company_id));
    return (cos || []).filter(c => isClient.has(c.id)).slice(0, PER_KIND)
      .map(c => ({ id: c.id, title: c.name, sub: [c.industry, c.location].filter(Boolean).join(' · ') }));
  }

  router.get('/search', auth, async (req, res) => {
    const q = cleanQuery(req.query.q);
    if (!q) return res.json({ q: '', candidates: [], leads: [], jobs: [], clients: [] });
    try {
      // One kind failing must not blank the others — it says so instead.
      const kinds = ['candidates', 'leads', 'jobs', 'clients'];
      const runs = await Promise.allSettled([searchCandidates(req, q), searchLeads(req, q), searchJobs(req, q), searchClients(req, q)]);
      const out = { q };
      const failed = [];
      runs.forEach((r, i) => { out[kinds[i]] = r.status === 'fulfilled' ? r.value : []; if (r.status === 'rejected') failed.push(kinds[i]); });
      if (failed.length) out.failed = failed;
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
module.exports.cleanQuery = cleanQuery;
