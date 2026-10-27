// R-332 (27 Oct 2026) — "I set the bounce limit to 10% and it still paused": an admin's number is saved for THEIR company
// (sys_<key>@<org>), and a reader that does not say which company gets the shared default instead. That was true of a dozen
// places. This is the convention pinned: every getSetting() names the company it is for.
//
// The only exception is a number that genuinely has no single company (listed below, each with why). A new one needs a reason
// written here — "forgot" is not one.
import fs from 'node:fs';
import path from 'node:path';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SKIP = new Set(['node_modules', 'test', 'scripts', '.git', 'public', 'docs', 'migrations', 'website']);
const ALLOWED = {
  wf_tick_batch: 'one workflow tick works through every company\'s due enrollments together — no single company (belongs with the operator, R-332)',
};
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith('.js') && !p.endsWith(path.join('config', 'settings.js'))) yield p;
  }
}
const bare = [];
let seen = 0;
for (const f of files(ROOT)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/getSetting\(\s*[A-Za-z_.$]+\s*,\s*'([a-z0-9_]+)'\s*(\)|,\s*[^)]*\))/g)) {
    seen++;
    const hasThird = m[2] !== ')';
    if (!hasThird && !ALLOWED[m[1]]) bare.push(path.relative(ROOT, f) + ' → ' + m[1]);
  }
}
step('the scan really found the readers (a probe that sees nothing proves nothing)', seen > 30, String(seen));
step('every setting read names the company it is for', bare.length === 0, bare.join('; '));
step('the allowed exceptions are still real (a stale allow-list hides the next mistake)', Object.keys(ALLOWED).every((k) => {
  for (const f of files(ROOT)) if (new RegExp(`getSetting\\([^)]*'${k}'\\s*\\)`).test(fs.readFileSync(f, 'utf8'))) return true;
  return false;
}));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
