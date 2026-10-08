// A BD WRITES SEQUENCES OF THEIR OWN (owner, 8 Oct, with a screenshot of the Sequences tab: "no new sequence creation option in the
// sequence section"). Until now only admin / RA lead / BD lead could create one, so a BD saw the company's standard sequence and no way
// to make their own. Proven here against the real router and a small in-memory database:
//   * a BD can create a sequence (it starts as a draft, owned by them) and change / switch on or off THEIR OWN
//   * a BD cannot change the company's sequence, nor another BD's (403, nothing written)
//   * the BD's list is their own + the organisation's (seeded standard, or made by an admin / lead) — never another BD's personal one
//   * leads and admins see and change everything exactly as before
// Usage: node test/sequence-own-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const T = {
  users: [{ id: 'bd1', role: 'bd', roles: ['bd'] }, { id: 'bd2', role: 'bd', roles: ['bd'] }, { id: 'boss', role: 'bd_lead', roles: ['bd_lead'] }, { id: 'adm', role: 'admin', roles: ['admin'] }, { id: 'rec', role: 'recruiter', roles: ['recruiter'] }],
  workflow_definitions: [
    { id: 'std', org_id: 'o1', name: 'Standard Sales Outreach', entity_type: 'contact', status: 'active', created_by: null, created_at: '2026-09-01' },
    { id: 'lead1', org_id: 'o1', name: 'Boss sequence', entity_type: 'contact', status: 'active', created_by: 'boss', created_at: '2026-09-02' },
    { id: 'mine', org_id: 'o1', name: 'Bd1 own', entity_type: 'contact', status: 'draft', created_by: 'bd1', created_at: '2026-09-03' },
    { id: 'theirs', org_id: 'o1', name: 'Bd2 own', entity_type: 'contact', status: 'active', created_by: 'bd2', created_at: '2026-09-04' },
  ],
  workflow_steps: [], workflow_enrollments: [],
};
let n = 0;
const fake = { from(name) { const f = []; let mode = 'select', patch = null, row = null;
  const rows = () => (T[name] = T[name] || []).filter(r => f.every(x => x(r)));
  const doInsert = () => { const arr = Array.isArray(row) ? row : [row]; arr.forEach(r => { const x = { id: r.id || 'new' + (++n), created_at: '2026-10-08', ...r }; (T[name] = T[name] || []).push(x); row0 = x; }); };
  const q = { select() { return q; }, eq(c, v) { f.push(r => r[c] === v); return q; }, in(c, l) { f.push(r => l.includes(r[c])); return q; }, is(c, v) { f.push(r => (v === null ? r[c] == null : r[c] === v)); return q; }, order() { return q; },
    insert(r) { mode = 'insert'; row = r; return q; }, update(p) { mode = 'update'; patch = p; return q; }, delete() { mode = 'delete'; return q; },
    single: async () => { let r; if (mode === 'insert') { doInsert(); r = row0; } else r = rows()[0]; return { data: r ? withSteps(name, r) : null, error: null }; },
    maybeSingle: async () => { if (mode === 'update') rows().forEach(x => Object.assign(x, patch)); const r = rows()[0]; return { data: r ? withSteps(name, r) : null, error: null }; },
    then(res, rej) { let out;
      if (mode === 'insert') { doInsert(); out = { data: [row0], error: null }; }
      else if (mode === 'update') { rows().forEach(r => Object.assign(r, patch)); out = { data: rows(), error: null }; }
      else if (mode === 'delete') { T[name] = T[name].filter(r => !f.every(x => x(r))); out = { error: null }; }
      else out = { data: rows().map(r => withSteps(name, r)), error: null };
      return Promise.resolve(out).then(res, rej); } };
  return q; } };
let row0 = null;
const withSteps = (name, r) => (name === 'workflow_definitions' ? { ...r, steps: T.workflow_steps.filter(s => s.workflow_id === r.id) } : r);
const ctx = { supabase: fake, auth: (_a, _b, nx) => nx(), hasRole: (req, ...roles) => (req.user.roles || []).some(x => roles.includes(x)), engine: { listChannels: () => ['email'], describeChannels: () => [] }, logActivity: async () => {} };
const router = require('../routes/wf.js')(ctx);
const handler = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, uid, body, params) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } };
  const u = T.users.find(x => x.id === uid); await handler(p, m)({ user: { ...u }, orgId: 'o1', body: body || {}, params: params || {}, query: {} }, res); return { code, out }; };

const steps = [{ channel: 'email', delay_days: 0, config: { template_key: 'initial' } }, { channel: 'email', delay_days: 3, config: { template_key: 'fu1', thread: true } }];
let r = await call('/wf/definitions', 'post', 'bd1', { name: 'My plan', steps });
step('a BD can create a sequence — it starts as a draft, made by them', r.code === 200 && r.out && r.out.status === 'draft' && T.workflow_definitions.some(d => d.name === 'My plan' && d.created_by === 'bd1'), JSON.stringify(r.out && r.out.status));
r = await call('/wf/definitions/:id/status', 'post', 'bd1', { status: 'active' }, { id: 'mine' });
step('a BD can switch their OWN sequence on', r.code === 200 && T.workflow_definitions.find(d => d.id === 'mine').status === 'active');
r = await call('/wf/definitions/:id', 'put', 'bd1', { name: 'Renamed' }, { id: 'mine' });
step('…and rename / edit it', r.code === 200 && T.workflow_definitions.find(d => d.id === 'mine').name === 'Renamed');
r = await call('/wf/definitions/:id', 'put', 'bd1', { name: 'Hijack' }, { id: 'std' });
step('a BD cannot change the company\'s standard sequence', r.code === 403 && T.workflow_definitions.find(d => d.id === 'std').name === 'Standard Sales Outreach');
r = await call('/wf/definitions/:id/status', 'post', 'bd1', { status: 'archived' }, { id: 'theirs' });
step('…nor switch off another BD\'s', r.code === 403 && T.workflow_definitions.find(d => d.id === 'theirs').status === 'active');
r = await call('/wf/definitions/:id', 'put', 'bd1', { name: 'Hijack' }, { id: 'lead1' });
step('…nor a lead\'s', r.code === 403 && T.workflow_definitions.find(d => d.id === 'lead1').name === 'Boss sequence');

r = await call('/wf/definitions', 'get', 'bd1');
const ids = (r.out || []).map(d => d.id);
step('a plain BD starts BLANK (D-0113): only the sequences THEY made — not the company\'s standard, not a lead\'s, not another BD\'s', ids.includes('mine') && !ids.includes('std') && !ids.includes('lead1') && !ids.includes('theirs'), ids.join(','));
step('…including the one they just made', (r.out || []).some(d => d.name === 'My plan'));
r = await call('/wf/definitions', 'get', 'bd2');
step('another BD sees theirs, not the first BD\'s', (r.out || []).some(d => d.id === 'theirs') && !(r.out || []).some(d => d.id === 'mine' || d.name === 'My plan'));
r = await call('/wf/definitions', 'get', 'boss');
step('a lead sees every sequence, as before', (r.out || []).length === T.workflow_definitions.length);
r = await call('/wf/definitions', 'get', 'adm');
step('an admin too', (r.out || []).length === T.workflow_definitions.length);
r = await call('/wf/definitions/:id', 'put', 'boss', { name: 'Lead edit' }, { id: 'theirs' });
step('a lead can still edit any sequence, as before', r.code === 200 && T.workflow_definitions.find(d => d.id === 'theirs').name === 'Lead edit');

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
