// R-346 (30 Oct) — BD Lead 1's 65 assigned leads got NO first email: one 138-row insert hit the database statement timeout and
// nothing said so. This pins the self-check that finds such leads and writes them, and every reason it must leave a lead alone.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const R = require('../services/first-email-repair.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const NOW = Date.parse('2026-10-30T15:00:00Z');
const base = { withEmail: new Set(), withFollow: new Set(['j1', 'j2', 'j3', 'j4']), manual: new Set(), tried: new Map(), now: NOW };
const A = [{ id: 'j1', assigned_to_bd: 'u1' }, { id: 'j2', assigned_to_bd: 'u1' }, { id: 'j3', assigned_to_bd: 'u2' }];

// ── the plan (pure) ──
let p = R.planRepair({ ...base, assigned: A });
step('auto-assigned leads with no email are written, grouped by owner', p.u1?.length === 2 && p.u2?.length === 1);
p = R.planRepair({ ...base, assigned: A, withEmail: new Set(['j1']) });
step('a lead that has ANY email is left alone (never a second cold email)', !p.u1.includes('j1') && p.u1.includes('j2'));
p = R.planRepair({ ...base, assigned: [...A, { id: 'j9', assigned_to_bd: 'u1' }] });
step('a lead with no follow-up schedule (a manager hand-out: "owning is not sending") is left alone', !p.u1.includes('j9'));
p = R.planRepair({ ...base, assigned: A, manual: new Set(['u2']) });
step('a person in MANUAL mode is left alone', !p.u2 && p.u1.length === 2);
p = R.planRepair({ ...base, assigned: A, tried: new Map([['j1', NOW - 60 * 1000]]) });
step('a lead tried a minute ago waits out the cooldown', !p.u1.includes('j1'));
p = R.planRepair({ ...base, assigned: A, tried: new Map([['j1', NOW - R.COOLDOWN_MS - 1]]) });
step('…and is tried again after it', p.u1.includes('j1'));
p = R.planRepair({ ...base, assigned: [{ id: 'j1', assigned_to_bd: null }] });
step('a lead with no owner is left alone', Object.keys(p).length === 0);

// ── the busy-database test ──
step('a statement timeout is "busy, try again"', R.isRetryableDbError({ code: '57014', message: 'canceling statement due to statement timeout' }));
step('the message alone is recognised too', R.isRetryableDbError({ message: 'canceling statement due to statement timeout' }));
step('a broken row is NOT retried', !R.isRetryableDbError({ code: '23505', message: 'duplicate key' }));
step('a network failure (the write may have landed) is NOT retried', !R.isRetryableDbError({ message: 'fetch failed' }));

// ── the runner, against a fake database ──
function fakeDb(tables) {
  return { from(t) {
    const rows = tables[t] || []; let f = rows.slice(); let range = null;
    const q = {
      select() { return q; }, is(c, v) { f = f.filter(r => (r[c] ?? null) === v); return q; }, eq(c, v) { f = f.filter(r => r[c] === v); return q; },
      not(c, op, v) { f = f.filter(r => r[c] !== null && r[c] !== undefined); return q; },
      gte(c, v) { f = f.filter(r => r[c] >= v); return q; }, lte(c, v) { f = f.filter(r => r[c] <= v); return q; },
      in(c, vs) { f = f.filter(r => vs.includes(r[c])); return q; }, order() { return q; },
      range(a, b) { range = [a, b]; return q; },
      then(res, rej) { const d = range ? f.slice(range[0], range[1] + 1) : f; return Promise.resolve({ data: d, error: null }).then(res, rej); },
    };
    return q;
  } };
}
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const jobs = [
  { id: 'a1', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(60 * 60e3), deleted_at: null },
  { id: 'a2', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(60 * 60e3), deleted_at: null },
  { id: 'fresh', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(60e3), deleted_at: null },           // still being written
  { id: 'old', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(8 * 864e5), deleted_at: null },         // outside the window
  { id: 'gone', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(60 * 60e3), deleted_at: iso(1) },
  { id: 'done', stage: 'Assigned', assigned_to_bd: 'bd1', assigned_at: iso(60 * 60e3), deleted_at: null },
];
const follow = ['a1', 'a2', 'fresh', 'old', 'gone', 'done'].map(job_id => ({ job_id }));
const calls = [], kicked = [];
const tried = new Map();
const run = R.createFirstEmailRepair({
  supabase: fakeDb({ jobs, emails: [{ job_id: 'done' }], follow_ups: follow }),
  generateEmailsForJobs: async (ids, uid) => { calls.push({ ids: ids.slice().sort(), uid }); return ids.length * 2; },
  getRaMode: async () => 'auto', onWritten: async (uid) => kicked.push(uid), clock: () => NOW, tried,
});
let out = await run();
step('the runner writes exactly the missing, settled, in-window, live leads', calls.length === 1 && calls[0].uid === 'bd1' && calls[0].ids.join() === 'a1,a2', JSON.stringify(calls));
step('…and starts that person\'s send', kicked.join() === 'bd1');
step('…and reports what it did', out.missing === 2 && out.written === 4, JSON.stringify(out));
out = await run();
step('the next run does not write them again while they wait out the cooldown', calls.length === 1 && out.skipped === 'nothing_missing');

const failing = R.createFirstEmailRepair({
  supabase: fakeDb({ jobs, emails: [], follow_ups: follow }),
  generateEmailsForJobs: async () => { throw new Error('canceling statement due to statement timeout'); },
  getRaMode: async () => 'auto', onWritten: async () => {}, clock: () => NOW, tried: new Map(),
});
const t2 = new Map();
const failing2 = R.createFirstEmailRepair({
  supabase: fakeDb({ jobs, emails: [], follow_ups: follow }),
  generateEmailsForJobs: async () => { throw new Error('busy'); }, getRaMode: async () => 'auto', onWritten: async () => {}, clock: () => NOW, tried: t2,
});
out = await failing2();
step('a failed write is not remembered as tried — the next run tries again', out.failed === 3 && t2.size === 0, JSON.stringify(out));
await failing();

const manualRun = R.createFirstEmailRepair({
  supabase: fakeDb({ jobs, emails: [], follow_ups: follow }), generateEmailsForJobs: async (ids) => { calls.push('manual!'); return 1; },
  getRaMode: async () => 'manual', onWritten: async () => {}, clock: () => NOW,
});
await manualRun();
step('a MANUAL-mode person is never written for by the runner', !calls.includes('manual!'));

// ── wiring ──
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('the job is registered with the engine', /engineRunner\.register\('first_email_repair'/.test(idx));
const gen = idx.slice(idx.indexOf('async function generateEmailsForJobs'), idx.indexOf("app.post('/emails/generate'"));
step('first emails are saved in small batches', /const INSERT_BATCH = 25;/.test(gen));
step('a busy database is retried, a failed batch does not throw away the others', /isRetryableDbError\(insErr\)/.test(gen) && /continue;/.test(gen));

const ok = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(ok ? 0 : 1);
