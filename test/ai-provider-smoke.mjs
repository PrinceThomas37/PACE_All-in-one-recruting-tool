// The AI provider layer: what goes on the wire, and what happens when it fails.
//
// Six features (cold email, daily briefing, resume parsing, JD scrubbing, lead
// distribution, the outreach generator) route through services/ai-provider so a
// deployment can point them at a free provider — Groq, OpenRouter, a self-hosted
// Ollama — instead of a paid Anthropic key.
//
// Two things must never regress:
//   1. Each provider gets the request IT understands (Anthropic's x-api-key +
//      {system, messages}, everyone else's Bearer + system-as-a-message). Get
//      this wrong and the feature silently falls back forever.
//   2. AI STAYS A SEAM. complete() returns null — not an error — when nothing
//      is configured or every provider fails, because the rules writer behind
//      that null is what production actually runs on today.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ai = require('../services/ai-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── wire format: Anthropic ───────────────────────────────────────────────────
const a = ai.buildRequest('anthropic', { key: 'sk-ant-x', system: 'SYS', prompt: 'HI', maxTokens: 42 });
const aBody = JSON.parse(a.options.body);
step('anthropic posts to the messages endpoint', a.url === 'https://api.anthropic.com/v1/messages', a.url);
step('anthropic authenticates with x-api-key, not Bearer',
  a.options.headers['x-api-key'] === 'sk-ant-x' && !a.options.headers.Authorization);
step('anthropic sends a version header', a.options.headers['anthropic-version'] === '2023-06-01');
step('anthropic takes the system prompt as a FIELD',
  aBody.system === 'SYS' && aBody.messages.length === 1 && aBody.messages[0].role === 'user');
step('max_tokens is passed through', aBody.max_tokens === 42);

// ── wire format: the OpenAI-compatible providers ─────────────────────────────
const g = ai.buildRequest('groq', { key: 'gsk_x', system: 'SYS', prompt: 'HI' });
const gBody = JSON.parse(g.options.body);
step('groq posts to its OpenAI-compatible endpoint',
  g.url === 'https://api.groq.com/openai/v1/chat/completions', g.url);
step('groq authenticates with Bearer, not x-api-key',
  g.options.headers.Authorization === 'Bearer gsk_x' && !g.options.headers['x-api-key']);
step('the system prompt becomes the FIRST MESSAGE, not a field',
  gBody.system === undefined && gBody.messages[0].role === 'system' && gBody.messages[0].content === 'SYS'
  && gBody.messages[1].role === 'user');
step('groq defaults to a free-tier model', gBody.model === 'llama-3.3-70b-versatile', gBody.model);

const or = ai.buildRequest('openrouter', { key: 'sk-or-x', prompt: 'HI' });
step('openrouter posts to its own host', or.url.startsWith('https://openrouter.ai/'), or.url);
step('openrouter defaults to a :free model', JSON.parse(or.options.body).model.endsWith(':free'));
step('a request with no system prompt carries only the user message',
  JSON.parse(or.options.body).messages.length === 1);

// ── Ollama: keyless, and the address is the connection ───────────────────────
step('ollama without a server address cannot be built',
  ai.buildRequest('ollama', {}) === null);
const ol = ai.buildRequest('ollama', { baseUrl: 'http://localhost:11434' });
step('ollama needs no key at all', !!ol && !ol.options.headers.Authorization);
step('the OpenAI-compatible path is appended for the operator',
  ol.url === 'http://localhost:11434/v1/chat/completions', ol.url);
step('a trailing slash does not double up',
  ai.endpointFor(ai.PROVIDERS.ollama, 'http://box:11434/') === 'http://box:11434/v1/chat/completions');
step('an address that already ends in /v1 is not doubled',
  ai.endpointFor(ai.PROVIDERS.ollama, 'http://box:11434/v1') === 'http://box:11434/v1/chat/completions');

// A keyed provider with no key must NOT be built — this is what stops an
// unconfigured deployment from firing an unauthenticated request every time.
step('a keyed provider with no key is never built', ai.buildRequest('groq', { prompt: 'x' }) === null);
step('an unknown provider is never built', ai.buildRequest('nope', { key: 'k', prompt: 'x' }) === null);

// A per-provider model override reaches the wire.
step('an explicit model overrides the default',
  JSON.parse(ai.buildRequest('groq', { key: 'k', model: 'qwen-2.5-32b', prompt: 'x' }).options.body).model === 'qwen-2.5-32b');

// ── parsing both response shapes ─────────────────────────────────────────────
const pa = ai.parseResponse('anthropic', {
  content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 3, output_tokens: 5 },
});
step('anthropic text is read out of content[].text', pa.text === 'hello');
step('anthropic token usage is reported', pa.usage.input_tokens === 3 && pa.usage.output_tokens === 5);
step('non-text anthropic blocks are ignored',
  ai.parseResponse('anthropic', { content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'y' }] }).text === 'y');

const pg = ai.parseResponse('groq', {
  choices: [{ message: { role: 'assistant', content: 'hello' } }],
  usage: { prompt_tokens: 3, completion_tokens: 5 },
});
step('openai-shaped text is read out of choices[0].message.content', pg.text === 'hello');
step('openai-shaped usage is mapped onto the same names',
  pg.usage.input_tokens === 3 && pg.usage.output_tokens === 5);

