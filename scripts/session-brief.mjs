#!/usr/bin/env node
// ============================================================================
// SESSION BRIEF — injected into EVERY session in this repo, by a SessionStart
// hook, before anyone types anything.
//
// WHY. The owner decided twice how PACE is worked (D-0008 territories, D-0024
// memory as the work lands). Both were recorded in files, both STAND, and both
// were missed anyway — because a rule in a file is only followed if the session
// happens to read that file and happens to remember it at the right moment.
// The owner should not have to repeat a settled decision every chat.
//
// A hook is different in kind: it runs whether or not anybody remembers it.
// This one states the protocol and, more usefully, reports the memory that is
// ALREADY owed right now — so a session inherits an accurate picture of the
// repo instead of an assumption.
// ============================================================================
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let owed = '';
try {
  execSync('node scripts/memory-check.mjs --quiet', { cwd: ROOT, stdio: 'pipe' });
} catch (_) {
  try {
    owed = execSync('node scripts/memory-check.mjs 2>&1 || true',
      { cwd: ROOT, encoding: 'utf8', shell: '/bin/bash' }).trim();
  } catch (_) { /* the brief must never be the reason a session fails to start */ }
}

const context = [
  'PACE — HOW THIS REPO IS WORKED (owner decisions D-0008 and D-0024, both STANDING).',
  '',
  '1. WORK THROUGH THE TERRITORIES. Nine subagents in .claude/agents/ own the',
  '   codebase between them (surface, gateway, deep, harbour, observatory,',
  '   guild, rampart, foundry, ledger; dispatch is the front door for a report',
  '   in plain English). Read docs/territories/README.md before starting a job.',
  '',
  '2. MEMORY IS WRITTEN AS THE WORK LANDS, NOT AT THE END. In the SAME change',
  '   as the code: the owning territory memory (docs/territories/<id>.md) and',
  '   docs/CONTEXT_ARCHIVE.md. Plus DECISIONS.md the moment the owner decides',
  '   anything, and CAPABILITIES.md for a new user-facing capability.',
  '   A territory subagent reads ONLY its own memory file — anything not',
  '   written there is lost when that context dies. "End of session" is not a',
  '   moment that announces itself.',
  '',
  '3. `node scripts/memory-check.mjs` answers whether anything is owed. A Stop',
  '   hook runs it, so a session that finishes with memory unwritten is told.',
  '   It checks that memory was WRITTEN, never that it is any good — that part',
  '   is judgement and cannot be automated.',
  '',
  '4. THE OWNER DOES NOT READ CODE and does not use git. They get the running',
  '   app, screenshots and plain English. Never ask them to review a diff,',
  '   operate GitHub, or re-state a decision already in DECISIONS.md.',
  owed ? '' : null,
  owed ? 'MEMORY ALREADY OWED IN THIS WORKING TREE (inherited, not yours):' : null,
  owed || null,
].filter(v => v !== null).join('\n');

process.stdout.write(JSON.stringify({
  suppressOutput: true,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}));
