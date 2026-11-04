// THE "ADD EVERYONE TO A SEQUENCE" LIST SHOWS ONLY WHAT YOU MAY USE (R-395, owner 4 Nov 2026: Ash Sayyad, who had made no sequence, was
// offered "Standard Sales Outreach" (built in, no owner) and "New Sequence test_2" (BD Lead 1's)).  The Sequences page already follows
// D-0113 — a person starts BLANK and sees their own; this makes the Compose dropdown and the send follow it too:
//   * GET /outreach/sequences — a plain BD gets only their own (nothing, if they have none); a BD lead / admin gets every sequence
//   * POST /outreach/send with a sequence you may not use — refused 404 BEFORE anything is sent (it would enrol a lead in someone
//     else's wording); with your own, it gets past that check
// Plus the pure rule (services/sequence-visibility.js).  The two enrol doors are covered in test/sequence-own-smoke.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };
const V = require('../services/sequence-visibility.js');

const ASH = { id: 'ash', role: 'bd', roles: ['bd'] }, BOSS = { id: 'boss', role: 'bd_lead', roles: ['bd_lead'] }, ADM = { id: 'adm', role: 'admin', roles: ['admin'] }, RA = { id: 'ra1', role: 'ra', roles: ['ra'] };
const STD = { id: 'std', created_by: null }, BOSS_SEQ = { id: 'b1', created_by: 'boss' }, ASH_SEQ = { id: 'a1', created_by: 'ash' };
step('rule: a plain BD may use only their own', V.mayUseSequence(ASH_SEQ, ASH) && !V.mayUseSequence(BOSS_SEQ, ASH) && !V.mayUseSequence(STD, ASH));
step('rule: the built-in (ownerless) sequence is nobody\'s own — not even a stray "undefined === undefined"', !V.mayUseSequence({ id: 'x' }, { id: undefined, roles: ['bd'] }) && !V.mayUseSequence(STD, { id: null, roles: ['bd'] }));
step('rule: a BD lead and an admin may use any', V.mayUseSequence(STD, BOSS) && V.mayUseSequence(ASH_SEQ, BOSS) && V.mayUseSequence(BOSS_SEQ, ADM));
step('rule: a role that does not design sequences (RA) sees only their own — i.e. none of these', V.visibleSequences([STD, BOSS_SEQ, ASH_SEQ], RA).length === 0);
step('rule: no sequence, or no user, is never usable', !V.mayUseSequence(null, ADM) && !V.mayUseSequence(ASH_SEQ, null));

