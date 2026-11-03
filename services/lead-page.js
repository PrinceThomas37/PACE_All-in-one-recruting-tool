'use strict';
// ============================================================================
// THE LEAD LIST FROM THE DATABASE (R-349 A/B) — the glue between GET /jobs/page and /jobs/counts (routes/jobs.js) and the SQL functions
// leads_page / leads_counts (migrations/073). The RULES are SQL (proven equal to services/lead-query.js on a real Postgres, test/lead-list-sql-smoke.mjs);
// this file only (1) turns the query string into clean filters, (2) builds the viewer's scope from the SESSION, (3) calls the database, (4) fetches the
// rows of the page, and (5) falls back to the in-memory list until migration 073 is applied — the same answer, slower.
//
// SECURITY: the organisation, the viewer and the reporting chain come ONLY from the session (the route passes them in). Nothing in the query string can
// name another company or another person's leads; every row that comes back is checked against the scope once more (canSeeLead) before it is returned.
// ============================================================================
const own = require('./ownership');
const lq = require('./lead-query');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGES = ['all', 'today', 'yesterday', 'week', 'custom'];
const csv = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
const dayOr = (v) => (DAY.test(String(v || '')) ? String(v) : new Date().toISOString().slice(0, 10));   // the viewer's own day when they send it, else the server's

/** The query string → the filters the lead list understands. Everything is trimmed, bounded and whitelisted. */
function filtersFrom(q) {
  q = q || {};
  const d = (x) => (DAY.test(String(x || '')) ? String(x) : '');
  return {
    search: String(q.search || '').trim().slice(0, 200),
    industries: csv(q.industries).slice(0, 50).map((x) => x.slice(0, 120).toLowerCase()),
    whose: q.whose === 'team' ? 'team' : q.whose === 'mine' ? 'mine' : '',
    assignee: String(q.assignee || '').trim().slice(0, 64),
    dateRange: RANGES.includes(q.dateRange) ? q.dateRange : '',
    dateFrom: d(q.dateFrom), dateTo: d(q.dateTo),
    stages: csv(q.stages).slice(0, 20).map((x) => x.slice(0, 40)),
  };
}

/** A manager (someone with a team, not an admin or RA Lead who work the whole pool) opens on their own leads (owner, 29 Oct). */
function isTeamManager({ isAdmin, roles, scope }) {
  const rs = roles || [];
  return !isAdmin && !rs.includes('ra_lead') && (rs.some((r) => ['bd_lead', 'director', 'associate_director'].includes(r)) || ((scope && scope.ownerIds) || []).length > 1);
}

/** The person's own choice (10 / 20 / 50), else the admin's default, else 20 — no number typed in the code (D-0123). */
function pageSize(asked, dflt) {
  const ok = lq.PAGE_SIZES;
  const a = Number(asked);
  return ok.includes(a) ? a : (ok.includes(Number(dflt)) ? Number(dflt) : 20);
}

// A bookmark is the position of the last lead on the page: where to continue. Opaque to the browser.
const encodeCursor = (row) => Buffer.from(JSON.stringify({ c: row.created_at, i: row.id })).toString('base64url');
function decodeCursor(tok) {
  if (!tok) return null;
  try {
    const o = JSON.parse(Buffer.from(String(tok), 'base64url').toString('utf8'));
    if (!o || typeof o.c !== 'string' || typeof o.i !== 'string' || isNaN(Date.parse(o.c)) || !/^[0-9a-f-]{36}$/i.test(o.i)) return false;
    return { created_at: o.c, id: o.i };
  } catch (_) { return false; }
}

const missingFunction = (err) => !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(String(err.message || '')));

// The arguments every call to the database carries. org / viewer / owner ids come from the session.
function rpcArgs(o) {
  const f = o.filters, s = o.scope;
  return {
    p_org: o.org, p_viewer: o.viewerId, p_all: !!s.all, p_owner_ids: s.ownerIds || [], p_sees_pool: !!s.seesPool, p_team_manager: !!o.manager,
    p_search: f.search || null, p_industries: f.industries || [], p_whose: f.whose || null, p_assignee: f.assignee || null,
    p_date_range: f.dateRange || null, p_today: o.today, p_now: o.now.toISOString(), p_date_from: f.dateFrom || null, p_date_to: f.dateTo || null,
  };
}

