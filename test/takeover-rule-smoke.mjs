// Pure rule tests for the take-over feature (R-047 / D-0036 / D-0037 / D-0038)
// — `services/ownership.js`'s `recordOwnerId`, `clientOwnerFrom`,
// `canRequestTakeover`, `approverFor`, `pickAdmin`, `canDecide`, `canCancel`,
// `takeoverTransition`. Adapted near-verbatim from rampart's scratch review
// (`takeover-check.cjs`, 83 cases) — the fixture and every edge case in it
// cost real thinking to find, same reasoning CLAUDE.md gives for keeping the
// candidate-outreach drip fixture and the email-history-scope one close to
// their scratch originals.
//
// The database/route half (creating, listing, approving, declining,
// cancelling requests, the duplicate-email door, the concurrent-approval
// race) is `test/ownership-requests-smoke.mjs` — this file never boots a
// server or touches a database, only the pure functions.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const own = require('../services/ownership.js');

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ORG = 'org-A', FOREIGN = 'org-B';
const U = (id, role, manager_id, extra) => Object.assign(
  { id, name: id.toUpperCase(), role, manager_id, org_id: ORG, is_active: true, created_at: '2025-01-01T00:00:00Z' },
  extra || {}
);
const users = [
  U('a1', 'admin', null, { created_at: '2025-06-01T00:00:00Z' }),
  U('a2', 'admin', null, { created_at: '2024-01-01T00:00:00Z' }),   // longest-serving -> the admin
  U('a0', 'admin', null, { created_at: '2020-01-01T00:00:00Z', is_active: false }), // departed
  U('d', 'director', null),
  U('bl1', 'bd_lead', 'd'), U('bd1', 'bd', 'bl1'), U('bd2', 'bd', 'bl1'),
  U('bl2', 'bd_lead', 'd'), U('bd3', 'bd', 'bl2'),
  U('bd4', 'bd', null),
  U('gone', 'bd_lead', null, { is_active: false }), U('bd5', 'bd', 'gone'),
  U('ra', 'ra', 'bl1'), U('rl', 'ra_lead', null), U('rec', 'recruiter', 'bd1'),
  U('multi', null, 'bl1', { roles: ['ra', 'bd'] }),
  U('f1', 'bd', null, { org_id: FOREIGN }),
];
const byId = Object.fromEntries(users.map(u => [u.id, u]));
const byMap = new Map(users.map(u => [u.id, u]));
const adminIds = ['a1', 'a2', 'a0'];
const chainOf = (id) => {
  const out = [id]; let grew = true;
  while (grew) {
    grew = false;
    for (const u of users) if (u.manager_id && out.includes(u.manager_id) && !out.includes(u.id)) { out.push(u.id); grew = true; }
  }
  return out;
};
const scopeFor = (id) => { const u = byId[id]; return own.viewScope({ role: u.role, roles: u.roles, userId: id, chainIds: chainOf(id) }); };
const req = (id) => byId[id];
const ask = (kind, record, id, extra) => own.canRequestTakeover(Object.assign({ kind, record, requester: req(id), scope: scopeFor(id) }, extra || {}));

const lead = (owner, extra) => Object.assign({ id: 'L-' + owner, org_id: ORG, assigned_to_bd: owner, created_by: null }, extra || {});
const jo = (owner, extra) => Object.assign({ id: 'J-' + owner, org_id: ORG, bd_manager_id: owner }, extra || {});

