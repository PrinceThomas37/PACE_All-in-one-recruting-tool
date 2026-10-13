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

const dist = require('../services/lead-distribution.js');
const finder = require('../services/lead-finder.js');
let settings = require('../config/settings.js');

// A fake app_settings that answers a read of several keys at once, like the real one.
const dbWith = (rows, boom) => ({ from() {
  return { select() { return this; }, async in(_col, keys) { if (boom) throw new Error('db down'); return { data: keys.filter((k) => rows[k] != null).map((k) => ({ key: k, value: rows[k] })) }; } };
} });
const fresh = () => { for (const m of ['../config/settings.js', '../services/daily-limit.js']) delete require.cache[require.resolve(m)]; return [require('../services/daily-limit.js'), require('../config/settings.js')]; };
let daily;
[daily] = fresh();

// 1. the admin's default
step('with no admin choice, the one fallback in config/limits.js is used', await daily.defaultDailyLimit(dbWith({})) === daily.DEFAULT_DAILY_SEND_LIMIT);
[daily] = fresh();
step('the admin\'s own number is what the system uses', await daily.defaultDailyLimit(dbWith({ 'sys_default_daily_send_limit@ORG1': '40' }), 'ORG1') === 40);
[daily] = fresh();
step('a number stored the old way (before it could be edited) still applies', await daily.defaultDailyLimit(dbWith({ default_daily_send_limit: '90' }), 'ORG1') === 90);
[daily] = fresh();
step('a nonsense value is ignored, not trusted', await daily.defaultDailyLimit(dbWith({ 'sys_default_daily_send_limit@ORG1': '0' }), 'ORG1') === daily.DEFAULT_DAILY_SEND_LIMIT);
[daily] = fresh();
step('an unreachable database gives a safe number, never an error', await daily.defaultDailyLimit(dbWith({}, true), 'ORG1') === daily.DEFAULT_DAILY_SEND_LIMIT);
step('a mailbox\'s own number beats the default', daily.limitOf({ daily_send_limit: 12 }, 40) === 12);
step('a mailbox with no number is held to the admin\'s default', daily.limitOf({ daily_send_limit: null }, 40) === 40 && daily.limitOf({}, 40) === 40 && daily.limitOf(null, 40) === 40);

// 1b. ONE COMPANY'S CHOICE NEVER REACHES ANOTHER (D-0124)
[daily] = fresh();
const twoCos = dbWith({ 'sys_default_daily_send_limit@A': '25', 'sys_default_daily_send_limit@B': '400', sys_default_daily_send_limit: '100' });
step('company A gets A\'s number', await daily.defaultDailyLimit(twoCos, 'A') === 25);
step('company B gets B\'s number — not A\'s', await daily.defaultDailyLimit(twoCos, 'B') === 400);
step('a company that has not chosen gets the shared number', await daily.defaultDailyLimit(twoCos, 'C') === 100);
{
  const [, st] = fresh();
  const rows = {}; const wdb = { from() { return { async upsert(r) { r.forEach((x) => { rows[x.key] = x.value; }); return { error: null }; }, delete() { return { async in(_col, ks) { ks.forEach((k) => delete rows[k]); return { error: null }; } }; } }; } };
  await st.setSettings(wdb, { default_daily_send_limit: 30 }, 'A');
  step('an admin\'s save is stored under THEIR company only', rows['sys_default_daily_send_limit@A'] === '30' && !('sys_default_daily_send_limit' in rows) && Object.keys(rows).length === 1);
  await st.setSettings(wdb, { default_daily_send_limit: '' }, 'A');
  step('clearing it goes back to the shared number (the company\'s row is removed)', Object.keys(rows).length === 0);
  const bad = await st.setSettings(wdb, { default_daily_send_limit: 999999 }, 'A');
  step('an out-of-range number is still refused for a company', !!bad.error);
  const all = await st.getAllSettings(dbWith({ 'sys_send_delay_min_sec@A': '10', sys_send_delay_min_sec: '45' }), 'A');
  const d = all.find((x) => x.key === 'send_delay_min_sec');
  step('the screen is told the value, where it came from, and the shared value', d.value === 10 && d.source === 'organisation' && d.shared_value === 45);
}

// 2. the places that used to say 150 / 300
const two = [{ id: 'A', email_address: 'a@x.com', daily_send_limit: null }, { id: 'B', email_address: 'b@x.com', daily_send_limit: 100 }];
step('Lead Finder treats a mailbox with no number as the admin\'s default (default 25 < B\'s 100, so B is roomier)', finder.suggestMailbox(two, {}, 25) === 'B');
step('...and when the admin raises the default to 500, the same mailbox is the roomier one', finder.suggestMailbox(two, {}, 500) === 'A');

