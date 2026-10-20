'use strict';
// ONE DATE FORMATTER PER KIND, MADE ONCE (R-298, 20 Oct).
//
// The memory watcher caught it: "Today"'s numbers (/insights/bd) pushed the server from ~170 MB to 542 MB in 20 seconds while the
// JavaScript heap stayed at ~50 MB. The cause was `new Intl.DateTimeFormat(...)` on EVERY row — each one builds an ICU formatter
// in native memory, outside the heap, that is not handed back to the system. Measured: 10,000 calls took the process from 39 MB to
// 367 MB (heap 8 MB) and ~3 s; 50,000 reached 1.2 GB. That is the free server's 512 MB gone on one page load — the out-of-memory
// restarts behind "PACE did not answer properly — the server may be waking up".
//
// So every formatter is made once per (locale, options) and reused. There are only a handful of kinds × the time zones in use,
// so the cache stays tiny. RULE: never write `new Intl.DateTimeFormat` (or toLocale*String with a timeZone) in server code —
// call formatter() / validZone() here. test/date-format-smoke.mjs fails if one appears.

const cache = new Map();

/** A shared Intl.DateTimeFormat for these options. Throws exactly as the constructor would (an unknown zone → RangeError). */
function formatter(locale, options) {
  const key = locale + '|' + JSON.stringify(options || {});
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); cache.set(key, f); }
  return f;
}

const zoneOk = new Map();
/** true when `tz` is a time zone this runtime knows. Remembered per zone (a bad zone is remembered too). */
function isZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  if (zoneOk.has(tz)) return zoneOk.get(tz);
  let ok = false;
  try { formatter('en-US', { timeZone: tz }); ok = true; } catch (_) { ok = false; }
  if (zoneOk.size < 1000) zoneOk.set(tz, ok);   // a caller cannot grow this without bound by sending junk zones
  return ok;
}

module.exports = { formatter, isZone, cacheSize: () => cache.size };
