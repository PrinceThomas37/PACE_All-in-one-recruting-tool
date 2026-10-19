// ADMIN → SYSTEM SETTINGS OPENS (R-266). The owner (19 Oct) clicked System Settings and saw "Failed to load settings:
// ctx.orgOf is not a function": routes/settings.js asked for the caller's organisation through a function the server never
// passes (it passes ctx.orgIdFor). The same helper also reads the company's follow-up limit. This mounts the REAL router with
// the context the server really gives it and asks for the admin numbers and the follow-up limit as an admin.
// Usage: node test/settings-org-smoke.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };

// A database that answers every question with "nothing saved", and records which organisation was asked about.
const asked = [];
function chain() {
  const res = { data: null, error: null };
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (ok, bad) => Promise.resolve({ ...res, data: [] }).then(ok, bad);
      if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve(res);
      return (...a) => { if (k === 'eq' || k === 'in') asked.push(a); return p; };
    },
    apply() { return p; },
  });
  return p;
}
const supabase = { from: () => chain(), rpc: () => Promise.resolve({ data: null, error: null }) };
const ctx = {
  supabase,
  auth: (req, _res, next) => { req.user = { id: 'u1', org_id: 'org-1', role: 'admin', roles: ['admin'] }; next(); },
  hasRole: (req, ...r) => r.some((x) => (req.user.roles || []).includes(x)),
  orgIdFor: (req) => (req && req.user && req.user.org_id) || null,   // exactly what index.js passes
};
const app = express(); app.use(express.json());
const mounted = require('../routes/settings.js')(ctx);
app.use(mounted && mounted.stack ? mounted : (mounted && mounted.router) || mounted);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const r = await fetch(base + '/admin/settings/numbers');
  const body = await r.text();
  step('System Settings answers 200 for an admin', r.status === 200, r.status + ' ' + body.slice(0, 160));
  step('…and never says "is not a function"', !/is not a function/.test(body), body.slice(0, 160));
  let list = []; try { list = JSON.parse(body); } catch (_) {}
  step('…and lists the settings', Array.isArray(list) && list.length > 0, 'got ' + (Array.isArray(list) ? list.length : typeof list));
  step('the caller\'s organisation was the one asked about', JSON.stringify(asked).includes('@org-1'), JSON.stringify(asked.slice(0, 4)));
} finally { server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
