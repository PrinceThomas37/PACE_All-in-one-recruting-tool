// Runs every test/*.mjs suite and reports one summary.  `npm test`
//
// Why this exists: the suites print their results in two different formats
// (some end with "RESULT: PASS", some only with "SUMMARY: n/n passed"), so
// grepping stdout for a pass marker silently mis-reports whole suites as
// failures. Exit codes are the only reliable signal — every suite already ends
// with process.exit(failed ? 1 : 0) — so that is what this runner uses.
//
// The 17 Playwright suites need `playwright-core` (a devDependency) and a
// browser at $PLAYWRIGHT_BROWSERS_PATH. When those are missing the run says so
// plainly instead of reporting a wall of unrelated failures.

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const PER_SUITE_TIMEOUT_MS = 240000;

const suites = readdirSync(testDir)
  .filter(f => f.endsWith('.mjs') && f !== 'run-all.mjs')
  .filter(f => !only.length || only.some(o => f.includes(o)))
  .sort();

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(testDir, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, PER_SUITE_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      // Suites report "SUMMARY: 12/12 passed" — surface the counts when present.
      const counts = (out.match(/SUMMARY:\s*(\d+)\/(\d+)/) || [])[0] || '';
      resolve({ file, ok: code === 0, ms: Date.now() - started, counts, out });
    });
  });
}

const results = [];
for (const file of suites) {
  const r = await runSuite(file);
  results.push(r);
  const label = r.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${label}  ${file.padEnd(36)} ${String(r.ms + 'ms').padStart(8)}  ${r.counts}`);
}

const failed = results.filter(r => !r.ok);

if (failed.length) {
  const missingPw = failed.filter(r => /Cannot find package 'playwright-core'/.test(r.out));
  if (missingPw.length) {
    console.log(`\n\x1b[33m${missingPw.length} suite(s) need playwright-core.\x1b[0m`);
    console.log('  npm install --no-save playwright-core');
    console.log('  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers');
  }
  for (const r of failed.filter(r => !/Cannot find package 'playwright-core'/.test(r.out))) {
    console.log(`\n\x1b[31m─── ${r.file} ───\x1b[0m`);
    const lines = r.out.split('\n').filter(l => /\[FAIL\]|Error|RESULT: FAIL/.test(l));
    console.log((lines.length ? lines : r.out.split('\n').slice(-15)).slice(0, 20).join('\n'));
  }
}

console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);
