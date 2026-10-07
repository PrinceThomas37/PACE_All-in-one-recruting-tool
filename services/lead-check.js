// ============================================================================
// CAN THIS COMPANY BE ADDED? — the database half. The RULE is services/lead-decision.js
// (pure); this file only loads what the rule needs, for ONE organisation:
//
//   the companies that might be the same one (by website, LinkedIn page, name or id),
//   the live leads on them, their open job orders, and the people's names.
//
// Everything goes through db.forRequest(req), so another organisation's companies
// are never loaded and never matched — a company in a different organisation does not
// exist for this caller (D-0090: nothing is shared between customers).
//
// Used by: POST /lead-check (what a screen shows BEFORE the person acts) and the two
// places a lead is actually created from outside the manual form — approving a sourced
// lead and POST /jobs — so a rule decided here is enforced where the action is taken
// as well as where it is offered.
// ============================================================================
const rule = require('./lead-decision');
const { getSetting } = require('../config/settings');

// Learned once per process: does `companies.linkedin_url` exist (migration 057)? Until the
// migration is applied the LinkedIn match simply has no data, and nothing else changes.
let hasLinkedInColumn = null;
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

async function load(scoped, candidate) {
  const found = new Map();
  const take = (rows) => (rows || []).forEach((r) => { if (r && r.id && !found.has(r.id)) found.set(r.id, r); });
  const columns = () => (hasLinkedInColumn === false ? 'id,name,website' : 'id,name,website,linkedin_url');
  // One company query. A missing linkedin_url column is learned and retried; any other failure is
  // THROWN — a duplicate check that silently found nothing would wave a duplicate through.
  async function query(build) {
    let r = await build(columns());
    if (r.error && hasLinkedInColumn !== false && /linkedin_url/i.test(String(r.error.message || ''))) {
      hasLinkedInColumn = false;
      r = await build(columns());
    } else if (!r.error && hasLinkedInColumn === null) {
      hasLinkedInColumn = true;
    }
    if (r.error) throw r.error;
    return r.data;
  }
  const co = (cols) => scoped.from('companies').select(cols).is('deleted_at', null);

  const cand = Object.assign({}, candidate);
  if (cand.company_id) {
    take(await query((cols) => co(cols).eq('id', cand.company_id).limit(1)));
    const mine = found.get(cand.company_id);
    if (mine) {                                     // the picked record tells us what to look for
      cand.name = cand.name || mine.name;
      cand.website = cand.website || mine.website;
      cand.linkedin = cand.linkedin || mine.linkedin_url;
    }
  }
  const dom = rule.normalizeDomain(cand.website);
  if (dom) take(await query((cols) => co(cols).ilike('website', '%' + likeEscape(dom) + '%').limit(50)));
  const nm = rule.normalizeName(cand.name);
  if (nm) {
    const token = nm.split(' ').sort((a, b) => b.length - a.length)[0];
    if (token && token.length >= 3) take(await query((cols) => co(cols).ilike('name', '%' + likeEscape(token) + '%').limit(50)));
  }
  const li = rule.normalizeLinkedIn(cand.linkedin);
  if (li && hasLinkedInColumn !== false) {
    const slug = li.split('/')[1];
    take(await query((cols) => co(cols).ilike('linkedin_url', '%' + likeEscape(slug) + '%').limit(50)));
  }
  return { cand, companies: Array.from(found.values()) };
}

/**
 * The answer for one candidate company. `supabase` is the raw client (for the admin-set
 * cooldown), `db` is the org-scoping layer, `req` the request, `candidate` is
 * { company_id?, name?, website?, linkedin? }. `now` is for tests.
 */
async function checkCompany({ db, supabase, req, candidate, now }) {
  const scoped = db.forRequest(req);
  const { cand, companies } = await load(scoped, candidate || {});
  const matchedIds = companies.filter((c) => rule.reasonsFor(cand, c).length).map((c) => c.id);
  const cooldownDays = await getSetting(supabase, 'company_cooldown_days');
  if (!matchedIds.length) {
    return rule.decide({ candidate: cand, companies, leads: [], jobOrders: [], nameOf: () => '', now: now || new Date(), cooldownDays });
  }

  const leadRes = await scoped.from('jobs')
    .select('id,company_id,position,stage,created_at,created_by,assigned_to_bd,assigned_to')
    .in('company_id', matchedIds).is('deleted_at', null);
  if (leadRes.error) throw leadRes.error;
  const leads = leadRes.data || [];

  // Job orders are the ATS's own record of an open client. If the table or column is not there
  // yet the answer is "none", never an error — the live-lead rule above still protects the company.
  let jobOrders = [];
  try {
    const joRes = await scoped.from('job_orders')
      .select('id,company_id,job_title,status,bd_manager_id')
      .in('company_id', matchedIds).eq('status', 'Active').is('deleted_at', null);
    if (!joRes.error) jobOrders = joRes.data || [];
  } catch (_) { jobOrders = []; }

  const personIds = Array.from(new Set([]
    .concat(leads.map((l) => l.assigned_to_bd), leads.map((l) => l.assigned_to), leads.map((l) => l.created_by), jobOrders.map((o) => o.bd_manager_id))
    .filter(Boolean)));
  const names = {};
  if (personIds.length) {
    const uRes = await scoped.from('users').select('id,name').in('id', personIds);
    (uRes.data || []).forEach((u) => { names[u.id] = u.name || ''; });
  }
  return rule.decide({
    candidate: cand, companies, leads, jobOrders,
    nameOf: (id) => names[id] || '', now: now || new Date(), cooldownDays,
  });
}

// What the screens and the 409 answers carry — the decision without internals.
function publicDecision(d) {
  return {
    state: d.state, blocked: d.blocked, company_id: d.company_id, company_name: d.company_name,
    matched_on: d.matched_on, matched_text: d.matched_text, owner_name: d.owner_name,
    position: d.position, days_left: d.days_left, days_ago: d.days_ago, sentence: d.sentence,
  };
}

module.exports = { checkCompany, publicDecision, _resetForTests: () => { hasLinkedInColumn = null; } };
