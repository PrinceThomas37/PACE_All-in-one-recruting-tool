// ============================================================================
// RECORD HISTORY — the rewind button's rules.
//
// The pure half (services/record-history.js) is exercised directly; the wiring
// half is checked by grep + a real browser, because the faults that actually
// shipped in this repo were never in the pure part.
//
// ⚠ EVERY TIME ASSERTION USES AN INJECTED `now`. `relativeTime` makes a factual
// claim about elapsed time, so a test calling it with the real clock passes on
// the day it is written and rots quietly after that (the conversation-intel
// rule, CLAUDE.md).
// ============================================================================
import assert from 'node:assert';
import fs from 'node:fs';
import H from '../services/record-history.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('[PASS] ' + name); pass++; }
  catch (e) { console.log('[FAIL] ' + name + '  — ' + e.message); fail++; }
};

console.log('=== RECORD HISTORY ===');

// ── the entry shape ─────────────────────────────────────────────────────────

t('a row with no timestamp is DROPPED, never dated now', () => {
  assert.strictEqual(H._entry({ at: null, to: 'Screening' }), null);
  assert.strictEqual(H._entry({ at: '', to: 'Screening' }), null);
  // A history whose times are invented is worse than a short one.
  assert.ok(H._entry({ at: '2026-09-23T10:00:00Z', to: 'Screening' }));
});

t('a jsonb blob and a bare string collapse to the same word', () => {
  assert.strictEqual(H._valueOf('Assigned'), 'Assigned');
  assert.strictEqual(H._valueOf({ stage: 'Assigned' }, 'stage'), 'Assigned');
  assert.strictEqual(H._valueOf({ value: 'Assigned' }), 'Assigned');
  assert.strictEqual(H._valueOf(null), null);
});

// ── the three stores, one shape ─────────────────────────────────────────────

t('activity_log stage change normalises to a stage entry', () => {
  const e = H.fromActivityLog({
    created_at: '2026-09-23T10:00:00Z', action_type: 'stage_change',
    old_value: { stage: 'Unassigned' }, new_value: { stage: 'Assigned' },
    user: { name: 'Prince' }, description: 'Stage: Unassigned → Assigned',
  });
  assert.strictEqual(e.kind, 'stage');
  assert.strictEqual(e.from, 'Unassigned');
  assert.strictEqual(e.to, 'Assigned');
  assert.strictEqual(e.actor, 'Prince');
});

t('activity_log non-stage rows survive as their own action', () => {
  const e = H.fromActivityLog({ created_at: '2026-09-23T10:00:00Z', action_type: 'job_created' });
  assert.strictEqual(e.kind, 'job_created');
  assert.strictEqual(H.describe(e), 'Lead created');
});

t('submission_activity normalises to the SAME shape', () => {
  const e = H.fromSubmissionActivity({
    created_at: '2026-09-23T11:00:00Z', old_stage: 'Sourced', new_stage: 'Screening',
    recruiter: { name: 'Asha' },
  });
  assert.strictEqual(e.kind, 'stage');
  assert.strictEqual(e.from, 'Sourced');
  assert.strictEqual(e.to, 'Screening');
  assert.strictEqual(e.actor, 'Asha');
  // The point of the whole file: three stores, one entry.
  assert.deepStrictEqual(Object.keys(e).sort(),
    Object.keys(H.fromActivityLog({ created_at: 'x', action_type: 'y' })).sort());
});

t('record_history normalises to the same shape', () => {
  const e = H.fromRecordHistory({
    created_at: '2026-09-23T12:00:00Z', action: 'stage', field: 'status',
    old_value: { value: 'Active' }, new_value: { value: 'Filled' },
    actor: { name: 'Prince' },
  });
  assert.strictEqual(e.field, 'status');
  assert.strictEqual(e.from, 'Active');
  assert.strictEqual(e.to, 'Filled');
});

// ── the timeline ────────────────────────────────────────────────────────────

