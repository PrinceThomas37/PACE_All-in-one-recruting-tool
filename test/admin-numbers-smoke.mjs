// NO NUMBER THAT LIMITS A CUSTOMER IS TYPED INTO THE CODE (D-0123) — the owner, 12 Oct:
// "do not code any variable limits into the code, mailcount, AI count, number count, user count, any count — the admin decides."
// Proven here: a mailbox's daily limit comes from what the admin set (app_settings.default_daily_send_limit), a change reaches the
// next ask, a mailbox's own number beats the default, a broken database still gives a safe number, and the new mailbox numbers
// (connect tries, their window, sweep batch, selected-send cap) are settings an admin can change — with the right bounds.
// Usage: node test/admin-numbers-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const daily = require('../services/daily-limit.js');
const dist = require('../services/lead-distribution.js');
const finder = require('../services/lead-finder.js');
const settings = require('../config/settings.js');

const dbWith = (rows, boom) => ({ from(t) {
  const q = { _k: null, select() { return q; }, eq(c, v) { q._k = v; return q; },
    async maybeSingle() { if (boom) throw new Error('db down'); return { data: rows[q._k] != null ? { value: rows[q._k] } : null }; } };
  return q;
} });

const T = 1e12;
// 1. the admin's default
daily.resetCache();
step('with no admin choice, the one fallback in config/limits.js is used', await daily.defaultDailyLimit(dbWith({}), T) === daily.DEFAULT_DAILY_SEND_LIMIT);
daily.resetCache();
step('the admin\'s default is what the system uses', await daily.defaultDailyLimit(dbWith({ default_daily_send_limit: '40' }), T) === 40);
step('a change reaches the next ask once the short cache has passed', await daily.defaultDailyLimit(dbWith({ default_daily_send_limit: '75' }), T + 61000) === 75);
daily.resetCache();
step('a nonsense value is ignored, not trusted', await daily.defaultDailyLimit(dbWith({ default_daily_send_limit: '0' }), T) === daily.DEFAULT_DAILY_SEND_LIMIT);
daily.resetCache();
step('an unreachable database gives a safe number, never an error', await daily.defaultDailyLimit(dbWith({}, true), T) === daily.DEFAULT_DAILY_SEND_LIMIT);
step('a mailbox\'s own number beats the default', daily.limitOf({ daily_send_limit: 12 }, 40) === 12);
step('a mailbox with no number is held to the admin\'s default', daily.limitOf({ daily_send_limit: null }, 40) === 40 && daily.limitOf({}, 40) === 40 && daily.limitOf(null, 40) === 40);

// 2. the places that used to say 150 / 300
const two = [{ id: 'A', email_address: 'a@x.com', daily_send_limit: null }, { id: 'B', email_address: 'b@x.com', daily_send_limit: 100 }];
step('Lead Finder treats a mailbox with no number as the admin\'s default (default 25 < B\'s 100, so B is roomier)', finder.suggestMailbox(two, {}, 25) === 'B');
step('...and when the admin raises the default to 500, the same mailbox is the roomier one', finder.suggestMailbox(two, {}, 500) === 'A');

// 3. the new mailbox numbers are admin settings
const byKey = Object.fromEntries(settings.SETTINGS_SCHEMA.map((s) => [s.key, s]));
for (const k of ['smtp_connect_tries', 'smtp_connect_window_minutes', 'smtp_sweep_batch', 'send_selected_max']) {
  step(k + ' is an admin setting with bounds', byKey[k] && byKey[k].min >= 1 && byKey[k].max > byKey[k].default && byKey[k].group === 'Email engine');
}
let saved = null;
const wdb = { from() { return { upsert: async (rows) => { saved = rows; return { error: null }; } }; } };
step('an admin can change one', (await settings.setSettings(wdb, { smtp_connect_tries: 3 })).success && saved[0].key === 'sys_smtp_connect_tries' && saved[0].value === '3');
step('an out-of-range number is refused in words', !!(await settings.setSettings(wdb, { smtp_sweep_batch: 5000 })).error);
const rdb = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { value: '2' } }) }; } };
step('the connect route reads the admin\'s number (not a constant)', await settings.getSetting(rdb, 'smtp_connect_tries') === 2);

// 4. nothing in the places that decide still carries the old literals
const fs = await import('node:fs');
const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
step('no route or service types a daily-limit number any more', ['routes/auth.js', 'routes/finder.js', 'routes/lead-assign.js', 'routes/ownership-requests.js', 'routes/recruiting/outreach.js', 'routes/candidate-outreach.js', 'services/lead-distribution.js', 'index.js'].every((f) => !/daily_send_limit\s*\|\|\s*(150|300)\b|daily_send_limit:\s*(150|300)\b/.test(src(f))));
step('the SMTP route holds no try-limit constant', !/TRY_LIMIT\s*=\s*6/.test(src('routes/smtp-mailbox.js')));

const p = results.filter(Boolean).length;
console.log(`SUMMARY: ${p}/${results.length}`);
process.exit(p === results.length ? 0 : 1);
