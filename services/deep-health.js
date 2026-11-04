'use strict';
// ============================================================================
// "Is the database actually answering?" (R-373, a small first half). /health answers "ok" without touching Supabase, which is right for the
// 30-minute heartbeat and for Render (cheap, never fails because of a slow database). This is the OTHER question, asked on its own path
// (/health/deep) so nobody who only wants "is the server awake" pays for it: one tiny read, bounded in time, and a plain yes / no.
//
// PURE: the read is passed in (`ping`), so the test can make it succeed, fail or hang without a database. Nothing is returned that a stranger
// could use — no error text, no table name — only ok and how long it took.
// shortcut: one table read, one number; upgrade to a cache / queue check when PACE has more dependencies than the database.
// ============================================================================
async function check({ ping, timeoutMs = 4000, now = Date.now } = {}) {
  const t0 = now();
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(ping),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return { ok: true, db: { ok: true, ms: now() - t0 } };
  } catch (_) {
    return { ok: false, db: { ok: false, ms: now() - t0 } };
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { check };
