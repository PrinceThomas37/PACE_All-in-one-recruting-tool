// THE LEAD LIST IS LOADED ONCE AT A TIME AND KEPT UNTIL A LEAD CAN HAVE CHANGED (R-324, 26 Oct — Render logs: GET /jobs 17–32 s and
// +60–104 MB per call at busy times; Ash's sign-in failed in that window, R-323).
//   · a sign-in, a Find Leads search, My Setup, the mailbox, reminders, Next Actions no longer throw the list away;
//   · every write that CAN change a lead (and any route not known to be safe) still does;
//   · callers asking during a load share ONE load; a write during a load means that load is not kept.
// Usage: node test/lead-list-cache-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../services/lead-list-cache.js');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── which writes drop the list ──
const keeps = [['POST', '/auth/login'], ['POST', '/auth/change-password'], ['PUT', '/me/preferences'], ['POST', '/my-setup/sync'], ['PUT', '/my-setup/sequence'],
  ['PATCH', '/mailbox/m1/messages/x'], ['POST', '/mailbox/m1/send'], ['DELETE', '/mailbox-scheduled/s1'], ['POST', '/reminders'], ['PATCH', '/reminders/r1'],
  ['POST', '/next-actions/dismiss'], ['POST', '/finder/find'], ['POST', '/finder/run'], ['POST', '/finder/searches'], ['PUT', '/finder/searches/s1'], ['POST', '/finder/searches/s1/run'],
  ['POST', '/finder/cards/c1/wait'], ['POST', '/finder/cards/c1/reject'], ['POST', '/finder/companies/suggest']];
const drops = [['POST', '/jobs'], ['PUT', '/jobs/j1'], ['DELETE', '/jobs/j1'], ['POST', '/jobs/bulk'], ['POST', '/contacts'], ['PUT', '/contacts/c1'], ['POST', '/companies'],
  ['POST', '/finder/cards/c1/accept'], ['POST', '/finder/cards/c1/another'], ['POST', '/finder/cards/c1/reveal'], ['POST', '/finder/cards/c1/people'], ['POST', '/emails/generate'],
  ['POST', '/lead-assign'], ['POST', '/job-orders'], ['POST', '/some-route-added-next-month'], ['POST', '/reminders-archive'], ['POST', '/mailboxes/alerts/x']];
const wrongKeep = keeps.filter(([m, p]) => C.writeMayChangeLeads(m, p));
const wrongDrop = drops.filter(([m, p]) => !C.writeMayChangeLeads(m, p));
step('writes that cannot change a lead (sign-in, Find Leads search, My Setup, mailbox, reminders…) keep the list', !wrongKeep.length, JSON.stringify(wrongKeep));
step('writes that can (leads, contacts, companies, Accept, writing emails, job orders) — and any unknown route — still drop it', !wrongDrop.length, JSON.stringify(wrongDrop));
step('a read never drops it', !C.writeMayChangeLeads('GET', '/jobs'));

// ── one load at a time ──
let loads = 0; const gates = []; const gate = () => new Promise((r) => { gates.push(r); }); const release = () => { while (gates.length) gates.shift()(); };
let t = 1000;
const cache = C.createLeadListCache({ ttlMs: 60000, now: () => t, load: async (org) => { loads++; await gate(); return ['lead-of-' + org + '-' + loads]; } });
const a = cache.get('org1'), b = cache.get('org1'), c = cache.get('org1');
await Promise.resolve(); await Promise.resolve();
release();
const [ra, rb, rc] = await Promise.all([a, b, c]);
step('three people asking while it loads share ONE load', loads === 1 && ra === rb && rb === rc, 'loads=' + loads);
const again = await cache.get('org1');
step('…and the next ask inside the minute is answered from memory', loads === 1 && again === ra);
t += 61000;
const p2 = cache.get('org1'); await Promise.resolve(); await Promise.resolve(); release(); await p2;
step('after the minute it loads again (background changes still show)', loads === 2);

// ── a write during a load ──
const p3 = (cache.invalidate(), cache.get('org1')); await Promise.resolve(); await Promise.resolve();
cache.invalidate();                       // a lead changed while that load was running
const p4 = cache.get('org1');             // someone asks after the change
await Promise.resolve(); await Promise.resolve();
step('someone asking AFTER a change does not join the load that started before it', loads === 4, 'loads=' + loads);
release(); await p3; await p4;
const after = cache.get('org1');
step('…and the load that started before the change is not kept', cache._state().kept === 1 && (await after) === (await p4), JSON.stringify(cache._state()));