// 3. the new mailbox numbers are admin settings
const byKey = Object.fromEntries(settings.SETTINGS_SCHEMA.map((s) => [s.key, s]));
for (const k of ['default_daily_send_limit', 'send_delay_min_sec', 'send_delay_max_sec', 'domain_max_per_hour', 'bulk_send_max_per_run', 'smtp_connect_tries', 'smtp_connect_window_minutes', 'smtp_sweep_batch', 'send_selected_max']) {
  step(k + ' is an admin setting with bounds', byKey[k] && byKey[k].min >= 0 && byKey[k].max >= byKey[k].default && byKey[k].group === 'Email engine');
}
let saved = null;
const wdb = { from() { return { upsert: async (rows) => { saved = rows; return { error: null }; } }; } };
step('an admin can change one', (await settings.setSettings(wdb, { smtp_connect_tries: 3 })).success && saved[0].key === 'sys_smtp_connect_tries' && saved[0].value === '3');
step('an out-of-range number is refused in words', !!(await settings.setSettings(wdb, { smtp_sweep_batch: 5000 })).error);
const rdb = dbWith({ sys_smtp_connect_tries: '2' });
step('the connect route reads the admin\'s number (not a constant)', await settings.getSetting(rdb, 'smtp_connect_tries') === 2);

// 4. nothing in the places that decide still carries the old literals
const fs = await import('node:fs');
const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
step('no route or service types a daily-limit number any more', ['routes/auth.js', 'routes/finder.js', 'routes/lead-assign.js', 'routes/ownership-requests.js', 'routes/recruiting/outreach.js', 'routes/candidate-outreach.js', 'services/lead-distribution.js', 'index.js'].every((f) => !/daily_send_limit\s*\|\|\s*(150|300)\b|daily_send_limit:\s*(150|300)\b/.test(src(f))));
step('the SMTP route holds no try-limit constant', !/TRY_LIMIT\s*=\s*6/.test(src('routes/smtp-mailbox.js')));

// 5. R-202: the older caps are the company's numbers too (D-0124)
{
  const lf = require('../services/lead-finder.js');
  const many = Array.from({ length: 60 }, (_, i) => 'Title ' + i);
  const def = lf.normalizeSearch({ name: 'x', titles: many, locations: ['TX'] });
  const small = lf.normalizeSearch({ name: 'x', titles: many, locations: ['TX'] }, { titles: 5 });
  const big = lf.normalizeSearch({ name: 'x', titles: many, locations: ['TX'] }, { titles: 55 });
  step('Finder: with no company number a search keeps the built-in 40 titles', def.ok && def.value.titles.length === 40);
  step('Finder: a company that sets 5 gets 5 — and 55 gets 55 (the code does not cap it)', small.value.titles.length === 5 && big.value.titles.length === 55);
  const places = Array.from({ length: 12 }, (_, i) => 'City' + i + ', TX');
  step('Finder: places follow the company number', lf.normalizeSearch({ name: 'x', titles: ['a'], locations: places }, { locations: 11 }).value.locations.length === 11);
  const comps = Array.from({ length: 40 }, (_, i) => 'site' + i + '.com');
  step('Finder: named companies follow the company number', lf.normalizeSearch({ name: 'x', titles: ['a'], locations: ['TX'], domains: comps }, { domains: 35 }).value.companies.length === 35);

  const ab = require('../services/ai-budget.js');
  const capDb = (rows) => ({ from() { return { select() { return this; }, eq(_c, k) { this._k = k; return this; }, async maybeSingle() { return { data: this._k in rows ? { value: rows[this._k] } : null }; } }; } });
  const rowsC = { ai_daily_token_cap: '1000', 'ai_daily_token_cap@A': '5000' };
  step('AI ceiling: company A has its own, company B gets the shared one', (await ab.getCaps(capDb(rowsC), 'A')).tokens === 5000 && (await ab.getCaps(capDb(rowsC), 'B')).tokens === 1000);
  step('AI ceiling: with nothing set anywhere the built-in default applies', (await ab.getCaps(capDb({}), 'A')).tokens === ab.DEFAULT_DAILY_TOKENS);

  const fs2 = require('../services/followup-steps.js');
  const person = { u_p_fu_count: '4' };
  const due = (cap) => Object.values(fs2.dueDates(person, 'p', new Date('2026-10-13T00:00:00Z'), cap)).filter(Boolean).length;
  step('Follow-ups: a person who chose 4 gets 4 when the company allows 5', due(5) === 4 && due(undefined) === 4);
  step('Follow-ups: the company can hold that to 2, or to none', due(2) === 2 && due(0) === 0);
}
{
  const fsx = await import('node:fs'); const rd = (f) => fsx.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  step('Finder routes hold no saved-search / contact / job count constant', !/MAX_SEARCHES/.test(rd('routes/finder.js')) && !/contacts : \[\]\)\.slice\(0, 3\)/.test(rd('routes/finder.js')) && !/positions\.slice\(1, 5\)/.test(rd('routes/finder.js')));
  step('The pool-capacity fallback no longer types 150', !/capacity \|\| 150/.test(rd('index.js')));
  step('The Finder\'s search-size numbers are admin settings', ['finder_max_titles', 'finder_max_places', 'finder_max_companies', 'finder_max_sectors', 'finder_max_keywords', 'finder_max_saved_searches', 'finder_max_contacts_per_lead', 'finder_max_jobs_per_lead', 'followup_max'].every((k) => byKey[k]));
}

const p = results.filter(Boolean).length;
console.log(`SUMMARY: ${p}/${results.length}`);
process.exit(p === results.length ? 0 : 1);
