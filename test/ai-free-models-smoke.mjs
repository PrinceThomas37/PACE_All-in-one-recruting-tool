// OpenRouter's free models are LOOKED UP, not remembered (Session 29). The
// hard-coded :free model 404'd the day the owner connected OpenRouter — the
// third expired model name in this repo.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../services/ai-provider.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

const ROWS = [
  { id: 'meta-llama/llama-3.3-70b-instruct', pricing: { prompt: '0.0000001', completion: '0.0000003' }, context_length: 131072 },
  { id: 'qwen/qwen3-235b-a22b:free', pricing: { prompt: '0', completion: '0' }, context_length: 40960 },
  { id: 'deepseek/deepseek-chat:free', pricing: { prompt: '0', completion: '0' }, context_length: 163840 },
  { id: 'some/whisper-large:free', pricing: { prompt: '0', completion: '0' }, context_length: 999999 },
  { id: 'some/image-gen', pricing: { prompt: '0', completion: '0' }, context_length: 1, architecture: { output_modalities: ['image'] } },
  { id: 'openrouter/auto', pricing: { prompt: '0', completion: '0' }, context_length: 2000000 },
  { id: 'google/gemma-free-no-suffix', pricing: { prompt: 0, completion: 0 }, context_length: 8192 },
];

console.log('\nOpenRouter free models');
await t('only free text writers, largest context first; paid, speech, image and the router excluded', () => {
  assert.deepEqual(P.rankFreeModels(ROWS), ['deepseek/deepseek-chat:free', 'qwen/qwen3-235b-a22b:free', 'google/gemma-free-no-suffix']);
});
await t('an empty or broken catalogue yields nothing, never a throw', () => {
  assert.deepEqual(P.rankFreeModels(null), []);
  assert.deepEqual(P.rankFreeModels([{}, null]), []);
});

// R-031 (Session 32): the live cache led with Google's MUSIC models. Rows
// shaped the way OpenRouter's catalogue describes them.
const MUSIC = [
  { id: 'google/lyria-3-clip-preview', pricing: { prompt: '0', completion: '0', request: '0.04' }, context_length: 9000000, architecture: { modality: 'text->audio' } },
  { id: 'google/lyria-3-pro-preview', pricing: { prompt: '0', completion: '0' }, context_length: 9000000, architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] } },
  { id: 'some/per-image', pricing: { prompt: '0', completion: '0', image: '0.01' }, context_length: 8000000 },
  { id: 'good/writer:free', pricing: { prompt: '0', completion: '0' }, context_length: 32000, architecture: { modality: 'text+image->text', output_modalities: ['text'] } },
];
await t('a text->audio model is not a writer (the modality was matched on its INPUT side)', () => {
  assert.ok(!P.rankFreeModels([MUSIC[0]]).includes('google/lyria-3-clip-preview'));
});
await t('a model that outputs text AND audio is not a writer', () => {
  assert.deepEqual(P.rankFreeModels([MUSIC[1]]), []);
});
await t('zero per-token but priced per request or per image is not free', () => {
  assert.deepEqual(P.rankFreeModels([MUSIC[0], MUSIC[2]].map(m => ({ ...m, architecture: undefined }))), []);
});
await t('a model that READS images but WRITES text still counts', () => {
  assert.deepEqual(P.rankFreeModels(MUSIC), ['good/writer:free']);
});

function db(cached) {
  const store = { [P.FREE_CACHE_KEY]: cached ? JSON.stringify(cached) : null };
  return { store, from: () => ({
    select: () => ({ eq: (_k, key) => ({ maybeSingle: async () => ({ data: store[key] == null ? null : { value: store[key] } }) }) }),
    upsert: async (row) => { store[row.key] = row.value; return { error: null }; },
  }) };
}
const NOW = Date.parse('2026-09-23T22:00:00Z');
const okFetch = (calls) => async () => { calls.push(1); return { ok: true, json: async () => ({ data: ROWS }) }; };

await t('fetches and caches the list when there is none', async () => {
  const d = db(); const calls = [];
  const ids = await P.freeModelsFor(d, { key: 'k' }, NOW, okFetch(calls));
  assert.equal(ids[0], 'deepseek/deepseek-chat:free'); assert.equal(calls.length, 1);
  assert.ok(JSON.parse(d.store[P.FREE_CACHE_KEY]).ids.length === 3);
});
await t('a fresh cache is used without asking OpenRouter again', async () => {
  const d = db({ at: new Date(NOW - 60000).toISOString(), ids: ['cached/model:free'], v: P.FREE_CACHE_VERSION }); const calls = [];
  assert.deepEqual(await P.freeModelsFor(d, {}, NOW, okFetch(calls)), ['cached/model:free']);
  assert.equal(calls.length, 0);
});
await t('a stale cache is refreshed', async () => {
  const d = db({ at: new Date(NOW - 7 * 3600000).toISOString(), ids: ['old/model:free'], v: P.FREE_CACHE_VERSION }); const calls = [];
  assert.equal((await P.freeModelsFor(d, {}, NOW, okFetch(calls)))[0], 'deepseek/deepseek-chat:free');
  assert.equal(calls.length, 1);
});
await t('OpenRouter unreachable → the stale list is still used rather than nothing', async () => {
  const d = db({ at: new Date(NOW - 7 * 3600000).toISOString(), ids: ['old/model:free'], v: P.FREE_CACHE_VERSION });
  const down = async () => { throw new Error('ECONNRESET'); };
  assert.deepEqual(await P.freeModelsFor(d, {}, NOW, down), ['old/model:free']);
});

await t('the old unversioned cache (it held the music models) is never used — refetched', async () => {
  const d = db({ at: new Date(NOW - 60000).toISOString(), ids: ['google/lyria-3-clip-preview'] }); const calls = [];
  const ids = await P.freeModelsFor(d, {}, NOW, okFetch(calls));
  assert.equal(calls.length, 1); assert.ok(!ids.includes('google/lyria-3-clip-preview'));
  assert.equal(JSON.parse(d.store[P.FREE_CACHE_KEY]).v, P.FREE_CACHE_VERSION);
});
await t('…and not even as the "stale beats none" fallback when OpenRouter is down', async () => {
  const d = db({ at: new Date(NOW - 7 * 3600000).toISOString(), ids: ['google/lyria-3-clip-preview'] });
  assert.deepEqual(await P.freeModelsFor(d, {}, NOW, async () => { throw new Error('down'); }), []);
});

console.log('\nOpenRouter free models — who uses the lookup');
await t('an admin-typed model always wins, and never triggers a lookup', async () => {
  let asked = false;
  const d = { from: () => { asked = true; throw new Error('should not be asked'); } };
  assert.deepEqual(await P.candidateModels(d, { id: 'openrouter', model_override: 'my/model' }, 'quality'), ['my/model']);
  assert.equal(asked, false);
});
await t('Groq is untouched — its models stay the configured ones', async () => {
  const d = { from: () => { throw new Error('should not be asked'); } };
  const got = await P.candidateModels(d, { id: 'groq' }, 'quality');
  assert.deepEqual(got, [P.modelFor({ id: 'groq' }, 'quality')]);
});
await t('the old hard-coded :free name is no longer what OpenRouter gets when the lookup succeeds', async () => {
  const d = db({ at: new Date().toISOString(), ids: ['deepseek/deepseek-chat:free', 'qwen/qwen3-235b-a22b:free', 'x:free'], v: P.FREE_CACHE_VERSION });
  assert.deepEqual(await P.candidateModels(d, { id: 'openrouter' }, 'fast'), ['deepseek/deepseek-chat:free', 'qwen/qwen3-235b-a22b:free']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
