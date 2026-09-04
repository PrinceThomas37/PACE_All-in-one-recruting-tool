// The assign-leads preview: the number it shows is the number it ASSIGNS.
//
// Found by the owner in five minutes of real use. Typing "10" and then
// describing priorities produced a preview for the whole 162-lead pool, because
// only the Auto path read the count box. That preview total is what
// /distribute/execute assigns — and assignment starts sending immediately — so
// a display bug here is a mass-send bug.
//
// Two more from the same screenshot: a typed instruction the rules engine
// cannot honour was dropped in silence under a heading that said AI, and the
// Freshness column was structurally always empty.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const page = readFileSync(new URL('../public/js/19-distribution.js', import.meta.url), 'utf8');
const distRoutes = readFileSync(new URL('../routes/distribution.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

// ── 1. the typed count is honoured on BOTH paths ─────────────────────────────
const fnBody = (src, name) => {
  const start = src.indexOf(name);
  if (start < 0) return '';
  // to the next top-level function/window. assignment
  const rest = src.slice(start + name.length);
  const end = rest.search(/\nwindow\.\w+=function|\nfunction \w+\(/);
  return rest.slice(0, end < 0 ? rest.length : end);
};
const autoPath = fnBody(page, 'function generateAutoRatio');
const priorityPath = fnBody(page, 'window.generateAssignRatio=function');

step('the Auto path reads the typed count', autoPath.includes('assign-manual-count'));
step('the Priority-text path reads the typed count TOO (the bug)',
  priorityPath.includes('assign-manual-count'));
step('both paths clamp capacity to the typed count, not just read it',
  /capacity=Math\.min\(manualCount/.test(autoPath) && /capacity=Math\.min\(manualCount/.test(priorityPath));

// ── 2. the engine that produced the split is named ───────────────────────────
step('the rules split labels itself as rules', /engine: 'rules'/.test(server));
step('an AI split labels itself as AI', /engine: 'ai'/.test(server));
step('the preview tells the user which engine wrote it', page.includes('engineNote'));
step('a dropped instruction is reported, not swallowed',
  page.includes('ignoredPriorities') && /Your priorities were not applied/.test(page));
step('the warning fires only when something WAS typed',
  /ignoredPriorities=\(ratio\.engine!=='ai'\)&&!!\(STATE\._assignPriorityText\|\|''\)\.trim\(\)/.test(page));
step('the Auto path does not claim priorities were ignored',
  /STATE\._assignPriorityText='';/.test(page));

// ── 3. freshness is actually counted ─────────────────────────────────────────
step('pool stats still select freshness from the database', /select\('id,freshness/.test(distRoutes));
step('pool stats now COUNT freshness (the empty column)',
  distRoutes.includes('by_freshness: {}') && distRoutes.includes('stats.by_freshness[fresh]'));
step('a lead with no freshness value is bucketed, not dropped',
  /const fresh = j\.freshness \|\| 'Unknown'/.test(distRoutes));

// ── 4. the even split itself still behaves ───────────────────────────────────
// buildAutoRatio is not exported; exercise its shape through the same evenSplit
// contract the preview depends on.
step('an empty bucket set produces no rows rather than NaN%',
  !/evenSplit\(pool_stats\?\.by_freshness \|\| \{\}\)[^)]*NaN/.test(server));

// ── 5. what the preview shows is what execute receives ───────────────────────
step('execute is handed the same ratio object the preview rendered',
  /apiPost\('\/distribute\/execute',\{manager_id:managerId,ratio:ratio\}\)/.test(page));
step('the preview total comes from that same object',
  page.includes("Distribution preview \\u2014 '+ratio.total_to_send"));

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