// ── the real generator router against a small fake database ──
const ORG = 'o1';
const DEFS = [
  { id: 'std', org_id: ORG, name: 'Standard Sales Outreach', domain: 'sales', entity_type: 'contact', status: 'active', created_by: null,
    workflow_steps: [1, 2, 3, 4].map((i) => ({ step_order: i, name: 's' + i, channel: 'email', delay_days: i })) },
  { id: 'b1', org_id: ORG, name: 'New Sequence test_2', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'boss',
    workflow_steps: [1, 2].map((i) => ({ step_order: i, name: 's' + i, channel: 'email', delay_days: i })) },
  { id: 'a1', org_id: ORG, name: 'Ash own', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'ash',
    workflow_steps: [1, 2, 3].map((i) => ({ step_order: i, name: 's' + i, channel: 'email', delay_days: i })) },
];
function table(name) {
  const f = [];
  const rows = () => (name === 'workflow_definitions' ? DEFS : []).filter((r) => f.every((fn) => fn(r)));
  const api = { select() { return api; }, eq(k, v) { f.push((r) => r[k] === v); return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    then(a, b) { return Promise.resolve({ data: rows(), error: null }).then(a, b); } };
  return api;
}
const calls = { mailbox: 0, sent: 0 };
const router = require('../routes/outreach-generator.js')({
  supabase: { from: table }, auth: (_q, _s, n) => n(), today: () => '2026-11-04', buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '',
  loadSuppressedSet: async () => new Set(), recruiterSendingMailbox: async () => ({ id: 'mb', email_address: 'a@x.test', platform: 'Gmail' }),
  sendMailboxNewMessage: async () => { calls.sent++; return {}; }, sendingMailboxFor: async () => { calls.mailbox++; return { id: 'mb', email_address: 'a@x.test', platform: 'Gmail' }; },
  ownSendingMailboxes: async () => [], withOrg: (q, req) => (req.orgId ? q.eq('org_id', req.orgId) : q), orgStamp: () => ({}), logActivity() {},
  wfEngine: { enroll: async () => ({ id: 'en' }) }, hasRole: (req, ...r) => r.some((x) => (req.user.roles || []).includes(x)), orgIdFor: () => ORG, canTouchJob: async () => true,
});
const handler = (p, m) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
async function call(p, m, user, body) {
  let code = 200, out = null; const res = { status(s) { code = s; return res; }, json(j) { out = j; return res; } };
  await handler(p, m)({ user, orgId: ORG, body: body || {}, query: {}, params: {}, headers: {} }, res); return { code, out };
}

let r = await call('/outreach/sequences', 'get', ASH);
step('the dropdown for Ash shows ONLY his own — not the built-in one, not BD Lead 1\'s', r.code === 200 && r.out.length === 1 && r.out[0].id === 'a1', JSON.stringify((r.out || []).map((x) => x.name)));
DEFS.splice(DEFS.findIndex((d) => d.id === 'a1'), 1);                       // Ash with NO sequence at all
r = await call('/outreach/sequences', 'get', ASH);
step('…with no sequence of his own the list is empty (the screen then asks him to create one)', r.code === 200 && r.out.length === 0, JSON.stringify(r.out));
DEFS.push({ id: 'a1', org_id: ORG, name: 'Ash own', domain: 'sales', entity_type: 'contact', status: 'active', created_by: 'ash', workflow_steps: [1, 2, 3].map((i) => ({ step_order: i, name: 's' + i, channel: 'email', delay_days: i })) });
r = await call('/outreach/sequences', 'get', ASH);
step('…once he makes one, he sees exactly that one', r.out.length === 1 && r.out[0].id === 'a1' && r.out[0].steps === 3, JSON.stringify(r.out.map((x) => x.name)));
r = await call('/outreach/sequences', 'get', BOSS);
step('a BD lead sees every active sequence, as on the Sequences page', r.out.length === 3, JSON.stringify(r.out.map((x) => x.name)));
r = await call('/outreach/sequences', 'get', ADM);
step('an admin too', r.out.length === 3);

const SEND = (seq) => ({ to: 'kev@x.test', subject: 'Hi', body: 'Hello', sequence_id: seq });
calls.mailbox = 0; calls.sent = 0;
r = await call('/outreach/send', 'post', ASH, SEND('b1'));
step('SEND into BD Lead 1\'s sequence is refused 404 — and nothing was sent, no mailbox was even chosen', r.code === 404 && /not one you can use/.test((r.out || {}).error || '') && calls.mailbox === 0 && calls.sent === 0, JSON.stringify(r) + ' ' + JSON.stringify(calls));
r = await call('/outreach/send', 'post', ASH, SEND('std'));
step('…and into the built-in one', r.code === 404 && calls.sent === 0);
r = await call('/outreach/send', 'post', ASH, SEND('does-not-exist'));
step('…a sequence that does not exist answers the same (nothing says which ones are real)', r.code === 404 && calls.sent === 0);
calls.mailbox = 0;
r = await call('/outreach/send', 'post', ASH, SEND('a1'));
step('SEND into his OWN sequence gets past the check (it goes on to choose the mailbox)', calls.mailbox === 1, JSON.stringify(r));
calls.mailbox = 0;
r = await call('/outreach/send', 'post', BOSS, SEND('a1'));
step('a BD lead may still use any', calls.mailbox === 1);
calls.mailbox = 0;
r = await call('/outreach/send', 'post', ASH, SEND(''));
step('sending with NO sequence is unchanged', calls.mailbox === 1);

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
