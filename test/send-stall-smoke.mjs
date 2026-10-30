// R-347 (owner, 30 Oct: "many a times I have to come and manually click send all pending"). Measured 27-30 Oct: the automatic
// check sent for each person ONE AFTER ANOTHER and one run held everyone for 105 minutes. Pins: a quiet run is shown as stalled,
// one quiet for an hour stops blocking a fresh run, only the run that holds the guard frees it, and the check starts each person
// on their own.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const P = require('../services/send-progress.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const NOW = Date.parse('2026-10-30T16:00:00Z');
const ago = (m) => new Date(NOW - m * 60000).toISOString();

step('a run that moved 10 minutes ago is not stalled', !P.isStalled({ active: true, touchedAt: ago(10) }, NOW));
step('a run quiet for 45 minutes is stalled', P.isStalled({ active: true, touchedAt: ago(45) }, NOW));
step('…a finished run is never "stalled"', !P.isStalled({ active: false, done: true, touchedAt: ago(300) }, NOW));
step('with no touch yet, the start time counts', P.isStalled({ active: true, startedAt: ago(50) }, NOW));
step('an hour of nothing → a fresh run may start', P.shouldRelease({ active: true, touchedAt: ago(61) }, NOW) && !P.shouldRelease({ active: true, touchedAt: ago(50) }, NOW));
step('no record at all → nothing to release (the guard stays as it is)', !P.shouldRelease(undefined, NOW) && !P.shouldRelease(null, NOW));
let r = P.reconcileProgress({ active: true, touchedAt: ago(46), startedAt: ago(90) }, { alive: true, now: NOW });
step('the card of a live but stalled run says so', r.stalled === true && r.active === true);
r = P.reconcileProgress({ active: true, touchedAt: ago(5), startedAt: ago(90) }, { alive: true, now: NOW });
step('…a moving run is left exactly as it is', !r.stalled);

const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const retry = idx.slice(idx.indexOf('async function retryDeferredPendingSends'), idx.indexOf('async function autoSendForManager'));
step('the automatic check starts each person on their own (no await one after another)', /autoSendForManager\(uid\)\.catch/.test(retry) && !/await autoSendForManager\(uid\)/.test(retry));
const auto = idx.slice(idx.indexOf('async function autoSendForManager'), idx.indexOf('async function autoSendForManager') + 6000);
step('a run quiet for an hour no longer blocks a fresh one', /sendRunShouldRelease\(sendProgressCache\.get\(managerId\)\)/.test(auto));
step('only the run that holds the guard frees it', /autoSendRunToken\.get\(managerId\) === runToken/.test(auto));
const sp = idx.slice(idx.indexOf('async function setSendProgress'), idx.indexOf('async function clearSendProgress'));
step('every progress write of a live run stamps when it last moved', /touchedAt: new Date\(\)\.toISOString\(\)/.test(sp));
step('the send itself still claims each email before sending (what makes a fresh run safe)', /update\(\{ status: 'sending' \}\)\s*\.eq\('id', email\.id\)\.eq\('status', 'pending'\)/.test(idx));
const ui = readFileSync(new URL('../public/js/07-page-email.js', import.meta.url), 'utf8');
step('both progress cards (own + RA Lead watching) show "Sending has stalled"', (ui.match(/Sending has stalled/g) || []).length >= 2);

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
