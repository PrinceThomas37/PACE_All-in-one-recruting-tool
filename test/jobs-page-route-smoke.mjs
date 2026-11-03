// R-349 A/B — GET /jobs/page and GET /jobs/counts, THE REAL ROUTES (routes/jobs.js + services/lead-page.js) over an in-memory PostgREST.
// The SQL itself is proven on a real Postgres by lead-list-sql-smoke; THIS proves the wiring: what the route sends to the database and what it does with the answer.
//   · the company, the viewer and the reporting chain come ONLY from the session — nothing in the query string can change them;
//   · a row the database wrongly returned is dropped if the viewer may not see it (defence in depth);
//   · a team manager opens on "mine"; page size = the person's 10/20/50, else the admin's default, else 20;
//   · bookmarks: every lead once, in order; a made-up bookmark is a 400, not a silent first page;
//   · until the migration is applied the SAME answer comes from the in-memory list (source: 'memory'); a real database error is a 500, never an empty list;
//   · literal paths are not shadowed by /jobs/:id.
// Usage: node test/jobs-page-route-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const own = require('../services/ownership'); const lq = require('../services/lead-query'); const lp = require('../services/lead-page');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };

const ORG = 'org-a', OTHER = 'org-b';
const users = [
  { id: 'boss', org_id: ORG, manager_id: null }, { id: 'mgr', org_id: ORG, manager_id: 'boss' },
  { id: 'rep1', org_id: ORG, manager_id: 'mgr' }, { id: 'rep2', org_id: ORG, manager_id: 'mgr' }, { id: 'lone', org_id: ORG, manager_id: 'boss' },
];
const owners = ['rep1', 'rep2', 'lone', 'mgr'];
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');   // real lead ids are UUIDs, and the bookmark insists on it
const POOL = uid(9001), FOREIGN = uid(9002);
const jobs = [];
for (let i = 0; i < 50; i++) jobs.push({ id: uid(i), org_id: ORG, position: 'Role ' + i, stage: i % 3 ? 'Assigned' : 'Connected', location: 'Austin',
  company: { name: 'Co' + (i % 5), industry: 'Healthcare' }, contacts: [], created_by: owners[i % 4], assigned_to: owners[i % 4], assigned_to_bd: owners[i % 4],
  created_at: '2026-11-0' + (1 + (i % 3)) + 'T10:00:00.' + String(100 + i) + 'Z', deleted_at: null });
jobs.push({ id: POOL, org_id: ORG, position: 'Pool', stage: 'Unassigned', company: { name: 'P' }, contacts: [], created_by: 'boss', assigned_to_bd: null, created_at: '2026-11-01T10:00:00.000Z', deleted_at: null });
jobs.push({ id: FOREIGN, org_id: OTHER, position: 'Theirs', stage: 'Assigned', company: { name: 'F' }, contacts: [], created_by: 'lone', assigned_to_bd: 'lone', created_at: '2026-11-03T10:00:00.000Z', deleted_at: null });
const raw = jobs.filter((j) => j.org_id === ORG);

