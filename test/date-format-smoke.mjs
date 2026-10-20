// ONE DATE FORMATTER PER KIND (R-298, 20 Oct). The memory watcher showed "Today"'s numbers (/insights/bd) taking the server from
// ~170 MB to 542 MB in 20 s with the JavaScript heap at ~50 MB: `new Intl.DateTimeFormat` on every row builds a native ICU
// formatter that is never handed back. 10,000 calls = 39 → 367 MB. services/date-format.js makes each kind once. Pinned here:
//   • 50,000 day conversions through the real bd-insights code barely move the process's memory (the bug: ~1.2 GB);
//   • the answers are unchanged (viewer's day, bad zone → UTC, interview wording);
//   • no server file builds a formatter per call again (new Intl.DateTimeFormat / toLocale*String with a timeZone).
// Usage: node test/date-format-smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 300) : '')); };
const df = require('../services/date-format.js');
const bd = require('../services/bd-insights.js');
const iv = require('../services/interview-time.js');
const vt = require('../services/viewer-time.js');
const MB = 1024 * 1024;

// The answers.
ok('the viewer\'s day: 20:00 UTC on 20 Oct is 21 Oct in Kolkata, 20 Oct in Los Angeles',
  bd.localDay('2026-10-20T20:00:00Z', 'Asia/Kolkata') === '2026-10-21' && bd.localDay('2026-10-20T20:00:00Z', 'America/Los_Angeles') === '2026-10-20');
ok('an unknown zone is UTC; a real one is kept', bd.validZone('Mars/Olympus') === 'UTC' && bd.validZone('Asia/Kolkata') === 'Asia/Kolkata' && bd.validZone('') === 'UTC');
const direct = new Date('2026-10-22T04:30:00Z').toLocaleString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'long' }).replace(/[  ]/g, ' ');
const fmt = iv.formatInterview('2026-10-22T04:30:00Z', 'Asia/Kolkata');
ok('the interview wording is the same as before', fmt.startsWith(direct), fmt + ' | ' + direct);
ok('the viewer windows still work', vt.windowsFor(Date.parse('2026-10-20T20:00:00Z'), 'Asia/Kolkata').today === '2026-10-21');

// The memory.
global.gc && global.gc();
const before = process.memoryUsage().rss;
const t0 = Date.now();
for (let i = 0; i < 50000; i++) bd.localDay(new Date(t0 - i * 60000).toISOString(), i % 2 ? 'Asia/Kolkata' : 'America/Chicago');
const grew = (process.memoryUsage().rss - before) / MB, ms = Date.now() - t0;
ok('50,000 day conversions grow the process by under 40 MB (the per-row formatters took ~1.2 GB)', grew < 40, `grew ${Math.round(grew)} MB in ${ms} ms`);
ok('…and take under 3 seconds (they took ~11)', ms < 3000, `${ms} ms`);
ok('the shared formatters stay few', df.cacheSize() < 50, String(df.cacheSize()));

// No server file builds one per call again.
const root = path.resolve(new URL('..', import.meta.url).pathname);
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p);
  if (st.isDirectory()) { if (!['node_modules', 'public', 'test', '.git', 'docs', 'scripts'].includes(f)) walk(p); } else if (f.endsWith('.js')) files.push(p); } };
walk(root);
const offenders = files.filter(p => !p.endsWith(path.join('services', 'date-format.js'))).filter(p => {
  const s = fs.readFileSync(p, 'utf8');
  return /new Intl\.DateTimeFormat\s*\(/.test(s) || /toLocale(?:Date|Time)?String\([^)]*\{[^}]*timeZone/.test(s);
}).map(p => path.relative(root, p));
ok('no server file makes a date formatter per call (use services/date-format.js)', offenders.length === 0, offenders.join(', '));

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
