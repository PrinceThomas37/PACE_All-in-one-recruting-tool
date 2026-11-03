'use strict';
// ============================================================================
// THE LEAD LIST, ASKED OF THE SERVER (R-349 Stage 1, 3 Nov 2026).
//
// Until now the browser held every lead and the Leads tab did the finding itself (public/js/06-page-leads.js renderJobs). That is why
// sign-in waits on a list that grows with the database. This is the SAME finding, done on the server's copy of the list, so the
// browser can ask for "page 3 of Connected leads matching 'nurse'" and hold only what is on screen.
//
// It is a faithful port of renderJobs — same filters, same order of filters, same quirks — because the proof that nothing is mis-counted
// is the side-by-side test (test/lead-query-smoke.mjs) that runs this and the old browser code on the same leads.
//
// PURE: the clock and the viewer's day come in as arguments. WHO MAY SEE a lead is NOT decided here: the caller passes in the list
// ALREADY narrowed by own.scopeLeads (CLAUDE.md: never filter who-sees-what in the browser; narrow before anything else).
// ============================================================================

const PAGE_SIZES = [10, 20, 50];            // the person's own choice (R-280); the DEFAULT comes from the admin setting, not from here

// The lead as the screens know it (the browser's normaliseJob): company fields flattened, stage defaulted.
function flat(j) {
  const co = j.company || {};
  return {
    id: j.id, stage: j.stage || 'Unassigned', position: j.position, location: j.location || '',
    company_name: co.name || '', company_ind: co.industry || '', industry: j.industry || '',
    assigned_to_bd: j.assigned_to_bd || null, created_at: j.created_at, created_date: j.created_date,
    contacts: Array.isArray(j.contacts) ? j.contacts : [],
  };
}

// A lead's industry as it carries it: its own, else its company's (R-312) — the same rule as the browser's leadIndustryOf.
function leadIndustryOf(f) { return String((f && (f.industry || f.company_ind)) || '').trim(); }

function dayOf(iso) { return String(iso || '').slice(0, 10); }

// "today / yesterday / week" exactly as the browser worked them: `today` is the viewer's own calendar day (they send it); yesterday and
// the week are taken from the clock and cut as UTC dates, as renderJobs always did.
function dateCut(range, today, nowMs) {
  if (range === 'today') return today;
  const d = new Date(nowMs);
  if (range === 'yesterday') { d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  if (range === 'week') { d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); }
  return null;
}

function stageCountsOf(rows, stageList) {
  const out = {};
  stageList.forEach((st) => { out[st] = rows.filter((j) => j.stage === st).length; });
  return out;
}

const STAGE_LIST = ['Unassigned', 'Assigned', 'Connected', 'In Discussion', 'Future', 'Rejected'];

/**
 * @param rows   leads ALREADY scoped to the caller (own.scopeLeads), raw database shape
 * @param filter { search, industries[], whose, assignee, dateRange, dateFrom, dateTo, stages[] }
 * @param ctx    { userId, teamManager, today:'YYYY-MM-DD', nowMs, page, perPage }
 * @returns {{ total, stripTotal, stageCounts, team:{on,mine,team,whose}, ids, rows, page, pageCount, perPage }}
 */
function queryLeads(rows, filter, ctx) {
  const f = filter || {};
  let jobs = (rows || []).map(flat);

  if (f.search) {
    const q = String(f.search).toLowerCase();
    jobs = jobs.filter((j) => {
      if (String(j.position || '').toLowerCase().includes(q)) return true;
      if (String(j.company_name || '').toLowerCase().includes(q)) return true;
      if (String(j.location || '').toLowerCase().includes(q)) return true;
      return j.contacts.some((c) => `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(q) || String(c.email || '').toLowerCase().includes(q));
    });
  }
  if (Array.isArray(f.industries) && f.industries.length) {
    const inds = f.industries.map((x) => String(x).trim().toLowerCase());
    jobs = jobs.filter((j) => inds.includes(leadIndustryOf(j).toLowerCase()));
  }

  // MY LEADS / MY TEAM'S LEADS (owner, 29 Oct): a team manager opens on their own; one click shows the team's. A lead nobody owns stays "mine".
  const teamManager = !!ctx.teamManager;
  const whose = teamManager ? (f.whose || 'mine') : 'all';
  let mine = 0, team = 0;
  const isTeams = (j) => !!j.assigned_to_bd && j.assigned_to_bd !== ctx.userId;
  if (teamManager) {
    jobs.forEach((j) => { if (isTeams(j)) team++; else mine++; });
    jobs = jobs.filter((j) => (whose === 'mine' ? !isTeams(j) : isTeams(j)));
  }
  if (f.assignee) jobs = jobs.filter((j) => (f.assignee === 'none' ? !j.assigned_to_bd : j.assigned_to_bd === f.assignee));

  if (f.dateRange && f.dateRange !== 'all' && f.dateRange !== 'custom') {
    const cut = dateCut(f.dateRange, ctx.today, ctx.nowMs);
    if (cut) {
      jobs = (f.dateRange === 'today' || f.dateRange === 'yesterday')
        ? jobs.filter((j) => dayOf(j.created_at) === cut)
        : jobs.filter((j) => dayOf(j.created_at) >= cut);
    }
  }
  if (f.dateRange === 'custom') {
    if (f.dateFrom) jobs = jobs.filter((j) => dayOf(j.created_at) >= f.dateFrom);
    if (f.dateTo) jobs = jobs.filter((j) => dayOf(j.created_at) <= f.dateTo);
  }

  // What the number strip counts: every filter but the stage buttons (R-279).
  const strip = jobs;
  const stageCounts = stageCountsOf(strip, STAGE_LIST);
  if (Array.isArray(f.stages) && f.stages.length) jobs = jobs.filter((j) => f.stages.includes(j.stage));

  // Connected only → newest first (Session 31). Everything else keeps the list's own order.
  if (Array.isArray(f.stages) && f.stages.length === 1 && f.stages[0] === 'Connected') {
    jobs = jobs.slice().sort((a, b) => String(b.created_at || b.created_date || '').localeCompare(String(a.created_at || a.created_date || '')));
  }

  const perPage = PAGE_SIZES.includes(ctx.perPage) ? ctx.perPage : 20;
  const pageCount = Math.max(1, Math.ceil(jobs.length / perPage));
  const page = Math.min(Math.max(0, Number(ctx.page) || 0), pageCount - 1);
  const ids = jobs.map((j) => j.id);                                  // "select all" = every lead in the filter, all pages
  const pageIds = new Set(ids.slice(page * perPage, (page + 1) * perPage));
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const pageRows = ids.slice(page * perPage, (page + 1) * perPage).filter((id) => pageIds.has(id)).map((id) => byId.get(id));

  return {
    total: jobs.length, stripTotal: strip.length, stageCounts,
    team: { on: teamManager, mine, team, whose },
    ids, rows: pageRows, page, pageCount, perPage,
  };
}

module.exports = { queryLeads, leadIndustryOf, flat, dateCut, STAGE_LIST, PAGE_SIZES };
