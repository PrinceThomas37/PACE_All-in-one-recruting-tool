// ============================================================================
// LOOKUPS — small form-support endpoints used by the RA job-entry form:
// industry list, US zip-code → city/state, and the recent-duplicate email check.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/lookups')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const { fetchWithRetry } = require('../http-client');
const own = require('../services/ownership');

// Zip lookup fires per keystroke from the autocomplete, so it gets a short
// budget — a slow third party must never hold an app request handler open.
const ZIP_TIMEOUT_MS = 5000;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, INDUSTRIES } = ctx;
  // `reportingChainIds` arrives on ctx (gateway added it to routeCtx), but
  // fall back to requiring it directly so this file still works if it's ever
  // mounted with a narrower ctx — same guard workflows.js and wf.js use.
  const { reportingChainIds } = ctx.reportingChainIds ? ctx : require('../hierarchy')(supabase);

router.get('/industries', auth, (req, res) => res.json(INDUSTRIES));

router.get('/lookup/zipcode', auth, async (req, res) => {
  try {
    const { zip } = req.query;
    if (!zip || zip.length < 3) return res.json([]);
    const resp = await fetchWithRetry(`https://api.zippopotam.us/us/${encodeURIComponent(zip.trim())}`, {}, { timeoutMs: ZIP_TIMEOUT_MS, retries: 1 });
    if (!resp.ok) return res.json([]);
    const data = await resp.json();
    const places = (data.places || []).map(p => ({
      zip: data['post code'], city: p['place name'], state: p['state'],
      state_abbr: p['state abbreviation'],
      display: `${p['place name']}, ${p['state abbreviation']} ${data['post code']}`
    }));
    res.json(places);
  } catch (err) { res.json([]); }
});

// D-0035 (D5, the owner's answer to "what does showing the other BD's contact
// details mean?"): a duplicate answers with WHOSE lead it is and SINCE WHEN —
// never that lead's own contact's name, its company, or its id, and never
// another org's. This used to have no org filter at all (any authenticated
// user could probe any org's contacts by email) and returned
// `contact_name`/`position`, which the one caller (`52-poc-block.js`
// `_pocNoteHTML`) has never actually rendered — it reads `added_by`, a field
// this endpoint never sent, so "added by <name>" has been silently dead since
// it shipped. Fixed as one change: whose lead (the lead's OWNER, D-0020's
// `assigned_to_bd`), not the contact who was found and not the client's name.
// R-047 (rampart, do-not-ship blocker): `company` and `lead_id` used to ride
// along too — D5 says owner + date only, and a lead id handed to someone who
// cannot see the lead is the exact hole this territory keeps closing.
// Gateway's `/ownership-requests` route resolves the lead from the typed
// email itself (D-0038's `viaDuplicateEmailMatch`), org-scoped, server-side —
// never from an id a browser hands back. `can_request` is computed with the
// SAME rule the take-over route enforces (`canRequestTakeover`,
// viaDuplicateEmailMatch: true) so an RA, a recruiter or an admin never sees a
// link that then refuses (R-047 F2).
router.post('/contacts/check-email', auth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ duplicate: false });
    const twoMonthsAgo = new Date(); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    let q = supabase.from('contacts')
      .select('id,created_at,job:jobs(id,org_id,deleted_at,assigned_to_bd,owner:users!assigned_to_bd(id,name))')
      .eq('email', email.toLowerCase().trim()).gte('created_at', twoMonthsAgo.toISOString()).limit(1);
    if (req.orgId) q = q.eq('org_id', req.orgId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) return res.json({ duplicate: false });
    const c = data[0];
    const daysSince = Math.floor((new Date() - new Date(c.created_at)) / 86400000);
    const job = c.job || {};
    const chain = await reportingChainIds(req.user.id, req.orgId || null);
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
    const requester = { id: req.user.id, role: req.user.role, roles: req.user.roles, org_id: req.orgId };
    const canReq = job.id
      ? own.canRequestTakeover({ kind: 'lead', record: job, requester, scope, viaDuplicateEmailMatch: true })
      : { ok: false };
    res.json({
      duplicate: true, days_ago: daysSince,
      added_by: (job.owner && job.owner.name) || null,
      can_request: canReq.ok,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
