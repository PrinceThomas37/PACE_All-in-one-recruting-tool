// TAGGING PUTS A CANDIDATE ON THE JOB (Session 31).
//
// The owner tagged candidates to a job from the database and they never
// appeared on the job's page. Measured live: 15 of 15 tagged rows had a
// `candidate_pipeline` row and NO `submissions` row — and the job page, the
// board, the funnel and every report read `submissions`. Session 28 fixed the
// same hole on the applicant import; the plain Tag button was left open.
//
// This drives the REAL route handlers in routes/recruiting/pipeline.js against
// an in-memory database, and asserts:
//   * POST /pipeline writes the tag AND a `Sourced` submission, linked, with
//     NO submitted_at (D-0029 — adding somebody is not submitting them);
//   * POST /pipeline/bulk does it for many in one request, and counts
//     added / already / not found;
//   * re-tagging somebody already tagged HEALS a missing submission (how the
//     15 live rows get fixed without a data migration) and still answers 409;
//   * a candidate from another company is "not found", never tagged.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── a small in-memory PostgREST ────────────────────────────────────────────
const tables = { job_orders: [], candidates: [], candidate_pipeline: [], submissions: [], submission_activity: [] };
const UNIQUE = { candidate_pipeline: ['candidate_id', 'job_order_id'], submissions: ['candidate_id', 'job_order_id'] };
let seq = 0;
function q(table) {
  const st = { filters: [], op: 'select', payload: null };
  const rows = () => tables[table].filter(r => st.filters.every(f => f(r)));
  const api = {
    select() { return api; },
    eq(k, v) { st.filters.push(r => r[k] === v); return api; },
    is(k, v) { st.filters.push(r => (r[k] == null) === (v == null)); return api; },
    in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
    order() { return api; }, limit() { return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    async maybeSingle() { const r = await run(); return { data: r.data ? (Array.isArray(r.data) ? r.data[0] || null : r.data) : null, error: r.error }; },
    async single() { const r = await run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: r.error || (d ? null : { message: 'no row' }) }; },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    if (st.op === 'insert') {
      const u = UNIQUE[table];
      if (u && tables[table].some(r => !r.deleted_at && u.every(k => r[k] === st.payload[k]))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const row = Object.assign({ id: table + '-' + (++seq), deleted_at: null }, st.payload);
      tables[table].push(row); return { data: row, error: null };
    }
    if (st.op === 'update') { rows().forEach(r => Object.assign(r, st.payload)); return { data: rows(), error: null }; }
    return { data: rows(), error: null };
  }
  return api;
}
const supabase = { from: q };

// ── mount the real router on a fake app ────────────────────────────────────
const handlers = {};
const app = new Proxy({}, { get: (_, m) => (path, ...fns) => { handlers[m.toUpperCase() + ' ' + path] = fns[fns.length - 1]; } });
const ORG = 'org-a';
require('../routes/recruiting/pipeline.js')(app, {
  supabase, auth: (_r, _s, n) => n(), hasRole: () => false,
  orgIdFor: (req) => req.orgId, orgStamp: (req) => ({ org_id: req.orgId }),
  withOrg: (query, req) => query.eq('org_id', req.orgId),
  isBDM: () => true, isRecruiter: () => false, recruiterCanTouchJob: async () => true,
  nextId: async (p) => p + '-' + (++seq),
  logSubmissionActivity: async (...a) => { tables.submission_activity.push(a); },
  SUBMISSION_SELECT: '*', STAGES: [], normalizeStage: (x) => x,
});
async function call(key, body) {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await handlers[key]({ body, user: { id: 'u1' }, orgId: ORG, params: {} }, res);
  return { status, body: out };
}

tables.job_orders.push({ id: 'jo1', org_id: ORG, deleted_at: null });
for (let i = 0; i < 4; i++) tables.candidates.push({ id: 'c' + i, org_id: ORG, deleted_at: null, current_employer: 'Acme' });
tables.candidates.push({ id: 'foreign', org_id: 'org-b', deleted_at: null });

step('the bulk route exists and sits in the router', typeof handlers['POST /pipeline/bulk'] === 'function');

// single tag
const one = await call('POST /pipeline', { candidate_id: 'c0', job_order_id: 'jo1' });
const sub0 = tables.submissions.find(s => s.candidate_id === 'c0');
step('a single tag answers 201', one.status === 201, String(one.status));
step('…and writes a Sourced submission for that person on that job', !!sub0 && sub0.stage === 'Sourced' && sub0.job_order_id === 'jo1');
step('…with NO submitted_at (D-0029: membership, not a submission)', sub0 && !sub0.submitted_at);
step('…and the tag row links to it', !!sub0 && tables.candidate_pipeline.find(p => p.candidate_id === 'c0').submission_id === sub0.id);

// bulk: c0 already there, c1..c3 new, one unknown, one foreign
const bulk = await call('POST /pipeline/bulk', { job_order_id: 'jo1', candidate_ids: ['c0', 'c1', 'c2', 'c3', 'nope', 'foreign'] });
step('bulk counts added / already / not found', bulk.status === 200 && bulk.body.added === 3 && bulk.body.already === 1 && bulk.body.not_found === 2, JSON.stringify(bulk.body));
step('every added person is on the job (a submission each)', ['c1', 'c2', 'c3'].every(id => tables.submissions.some(s => s.candidate_id === id && s.job_order_id === 'jo1')));
step('another company\'s candidate is never tagged', !tables.candidate_pipeline.some(p => p.candidate_id === 'foreign'));

// heal: a legacy tag with no submission (the live state of all 15 rows)
tables.candidate_pipeline.push({ id: 'legacy', org_id: ORG, candidate_id: 'c9', job_order_id: 'jo1', deleted_at: null, submission_id: null });
tables.candidates.push({ id: 'c9', org_id: ORG, deleted_at: null });
const again = await call('POST /pipeline', { candidate_id: 'c9', job_order_id: 'jo1' });
step('re-tagging an already-tagged person still answers 409', again.status === 409, String(again.status));
step('…but HEALS the missing submission and links it', tables.submissions.some(s => s.candidate_id === 'c9') &&
  tables.candidate_pipeline.find(p => p.id === 'legacy').submission_id);

const bad = await call('POST /pipeline/bulk', { job_order_id: 'jo1', candidate_ids: [] });
step('an empty list is refused', bad.status === 400);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
