// D-0173 (owner, 26 Oct 2026): "Once a lead is assigned it's assigned." Nothing may return an owned lead to the
// Unassigned pool on its own. Only a person does that (bulk stage change). This fails if an automatic sweep comes back.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const read = (f) => readFileSync(join(root, f), 'utf8');

const idx = read('index.js');
step('no engine job returns leads to the pool', !/engineRunner\.register\(\s*'lead_recycle'/.test(idx));
step('no manual "run the recycle sweep" endpoint', !/leads\/recycle/.test(idx));
step('the old decision file is gone', !existsSync(join(root, 'services/lead-recycle.js')));

// Every automatic place that releases a lead to the pool: the only callers are the two human-driven routes.
const callers = [];
const walk = (d) => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
  const rel = d + '/' + e.name;
  if (e.isDirectory()) { if (!['node_modules', 'test', 'docs', '.git', 'public'].includes(e.name)) walk(rel); }
  else if (e.name.endsWith('.js') && /releaseToPoolUpdate\(/.test(read(rel)) && !rel.endsWith('services/outreach-cycle.js')) callers.push(rel);
} };
walk('.'); callers.forEach((c, i) => { callers[i] = c.replace(/^\.\//, ''); });
const ok = ['routes/jobs.js', 'routes/workflows.js'];
step('only the two person-driven routes release a lead to the pool', callers.every(c => ok.includes(c)), callers.join(', '));

const failed = results.filter(r => !r).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
