// A MANAGER HANDS UNASSIGNED LEADS OUT, AND A FIRST EMAIL CLAIMS A LEAD (D-0110, R-175)
// The owner (8 Oct): imports land Unassigned; "assign button in the leads tab" — to themselves or anyone under them — and
// "can a user choose how many of the lot should go from each email ID?". Proven here against an in-memory database:
//   * services/lead-claim.js — which leads a first email claims, the mailbox each gets, the claim never taking a lead twice
//   * services/lead-distribution.js allocationQueue — the person's own split adds up exactly, or is refused in words
//   * GET /leads/assign/people + /mailboxes, POST /leads/assign — only me and my team, only unowned leads I can see,
//     only the assignee's connected mailboxes, the explicit split honoured, a race never overwrites an owner, an activity entry
// Usage: node test/lead-assign-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const dist = require('../services/lead-distribution.js');
const claim = require('../services/lead-claim.js');
const ownership = require('../services/ownership.js');

// ── 1. the pure rules ───────────────────────────────────────────────────────
const accs = [{ id: 'A', remaining: 30 }, { id: 'B', remaining: 10 }];
let a = dist.allocationQueue([{ mailbox_id: 'A', count: 7 }, { mailbox_id: 'B', count: 5 }], accs, 12, () => 0.3);
step('a split that adds up gives EXACTLY that many leads to each email ID', a.queue && a.queue.length === 12 && a.queue.filter(x => x === 'A').length === 7 && a.queue.filter(x => x === 'B').length === 5, JSON.stringify(a));
a = dist.allocationQueue([{ mailbox_id: 'A', count: 7 }, { mailbox_id: 'B', count: 4 }], accs, 12);
step('a split that loses a lead is refused, and says how many it gives out', /gives out 11/.test(a.error || ''), a.error);
a = dist.allocationQueue([{ mailbox_id: 'A', count: 13 }], accs, 12);
step('a split that invents a lead is refused too', !!a.error && !a.queue);
a = dist.allocationQueue([{ mailbox_id: 'Z', count: 12 }], accs, 12);
step('an email ID that is not the assignee\'s is refused', /not one of theirs/.test(a.error || ''));
a = dist.allocationQueue([{ mailbox_id: 'A', count: 6 }, { mailbox_id: 'A', count: 6 }], accs, 12);
step('the same email ID twice is refused', /twice/.test(a.error || ''));
a = dist.allocationQueue([{ mailbox_id: 'A', count: 6.5 }, { mailbox_id: 'B', count: 5.5 }], accs, 12);
step('fractions and negatives are refused', !!a.error && !!dist.allocationQueue([{ mailbox_id: 'A', count: -1 }, { mailbox_id: 'B', count: 13 }], accs, 12).error);

const pl = claim.planClaim([{ id: 'j1', assigned_to_bd: null }, { id: 'j2', assigned_to_bd: 'x' }, { id: 'j3' }], accs, '');
step('a first email claims only leads nobody owns — never one that already has an owner', pl.claims.length === 2 && pl.claims.every(c => c.job_id !== 'j2'));
step('a chosen email ID is the one every claimed lead goes from', claim.planClaim([{ id: 'j1' }, { id: 'j3' }], accs, 'B').claims.every(c => c.mailbox_id === 'B'));
const of = claim.ownerFields('u1', 'mbx', '2026-10-08T10:00:00.000Z');
step('a claim writes the owner, the mailbox, the time and the stage "Assigned" — together', of.assigned_to_bd === 'u1' && of.assigned_to === 'u1' && of.sending_email_id === 'mbx' && of.stage === 'Assigned' && of.assigned_at === '2026-10-08T10:00:00.000Z');

