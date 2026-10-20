// SCHEDULE SEND FROM THE INBOX (owner, 19 Oct: "I also need schedule button to our emails"; R-273, D-0162, D-0163).
//   1. the engine (services/scheduled-sends.js): sends what is due — and only that — through the one send path, from the
//      mailbox chosen; CLAIMS a row before sending so it never goes twice; a failure is 'failed' with words and is NOT retried;
//      a mailbox no longer the person's, or switched off, does not send; attachments leave the row once sent; a row a dead
//      process left at 'sending' becomes 'failed' at boot and is never re-sent; nothing due → the engine's quiet "skipped";
//   2. the routes: Schedule checks the email NOW (same answers as Send), refuses a time that has passed, keeps the person's
//      zone, never schedules from another person's mailbox; the Scheduled list is the person's own only and carries no file
//      contents; Cancel and Send now act only on the person's own, and Cancel drops the attachments.
// Usage: node test/schedule-send-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const { createScheduledSends, STUCK_MESSAGE } = require('../services/scheduled-sends.js');
const { createMailboxSender } = require('../services/mailbox-send.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── a tiny in-memory table: enough of supabase-js for these two files ──
function makeTable(rows) {
  return () => {
    const f = []; let op = 'select', patch = null, ins = null, wantRows = false, lim = null, ord = null, single = null;
    const match = (r) => f.every(([k, t, v]) => t === 'eq' ? r[k] === v : t === 'in' ? v.includes(r[k]) : t === 'lte' ? String(r[k]) <= String(v) : true);
    const run = () => {
      if (op === 'insert') { const r = Object.assign({ id: 'row-' + (rows.length + 1) }, ins); rows.push(r); return { data: single ? r : [r], error: null }; }
      let hit = rows.filter(match);
      if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: wantRows ? hit.map(r => ({ id: r.id })) : null, error: null }; }
      if (ord) hit = hit.slice().sort((a, b) => String(a[ord]).localeCompare(String(b[ord])));
      if (lim != null) hit = hit.slice(0, lim);
      if (single === 'maybe') return { data: hit[0] || null, error: null };
      if (single) return { data: hit[0] || null, error: hit[0] ? null : { message: 'none' } };
      return { data: hit.map(r => JSON.parse(JSON.stringify(r))), error: null };
    };
    const c = {
      select: () => { if (op !== 'select') wantRows = true; return c; },
      insert: (o) => { op = 'insert'; ins = o; return c; },
      update: (o) => { op = 'update'; patch = o; return c; },
      eq: (k, v) => { f.push([k, 'eq', v]); return c; }, in: (k, v) => { f.push([k, 'in', v]); return c; },
      lte: (k, v) => { f.push([k, 'lte', v]); return c; },
      order: (k) => { ord = k; return c; }, limit: (n) => { lim = n; return c; },
      maybeSingle: async () => { single = 'maybe'; return run(); }, single: async () => { single = true; return run(); },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return c;
  };
}

