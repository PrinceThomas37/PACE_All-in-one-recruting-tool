// R-047 B2 — a reminder must not be a side door to a lead the caller cannot
// touch or see. `routes/reminders.js` documents the fault this closes:
// `reminders` stores a job_id/contact_id and `GET /reminders` used to embed
// the lead + contact via an un-org-filtered PostgREST join, while
// `POST /reminders` accepted any job_id/contact_id unchecked — so creating a
// reminder naming ANY lead id, in any company, read that lead's position,
// company and contact's email/phone back out.
//
// Two halves, tested here against the REAL functions (not a reimplementation):
//   * READ  — `reminderEmbedFor` (pure, exported from routes/reminders.js):
//     the embed is kept only when the lead is in the caller's org AND in
//     their view scope (`ownership.canSeeLead`, D-0034), and the contact is
//     in the org and hangs off THAT lead. A row that fails keeps its own
//     stored text and loses the embed — never deleted, never hidden outright.
//   * WRITE — `POST /reminders`, driven through the real Express router with
//     a tiny fake db + a stubbed `canTouchJob`: a lead the caller cannot
//     touch, or a contact belonging to a different org or a different lead,
//     both answer the SAME 404 (an id cannot be probed).
//
// Adapted from ledger's scratch check (`rem.cjs`, 14 assertions) — kept
// close to verbatim; the fixture cost real thought to find.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const own = require('../services/ownership.js');
const mod = require('../routes/reminders.js');
const reminderEmbedFor = mod.reminderEmbedFor;

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });

// ── CANNOT-MEASURE GUARD ─────────────────────────────────────────────────
ok('CANNOT-MEASURE GUARD: reminderEmbedFor is exported', typeof reminderEmbedFor === 'function');

const me = own.viewScope({ role: 'bd', userId: 'u1', chainIds: [] });
const job = { id: 'j1', org_id: 'A', assigned_to_bd: 'u1', company: { org_id: 'A', name: 'Co' } };
const c = { id: 'c1', org_id: 'A', job_id: 'j1', email: 'x@y' };

// ── READ half: reminderEmbedFor ──────────────────────────────────────────
{
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job, contact: c }, { orgId: 'A', scope: me });
  ok('own lead: job + contact embedded, not withheld', !!e.job && !!e.contact && !e.withheld, e);
}
{
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job: { ...job, org_id: 'B' }, contact: { ...c, org_id: 'B' } }, { orgId: 'A', scope: me });
  ok('cross-org lead: both withheld', !e.job && !e.contact && e.withheld, e);
}
{
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job: { ...job, assigned_to_bd: 'u9' }, contact: c }, { orgId: 'A', scope: me });
  ok('lead not mine (out of scope): both withheld', !e.job && !e.contact && e.withheld, e);
}
{
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job, contact: { ...c, job_id: 'j2' } }, { orgId: 'A', scope: me });
  ok('contact belongs to a DIFFERENT lead: job kept, contact withheld', !!e.job && !e.contact && e.withheld, e);
}
{
  const e = reminderEmbedFor({ job_id: null, contact_id: 'c1', job: null, contact: c }, { orgId: 'A', scope: me });
  ok('contact with no job on the row: withheld', !e.contact && e.withheld, e);
}
{
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job: { ...job, company: { org_id: 'B', name: 'X' } }, contact: c }, { orgId: 'A', scope: me });
  ok('lead kept but its company is a different org: company nulled, lead still shown', !!e.job && e.job.company === null, e);
}
{
  const admin = own.viewScope({ role: 'admin', userId: 'u1' });
  const e = reminderEmbedFor({ job_id: 'j1', contact_id: 'c1', job: { ...job, assigned_to_bd: 'u9' }, contact: c }, { orgId: 'A', scope: admin });
  ok('admin in org sees a lead owned by someone else', !!e.job && !!e.contact, e);
}
{
  const e = reminderEmbedFor({ job_id: null, contact_id: null, job: null, contact: null }, { orgId: 'A', scope: me });
  ok('a plain manual reminder (no lead at all) is never marked withheld', !e.withheld, e);
}

// ── WRITE half: POST /reminders ──────────────────────────────────────────
function mkDb(contacts) {
  const inserted = [];
  const db = {
    forRequest: () => ({
      from: (t) => {
        const st = { t, f: {} };
        const q = {
          select() { return q; },
          eq(k, v) { st.f[k] = v; return q; },
          maybeSingle: async () => ({ data: (contacts.find(x => x.id === st.f.id && x.org_id === 'A')) || null }),
          insert(row) {
            inserted.push({ ...row, org_id: 'A' });
            return { select: () => ({ single: async () => ({ data: row }) }) };
          },
        };
        return q;
      },
    }),
  };
  return { db, inserted };
}
const express = require('../node_modules/express');
async function call(body, contacts, touchable) {
  const { db, inserted } = mkDb(contacts);
  const router = mod({
    db, auth: (q, s, nx) => nx(), today: () => '2026-09-24',
    canTouchJob: async (req, id) => touchable.includes(id),
    reportingChainIds: async () => [],
  });
  const layer = router.stack.find(l => l.route && l.route.path === '/reminders' && l.route.methods.post);
  const handle = layer.route.stack[1].handle;
  let status = 200, out;
  await handle({ body, user: { id: 'u1', role: 'bd' }, orgId: 'A' }, { status(s) { status = s; return this; }, json(j) { out = j; } });
  return { status, out, inserted };
}

(async () => {
  const cs = [{ id: 'c1', job_id: 'j1', org_id: 'A' }, { id: 'cB', job_id: 'jB', org_id: 'B' }];

  let x = await call({ return_date: '2026-09-25', job_id: 'j1', contact_id: 'c1' }, cs, ['j1']);
  ok('POST: a lead the caller may touch creates the reminder (201)', x.status === 201 && x.inserted[0].job_id === 'j1', x);

  x = await call({ return_date: '2026-09-25', job_id: 'j9' }, cs, ['j1']);
  ok('POST: a lead the caller may NOT touch -> 404, nothing inserted', x.status === 404 && !x.inserted.length, x);

  x = await call({ return_date: '2026-09-25', contact_id: 'cB' }, cs, ['jB']);
  ok('POST: a contact in a DIFFERENT org -> 404, nothing inserted (same sentence as untouchable job)',
    x.status === 404 && !x.inserted.length, x);

  x = await call({ return_date: '2026-09-25', job_id: 'j1', contact_id: 'c2' }, cs.concat([{ id: 'c2', job_id: 'j2', org_id: 'A' }]), ['j1', 'j2']);
  ok('POST: a contact belonging to a DIFFERENT lead than the one named -> 404', x.status === 404, x);

  x = await call({ return_date: '2026-09-25', contact_id: 'c1' }, cs, ['j1']);
  ok('POST: job_id may be derived from the contact alone', x.status === 201 && x.inserted[0].job_id === 'j1', x);

  x = await call({ return_date: '2026-09-25', contact_name: 'Me' }, cs, []);
  ok('POST: a plain manual reminder with no lead still works, job_id null', x.status === 201 && x.inserted[0].job_id === null, x);

  const failed = results.filter(r => !r.c);
  for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
