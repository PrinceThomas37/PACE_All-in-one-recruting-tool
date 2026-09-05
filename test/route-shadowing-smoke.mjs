// Pins the fix for a whole CLASS of bug that produces no error anywhere.
//
// Express matches routes IN REGISTRATION ORDER. A literal path registered
// after a `:param` route that also matches it is dead — the param handler
// answers instead, usually with a perfectly valid 200, so nothing logs, the
// browser sees a normal response, and the feature simply appears not to work.
//
// Three of these were live at the same time (found Session 19):
//
//   POST /admin/integrations/ai-test     ← the "Test AI generation" button.
//         POST /admin/integrations/:id answered with the integrations list, so
//         the health card stored that as its diagnosis and drew its "click the
//         button" placeholder. The button did nothing, four sessions running.
//   POST /admin/integrations/email-verify ← the verifier tester, same cause.
//   GET  /jobs/export                     ← the RA lead's CSV export, matched
//         as `/jobs/:id` with id="export".
//
// CLAUDE.md already carries this rule for routes/recruiting/*, which register
// on `app` directly. It is not a recruiting quirk — it is how Express works,
// everywhere. This test therefore checks EVERY router in the repo, so the next
// literal endpoint appended to the bottom of a file fails here rather than in
// production.
//
// Deliberately a source scan, not a booted server: the point is to cover every
// route in the tree, including ones that need a database, an admin session or
// a provider key to reach. A booted probe would test the handful that are easy
// to call, which is not where this bug hides.
//
// Usage: node test/route-shadowing-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'public', 'test', 'migrations', 'docs']);

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// `router.get('/x/:id', …)` / `app.post("/y", …)`. Template literals are
// matched too but skipped below unless they are fully static.
const ROUTE_RE = /\b(?:router|app)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/g;

function routesIn(src) {
  const found = [];
  let m;
  while ((m = ROUTE_RE.exec(src))) {
    const p = m[3];
    if (p.includes('${')) continue;           // an interpolated path is not analysable
    found.push({ method: m[1], path: p, line: src.slice(0, m.index).split('\n').length });
  }
  return found;
}

// Would `earlier` (a path containing at least one :param) swallow `later`?
// A param segment matches any single non-empty segment, which is exactly the
// trap: "/admin/integrations/:id" eats "/admin/integrations/ai-test".
function swallows(earlier, later) {
  if (!earlier.includes(':')) return false;
  if (later.includes(':') || later.includes('*')) return false;
  const rx = new RegExp('^' + earlier
    .split('/')
    .map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\/') + '$');
  return rx.test(later);
}

const files = jsFiles(ROOT);
step('found route files to scan', files.length > 0, files.length + ' .js files');

const shadowed = [];
let routeCount = 0;
for (const file of files) {
  const routes = routesIn(fs.readFileSync(file, 'utf8'));
  routeCount += routes.length;
  for (let i = 0; i < routes.length; i++) {
    for (let j = 0; j < i; j++) {
      const earlier = routes[j], later = routes[i];
      if (earlier.method !== 'all' && earlier.method !== later.method) continue;
      if (!swallows(earlier.path, later.path)) continue;
      shadowed.push({
        file: path.relative(ROOT, file),
        later: `${later.method.toUpperCase()} ${later.path} (line ${later.line})`,
        earlier: `${earlier.method.toUpperCase()} ${earlier.path} (line ${earlier.line})`,
      });
    }
  }
}

step('the scan actually saw routes', routeCount > 100, routeCount + ' routes across the tree');

step('no literal route is shadowed by an earlier :param route', shadowed.length === 0,
  shadowed.length ? shadowed.map(s => `\n         ${s.file}: ${s.later} is never reached — ${s.earlier} matches first`).join('') : 'all reachable');

// The three that were actually broken, named individually, so a regression on
// any one of them fails with the feature's name attached rather than as an
// anonymous entry in a list.
const NAMED = [
  ['routes/integrations.js', 'post', '/admin/integrations/ai-test', 'the "Test AI generation" button'],
  ['routes/integrations.js', 'post', '/admin/integrations/email-verify', 'the email-verifier tester'],
  ['routes/jobs.js', 'get', '/jobs/export', "the RA lead's CSV export"],
];
for (const [file, method, literal, what] of NAMED) {
  const routes = routesIn(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const mine = routes.find(r => r.method === method && r.path === literal);
  const blocker = mine && routes.find(r =>
    r.line < mine.line && (r.method === method || r.method === 'all') && swallows(r.path, literal));
  step(`${method.toUpperCase()} ${literal} is reachable (${what})`, !!mine && !blocker,
    !mine ? 'route not found at all' : blocker ? `shadowed by ${blocker.path} on line ${blocker.line}` : 'registered before any matching :param route');
}

// The scanner has to be able to SEE the bug, or it is a test that always
// passes. Prove it against the exact shape that was live.
step('the scanner detects a known-bad ordering', swallows('/admin/integrations/:id', '/admin/integrations/ai-test'));
step('the scanner does not cry wolf on a deeper path',
  !swallows('/admin/integrations/:id', '/admin/integrations/groq/test'));
step('the scanner does not cry wolf on a different prefix',
  !swallows('/jobs/:id', '/candidates/export'));

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
