// GET /admin/system-health — THE REAL ROUTE (routes/system-health.js) over an in-memory PostgREST (R-367).
//   admin only · the company's mailboxes only (never another company's) · the engine and server facts only for the PACE operator ·
//   follow-ups missed / failed / fine · a failing read is an issue, never "all fine" · the facts reach the rules (services/system-health.js) intact.
// Usage: node test/system-health-routes-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };

const ORG = 'org-a', OTHER = 'org-b';
const NOW = Date.parse('2026-11-03T08:30:00Z');       // 14:00 in India
const tables = {
  user_emails: [
    { id: 'm1', org_id: ORG, user_id: 'u1', email_address: 'ok@acme.com', is_active: true, auto_paused_at: null, platform: 'Gmail' },
    { id: 'm2', org_id: ORG, user_id: 'u1', email_address: 'expired@acme.com', is_active: true, auto_paused_at: null, platform: 'Gmail' },
    { id: 'm3', org_id: ORG, user_id: 'u2', email_address: 'bouncy@acme.com', is_active: true, auto_paused_at: '2026-11-02T10:00:00Z', platform: 'Gmail' },
    { id: 'm4', org_id: ORG, user_id: 'u2', email_address: 'locked@acme.com', is_active: true, auto_paused_at: '2026-11-02T10:00:00Z', platform: 'Gmail' },
    { id: 'm5', org_id: ORG, user_id: 'u2', email_address: 'off@acme.com', is_active: false, auto_paused_at: null, platform: 'Gmail' },
    { id: 'x1', org_id: OTHER, user_id: 'z1', email_address: 'theirs-expired@other.com', is_active: true, auto_paused_at: null, platform: 'Gmail' },
  ],
  gmail_tokens: [{ user_email_id: 'm1', refresh_failed: false }, { user_email_id: 'm2', refresh_failed: true, last_error: 'invalid_grant' }, { user_email_id: 'm3', refresh_failed: false }, { user_email_id: 'm4', refresh_failed: false }, { user_email_id: 'x1', refresh_failed: true, last_error: 'invalid_grant' }],
  microsoft_tokens: [], smtp_credentials: [],
  app_settings: [
    { key: 'last_followup_run', value: '2026-10-29' }, { key: 'followup_send_time', value: '08:30' },
    { key: 'mailbox_pause_note_m4', value: JSON.stringify({ kind: 'blocked', by: 'Prince', at: '2026-11-02T10:00:00Z' }) },
  ],
};
let failSettings = false;
const fake = createFakeDb({ tables, onQuery: (q) => (failSettings && q.table === 'app_settings' ? { data: null, error: { message: 'timeout' } } : undefined) });
const supabase = fake.supabase; const db = createDb(supabase);
let current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG }; let operator = true;
const runner = {
  recent: async () => [{ job_name: 'bounce_sweep', status: 'error', error: 'invalid_grant', started_at: '2026-11-03T07:00:00Z' }],
  lastPingAt: async () => new Date(NOW - 20 * 60e3).toISOString(),
  status: async () => [{ job: 'reply_sweep', overdue: true, last_run_at: '2026-11-03T01:00:00Z', every_ms: 1800000 }, { job: 'ooo_return', overdue: false, last_run_at: '2026-11-03T07:00:00Z', every_ms: 21600000 }],
};
const app = express();
const auth = (req, _res, next) => { req.user = current; req.orgId = current.org_id; next(); };
const hasRole = (req, ...r) => (req.user.roles || []).some((x) => r.includes(x));
app.use(require('../routes/system-health')({ runner, auth, hasRole, isOperator: () => operator, supabase, db, now: () => NOW }));
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const get = async () => { const r = await fetch('http://127.0.0.1:' + srv.address().port + '/admin/system-health'); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; };
const byId = (b, id) => (b.issues || []).find((i) => i.id === id);

current = { id: 'bd', role: 'bd', roles: ['bd'], org_id: ORG };
ok('a non-admin is refused (403)', (await get()).status === 403);
current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG };
let r = await get();
ok('an admin gets the health list', r.status === 200 && Array.isArray(r.body.issues), JSON.stringify(r.body).slice(0, 200));
ok('the follow-ups that last ran on 29 Oct are reported as not run today (14:00 India time, send time 08:30) with the Run button', (() => { const i = byId(r.body, 'followups_missed'); return i && i.level === 'bad' && /2026-10-29/.test(i.sentence) && i.actions[0].path === '/follow-ups/run'; })(), JSON.stringify(byId(r.body, 'followups_missed')));
const mb = byId(r.body, 'mailboxes_attention');
ok("the mailboxes: ONLY this company's — the expired sign-in, the bounce-paused one and the blocked one, never the other company's", mb && /expired@acme.com/.test(mb.sentence) && /bouncy@acme.com/.test(mb.sentence) && /locked@acme.com/.test(mb.sentence) && !/theirs-expired/.test(mb.sentence), mb && mb.sentence);
ok('…a blocked mailbox is counted as blocked, not also as paused; a deactivated one is not counted at all', mb && /1 mailbox blocked by an admin \(locked@acme.com\)/.test(mb.sentence) && !/off@acme.com/.test(mb.sentence) && /1 mailbox paused by PACE for bounces \(bouncy@acme.com\)/.test(mb.sentence));
ok('the PACE operator also sees the background jobs (an overdue one with its Run button, the failed one with its error) and the server', (() => { const j = byId(r.body, 'jobs_unhealthy'); return j && /reply_sweep/.test(j.sentence) && /invalid_grant/.test(j.sentence) && j.actions.some((a) => a.path === '/admin/engine/run/reply_sweep'); })());
ok('…and that this server has only just started (this test process has been up for seconds)', (r.body.issues || []).some((i) => i.id === 'server_restarted'));

