// Verifies the app-password mailbox ROUTES (D-0120, R-200 step b): who may connect which mailbox, the step-by-step answer, "nothing is
// saved unless sending AND reading both work", and that the password is never in any response. The mail servers are scripted fakes
// (test/smtp-mailbox-smoke.mjs covers the real SMTP behaviour); this is about what the routes decide and say.
//
// Usage: node test/smtp-routes-smoke.mjs

import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = 'test-secret-smtp-routes';
const express = require('express');
const secret = require('../services/mailbox-secret.js');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

const PW = 'zz-very-secret-app-pw-9';
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

// ── a fake database: one mailbox slot, and a record of what was written ───────────────────────────────────────────────
function makeDb() {
  const state = { slots: { mb1: { id: 'mb1', user_id: 'u1', org_id: 'orgA', email_address: 'bea@acme.test', display_name: 'Bea Smith', daily_send_limit: 150, is_active: true }, mbOther: { id: 'mbOther', user_id: 'u2', org_id: 'orgA', email_address: 'sam@acme.test', daily_send_limit: 150 }, mbB: { id: 'mbB', user_id: 'u3', org_id: 'orgB', email_address: 'x@b.test', daily_send_limit: 150 } }, updates: [], other: [] };
  state.from = (table) => {
    const q = { _t: table, _f: {}, _upd: null };
    const chain = ['select', 'in', 'is', 'not', 'order', 'limit', 'insert', 'upsert', 'neq', 'gte', 'lte'];
    chain.forEach((m) => { q[m] = () => q; });
    q.eq = (k, v) => { q._f[k] = v; return q; };
    q.update = (o) => { q._upd = o; return q; };
    q.delete = () => { q._del = true; return q; };
    const resolveNow = () => { if (q._upd && table === 'user_emails') state.updates.push({ id: q._f.id, org: q._f.org_id, set: q._upd }); else if (q._upd || q._del) state.other.push({ table, upd: q._upd, del: !!q._del }); return { data: [], error: null }; };
    q.maybeSingle = () => Promise.resolve({ data: table === 'user_emails' ? (state.slots[q._f.id] || null) : null, error: null });
    q.single = q.maybeSingle;
    q.then = (res, rej) => Promise.resolve(resolveNow()).then(res, rej);
    return q;
  };
  return state;
}

// ── scripted mail servers ──────────────────────────────────────────────────────────────────────────────────────────────
function makeMail(script) {
  const log = { smtp: [], imap: 0, sent: [], marker: 0 };
  const sc = Object.assign({ smtp: () => ({ ok: true }), imap: () => ({ ok: true }), send: () => ({}), marker: () => ({ found: true, folder: 'INBOX' }) }, script || {});
  return { log, mailbox: {
    verifySmtp: async (c) => { log.smtp.push(c.smtp.host); return sc.smtp(c); },
    verifyImap: async () => { log.imap++; return sc.imap(); },
    sendMail: async (c, creds, msg) => { log.sent.push(msg); return sc.send(msg); },
    findMarker: async () => { log.marker++; return sc.marker(); },
  } };
}

async function run(opts, fn) {
  const db = makeDb(), mail = makeMail(opts.script), saved = [], removed = [];
  const who = Object.assign({ id: 'u1', org: 'orgA', roles: ['bd'] }, opts.who || {});
  const smtp = {
    secret: { isConfigured: () => opts.configured !== false },
    mailbox: mail.mailbox,
    store: { save: async (row) => { saved.push(row); }, remove: async (id) => { removed.push(id); }, get: async () => (opts.connected ? { cfg: {}, creds: {}, row: { refresh_failed: false } } : null), outcome: async () => {} },
    resolver: { mx: async () => (opts.mx === undefined ? ['mx.zoho.com'] : opts.mx), txt: async () => [], cname: async () => [] },
    findOptions: { tries: 1, waitMs: 0 },
  };
  const ctx = { supabase: db, auth: (req, res, next) => { req.user = { id: who.id }; req._roles = who.roles; req._org = who.org; next(); }, hasRole: (req, ...r) => (req._roles || []).some((x) => r.includes(x)), orgIdFor: (req) => req._org, smtp };
  const app = express(); app.use(express.json()); app.use(require('../routes/smtp-mailbox.js')(ctx));
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const call = (method, path, body) => new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, text: b, body: b ? JSON.parse(b) : {} })); });
    if (data) req.write(data); req.end();
  });
  try { await fn({ call, db, mail, saved, removed }); } finally { srv.close(); }
}

