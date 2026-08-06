// Unit test for telephony/registry.js + telephony/inbound.js — the part that
// makes telephony provider-agnostic: registry.get() looks an adapter up by
// name, and processInboundTelephonyMessage() runs the SAME matching/storage
// logic regardless of which carrier produced the normalized message. This is
// the guarantee that a second carrier (Exotel, a client's own PBX relay,
// anything implementing the interface in registry.js) never needs its own
// copy of that logic.
//
// Usage: node test/telephony-registry-smoke.mjs   (no external dependencies)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const registry = require('../telephony/registry.js');
const { processInboundTelephonyMessage } = require('../telephony/inbound.js');

// ── 1. Both shipped adapters are registered and implement the interface ────
{
  ok('twilio is registered', registry.list().includes('twilio'), JSON.stringify(registry.list()));
  ok('generic is registered', registry.list().includes('generic'), JSON.stringify(registry.list()));
  ok('an unknown provider name returns null, not a crash', registry.get('some-carrier-nobody-wrote-yet') === null);
}
{
  const REQUIRED = ['isConfigured', 'verifyWebhook', 'normalizeInbound', 'ackResponse', 'sendMessage'];
  for (const name of registry.list()) {
    const adapter = registry.get(name);
    for (const method of REQUIRED) {
      ok(`adapter "${name}" implements ${method}()`, typeof adapter[method] === 'function');
    }
  }
}

// ── 2. The shared pipeline: a fake Supabase, exercised once per "carrier" ──
// A minimal stub standing in for supabase-js's chainable query builder —
// enough to prove the SAME code path runs for two different adapters.
function makeFakeSupabase({ candidateMatch = null, contactMatch = null } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: table === 'candidates' ? candidateMatch : null }),
        insert: async (row) => { inserted.push({ table, row }); return { error: null }; },
        then: (resolve) => resolve({ data: table === 'contacts' ? (contactMatch ? [contactMatch] : []) : [] }),
      };
      return chain;
    },
  };
}

{
  const supabase = makeFakeSupabase({ candidateMatch: { id: 'cand-1' } });
  const normalized = { from: '+14158675310', body: 'Interested, tell me more', messageKey: 'twilio-msg-1', channel: 'sms' };
  const result = await processInboundTelephonyMessage(supabase, 'twilio', normalized);
  ok('a message matched to a candidate is recorded as matched', result.matched && result.candidateId === 'cand-1', JSON.stringify(result));
  ok('the stored row is tagged with the carrier + channel', supabase.inserted[0]?.row.provider === 'twilio_sms', JSON.stringify(supabase.inserted));
  ok('the stored row carries the candidate id', supabase.inserted[0]?.row.candidate_id === 'cand-1');
}
{
  // A DIFFERENT "carrier" name, same candidate match, same pipeline function —
  // this is the actual claim being tested: no per-carrier copy of the logic.
  const supabase = makeFakeSupabase({ candidateMatch: { id: 'cand-2' } });
  const normalized = { from: '+14155559999', body: 'Sounds good', messageKey: 'ext-77', channel: 'whatsapp' };
  const result = await processInboundTelephonyMessage(supabase, 'generic', normalized);
  ok('the exact same function handles a second, unrelated carrier name', result.matched && result.candidateId === 'cand-2');
  ok('...tagging the row with THAT carrier\'s name, not a hardcoded one', supabase.inserted[0]?.row.provider === 'generic_whatsapp');
}
{
  const supabase = makeFakeSupabase(); // no match anywhere
  const result = await processInboundTelephonyMessage(supabase, 'twilio', { from: '+10000000000', body: 'hi', messageKey: 'x', channel: 'sms' });
  ok('an unmatched phone number is reported as unmatched', result.matched === false, JSON.stringify(result));
  ok('...and nothing is written for it', supabase.inserted.length === 0);
}

console.log('\n=== TELEPHONY: REGISTRY + SHARED PIPELINE SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