// A stand-in for the database function: the JavaScript reference. It records exactly what it was asked.
const asked = [];
const rpcs = {
  leads_page: (a) => {
    asked.push(a);
    const scope = { all: a.p_all, ownerIds: a.p_owner_ids, seesPool: a.p_sees_pool, userId: a.p_viewer };
    const scoped = own.scopeLeads(raw, scope);
    const f = { search: a.p_search || '', industries: a.p_industries, whose: a.p_whose || '', assignee: a.p_assignee || '', dateRange: a.p_date_range || '', dateFrom: a.p_date_from || '', dateTo: a.p_date_to || '', stages: a.p_stages };
    const out = lq.queryLeads(scoped, f, { userId: a.p_viewer, teamManager: a.p_team_manager, today: a.p_today, nowMs: Date.parse(a.p_now), page: 0, perPage: 10 });
    const by = new Map(scoped.map((j) => [j.id, j]));
    let list = out.ids.map((id) => ({ id, created_at: by.get(id).created_at })).sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : (x.id < y.id ? 1 : -1)));
    if (a.p_after_created) list = list.filter((x) => x.created_at < a.p_after_created || (x.created_at === a.p_after_created && x.id < a.p_after_id));
    if (leak.on) list.unshift({ id: uid(3), created_at: '2026-11-03T23:00:00.000Z' });        // the database "wrongly" returns someone else's lead
    return list.slice(0, a.p_limit);
  },
  leads_counts: (a) => {
    asked.push(a);
    const scope = { all: a.p_all, ownerIds: a.p_owner_ids, seesPool: a.p_sees_pool, userId: a.p_viewer };
    const out = lq.queryLeads(own.scopeLeads(raw, scope), { search: a.p_search || '', industries: a.p_industries, whose: a.p_whose || '', assignee: a.p_assignee || '', dateRange: a.p_date_range || '' }, { userId: a.p_viewer, teamManager: a.p_team_manager, today: a.p_today, nowMs: Date.parse(a.p_now), page: 0, perPage: 10 });
    const rows = Object.entries(out.stageCounts).filter(([, n]) => n > 0).map(([k, n]) => ({ kind: 'strip', k, n }));
    if (a.p_team_manager) rows.push({ kind: 'team', k: 'mine', n: out.team.mine }, { kind: 'team', k: 'team', n: out.team.team });
    return rows;
  },
};
const leak = { on: false };
let dbError = null;
const fake = createFakeDb({ tables: { users, jobs, app_settings: [] }, rpcs: { ...rpcs }, onQuery: (q) => (dbError && q.table === 'jobs' ? { data: null, error: { message: dbError } } : undefined) });
// the settings are cached per process: the admin's number is stored BEFORE the first read
fake.tables.app_settings.push({ key: 'sys_leads_page_size_default@' + ORG, value: '10' });
const supabase = fake.supabase; const db = createDb(supabase);
let current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG };
const app = express(); app.use(express.json());
const auth = (req, res, next) => { req.user = current; req.orgId = current.org_id; next(); };
const hasRole = (req, ...r) => (req.user.roles || [req.user.role]).some((x) => r.includes(x));
const ctx = {
  supabase, db, auth, hasRole, today: () => '2026-11-03', canTouchJob: async () => true, logActivity: async () => {}, ownership: own,
  orgIdFor: (req) => req.orgId, withOrg: (q, req) => q.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }), userOrgId: () => ORG, mailboxOrgId: () => ORG,
  loadAllJobs: async (org) => jobs.filter((j) => j.org_id === org), JOB_SELECT: '*', getTimezoneFromLocation: () => null, persistLearnedSkills: () => {},
};
app.use(require('../routes/jobs')(ctx));
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const get = async (p) => { const r = await fetch(API + p); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; };
const as = (u) => { current = u; };
const allPages = async (qs, size = 'perPage=10') => { const ids = []; let after = ''; for (let g = 0; g < 50; g++) { const r = await get(`/jobs/page?${size}&${qs}${after ? '&after=' + after : ''}`); if (r.status !== 200) return { err: r }; ids.push(...r.body.rows.map((x) => x.id)); if (!r.body.next) break; after = r.body.next; } return { ids }; };

