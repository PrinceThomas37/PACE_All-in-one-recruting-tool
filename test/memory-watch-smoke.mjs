// THE MEMORY WATCHER (R-291, owner 20 Oct: "add a small watcher"). The free server is killed at 512 MB and nothing says what
// was running. services/memory-watch.js logs, before the kill, the requests and engine jobs in flight once memory passes the
// line, and names any single request that grew memory a lot. Pinned with a fake clock, fake memory and a captured log:
//   • below the line it says nothing; above it, one line naming every request in flight (oldest first) and every job running;
//   • at most one snapshot per quiet period (a slow climb is not a flood);
//   • a request that grew memory by GROW_MB is named when it ends, a light one is not;
//   • a secret in the path (/i/:token, /apply/:token) and ids are masked — the log never carries a token;
//   • the engine runner reports what is running.
// Usage: node test/memory-watch-smoke.mjs
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createMemoryWatch, maskPath } = require('../services/memory-watch.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 300) : '')); };

const MB = 1024 * 1024;
let mem = 100 * MB, t = 1_000_000, running = [];
const lines = [];
const w = createMemoryWatch({ log: (l) => lines.push(l), rss: () => mem, heap: () => mem * 0.8, now: () => t, jobs: () => running });
const fakeReq = (method, url, user) => ({ method, originalUrl: url, user });
const fakeRes = () => { const r = new EventEmitter(); r.statusCode = 200; return r; };

// Two requests start; one is heavy.
const r1 = fakeReq('GET', '/client-intel/digest?tz=Asia/Kolkata', { id: 'u-bea-1234567' }), s1 = fakeRes();
w.middleware(r1, s1, () => {});
t += 3000;
const r2 = fakeReq('GET', '/i/9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddcc', null), s2 = fakeRes();
w.middleware(r2, s2, () => {});
running = ['reply_sweep'];

ok('below the line, nothing is logged', w.check() === null && lines.length === 0);
mem = 420 * MB; t += 2000;
const snap = w.check();
ok('above the line: one line with memory, every request in flight and the running job', !!snap && /420 MB/.test(snap) && /GET \/client-intel\/digest \(5s, user u-bea-12\)/.test(snap) && /engine jobs running: reply_sweep/.test(snap), snap);
ok('…oldest request first', snap.indexOf('/client-intel/digest') < snap.indexOf('/i/'));
ok('…the query string is dropped and the public token is masked — no secret in the log', !/tz=/.test(snap) && !/9f8e7d6c5b4a/.test(snap) && /GET \/i\/:id/.test(snap), snap);
t += 2000;
ok('a second look within the quiet period writes nothing more', w.check() === null && lines.length === 1);
t += 11000;
ok('after the quiet period it snapshots again', !!w.check() && lines.length === 2);

// The heavy one ends: named. The light one ends: not.
s1.emit('finish'); s1.emit('close');
ok('a request that grew memory by 60+ MB is named when it ends, once', lines.filter(l => /grew memory \+320 MB/.test(l) && /client-intel\/digest/.test(l)).length === 1, lines.slice(-1)[0]);
const before = lines.length;
mem = 425 * MB;
const r3 = fakeReq('GET', '/jobs', { id: 'u2' }), s3 = fakeRes(); w.middleware(r3, s3, () => {}); mem = 430 * MB; s3.emit('finish');
ok('a light request is not named', lines.length === before);
s2.emit('close');
ok('finished requests leave the in-flight list', w.inFlightCount() === 0);

ok('ids and long segments are masked', maskPath('/apply/abcdefghijklmnopqrstuvwxyz/x') === '/apply/:id/x' && maskPath('/clients/3f2a1b4c-1111-2222-3333-444455556666/intel') === '/clients/:id/intel' && maskPath('/leads/123') === '/leads/:id');

// The engine runner says what is running.
const { createEngineRunner } = require('../engine-runs.js');
const fakeDb = { from: () => new Proxy({}, { get: (_, k) => (k === 'then' ? (a) => Promise.resolve({ data: [], error: null }).then(a) : () => fakeDb.from()) }) };
const er = createEngineRunner({ supabase: fakeDb });
let seen = null;
er.register('slow_job', { everyMs: 60000, run: async () => { seen = er.running(); return {}; } });
await er.runJob('slow_job');
ok('the engine runner reports the job while it runs, and not after', JSON.stringify(seen) === '["slow_job"]' && er.running().length === 0, JSON.stringify(seen));

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
