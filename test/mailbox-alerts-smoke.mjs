// R-037 — a dead mailbox sign-in is put in front of the person who can fix it.
//   * the rule: which mailboxes warrant a warning, and what it says — the
//     LIVE Microsoft error of 2026-09-26 (AADSTS65001) becomes a sentence;
//   * a guess is never stated as a certainty ("probably");
//   * Gmail now RECORDS a failed refresh (it never did) and a success clears
//     it; a Google outage is not recorded as a dead sign-in;
//   * GET /mailboxes/alerts: yours; your reports' for a manager; the company's
//     for admin; never another organisation's; mail waiting counted by the
//     send loop's own rule (override mailbox, else the lead's).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ma = require('../services/mailbox-alerts.js');
const health = require('../mailbox-health.js');

// ── the rule ───────────────────────────────────────────────────────────────
const LIVE = "invalid_grant: AADSTS65001: The user or administrator has not consented to use the application with ID 'a787…'";
let s = ma.reasonSentence('microsoft', LIVE);
step('the live Microsoft error becomes a plain sentence', /Microsoft withdrew PACE's permission/.test(s) && !/AADSTS/.test(s), s);
s = ma.reasonSentence('gmail', 'invalid_grant: Token has been expired or revoked.');
step('Google\'s 7-day testing expiry is named', /7 days/.test(s) && /Google/.test(s), s);
step('an unknown error still reads as an instruction', /reconnect/.test(ma.reasonSentence('gmail', 'something odd')));

const mb = { id: 'm1', email_address: 'a@x.com', is_active: true, platform: 'Microsoft' };
const now = Date.now();
const certain = health.deriveTokenStatus({ expires_at: new Date(now - 864e5).toISOString(), refresh_failed: true, last_refresh_error: LIVE, last_refresh_at: new Date().toISOString(), updated_at: '2026-07-21T22:16:55Z' });
const guessed = health.deriveTokenStatus({ expires_at: new Date(now - 864e5).toISOString(), refresh_failed: null });
const fine = health.deriveTokenStatus({ expires_at: new Date(now + 36e5).toISOString(), refresh_failed: false });
let a = ma.alertFor({ mailbox: mb, conn: Object.assign({ platform: 'microsoft' }, certain), held: 3 });
step('"last worked" is the last SUCCESS, never the last failed attempt', a && a.since === '2026-07-21T22:16:55Z', a && a.since);
step('a RECORDED failure is a certain alert with the reason', a && a.state === 'failed' && a.held === 3 && /withdrew/.test(a.sentence));
a = ma.alertFor({ mailbox: mb, conn: Object.assign({ platform: 'gmail' }, guessed) });
step('a stale expiry with no record is only "probably"', a && a.state === 'probably_expired' && /probably/.test(a.sentence));
step('a healthy mailbox raises nothing', ma.alertFor({ mailbox: mb, conn: Object.assign({ platform: 'gmail' }, fine) }) === null);
step('a switched-off mailbox raises nothing', ma.alertFor({ mailbox: Object.assign({}, mb, { is_active: false }), conn: Object.assign({}, certain) }) === null);
step('a never-connected spare slot raises nothing', ma.alertFor({ mailbox: mb, conn: { connected: false, status: 'none' }, held: 0 }) === null);
a = ma.alertFor({ mailbox: mb, conn: { connected: false, status: 'none' }, held: 2 });
step('…but a never-connected mailbox with mail waiting does, with its provider', a && a.state === 'not_connected' && a.platform === 'microsoft');
const sorted = ma.sortAlerts([{ state: 'probably_expired', email: 'z' }, { state: 'failed', email: 'b', held: 1 }, { state: 'failed', email: 'a', held: 9 }]);
step('most urgent first', sorted.map(x => x.email).join('') === 'abz');

// ── Gmail records its refresh outcome ─────────────────────────────────────
{
  const updates = [];
  let tokenRow = { user_email_id: 'g1', access_token: 'old', refresh_token: 'r', expires_at: new Date(now - 1000).toISOString() };
  const fakeSb = { from: (t) => {
    const api = { _upd: null,
      select() { return api; }, eq() { return api; },
      update(p) { api._upd = p; updates.push({ t, p }); return api; },
      async single() { return { data: tokenRow, error: null }; },
      then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); } };
    return api; } };
  let answer = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: answer.error ? false : true, status: answer.error ? 400 : 200, json: async () => answer, headers: { get: () => null } });
  const { createGmailProvider } = require('../gmail-provider.js');
  const gp = createGmailProvider({ supabase: fakeSb, google: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' } });
  let threw = false;
  try { await gp.listMessages('g1', {}); } catch (e) { threw = /refresh failed/.test(e.message); }
  const rec = updates.find(u => u.t === 'gmail_tokens' && 'refresh_failed' in u.p);
  step('a dead Google sign-in throws as before…', threw);
  step('…and is now RECORDED on the token row (it never was)', rec && rec.p.refresh_failed === true && /invalid_grant/.test(rec.p.last_refresh_error), JSON.stringify(rec && rec.p));
  updates.length = 0; answer = { error: 'temporarily_unavailable' };
  try { await gp.listMessages('g1', {}); } catch (_) {}
  step('a Google outage is NOT recorded as a dead sign-in', !updates.some(u => u.p.refresh_failed === true));
  updates.length = 0; answer = { access_token: 'new', expires_in: 3600 };
  try { await gp.listMessages('g1', {}); } catch (_) {}
  step('a successful refresh clears the flag', updates.some(u => u.p.refresh_failed === false));
  globalThis.fetch = realFetch;
}

// ── the route ─────────────────────────────────────────────────────────────
const T = {
  users: [
    { id: 'u-mgr', org_id: 'o1', manager_id: null, name: 'Mona', deleted_at: null },
    { id: 'u-rep', org_id: 'o1', manager_id: 'u-mgr', name: 'Raj', deleted_at: null },
    { id: 'u-peer', org_id: 'o1', manager_id: null, name: 'Pat', deleted_at: null },
    { id: 'u-x', org_id: 'o2', manager_id: null, name: 'Other', deleted_at: null },
  ],
  user_emails: [
    { id: 'mb-mgr', org_id: 'o1', user_id: 'u-mgr', email_address: 'mona@a.com', is_active: true, platform: 'Gmail' },
    { id: 'mb-rep', org_id: 'o1', user_id: 'u-rep', email_address: 'raj@a.com', is_active: true, platform: 'Microsoft' },
    { id: 'mb-peer', org_id: 'o1', user_id: 'u-peer', email_address: 'pat@a.com', is_active: true, platform: 'Gmail' },
    { id: 'mb-x', org_id: 'o2', user_id: 'u-x', email_address: 'x@b.com', is_active: true, platform: 'Gmail' },
  ],
  microsoft_tokens: [{ user_email_id: 'mb-rep', expires_at: new Date(now - 864e5).toISOString(), refresh_failed: true, last_refresh_error: LIVE, last_refresh_at: new Date().toISOString() }],
  gmail_tokens: [
    { user_email_id: 'mb-mgr', expires_at: new Date(now + 36e5).toISOString(), refresh_failed: false },
    { user_email_id: 'mb-peer', expires_at: new Date(now - 864e5).toISOString(), refresh_failed: true, last_refresh_error: 'invalid_grant' },
    { user_email_id: 'mb-x', expires_at: new Date(now - 864e5).toISOString(), refresh_failed: true, last_refresh_error: 'invalid_grant' },
  ],
  jobs: [{ id: 'j1', org_id: 'o1', sending_email_id: 'mb-rep', deleted_at: null }, { id: 'j2', org_id: 'o1', sending_email_id: 'mb-peer', deleted_at: null }],
  emails: [
    { id: 'e1', org_id: 'o1', status: 'pending', job_id: 'j1', sending_email_id: null },
    { id: 'e2', org_id: 'o1', status: 'pending', job_id: 'j1', sending_email_id: null },
    { id: 'e3', org_id: 'o1', status: 'pending', job_id: 'j1', sending_email_id: 'mb-mgr' },   // override: NOT behind mb-rep
    { id: 'e4', org_id: 'o1', status: 'sent', job_id: 'j1', sending_email_id: null },
    { id: 'e5', org_id: 'o1', status: 'pending', job_id: null, sending_email_id: 'mb-rep' },
  ],
};
function q(table) {
  const f = [];
  const api = {
    select() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
    is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    then(res, rej) { return Promise.resolve({ data: (T[table] || []).filter(r => f.every(fn => fn(r))), error: null }).then(res, rej); },
  };
  return api;
}
const router = require('../routes/mailbox-alerts.js')({ supabase: { from: q }, auth: (_a, _b, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r) });
const h = router.stack.find(l => l.route && l.route.path === '/mailboxes/alerts').route.stack.slice(-1)[0].handle;
const call = async (user) => { let out; const res = { status() { return res; }, json(j) { out = j; return res; } }; await h({ user, orgId: user.org_id }, res); return out; };

let r = await call({ id: 'u-rep', roles: ['bd'], org_id: 'o1' });
step('the owner sees their own dead mailbox, with a Reconnect', r.alerts.length === 1 && r.alerts[0].email === 'raj@a.com' && r.alerts[0].is_owner === true, JSON.stringify(r.alerts.map(a => a.email)));
step('mail behind it is counted by the send loop\'s rule (lead\'s mailbox, or its own override)', r.alerts[0].held === 3, String(r.alerts[0].held));
r = await call({ id: 'u-mgr', roles: ['bd_lead'], org_id: 'o1' });
step('a manager sees their report\'s dead mailbox, as "ask Raj"', r.alerts.length === 1 && r.alerts[0].owner_name === 'Raj' && r.alerts[0].is_owner === false);
step('…but not a peer\'s outside their chain', !r.alerts.some(a => a.email === 'pat@a.com'));
r = await call({ id: 'u-adm', roles: ['admin'], org_id: 'o1' });
step('admin sees every dead mailbox in the company', r.alerts.map(a => a.email).sort().join() === 'pat@a.com,raj@a.com');
step('…and never another organisation\'s', !r.alerts.some(a => a.email === 'x@b.com'));
step('a certain failure sorts above the rest', r.alerts[0].state === 'failed');

// ── HIDING A WARNING + ASKING THE OWNER (R-122 step 3) ───────────────────────
// The rules are plain functions (no source-grep): hidden for a week against the
// FACT it was hidden against; per person; counted; and "who may ask whom".
{
  const t0 = Date.parse('2026-10-06T12:00:00Z');
  const al = { mailbox_id: 'mb1', state: 'failed', since: '2026-07-21T22:16:55Z' };
  let st = ma.recordHide({}, al, t0);
  step('a hidden warning is hidden now…', ma.isHidden(st, al, t0 + 1000));
  step('…for a week, not forever', ma.isHidden(st, al, t0 + 6.9 * 864e5) && !ma.isHidden(st, al, t0 + 7.1 * 864e5));
  step('…and comes straight back if the mailbox fails in a NEW way (state or last-worked date changes)',
    !ma.isHidden(st, { ...al, state: 'probably_expired' }, t0 + 1000) && !ma.isHidden(st, { ...al, since: '2026-10-01T00:00:00Z' }, t0 + 1000));
  step('hiding one mailbox hides no other', !ma.isHidden(st, { ...al, mailbox_id: 'mb2' }, t0 + 1000));
  const ap = ma.applyHidden([al, { ...al, mailbox_id: 'mb2' }], st, t0 + 1000);
  step('what is hidden is COUNTED, never silently dropped', ap.alerts.length === 1 && ap.hidden === 1 && ap.alerts[0].mailbox_id === 'mb2');
  step('an expired entry is pruned on the next write (the row cannot grow without bound)', Object.keys(ma.recordHide(st, { ...al, mailbox_id: 'mb3' }, t0 + 8 * 864e5)).join() === 'mb3');
  step('nobody may ask themselves, a peer, or ask about an unowned mailbox',
    /own mailbox/.test(ma.askRefusal({ askerId: 'a', ownerId: 'a', chainIds: [] })) &&
    /own team/.test(ma.askRefusal({ askerId: 'a', ownerId: 'b', chainIds: ['c'] })) &&
    /nobody to ask/.test(ma.askRefusal({ askerId: 'a', ownerId: null })));
  step('a manager (owner in their chain) and an admin may ask', ma.askRefusal({ askerId: 'a', ownerId: 'b', chainIds: ['b'] }) === null && ma.askRefusal({ askerId: 'a', ownerId: 'b', isAdmin: true }) === null);
}
{
  // The routes, against a fake db that can WRITE.
  const D = JSON.parse(JSON.stringify(T)); D.app_settings = []; D.reminders = [];
  const written = { reminders: [], settings: [] };
  function w(table) {
    const f = []; let ins = null, ups = null, lim = null;
    const api = {
      select() { return api; }, limit(n) { lim = n; return api; }, order() { return api; },
      eq(k, v) { f.push(r => r[k] === v); return api; }, in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
      is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
      insert(row) { ins = row; return api; }, upsert(row) { ups = row; return api; },
      maybeSingle() { return Promise.resolve({ data: (D[table] || []).filter(r => f.every(fn => fn(r)))[0] || null, error: null }); },
      then(res, rej) {
        if (ins) { const row = { id: 'r' + (D[table].length + 1), org_id: 'o1', ...ins }; D[table].push(row); written[table] && written[table].push(row); return Promise.resolve({ data: row, error: null }).then(res, rej); }
        if (ups) { const i = D.app_settings.findIndex(r => r.key === ups.key); if (i >= 0) D.app_settings[i] = ups; else D.app_settings.push(ups); return Promise.resolve({ error: null }).then(res, rej); }
        let rows = (D[table] || []).filter(r => f.every(fn => fn(r))); if (lim != null) rows = rows.slice(0, lim);
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return api;
  }
  const rr = require('../routes/mailbox-alerts.js')({ supabase: { from: w }, auth: (_a, _b, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r) });
  const handler = (method, path) => rr.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
  const run = async (method, path, user, { body = {}, params = {} } = {}) => { let out, code = 200; const res = { status(c) { code = c; return res; }, json(j) { out = j; return res; } }; await handler(method, path)({ user, orgId: user.org_id, body, params }, res); return { code, out }; };
  const mgr = { id: 'u-mgr', name: 'Mona', roles: ['bd_lead'], org_id: 'o1' }, rep = { id: 'u-rep', name: 'Raj', roles: ['bd'], org_id: 'o1' }, peer = { id: 'u-peer', name: 'Pat', roles: ['bd'], org_id: 'o1' };

  let x = await run('post', '/mailboxes/alerts/:mailboxId/ask', mgr, { params: { mailboxId: 'mb-rep' } });
  step('the manager\'s "Remind Raj" puts a task on RAJ\'s list, naming who asked', x.code === 201 && written.reminders.length === 1 && written.reminders[0].user_id === 'u-rep' &&
    /Mona asked you to pick this up/.test(written.reminders[0].note) && /raj@a.com/.test(written.reminders[0].note) && written.reminders[0].reminder_type === 'manager_prompt', JSON.stringify(written.reminders[0]));
  step('…carrying the plain-words reason and what to do', /withdrew PACE's permission/.test(written.reminders[0].note) && /press Reconnect/.test(written.reminders[0].note));
  x = await run('post', '/mailboxes/alerts/:mailboxId/ask', mgr, { params: { mailboxId: 'mb-rep' } });
  step('asking twice does not pile a second task on Raj', x.out.already === true && written.reminders.length === 1);
  const list = await run('get', '/mailboxes/alerts', mgr);
  step('…and the warning then says Raj has been asked', list.out.alerts[0].asked === true, JSON.stringify(list.out.alerts[0]));
  x = await run('post', '/mailboxes/alerts/:mailboxId/ask', peer, { params: { mailboxId: 'mb-rep' } });
  step('a peer outside the chain cannot drop a task on Raj (it is not even their warning)', x.code === 404 && written.reminders.length === 1);
  x = await run('post', '/mailboxes/alerts/:mailboxId/ask', rep, { params: { mailboxId: 'mb-rep' } });
  step('Raj cannot "ask" himself — his own mailbox has Reconnect', x.code === 403 && /Reconnect/.test(x.out.error));
  x = await run('post', '/mailboxes/alerts/:mailboxId/ask', mgr, { params: { mailboxId: 'mb-mgr' } });
  step('a working mailbox creates no task', x.code === 404 && written.reminders.length === 1);

  x = await run('post', '/mailboxes/alerts/hide', mgr, { body: { mailbox_id: 'mb-rep' } });
  step('hide works for a warning that is on your list', x.code === 200 && x.out.success === true);
  const after = await run('get', '/mailboxes/alerts', mgr);
  step('the hidden warning leaves the list and is counted', after.out.alerts.length === 0 && after.out.hidden === 1, JSON.stringify(after.out));
  const other = await run('get', '/mailboxes/alerts', { id: 'u-adm', roles: ['admin'], org_id: 'o1' });
  step('hiding is PER PERSON — the admin still sees it', other.out.alerts.some(a => a.email === 'raj@a.com') && other.out.hidden === 0);
  x = await run('post', '/mailboxes/alerts/hide', peer, { body: { mailbox_id: 'mb-rep' } });
  step('you cannot hide a warning that is not yours to see', x.code === 404);
  x = await run('post', '/mailboxes/alerts/show', mgr);
  const back = await run('get', '/mailboxes/alerts', mgr);
  step('Show brings every hidden warning back', x.out.success === true && back.out.alerts.length === 1 && back.out.hidden === 0);
}

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
