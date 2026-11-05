// OUTREACH INSIGHTS — Me / My team / a person (R-398, D-0215/D-0216), on the REAL routes with a small fake database.
//   * "me" counts only my sends; "team" counts the WHOLE reporting line (reports of reports too) and nobody outside it;
//   * one person on the line can be picked; a person outside the line is a 404 (never confirms the id exists);
//   * an admin's team is the company;
//   * the sequences table says whose each is and whether it can be switched off from here;
//   * a manager switches off a team member's sequence = it leaves "active" AND everyone inside stops; an outsider's is a 404, untouched.
// Usage: node test/outreach-team-scope-smoke.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const R = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(R + '/index.js');
let pass = 0, fail = 0; const step = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x ? ' — ' + x : '')); } };
const ORG = 'org1', day = new Date().toISOString().slice(0, 10);
const D = {
  users: [
    { id: 'M', name: 'Mona Manager', manager_id: null, org_id: ORG, deleted_at: null },
    { id: 'R1', name: 'Rita Report', manager_id: 'M', org_id: ORG, deleted_at: null },
    { id: 'R2', name: 'Ravi Underrita', manager_id: 'R1', org_id: ORG, deleted_at: null },
    { id: 'X', name: 'Xavier Outsider', manager_id: null, org_id: ORG, deleted_at: null }],
  workflow_definitions: [
    { id: 'sM', name: 'Mona seq', created_by: 'M', status: 'active', org_id: ORG },
    { id: 'sR1', name: 'Rita seq', created_by: 'R1', status: 'active', org_id: ORG },
    { id: 'sX', name: 'Xavier seq', created_by: 'X', status: 'active', org_id: ORG }],
  workflow_step_runs: [], email_tracking: [], contacts: [], jobs: [],
  emails: [], workflow_enrollments: [
    { id: 'n1', workflow_id: 'sR1', status: 'active', org_id: ORG }, { id: 'n2', workflow_id: 'sR1', status: 'paused', org_id: ORG },
    { id: 'n3', workflow_id: 'sX', status: 'active', org_id: ORG }],
};
[['M', 1], ['R1', 2], ['R2', 4], ['X', 8]].forEach(([u, n]) => { for (let i = 0; i < n; i++) D.emails.push({ id: u + i, sent_by: u, status: 'sent', sent_at: day, contact_id: null, org_id: ORG }); });
function q(table) {
  const f = []; let upd = null, single = false;
  const api = {
    select() { return api; }, order() { return api; }, range() { return api; },
    eq(k, v) { f.push((r) => r[k] === v); return api; }, is(k, v) { f.push((r) => (r[k] == null) === (v == null)); return api; },
    gte(k, v) { f.push((r) => String(r[k] || '') >= String(v)); return api; }, lte(k, v) { f.push((r) => String(r[k] || '') <= String(v)); return api; },
    in(k, vs) { f.push((r) => vs.includes(r[k])); return api; }, update(p) { upd = p; return api; }, maybeSingle() { single = true; return api; },
    then(ok, bad) {
      return (async () => {
        const rows = (D[table] || []).filter((r) => f.every((fn) => fn(r)));
        if (upd) { rows.forEach((r) => Object.assign(r, upd)); return { data: rows.map((r) => ({ id: r.id })), error: null }; }
        return { data: single ? (rows[0] || null) : rows, error: null };
      })().then(ok, bad);
    },
  };
  return api;
}
const supabase = { from: q };
const { reportingChainIds } = require(R + '/hierarchy.js')(supabase);
const router = require(R + '/routes/workflows.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...r) => r.some((x) => (req.user.roles || []).includes(x)),
  today: () => day, logActivity() {}, INDUSTRIES: [], normInd: (x) => x, userOrgId: async () => ORG, withOrg: (qq, req) => (req && req.orgId ? qq.eq('org_id', req.orgId) : qq), reportingChainIds });
const handler = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack.slice(-1)[0].handle;
async function call(method, p, req) { let status = 200, body = null; const res = { status(s) { status = s; return res; }, json(j) { body = j; return res; } }; await handler(method, p)(req, res); return { status, body }; }
const as = (id, roles, query = {}, params = {}) => ({ query, params, user: { id, role: roles[0], roles }, orgId: ORG });
const get = (u, who) => call('get', '/insights/outreach', as(u.id, u.roles, who ? { who } : {}));