t('timeline merges several stores and sorts NEWEST FIRST', () => {
  const a = [H.fromActivityLog({ created_at: '2026-09-20T10:00:00Z', action_type: 'job_created' })];
  const b = [H.fromSubmissionActivity({ created_at: '2026-09-23T10:00:00Z', new_stage: 'Screening' })];
  const out = H.timeline([a, b]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].at, '2026-09-23T10:00:00Z');
  assert.strictEqual(out[1].at, '2026-09-20T10:00:00Z');
});

t('timeline drops nulls rather than throwing on them', () => {
  assert.strictEqual(H.timeline([[null, undefined], null]).length, 0);
});

// ── the sentence ────────────────────────────────────────────────────────────

t('a stage change names BOTH ends', () => {
  const e = H.fromSubmissionActivity({ created_at: 'x', old_stage: 'Sourced', new_stage: 'Screening' });
  // "Screening" alone does not say whether that was progress.
  assert.strictEqual(H.describe(e), 'Stage: Sourced → Screening');
});

t('a FIRST value says "set to", never inventing a previous one', () => {
  const e = H.fromSubmissionActivity({ created_at: 'x', old_stage: null, new_stage: 'Sourced' });
  assert.strictEqual(H.describe(e), 'Stage set to Sourced');
});

t('a cleared value says what it was', () => {
  const e = H.fromRecordHistory({ created_at: 'x', field: 'owner_id', old_value: { value: 'Asha' }, new_value: null });
  assert.match(H.describe(e), /cleared \(was Asha\)/);
});

// ── time, with an injected clock ────────────────────────────────────────────

t('relativeTime reads from the clock it is GIVEN', () => {
  const now = '2026-09-23T12:00:00Z';
  assert.strictEqual(H.relativeTime('2026-09-23T11:59:30Z', now), 'just now');
  assert.strictEqual(H.relativeTime('2026-09-23T11:30:00Z', now), '30 mins ago');
  assert.strictEqual(H.relativeTime('2026-09-23T09:00:00Z', now), '3 hours ago');
  assert.strictEqual(H.relativeTime('2026-09-22T12:00:00Z', now), 'yesterday');
  assert.strictEqual(H.relativeTime('2026-09-13T12:00:00Z', now), '10 days ago');
});

t('singular and plural are not the same word', () => {
  const now = '2026-09-23T12:00:00Z';
  assert.strictEqual(H.relativeTime('2026-09-23T11:00:00Z', now), '1 hour ago');
  assert.strictEqual(H.relativeTime('2026-09-23T10:00:00Z', now), '2 hours ago');
});

t('a future timestamp is "just now", not a negative age', () => {
  // Clock skew between a browser and the server is normal; a time machine is not.
  assert.strictEqual(H.relativeTime('2026-09-23T13:00:00Z', '2026-09-23T12:00:00Z'), 'just now');
});

t('an unparseable timestamp returns null rather than a wrong answer', () => {
  assert.strictEqual(H.relativeTime('not-a-date', '2026-09-23T12:00:00Z'), null);
  assert.strictEqual(H.relativeTime('2026-09-23T12:00:00Z', 'nonsense'), null);
});

// ── how long it sat there ───────────────────────────────────────────────────

t('durations measure how long the record HELD each stage', () => {
  const entries = H.timeline([[
    H.fromSubmissionActivity({ created_at: '2026-09-23T12:00:00Z', new_stage: 'Screening' }),
    H.fromSubmissionActivity({ created_at: '2026-09-21T12:00:00Z', new_stage: 'Sourced' }),
  ]]);
  const d = H.durations(entries, '2026-09-24T12:00:00Z');
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].stage, 'Screening');
  assert.strictEqual(d[0].open, true);                       // still there
  assert.strictEqual(d[0].ms, 24 * 3600000);                 // 1 day, to `now`
  assert.strictEqual(d[1].stage, 'Sourced');
  assert.strictEqual(d[1].open, false);
  assert.strictEqual(d[1].ms, 48 * 3600000);                 // 2 days, then moved
});

