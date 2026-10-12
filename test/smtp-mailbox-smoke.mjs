// Verifies the APP-PASSWORD MAILBOX (SMTP to send, IMAP to read) — D-0120, R-200 step b. Everything that can be checked here for
// real IS: the password encryption, the "which servers may PACE talk to" rules, and actual sending through a real local SMTP
// server (smtp-server) over STARTTLS. IMAP is driven through a fake client, because there is no IMAP server in this sandbox — so
// the IMAP wire protocol itself is NOT covered; that needs one live test against a real mailbox (see the notes in the PR).
//
// Usage: node test/smtp-mailbox-smoke.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = 'test-secret-smtp';

const secret = require('../services/mailbox-secret.js');
const presets = require('../services/smtp-presets.js');
const { createSmtpMailbox, explain, normalizeParsed } = require('../services/smtp-mailbox.js');
const { createSmtpDelivery, toSendError, htmlToText } = require('../services/smtp-delivery.js');
const { createSmtpStore } = require('../services/smtp-store.js');
const sendRetry = require('../services/send-retry.js');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { SMTPServer } = require('smtp-server');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// ── 1. the password is never stored in clear ───────────────────────────────────────────────────────────────────────────
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const enc = secret.encrypt('s3cret-app-pw', KEY);
step('an encrypted password does not contain the password, and decrypts back', !enc.includes('s3cret') && secret.decrypt(enc, KEY) === 's3cret-app-pw');
step('every encryption is different (a fresh random IV), so equal passwords do not look equal', secret.encrypt('same', KEY) !== secret.encrypt('same', KEY));
step('a changed byte fails to decrypt — it does not decrypt to rubbish', secret.decrypt(enc.slice(0, -3) + 'AAA', KEY) === null);
step('the wrong key fails to decrypt', secret.decrypt(enc, 'ff' + KEY.slice(2)) === null);
step('a value that is not ours decrypts to nothing, never throws', secret.decrypt('hello', KEY) === null && secret.decrypt(null, KEY) === null);
step('a key can be hex or base64, and must be 32 bytes', secret.isConfigured({ MAILBOX_SECRET_KEY: KEY }) && secret.isConfigured({ MAILBOX_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') }) && !secret.isConfigured({ MAILBOX_SECRET_KEY: 'short' }) && !secret.isConfigured({}));
let threw = false; try { secret.encrypt('x', ''); } catch (_) { threw = true; }
step('with no key it REFUSES to encrypt (fails closed — never "store it plain for now")', threw);

// ── 2. which servers, and which PACE refuses ───────────────────────────────────────────────────────────────────────────
const z = presets.candidatesFor({ provider: 'zoho', region: 'in' });
step('Zoho tries the business servers first, then the personal ones, in its own region', z.length === 2 && z[0].smtp.host === 'smtppro.zoho.in' && z[0].imap.host === 'imappro.zoho.in' && z[1].smtp.host === 'smtp.zoho.in' && z[0].smtp.port === 465 && z[0].imap.port === 993);
step('a provider PACE does not know gets NO guess; Microsoft 365 is not offered (it signs in with Microsoft)', presets.candidatesFor({ provider: 'other' }).length === 0 && presets.candidatesFor({ provider: 'microsoft' }).length === 0);
step('typed servers win, and a 465 port means TLS from the first byte', presets.candidatesFor({ provider: 'zoho', typed: { smtp_host: 'SMTP.Example.com', imap_host: 'imap.example.com' } })[0].smtp.host === 'smtp.example.com');
step('the guide for Zoho says app passwords need two-factor, and IMAP must be on', /two-factor/i.test(presets.guideFor('zoho').note) && /IMAP/.test(presets.guideFor('zoho').steps.join(' ')));
for (const [ip, priv] of [['10.1.2.3', true], ['127.0.0.1', true], ['169.254.169.254', true], ['172.16.0.9', true], ['192.168.1.1', true], ['100.64.0.1', true], ['::1', true], ['fd00::1', true], ['fe80::1', true], ['::ffff:10.0.0.1', true], ['8.8.8.8', false], ['2606:4700::1111', false]])
  if (presets.isPrivateAddress(ip) !== priv) step('address ' + ip + ' is ' + (priv ? 'private' : 'public'), false);
step('private, loopback, link-local (cloud metadata), carrier-grade and unique-local addresses are all private; public ones are not', true);
const pub = async () => [{ address: '203.0.113.7', family: 4 }];
step('a normal mail server name resolves to a checked public address', (await presets.safeTarget('smtp.zoho.com', pub)).ip === '203.0.113.7');
step('an IP address typed as a server is refused (a name is required)', !(await presets.safeTarget('10.0.0.5', pub)).ok && !(await presets.safeTarget('203.0.113.7', pub)).ok);
step('a name that points at a PRIVATE address is refused', /private address/.test((await presets.safeTarget('evil.example.com', async () => [{ address: '10.0.0.5' }])).why));
step('…even when only ONE of its addresses is private (a rebinding trick)', !(await presets.safeTarget('evil.example.com', async () => [{ address: '203.0.113.7' }, { address: '169.254.169.254' }])).ok);
step('a name that does not exist is said not to exist', /Could not find/.test((await presets.safeTarget('nope.example.com', async () => { throw new Error('ENOTFOUND'); })).why));
step('odd names (spaces, localhost, a path) are refused', !(await presets.safeTarget('localhost', pub)).ok && !(await presets.safeTarget('a b.example.com', pub)).ok && !(await presets.safeTarget('smtp.example.com/x', pub)).ok);
step('only the mail ports are allowed: SMTP 465/587, IMAP 993', presets.portProblem({ smtp: { port: 465 }, imap: { port: 993 } }) === null && presets.portProblem({ smtp: { port: 587 }, imap: { port: 993 } }) === null && /465 or 587/.test(presets.portProblem({ smtp: { port: 25 }, imap: { port: 993 } })) && /993/.test(presets.portProblem({ smtp: { port: 465 }, imap: { port: 143 } })) && /465 or 587/.test(presets.portProblem({ smtp: { port: 5432 }, imap: { port: 993 } })));

// ── 3. plain words for what went wrong ─────────────────────────────────────────────────────────────────────────────────
step('a refused sign-in says "use an app password", for both SMTP and IMAP', explain({ code: 'EAUTH', message: 'Invalid login: 535 5.7.8 Authentication failed' }, 'smtp').kind === 'auth' && /app password/.test(explain({ message: 'AUTHENTICATIONFAILED Invalid credentials' }, 'imap').message));
step('IMAP switched off, host not found, unreachable, and a bad certificate are told apart', explain({ message: 'IMAP access is not enabled for this account' }, 'imap').kind === 'imap_off' && explain({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }, 'smtp', { host: 'x.example.com' }).kind === 'host' && explain({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }, 'smtp').kind === 'unreachable' && explain({ message: 'self signed certificate' }, 'smtp').kind === 'tls');

// ── 4. a received message, in the shape the sweeps read ────────────────────────────────────────────────────────────────
const RAW_REPLY = ['From: Dana Cole <dana@brazos.example>', 'To: bea@acme.test', 'Subject: Re: Candidates for your Welder role', 'Message-ID: <reply-1@brazos.example>',
  'In-Reply-To: <second@acme.test>', 'References: <root@acme.test> <second@acme.test>', 'Date: Mon, 12 Oct 2026 10:00:00 +0000', 'Content-Type: text/plain; charset=utf-8', '', 'Yes please send the resumes.', ''].join('\r\n');
const reply = normalizeParsed(await simpleParser(RAW_REPLY), { folder: 'INBOX', uid: 7, internalDate: new Date('2026-10-12T10:00:05Z') });
step('a reply is normalised: sender, subject, text, time, and the thread ROOT (first of References)', reply.from.emailAddress.address === 'dana@brazos.example' && reply.subject === 'Re: Candidates for your Welder role' && /send the resumes/.test(reply.bodyPreview) && reply.receivedDateTime === '2026-10-12T10:00:05.000Z' && reply.conversationId === '<root@acme.test>' && reply._provider === 'smtp');
const RAW_NDR = ['From: Mail Delivery Subsystem <mailer-daemon@zoho.com>', 'To: bea@acme.test', 'Subject: Undelivered Mail Returned to Sender', 'Message-ID: <ndr-1@zoho.com>', 'X-Fute-Warmup: 1', 'Content-Type: text/plain', '', 'The following address failed: gone@client.example', ''].join('\r\n');
const ndr = normalizeParsed(await simpleParser(RAW_NDR), { folder: 'INBOX', uid: 8, internalDate: new Date('2026-10-12T11:00:00Z') });
step('the headers the sweeps look for are kept (warm-up marker), and a mail-daemon sender is visible to the NDR rule', ndr.internetMessageHeaders.some((h) => /x-fute-warmup/i.test(h.name)) && /mailer-daemon/.test(ndr.from.emailAddress.address));

// ── 5. a fake IMAP client: folders, the time bound, read-only, a missing folder ───────────────────────────────────────
const MAILS = { INBOX: [{ uid: 1, raw: RAW_REPLY, at: '2026-10-12T10:00:05Z' }, { uid: 2, raw: RAW_NDR.replace('X-Fute-Warmup: 1\r\n', ''), at: '2026-10-01T00:00:00Z' }], Junk: [{ uid: 3, raw: RAW_NDR.replace('X-Fute-Warmup: 1\r\n', ''), at: '2026-10-12T12:00:00Z' }, { uid: 4, raw: ['From: Bea <bea@acme.test>', 'To: bea@acme.test', 'Subject: PACE connection test', 'Message-ID: <t1@acme.test>', 'X-PACE-Test: marker123', '', 'test', ''].join('\r\n'), at: '2026-10-12T12:30:00Z' }] };
let imapLog = [];
class FakeImap {
  constructor(o) { this.o = o; imapLog.push(['new', o.host, o.port, o.secure, o.servername]); this.on = () => {}; }
  async connect() { if (this.o.auth.pass !== 'good-pw') { const e = new Error('Command failed'); e.authenticationFailed = true; e.responseText = 'AUTHENTICATIONFAILED Invalid credentials'; throw e; } imapLog.push(['connect']); }
  async getMailboxLock(folder, opts) { imapLog.push(['lock', folder, opts && opts.readOnly]); if (!MAILS[folder]) throw new Error('no such folder'); this.f = folder; return { release() {} }; }
  async search(q) { if (q.header) { const k = Object.keys(q.header)[0]; return MAILS[this.f].filter((m) => new RegExp(k + ': ' + q.header[k], 'i').test(m.raw)).map((m) => m.uid); } return MAILS[this.f].map((m) => m.uid); }
  async *fetch(uids) { for (const m of MAILS[this.f]) if (uids.includes(m.uid)) yield { uid: m.uid, internalDate: new Date(m.at), source: Buffer.from(m.raw) }; }
  async logout() { imapLog.push(['logout']); }
  close() {}
}
const mbFake = createSmtpMailbox({ nodemailer, ImapFlow: FakeImap, simpleParser, lookup: pub });
const CFG = { smtp: { host: 'smtp.zoho.com', port: 465, secure: true }, imap: { host: 'imap.zoho.com', port: 993 } };
const got = await mbFake.fetchRecent(CFG, { user: 'bea@acme.test', pass: 'good-pw' }, { folders: ['INBOX', 'Junk', 'Spam'], since: new Date('2026-10-10T00:00:00Z') });
step('reading returns messages newer than the bound, newest first, from every folder that exists (a missing "Spam" is skipped, not an error)', got.length === 3 && got[0]._folder === 'Junk' && got[2]._folder === 'INBOX', got.map((g) => g._folder).join());
step('every folder is opened READ-ONLY, and the connection is always closed (nothing is moved, marked or deleted)', imapLog.filter((l) => l[0] === 'lock').every((l) => l[2] === true) && imapLog.filter((l) => l[0] === 'logout').length === 1);
step('the connection goes to the CHECKED address with the name kept for the certificate, over TLS', imapLog[0][1] === '203.0.113.7' && imapLog[0][3] === true && imapLog[0][4] === 'imap.zoho.com');
step('a wrong password on IMAP is reported as a refused sign-in in plain words', (await mbFake.verifyImap(CFG, { user: 'a', pass: 'bad' })).kind === 'auth' && (await mbFake.verifyImap(CFG, { user: 'a', pass: 'good-pw' })).ok === true);
step('the connect test can find its marker message, in the inbox or the junk folder', (await mbFake.findMarker(CFG, { user: 'a', pass: 'good-pw' }, 'marker123', { tries: 1, waitMs: 0 })).found === true && (await mbFake.findMarker(CFG, { user: 'a', pass: 'good-pw' }, 'nothing-like-this', { tries: 1, waitMs: 0 })).found === false);
const priv = createSmtpMailbox({ nodemailer, ImapFlow: FakeImap, simpleParser, lookup: async () => [{ address: '10.0.0.5' }] });
step('a server that resolves to a private address is never connected to (SMTP and IMAP)', /private address/.test((await priv.verifySmtp(CFG, { user: 'a', pass: 'b' })).message) && (await priv.verifyImap(CFG, { user: 'a', pass: 'b' })).ok === false);

// ── 6. REAL sending through a real SMTP server (STARTTLS, login required) ──────────────────────────────────────────────
let lastMail = null, rcptRefuse = null, dropData = false;
const server = new SMTPServer({
  logger: false, authOptional: false, allowInsecureAuth: false, banner: 'test smtp',
  onAuth(auth, session, cb) { return auth.username === 'bea@acme.test' && auth.password === 'good-pw' ? cb(null, { user: 1 }) : cb(new Error('Invalid login: 535 5.7.8 Authentication failed')); },
  onRcptTo(addr, session, cb) { if (rcptRefuse && addr.address === rcptRefuse) { const e = new Error('550 5.1.1 no such user'); e.responseCode = 550; return cb(e); } cb(); },
  onData(stream, session, cb) {
    if (dropData) { stream.on('data', () => {}); stream.once('data', () => { for (const c of server.connections) c._socket.destroy(); }); return; }
    const chunks = []; stream.on('data', (c) => chunks.push(c)); stream.on('end', async () => { lastMail = await simpleParser(Buffer.concat(chunks)); cb(); });
  },
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.server.address().port;
const LOCAL = { smtp: { host: '127.0.0.1', port: PORT, secure: false }, imap: { host: '127.0.0.1', port: 993 } };
const mbReal = createSmtpMailbox({ nodemailer, ImapFlow: FakeImap, simpleParser, allowPrivate: true, tlsOptions: { rejectUnauthorized: false } });
step('sign-in with the right app password works over STARTTLS', (await mbReal.verifySmtp(LOCAL, { user: 'bea@acme.test', pass: 'good-pw' })).ok === true);
const bad = await mbReal.verifySmtp(LOCAL, { user: 'bea@acme.test', pass: 'wrong' });
step('the wrong app password is refused, in plain words', bad.ok === false && bad.kind === 'auth' && /app password/.test(bad.message));

const calls = { outcome: [] };
const store = { get: async () => ({ cfg: LOCAL, creds: { user: 'bea@acme.test', pass: 'good-pw' }, row: { email_address: 'bea@acme.test' } }), outcome: async (id, ok) => { calls.outcome.push(ok); } };
// a tiny database holding the lead's earlier sent email
let priorRow = null;
const fakeDb = { from: () => { const q = { select() { return q; }, eq() { return q; }, not() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return Promise.resolve({ data: priorRow }); } }; return q; } };
const dlv = createSmtpDelivery({ supabase: fakeDb, store, mailbox: mbReal, buildQuote: async () => '<blockquote>the earlier email</blockquote>', makeId: () => 'abc123' });
const SENDING = { email_address: 'bea@acme.test', display_name: 'Bea Smith' };
const first = await dlv.deliver({ job_id: 'J', contact_id: 'C', to_email: 'dana@brazos.example', subject: 'Candidates for your Welder role', followup_type: null }, 'mb1', '<p>Hi Dana, <b>we have people</b>.</p><p>Bea</p>', SENDING);
step('a first email goes out for real: From carries the display name, Message-ID is on the sender\'s own domain', lastMail.from.value[0].name === 'Bea Smith' && lastMail.from.value[0].address === 'bea@acme.test' && lastMail.messageId === '<abc123@acme.test>' && first.graphMessageId === '<abc123@acme.test>');
step('…as HTML with a plain-text twin (better for spam filters), and not a reply', /<b>we have people<\/b>/.test(lastMail.html) && /we have people/.test(lastMail.text) && !lastMail.inReplyTo && first.inReplyTo === null && first.conversationId === '<abc123@acme.test>');
priorRow = { graph_message_id: '<abc123@acme.test>', conversation_id: '<abc123@acme.test>', subject: 'Candidates for your Welder role' };
const dlv2 = createSmtpDelivery({ supabase: fakeDb, store, mailbox: mbReal, buildQuote: async () => '<blockquote>the earlier email</blockquote>', makeId: () => 'def456' });
const fu = await dlv2.deliver({ job_id: 'J', contact_id: 'C', to_email: 'dana@brazos.example', subject: 'Re: Candidates for your Welder role', followup_type: 'fu1' }, 'mb1', '<p>Circling back.</p>', SENDING);
step('a follow-up is a REPLY in the thread: In-Reply-To the earlier email, References, "Re:" kept', lastMail.inReplyTo === '<abc123@acme.test>' && (lastMail.references || []).includes('<abc123@acme.test>') && /^Re:/.test(lastMail.subject) && fu.inReplyTo === '<abc123@acme.test>' && fu.conversationId === '<abc123@acme.test>');
step('…with the earlier email quoted underneath, as on the other providers', /Circling back/.test(lastMail.html) && /the earlier email/.test(lastMail.html) && lastMail.html.indexOf('Circling back') < lastMail.html.indexOf('the earlier email'));
priorRow = { graph_message_id: '<second@acme.test>', conversation_id: '<abc123@acme.test>' };
await createSmtpDelivery({ supabase: fakeDb, store, mailbox: mbReal, buildQuote: async () => '', makeId: () => 'ghi789' }).deliver({ job_id: 'J', contact_id: 'C', to_email: 'dana@brazos.example', subject: 'Re: Candidates for your Welder role', followup_type: 'fu2' }, 'mb1', '<p>Last note.</p>', SENDING);
step('a later follow-up names the thread ROOT then the email it answers', lastMail.inReplyTo === '<second@acme.test>' && (lastMail.references || []).join(' ') === '<abc123@acme.test> <second@acme.test>', JSON.stringify(lastMail.references));
priorRow = null;
await createSmtpDelivery({ supabase: fakeDb, store, mailbox: mbReal, buildQuote: async () => '<blockquote>the earlier email</blockquote>', makeId: () => 'jkl012' }).deliver({ job_id: 'J', contact_id: 'C', to_email: 'dana@brazos.example', subject: 'Re: Candidates for your Welder role', followup_type: 'fu1' }, 'mb1', '<p>Following up.</p>', SENDING);
step('a follow-up with NOTHING to reply to goes out fresh — "Re:" removed, never a fake reply', !lastMail.inReplyTo && lastMail.subject === 'Candidates for your Welder role' && /the earlier email/.test(lastMail.html));
step('a successful send records that the sign-in works', calls.outcome.length >= 4 && calls.outcome.every((o) => o === true));

// ── 7. failures, in the send loop's own vocabulary ─────────────────────────────────────────────────────────────────────
const failStore = { get: async () => ({ cfg: LOCAL, creds: { user: 'bea@acme.test', pass: 'WRONG' }, row: {} }), outcome: async (id, ok) => { calls.outcome.push(ok); } };
let err1; try { await createSmtpDelivery({ supabase: fakeDb, store: failStore, mailbox: mbReal, buildQuote: async () => '' }).deliver({ job_id: 'J', contact_id: 'C', to_email: 'd@x.example', subject: 'Hi' }, 'mb1', '<p>x</p>', SENDING); } catch (e) { err1 = e; }
step('a refused password reads as "sign-in expired": the loop sets the mailbox aside, retries the email later, and the mailbox shows reconnect', err1 && sendRetry.isAuthFailure(err1.message) && sendRetry.classifyFailure(err1.message) === 'temporary' && calls.outcome[calls.outcome.length - 1] === false, err1 && err1.message);
rcptRefuse = 'gone@client.example';
let err2; try { await dlv.deliver({ job_id: 'J', contact_id: 'C', to_email: 'gone@client.example', subject: 'Hi' }, 'mb1', '<p>x</p>', SENDING); } catch (e) { err2 = e; }
step('a rejected RECIPIENT is permanent (a fact about them) and never retried', err2 && sendRetry.classifyFailure(err2.message) === 'permanent', err2 && err2.message);
rcptRefuse = null;
dropData = true;
let err3; try { await dlv.deliver({ job_id: 'J', contact_id: 'C', to_email: 'dana@brazos.example', subject: 'Hi' }, 'mb1', '<p>x</p>', SENDING); } catch (e) { err3 = e; }
step('a connection that DIES while the message is being sent is UNCERTAIN: never retried by itself (it may have been delivered)', err3 && sendRetry.classifyFailure(err3.message) === 'uncertain', err3 && err3.message);
dropData = false;
const closed = createSmtpMailbox({ nodemailer, ImapFlow: FakeImap, simpleParser, allowPrivate: true, tlsOptions: { rejectUnauthorized: false } });
let err4; try { await createSmtpDelivery({ supabase: fakeDb, store: { get: async () => ({ cfg: { smtp: { host: '127.0.0.1', port: 1, secure: false }, imap: LOCAL.imap }, creds: { user: 'a', pass: 'b' }, row: {} }), outcome: async () => {} }, mailbox: closed, buildQuote: async () => '' }).deliver({ job_id: 'J', contact_id: 'C', to_email: 'd@x.example', subject: 'Hi' }, 'mb1', '<p>x</p>', SENDING); } catch (e) { err4 = e; }
step('a server that cannot be reached is TEMPORARY and says nothing was sent (not "may have gone out")', err4 && sendRetry.classifyFailure(err4.message) === 'temporary' && /before anything was sent/.test(err4.message), err4 && err4.message);
step('the mapping alone: a 5xx on the message is "needs a person", a 4xx is busy-try-later', sendRetry.classifyFailure(toSendError({ responseCode: 554, command: 'DATA', response: '554 blocked' }).message) === 'needs_fix' && sendRetry.classifyFailure(toSendError({ responseCode: 451, command: 'DATA', response: '451 try later' }).message) === 'temporary');
step('an error with no detail at all is treated as UNCERTAIN (the safe side of emailing someone twice)', sendRetry.classifyFailure(toSendError({}).message) === 'uncertain');
let noCreds; try { await createSmtpDelivery({ supabase: fakeDb, store: { get: async () => null, outcome: async () => {} }, mailbox: mbReal, buildQuote: async () => '' }).deliver({ to_email: 'a@b.example', subject: 's' }, 'mb1', '<p>x</p>', SENDING); } catch (e) { noCreds = e; }
step('a mailbox with no saved connection fails as "sign-in expired — reconnect", never a crash', noCreds && sendRetry.isAuthFailure(noCreds.message));
step('html → text keeps links readable and line breaks', /Hello\nWorld/.test(htmlToText('<p>Hello</p><p>World</p>')) && /see https:\/\/x\.example\/a/.test(htmlToText('<a href="https://x.example/a">see</a>')) === false && /see \(https:\/\/x\.example\/a\)/.test(htmlToText('<a href="https://x.example/a">see</a>')));
server.close();

// ── 8. the store: encrypted at rest ──────────────────────────────────────────────────────────────────────────────────
const rows = {};
const dbStore = { from: (t) => ({ _t: t, upsert(row) { rows[row.user_email_id] = row; return Promise.resolve({ error: null }); }, select() { return { eq: (k, v) => ({ maybeSingle: () => Promise.resolve({ data: rows[v] || null, error: null }) }) }; }, delete() { return { eq: (k, v) => { delete rows[v]; return Promise.resolve({ error: null }); } }; } }) };
const st = createSmtpStore({ supabase: dbStore, secretKey: KEY });
await st.save({ userEmailId: 'mb9', orgId: 'o1', userId: 'u1', email: 'bea@acme.test', username: 'bea@acme.test', password: 'my-app-pw', cfg: CFG, provider: 'zoho' });
step('what is written to the database holds NO clear password', !JSON.stringify(rows.mb9).includes('my-app-pw') && /^v1\./.test(rows.mb9.password_enc) && rows.mb9.org_id === 'o1');
const back = await st.get('mb9');
step('it is read back decrypted for the moment of connecting, with the servers', back.creds.pass === 'my-app-pw' && back.cfg.smtp.host === 'smtp.zoho.com' && back.cfg.smtp.secure === true && back.cfg.imap.port === 993);
step('a different server key reads it as "unreadable — reconnect", never a crash or a wrong password', (await createSmtpStore({ supabase: dbStore, secretKey: 'ff' + KEY.slice(2) }).get('mb9')).error === 'unreadable');
const noKey = createSmtpStore({ supabase: dbStore, secretKey: '' });
let storeRefused = false; try { await noKey.save({ userEmailId: 'mb10', orgId: 'o', email: 'a@b.c', username: 'a', password: 'p', cfg: CFG }); } catch (_) { storeRefused = true; }
step('with no key on the server nothing can be saved', storeRefused && !rows.mb10);
step('a missing table (migration 063 not applied) reads as "not connected", never an error', (await createSmtpStore({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'relation "smtp_credentials" does not exist' } }) }) }) }) }, secretKey: KEY }).get('x')) === null);

