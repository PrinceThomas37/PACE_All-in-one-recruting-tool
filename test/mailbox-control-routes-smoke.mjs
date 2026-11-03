// ONE MAILBOX, ONE PLACE TO ACT — THE REAL ROUTES (routes/mailbox-control.js over an in-memory PostgREST, real models layer).
//   admin only · another company's mailbox is a 404 · an empty search returns NOTHING (no long list) · the numbers · every action really changes
//   the row the send loops read (auto_paused_at / is_active) · Block locks and takes it out of warm-up · Start is refused on a blocked mailbox ·
//   Delete is refused (409, row kept) for a mailbox with mail on record — the old delete button "succeeded" without deleting.
// Usage: node test/mailbox-control-routes-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createDb } = require('../models');
const alerts = require('../services/mailbox-alerts');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', OTHER = 'org-b';
const U1 = uid(), U2 = uid(), UX = uid();
const M = { busy: uid(), fresh: uid(), warm: uid(), expired: uid(), foreign: uid(), under: uid(), five: [uid(), uid(), uid(), uid()] };
const NOW = new Date().toISOString();
const mb = (id, user, email, extra = {}) => ({ id, org_id: ORG, user_id: user, email_address: email, display_name: email.split('@')[0], platform: 'Gmail', is_primary: false, is_active: true, daily_send_limit: 300, auto_paused_at: null, warmup_status: null, ...extra });
const tables = {
  users: [{ id: U1, org_id: ORG, name: 'Neil Patrick', role: 'bd' }, { id: U2, org_id: ORG, name: 'Sam Wilson', role: 'bd' }, { id: UX, org_id: OTHER, name: 'Far Away', role: 'bd' }],
  user_emails: [
    mb(M.busy, U1, 'neil.patrick@acme.com'), mb(M.fresh, U2, 'sam.wilson@acme.com'),
    mb(M.warm, U2, 'sam_w@acme.com', { warmup_status: 'warming', warmup_pool_opt_in: true }),
    mb(M.expired, U1, 'old.signin@acme.com'),
    { ...mb(M.foreign, UX, 'far.away@other.com'), org_id: OTHER },
    mb(M.under, U2, 'under.limit@acme.com'),
    ...M.five.map((id, i) => mb(id, UX === U1 ? U1 : U1, `extra${i}@acme.com`, { is_active: i < 3 })),
  ],
  contacts: [], emails: [], email_tracking: [], app_settings: [{ key: 'sys_bounce_rate_threshold_pct@' + ORG, value: '5' }],
  jobs: [{ id: 'j1', org_id: ORG, sending_email_id: M.fresh, deleted_at: null }],
  microsoft_tokens: [], gmail_tokens: [{ user_email_id: M.busy, refresh_failed: false }, { user_email_id: M.fresh, refresh_failed: false }, { user_email_id: M.warm, refresh_failed: false }, { user_email_id: M.expired, refresh_failed: true, last_error: 'invalid_grant' }],
  smtp_credentials: [], activity_log: [], follow_ups: [],
};
// 10 emails from the busy mailbox (mixed-case address); 4 people: a,b bounced, c replied, d fine
const people = [['a', 'invalid', null], ['b', 'blocked', null], ['c', 'valid', '2026-11-01'], ['d', 'valid', null]];
people.forEach(([id, st, rep]) => tables.contacts.push({ id, org_id: ORG, email_status: st, replied_at: rep }));
['a', 'a', 'b', 'c', 'd', 'd'].forEach((c, i) => tables.emails.push({ id: 'e' + i, org_id: ORG, contact_id: c, from_email: i % 2 ? 'NEIL.PATRICK@acme.com' : 'neil.patrick@acme.com', status: 'sent', created_at: NOW }));
tables.emails.push({ id: 'ef', org_id: ORG, contact_id: 'a', from_email: 'neil.patrick@acme.com', status: 'failed', fail_kind: 'permanent', fail_reason: 'mailbox full', created_at: NOW });
tables.emails.push({ id: 'ep', org_id: ORG, contact_id: 'd', from_email: 'neil.patrick@acme.com', status: 'pending', created_at: NOW });
['x1', 'x2'].forEach((id) => tables.emails.push({ id, org_id: ORG, contact_id: 'd', from_email: 'samXw@acme.com', status: 'sent', created_at: NOW }));   // look-alike of sam_w@ — `_` is a LIKE wildcard
tables.emails.push({ id: 'eo', org_id: ORG, contact_id: 'd', from_email: 'neilXpatrick@acme.com', status: 'sent', created_at: NOW });   // a LOOK-ALIKE: `_` wildcard must not pull it in
['t1', 't2', 't3', 't4'].forEach((t, i) => tables.email_tracking.push({ id: t, org_id: ORG, mailbox_email: 'neil.patrick@acme.com', open_count: i < 1 ? 3 : 0, sent_at: NOW }));
tables.emails.push({ id: 'ehist', org_id: ORG, contact_id: 'c', from_email: 'sam.wilson@acme.com', status: 'sent', created_at: NOW });   // fresh HAS history → cannot be deleted
const fake = createFakeDb({ tables, defaults: { user_emails: () => ({ org_id: ORG }) } });
const supabase = fake.supabase; const db = createDb(supabase);