// ── 2. an in-memory database ───────────────────────────────────────────────
function makeDb(tables, hooks = {}) {
  const db = { tables, calls: [] };
  db.from = (name) => {
    const filters = []; let mode = 'select', patch = null, limitN = null, row = null, selectAfter = false;
    const apply = () => (tables[name] = tables[name] || []).filter(r => filters.every(f => f(r)));
    const q = {
      select() { if (mode === 'update' || mode === 'insert') selectAfter = true; return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      is(c, v) { filters.push(r => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, list) { filters.push(r => list.includes(r[c])); return q; },
      gte() { return q; }, lt() { return q; }, order() { return q; },
      limit(n) { limitN = n; return q; },
      update(p) { mode = 'update'; patch = p; return q; },
      insert(r) { mode = 'insert'; row = r; return q; },
      upsert(rows, opts) { const t = (tables[name] = tables[name] || []); const k = (opts && opts.onConflict) || 'key'; for (const r of [].concat(rows)) { const i = t.findIndex(x => x[k] === r[k]); if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r }); } return Promise.resolve({ error: null }); },
      maybeSingle: async () => ({ data: apply()[0] || null, error: null }),
      then(res, rej) {
        let out;
        if (mode === 'update') { const hit = apply(); hit.forEach(r => Object.assign(r, patch)); out = { data: selectAfter ? hit.map(r => ({ id: r.id })) : null, error: null }; }
        else if (mode === 'insert') { const rows = (Array.isArray(row) ? row : [row]).map((r, i) => ({ id: r.id || `${name}-${(tables[name] || []).length + i + 1}`, ...r })); (tables[name] = tables[name] || []).push(...rows); out = { data: selectAfter ? rows.map(r => ({ id: r.id })) : null, error: null }; }
        else { let d = apply(); if (limitN) d = d.slice(0, limitN); if (name === 'jobs' && hooks.afterPoolRead) { const snap = d.map(x => ({ ...x })); hooks.afterPoolRead(tables); d = snap; } out = { data: d, error: null }; }
        db.calls.push([name, mode]); return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };
  return db;
}

const mk = () => ({
  users: [
    { id: 'boss', name: 'Bo Manager', role: 'bd_lead', roles: ['bd_lead'], manager_id: null, deleted_at: null },
    { id: 'amy', name: 'Amy Rep', role: 'bd', roles: ['bd'], manager_id: 'boss', deleted_at: null },
    { id: 'cal', name: 'Cal Deep', role: 'bd', roles: ['bd'], manager_id: 'amy', deleted_at: null },
    { id: 'zed', name: 'Zed Other', role: 'bd', roles: ['bd'], manager_id: null, deleted_at: null },
    { id: 'nomail', name: 'Nia NoMail', role: 'bd', roles: ['bd'], manager_id: 'boss', deleted_at: null },
  ],
  user_emails: [
    { id: 'b1', user_id: 'boss', email_address: 'bo@x.test', is_active: true, daily_send_limit: 100 },
    { id: 'a1', user_id: 'amy', email_address: 'amy@co-a.test', is_active: true, daily_send_limit: 100 },
    { id: 'a2', user_id: 'amy', email_address: 'amy@co-b.test', is_active: true, daily_send_limit: 50 },
    { id: 'c1', user_id: 'cal', email_address: 'cal@x.test', is_active: true, daily_send_limit: 100 },
    { id: 'z1', user_id: 'zed', email_address: 'zed@x.test', is_active: true, daily_send_limit: 100 },
    { id: 'n1', user_id: 'nomail', email_address: 'nia@x.test', is_active: true, daily_send_limit: 100 },
  ],
  microsoft_tokens: [{ user_email_id: 'b1', refresh_failed: false }, { user_email_id: 'a1', refresh_failed: false }, { user_email_id: 'c1', refresh_failed: false }, { user_email_id: 'z1', refresh_failed: false }, { user_email_id: 'n1', refresh_failed: true }],
  gmail_tokens: [{ user_email_id: 'a2', refresh_failed: false }],
  email_send_log: [{ user_email_id: 'a1', emails_sent: 30, send_date: '2026-10-08' }],
  jobs: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'imp' + i, stage: 'Unassigned', assigned_to_bd: null, assigned_to: null, created_by: 'boss', deleted_at: null, is_duplicate: false })),
    { id: 'theirs', stage: 'Assigned', assigned_to_bd: 'zed', assigned_to: 'zed', created_by: 'boss', deleted_at: null, is_duplicate: false },
    { id: 'pool', stage: 'Unassigned', assigned_to_bd: null, created_by: 'someone-else', deleted_at: null, is_duplicate: false },
    { id: 'dup', stage: 'Unassigned', assigned_to_bd: null, created_by: 'boss', deleted_at: null, is_duplicate: true },
  ],
});
const hasRole = (req, ...roles) => (req.user.roles || []).some(r => roles.includes(r));
const chainOf = (tables) => async (uid) => { const out = new Set([uid]); let grew = true; while (grew) { grew = false; tables.users.forEach(u => { if (u.manager_id && out.has(u.manager_id) && !out.has(u.id)) { out.add(u.id); grew = true; } }); } return [...out]; };
const handlerOf = (router, p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const logs = [];
let tables = mk(), db = makeDb(tables);
const ctx = () => ({ supabase: db, auth: (_a, _b, n) => n(), hasRole, today: () => '2026-10-08', withOrg: (q) => q, orgIdFor: () => 'o1', reportingChainIds: chainOf(tables), ownership, logActivity: async (...x) => { logs.push(x); } });
let router = require('../routes/lead-assign.js')(ctx());
const call = async (p, m, user, body, query) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } };
  await handlerOf(router, p, m)({ user: Object.assign({ id: 'boss', name: 'Bo Manager', roles: ['bd_lead'], role: 'bd_lead' }, user), orgId: 'o1', body, query: query || {} }, res); return { code, out }; };

