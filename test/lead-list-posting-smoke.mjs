// THE LEAD LIST CARRIES NO POSTING TEXT (R-301, 21 Oct). The memory watcher showed GET /jobs growing the free server 65-110 MB
// per load; 7.7 MB of the 8.7 MB of lead research was the pasted job description (`research.jd_raw`), sent for every lead to
// every tab every 3 minutes. Pinned here:
//   * the list copy drops the text, keeps every other research field, marks the drop, and carries the posting summary;
//   * the list is read in pages, ordered with a tie-breaker, and returns EVERY lead (no page silently dropped);
//   * a save from a list copy (Research panel PATCH, Edit lead PUT) never wipes the stored text; an explicit edit still wins;
//   * the screens load the text for one lead before showing or editing it.
// Usage: node test/lead-list-posting-smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };

const lp = require('../services/lead-posting.js');
const { loadLeadList } = require('../services/lead-list.js');

const POSTING = 'We are hiring a Commercial HVAC Lead Installer to run a crew of four on rooftop units and VRF systems. EPA 608 Universal required. '.repeat(4);
const full = { id: 'j1', position: 'HVAC Lead Installer', research: { jd_raw: 'Title: HVAC Lead Installer\n\n' + POSTING, requirements: { skill_1: 'EPA 608' }, source: 'finder', company: { expertise: 'HVAC' } } };

// ── the list copy ───────────────────────────────────────────────────────────
const lc = lp.forList(full);
ok('the list copy has no posting text', !('jd_raw' in lc.research) && !JSON.stringify(lc).includes('rooftop'));
ok('…and says it left it out', lc.research.jd_raw_omitted === true);
ok('…keeps every other research field', lc.research.requirements.skill_1 === 'EPA 608' && lc.research.source === 'finder' && lc.research.company.expertise === 'HVAC');
const st = lp.postingState(full);
ok('…and carries the same posting summary the posting box shows', lc.posting && lc.posting.has_posting === true && lc.posting.chars === st.chars && lc.posting.words === st.words, JSON.stringify(lc.posting));
ok('the original row is not changed (the cache never loses it by accident)', full.research.jd_raw.includes('rooftop'));
const none = lp.forList({ id: 'j2', position: 'X', research: { requirements: { skill_1: 'A' } } });
ok('a lead with no posting is not marked', !none.research.jd_raw_omitted && none.posting.has_posting === false);
ok('research stored as a JSON string is read, then cut', lp.forList({ id: 'j3', position: 'X', research: JSON.stringify(full.research) }).research.jd_raw_omitted === true);

// ── read in pages, every lead returned ──────────────────────────────────────
const TABLE = Array.from({ length: 701 }, (_, i) => ({ id: 'id' + String(i).padStart(4, '0'), org_id: i % 50 === 0 ? 'other' : 'o1', deleted_at: null,
  created_at: new Date(Date.parse('2026-10-01') + Math.floor(i / 3) * 1000).toISOString(), position: 'P' + i, research: { jd_raw: 'Title: P\n\n' + POSTING } }));
const calls = [];
const fake = { from() {
  const f = []; let ord = []; let rng = null;
  const api = {
    select() { return api; }, is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; }, eq(k, v) { f.push(r => r[k] === v); return api; },
    order(k, o) { ord.push([k, o.ascending]); return api; }, range(a, b) { rng = [a, b]; calls.push({ rng, ord: ord.slice() }); return api; },
    then(res, rej) {
      let rows = TABLE.filter(r => f.every(fn => fn(r)));
      rows.sort((x, y) => { for (const [k, asc] of ord) { if (x[k] < y[k]) return asc ? -1 : 1; if (x[k] > y[k]) return asc ? 1 : -1; } return 0; });
      return Promise.resolve({ data: rows.slice(rng[0], rng[1] + 1), error: null }).then(res, rej);
    },
  };
  return api;
} };
const got = await loadLeadList({ supabase: fake, select: '*', orgId: 'o1', pageSize: 100 });
const want = TABLE.filter(r => r.org_id === 'o1').length;
ok('every lead of the org comes back, across pages', got.length === want && new Set(got.map(r => r.id)).size === want, got.length + ' / ' + want);
ok('read in pages (no single read of the whole list)', calls.length === Math.ceil(want / 100) + (want % 100 === 0 ? 1 : 0) && calls.every(c => c.rng[1] - c.rng[0] === 99), calls.length + ' reads');
ok('ordered newest first with the id as a tie-breaker', calls.every(c => c.ord[0][0] === 'created_at' && c.ord[0][1] === false && c.ord[1][0] === 'id'));
ok('no posting text in anything the list returns', got.every(r => !('jd_raw' in r.research) && r.research.jd_raw_omitted === true));

// ── a save from a list copy never wipes the text ────────────────────────────
const stored = full.research;
ok('the Research panel saving a list copy keeps the stored posting', lp.keepStoredPosting(Object.assign({}, lc.research, { company: { notes: 'new' } }), stored).jd_raw === stored.jd_raw);
ok('…and the mark is never stored', !('jd_raw_omitted' in lp.keepStoredPosting(lc.research, stored)));
ok('a research object with no posting key keeps the stored one', lp.keepStoredPosting({ requirements: {} }, stored).jd_raw === stored.jd_raw);
ok('an explicit clear (no mark) is the person\'s edit and wins', lp.keepStoredPosting({ jd_raw: null }, stored).jd_raw === null);
ok('an explicit new posting wins', lp.keepStoredPosting({ jd_raw: 'Title: X\n\nnew text', jd_raw_omitted: true }, stored).jd_raw === 'Title: X\n\nnew text');
ok('nothing stored and nothing sent → still nothing', !('jd_raw' in lp.keepStoredPosting({ jd_raw_omitted: true, source: 's' }, null)));

