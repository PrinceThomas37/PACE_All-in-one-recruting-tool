// ============================================================================
// SMTP / IMAP MAILBOX — the one place PACE opens a connection to a customer's mail servers with an app password
// (D-0120, R-200 step b). Everything above it (the connect screen, the send loop, the reply and bounce sweeps) asks THIS.
// ----------------------------------------------------------------------------
//   send      nodemailer over SMTP — TLS always (465 from the first byte, or 587 with STARTTLS REQUIRED).
//   read      imapflow over IMAP — TLS always (993). Reads only; it never deletes, moves or marks anything. The mailbox stays the
//             customer's: nothing is mirrored into Postgres here.
//   checks    a connect test says exactly WHICH step failed, in plain words (wrong password, IMAP off, server unreachable).
//
// SAFETY. Every server name goes through services/smtp-presets.js safeTarget() first (public addresses only; the connection is made
// to the checked address with the name kept for the certificate). `allowPrivate` / `tlsOptions` exist for TESTS against a local
// server and are not reachable from any route.
//
// Every dependency is injected, so the tests drive these functions with a real local SMTP server and a fake IMAP client.
// ============================================================================
'use strict';

const net = require('net');
const presets = require('./smtp-presets');

const SMTP_TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 45000 };
const IMAP_TIMEOUT_MS = 20000;
const MAX_SOURCE_BYTES = 262144;          // a reply's text is far smaller; a huge attachment is not worth reading

// ── plain words for what went wrong ───────────────────────────────────────────────────────────────────────────────────
/**
 * A connection or login failure → { kind, message }. `where` = 'smtp' | 'imap'.
 * kind: 'auth' (the password/login was refused) · 'host' (name not found) · 'unreachable' · 'tls' · 'imap_off' · 'timeout' · 'other'
 */
function explain(err, where, ctx) {
  const msg = String((err && (err.responseText || err.message)) || err || '');
  const code = String((err && (err.code || err.responseStatus)) || '');
  const low = (msg + ' ' + code).toLowerCase();
  const who = where === 'imap' ? 'incoming (IMAP)' : 'outgoing (SMTP)';
  const host = (ctx && ctx.host) || 'the mail server';
  if (/eauth|invalid login|authentication|auth.*fail|535|534|\bno\b.*login|login failed|invalid credentials|username and password not accepted|authenticationfailed/.test(low))
    return { kind: 'auth', message: 'The ' + who + ' server refused the sign-in. Use an app password (not your normal password) and check the address.' };
  if (/imap.*(disabled|not enabled|access)|\[unavailableimap|imap is not enabled/.test(low))
    return { kind: 'imap_off', message: 'IMAP is switched off for this mailbox. Turn on IMAP access in the mail settings, then try again.' };
  if (/enotfound|eai_again|getaddrinfo/.test(low)) return { kind: 'host', message: 'Could not find ' + host + '. Check the server name.' };
  if (/certificate|self.signed|tls|ssl|handshake|wrong version/.test(low)) return { kind: 'tls', message: 'The ' + who + ' server\'s security certificate was not accepted, so PACE did not connect.' };
  if (/etimedout|timed out|timeout|esocket|econnreset|econnrefused|ehostunreach|enetunreach/.test(low))
    return { kind: 'unreachable', message: 'Could not reach ' + host + '. A firewall may be blocking it, or the port is wrong.' };
  return { kind: 'other', message: 'The ' + who + ' server answered: ' + msg.replace(/\s+/g, ' ').slice(0, 160) };
}

// ── a received message, in the shape the reply and bounce sweeps already read (Microsoft Graph's) ──────────────────────
const KEEP_HEADERS = new Set(['x-fute-warmup', 'auto-submitted', 'in-reply-to', 'references', 'message-id', 'x-pace-test']);
function addrOf(v) {
  const a = v && v.value && v.value[0];
  return a ? { address: String(a.address || '').toLowerCase(), name: a.name || '' } : { address: '', name: '' };
}
function plainSnippet(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280); }
/**
 * `parsed` = mailparser's simpleParser output. → the message shape processInboundMessages / isNdrMessage / isWarmupMessage read.
 * The thread key is the ROOT message id (first of References, else In-Reply-To, else the message's own id) — the same value
 * smtp-delivery stores as emails.conversation_id, so a reply to ours is recognised as belonging to a thread PACE started.
 */
