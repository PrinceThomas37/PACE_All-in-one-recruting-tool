// THE MEMORY CHECK — scripts/memory-check.mjs
//
// The owner decided twice that PACE is built through its territory agents
// (D-0008) and that memory is written as the work lands (D-0024). Both were
// recorded, both STAND, and Session 27 broke both anyway: two features shipped
// and SIX territory memories were left stale, until the owner asked — again —
// whether the context had been updated.
//
// D-0024 rejected automating this because "a hook can run a script — it cannot
// write a narrative about what happened and why." True, and beside the point:
// a script cannot write the narrative, but it can check that one was written.
// That distinction is the whole fix, and this suite is what makes the checker
// trustworthy enough to rely on.
//
// The checker is PURE (`whatIsOwed(files)`), so every case below is a
// synthetic file list rather than a real repository — which is the only way to
// prove it FAILS when it should, rather than passing because nothing ran.
//
// Usage: node test/memory-discipline-smoke.mjs
import { whatIsOwed, ownerOf } from '../scripts/memory-check.mjs';

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail && !cond ? ' — ' + detail : ''));
};

const owes = (files) => whatIsOwed(files).owed;

// ── ownership ───────────────────────────────────────────────────────────────
ok('a route belongs to gateway', ownerOf('routes/apply.js') === 'gateway');
ok('a recruiting route belongs to guild', ownerOf('routes/recruiting/sourcing.js') === 'guild');
ok('a page belongs to surface', ownerOf('public/js/32-page-sourcing.js') === 'surface');
ok('a test belongs to foundry', ownerOf('test/anything.mjs') === 'foundry');
ok('a migration belongs to deep', ownerOf('migrations/044_apply_page.sql') === 'deep');
// Longest prefix wins, or a territory owning `services/` would steal this one.
ok('the longest prefix wins over a broader one',
  ownerOf('services/view-horizon.js') === 'surface', ownerOf('services/view-horizon.js'));

// ── THE REAL FAILURE, REPLAYED ──────────────────────────────────────────────
// These are the actual files of Session 27's apply-page commit. At the moment
// it was made, not one territory memory had been written. The check must say so.
{
  const realCommit = [
    'routes/apply.js', 'services/jd-scrub.js', 'migrations/044_apply_page.sql',
    'test/apply-page-smoke.mjs', 'public/js/25-workflow-bd.js',
    'routes/recruiting/job-orders.js', 'index.js',
    'CLAUDE.md', 'docs/territories/CAPABILITIES.md', 'docs/territories/DECISIONS.md',
  ];
  const owed = owes(realCommit);
  ok('the real Session 27 gap is caught', owed.length > 0, 'reported nothing owed');
  for (const t of ['gateway', 'guild', 'surface', 'deep', 'foundry']) {
    ok(`...it names ${t}`, owed.includes(`docs/territories/${t}.md`), owed.join(','));
  }
  ok('...and the archive', owed.includes('docs/CONTEXT_ARCHIVE.md'));
  // CLAUDE.md and DECISIONS were written, so they must NOT be demanded again.
  ok('...without demanding memory that WAS written',
    !owed.includes('CLAUDE.md') && !owed.includes('docs/territories/DECISIONS.md'), owed.join(','));
}

// ── the clean case ──────────────────────────────────────────────────────────
{
  const owed = owes([
    'routes/apply.js', 'docs/territories/gateway.md', 'docs/CONTEXT_ARCHIVE.md',
  ]);
  ok('code + its territory memory + the archive owes nothing', owed.length === 0, owed.join(','));
}
{
  const owed = owes([
    'routes/apply.js', 'public/js/x.js',
    'docs/territories/gateway.md', 'docs/territories/surface.md', 'docs/CONTEXT_ARCHIVE.md',
  ]);
  ok('two territories, both written, owes nothing', owed.length === 0, owed.join(','));
}

// ── the partial case, which is how this actually goes wrong ────────────────
{
  const owed = owes([
    'routes/apply.js', 'public/js/x.js',
    'docs/territories/gateway.md', 'docs/CONTEXT_ARCHIVE.md',
  ]);
  ok('one territory written and one forgotten is still caught',
    owed.length === 1 && owed[0] === 'docs/territories/surface.md', owed.join(','));
}
{
  const owed = owes(['routes/apply.js', 'docs/territories/gateway.md']);
  ok('the archive alone being missed is caught',
    owed.length === 1 && owed[0] === 'docs/CONTEXT_ARCHIVE.md', owed.join(','));
}

// ── memory-only changes owe nothing, or the check would chase its own tail ──
{
  ok('a docs-only change owes nothing',
    owes(['docs/CONTEXT_WINDOW.md', 'docs/territories/DECISIONS.md']).length === 0);
  ok('writing the archive alone owes nothing', owes(['docs/CONTEXT_ARCHIVE.md']).length === 0);
  ok('an empty change owes nothing', owes([]).length === 0);
  ok('undefined is safe', owes(undefined).length === 0);
}

// ── shape ───────────────────────────────────────────────────────────────────
{
  const r = whatIsOwed(['routes/apply.js']);
  ok('it reports which territories were touched',
    r.touchedTerritories.includes('gateway'), JSON.stringify(r.touchedTerritories));
  ok('it reports the code files it judged on', r.code.includes('routes/apply.js'));
  ok('it never counts a memory file as code', !r.code.includes('docs/CONTEXT_ARCHIVE.md'));
}

const failed = results.filter(r => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