// ── 3. who I may hand leads to ─────────────────────────────────────────────
let r = await call('/leads/assign/people', 'get', {});
const ids = (r.out.people || []).map(p => p.id);
step('a manager is offered themselves first, then everyone under them (any depth) — nobody outside their team', ids[0] === 'boss' && ids.includes('amy') && ids.includes('cal') && ids.includes('nomail') && !ids.includes('zed'), ids.join(','));
step('…and each person says how many email IDs they have (so one with none can be greyed out)', r.out.people.find(p => p.id === 'amy').mailboxes === 2);
r = await call('/leads/assign/people', 'get', { id: 'x', roles: ['recruiter'], role: 'recruiter' });
step('a recruiter has no Assign at all', r.code === 403);
r = await call('/leads/assign/people', 'get', { id: 'adm', roles: ['admin'], role: 'admin' });
step('an admin may hand leads to anyone in the company', (r.out.people || []).some(p => p.id === 'zed') && (r.out.people || []).length === 5);

r = await call('/leads/assign/mailboxes', 'get', {}, null, { user_id: 'amy' });
step('a team member\'s connected email IDs come with today\'s room on each', r.out.mailboxes.length === 2 && r.out.mailboxes.find(m => m.id === 'a1').room === 70 && r.out.mailboxes.find(m => m.id === 'a2').room === 50, JSON.stringify(r.out));
r = await call('/leads/assign/mailboxes', 'get', {}, null, { user_id: 'zed' });
step('someone outside my team is not even revealed (404)', r.code === 404);
r = await call('/leads/assign/mailboxes', 'get', {}, null, { user_id: 'nomail' });
step('a person whose only email ID is broken says so, in words', r.out.mailboxes.length === 0 && /connected and working|connected, working/.test(r.out.error || ''), r.out.error);

