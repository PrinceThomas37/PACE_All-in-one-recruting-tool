// A send that died with its server must stop saying "Sending emails…" (owner's screenshot, 7 Oct 2026: "29 sent,
// 3 waiting, 56 total", Pending list 27, nothing moving — a deploy had killed the run and left its record `active`).
//
//  1. the pure rule (services/send-progress.js reconcileProgress)
//  2. the route that serves the card (GET /emails/send-progress) over a stubbed database, with and without a live run
//  3. the two source facts the fix depends on: Send all pending answers the truth BEFORE it answers, and both ways a
//     run starts (Send all / Send selected) register themselves as alive.
//
// Usage: node test/send-progress-smoke.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const express = require('express');
const { reconcileProgress, isStaleProgress, tryStartRun, DEAD_RUN_GRACE_MS, DONE_TTL_MS } = require('../services/send-progress.js');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const NOW = Date.parse('2026-10-07T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

// ── 1. the rule ────────────────────────────────────────────────────────────
console.log('\nThe rule');
const live = { active: true, total: 56, sent: 29, failed: 0, deferred: 3, startedAt: ago(20 * 60000), current: 'a@x.test' };
step('a run that IS alive in this process is left exactly as it is', reconcileProgress(live, { alive: true, now: NOW }) === live);
const dead = reconcileProgress(live, { alive: false, now: NOW });
step('an old active run with no live process behind it becomes "stopped early" — no longer active, marked interrupted, with a finish time', dead.active === false && dead.done === true && dead.interrupted === true && dead.completedAt === new Date(NOW).toISOString() && dead.current === '');
step('…keeping the counts it had (29 of 56 sent), so the card can say how far it got', dead.sent === 29 && dead.total === 56 && dead.deferred === 3);
step('a run only just started (inside the grace) is NOT declared dead — its record is written a moment before it registers', reconcileProgress({ active: true, total: 5, sent: 0, startedAt: ago(DEAD_RUN_GRACE_MS - 1000) }, { alive: false, now: NOW }).active === true);
step('…and one just past the grace is', reconcileProgress({ active: true, total: 5, sent: 0, startedAt: ago(DEAD_RUN_GRACE_MS + 1000) }, { alive: false, now: NOW }).interrupted === true);
step('an active record with no start time cannot be aged, so it is not left claiming to send forever', reconcileProgress({ active: true, total: 5, sent: 1 }, { alive: false, now: NOW }).interrupted === true);
const done = { active: false, done: true, total: 3, sent: 3, completedAt: ago(1000) };
step('a finished run is never touched', reconcileProgress(done, { alive: false, now: NOW }) === done);
step('nothing in, nothing out (null / not an object)', reconcileProgress(null, { alive: false }) === null && reconcileProgress(undefined, { alive: false }) === undefined && reconcileProgress('x', { alive: false }) === 'x');
step('the "stopped early" record ages out like any finished run (shown now, gone after the shelf life), so it cannot haunt the screen', isStaleProgress(dead, NOW) === false && isStaleProgress(dead, NOW + DONE_TTL_MS + 1000) === true);
step('an ACTIVE run still never expires by age alone (a long real send keeps its bar) — that rule is unchanged', isStaleProgress(live, NOW + 6 * 3600000) === false);

// ── 2. the route ───────────────────────────────────────────────────────────
console.log('\nThe card the server serves');
function boot({ progress, alive }) {
  const store = { rows: progress ? { send_progress_u1: JSON.stringify(progress) } : {}, upserts: [] };
  const builder = (table) => {
    const q = { filters: {} }; const chain = {};
    ['select', 'order', 'range', 'gte', 'lte', 'is', 'not', 'limit', 'in'].forEach((m) => { chain[m] = () => chain; });
    chain.eq = (c, v) => { q.filters[c] = v; return chain; };
    chain.delete = () => { q.op = 'delete'; return chain; };
    chain.upsert = (row) => { store.upserts.push(row); store.rows[row.key] = row.value; return Promise.resolve({ error: null }); };
    chain.single = async () => { const v = store.rows[q.filters.key]; return { data: v ? { value: v } : null, error: v ? null : { message: 'none' } }; };
    chain.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return chain;
  };
  const ctx = {
    supabase: { from: builder }, auth: (req, _r, next) => { req.user = { id: 'u1', org_id: 'o1', roles: ['bd'] }; req.orgId = 'o1'; next(); },
    hasRole: () => true, today: () => '2026-10-07', logActivity: async () => {},
    getSendWindowHours: async () => ({ start: 8, end: 18 }), isInLeadSendWindow: () => true, getMinutesUntilWindowOpens: () => 0,
    formatWindowOpensLabel: () => '', padHour: (h) => String(h).padStart(2, '0'), sendProgressCache: new Map(),
  };
  if (alive !== undefined) ctx.isSendAlive = () => alive;
  const app = express(); app.use(express.json()); app.use(require('../routes/emails.js')(ctx));
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = () => new Promise((res, rej) => http.get(base + '/emails/send-progress', (r) => { let o = ''; r.on('data', (d) => { o += d; }); r.on('end', () => res(JSON.parse(o))); }).on('error', rej));
    resolve({ get, store, ctx, close: () => server.close() });
  }));
}
const OLD = { active: true, total: 56, sent: 29, failed: 0, deferred: 3, startedAt: new Date(Date.now() - 20 * 60000).toISOString(), current: 'a@x.test' };
let b = await boot({ progress: OLD, alive: false });
let out = await b.get();
step('after a restart (no run alive) the card is served as "stopped early", not "sending"', out.active === false && out.done === true && out.interrupted === true && out.sent === 29 && out.total === 56, JSON.stringify(out));
step('…and that is written back, so it does not flip between answers and survives the next restart', b.store.upserts.length === 1 && JSON.parse(b.store.rows.send_progress_u1).interrupted === true);
out = await b.get();
step('asking again gives the same answer (served from the kept record)', out.interrupted === true && b.store.upserts.length === 1);
b.close();
b = await boot({ progress: OLD, alive: true });
out = await b.get();
step('while a run IS alive the card stays "sending" and nothing is rewritten', out.active === true && !out.interrupted && b.store.upserts.length === 0);
b.close();
b = await boot({ progress: OLD });
out = await b.get();
step('with no liveness probe (a bare harness) nothing changes — the fix never invents a failure', out.active === true && !out.interrupted);
b.close();

