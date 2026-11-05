// A SEQUENCE WITH PEOPLE IN IT CAN BE STOPPED, DELETED, RESTORED AND REWORDED (R-384/R-385/R-386, owner 4–5 Nov 2026; D-0216, D-0217).
//   * "N people in it now" = people active or paused in THAT sequence (not finished, not another sequence's);
//   * Stop all: everyone still going through it stops; emails ALREADY QUEUED still go out (the pending email row is untouched);
//   * Delete: everyone stops, it leaves the list, and it is KEPT — restorable for the admin's number of days (default 14), then not;
//     a deleted sequence cannot be turned on or edited; restoring brings it back SWITCHED OFF and the people stay stopped;
//   * editing with people inside: the WORDING (subject, body, versions) of any step changes IN PLACE (same steps, same people);
//     adding / removing / reordering / retiming steps is refused with "save it as a new copy";
//   * versions per step: the admin's `sequence_versions_max` (including the step's own words), for any builder.
// The real wf router runs against a small in-memory database. Nothing here is a source grep.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 230) : '')); };
const C = require('../services/sequence-control.js');

// ── the pure rules ──
const OLD = [{ step_order: 1, name: 'First', channel: 'email', delay_days: 0, config: { subject: 'S', body: 'B', builder: 'v2' } }, { step_order: 2, name: 'Fu1', channel: 'email', delay_days: 3, config: { subject: 'S2', body: 'B2', thread: true } }];
const mod = (fn) => { const n = JSON.parse(JSON.stringify(OLD)); fn(n); return n; };
step('classify: the same steps → none', C.classifyEdit(OLD, OLD).kind === 'none');
step('classify: a body / subject / versions change → wording (and which step)', JSON.stringify(C.classifyEdit(OLD, mod((n) => { n[1].config.body = 'new'; }))) === '{"kind":"wording","changed":[2]}' && C.classifyEdit(OLD, mod((n) => { n[0].config.versions = [{ body: 'v2' }]; })).kind === 'wording');
step('classify: a step\'s name alone is cosmetic → wording', C.classifyEdit(OLD, mod((n) => { n[0].name = 'Opener'; })).kind === 'wording');
step('classify: a different delay, kind, number of steps, or another setting (thread) → structure', ['delay', 'channel', 'count', 'thread'].every((w) => C.classifyEdit(OLD, mod((n) => { if (w === 'delay') n[1].delay_days = 9; if (w === 'channel') n[1].channel = 'bd_touch'; if (w === 'count') n.push({ name: 'x', channel: 'email', delay_days: 1, config: {} }); if (w === 'thread') n[1].config.thread = false; })).kind === 'structure'));
step('classify: reordering steps → structure', C.classifyEdit(OLD, [OLD[1], OLD[0]]).kind === 'structure');
const DEL = { status: 'deleted', updated_at: new Date(Date.now() - 13 * 86400000).toISOString() };
step('restore window: deleted 13 days ago with a 14-day window → can come back; 15 days ago → cannot', C.restorable(DEL, { days: 14 }).ok && !C.restorable({ ...DEL, updated_at: new Date(Date.now() - 15 * 86400000).toISOString() }, { days: 14 }).ok && !C.restorable({ status: 'active' }, { days: 14 }).ok);
step('received: counts people whose last step done is at or past that step', C.receivedStep([{ current_step_order: 2 }, { current_step_order: 1 }, { current_step_order: 0 }], 2) === 1);