t('only the newest stage is open', () => {
  const entries = H.timeline([[
    H.fromSubmissionActivity({ created_at: '2026-09-23T12:00:00Z', new_stage: 'Offer' }),
    H.fromSubmissionActivity({ created_at: '2026-09-22T12:00:00Z', new_stage: 'Screening' }),
    H.fromSubmissionActivity({ created_at: '2026-09-21T12:00:00Z', new_stage: 'Sourced' }),
  ]]);
  const d = H.durations(entries, '2026-09-24T12:00:00Z');
  assert.strictEqual(d.filter(x => x.open).length, 1);
  assert.strictEqual(d[0].stage, 'Offer');
});

// ── the entity contract ─────────────────────────────────────────────────────

t('the five record kinds are the contract, and an unknown one is refused', () => {
  for (const k of ['lead', 'candidate', 'job_order', 'submission', 'company']) {
    assert.ok(H.isEntity(k), k + ' must be a known record kind');
  }
  assert.strictEqual(H.isEntity('users'), false);
  assert.strictEqual(H.isEntity(''), false);
  assert.strictEqual(H.isEntity(null), false);
});

// ── the wiring (grep) ───────────────────────────────────────────────────────
// These are the faults that actually ship: a guarded call to a function that
// does not exist, an endpoint nobody mounted, a second copy of the panel.

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

t('the history endpoint is MOUNTED (an unmounted router is dead code)', () => {
  assert.match(read('../index.js'), /routes\/record-history/);
});

t('the endpoint refuses an unknown record kind and 404s a foreign one', () => {
  const r = read('../routes/record-history.js');
  assert.match(r, /unknown_record_kind/);
  // 404 not 403 — a 403 confirms the id exists, which is how ids get probed.
  assert.match(r, /status\(404\)/);
  assert.ok(!/status\(403\)/.test(r), 'a foreign record must 404, never 403');
});

t('the panel exists ONCE — no second copy of the history UI', () => {
  const files = fs.readdirSync(new URL('../public/js/', import.meta.url))
    .filter(f => f.endsWith('.js'));
  const owners = files.filter(f => /registerOverlay\('rewind'/.test(read('../public/js/' + f)));
  assert.deepStrictEqual(owners, ['54-record-history.js'],
    'the rewind panel must be built in exactly one file, not copied per page');
});

t('every page that shows the button reaches the SHARED global', () => {
  // The Session 28 rule: a cross-module call goes to a NAMED global, and an
  // `if (window.x)` guard around a call that must happen turns a crash into a
  // silence. So the global has to be real.
  const mod = read('../public/js/54-record-history.js');
  assert.match(mod, /window\.rewindBtn\s*=/);
  assert.match(mod, /window\.openRewind\s*=/);
  assert.match(mod, /window\.closeRewind\s*=/);
});

t('all four record screens actually carry the button', () => {
  const wired = {
    'lead': '../public/js/06-page-leads.js',
    'job_order': '../public/js/25-workflow-bd.js',
    'candidate': '../public/js/30-page-candidate.js',
    'company': '../public/js/41-page-clients.js',
  };
  for (const [entity, file] of Object.entries(wired)) {
    const src = read(file);
    assert.ok(new RegExp("['\"]" + entity + "['\"]").test(src) &&
              /rewindBtn|openRewind/.test(src),
      file + ' must offer the rewind button for ' + entity);
  }
});

t('the panel paints on --card-solid, never the glass --card', () => {
  // Session 25: twelve hand-rolled panels carried background:var(--card) and
  // were see-through on a phone. A float is opaque.
  const css = read('../public/ui.css');
  const panel = css.slice(css.indexOf('.rw-panel{'), css.indexOf('.rw-panel{') + 300);
  assert.match(panel, /--card-solid/);
});

t('the button and panel are registered in index.html', () => {
  assert.match(read('../public/index.html'), /54-record-history\.js/);
});

t('migration 045 registers its table as a TENANT table', () => {
  // A migration that adds a table with org_id must add it to models/tables.js,
  // or every query against it silently escapes org scoping.
  assert.match(read('../models/tables.js'), /'record_history'/);
  const m = read('../migrations/045_record_history.sql');
  assert.match(m, /org_id\s+UUID NOT NULL REFERENCES organizations/);
  assert.match(m, /ENABLE ROW LEVEL SECURITY/);
  assert.match(m, /service_role/);
});

console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' passed');
console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
