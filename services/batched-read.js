// ============================================================================
// READ BY A LIST OF IDS, SAFELY (R-352, owner 3 Nov 2026: "why are the follow ups paused").
// ----------------------------------------------------------------------------
// From 30 Oct every follow-up was skipped as "no first email": the engine asked the database about ~1,000 contacts in ONE
// request, the request failed, nobody looked at the error, and an empty answer read as "nothing was ever sent". Here: ids in
// batches of 100, every page read (a request returns at most 1,000 rows), and a failed read THROWS — a job that cannot see stops
// and says so; it never decides on an empty answer. Injectable `supabase` so a test can make the database fail.
// ============================================================================
'use strict';

const BATCH = 100, PAGE = 1000;

async function readByIds(supabase, table, select, col, ids, narrow) {
  const out = [];
  const list = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += BATCH) {
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select(select).in(col, list.slice(i, i + BATCH));
      if (narrow) q = narrow(q);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} lookup failed: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

async function readAllPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

module.exports = { BATCH, PAGE, readByIds, readAllPages };