// The routes, run: PATCH /jobs/:id/research and PUT /jobs/:id against an in-memory table.
const T = { jobs: [{ id: 'j1', org_id: 'o1', position: 'HVAC Lead Installer', created_by: 'u-ra', created_at: new Date().toISOString(), assigned_to: null, assigned_to_bd: null, stage: 'Unassigned', industry: 'HVAC', research: JSON.parse(JSON.stringify(stored)), deleted_at: null }] };
function q(table) {
  const f = []; let upd = null;
  const api = {
    select() { return api; }, eq(k, v) { f.push(r => r[k] === v); return api; }, is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    in() { return api; }, update(p) { upd = p; return api; }, delete() { return api; },
    async maybeSingle() { const rows = (T[table] || []).filter(r => f.every(fn => fn(r))); if (upd) rows.forEach(r => Object.assign(r, upd)); return { data: rows[0] || null, error: null }; },
    async single() { return api.maybeSingle(); },
    then(res, rej) { return api.maybeSingle().then(res, rej); },
  };
  return api;
}
const supabase = { from: q };
const { hasRole, canTouchJob } = require('../middleware/authorize.js')({ supabase });
const router = require('../routes/jobs.js')({
  supabase, auth: (_a, _b, n) => n(), hasRole, canTouchJob, withOrg: (query, req) => query.eq('org_id', req.orgId),
  orgIdFor: (req) => req.orgId, orgStamp: () => ({}), today: () => '2026-10-21', logActivity: async () => {}, loadAllJobs: async () => [],
  JOB_SELECT: '*', getTimezoneFromLocation: () => 'EST', persistLearnedSkills: () => {},
});
const handler = (path, method) => { const l = router.stack.find(x => x.route && x.route.path === path && x.route.methods[method]); return l && l.route.stack.slice(-1)[0].handle; };
const run = async (h, req) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } }; await h(Object.assign({ orgId: 'o1' }, req), res); return { status, out }; };
let r = await run(handler('/jobs/:id/research', 'patch'), { params: { id: 'j1' }, user: { id: 'u-rl', roles: ['ra_lead'] }, body: { research: Object.assign({}, lc.research, { company: { notes: 'Saved from the panel' } }) } });
ok('PATCH /jobs/:id/research from a list copy: saved, posting kept', r.status === 200 && T.jobs[0].research.company.notes === 'Saved from the panel' && T.jobs[0].research.jd_raw === stored.jd_raw && !('jd_raw_omitted' in T.jobs[0].research), r.status + ' ' + JSON.stringify(r.out).slice(0, 120));
const put = handler('/jobs/:id', 'put');
ok('PUT /jobs/:id exists', !!put);
r = await run(put, { params: { id: 'j1' }, user: { id: 'admin1', roles: ['admin'] }, body: { research: { requirements: { skill_1: 'OSHA' }, jd_raw_omitted: true } } });
ok('PUT /jobs/:id with a list-copy research: posting kept', T.jobs[0].research.jd_raw === stored.jd_raw && T.jobs[0].research.requirements.skill_1 === 'OSHA', r.status + ' ' + JSON.stringify(r.out).slice(0, 160));

// ── the screens load the text before showing or editing it ──────────────────
const api = fs.readFileSync(new URL('../public/js/22-api.js', import.meta.url), 'utf8');
const post = fs.readFileSync(new URL('../public/js/59-lead-posting.js', import.meta.url), 'utf8');
const ra = fs.readFileSync(new URL('../public/js/15-ra-entry-form.js', import.meta.url), 'utf8');
ok('one loader fetches the single lead for its text', /window\.loadLeadPosting=function\(id\)\{[\s\S]{0,200}apiGet\('\/jobs\/'\+encodeURIComponent\(id\)\)/.test(api));
ok('the posting box loads before Show / Edit', /function withText\(id, then\)[\s\S]{0,200}loadLeadPosting\(id\)/.test(post) && /leadPostingShow=function[\s\S]{0,120}withText\(/.test(post) && /leadPostingEdit=function[\s\S]{0,160}withText\(/.test(post));
ok('Edit lead loads before it opens', /window\.raFormEdit=function\(jobId\)\{[\s\S]{0,260}loadLeadPosting\(jobId\)\.then\(function\(\)\{raFormEditLoaded\(jobId\)/.test(ra));
// Run the list-copy merge as the browser would: the kept text survives the 3-minute refresh, and a stale copy is dropped.
const ctx = { STATE: { jobs: [] }, window: {}, parseResearchObject: (r) => (typeof r === 'string' ? JSON.parse(r) : (r || {})) };
const src = api.slice(api.indexOf('function jobPostings()'), api.indexOf('window.leadPostingLoaded'));
const fn = new Function('STATE', 'window', 'parseResearchObject', src + '\nreturn { listResearch, jobPostings };');
const m = fn(ctx.STATE, ctx.window, ctx.parseResearchObject);
m.jobPostings().j1 = stored.jd_raw;
ok('a loaded posting is put back on the refreshed list copy', m.listResearch(lc).jd_raw === stored.jd_raw && !m.listResearch(lc).jd_raw_omitted);
ok('a kept copy that no longer matches the server\'s summary is dropped', m.listResearch(Object.assign({}, lc, { posting: Object.assign({}, lc.posting, { chars: 5 }) })).jd_raw_omitted === true && m.jobPostings().j1 === undefined);

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
