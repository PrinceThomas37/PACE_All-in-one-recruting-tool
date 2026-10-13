// ============================================================================
// SMTP STORE — a mailbox's app-password connection as it is kept in the database (D-0120, R-200 step b).
// ----------------------------------------------------------------------------
// One row per mailbox in smtp_credentials (migration 063): where its servers are, the login name, and the password ENCRYPTED
// (services/mailbox-secret.js). The password is decrypted only here, only for the instant a connection is opened, and is never
// logged, returned by a route, or put in an error message.
//
// A missing table (migration 063 not applied yet) reads as "no connection", never as an error — the app runs before and after.
// ============================================================================
'use strict';

const secret = require('./mailbox-secret');
const { recordRefreshOutcome } = require('../mailbox-health');

const MISSING_TABLE = /relation .*smtp_credentials.* does not exist|could not find the table/i;

function createSmtpStore({ supabase, secretKey }) {
  const key = () => (secretKey !== undefined ? secret.parseKey(secretKey) : secret.keyFromEnv());

  /**
   * The mailbox's connection, ready to use: { cfg, creds, row }. null = not connected.
   * { error: 'unreadable' } = a row exists but its password cannot be decrypted (the key changed) — the owner must reconnect.
   */
  async function get(userEmailId) {
    const { data, error } = await supabase.from('smtp_credentials').select('*').eq('user_email_id', userEmailId).maybeSingle();
    if (error) { if (MISSING_TABLE.test(error.message || '')) return null; throw error; }
    if (!data) return null;
    const pass = secret.decrypt(data.password_enc, key());
    if (pass == null) return { error: 'unreadable', row: data };
    return {
      cfg: { smtp: { host: data.smtp_host, port: data.smtp_port, secure: data.smtp_secure !== false }, imap: { host: data.imap_host, port: data.imap_port || 993 } },
      creds: { user: data.username, pass },
      row: data,
    };
  }

  async function save({ userEmailId, orgId, userId, email, username, password, cfg, provider }) {
    const enc = secret.encrypt(password, key());
    const row = {
      user_email_id: userEmailId, org_id: orgId, user_id: userId || null, email_address: email, username,
      password_enc: enc, smtp_host: cfg.smtp.host, smtp_port: Number(cfg.smtp.port), smtp_secure: !!cfg.smtp.secure,
      imap_host: cfg.imap.host, imap_port: Number(cfg.imap.port), provider: provider || null,
      refresh_failed: false, last_refresh_error: null, last_refresh_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('smtp_credentials').upsert(row, { onConflict: 'user_email_id' });
    if (error) throw error;
  }

  async function remove(userEmailId) {
    const { error } = await supabase.from('smtp_credentials').delete().eq('user_email_id', userEmailId);
    if (error && !MISSING_TABLE.test(error.message || '')) throw error;
  }

  /** The mailbox's sign-in worked (a send went out, a sweep read the inbox) or was refused. Best effort, never throws. */
  async function outcome(userEmailId, ok, message) {
    await recordRefreshOutcome(supabase, 'smtp_credentials', userEmailId, ok, message);
    if (ok) { try { await supabase.from('smtp_credentials').update({ updated_at: new Date().toISOString() }).eq('user_email_id', userEmailId); } catch (_) { /* a record, not the point */ } }
  }

  /** Every connected mailbox: [{ user_email_id, email_address, org_id }] — what the reply and bounce sweeps walk. */
  async function listConnected() {
    const { data, error } = await supabase.from('smtp_credentials').select('user_email_id,email_address,org_id,refresh_failed');
    if (error) { if (MISSING_TABLE.test(error.message || '')) return []; throw error; }
    return data || [];
  }

  return { get, save, remove, outcome, listConnected };
}

module.exports = { createSmtpStore, MISSING_TABLE };