try {
  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const p1 = await get('/jobs/page?perPage=10');
  step('the literal /jobs/page is answered by its own handler (not shadowed by /jobs/:id) and says where the answer came from', p1.status === 200 && Array.isArray(p1.body.rows) && p1.body.source === 'database', p1.status + ' ' + JSON.stringify(p1.body).slice(0, 100));
  step('page 1 holds 10 leads and a bookmark for the next', p1.body.rows.length === 10 && typeof p1.body.next === 'string', String(p1.body.rows.length));
  const walked = await allPages('');
  step("walking the bookmarks returns EVERY lead of this company once (51), in newest-first order, and never the other company's", walked.ids.length === 51 && new Set(walked.ids).size === 51 && !walked.ids.includes(FOREIGN), String(walked.ids.length));
  const sorted = raw.slice().sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : (x.id < y.id ? 1 : -1))).map((j) => j.id);
  step('…in exactly the order the list is defined (created_at DESC, id DESC)', JSON.stringify(walked.ids) === JSON.stringify(sorted));
  step('a row carries the lead\'s own fields (so the screen can draw it)', p1.body.rows[0].position && p1.body.rows[0].company);

  // the session decides who is asking — nothing else
  asked.length = 0;
  await get('/jobs/page?perPage=10&org=org-b&p_org=org-b&owner_ids=lone&p_owner_ids=lone&viewer=lone&p_viewer=lone&all=true&p_all=true&sees_pool=true');
  const a0 = asked[0];
  step('the company and the viewer come from the session; a query string cannot change them', a0.p_org === ORG && a0.p_viewer === 'boss', JSON.stringify([a0.p_org, a0.p_viewer]));
  as({ id: 'lone', role: 'bd', roles: ['bd'], org_id: ORG });
  asked.length = 0;
  const lone = await get('/jobs/page?perPage=50&p_all=true&all=true&p_sees_pool=true&sees_pool=1&owner_ids=rep1,rep2');
  const a1 = asked[0];
  step('a plain BD cannot ask to see everyone, the pool or another person\'s leads (scope is built from the session)', a1.p_all === false && a1.p_sees_pool === false && JSON.stringify(a1.p_owner_ids) === '["lone"]', JSON.stringify(a1.p_owner_ids));
  step('…and only their own leads come back', lone.body.rows.length > 0 && lone.body.rows.every((j) => [j.assigned_to_bd, j.created_by].includes('lone')));
  leak.on = true;
  const leaked = await get('/jobs/page?perPage=50');
  leak.on = false;
  step('DEFENCE IN DEPTH: if the database ever returned someone else\'s lead, the route still drops it', !leaked.body.rows.some((j) => j.id === uid(3)) && leaked.body.rows.length === lone.body.rows.length, String(leaked.body.rows.length));

  // a team manager
  as({ id: 'mgr', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG });
  asked.length = 0;
  await get('/jobs/page?perPage=10');
  step('a team manager is told to the database as a manager, with their reporting chain as scope', asked[0].p_team_manager === true && asked[0].p_owner_ids.includes('rep1') && asked[0].p_owner_ids.includes('mgr') && !asked[0].p_owner_ids.includes('lone'), JSON.stringify(asked[0].p_owner_ids));
  as({ id: 'boss', role: 'admin', roles: ['admin', 'bd_lead'], org_id: ORG });
  asked.length = 0; await get('/jobs/page?perPage=10');
  step('an admin who also holds a lead role is NOT a "team manager" (they see the company, not just "my leads")', asked[0].p_team_manager === false && asked[0].p_all === true);
  as({ id: 'mgr', role: 'bd_lead', roles: ['bd_lead', 'ra_lead'], org_id: ORG });
  asked.length = 0; await get('/jobs/page?perPage=10');
  step('an RA Lead who also manages people works the whole pool: not a "team manager" either', asked[0].p_team_manager === false && asked[0].p_sees_pool === true);
  as({ id: 'mgr', role: 'bd_lead', roles: ['bd_lead'], org_id: ORG });
  const cnt = await get('/jobs/counts');
  step('the counts: stage numbers and the mine / team chips, from the database', cnt.status === 200 && cnt.body.source === 'database' && cnt.body.team.on === true && cnt.body.team.whose === 'mine' && cnt.body.team.mine > 0 && cnt.body.team.team > 0 && cnt.body.stripTotal > 0, JSON.stringify(cnt.body));
  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const c2 = await get('/jobs/counts');
  step('an admin\'s counts add up to the whole company (51)', c2.body.stripTotal === 51 && c2.body.team.on === false, JSON.stringify(c2.body));
  step('counts: the literal path is not shadowed either', c2.status === 200 && !('id' in c2.body));

  // "select all N matching": only the ids, the same rules, capped
  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const idsAll = await get('/jobs/ids');
  step('"select all matching": the ids of every lead in the filter (51 for an admin), newest first, the other company\'s never', idsAll.status === 200 && idsAll.body.ids.length === 51 && idsAll.body.count === 51 && idsAll.body.capped === false && !idsAll.body.ids.includes(FOREIGN) && JSON.stringify(idsAll.body.ids) === JSON.stringify(sorted), JSON.stringify(idsAll.body).slice(0, 120));
  const idsConn = await get('/jobs/ids?stages=Connected');
  step('…the filter applies: only the Connected ones', idsConn.body.ids.length === jobs.filter((j) => j.org_id === ORG && j.stage === 'Connected').length && idsConn.body.ids.every((id) => raw.find((j) => j.id === id).stage === 'Connected'));
  as({ id: 'lone', role: 'bd', roles: ['bd'], org_id: ORG });
  asked.length = 0;
  const idsLone = await get('/jobs/ids?p_all=true&owner_ids=rep1');
  step('a plain BD gets only their own ids and cannot widen it from the query string', idsLone.body.ids.length > 0 && idsLone.body.ids.every((id) => [raw.find((j) => j.id === id).assigned_to_bd, raw.find((j) => j.id === id).created_by].includes('lone')) && asked[0].p_all === false);
  as({ id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG });
  const realRpc = fake.supabase.rpc; fake.supabase.rpc = async (name, a) => (name === 'leads_page' ? { data: Array.from({ length: a.p_limit }, (_, i) => ({ id: uid(100000 + i), created_at: '2026-11-01T00:00:00.000Z' })), error: null } : realRpc.call(fake.supabase, name, a));
  const capped = await get('/jobs/ids');
  step('a huge filter is CUT at the cap and says so (the screen then says "the first N of many")', capped.body.capped === true && capped.body.count === capped.body.cap && capped.body.cap === 5000, JSON.stringify([capped.body.capped, capped.body.count, capped.body.cap]));
  fake.supabase.rpc = realRpc;

  // page size
  step('page size: the admin\'s default (10) when the person has not chosen', (await get('/jobs/page')).body.perPage === 10);
  step('…the person\'s own choice (20) beats it', (await get('/jobs/page?perPage=20')).body.perPage === 20);
  step('…a made-up size (7) is ignored, not obeyed', (await get('/jobs/page?perPage=7')).body.perPage === 10);

  // bookmarks
  step('a made-up bookmark is a 400 with a sentence, not a silent first page', (await get('/jobs/page?after=not-a-bookmark')).status === 400 && /not valid/.test((await get('/jobs/page?after=zzz')).body.error));
  step('a bookmark cannot smuggle SQL: it is decoded and validated', (await get('/jobs/page?after=' + Buffer.from(JSON.stringify({ c: "2026-11-03'; DROP TABLE jobs;--", i: uid(1) })).toString('base64url'))).status === 400);

  // until the migration is applied
  delete fake.rpcs; fake.supabase.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.leads_page' } });
  const mem = await allPages('');
  step('until migration 073 is applied: the SAME 51 leads in the SAME order, from memory, and it says so', mem.ids && JSON.stringify(mem.ids) === JSON.stringify(sorted) && (await get('/jobs/page?perPage=10')).body.source === 'memory');
  const memIds = await get('/jobs/ids');
  step('…and the ids too (51, same order)', memIds.body.source === 'memory' && JSON.stringify(memIds.body.ids) === JSON.stringify(sorted));
  const memCounts = await get('/jobs/counts');
  step('…and the counts too (51)', memCounts.status === 200 && memCounts.body.source === 'memory' && memCounts.body.stripTotal === 51, JSON.stringify(memCounts.body));
  fake.supabase.rpc = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  const boom = await get('/jobs/page?perPage=10');
  step('a REAL database error is a 500 with its reason — never an empty list that looks like "no leads"', boom.status === 500 && /timeout/.test(boom.body.error), JSON.stringify(boom.body));
} catch (e) { step('route test ran without throwing', false, e.stack); }
srv.close();
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
