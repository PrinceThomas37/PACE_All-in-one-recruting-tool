// WHO ASSIGNED A LEAD (R-340 / R-363, owner 3 Nov 2026: "start recording who assigned lead, it should come in lead history").
// Every way a lead gets an owner writes jobs.assigned_by, and the lead history says WHO handed it to WHOM. Old leads stay unknown (NULL) —
// nothing is guessed. Proven here: the rules (services/lead-claim.js) against an in-memory PostgREST, the history sentence end to end
// (activity row → history entry → the words a person reads), releasing to the pool clears it, and a GUARD that fails if any code path
// writes an owner without writing who (a path added next year that forgets).
// Usage: node test/assigned-by-smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const lc = require('../services/lead-claim.js');
const H = require('../services/record-history.js');
const { releaseToPoolUpdate } = require('../services/outreach-cycle.js');

// ── the fields ──
const f1 = lc.ownerFields('bd1', 'mb1', '2026-11-03T10:00:00.000Z');
ok('a claim by the person themselves: assigned_by is that person', f1.assigned_to_bd === 'bd1' && f1.assigned_by === 'bd1');
const f2 = lc.ownerFields('bd1', 'mb1', '2026-11-03T10:00:00.000Z', 'ra9');
ok('a hand-out: the owner is the receiver, assigned_by is the giver', f2.assigned_to_bd === 'bd1' && f2.assigned_by === 'ra9');
ok('releasing a lead to the pool clears who assigned it (nobody has it)', releaseToPoolUpdate(new Date()).assigned_by === null && releaseToPoolUpdate(new Date()).assigned_to_bd === null);

// ── RA Lead hands a batch to a manager ──
const T = (rows) => createFakeDb({ tables: { jobs: rows, activity_log: [] }, defaults: { activity_log: () => ({ id: 'a' + Math.random().toString(36).slice(2) }) } });
const mk = (id, extra = {}) => ({ id, org_id: 'o', stage: 'Unassigned', assigned_to_bd: null, assigned_by: null, deleted_at: null, ...extra });
{
  const db = T([mk('a'), mk('b'), mk('c', { stage: 'Assigned', assigned_to_bd: 'someone', assigned_by: 'boss0' })]);
  const done = await lc.assignToManager({ jobsTable: () => db.supabase.from('jobs'), byBox: { mbx: ['a', 'b', 'c'] }, managerId: 'mgr1', byUserId: 'ra9', now: new Date('2026-11-03T10:00:00Z') });
  const row = (id) => db.tables.jobs.find((j) => j.id === id);
  ok('RA Lead → manager: the two free leads are assigned, each records the RA Lead as the giver', done.length === 2 && row('a').assigned_to_bd === 'mgr1' && row('a').assigned_by === 'ra9' && row('b').assigned_by === 'ra9' && row('a').stage === 'Assigned' && row('a').sending_email_id === 'mbx', JSON.stringify(done));
  ok('…a lead somebody already owns is NOT taken and keeps ITS giver (a race never rewrites history)', row('c').assigned_to_bd === 'someone' && row('c').assigned_by === 'boss0');
  const hr = lc.historyRows(done.map((d) => d.job_id), { byUserId: 'ra9', toUserId: 'mgr1', sentence: lc.assignmentSentence({ by: 'Prince', to: 'Sam' }) });
  ok('the history rows say who gave to whom, and who the actor is', hr.length === 2 && hr.every((r) => r.action_type === 'assigned' && r.user_id === 'ra9' && r.description === 'Assigned to Sam by Prince' && r.new_value.assigned_to_bd === 'mgr1' && r.new_value.assigned_by === 'ra9'));
  // 250 leads → 2 inserts, not 250 (Seoul is ~200 ms a trip: one insert per lead made a 200-lead assignment take ~40 s)
  let inserts = 0; const rows250 = Array.from({ length: 250 }, (_, i) => ({ job_id: 'j' + i }));
  await lc.writeHistory(() => ({ insert: async (r) => { inserts++; return { error: null }; } }), rows250);
  ok('250 history rows are written in 2 inserts, not 250', inserts === 2, String(inserts));
  ok('a failing history write does not undo the assignment (it is a record, not the point)', (await lc.writeHistory(() => ({ insert: async () => ({ error: { message: 'down' } }) }), rows250)) === false && row('a').assigned_to_bd === 'mgr1');
}
// ── a first email claims (the person themselves) ──
{
  const db = T([mk('x'), mk('y', { assigned_to_bd: 'other', stage: 'Assigned', assigned_by: 'boss0' })]);
  const out = await lc.applyClaims({ jobsTable: () => db.supabase.from('jobs'), claims: [{ job_id: 'x', mailbox_id: 'm1' }, { job_id: 'y', mailbox_id: 'm1' }], withEmail: new Set(['x', 'y']), userId: 'bd1', now: new Date() });
  ok('a first-email claim records the claimer as the giver; an owned lead is left alone', out.claimed.join() === 'x' && db.tables.jobs[0].assigned_by === 'bd1' && db.tables.jobs[1].assigned_by === 'boss0' && out.lost.join() === 'y');
}

