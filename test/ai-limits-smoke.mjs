// R-040: the limits an AI provider REPORTS with each answer are kept and shown,
// so "is the free plan enough?" is answered by the provider, not from memory.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../services/ai-provider.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

console.log('\nAI provider limits');
await t('reads Groq-style headers from a real Headers object', () => {
  const h = new Headers({ 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '963',
    'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '5710', 'x-ratelimit-reset-tokens': '17.2s' });
  const r = P.readRateLimits(h);
  assert.deepEqual(r.requests, { limit: 1000, remaining: 963, reset: null });
  assert.deepEqual(r.tokens, { limit: 8000, remaining: 5710, reset: '17.2s' });
});
await t('reads plain x-ratelimit-* headers, case-insensitively, from an object', () => {
  const r = P.readRateLimits({ 'X-RateLimit-Limit': '50', 'X-RateLimit-Remaining': '12' });
  assert.equal(r.plain.limit, 50); assert.equal(r.plain.remaining, 12);
});
await t('no limit headers → null (nothing recorded, nothing invented)', () => {
  assert.equal(P.readRateLimits(new Headers({ 'content-type': 'application/json' })), null);
  assert.equal(P.readRateLimits(null), null);
  assert.equal(P.readRateLimits({ 'x-ratelimit-limit-requests': 'lots' }), null);
});
await t('Groq windows are named; unknown providers claim no window', () => {
  assert.deepEqual(P.LIMIT_WINDOWS.groq, { requests: 'day', tokens: 'minute' });
  assert.equal(P.LIMIT_WINDOWS.openrouter, undefined);
});

function fakeDb(initial) {
  const store = { [P.LIMITS_KEY]: initial || null };
  return { store, from: () => ({
    select: () => ({ eq: (_k, key) => ({ maybeSingle: async () => ({ data: store[key] == null ? null : { value: store[key] } }) }) }),
    upsert: async (row) => { store[row.key] = row.value; return { error: null }; },
  }) };
}
await t('recordLimits keeps one entry per provider/model and merges, never drops others', async () => {
  const db = fakeDb();
  await P.recordLimits(db, 'groq', 'openai/gpt-oss-120b', { 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-limit-requests': '1000' }, Date.parse('2026-09-23T20:00:00Z'));
  await P.recordLimits(db, 'groq', 'openai/gpt-oss-20b', { 'x-ratelimit-remaining-requests': '990', 'x-ratelimit-limit-requests': '1000' }, Date.parse('2026-09-23T20:01:00Z'));
  await P.recordLimits(db, 'groq', 'openai/gpt-oss-120b', { 'x-ratelimit-remaining-requests': '899', 'x-ratelimit-limit-requests': '1000' }, Date.parse('2026-09-23T20:02:00Z'));
  const list = await P.getProviderLimits(db);
  assert.equal(list.length, 2);
  const big = list.find(l => l.model === 'openai/gpt-oss-120b');
  assert.equal(big.requests.remaining, 899); assert.equal(big.windows.requests, 'day'); assert.equal(big.at, '2026-09-23T20:02:00.000Z');
});
await t('a limits record that cannot be written never throws', async () => {
  const broken = { from: () => { throw new Error('db down'); } };
  await P.recordLimits(broken, 'groq', 'm', { 'x-ratelimit-limit-requests': '1' });
  assert.deepEqual(await P.getProviderLimits(broken), []);
});

console.log('\nAI provider limits — wiring');
const src = readFileSync(new URL('../services/ai-provider.js', import.meta.url), 'utf8');
await t('both the feature path and the health test record limits BEFORE the ok check (a 429 carries them too)', () => {
  const hits = src.match(/await recordLimits\(supabase, entry\.id, model, response\.headers\);\n\s*if \(!response\.ok\)/g) || [];
  assert.equal(hits.length, 2, 'found ' + hits.length);
});
await t('the AI budget endpoint returns provider_limits', () => {
  assert.match(readFileSync(new URL('../routes/integrations.js', import.meta.url), 'utf8'), /provider_limits: await aiProvider\.getProviderLimits\(supabase\)/);
});
await t('the AI card draws the block', () => {
  const page = readFileSync(new URL('../public/js/08-page-admin.js', import.meta.url), 'utf8');
  assert.match(page, /aiProviderLimitsBlock\(b\.provider_limits\)/);
  assert.match(page, /function aiProviderLimitsBlock\(list\)/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
