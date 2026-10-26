'use strict';
// ============================================================================
// THE LEAD LIST IN MEMORY: LOADED ONCE AT A TIME, KEPT UNTIL A LEAD CAN HAVE CHANGED (R-324, 26 Oct).
//
// Render logs, 26 Oct 22:30–22:42 UTC: GET /jobs (the whole company's 2,061 leads with their contacts) took 17–32 s and grew the
// free server by 60–104 MB per call — and during that window Ash's sign-in failed (R-323). Two reasons it reloaded so often:
//   1. EVERY successful POST/PUT/PATCH/DELETE threw the cached list away — a sign-in, a Find Leads search, ticking My Setup,
//      reading mail, a reminder. While people work that is several times a minute, so the cache almost never held.
//   2. Two people asking while the list was being reloaded each started their OWN reload — two copies in memory at once.
// Now:
//   · `writeMayChangeLeads(method, path)` — only a write that can change a lead, its contacts or its company drops the list.
//     It is a list of what is known NOT to touch leads (each checked in its route: none writes jobs/contacts/companies); any
//     path not on it still drops the list, exactly as before, so a new route is safe by default;
//   · `get(orgId)` — one load per organisation at a time; everyone asking meanwhile waits for that same load.
//     A write that lands DURING a load means that load may be stale: its callers still get it (they asked before the write),
//     but it is not kept, and the next caller starts a fresh one.
// Background changes (the send loop, sweeps) are still covered by the TTL, as before.
// ============================================================================

// Writes that cannot change a lead, a contact or a company (path = req.path, no query string).
const NO_LEAD_CHANGE = [
  /^\/auth\//,                                   // sign in, sign out, change password
  /^\/me\/preferences$/,                         // theme and other personal choices
  /^\/my-setup\//,                               // My Setup: send window, sequence, its own reminders
  /^\/mailbox(-scheduled)?\//,                   // the in-app mailbox: read, move, label, draft, send — mail, not leads
  /^\/reminders(\/|$)/,                          // reminders (a reminder BECOMING a lead goes through POST /jobs)
  /^\/next-actions\//,                           // the "needs you today" queue
  /^\/finder\/(find|run|companies\/suggest)$/,   // Find Leads searches: cards, not leads (D-0111 — nothing is a lead until Accept)
  /^\/finder\/searches(\/[^/]+)?(\/run)?$/,      // saved searches and running them
  /^\/finder\/cards\/[^/]+\/(wait|unwait|reject|postings)$/,
];
function writeMayChangeLeads(method, path) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())) return false;
  const p = String(path || '');
  return !NO_LEAD_CHANGE.some((re) => re.test(p));
}

function createLeadListCache({ load, ttlMs, now = () => Date.now() }) {
  const kept = new Map();       // org → { data, at }
  const loading = new Map();    // org → promise of the load in progress
  let gen = 0;                  // moves on every invalidate

  function get(orgId) {
    const key = orgId || '__all__';
    const k = kept.get(key);
    if (k && now() - k.at < ttlMs) return Promise.resolve(k.data);
    if (loading.has(key)) return loading.get(key);
    const startedGen = gen;
    const p = Promise.resolve().then(() => load(orgId)).then((data) => {
      if (startedGen === gen) kept.set(key, { data, at: now() });   // a write landed meanwhile → not kept
      return data;
    }).finally(() => { if (loading.get(key) === p) loading.delete(key); });
    loading.set(key, p);
    return p;
  }
  function invalidate() { gen++; kept.clear(); loading.clear(); }
  return { get, invalidate, _state: () => ({ kept: kept.size, loading: loading.size, gen }) };
}

module.exports = { createLeadListCache, writeMayChangeLeads, NO_LEAD_CHANGE };