// ── the real routes ──
const D = {
  users: [{ id: 'bd1', role: 'bd', roles: ['bd'] }, { id: 'bd2', role: 'bd', roles: ['bd'] }, { id: 'boss', role: 'bd_lead', roles: ['bd_lead'] }],
  workflow_definitions: [
    { id: 'S1', org_id: 'o1', name: 'Mine', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'bd1', version: 1, created_at: '2026-10-01', updated_at: '2026-10-01T00:00:00Z' },
    { id: 'S2', org_id: 'o1', name: 'Theirs', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'bd2', version: 1, created_at: '2026-10-02', updated_at: '2026-10-02T00:00:00Z' },
    { id: 'S3', org_id: 'o1', name: 'Empty one', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'bd1', version: 1, created_at: '2026-10-03', updated_at: '2026-10-03T00:00:00Z' },
  ],
  workflow_steps: [], workflow_enrollments: [], emails: [], app_settings: [],
};
const mkSteps = (wf, n = 3) => Array.from({ length: n }, (_, i) => ({ id: wf + '-st' + (i + 1), workflow_id: wf, org_id: 'o1', step_order: i + 1, name: i ? 'Follow-up ' + i : 'First', channel: 'email', delay_days: i ? 3 : 0, config: { subject: 'Subj ' + i, body: 'Body number ' + i + ' of the email' } }));
const resetData = () => {
  D.workflow_steps = [...mkSteps('S1'), ...mkSteps('S2'), ...mkSteps('S3', 2)];
  D.workflow_enrollments = [
    { id: 'e1', workflow_id: 'S1', org_id: 'o1', status: 'active', current_step_order: 1, contact_id: 'c1' },
    { id: 'e2', workflow_id: 'S1', org_id: 'o1', status: 'paused', current_step_order: 0, contact_id: 'c2' },
    { id: 'e3', workflow_id: 'S1', org_id: 'o1', status: 'exited', current_step_order: 2, contact_id: 'c3' },
    { id: 'e4', workflow_id: 'S1', org_id: 'o1', status: 'completed', current_step_order: 3, contact_id: 'c4' },
    { id: 'e5', workflow_id: 'S2', org_id: 'o1', status: 'active', current_step_order: 1, contact_id: 'c5' },
  ];
  D.emails = [{ id: 'em1', contact_id: 'c1', status: 'pending', subject: 'queued before the stop' }];
  D.workflow_definitions.forEach((d) => { d.status = 'active'; d.updated_at = '2026-10-01T00:00:00Z'; });
};
resetData();
let n = 0;
const fake = { from(name) {
  const f = []; let mode = 'select', patch = null, row = null, sel = false, ord = null;
  const rows = () => { let r = (D[name] = D[name] || []).filter((x) => f.every((fn) => fn(x))); if (ord) r = r.slice().sort((a, b) => (String(b[ord]) > String(a[ord]) ? 1 : -1)); return r; };
  const withSteps = (r) => (name === 'workflow_definitions' ? { ...r, steps: D.workflow_steps.filter((s) => s.workflow_id === r.id) } : r);
  const q = { select() { sel = true; return q; }, eq(c, v) { f.push((r) => r[c] === v); return q; }, in(c, l) { f.push((r) => l.includes(r[c])); return q; },
    is(c, v) { f.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; }, order(c) { ord = c; return q; },
    insert(r) { mode = 'insert'; row = r; return q; }, update(p) { mode = 'update'; patch = p; return q; }, delete() { mode = 'delete'; return q; },
    single: async () => { const r = rows()[0]; return { data: r ? withSteps(r) : null, error: null }; },
    maybeSingle: async () => { if (mode === 'update') rows().forEach((x) => Object.assign(x, patch)); const r = rows()[0]; return { data: r ? withSteps(r) : null, error: null }; },
    then(res, rej) { let out;
      if (mode === 'insert') { const arr = Array.isArray(row) ? row : [row]; arr.forEach((r) => (D[name] = D[name] || []).push({ id: r.id || 'n' + (++n), ...r })); out = { data: arr, error: null }; }
      else if (mode === 'update') { const r = rows(); r.forEach((x) => Object.assign(x, patch)); out = { data: sel ? r : null, error: null }; }
      else if (mode === 'delete') { D[name] = D[name].filter((x) => !f.every((fn) => fn(x))); out = { error: null }; }
      else out = { data: rows().map(withSteps), error: null };
      return Promise.resolve(out).then(res, rej); } };
  return q; } };
const ctx = { supabase: fake, auth: (_a, _b, nx) => nx(), hasRole: (req, ...roles) => (req.user.roles || []).some((x) => roles.includes(x)), engine: { listChannels: () => ['email'], describeChannels: () => [] }, logActivity: async () => {} };
const router = require('../routes/wf.js')(ctx);
const handler = (p, m) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, uid, body, params, org = 'o1') => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } };
  const u = D.users.find((x) => x.id === uid); await handler(p, m)({ user: { ...u }, orgId: org, body: body || {}, params: params || {}, query: {} }, res); return { code, out }; };
const stepsOf = (wf) => D.workflow_steps.filter((s) => s.workflow_id === wf).sort((a, b) => a.step_order - b.step_order).map((s) => ({ name: s.name, channel: s.channel, delay_days: s.delay_days, config: JSON.parse(JSON.stringify(s.config)) }));
const statusOf = (id) => D.workflow_enrollments.find((e) => e.id === id).status;

// ── "N people in it now" ──
let r = await call('/wf/definitions', 'get', 'bd1');
step('the list says how many are in each of YOUR sequences now — active and paused only (2), not finished ones, not another sequence\'s', r.out.find((d) => d.id === 'S1').people_now === 2 && r.out.find((d) => d.id === 'S3').people_now === 0 && !r.out.some((d) => d.id === 'S2'), JSON.stringify(r.out.map((d) => [d.id, d.people_now])));

