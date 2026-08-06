// ============================================================================
// CONVERSATION SIGNALS JOB — batch runner for conversation-ai.js.
//
// Registered on engineRunner like every other sweep (index.js), so due-ness
// survives a Render sleep/restart the same way lead_sourcing/reply_sweep do.
// Mirrors the blueprint's "batch at midnight for low-signal events" mode —
// there is no real-time path yet, everything here runs on the shared tick.
//
// Cheapest possible no-op when there is nothing to do: bails before any query
// if conversation-ai isn't configured (no funded ANTHROPIC_API_KEY), so this
// costs nothing and touches nothing on a normal deploy today.
// ============================================================================
const conversationAi = require('./conversation-ai');
const conversationIntel = require('./conversation-intel');

const BATCH_LIMIT = 50; // bounded so one big org can't turn a tick into a long-running job

async function runDue({ supabase }) {
  if (!conversationAi.isConfigured()) return { processed: 0, skipped: 'not_configured' };

  // For each POC, find their newest inbound message and compare it against
  // conversation_summaries.last_message_key — only entities with something
  // genuinely new get an AI call, which is both the cost control and the
  // reason this can safely run on a shared tick with everything else.
  let newest;
  try {
    const { data, error } = await supabase.from('conversation_messages')
      .select('id,contact_id,candidate_id,direction,body,message_key,sent_at')
      .eq('direction', 'inbound')
      .order('sent_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    newest = data || [];
  } catch (err) {
    // Migration 041 (or 037, upstream of it) not applied yet — nothing to do.
    if (/does not exist/i.test(String(err.message || ''))) return { processed: 0, skipped: 'table_missing' };
    console.error('[conversation-signals] read failed:', err.message);
    return { processed: 0, error: err.message };
  }

  // Keep only the single newest inbound message per entity.
  const latestByEntity = new Map();
  for (const m of newest) {
    const key = m.contact_id ? `contact:${m.contact_id}` : (m.candidate_id ? `candidate:${m.candidate_id}` : null);
    if (!key) continue;
    if (!latestByEntity.has(key)) latestByEntity.set(key, m);
  }

  const entries = [...latestByEntity.entries()].slice(0, BATCH_LIMIT);
  let processed = 0;
  for (const [key, msg] of entries) {
    const [kind, id] = key.split(':');
    const col = kind === 'contact' ? 'contact_id' : 'candidate_id';

    let existing = null;
    try {
      const { data } = await supabase.from('conversation_summaries')
        .select('id,running_summary,last_message_key').eq(col, id).maybeSingle();
      existing = data || null;
    } catch (_) { /* table may not exist — extractSignals below still runs, upsert will just fail safely */ }

    if (existing && existing.last_message_key === msg.message_key) continue; // already processed

    const result = await conversationAi.extractSignals({
      newMessage: conversationIntel.stripQuotedText(msg.body || ''),
      runningSummary: existing?.running_summary || '',
    });
    if (!result) continue;

    try {
      await supabase.from('conversation_summaries').upsert({
        [col]: id,
        running_summary: result.updated_summary,
        signals: result.signals,
        needs_verification: result.needs_verification,
        last_message_key: msg.message_key,
        updated_at: new Date(),
      }, { onConflict: col });
      processed++;
    } catch (err) {
      console.error('[conversation-signals] upsert failed:', err.message);
    }
  }

  return { processed };
}

module.exports = { runDue, BATCH_LIMIT };
