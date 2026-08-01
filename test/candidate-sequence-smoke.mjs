// Tests candidate nurture sequences end to end against the real workflow engine.
//
// The bug this exists to prevent recurring: enrolling a candidate USED TO
// silently do nothing. No context loader was registered for `entity_type:
// 'candidate'`, so the engine handed each step an empty context, the email
// channel read an undefined candidate, returned "no_candidate_email", and the
// enrollment marched to `completed` without ever sending. It looked like it had
// worked. Every assertion below about "actually sent" is guarding that.
//
// Uses the real workflow-engine.js with a fake Supabase and fake channels, so
// the engine's own dispatch, context-loading and exit semantics are exercised
// rather than mocked.
//
// Usage: node test/candidate-sequence-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWorkflowEngine } = require('../workflow-engine.js');

// The engine logs a summary per tick; the assertions below are the output that matters.
const _log = console.log; console.log = (...a) => { if (!/^\[wf\]/.test(String(a[0] || ''))) _log(...a); };

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── a fake Supabase covering only what the engine touches ────────────────────
function fakeDb(seed = {}) {
  const rows = {
    workflow_definitions: seed.definitions || [],
    workflow_steps: seed.steps || [],
    workflow_enrollments: seed.enrollments || [],
    workflow_step_runs: [],
    candidates: seed.candidates || [],
    submissions: seed.submissions || [],
    app_settings: []
  };
  let seq = 0;

  function from(table) {
    const t = rows[table] || (rows[table] = []);
    const f = [];
    const b = {
      select() { return b; },
      eq(c, v) { f.push(r => String(r[c]) === String(v)); return b; },
      neq(c, v) { f.push(r => String(r[c]) !== String(v)); return b; },
      in(c, vs) { f.push(r => vs.map(String).includes(String(r[c]))); return b; },
      is(c, v) { if (v === null) f.push(r => r[c] == null); return b; },
      lte(c, v) { f.push(r => r[c] != null && r[c] <= v); return b; },
      gte(c, v) { f.push(r => r[c] != null && r[c] >= v); return b; },
      order() { return b; },
      limit() { return b; },
      _rows() { return t.filter(r => f.every(fn => fn(r))); },
      maybeSingle() { return Promise.resolve({ data: b._rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: b._rows()[0] || null, error: null }); },
      insert(payload) {
        const arr = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: p.id || `row-${++seq}`, ...p }));
        if (table === 'workflow_enrollments') {
          const clash = arr.some(a => t.some(r => r.status === 'active'
            && r.workflow_id === a.workflow_id && r.entity_type === a.entity_type
            && String(r.entity_id) === String(a.entity_id)
            && String(r.job_id || '') === String(a.job_id || '')));
          if (clash) {
            const err = { code: '23505', message: 'duplicate key value violates unique constraint "uq_wf_enr_active"' };
            const pe = Promise.resolve({ data: null, error: err });
            pe.select = () => ({ single: () => Promise.resolve({ data: null, error: err }) });
            return pe;
          }
        }
        arr.forEach(a => t.push(a));
        const p = Promise.resolve({ data: arr, error: null });
        p.select = () => ({ single: () => Promise.resolve({ data: arr[0], error: null }) });
        return p;
      },
      update(patch) {
        const apply = (pred) => { t.filter(pred).forEach(r => Object.assign(r, patch)); return Promise.resolve({ data: null, error: null }); };
        const p = Promise.resolve({ data: null, error: null });
        p.eq = (c, v) => apply(r => String(r[c]) === String(v));
        // exitEntity updates by a set of ids, not a single one.
        p.in = (c, vs) => apply(r => vs.map(String).includes(String(r[c])));
        return p;
      },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      then(res) { return Promise.resolve({ data: b._rows(), error: null }).then(res); }
    };
    return b;
  }
  return { rows, client: { from } };
}

