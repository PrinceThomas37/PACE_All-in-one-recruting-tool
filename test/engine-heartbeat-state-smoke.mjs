// "Background engine: not receiving its heartbeat" — a false alarm.
//
// The owner sent a screenshot of that warning, which also told them the cause
// was a CRON_KEY mismatch. Both halves were wrong. The GitHub Actions run
// history for 2026-09-04 shows the heartbeat firing at 01:12, 06:24, 11:37,
// 16:05 and 19:03 UTC — every one of them HTTP 200 with all six jobs run.
//
// The workflow ASKS for every 30 minutes; GitHub treats scheduled workflows as
// best-effort and delivers this one hours apart. So a one-hour threshold called
// a perfectly healthy engine broken, and then blamed a misconfiguration that
// did not exist — the worst kind of alert, because acting on it would have
// meant rotating a key that was already correct.
import { readFileSync } from 'node:fs';

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const cron = readFileSync(new URL('../routes/cron.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/js/08-page-admin.js', import.meta.url), 'utf8');

// ── the server distinguishes late from silent ────────────────────────────────
step('the server reports a heartbeat STATE, not just a boolean',
  cron.includes('heartbeat_state') && /'healthy'|'late'|'silent'/.test(cron));
step('"late" starts well after the requested 30-minute cadence',
  /LATE_AFTER_MS = 90 \* 60 \* 1000/.test(cron));
step('"silent" needs hours of nothing, not one missed run',
  /SILENT_AFTER_MS = 8 \* 60 \* 60 \* 1000/.test(cron));
step('the elapsed time is reported so the card can be specific',
  cron.includes('minutes_since_ping'));
step('never having been pinged still counts as silent',
  /sincePing === null \? 'silent'/.test(cron));
step('the old boolean is kept for compatibility', cron.includes('heartbeat_healthy:'));

// ── the card no longer accuses a correct configuration ───────────────────────
step('a late heartbeat says the engine is RUNNING',
  /'Background engine: running, heartbeat arriving late'/.test(page));
step('a late heartbeat blames GitHub scheduling, not the key',
  page.includes('GitHub delivers scheduled runs when it has capacity'));
step('it says plainly that nothing is skipped',
  page.includes('Nothing is broken and nothing is skipped'));
step('the key-mismatch advice survives ONLY for the genuinely silent case',
  /state==='silent'[\s\S]{0,300}CRON_KEY in Render and the GitHub Actions secret match/.test(page));
step('a late heartbeat is not painted as an alarm',
  /state==='late'\s*\?\s*\{bg:'var\(--card\)'/.test(page));
step('the card still falls back gracefully to an older server',
  /s\.heartbeat_state \|\| \(s\.heartbeat_healthy \? 'healthy' : 'silent'\)/.test(page));
step('an unset key is still its own distinct state',
  /!s\.cron_configured \? 'unset'/.test(page));

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