const mgr = { id: 'M', roles: ['bd_lead'] };
let r = await get(mgr);
step('default is "me": only my own 1 email', r.status === 200 && r.body.totals.emailed === 1 && r.body.scope.who === 'me', JSON.stringify(r.body && r.body.totals));
r = await get(mgr, 'team');
step('"My team" counts the whole line: me + Rita + Rita\'s report = 1+2+4 = 7, not the outsider\'s 8', r.body.totals.emailed === 7, String(r.body.totals && r.body.totals.emailed));
step('…the switch offers the two people under me, not the outsider', JSON.stringify(r.body.scope.people.map((p) => p.id).sort()) === '["R1","R2"]', JSON.stringify(r.body.scope.people));
step('…the sequence picker holds the line\'s sequences only', r.body.choices.some((c) => c.id === 'sR1') && r.body.choices.some((c) => c.id === 'sM') && !r.body.choices.some((c) => c.id === 'sX'));
r = await get(mgr, 'R2');
step('one person on the line (a report of a report) is readable: 4 emails', r.status === 200 && r.body.totals.emailed === 4 && r.body.scope.who === 'R2');
r = await get(mgr, 'X');
step('a person outside the line answers 404', r.status === 404);
r = await get({ id: 'R1', roles: ['bd'] }, 'team');
step('a plain person\'s team is themselves and their own report: 2+4 = 6', r.body.totals.emailed === 6, String(r.body.totals && r.body.totals.emailed));
r = await get({ id: 'R1', roles: ['bd'] }, 'M');
step('…and cannot read upward (their manager is a 404)', r.status === 404);
r = await get({ id: 'A', roles: ['admin'] }, 'team');
step('an admin\'s team is the company: 1+2+4+8 = 15', r.status === 200 && r.body.totals.emailed === 15, String(r.body.totals && r.body.totals.emailed));

D.emails.push({ id: 'mR1', sent_by: 'R1', status: 'sent', sent_at: day, contact_id: null, org_id: ORG });
D.workflow_step_runs.push({ id: 1, workflow_id: 'sR1', detail: { email_id: 'mR1' }, outcome: 'done', run_at: new Date().toISOString() });
r = await get(mgr, 'team');
const row = r.body.sequences.find((s) => s.id === 'sR1');
step('the by-sequence table names the owner and allows switching off a line member\'s active sequence', !!row && row.owner_name === 'Rita Report' && row.can_switch_off === true, JSON.stringify(row));

step('…and it names how many are inside right now (2), so the confirmation can say so', row.people_now === 2, JSON.stringify(row && row.people_now));
// ── switch off ──
const off = (u, id) => call('post', '/insights/outreach/sequence/:id/switch-off', as(u.id, u.roles, {}, { id }));
r = await off({ id: 'X', roles: ['bd'] }, 'sR1');
step('someone outside the line cannot switch it off (404) and nothing changes', r.status === 404 && D.workflow_definitions.find((d) => d.id === 'sR1').status === 'active' && D.workflow_enrollments.filter((e) => e.workflow_id === 'sR1' && e.status !== 'exited').length === 2);
r = await off(mgr, 'sX');
step('a manager cannot switch off an outsider\'s sequence (404) and its people stay in', r.status === 404 && D.workflow_enrollments.find((e) => e.id === 'n3').status === 'active');
r = await off(mgr, 'sR1');
step('the manager switches off a team member\'s sequence: it is turned off…', r.status === 200 && D.workflow_definitions.find((d) => d.id === 'sR1').status === 'archived');
step('…everyone inside stops, and it says how many (2)', r.body.stopped === 2 && D.workflow_enrollments.filter((e) => e.workflow_id === 'sR1').every((e) => e.status === 'exited'), JSON.stringify(r.body));
step('…and the outsider\'s people were not touched', D.workflow_enrollments.find((e) => e.id === 'n3').status === 'active');
r = await get(mgr, 'team');
step('its past numbers are still in the table after it is off', r.body.sequences.some((s) => s.id === 'sR1'));
console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' passed'); process.exit(fail ? 1 : 0);
