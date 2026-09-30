'use strict';
// "WHAT WENT WRONG" — the server reports its own crashes (owner, 2026-09-30, R-090).
//
// A smoke detector, not a detective: when code throws and nobody caught it, the server tells
// Sentry WHAT failed and WHERE (file and line). No AI is needed to notice; the explaining and
// the fixing happen when a person (or a session) opens the report.
//
// Rules this file keeps:
//   * OFF unless SENTRY_DSN is set — the app runs identically without it, and so do the tests.
//   * NOTHING PERSONAL LEAVES: no request bodies, no cookies, no auth headers, no query strings
//     (they carry tokens — /i/:token, /apply/:token are secrets), no user, no email addresses.
//   * Errors only: no performance tracing (spend nothing, and less data leaves).
//   * Never throws: a reporter that can crash the server is worse than none.

const SECRET_KEYS = /authorization|cookie|token|secret|password|api[-_]?key|x-api-key/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Pure: takes a Sentry event, returns it with everything personal removed.
function scrub(event) {
  if (!event || typeof event !== 'object') return event;
  const e = event;
  if (e.request) {
    delete e.request.data; delete e.request.cookies; delete e.request.query_string;
    if (e.request.headers) for (const k of Object.keys(e.request.headers)) if (SECRET_KEYS.test(k)) delete e.request.headers[k];
    if (typeof e.request.url === 'string') e.request.url = e.request.url.split('?')[0]
      .replace(/\/(i|apply)\/[^/]+/i, '/$1/:token');
  }
  delete e.user;
  if (e.message) e.message = String(e.message).replace(EMAIL, "[email]");
  for (const ex of (e.exception && e.exception.values) || []) if (ex.value) ex.value = String(ex.value).replace(EMAIL, '[email]');
  return e;
}

let sentry = null;

function init(env = process.env, load = () => require('@sentry/node')) {
  if (!env.SENTRY_DSN) return false;
  try {
    const S = load();
    S.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV || 'production', sendDefaultPii: false,
             tracesSampleRate: 0, beforeSend: scrub });
    sentry = S;
    return true;
  } catch (e) { console.error('[error-report] could not start:', e && e.message); sentry = null; return false; }
}

// Call AFTER every route is registered, so a throw in any route is reported.
function attachErrorHandler(app) {
  if (!sentry || !app) return false;
  try { sentry.setupExpressErrorHandler(app); return true; } catch (_) { return false; }
}

// For a failure that was caught but the owner should still hear about.
function report(err, where) {
  if (!sentry) return false;
  try { sentry.withScope(s => { if (where) s.setTag('where', String(where)); sentry.captureException(err); }); return true; } catch (_) { return false; }
}

module.exports = { init, attachErrorHandler, report, scrub };