const EVENTS = { WORKFLOW_ENROLLED: 'e1', WORKFLOW_STEP_EXECUTED: 'e2', WORKFLOW_COMPLETED: 'e3', WORKFLOW_EXITED: 'e4' };
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function buildEngine(seed, { withLoader = true } = {}) {
  const db = fakeDb(seed);
  const sent = [];
  const engine = createWorkflowEngine({ supabase: db.client, emit: () => {}, EVENTS });

  if (withLoader) {
    // Mirrors the real loader registered in index.js — crucially, it returns
    // null for a missing candidate so the engine exits rather than completing.
    engine.registerContextLoader('candidate', async (enrollment) => {
      const c = db.rows.candidates.find(x => x.id === enrollment.entity_id && !x.deleted_at);
      if (!c) return null;
      return { candidate: c, job_order: null, submission: null };
    });
  }

  engine.registerChannel('candidate_email', async ({ context, step }) => {
    if (!context.candidate?.email) return { outcome: 'skipped', detail: { reason: 'no_candidate_email' } };
    sent.push({ to: context.candidate.email, step: step.name, tracked: true });
    return { outcome: 'done', detail: { to: context.candidate.email } };
  }, { entity_types: ['submission', 'candidate'] });

  engine.registerChannel('candidate_status_move', async ({ context, step }) => {
    if (!context.candidate) return { outcome: 'skipped', detail: { reason: 'no_candidate' } };
    context.candidate.applicant_status = (step.config || {}).to_status;
    return { outcome: 'done' };
  }, { entity_types: ['candidate'] });

  return { db, engine, sent };
}

const SEED = () => ({
  definitions: [{ id: 'wf1', entity_type: 'candidate', status: 'active', org_id: 'org1', name: 'Nurture' }],
  steps: [
    { id: 'st1', workflow_id: 'wf1', step_order: 1, name: 'Touch 1', channel: 'candidate_email', delay_days: 0, config: {} },
    { id: 'st2', workflow_id: 'wf1', step_order: 2, name: 'Mark nurturing', channel: 'candidate_status_move', delay_days: 0, config: { to_status: 'Nurturing' } }
  ],
  candidates: [{ id: 'c1', full_name: 'Ada Lovelace', email: 'ada@example.com', applicant_status: 'New lead' }]
});

// ── 1. THE REGRESSION: a candidate enrolment actually sends ─────────────────
{
  const { db, engine, sent } = buildEngine(SEED());
  const enr = await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  ok('a candidate can be enrolled', Boolean(enr && enr.id), JSON.stringify(enr));
  ok('the enrolment records the candidate entity type', enr.entity_type === 'candidate', enr.entity_type);
  ok('job_id is left null (the FK points at the sales jobs table)', enr.job_id == null, String(enr.job_id));

  await engine.tick();
  ok('THE FIX: the first step actually sends', sent.length === 1 && sent[0].to === 'ada@example.com', JSON.stringify(sent));

  const runs = db.rows.workflow_step_runs;
  ok('the send is recorded as done, not skipped',
    runs.length === 1 && runs[0].outcome === 'done', JSON.stringify(runs.map(r => r.outcome)));
  ok('it is NOT the old silent no-op',
    !runs.some(r => (r.detail || {}).reason === 'no_candidate_email'), JSON.stringify(runs));
}

// ── 2. Without the loader it fails the old way — proving the test bites ─────
{
  const { db, engine, sent } = buildEngine(SEED(), { withLoader: false });
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.tick();
  ok('without a context loader nothing sends (the original bug)', sent.length === 0);
  ok('...and it silently reports skipped rather than failing loudly',
    db.rows.workflow_step_runs.some(r => (r.detail || {}).reason === 'no_candidate_email'),
    JSON.stringify(db.rows.workflow_step_runs));
}

// ── 3. A missing candidate exits, rather than quietly completing ────────────
{
  const seed = SEED(); seed.candidates = [];
  const { db, engine, sent } = buildEngine(seed);
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.tick();
  const enr = db.rows.workflow_enrollments[0];
  ok('a deleted candidate exits the sequence', enr.status === 'exited', enr.status);
  ok('...with a reason that says why', enr.exit_reason === 'entity_missing', enr.exit_reason);
  ok('...and nothing was sent', sent.length === 0);
}

// ── 4. Steps advance in order and the sequence completes ───────────────────
{
  const { db, engine, sent } = buildEngine(SEED());
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.tick();                                   // step 1
  db.rows.workflow_enrollments[0].next_step_due_date = yesterday;   // make step 2 due
  await engine.tick();                                   // step 2
  ok('the second step runs', db.rows.workflow_step_runs.length === 2);
  ok('the status-move step updates the candidate',
    db.rows.candidates[0].applicant_status === 'Nurturing', db.rows.candidates[0].applicant_status);
  ok('the sequence completes after its last step',
    db.rows.workflow_enrollments[0].status === 'completed', db.rows.workflow_enrollments[0].status);
  ok('exactly one email went out across the whole sequence', sent.length === 1, String(sent.length));
}

