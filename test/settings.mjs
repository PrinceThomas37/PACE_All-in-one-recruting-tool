// Unit test for config/settings.js — validates the cached numeric-settings
// module in isolation with a mock Supabase.
// Usage: node test/settings.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// Fresh module instance per scenario (the module has an internal cache we
// need to reset between tests) — bust Node's require cache each time.
function freshSettings() {
  const path = require.resolve('../config/settings.js');
  delete require.cache[path];
  return require('../config/settings.js');
}

function mockSupabase(row) {
  // row: { value: '...' } | null  — the single row app_settings would return.
  return {
    from: () => ({
      // the read asks for the organisation's key, the shared key and any legacy key in one go (D-0124); the mock answers the shared one
      select: () => ({
        in: async (_col, keys) => ({ data: row ? [{ key: keys[0], value: row.value }] : [] }),
      }),
      upsert: async () => ({ error: null }),
    }),
  };
}

// 1. No override in DB → returns schema default.
{
  const { getSetting } = freshSettings();
  const v = await getSetting(mockSupabase(null), 'company_cooldown_days');
  ok('no DB row → default (21)', v === 21, `got ${v}`);
}

// 2. Valid override in DB → returns that value.
{
  const { getSetting } = freshSettings();
  const v = await getSetting(mockSupabase({ value: '30' }), 'company_cooldown_days');
  ok('valid override (30) is used', v === 30, `got ${v}`);
}

// 3. Out-of-range value in DB → falls back to default, never applies the bad value.
{
  const { getSetting } = freshSettings();
  const v = await getSetting(mockSupabase({ value: '9999' }), 'company_cooldown_days');
  ok('out-of-range DB value (9999) falls back to default (21)', v === 21, `got ${v}`);
}

// 4. Non-numeric junk in DB → falls back to default.
{
  const { getSetting } = freshSettings();
  const v = await getSetting(mockSupabase({ value: 'not-a-number' }), 'company_cooldown_days');
  ok('non-numeric DB value falls back to default (21)', v === 21, `got ${v}`);
}

// 5. Supabase throwing → falls back to default (never breaks the caller).
{
  const { getSetting } = freshSettings();
  const throwing = { from: () => ({ select: () => ({ in: async () => { throw new Error('down'); } }) }) };
  const v = await getSetting(throwing, 'wf_tick_batch');
  ok('DB error falls back to default (200), does not throw', v === 200, `got ${v}`);
}

// 6. Unknown key → throws (programmer error, not a runtime data issue).
{
  const { getSetting } = freshSettings();
  let threw = false;
  try { await getSetting(mockSupabase(null), 'not_a_real_setting'); } catch (e) { threw = true; }
  ok('unknown key throws', threw);
}

// 7. Cache: a second read within the TTL does not hit Supabase again.
{
  const { getSetting } = freshSettings();
  let calls = 0;
  const counting = { from: () => ({ select: () => ({ in: async (_col, keys) => { calls++; return { data: [{ key: keys[0], value: '50' }] }; } }) }) };
  const v1 = await getSetting(counting, 'wf_max_step_failures');
  const v2 = await getSetting(counting, 'wf_max_step_failures');
  ok('cached: second read within TTL does not re-query', calls === 1 && v1 === v2, `calls=${calls} v1=${v1} v2=${v2}`);
}

// 8. getAllSettings returns every schema entry with its effective value.
{
  const { getAllSettings, SETTINGS_SCHEMA } = freshSettings();
  const all = await getAllSettings(mockSupabase(null));
  ok('getAllSettings returns one row per schema entry, all defaults',
    all.length === SETTINGS_SCHEMA.length && all.every((r) => r.value === r.default),
    `got ${all.length} rows`);
}

// 9. setSettings validates all-or-nothing: one bad key rejects the whole batch.
{
  const { setSettings } = freshSettings();
  const sb = mockSupabase(null);
  let upserted = false;
  sb.from = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    upsert: async () => { upserted = true; return { error: null }; },
  });
  const r = await setSettings(sb, { company_cooldown_days: '30', wf_tick_batch: '999999' /* out of range */ });
  ok('setSettings rejects the whole batch on one invalid value', !!r.error && !upserted, JSON.stringify(r));
}

// 10. setSettings with all-valid values writes and invalidates the cache.
{
  const settings = freshSettings();
  let lastUpsertRows = null;
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      upsert: async (rows) => { lastUpsertRows = rows; return { error: null }; },
    }),
  };
  const r = await settings.setSettings(sb, { mailbox_warmup_start: '25' });
  const wroteExpectedKey = Array.isArray(lastUpsertRows) && lastUpsertRows[0].key === 'sys_mailbox_warmup_start' && lastUpsertRows[0].value === '25';
  ok('setSettings writes sys_<key> = value and succeeds', r.success === true && wroteExpectedKey, JSON.stringify(r) + ' ' + JSON.stringify(lastUpsertRows));
}

console.log('\n=== SETTINGS TEST ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
