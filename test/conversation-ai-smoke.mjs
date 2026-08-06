// Unit test for conversation-ai.js — the optional LLM seam behind
// conversation-intel.js. There is no funded ANTHROPIC_API_KEY in this repo
// (and none in CI), so this test asserts the two things that must be true
// regardless of that: (1) the module is dark — isConfigured() false, every
// entry point a safe no-op — and (2) the parsing/shaping logic that WOULD run
// once a key exists is correct, tested directly without a network call.
//
// Usage: node test/conversation-ai-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── 1. Dark by default: no ANTHROPIC_API_KEY in this test's environment ────
{
  delete process.env.ANTHROPIC_API_KEY;
  const conversationAi = require('../conversation-ai.js');
  ok('isConfigured() is false with no key', conversationAi.isConfigured() === false);
}
{
  process.env.ANTHROPIC_API_KEY = 'your_anthropic_api_key_here';
  delete require.cache[require.resolve('../conversation-ai.js')];
  const conversationAi = require('../conversation-ai.js');
  ok('isConfigured() is false for the placeholder key', conversationAi.isConfigured() === false);
}
{
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../conversation-ai.js')];
  const conversationAi = require('../conversation-ai.js');
  const result = await conversationAi.extractSignals({ newMessage: 'Sounds good, let’s talk rates.', runningSummary: '' });
  ok('extractSignals() is a safe no-op with no key configured', result === null, JSON.stringify(result));
}
{
  process.env.ANTHROPIC_API_KEY = 'sk-test-real-looking-key';
  delete require.cache[require.resolve('../conversation-ai.js')];
  const conversationAi = require('../conversation-ai.js');
  const result = await conversationAi.extractSignals({ newMessage: '', runningSummary: 'x' });
  ok('extractSignals() is a safe no-op for an empty message even WITH a key', result === null, JSON.stringify(result));
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../conversation-ai.js')];
}

const conversationAi = require('../conversation-ai.js');

// ── 2. Prompt shape ──────────────────────────────────────────────────────
{
  const prompt = conversationAi.buildPrompt({ newMessage: 'What are your rates?', runningSummary: 'Prior context.' });
  ok('the prompt carries the new message', prompt.includes('What are your rates?'));
  ok('the prompt carries the running summary', prompt.includes('Prior context.'));
  ok('the prompt asks for JSON only', /ONLY valid JSON/i.test(prompt));
}
{
  const prompt = conversationAi.buildPrompt({ newMessage: 'Hi', runningSummary: '' });
  ok('an empty running summary is labeled, not left blank/confusing', /no summary yet/i.test(prompt), prompt);
}

// ── 3. normalizeSignals — the model's raw JSON becomes a stable shape ──────
{
  const raw = {
    topic: { value: 'Java backend role', confidence: 92 },
    products: { value: '', confidence: 10 },
    sentiment: { value: 'positive', confidence: 88 },
    objections: { value: 'rate too low', confidence: 60 },
    next_step: { value: 'send updated resume', confidence: 40 },
    business_signals: { value: '', confidence: 5 },
    updated_summary: 'Interested in the Java role, pushing back on rate.',
  };
  const result = conversationAi.normalizeSignals(raw, 'old summary');
  ok('high-confidence fields are kept as-is', result.signals.topic.value === 'Java backend role');
  ok('the updated summary replaces the old one', result.updated_summary === raw.updated_summary);
  ok('fields at/above the confidence floor are NOT held for verification',
    !result.needs_verification.some(v => v.field === 'topic' || v.field === 'sentiment'));
  ok('fields below the confidence floor WITH a value ARE held for verification',
    result.needs_verification.some(v => v.field === 'objections') &&
    result.needs_verification.some(v => v.field === 'next_step'),
    JSON.stringify(result.needs_verification));
  ok('an empty value is never queued for verification even at low confidence',
    !result.needs_verification.some(v => v.field === 'products' || v.field === 'business_signals'),
    JSON.stringify(result.needs_verification));
}
{
  // A malformed / partial response must not crash the caller — this is the
  // difference between "the model said something odd" and "the sweep broke."
  const result = conversationAi.normalizeSignals({}, 'kept summary');
  ok('a fully empty response still returns a valid shape', Array.isArray(result.needs_verification) && result.needs_verification.length === 0);
  ok('an empty response falls back to the prior summary', result.updated_summary === 'kept summary');
  for (const f of conversationAi.FIELDS) {
    ok(`...field "${f}" defaults to an empty, zero-confidence entry`, result.signals[f].value === '' && result.signals[f].confidence === 0);
  }
}
{
  // Confidence is clamped, not trusted verbatim — a model could return
  // anything in that field.
  const result = conversationAi.normalizeSignals({ topic: { value: 'x', confidence: 500 } }, '');
  ok('confidence is clamped to [0,100]', result.signals.topic.confidence === 100, String(result.signals.topic.confidence));
}

console.log('\n=== CONVERSATION AI SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
