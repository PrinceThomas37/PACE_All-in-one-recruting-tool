'use strict';
// THE LEAD LIST, READ IN PAGES, WITHOUT POSTING TEXT (R-301, 21 Oct).
//
// GET /jobs is the whole company's leads, re-read by every open tab every 3 minutes. Each lead used to arrive with its pasted
// job description (`research.jd_raw`): 7.7 MB of the 8.7 MB of research text on 1,479 leads, and the memory watcher saw one
// load grow the free server by 65-110 MB. Now the rows are read a page at a time and each page is cut down
// (services/lead-posting.js forList) before the next is read, so the full text is never in memory at once and never sent.
// Ordered newest first with the id as a tie-breaker, so a page boundary cannot repeat or skip a lead.
const leadPosting = require('./lead-posting');

// R-324: the pages used to be read ONE AFTER ANOTHER — three trips to the database in Seoul, back to back, before the list could be
// answered (R-304 measured GET /jobs going from 7-10 s to 13-20 s after R-301). Now the first page also asks how many leads there
// are, and the rest are read AT THE SAME TIME: two waits, however big the list grows. Each page is still cut down
// (forList) as it arrives. A lead added or removed between the reads could shift a page boundary, so the pages are joined in
// order and a lead seen twice is kept once. If the count does not come back, it falls back to reading page after page.
// R-348 (30 Oct): six pages read AT ONCE on the small database each ran into its 8 s limit and the whole list failed — the
// screen asked again, adding load. Now at most CONCURRENT pages are read together, and a page the database cut off for being
// busy is read again (a read is always safe to repeat) instead of failing the list. `fallbackSelect`: if the light select is
// refused (the columns of migration 070 not there yet) the list is read the old way, so the code never depends on the order
// the migration and the release happen in.
const CONCURRENT = 2;
const TRIES = 3;
const busy = (e) => !!e && (e.code === '57014' || /statement timeout|canceling statement/i.test(String(e.message || '')));
const missingColumn = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find/i.test(String(e.message || '')));

async function loadLeadList({ supabase, select, fallbackSelect, orgId, pageSize = 500, wait = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  let sel = select;
  const page = async (from, withCount) => {
    for (let attempt = 1; ; attempt++) {
      let query = supabase.from('jobs').select(sel, withCount ? { count: 'exact' } : undefined).is('deleted_at', null);
      if (orgId) query = query.eq('org_id', orgId);
      const r = await query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + pageSize - 1);
      if (r.error && fallbackSelect && sel !== fallbackSelect && missingColumn(r.error)) { sel = fallbackSelect; attempt = 0; continue; }
      if (r.error && busy(r.error) && attempt < TRIES) { await wait(1000 * attempt); continue; }
      if (r.error) throw r.error;
      return r;
    }
  };
  const cut = (data) => (data || []).map(leadPosting.forList);
  const first = await page(0, true);
  const pages = [cut(first.data)];
  const full = (first.data || []).length === pageSize;
  if (full && Number.isFinite(first.count)) {
    const froms = [];
    for (let from = pageSize; from < first.count; from += pageSize) froms.push(from);
    const got = new Array(froms.length);
    let next = 0;
    const worker = async () => { while (next < froms.length) { const i = next++; got[i] = cut((await page(froms[i], false)).data); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, froms.length) }, worker));
    pages.push(...got);
    // The count is from a moment ago: a lead added since could push one more page. Read on until a short page, as before.
    let from = pageSize * pages.length;
    while (pages[pages.length - 1].length === pageSize) {
      pages.push(cut((await page(from, false)).data));
      from += pageSize;
    }
  } else if (full) {
    for (let from = pageSize; ; from += pageSize) {
      const { data } = await page(from, false);
      pages.push(cut(data));
      if (!data || data.length < pageSize) break;
    }
  }
  const seenIds = new Set(), rows = [];
  for (const pg of pages) for (const row of pg) {
    if (row && row.id != null) { if (seenIds.has(row.id)) continue; seenIds.add(row.id); }
    rows.push(row);
  }
  return rows;
}

module.exports = { loadLeadList };