// ── 1. the engine ──
{
  const ME = 'u-me';
  const MBX = [
    { id: 'mb-1', user_id: ME, org_id: 'o', email_address: 'me@x.com', platform: 'Gmail', is_active: true },
    { id: 'mb-off', user_id: ME, org_id: 'o', email_address: 'off@x.com', platform: 'Gmail', is_active: false },
    { id: 'mb-gone', user_id: 'u-someone-else', org_id: 'o', email_address: 'theirs@x.com', platform: 'Gmail', is_active: true },
  ];
  const att = [{ filename: 'cv.pdf', content_type: 'application/pdf', base64: 'QUJD' }];
  const ROWS = [
    { id: 'due', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'new', payload: { to: 'ray@y.com', subject: 'Hi', body: 'Hello Ray', attachments: att }, send_at: '2026-10-20T07:00:00.000Z', status: 'scheduled' },
    { id: 'later', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'new', payload: { to: 'z@y.com', body: 'Later' }, send_at: '2026-10-21T07:00:00.000Z', status: 'scheduled' },
    { id: 'reply', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'reply', message_id: 'M-9', payload: { body: 'Thanks', reply_all: true }, send_at: '2026-10-20T06:00:00.000Z', status: 'scheduled' },
    { id: 'off', org_id: 'o', user_id: ME, mailbox_id: 'mb-off', kind: 'new', payload: { to: 'a@b.com', body: 'x' }, send_at: '2026-10-20T06:30:00.000Z', status: 'scheduled' },
    { id: 'gone', org_id: 'o', user_id: ME, mailbox_id: 'mb-gone', kind: 'new', payload: { to: 'a@b.com', body: 'x' }, send_at: '2026-10-20T06:40:00.000Z', status: 'scheduled' },
    { id: 'cancelled', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'new', payload: { to: 'a@b.com', body: 'x' }, send_at: '2026-10-20T05:00:00.000Z', status: 'cancelled' },
    { id: 'stuck', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'new', payload: { to: 'a@b.com', body: 'x' }, send_at: '2026-10-19T05:00:00.000Z', status: 'sending' },
  ];
  const sent = [];
  let failNext = null;
  const sender = { check: createMailboxSender({}).check, send: async (mb, uid, kind, mid, body) => {
    if (failNext) { const e = failNext; failNext = null; throw e; }
    sent.push({ mb: mb.id, uid, kind, mid, to: body.to, files: (body.attachments || []).length, replyAll: body.reply_all }); return { success: true };
  } };
  const s = createScheduledSends({ table: makeTable(ROWS), mailboxes: makeTable(MBX), sender });
  const now = '2026-10-20T07:00:30.000Z';
  const r1 = await s.runDue({ now });
  const by = Object.fromEntries(ROWS.map(r => [r.id, r]));
  step('only what is due goes, oldest first', sent.length === 2 && sent[0].mid === 'M-9' && sent[1].to === 'ray@y.com', JSON.stringify(sent));
  step('…through the one send path, as the kind it was (a reply stays a reply-all to its email)', sent[0].kind === 'reply' && sent[0].replyAll === true && sent[1].kind === 'new' && sent[1].files === 1);
  step('a later one waits', by.later.status === 'scheduled');
  step('a sent one is marked sent, with when', by.due.status === 'sent' && by.due.sent_at === now);
  step('…and its attachments leave the row (their names stay)', !by.due.payload.attachments && JSON.stringify(by.due.payload.attachment_names) === '["cv.pdf"]');
  step('an email ID that is switched off does not send — and says why', by.off.status === 'failed' && /switched off/.test(by.off.error));
  step('an email ID that is no longer the person\'s does not send', by.gone.status === 'failed' && /no longer yours/.test(by.gone.error) && !sent.some(x => x.mb === 'mb-gone'));
  step('a cancelled one never goes', by.cancelled.status === 'cancelled');
  step('the engine log gets counts', r1.sent === 2 && r1.failed === 2, JSON.stringify(r1));

  // a failure is recorded in words and is NOT retried by itself
  by.later.send_at = '2026-10-20T07:00:00.000Z';
  failNext = new Error('invalid_grant: token expired');
  await s.runDue({ now });
  step('a failed send is "failed" with words a person can act on', by.later.status === 'failed' && /reconnect/i.test(by.later.error), by.later.error);
  sent.length = 0;
  await s.runDue({ now: '2026-10-20T09:00:00.000Z' });
  step('…and the next pass does not try it again', sent.length === 0 && by.later.status === 'failed');
  step('nothing due → the engine\'s quiet "skipped" (no run-log row every minute)', JSON.stringify(await s.runDue({ now: '2026-10-20T09:00:00.000Z' })) === '{"skipped":"nothing_due"}');

  // claimed elsewhere: a row another tick already took is not sent again
  ROWS.push({ id: 'race', org_id: 'o', user_id: ME, mailbox_id: 'mb-1', kind: 'new', payload: { to: 'r@y.com', body: 'x' }, send_at: '2026-10-20T08:00:00.000Z', status: 'scheduled' });
  const racing = createScheduledSends({ table: (() => { const t = makeTable(ROWS); return () => { const q = t(); const u = q.update; q.update = (o) => { if (o.status === 'sending') ROWS.find(r => r.id === 'race').status = 'sending'; return u(o); }; return q; }; })(), mailboxes: makeTable(MBX), sender });
  sent.length = 0;
  await racing.runDue({ now: '2026-10-20T09:00:00.000Z' });
  step('a row another pass already claimed is not sent twice', sent.length === 0, JSON.stringify(sent));

  const rec = await s.recoverStuck({ now });
  step('at boot, a row a dead process left at "sending" becomes "failed" with a plain warning — never re-sent', by.stuck.status === 'failed' && by.stuck.error === STUCK_MESSAGE && rec.recovered >= 1);
}

