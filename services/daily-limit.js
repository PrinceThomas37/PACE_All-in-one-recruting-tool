// ============================================================================
// A MAILBOX'S DAILY SEND LIMIT — what the admin has allowed (owner, 12 Oct, D-0123).
// ----------------------------------------------------------------------------
// A mailbox starts with the limit the admin set as the default (app_settings `default_daily_send_limit`, edited under Admin → Email
// Engine Schedule) and an admin can change any one mailbox's limit afterwards. A mailbox with NO number of its own is held to that
// same default — never to a number typed into the place that checks it. Until an admin chooses, config/limits.js says what to use.
//
// One cached read (60 s), so asking is cheap anywhere. Never throws: an unreachable database gives the fallback, never a failure.
// ============================================================================
'use strict';

const { DEFAULT_DAILY_SEND_LIMIT } = require('../config/limits');
const KEY = 'default_daily_send_limit';
const TTL_MS = 60 * 1000;
let cache = { at: 0, value: DEFAULT_DAILY_SEND_LIMIT };

/** The admin's default daily limit for a mailbox. */
async function defaultDailyLimit(supabase, now) {
  const t = now == null ? Date.now() : now;
  if (t - cache.at < TTL_MS) return cache.value;
  let v = DEFAULT_DAILY_SEND_LIMIT;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    const n = parseInt(data && data.value, 10);
    if (Number.isFinite(n) && n >= 1) v = n;
  } catch (_) { /* keep the fallback */ }
  cache = { at: t, value: v };
  return v;
}

/** This mailbox's limit: its own number, else the default given. */
function limitOf(mailbox, fallback) {
  const own = Number(mailbox && mailbox.daily_send_limit);
  return own >= 1 ? own : (Number(fallback) >= 1 ? Number(fallback) : DEFAULT_DAILY_SEND_LIMIT);
}

function resetCache() { cache = { at: -Infinity, value: DEFAULT_DAILY_SEND_LIMIT }; }

module.exports = { defaultDailyLimit, limitOf, resetCache, DEFAULT_DAILY_SEND_LIMIT };