// ── 5. A reply exits the sequence — the safety property ────────────────────
{
  const { db, engine, sent } = buildEngine(SEED());
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.tick();
  ok('one email sent before the reply', sent.length === 1);

  await engine.exitEntity({ entity_type: 'candidate', entity_id: 'c1', reason: 'replied' });
  const enr = db.rows.workflow_enrollments[0];
  ok('replying exits the enrolment', enr.status === 'exited', enr.status);
  ok('...recorded as a reply', enr.exit_reason === 'replied', enr.exit_reason);

  db.rows.workflow_enrollments[0].next_step_due_date = yesterday;
  await engine.tick();
  ok('THE POINT: no further email after a reply', sent.length === 1, `sent=${sent.length}`);
}

// ── 6. An unsubscribe exits too ─────────────────────────────────────────────
{
  const { db, engine } = buildEngine(SEED());
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.exitEntity({ entity_type: 'candidate', entity_id: 'c1', reason: 'unsubscribed' });
  ok('an unsubscribe exits the enrolment', db.rows.workflow_enrollments[0].exit_reason === 'unsubscribed');
}

// ── 7. Exiting a candidate must not touch a different candidate ────────────
{
  const seed = SEED();
  seed.candidates.push({ id: 'c2', full_name: 'Grace Hopper', email: 'grace@example.com', applicant_status: 'New lead' });
  const { db, engine } = buildEngine(seed);
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c2', org_id: 'org1', enrolled_by: 'u1' });
  await engine.exitEntity({ entity_type: 'candidate', entity_id: 'c1', reason: 'replied' });
  const byId = Object.fromEntries(db.rows.workflow_enrollments.map(e => [e.entity_id, e]));
  ok('the replying candidate is exited', byId['c1'].status === 'exited');
  ok('the other candidate keeps running', byId['c2'].status === 'active', byId['c2'].status);
}

// ── 8. Enrolling the same candidate twice is refused ───────────────────────
{
  const { engine } = buildEngine(SEED());
  await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' });
  let msg = '';
  try { await engine.enroll({ workflow_id: 'wf1', entity_type: 'candidate', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' }); }
  catch (e) { msg = e.message; }
  ok('a double enrolment is rejected', /already/i.test(msg), msg || 'no error thrown');
}

// ── 9. A mismatched entity type is refused ─────────────────────────────────
{
  const { engine } = buildEngine(SEED());
  let msg = '';
  try { await engine.enroll({ workflow_id: 'wf1', entity_type: 'contact', entity_id: 'c1', org_id: 'org1', enrolled_by: 'u1' }); }
  catch (e) { msg = e.message; }
  ok('enrolling a contact into a candidate workflow is refused', /entity_type/i.test(msg), msg || 'no error thrown');
}

// ── 10. The shipped nurture template reads correctly with no job ───────────
// The job-attached default renders "Opportunity: " and "a  role we're working
// on with ." when there is no job_order — every variable degrades to empty.
{
  const src = require('node:fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  ok('a separate nurture default exists', /DEFAULT_CANDIDATE_NURTURE_EMAIL/.test(src));
  const block = (src.match(/DEFAULT_CANDIDATE_NURTURE_EMAIL\s*=\s*\{[\s\S]*?\};/) || [''])[0];
  ok('the nurture template references no job variables',
    !/\{\{(position|client|company|job_code)\}\}/.test(block), block.slice(0, 200));
  ok('...and still greets by name', /\{\{first_name\}\}/.test(block));
  ok('the channel picks a template based on whether a job is attached',
    /defaultCandidateTemplate\(job_order\)/.test(src));
  ok('sequence sends are now tracked', /channel: 'candidate_sequence'/.test(src));
  const chan = (src.match(/registerChannel\('candidate_email'[\s\S]*?entity_types: \[[^\]]*\], label: 'Email the candidate'/) || [''])[0];
  ok('the candidate_email channel accepts candidates, not just submissions',
    /entity_types: \['submission', 'candidate'\]/.test(chan), chan.slice(-90));
  ok('sequence sends respect the mailbox auto-pause gate', /mailbox_autopaused/.test(chan));
  ok('sequence sends respect the warm-up ramp', /warmupLimit\(/.test(chan));
  ok('sequence sends carry an open-tracking pixel', /injectTrackPixel\(/.test(chan));
}

console.log('\n=== CANDIDATE SEQUENCE SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