// ── Stop all ──
r = await call('/wf/definitions/:id/stop-all', 'post', 'bd1', {}, { id: 'S1' });
step('Stop all: answers how many it stopped (2) and those two are stopped', r.code === 200 && r.out.stopped === 2 && statusOf('e1') === 'exited' && statusOf('e2') === 'exited' && D.workflow_enrollments.find((e) => e.id === 'e1').exit_reason === 'sequence_stopped', JSON.stringify(r.out));
step('…people already finished are not touched, and neither is ANOTHER sequence\'s person', statusOf('e3') === 'exited' && D.workflow_enrollments.find((e) => e.id === 'e3').exit_reason == null && statusOf('e4') === 'completed' && statusOf('e5') === 'active');
step('…an email ALREADY QUEUED is left exactly as it was — it still goes out', D.emails[0].status === 'pending' && D.emails[0].subject === 'queued before the stop');
r = await call('/wf/definitions/:id/stop-all', 'post', 'bd2', {}, { id: 'S1' });
step('…a BD cannot stop someone else\'s sequence (403)', r.code === 403);

// ── Delete, undo window, Restore ──
resetData();
r = await call('/wf/definitions/:id/delete', 'post', 'bd1', {}, { id: 'S1' });
const s1 = D.workflow_definitions.find((d) => d.id === 'S1');
step('Delete: stops the people (2), marks it deleted, KEEPS the row, and says how long it can come back (14 days)', r.code === 200 && r.out.stopped === 2 && s1.status === 'deleted' && r.out.restorable_days === 14 && statusOf('e1') === 'exited' && D.workflow_enrollments.find((e) => e.id === 'e1').exit_reason === 'sequence_deleted', JSON.stringify(r.out));
step('…its steps and the queued email are still there (nothing erased)', stepsOf('S1').length === 3 && D.emails[0].status === 'pending');
r = await call('/wf/definitions', 'get', 'bd1');
step('…it is gone from the list', !r.out.some((d) => d.id === 'S1') && r.out.some((d) => d.id === 'S3'));
r = await call('/wf/definitions/deleted', 'get', 'bd1');
step('…and appears under "Recently deleted" with its deadline', r.out.deleted.length === 1 && r.out.deleted[0].id === 'S1' && !!r.out.deleted[0].restorable_until && r.out.days === 14, JSON.stringify(r.out));
r = await call('/wf/definitions/deleted', 'get', 'bd2');
step('…only to its owner (another BD sees nothing)', r.out.deleted.length === 0);
r = await call('/wf/definitions/:id/status', 'post', 'bd1', { status: 'active' }, { id: 'S1' });
step('a deleted sequence cannot be turned on (409: restore it first)', r.code === 409 && /restore/i.test(r.out.error));
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: stepsOf('S1') }, { id: 'S1' });
step('…nor edited', r.code === 409);
r = await call('/wf/definitions/:id/restore', 'post', 'bd1', {}, { id: 'S1' });
step('Restore: it comes back SWITCHED OFF (archived) — nothing starts by itself — and its people stay stopped', r.code === 200 && s1.status === 'archived' && statusOf('e1') === 'exited' && statusOf('e2') === 'exited', JSON.stringify(r.out && r.out.status));
r = await call('/wf/definitions/:id/delete', 'post', 'bd1', {}, { id: 'S1' });
s1.updated_at = new Date(Date.now() - 15 * 86400000).toISOString();
r = await call('/wf/definitions/:id/restore', 'post', 'bd1', {}, { id: 'S1' });
step('after the window (15 days > 14) it can NO LONGER be restored (409), and the row is still kept', r.code === 409 && /14 days/.test(r.out.error) && s1.status === 'deleted');
r = await call('/wf/definitions/deleted', 'get', 'bd1');
step('…and it is no longer offered under "Recently deleted"', r.out.deleted.length === 0);
// the admin's number
D.app_settings.push({ key: 'sys_sequence_undo_days@o2', value: '30' });
D.workflow_definitions.push({ id: 'S9', org_id: 'o2', name: 'Other org', domain: 'sales', entity_type: 'contact', status: 'deleted', created_by: 'bd1', version: 1, created_at: '2026-10-01', updated_at: new Date(Date.now() - 20 * 86400000).toISOString() });
r = await call('/wf/definitions/:id/restore', 'post', 'bd1', {}, { id: 'S9' }, 'o2');
step('the undo window is the ADMIN\'S number (30 days in this company): 20 days ago is still restorable', r.code === 200 && D.workflow_definitions.find((d) => d.id === 'S9').status === 'archived', JSON.stringify(r.out && (r.out.error || r.out.status)));

