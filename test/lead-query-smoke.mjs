// R-349 Stage 1 — THE PROOF THAT NOTHING IS MIS-COUNTED.
// Runs the Leads tab's REAL old finding (the text of renderJobs in public/js/06-page-leads.js, cut out and executed, not retyped)
// and the new server code (services/lead-query.js) on the SAME leads, for a matrix of filters and three kinds of viewer, and requires
// the same leads in the same order, the same strip counts, the same mine/team counts. A guard that cannot fail is worth nothing, so
// the last block breaks the port on purpose and requires this test to notice.
// Usage: node test/lead-query-smoke.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const lq = require('../services/lead-query.js');

// ── the old code, cut out of the real file ──
const src = fs.readFileSync(new URL('../public/js/06-page-leads.js', import.meta.url), 'utf8');
const a = src.indexOf('function renderJobs(){');
const b = src.indexOf('  var stages=["Unassigned"', a);
ok('the old filtering block is found in 06-page-leads.js (a probe that cannot find it must FAIL)', a >= 0 && b > a, `a=${a} b=${b}`);
const body = src.slice(a + 'function renderJobs(){'.length, b);
const NOW = Date.parse('2026-11-03T09:30:00Z'), TODAY = '2026-11-03';
const FixedDate = class extends Date { constructor(...x) { if (x.length) super(...x); else super(NOW); } static now() { return NOW; } };

// ── seeded leads ──
const stages = ['Unassigned', 'Assigned', 'Connected', 'In Discussion', 'Future', 'Rejected', 'Qualified'];
const inds = ['Healthcare', 'IT & software', 'Media & publishing', '', 'Construction'];
const people = ['u-me', 'u-a', 'u-b', null];
const days = ['2026-11-03', '2026-11-02', '2026-10-30', '2026-10-27', '2026-10-20', '2026-09-01'];   // 10-27 is exactly the week cut (a boundary the test must hit)
const raw = [];
for (let i = 0; i < 90; i++) {
  raw.push({
    id: 'L' + String(i).padStart(3, '0'), position: ['Nurse', 'Engineer', 'Editor', 'Welder'][i % 4] + ' ' + i, location: ['Austin, TX', 'Greer, SC', 'Remote'][i % 3],
    stage: i % 11 === 0 ? undefined : stages[i % stages.length],
    industry: i % 4 === 0 ? inds[i % inds.length] : '', company: { name: ['Acme', 'Beta Health', 'Gamma Media', 'Delta'][i % 4], industry: inds[(i + 1) % inds.length] },
    assigned_to_bd: people[i % people.length], created_at: days[i % days.length] + 'T0' + (i % 9) + ':00:00Z',
    contacts: i % 5 === 0 ? [{ id: 'c' + i, job_id: 'L' + String(i).padStart(3, '0'), first_name: 'Pat', last_name: 'Nurse' + i, email: `pat${i}@acme.test`, is_primary: true }] : [],
  });
}
// the browser's normaliseJob + contacts split, as 22-api.js does it
const norm = raw.map((j) => ({ id: j.id, company_name: j.company.name, company_ind: j.company.industry, position: j.position, location: j.location,
  stage: j.stage || 'Unassigned', assigned_to_bd: j.assigned_to_bd || null, industry: j.industry || '', created_at: j.created_at }));
const contacts = raw.flatMap((j) => j.contacts);

const viewers = [
  { name: 'plain BD', user: { id: 'u-me' }, teamManager: false },
  { name: 'team manager', user: { id: 'u-me' }, teamManager: true },
  { name: 'admin', user: { id: 'u-admin' }, teamManager: false },
];
const filters = [
  {}, { search: 'nurse' }, { search: 'PAT3' }, { search: 'greer' }, { search: 'beta' }, { industries: ['healthcare'] }, { industries: ['Media & publishing', 'Construction'] },
  { stages: ['Connected'] }, { stages: ['Assigned', 'Future'] }, { assignee: 'none' }, { assignee: 'u-a' }, { whose: 'team' }, { whose: 'mine' },
  { dateRange: 'today' }, { dateRange: 'yesterday' }, { dateRange: 'week' }, { dateRange: 'custom', dateFrom: '2026-10-27' }, { dateRange: 'custom', dateTo: '2026-10-30' },
  { dateRange: 'custom', dateFrom: '2026-10-01', dateTo: '2026-11-02' }, { search: 'acme', stages: ['Connected'], whose: 'team', dateRange: 'week' },
  { search: 'zzzz-nothing' },
];