// ── the in-memory answer (until migration 073 is applied; also the reference the database is proven equal to) ──
async function idsFromMemory(o) {
  const all = await o.loadAllJobs(o.org);
  const scoped = own.scopeLeads(all, o.scope);
  const out = lq.queryLeads(scoped, o.filters, { userId: o.viewerId, teamManager: o.manager, today: o.today, nowMs: o.now.getTime(), page: 0, perPage: lq.PAGE_SIZES[0] });
  const byId = new Map(scoped.map((j) => [j.id, j]));
  const ids = out.ids.slice().sort((a, b) => { const A = byId.get(a).created_at, B = byId.get(b).created_at; return A < B ? 1 : A > B ? -1 : (a < b ? 1 : -1); });
  return { ids, out, byId };
}

/** One page. { rows, next, perPage, source } — `next` is the bookmark for the following page, or null at the end. */
async function fetchPage(o) {
  const want = o.perPage + 1;
  const f = o.filters;
  let source = 'database', page;
  const r = await o.supabase.rpc('leads_page', {
    ...rpcArgs(o), p_stages: f.stages || [], p_after_created: o.cursor ? o.cursor.created_at : null, p_after_id: o.cursor ? o.cursor.id : null, p_limit: want,
  });
  if (r.error && !missingFunction(r.error)) throw new Error(r.error.message);
  let keyOf;
  if (r.error) {
    source = 'memory';
    const m = await idsFromMemory(o);
    let list = m.ids.map((id) => ({ id, created_at: m.byId.get(id).created_at }));
    if (o.cursor) list = list.filter((x) => x.created_at < o.cursor.created_at || (x.created_at === o.cursor.created_at && x.id < o.cursor.id));
    page = list.slice(0, want);
  } else page = r.data || [];
  const more = page.length > o.perPage;
  const pageRows = page.slice(0, o.perPage);
  let rows = [];
  if (pageRows.length) {
    const { data, error } = await o.scoped(o.supabase.from('jobs').select(o.listSelect).in('id', pageRows.map((x) => x.id)));
    if (error) throw new Error(error.message);
    const byId = new Map((data || []).map((j) => [j.id, j]));
    // newest first as the database said; and once more: a row the viewer may not see is never returned, whatever came back
    rows = pageRows.map((x) => byId.get(x.id)).filter((j) => j && own.canSeeLead(j, o.scope));
  }
  return { rows, next: more && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]) : null, perPage: o.perPage, source };
}

/** The numbers: how many in each stage under every filter but the stage buttons, and (for a team manager) how many are mine / the team's. */
async function fetchCounts(o) {
  const r = await o.supabase.rpc('leads_counts', rpcArgs(o));
  if (r.error && !missingFunction(r.error)) throw new Error(r.error.message);
  const strip = {}, team = { on: !!o.manager, mine: 0, team: 0, whose: o.manager ? (o.filters.whose || 'mine') : 'all' };
  let source = 'database';
  if (r.error) {
    source = 'memory';
    const m = await idsFromMemory(o);
    Object.assign(strip, m.out.stageCounts);
    const unlisted = m.out.stripTotal - Object.values(m.out.stageCounts).reduce((a, b) => a + b, 0);
    if (unlisted > 0) strip.Other = unlisted;
    team.mine = m.out.team.mine; team.team = m.out.team.team;
  } else {
    for (const row of r.data || []) { if (row.kind === 'strip') strip[row.k] = Number(row.n); else if (row.kind === 'team') team[row.k] = Number(row.n); }
  }
  return { strip, stripTotal: Object.values(strip).reduce((a, b) => a + b, 0), team, source };
}

// shortcut: one request returns at most IDS_CAP ids, so a bulk action over a huge filter cannot be unbounded; the answer says when it was cut and the screen then says
// "the first N of many". Upgrade: a server-side "apply to this filter" action that never sends ids to the browser at all (step E).
const IDS_CAP = 5000;