// ── availability ──────────────────────────────────────────────────────────────────────────────────────────────────────
await run({}, async ({ call }) => {
  const r = await call('GET', '/smtp/enabled');
  step('"is it available?" is yes when the server has its key', r.status === 200 && r.body.enabled === true);
});
await run({ configured: false }, async ({ call, saved }) => {
  step('…and no when it has none — so the screen shows no such button', (await call('GET', '/smtp/enabled')).body.enabled === false);
  const i = await call('GET', '/smtp/info/mb1');
  step('the info says WHY it is off, in words (nothing can be stored safely without a key)', i.body.enabled === false && /MAILBOX_SECRET_KEY/.test(i.body.reason));
  const c = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('connecting is refused outright (503), and nothing is saved', c.status === 503 && c.body.error === 'not_configured' && !saved.length && !c.text.includes(PW));
});

// ── who may connect which mailbox ─────────────────────────────────────────────────────────────────────────────────────
await run({}, async ({ call, mail }) => {
  step('your own mailbox is found', (await call('GET', '/smtp/info/mb1')).status === 200);
  step('someone else\'s mailbox is a 404 (never a 403 that confirms it exists)', (await call('GET', '/smtp/info/mbOther')).status === 404 && (await call('POST', '/smtp/connect/mbOther', { password: PW })).status === 404);
  step('another organisation\'s mailbox is a 404', (await call('POST', '/smtp/connect/mbB', { password: PW })).status === 404);
  step('…and no mail server was touched for any of those', mail.log.smtp.length === 0 && mail.log.imap === 0);
  step('a made-up id is a 404', (await call('POST', '/smtp/connect/nope', { password: PW })).status === 404);
});
await run({ who: { id: 'adm', roles: ['admin'] } }, async ({ call }) => {
  step('an admin of the same organisation may connect a teammate\'s mailbox; of another organisation, never', (await call('GET', '/smtp/info/mbOther')).status === 200 && (await call('GET', '/smtp/info/mbB')).status === 404);
});

// ── what the info says ────────────────────────────────────────────────────────────────────────────────────────────────
await run({}, async ({ call }) => {
  const i = (await call('GET', '/smtp/info/mb1')).body;
  step('a Zoho address is recognised from its mail records, with the Zoho guide and known servers', i.enabled && i.provider.key === 'zoho' && i.servers_known === true && /Zoho/.test(i.guide.title));
});
await run({ mx: ['mail.unknown-host.net'] }, async ({ call }) => {
  const i = (await call('GET', '/smtp/info/mb1')).body;
  step('an unknown provider is said to need typed servers, with a general guide', i.provider.key === 'other' && i.servers_known === false);
});