// ── organisations are separate ──
const o2 = cache.get('org2'); await Promise.resolve(); await Promise.resolve(); release();
step('another organisation gets its own list', (await o2)[0].startsWith('lead-of-org2'));

// ── a failed load is not kept and does not block the next ──
let fail = true;
const cache2 = C.createLeadListCache({ ttlMs: 60000, load: async () => { if (fail) throw new Error('db down'); return ['ok']; } });
let threw = false; try { await cache2.get('o'); } catch (_) { threw = true; }
fail = false;
step('a failed load is reported, not kept, and the next ask tries again', threw && (await cache2.get('o'))[0] === 'ok');

// ── the list is read in pages AT THE SAME TIME (R-304/R-324: three back-to-back trips to Seoul made it 13-20 s) ──
const { loadLeadList } = require('../services/lead-list.js');
function makeFake(table, { withCount = true, onRead } = {}) {
  let inFlight = 0; const stats = { maxInFlight: 0, reads: 0, waves: [] };
  const from = () => {
    const f = []; const ord = []; let rng = null; let wantCount = false;
    const api = {
      select(_s, o) { wantCount = !!(o && o.count); return api; }, is(k, v) { f.push((r) => (r[k] == null) === (v == null)); return api; }, eq(k, v) { f.push((r) => r[k] === v); return api; },
      order(k, o) { ord.push([k, o.ascending]); return api; }, range(a, b) { rng = [a, b]; return api; },
      then(res, rej) {
        stats.reads++; inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        return new Promise((ok) => setTimeout(ok, 20)).then(() => {
          if (onRead) onRead(rng);
          let rows = table.filter((r) => f.every((fn) => fn(r)));
          rows.sort((x, y) => { for (const [k, asc] of ord) { if (x[k] < y[k]) return asc ? -1 : 1; if (x[k] > y[k]) return asc ? 1 : -1; } return 0; });
          inFlight--;
          return { data: rows.slice(rng[0], rng[1] + 1), error: null, count: wantCount && withCount ? rows.length : null };
        }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from }, stats };
}
const T2 = Array.from({ length: 2061 }, (_, i) => ({ id: 'L' + String(i).padStart(5, '0'), org_id: 'o1', deleted_at: null, created_at: new Date(Date.parse('2026-01-01') + i * 60000).toISOString(), research: { jd_raw: 'Title: X\n\nlong posting' } }));
let fk = makeFake(T2);
let t0 = Date.now();
let got = await loadLeadList({ supabase: fk.supabase, select: '*', orgId: 'o1', pageSize: 500 });
step('all 2,061 leads come back, each once, newest first', got.length === 2061 && new Set(got.map((r) => r.id)).size === 2061 && got[0].id === 'L02060' && got[2060].id === 'L00000');
step('…the pages after the first are read together, but never more than TWO at once (R-348: six at once ran into the 8 s limit)', fk.stats.maxInFlight === 2 && fk.stats.reads === 5, JSON.stringify(fk.stats) + ' ' + (Date.now() - t0) + 'ms');
step('…and no posting text is in the list', got.every((r) => !('jd_raw' in r.research)));
// A lead added between the first read and the rest pushes everything down one: the boundary lead is seen twice → kept once,
// and the extra lead at the end is still read.
const T3 = T2.slice();
fk = makeFake(T3, { onRead: (rng) => { if (rng[0] === 0 && !T3.added) { T3.added = true; T3.push({ id: 'Lnew', org_id: 'o1', deleted_at: null, created_at: '2026-12-31T00:00:00.000Z', research: {} }); } } });
got = await loadLeadList({ supabase: fk.supabase, select: '*', orgId: 'o1', pageSize: 500 });
step('a lead added mid-read: nobody is shown twice and nobody is lost', new Set(got.map((r) => r.id)).size === got.length && T2.every((r) => got.some((g) => g.id === r.id)), got.length + ' rows');
fk = makeFake(T2, { withCount: false });
got = await loadLeadList({ supabase: fk.supabase, select: '*', orgId: 'o1', pageSize: 500 });
step('no count from the database → it still reads every page, one after another', got.length === 2061 && fk.stats.maxInFlight === 1, JSON.stringify(fk.stats));
fk = makeFake(T2.slice(0, 120));
got = await loadLeadList({ supabase: fk.supabase, select: '*', orgId: 'o1', pageSize: 500 });
step('a small list is ONE read', got.length === 120 && fk.stats.reads === 1);

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
