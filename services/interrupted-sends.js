// ============================================================================
// SENDS CUT OFF MID-FLIGHT — rows a previous process claimed and never finished.
// ----------------------------------------------------------------------------
// The send loop claims a row (pending → 'sending') the moment before it hands
// it to Gmail/Outlook, and writes 'sent' or the failure the moment after. A
// process that dies in between — a deploy, a restart, the free tier going to
// sleep — leaves the row at 'sending', where no screen shows it and no run
// picks it up again. Measured live 2026-09-28: one first follow-up, stuck at
// 'sending' since 26 Sep, on no screen at all.
//
// Nobody can tell from here whether the provider accepted it, so it becomes an
// UNCERTAIN failure (services/send-retry.js `interruptedUpdate`): listed under
// "Didn't send" with "it may have gone out — check Sent before retrying", and
// never retried by itself.
//
// Run once at boot, before this process has claimed anything. A row that a
// still-running OLD process (the overlap during a deploy) is part-way through
// is safe too: the send loop's own 'sent' / failure write lands on the row by
// id when it finishes, over this one. And this write is conditional on the row
// STILL being 'sending', so it never overwrites an answer that already landed.
// ============================================================================
const sendRetry = require('./send-retry');

const BATCH = 500;

// Returns how many rows it moved. Never throws: a recovery sweep must never be
// the reason the server fails to start.
async function releaseInterruptedSends(supabase) {
  try {
    const { data, error } = await supabase.from('emails')
      .select('id, attempt_count').eq('status', 'sending')
      .order('id', { ascending: true }).limit(BATCH);
    if (error || !data || !data.length) return 0;
    let moved = 0;
    for (const row of data) {
      try {
        const { data: done, error: upErr } = await supabase.from('emails')
          .update(sendRetry.interruptedUpdate(row))
          .eq('id', row.id).eq('status', 'sending')
          .select('id');
        if (!upErr && done && done.length) moved++;
      } catch (_) { /* next row */ }
    }
    return moved;
  } catch (_) {
    return 0;
  }
}

module.exports = { releaseInterruptedSends };