// ── connecting ────────────────────────────────────────────────────────────────────────────────────────────────────────
await run({}, async ({ call, saved, db, mail }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('everything works: ok, and the four steps are listed in order', r.status === 200 && r.body.ok === true && r.body.steps.map((s) => s.id).join() === 'servers,smtp,imap,test' && r.body.steps.every((s) => s.ok));
  step('the first servers tried are Zoho\'s business ones', mail.log.smtp[0] === 'smtppro.zoho.com');
  step('the test email is sent to the person themselves, carrying a marker', mail.log.sent.length === 1 && mail.log.sent[0].to === 'bea@acme.test' && /^[0-9a-f]{16}$/.test(mail.log.sent[0].headers['X-PACE-Test']));
  step('only now is it SAVED, with the password handed to the (encrypting) store, the chosen servers, and the org', saved.length === 1 && saved[0].password === PW && saved[0].cfg.smtp.host === 'smtppro.zoho.com' && saved[0].orgId === 'orgA' && saved[0].provider === 'zoho');
  const u = db.updates.find((x) => x.id === 'mb1');
  step('the mailbox switches to the app-password type and is active, and its daily limit is NOT touched — it is whatever the admin allowed, like any other mailbox', u && u.set.platform === 'SMTP' && u.set.is_active === true && !('daily_send_limit' in u.set) && r.body.daily_send_limit === 150);
  step('the password is in NO response', !r.text.includes(PW));
  step('the update of the mailbox row is tied to its organisation as well as its id', u.org === 'orgA');
});
await run({}, async ({ db, call }) => {
  db.slots.mb1.daily_send_limit = 20;
  const r20 = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('a limit an admin already set (20) is kept and reported as it is', !('daily_send_limit' in db.updates.find((x) => x.id === 'mb1').set) && r20.body.daily_send_limit === 20);
});
await run({ script: { smtp: (c) => (c.smtp.host === 'smtppro.zoho.com' ? { ok: false, kind: 'auth', message: 'refused' } : { ok: true }) } }, async ({ call, mail, saved }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('a business server that refuses the sign-in falls through to the personal one, and that is the one kept', r.body.ok === true && mail.log.smtp.join() === 'smtppro.zoho.com,smtp.zoho.com' && saved[0].cfg.smtp.host === 'smtp.zoho.com');
});
await run({ script: { smtp: () => ({ ok: false, kind: 'auth', message: 'The outgoing (SMTP) server refused the sign-in. Use an app password (not your normal password) and check the address.' }) } }, async ({ call, saved, db }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('a refused password: not ok, the step says why in plain words, NOTHING saved, mailbox untouched', r.body.ok === false && r.body.steps[r.body.steps.length - 1].id === 'smtp' && /app password/.test(r.body.steps[r.body.steps.length - 1].message) && !saved.length && !db.updates.length);
  step('…and the password is not echoed even then', !r.text.includes(PW));
});
await run({ script: { imap: () => ({ ok: false, kind: 'imap_off', message: 'IMAP is switched off for this mailbox. Turn on IMAP access in the mail settings, then try again.' }) } }, async ({ call, saved }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('sending works but reading does not: NOT connected (a mailbox that cannot read replies would keep mailing people who answered)', r.body.ok === false && r.body.steps.map((s) => s.id).join() === 'servers,smtp,imap' && !saved.length);
});
await run({ script: { marker: () => ({ found: false }) } }, async ({ call, saved }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  const t = r.body.steps.find((s) => s.id === 'test');
  step('a slow test email does not undo the connection: saved, with a warning to check the inbox and spam', r.body.ok === true && t.ok === true && /spam/.test(t.message) && saved.length === 1);
});
await run({ script: { marker: () => ({ found: true, folder: 'Spam' }) } }, async ({ call }) => {
  step('a test email that landed in spam says so', /Spam/.test((await call('POST', '/smtp/connect/mb1', { password: PW })).body.steps.find((s) => s.id === 'test').message));
});
await run({ script: { send: () => { throw new Error('554 blocked using ' + PW); } } }, async ({ call, saved }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('a test email that cannot be sent: not ok, nothing saved, and the password is scrubbed from the error shown', r.body.ok === false && !saved.length && !r.text.includes(PW) && /•••/.test(r.text));
});
await run({ mx: ['mail.unknown-host.net'] }, async ({ call, saved, mail }) => {
  const r = await call('POST', '/smtp/connect/mb1', { password: PW });
  step('an unknown provider with no servers typed: asks for them, touches no server, saves nothing', r.body.ok === false && r.body.steps[0].needs_servers === true && !mail.log.smtp.length && !saved.length);
  const r2 = await call('POST', '/smtp/connect/mb1', { password: PW, smtp_host: 'smtp.unknown-host.net', smtp_port: 587, imap_host: 'imap.unknown-host.net' });
  step('typed servers are used as typed (587 = STARTTLS), and it connects', r2.body.ok === true && mail.log.smtp.includes('smtp.unknown-host.net'));
  const r3 = await call('POST', '/smtp/connect/mb1', { password: PW, smtp_host: 'smtp.unknown-host.net', smtp_port: 25, imap_host: 'imap.unknown-host.net' });
  step('a port that is not a mail-over-TLS port is refused before any connection', r3.body.ok === false && /465 or 587/.test(r3.body.steps[0].message));
});
await run({}, async ({ call }) => {
  step('no password typed: a 400', (await call('POST', '/smtp/connect/mb1', {})).status === 400);
});
await run({ script: { smtp: () => ({ ok: false, kind: 'auth', message: 'refused' }) } }, async ({ call }) => {
  let last;
  for (let i = 0; i < 8; i++) last = await call('POST', '/smtp/connect/mb1', { password: 'guess' + i });
  step('only a few tries are allowed in a short while (this must not become a way to guess a password)', last.status === 429 && /Too many/.test(last.body.message));
});

// ── status and disconnect ────────────────────────────────────────────────────────────────────────────────────────────
await run({ connected: true }, async ({ call, removed, db }) => {
  step('status says connected, without any secret', (await call('GET', '/smtp/status/mb1')).body.connected === true);
  const d = await call('DELETE', '/smtp/mb1');
  step('disconnecting removes the saved connection, switches the mailbox off, and moves its leads', d.status === 200 && removed.join() === 'mb1' && db.updates.some((x) => x.id === 'mb1' && x.set.is_active === false));
  step('someone else\'s mailbox cannot be disconnected (404)', (await call('DELETE', '/smtp/mbOther')).status === 404 && (await call('DELETE', '/smtp/mbB')).status === 404);
});
await run({}, async ({ call }) => {
  step('status of a mailbox with no connection says so', (await call('GET', '/smtp/status/mb1')).body.connected === false);
});

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
