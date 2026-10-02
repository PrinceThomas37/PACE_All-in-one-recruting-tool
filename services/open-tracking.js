'use strict';
// OPEN TRACKING — DID THE RECIPIENT OPEN IT? (R-110, D-0068)
//
// The owner (2026-10-02): "the email should only be tracked if the to address
// opens the email, not us. Even I can open the sent emails to see how it looks,
// and I think now the system tracks that too."
//
// It did. The pixel route counted EVERY request for the image: the sender
// reading their Sent folder, a security scanner that fetches images the moment
// mail arrives, Apple Mail pre-loading for its user. A pixel cannot say who
// opened a message — it carries only a time, a network address and the type of
// mail app — so this is an APPROXIMATION, said as one on screen. Each hit is
// sorted into one of four kinds and only the last counts:
//
//   sender     the request came from a network address the sender has recently
//              used to sign in to PACE (stored as a salted hash, never raw)
//   machine    no user agent, or one that names a scanner/bot/library
//   early      inside the first two minutes after the send: the sender checking
//              what went out, or a scanner/prefetch reading it on arrival
//   recipient  none of the above — counted as an open
//
// Known gaps, deliberate and stated: a sender who opens their own copy from a
// phone or a new network, or from Gmail (whose image proxy hides the address),
// is counted as a recipient. Outlook blocks images by default, so some real
// opens are never seen. Google's image proxy is NOT treated as a machine: it
// fetches when somebody opens the message, so for a Gmail recipient it IS the
// open.
//
// PURE where it can be (classifyOpen, readLevel, mergeSeenIps, hashIp) —
// callable and tested; the factory below adds the database, with every call
// best-effort: tracking must never fail a send or a pixel.
const crypto = require('crypto');
const { newToken } = require('../email-tracking');

const EARLY_MS = 2 * 60 * 1000;
const READ_AGAIN_MS = 60 * 1000;            // "likely read" = opened again at least a minute later
const SENDER_IP_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SENDER_IPS = 8;
const NOTE_IP_EVERY_MS = 10 * 60 * 1000;    // one look per person+address per ten minutes
const REFRESH_ENTRY_MS = 24 * 3600 * 1000;  // …and a write only when the entry is new or a day old
const ENABLED_CACHE_MS = 60 * 1000;
const SETTING_USERS = 'open_tracking_users';  // 'all' | JSON array of user ids | absent = nobody

// A user agent that names a scanner, bot or HTTP library. Empty counts too.
const BOT_UA_RE = /bot\b|spider|crawl|scan|curl\/|wget|python|java\/|go-http|libwww|headless|phantom|proofpoint|mimecast|barracuda|zscaler|symantec|sophos|forcepoint|fireeye|ironport|safelinks|defender|trendmicro/i;
const isMachineUa = (ua) => { const s = String(ua || '').trim(); return !s || BOT_UA_RE.test(s); };

// One address, one comparable string: strip the IPv4-in-IPv6 prefix, and keep
// only the first 64 bits of an IPv6 address (a device's own suffix rotates).
function normIp(ip) {
  let s = String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!s) return '';
  if (s.includes(':')) s = s.split(':').slice(0, 4).join(':');
  return s;
}
function hashIp(ip, secret) {
  const n = normIp(ip);
  if (!n) return '';
  return crypto.createHash('sha256').update(String(secret || '') + '|' + n).digest('hex').slice(0, 16);
}

// The sender's recently seen address hashes, newest first, bounded and expiring.
function mergeSeenIps(list, hash, now) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const keep = (Array.isArray(list) ? list : [])
    .filter(x => x && x.h && Number.isFinite(x.at) && t - x.at < SENDER_IP_TTL_MS && x.h !== hash);
  if (hash) keep.unshift({ h: hash, at: t });
  return keep.slice(0, MAX_SENDER_IPS);
}

// → { kind: 'sender' | 'machine' | 'early' | 'recipient', reason }
function classifyOpen({ now, sentAt, ua, ipHash, senderIpHashes }) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  if (ipHash && (senderIpHashes || []).includes(ipHash)) return { kind: 'sender', reason: 'the sender\'s own network' };
  if (isMachineUa(ua)) return { kind: 'machine', reason: String(ua || '').trim() ? 'a scanner or bot' : 'no user agent' };
  const s = sentAt ? new Date(sentAt).getTime() : NaN;
  if (Number.isFinite(s) && t - s < EARLY_MS) return { kind: 'early', reason: 'within two minutes of sending' };
  return { kind: 'recipient', reason: '' };
}

// What a tracked email's counters say, in the words the screen uses.
//   opened       at least one recipient-looking open
//   likely_read  opened, and again at least a minute after the first time
function readLevel(row) {
  const count = Number(row && row.open_count) || 0;
  const first = row && row.opened_at ? new Date(row.opened_at).getTime() : NaN;
  const last = row && row.last_open_at ? new Date(row.last_open_at).getTime() : NaN;
  const opened = count > 0;
  const likelyRead = count >= 2 && Number.isFinite(first) && Number.isFinite(last) && last - first >= READ_AGAIN_MS;
  return { opened, likely_read: likelyRead, count, first_at: opened ? row.opened_at : null, last_at: opened ? row.last_open_at : null };
}

