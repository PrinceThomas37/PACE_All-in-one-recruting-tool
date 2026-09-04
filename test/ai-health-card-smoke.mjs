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
const runFn2 = runFn;
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

// ── 5. the answer must survive the browser losing it ─────────────────────────
// A result that lives only in a promise is lost to a hung request, a reload, or
// anything between the server and the screen. The server keeps the last test,
// and the card falls back to it.
step('a test result is stored server-side', typeof ai.recordTest === 'function' && typeof ai.getLastTest === 'function');
const persisted = {};
const rwStore = {
  from() {
    const q = { _key: null };
    q.select = () => q; q.eq = (_c, v) => { q._key = v; return q; }; q.ilike = () => q;
    q.maybeSingle = async () => ({ data: persisted[q._key] ? { value: persisted[q._key] } : null });
    q.upsert = async (row) => { persisted[row.key] = row.value; return { error: null }; };
    return q;
  },
};
globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"Invalid API Key"}}' });
await ai.diagnose(rwStore.__proto__ === Object.prototype ? Object.assign({}, rwStore, {
  from: (() => { const rows = { int_groq_api_key: 'gsk_x' }; return () => { const q = { _key: null };
    q.select = () => q; q.eq = (_c, v) => { q._key = v; return q; }; q.ilike = () => q;
    q.maybeSingle = async () => ({ data: rows[q._key] ? { value: rows[q._key] } : (persisted[q._key] ? { value: persisted[q._key] } : null) });
    q.upsert = async (row) => { persisted[row.key] = row.value; return { error: null }; };
    return q; }; })(),
}) : rwStore);
globalThis.fetch = realFetch;
step('the stored result records what happened', !!persisted[ai.LAST_TEST_KEY], Object.keys(persisted).join(','));
const storedTest = JSON.parse(persisted[ai.LAST_TEST_KEY] || '{}');
step('the stored result carries a timestamp and the attempts',
  !!storedTest.at && Array.isArray(storedTest.attempts) && storedTest.attempts.length === 1);
step('the stored result keeps the provider\'s own error text',
  /Invalid API Key/.test(JSON.stringify(storedTest)));
step('the card renders a stored result when it has no live one',
  cardFn.includes('b.last_test') && cardFn.includes('last tested '));

// ── 6. a request that never settles still answers ────────────────────────────
step('a hung request gives up and says so', /did not answer within 45 seconds/.test(runFn2));
step('the give-up path explains the free-tier cold start',
  /sleeps when idle/.test(runFn2));
step('the give-up timer cannot fight a late real answer',
  /var settled=false/.test(runFn2) && /clearTimeout\(giveUp\)/.test(runFn2));
step('the pending state warns that waking up takes a minute',
  cardFn.includes('idle and is waking up'));

// ── 7. a failure tells you what to use instead ───────────────────────────────
// "model decommissioned" is only half an answer; the other half is the list of
// models that provider actually offers, ready to paste into the model box.
step('a failed attempt asks the provider what it does offer',
  typeof ai.listModels === 'function');
let listed = 0;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/models')) { listed++; return { ok: true, status: 200, json: async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'llama-3.1-8b-instant' }] }) }; }
  return { ok: false, status: 400, text: async () => '{"error":{"message":"model_decommissioned"}}' };
};
const withList = await ai.diagnose(storeOf({ int_groq_api_key: 'gsk_x' }));
step('the offered models come back with the failure',
  (withList.attempts[0].available_models || []).includes('llama-3.3-70b-versatile'), JSON.stringify(withList.attempts[0].available_models));
step('the model list is only fetched when something failed', listed === 1, `${listed} lookups`);
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ready' } }] }) });
listed = 0;
await ai.diagnose(storeOf({ int_groq_api_key: 'gsk_x' }));
step('a success does not go asking for a model list', listed === 0);
globalThis.fetch = realFetch;
step('the card shows those models with instructions to paste one',
  page.includes('This provider currently offers') && page.includes('Paste one of these into the model box'));

// ── 8. the card cannot be the thing that hides a fault ───────────────────────
// The owner reported the modal "glitching and showing itself" — a redraw with
// no change, which is what happens when the card throws before it can render a
// result. So both the card and the click handler have an error boundary, and
// the exception becomes visible text rather than a silent flash.
step('the card render is wrapped in an error boundary',
  /function aiHealthCard\(\)\{\s*try\{ return aiHealthCardInner\(\); \}/.test(page));
step('a thrown card shows the error message on screen',
  page.includes('The AI status card could not draw'));
step('the click handler has its own boundary',
  /function runAiHealthTestInner\(\)/.test(page) && page.includes('hit an error before it could ask the server'));
step('the boundary offers a way to retry',
  /could not draw[\s\S]{0,400}onclick="runAiHealthTest\(\)"/.test(page));

// ── 9. it answers its own question ───────────────────────────────────────────
// A screen titled "Is AI actually working?" should not depend on a button being
// pressed — especially not while a click that does not land is a live suspect.
const openFn = page.slice(page.indexOf('window.openIntegrationsModal'), page.indexOf('function intgFind'));
step('opening the screen runs the test when nothing has been recorded yet',
  /if\(!r\|\|!r\.last_test\)/.test(openFn) && openFn.includes('runAiHealthTest()'));
step('it only self-runs when a provider is actually configured',
  /it\.ai&&it\.configured/.test(openFn));
step('a stored result is shown instead of spending another call',
  openFn.includes('!r.last_test'));
step('it does not self-run over a result already on screen',
  /!STATE\.aiHealth/.test(openFn));

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
