// ============================================================================
// LEAD DISTRIBUTION — the ONE way leads are spread over someone's mailboxes.
// ----------------------------------------------------------------------------
// Until Session 40 this lived inline in `POST /distribute/execute` (admin / RA lead
// hands a pool lead to a BD). The owner (7 Oct, D-0082) then asked for the same thing
// from the BD's side — "A BD takes leads for themselves" (R-148, option A) — and for a
// BD who IMPORTS a list into their own profile (those leads must be theirs, in their
// mailbox, ready to send). Three callers, one rule, so they cannot drift:
//
//   * orderPool(pool)                       freshest-last order the engine has always used
//   * assignmentQueue(accounts, n, rand)    which mailbox gets lead i: proportional to what each
//                                           mailbox can still send today, then shuffled
//   * connectedMailboxesFor(...)            a person's active mailboxes whose sign-in WORKS and
//                                           which still have room today
//   * dayRemaining(cap, taken)              how many a self-serve cap still allows
//
// The pure functions take their randomness as an argument so tests can fix it.
// ============================================================================
'use strict';

const FRESHNESS_ORDER = { Old: 0, Normal: 1, New: 2, '': 3 };

/** Stable copy of the pool in the order leads have always been handed out. */
function orderPool(pool) {
  return [...(pool || [])].sort((a, b) => (FRESHNESS_ORDER[a.freshness] ?? 3) - (FRESHNESS_ORDER[b.freshness] ?? 3));
}

/**
 * For `total` leads, the mailbox id each one goes to. A mailbox's share is proportional to its
 * `remaining` daily allowance; rounding is padded/trimmed to exactly `total`; then the whole queue is
 * shuffled (Fisher-Yates) so the assignment is interleaved, not in blocks.
 */
function assignmentQueue(accounts, total, rand = Math.random) {
  const accs = (accounts || []).filter(a => a && a.remaining > 0);
  if (!accs.length || !(total > 0)) return [];
  const cap = accs.reduce((s, a) => s + a.remaining, 0);
  const queue = [];
  for (const a of accs) {
    const share = Math.round((a.remaining / cap) * total);
    for (let i = 0; i < share; i++) queue.push(a.id);
  }
  while (queue.length < total) queue.push(accs[queue.length % accs.length].id);
  while (queue.length > total) queue.pop();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

/** How many more a per-day self-serve cap allows. A cap of 0 (or less) means the feature is OFF. */
function dayRemaining(cap, taken) {
  const c = Number(cap), t = Number(taken) || 0;
  if (!Number.isFinite(c) || c <= 0) return 0;
  return Math.max(0, Math.floor(c) - Math.max(0, Math.floor(t)));
}

/**
 * A person's active mailboxes that can send today.
 *   withOrg(query)  — the caller's org narrowing (db.forRequest / withOrg)
 *   who             — how to speak about the person in an error: 'Manager' (admin path) or 'You'
 *   ignoreRoom      — skip the "room today" test (see below)
 * Returns { accounts: [{id,email_address,display_name,daily_send_limit,remaining}] } or { error: '<plain words>' }.
 * "Connected" means a token row exists that has not failed its last refresh (Microsoft or Gmail) — a
 * stale token row used to count as connected and silently starved the mailbox.
 */
async function connectedMailboxesFor({ supabase, withOrg, userId, todayStr, who = 'Manager', ignoreRoom = false }) {
  const own = who === 'You';
  const q = supabase.from('user_emails').select('id,email_address,display_name,daily_send_limit').eq('user_id', userId).eq('is_active', true);
  const { data: all } = await (withOrg ? withOrg(q) : q);
  if (!all || !all.length) return { error: own ? 'You have no active email IDs set up yet — add one under Email IDs first.' : `${who} has no active email IDs configured` };
  const ids = all.map(e => e.id);
  const [{ data: ms }, { data: gm }] = await Promise.all([
    supabase.from('microsoft_tokens').select('user_email_id,refresh_failed').in('user_email_id', ids),
    supabase.from('gmail_tokens').select('user_email_id,refresh_failed').in('user_email_id', ids),
  ]);
  const connected = new Set([...(ms || []), ...(gm || [])].filter(t => !t.refresh_failed).map(t => t.user_email_id));
  const working = all.filter(e => connected.has(e.id));
  if (!working.length) return { error: own
    ? 'None of your email IDs is connected and working — connect or reconnect one under Email IDs first.'
    : `${who} has no connected, working email accounts — please connect or reconnect one under Email IDs` };
  // ignoreRoom: owning a lead is not sending an email — an import may be spread over a mailbox whose sending
  // limit for TODAY is used up (the emails simply go on a later day).
  if (ignoreRoom) return { accounts: working.map(a => ({ ...a, remaining: a.daily_send_limit || 150 })) };
  const { data: logs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', todayStr);
  const sent = {}; (logs || []).forEach(l => { sent[l.user_email_id] = l.emails_sent; });
  const accounts = working.map(a => ({ ...a, remaining: (a.daily_send_limit || 150) - (sent[a.id] || 0) })).filter(a => a.remaining > 0);
  if (!accounts.length) return { error: own ? 'All your email IDs have reached today’s sending limit.' : 'All email IDs have reached daily limit' };
  return { accounts };
}

module.exports = { FRESHNESS_ORDER, orderPool, assignmentQueue, dayRemaining, connectedMailboxesFor };