// ── editing with people inside ──
resetData();
const stepsOK = stepsOf('S1');
const reword = JSON.parse(JSON.stringify(stepsOK)); reword[1].config.body = 'A better follow-up, reworded';
const idsBefore = D.workflow_steps.filter((s) => s.workflow_id === 'S1').map((s) => s.id).join();
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: reword }, { id: 'S1' });
step('edit with 2 people inside: rewording a step is ALLOWED — and the sequence is not locked', r.code === 200, JSON.stringify(r.out && r.out.error));
step('…done IN PLACE: the same steps (ids), the new words stored, the people still where they were', D.workflow_steps.filter((s) => s.workflow_id === 'S1').map((s) => s.id).join() === idsBefore && /reworded/.test(D.workflow_steps.find((s) => s.id === 'S1-st2').config.body) && statusOf('e1') === 'active' && statusOf('e2') === 'paused' && D.workflow_enrollments.find((e) => e.id === 'e1').current_step_order === 1);
step('…the version number goes up, an untouched step is untouched', D.workflow_definitions.find((d) => d.id === 'S1').version === 2 && D.workflow_steps.find((s) => s.id === 'S1-st1').config.body === 'Body number 0 of the email');
const reachedRewording = JSON.parse(JSON.stringify(stepsOf('S1'))); reachedRewording[0].config.body = 'Reworded first email, which e1 already got';
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: reachedRewording }, { id: 'S1' });
step('rewording a step someone has ALREADY received is allowed too (owner 5 Nov) — it only reaches people who have not got it', r.code === 200 && /Reworded first/.test(D.workflow_steps.find((s) => s.id === 'S1-st1').config.body));
const retime = stepsOf('S1'); retime[1].delay_days = 9;
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: retime }, { id: 'S1' });
step('changing a step\'s timing with people inside is refused — "save it as a new copy" — and nothing changed', r.code === 409 && r.out.code === 'needs_copy' && r.out.people === 2 && /new copy/.test(r.out.error) && D.workflow_steps.find((s) => s.id === 'S1-st2').delay_days === 3, JSON.stringify(r.out));
const added = stepsOf('S1'); added.push({ name: 'Extra', channel: 'email', delay_days: 2, config: { subject: 'x', body: 'An extra email step here' } });
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: added }, { id: 'S1' });
step('adding a step with people inside is refused too, and the steps stay 3', r.code === 409 && stepsOf('S1').length === 3);
const removed = stepsOf('S1').slice(0, 2);
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: removed }, { id: 'S1' });
step('…and removing one', r.code === 409 && stepsOf('S1').length === 3);
const added3 = stepsOf('S3'); added3.push({ name: 'Extra', channel: 'email', delay_days: 2, config: { subject: 'x', body: 'An extra email step here' } });
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: added3 }, { id: 'S3' });
step('with NOBODY inside, the structure can still be changed freely (S3: 2 → 3 steps)', r.code === 200 && stepsOf('S3').length === 3, JSON.stringify(r.out && r.out.error));

// ── versions per step: the admin's number ──
resetData();
const withVersions = (k) => { const s = stepsOf('S3'); s[1].config.versions = Array.from({ length: k }, (_, i) => ({ subject: 'Alt ' + i, body: 'An alternative wording number ' + i })); return s; };
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: withVersions(19) }, { id: 'S3' });
step('versions: 20 in all (its own words + 19 more) is allowed at the default ceiling (20)', r.code === 200, JSON.stringify(r.out && r.out.error));
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: withVersions(20) }, { id: 'S3' });
step('…21 in all is refused, in the person\'s words', r.code === 400 && /at most 20 versions/.test(r.out.error), JSON.stringify(r.out));
D.app_settings.push({ key: 'sys_sequence_versions_max@o3', value: '3' });
D.workflow_definitions.push({ id: 'S7', org_id: 'o3', name: 'Small ceiling', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'bd1', version: 1, created_at: '2026-10-01', updated_at: '2026-10-01T00:00:00Z' });
D.workflow_steps.push(...mkSteps('S7', 2).map((s) => ({ ...s, org_id: 'o3' })));
const sm = (k) => { const s = stepsOf('S7'); s[1].config.versions = Array.from({ length: k }, (_, i) => ({ subject: 'A' + i, body: 'An alternative wording number ' + i })); return s; };
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: sm(2) }, { id: 'S7' }, 'o3');
step('the ceiling is the ADMIN\'S setting: 3 in all (own + 2) is fine when the admin chose 3', r.code === 200, JSON.stringify(r.out && r.out.error));
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: sm(3) }, { id: 'S7' }, 'o3');
step('…and a 4th is refused ("at most 3 versions") — this applies to any builder, not only the newer one', r.code === 400 && /at most 3 versions/.test(r.out.error), JSON.stringify(r.out));
const blankV = stepsOf('S7'); blankV[1].config.versions = [{ subject: 'x', body: '   ' }];
r = await call('/wf/definitions/:id', 'put', 'bd1', { steps: blankV }, { id: 'S7' }, 'o3');
step('a version with no text is refused', r.code === 400 && /no text/.test(r.out.error), JSON.stringify(r.out));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
