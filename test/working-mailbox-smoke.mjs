// A LEAD IS NEVER TIED TO A MAILBOX WHOSE SIGN-IN WAS REJECTED (R-399, owner 5 Nov 2026; D-0211, D-0215).
// Ash Sayyad's older mailbox (ash@futeglobal.com) had a stored sign-in Google had rejected. It still counted as "connected", won "primary
// first, else oldest", and three server places SAVE that pick onto a lead — so 20 leads ended up tied to a dead mailbox. One rule now
// (services/working-mailbox.js): connected AND not rejected. It is for NEW choices only; the owner said "absolute no" to rewriting the
// 20 existing leads, so nothing here may touch a lead that is not part of the request.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const W = require('../services/working-mailbox.js');
const RL = require('../services/reminder-lead.js');

const old = { id: 'old', is_active: true, is_primary: false }, fresh = { id: 'new', is_active: true, is_primary: false };
const H = { connected: new Set(['old', 'new']), rejected: new Set(['old']) };
step('rule: the older rejected mailbox is skipped for the healthy one', W.pickWorkingMailbox([old, fresh], H).id === 'new');
step('rule: only a rejected one left → null by default (a lead is not tied to it)', W.pickWorkingMailbox([old], H) === null);
step('rule: …unless the caller wants the honest error (fallbackToRejected) — then it is returned', W.pickWorkingMailbox([old], H, { fallbackToRejected: true }).id === 'old');
step('rule: a mailbox with no stored sign-in, or switched off, is never picked', W.pickWorkingMailbox([{ id: 'x', is_active: true }, { id: 'new', is_active: false }], H) === null);
step('rule: a rejected PRIMARY loses to a healthy non-primary', W.pickWorkingMailbox([{ id: 'old', is_active: true, is_primary: true }, fresh], H).id === 'new');
step('rule: nothing at all → null, never a crash', W.pickWorkingMailbox([], H) === null && W.pickWorkingMailbox(null, null) === null);

// the health loader over the three sign-in tables
const T = { microsoft_tokens: [{ user_email_id: 'ms1', refresh_failed: false }], gmail_tokens: [{ user_email_id: 'g1', refresh_failed: true }, { user_email_id: 'g2', refresh_failed: null }], smtp_credentials: [{ user_email_id: 's1', refresh_failed: false }] };
const q = (name) => { let ids = null; const api = { select() { return api; }, in(_k, v) { ids = v; return api; }, then(a, b) { return Promise.resolve({ data: (T[name] || []).filter((r) => ids.includes(r.user_email_id)), error: null }).then(a, b); } }; return api; };
const hh = await W.loadMailboxHealth({ from: q }, ['ms1', 'g1', 'g2', 's1', 'none']);
step('health: connected = any stored sign-in (Microsoft, Gmail, app-password); rejected = refresh_failed true', ['ms1', 'g1', 'g2', 's1'].every((i) => hh.connected.has(i)) && !hh.connected.has('none') && hh.rejected.has('g1') && !hh.rejected.has('g2') && hh.rejected.size === 1, JSON.stringify([...hh.rejected]));
step('health: a missing smtp table reads as none (never a crash)', (await W.loadMailboxHealth({ from: (n) => (n === 'smtp_credentials' ? { select() { return this; }, in() { return this; }, then(a) { return Promise.resolve({ data: null, error: { message: 'no table' } }).then(a); } } : q(n)) }, ['ms1'])).connected.has('ms1'));

// a lead made from a reminder
step('reminder lead: with health, the mailbox saved on the new lead is the first that can send', RL.mainMailboxId([{ id: 'old', is_primary: true }, { id: 'new' }], H) === 'new');
step('reminder lead: nothing can send → none (they pick at send), not a dead mailbox', RL.mainMailboxId([{ id: 'old', is_primary: true }], H) === null);
step('reminder lead: without health it is the old rule (primary, else first, else none) — nothing else changes', RL.mainMailboxId([{ id: 'm1' }, { id: 'm2', is_primary: true }]) === 'm2' && RL.mainMailboxId([]) === null);

