'use strict';
// THE MEMORY WATCHER (R-291, owner 20 Oct: "No I'm not upgrading. Add a small watcher").
//
// The free server has 512 MB and is killed the moment it goes over. Memory jumps from ~90 MB to 500+ MB within minutes, and
// nothing in the logs says what was running — Render keeps no request log for this service, and a killed process writes no
// last words. So this watches from the inside and writes down, BEFORE the kill:
//   • every few seconds, if memory is above WARN_MB: each request still in flight (method, path with ids masked, how long it has
//     been running, who asked) and each engine job running;
//   • when a request finishes having grown memory by GROW_MB or more: that request, its time and the growth.
// It changes nothing anyone sees and stores nothing — it only logs, and only when something is heavy.
//
// The numbers are technical thresholds for a diagnostic, not limits on a customer (D-0123 does not apply).
//
// PURE where it can be: the clock, the memory reader and the logger are handed in.

const WARN_MB = 380;         // a snapshot of what is running once memory passes this (the limit is 512)
const GROW_MB = 60;          // a single request that grows memory this much is named when it ends
const EVERY_MS = 2000;       // how often memory is looked at
const QUIET_MS = 10000;      // at most one snapshot per this long, so a slow climb is not a flood
const MB = 1024 * 1024;

// A path with anything that could be a secret or an id masked: public token pages (/i/:token, /apply/:token) carry the secret
// in the path itself, and ids are noise for this purpose.
function maskPath(url) {
  return String(url || '').split('?')[0]
    .split('/').map(seg => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^\d+$/.test(seg) || seg.length >= 20 ? ':id' : seg)).join('/')
    .slice(0, 160);
}

function createMemoryWatch({ log = console.warn, rss = () => process.memoryUsage().rss, heap = () => process.memoryUsage().heapUsed,
  now = () => Date.now(), jobs = () => [], warnMb = WARN_MB, growMb = GROW_MB, quietMs = QUIET_MS } = {}) {
  const inFlight = new Map();   // id -> { method, path, at, startRss, req }
  let seq = 0, lastSnapshot = 0;

  // Express middleware: remember the request while it runs; name it if it grew memory a lot.
  function middleware(req, res, next) {
    const id = ++seq;
    const entry = { method: req.method, path: maskPath(req.originalUrl || req.url), at: now(), startRss: rss(), req };
    inFlight.set(id, entry);
    let done = false;
    const end = () => {
      if (done) return; done = true;
      inFlight.delete(id);
      const grew = (rss() - entry.startRss) / MB;
      if (grew >= growMb) {
        log(`[MemWatch] ${entry.method} ${entry.path} grew memory +${Math.round(grew)} MB in ${now() - entry.at} ms (now ${Math.round(rss() / MB)} MB, status ${res.statusCode}, user ${who(req)})`);
      }
    };
    res.on('finish', end);
    res.on('close', end);
    next();
  }

  // One look: above the line, say what is running.
  function check() {
    const r = rss() / MB;
    if (r < warnMb || now() - lastSnapshot < quietMs) return null;
    lastSnapshot = now();
    const reqs = [...inFlight.values()].sort((a, b) => a.at - b.at)
      .map(e => `${e.method} ${e.path} (${Math.round((now() - e.at) / 1000)}s, user ${who(e.req)})`);
    let running = [];
    try { running = jobs() || []; } catch (_) { running = []; }
    const line = `[MemWatch] memory ${Math.round(r)} MB (heap ${Math.round(heap() / MB)} MB) — requests in flight: ${reqs.length ? reqs.join('; ') : 'none'} — engine jobs running: ${running.length ? running.join(', ') : 'none'}`;
    log(line);
    return line;
  }

  let timer = null;
  function start(everyMs = EVERY_MS) {
    if (timer) return;
    timer = setInterval(check, everyMs);
    if (timer.unref) timer.unref();   // never keeps the process alive on its own
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { middleware, check, start, stop, inFlightCount: () => inFlight.size };
}

function who(req) {
  const u = req && req.user;
  return (u && (u.id || u.email)) ? String(u.id || u.email).slice(0, 8) : '-';
}

module.exports = { createMemoryWatch, maskPath, WARN_MB, GROW_MB };
