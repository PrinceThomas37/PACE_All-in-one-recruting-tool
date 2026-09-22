#!/usr/bin/env node
// ============================================================================
// STOP GATE — a session does not finish quietly with its memory unwritten.
//
// This is the part that makes D-0008 / D-0024 enforceable rather than hoped
// for. Both were recorded, both STOOD, and both were missed anyway, because a
// rule in a file only works if a session reads it AND remembers it at the
// right moment. A hook does not depend on either.
//
// IT BLOCKS RATHER THAN WARNS, and that is deliberate — the owner asked for a
// strict rule after having to ask three times. But a blocking gate must always
// be SATISFIABLE, or it traps the session instead of correcting it. Two things
// keep it satisfiable:
//   • Writing the memory clears it. One append, one commit, done.
//   • Work genuinely mid-flight clears it with an honest one-line placeholder
//     in the archive, which is what D-0024 asks for anyway ("an archive of
//     accurate fragments beats an eloquent one that was never written").
// The reason text names both, so the way out is never a guess.
//
// It also emits a systemMessage, so the OWNER sees it too. They should not
// have to audit this — but they should never be the last line of defence
// without knowing it.
//
// The gate NEVER fails the session on its own error: if the check cannot run,
// it stays silent rather than blocking work behind a broken script.
// ============================================================================
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = () => { process.stdout.write(JSON.stringify({ suppressOutput: true })); process.exit(0); };

let report = '';
try {
  execSync('node scripts/memory-check.mjs --quiet', { cwd: ROOT, stdio: 'pipe' });
  pass();                                   // nothing owed
} catch (err) {
  // Exit 1 is "memory owed". Anything else is the checker itself failing, and
  // a broken checker must never become a wall in front of the work.
  if (err.status !== 1) pass();
  try {
    report = execSync('node scripts/memory-check.mjs 2>&1 || true',
      { cwd: ROOT, encoding: 'utf8', shell: '/bin/bash' }).trim();
  } catch (_) { pass(); }
}

const owed = (report.match(/^│\s+• (.+)$/gm) || [])
  .map(l => l.replace(/^│\s+• /, '').trim());

const reason = [
  'This session changed code and has not written the memory that change owes.',
  '',
  owed.length ? 'Not yet updated:' : null,
  ...owed.map(f => `  \u2022 ${f}`),
  '',
  'D-0008 and D-0024 are standing owner decisions: PACE is worked through its',
  'territories, and memory is written as the work lands. A territory subagent',
  'reads ONLY its own memory file, so anything absent there is lost when that',
  'context dies — and "the end of the session" is a moment that never',
  'announces itself.',
  '',
  'Two ways to clear this, both legitimate:',
  '  1. Write it properly — what is now true in those paths, and an archive',
  '     section for the work that landed.',
  '  2. If the work is genuinely mid-flight, append an honest one-line',
  '     placeholder to docs/CONTEXT_ARCHIVE.md saying what is in progress.',
  '     An archive of accurate fragments beats one that was never written.',
  '',
  'Do not clear it by writing nothing.',
].filter(v => v !== null).join('\n');

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason,
  systemMessage: `Memory owed before this session ends: ${owed.join(', ') || 'see scripts/memory-check.mjs'}`,
}));
