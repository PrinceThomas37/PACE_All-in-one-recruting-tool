#!/usr/bin/env node
// ============================================================================
// MEMORY CHECK — did this work update the memory it was supposed to?
//
// WHY THIS EXISTS. The owner decided twice that PACE is built through its
// territory agents (D-0008) and that memory is written as the work lands
// (D-0024). Both were recorded, both STAND, and both were missed anyway —
// Session 27 shipped two features and left SIX territory memories stale. The
// owner then had to ask, again, whether the context had been updated.
//
// D-0024 considered automating this and rejected it, on the grounds that "a
// hook can run a script — it cannot write a narrative about what happened and
// why." That is true and it is beside the point. **A script cannot write the
// narrative. It can absolutely check that one was written.** Missing that
// distinction is why the rule depended on memory for three more sessions.
//
// So this is deliberately DUMB. It never judges quality — it cannot, and
// pretending otherwise would be the most convincing vacuous guard of all. It
// answers one mechanical question: you changed files these territories own;
// did their memories change too?
//
// WHAT IT CANNOT DO, stated plainly so nobody mistakes it for more:
//   • It cannot tell a real memory update from one blank line.
//   • It cannot make anyone USE the territory subagents (D-0008) — it only
//     notices afterwards that a territory's paths moved without its memory.
//   • It cannot judge whether the archive entry is any good.
// It closes the gap between "forgot entirely" and "wrote something", which is
// the gap every one of these misses has fallen into.
//
// Usage:
//   node scripts/memory-check.mjs              # working tree vs HEAD
//   node scripts/memory-check.mjs --range A..B # a commit range
//   node scripts/memory-check.mjs --quiet      # exit code only
// Exit 0 = nothing owed. Exit 1 = memory owed, and it names which files.
// ============================================================================

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(path.join(ROOT, 'docs/territories/_map.json'), 'utf8'));

const ARCHIVE = 'docs/CONTEXT_ARCHIVE.md';
const memoryOf = (id) => `docs/territories/${id}.md`;

// Files that ARE the memory. Changing one never obliges anything further, or
// the check would demand an archive entry for its own bookkeeping.
const MEMORY_FILES = new Set([
  ARCHIVE, 'docs/CONTEXT_WINDOW.md', 'CLAUDE.md',
  'docs/territories/DECISIONS.md', 'docs/territories/CAPABILITIES.md',
  'docs/territories/_contracts.md', 'docs/territories/_map.json',
  'docs/territories/README.md', 'docs/territories/INTAKE.md',
  ...MAP.territories.map(t => memoryOf(t.id)),
]);

// Longest prefix wins, so `services/view-horizon.js` (surface) is not stolen by
// a territory that owns `services/`.
const OWNERSHIP = MAP.territories
  .flatMap(t => (t.own || []).map(prefix => ({ id: t.id, prefix })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

// `.claude/` and `docs/` are deliberately unowned — scripts/territory-map.mjs
// skips both, because they are the protocol itself rather than code a
// territory works. A change confined to them therefore owes no territory
// memory, but STILL owes an archive entry: it is real work, and work that
// changes how the repo is worked is the last thing that should go unrecorded.
export function ownerOf(file) {
  const hit = OWNERSHIP.find(o => file === o.prefix || file.startsWith(o.prefix));
  return hit ? hit.id : null;
}

// PURE, so the test can drive it with a synthetic file list rather than a real
// repository — which is also the only way to prove it FAILS when it should.
export function whatIsOwed(changedFiles) {
  const files = (changedFiles || []).filter(Boolean);
  const code = files.filter(f => !MEMORY_FILES.has(f));
  if (!code.length) return { owed: [], touchedTerritories: [], code: [] };

  const touched = [...new Set(code.map(ownerOf).filter(Boolean))].sort();
  const owed = [];

  for (const id of touched) {
    if (!files.includes(memoryOf(id))) owed.push(memoryOf(id));
  }
  // The archive is owed by ANY real work, whichever territory it belonged to.
  if (!files.includes(ARCHIVE)) owed.push(ARCHIVE);

  return { owed, touchedTerritories: touched, code };
}

function changedFiles(range) {
  const cmd = range
    ? `git diff --name-only ${range}`
    : 'git status --porcelain=v1 | cut -c4-';
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: '/bin/bash' })
    .split('\n').map(s => s.trim()).filter(Boolean)
    // A rename prints "old -> new"; the new path is the one that matters.
    .map(s => (s.includes(' -> ') ? s.split(' -> ').pop() : s));
}

// Run directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quiet = process.argv.includes('--quiet');
  const rangeIdx = process.argv.indexOf('--range');
  const range = rangeIdx > -1 ? process.argv[rangeIdx + 1] : null;

  const files = changedFiles(range);
  const { owed, touchedTerritories, code } = whatIsOwed(files);

  if (!code.length) {
    if (!quiet) console.log('memory-check: no code changes — nothing owed.');
    process.exit(0);
  }
  if (!owed.length) {
    if (!quiet) {
      console.log(`memory-check: OK — ${code.length} file(s) changed across ` +
        `[${touchedTerritories.join(', ') || 'no territory'}], and every memory they owe was written.`);
    }
    process.exit(0);
  }

  console.error('');
  console.error('╭─ MEMORY OWED ─────────────────────────────────────────────');
  console.error(`│ ${code.length} file(s) changed in: ${touchedTerritories.join(', ') || '(unowned paths)'}`);
  console.error('│');
  console.error('│ These have NOT been updated in the same change:');
  for (const f of owed) console.error(`│   • ${f}`);
  console.error('│');
  console.error('│ D-0008: PACE is worked through its territories.');
  console.error('│ D-0024: memory is written as the work lands, not at the end.');
  console.error('│ A territory subagent reads ONLY its own memory — anything');
  console.error('│ absent there is lost when that context dies.');
  console.error('╰───────────────────────────────────────────────────────────');
  console.error('');
  process.exit(1);
}
