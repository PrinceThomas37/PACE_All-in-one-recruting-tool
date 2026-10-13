// ============================================================================
// MAILBOX SECRET — encrypting an app password before it is stored (D-0120, R-200 step b).
// ----------------------------------------------------------------------------
// A customer's mailbox password is the most sensitive thing PACE will ever hold: with it, anyone can read that person's mail.
// So it is never stored in clear. AES-256-GCM (an authenticated cipher: a changed byte fails to decrypt rather than decrypting
// to rubbish), a fresh random IV for every value, and a key that lives ONLY in the server's environment (MAILBOX_SECRET_KEY) —
// never in the database, so a copy of the database alone reveals nothing.
//
// FAILS CLOSED. With no key set, nothing can be encrypted, so nothing is connected with a password and the screen says so — the
// alternative (storing it unencrypted "for now") is not on offer.
//
// The key: 32 random bytes, written as 64 hex characters or as base64. Make one with:  openssl rand -hex 32
// Losing or changing the key makes every stored password unreadable; each mailbox then shows "reconnect" and its owner types the
// app password again — nothing else is lost.
// ============================================================================
'use strict';

const crypto = require('crypto');
const VERSION = 'v1';

/** The key bytes from a hex or base64 string, or null when it is missing or not 32 bytes. */
function parseKey(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) buf = Buffer.from(s, 'hex');
  else { try { const b = Buffer.from(s, 'base64'); if (b.length === 32) buf = b; } catch (_) { buf = null; } }
  return buf && buf.length === 32 ? buf : null;
}

function keyFromEnv(env) { return parseKey((env || process.env).MAILBOX_SECRET_KEY); }
/** Is the server able to hold app passwords at all? */
function isConfigured(env) { return !!keyFromEnv(env); }

function encrypt(plain, key) {
  const k = Buffer.isBuffer(key) ? key : parseKey(key);
  if (!k) throw new Error('MAILBOX_SECRET_KEY is not set (or is not 32 bytes), so a password cannot be stored.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

/** The password back, or null when the value is not ours, was changed, or the key is not the one it was made with. Never throws. */
function decrypt(blob, key) {
  try {
    const k = Buffer.isBuffer(key) ? key : parseKey(key);
    if (!k) return null;
    const parts = String(blob || '').split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(parts[1], 'base64'));
    d.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

module.exports = { parseKey, keyFromEnv, isConfigured, encrypt, decrypt };