/** The ids of every lead the filter matches (newest first), up to IDS_CAP, for "select all N matching". */
async function fetchIds(o) {
  const f = o.filters;
  const r = await o.supabase.rpc('leads_page', { ...rpcArgs(o), p_stages: f.stages || [], p_after_created: null, p_after_id: null, p_limit: IDS_CAP + 1 });
  if (r.error && !missingFunction(r.error)) throw new Error(r.error.message);
  let list, source = 'database';
  if (r.error) { source = 'memory'; const m = await idsFromMemory(o); list = m.ids.map((id) => ({ id })); } else list = r.data || [];
  // who may see them was decided by the database (or, in memory, by own.scopeLeads) — an id list carries no row to check again
  const cut = list.length > IDS_CAP;
  const ids = list.slice(0, IDS_CAP).map((x) => x.id);
  return { ids, count: ids.length, capped: cut, cap: IDS_CAP, source };
}

/**
 * The two drop-downs on the Leads tab: who owns how many of the leads the viewer can see, and how many carry each industry (R-312).
 * Counted over every visible lead — never over the filtered set. { owners:[{id,count}], nobody, industries:[{key,label,count}], total, source }
 * Until migration 074 is applied the same answer is counted from the in-memory list (`source: 'memory'`).
 */
async function fetchFacets(o) {
  const r = await o.supabase.rpc('leads_facets', { p_org: o.org, p_viewer: o.viewerId, p_all: !!o.scope.all, p_owner_ids: o.scope.ownerIds || [], p_sees_pool: !!o.scope.seesPool });
  if (r.error && !missingFunction(r.error)) throw new Error(r.error.message);
  const owners = [], industries = [];
  let nobody = 0, source = 'database';
  if (r.error) {
    source = 'memory';
    const scoped = own.scopeLeads(await o.loadAllJobs(o.org), o.scope);
    const oc = new Map(), ic = new Map();
    for (const j of scoped) {
      if (j.assigned_to_bd) oc.set(j.assigned_to_bd, (oc.get(j.assigned_to_bd) || 0) + 1); else nobody++;
      const v = lq.leadIndustryOf(lq.flat(j));
      if (v) { const k = v.toLowerCase(); const e = ic.get(k) || { key: k, label: v, count: 0 }; e.count++; ic.set(k, e); }
    }
    oc.forEach((count, id) => owners.push({ id, count })); ic.forEach((e) => industries.push(e));
  } else {
    for (const row of r.data || []) {
      if (row.kind === 'owner') { if (row.k) owners.push({ id: row.k, count: Number(row.n) }); else nobody = Number(row.n); }
      else if (row.kind === 'industry') industries.push({ key: row.k, label: row.label, count: Number(row.n) });
    }
  }
  industries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = owners.reduce((a, b) => a + b.count, 0) + nobody;
  return { owners, nobody, industries, total, source };
}

// shortcut: at most BY_IDS_MAX leads per request (a technical guard on one request's size, not a business limit); the browser asks again for more.
const BY_IDS_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whole leads (the same shape as a page row) for ids the browser already knows — a lead opened from somewhere other than the list, a ticked lead on another page. */
async function fetchByIds(o) {
  const ids = [...new Set(String(o.ids || '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))].slice(0, BY_IDS_MAX);
  if (!ids.length) return { rows: [] };
  const { data, error } = await o.scoped(o.supabase.from('jobs').select(o.listSelect).in('id', ids).is('deleted_at', null));
  if (error) throw new Error(error.message);
  // a row the viewer may not see is never returned (D-0034/35/36), whatever the database sent back
  return { rows: (data || []).filter((j) => own.canSeeLead(j, o.scope)) };
}

module.exports = { fetchFacets, fetchByIds, BY_IDS_MAX, fetchIds, IDS_CAP, filtersFrom, isTeamManager, pageSize, encodeCursor, decodeCursor, dayOr, fetchPage, fetchCounts, rpcArgs, missingFunction };