// An error body must not be mistaken for an answer.
step('an error payload parses as null (so the next provider is tried)',
  ai.parseResponse('groq', { error: { message: 'rate limited' } }) === null);
step('an empty completion parses as null',
  ai.parseResponse('groq', { choices: [{ message: { content: '   ' } }] }) === null);
step('an empty anthropic completion parses as null',
  ai.parseResponse('anthropic', { content: [] }) === null);

// ── configuration + the fallback chain ───────────────────────────────────────
// A fake app_settings store: { key: value } as the real table stores them.
const storeOf = (rows) => ({
  from() {
    const q = { _key: null, _like: null };
    q.select = () => q;
    q.eq = (_c, v) => { q._key = v; return q; };
    q.ilike = () => q;
    q.maybeSingle = async () => ({ data: rows[q._key] ? { value: rows[q._key] } : null });
    return q;
  },
});

const chainOf = async (rows) => (await ai.resolveChain(storeOf(rows))).map(c => c.id);

step('nothing configured means no providers at all',
  (await chainOf({})).length === 0);
step('an unconfigured deployment reports AI unavailable',
  (await ai.isAvailable(storeOf({}))) === false);
step('a single free key is enough to turn AI on',
  (await ai.isAvailable(storeOf({ int_groq_api_key: 'gsk_x' }))) === true);

step('a placeholder key is not configuration',
  (await chainOf({ int_anthropic_api_key: 'your_anthropic_api_key_here' })).length === 0);

step('ollama is off until a server address is given',
  (await chainOf({ int_ollama_model: 'llama3.1:8b' })).length === 0);
step('ollama turns on with an address and no key',
  (await chainOf({ int_ollama_base_url: 'http://localhost:11434' })).join() === 'ollama');

// The admin's choice leads; the rest stay as fallbacks, which is what makes a
// free tier safe to depend on.
const rows = { int_anthropic_api_key: 'sk-ant', int_groq_api_key: 'gsk', int_openrouter_api_key: 'sk-or' };
step('with no choice made, the registry order applies',
  (await chainOf(rows)).join() === 'anthropic,groq,openrouter');
step('the chosen provider goes first',
  (await chainOf({ ...rows, int_ai_active: 'groq' })).join() === 'groq,anthropic,openrouter');
step('choosing a provider does not drop the others as fallbacks',
  (await chainOf({ ...rows, int_ai_active: 'openrouter' })).length === 3);
step('choosing a provider whose key is gone falls back to the rest',
  (await chainOf({ int_groq_api_key: 'gsk', int_ai_active: 'ollama' })).join() === 'groq');

const withModel = await ai.resolveChain(storeOf({ int_groq_api_key: 'gsk', int_groq_model: 'qwen-2.5-32b' }));
step('a stored model override is carried into the chain', withModel[0].model === 'qwen-2.5-32b');
step('with no override the provider default is used',
  (await ai.resolveChain(storeOf({ int_groq_api_key: 'gsk' })))[0].model === 'llama-3.3-70b-versatile');

// ── THE SEAM: complete() never throws, and null means "use the rules" ────────
const nothing = await ai.complete(storeOf({}), { prompt: 'hi' });
step('complete() with no provider returns null rather than throwing', nothing === null);
step('complete() with no store returns null', (await ai.complete(null, { prompt: 'hi' })) === null);

// Every provider failing (a spent free tier, an unreachable box) must land in
// the same place as "not configured": null, and the caller writes with rules.
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) }; };
const allFail = await ai.complete(storeOf({ int_groq_api_key: 'g', int_openrouter_api_key: 'o' }), { prompt: 'hi', timeoutMs: 2000 });
step('a spent free tier falls through to the next provider', calls === 2, `${calls} attempts`);
step('every provider failing returns null, not an error', allFail === null);

// A working provider ends the chain — the fallbacks are not also called.
calls = 0;
globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'drafted' } }] }) }; };
const ok = await ai.complete(storeOf({ int_groq_api_key: 'g', int_openrouter_api_key: 'o' }), { prompt: 'hi' });
step('a working provider returns its text', ok && ok.text === 'drafted');
step('the answer says which provider wrote it', ok && ok.provider === 'groq', ok && ok.provider);
step('a success does not also call the fallbacks', calls === 1, `${calls} attempts`);
globalThis.fetch = realFetch;

// ── the seam holds only if nothing bypasses it ───────────────────────────────
// A feature that goes straight to a provider URL is unreachable by the admin
// dropdown and cannot fall back — which is exactly the six-copies problem this
// layer replaced. Fail loudly if one comes back.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git' || f === 'test') continue;
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (f.endsWith('.js')) out.push(full);
  }
  return out;
};
const PROVIDER_HOSTS = /api\.anthropic\.com\/v1\/messages|api\.groq\.com\/openai|openrouter\.ai\/api\/v1\/chat/;
const offenders = walk(root)
  .filter(f => !f.endsWith('services/ai-provider.js') && !f.endsWith('routes/integrations.js'))
  .filter(f => PROVIDER_HOSTS.test(readFileSync(f, 'utf8')))
  .map(f => f.replace(root, ''));
step('no feature calls a provider directly — everything goes through the seam',
  offenders.length === 0, offenders.join(', '));

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