// ── recordOwnerId ────────────────────────────────────────────────────────
ok('lead owner = assigned_to_bd', eq(own.recordOwnerId('lead', lead('bd1')), 'bd1'));
ok('lead unowned = null', eq(own.recordOwnerId('lead', lead(null)), null));
ok('job order owner = bd_manager_id', eq(own.recordOwnerId('job_order', jo('bd3')), 'bd3'));
{
  let threw = false;
  try { own.recordOwnerId('candidate', {}); } catch { threw = true; }
  ok('unknown kind throws', threw);
}
const company = { id: 'C1', org_id: ORG, created_by: 'ra' };
ok('client: newest live job order wins', eq(own.recordOwnerId('client', {
  company,
  jobOrders: [
    { company_id: 'C1', bd_manager_id: 'bd1', created_at: '2025-01-01' },
    { company_id: 'C1', bd_manager_id: 'bd2', created_at: '2025-05-01' },
    { company_id: 'C1', bd_manager_id: 'bd3', created_at: '2026-01-01', deleted_at: '2026-02-01' },
  ],
  leads: [{ company_id: 'C1', assigned_to_bd: 'bd4', created_at: '2026-01-01' }],
}), 'bd2'));
ok('client: job order with null bd skipped -> lead', eq(own.recordOwnerId('client', {
  company,
  jobOrders: [{ company_id: 'C1', bd_manager_id: null, created_at: '2026-01-01' }],
  leads: [
    { company_id: 'C1', assigned_to_bd: 'bd1', created_at: '2024-01-01' },
    { company_id: 'C1', assigned_to_bd: 'bd4', created_at: '2025-01-01' },
  ],
}), 'bd4'));
ok('client: falls to created_by', eq(own.recordOwnerId('client', { company, jobOrders: [], leads: [{ company_id: 'C1', assigned_to_bd: null }] }), 'ra'));
ok('client: another company rows ignored', eq(own.recordOwnerId('client', { company, jobOrders: [{ company_id: 'C9', bd_manager_id: 'bd1' }] }), 'ra'));
ok('client: nothing -> null', eq(own.recordOwnerId('client', { company: { id: 'C2', org_id: ORG } }), null));

// ── canRequestTakeover ───────────────────────────────────────────────────
{ const r = ask('lead', lead('bd1'), 'bl1'); ok('same team, lead: bl1 asks for bd1 lead -> ok', r.ok && eq(r.ownerId, 'bd1'), r); }
ok('peer bd cannot see peer lead -> not_found', ask('lead', lead('bd2'), 'bd1').code === 'not_found');
ok('cross-team lead invisible -> not_found', ask('lead', lead('bd3'), 'bl1').code === 'not_found');
ok('bl1 sees bd3 lead researched by own RA (D-0034 sight) -> may ask', ask('lead', lead('bd3', { created_by: 'ra' }), 'bl1').ok);
ok('pool lead invisible to bd -> not_found', ask('lead', lead(null), 'bd1').code === 'not_found');
{ const r = ask('client', { company: { id: 'C1', org_id: ORG }, jobOrders: [{ company_id: 'C1', bd_manager_id: 'bd3' }] }, 'bd1'); ok('cross-team client (shared to see) -> ok', r.ok && eq(r.ownerId, 'bd3'), r); }
ok('cross-team job order -> ok', ask('job_order', jo('bd3'), 'bd1').ok);
{ const r = ask('job_order', jo(null), 'bd1'); ok('unowned job order -> ok, ownerId null', r.ok && r.ownerId === null, r); }
ok('already owner refused', ask('job_order', jo('bd1'), 'bd1').code === 'already_owner');
ok('already owner (lead) refused', ask('lead', lead('bd1'), 'bd1').code === 'already_owner');
ok('recruiter cannot take over a client', ask('client', { company: { id: 'C1', org_id: ORG, created_by: 'bd1' } }, 'rec').code === 'role');
ok('ra cannot take over a job order', ask('job_order', jo('bd1'), 'ra').code === 'role');
ok('ra_lead cannot take over a pool lead even though they see it', ask('lead', lead(null), 'rl').code === 'role');
ok('director CAN own job order', ask('job_order', jo('bd3'), 'd').ok);
ok('director cannot own a lead (lead roles = bd, bd_lead)', ask('lead', lead('bd1'), 'd').code === 'role');
ok('multi-role roles[] wins: [ra,bd] may ask', ask('job_order', jo('bd3'), 'multi').ok);
ok('admin refused (reassigns directly)', ask('job_order', jo('bd1'), 'a1').code === 'admin');
ok('cross-org record -> not_found', ask('job_order', jo('bd1', { org_id: FOREIGN }), 'bd3').code === 'not_found');
ok('foreign requester -> not_found', ask('job_order', jo('bd1'), 'f1').code === 'not_found');
ok('record missing org_id -> not_found (fail closed)', ask('job_order', jo('bd3', { org_id: undefined }), 'bd1').code === 'not_found');
ok('deleted record -> not_found', ask('job_order', jo('bd3', { deleted_at: '2026-01-01' }), 'bd1').code === 'not_found');
ok('scope of a different user -> not_found', own.canRequestTakeover({ kind: 'job_order', record: jo('bd3'), requester: req('bd1'), scope: scopeFor('bd2') }).code === 'not_found');
ok('no scope -> not_found', own.canRequestTakeover({ kind: 'job_order', record: jo('bd3'), requester: req('bd1') }).code === 'not_found');
{
  const a = ask('job_order', jo('bd1', { org_id: FOREIGN }), 'bd3').reason;
  const b = ask('lead', lead('bd3'), 'bl1').reason;
  const c = ask('job_order', jo('x', { deleted_at: 1 }), 'bd1').reason;
  ok('not_found reasons identical (law 3)', a === b && b === c, { a, b, c });
}
ok('unknown kind -> bad_kind', ask('candidate', {}, 'bd1').code === 'bad_kind');
ok('duplicate pending by same person refused', ask('job_order', jo('bd3'), 'bd1', { openRequests: [{ status: 'pending', requester_id: 'bd1' }] }).code === 'already_requested');
ok('someone else pending does not block', ask('job_order', jo('bd3'), 'bd1', { openRequests: [{ status: 'pending', requester_id: 'bd2' }, { status: 'declined', requester_id: 'bd1' }] }).ok);
{
  const rs = [ask('lead', lead('bd1'), 'bd1'), ask('client', { company }, 'rec'), ask('job_order', jo('bd1'), 'a1')];
  ok('refusal reasons are sentences', rs.every(r => /^[A-Z].*\.$/.test(r.reason)), rs.map(r => r.reason));
}