operator = false;
r = await get();
ok("an admin who is NOT the PACE operator sees no background-job or server issues (they run for every company)", r.status === 200 && !byId(r.body, 'jobs_unhealthy') && !(r.body.issues || []).some((i) => i.id.startsWith('server_') || i.id.startsWith('heartbeat')));
ok('…but still sees their own follow-ups and mailboxes', byId(r.body, 'followups_missed') && byId(r.body, 'mailboxes_attention'));

operator = true;
tables.app_settings.find((x) => x.key === 'last_followup_run').value = '2026-11-03';
r = await get();
ok('once the day\'s follow-up run is recorded the issue is gone', !byId(r.body, 'followups_missed'));
tables.app_settings.push({ key: 'followup_engine_alert', value: JSON.stringify({ date: '2026-11-03', reason: 'the database timed out' }) });
r = await get();
ok('three failed tries today → its own "needs you" with the reason', (() => { const i = byId(r.body, 'followups_failed'); return i && /timed out/.test(i.sentence); })());
tables.app_settings.find((x) => x.key === 'followup_engine_alert').value = JSON.stringify({ date: '2026-11-02', reason: 'old' });
ok("yesterday's failure is not shown today", !byId((await get()).body, 'followups_failed'));
failSettings = true;
r = await get();
ok('when the follow-up record cannot be read the banner says so — never "all fine"', r.status === 200 && !!byId(r.body, 'followups_unchecked'), JSON.stringify((r.body.issues || []).map((i) => i.id)));
failSettings = false;

// ── R-382: what the admin CLOSED in the mailbox warnings block leaves the banner too (ONE store), and the banner says how many ─────────────────────
{
  const ma = require('../services/mailbox-alerts');
  const { mailboxConnections } = require('../mailbox-health');
  const conns = await mailboxConnections(supabase, ['m2', 'm3']);
  const al = (id) => ma.alertFor({ mailbox: tables.user_emails.find((m) => m.id === id), conn: conns[id] });
  ok('(setup) the two mailbox problems have alerts to close', !!al('m2') && !!al('m3'), JSON.stringify([al('m2') && al('m2').state, al('m3') && al('m3').state]));
  let before = byId((await get()).body, 'mailboxes_attention');
  ok('before closing: the expired sign-in is in the banner', before && /expired@acme.com/.test(before.sentence));
  tables.app_settings.push({ key: ma.hideKey('boss'), value: JSON.stringify(ma.recordClose({}, al('m2'), NOW)) });
  let after = byId((await get()).body, 'mailboxes_attention');
  ok('after the admin CLOSES the expired sign-in it is gone from the banner, the others stay, and the banner says one was closed', after && !/expired@acme.com/.test(after.sentence) && /bouncy@acme.com/.test(after.sentence) && /1 more warning closed by you/.test(after.sentence), after && after.sentence);
  current = { id: 'boss2', role: 'admin', roles: ['admin'], org_id: ORG };
  const other = byId((await get()).body, 'mailboxes_attention');
  ok('closing is PER PERSON — another admin still sees it', other && /expired@acme.com/.test(other.sentence) && !/closed by you/.test(other.sentence));
  current = { id: 'boss', role: 'admin', roles: ['admin'], org_id: ORG };
  tables.app_settings.find((x) => x.key === ma.hideKey('boss')).value = JSON.stringify(ma.recordClose(ma.recordClose({}, al('m2'), NOW), al('m3'), NOW));
  after = byId((await get()).body, 'mailboxes_attention');
  ok('closing the paused one too leaves only the lock an admin set on purpose (not a closable warning)', after && !/expired@acme.com/.test(after.sentence) && !/bouncy@acme.com/.test(after.sentence) && /locked@acme.com/.test(after.sentence) && /2 more warnings closed by you/.test(after.sentence), after && after.sentence);
  const st = JSON.parse(tables.app_settings.find((x) => x.key === ma.hideKey('boss')).value);
  st.m2.fp = 'failed|a-different-last-worked-date';
  tables.app_settings.find((x) => x.key === ma.hideKey('boss')).value = JSON.stringify(st);
  after = byId((await get()).body, 'mailboxes_attention');
  ok('a mailbox that fails in a NEW way comes straight back into the banner', after && /expired@acme.com/.test(after.sentence), after && after.sentence);
}
srv.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