// ── 3. what the server must do ─────────────────────────────────────────────
console.log('\nWhat the server does');
const SRC = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const qa = SRC.slice(SRC.indexOf("app.post('/emails/queue-all'"), SRC.indexOf('// DELETE/PATCH /emails/:id'));
const act = new Set();
step('starting a run is ONE step: the first click starts, a second in the same instant is refused (and a different person is not blocked)', tryStartRun(act, 'u1') === true && tryStartRun(act, 'u1') === false && tryStartRun(act, 'u2') === true);
const iGuard = qa.indexOf('tryStartRun(activeSendByUser, userId)'), iAnswer = qa.indexOf("res.json({ success: true, queued: totalCount })");
step('Send all pending decides BEFORE it answers "queued": a second click is told "already running" (a real answer), not "queued"', iGuard > 0 && iAnswer > iGuard && /already_running: true/.test(qa));
const ss = SRC.slice(SRC.indexOf("app.post('/emails/send-selected'"), SRC.indexOf('// GET /emails/send-progress'));
step('Send selected registers its run as alive and always un-registers (finally), so a selected run is never declared dead mid-send', /selectedSendsByUser\.set\(userId/.test(ss) && /finally \{[\s\S]*selectedSendsByUser/.test(ss));
step('the liveness answer the route uses covers both ways a run starts', /const isSendAlive = \(userId\) => activeSendByUser\.has\(userId\) \|\| \(selectedSendsByUser\.get\(userId\) \|\| 0\) > 0/.test(SRC) && /sendProgressCache, isSendAlive/.test(SRC));

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
