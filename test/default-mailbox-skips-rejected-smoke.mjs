// A MAILBOX GOOGLE HAS REJECTED MUST NOT BE THE DEFAULT SENDER (R-394, owner 4 Nov 2026: Ash had two Gmail mailboxes, neither marked
// primary; the app picked the OLDER one, ash@futeglobal.com, whose sign-in Google had rejected ("invalid_grant"), so every send said
// "Gmail token refresh failed: Bad Request" while his other mailbox, ash@vhcstaffing.com, was healthy and has its own signature).
// The rule: the default is the first mailbox whose sign-in WORKS; a rejected one is still LISTED (marked needs_reconnect) and is the
// default only when nothing healthy is left — so a person with nothing healthy still gets the honest error, not a silent "no mailbox".
// The real router is mounted against a fake database (the same way test/from-mailbox-smoke.mjs does).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', ASH = 'u-ash', SOLO = 'u-solo', PRIM = 'u-prim';
const D = {
  user_emails: [
    // Ash: neither primary; the OLDER one (futeglobal) is the one with the rejected sign-in
    { id: 'ash-fute', user_id: ASH, org_id: ORG, email_address: 'ash@futeglobal.com', display_name: 'Ash Sayyad', is_primary: false, is_active: true, platform: 'Gmail', created_at: '2026-10-06T20:25:00Z' },
    { id: 'ash-vhc', user_id: ASH, org_id: ORG, email_address: 'ash@vhcstaffing.com', display_name: 'Ash Sayyad', is_primary: false, is_active: true, platform: 'Gmail', created_at: '2026-10-07T23:50:00Z' },
    // a person whose ONLY mailbox is rejected
    { id: 'solo-1', user_id: SOLO, org_id: ORG, email_address: 'solo@x.test', display_name: 'Solo', is_primary: true, is_active: true, platform: 'Gmail', created_at: '2026-10-01T00:00:00Z' },
    // a person whose PRIMARY is rejected and a non-primary one is healthy
    { id: 'prim-bad', user_id: PRIM, org_id: ORG, email_address: 'p1@x.test', display_name: 'P1', is_primary: true, is_active: true, platform: 'Microsoft', created_at: '2026-10-01T00:00:00Z' },
    { id: 'prim-ok', user_id: PRIM, org_id: ORG, email_address: 'p2@x.test', display_name: 'P2', is_primary: false, is_active: true, platform: 'Gmail', created_at: '2026-10-02T00:00:00Z' },
  ],
  gmail_tokens: [
    { user_email_id: 'ash-fute', refresh_failed: true }, { user_email_id: 'ash-vhc', refresh_failed: false }, { user_email_id: 'solo-1', refresh_failed: true },
    { user_email_id: 'prim-ok', refresh_failed: null },
  ],
  microsoft_tokens: [{ user_email_id: 'prim-bad', refresh_failed: true }],
};
function table(name) {
  const st = { f: [] };
  const rows = () => (D[name] || []).filter(r => st.f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : true));
  const api = { select() { return api; }, eq(k, v) { st.f.push(['eq', k, v]); return api; }, in(k, v) { st.f.push(['in', k, v]); return api; }, order() { return api; }, limit() { return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); }, single() { const r = rows()[0]; return Promise.resolve({ data: r || null, error: r ? null : { message: 'none' } }); },
    then(a, b) { return Promise.resolve({ data: rows(), error: null }).then(a, b); } };
  return api;
}
const handlers = {};
const app = new Proxy({}, { get: (_t, verb) => (path, ...fns) => { handlers[verb.toUpperCase() + ' ' + path] = fns[fns.length - 1]; } });
require('../routes/recruiting/outreach.js')(app, {
  supabase: { from: table }, auth: (_q, _s, n) => n(), hasRole: () => true, today: () => '2026-11-04', wfEngine: { registerChannel() {}, registerContextLoader() {}, exitEntity() {} },
  gmailProvider: {}, config: {}, settingsConfig: { getSetting: async () => 0 }, graphMailRequest: async () => ({}), sendMicrosoftNewMessage: async () => ({}),
  buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '', getMicrosoftToken: async () => 't', warmupLimit: () => 999, isSendingPaused: () => false,
  isManagerPaused: () => false, loadMailboxDelivState: async () => ({}), loadSuppressedSet: async () => new Set(), friendlySendError: (e) => String(e && e.message || e),
});
async function list(userId) {
  let out = null; const res = { status() { return res; }, json(j) { out = j; return res; } };
  await handlers['GET /me/sending-mailboxes']({ user: { id: userId, roles: ['bd'] }, orgId: ORG, query: {}, body: {}, params: {} }, res);
  return out;
}

const ash = await list(ASH);
step('Ash (two Gmail mailboxes, neither primary): the default is the HEALTHY one, not the older rejected one', ash.default_id === 'ash-vhc', 'default ' + ash.default_id);
step('…both are still listed (he should see the broken one)', ash.mailboxes.length === 2);
step('…the rejected one is marked needs_reconnect, the healthy one is not', ash.mailboxes.find(m => m.id === 'ash-fute').needs_reconnect === true && ash.mailboxes.find(m => m.id === 'ash-vhc').needs_reconnect === false, JSON.stringify(ash.mailboxes.map(m => [m.email, m.needs_reconnect])));

const solo = await list(SOLO);
step('a person whose ONLY mailbox is rejected still gets it as the default (the honest "token refresh failed", not a silent "no mailbox")', solo.default_id === 'solo-1' && solo.mailboxes[0].needs_reconnect === true, JSON.stringify(solo));

const prim = await list(PRIM);
step('a rejected PRIMARY loses to a healthy non-primary mailbox', prim.default_id === 'prim-ok' && prim.mailboxes.find(m => m.id === 'prim-bad').needs_reconnect === true, JSON.stringify(prim));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