let current = { id: U1, role: 'admin', roles: ['admin'], org_id: ORG, name: 'Prince Thomas' };
const logged = [];
const app = express(); app.use(express.json());
const auth = (req, res, next) => { req.user = current; req.orgId = current.org_id; next(); };
const hasRole = (req, ...r) => (req.user.roles || [req.user.role]).some((x) => r.includes(x));
app.use(require('../routes/mailbox-control')({ supabase, db, auth, hasRole, orgIdFor: (req) => req.orgId, logActivity: async (...a) => { logged.push(a); } }));
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const call = async (method, path, body) => { const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status, body: b }; };
const row = (id) => fake.tables.user_emails.find((m) => m.id === id);
const act = (id, action, extra) => call('POST', `/admin/mailboxes/${id}/action`, { action, ...(extra || {}) });

try {
  // ── who may ──
  current = { id: U2, role: 'bd', roles: ['bd'], org_id: ORG, name: 'Sam' };
  const gets = await Promise.all(['/admin/mailboxes/summary', '/admin/mailboxes/search?q=neil', `/admin/mailboxes/${M.busy}/detail`].map((p) => call('GET', p)));
  step('a non-admin gets 403 on summary, search and detail', gets.every((g) => g.status === 403), gets.map((g) => g.status).join());
  step('…and cannot act', (await act(M.busy, 'block')).status === 403 && !row(M.busy).auto_paused_at);
  current = { id: U1, role: 'admin', roles: ['admin'], org_id: ORG, name: 'Prince Thomas' };

  // ── search: never the long list ──
  const none = await call('GET', '/admin/mailboxes/search');
  step('an empty search returns NOTHING (no long list)', none.status === 200 && none.body.results.length === 0);
  const byAddr = await call('GET', '/admin/mailboxes/search?q=neil.pat');
  step('search by part of the address finds it (literal route not shadowed by :id)', byAddr.body.results.length === 1 && byAddr.body.results[0].id === M.busy && byAddr.body.results[0].owner === 'Neil Patrick', JSON.stringify(byAddr.body));
  step('search by the OWNER\'s name finds their mailboxes', (await call('GET', '/admin/mailboxes/search?q=sam wilson')).body.results.length === 3);
  step('another company\'s mailbox is never found', (await call('GET', '/admin/mailboxes/search?q=far.away')).body.results.length === 0 && (await call('GET', '/admin/mailboxes/search?q=other.com')).body.results.length === 0);
  const sum0 = await call('GET', '/admin/mailboxes/summary');
  step('the summary counts this company\'s mailboxes only (9), by state, and the expired sign-in', sum0.body.total === 9 && sum0.body.active === 8 && sum0.body.deactivated === 1 && sum0.body.expired === 1, JSON.stringify(sum0.body));
  const exp = await call('GET', '/admin/mailboxes/search?state=expired');
  step('the "sign-in expired" chip lists just that one', exp.body.results.length === 1 && exp.body.results[0].id === M.expired);

  // ── detail ──
  const d = await call('GET', `/admin/mailboxes/${M.busy}/detail?days=30`);
  const s = d.body.stats || {};
  step('detail: 6 sent from this address (any case) — the look-alike address is NOT counted', s.sent === 6, JSON.stringify(s));
  step('detail: bounce rate counts people (a,b of a,b,c,d = 50 %), reply 25 %, 1 failed, 1 pending', s.people_emailed === 4 && s.bounce_rate === 50 && s.reply_rate === 25 && s.failed === 1 && s.pending === 1, JSON.stringify(s));
  step('detail: open rate is of tracked emails (1 of 4 = 25 %)', s.tracked === 4 && s.opened === 1 && s.open_rate === 25);
  step('detail: the company\'s own bounce limit (5 %) is used and 50 % is flagged bad', d.body.bounce_limit_pct === 5 && d.body.health.level === 'bad' && /50%/.test(d.body.health.tips.join()), JSON.stringify(d.body.health));
  step('detail: last failure reason shown, 7-day strip has 7 days, owner named', s.last_failure && s.last_failure.reason === 'mailbox full' && d.body.week.length === 7 && d.body.owner.name === 'Neil Patrick');
  const w = await call('GET', `/admin/mailboxes/${M.warm}/detail`);
  step('detail: an address with an underscore (sam_w@) is matched EXACTLY — samXw@ is not counted as its mail', w.body.stats.sent === 0 && w.body.email_count === 0, JSON.stringify(w.body.stats));
  const e = await call('GET', `/admin/mailboxes/${M.expired}/detail`);
  step('detail: an expired sign-in is "Sign-in expired" and has no made-up rates', e.body.health.label === 'Sign-in expired' && e.body.stats.bounce_rate === null && e.body.stats.open_rate === null);
  step('detail of another company\'s mailbox is a 404; so is a junk id', (await call('GET', `/admin/mailboxes/${M.foreign}/detail`)).status === 404 && (await call('GET', '/admin/mailboxes/not-a-uuid/detail')).status === 404);
  step('detail offers exactly the actions the state allows', d.body.actions.map((a) => a.action).join() === 'pause,block,deactivate,delete');

  // ── actions ──
  const p = await act(M.fresh, 'pause');
  step('PAUSE: the row the send loops read now says paused, and the screen is told', p.status === 200 && !!row(M.fresh).auto_paused_at && p.body.state === 'paused' && p.body.actions.map((a) => a.action).join() === 'start,block,deactivate,delete', JSON.stringify(p.body));
  const alertNote = JSON.parse(fake.tables.app_settings.find((r) => r.key === alerts.pauseNoteKey(M.fresh)).value);
  step('PAUSE: the reason kept is "paused by Prince Thomas", never blamed on bounces', alertNote.kind === 'manual' && alertNote.by === 'Prince Thomas' && !/bounce/i.test(alerts.pausedSentence(alertNote)));
  const dp0 = await call('GET', `/admin/mailboxes/${M.fresh}/detail`);
  step('PAUSE: the card carries the one-sentence scope note (OUTREACH only; one-by-one emails and replies still go) and the state note says so too', /OUTREACH/.test(dp0.body.scope_note) && /one by one/.test(dp0.body.scope_note) && /Outreach from it is stopped/.test(dp0.body.state_note) && !/Nothing sends/.test(dp0.body.state_note), JSON.stringify([dp0.body.scope_note, dp0.body.state_note]));
  step('an ACTIVE mailbox carries no scope note (nothing to explain)', (await call('GET', `/admin/mailboxes/${M.busy}/detail`)).body.scope_note === null);
  step('PAUSE twice is refused (409) in words', (await act(M.fresh, 'pause')).status === 409);
  const st = await act(M.fresh, 'start');
  step('START: sending is allowed again and the pause note is forgotten', st.status === 200 && row(M.fresh).auto_paused_at === null && st.body.state === 'active' && !fake.tables.app_settings.some((r) => r.key === alerts.pauseNoteKey(M.fresh)));

  const b = await act(M.warm, 'block');
  step('BLOCK: paused AND out of warm-up (no longer warming, not receiving pool mail)', b.status === 200 && b.body.state === 'blocked' && row(M.warm).warmup_status === 'paused' && row(M.warm).warmup_pool_opt_in === false && !!row(M.warm).auto_paused_at);
  const sb = await act(M.warm, 'start');
  step('START on a BLOCKED mailbox is refused: unblock first', sb.status === 409 && /Unblock it first/.test(sb.body.error) && !!row(M.warm).auto_paused_at);
  const ub = await act(M.warm, 'unblock');
  step('UNBLOCK: it becomes a plain pause — still NOT sending until Start', ub.status === 200 && ub.body.state === 'paused' && !!row(M.warm).auto_paused_at);
  step('…then START sends again', (await act(M.warm, 'start')).body.state === 'active');
  step('an unknown action is refused', (await act(M.warm, 'explode')).status === 409);
  step('another company\'s mailbox cannot be acted on (404, untouched)', (await act(M.foreign, 'block')).status === 404 && row(M.foreign).auto_paused_at === null);

  const dx = await act(M.fresh, 'deactivate');
  step('DEACTIVATE: out of use, and the lead pointed at it is moved or reported (never left stuck silently)', dx.status === 200 && row(M.fresh).is_active === false && dx.body.state === 'deactivated' && dx.body.reassignment && typeof dx.body.reassignment.stranded === 'number', JSON.stringify(dx.body.reassignment));
  const sd = await act(M.fresh, 'start');
  step('START on a deactivated mailbox puts it back in use, not paused', sd.status === 200 && row(M.fresh).is_active === true && row(M.fresh).auto_paused_at === null);

  // the 4-active-per-user rule (the product's existing one) holds here too: extra0..2 are active + busy = 4 for U1
  const cap = await act(M.five[3], 'start');
  step('START is refused when its owner already has 4 active email IDs (same rule as the old screen)', cap.status === 409 && /most allowed/.test(cap.body.error) && row(M.five[3]).is_active === false, JSON.stringify(cap.body));

  // delete
  const noType = await act(M.under, 'delete');
  step('DELETE without typing the address is refused (400), row kept', noType.status === 400 && !!row(M.under));
  const hist = await act(M.fresh, 'delete', { confirm_address: 'sam.wilson@acme.com' });
  step('DELETE of a mailbox with mail on record is REFUSED (409), says why, offers Deactivate, and the row is STILL THERE', hist.status === 409 && /on record/.test(hist.body.error) && /Deactivate/.test(hist.body.error) && !!row(M.fresh), JSON.stringify(hist.body));
  const del = await act(M.under, 'delete', { confirm_address: 'UNDER.LIMIT@acme.com' });
  step('DELETE of a clean mailbox (address typed back) really deletes it', del.status === 200 && del.body.deleted === true && !row(M.under));
  step('…and it is gone from search', (await call('GET', '/admin/mailboxes/search?q=under.limit')).body.results.length === 0);
  step('every action that worked left an audit line saying who and what (8 of them)', logged.length === 8 && logged.every((a) => a[2] === U1 && /^mailbox_/.test(a[3])) && logged.some((a) => a[3] === 'mailbox_delete'), logged.map((a) => a[3]).join());
} catch (e) { step('route test ran without throwing', false, e.stack); }
srv.close();
const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
