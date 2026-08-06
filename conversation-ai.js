// ============================================================================
// CONVERSATION AI SEAM — optional LLM enrichment behind conversation-intel.js.
//
// The plan (docs/AUTONOMOUS_ENGINE_PLAN.md) always said the AI seam would
// "plug in behind analyzeThread's output shape and change nothing about its
// callers." This is that seam. There is still no funded ANTHROPIC_API_KEY
// (CLAUDE.md) — same as every other AI call site in this repo (routes/ai.js) —
// so isConfigured() is false today, every caller falls back to the existing
// rules-only output, and nothing here runs, costs anything, or changes
// behavior until a real key is set. Dark by design, not half-built.
//
// WHAT IT DOES, ONCE A KEY EXISTS
// Reads the newest inbound message plus the running summary already on file
// and asks the model for a small set of structured signals — mirroring the
// architecture blueprint this was designed against — each with a
// self-reported 0-100 confidence. A signal at or above CONFIDENCE_FLOOR folds
// into the running summary automatically; anything below it comes back as
// `needs_verification` for a human yes/no check rather than being trusted
// silently (surfaced by next-action.js as a `signal_verify` item).
// ============================================================================
const { fetchWithTimeout } = require('./http-client');

const AI_TIMEOUT_MS = 30000;
const MODEL = 'claude-sonnet-4-20250514';
const CONFIDENCE_FLOOR = 75;
const FIELDS = ['topic', 'products', 'sentiment', 'objections', 'next_step', 'business_signals'];

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';
}

function buildPrompt({ newMessage, runningSummary }) {
  return `You are extracting structured signals from ONE new message in an ongoing recruiting conversation. Do not use any knowledge beyond what is given below.

Running summary of the relationship so far (may be empty for a new contact):
"""${runningSummary || '(no summary yet)'}"""

The new message just received:
"""${newMessage}"""

Return ONLY valid JSON, no prose, in exactly this shape:
{
  "topic": {"value": string, "confidence": number},
  "products": {"value": string, "confidence": number},
  "sentiment": {"value": "positive"|"neutral"|"hesitant"|"disengaging", "confidence": number},
  "objections": {"value": string, "confidence": number},
  "next_step": {"value": string, "confidence": number},
  "business_signals": {"value": string, "confidence": number},
  "updated_summary": string
}
Each "value" should be an empty string if nothing applies. "confidence" is your own 0-100 certainty that the value is correct, based only on how explicitly the evidence appeared in the message — not a guess dressed up as a number. "updated_summary" is the running summary rewritten to include anything new here, kept under 200 words.`;
}

/** Turn the model's raw JSON into a stable shape, regardless of what it left out. */
function normalizeSignals(raw, fallbackSummary) {
  const signals = {};
  const needsVerification = [];
  for (const f of FIELDS) {
    const entry = (raw && raw[f]) || {};
    const confidence = Number(entry.confidence);
    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    const conf = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0;
    signals[f] = { value, confidence: conf };
    if (value && conf < CONFIDENCE_FLOOR) needsVerification.push({ field: f, value, confidence: conf });
  }
  const updatedSummary = raw && typeof raw.updated_summary === 'string'
    ? raw.updated_summary.trim().slice(0, 1200)
    : (fallbackSummary || '');
  return { signals, needs_verification: needsVerification, updated_summary: updatedSummary };
}

/**
 * Extract signals from one new inbound message. Returns null (never throws)
 * when there is nothing to do — no key configured, empty message, a network
 * failure, or a response that isn't parseable JSON — so a caller can always
 * treat "no AI result" as "fall back to the rules-only path," exactly like
 * every other AI call site in this app.
 */
async function extractSignals({ newMessage, runningSummary }, opts = {}) {
  if (!isConfigured()) return null;
  if (!newMessage || !newMessage.trim()) return null;
  try {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: buildPrompt({ newMessage, runningSummary }) }],
      }),
    }, { timeoutMs: AI_TIMEOUT_MS, fetchImpl: opts.fetchImpl });
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeSignals(parsed, runningSummary);
  } catch (err) {
    console.error('[conversation-ai] extraction failed:', err.message);
    return null;
  }
}

module.exports = { isConfigured, extractSignals, buildPrompt, normalizeSignals, CONFIDENCE_FLOOR, FIELDS };
