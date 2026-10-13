// ============================================================================
// A MAILBOX'S DAILY SEND LIMIT — what the admin has allowed (owner, 12 Oct, D-0123).
// ----------------------------------------------------------------------------
// A mailbox starts with the limit the admin set as the default (the `default_daily_send_limit` setting in Admin → System settings, per
// organisation) and an admin can change any one mailbox's limit afterwards. A mailbox with NO number of its own is held to that same default — never to a number typed into the place that checks it. Until an admin chooses, config/limits.js says what to use.
//
// Read through config/settings.js (cached 60 s, per organisation). Never throws: an unreachable database gives the fallback.
// ============================================================================
'use strict';

const { DEFAULT_DAILY_SEND_LIMIT } = require('../config/limits');
const { getSetting } = require('../config/settings');

/** The default daily limit for a mailbox of this ORGANISATION (D-0124): its own choice, else the shared one, else the fallback. */
async function defaultDailyLimit(supabase, orgId) {
  try {
    const n = Math.floor(Number(await getSetting(supabase, 'default_daily_send_limit', orgId || undefined)));
    return n >= 1 ? n : DEFAULT_DAILY_SEND_LIMIT;
  } catch (_) { return DEFAULT_DAILY_SEND_LIMIT; }
}

/** This mailbox's limit: its own number, else the default given. */
function limitOf(mailbox, fallback) {
  const own = Number(mailbox && mailbox.daily_send_limit);
  return own >= 1 ? own : (Number(fallback) >= 1 ? Number(fallback) : DEFAULT_DAILY_SEND_LIMIT);
}

module.exports = { defaultDailyLimit, limitOf, DEFAULT_DAILY_SEND_LIMIT };