// ── 9. it is wired into the places that decide things ─────────────────────────────────────────────────────────────────
const IDX = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('the send path hands app-password mailboxes to the SMTP delivery', /platform === 'smtp'\)\s*\{\s*return deliverViaSmtp/.test(IDX));
step('a server with no key fails an app-password send plainly ("not configured on the server") instead of trying', /platform === 'smtp' && !mailboxSecret\.isConfigured\(\)/.test(IDX) && sendRetry.classifyFailure('App-password sending is not configured on the server yet') === 'needs_fix');
step('the reply sweep and the bounce sweep both read app-password mailboxes (and skip one whose password was refused)', /sweepSmtpReplies\(t, ownAddresses\)/.test(IDX) && /sweepSmtpBounces\(t, ownAddresses\)/.test(IDX) && (IDX.match(/filter\(t => !t\.refresh_failed\)/g) || []).length >= 2);
step('the bounce rule is ONE function shared by every provider', (IDX.match(/markBouncesFromMessages\(/g) || []).length >= 3);
step('a stored reply is labelled with its provider', /msg\._provider === 'smtp' \? 'smtp'/.test(IDX));
step('mailbox health, the lead-assignment rule and the in-app inbox all know about it', /smtp_credentials/.test(fs.readFileSync(new URL('../mailbox-health.js', import.meta.url), 'utf8')) && /smtp_credentials/.test(fs.readFileSync(new URL('../services/lead-distribution.js', import.meta.url), 'utf8')) && /not_supported/.test(fs.readFileSync(new URL('../routes/mailbox.js', import.meta.url), 'utf8')));
step('health never selects the password column', !/select\('\*'\)\.in\('user_email_id', ids\); sm/.test(fs.readFileSync(new URL('../mailbox-health.js', import.meta.url), 'utf8')) && !/password_enc/.test(fs.readFileSync(new URL('../mailbox-health.js', import.meta.url), 'utf8')));
step('the table is in the migration and in the tenancy registry', /CREATE TABLE IF NOT EXISTS smtp_credentials/.test(fs.readFileSync(new URL('../migrations/063_smtp_credentials.sql', import.meta.url), 'utf8')) && /'smtp_credentials'/.test(fs.readFileSync(new URL('../models/tables.js', import.meta.url), 'utf8')));

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