// ── D-0038: viaDuplicateEmailMatch (lead sight only) ────────────────────
const dupe = { viaDuplicateEmailMatch: true };
const NF = ask('lead', lead('bd2'), 'bd1').reason;
{ const r = ask('lead', lead('bd2'), 'bd1', dupe); ok('D38 peer lead + verified match -> ok', r.ok && eq(r.ownerId, 'bd2'), r); }
ok('D38 cross-team lead + match -> ok', ask('lead', lead('bd3'), 'bd1', dupe).ok);
{ const r = ask('lead', lead(null), 'bd1', dupe); ok('D38 pool lead + match -> ok (ownerId null)', r.ok && r.ownerId === null, r); }
ok('D38 flag absent -> still not_found', ask('lead', lead('bd2'), 'bd1').code === 'not_found');
ok('D38 flag false -> not_found', ask('lead', lead('bd2'), 'bd1', { viaDuplicateEmailMatch: false }).code === 'not_found');
{
  for (const v of ['true', 1, {}]) {
    ok(`D38 truthy non-true (${JSON.stringify(v)}) -> not_found`, ask('lead', lead('bd2'), 'bd1', { viaDuplicateEmailMatch: v }).code === 'not_found');
  }
}
{ const r = ask('lead', lead('bd2', { org_id: FOREIGN }), 'bd1', dupe); ok('D38 foreign-org lead + match -> not_found, same sentence', r.code === 'not_found' && r.reason === NF, r); }
{ const r = ask('lead', lead('bd2', { deleted_at: '2026-01-01' }), 'bd1', dupe); ok('D38 deleted lead + match -> not_found, same sentence', r.code === 'not_found' && r.reason === NF, r); }
ok('D38 no scope + match -> not_found', own.canRequestTakeover({ kind: 'lead', record: lead('bd2'), requester: req('bd1'), scope: null, viaDuplicateEmailMatch: true }).code === 'not_found');
ok('D38 admin + match -> admin', ask('lead', lead('bd2'), 'a1', dupe).code === 'admin');
ok('D38 own lead + match -> already_owner', ask('lead', lead('bd1'), 'bd1', dupe).code === 'already_owner');
ok('D38 RA + match -> role', ask('lead', lead('bd2'), 'ra', dupe).code === 'role');
ok('D38 recruiter + match -> role', ask('lead', lead('bd2'), 'rec', dupe).code === 'role');
ok('D38 duplicate pending + match -> already_requested', ask('lead', lead('bd2'), 'bd1', Object.assign({ openRequests: [{ status: 'pending', requester_id: 'bd1' }] }, dupe)).code === 'already_requested');
{
  const recs = [
    ['job_order', jo('bd3')], ['job_order', jo('bd1')],
    ['job_order', jo('bd3', { org_id: FOREIGN })], ['job_order', jo('bd3', { deleted_at: 'x' })],
    ['client', { company: { id: 'C1', org_id: ORG }, jobOrders: [{ company_id: 'C1', bd_manager_id: 'bd3' }] }],
    ['client', { company: { id: 'C1', org_id: FOREIGN } }],
  ];
  let allMatch = true; const diffs = [];
  for (const [k, r] of recs) for (const who of ['bd1', 'ra', 'a1']) {
    const withFlag = ask(k, r, who, dupe), without = ask(k, r, who);
    if (!eq(withFlag, without)) { allMatch = false; diffs.push(k + '/' + who); }
  }
  ok('D38 flag does not change job_order/client answers', allMatch, diffs);
}
ok('D38 job_order sight path unaffected by flag via recordRow', ask('job_order', jo('bd3', { org_id: FOREIGN }), 'bd1', dupe).code === 'not_found');