function normalizeParsed(parsed, meta) {
  const p = parsed || {}, m = meta || {};
  const refs = Array.isArray(p.references) ? p.references : (p.references ? [p.references] : []);
  const root = refs[0] || p.inReplyTo || p.messageId || null;
  const headers = [];
  if (p.headerLines) p.headerLines.forEach((h) => { const k = String(h.key || '').toLowerCase(); if (KEEP_HEADERS.has(k)) headers.push({ name: h.key, value: String(h.line || '').replace(/^[^:]*:\s*/, '') }); });
  const html = typeof p.html === 'string' ? p.html : '';
  const text = p.text || '';
  return {
    id: p.messageId || ((m.folder || 'INBOX') + ':' + (m.uid || '')),
    subject: p.subject || '',
    from: { emailAddress: addrOf(p.from) },
    bodyPreview: plainSnippet(text || html.replace(/<[^>]+>/g, ' ')),
    body: { content: html || text },
    receivedDateTime: (m.internalDate ? new Date(m.internalDate) : (p.date || new Date())).toISOString(),
    conversationId: root,
    threadId: root,
    internetMessageHeaders: headers,
    inReplyTo: p.inReplyTo || null,
    _provider: 'smtp',
  };
}

// ── the connections ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * deps: { nodemailer, ImapFlow, simpleParser, lookup?, allowPrivate?, tlsOptions? }
 * cfg:  { smtp:{host,port,secure}, imap:{host,port} }      creds: { user, pass }
 */
