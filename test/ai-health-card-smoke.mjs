// The AI health card must ALWAYS say something.
//
// The owner clicked "Test AI generation", saw "Asking each connected
// provider…", and then the card went back to how it looked before. From the
// outside that is indistinguishable from the button doing nothing — which is
// the exact failure this card exists to end.
//
// Two causes, both structural:
//   1. The card was drawn INSIDE aiBudgetCard(), which returns '' when the
//      budget has not loaded — so the diagnostic vanished precisely when
//      something was wrong.
//   2. Every non-happy path (an unparseable reply, a 404 from a half-finished
//      deploy, nothing configured) had to produce visible, specific text.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ai = require('../services/ai-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const page = readFileSync(new URL('../public/js/08-page-admin.js', import.meta.url), 'utf8');

// ── 1. the card is drawn independently of the budget ─────────────────────────
step('the health card is rendered on its own, not inside the budget card',
  /aiProviderNote\(\)\+aiHealthCard\(\)\+aiBudgetCard\(\)/.test(page));
// Slice to the next declaration, not to saveAiBudget — the health card's own
// definition sits between them and its name would match here.
const budgetFn = page.slice(page.indexOf('function aiBudgetCard(){'), page.indexOf('function aiHealthCard(){'));
step('the budget card no longer carries the health card with it',
  !budgetFn.includes('aiHealthCard()'));
step('the budget card still bails out early when it has no data (why 1 mattered)',
  /var b=STATE\.aiBudget;\s*\n\s*if\(!b\)return '';/.test(budgetFn));

// ── 2. every path renders visible text ───────────────────────────────────────
const cardFn = page.slice(page.indexOf('function aiHealthCard(){'), page.indexOf('window.runAiHealthTest'));
for (const [name, needle] of [
  ['pending', 'Asking each connected provider'],
  ['working', 'AI IS WORKING'],
  ['failing', 'AI IS NOT WORKING'],
  ['nothing configured', 'No provider is connected, so no AI ran'],
  ['a remembered failure', 'The last failure recorded was'],
  ['never run', 'Click <b>Test AI generation</b>'],
]) step(`the "${name}" state renders its own message`, cardFn.includes(needle));

step('there is no branch that renders an empty string',
  !/body\s*=\s*''/.test(cardFn));

// ── 3. a bad or missing response still says something ────────────────────────
const runFn = page.slice(page.indexOf('window.runAiHealthTest'), page.indexOf('window.saveAiBudget'));
step('a response that is not an object becomes a visible error, not silence',
  /r&&typeof r==='object'/.test(runFn) && runFn.includes('replied with nothing usable'));
step('a mid-deploy 404 is explained in words the owner can act on',
  /Unexpected token\|JSON/.test(runFn) && runFn.includes('wait a minute for the deploy to finish'));
step('a failed budget refresh cannot wipe the test result',
  /apiGet\('\/admin\/ai-budget'\)[\s\S]*?\.catch\(function\(\)\{\}\)/.test(runFn));
step('the result is rendered BEFORE the budget refresh is attempted',
  runFn.indexOf('renderIntegrationsModal();\n    return apiGet') > 0);

// ── 4. the server tells the card WHY nothing is configured ───────────────────
// "nothing saved" and "your saved key is not being found" look identical to a
// user, and only one of them is a bug.
const storeOf = (rows) => ({
  from() {
    const q = { _key: null };
    q.select = () => q; q.eq = (_c, v) => { q._key = v; return q; }; q.ilike = () => q;
    q.maybeSingle = async () => ({ data: rows[q._key] ? { value: rows[q._key] } : null });
    return q;
  },
});

const empty = await ai.diagnose(storeOf({}));
step('an unconfigured deployment reports every provider it looked at',
  empty.configured === false && empty.providers.length === ai.PROVIDER_ORDER.length);
step('each provider says why it is not usable',
  empty.providers.every(p => p.usable === false && !!p.why), JSON.stringify(empty.providers[1]));
step('ollama explains that it needs an address, not a key',
  empty.providers.find(p => p.provider === 'ollama').why === 'no server address saved');
step('a placeholder key is called out as a placeholder',
  (await ai.diagnose(storeOf({ int_anthropic_api_key: 'your_anthropic_api_key_here' })))
    .providers.find(p => p.provider === 'anthropic').why === 'the placeholder value is still in place');

// A saved key must be visibly recognised — this is what proves a save stuck.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ready' } }] }) });
const saved = await ai.diagnose(storeOf({ int_groq_api_key: 'gsk_abcd1234' }));
const groq = saved.providers.find(p => p.provider === 'groq');
step('a saved key is reported as found', groq.key_found === true && groq.usable === true);
step('the hint identifies the key without exposing it',
  groq.key_hint === '••••1234' && !JSON.stringify(saved).includes('gsk_abcd1234'), groq.key_hint);
step('a working provider is actually exercised, not assumed',
  saved.working === true && saved.attempts[0].ok === true && saved.attempts[0].sample === 'ready');

globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'model_decommissioned: llama-x' } }) });
const broken = await ai.diagnose(storeOf({ int_groq_api_key: 'gsk_abcd1234' }));
step("a valid key with a bad model reports the PROVIDER's own words",
  broken.working === false && /model_decommissioned: llama-x/.test(broken.attempts[0].error), broken.attempts[0].error);
step('that case still shows the key as found — so it is not mistaken for "no key"',
  broken.providers.find(p => p.provider === 'groq').key_found === true);
globalThis.fetch = realFetch;

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
