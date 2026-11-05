// 5 Nov 2026 — a mailbox taken OUT of warm-up must not stay capped by the warm-up ramp (Sam Wilson: stopped warm-up, send loop kept
// holding him to 20 + 5 × days because it read only warmup_start_date). The rule lives in services/warmup-ramp.js and is CALLED here.
//   • warming  → ramped            • paused → still ramped (pausing never loosens the cap)
//   • warmed (graduated OR stopped by hand) with a start date still on record → NO ramp   ← the bug
//   • no status / no date / unreadable date → no ramp
//   • the engine's loader and the deliverability card read warmup_status (without it the rule above can never fire)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { warmupLimit } = require(ROOT + '/services/warmup-ramp.js');

let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fails++; };

const NOW = Date.parse('2026-11-05T14:35:00Z');
const row = (status, start = '2026-11-03') => ({ warmup_status: status, warmup_start_date: start });

ok('warming: 20 + 5 x 2 days = 30', warmupLimit(row('warming'), 20, 5, NOW) === 30);
ok('warming, day zero = the starting cap', warmupLimit(row('warming', '2026-11-05'), 20, 5, NOW) === 20);
ok('admin numbers are used, not the fallback', warmupLimit(row('warming'), 10, 2, NOW) === 14);
ok('paused warm-up is still ramped', warmupLimit(row('paused'), 20, 5, NOW) === 30);
ok('THE BUG: warmed (stopped/graduated) with a start date → no ramp', warmupLimit(row('warmed'), 20, 5, NOW) === null);
ok('no status but a start date → no ramp', warmupLimit(row(null), 20, 5, NOW) === null);
ok('unknown status → no ramp', warmupLimit(row('whatever'), 20, 5, NOW) === null);
ok('no start date → no ramp', warmupLimit({ warmup_status: 'warming', warmup_start_date: null }, 20, 5, NOW) === null);
ok('unreadable start date → no ramp', warmupLimit(row('warming', 'not-a-date'), 20, 5, NOW) === null);
ok('no row → no ramp', warmupLimit(null, 20, 5, NOW) === null && warmupLimit(undefined, 20, 5, NOW) === null);
ok('a start date in the future never gives less than the starting cap', warmupLimit(row('warming', '2026-12-01'), 20, 5, NOW) === 20);

// The rule is only as good as the data it is handed: every reader that feeds it must select warmup_status.
const idx = readFileSync(ROOT + '/index.js', 'utf8');
const deliv = readFileSync(ROOT + '/routes/deliverability.js', 'utf8');
ok('index.js uses the ONE ramp (no second copy of the formula)', /require\('\.\/services\/warmup-ramp'\)/.test(idx) && !/warmupStart \+ warmupStep \* days/.test(idx));
ok('the engine loader (loadMailboxDelivState) selects warmup_status', /from\('user_emails'\)\.select\('id,warmup_status,warmup_start_date,auto_paused_at'\)/.test(idx));
ok('the deliverability card selects warmup_status', /select\('id,warmup_status,warmup_start_date,auto_paused_at'\)/.test(deliv));
ok('the deliverability card shows a ramp only where the engine applies one', /warmup: warmupLimit\(dc, warmupStart, warmupStep\) != null/.test(deliv));

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('warmup-ramp-smoke: all passed');