// ── approverFor ──────────────────────────────────────────────────────────
const app = (owner, requester, u) => own.approverFor({ owner, requester, usersById: u || byId, adminIds });
{ const r = app('bd1', 'bd2'); ok('same team: bd2 asks for bd1 record -> bl1', r.approverId === 'bl1' && r.basis === 'owner_manager', r); }
{ const r = app('bd3', 'bd1'); ok('cross-team: bd1 asks for bd3 record -> bl2 (OWNER manager, not asker)', r.approverId === 'bl2' && r.basis === 'owner_manager', r); }
{ const r = app('bd4', 'bd1'); ok('owner has no manager -> admin a2 (longest-serving live)', r.approverId === 'a2' && r.basis === 'owner_no_manager', r); }
{ const r = app('bd5', 'bd1'); ok('owner manager inactive -> admin', r.approverId === 'a2' && r.basis === 'owner_no_manager', r); }
{ const r = app(null, 'bd3'); ok('unowned -> requester manager', r.approverId === 'bl2' && r.basis === 'unowned_requester_manager', r); }
{ const r = app(null, 'bd4'); ok('unowned, requester no manager -> admin', r.approverId === 'a2' && r.basis === 'unowned_no_manager', r); }
{ const r = app('bd1', 'bl1'); ok('manager asks for report record -> admin, not self', r.approverId === 'a2' && r.basis === 'self_approval', r); }
{ const r = app('bl1', 'd'); ok('director asks for bl1 record (d manages bl1) -> admin', r.approverId === 'a2' && r.basis === 'self_approval', r); }
{
  let never = true;
  for (const o of [null, ...users.map(u => u.id)]) for (const q of users.map(u => u.id)) { if (app(o, q).approverId === q) never = false; }
  ok('approver is never the requester (sweep)', never);
}
ok('Map usersById works', app('bd3', 'bd1', byMap).approverId === 'bl2');
ok('admin excluded when requester is that admin', own.approverFor({ owner: 'bd4', requester: 'a2', usersById: byId, adminIds }).approverId === 'a1');
{ const r = own.approverFor({ owner: 'bd4', requester: 'bd1', usersById: byId, adminIds: ['a0'] }); ok('no live admin -> no_approver, null', r.approverId === null && r.basis === 'no_approver', r); }
{
  const u = Object.assign({}, byId, { x: U('x', 'bd', 'f1') });
  const r = own.approverFor({ owner: 'x', requester: 'bd1', usersById: u, adminIds });
  ok('foreign-org manager is not an approver', r.approverId === 'a2', r);
}
ok('admin tie on created_at -> smallest id', (() => {
  const u = Object.assign({}, byId, { z9: U('z9', 'admin', null, { created_at: '2024-01-01T00:00:00Z' }), a2: byId.a2 });
  return own.pickAdmin(['z9', 'a2'], u, null, ORG) === 'a2';
})());
{ const r = app('bd3', 'bd1'); ok('why names people', r.why.includes('BD3') && r.why.includes('BL2'), r.why); }

