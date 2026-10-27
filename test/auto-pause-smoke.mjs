// D-0183 follow-up — the owner set the bounce limit to 10% in Admin and mailboxes were still paused.
// Cause: the check read the deployment-wide value (5%), not the organisation's own. These pin that the MAILBOX'S organisation's
// numbers are the ones used, using the real settings reader and a db that holds the keys the Admin screen really writes.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const settingsConfig = require('../config/settings.js');
const ap = require('../services/auto-pause.js');

// The rows exactly as the live database holds them (27 Oct 2026): the org's own choice under sys_<key>@<org>.
const ORG = '53f5b5d0-b0fd-4132-a340-6c6bd8503ae9';
function db(settingRows, mailboxes) {
  return { from(t) {
    const f = [];
    const base = () => (t === 'app_settings' ? settingRows : mailboxes);
    const api = {
      select() { return api; }, eq(k, v) { f.push(r => r[k] === v); return api; }, in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
      maybeSingle() { return Promise.resolve({ data: base().filter(r => f.every(fn => fn(r)))[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: base().filter(r => f.every(fn => fn(r))), error: null }).then(res, rej); },
    };
    return api;
  } };
}
const sb = db([{ key: 'sys_bounce_rate_threshold_pct@' + ORG, value: '10' }], [{ id: 'mb1', org_id: ORG }, { id: 'mb-other', org_id: 'other-org' }]);

let l = await ap.limitsFor(sb, settingsConfig, 'mb1');
step('the mailbox\'s organisation chose 10% → 10% is what is used (not the default 5%)', l.thresholdPct === 10 && l.orgId === ORG, JSON.stringify(l));
l = await ap.limitsFor(sb, settingsConfig, 'mb-other');
step('another organisation with no choice still gets the default', l.thresholdPct === 5, JSON.stringify(l));
l = await ap.limitsFor({ from: () => { throw new Error('down'); } }, settingsConfig, 'mb1');
step('an unreadable mailbox row never crashes the check (the shared value applies)', l.thresholdPct === 5 && l.orgId === null, JSON.stringify(l));

// The mailboxes of 27 Oct as they stood: sam 3/38, spencer 2/29, daniel 2/32, dan 2/61.
const day = { sam: [3, 38], spencer: [2, 29], daniel: [2, 32], dan: [2, 61] };
const at = (limit) => Object.entries(day).filter(([, [b, n]]) => ap.shouldPause({ bouncesToday: b, sentToday: n, thresholdPct: limit, minSample: 20 })).map(([k]) => k).join();
step('at the default 5%, sam, spencer and daniel were paused (the live behaviour)', at(5) === 'sam,spencer,daniel', at(5));
step('at the owner\'s 10%, none of them is', at(10) === '', at(10));
step('exactly at the limit is not over it', ap.shouldPause({ bouncesToday: 1, sentToday: 20, thresholdPct: 5, minSample: 20 }) === false);
step('below the minimum sample nothing is judged', ap.shouldPause({ bouncesToday: 5, sentToday: 10, thresholdPct: 5, minSample: 20 }) === false);
step('a mailbox that sent nothing is never paused', ap.shouldPause({ bouncesToday: 1, sentToday: 0, thresholdPct: 5, minSample: 0 }) === false);

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('index.js asks services/auto-pause.js, not the shared setting', /autoPause\.limitsFor\(supabase, settingsConfig, userEmailId\)/.test(src) && !/getSetting\(supabase, 'bounce_rate_threshold_pct'\)/.test(src));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