// ── 4. handing leads out ───────────────────────────────────────────────────
const imp = Array.from({ length: 12 }, (_, i) => 'imp' + i);
r = await call('/leads/assign', 'post', {}, { job_ids: imp, to_user_id: 'zed' });
step('a manager cannot hand leads to someone outside their team', r.code === 403 && tables.jobs.filter(j => j.assigned_to_bd).length === 1);
r = await call('/leads/assign', 'post', {}, { job_ids: imp, to_user_id: 'nomail' });
step('…nor to a person with no working email ID — and nothing is assigned', r.code === 400 && /Nothing was assigned/.test(r.out.error) && tables.jobs.filter(j => j.assigned_to_bd).length === 1, r.out.error);
r = await call('/leads/assign', 'post', {}, { job_ids: imp, to_user_id: 'amy', allocation: [{ mailbox_id: 'a1', count: 7 }, { mailbox_id: 'a2', count: 4 }] });
step('a split that does not add up is refused and NOTHING is assigned', r.code === 400 && /gives out 11/.test(r.out.error) && tables.jobs.filter(j => j.assigned_to_bd).length === 1, r.out.error);
r = await call('/leads/assign', 'post', {}, { job_ids: imp, to_user_id: 'amy', allocation: [{ mailbox_id: 'b1', count: 12 }] });
step('a split naming someone else\'s email ID is refused', r.code === 400 && /not one of theirs/.test(r.out.error));
r = await call('/leads/assign', 'post', {}, { job_ids: imp.concat(['theirs', 'pool', 'dup']), to_user_id: 'amy', allocation: [{ mailbox_id: 'a1', count: 7 }, { mailbox_id: 'a2', count: 5 }] });
const mine = tables.jobs.filter(j => j.assigned_to_bd === 'amy');
step('the manager\'s own split is honoured: 7 from one email ID, 5 from the other', r.code === 200 && r.out.assigned === 12 && mine.filter(j => j.sending_email_id === 'a1').length === 7 && mine.filter(j => j.sending_email_id === 'a2').length === 5, JSON.stringify(r.out));
step('each handed lead is Assigned, owned by the assignee, time-stamped', mine.length === 12 && mine.every(j => j.stage === 'Assigned' && j.assigned_to === 'amy' && j.assigned_at));
step('a lead that ALREADY had an owner, a pool lead the manager cannot see, and a flagged duplicate were left alone and counted as skipped', tables.jobs.find(j => j.id === 'theirs').assigned_to_bd === 'zed' && !tables.jobs.find(j => j.id === 'pool').assigned_to_bd && !tables.jobs.find(j => j.id === 'dup').assigned_to_bd && r.out.skipped === 3, JSON.stringify([r.out.skipped, r.out.message]));
step('every hand-over is written in the lead\'s own history, saying who gave it to whom', logs.filter(l => l[3] === 'assigned').length === 12 && /Bo Manager to Amy Rep/.test(logs.find(l => l[3] === 'assigned')[4]), logs[0] && logs[0][4]);
step('the answer says how many went from each email ID', r.out.by_mailbox.find(m => m.mailbox_id === 'a1').count === 7);

// automatic spread, to myself, and a race
tables = mk(); db = makeDb(tables); router = require('../routes/lead-assign.js')(ctx());
r = await call('/leads/assign', 'post', {}, { job_ids: imp.slice(0, 6), to_user_id: 'boss' });
step('with no split chosen the automatic spread is used (here: to myself, my only email ID)', r.out.assigned === 6 && tables.jobs.filter(j => j.assigned_to_bd === 'boss').every(j => j.sending_email_id === 'b1'));
tables = mk(); db = makeDb(tables, { afterPoolRead: (t) => { const x = t.jobs.find(j => j.id === 'imp0'); x.assigned_to_bd = 'zed'; x.stage = 'Assigned'; } }); router = require('../routes/lead-assign.js')(ctx());
r = await call('/leads/assign', 'post', {}, { job_ids: imp.slice(0, 4), to_user_id: 'amy' });
step('RACE: a lead handed to someone else a moment ago is NOT taken from them; the rest are assigned and the answer says so', tables.jobs.find(j => j.id === 'imp0').assigned_to_bd === 'zed' && r.out.assigned === 3 && r.out.lead === undefined, JSON.stringify(r.out));

// ── 5. the first email claims the lead (what POST /emails/generate does through services/lead-claim.js) ──
tables = mk(); db = makeDb(tables, { afterPoolRead: null });
const plan = claim.planClaim(tables.jobs.filter(j => /^imp[0-3]$/.test(j.id)), [{ id: 'a1', remaining: 70 }, { id: 'a2', remaining: 50 }], 'a2');
tables.jobs.find(j => j.id === 'imp1').assigned_to_bd = 'zed';   // somebody else got imp1 between planning and writing
const done = await claim.applyClaims({ jobsTable: () => db.from('jobs'), claims: plan.claims, withEmail: new Set(['imp0', 'imp1', 'imp2']), userId: 'amy', now: new Date('2026-10-08T10:00:00Z') });
step('only leads that really got an email are claimed (imp3 had none and stays Unassigned)', done.claimed.includes('imp0') && done.claimed.includes('imp2') && tables.jobs.find(j => j.id === 'imp3').stage === 'Unassigned');
step('a claimed lead is the writer\'s, in the chosen email ID, stage Assigned', ['imp0', 'imp2'].every(id => { const j = tables.jobs.find(x => x.id === id); return j.assigned_to_bd === 'amy' && j.sending_email_id === 'a2' && j.stage === 'Assigned'; }));
step('a lead somebody else owns by then is NOT taken, and is reported so its email can be dropped', done.lost.includes('imp1') && tables.jobs.find(j => j.id === 'imp1').assigned_to_bd === 'zed');

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
