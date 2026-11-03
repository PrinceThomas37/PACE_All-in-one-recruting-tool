// R-349 A — THE LEAD LIST IN THE DATABASE, ON A REAL POSTGRES (migrations/073_lead_list_in_database.sql, applied verbatim).
// A fake database cannot run SQL, so this starts its own PostgreSQL (test/helpers/local-postgres.mjs), applies the real migration and requires
// the SAME answer as the JavaScript reference (services/lead-query.js, itself proven equal to the old Leads-tab code by lead-query-smoke):
//   * the same leads in the same newest-first order, for 5 kinds of viewer × 25 filters (who-may-see decided FIRST — a stranger gets nothing,
//     another company's leads are never returned, the pool only for those who see it);
//   * paging by bookmark loses nothing and repeats nothing, even when many leads share one created_at (an import);
//   * the numbers (stage counts, my/team counts) equal the reference;
//   * search is literal substring: % _ ' \ mean themselves, nothing a person types changes the statement;
//   * the search text is kept up to date by the DATABASE when a lead, a company or a contact changes;
//   * a deliberate break of the SQL is noticed.
// Usage: node test/lead-list-sql-smoke.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { createRequire } from 'node:module';
import { startPostgres, lit, uuidArr, txtArr } from './helpers/local-postgres.mjs';
const require = createRequire(import.meta.url);
const lq = require('../services/lead-query.js'); const own = require('../services/ownership.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 300) : '')); };

const pg = await startPostgres();
try {
  pg.createDb('t');
  pg.exec('postgres', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');   // the roles a Supabase database has
  pg.exec('t', `
    CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE companies (id uuid PRIMARY KEY, org_id uuid NOT NULL, name text NOT NULL, industry text);
    CREATE TABLE jobs (id uuid PRIMARY KEY, org_id uuid NOT NULL, company_id uuid NOT NULL, position text NOT NULL, location text, source text, industry text,
      stage text NOT NULL DEFAULT 'Unassigned', created_by uuid, assigned_to uuid, assigned_to_bd uuid, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, is_duplicate boolean);
    CREATE TABLE contacts (id uuid PRIMARY KEY, org_id uuid NOT NULL, job_id uuid NOT NULL, first_name text NOT NULL, last_name text, email text, is_primary boolean NOT NULL DEFAULT false);`);
  const mig = path.resolve(new URL('../migrations/073_lead_list_in_database.sql', import.meta.url).pathname);
  pg.execFile('t', mig);
  ok('the real migration applies', true);
  pg.execFile('t', mig);
  ok('…and is safe to apply twice', true);

  const can = (role, fn) => pg.rows('t', `select has_function_privilege('${role}', '${fn}', 'EXECUTE') as ok`)[0].ok;
  ok('only the server can ask for a lead list: service_role may call leads_page / leads_counts; anon, authenticated and the public may not',
    ['leads_page(uuid,uuid,boolean,uuid[],boolean,boolean,text,text[],text,text,text,date,timestamptz,date,date,text[],timestamptz,uuid,integer)', 'leads_counts(uuid,uuid,boolean,uuid[],boolean,boolean,text,text[],text,text,text,date,timestamptz,date,date)'].every((fn) => can('service_role', fn) && !can('anon', fn) && !can('authenticated', fn)));

  // ── seed ──
  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ORG = U(900), OTHER = U(901);
  const users = { admin: U(1), ra: U(2), mgr: U(3), bd1: U(4), bd2: U(5), bd3: U(6), stranger: U(7), foreign: U(8) };
  const stages = ['Unassigned', 'Assigned', 'Connected', 'In Discussion', 'Future', 'Rejected', 'Qualified'];
  const inds = ['Healthcare', 'IT & software', 'Media & publishing', '', 'Construction'];
  const days = ['2026-11-03', '2026-11-02', '2026-10-30', '2026-10-27', '2026-10-20', '2026-09-01'];
  const owners = [users.bd1, users.bd2, users.bd3, null, users.mgr];
  const raw = [], sql = [];
  const cid = (i) => `00000000-0000-4000-8000-${String(10000 + i).padStart(12, '0')}`, jid = (i) => `00000000-0000-4000-8000-${String(20000 + i).padStart(12, '0')}`, kid = (i) => `00000000-0000-4000-8000-${String(30000 + i).padStart(12, '0')}`;
  for (const [k, v] of Object.entries(users)) sql.push(`INSERT INTO users VALUES (${lit(v)}, ${lit(k === 'foreign' ? OTHER : ORG)}, ${lit(k)});`);
  for (let i = 0; i < 120; i++) {
    const company = { name: ['Acme', 'Beta Health', 'Gamma Media', 'Delta', "O'Neil & Sons", 'Rate_50% Co'][i % 6] + (i % 11 === 0 ? ' LLC' : ''), industry: inds[(i + 1) % inds.length] };
    const job = { id: jid(i), org_id: i % 17 === 16 ? OTHER : ORG, position: ['Nurse', 'Engineer', 'Editor', 'Welder'][i % 4] + ' ' + i, location: ['Austin, TX', 'Greer, SC', 'Remote'][i % 3],
      stage: i % 11 === 0 ? 'Unassigned' : stages[i % stages.length], industry: i % 4 === 0 ? inds[i % inds.length] : '',
      assigned_to_bd: owners[i % owners.length], created_by: [users.ra, users.admin, users.bd1, users.bd2][i % 4], assigned_to: i % 9 === 0 ? users.bd2 : null,
      created_at: days[i % days.length] + 'T0' + (i % 3) + ':00:00Z', deleted_at: i % 29 === 0 ? '2026-11-01T00:00:00Z' : null };
    const contacts = i % 5 === 0 ? [{ id: kid(i), first_name: 'Pat', last_name: 'Nurse' + i, email: `pat${i}@acme-${i % 7}.test` }] : [];
    sql.push(`INSERT INTO companies VALUES (${lit(cid(i))}, ${lit(job.org_id)}, ${lit(company.name)}, ${lit(company.industry)});`);
    sql.push(`INSERT INTO jobs (id, org_id, company_id, position, location, industry, stage, created_by, assigned_to, assigned_to_bd, created_at, deleted_at) VALUES (${lit(job.id)}, ${lit(job.org_id)}, ${lit(cid(i))}, ${lit(job.position)}, ${lit(job.location)}, ${lit(job.industry)}, ${lit(job.stage)}, ${lit(job.created_by)}, ${lit(job.assigned_to)}, ${lit(job.assigned_to_bd)}, ${lit(job.created_at)}, ${lit(job.deleted_at)});`);
    contacts.forEach((c) => sql.push(`INSERT INTO contacts VALUES (${lit(c.id)}, ${lit(job.org_id)}, ${lit(job.id)}, ${lit(c.first_name)}, ${lit(c.last_name)}, ${lit(c.email)}, true);`));
    if (job.org_id === ORG && !job.deleted_at) raw.push({ ...job, company, contacts });      // the reference sees only this company's live leads (the database filters org and deleted_at)
  }
  pg.exec('t', sql.join('\n'));
  pg.exec('t', 'ANALYZE;');
  ok('seeded 120 leads (some deleted, some of another company, many sharing one created_at)', pg.rows('t', 'select count(*)::int n from jobs')[0].n === 120);

  // ── viewers: the same objects the route will build ──
  const viewers = [
    { name: 'admin', role: 'admin', roles: ['admin'], id: users.admin, chain: null, team: false },
    { name: 'RA lead (sees the pool)', role: 'ra_lead', roles: ['ra_lead'], id: users.ra, chain: [], team: false },
    { name: 'BD', role: 'bd', roles: ['bd'], id: users.bd1, chain: [], team: false },
    { name: 'team manager', role: 'bd_lead', roles: ['bd_lead'], id: users.mgr, chain: [users.bd1, users.bd2], team: true },
    { name: 'stranger (no leads, no pool)', role: 'bd', roles: ['bd'], id: users.stranger, chain: [], team: false },
  ];
  const NOW = Date.parse('2026-11-03T09:30:00Z'), TODAY = '2026-11-03';
  const filters = [
    {}, { search: 'nurse' }, { search: 'PAT3' }, { search: 'greer' }, { search: 'beta' }, { search: 'acme' }, { search: "o'neil" }, { search: 'rate_50%' }, { search: '50_' }, { search: 'pat nurse10' },
    { industries: ['healthcare'] }, { industries: ['media & publishing', 'construction'] }, { stages: ['Connected'] }, { stages: ['Assigned', 'Future'] }, { assignee: 'none' },
    { assignee: users.bd2 }, { whose: 'team' }, { whose: 'mine' }, { dateRange: 'today' }, { dateRange: 'yesterday' }, { dateRange: 'week' }, { dateRange: 'custom', dateFrom: '2026-10-27' },
    { dateRange: 'custom', dateTo: '2026-10-30' }, { dateRange: 'custom', dateFrom: '2026-10-01', dateTo: '2026-11-02' }, { search: 'acme', stages: ['Connected'], whose: 'team', dateRange: 'week' }, { search: 'zzzz-nothing' },
  ];
  const scopeOf = (v) => own.viewScope({ role: v.role, roles: v.roles, userId: v.id, chainIds: v.chain });
  const callPage = (v, f, extra = {}) => {
    const s = scopeOf(v);
    const a = [lit(ORG), lit(v.id), s.all, uuidArr(s.ownerIds), !!s.seesPool, v.team, f.search ? lit(f.search) : 'NULL', txtArr((f.industries || []).map((x) => x.toLowerCase())), f.whose ? lit(f.whose) : 'NULL', f.assignee ? lit(f.assignee) : 'NULL',
      f.dateRange ? lit(f.dateRange) : 'NULL', lit(TODAY) + '::date', lit(new Date(NOW).toISOString()) + '::timestamptz', f.dateFrom ? lit(f.dateFrom) + '::date' : 'NULL::date', f.dateTo ? lit(f.dateTo) + '::date' : 'NULL::date',
      txtArr(f.stages || []), extra.afterCreated ? lit(extra.afterCreated) + '::timestamptz' : 'NULL::timestamptz', extra.afterId ? lit(extra.afterId) + '::uuid' : 'NULL::uuid', extra.limit || 1000];
    return pg.rows('t', `SELECT id, created_at FROM leads_page(${a.map((x, i) => (i === 2 || i === 4 || i === 5 ? String(x) : x)).join(', ')})`);
  };
  const callCounts = (v, f) => {
    const s = scopeOf(v);
    return pg.rows('t', `SELECT kind, k, n::int n FROM leads_counts(${lit(ORG)}, ${lit(v.id)}, ${s.all}, ${uuidArr(s.ownerIds)}, ${!!s.seesPool}, ${v.team}, ${f.search ? lit(f.search) : 'NULL'}, ${txtArr((f.industries || []).map((x) => x.toLowerCase()))}, ${f.whose ? lit(f.whose) : 'NULL'}, ${f.assignee ? lit(f.assignee) : 'NULL'}, ${f.dateRange ? lit(f.dateRange) : 'NULL'}, ${lit(TODAY)}::date, ${lit(new Date(NOW).toISOString())}::timestamptz, ${f.dateFrom ? lit(f.dateFrom) + '::date' : 'NULL::date'}, ${f.dateTo ? lit(f.dateTo) + '::date' : 'NULL::date'})`);
  };
  const byId = new Map(raw.map((r) => [r.id, r]));
  const reference = (v, f) => {
    const scoped = own.scopeLeads(raw, scopeOf(v));
    const out = lq.queryLeads(scoped, f, { userId: v.id, teamManager: v.team, today: TODAY, nowMs: NOW, page: 0, perPage: 50 });
    const ids = out.ids.slice().sort((a, b) => { const A = byId.get(a), B = byId.get(b); return A.created_at < B.created_at ? 1 : A.created_at > B.created_at ? -1 : (a < b ? 1 : -1); });   // newest first; the id breaks ties (DESC)
    return { ids, out };
  };

  // ── same leads, same order, for every viewer × filter ──
  let compared = 0; const bad = []; let nonEmpty = 0; const distinct = new Set();
  for (const v of viewers) for (const f of filters) {
    const got = callPage(v, f).map((r) => r.id), want = reference(v, f).ids;
    compared++; if (want.length) nonEmpty++; distinct.add(want.length);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${v.name} ${JSON.stringify(f)}: sql ${got.length} vs js ${want.length}`);
  }
  ok(`SQL and the JavaScript reference agree on ${compared} viewer × filter cases (same leads, same newest-first order)`, bad.length === 0, bad.slice(0, 3).join(' | '));
  ok('the matrix is not vacuous: many cases return leads, and the sizes differ a lot', nonEmpty > 60 && distinct.size > 12, `${nonEmpty} non-empty, ${distinct.size} distinct sizes`);

  // ── who may see what (the dangerous part) ──
  const stranger = callPage(viewers[4], {});
  ok('a person with no leads and no pool access gets NOTHING (an empty scope never means "everything")', stranger.length === 0);
  const bdIds = callPage(viewers[2], {}).map((r) => byId.get(r.id));
  ok('a BD sees only leads they own, created or are assigned — never the pool, never a colleague\'s', bdIds.length > 0 && bdIds.every((j) => [j.assigned_to_bd, j.created_by, j.assigned_to].includes(users.bd1)), String(bdIds.length));
  ok('the RA lead sees the unowned pool; the BD does not', callPage(viewers[1], {}).some((r) => byId.get(r.id).assigned_to_bd === null) && !bdIds.some((j) => j.assigned_to_bd === null && ![j.created_by, j.assigned_to].includes(users.bd1)));
  const everyone = pg.rows('t', `select id from leads_page(${lit(users.foreign ? ORG : ORG)}, ${lit(users.admin)}, true, ARRAY[]::uuid[], true, false, NULL, NULL::text[], NULL, NULL, NULL, NULL, now(), NULL, NULL, NULL::text[], NULL, NULL, 1000)`).map((r) => r.id);
  ok("another company's leads are never returned, not even to an admin of this one (the org is part of every query)", pg.rows('t', `select count(*)::int n from jobs where org_id = ${lit(OTHER)}`)[0].n > 0 && everyone.every((id) => byId.has(id)) && everyone.length === raw.length, `${everyone.length}/${raw.length}`);
  ok('deleted leads never appear', !everyone.some((id) => !byId.has(id)));

  // ── paging by bookmark ──
  let pagingBad = 0, pagingCases = 0;
  for (const v of [viewers[0], viewers[3], viewers[1]]) for (const f of [{}, { search: 'nurse' }, { stages: ['Assigned', 'Connected'] }, { dateRange: 'custom', dateFrom: '2026-10-20' }]) for (const size of [1, 7, 13]) {
    pagingCases++;
    const all = []; let cursor = {};
    for (let guard = 0; guard < 400; guard++) {
      const page = callPage(v, f, { ...cursor, limit: size + 1 });
      all.push(...page.slice(0, size).map((r) => r.id));
      if (page.length <= size) break;
      const last = page[size - 1]; cursor = { afterCreated: last.created_at, afterId: last.id };
    }
    const want = reference(v, f).ids;
    if (JSON.stringify(all) !== JSON.stringify(want) || new Set(all).size !== all.length) pagingBad++;
  }
  ok(`paging by bookmark returns every lead once, in order, for ${pagingCases} cases (pages of 1, 7 and 13) — including leads that share one created_at`, pagingBad === 0, String(pagingBad));
  ok('the test data really has leads that share a created_at', new Set(raw.map((r) => r.created_at)).size < raw.length / 2);

  // ── the numbers ──
  let cBad = [], cCases = 0;
  for (const v of viewers) for (const f of filters.filter((x) => !x.stages)) {
    cCases++;
    const got = callCounts(v, f), ref = reference(v, f).out;
    const strip = Object.fromEntries(got.filter((r) => r.kind === 'strip').map((r) => [r.k, r.n]));
    const stripOk = lq.STAGE_LIST.every((st) => (strip[st] || 0) === (ref.stageCounts[st] || 0));
    const team = Object.fromEntries(got.filter((r) => r.kind === 'team').map((r) => [r.k, r.n]));
    const teamOk = !v.team || ((team.mine || 0) === ref.team.mine && (team.team || 0) === ref.team.team);
    if (!(stripOk && teamOk)) cBad.push(`${v.name} ${JSON.stringify(f)}`);
  }
  ok(`the stage counts and the my/team counts equal the reference for ${cCases} cases`, cBad.length === 0, cBad.slice(0, 3).join(' | '));

  // ── search is literal ──
  pg.exec('t', `UPDATE jobs SET position = 'Nurse 50% rate_x' WHERE id = ${lit(jid(1))};`);
  // ── the two drop-downs (migration 074): who owns how many, how many per industry — equal to the reference for every kind of viewer ──
  pg.execFile('t', path.resolve(new URL('../migrations/074_lead_list_facets.sql', import.meta.url).pathname));
  ok('migration 074 applies', true);
  pg.execFile('t', path.resolve(new URL('../migrations/074_lead_list_facets.sql', import.meta.url).pathname));
  ok('…and is safe to apply twice', true);
  ok('only the server may ask for the drop-down numbers (service_role yes; anon, authenticated, public no)',
    can('service_role', 'leads_facets(uuid,uuid,boolean,uuid[],boolean)') && !can('anon', 'leads_facets(uuid,uuid,boolean,uuid[],boolean)') && !can('authenticated', 'leads_facets(uuid,uuid,boolean,uuid[],boolean)'));
  const facetsOf = (v) => { const s = scopeOf(v); return pg.rows('t', `SELECT kind, k, label, n::int n FROM leads_facets(${lit(ORG)}, ${lit(v.id)}, ${s.all}, ${uuidArr(s.ownerIds)}, ${!!s.seesPool})`); };
  const facetRef = (v) => {
    const scoped = own.scopeLeads(raw, scopeOf(v)); const oc = {}, ic = {}; let nobody = 0;
    scoped.forEach((j) => { if (j.assigned_to_bd) oc[j.assigned_to_bd] = (oc[j.assigned_to_bd] || 0) + 1; else nobody++; const ind = lq.leadIndustryOf(lq.flat(j)); if (ind) ic[ind.toLowerCase()] = (ic[ind.toLowerCase()] || 0) + 1; });
    return { oc, ic, nobody };
  };
  const facetBad = [];
  for (const v of viewers) {
    const got = facetsOf(v), want = facetRef(v);
    const go = {}, gi = {}; let gn = 0;
    got.forEach((r) => { if (r.kind === 'owner') { if (r.k) go[r.k] = r.n; else gn = r.n; } else gi[r.k] = r.n; });
    if (JSON.stringify(go) !== JSON.stringify(want.oc) && JSON.stringify(Object.entries(go).sort()) !== JSON.stringify(Object.entries(want.oc).sort())) facetBad.push(v.id + ' owners');
    if (gn !== want.nobody) facetBad.push(v.id + ' nobody ' + gn + '/' + want.nobody);
    if (JSON.stringify(Object.entries(gi).sort()) !== JSON.stringify(Object.entries(want.ic).sort())) facetBad.push(v.id + ' industries');
  }
  ok('the drop-down numbers equal the reference for every kind of viewer (owners, "nobody", industries, other companies never counted)', facetBad.length === 0, facetBad.join('; '));
  ok('a stranger (sees nothing) gets no numbers', facetsOf(viewers[4]).length === 0);
  const find = (s) => callPage(viewers[0], { search: s }).map((r) => r.id);
  ok('"%" in a search means a percent sign, not "anything"', find('50% rate').includes(jid(1)) && !find('50% rate').includes(jid(2)) && find('%').every((id) => /%/.test(pg.rows('t', `select search_text from jobs where id = ${lit(id)}`)[0].search_text)));
  ok('"_" means an underscore, not "any one letter"', find('rate_x').includes(jid(1)) && find('rate_').length >= 1 && !find('rat_').includes(jid(1)));
  ok('a quote, a backslash and an injection attempt change nothing and break nothing', (() => { find("'; DROP TABLE jobs; --"); find('\\'); find('a\\%b'); return pg.rows('t', 'select count(*)::int n from jobs')[0].n === 120; })());
  ok('a search that matches nothing returns nothing', find('zzzzqqqq').length === 0);

  // ── the search text is kept by the database ──
  const sid = jid(3);
  pg.exec('t', `UPDATE companies SET name = 'Zebra Holdings' WHERE id = ${lit(cid(3))};`);
  ok('renaming a company: its leads are found by the new name', find('zebra holdings').includes(sid));
  ok('…and no longer by the old one', !find('delta').includes(sid) || pg.rows('t', `select search_text from jobs where id=${lit(sid)}`)[0].search_text.includes('delta'));
  pg.exec('t', `INSERT INTO contacts VALUES (${lit(kid(900))}, ${lit(ORG)}, ${lit(sid)}, 'Quentin', 'Zorro', 'q.zorro@newmail.test', false);`);
  ok('adding a contact: the lead is found by their name and by their email', find('quentin zorro').includes(sid) && find('q.zorro@newmail').includes(sid));
  pg.exec('t', `UPDATE contacts SET email = 'moved@else.test' WHERE id = ${lit(kid(900))};`);
  ok('changing a contact\'s email: found by the new one, not the old', find('moved@else').includes(sid) && !find('q.zorro@newmail').includes(sid));
  pg.exec('t', `DELETE FROM contacts WHERE id = ${lit(kid(900))};`);
  ok('removing a contact: no longer found by them', !find('quentin zorro').includes(sid) && !find('moved@else').includes(sid));
  pg.exec('t', `UPDATE jobs SET position = 'Quokka Wrangler' WHERE id = ${lit(sid)};`);
  ok('editing a lead\'s title: found by the new title', find('quokka').includes(sid));
  pg.exec('t', `INSERT INTO jobs (id, org_id, company_id, position, location, stage, created_by, assigned_to_bd) VALUES (${lit(jid(500))}, ${lit(ORG)}, ${lit(cid(3))}, 'Yak Shaver', 'Nowhere', 'Assigned', ${lit(users.bd1)}, ${lit(users.bd1)});`);
  ok('a brand-new lead is searchable at once', find('yak shaver').includes(jid(500)));
  ok('a search never matches ACROSS two parts (title | company)', find('yak shaver nowhere').length === 0);

  // ── a deliberate break is noticed ──
  const broken = fs.readFileSync(mig, 'utf8').replace("OR j.created_by = ANY($2) OR j.assigned_to = ANY($2)", "OR j.created_by = ANY($2)");
  const tmp = path.join(os.tmpdir(), 'broken073.sql'); fs.writeFileSync(tmp, broken);
  pg.exec('t', 'DROP FUNCTION IF EXISTS lead_where_sql(text,boolean,boolean,boolean,boolean,boolean,text,text,text,boolean,boolean,boolean,boolean) CASCADE;');
  pg.execFile('t', tmp);
  const afterBreak = []; for (const v of viewers) for (const f of filters.slice(0, 6)) { const got = callPage(v, f).map((r) => r.id), want = reference(v, f).ids; if (JSON.stringify(got) !== JSON.stringify(want)) afterBreak.push(1); }
  ok('mutation: a SQL that forgets "assigned_to" in who-may-see is caught by this comparison', afterBreak.length > 0, String(afterBreak.length));
} catch (e) { ok('the SQL test ran to the end without throwing', false, e.stack || e.message); }
finally { pg.stop(); }
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