// ── the sentences ──
ok('hand-out wording', lc.assignmentSentence({ by: 'Prince', to: 'Sam' }) === 'Assigned to Sam by Prince');
ok('hand-out to oneself reads naturally', lc.assignmentSentence({ by: 'Prince', to: 'themselves' }) === 'Prince assigned it to themselves');
ok('an edit says it was an edit', /lead edited/.test(lc.assignmentSentence({ by: 'Prince', to: 'Sam', how: 'edit' })));
// the stored activity row → the history entry the SCREEN receives: the sentence travels as the entry's note, the giver as its actor
const entry = H.fromActivityLog({ created_at: '2026-11-03T10:00:00Z', action_type: 'assigned', description: 'Assigned to Sam by Prince', user: { name: 'Prince' }, old_value: null, new_value: { assigned_to_bd: 'm' } });
ok('the history entry carries WHO (actor) and the sentence (note) — the screen prints both (see assigned-history-ui-smoke)', entry.actor === 'Prince' && entry.note === 'Assigned to Sam by Prince' && entry.kind === 'assigned', JSON.stringify(entry));

// ── THE GUARD: no code path writes an owner without writing who ──
const root = path.resolve(new URL('..', import.meta.url).pathname);
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? d + '/' + e.name : e.name;
  if (e.isDirectory()) { if (!['node_modules', 'test', 'docs', '.git', 'public', 'migrations', 'scripts'].includes(e.name)) walk(rel); } else if (e.name.endsWith('.js')) files.push(rel); } };
walk('');
const offenders = [], seen = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  lines.forEach((ln, i) => {
    if (!/\bassigned_to_bd\s*:/.test(ln) || /^\s*(\/\/|\*)/.test(ln)) return;
    if (/assigned_to_bd\s*:\s*(null\b|\{)/.test(ln) && !/assigned_by/.test(lines.slice(Math.max(0, i - 4), i + 5).join('\n')) && /releaseToPool|outreach-cycle/.test(f) === false) { /* a null owner outside the pool release: read below */ }
    const near = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
    seen.push(f + ':' + (i + 1));
    if (!/assigned_by/.test(near)) offenders.push(f + ':' + (i + 1) + '  ' + ln.trim().slice(0, 90));
  });
}
// reading/shaping code that merely mentions the key is allowed: it is not a write
const READ_ONLY = ['services/lead-query.js', 'services/record-history.js'];
const bad = offenders.filter((o) => !READ_ONLY.some((r) => o.startsWith(r)) && !/old_value|\{ assigned_to_bd: oldOwnerId \}|Object\.assign\(\{\}, j,/.test(o));   // the last is a preview of the list, not a write
ok('every code path that writes an owner (assigned_to_bd:) also writes assigned_by within 4 lines — or is listed here', bad.length === 0, bad.join(' | '));
ok('the guard is not vacuous: it found the known writers (≥ 8 places)', seen.length >= 8, String(seen.length));

const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