// ── 2. the routes ──
{
  const ME = 'u-me', ORG = 'org-a';
  const MB = {
    'mb-g': { id: 'mb-g', user_id: ME, org_id: ORG, email_address: 'me@gmail.test', platform: 'Gmail', is_active: true },
    'mb-theirs': { id: 'mb-theirs', user_id: 'u-other', org_id: ORG, email_address: 'them@x.test', platform: 'Gmail', is_active: true },
  };
  const SCHED = [
    { id: 'theirs-1', org_id: ORG, user_id: 'u-other', mailbox_id: 'mb-theirs', kind: 'new', payload: { to: 'x@y.com', body: 'secret', subject: 'Theirs' }, send_at: '2030-01-01T00:00:00Z', status: 'scheduled' },
  ];
  const supabase = { from: (table) => {
    const f = {};
    const chain = {
      select: () => chain, order: () => chain, is: () => chain, limit: () => chain,
      in: (c, v) => { f[c] = v; return chain; }, eq: (c, v) => { f[c] = v; return chain; },
      maybeSingle: async () => table === 'user_emails' ? { data: MB[f.id] || null } : { data: { user_email_id: f.user_email_id } },
      then: (res) => Promise.resolve({ data: table === 'user_emails' ? Object.values(MB).filter(m => (!f.id || f.id.includes(m.id)) && (!f.user_id || m.user_id === f.user_id)) : [] }).then(res),
    };
    return chain;
  } };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(require('../routes/mailbox.js')({
    supabase,
    db: { forRequest: () => ({ from: (t) => t === 'scheduled_sends' ? makeTable(SCHED)() : ({ select: () => ({ in: () => ({ limit: async () => ({ data: [] }), is: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) },
    auth: (req, _res, next) => { req.user = { id: ME, org_id: ORG, roles: ['bd'] }; next(); },
    orgIdFor: (req) => req.user.org_id,
    graphMailRequest: async () => ({ value: [] }), getMicrosoftToken: async () => 't', gmailProvider: {},
    sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '',
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const future = new Date(Date.now() + 26 * 3600e3).toISOString();
  try {
    let r = await call('POST', '/mailbox/mb-g/schedule', { kind: 'new', to: 'ray@y.com', subject: 'Hi', body: 'Hello', send_at: future, timezone: 'America/Chicago', attachments: [{ filename: 'cv.pdf', base64: 'QUJD' }], sneaky: 'x' });
    let j = await r.json();
    const row = SCHED.find(x => x.user_id === ME);
    step('Schedule stores the email for later, from the mailbox chosen', r.status === 200 && row && row.mailbox_id === 'mb-g' && row.status === 'scheduled' && row.send_at === future, JSON.stringify(j));
    step('…keeping the person\'s own time zone, and only the window\'s fields', row.timezone === 'America/Chicago' && row.payload.to === 'ray@y.com' && !('sneaky' in row.payload) && row.org_id === ORG);
    r = await call('POST', '/mailbox/mb-g/schedule', { kind: 'new', to: 'ray@y.com', body: '', send_at: future });
    step('an empty email is refused NOW, with the same words Send uses', r.status === 400 && /empty/i.test((await r.json()).error));
    r = await call('POST', '/mailbox/mb-g/schedule', { kind: 'new', to: 'ray@y.com', body: 'x', send_at: new Date(Date.now() - 60e3).toISOString() });
    step('a time that has passed is refused in words', r.status === 400 && /passed/.test((await r.json()).error));
    r = await call('POST', '/mailbox/mb-g/schedule', { kind: 'reply', body: 'x', send_at: future });
    step('a scheduled reply must say which email it answers', r.status === 400);
    r = await call('POST', '/mailbox/mb-g/schedule', { kind: 'new', to: 'a@b.com', body: 'x', send_at: future, timezone: 'Not/AZone' });
    step('a time zone that is not one is not stored', r.status === 200 && SCHED[SCHED.length - 1].timezone === null);
    r = await call('POST', '/mailbox/mb-theirs/schedule', { kind: 'new', to: 'a@b.com', body: 'x', send_at: future });
    step('scheduling from another person\'s mailbox → 404 (the one door)', r.status === 404);

    r = await call('GET', '/mailbox-scheduled');
    j = await r.json();
    step('the Scheduled list is the person\'s own only', r.status === 200 && j.items.length === 2 && j.items.every(i => i.mailbox_id === 'mb-g'), JSON.stringify(j.items.map(i => i.mailbox_id)));
    step('…says the email ID, to, subject, when and zone, and the file NAMES — never the file contents', j.items[0].mailbox_email === 'me@gmail.test' && j.items[0].to === 'ray@y.com' && j.items[0].timezone === 'America/Chicago' && JSON.stringify(j.items[0].attachments) === '["cv.pdf"]' && !JSON.stringify(j).includes('QUJD'));

    r = await call('DELETE', '/mailbox-scheduled/theirs-1');
    step('cancelling another person\'s → 404, and theirs is untouched', r.status === 404 && SCHED[0].status === 'scheduled');
    r = await call('POST', '/mailbox-scheduled/theirs-1/send-now');
    step('"Send now" on another person\'s → 404', r.status === 404 && SCHED[0].send_at === '2030-01-01T00:00:00Z');
    r = await call('POST', '/mailbox-scheduled/' + row.id + '/send-now');
    step('Send now makes the person\'s own due now', r.status === 200 && Date.parse(row.send_at) <= Date.now() && row.status === 'scheduled');
    r = await call('DELETE', '/mailbox-scheduled/' + row.id);
    step('Cancel cancels the person\'s own, and its attachments go with it', r.status === 200 && row.status === 'cancelled' && !row.payload.attachments);
    r = await call('DELETE', '/mailbox-scheduled/' + row.id);
    step('a cancelled one cannot be cancelled again (it has gone from the list)', r.status === 409);
  } finally { server.close(); }
}

const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