// the REAL bulk-assign route, in Ash's situation
const ORG = 'o1';
const DB = {
  users: [{ id: 'ash', name: 'Ash Sayyad', org_id: ORG, deleted_at: null }],
  user_emails: [
    { id: 'ash-fute', user_id: 'ash', email_address: 'ash@futeglobal.com', is_primary: false, is_active: true, created_at: '2026-10-06T20:25:00Z' },
    { id: 'ash-vhc', user_id: 'ash', email_address: 'ash@vhcstaffing.com', is_primary: false, is_active: true, created_at: '2026-10-07T23:50:00Z' },
  ],
  gmail_tokens: [{ user_email_id: 'ash-fute', refresh_failed: true }, { user_email_id: 'ash-vhc', refresh_failed: false }],
  microsoft_tokens: [], smtp_credentials: [],
  jobs: [
    { id: 'j-new', org_id: ORG, stage: 'Unassigned', sending_email_id: null },
    { id: 'j-old', org_id: ORG, stage: 'Assigned', assigned_to_bd: 'ash', sending_email_id: 'ash-fute' },     // one of the 20: must stay exactly as it is
  ],
};
function table(name) {
  const f = []; let mode = 'select', patch = null;
  const rows = () => (DB[name] || []).filter((r) => f.every((fn) => fn(r)));
  const api = { select() { return api; }, eq(k, v) { f.push((r) => r[k] === v); return api; }, is(k, v) { f.push((r) => (r[k] == null) === (v == null)); return api; },
    in(k, v) { f.push((r) => v.includes(r[k])); return api; }, order() { return api; }, update(p) { mode = 'update'; patch = p; return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    then(a, b) { if (mode === 'update') rows().forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: rows(), error: null }).then(a, b); } };
  return api;
}
const handlerFor = (supabase) => {
  const router = require('../routes/workflows.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: () => true, today: () => '2026-11-05', logActivity: async () => {}, INDUSTRIES: [], normInd: (x) => x,
    userOrgId: async () => ORG, withOrg: (qq) => qq, reportingChainIds: async (id) => new Set([id]) });
  return router.stack.find((l) => l.route && l.route.path === '/jobs/bulk-assign' && l.route.methods.post).route.stack.slice(-1)[0].handle;
};
async function assign(ids) { let out = null, code = 200; const res = { status(s) { code = s; return res; }, json(j) { out = j; return res; } };
  await handlerFor({ from: table })({ user: { id: 'adm', role: 'admin', roles: ['admin'] }, orgId: ORG, body: { job_ids: ids, assigned_to_bd: 'ash' }, query: {}, params: {} }, res); return { code, out }; }
let r = await assign(['j-new']);
step('bulk-assign (Ash: older mailbox rejected, newer healthy): the lead is tied to the HEALTHY mailbox', r.code === 200 && r.out.sending_email_id === 'ash-vhc' && DB.jobs[0].sending_email_id === 'ash-vhc', JSON.stringify(r.out));
step('…and a lead NOT in the request (one of the 20 tied to the dead mailbox) is left exactly as it was — nothing rewrites it', DB.jobs[1].sending_email_id === 'ash-fute' && DB.jobs[1].stage === 'Assigned');
DB.gmail_tokens[1].refresh_failed = true; DB.jobs[0].sending_email_id = null;
r = await assign(['j-new']);
step('only rejected mailboxes → the lead is assigned but NOT tied to a dead mailbox (nothing saved)', r.code === 200 && r.out.sending_email_id === null && DB.jobs[0].sending_email_id === null, JSON.stringify(r.out));

// (source only — index.js cannot be mounted here) the reminder send saves the pick of the shared rule, never "the first row"
const idx = require('fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('(source) the reminder send in index.js saves the mailbox the shared rule picks — never the first row', /workingMailbox\.pickWorkingMailbox\(ue,/.test(idx) && /sending_email_id: pick\.id/.test(idx) && !/sending_email_id: ue\[0\]\.id/.test(idx));
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