// Who has tracking switched on? 'all' | an array of user ids | nobody.
function enabledFromSetting(value, userId) {
  if (!userId) return false;
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (v.toLowerCase() === 'all' || v === '"all"') return true;
  try { const a = JSON.parse(v); return Array.isArray(a) && a.includes(userId); } catch (_) { return false; }
}

module.exports = function createOpenTracking({ supabase, secret, now = () => new Date() } = {}) {
  const salt = secret || process.env.JWT_SECRET || 'pace';
  const lastNoted = new Map();   // userId|hash -> ms
  let enabledCache = { at: 0, value: '' };

  async function settingValue() {
    const t = now().getTime();
    if (t - enabledCache.at < ENABLED_CACHE_MS) return enabledCache.value;
    let value = '';
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', SETTING_USERS).maybeSingle();
      value = data && data.value != null ? String(data.value) : '';
    } catch (_) { value = ''; }
    enabledCache = { at: t, value };
    return value;
  }
  const enabledFor = async (userId) => enabledFromSetting(await settingValue(), userId);

  async function seenIps(userId) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', `u_${userId}_seen_ips`).maybeSingle();
      const list = data && data.value ? JSON.parse(data.value) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }

  // Called (not awaited) when a signed-in person makes a request: remember the
  // network they are on, so their own opens of what they sent can be told apart.
  // For EVERYONE — the candidate emails carry the same pixel, and the owner's
  // complaint was about all of it. Cheap by construction: one look per person
  // and address per ten minutes, and a write only when the address is new or its
  // entry is over a day old.
  async function noteSenderIp(userId, ip) {
    try {
      if (!userId || !ip) return;
      const h = hashIp(ip, salt);
      if (!h) return;
      const t = now().getTime();
      const key = userId + '|' + h;
      if (t - (lastNoted.get(key) || 0) < NOTE_IP_EVERY_MS) return;
      lastNoted.set(key, t);
      if (lastNoted.size > 5000) lastNoted.clear();
      const list = await seenIps(userId);
      const known = list.find(x => x && x.h === h);
      if (known && t - known.at < REFRESH_ENTRY_MS) return;
      await supabase.from('app_settings').upsert(
        { key: `u_${userId}_seen_ips`, value: JSON.stringify(mergeSeenIps(list, h, t)), updated_at: now() }, { onConflict: 'key' });
    } catch (_) { /* never in the way of a request */ }
  }

  // Before a leads-engine email goes out: if tracking is on for its sender,
  // return the token for the pixel (reusing the row if this email was tried
  // before). null = send it untracked, exactly as before.
  async function prepareLeadTracking({ email, sendingEmail }) {
    try {
      const sender = email && email.sent_by;
      if (!sender || !email.id || !(await enabledFor(sender))) return null;
      const { data: existing } = await supabase.from('email_tracking').select('token').eq('email_id', email.id).limit(1);
      if (existing && existing[0] && existing[0].token) return existing[0].token;
      const token = newToken();
      const { error } = await supabase.from('email_tracking').insert({
        token, channel: 'lead_outreach', lead_id: email.job_id || null, contact_id: email.contact_id || null, email_id: email.id,
        to_email: email.to_email || null, subject: email.subject || null, sent_by: sender,
        mailbox_email: (sendingEmail && sendingEmail.email_address) || email.from_email || null,
        ...(email.org_id ? { org_id: email.org_id } : {}),
      });
      return error ? null : token;   // no row, no pixel: an untracked send beats an uncountable one
    } catch (_) { return null; }
  }

  // The pixel was requested. Count it only if it looks like the recipient.
  async function recordOpen({ token, ip, ua }) {
    if (!token) return null;
    const { data: row } = await supabase.from('email_tracking')
      .select('id,sent_at,sent_by,open_count,opened_at,ignored_open_count').eq('token', token).maybeSingle();
    if (!row) return null;
    const t = now();
    const ipHash = hashIp(ip, salt);
    const verdict = classifyOpen({ now: t, sentAt: row.sent_at, ua, ipHash, senderIpHashes: (await seenIps(row.sent_by)).map(x => x && x.h) });
    if (verdict.kind === 'recipient') {
      await supabase.from('email_tracking').update({
        open_count: (row.open_count || 0) + 1, opened_at: row.opened_at || t, last_open_at: t,
      }).eq('id', row.id);
    } else {
      await supabase.from('email_tracking').update({
        ignored_open_count: (row.ignored_open_count || 0) + 1, last_ignored_reason: verdict.kind,
      }).eq('id', row.id);
    }
    return verdict;
  }

  return { enabledFor, noteSenderIp, prepareLeadTracking, recordOpen, seenIps };
};

Object.assign(module.exports, {
  classifyOpen, readLevel, mergeSeenIps, hashIp, normIp, isMachineUa, enabledFromSetting,
  EARLY_MS, READ_AGAIN_MS, MAX_SENDER_IPS, SETTING_USERS,
});