function createSmtpMailbox(deps) {
  const d = deps || {};
  const tlsExtra = d.tlsOptions || {};

  async function target(host) {
    if (d.allowPrivate) return { ok: true, host, ip: host };                // tests only
    return presets.safeTarget(host, d.lookup);
  }

  // The certificate NAME: the server's host name. Never an IP address — Node 26 refuses one ("Setting the TLS ServerName to an IP
  // address is not permitted"); a real mail server is always reached by name, so this only matters for a local test server.
  const tlsName = (host) => (net.isIP(host) ? {} : { servername: host });

  function smtpTransport(cfg, creds, t) {
    return d.nodemailer.createTransport(Object.assign({
      host: t.ip, port: Number(cfg.smtp.port), secure: !!cfg.smtp.secure, requireTLS: !cfg.smtp.secure,
      auth: { user: creds.user, pass: creds.pass },
      tls: Object.assign({ minVersion: 'TLSv1.2' }, tlsName(t.host), tlsExtra),
      // no pooling and no automatic retry: a send is attempted ONCE (a retry after an unclear failure could email a person twice)
      pool: false,
    }, SMTP_TIMEOUTS));
  }

  /** Sign in to SMTP and stop (nothing is sent). → { ok } or { ok:false, kind, message } */
  async function verifySmtp(cfg, creds) {
    const pb = presets.portProblem(cfg); if (pb && !d.allowPrivate) return { ok: false, kind: 'other', message: pb };
    const t = await target(cfg.smtp.host); if (!t.ok) return { ok: false, kind: 'host', message: t.why };
    const tr = smtpTransport(cfg, creds, t);
    try { await tr.verify(); return { ok: true }; }
    catch (e) { return Object.assign({ ok: false }, explain(e, 'smtp', { host: cfg.smtp.host })); }
    finally { try { tr.close(); } catch (_) { /* nothing to close */ } }
  }

  /** Send ONE message. Throws the transport's error untouched (smtp-delivery turns it into the send loop's vocabulary). */
  async function sendMail(cfg, creds, message) {
    const t = await target(cfg.smtp.host); if (!t.ok) throw new Error(t.why);
    const tr = smtpTransport(cfg, creds, t);
    try { return await tr.sendMail(message); } finally { try { tr.close(); } catch (_) { /* nothing to close */ } }
  }

  async function withImap(cfg, creds, fn) {
    const pb = presets.portProblem(cfg); if (pb && !d.allowPrivate) throw Object.assign(new Error(pb), { code: 'EPORT' });
    const t = await target(cfg.imap.host); if (!t.ok) throw Object.assign(new Error(t.why), { code: 'ENOTFOUND' });
    const client = new d.ImapFlow({
      host: t.ip, port: Number(cfg.imap.port), secure: true, ...tlsName(t.host),
      auth: { user: creds.user, pass: creds.pass }, logger: false,
      tls: Object.assign({ minVersion: 'TLSv1.2' }, tlsName(t.host), tlsExtra),
      socketTimeout: IMAP_TIMEOUT_MS, connectionTimeout: IMAP_TIMEOUT_MS, greetingTimeout: IMAP_TIMEOUT_MS,
    });
    client.on('error', () => { /* surfaced by the call that was waiting; an unhandled 'error' event would crash the process */ });
    await client.connect();
    try { return await fn(client); }
    finally { try { await client.logout(); } catch (_) { try { client.close(); } catch (__) { /* gone */ } } }
  }

  /** Sign in to IMAP and open the inbox (read-only). → { ok } or { ok:false, kind, message } */
  async function verifyImap(cfg, creds) {
    try {
      await withImap(cfg, creds, async (c) => { const lock = await c.getMailboxLock('INBOX', { readOnly: true }); lock.release(); });
      return { ok: true };
    } catch (e) { return Object.assign({ ok: false }, explain(e, 'imap', { host: cfg.imap.host })); }
  }

  /**
   * Messages that arrived since `since`, newest first, in the shape the sweeps read. Read-only.
   * opts: { folders: ['INBOX', …], since: Date, limit: 50 }. A folder that does not exist is skipped, not an error.
   */
  async function fetchRecent(cfg, creds, opts) {
    const o = opts || {}, folders = o.folders || ['INBOX'], limit = Math.max(1, Math.min(200, o.limit || 50));
    const since = o.since instanceof Date ? o.since : new Date(Date.now() - 7 * 86400000);
    return withImap(cfg, creds, async (c) => {
      const out = [];
      for (const folder of folders) {
        let lock;
        try { lock = await c.getMailboxLock(folder, { readOnly: true }); } catch (_) { continue; }   // no such folder
        try {
          const uids = await c.search({ since }, { uid: true });
          if (!uids || !uids.length) continue;
          const pick = uids.slice(-limit);
          for await (const msg of c.fetch(pick, { uid: true, internalDate: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: true })) {
            try {
              const parsed = await d.simpleParser(msg.source);
              const n = normalizeParsed(parsed, { folder, uid: msg.uid, internalDate: msg.internalDate });
              n._folder = folder;
              if (new Date(n.receivedDateTime) >= since) out.push(n);
            } catch (_) { /* one unreadable message must not end the sweep */ }
          }
        } finally { lock.release(); }
      }
      out.sort((a, b) => (a.receivedDateTime < b.receivedDateTime ? 1 : -1));
      return out;
    });
  }

  /** Is a message carrying this X-PACE-Test marker in the inbox (or junk)? Used by the connect test to prove both directions. */
  async function findMarker(cfg, creds, marker, opts) {
    const o = opts || {}, tries = o.tries || 6, waitMs = o.waitMs == null ? 2500 : o.waitMs;
    for (let i = 0; i < tries; i++) {
      try {
        const found = await withImap(cfg, creds, async (c) => {
          for (const folder of ['INBOX', 'Junk', 'Spam', 'Junk Email']) {
            let lock;
            try { lock = await c.getMailboxLock(folder, { readOnly: true }); } catch (_) { continue; }
            try { const hit = await c.search({ header: { 'x-pace-test': marker } }, { uid: true }); if (hit && hit.length) return folder; }
            finally { lock.release(); }
          }
          return null;
        });
        if (found) return { found: true, folder: found };
      } catch (e) { return { found: false, error: explain(e, 'imap', { host: cfg.imap.host }) }; }
      if (i < tries - 1 && waitMs) await new Promise((r) => setTimeout(r, waitMs));
    }
    return { found: false };
  }

  return { verifySmtp, sendMail, verifyImap, fetchRecent, findMarker };
}

module.exports = { createSmtpMailbox, explain, normalizeParsed, MAX_SOURCE_BYTES };