// the old block begins "var u=STATE.user; var jobs=getMyJobs(u);" — give it a getMyJobs through STATE.jobs
const oracle2 = new Function('STATE', 'jobContacts', 'leadIndustryOf', 'userHasAnyRole', 'leadsIsTeamManager', 'todayIST', 'Date', 'getMyJobs',
  body + '\nreturn {jobs: jobs, stripBase: stripBase, mineCount: mineCount, teamCount: teamCount};');
function runOld(v, f) {
  const STATE = { user: v.user, jobs: norm, contacts, jobsFilter: Object.assign({ search: '', stages: [], industries: [], assignee: '', dateRange: 'all', dateFrom: '', dateTo: '' }, f) };
  const jobContacts = (id) => contacts.filter((c) => c.job_id === id);
  const leadIndustryOf = (j) => String((j && (j.industry || j.company_ind)) || '').trim();
  return oracle2(STATE, jobContacts, leadIndustryOf, () => false, () => v.teamManager, () => TODAY, FixedDate, () => norm.slice());
}

let compared = 0, bad = [];
for (const v of viewers) for (const f of filters) {
  const o = runOld(v, f);
  const n = lq.queryLeads(raw, f, { userId: v.user.id, teamManager: v.teamManager, today: TODAY, nowMs: NOW, page: 0, perPage: 50 });
  const sameIds = JSON.stringify(o.jobs.map((j) => j.id)) === JSON.stringify(n.ids);
  const sameStrip = o.stripBase.length === n.stripTotal;
  const oc = {}; lq.STAGE_LIST.forEach((s) => { oc[s] = o.stripBase.filter((j) => j.stage === s).length; });
  const sameStages = JSON.stringify(oc) === JSON.stringify(n.stageCounts);
  const sameTeam = !v.teamManager || (o.mineCount === n.team.mine && o.teamCount === n.team.team);
  compared++;
  if (!(sameIds && sameStrip && sameStages && sameTeam)) bad.push(`${v.name} ${JSON.stringify(f)}: ids ${sameIds} strip ${sameStrip} stages ${sameStages} team ${sameTeam}`);
}
ok(`old code and server agree on ${compared} filter × viewer cases (same leads, same order, same strip, same stage counts, same mine/team)`, bad.length === 0, bad.slice(0, 3).join(' | '));
ok('the matrix is not vacuous: filters really change the answer', new Set(filters.map((f) => runOld(viewers[0], f).jobs.length)).size > 8);
ok('an impossible search finds nothing (and says 0, not blank)', lq.queryLeads(raw, { search: 'zzzz-nothing' }, { userId: 'u-me', today: TODAY, nowMs: NOW, perPage: 20 }).total === 0);

// paging: select-all = every lead in the filter, all pages; pages are slices of that
const pg = lq.queryLeads(raw, {}, { userId: 'u-admin', today: TODAY, nowMs: NOW, page: 1, perPage: 20 });
ok('page 2 of 20 holds leads 21–40 of the filter', pg.rows.length === 20 && pg.rows[0].id === pg.ids[20] && pg.pageCount === 5, `${pg.rows.length}/${pg.pageCount}`);
ok('"select all" ids cover every page (90), not just the screen', pg.ids.length === 90 && pg.total === 90);
ok('a page past the end falls back to the last page', lq.queryLeads(raw, {}, { userId: 'u-admin', today: TODAY, nowMs: NOW, page: 99, perPage: 20 }).page === 4);
ok('a page size that is not 10/20/50 becomes 20', lq.queryLeads(raw, {}, { userId: 'u-admin', today: TODAY, nowMs: NOW, perPage: 7 }).perPage === 20);

// the guard must be able to fail: break the port and require this suite to notice
const broken = (rows, f, c) => { const r = lq.queryLeads(rows, f, c); r.ids = r.ids.slice(1); return r; };
const o0 = runOld(viewers[0], { search: 'nurse' });
ok('mutation: a port that drops one lead is caught by the comparison', JSON.stringify(o0.jobs.map((j) => j.id)) !== JSON.stringify(broken(raw, { search: 'nurse' }, { userId: 'u-me', today: TODAY, nowMs: NOW, perPage: 50 }).ids));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