// ── canDecide / canCancel / transitions ──────────────────────────────────
const R = (o) => Object.assign({ requester_id: 'bd1', approver_id: 'bl2', status: 'pending', org_id: ORG }, o || {});
ok('recorded approver may decide', own.canDecide({ request: R(), deciderId: 'bl2', deciderRoles: ['bd_lead'] }).ok);
ok('same-org admin may decide', own.canDecide({ request: R(), deciderId: 'a1', deciderRoles: ['admin'], deciderOrgId: ORG }).ok);
ok('admin role as {role} object', own.canDecide({ request: R(), deciderId: 'a1', deciderRoles: { role: 'admin' }, deciderOrgId: ORG }).ok);
ok('foreign-org admin refused', !own.canDecide({ request: R(), deciderId: 'fa', deciderRoles: ['admin'], deciderOrgId: FOREIGN }).ok);
ok('admin with no org given refused (fail closed)', !own.canDecide({ request: R(), deciderId: 'a1', deciderRoles: ['admin'] }).ok);
ok('requester refused', !own.canDecide({ request: R(), deciderId: 'bd1', deciderRoles: ['bd'] }).ok);
ok('requester who is admin refused', !own.canDecide({ request: R({ requester_id: 'a1' }), deciderId: 'a1', deciderRoles: ['admin'], deciderOrgId: ORG }).ok);
ok('other manager refused', !own.canDecide({ request: R(), deciderId: 'bl1', deciderRoles: ['bd_lead'] }).ok);
ok('owner (not approver) refused', !own.canDecide({ request: R(), deciderId: 'bd3', deciderRoles: ['bd'] }).ok);
{
  let allRefused = true;
  for (const s of ['approved', 'declined', 'cancelled']) if (own.canDecide({ request: R({ status: s }), deciderId: 'bl2', deciderRoles: [] }).ok) allRefused = false;
  ok('decided request cannot be decided again', allRefused);
}
ok('requester may cancel pending', own.canCancel({ request: R(), actorId: 'bd1' }).ok);
ok('approver may not cancel', !own.canCancel({ request: R(), actorId: 'bl2' }).ok);
ok('cannot cancel an approved one', !own.canCancel({ request: R({ status: 'approved' }), actorId: 'bd1' }).ok);
{
  const legal = [];
  for (const f of own.TAKEOVER_STATES) for (const to of own.TAKEOVER_STATES) if (own.takeoverTransition(f, to).ok) legal.push(f + '>' + to);
  ok('transitions: exactly three legal', eq(legal, ['pending>approved', 'pending>declined', 'pending>cancelled']), legal);
}
ok('unknown state refused', !own.takeoverTransition('pending', 'expired').ok && !own.takeoverTransition(undefined, 'approved').ok);

// ── mutation: approver = asker's manager (D-0037's central rule) ─────────
// A buggy reimplementation that hands the request to the REQUESTER's manager
// instead of the OWNER's — the exact wrong shape D-0037 explicitly rejected
// ("current owner's manager", not "asker's manager only"). If this file's
// real assertions above ever regress to match this mutation's answer, the
// mutation itself would then be indistinguishable from correct — so this
// section proves the mutation actually disagrees with the shipped function
// on a real case, and that the *shipped* function gives the D-0037 answer.
function approverFor_WRONG_askersManager({ owner, requester, usersById, adminIds }) {
  // Same admin/self-approval handling, but looks up the REQUESTER's manager
  // even when the record IS owned — the asker's-manager-only shape D-0037
  // rejected.
  const lookup = (id) => (typeof usersById.get === 'function' ? usersById.get(id) : usersById[id]);
  const mid = lookup(requester) && lookup(requester).manager_id;
  if (!mid) return own.approverFor({ owner, requester, usersById, adminIds });
  return { approverId: mid, basis: 'WRONG_askers_manager', why: 'wrong' };
}
{
  // bd1 asks for bd3's (cross-team) record: real answer is bl2 (bd3's
  // manager); the wrong mutation would hand it to bl1 (bd1's own manager).
  const real = own.approverFor({ owner: 'bd3', requester: 'bd1', usersById: byId, adminIds });
  const wrong = approverFor_WRONG_askersManager({ owner: 'bd3', requester: 'bd1', usersById: byId, adminIds });
  ok('MUTATION approver=askers-manager disagrees with the shipped cross-team answer',
    real.approverId === 'bl2' && wrong.approverId === 'bl1' && real.approverId !== wrong.approverId,
    { real, wrong });
}

const failed = results.filter(x => !x.c);
for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
